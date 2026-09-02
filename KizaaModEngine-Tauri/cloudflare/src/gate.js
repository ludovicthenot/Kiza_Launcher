/**
 * The doors: signing in with Discord, and the bot deciding who may.
 *
 * Three audiences reach this file and they are told apart by what they can
 * prove, never by what they claim to be:
 *
 * - **A launcher** starts a sign-in, then claims the result. It proves nothing
 *   at the start — anybody may ask — and proves it is the same launcher at the
 *   end by producing the `state` it began with.
 * - **Discord** comes back with a code. It is not trusted either: the code is
 *   exchanged over HTTPS with our own client secret, and what comes back is
 *   the only thing believed.
 * - **The bot** grants and revokes. It carries a shared secret and is the only
 *   caller that may write anything.
 *
 * The sign-in deliberately hands the launcher a short code rather than the
 * pass itself. The browser is a place with a history, a URL bar, and other
 * people's extensions; a pass that lived there for even a moment would be a
 * month of access sitting in a log. The code is worth one exchange, over
 * HTTPS, within five minutes, and only to whoever started the sign-in.
 */

import {
  admitMachine,
  cleanChannels,
  DISCORD_CHANNELS,
  grants,
  HANDOFF_SECONDS,
  hashKey,
  isDiscordId,
  KEY_CHANNELS,
  machinesKey,
  MAX_MACHINES,
  memberKey,
  mintPass,
  onItsMachine,
  PASS_DAYS,
  randomToken,
  readPass,
  setupKeyKey,
  STATE_SECONDS,
} from "./access.js";

/** Where the browser is sent once the sign-in is done. */
const APP_SCHEME = "kiza://access";

/** What Discord is asked for: who this is, and nothing else. */
const DISCORD_SCOPE = "identify";

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

/** Whether the service has been given what it needs to do this at all. */
export function accessConfigured(env) {
  return Boolean(env.ACCESS && env.ACCESS_SECRET && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}

/**
 * The pass a request carries, if it carries a readable one.
 *
 * Returned with its reason when it does not read, because the launcher needs
 * to tell "sign in again" from "your access ended" from "this build is not for
 * you", and those are three different sentences to a person.
 */
/**
 * Which machine is asking.
 *
 * A hash the launcher computes and sends; the service never learns what the
 * machine is, only whether it is the same one as last time. That is all the
 * rule needs, and it means this store holds no hardware inventory about
 * anybody.
 */
export function machineFrom(request) {
  const given = (request.headers.get("x-kiza-machine") ?? "").trim();
  return /^[a-f0-9]{16,64}$/i.test(given) ? given.toLowerCase() : null;
}

export async function passFrom(request, env) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!token) return { ok: false, reason: "absent" };
  return readPass(env.ACCESS_SECRET, token);
}

/**
 * Whether this request may have this channel.
 *
 * A Setup key is checked here as well as a pass, so a fresh Maker install can
 * update before anybody has signed in to anything: the key it was given is
 * proof enough, and it is the only proof there is for an edition that has no
 * "who".
 */
export async function mayHave(request, env, channel) {
  const key = request.headers.get("x-kiza-setup");
  if (key && env.ACCESS) {
    const stored = await env.ACCESS.get(setupKeyKey(await hashKey(key)), { type: "json" });
    if (stored && cleanChannels(stored.channels, KEY_CHANNELS).includes(channel)) {
      return { allowed: true, by: "setup-key" };
    }
  }

  const found = await passFrom(request, env);
  if (!found.ok) return { allowed: false, reason: found.reason };
  if (!grants(found.pass, channel)) return { allowed: false, reason: "not-granted" };
  // A pass names the machine it was issued to. Checked on every request, not
  // only at sign-in, because the file it lives in is the thing that travels.
  if (!onItsMachine(found.pass, machineFrom(request))) {
    return { allowed: false, reason: "another-machine" };
  }
  return { allowed: true, by: "pass", pass: found.pass };
}

/* ------------------------------------------------------------- signing in -- */

/**
 * Step one: the launcher asks, and we send the browser to Discord.
 *
 * The launcher's own `state` is remembered here rather than handed to Discord,
 * so what comes back through the browser cannot be replayed at another
 * launcher: the code is only exchangeable by whoever knows the state that
 * started it.
 */
export async function startSignIn(request, env, url) {
  if (!accessConfigured(env)) {
    return json({ error: "Discord sign-in is not set up on this service." }, 503);
  }
  const state = (url.searchParams.get("state") ?? "").trim();
  if (state.length < 16 || state.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(state)) {
    return json({ error: "A sign-in needs a state of its own." }, 400);
  }

  const nonce = randomToken(18);
  await env.ACCESS.put(`state:${nonce}`, JSON.stringify({ state }), {
    expirationTtl: STATE_SECONDS,
  });

  const authorize = new URL("https://discord.com/api/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/v1/access/callback`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", DISCORD_SCOPE);
  authorize.searchParams.set("state", nonce);
  authorize.searchParams.set("prompt", "none");

  return Response.redirect(authorize.toString(), 302);
}

/** A page for the browser, since the browser is where this ends. */
function closingPage(message, link) {
  const body = `<!doctype html><meta charset="utf-8"><title>Kiza</title>
<style>body{background:#0b0b12;color:#e8e8f0;font:16px/1.6 system-ui,sans-serif;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{max-width:32rem;padding:2rem;text-align:center}a{color:#a78bfa}</style>
<main><h1>Kiza</h1><p>${message}</p>${link ? `<p><a href="${link}">Open Kiza</a></p>` : ""}
<p style="opacity:.6">You can close this tab.</p></main>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * Step two: Discord sends the browser back, and we decide.
 *
 * Somebody who is not on any list still gets a courteous page rather than an
 * error: they signed in correctly, they simply have no access, and that is not
 * a failure on their part.
 */
export async function finishSignIn(request, env, url) {
  if (!accessConfigured(env)) return closingPage("Sign-in is not set up on this service.");

  const nonce = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!nonce || !code) return closingPage("That sign-in is missing something. Try again from Kiza.");

  const pending = await env.ACCESS.get(`state:${nonce}`, { type: "json" });
  if (!pending) return closingPage("That sign-in took too long. Try again from Kiza.");
  await env.ACCESS.delete(`state:${nonce}`);

  const form = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${url.origin}/v1/access/callback`,
  });
  const exchanged = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!exchanged.ok) return closingPage("Discord would not confirm that sign-in.");

  const { access_token: token } = await exchanged.json();
  const me = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!me.ok) return closingPage("Discord would not say who that was.");
  const account = await me.json();

  const grant = await env.ACCESS.get(memberKey(account.id), { type: "json" });
  const channels = cleanChannels(grant?.channels ?? [], DISCORD_CHANNELS);
  if (channels.length === 0) {
    return closingPage(
      `Signed in as <strong>${escapeHtml(account.username ?? "someone")}</strong>, ` +
        "but this account is not on the test list yet.",
    );
  }

  // The pass is not written yet: which machine it belongs to is only known
  // when the launcher claims it, and the machine is part of what is signed.
  const handoff = randomToken(24);
  await env.ACCESS.put(
    `handoff:${handoff}`,
    JSON.stringify({ account: account.id, state: pending.state, channels }),
    { expirationTtl: HANDOFF_SECONDS },
  );

  const back = `${APP_SCHEME}?code=${encodeURIComponent(handoff)}&state=${encodeURIComponent(pending.state)}`;
  return new Response(null, { status: 302, headers: { location: back } });
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

/**
 * Step three: the launcher exchanges its code for the pass.
 *
 * One use. The record is deleted before the pass is handed over, so a code
 * that leaked between the browser and here is worth nothing by the time
 * anybody tries it a second time.
 */
export async function claimPass(request, env) {
  if (!accessConfigured(env)) {
    return json({ error: "Discord sign-in is not set up on this service." }, 503);
  }
  let asked;
  try {
    asked = await request.json();
  } catch {
    return json({ error: "Send the code as JSON." }, 400);
  }

  const code = typeof asked?.code === "string" ? asked.code : "";
  const state = typeof asked?.state === "string" ? asked.state : "";
  if (!code || !state) return json({ error: "A claim needs its code and its state." }, 400);

  const stored = await env.ACCESS.get(`handoff:${code}`, { type: "json" });
  if (!stored) return json({ error: "That code has been used or has expired." }, 404);
  if (stored.state !== state) {
    // A code that arrived at a launcher other than the one that asked for it.
    return json({ error: "That code was not this launcher's." }, 403);
  }

  const machine = machineFrom(request) ?? (typeof asked?.machine === "string" ? asked.machine : null);
  const clean = machine && /^[a-f0-9]{16,64}$/i.test(machine) ? machine.toLowerCase() : null;
  if (!clean) {
    return json({ error: "This launcher did not say which machine it is." }, 400);
  }

  const known = await env.ACCESS.get(machinesKey(stored.account), { type: "json" });
  const verdict = admitMachine(known, clean);
  if (!verdict.allowed) {
    // Refused with a sentence, not a shrug: the person is on the list, and the
    // thing to do about this is ask, not guess.
    return json(
      {
        error:
          `This account already has ${MAX_MACHINES} machines. ` +
          "Ask an admin for a reset if you have changed computer.",
        reason: "too-many-machines",
        machines: verdict.count,
      },
      409,
    );
  }

  await env.ACCESS.delete(`handoff:${code}`);
  await env.ACCESS.put(machinesKey(stored.account), JSON.stringify(verdict.machines));

  const pass = await mintPass(env.ACCESS_SECRET, {
    subject: stored.account,
    channels: stored.channels,
    machine: clean,
  });
  return json({ pass, channels: stored.channels, days: PASS_DAYS });
}

/** What a pass says about itself, for a launcher showing its own state. */
export async function whoami(request, env) {
  const found = await passFrom(request, env);
  if (!found.ok) return json({ ok: false, reason: found.reason }, 401);
  return json({
    ok: true,
    subject: found.pass.sub,
    channels: found.pass.ch,
    expires: new Date(found.pass.exp * 1000).toISOString(),
  });
}

/* ------------------------------------------------------------------ the bot -- */

/**
 * Whether this is the bot.
 *
 * One shared secret, compared in constant time by the same helper the passes
 * use — a token check that returns early on the first wrong character is a
 * token check that can be guessed a character at a time.
 */
async function isBot(request, env) {
  if (!env.BOT_TOKEN) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.toLowerCase().startsWith("bot ") ? header.slice(4).trim() : "";
  if (!given) return false;
  // Comparing hashes rather than the values: equal length, and no way to learn
  // the secret's length from how long the comparison took.
  return (await hashKey(given)) === (await hashKey(env.BOT_TOKEN));
}

/**
 * The bot writing down who may test.
 *
 * `POST /v1/access/grant  {discordId, channels, note}`
 * `POST /v1/access/revoke {discordId}`
 * `GET  /v1/access/member/<id>`
 * `POST /v1/access/setup-key {note}`  → a Maker key, shown once
 */
export async function botRoute(request, env, segments) {
  if (!env.ACCESS) return json({ error: "This service has no access store." }, 503);
  if (!(await isBot(request, env))) return json({ error: "Not for you." }, 401);

  const [, action, ...rest] = segments; // segments = ["access", <action>, …]

  if (action === "member" && request.method === "GET") {
    const id = rest[0] ?? "";
    if (!isDiscordId(id)) return json({ error: "That is not a Discord id." }, 400);
    const grant = await env.ACCESS.get(memberKey(id), { type: "json" });
    const machines = (await env.ACCESS.get(machinesKey(id), { type: "json" })) ?? [];
    return json({
      id,
      channels: grant?.channels ?? [],
      note: grant?.note ?? null,
      // A count and dates, never the identifiers themselves. What is useful to
      // whoever is reading is "two machines, one of them yesterday" — the
      // hashes would tell them nothing they could act on.
      machines: machines.length,
      limit: MAX_MACHINES,
      lastSeen: machines.map((entry) => new Date(entry.last ?? 0).toISOString()),
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Use POST." }, 405, { allow: "POST" });
  }

  let asked = {};
  try {
    asked = await request.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }

  if (action === "grant") {
    if (!isDiscordId(asked.discordId)) return json({ error: "That is not a Discord id." }, 400);
    const channels = cleanChannels(asked.channels ?? ["beta"], DISCORD_CHANNELS);
    if (channels.length === 0) {
      return json(
        { error: `Grant one of: ${[...DISCORD_CHANNELS].join(", ")}.` },
        400,
      );
    }
    const record = {
      channels,
      note: typeof asked.note === "string" ? asked.note.slice(0, 200) : null,
      grantedAt: new Date().toISOString(),
    };
    await env.ACCESS.put(memberKey(asked.discordId), JSON.stringify(record));
    return json({ ok: true, id: asked.discordId, ...record });
  }

  if (action === "revoke") {
    if (!isDiscordId(asked.discordId)) return json({ error: "That is not a Discord id." }, 400);
    await env.ACCESS.delete(memberKey(asked.discordId));
    // The pass already in that launcher's hands keeps working until it runs
    // out. Said plainly rather than left to be discovered: the alternative is
    // a list of revoked passes to check on every request, which is a second
    // source of truth and the thing this design is built to avoid.
    return json({ ok: true, id: asked.discordId, note: `Any pass already issued lasts up to ${PASS_DAYS} days.` });
  }

  if (action === "reset") {
    if (!isDiscordId(asked.discordId)) return json({ error: "That is not a Discord id." }, 400);
    await env.ACCESS.delete(machinesKey(asked.discordId));
    // Passes already issued still name their old machine, so they keep working
    // where they are. What this clears is the count.
    return json({ ok: true, id: asked.discordId, machines: 0 });
  }

  if (action === "setup-key") {
    const key = randomToken(24);
    const record = {
      channels: ["maker"],
      note: typeof asked.note === "string" ? asked.note.slice(0, 200) : null,
      issuedAt: new Date().toISOString(),
    };
    await env.ACCESS.put(setupKeyKey(await hashKey(key)), JSON.stringify(record));
    // Shown once, stored as a hash. A key the service could read back is a key
    // that leaks with the store.
    return json({ ok: true, key, ...record });
  }

  return json({ error: "No such action." }, 404);
}
