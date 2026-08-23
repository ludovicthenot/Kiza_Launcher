import fs from "node:fs";

const tauriConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const defaultCapability = JSON.parse(fs.readFileSync("src-tauri/capabilities/default.json", "utf8"));
const desktopCapability = JSON.parse(fs.readFileSync("src-tauri/capabilities/desktop.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");

const failures = [];
const expectedEndpoint = "https://github.com/ludovicthenot/Kiza_Launcher/releases/latest/download/latest.json";

const pubkey = tauriConfig.plugins?.updater?.pubkey;
if (!pubkey || pubkey.trim().length < 40 || /replace|placeholder|todo/i.test(pubkey)) {
  failures.push("Updater pubkey is missing in src-tauri/tauri.conf.json.");
}

const endpoints = tauriConfig.plugins?.updater?.endpoints ?? [];

if (endpoints.length === 0) {
  failures.push("The updater has no endpoint; nothing would ever update.");
}

// An endpoint reached over plain HTTP could be swapped in transit. The
// signature would still refuse the swapped file, but the launcher would be told
// there is nothing new — a silent way to keep someone on an old version.
for (const endpoint of endpoints) {
  if (!endpoint.startsWith("https://")) {
    failures.push(`Updater endpoints must be https: ${endpoint}`);
  }
}

// The fallback has to be there, and has to be last: Tauri stops at the first
// endpoint that answers, so a fallback listed first is not a fallback — it is
// the only source anyone ever reads.
if (!endpoints.includes(expectedEndpoint)) {
  failures.push(`The GitHub fallback (${expectedEndpoint}) must stay in the endpoint list.`);
} else if (endpoints[endpoints.length - 1] !== expectedEndpoint) {
  failures.push("The GitHub fallback must be the last endpoint, not the first.");
}

const cloudflare = endpoints.find((endpoint) => endpoint.includes("/v1/latest/"));
if (cloudflare && endpoints[0] !== cloudflare) {
  failures.push("The Cloudflare endpoint must come first, ahead of the GitHub fallback.");
}
if (cloudflare && !cloudflare.includes("{{current_version}}")) {
  failures.push("The Cloudflare endpoint must carry {{target}}/{{arch}}/{{current_version}}.");
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== true) {
  failures.push("Release config must create signed updater artifacts.");
}

const bundleTargets = tauriConfig.bundle?.targets ?? [];
const expectedBundleTargets = ["msi", "nsis"];
const normalizedBundleTargets = Array.isArray(bundleTargets)
  ? [...bundleTargets].sort()
  : [];
if (JSON.stringify(normalizedBundleTargets) !== JSON.stringify(expectedBundleTargets)) {
  failures.push("Release bundles must target NSIS and MSI.");
}

const nsisMode = tauriConfig.bundle?.windows?.nsis?.installMode;
if (nsisMode !== "currentUser") {
  failures.push("NSIS installMode must stay currentUser so updates preserve AppData and do not require admin rights.");
}

const csp = tauriConfig.app?.security?.csp;
if (!csp || csp === null) {
  failures.push("Production CSP must not be null.");
}

if ((defaultCapability.permissions ?? []).includes("process:default")) {
  failures.push("Capability must not grant process:default; use process:allow-restart only.");
}

for (const capability of [defaultCapability, desktopCapability]) {
  const permissions = capability.permissions ?? [];
  if (permissions.includes("updater:default") || permissions.includes("updater:allow-download-and-install")) {
    failures.push(`${capability.identifier} must not expose the combined updater download-and-install command.`);
  }
  for (const required of ["updater:allow-check", "updater:allow-download", "updater:allow-install"]) {
    if (!permissions.includes(required)) {
      failures.push(`${capability.identifier} is missing ${required}.`);
    }
  }
}

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (packageJson.version !== tauriConfig.version || packageJson.version !== cargoVersion) {
  failures.push("package.json, tauri.conf.json, and Cargo.toml versions must match.");
}

// --- Kiza Setup ------------------------------------------------------------

const setupConfPath = "kiza-setup/src-tauri/tauri.conf.json";
const setupCargoPath = "kiza-setup/src-tauri/Cargo.toml";

if (!fs.existsSync(setupConfPath) || !fs.existsSync(setupCargoPath)) {
  failures.push("Kiza Setup is missing; there would be nothing to hand to users.");
} else {
  const setupConfig = JSON.parse(fs.readFileSync(setupConfPath, "utf8"));
  const setupCargoVersion = fs
    .readFileSync(setupCargoPath, "utf8")
    .match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  // The installer writes its own version into the registry as DisplayVersion,
  // and the updater compares against that. A mismatch makes Windows report the
  // wrong version and can make every future update look already-applied.
  if (setupConfig.version !== packageJson.version || setupCargoVersion !== packageJson.version) {
    failures.push("Kiza Setup's version must match the launcher's.");
  }

  // Bundling the installer would produce an installer for the installer.
  if (setupConfig.bundle?.active !== false) {
    failures.push("Kiza Setup must not be bundled; it is shipped as a bare executable.");
  }

  // Without this the interface cannot reach Tauri at all, because there is no
  // bundler in kiza-setup to import from.
  if (setupConfig.app?.withGlobalTauri !== true) {
    failures.push("Kiza Setup needs withGlobalTauri; its interface has no bundler.");
  }

  if (!setupConfig.app?.security?.csp) {
    failures.push("Kiza Setup must ship a content security policy.");
  }
}

/**
 * The Node version CI installs, against the one wrangler refuses to run below.
 *
 * The release build succeeded, produced a signed installer, and then fell over
 * on the publish step because the workflow pinned Node 20 and wrangler wants
 * 22. It passed locally the whole time — this machine runs Node 24. Fifteen
 * minutes of compiling to learn that a number in a YAML file was too small.
 */
// Run from the launcher project, so the workflow is one level up.
const workflow = "../.github/workflows/release.yml";
if (fs.existsSync(workflow)) {
  const pinned = Number(
    fs.readFileSync(workflow, "utf8").match(/node-version:\s*(\d+)/)?.[1],
  );
  const wranglerRange = packageJson.devDependencies?.wrangler ?? "";
  // wrangler 4 requires Node 22 or newer.
  const needed = wranglerRange.includes("4.") ? 22 : 20;

  if (!Number.isFinite(pinned)) {
    failures.push("The release workflow does not pin a Node version.");
  } else if (pinned < needed) {
    failures.push(
      `The release workflow pins Node ${pinned}, but wrangler ${wranglerRange} needs ${needed} or newer. ` +
        "The build would succeed and the publish would fail.",
    );
  }
}

if (failures.length > 0) {
  console.error("Release config check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Release config check passed.");
