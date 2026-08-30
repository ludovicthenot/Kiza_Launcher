// Renders the frontend against a mocked Tauri backend and saves screenshots.
// Usage: node scripts/ui-preview-screenshot.mjs (vite dev server must run on 1420)
import { chromium } from "playwright";

const outDir = process.argv[2] ?? ".";

function tauriMock() {
  localStorage.setItem("kiza.language", "fr");
  const modrinthProjects = [
    { project_id: "fabric-api", title: "Fabric API", description: "API légère et modulaire fournissant les outils communs utilisés par de nombreux mods Fabric.", downloads: 22700000, follows: 94000, icon_url: "https://cdn.modrinth.com/data/P7dR8mSH/icon.png", author: "modmuss50", date_modified: new Date(Date.now() - 2 * 86400000).toISOString(), versions: ["1.21.1"], categories: ["fabric"] },
    { project_id: "sodium", title: "Sodium", description: "Un moteur de rendu haute performance pour Minecraft qui améliore considérablement les performances.", downloads: 20200000, follows: 77000, icon_url: "https://cdn.modrinth.com/data/AANobbMI/icon.png", author: "jellysquid3", date_modified: new Date(Date.now() - 4 * 86400000).toISOString(), versions: ["1.21.1"], categories: ["fabric"] },
    { project_id: "iris", title: "Iris Shaders", description: "Un chargeur de shaders moderne et compatible avec les packs de shaders existants.", downloads: 15700000, follows: 52000, icon_url: "https://cdn.modrinth.com/data/YL57xq9U/icon.png", author: "coderbot", date_modified: new Date(Date.now() - 6 * 86400000).toISOString(), versions: ["1.21.1"], categories: ["fabric"] },
    { project_id: "cloth-config", title: "Cloth Config API", description: "Une bibliothèque de configuration pour les mods Minecraft.", downloads: 15100000, follows: 36000, icon_url: "https://cdn.modrinth.com/data/9s6osm5g/icon.png", author: "shedaniel", date_modified: new Date(Date.now() - 8 * 86400000).toISOString(), versions: ["1.21.1"], categories: ["fabric"] },
  ];
  const instances = [
    {
      id: "a1",
      game_id: "minecraft",
      display_name: "Kiza Alpha",
      status: "Valid",
      install_path: "C:\\Users\\nefer\\AppData\\Roaming\\com.kizamods.engine\\minecraft\\instances\\a1\\game",
      last_verified_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      active_profile_id: null,
      mod_count: 6,
      active_mod_count: 5,
      last_deployed_at: new Date(Date.now() - 4 * 60000).toISOString(),
      minecraft: { mc_version: "1.21.1", loader: "fabric", loader_version: "0.19.3" },
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
      last_deployed_at: new Date(Date.now() - 3600000).toISOString(),
      minecraft: { mc_version: "1.20.4", loader: "fabric", loader_version: "0.19.3" },
    },
    {
      id: "c3",
      game_id: "minecraft",
      display_name: "Vanilla Test",
      status: "Valid",
      install_path: "C:\\Users\\nefer\\AppData\\Roaming\\com.kizamods.engine\\minecraft\\instances\\c3\\game",
      last_verified_at: new Date(Date.now() - 2 * 3600000).toISOString(),
      active_profile_id: null,
      mod_count: 0,
      active_mod_count: 0,
      last_deployed_at: new Date(Date.now() - 2 * 3600000).toISOString(),
      minecraft: { mc_version: "1.20.4", loader: "vanilla", loader_version: null },
    },
  ];

  const installedMods = [
    { id: "jei", name: "Just Enough Items (JEI)", version: "19.21.0.247", description: "Affiche les objets et leurs recettes", source: "curseforge", author: "mezz", homepage_url: null, cover_url: "https://media.forgecdn.net/avatars/thumbnails/29/69/64/64/635838945588716414.jpeg", cover_path: null, file_size: 1200000, game_versions: ["1.21.1"], loaders: ["fabric"], updated_at: null, enabled: true, install_date: new Date().toISOString(), files: ["jei-19.21.0.247.jar"], load_order: 0, deployed_file_count: 1 },
    { id: "jade", name: "Jade", version: "15.10.0", description: "Informations sur les blocs et entités", source: "modrinth", author: "Snownee", homepage_url: null, cover_url: "https://cdn.modrinth.com/data/nvQzSEkH/icon.png", cover_path: null, file_size: 900000, game_versions: ["1.21.1"], loaders: ["fabric"], updated_at: null, enabled: true, install_date: new Date().toISOString(), files: ["jade-15.10.0.jar"], load_order: 1, deployed_file_count: 1 },
    { id: "sodium", name: "Sodium", version: "0.6.13", description: "Optimisation du rendu et des performances", source: "modrinth", author: "jellysquid3", homepage_url: null, cover_url: "https://cdn.modrinth.com/data/AANobbMI/icon.png", cover_path: null, file_size: 1000000, game_versions: ["1.21.1"], loaders: ["fabric"], updated_at: null, enabled: true, install_date: new Date().toISOString(), files: ["sodium-0.6.13.jar"], load_order: 2, deployed_file_count: 1 },
    { id: "emi", name: "EMI", version: "1.1.18+1.21.1", description: "Affiche les recettes et objets", source: "modrinth", author: "shedaniel", homepage_url: null, cover_url: "https://cdn.modrinth.com/data/fRiHVvU7/icon.png", cover_path: null, file_size: 950000, game_versions: ["1.21.1"], loaders: ["fabric"], updated_at: null, enabled: true, install_date: new Date().toISOString(), files: ["emi-1.1.18.jar"], load_order: 3, deployed_file_count: 1 },
    { id: "yacl", name: "YetAnotherConfigLib", version: "3.6.2+1.21.1-fabric", description: "Bibliothèque de configuration pour mods", source: "modrinth", author: "isXander", homepage_url: null, cover_url: "https://cdn.modrinth.com/data/1eAoo2KR/icon.png", cover_path: null, file_size: 820000, game_versions: ["1.21.1"], loaders: ["fabric"], updated_at: null, enabled: true, install_date: new Date().toISOString(), files: ["yacl-3.6.2.jar"], load_order: 4, deployed_file_count: 1 },
    { id: "iris", name: "Iris Shaders", version: "1.7.2+mc1.21.1", description: "Support des shaders pour Fabric", source: "modrinth", author: "coderbot", homepage_url: null, cover_url: "https://cdn.modrinth.com/data/YL57xq9U/icon.png", cover_path: null, file_size: 2400000, game_versions: ["1.21.1"], loaders: ["fabric"], updated_at: null, enabled: false, install_date: new Date().toISOString(), files: ["iris-1.7.2.jar"], load_order: 5, deployed_file_count: 1 },
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
          {
            const requestedCount = Number(localStorage.getItem("kiza.preview.instanceCount"));
            if (!Number.isFinite(requestedCount) || requestedCount <= 0) return instances;
            // Asking for more than the fixtures repeats them, so the crowded
            // library can be looked at too — it is the state that decides
            // whether the layout holds up.
            const grown = [];
            for (let index = 0; index < requestedCount; index += 1) {
              const source = instances[index % instances.length];
              grown.push(index < instances.length
                ? source
                : { ...source, id: `${source.id}-${index}`, display_name: `${source.display_name} ${index + 1}` });
            }
            return grown;
          }
        case "get_app_config":
          return {
            enable_discord_rpc: true, discord_show_mc_version: true,
            discord_show_instance_name: true, close_to_tray_on_launch: true,
            close_to_tray: true, open_log_window_on_launch: true,
            minecraft_java_path: null, minecraft_min_memory_mb: null,
            minecraft_max_memory_mb: null, minecraft_extra_args: null,
            minecraft_releases_only: true, close_button_action: "tray",
            quit_after_launch: false, verify_before_launch: true,
            crash_action: "report", auto_download_updates: true,
            update_channel: "stable",
            download_concurrency: 3, notify_background: true,
            notify_update_ready: true, notify_downloads_finished: false,
            notify_windows: true, notify_in_app: true, notify_sound: false,
            notify_position: "bottom-right", notify_game_started: false,
            notify_backup_done: true, dnd_during_game: true,
            dnd_quiet_hours: true, dnd_from: "22:00", dnd_to: "08:00",
            dnd_allow_critical: true, log_retention_days: 14,
            cache_retention_days: 30, clear_finished_downloads: false,
            download_attempts: 4, pause_downloads_in_game: true,
            time_format: "system", date_format: "system", storage_units: "auto",
          };
        case "system_report":
          return {
            os: "Windows", os_version: "11", arch: "x86_64",
            cpu: "AMD Ryzen 7 5800X 8-Core Processor", cores: 16,
            total_ram_mb: 32_640,
            disk: { mount: "C:\\", total_bytes: 511_000_000_000, free_bytes: 334_000_000_000 },
            install_id: "0123456789abcdef0123456789ab8f2a",
          };
        case "set_downloads_paused":
        case "downloads_paused":
          return false;
        // Registered here, so the Notifications page draws its normal state
        // rather than the "Windows cannot see Kiza" warning.
        case "export_plan":
          return {
            instanceId: "a1", name: "Kiza Alpha", mcVersion: "1.21.1",
            loader: "fabric", loaderVersion: "0.19.3",
            mods: { count: 6, referenced: 5, bundled: 1, bundledBytes: 1_200_000, everyJarBytes: 24_000_000 },
            config: { present: true, fileCount: 42, sizeBytes: 380_000 },
            resourcepacks: { present: true, fileCount: 1, sizeBytes: 16_384 },
            shaderpacks: { present: false, fileCount: 0, sizeBytes: 0 },
            options: { present: true, fileCount: 1, sizeBytes: 5_082 },
            worlds: [
              { folder: "New World", display_name: "Nouveau monde", size_bytes: 9_100_000,
                file_count: 312, last_played_ms: Date.now() - 7200000, version_name: "1.21.1",
                hardcore: false, icon: null, checkpoint_count: 0 },
              { folder: "Hardcore run", display_name: "Hardcore run", size_bytes: 42_000_000,
                file_count: 900, last_played_ms: Date.now() - 86400000, version_name: "1.21.1",
                hardcore: true, icon: null, checkpoint_count: 2 },
            ],
          };
        case "notification_readiness":
          return { registered: true, shortcutTagged: true };
        // Two real problems, of both severities. The notice used to print the
        // number and keep the reasons to itself.
        case "check_mod_compatibility":
          return {
            instance_id: "kiza-alpha", mc_version: "1.21.1", errors: 1, warnings: 1,
            mods: [
              {
                file_name: "sodium-fabric-0.6.13.jar", mod_id: "sodium", name: "Sodium",
                version: "0.6.13", minecraft_ok: true,
                issues: [{
                  severity: "error",
                  message: "Forge mod detected in a Fabric instance. This JAR requires Forge and cannot load with Fabric.",
                }],
              },
              {
                file_name: "oldmod-1.2.jar", mod_id: null, name: null,
                version: null, minecraft_ok: null,
                issues: [{
                  severity: "warning",
                  message: "No Fabric manifest (fabric.mod.json) found; this JAR is not a Fabric mod.",
                }],
              },
            ],
          };
        // An instance that is deployed and has never been launched: the case
        // where the panel used to draw every capability it hoped for.
        case "get_kiza_client_support":
          return {
            available: true, installed: true, from_last_launch: false,
            runtime_variant: "fabric-modern", runtime_state: "not_started",
            expected_capabilities: [
              "menu-theme", "window-branding", "discord-presence-state", "local-state-bridge",
            ],
            active_capabilities: [], modules: [], last_reported_at_ms: null, reason: null,
          };
        case "save_first_run_setup":
        case "get_first_run_setup":
          return {
            schema_version: 1, setup_version: 1, setup_completed: true,
            completed_at: new Date().toISOString(),
            selected_performance_profile: "balanced", skipped_steps: [],
          };
        case "support_cooldown_seconds":
          return 0;
        case "support_preview":
          return {
            category: "crash", summary: "Plante des que j'appuie sur Jouer",
            details: "", diagnostic: "", version: "0.0.310",
            installId: "8F2A", channel: "stable",
          };
        case "list_java_runtimes":
          return [
            { major: 8, covers: "Minecraft 1.7-1.16", installed: true, bytes: 190_000_000, broken: false },
            { major: 17, covers: "Minecraft 1.17-1.20.4", installed: true, bytes: 204_000_000, broken: false },
            { major: 21, covers: "Minecraft 1.20.5+", installed: true, bytes: 218_000_000, broken: false },
            { major: 25, covers: "Recent snapshots", installed: false, bytes: 0, broken: false },
          ];
        case "remove_java_runtime":
          return 190_000_000;
        case "prune_cache":
          return 214_000_000;
        case "get_api_connections":
          return [
            { id: "modrinth", label: "Modrinth", kind: "content", configured: true,
              status: "available", detail: "Content search is ready.",
              recoverable: false, action_hint: null },
            { id: "curseforge", label: "CurseForge", kind: "content", configured: true,
              status: "configured", detail: "Content search is ready.",
              recoverable: false, action_hint: null },
          ];
        case "logs_overview":
          return { files: 23, bytes: 26_400_000, oldest_days: 11 };
        case "prune_logs":
          return { files: 4, bytes: 3_100_000 };
        case "check_services":
          return [
            { id: "microsoft", label: "Microsoft Auth", reachable: true, latency_ms: 142 },
            { id: "mojang", label: "Mojang Services", reachable: true, latency_ms: 208 },
            { id: "modrinth", label: "Modrinth", reachable: true, latency_ms: 128 },
            { id: "curseforge", label: "CurseForge", reachable: true, latency_ms: 184 },
          ];
        case "clear_metadata_cache":
          return 340_000_000;
        case "rebuild_instance_index":
          return 4;
        case "launch_at_startup_enabled":
          return false;
        case "download_concurrency_range":
          return [1, 8];
        case "storage_usage":
          // Sizes chosen so the bars differ visibly and the reclaimable total
          // is not the largest figure on the page.
          return {
            entries: [
              { id: "instances", bytes: 4_800_000_000, reclaimable: false },
              { id: "versions", bytes: 1_200_000_000, reclaimable: false },
              { id: "libraries", bytes: 780_000_000, reclaimable: false },
              { id: "assets", bytes: 2_100_000_000, reclaimable: false },
              { id: "java", bytes: 950_000_000, reclaimable: false },
              { id: "world-backups", bytes: 640_000_000, reclaimable: false },
              { id: "restore-points", bytes: 210_000_000, reclaimable: false },
              { id: "cache", bytes: 340_000_000, reclaimable: true },
              { id: "downloads", bytes: 1_050_000_000, reclaimable: true },
              { id: "logs", bytes: 26_000_000, reclaimable: true },
            ],
            total_bytes: 12_096_000_000,
            reclaimable_bytes: 1_416_000_000,
          };
        case "get_downloads":
          return [];
        case "get_running_minecraft_instances":
          return {};
        case "get_launch_status":
          return { phase: "idle", message: null, pid: null, exit_code: null, log_path: null };
        case "get_installed_mods":
          return installedMods;
        case "get_instance_art":
          return null;
        case "get_shaderpacks":
        case "list_minecraft_content":
        case "list_minecraft_worlds":
        case "list_offline_profiles":
          return [];
        case "modrinth_search_mods":
          return { hits: modrinthProjects, limit: 30, offset: 0, total_hits: 248 };
        case "curseforge_search_mods":
          return { data: [{ id: 455508, name: "Iris Shaders", summary: "Un chargeur de shaders moderne et compatible avec les packs existants.", download_count: 15700000, date_modified: new Date(Date.now() - 6 * 86400000).toISOString(), logo: { thumbnail_url: "https://media.forgecdn.net/avatars/thumbnails/408/525/64/64/637625544028446053.png" }, authors: [{ id: 1, name: "coderbot" }], latest_files_indexes: [{ game_version: "1.21.1", mod_loader: 4 }] }] };
        case "check_instance_updates":
          return [
            { path: "jei-19.21.0.247.jar", provider: "curseforge", project_id: "455508", current_version_id: "1", status: "available", target: { version_id: "2", version_name: "19.21.0.260", game_versions: ["1.21.1"], loaders: ["fabric"], released_at: new Date().toISOString(), changelog: null } },
            { path: "jade-15.10.0.jar", provider: "modrinth", project_id: "nvQzSEkH", current_version_id: "1", status: "available", target: { version_id: "2", version_name: "15.10.1", game_versions: ["1.21.1"], loaders: ["fabric"], released_at: new Date().toISOString(), changelog: null } },
          ];
        case "modrinth_get_versions":
          return [{
            id: "fabric-api-1.21.1",
            project_id: "fabric-api",
            name: "Fabric API 0.129.0+1.21.1",
            version_number: "0.129.0+1.21.1",
            game_versions: ["1.21.1"],
            loaders: ["fabric"],
            date_published: new Date(Date.now() - 2 * 86400000).toISOString(),
            files: [{ url: "https://example.invalid/fabric-api.jar", filename: "fabric-api-0.129.0+1.21.1.jar", primary: true, size: 2200000, hashes: { sha1: "", sha512: "" } }],
          }];
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

/**
 * The first screen anyone sees, before the library exists.
 *
 * It replaced a five-step wizard whose four other steps asked for nothing the
 * launcher could not do itself. What is checked here is that the one way past
 * it is actually visible: an entrance animation once left "Continue without an
 * account" drawn, measured, clickable and at `opacity: 0`, which is the kind of
 * thing a screenshot review misses and a first-time user does not.
 */
async function checkFirstRun() {
  const first = await chromium.launch();
  const page = await first.newPage({ viewport: { width: 1585, height: 991 } });
  await page.addInitScript(tauriMock);
  await page.addInitScript(() => {
    const wait = setInterval(() => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals) return;
      clearInterval(wait);
      const original = internals.invoke;
      internals.invoke = async (command, args) => {
        if (command === "get_first_run_setup") {
          return { schema_version: 1, setup_version: 1, setup_completed: false, completed_at: null, selected_performance_profile: "balanced", skipped_steps: [] };
        }
        if (command === "minecraft_auth_list_accounts") return [];
        if (command === "minecraft_auth_get_account") return null;
        return original(command, args);
      };
    }, 5);
  });
  await page.goto("http://localhost:1420", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const visible = (node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return Number(style.opacity) > 0.9 && style.visibility === "visible" && box.width > 0 && box.height > 0;
    };
    const named = (pattern) => buttons.find((node) => pattern.test(node.innerText));
    const signIn = named(/Microsoft/);
    const skip = named(/sans compte|without an account/);
    return {
      signIn: !!signIn && visible(signIn),
      skip: !!skip && visible(skip),
      steps: document.body.innerText.includes("Runtime") && document.body.innerText.includes("APIs"),
    };
  });

  if (!state.signIn) throw new Error("The first-run screen has no visible way to sign in");
  if (!state.skip) throw new Error("The first-run screen has no visible way past it");
  if (state.steps) throw new Error("The five-step wizard is back on the first-run screen");

  await page.screenshot({ path: `${outDir}/ui-first-run.png` });
  console.log("First run: one screen, both ways forward visible.");
  await first.close();
}

await checkFirstRun();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1585, height: 991 } });
await page.addInitScript(tauriMock);
await page.goto("http://localhost:1420", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/ui-library.png` });

// Open the account menu
await page.click("text=nxferr");
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/ui-account-menu.png` });
await page.keyboard.press("Escape");

// Open the create-instance dialog
await page.getByText(/New instance|Nouvelle instance/).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/ui-dialog.png` });
await page.keyboard.press("Escape");

// Open an instance, then its settings dialog
await page.click("text=Kiza Alpha");
await page.getByRole("button", { name: /Manage this instance|Gérer cette instance/ }).first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/ui-instance.png`, fullPage: true });

// The Mods page used to be the one page with no instance header: no Play
// button, no instance name, no Sync — on the page people spend the most time
// on. Checked here because the header is drawn by a different component from
// the one being looked at, so nothing else would notice it going missing.
{
  const header = await page.evaluate(() => {
    const top = document.querySelector('[data-anim="instance-top"]');
    return { present: !!top, text: top?.innerText ?? "" };
  });
  if (!header.present || !header.text.includes("Kiza Alpha")) {
    throw new Error(`The Mods page lost the instance header: ${JSON.stringify(header)}`);
  }
  console.log("Mods: the instance header is drawn, like every other page.");
}

// A count is not a diagnosis. The notice knew the file, the severity and the
// sentence explaining it, and printed "2 problems".
{
  const notice = await page.evaluate(() => {
    const found = [...document.querySelectorAll("div")].find((node) =>
      /compatibilit|compatibility/i.test(node.innerText ?? ""),
    );
    return found?.innerText ?? "";
  });

  for (const expected of ["sodium-fabric-0.6.13.jar", "Forge mod detected", "oldmod-1.2.jar"]) {
    if (!notice.includes(expected)) {
      throw new Error(`The compatibility notice does not say what is wrong (${expected}): ${notice}`);
    }
  }
  console.log("Compatibility notice: names the file and the reason, not just a count.");
}

// Where a mod came from, said with the mark. The two services used to be
// written out in emerald and violet — CurseForge in Modrinth's colour family,
// which is the one confusion the badge exists to prevent.
{
  const badges = await page.evaluate(() => {
    const found = [...document.querySelectorAll('span[title="CurseForge"], span[title="Modrinth"]')];
    return found.map((node) => ({
      service: node.getAttribute("title"),
      logo: !!node.querySelector("svg path"),
      background: getComputedStyle(node).backgroundColor,
    }));
  });
  const forge = badges.find((badge) => badge.service === "CurseForge");
  const modrinth = badges.find((badge) => badge.service === "Modrinth");
  if (!forge || !modrinth) {
    throw new Error(`The mods list is missing a source badge: ${JSON.stringify(badges)}`);
  }
  if (!forge.logo || !modrinth.logo) {
    throw new Error("A source badge has no logo in it");
  }
  // Filled, and each in its own colour: a transparent chip would leave the
  // mark to fend for itself against the row behind it.
  if (forge.background === modrinth.background) {
    throw new Error(`Both services share one colour: ${forge.background}`);
  }
  for (const badge of [forge, modrinth]) {
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(badge.background)) {
      throw new Error(`${badge.service} has no background behind its logo`);
    }
  }
  console.log(`Mods: source badges carry a logo on a filled chip (${forge.background} / ${modrinth.background}).`);
}
const updateCheck = page.getByRole("button", { name: /Check for updates|Vérifier les mises à jour/ });
if (await updateCheck.count()) {
  await updateCheck.click();
  await page.waitForTimeout(500);
}
const jeiCheckbox = page.locator('input[aria-label="Sélectionner Just Enough Items (JEI)"]');
const jadeCheckbox = page.locator('input[aria-label="Sélectionner Jade"]');
if ((await jeiCheckbox.count()) && (await jadeCheckbox.count())) {
  await jeiCheckbox.check();
  await jadeCheckbox.check();
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${outDir}/ui-mods-installed.png`, fullPage: true });
const findMore = page.locator('button[title="Find more to install"], button[title="Trouver de quoi installer"]');
if (await findMore.count()) {
  await findMore.click();
  await page.waitForTimeout(400);
}
const discover = page.getByRole("button", { name: /Discover|Découvrir/, exact: true });
if (await discover.count()) {
  await discover.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/ui-discover.png`, fullPage: true });
  const filters = page.getByRole("button", { name: /Active filters|Filtres actifs/ });
  await filters.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/ui-discover-filters.png`, fullPage: true });
  await filters.click();
  const sort = page.getByRole("button", { name: /Relevance|Pertinence/ }).first();
  await sort.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/ui-discover-sort.png`, fullPage: true });
}
const gear = page.locator('button[title="Instance settings"]');
if (await gear.count()) {
  await gear.first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/ui-instance-settings.png` });
}

// Exporting used to be a button that wrote mods and config and said nothing
// about the world it left behind. It is a choice now, and every line in it
// carries a real size.
{
  // Share / Export lives on the instance's own settings page, which is the
  // sidebar entry rather than the launcher gear of the same name.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const instanceSettings = page
    .locator('aside, nav')
    .getByRole("button", { name: /^(Settings|Paramètres)$/ });
  if (await instanceSettings.count()) {
    await instanceSettings.first().click();
    await page.waitForTimeout(600);
  }

  // The client panel, for an instance that is deployed and has never been
  // launched. It used to fall back to the capabilities it hoped for when no
  // report existed, and draw them in the same chip as ones that actually
  // started — so a runtime that had never run looked exactly like a working
  // one, which is the single thing the report exists to prevent.
  {
    const panel = await page.evaluate(() => {
      const heading = [...document.querySelectorAll("h3")].find((node) =>
        /Client Kiza|Kiza Client Runtime/.test(node.innerText),
      );
      const box = heading?.closest("section");
      return { found: !!box, text: box?.innerText ?? "" };
    });

    if (!panel.found) {
      throw new Error("The instance settings page has no Kiza client panel");
    }
    if (!panel.text.includes("fabric-modern")) {
      throw new Error(`The client panel does not name the runtime variant: ${panel.text}`);
    }
    if (!/Jamais démarré|Never started/.test(panel.text)) {
      throw new Error(`The client panel does not say it has never run: ${panel.text}`);
    }
    // Case-insensitive throughout: the group headings are uppercased in CSS
    // and innerText returns what is rendered, not what was written.
    const text = panel.text.toLowerCase();
    if (!text.includes("prévu sur cette version") && !text.includes("expected on this version")) {
      throw new Error(`The client panel does not label what it has not run yet: ${panel.text}`);
    }
    if (/^\s*(en cours|running)\s*$/m.test(text)) {
      throw new Error(
        `The client panel claims something is running with no report: ${panel.text}`,
      );
    }
    const claimed = text.indexOf("thème du menu");
    const label = text.indexOf("prévu sur cette version");
    if (claimed !== -1 && label > claimed) {
      throw new Error(`A capability is drawn before it is called expected: ${panel.text}`);
    }
    await page.screenshot({ path: `${outDir}/ui-instance-client.png`, fullPage: true });
    console.log("Client panel: names the variant, claims nothing that has not run.");
  }

  const share = page.getByRole("button", { name: /Share \/ Export/ });
  if (await share.count()) {
    await share.first().click();
    await page.waitForTimeout(700);

    const dialog = await page.evaluate(() => {
      const box = document.querySelector('[role="dialog"]');
      const text = box?.innerText ?? "";
      const boxes = [...(box?.querySelectorAll('input[type="checkbox"]') ?? [])];
      return {
        text,
        checkboxes: boxes.length,
        anyTicked: boxes.some((entry) => entry.checked),
      };
    });

    // The choice that decides every size under it, and the two numbers that
    // make it a choice rather than two words.
    if (!/Pack CurseForge|CurseForge pack/.test(dialog.text)) {
      throw new Error(`The export window offers no archive format: ${dialog.text}`);
    }
    if (!/Autonome|Self-contained/.test(dialog.text)) {
      throw new Error(`The export window has only one format: ${dialog.text}`);
    }

    if (!dialog.text.includes("Nouveau monde") || !dialog.text.includes("Hardcore run")) {
      throw new Error(`The export window does not list the worlds: ${dialog.text}`);
    }
    if (dialog.anyTicked) {
      throw new Error("Something was ticked before the user chose anything");
    }
    if (dialog.checkboxes < 7) {
      throw new Error(`Only ${dialog.checkboxes} things can be chosen`);
    }
    await page.screenshot({ path: `${outDir}/ui-export.png` });
    console.log(`Export: ${dialog.checkboxes} choices, nothing ticked, both worlds listed.`);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}


// The launcher's own settings: every one of the eleven pages, so a page that
// throws or renders empty is caught here rather than by the user.
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const settingsGear = page.locator('button[title="Settings"], button[title="Paramètres"]');
if (await settingsGear.count()) {
  await settingsGear.first().click();
  await page.waitForTimeout(800);

  const pages = [
    ["general", /^(General|Général)$/],
    ["appearance", /^(Appearance|Apparence)$/],
    ["language", /^(Language and region|Langue et région)$/],
    ["minecraft", /^(Minecraft and Java|Minecraft et Java)$/],
    ["downloads", /^(Downloads|Téléchargements)$/],
    ["storage", /^(Storage|Stockage)$/],
    ["accounts", /^(Accounts|Comptes)$/],
    ["connections", /^(Connections|Connexions)$/],
    ["notifications", /^Notifications$/],
    ["advanced", /^(Advanced|Avancé)$/],
    ["about", /^(About|À propos)$/],
  ];

  for (const [name, label] of pages) {
    const tab = page.getByRole("button", { name: label }).first();
    if (!(await tab.count())) {
      throw new Error(`Settings tab missing: ${name}`);
    }
    await tab.click();
    await page.waitForTimeout(500);

    // A page that rendered nothing is the failure worth catching: it looks
    // exactly like a page that is still loading.
    const filled = await page.evaluate(() => {
      const main = document.querySelector('[role="dialog"] main');
      return main ? main.innerText.trim().length : 0;
    });
    if (filled < 40) {
      throw new Error(`Settings page ${name} rendered almost nothing (${filled} chars)`);
    }

    // Every page opens at its top. The panel is one scrolling element shared by
    // all eleven, so its position used to survive the switch: leaving one page
    // halfway down opened the next one halfway down too, often at its very
    // bottom, where the wheel does nothing and the scrollbar reads as broken.
    const restingAt = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"] main');
      return panel ? panel.scrollTop : 0;
    });
    if (restingAt !== 0) {
      throw new Error(`Settings page ${name} opened ${restingAt}px down instead of at its top`);
    }

    // Scrolled before moving on, so the next page inherits something to reset.
    await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"] main');
      if (panel) panel.scrollTop = panel.scrollHeight;
    });

    await page.screenshot({ path: `${outDir}/ui-settings-${name}.png` });

    // The update channel travels to the service as a header and the service
    // honours it, so a launcher with no way to change it would be carrying a
    // capability nobody can reach.
    if (name === "general") {
      const reachable = await page.evaluate(() => {
        const main = document.querySelector('[role="dialog"] main');
        return (main?.innerText ?? "").includes("Quelles versions suivre");
      });
      if (!reachable) {
        throw new Error("The update channel has no control on the General page");
      }
      console.log("Update channel: reachable from the interface.");
    }

    // The reachability grid only appears once something has been measured, so
    // a page that never fills it in would still pass the "rendered something"
    // check above while the feature did nothing.
    if (name === "connections") {
      await page.getByRole("button", { name: "Tout vérifier" }).click();
      await page.waitForTimeout(400);
      const measured = await page.evaluate(() => {
        const main = document.querySelector('[role="dialog"] main');
        const text = main?.innerText ?? "";
        return {
          services: ["Microsoft Auth", "Mojang Services", "Modrinth", "CurseForge"].filter((s) =>
            text.includes(s),
          ).length,
          latencies: (text.match(/\d+ ms/g) ?? []).length,
        };
      });
      if (measured.services < 4 || measured.latencies < 4) {
        throw new Error(
          `Connections showed ${measured.services} services and ${measured.latencies} latencies after a check`,
        );
      }
      await page.screenshot({ path: `${outDir}/ui-settings-connections-checked.png` });
      console.log("Connections: four services measured, with latencies.");
    }

    // The problem report replaces "write a file, find it, open Discord,
    // describe it again from memory" — most people stop at step two.
    if (name === "advanced") {
      await page.getByRole("button", { name: "Écrire un signalement" }).click();
      await page.waitForTimeout(300);

      const form = await page.evaluate(() => {
        const main = document.querySelector('[role="dialog"] main');
        const text = main?.innerText ?? "";
        return {
          summary: !!document.querySelector("#report-summary"),
          details: !!document.querySelector("#report-details"),
          preview: text.includes("Voir exactement ce qui sera envoyé"),
          privacy: text.includes("Rien ici ne vous identifie"),
        };
      });
      if (!form.summary || !form.details || !form.preview || !form.privacy) {
        throw new Error(`The problem report is missing parts: ${JSON.stringify(form)}`);
      }
      await page.screenshot({ path: `${outDir}/ui-settings-problem-report.png` });
      console.log("Problem report: form, preview and the privacy line are present.");
    }

    // The accent used the operating system's own colour dialogue: a white
    // panel with R, G and B spin boxes, on top of a dark launcher, and modal —
    // so the live preview it existed to feed could not be seen while choosing.
    if (name === "appearance") {
      await page.getByRole("button", { name: "Couleur d'accent personnalisée" }).click();
      await page.waitForTimeout(300);

      const picker = await page.evaluate(() => {
        const pad = document.querySelector('[role="application"]');
        const hex = document.querySelector('input[aria-label="Hex"]');
        const hue = document.querySelector('input[aria-label="Hue"]');
        return { pad: !!pad, hex: !!hex, hue: !!hue };
      });
      if (!picker.pad || !picker.hex || !picker.hue) {
        throw new Error(`The accent picker is missing parts: ${JSON.stringify(picker)}`);
      }

      // Typing a colour must repaint the launcher, not just the field.
      // Typed rather than filled: React listens for input events, and a value
      // set in one go can be swallowed by its controlled-input bookkeeping.
      const hexField = page.locator('input[aria-label="Hex"]');
      await hexField.click();
      await hexField.press("ControlOrMeta+a");
      await hexField.press("Delete");
      await hexField.type("#22C55E", { delay: 20 });
      await page.waitForTimeout(300);
      const typed = await hexField.inputValue();
      if (typed !== "#22C55E") {
        // The field used to fight the colour: every keystroke that formed a
        // valid hex applied it, which rewrote the field under the cursor and
        // turned "#22C55E" into "#2222CC55E".
        throw new Error(`The hex field mangled what was typed: "${typed}"`);
      }
      const primary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      );
      if (!primary.startsWith("142 ")) {
        throw new Error(`Typing an accent did not reach the stylesheet (--primary is "${primary}")`);
      }

      await page.screenshot({ path: `${outDir}/ui-settings-accent-picker.png` });
      console.log(`Accent picker: pad, hue and hex present; --primary became "${primary}".`);
    }
  }
  console.log(`Settings: ${pages.length} pages captured.`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

for (const viewport of [
  { width: 960, height: 600, name: "960x600" },
  { width: 1280, height: 720, name: "1280x720" },
  { width: 1536, height: 864, name: "1536x864" },
  { width: 1920, height: 1080, name: "1920x1080" },
]) {
  const responsivePage = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });
  await responsivePage.addInitScript(() => {
    localStorage.setItem("kiza.preview.instanceCount", "2");
  });
  await responsivePage.addInitScript(tauriMock);
  await responsivePage.goto("http://localhost:1420", { waitUntil: "domcontentloaded" });
  await responsivePage.waitForTimeout(1800);
  const metrics = await responsivePage.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    bodyScrollWidth: document.body.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
  }));
  console.log(`Responsive ${viewport.name}: ${JSON.stringify(metrics)}`);

  if (viewport.name === "1280x720") {
    const firstPoster = responsivePage.locator('[data-instance-poster="a1"]');
    const secondPoster = responsivePage.locator('[data-instance-poster="b2"]');
    // The reference layout is a shelf of equals: selecting a card must change
    // its border and its actions, never the geometry of the row.
    const before = {
      first: await firstPoster.boundingBox(),
      second: await secondPoster.boundingBox(),
    };
    await secondPoster.click({ position: { x: 40, y: 140 } });
    await responsivePage.waitForTimeout(600);
    const after = {
      first: await firstPoster.boundingBox(),
      second: await secondPoster.boundingBox(),
    };
    const sizes = [before.first, before.second, after.first, after.second];
    if (sizes.some((box) => !box)) {
      throw new Error(`Instance posters not found: ${JSON.stringify({ before, after })}`);
    }
    const widths = sizes.map((box) => Math.round(box.width));
    if (Math.max(...widths) - Math.min(...widths) > 1) {
      throw new Error(
        `Instance cards must stay the same width when selected: ${JSON.stringify({ before, after })}`,
      );
    }
    console.log(`Instance cards keep equal widths: ${JSON.stringify(widths)}`);
  }
  await responsivePage.screenshot({
    path: `${outDir}/ui-library-${viewport.name}.png`,
  });
  if (viewport.name === "1280x720") {
    await responsivePage.locator('[data-instance-poster="b2"]').dblclick({
      position: { x: 40, y: 140 },
    });
    await responsivePage.locator(
      '[title="Trouver de quoi installer"], [title="Find more to install"]',
    ).waitFor({ state: "visible" });
    console.log("Instance double-click shortcut: opened instance management");
  }
  await responsivePage.close();
}

// The crowded library: the state that decides whether the layout holds up.
// A shelf that only ever gets three cards proves nothing.
for (const viewport of [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1920x1080", width: 1920, height: 1080 },
]) {
  const crowded = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });
  await crowded.addInitScript(() => {
    localStorage.setItem("kiza.preview.instanceCount", "14");
  });
  await crowded.addInitScript(tauriMock);
  await crowded.goto("http://localhost:1420", { waitUntil: "domcontentloaded" });
  await crowded.waitForTimeout(1600);

  const overflow = await crowded.evaluate(() => {
    // The app scrolls an inner panel, not the document, so measuring
    // documentElement would make this check unable to fail.
    const poster = document.querySelector("[data-instance-poster]");
    let scroller = poster?.parentElement ?? null;
    while (scroller && getComputedStyle(scroller).overflowY !== "auto") {
      scroller = scroller.parentElement;
    }
    return {
      cards: document.querySelectorAll("[data-instance-poster]").length,
      rows: new Set(
        Array.from(document.querySelectorAll("[data-instance-poster]")).map(
          (card) => Math.round(card.getBoundingClientRect().top),
        ),
      ).size,
      horizontal: document.body.scrollWidth > window.innerWidth,
      verticalScroll: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : false,
    };
  });
  // Growing sideways past twenty cards would hide most of the library behind
  // a scrollbar nobody thinks to drag.
  if (overflow.horizontal) {
    throw new Error(`A crowded library must not scroll sideways (${viewport.name})`);
  }
  // Fourteen cards on one line would mean the shelf never wrapped.
  if (overflow.rows < 2) {
    throw new Error(`A crowded library must wrap onto several rows (${viewport.name})`);
  }
  if (!overflow.verticalScroll) {
    throw new Error(`A crowded library must scroll down (${viewport.name})`);
  }
  console.log(`Crowded library ${viewport.name}: ${JSON.stringify(overflow)}`);

  await crowded.screenshot({ path: `${outDir}/ui-library-many-${viewport.name}.png` });
  await crowded.close();
}

await browser.close();
console.log("Screenshots saved.");
