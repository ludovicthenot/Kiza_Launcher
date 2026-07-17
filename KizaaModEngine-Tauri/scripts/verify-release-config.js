import fs from "node:fs";

const tauriConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const defaultCapability = JSON.parse(fs.readFileSync("src-tauri/capabilities/default.json", "utf8"));
const desktopCapability = JSON.parse(fs.readFileSync("src-tauri/capabilities/desktop.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");

const failures = [];
const expectedEndpoint = "https://github.com/ludovicthenot/Kiza-Client/releases/latest/download/latest.json";

const pubkey = tauriConfig.plugins?.updater?.pubkey;
if (!pubkey || pubkey.trim().length < 40 || /replace|placeholder|todo/i.test(pubkey)) {
  failures.push("Updater pubkey is missing in src-tauri/tauri.conf.json.");
}

const endpoints = tauriConfig.plugins?.updater?.endpoints ?? [];
if (endpoints.length !== 1 || endpoints[0] !== expectedEndpoint) {
  failures.push(`Updater endpoint must be exactly ${expectedEndpoint}.`);
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== true) {
  failures.push("Release config must create signed updater artifacts.");
}

const bundleTargets = tauriConfig.bundle?.targets ?? [];
if (!Array.isArray(bundleTargets) || bundleTargets.length !== 1 || bundleTargets[0] !== "nsis") {
  failures.push("Release bundles must target NSIS only.");
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

if (failures.length > 0) {
  console.error("Release config check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Release config check passed.");
