/**
 * Builds Kiza Setup: the launcher, wrapped inside the installer that ships it.
 *
 * The order is not negotiable. The launcher is compiled first, then packed into
 * the payload, then the installer is compiled around that payload. Building the
 * installer before the payload exists produces a binary that runs, looks right,
 * and installs nothing — which is why `payload.rs` refuses to install an empty
 * archive rather than reporting success.
 *
 * Output lands in ../releases/<edition>/<version>/ beside the launcher project,
 * never inside it — one folder per channel, because Stable and the Maker are
 * different applications and a single pile of files cannot say which is which.
 *
 * Every edition ships inside Kiza Setup. What changes between them is the
 * name on the folder, the shortcut, the uninstall entry and the notification
 * identity — all of which Kiza Setup reads from the same `KIZA_EDITION` this
 * script was run with, so the Maker installs beside the launcher instead of
 * over it.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { manifestNotes, releaseNotes } from "./release-notes.mjs";
import { channelsFor, edition, releaseDir } from "./channels.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const channel = edition();

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const setupCrate = path.join(root, "kiza-setup", "src-tauri");

/** What this edition is called, everywhere a person sees it. */
const PRODUCT = channel === "stable" ? "Kiza Launcher" : `Kiza ${channel[0].toUpperCase()}${channel.slice(1)}`;

/**
 * The name the launcher is given inside the payload, and on disk afterwards.
 *
 * It must match what `kiza-setup`'s layout expects for this edition, because
 * the installer looks for the file by name once it has unpacked the payload.
 */
const LAUNCHER_NAME = `${PRODUCT}.exe`;
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

/** What this edition's installer is called, on disk and once served. */
function installerName() {
  return `${PRODUCT}_${version}_x64-setup.exe`;
}

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
  // The edition's own configuration carries its identifier, its window title
  // and its update endpoint. Stable is the base file and needs no overlay.
  const configuration =
    channel === "stable" ? [] : ["--config", `src-tauri/tauri.${channel}.conf.json`];
  run("npx", ["tauri", "build", "--no-bundle", ...configuration]);

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

/**
 * The stream this installer hands out, when it is built for one.
 *
 * `--channel alpha` produces the installer given to a tester: the same
 * launcher as everybody else's, with a note beside it saying which stream this
 * copy was for. The launcher reads that note once, on its first run.
 *
 * Without the flag the installer says nothing and the launcher stays on
 * whatever it already follows — which is what the ordinary installer must do,
 * so that reinstalling over somebody's launcher does not quietly move them.
 */
function handedOutChannel() {
  const index = process.argv.indexOf("--channel");
  if (index === -1) return null;

  const asked = (process.argv[index + 1] ?? "").trim().toLowerCase();
  const allowed = channelsFor(edition());
  if (!allowed.includes(asked)) {
    throw new Error(
      `A ${edition()} installer cannot hand out "${asked}". ` +
        `It may hand out: ${allowed.join(", ")}.`,
    );
  }
  return asked;
}

/**
 * The access key this installer writes on install, when it is given one.
 *
 * Some channels cannot be reached from inside the launcher by anybody: there is
 * no sign-in that leads to them, and no list to be added to. The only way in is
 * that somebody was handed this executable, and this is what makes that true.
 *
 *     node scripts/build-installer.mjs --channel stable --key <key from /makerkey>
 *
 * Never logged. The key is a credential and a build log is a thing people
 * paste into a chat.
 */
function carriedKey() {
  const index = process.argv.indexOf("--key");
  if (index === -1) return null;

  const key = (process.argv[index + 1] ?? "").trim();
  // Checked here as well as in the crate, because the useful moment to catch a
  // shell mangling the argument is now, not in an installer somebody has
  // already handed out.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new Error(
      "--key needs the token /makerkey printed: 8 to 128 url-safe characters.",
    );
  }
  return key;
}

function buildInstaller(payload) {
  const handedOut = handedOutChannel();
  const key = carriedKey();
  if (handedOut) {
    console.log(`
This installer will put the launcher on the ${handedOut} channel.`);
  }
  if (key) {
    // The fact, not the key.
    console.log("It carries an access key, so the launcher it installs can update.");
  }

  // Run from the crate rather than with --manifest-path: one less long path
  // for the Windows shell to mangle.
  run("cargo", ["build", "--release", "--bin", "KizaSetup"], {
    cwd: setupCrate,
    env: {
      ...process.env,
      KIZA_SETUP_PAYLOAD: payload,
      // Absent rather than empty when there is none: `option_env!` reads it at
      // compile time, and an empty string is a value the crate would have to
      // second-guess.
      ...(handedOut ? { KIZA_SETUP_CHANNEL: handedOut } : {}),
      ...(key ? { KIZA_SETUP_KEY: key } : {}),
    },
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
  console.log(`Building ${channel} ${version}`);

  requireSources();
  const launcher = buildLauncher();
  const payload = packPayload(launcher);
  const installer = buildInstaller(payload);

  // Beside the project, not inside it, and under this edition's own name: the
  // repository holds sources, the releases folder holds what is handed to
  // people, and each channel hands out its own thing.
  // Filed under what it hands out, not under what built it.
  //
  // The ordinary installer and the one that puts a tester on the alpha are the
  // same size, the same name and the same version — and they do different
  // things. Sharing a folder meant the second silently replaced the first, and
  // the file left behind was the one that quietly moves people onto a test
  // stream. Two folders, one truth each.
  const destination = releaseDir(root, version, handedOutChannel() ?? edition());
  fs.mkdirSync(destination, { recursive: true });

  const name = installerName();
  const delivered = path.join(destination, name);
  fs.copyFileSync(installer, delivered);

  const signature = sign(delivered);
  const manifest = writeUpdaterManifest(destination, name, signature);

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
