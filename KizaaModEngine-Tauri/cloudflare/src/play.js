/**
 * A name for a hosted server, instead of an address that changes.
 *
 * Minecraft connects over raw TCP, so there is no HTTP proxy that could put
 * a name in front of it; what puts a name in front of a Minecraft server is
 * DNS. This is dynamic DNS for Kiza's servers: a signed-in launcher asks for
 * `<name>.<PLAY_ZONE>`, and the Worker writes two records into Cloudflare —
 * an A (or AAAA) record with the address the request came from, and an SRV
 * record so the game finds the port without being told it. Ask again and the
 * records follow the new address; that is the whole of "dynamic".
 *
 * A name belongs to the account that first claimed it, for as long as that
 * account keeps it. Nobody else can move it, and the launcher that holds the
 * pass is the only thing that can ask.
 *
 * The name points at the machine only while its server runs. When the server
 * stops, the launcher parks the name: the address record is removed and the
 * name resolves to nothing, so an address is public for exactly as long as
 * there is something to join at it. The ownership stays.
 *
 * On cost: every claim is one or two DNS calls and, only when something
 * changed, one KV write. A server that starts with the address it had
 * yesterday costs the DNS calls and no write at all — KV writes are the
 * scarce thing on the free plan, and most starts change nothing.
 *
 * Needs three things this file does not contain:
 *   PLAY_ZONE              var     the parent name, e.g. play.example.com
 *   PLAY_ZONE_ID           var     the Cloudflare zone the parent lives in
 *   CLOUDFLARE_DNS_TOKEN   secret  a token with DNS:Edit on that zone only
 */

import { passFrom } from "./gate.js";
import { withinLimit } from "./support.js";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
/** How many names one account may hold. */
const NAMES_PER_ACCOUNT = 5;
/** Sixty seconds: an address that changed is followed within the minute. */
const TTL = 60;
/** Names that would be confusing or are conventionally something else. */
const RESERVED = new Set(["www", "api", "mail", "ftp", "admin", "kiza", "play", "server", "test", "ns1", "ns2"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function playConfigured(env) {
  return Boolean(env.PLAY_ZONE && env.PLAY_ZONE_ID && env.CLOUDFLARE_DNS_TOKEN && env.ACCESS);
}

/**
 * A name somebody may have: 3–32 characters of lowercase letters, digits
 * and dashes, neither starting nor ending with a dash, and not a word that
 * belongs to the infrastructure.
 */
export function validName(name) {
  if (typeof name !== "string") return false;
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(name)) return false;
  return !RESERVED.has(name);
}

/** The name a launcher suggests, from whatever the server is called. */
export function slugName(label) {
  const slug = String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : `${slug}-server`.replace(/^-/, "").slice(0, 32);
}

const nameKey = (name) => `play:${name}`;
const ownerKey = (sub) => `play-owner:${sub}`;

async function cloudflare(env, method, path, body) {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_DNS_TOKEN}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const reason = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    throw new Error(`Cloudflare DNS: ${reason}`);
  }
  return payload.result;
}

/** Creates or updates one record, by its remembered id. */
async function upsert(env, id, record) {
  const zone = env.PLAY_ZONE_ID;
  if (id) {
    try {
      return (await cloudflare(env, "PUT", `/zones/${zone}/dns_records/${id}`, record)).id;
    } catch {
      // The record was deleted by hand; make it again.
    }
  }
  return (await cloudflare(env, "POST", `/zones/${zone}/dns_records`, record)).id;
}

async function remove(env, id) {
  if (!id) return;
  try {
    await cloudflare(env, "DELETE", `/zones/${env.PLAY_ZONE_ID}/dns_records/${id}`);
  } catch {
    // Already gone is the outcome wanted.
  }
}

function addressOf(request) {
  return request.headers.get("cf-connecting-ip") ?? "";
}

/**
 * POST /v1/play/claim  { name, port }
 *
 * Points `<name>.<zone>` at the address this request came from, on `port`.
 * The same account may call it as often as it likes — every server start
 * does — and the records follow.
 */
export async function claimAddress(request, env) {
  if (!playConfigured(env)) {
    return json({ error: "Kiza addresses are not set up on this service." }, 503);
  }
  const found = await passFrom(request, env);
  if (!found.ok) return json({ error: "Sign in to Kiza to get an address." }, 401);
  if (!(await withinLimit(env.RELEASES, addressOf(request) || "unknown"))) {
    return json({ error: "Too many attempts. Try again in a minute." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  const name = String(body?.name ?? "").trim().toLowerCase();
  const port = Number(body?.port);
  if (!validName(name)) {
    return json({ error: "A name is 3 to 32 lowercase letters, digits and dashes." }, 400);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return json({ error: "The port must be between 1 and 65535." }, 400);
  }
  const ip = addressOf(request);
  if (!ip) return json({ error: "Your address could not be read." }, 400);

  const sub = found.pass.sub;
  const existing = await env.ACCESS.get(nameKey(name), { type: "json" });
  if (existing && existing.sub !== sub) {
    return json({ error: "That name belongs to someone else." }, 409);
  }
  const owned = (await env.ACCESS.get(ownerKey(sub), { type: "json" })) ?? [];
  if (!existing && owned.length >= NAMES_PER_ACCOUNT) {
    return json({ error: `An account may hold ${NAMES_PER_ACCOUNT} names.` }, 409);
  }

  const host = `${name}.${env.PLAY_ZONE}`;
  // The usual start: same address, same port, records in place. Nothing to
  // write anywhere — not to DNS, not to KV.
  if (existing && !existing.parked && existing.ip === ip && existing.port === port && existing.a_id && existing.srv_id) {
    return json({ ok: true, address: host, ip, port, ttl: TTL, unchanged: true });
  }
  const isV6 = ip.includes(":");
  let aId;
  let srvId;
  try {
    aId = await upsert(env, existing?.a_id, {
      type: isV6 ? "AAAA" : "A",
      name: host,
      content: ip,
      ttl: TTL,
      proxied: false,
      comment: "Kiza Launcher hosted server",
    });
    srvId = await upsert(env, existing?.srv_id, {
      type: "SRV",
      name: `_minecraft._tcp.${host}`,
      data: { priority: 0, weight: 0, port, target: host },
      ttl: TTL,
      comment: "Kiza Launcher hosted server",
    });
  } catch (error) {
    return json({ error: String(error.message ?? error) }, 502);
  }

  const unchanged =
    existing &&
    existing.ip === ip &&
    existing.port === port &&
    existing.a_id === aId &&
    existing.srv_id === srvId &&
    !existing.parked;
  if (!unchanged) {
    const record = { sub, ip, port, a_id: aId, srv_id: srvId, parked: false, updated: new Date().toISOString() };
    await env.ACCESS.put(nameKey(name), JSON.stringify(record));
  }
  if (!owned.includes(name)) {
    await env.ACCESS.put(ownerKey(sub), JSON.stringify([...owned, name]));
  }
  return json({ ok: true, address: host, ip, port, ttl: TTL });
}

/**
 * POST /v1/play/park  { name }
 *
 * The server stopped: the address record goes, the name stays owned. The
 * next claim puts the record back. Parking a name that is already parked
 * costs nothing.
 */
export async function parkAddress(request, env) {
  if (!playConfigured(env)) {
    return json({ error: "Kiza addresses are not set up on this service." }, 503);
  }
  const found = await passFrom(request, env);
  if (!found.ok) return json({ error: "Sign in to Kiza first." }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  const name = String(body?.name ?? "").trim().toLowerCase();
  const existing = await env.ACCESS.get(nameKey(name), { type: "json" });
  if (!existing) return json({ ok: true, parked: false });
  if (existing.sub !== found.pass.sub) {
    return json({ error: "That name belongs to someone else." }, 403);
  }
  if (existing.parked) return json({ ok: true, parked: true });
  await remove(env, existing.a_id);
  await remove(env, existing.srv_id);
  await env.ACCESS.put(
    nameKey(name),
    JSON.stringify({ ...existing, a_id: null, srv_id: null, parked: true, updated: new Date().toISOString() }),
  );
  return json({ ok: true, parked: true });
}

/** POST /v1/play/release  { name } — gives the name back. */
export async function releaseAddress(request, env) {
  if (!playConfigured(env)) {
    return json({ error: "Kiza addresses are not set up on this service." }, 503);
  }
  const found = await passFrom(request, env);
  if (!found.ok) return json({ error: "Sign in to Kiza first." }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  const name = String(body?.name ?? "").trim().toLowerCase();
  const existing = await env.ACCESS.get(nameKey(name), { type: "json" });
  if (!existing) return json({ ok: true, released: false });
  if (existing.sub !== found.pass.sub) {
    return json({ error: "That name belongs to someone else." }, 403);
  }
  await remove(env, existing.a_id);
  await remove(env, existing.srv_id);
  await env.ACCESS.delete(nameKey(name));
  const owned = (await env.ACCESS.get(ownerKey(found.pass.sub), { type: "json" })) ?? [];
  await env.ACCESS.put(ownerKey(found.pass.sub), JSON.stringify(owned.filter((n) => n !== name)));
  return json({ ok: true, released: true });
}

/** GET /v1/play/mine — the names this account holds. */
export async function myAddresses(request, env) {
  if (!playConfigured(env)) {
    return json({ configured: false, zone: null, names: [] });
  }
  const found = await passFrom(request, env);
  if (!found.ok) return json({ error: "Sign in to Kiza first." }, 401);
  const owned = (await env.ACCESS.get(ownerKey(found.pass.sub), { type: "json" })) ?? [];
  const names = [];
  for (const name of owned) {
    const record = await env.ACCESS.get(nameKey(name), { type: "json" });
    if (record) names.push({ name, address: `${name}.${env.PLAY_ZONE}`, ip: record.ip, port: record.port, parked: Boolean(record.parked), updated: record.updated });
  }
  return json({ configured: true, zone: env.PLAY_ZONE, names });
}
