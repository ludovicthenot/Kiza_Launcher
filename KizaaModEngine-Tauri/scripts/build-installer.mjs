/**
 * Builds Kiza Setup: the launcher, wrapped inside the installer that ships it.
 *
 * The order is not negotiable. The launcher is compiled first, then packed into
 * the payload, then the installer is compiled around that payload. Building the
 * installer before the payload exists produces a binary that runs, looks right,
 * and installs nothing — which is why `payload.rs` refuses to install an empty
 * archive rather than reporting success.
 *
 * Output lands in ../releases/<version>/ beside the launcher project, never
 * inside it.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { manifestNotes, releaseNotes } from "./release-notes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releasesRoot = path.resolve(root, "..", "releases");

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const setupCrate = path.join(root, "kiza-setup", "src-tauri");

/** The name the launcher is given inside the payload, and on disk afterwards. */
const LAUNCHER_NAME = "Kiza Launcher.exe";
/** What Cargo calls the launcher binary before it is renamed. */
const BUILT_LAUNCHER = "KizaaMod.exe";

const OWNER_REPO = "ludovicthenot/Kiza_Launcher";

function run(command, args, options = {}) {
  // Windows needs a shell to resolve `npx` and `cargo` shims, and a shell
  // re-splits the arguments on spaces. The project lives under "Kiza Mods", so
  // every path handed over here has one.
  const quoted = args.map((argument) =>
    /[\s&|<>^]/.test(argument) ? `"${argument}"` : argument,
  );

  console.log(`\n> ${command} ${quoted.join(" ")}`);
  const result = spawnSync(command, quoted, {
    stdio: "inherit",
    cwd: root,
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with code ${result.status}`);
  }
}

function megabytes(file) {
  return (fs.statSync(file).size / 1024 / 1024).toFixed(1);
}

/* -------------------------------------------------------------- the launcher */

function buildLauncher() {
  // Baked in with `option_env!`, so a build without it produces a launcher
  // whose CurseForge half is silently dead — and nothing downstream would
  // notice until a user searched for a mod.
  if (!process.env.KIZAMODS_CURSEFORGE_API_KEY?.trim()) {
    throw new Error(
      "Missing KIZAMODS_CURSEFORGE_API_KEY. Refusing to ship a launcher without CurseForge support.",
    );
  }

  // `--no-bundle` stops Tauri from also producing the NSIS wizard this whole
  // exercise exists to replace. The configuration keeps its bundle targets, so
  // a plain `tauri build` still makes one if it is ever wanted.
  run("npx", ["tauri", "build", "--no-bundle"]);

  const built = path.join(root, "src-tauri", "target", "release", BUILT_LAUNCHER);
  if (!fs.existsSync(built)) {
    throw new Error(`The launcher was not produced at ${built}`);
  }
  return built;
}

/* ----------------------------------------------------------------- the payload */

function packPayload(launcherExe) {
  const staging = path.join(root, "kiza-setup", "payload");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, "files"), { recursive: true });

  // Renamed on the way in. Cargo names the binary after the crate, which is
  // how every existing install ended up with a "KizaaMod.exe" in it.
  fs.copyFileSync(launcherExe, path.join(staging, "files", LAUNCHER_NAME));

  const archive = path.join(staging, "payload.zip");
  // Packed by the same library that reads it back, and with zstd: PowerShell's
  // Compress-Archive only knows deflate, which left the payload at 19 MB where
  // this gets it to about 10.
  run("cargo", ["run", "--release", "--bin", "pack-payload", "--", path.join(staging, "files"), archive], {
    cwd: setupCrate,
  });

  console.log(
    `payload: ${megabytes(archive)} MB compressed from ${megabytes(launcherExe)} MB`,
  );
  return archive;
}

/* --------------------------------------------------------------- the installer */

function buildInstaller(payload) {
  // Run from the crate rather than with --manifest-path: one less long path
  // for the Windows shell to mangle.
  run("cargo", ["build", "--release", "--bin", "KizaSetup"], {
    cwd: setupCrate,
    env: { ...process.env, KIZA_SETUP_PAYLOAD: payload },
  });

  const built = path.join(setupCrate, "target", "release", "KizaSetup.exe");
  if (!fs.existsSync(built)) {
    throw new Error(`The installer was not produced at ${built}`);
  }
  return built;
}

/* ------------------------------------------------------------------- signing */

function sign(file) {
  const keyPath = path.join(root, ".tauri-keys", "kizamods-updater.key");
  const env = { ...process.env };
  if (!env.TAURI_SIGNING_PRIVATE_KEY && !env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    if (!fs.existsSync(keyPath)) {
      throw new Error(
        "No signing key. Set TAURI_SIGNING_PRIVATE_KEY or put one at .tauri-keys/kizamods-updater.key.",
      );
    }
    env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(keyPath, "utf8").trim();
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
  }

  run("npx", ["tauri", "signer", "sign", file], { env });

  const signature = `${file}.sig`;
  if (!fs.existsSync(signature)) {
    // Without this the updater rejects the download, and it would do so on the
    // user's machine rather than here.
    throw new Error(`Signing produced no ${path.basename(signature)}`);
  }
  return signature;
}

/* ------------------------------------------------------------- the update feed */

function writeUpdaterManifest(directory, installerName, signatureFile) {
  // GitHub replaces spaces in an asset name with dots when it serves it. A URL
  // built from the file name as it sits on disk would 404 for every user.
  const assetName = installerName.replace(/ /g, ".");

  const manifest = {
    version,
    notes: manifestNotes(version),
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: fs.readFileSync(signatureFile, "utf8").trim(),
        url: `https://github.com/${OWNER_REPO}/releases/download/v${version}/${assetName}`,
      },
    },
  };

  const file = path.join(directory, "latest.json");
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

/* ---------------------------------------------------------------------- main */

/**
 * Every source file the build needs, checked before the first compiler runs.
 *
 * `pack-payload.rs` once sat in a folder that `.gitignore` was quietly
 * swallowing, so the build passed on the machine that had the file and failed
 * in CI — thirteen minutes in, after a full launcher compile, with cargo
 * reporting a bin target that was simply not there. One second of checking
 * here turns that into an immediate, readable failure.
 */
function requireSources() {
  const needed = [
    "kiza-setup/src-tauri/src/bin/pack-payload.rs",
    "kiza-setup/src-tauri/src/main.rs",
    "kiza-setup/ui/index.html",
    "cloudflare/src/worker.js",
  ];

  const missing = needed.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length > 0) {
    throw new Error(
      [
        "Missing source file(s) the build needs:",
        ...missing.map((file) => `  ${file}`),
        "",
        "If they exist on disk, check .gitignore — this has happened before.",
      ].join("\n"),
    );
  }
}

function main() {
  console.log(`Building Kiza Setup ${version}`);
  requireSources();

  const launcher = buildLauncher();
  const payload = packPayload(launcher);
  const installer = buildInstaller(payload);

  // Beside the project, not inside it: the repository holds sources, the
  // releases folder holds what is handed to people.
  const destination = path.join(releasesRoot, version);
  fs.mkdirSync(destination, { recursive: true });

  const installerName = `Kiza Launcher_${version}_x64-setup.exe`;
  const delivered = path.join(destination, installerName);
  fs.copyFileSync(installer, delivered);

  const signature = sign(delivered);
  const manifest = writeUpdaterManifest(destination, installerName, signature);

  // Written beside the artefacts so the release step hands out the same text
  // the manifest was built from, rather than a second account of the release.
  const notes = path.join(destination, "NOTES.md");
  fs.writeFileSync(notes, `${releaseNotes(version)}
`);

  console.log("\nReady:");
  for (const file of [delivered, signature, manifest, notes]) {
    console.log(`  ${file}  (${megabytes(file)} MB)`);
  }
}

main();
