/**
 * Publishes a built release to Cloudflare R2.
 *
 * Order matters and is not negotiable: the installer is uploaded first, the
 * manifest that names it second. Doing it the other way round leaves a window
 * — seconds, but real — where every launcher on earth is told a version exists
 * and then gets a 404 trying to fetch it.
 *
 *     node scripts/publish-release.mjs [--channel stable|beta] [--github]
 *
 * The signature is not uploaded as a file. It lives inside the manifest,
 * because that is where the updater looks for it.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releasesRoot = path.resolve(root, "..", "releases");
const cloudflareDir = path.join(root, "cloudflare");

const BUCKET = "kiza-releases";
const CHANNELS = new Set(["stable", "beta"]);
const REPOSITORY = "ludovicthenot/Kiza_Launcher";

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function run(command, args, options = {}) {
  const quoted = args.map((value) => (/[\s&|<>^]/.test(value) ? `"${value}"` : value));
  console.log(`\n> ${command} ${quoted.join(" ")}`);

  const result = spawnSync(command, quoted, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with code ${result.status}`);
  }
}

/**
 * The name the file takes once it is served.
 *
 * Spaces become dots because GitHub does that to asset names anyway, and having
 * the same file under two different names in two places is how a fallback ends
 * up pointing at nothing.
 */
function assetName(fileName) {
  return fileName.replace(/ /g, ".");
}

function locateBuild() {
  const directory = path.join(releasesRoot, version);
  const installer = path.join(directory, `Kiza Launcher_${version}_x64-setup.exe`);
  const signature = `${installer}.sig`;

  for (const file of [installer, signature]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `Missing ${path.basename(file)}. Build it first:\n    npm run build:installer`,
      );
    }
  }

  // A signature made against a different binary would be accepted by nothing,
  // and the failure would surface on a user's machine rather than here.
  const signedName = fs
    .readFileSync(signature, "utf8")
    .trim();
  const decoded = Buffer.from(signedName, "base64").toString("utf8");
  const signedFile = decoded.match(/file:(.+)/)?.[1]?.trim();
  if (signedFile && signedFile !== path.basename(installer)) {
    throw new Error(
      `The signature was made for "${signedFile}" but the installer is ` +
        `"${path.basename(installer)}". Rebuild before publishing.`,
    );
  }

  return { directory, installer, signature: fs.readFileSync(signature, "utf8").trim() };
}

function upload(key, file, contentType) {
  run(
    "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      `${BUCKET}/${key}`,
      "--file",
      file,
      "--content-type",
      contentType,
      // Without this wrangler writes to a local simulation of R2 and reports
      // success, which looks exactly like a real publish.
      "--remote",
    ],
    { cwd: cloudflareDir },
  );
}

/**
 * The manifest as it is stored.
 *
 * It names a `file`, not a URL. The Worker turns that into a full address at
 * request time, which is what lets the service move to another hostname without
 * every past release having to be republished.
 */
function buildManifest(installerName, signature, notes) {
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        file: assetName(installerName),
      },
    },
  };
}

function publishToGithub(directory, installer) {
  const tag = `v${version}`;
  const manifest = path.join(directory, "latest.json");

  // The GitHub copy is the fallback the launcher tries when Cloudflare does not
  // answer. It carries its own manifest, the one build-installer.mjs wrote with
  // absolute GitHub URLs in it.
  if (!fs.existsSync(manifest)) {
    throw new Error("latest.json is missing; run npm run build:installer first.");
  }

  const exists = spawnSync("gh", ["release", "view", tag, "--repo", REPOSITORY], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  if (exists.status !== 0) {
    run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      REPOSITORY,
      "--title",
      `Kiza Launcher ${tag}`,
      "--notes",
      "Kiza Setup installs and updates Kiza Launcher. Nothing else is needed.",
    ]);
  }

  run("gh", [
    "release",
    "upload",
    tag,
    installer,
    `${installer}.sig`,
    manifest,
    "--repo",
    REPOSITORY,
    "--clobber",
  ]);
}

function main() {
  const channel = argument("--channel", "stable");
  if (!CHANNELS.has(channel)) {
    throw new Error(`Unknown channel "${channel}". Use stable or beta.`);
  }

  const { directory, installer, signature } = locateBuild();
  const installerName = path.basename(installer);
  const size = (fs.statSync(installer).size / 1024 / 1024).toFixed(1);

  console.log(`Publishing Kiza Launcher ${version} to the ${channel} channel (${size} MB)`);

  // 1. The installer, so it is already there when the manifest names it.
  upload(`${channel}/${assetName(installerName)}`, installer, "application/octet-stream");

  // 2. The manifest, which is what makes the release visible to launchers.
  const manifest = buildManifest(installerName, signature, `Kiza Launcher ${version}`);
  const manifestPath = path.join(directory, `r2-${channel}-latest.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  upload(`${channel}/latest.json`, manifestPath, "application/json");

  if (process.argv.includes("--github")) {
    publishToGithub(directory, installer);
  } else {
    console.log(
      "\nGitHub fallback not touched. Push the tag to publish it there, or pass --github.",
    );
  }

  console.log(`\nPublished. Launchers on the ${channel} channel will see ${version}.`);
}

main();
