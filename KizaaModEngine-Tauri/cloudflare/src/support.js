/**
 * Where a problem report goes.
 *
 * The launcher does not hold the webhook. It could have — the address would fit
 * in the binary next to the CurseForge key — but a Discord webhook URL is a
 * write credential for a channel, and anything compiled into a downloadable
 * .exe can be read out of it with `strings`. The first person to do that owns
 * the support channel.
 *
 * So the launcher posts here, this Worker holds the address as a secret, and
 * the rate limit lives at the edge where one machine cannot bypass it by
 * editing its own copy.
 */

/** What a ticket may be about. Spelled out so a report cannot invent a label. */
export const CATEGORIES = new Set([
  "crash",
  "launch",
  "mods",
  "account",
  "download",
  "interface",
  "other",
]);

/** Caps, applied before anything is forwarded. */
export const LIMITS = {
  summary: 160,
  details: 4000,
  diagnostic: 60_000,
  version: 32,
  installId: 8,
  logTail: 900,
  body: 96 * 1024,
};

/** Colour and label per category. The slug alone reads as a database value. */
const KINDS = {
  crash: { colour: 0xef4444, label: "Crash" },
  launch: { colour: 0xf59e0b, label: "Will not start" },
  mods: { colour: 0x8b5cf6, label: "Mods and packs" },
  account: { colour: 0x3b82f6, label: "Sign-in" },
  download: { colour: 0x06b6d4, label: "Downloads" },
  interface: { colour: 0xec4899, label: "Launcher interface" },
  other: { colour: 0x64748b, label: "Other" },
};

/**
 * A short, human-quotable reference for one ticket.
 *
 * Derived from the moment it arrived rather than random, so two tickets sent in
 * the same second collide and everything else does not — and so the reference
 * says roughly when it was sent, which is the one thing anyone reading it back
 * wants to know.
 */
export function ticketReference(now = Date.now()) {
  return `KZ-${now.toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Checks a report and returns either the cleaned version or why it was refused.
 *
 * Everything is length-capped here rather than trusted: this endpoint is open
 * to anything that can make an HTTPS request, not only to the launcher.
 */
export function validateTicket(input) {
  if (typeof input !== "object" || input === null) {
    return { error: "A report must be an object." };
  }

  const category = String(input.category ?? "other");
  if (!CATEGORIES.has(category)) {
    return { error: `Unknown category "${category}".` };
  }

  const summary = String(input.summary ?? "").trim();
  if (summary.length === 0) {
    return { error: "A report needs a summary." };
  }
  if (summary.length > LIMITS.summary) {
    return { error: `The summary is longer than ${LIMITS.summary} characters.` };
  }

  const details = String(input.details ?? "").trim();
  if (details.length > LIMITS.details) {
    return { error: `The details are longer than ${LIMITS.details} characters.` };
  }

  const diagnostic = typeof input.diagnostic === "string" ? input.diagnostic : "";
  if (diagnostic.length > LIMITS.diagnostic) {
    return { error: "The diagnostic report is too large." };
  }

  return {
    ticket: {
      category,
      summary,
      details,
      diagnostic,
      version: String(input.version ?? "unknown").slice(0, LIMITS.version),
      installId: String(input.installId ?? "").slice(0, LIMITS.installId),
      channel: input.channel === "beta" ? "beta" : "stable",
      system: String(input.system ?? "").slice(0, 200),
      java: String(input.java ?? "").slice(0, 200),
      instances: Number.isFinite(input.instances) ? Math.max(0, Math.trunc(input.instances)) : null,
      services: String(input.services ?? "").slice(0, 300),
      logTail: String(input.logTail ?? "").slice(0, LIMITS.logTail),
    },
  };
}

/**
 * The Discord message for a ticket.
 *
 * Written to be triaged from, not merely received. The first version put the
 * reference in the title, the category as a raw slug in the footer, and nothing
 * else — so deciding whether a report mattered meant downloading the attachment
 * every single time.
 *
 * What is on the card now is what explains most reports without opening
 * anything: the machine, the Java, how many instances, which services answered,
 * and the end of the last log. The attachment is still there for the ones that
 * need it.
 */
export function buildMessage(ticket, reference) {
  const kind = KINDS[ticket.category] ?? KINDS.other;

  const fields = [
    { name: "Kind", value: kind.label, inline: true },
    { name: "Version", value: `\`${ticket.version}\` ${ticket.channel}`, inline: true },
    { name: "Install", value: ticket.installId ? `\`${ticket.installId}\`` : "—", inline: true },
  ];

  if (ticket.system) {
    fields.push({ name: "Machine", value: ticket.system, inline: false });
  }
  if (ticket.java) {
    fields.push({ name: "Java", value: `\`${ticket.java}\``, inline: true });
  }
  if (ticket.instances !== null && ticket.instances !== undefined) {
    fields.push({ name: "Instances", value: String(ticket.instances), inline: true });
  }
  if (ticket.services) {
    fields.push({ name: "Services", value: ticket.services, inline: false });
  }

  // The details and the log share one description, and Discord caps it at four
  // thousand characters. The details are what the person wrote, so they go
  // first and are never the part that gets dropped.
  const parts = [ticket.details || "_No further details were given._"];
  if (ticket.logTail) {
    parts.push("", "**End of the last log**", "```", ticket.logTail, "```");
  }

  return {
    username: "Kiza Support",
    embeds: [
      {
        title: ticket.summary,
        description: parts.join("\n").slice(0, 4000),
        color: kind.colour,
        fields,
        footer: {
          text: ticket.diagnostic
            ? `${reference} · full report attached`
            : `${reference} · no report attached`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
    // Nothing in a report should be able to ping a channel.
    allowed_mentions: { parse: [] },
  };
}

/** The multipart body Discord wants when a file rides along. */
export function buildForm(message, diagnostic, reference) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(message));
  if (diagnostic) {
    form.append(
      "files[0]",
      new Blob([diagnostic], { type: "text/plain" }),
      `${reference}.txt`,
    );
  }
  return form;
}

/**
 * How many reports one address may send per minute.
 *
 * Cloudflare's own rate limiting binding was tried first and does not count:
 * deployed, bound, and reported in the dashboard as "3 requests/60s", it
 * answered `{success: true}` to the seventeenth request in three minutes from
 * one address. Rather than ship a limit that only exists in the configuration
 * file, the count is kept here, in the bucket this Worker already has.
 */
export const PER_MINUTE = 3;

/**
 * A key that identifies an address without storing one.
 *
 * The bucket would otherwise accumulate a list of every IP that has ever asked
 * for help, which is a log of who was having trouble and when. A hash keeps the
 * counting and drops the identity — two requests from one address land on the
 * same key, and the key says nothing about whose it is.
 */
export async function limitKey(address, minute) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`kiza-support:${address}`),
  );
  const hex = [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `support-limits/${hex}/${minute}`;
}

/** The minute a moment falls in, which is also how old counters expire. */
export function minuteOf(now = Date.now()) {
  return Math.floor(now / 60_000);
}

/**
 * Counts one report against an address, and says whether it may proceed.
 *
 * Two requests arriving at the same instant can both read the same count and
 * both write one more, so a determined caller can exceed the limit by a little.
 * That is accepted: this exists to stop a stuck retry loop and an impatient
 * finger, not an attacker, and the alternative is a lock on every report.
 */
export async function withinLimit(bucket, address, now = Date.now()) {
  const minute = minuteOf(now);
  const key = await limitKey(address, minute);

  const existing = await bucket.get(key);
  const count = existing ? Number(await existing.text()) || 0 : 0;
  if (count >= PER_MINUTE) return false;

  await bucket.put(key, String(count + 1), {
    // Read back only within the minute it counts for, and swept afterwards by
    // the bucket's own lifecycle rule rather than by anything here.
    httpMetadata: { cacheControl: "no-store" },
  });
  return true;
}
