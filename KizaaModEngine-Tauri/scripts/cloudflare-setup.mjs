/**
 * Puts the update service in place: the R2 bucket, the Worker, and the address
 * the launcher will ask.
 *
 * Safe to run again. Creating a bucket that exists is not treated as a failure,
 * and deploying a Worker that exists replaces it.
 *
 * The one thing this script cannot do is log in. `wrangler login` opens a
 * browser and waits for a person to approve it, which is exactly as it should
 * be — nothing here should be able to reach a Cloudflare account on its own.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloudflareDir = path.join(root, "cloudflare");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");

const BUCKET = "kiza-releases";
const WORKER = "kiza-updates";

/** Kept as the second endpoint, so a Cloudflare outage is not a dead end. */
const GITHUB_FALLBACK =
  "https://github.com/ludovicthenot/Kiza-Client/releases/latest/download/latest.json";

function wrangler(args, { allowFailure = false } = {}) {
  const quoted = args.map((argument) => (/\s/.test(argument) ? `"${argument}"` : argument));
  console.log(`\n> wrangler ${quoted.join(" ")}`);

  const result = spawnSync("npx", ["wrangler", ...quoted], {
    cwd: cloudflareDir,
    shell: process.platform === "win32",
    encoding: "utf8",
    // Captured rather than inherited: the deployed address is in this output
    // and has to be read back, not just shown.
    stdio: ["inherit", "pipe", "pipe"],
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`wrangler ${args[0]} failed with code ${result.status}`);
  }
  return { ok: result.status === 0, output };
}

function requireLogin() {
  const { ok, output } = wrangler(["whoami"], { allowFailure: true });
  if (ok && !/Not logged in/i.test(output)) return;

  console.error(
    [
      "",
      "Not signed in to Cloudflare.",
      "",
      "Run this once, in a terminal you can click in — it opens a browser and",
      "waits for you to approve. Nothing else here can reach your account.",
      "",
      "    cd KizaaModEngine-Tauri/cloudflare",
      "    npx wrangler login",
      "",
      "Then run this script again.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function ensureBucket() {
  const { ok, output } = wrangler(["r2", "bucket", "create", BUCKET], { allowFailure: true });
  if (ok) {
    console.log(`Bucket ${BUCKET} created.`);
    return;
  }
  // Already existing is the outcome that was wanted, so it is not a failure.
  if (/already exists|10004/i.test(output)) {
    console.log(`Bucket ${BUCKET} was already there.`);
    return;
  }
  throw new Error(`Could not create the bucket ${BUCKET}.`);
}

/** Deploys, and reads the address Cloudflare gave the Worker back out. */
function deployWorker() {
  const { output } = wrangler(["deploy"]);

  // The deploy prints every route it published; the workers.dev one is the
  // address the launcher will ask.
  const match = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  if (!match) {
    throw new Error(
      "The Worker deployed but no workers.dev address appeared in the output. " +
        "If you attached a custom domain instead, pass it with --endpoint.",
    );
  }
  return match[0];
}

/**
 * Points the launcher at the service.
 *
 * The Cloudflare address goes first and GitHub second: Tauri tries them in
 * order and stops at the first that answers, so this is the fallback behaving
 * as a fallback rather than as a competing source of truth.
 */
function writeEndpoint(base) {
  const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
  const primary = `${base}/v1/latest/{{target}}/{{arch}}/{{current_version}}`;

  config.plugins.updater.endpoints = [primary, GITHUB_FALLBACK];
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`);

  console.log("\nThe launcher now asks:");
  console.log(`  1. ${primary}`);
  console.log(`  2. ${GITHUB_FALLBACK}   (only if the first does not answer)`);
}

function main() {
  const explicit = process.argv.includes("--endpoint")
    ? process.argv[process.argv.indexOf("--endpoint") + 1]
    : null;

  requireLogin();
  ensureBucket();

  const base = (explicit ?? deployWorker()).replace(/\/+$/, "");
  writeEndpoint(base);

  console.log(
    [
      "",
      "Done. Check it with:",
      `    curl ${base}/v1/health`,
      "",
      "It will say there is no release yet — publish one with:",
      "    npm run release:publish",
      "",
      "The version currently in src-tauri/tauri.conf.json is what the next build",
      "will look for. Rebuild the installer for the new address to take effect:",
      "    npm run build:installer",
      "",
    ].join("\n"),
  );
}

main();
