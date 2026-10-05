/**
 * The launcher the Maker themes: real pages, demonstration data.
 *
 * Kiza Maker is a theme editor. It draws the launcher's own pages — the
 * library, an instance, its mods, Discover, servers, settings — so a designer
 * sees a theme on the real thing, animations and all. But nothing behind
 * those pages is real: the Maker's backend (`maker.rs`) does not even
 * register a command that could launch Minecraft, download, sign in or host.
 *
 * This answers the launcher's questions instead. Every call the pages make
 * goes through Tauri's `invoke`; in the Maker that import is swapped at build
 * time for `core.ts`, so the theme commands, the window, the file dialogue and
 * events still reach the real runtime, and everything else is answered here
 * from a small library of test instances. Play is acted out — preparing, downloading, starting, running —
 * so a theme can be seen in every state a launch passes through, and no game
 * is ever started.
 *
 * Only the Maker edition's bundle contains this file: the swap is made in
 * `vite.config.ts` for that edition and no other.
 */

type Args = Record<string, unknown> | undefined;

/** What still goes to the real runtime: themes, windows, dialogues, events. */
const REAL = new Set([
  "import_theme",
  "installed_themes",
  "stage_theme_asset",
  "remove_theme",
  "export_theme",
  "launcher_edition",
  "open_maker_panel",
  "close_maker_panel",
]);
const REAL_PLUGINS = ["plugin:window|", "plugin:webview|", "plugin:event|", "plugin:app|", "plugin:dialog|", "plugin:path|", "plugin:resources|", "plugin:image|"];

// ---------------------------------------------------------------------------
// The library

/** A square picture with a gradient and a glyph, for a mod's or a project's icon. */
function icon(from: string, to: string, glyph: string): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/></linearGradient></defs><rect width='64' height='64' fill='url(#g)'/><text x='32' y='42' font-size='28' text-anchor='middle' fill='white' font-family='Segoe UI'>${glyph}</text></svg>`,
    )
  );
}

const now = () => new Date().toISOString();

type Loader = "vanilla" | "fabric" | "forge" | "neoforge";

interface DemoInstance {
  id: string;
  name: string;
  version: string;
  loader: Loader;
  loaderVersion: string | null;
  status?: string;
}

const INSTANCES: DemoInstance[] = [
  { id: "demo-survie", name: "Survie entre amis", version: "1.21.1", loader: "fabric", loaderVersion: "0.16.10" },
  { id: "demo-atm", name: "All the Mods 10", version: "1.21.1", loader: "neoforge", loaderVersion: "21.1.172" },
  { id: "demo-rlcraft", name: "RLCraft", version: "1.12.2", loader: "forge", loaderVersion: "14.23.5.2860" },
  { id: "demo-skyblock", name: "Skyblock", version: "1.20.1", loader: "forge", loaderVersion: "47.3.0", status: "Unverified" },
  { id: "demo-vanilla", name: "Vanilla pure", version: "1.21.4", loader: "vanilla", loaderVersion: null },
  { id: "demo-creatif", name: "Créatif", version: "1.20.4", loader: "fabric", loaderVersion: "0.15.11" },
];

const MOD_POOL: [string, string, string, string, string, string][] = [
  // name, description, from, to, glyph, side
  ["Sodium", "Modern rendering engine, made for frame rates.", "#1b3b2f", "#5fe0a0", "⚡", "client"],
  ["Iris Shaders", "Shader packs, compatible with Sodium.", "#2a1b4a", "#a37cff", "✦", "client"],
  ["Fabric API", "Lightweight and modular API providing common hooks.", "#3a2f1e", "#d9c79b", "🧵", "both"],
  ["Just Enough Items", "View items and recipes.", "#1d5c2a", "#7fe08a", "J", "both"],
  ["Xaero's Minimap", "A minimap that stays out of the way.", "#14365e", "#43c6ff", "🗺", "client"],
  ["Create", "Building tools and aesthetic technology.", "#5a3a12", "#f0b04a", "⚙", "both"],
  ["Waystones", "Teleport back to activated waystones.", "#2b2b3b", "#9aa0ff", "◆", "both"],
  ["Farmer's Delight", "Cooking, farming and a kitchen to match.", "#4a2a12", "#ffb070", "🍲", "both"],
  ["AppleSkin", "Food values and saturation on the hunger bar.", "#4a1212", "#ff6b6b", "🍎", "client"],
  ["Jade", "Shows what you are looking at.", "#123a3a", "#5fe0e0", "🔍", "client"],
  ["3D Skin Layers", "Renders the second skin layer in 3D.", "#7a4a2a", "#e0a070", "🧍", "client"],
  ["Clumps", "Groups experience orbs together.", "#1e4a1e", "#9fe07f", "●", "both"],
];

function modsFor(instance: DemoInstance) {
  if (instance.loader === "vanilla") return [];
  const count = instance.id === "demo-atm" ? 12 : instance.id === "demo-rlcraft" ? 9 : 6;
  return MOD_POOL.slice(0, count).map(([name, description, from, to, glyph, side], index) => ({
    id: `${instance.id}-${index}`,
    name,
    version: `${1 + (index % 4)}.${index}.${(index * 3) % 10}`,
    description,
    source: index % 3 === 2 ? "curseforge" : "modrinth",
    author: "Kiza demo",
    homepage_url: null,
    cover_url: icon(from, to, glyph),
    cover_path: null,
    file_size: 400_000 + index * 180_000,
    game_versions: [instance.version],
    loaders: [instance.loader],
    updated_at: "2026-09-01T00:00:00Z",
    side,
    enabled: index !== 4,
    install_date: "2026-09-07T10:00:00Z",
    files: [`mods/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jar`],
    load_order: index,
    deployed_file_count: 1,
  }));
}

const mods = new Map(INSTANCES.map((instance) => [instance.id, modsFor(instance)]));

function summary(instance: DemoInstance) {
  const list = mods.get(instance.id) ?? [];
  return {
    id: instance.id,
    game_id: "minecraft",
    display_name: instance.name,
    status: instance.status ?? "Valid",
    install_path: `C:\\Kiza Maker\\demo\\${instance.id}`,
    last_verified_at: now(),
    active_profile_id: null,
    mod_count: list.length,
    active_mod_count: list.filter((mod) => mod.enabled).length,
    minecraft: {
      mc_version: instance.version,
      loader: instance.loader,
      loader_version: instance.loaderVersion,
    },
  };
}

// ---------------------------------------------------------------------------
// Launches, acted out

interface Launch {
  startedAt: number;
  stopped: boolean;
}
const launches = new Map<string, Launch>();
const PID = 4242;

/** Where an acted-out launch is, by how long ago Play was pressed. */
function launchStatus(instanceId: string) {
  const launch = launches.get(instanceId);
  const idle = { phase: "idle", message: null, pid: null, exit_code: null, log_path: null };
  if (!launch) return idle;
  if (launch.stopped) {
    return { ...idle, phase: "exited", exit_code: 0, message: "Demo: the game was only acted out." };
  }
  const elapsed = Date.now() - launch.startedAt;
  const steps: [number, string, string][] = [
    [1200, "preparing", "Checking the instance…"],
    [2600, "downloading_game", "Demo: nothing is downloaded."],
    [3800, "starting", "Starting Minecraft…"],
  ];
  for (const [until, phase, message] of steps) {
    if (elapsed < until) return { ...idle, phase, message };
  }
  return { ...idle, phase: "running", pid: PID, message: "Demo: no game is running." };
}

function running(): Record<string, number> {
  const answer: Record<string, number> = {};
  for (const [id] of launches) {
    if (launchStatus(id).phase === "running") answer[id] = PID;
  }
  return answer;
}

// ---------------------------------------------------------------------------
// Discover

const PROJECTS: [string, string, string, number, string, string, string][] = [
  ["sodium", "Sodium", "The fastest rendering optimisation mod for Minecraft.", 98_000_000, "#1b3b2f", "#5fe0a0", "⚡"],
  ["iris", "Iris Shaders", "A modern shaders mod, compatible with OptiFine packs.", 71_000_000, "#2a1b4a", "#a37cff", "✦"],
  ["jei", "Just Enough Items", "View items and recipes.", 450_000_000, "#1d5c2a", "#7fe08a", "J"],
  ["create", "Create", "Aesthetic technology and building tools.", 82_000_000, "#5a3a12", "#f0b04a", "⚙"],
  ["xaero", "Xaero's Minimap", "A minimap that keeps to its corner.", 64_000_000, "#14365e", "#43c6ff", "🗺"],
  ["farmers", "Farmer's Delight", "Farming and cooking, done properly.", 41_000_000, "#4a2a12", "#ffb070", "🍲"],
  ["skies", "Dramatic Skys", "New skies, sunsets and moons.", 9_200_000, "#3a1a6e", "#ff7aa8", "☁"],
  ["ores", "Visible Ores", "Ores you can read at a glance.", 2_800_000, "#2b2b2b", "#bfbfbf", "⛏"],
];

function modrinthHits() {
  return PROJECTS.map(([id, title, description, downloads, from, to, glyph]) => ({
    project_id: id,
    slug: id,
    title,
    description,
    downloads,
    follows: Math.round(downloads / 900),
    icon_url: icon(from, to, glyph),
    author: "Kiza demo",
    date_modified: "2026-09-01T00:00:00Z",
    versions: ["1.21.1", "1.20.1"],
    categories: ["optimization"],
    license: "MIT",
    project_type: "mod",
  }));
}

// ---------------------------------------------------------------------------
// Servers

const OFFLINE = { state: "offline", pid: null, exit_code: null, started_at_ms: null, players: [], last_error: null, install: null };

const SERVERS = [
  {
    id: "demo-server",
    name: "Serveur des amis",
    description: "Un serveur de démonstration",
    mc_version: "1.21.1",
    loader: "fabric",
    loader_version: "0.16.10",
    preset: "survival",
    port: 25565,
    java_major: null,
    min_memory_mb: 1024,
    max_memory_mb: 4096,
    jvm_args: [],
    linked_instance_id: "demo-survie",
    created_from: "instance:demo-survie",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: null,
    auto_backup: { before_start: true, every_minutes: 60, keep: 10 },
    kiza_address: null,
    installed: true,
    eula_accepted: true,
    has_icon: false,
    mod_count: 6,
    folder: "C:\Kiza Maker\demo\servers\demo-server",
    status: OFFLINE,
  },
];

// ---------------------------------------------------------------------------

function answer(command: string, args: Args): unknown {
  const instanceId = typeof args?.instanceId === "string" ? args.instanceId : null;
  switch (command) {
    // Who and what this is
    case "get_app_config":
      return { language: "fr", close_button_action: "quit", close_to_tray: false, update_channel: "maker" };
    case "get_first_run_setup":
      return { setup_completed: true, setup_version: 1, completed_at: now(), selected_performance_profile: "balanced", skipped_steps: [] };
    case "access_status":
      return { channel: "maker", allowed: true };
    case "minecraft_auth_get_account":
      return { uuid: "00000000-0000-0000-0000-000000000000", username: "KizaDesigner", skin_url: null, skin_head_url: null };
    case "minecraft_auth_list_accounts":
      return [{ uuid: "00000000-0000-0000-0000-000000000000", username: "KizaDesigner", skin_url: null, skin_head_url: null }];
    case "offline_accounts_list":
      return [];

    // The library
    case "list_game_instances":
      return INSTANCES.map(summary);
    case "instance_cover":
    case "get_instance_cover":
      return null;
    case "instance_play_history":
      return { "demo-survie": "2026-10-04T20:15:00Z", "demo-atm": "2026-09-28T18:40:00Z" };
    case "get_installed_mods":
      return instanceId ? (mods.get(instanceId) ?? []) : [];
    case "toggle_mod": {
      const list = instanceId ? mods.get(instanceId) : undefined;
      const mod = list?.find((entry) => entry.id === args?.modId);
      if (mod) mod.enabled = typeof args?.enabled === "boolean" ? args.enabled : !mod.enabled;
      return null;
    }
    case "delete_mod": {
      if (instanceId) mods.set(instanceId, (mods.get(instanceId) ?? []).filter((mod) => mod.id !== args?.modId));
      return null;
    }
    case "list_profiles":
      return { schema_version: 1, active_profile_id: null, profiles: [] };
    case "get_conflicts":
      return {};
    case "list_shaderpacks":
    case "list_minecraft_content":
    case "list_minecraft_worlds":
    case "get_downloads":
    case "restore_points_list":
    case "world_vault_worlds":
    case "scan_other_launchers":
    case "list_java_runtimes":
    case "minecraft_skin_library":
      return [];
    case "get_minecraft_install_status":
      return { stage: "done", ready: true, overall_completed: 8, overall_total: 8 };
    case "check_mod_compatibility":
      return { instance_id: instanceId, mc_version: "1.21.1", errors: 0, warnings: 0, mods: [] };
    case "get_performance_profiles":
      return [
        { id: "balanced", label: "Balanced", description: "The default: stable FPS on most PCs.", min_memory_mb: 2048, max_memory_mb: 4096, jvm_args: [] },
        { id: "performance", label: "Performance", description: "More memory for heavy packs.", min_memory_mb: 4096, max_memory_mb: 8192, jvm_args: [] },
      ];
    case "get_instance_performance_profile":
      return { instance_id: instanceId, profile_id: "balanced" };
    case "get_minecraft_loader_versions":
      return [{ version: "0.16.10", stable: true }];

    // Play, acted out
    case "launch_minecraft_instance":
      if (instanceId) launches.set(instanceId, { startedAt: Date.now(), stopped: false });
      return { pid: PID };
    case "get_launch_status":
      return instanceId ? launchStatus(instanceId) : launchStatus("");
    case "get_running_minecraft_instances":
      return running();
    case "stop_minecraft_instance": {
      const launch = instanceId ? launches.get(instanceId) : undefined;
      if (launch) launch.stopped = true;
      return null;
    }
    case "dismiss_launch_status":
      if (instanceId) launches.delete(instanceId);
      return null;
    case "read_instance_log":
      return "[Kiza Maker] This is a demonstration instance.\n[Kiza Maker] Nothing was launched, so there is nothing to log.\n";
    case "read_launch_record":
      return null;

    // Discover
    case "search_categories":
      return [];
    case "search_filter_support":
      return { curseforge_ignores: [], modrinth_ignores: [], curseforge_has_no_sides: false, curseforge_sort_approximate: true };
    case "modrinth_search_mods":
    case "modrinth_search_shaders": {
      const hits = modrinthHits();
      return { hits, limit: 20, offset: 0, total_hits: hits.length };
    }
    case "curseforge_search_mods":
      return { data: [] };
    case "modrinth_get_versions":
      return [];
    case "get_minecraft_versions":
      return {
        versions: ["1.21.4", "1.21.1", "1.20.4", "1.20.1", "1.19.2", "1.16.5", "1.12.2"].map((id, index) => ({
          id,
          type: "release",
          release_time: new Date(Date.UTC(2025 - index, 0, 1)).toISOString(),
          java_major: 21,
        })),
      };

    // Servers
    case "list_hosted_servers":
      return SERVERS;
    case "get_hosted_server":
      return SERVERS[0];
    case "hosted_server_status":
      return OFFLINE;
    case "hosted_server_players":
      return { ops: [{ uuid: "u", name: "KizaDesigner", level: 4 }], whitelist: [], banned: [], whitelist_enabled: false };
    case "hosted_server_mods":
      return (mods.get("demo-survie") ?? []).map((mod) => ({
        file: mod.files[0].replace("mods/", ""),
        mod_id: mod.id,
        name: mod.name,
        version: mod.version,
        bytes: mod.file_size,
        enabled: true,
      }));
    case "hosted_server_backups":
    case "hosted_server_console":
      return [];
    case "hosted_server_log":
      return "[Kiza Maker] A demonstration server. It never starts.";
    case "hosted_server_metrics":
      return { uptime_s: 0, memory_bytes: 0, cpu_percent: 0, world_bytes: 91_000_000, port_open: false };

    // The updater and notifications are not the Maker's business.
    case "plugin:updater|check":
      return null;
    default:
      return null;
  }
}

/** Whether this command is answered here rather than by the real runtime. */
export function answers(command: string): boolean {
  return !REAL.has(command) && !REAL_PLUGINS.some((prefix) => command.startsWith(prefix));
}

/**
 * The answer to one of the launcher's questions.
 *
 * After a moment, like a real backend: loading states and skeletons are part
 * of what a theme has to look right in.
 */
export function demo(command: string, args: Args): Promise<unknown> {
  return new Promise((resolve) => setTimeout(() => resolve(answer(command, args)), 120));
}
