import { chromium } from "playwright";

const out = process.argv[2] ?? ".";

function mock() {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => undefined,
    invoke: async (cmd) => {
      switch (cmd) {
        case "get_first_run_setup": return { setup_completed: true, setup_version: 1, completed_at: new Date().toISOString(), selected_performance_profile: "balanced", skipped_steps: [] };
        case "minecraft_auth_get_account": return { uuid: "27ad5836780c4818af066164f6255967", username: "nxferr", skin_url: null, skin_head_url: null };
        case "minecraft_auth_list_accounts": return [];
        case "list_game_instances": return [{ id: "a1", game_id: "minecraft", display_name: "Kiza Alpha", status: "Valid", install_path: "C:\\game", last_verified_at: new Date().toISOString(), active_profile_id: null, mod_count: 3, active_mod_count: 3, minecraft: { mc_version: "1.21.5", loader: "fabric", loader_version: "0.19.3" } }];
        case "get_downloads": return [];
        case "get_running_minecraft_instances": return {};
        case "get_launch_status": return { phase: "idle", message: null, pid: null, exit_code: null, log_path: null };
        case "get_installed_mods": return [
          { id: "m1", name: "Sodium", version: "0.8.13", description: "Renderer", enabled: true, load_order: 0, source: "modrinth", game_versions: ["1.21.5"], loaders: ["fabric"], file_size: 900000, updated_at: null, author: null, homepage_url: null, cover_url: null, cover_path: null },
          { id: "m2", name: "Iris Shaders", version: "1.10.7", description: "Shader loader", enabled: true, load_order: 1, source: "modrinth", game_versions: ["1.21.5"], loaders: ["fabric"], file_size: 2600000, updated_at: null, author: null, homepage_url: null, cover_url: null, cover_path: null },
        ];
        case "check_mod_compatibility": return {
          instance_id: "a1", mc_version: "1.21.5", errors: 2, warnings: 0,
          mods: [
            { file_name: "sodium.jar", mod_id: "sodium", name: "Sodium", version: "0.8.13", minecraft_ok: true, issues: [ { severity: "error", message: "Conflicts with installed iris 1.10.7." } ] },
            { file_name: "oldmod.jar", mod_id: "oldmod", name: "OldMod", version: "1.0.0", minecraft_ok: false, issues: [ { severity: "error", message: "Made for Minecraft 1.20.x, this instance runs 1.21.5." } ] },
            { file_name: "iris.jar", mod_id: "iris", name: "Iris", version: "1.10.7", minecraft_ok: true, issues: [] },
          ],
        };
        case "list_profiles": return { profiles: [{ id: "p1", name: "Balanced" }], active_profile_id: "p1" };
        case "verify_minecraft_optimization_pack": return { instance_id: "a1", applied: true, installed: 11, missing: 0, failed: 0, incompatible: 0, mods: [], message: "ok" };
        case "get_instance_performance_profile": return { instance_id: "a1", profile_id: "balanced" };
        case "get_performance_profiles": return [{ id: "balanced", label: "Balanced", description: "d", min_memory_mb: 1024, max_memory_mb: 5734, jvm_args: [] }];
        case "get_minecraft_versions": return { versions: [{ id: "1.21.5", type: "release", url: "", time: "", releaseTime: "" }] };
        case "get_minecraft_install_status": return { stage: "done", completed: 1, total: 1, message: null };
        case "list_shaderpacks": return [
          { file_name: "BSL_v8.4.zip", size: 4200000 },
          { file_name: "ComplementaryUnbound_r5.5.1.zip", size: 8900000 },
        ];
        case "is_iris_installed": return false;
        case "modrinth_search_shaders": return { hits: [
          { project_id: "s1", title: "Complementary Shaders - Unbound", description: "Transforming vanilla with exceptional quality", downloads: 1, follows: 1, icon_url: null, author: "EminGT", date_modified: "", versions: [] },
          { project_id: "s2", title: "BSL Shaders", description: "A shaderpack with high customization", downloads: 1, follows: 1, icon_url: null, author: "capttatsu", date_modified: "", versions: [] },
        ], limit: 20, offset: 0, total_hits: 2 };
        case "get_app_config": return { enable_discord_rpc: true, discord_show_mc_version: true, discord_show_instance_name: true, close_to_tray_on_launch: false, open_log_window_on_launch: true, minecraft_java_path: null, minecraft_min_memory_mb: null, minecraft_max_memory_mb: null, minecraft_extra_args: null };
        case "plugin:app|version": return "0.0.224";
        default: return null;
      }
    },
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(mock);
await page.goto("http://localhost:1420");
await page.waitForTimeout(2200);
await page.click("text=Kiza Alpha");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/mods-compat.png` });

await page.click("text=Shaders");
await page.waitForTimeout(800);
await page.fill('input[placeholder*="Modrinth shaders"]', "complementary");
await page.click("text=Search");
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/shaders-tab.png` });

await browser.close();
console.log("Compat + shaders screenshots saved.");
