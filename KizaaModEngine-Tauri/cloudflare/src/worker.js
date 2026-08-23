/**
 * Kiza Launcher's update service.
 *
 * It does two things: hand the launcher a signed manifest saying what the
 * latest release is, and serve the installer that manifest points at. Both come
 * out of one R2 bucket.
 *
 * Why a Worker rather than a public bucket: R2's own `r2.dev` addresses are
 * rate limited and Cloudflare says not to build on them. A Worker also lets the
 * manifest name its own download URL at request time — see `withDownloadUrl` —
 * which is what makes moving to a custom domain later a configuration change
 * rather than a re-publish of every release ever made.
 *
 * It stores no secrets. The signature that protects an update is made on the
 * release machine with a key that never leaves it, and checked by the launcher
 * against a public key compiled into the binary. A Worker serving a tampered
 * file cannot make the launcher install it.
 */

/** Release channels, spelled out so a request cannot name a bucket prefix. */
const CHANNELS = new Set(["stable", "beta"]);
const DEFAULT_CHANNEL = "stable";

/** The launcher tells us which channel it follows with this header. */
const CHANNEL_HEADER = "x-kiza-channel";

/**
 * How long a manifest may be cached at the edge.
 *
 * Short, because this is the file that decides whether a release exists at all:
 * a ten-minute cache is ten minutes of users being told there is nothing new
 * after a release has shipped.
 */
const MANIFEST_CACHE_SECONDS = 60;

/** Installers are named after their version, so they never change. */
const INSTALLER_CACHE_SECONDS = 60 * 60 * 24 * 365;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function channelFrom(request, url) {
  // The header is how the launcher asks. The query parameter exists so a human
  // can look at a channel from a browser without special tools.
  const asked =
    request.headers.get(CHANNEL_HEADER) ?? url.searchParams.get("channel") ?? DEFAULT_CHANNEL;
  const channel = asked.trim().toLowerCase();
  return CHANNELS.has(channel) ? channel : DEFAULT_CHANNEL;
}

/**
 * Turns the stored manifest into the one the launcher expects.
 *
 * What is kept in R2 names a `file`; what goes out names a full `url` pointing
 * back at this Worker. That indirection is the whole reason a release published
 * today keeps working if the service moves to another hostname tomorrow.
 */
function withDownloadUrl(manifest, origin, channel) {
  const platforms = {};

  for (const [platform, entry] of Object.entries(manifest.platforms ?? {})) {
    // A stored manifest that already carries a url is served as it is: it may
    // legitimately point somewhere else, and rewriting it would be this
    // service overruling a decision made at publish time.
    if (entry.url) {
      platforms[platform] = entry;
      continue;
    }
    if (!entry.file) continue;

    platforms[platform] = {
      signature: entry.signature,
      url: `${origin}/v1/download/${channel}/${encodeURIComponent(entry.file)}`,
    };
  }

  return { ...manifest, platforms };
}

async function serveManifest(request, env, url) {
  const channel = channelFrom(request, url);
  const object = await env.RELEASES.get(`${channel}/latest.json`);

  if (!object) {
    // 204 is what the updater reads as "nothing new", so an empty channel is a
    // quiet answer rather than an error the user sees.
    return new Response(null, { status: 204 });
  }

  let manifest;
  try {
    manifest = JSON.parse(await object.text());
  } catch {
    return json({ error: "The manifest for this channel is not valid JSON." }, 500);
  }

  return json(withDownloadUrl(manifest, url.origin, channel), 200, {
    "cache-control": `public, max-age=${MANIFEST_CACHE_SECONDS}`,
    "x-kiza-channel": channel,
  });
}

async function serveInstaller(request, env, segments) {
  const [channel, ...rest] = segments;
  if (!CHANNELS.has(channel)) {
    return json({ error: "Unknown channel." }, 404);
  }

  // One segment only. Anything with a slash in it would be a request to walk
  // the bucket rather than to download a release.
  if (rest.length !== 1) {
    return json({ error: "Not found." }, 404);
  }
  const file = decodeURIComponent(rest[0]);
  if (file.includes("/") || file.includes("\\") || file.startsWith(".")) {
    return json({ error: "Not found." }, 404);
  }

  // Passing the request's own headers through gives conditional requests and
  // byte ranges for free, which is what lets an interrupted download resume
  // instead of starting the 12 MB again.
  const object = await env.RELEASES.get(`${channel}/${file}`, {
    range: request.headers,
    onlyIf: request.headers,
  });

  // R2 reports a range even when none was asked for — it simply describes the
  // whole object. Answering 206 to a client that sent no Range header is wrong,
  // and a client that takes 206 at its word will treat a complete file as a
  // fragment. Only the request can say whether this is a partial response.
  const wantsRange = request.headers.has("range");

  if (!object) {
    return json({ error: "No such release." }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", `public, max-age=${INSTALLER_CACHE_SECONDS}, immutable`);
  headers.set("content-disposition", `attachment; filename="${file}"`);

  // `body` is absent when the object was matched but not returned: a 304, or a
  // range that could not be satisfied.
  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }

  if (wantsRange && object.range && "offset" in object.range) {
    const start = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - start;
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  headers.set("accept-ranges", "bytes");
  return new Response(object.body, { status: 200, headers });
}

async function serveHealth(request, env, url) {
  const channel = channelFrom(request, url);
  const object = await env.RELEASES.get(`${channel}/latest.json`);

  if (!object) {
    return json({ ok: true, channel, version: null, note: "No release published yet." });
  }

  try {
    const manifest = JSON.parse(await object.text());
    return json({ ok: true, channel, version: manifest.version ?? null });
  } catch {
    return json({ ok: false, channel, error: "The manifest is not valid JSON." }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Nothing here is ever written to from the outside. Publishing happens
    // through Cloudflare's own API with a token this Worker does not have.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Only GET is allowed." }, 405, { allow: "GET, HEAD" });
    }

    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] === "v1") {
      // `/v1/latest/<target>/<arch>/<current version>` — the trailing three are
      // filled in by the launcher and ignored here. They are in the path
      // because that is the shape Tauri documents, and because having them
      // means a future version of this service can answer differently for an
      // old client without any client needing to change.
      if (segments[1] === "latest") {
        return serveManifest(request, env, url);
      }
      if (segments[1] === "download") {
        return serveInstaller(request, env, segments.slice(2));
      }
      if (segments[1] === "health") {
        return serveHealth(request, env, url);
      }
    }

    // Something a person reached by accident, rather than the launcher.
    if (segments.length === 0) {
      return new Response(
        "Kiza Launcher update service.\n\n" +
          "This address serves update manifests and installers to the launcher.\n" +
          "Download Kiza from https://github.com/ludovicthenot/Kiza_Launcher\n",
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    return json({ error: "Not found." }, 404);
  },
};
