/**
 * Exercises the update Worker against a local simulation of R2.
 *
 * It touches no Cloudflare account: `wrangler dev --local` runs the Worker in
 * the same runtime Cloudflare uses, against a bucket on this disk. That makes
 * the refusals below testable — and they are the half worth testing, because a
 * service that serves the right file is obvious the first time anyone tries it,
 * while a service that also serves the wrong one is not.
 *
 *     node cloudflare/verify.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { mintPass } from "./src/access.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const BUCKET = "kiza-releases";

const INSTALLER = "Kiza.Launcher_9.9.9_x64-setup.exe";

/**
 * The secrets this run pretends the service has.
 *
 * Written to `.dev.vars` for the local Worker and used here to sign a pass, so
 * the test holds a real one rather than mocking the check it is testing.
 * Removed afterwards, and never written over a file that was already there —
 * that one would be somebody's real secrets.
 */
const TEST_SECRETS = {
  ACCESS_SECRET: "verify-mjs-access-secret",
  BOT_TOKEN: "verify-mjs-bot-token",
  DISCORD_CLIENT_ID: "0000000000000000000",
  DISCORD_CLIENT_SECRET: "verify-mjs-discord-secret",
};

const TESTER = "184700731213480000";

function wrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: here,
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed:\n${result.stderr ?? ""}`);
  }
}

function seed() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "kiza-worker-"));

  const manifest = {
    version: "9.9.9",
    notes: "A release that exists only for this test.",
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": { signature: "dGVzdA==", file: INSTALLER },
    },
  };
  const manifestPath = path.join(scratch, "latest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const installerPath = path.join(scratch, INSTALLER);
  fs.writeFileSync(installerPath, Buffer.alloc(10_000, 7));

  wrangler([
    "r2", "object", "put", `${BUCKET}/stable/latest.json`,
    "--file", manifestPath, "--content-type", "application/json", "--local",
  ]);
  wrangler([
    "r2", "object", "put", `${BUCKET}/stable/${INSTALLER}`,
    "--file", installerPath, "--content-type", "application/octet-stream", "--local",
  ]);

  // The channels nobody may have without asking, so the refusals below refuse
  // something that exists rather than something that is merely missing.
  for (const channel of ["alpha", "maker"]) {
    wrangler([
      "r2", "object", "put", `${BUCKET}/${channel}/latest.json`,
      "--file", manifestPath, "--content-type", "application/json", "--local",
    ]);
    wrangler([
      "r2", "object", "put", `${BUCKET}/${channel}/${INSTALLER}`,
      "--file", installerPath, "--content-type", "application/octet-stream", "--local",
    ]);
  }

  return scratch;
}

/** Gives the local Worker its secrets. Returns the file only if we made it. */
function writeDevVars() {
  const devVars = path.join(here, ".dev.vars");
  if (fs.existsSync(devVars)) return null;
  const lines = Object.entries(TEST_SECRETS).map(([name, value]) => `${name}=${value}`);
  fs.writeFileSync(devVars, `${lines.join("\n")}\n`);
  return devVars;
}

async function waitForWorker(deadlineMs = 90_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${BASE}/v1/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The Worker never started.");
}

const failures = [];

async function expect(what, request, predicate) {
  const response = await fetch(request.url, request.init);
  const body = response.headers.get("content-type")?.includes("json")
    ? await response.json()
    : null;

  const problem = predicate(response, body);
  if (problem) {
    failures.push(`${what}: ${problem}`);
    console.log(`  FAIL  ${what} — ${problem}`);
  } else {
    console.log(`  ok    ${what}`);
  }
}

async function run() {
  console.log("\nWhat the launcher relies on");

  await expect(
    "the manifest names a full download URL, not a bucket key",
    { url: `${BASE}/v1/latest/windows-x86_64/x86_64/0.0.1` },
    (response, body) => {
      if (response.status !== 200) return `status ${response.status}`;
      const entry = body?.platforms?.["windows-x86_64"];
      if (!entry?.url?.startsWith(BASE)) return `url was ${entry?.url}`;
      if (entry.file) return "the stored bucket key leaked into the response";
      if (!entry.signature) return "the signature is missing";
      return null;
    },
  );

  await expect(
    "a full download is 200, not 206",
    { url: `${BASE}/v1/download/stable/${INSTALLER}` },
    (response) => {
      if (response.status !== 200) return `status ${response.status}`;
      if (response.headers.get("accept-ranges") !== "bytes") return "ranges not advertised";
      return null;
    },
  );

  await expect(
    "a resumed download gets its bytes and a correct range",
    {
      url: `${BASE}/v1/download/stable/${INSTALLER}`,
      init: { headers: { Range: "bytes=100-199" } },
    },
    (response) => {
      if (response.status !== 206) return `status ${response.status}`;
      const range = response.headers.get("content-range");
      if (range !== "bytes 100-199/10000") return `content-range was ${range}`;
      return null;
    },
  );

  // Beta is a test channel, so this needs a pass to get far enough to find
  // that there is nothing published there. Without one the answer would be a
  // refusal, which is right and is checked further down.
  const betaPass = await mintPass(TEST_SECRETS.ACCESS_SECRET, {
    subject: TESTER,
    channels: ["beta"],
  });
  await expect(
    "an empty channel says 'nothing new' rather than failing",
    {
      url: `${BASE}/v1/latest/windows-x86_64/x86_64/0.0.1`,
      init: {
        headers: { "X-Kiza-Channel": "beta", authorization: `Bearer ${betaPass}` },
      },
    },
    (response) => (response.status === 204 ? null : `status ${response.status}`),
  );

  console.log("\nWhat must be refused");

  const refusals = [
    ["walking out of the channel", `${BASE}/v1/download/stable/%2E%2E%2Fbeta%2Flatest.json`, 404],
    ["a nested key", `${BASE}/v1/download/stable/sub/key.exe`, 404],
    ["a channel that is not one", `${BASE}/v1/download/anything/${INSTALLER}`, 404],
    ["a file that is not there", `${BASE}/v1/download/stable/nope.exe`, 404],
    ["an unknown path", `${BASE}/v1/nonsense`, 404],
  ];

  for (const [what, url, status] of refusals) {
    await expect(what, { url }, (response) =>
      response.status === status ? null : `status ${response.status}, wanted ${status}`,
    );
  }

  await expect(
    "writing to it",
    { url: `${BASE}/v1/latest/a/b/c`, init: { method: "POST" } },
    (response) => (response.status === 405 ? null : `status ${response.status}, wanted 405`),
  );

  await expect(
    "an unknown channel quietly becomes stable",
    { url: `${BASE}/v1/health`, init: { headers: { "X-Kiza-Channel": "../../etc" } } },
    (response, body) => (body?.channel === "stable" ? null : `channel was ${body?.channel}`),
  );

  console.log("\nWho may have a test build");

  const bot = { authorization: `Bot ${TEST_SECRETS.BOT_TOKEN}` };
  const alpha = { "X-Kiza-Channel": "alpha" };

  // The two that matter most. A test build is refused at the manifest *and* at
  // the file: the download address is a plain URL anybody can pass on, so a
  // check that happened only at the manifest would be one anybody could walk
  // around by sharing a link.
  await expect(
    "the manifest of a test channel, with no pass",
    { url: `${BASE}/v1/latest/windows-x86_64/x86_64/0.0.1`, init: { headers: alpha } },
    (response, body) => {
      if (response.status !== 403) return `status ${response.status}, wanted 403`;
      if (body?.reason !== "absent") return `reason was ${body?.reason}`;
      return null;
    },
  );

  await expect(
    "the installer of a test channel, with no pass",
    { url: `${BASE}/v1/download/alpha/${INSTALLER}` },
    (response) => (response.status === 403 ? null : `status ${response.status}, wanted 403`),
  );

  const goodPass = await mintPass(TEST_SECRETS.ACCESS_SECRET, {
    subject: TESTER,
    channels: ["alpha"],
  });
  // The same access, issued to one computer. This is the pass that travels
  // when somebody copies their Kiza folder to a friend.
  const boundPass = await mintPass(TEST_SECRETS.ACCESS_SECRET, {
    subject: TESTER,
    channels: ["alpha"],
    machine: "a".repeat(32),
  });
  const forged = await mintPass("not-the-services-secret", {
    subject: TESTER,
    channels: ["alpha", "maker"],
  });

  await expect(
    "the manifest of a test channel, with a pass for it",
    {
      url: `${BASE}/v1/latest/windows-x86_64/x86_64/0.0.1`,
      init: { headers: { ...alpha, authorization: `Bearer ${goodPass}` } },
    },
    (response) => (response.status === 200 ? null : `status ${response.status}`),
  );

  await expect(
    "the installer of a test channel, with a pass for it",
    {
      url: `${BASE}/v1/download/alpha/${INSTALLER}`,
      init: { headers: { authorization: `Bearer ${goodPass}` } },
    },
    (response) => (response.status === 200 ? null : `status ${response.status}`),
  );

  await expect(
    "a pass for another channel",
    {
      url: `${BASE}/v1/download/alpha/${INSTALLER}`,
      init: { headers: { authorization: `Bearer ${betaPass}` } },
    },
    (response) => (response.status === 403 ? null : `status ${response.status}, wanted 403`),
  );

  await expect(
    "a pass somebody wrote themselves",
    {
      url: `${BASE}/v1/download/alpha/${INSTALLER}`,
      init: { headers: { authorization: `Bearer ${forged}` } },
    },
    (response) => (response.status === 403 ? null : `status ${response.status}, wanted 403`),
  );

  await expect(
    "the Maker channel, to somebody with a Discord pass",
    {
      url: `${BASE}/v1/download/maker/${INSTALLER}`,
      init: { headers: { authorization: `Bearer ${goodPass}` } },
    },
    (response) => (response.status === 403 ? null : `status ${response.status}, wanted 403`),
  );

  await expect(
    "a pass on the computer it was issued to",
    {
      url: `${BASE}/v1/download/alpha/${INSTALLER}`,
      init: {
        headers: {
          authorization: `Bearer ${boundPass}`,
          "X-Kiza-Machine": "a".repeat(32),
        },
      },
    },
    (response) => (response.status === 200 ? null : `status ${response.status}`),
  );

  await expect(
    "the same pass, copied to another computer",
    {
      url: `${BASE}/v1/download/alpha/${INSTALLER}`,
      init: {
        headers: {
          authorization: `Bearer ${boundPass}`,
          "X-Kiza-Machine": "b".repeat(32),
        },
      },
    },
    (response, body) => {
      if (response.status !== 403) return `status ${response.status}, wanted 403`;
      if (body?.reason !== "another-machine") return `reason was ${body?.reason}`;
      return null;
    },
  );

  await expect(
    "the same pass, saying nothing about the computer",
    {
      url: `${BASE}/v1/download/alpha/${INSTALLER}`,
      init: { headers: { authorization: `Bearer ${boundPass}` } },
    },
    (response) => (response.status === 403 ? null : `status ${response.status}, wanted 403`),
  );

  console.log("\nThe bot, and the Setup key");

  await expect(
    "granting without being the bot",
    {
      url: `${BASE}/v1/access/grant`,
      init: {
        method: "POST",
        body: JSON.stringify({ discordId: TESTER, channels: ["alpha"] }),
      },
    },
    (response) => (response.status === 401 ? null : `status ${response.status}, wanted 401`),
  );

  await expect(
    "granting a channel the bot may not hand out",
    {
      url: `${BASE}/v1/access/grant`,
      init: {
        method: "POST",
        headers: bot,
        body: JSON.stringify({ discordId: TESTER, channels: ["maker"] }),
      },
    },
    (response) => (response.status === 400 ? null : `status ${response.status}, wanted 400`),
  );

  await expect(
    "granting the alpha list",
    {
      url: `${BASE}/v1/access/grant`,
      init: {
        method: "POST",
        headers: bot,
        body: JSON.stringify({ discordId: TESTER, channels: ["alpha"], note: "alpha" }),
      },
    },
    (response, body) =>
      response.status === 200 && body?.channels?.includes("alpha")
        ? null
        : `status ${response.status}, channels ${JSON.stringify(body?.channels)}`,
  );

  await expect(
    "reading back who was granted, and on how many machines",
    { url: `${BASE}/v1/access/member/${TESTER}`, init: { headers: bot } },
    (response, body) => {
      if (!body?.channels?.includes("alpha")) return `channels ${JSON.stringify(body?.channels)}`;
      if (typeof body.machines !== "number") return "no machine count";
      if (body.limit !== 2) return `limit was ${body.limit}`;
      return null;
    },
  );

  await expect(
    "forgetting somebody's machines",
    {
      url: `${BASE}/v1/access/reset`,
      init: { method: "POST", headers: bot, body: JSON.stringify({ discordId: TESTER }) },
    },
    (response, body) =>
      response.status === 200 && body?.machines === 0 ? null : `status ${response.status}`,
  );

  await expect(
    "a claim that will not say which computer it is",
    {
      url: `${BASE}/v1/access/claim`,
      init: {
        method: "POST",
        body: JSON.stringify({ code: "whatever", state: "x".repeat(20) }),
      },
    },
    // The code is checked first, so this is still a 404 — what matters is that
    // it is never a 200 for a launcher that named no machine.
    (response) => (response.status === 404 ? null : `status ${response.status}, wanted 404`),
  );

  const issued = await fetch(`${BASE}/v1/access/setup-key`, {
    method: "POST",
    headers: bot,
    body: JSON.stringify({ note: "verify.mjs" }),
  });
  const setupKey = issued.ok ? (await issued.json()).key : null;

  await expect(
    "the Maker channel, with the key its Setup carries",
    {
      url: `${BASE}/v1/download/maker/${INSTALLER}`,
      init: { headers: { "X-Kiza-Setup": setupKey ?? "none" } },
    },
    (response) => (response.status === 200 ? null : `status ${response.status}`),
  );

  await expect(
    "the Maker channel, with a key somebody made up",
    {
      url: `${BASE}/v1/download/maker/${INSTALLER}`,
      init: { headers: { "X-Kiza-Setup": "a-key-somebody-made-up" } },
    },
    (response) => (response.status === 403 ? null : `status ${response.status}, wanted 403`),
  );

  await expect(
    "a sign-in with no state of its own",
    { url: `${BASE}/v1/access/start` },
    (response) => (response.status === 400 ? null : `status ${response.status}, wanted 400`),
  );

  await expect(
    "claiming a code that was never issued",
    {
      url: `${BASE}/v1/access/claim`,
      init: { method: "POST", body: JSON.stringify({ code: "nope", state: "x".repeat(20) }) },
    },
    (response) => (response.status === 404 ? null : `status ${response.status}, wanted 404`),
  );
}

const scratch = seed();
const devVars = writeDevVars();
const worker = spawn(
  "npx",
  ["wrangler", "dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1"],
  { cwd: here, shell: process.platform === "win32", stdio: "ignore" },
);

try {
  await waitForWorker();
  await run();
} finally {
  worker.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
  if (devVars) fs.rmSync(devVars, { force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nEvery check passed.");
