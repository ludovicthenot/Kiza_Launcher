import { chromium } from "playwright";

const out = process.argv[2] ?? ".";

function mock() {
  const sampleLog = [
    "[10:25:20] [main/INFO]: Loading Minecraft 26.2 with Fabric Loader 0.19.3",
    "[10:25:21] [main/INFO]: Loading 65 mods:",
    "[10:25:24] [Render thread/INFO]: Backend library: LWJGL version 3.3.3",
    "[10:25:25] [Render thread/INFO]: OpenAL initialized on device OpenAL Soft",
    "[10:25:25] [Render thread/INFO]: Sound engine started",
    "[10:25:26] [Render thread/INFO]: Reloading ResourceManager: vanilla, sodium, file/KizaClient.zip",
    "[10:25:28] [Render thread/INFO]: Setting user: nxferr",
    "[10:25:34] [Server thread/INFO]: Preparing start region for dimension minecraft:overworld",
    "[10:25:40] [Render thread/WARN]: Using missing texture, unable to load",
  ].join("\n");

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => undefined,
    invoke: async (cmd) => {
      switch (cmd) {
        case "get_first_run_setup": return { setup_completed: true, setup_version: 1, completed_at: new Date().toISOString(), selected_performance_profile: "balanced", skipped_steps: [] };
        case "minecraft_auth_get_account": return { uuid: "27ad5836780c4818af066164f6255967", username: "nxferr", skin_url: null, skin_head_url: "https://mc-heads.net/avatar/27ad5836780c4818af066164f6255967/96" };
        case "minecraft_auth_list_accounts": return [];
        case "list_game_instances": return [{ id: "a1", game_id: "minecraft", display_name: "Kiza Alpha", status: "Valid", install_path: "C:\\game", last_verified_at: new Date().toISOString(), active_profile_id: null, mod_count: 13, active_mod_count: 13, minecraft: { mc_version: "26.2", loader: "fabric", loader_version: "0.19.3" } }];
        case "get_downloads": return [];
        case "get_running_minecraft_instances": return { a1: 1234 };
        case "get_launch_status": return { phase: "running", message: null, pid: 1234, exit_code: null, log_path: "C:\\game\\logs\\latest.log" };
        case "read_instance_log": return sampleLog;
        case "get_installed_mods": return [];
        case "list_profiles": return { profiles: [{ id: "p1", name: "Balanced" }], active_profile_id: "p1" };
        case "verify_minecraft_optimization_pack": return { instance_id: "a1", applied: true, installed: 11, missing: 0, failed: 0, incompatible: 4, mods: [], message: "ok" };
        case "get_instance_performance_profile": return { instance_id: "a1", profile_id: "balanced" };
        case "get_performance_profiles": return [{ id: "balanced", label: "Balanced", description: "d", min_memory_mb: 1024, max_memory_mb: 5734, jvm_args: [] }];
        case "get_minecraft_versions": return { versions: [{ id: "26.2", type: "release", url: "", time: "", releaseTime: "" }] };
        case "get_minecraft_install_status": return { stage: "done", completed: 1, total: 1, message: null };
        case "get_app_config": return { enable_discord_rpc: true, discord_show_mc_version: true, discord_show_instance_name: true, close_to_tray_on_launch: false, minecraft_java_path: null, minecraft_min_memory_mb: null, minecraft_max_memory_mb: null, minecraft_extra_args: null };
        case "plugin:app|version": return "0.0.222";
        default: return null;
      }
    },
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(mock);
await page.goto("http://localhost:1420");
await page.waitForTimeout(2500);
await page.click("text=Kiza Alpha");
await page.waitForTimeout(2500); // console auto-opens on running phase
await page.screenshot({ path: `${out}/console-activity.png` });

const rawBtn = page.locator("text=Raw log");
if (await rawBtn.count()) {
  await rawBtn.first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/console-raw.png` });
}
await browser.close();
console.log("Console screenshots saved.");
