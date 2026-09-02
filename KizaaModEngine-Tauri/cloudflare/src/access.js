/**
 * Who may have which build.
 *
 * Kiza ships four streams and only one of them is for everybody. Stable is
 * public. Beta and Experimental are tests, and a test with an audience that
 * did not agree to be tested on is how a launcher gets a reputation. Maker is
 * the edition with the tools in it, handed to the people who were given the
 * Setup.
 *
 * The rule that decides everything else here: **the client never judges its
 * own access.** A launcher can be edited, its settings file is a text file,
 * and its binary is on somebody else's computer. So the launcher asks and this
 * service answers; a build nobody is entitled to is a file the service refuses
 * to hand over, not a button the interface hides.
 *
 * Two ways in, because there are two different questions:
 *
 * - **Discord**, for the test channels. The bot already knows who is a patron,
 *   who boosted, and who was added by hand; it writes that down here, and a
 *   launcher proves it is one of those people by signing in once.
 * - **A Setup key**, for Maker. There is no "who" to ask about — the answer is
 *   "whoever was given the installer", and a key issued with it is exactly
 *   that fact, revocable one person at a time.
 *
 * What a launcher carries afterwards is a *pass*: a small signed statement
 * saying which channels this person may have and when that stops being true.
 * It is signed with a secret this service holds, so it can be checked on every
 * request without asking Discord again, and it expires so that access taken
 * away stops working without anything having to be hunted down.
 */

/**
 * Every stream a build can follow. Spelled out so a request cannot invent one.
 *
 * `alpha` and `experimental` are not the same thing, and the difference is
 * worth keeping. Alpha is the launcher, earlier: the same product, the same
 * identity on disk, published from the same edition, so anybody holding the
 * ordinary installer can follow it once they are let in. Experimental is a
 * different build of Kiza altogether — its own identity, its own folder — and
 * a launcher following `alpha` must never be handed one, because that would
 * not be an update, it would be a different application arriving under the
 * name of this one.
 */
export const CHANNELS = ["stable", "beta", "alpha", "experimental", "maker"];

/**
 * The channels anybody may have. Empty, for now, and that is deliberate.
 *
 * Kiza has not been released. Stable holds an old build and nothing else, and
 * the people who have it were handed it personally — so there is nobody for an
 * open door to serve, and an open door is a door somebody finds. Closing it
 * costs nothing today and stops the launcher being downloadable by anyone who
 * discovers this address before the day it is meant to be.
 *
 * Note what this means: with `stable` closed and the bot unable to grant it,
 * *nobody* can have it — signing in with Discord does not help, because there
 * is no grant to be had. That is the intended state, not an oversight.
 *
 * **On launch day, put `"stable"` back in this set.** That single change opens
 * the front door; nothing else has to move.
 */
export const OPEN_CHANNELS = new Set([]);

/** The channels a Discord account can open. */
export const DISCORD_CHANNELS = new Set(["beta", "alpha", "experimental"]);

/** The channels only a Setup key opens. */
export const KEY_CHANNELS = new Set(["maker"]);

/**
 * How long a pass is good for.
 *
 * A week, not a month. A pass is a bearer token: whoever holds the file holds
 * the access, so the question is not whether one can be copied but for how
 * long a copy is worth anything. Seven days means somebody taken off the list
 * — or somebody's file passed to a friend — stops working within the week,
 * without anyone having to hunt it down. The person still on the list never
 * notices: the launcher renews it while they are signed in.
 */
export const PASS_DAYS = 7;

/**
 * How many machines one account may have.
 *
 * Two, because one is wrong. A tester with a desktop and a laptop is the
 * ordinary case, not abuse, and locking them to one would turn helping into a
 * support ticket. Beyond two it stops being "my other computer" and starts
 * being somebody else's.
 *
 * The limit counts rather than forbids: the third machine is refused with a
 * sentence saying why and what to ask for, and the list is visible so a
 * account with far too many is a conversation rather than a silent block.
 */
export const MAX_MACHINES = 2;

/**
 * Long enough to walk to the browser and back, short enough that a code left
 * in a history somewhere is worthless by the time anybody finds it.
 */
export const HANDOFF_SECONDS = 300;

/** And how long the launcher's own request may sit unanswered. */
export const STATE_SECONDS = 900;

export function isChannel(name) {
  return CHANNELS.includes(name);
}

/** Whether this channel asks anything of whoever wants it. */
export function isGated(channel) {
  return isChannel(channel) && !OPEN_CHANNELS.has(channel);
}

/* --------------------------------------------------------------- encoding -- */

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes, or says it could not.
 *
 * Nothing here is given a value it chose: every one of these strings arrived
 * in a request. `atob` throws on anything that is not base64, and a throw in a
 * Worker is a 500 — which would turn "that is not a pass" into "this service
 * is broken", and hand whoever sent the rubbish a way to make the launcher say
 * so to everybody.
 */
function fromBase64Url(text) {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/**
 * Compares without leaking where two values stopped matching.
 *
 * A comparison that returns early tells anyone who can time it how much of a
 * signature they got right, which turns forging one into a few thousand
 * requests instead of a few billion years.
 */
function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let at = 0; at < left.length; at += 1) difference |= left[at] ^ right[at];
  return difference === 0;
}

/** A random, url-safe identifier — a state, a handoff code, a Setup key. */
export function randomToken(bytes = 24) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The stored form of a Setup key. Keys are checked, never kept. */
export async function hashKey(key) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  return toBase64Url(new Uint8Array(digest));
}

/* ------------------------------------------------------------------ passes -- */

/**
 * Writes a pass.
 *
 * `subject` is who it is about — a Discord id, or `setup:<name>` for a key —
 * and it is in there so a pass can be traced back to the grant that produced
 * it. `channels` is what it opens, decided here and now rather than by
 * whoever presents it later.
 */
export async function mintPass(
  secret,
  { subject, channels, machine = null, seconds = PASS_DAYS * 86400, now = Date.now() },
) {
  const issued = Math.floor(now / 1000);
  const payload = {
    v: 1,
    sub: subject,
    ch: [...channels].filter(isChannel).sort(),
    // The machine it was issued to, when there is one. Inside the signature,
    // so a pass copied to another computer is a pass that names a computer it
    // is not on — and the service can see that without trusting the copy.
    ...(machine ? { mac: machine } : {}),
    iat: issued,
    exp: issued + seconds,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmac(secret, body));
  return `${body}.${signature}`;
}

/**
 * Reads a pass, and says why not when it will not read.
 *
 * Every failure is a refusal with a reason rather than a thrown error: the
 * caller has to answer the request either way, and "your access ran out" and
 * "that is not a pass at all" deserve different words on the launcher's side.
 */
export async function readPass(secret, token, now = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [body, signature] = token.split(".", 2);
  if (!body || !signature) return { ok: false, reason: "malformed" };

  let expected;
  try {
    expected = await hmac(secret, body);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const given = fromBase64Url(signature);
  if (!given || !sameBytes(given, expected)) {
    return { ok: false, reason: "signature" };
  }

  const decoded = fromBase64Url(body);
  if (!decoded) return { ok: false, reason: "malformed" };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.v !== 1 || typeof payload.sub !== "string" || !Array.isArray(payload.ch)) {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, pass: payload };
}

/** Whether a pass opens a particular channel. */
export function grants(pass, channel) {
  return Boolean(pass) && Array.isArray(pass.ch) && pass.ch.includes(channel);
}

/**
 * Whether this pass is on the machine it was issued to.
 *
 * A pass with no machine on it predates this rule and is let through: the
 * alternative is locking out everybody who signed in last week, to close a
 * hole that closes by itself when their pass runs out.
 */
export function onItsMachine(pass, machine) {
  if (!pass?.mac) return true;
  return typeof machine === "string" && machine === pass.mac;
}

/* ------------------------------------------------------------ entitlements -- */

/**
 * The machines an account has signed in from, and whether one more may.
 *
 * Pure, so the rule can be tested without a store: given what is on record and
 * the machine asking, either the list to write back or a refusal. A machine
 * already known is never counted twice — signing in again on the same computer
 * is not a second machine, it is the same person renewing.
 */
export function admitMachine(known, machine, now = Date.now()) {
  const seen = Array.isArray(known) ? known.filter((entry) => entry && entry.id) : [];
  const already = seen.find((entry) => entry.id === machine);

  if (already) {
    return {
      allowed: true,
      machines: seen.map((entry) =>
        entry.id === machine ? { ...entry, last: now } : entry,
      ),
    };
  }

  if (seen.length >= MAX_MACHINES) {
    return { allowed: false, machines: seen, count: seen.length };
  }

  return { allowed: true, machines: [...seen, { id: machine, first: now, last: now }] };
}

/** Where an account's machines are kept. */
export function machinesKey(discordId) {
  return `machines:${discordId}`;
}

/** Where one person's grant is kept. */
export function memberKey(discordId) {
  return `member:${discordId}`;
}

/** And where a Setup key's grant is kept, under the hash of the key. */
export function setupKeyKey(hash) {
  return `setup:${hash}`;
}

/**
 * Cleans up what a bot asked to grant.
 *
 * The bot is trusted to say who; it is not trusted to invent a channel, and a
 * typo that granted `expiremental` would be a grant that silently opened
 * nothing. Unknown names are dropped and the caller is told what was kept.
 */
export function cleanChannels(wanted, allowed = DISCORD_CHANNELS) {
  const list = Array.isArray(wanted) ? wanted : [wanted];
  const kept = [
    ...new Set(
      list
        .filter((name) => typeof name === "string")
        .map((name) => name.trim().toLowerCase())
        .filter((name) => allowed.has(name)),
    ),
  ].sort();
  return kept;
}

/**
 * A Discord id, as far as we are willing to believe one.
 *
 * Snowflakes are decimal digits. Anything else is either a mistake or somebody
 * trying to write a key of their own choosing into the store.
 */
export function isDiscordId(value) {
  return typeof value === "string" && /^[0-9]{5,25}$/.test(value);
}
