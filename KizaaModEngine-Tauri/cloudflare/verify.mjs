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

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const BUCKET = "kiza-releases";

const INSTALLER = "Kiza.Launcher_9.9.9_x64-setup.exe";

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

  return scratch;
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

  await expect(
    "an empty channel says 'nothing new' rather than failing",
    {
      url: `${BASE}/v1/latest/windows-x86_64/x86_64/0.0.1`,
      init: { headers: { "X-Kiza-Channel": "beta" } },
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
}

const scratch = seed();
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
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nEvery check passed.");
