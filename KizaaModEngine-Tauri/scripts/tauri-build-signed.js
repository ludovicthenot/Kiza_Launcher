import fs from "node:fs";
import { spawnSync } from "node:child_process";

const env = { ...process.env };
const localKeyPath = ".tauri-keys/kizamods-updater.key";

if (!env.KIZAMODS_CURSEFORGE_API_KEY?.trim()) {
  console.error(
    "Missing KIZAMODS_CURSEFORGE_API_KEY. Refusing to build a release without CurseForge support.",
  );
  process.exit(1);
}

// Tauri 2 reads the key from TAURI_SIGNING_PRIVATE_KEY (raw contents). Feed it
// the local dev key when no signing env var is already provided (CI sets it).
if (!env.TAURI_SIGNING_PRIVATE_KEY && !env.TAURI_SIGNING_PRIVATE_KEY_PATH && fs.existsSync(localKeyPath)) {
  env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(localKeyPath, "utf8").trim();
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
}

const command = process.platform === "win32" ? "node_modules\\.bin\\tauri.cmd" : "node_modules/.bin/tauri";
const result = spawnSync(command, ["build"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
