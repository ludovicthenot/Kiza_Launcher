// Renders the frontend against a mocked Tauri backend and saves screenshots.
// Usage: node scripts/ui-preview-screenshot.mjs (vite dev server must run on 1420)
import { chromium } from "playwright";

const outDir = process.argv[2] ?? ".";

function tauriMock() {
  const instances = [
    {
      id: "a1",
      game_id: "minecraft",
      display_name: "Kiza Alpha",
      status: "Valid",
      install_path: "C:\\Users\\nefer\\AppData\\Roaming\\com.kizamods.engine\\minecraft\\instances\\a1\\game",
      last_verified_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      active_profile_id: null,
      mod_count: 13,
      active_mod_count: 13,
      minecraft: { mc_version: "1.21.8", loader: "fabric", loader_version: "0.19.3" },
    },
    {
      id: "b2",
      game_id: "minecraft",
      display_name: "PvP Practice",
      status: "Valid",
      install_path: "C:\\Users\\nefer\\AppData\\Roaming\\com.kizamods.engine\\minecraft\\instances\\b2\\game",
      last_verified_at: new Date(Date.now() - 3600000).toISOString(),
      active_profile_id: "p1",
      mod_count: 7,
      active_mod_count: 6,
      minecraft: { mc_version: "1.20.4", loader: "fabric", loader_version: "0.19.3" },
    },
  ];

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    invoke: async (cmd) => {
      switch (cmd) {
        case "get_first_run_setup":
          return { setup_completed: true, setup_version: 1, completed_at: new Date().toISOString(), selected_performance_profile: "balanced", skipped_steps: [] };
        case "minecraft_auth_get_account":
          return { uuid: "27ad5836780c4818af066164f6255967", username: "nxferr", skin_url: null, skin_head_url: "https://mc-heads.net/avatar/27ad5836780c4818af066164f6255967/96" };
        case "minecraft_auth_list_accounts":
          return [{ uuid: "27ad5836780c4818af066164f6255967", username: "nxferr", skin_url: null, skin_head_url: "https://mc-heads.net/avatar/27ad5836780c4818af066164f6255967/96" }];
        case "list_game_instances":
          return instances;
        case "get_downloads":
          return [];
        case "get_running_minecraft_instances":
          return {};
        case "get_launch_status":
          return { phase: "idle", message: null, pid: null, exit_code: null, log_path: null };
        case "get_installed_mods":
          return [];
        case "list_profiles":
          return { profiles: [{ id: "p1", name: "Balanced" }], active_profile_id: "p1" };
        case "get_optimization_pack_status":
        case "verify_minecraft_optimization_pack":
          return { instance_id: "a1", applied: true, installed: 11, missing: 0, failed: 0, incompatible: 4, mods: [], message: "Optimization pack active" };
        case "get_instance_performance_profile":
          return { instance_id: "a1", profile_id: "balanced" };
        case "get_minecraft_versions":
          return { versions: [{ id: "1.21.8", type: "release", url: "", time: "", releaseTime: "" }] };
        case "get_performance_profiles":
          return [
            { id: "low_end", label: "Low End", description: "Small RAM budget.", min_memory_mb: 512, max_memory_mb: 2048, jvm_args: [] },
            { id: "balanced", label: "Balanced", description: "Default profile.", min_memory_mb: 1024, max_memory_mb: 5734, jvm_args: [] },
            { id: "quality", label: "Quality", description: "Heavier mod lists.", min_memory_mb: 2048, max_memory_mb: 8192, jvm_args: [] },
          ];
        case "plugin:app|version":
          return "0.0.216";
        default:
          return null;
      }
    },
    transformCallback: () => 1,
    unregisterCallback: () => undefined,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(tauriMock);
await page.goto("http://localhost:1420");
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/ui-library.png` });

// Open the account menu
await page.click("text=nxferr");
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/ui-account-menu.png` });
await page.keyboard.press("Escape");

// Open the create-instance dialog
await page.click("text=New instance");
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/ui-dialog.png` });
await page.keyboard.press("Escape");

// Open an instance, then its settings dialog
await page.click("text=Kiza Alpha");
await page.waitForTimeout(1000);
const gear = page.locator('button[title="Instance settings"]');
if (await gear.count()) {
  await gear.first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/ui-instance-settings.png` });
}

await browser.close();
console.log("Screenshots saved.");
