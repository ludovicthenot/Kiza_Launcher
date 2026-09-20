mod access;
mod archive;
mod app_error;
mod base_mod;
mod commands;
mod compat_fixer;
mod config_manager;
mod content_filters;
mod content_manager;
mod content_provenance;
mod content_identity;
mod crash_doctor;
mod crash_telemetry;
mod credential_store;
mod curseforge_api;
mod dependency_resolver;
mod diagnostics;
mod discord_rpc;
mod doctor;
mod download_manager;
mod edition;
mod forge;
mod game_manager;
mod instance_art;
mod instance_export;
mod instance_import;
mod instance_lock;
mod instance_repair;
mod kizatheme;
mod launcher_import;
mod launcher_log;
mod lockfile;
mod minecraft_auth;
mod minecraft_manager;
mod minecraft_skins;
mod missing_dependency;
mod mod_compat;
mod mod_courtesy;
mod mod_manager;
mod mod_side;
mod modrinth_api;
mod nbt;
mod offline_accounts;
mod optifine;
mod path_security;
mod performance_advisor;
mod provenance_backfill;
mod restore_points;
mod safe_mode;
mod server_backup;
mod server_from_instance;
mod server_host;
mod server_import;
mod server_install;
mod server_mods;
mod server_network;
mod server_players;
mod server_process;
mod server_properties;
mod setup_manager;
mod startup;
mod storage_report;
mod support;
mod system_report;
mod tray_menu;
mod update_center;
mod webview_power;
mod windows_identity;
mod world_vault;

use app_error::AppError;
use config_manager::{AppConfig, ConfigManager};
use discord_rpc::{DiscordManager, LauncherPresenceActivity};
use download_manager::{DownloadInstallStatus, DownloadJob, DownloadManager, DownloadState};
use game_manager::{GameInstance, GameInstanceSummary, GameManager, MinecraftLoader};
use minecraft_auth::MinecraftAuthManager;
use minecraft_manager::MinecraftInstallManager;
use mod_manager::{DeleteModResult, ModManager};
use serde::{Deserialize, Serialize};
use sha1::Digest;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;

pub(crate) const DEFAULT_MICROSOFT_CLIENT_ID: &str = "3f1d7c79-7a79-45fc-a9e0-41d93e680009";

fn bundled_curseforge_api_key() -> Option<String> {
    option_env!("KIZAMODS_CURSEFORGE_API_KEY")
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

pub struct AppState {
    pub download_manager: Arc<DownloadManager>,
    pub discord_manager: Arc<DiscordManager>,
    pub minecraft_install_manager: Arc<MinecraftInstallManager>,
    pub minecraft_auth_manager: Arc<MinecraftAuthManager>,
    /// Per-instance launch phase, so the UI can show progress and crashes.
    pub launch_manager: Arc<minecraft_manager::LaunchManager>,
    /// instance_id -> PID of the running Minecraft process.
    pub running_games: Arc<std::sync::Mutex<std::collections::HashMap<String, u32>>>,
    /// Instances whose game the person asked the launcher to stop.
    ///
    /// A killed process exits with a non-zero code, which is also what a
    /// crash looks like from outside; without this the Manager showed
    /// "Crashed" after every Stop game. The watcher reads the mark once, when
    /// the process goes, and reports a stop as a stop.
    pub stop_requested: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    /// Where an import has got to, read by the window while it waits.
    ///
    /// Polled rather than pushed, like every other progress in this launcher.
    /// A pack of thirty mods is a minute of downloading, and it used to be a
    /// minute of a spinner that could not say whether anything was happening.
    pub import_progress: Arc<std::sync::Mutex<Option<ImportProgress>>>,
    /// The hosted servers' processes, consoles and states.
    pub servers: Arc<server_process::ServerRuntime>,
}

/// One line of "where the import has got to".
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    /// The mod being fetched, when it is known.
    pub name: String,
}

/// What an import produced, and what it could not.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub struct InstanceImportOutcome {
    pub instance_id: String,
    pub mods_installed: usize,
    /// Mods whose author does not allow a launcher to download them.
    pub blocked: Vec<content_manager::BlockedPackFile>,
    /// Mods that failed for a reason nobody chose.
    pub failed: Vec<content_manager::FailedPackFile>,
    /// The official release on CurseForge, when it is much heavier than the
    /// archive that was imported -- files are probably missing from it.
    #[serde(default)]
    pub lighter_than: Option<content_manager::OfficialPack>,
}

use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone)]
pub struct GameInfo {
    pub id: String,
    pub title: String,
    pub executable_path: String,
    pub version: String,
    pub is_supported: bool,
    pub checksum: String,
}

// Re-using the Mod struct from mod_manager would be cleaner,
// but for API compatibility with frontend we keep ModInfo as a subset/wrapper or alias.
#[derive(Serialize, Deserialize, Clone)]
pub struct ModInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub description: Option<String>,
    pub source: Option<String>,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub cover_url: Option<String>,
    pub cover_path: Option<String>,
    pub file_size: Option<u64>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub updated_at: Option<String>,
    pub load_order: i32,
    pub install_date: String,
    pub deployed_file_count: usize,
    /// Which side of the game this mod runs on, when anything knows.
    ///
    /// "client", "server", "both", or absent. Absent is a real answer and is
    /// left absent rather than filled in with "both": Forge and NeoForge
    /// manifests carry no side at all, so a Forge mod with no catalogue entry
    /// genuinely cannot be classified, and guessing would put a client-only mod
    /// into somebody's server pack.
    pub side: Option<String>,
    /// The files this mod owns, relative to the game directory.
    ///
    /// The interface has declared this field for a long time and the backend
    /// never sent it, so `mod.files` was `undefined` at runtime. Two components
    /// call `.some()` on it — the update list and the crash doctor — and both
    /// only run once something has been found to update or to blame, which
    /// nothing ever had while mods carried no provenance. The first check that
    /// returned a real candidate took the whole interface down.
    pub files: Vec<String>,
}

impl From<mod_manager::Mod> for ModInfo {
    fn from(m: mod_manager::Mod) -> Self {
        Self {
            id: m.id,
            name: m.name,
            version: m.version,
            enabled: m.enabled,
            description: Some(m.description),
            source: m.source,
            author: m.author,
            homepage_url: m.homepage_url,
            cover_url: m.cover_url,
            cover_path: m.cover_path,
            file_size: m.file_size,
            game_versions: m.game_versions,
            loaders: m.loaders,
            updated_at: m.updated_at,
            load_order: m.load_order,
            install_date: m.install_date,
            deployed_file_count: 0,
            side: None,
            files: m.files,
        }
    }
}

fn find_game_executable(_dir: &Path, _depth: u32) -> Option<(String, PathBuf, String)> {
    None
}


/// Where a mod runs, asked of the jar first and the catalogue second.
///
/// The jar wins because the loader that reads it is the one that obeys it, and
/// because it answers for a file somebody dropped in by hand -- which is
/// exactly the case a catalogue cannot help with. Read on every listing rather
/// than stored: a mod's jar can be replaced under it by an update, and a
/// recorded side would then describe the file that used to be there.
fn side_of(
    manager: &ModManager,
    instance_id: &str,
    entry: &mod_manager::Mod,
) -> Option<mod_side::ModSide> {
    if let Ok(folder) = manager.get_mod_path(instance_id, &entry.id) {
        let root = std::path::Path::new(&folder);
        for file in &entry.files {
            let path = root.join(file);
            if path.extension().and_then(|value| value.to_str()) != Some("jar") {
                continue;
            }
            if let Some(found) = mod_side::from_jar(&path) {
                return Some(found);
            }
        }
    }
    mod_side::from_catalogue(None, None, &entry.game_versions)
}


#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct ApiConnectionStatus {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub configured: bool,
    pub status: String,
    pub detail: String,
    pub recoverable: bool,
    pub action_hint: Option<String>,
}

fn connection_status(
    id: &str,
    label: &str,
    kind: &str,
    configured: bool,
    status: &str,
    detail: &str,
    action_hint: Option<&str>,
) -> ApiConnectionStatus {
    ApiConnectionStatus {
        id: id.to_string(),
        label: label.to_string(),
        kind: kind.to_string(),
        configured,
        status: status.to_string(),
        detail: detail.to_string(),
        recoverable: status != "connected" && status != "available",
        action_hint: action_hint.map(str::to_string),
    }
}

fn map_api_error(provider: &str, error: String) -> AppError {
    let lower = error.to_lowercase();
    if lower.contains("401") || lower.contains("403") || lower.contains("unauthorized") {
        return AppError::auth(
            format!("{provider}: authentication refused."),
            "Replace the key or reconnect the account.",
        );
    }
    if lower.contains("429") || lower.contains("rate") {
        return AppError::external_api(
            "rate_limited",
            format!("{provider}: rate limit reached."),
            true,
        );
    }
    if lower.contains("network")
        || lower.contains("request")
        || lower.contains("dns")
        || lower.contains("timeout")
    {
        return AppError::network(format!("{provider}: connexion impossible."));
    }
    AppError::external_api("api_error", format!("{provider}: {error}"), true)
}

fn provider_secret_name(provider: &str) -> Option<&'static str> {
    match provider {
        "curseforge" => Some(credential_store::CURSEFORGE_API_KEY),
        _ => None,
    }
}

fn microsoft_client_id() -> Result<String, String> {
    Ok(option_env!("KIZAMODS_MICROSOFT_CLIENT_ID")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_MICROSOFT_CLIENT_ID)
        .to_string())
}

fn curseforge_api_key() -> Result<String, String> {
    // Release builds own the CurseForge integration. Prefer the validated
    // bundled key so a legacy credential cannot silently override it.
    if let Some(value) = bundled_curseforge_api_key() {
        return Ok(value);
    }

    if let Some(value) = credential_store::get_secret_or_env(
        credential_store::CURSEFORGE_API_KEY,
        "CURSEFORGE_API_KEY",
    )
    .map_err(|e| e.message)?
    {
        return Ok(value);
    }

    Err("CurseForge is not configured".to_string())
}


fn api_connections() -> Vec<ApiConnectionStatus> {
    let curseforge_ready = curseforge_api_key().is_ok();
    vec![
        connection_status(
            "modrinth",
            "Modrinth",
            "content",
            true,
            "available",
            "Content search is ready.",
            None,
        ),
        connection_status(
            "curseforge",
            "CurseForge",
            "content",
            curseforge_ready,
            if curseforge_ready {
                "configured"
            } else {
                "disabled"
            },
            // Says a key exists, not that it works. Deciding the second means a
            // network call, and this answers the moment the settings dialogue
            // opens; the Connections page has a button that does ask.
            if curseforge_ready {
                "A CurseForge key is configured. Use Check all to see whether it is accepted."
            } else {
                "CurseForge is unavailable in this build."
            },
            None,
        ),
    ]
}


/// The Discord presence for the servers, decided from what is actually up.
///
/// The game wins when it is running: its watcher owns the presence then.
/// Otherwise the busiest online server is announced with its player count,
/// and when the last one goes down the launcher's own presence comes back.
/// Returns whether a server took the presence.
fn refresh_hosting_presence(app_state: &AppState, app_data_dir: &Path) -> bool {
    let game_running = app_state
        .running_games
        .lock()
        .map(|running| !running.is_empty())
        .unwrap_or(false);
    if game_running {
        return false;
    }
    let mut online = app_state.servers.online();
    online.sort_by_key(|(_, status)| std::cmp::Reverse(status.players.len()));
    match online.first() {
        Some((id, status)) => {
            let Ok(server) = server_host::get(app_data_dir, id) else {
                return false;
            };
            let config = ConfigManager::new(app_data_dir.to_path_buf()).load_config();
            let name = if config.discord_show_instance_name {
                server.name.as_str()
            } else {
                ""
            };
            let version = if config.discord_show_mc_version {
                server.mc_version.as_str()
            } else {
                ""
            };
            let start = status.started_at_ms.map_or(0, |ms| (ms / 1000) as i64);
            app_state.discord_manager.update_hosting_presence(
                name,
                version.trim(),
                status.players.len(),
                start,
            );
            true
        }
        None => {
            app_state.discord_manager.restore_presence();
            false
        }
    }
}

fn discord_instance_context(instance: &GameInstance, config: &AppConfig) -> Option<String> {
    let mut parts = Vec::new();
    if config.discord_show_instance_name {
        parts.push(instance.display_name.clone());
    }
    if config.discord_show_mc_version {
        if let Some(minecraft) = instance.minecraft.as_ref() {
            parts.push(format!(
                "{} {}",
                minecraft.mc_version,
                minecraft.loader.display_name()
            ));
        }
    }
    (!parts.is_empty()).then(|| parts.join(" | "))
}

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

/// Whether this session has already explained where the launcher went.
///
/// Once per run of the launcher, not once per install: someone who closes the
/// window every day should not be told every day, but someone who starts Kiza
/// fresh and closes it should never be left wondering whether it quit.
static TRAY_NOTICE_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Whether any instance is currently playing.
///
/// A poisoned lock is read through rather than answered with a guess. The
/// previous version returned `true` on poisoning, which quietly meant "assume
/// the game is up" and suppressed every idle and restore for the rest of the
/// session, with nothing on screen to say why.
fn minecraft_is_running(app: &tauri::AppHandle) -> bool {
    let app_state = app.state::<AppState>();
    let running = app_state
        .running_games
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    !running.is_empty()
}

/// Brings the launcher window back: the webview is woken first, so the page
/// is running by the time it is on screen.
fn show_launcher(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        webview_power::show(&window);
    }
    restore_launcher_presence(app);
}

fn restore_launcher_presence(app: &tauri::AppHandle) {
    if !minecraft_is_running(app) {
        let state = app.state::<AppState>();
        if !refresh_hosting_presence(&state, &app_data_dir(app)) {
            state.discord_manager.restore_presence();
        }
    }
}

/// Hides the window instead of quitting, and says so the first time.
///
/// Quitting on the cross would abandon whatever is in flight — a download, a
/// running game, an update being installed — so the window closing and the
/// launcher stopping are deliberately two different things.
fn hide_to_tray(window: &tauri::Window) {
    use tauri_plugin_notification::NotificationExt;

    match window.app_handle().get_webview_window("main") {
        Some(main) => webview_power::hide(&main),
        None => {
            let _ = window.hide();
        }
    }
    if !minecraft_is_running(window.app_handle()) {
        window
            .app_handle()
            .state::<AppState>()
            .discord_manager
            .set_idle();
    }

    if TRAY_NOTICE_SHOWN.swap(true, std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    // The user can switch this off in Notifications. Hiding without it is a
    // deliberate choice on their part, so it stops being a surprise worth
    // interrupting them for.
    let notify = window
        .app_handle()
        .path()
        .app_data_dir()
        .map(|dir| ConfigManager::new(dir).load_config().notify_background)
        .unwrap_or(true);
    if !notify {
        return;
    }

    // One line: the fact, and where the icon is. The reasons were a
    // paragraph, and a paragraph is what people close without reading.
    let mut notice = window
        .app_handle()
        .notification()
        .builder()
        .title("Kiza Launcher")
        .body("Still running in the tray. Right-click the icon for the menu.");
    if let Some(icon) = notification_icon(window.app_handle()) {
        notice = notice.icon(icon);
    }
    let _ = notice.show();
}

/// The launcher's mark for its own notifications, as a file Windows can
/// read. A toast names its sender by AppUserModelID and draws the icon of
/// the shortcut that carries it; a launcher without that shortcut — a
/// portable copy, a development build — got no icon at all. A file on disk
/// is read either way.
fn notification_icon(app: &tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    let path = dir.join("notification-icon.png");
    if !path.exists() {
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::write(&path, include_bytes!("../icons/128x128.png")).ok()?;
    }
    Some(path.to_string_lossy().to_string())
}

/// A `kiza://` link, when it is the answer to a sign-in this launcher started.
///
/// One kind reaches here now. There was a second — an offer to join a server —
/// and it went with the server list: a handler that validated an address and
/// then had nowhere to send it would be worse than not accepting one, because
/// the link would look supported and quietly do nothing.
///
/// Anything else on the scheme is ignored. The launcher is reachable by any web
/// page that can open a URL, so an unrecognised link is not an error to report,
/// it is a stranger to turn away.
fn handle_kiza_link(app: &tauri::AppHandle, url: &str) {
    use tauri::Emitter;

    let Some((code, state)) = access::parse_access_link(url) else {
        return;
    };
    show_launcher(app);
    let _ = app.emit(
        "kiza://access-code",
        serde_json::json!({ "code": code, "state": state }),
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// What the installer passes to ask a running launcher to close.
///
/// Shared with KizaSetup by value rather than by import — they are separate
/// crates, and a constant duplicated in two places with a test naming the
/// contract is better than a dependency between an installer and the thing it
/// installs.
pub const QUIT_FOR_UPDATE_ARG: &str = "--quit-for-update";

/// Whether this process was started only to tell a running launcher to close.
fn started_to_deliver_a_quit() -> bool {
    std::env::args().any(|arg| arg == QUIT_FOR_UPDATE_ARG)
}

pub fn run() {
    // Before any window exists: Windows reads the process identifier when the
    // first toast is raised, and a process that claims it late is a process
    // whose notifications are filed under the wrong name.
    windows_identity::claim_identity();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // The installer asking the running launcher to step aside.
            //
            // Windows will not let a running executable be overwritten, so an
            // update that finds Kiza open can only rename the old binary and
            // write the new one beside it — leaving the user running the old
            // version until they happen to restart. The installer therefore
            // asks first, through the same single-instance channel that
            // carries kiza:// links, and waits for the file to be released.
            //
            // Answered by quitting outright rather than by hiding to the tray:
            // the whole point is to let go of the file.
            if argv.iter().any(|arg| arg == QUIT_FOR_UPDATE_ARG) {
                crate::log_info!("Update", "Closing so the installer can replace this build.");
                app.exit(0);
                return;
            }

            if let Some(arg) = argv.iter().find(|a| a.starts_with("kiza://")) {
                handle_kiza_link(app, arg);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Asked to close, with nothing of ours already running.
            //
            // Reaching here with that argument means the single-instance
            // plugin found no earlier instance to hand it to, so there is no
            // launcher holding the file and nothing to do. The installer only
            // asks when the file *is* held, so this is the safety net rather
            // than the normal path — but a launcher that opened a window on
            // its way to doing nothing would be a strange thing to watch
            // during an update.
            if started_to_deliver_a_quit() {
                app.handle().exit(0);
                return Ok(());
            }

            let app_handle = app.handle();
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            // Config Load
            launcher_log::init(&app_data_dir);
            let config_manager = ConfigManager::new(app_data_dir.clone());
            let config = config_manager.load_config();

            // Old logs go now rather than when someone next opens the
            // settings page. A retention period chosen in March has to keep
            // being honoured by a launcher whose settings nobody reopens.
            //
            // On its own thread: it walks a folder, and the window is waiting.
            {
                let root = app_data_dir.clone();
                let logs_dir = app_data_dir.join("logs");
                let keep_logs = config.log_retention_days;
                let keep_cache = config.cache_retention_days;
                std::thread::spawn(move || {
                    let pruned = diagnostics::prune(&logs_dir, keep_logs);
                    if pruned.files > 0 {
                        crate::log_info!("Logs", "Removed {} old log files ({} bytes).",
                            pruned.files, pruned.bytes
                        );
                    }
                    let freed = storage_report::prune_cache(&root, keep_cache);
                    if freed > 0 {
                        crate::log_info!("Cache", "Removed {freed} bytes of stale cache.");
                    }
                });
            }

            // Who Kiza is, as far as Windows notifications are concerned.
            //
            // A toast is addressed to an AppUserModelID, and Windows drops any
            // sent under one it does not recognise — silently, with the call
            // still returning success. KizaSetup writes a Start menu shortcut
            // without that identifier, which is why every notification stopped
            // appearing when it replaced the NSIS bundle. Repaired here rather
            // than at install time only, so an existing install is fixed by the
            // next launch instead of by a reinstall.
            //
            // On its own thread: it touches COM and the registry, and the
            // window is what the main thread should be drawing.
            {
                let executable = std::env::current_exe().unwrap_or_default();
                let icon = notification_icon(app.handle()).map(PathBuf::from);
                std::thread::spawn(move || {
                    // The startup entry, if the user asked for one, must name
                    // the launcher that is actually installed.
                    //
                    // It is written once — when the switch is turned on — and
                    // was never looked at again. Kiza used to be called
                    // `KizaaMod.exe`, so anyone who enabled "start with
                    // Windows" on an older build kept an entry pointing at that
                    // file, and every reboot started the version they thought
                    // they had replaced. Nothing about the new install looked
                    // wrong: it was on disk, the shortcuts pointed at it, and it
                    // still was not what opened.
                    if startup::refresh(&executable) {
                        crate::log_info!("Startup", "The startup entry now points at this build.");
                    }

                    let Some(programs) = windows_identity::start_menu_programs() else {
                        return;
                    };
                    let state = windows_identity::ensure(
                        &executable,
                        &windows_identity::shortcut_path(&programs),
                        icon.as_deref(),
                    );
                    if !state.can_notify() {
                        crate::log_warn!("Notifications", "No Start menu shortcut carries Kiza's identifier; Windows will not show notifications."
                        );
                    }
                });
            }

            let discord_manager = Arc::new(DiscordManager::new());
            if config.enable_discord_rpc {
                discord_manager.connect();
            }

            let download_manager = Arc::new(DownloadManager::new(
                Some(app_handle.clone()),
                Some(app_data_dir.join("config").join("downloads.json")),
            ));
            // The saved setting is applied before the queue resumes anything,
            // so a limit chosen last session is not silently ignored on this
            // one just because nobody opened the settings page.
            download_manager.set_concurrency(config.download_concurrency as usize);
            download_manager.set_max_attempts(config.download_attempts);
            let minecraft_install_manager = Arc::new(MinecraftInstallManager::new());
            let minecraft_auth_manager = Arc::new(MinecraftAuthManager::new());

            app.manage(AppState {
                download_manager,
                discord_manager,
                minecraft_install_manager,
                minecraft_auth_manager,
                launch_manager: Arc::new(minecraft_manager::LaunchManager::new()),
                running_games: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
                stop_requested: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
                import_progress: Arc::new(std::sync::Mutex::new(None)),
                servers: {
                    // Every status change and every burst of console lines
                    // reaches the window as an event, so the Host page shows
                    // "Online" when the server says Done, not on its next poll.
                    let runtime = Arc::new(server_process::ServerRuntime::default());
                    let emitter = app.handle().clone();
                    let data_dir = app_data_dir.clone();
                    runtime.set_notifier(Box::new(move |notice| {
                        use tauri::Emitter;
                        if let server_process::Notice::Status { id, status } = &notice {
                            if let Some(state) = emitter.try_state::<AppState>() {
                                refresh_hosting_presence(&state, &data_dir);
                            }
                            // A port Kiza opened on the router closes with the
                            // server that used it, and its name stops pointing
                            // here: an address is public only while there is
                            // something to join at it.
                            if matches!(status.state, server_process::ServerState::Offline | server_process::ServerState::Crashed) {
                                if let Ok(server) = server_host::get(&data_dir, id) {
                                    tauri::async_runtime::spawn(server_network::close_if_opened(server.port));
                                    park_kiza_address(&emitter, &server);
                                }
                            }
                        }
                        let _ = emitter.emit("kiza://server", &notice);
                    }));
                    runtime
                },
            });

            // System Tray. Left click brings the launcher back; right click
            // opens Kiza's own menu window rather than the system's list.
            //
            // The same mark as the app icon, but rendered at 64px: the tray
            // draws at 16 or 32 depending on the display, and both divide into
            // 64 cleanly, so Windows never resamples by an awkward ratio.
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                    .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Kiza Launcher")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    let TrayIconEvent::Click {
                        button,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    else {
                        return;
                    };
                    let app = tray.app_handle();
                    match button {
                        MouseButton::Left => {
                            tray_menu::close(app);
                            show_launcher(app);
                        }
                        MouseButton::Right => {
                            if let Err(error) = tray_menu::open(app, position) {
                                crate::log_warn!("Tray", "The menu could not open: {error}");
                            }
                        }
                        MouseButton::Middle => {}
                    }
                })
                .build(app)?;

            // In a development build the schemes are not registered by an
            // installer, so ask the OS for them at startup. On an installed
            // build the NSIS script has already written them and this is a
            // no-op.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();

                let link_app = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        // Through the same door as every other kiza:// link.
                        // This called the join handler directly, so a Discord
                        // sign-in that came back while the launcher was already
                        // running was read as a server address, failed to parse
                        // and was dropped -- the browser said it had worked and
                        // the launcher never heard.
                        handle_kiza_link(&link_app, url.as_str());
                    }
                });
            }

            // A link can also arrive as an argument on the very first launch,
            // before any window exists to receive an event.
            let args: Vec<String> = std::env::args().collect();
            if let Some(arg) = args.iter().find(|a| a.starts_with("kiza://")) {
                let link_app = app.handle().clone();
                let link = arg.clone();
                // The frontend has to be listening before the offer is sent.
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    handle_kiza_link(&link_app, &link);
                });
            }


            Ok(())
        })
        .on_window_event(|window, event| {
            // The tray menu is a menu: it goes away when the eye does.
            if window.label() == tray_menu::LABEL {
                if let tauri::WindowEvent::Focused(false) = event {
                    tray_menu::blurred(window.app_handle());
                }
                return;
            }
            // Only the main window from here. The console window is a log
            // viewer, and closing it means closing it.
            if window.label() != "main" {
                return;
            }
            // Focus reaches a dozing webview only through a path that woke
            // it first — except the taskbar, which shows the window itself.
            if let tauri::WindowEvent::Focused(true) = event {
                if let Some(main) = window.app_handle().get_webview_window("main") {
                    webview_power::wake(&main);
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_data_dir = window
                    .app_handle()
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                let config = ConfigManager::new(app_data_dir).load_config();
                // Two settings said the same thing; the action is the one that
                // decides, and the older flag is honoured as its fallback.
                let hides = config.close_button_action == "tray" && config.close_to_tray;
                if !hides {
                    return;
                }
                api.prevent_close();
                hide_to_tray(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::mods::scan_directory,
            commands::mods::get_installed_mods,
            commands::mods::install_mod,
            commands::mods::toggle_mod,
            commands::mods::deploy_mods,
            commands::mods::verify_mods,
            commands::mods::repair_mods,
            commands::mods::undeploy_mods,
            commands::mods::refresh_mods,
            commands::instances::add_game_instance,
            commands::instances::list_game_instances,
            commands::instances::get_kiza_client_support,
            commands::instances::verify_game_instance,
            commands::mods::create_profile,
            commands::mods::switch_profile,
            commands::mods::list_profiles,
            commands::mods::delete_profile,
            commands::mods::get_active_profile_id,
            commands::mods::get_conflicts,
            commands::mods::delete_mod,
            commands::mods::get_mod_path,
            commands::mods::open_mod_folder,
            commands::mods::scan_residuals,
            commands::mods::delete_residual_files,
            commands::settings::get_app_config,
            commands::settings::save_app_config,
            commands::settings::get_first_run_setup,
            commands::settings::save_first_run_setup,
            commands::settings::complete_first_run_setup,
            commands::settings::get_api_connections,
            commands::settings::save_api_connection,
            commands::settings::validate_api_connection,
            commands::settings::remove_api_connection,
            commands::settings::start_download,
            commands::settings::get_downloads,
            commands::settings::pause_download,
            commands::settings::resume_download,
            commands::settings::cancel_download,
            commands::settings::install_download,
            commands::instances::get_minecraft_versions,
            commands::instances::get_minecraft_loader_versions,
            commands::settings::detect_minecraft_runtime,
            commands::settings::install_minecraft_runtime,
            commands::settings::list_java_runtimes,
            commands::settings::remove_java_runtime,
            commands::launch::get_performance_profiles,
            commands::launch::get_instance_performance_profile,
            commands::launch::save_instance_performance_profile,
            commands::instances::get_instance_settings,
            commands::instances::save_instance_settings,
            commands::instances::export_instance,
            commands::instances::export_plan,
            commands::instances::create_minecraft_instance_cmd,
            commands::instances::rename_minecraft_instance_cmd,
            commands::instances::set_minecraft_instance_version_cmd,
            commands::instances::set_minecraft_instance_java_cmd,
            commands::instances::delete_minecraft_instance_cmd,
            commands::instances::open_instance_folder,
            commands::mods::check_mod_compatibility,
            commands::content::list_minecraft_worlds,
            commands::content::list_minecraft_content,
            commands::content::delete_minecraft_content,
            commands::content::import_minecraft_content,
            commands::content::open_minecraft_content_folder,
            commands::mods::install_modrinth_content,
            commands::content::install_curseforge_content,
            commands::content::list_shaderpacks,
            commands::content::delete_shaderpack,
            commands::content::import_shaderpack,
            commands::content::open_shaderpacks_folder,
            commands::content::modrinth_search_shaders,
            commands::content::install_shaderpack_from_modrinth,
            commands::content::is_iris_installed,
            commands::content::install_iris,
            commands::launch::start_minecraft_install,
            commands::launch::get_minecraft_install_status,
            commands::launch::launch_minecraft_instance,
            commands::accounts::offline_accounts_list,
            commands::accounts::offline_account_create,
            commands::accounts::offline_account_rename,
            commands::accounts::offline_account_delete,
            commands::accounts::offline_account_import_skin,
            commands::launch::get_running_minecraft_instances,
            commands::launch::get_launch_status,
            commands::launch::read_instance_log,
            commands::launch::read_launch_record,
            commands::launch::open_instance_log,
            commands::instances::scan_other_launchers,
            commands::instances::import_from_other_launcher,
            commands::launch::diagnose_instance_crash,
            commands::instances::restore_points_list,
            commands::instances::restore_point_create,
            commands::instances::restore_point_apply,
            commands::instances::restore_points_prune,
            commands::instances::restore_points_stored_bytes,
            commands::mods::content_origins,
            commands::mods::content_origin,
            commands::mods::content_set_pinned,
            commands::mods::content_forget_origin,
            commands::mods::check_instance_updates,
            commands::mods::apply_instance_updates,
            commands::mods::list_content_versions,
            commands::mods::set_content_version,
            commands::mods::download_content_file,
            commands::mods::backfill_content_origins,
            commands::launch::safe_mode_start,
            commands::launch::safe_mode_record,
            commands::launch::safe_mode_status,
            commands::launch::safe_mode_stop,
            commands::settings::launch_at_startup_enabled,
            commands::settings::set_launch_at_startup,
            commands::settings::storage_usage,
            commands::settings::reclaim_storage,
            commands::settings::open_kiza_folder,
            commands::settings::send_test_notification,
            commands::settings::notification_readiness,
            commands::settings::send_notification,
            commands::settings::logs_overview,
            commands::settings::prune_logs,
            commands::settings::export_diagnostics,
            commands::settings::support_cooldown_seconds,
            commands::settings::support_preview,
            commands::settings::support_submit,
            commands::settings::check_services,
            commands::settings::system_report,
            commands::settings::clear_metadata_cache,
            commands::settings::prune_cache,
            commands::instances::rebuild_instance_index,
            commands::settings::download_concurrency_range,
            commands::settings::set_downloads_paused,
            commands::settings::downloads_paused,
            commands::settings::reset_app_config,
            commands::content::instance_cover,
            commands::content::set_instance_cover,
            commands::content::clear_instance_cover,
            commands::launch::instance_play_history,
            commands::instances::lockfile_export,
            commands::instances::lockfile_save,
            commands::instances::lockfile_read,
            commands::instances::lockfile_diff,
            commands::instances::lockfile_apply,
            commands::content::world_vault_worlds,
            commands::content::world_vault_checkpoints,
            commands::content::world_vault_backup,
            commands::content::world_vault_restore,
            commands::content::world_vault_delete,
            commands::content::world_vault_prune,
            commands::content::world_vault_stored_bytes,
            commands::launch::performance_report,
            commands::launch::performance_measure_next_launch,
            commands::launch::performance_apply_advice,
            commands::launch::dismiss_launch_status,
            commands::launch::stop_minecraft_instance,
            commands::launch::open_console_window,
            commands::launch::return_to_launcher,
            commands::accounts::minecraft_auth_start,
            commands::accounts::minecraft_auth_poll,
            commands::accounts::minecraft_auth_get_account,
            commands::accounts::minecraft_auth_list_accounts,
            commands::accounts::minecraft_auth_set_active,
            commands::accounts::minecraft_auth_remove_account,
            commands::accounts::minecraft_auth_logout,
            commands::accounts::minecraft_skin_current,
            commands::accounts::minecraft_skin_preview,
            commands::accounts::minecraft_skin_apply,
            commands::accounts::minecraft_skin_reset,
            commands::accounts::minecraft_skin_set_cape,
            commands::accounts::minecraft_skin_library,
            commands::accounts::minecraft_skin_library_add,
            commands::accounts::minecraft_skin_library_rename,
            commands::accounts::minecraft_skin_library_set_variant,
            commands::accounts::minecraft_skin_library_remove,
            commands::settings::tray_action,
            commands::content::identify_minecraft_content,
            commands::mods::modrinth_search_mods,
            commands::mods::modrinth_get_versions,
            commands::mods::minecraft_download_mod_from_url,
            commands::mods::curseforge_search_mods,
            commands::mods::search_filter_support,
            commands::mods::search_categories,
            commands::servers::list_hosted_servers,
            commands::servers::get_hosted_server,
            commands::servers::create_hosted_server,
            commands::servers::update_hosted_server,
            commands::servers::delete_hosted_server,
            commands::servers::clone_hosted_server,
            commands::servers::open_hosted_server_folder,
            commands::servers::accept_hosted_server_eula,
            commands::servers::set_hosted_server_icon,
            commands::servers::hosted_server_icon,
            commands::servers::install_hosted_server,
            commands::servers::cancel_hosted_server_install,
            commands::servers::start_hosted_server,
            commands::servers::stop_hosted_server,
            commands::servers::kill_hosted_server,
            commands::servers::restart_hosted_server,
            commands::servers::hosted_server_status,
            commands::servers::hosted_server_console,
            commands::servers::clear_hosted_server_console,
            commands::servers::send_hosted_server_command,
            commands::servers::hosted_server_metrics,
            commands::servers::hosted_server_network,
            commands::servers::open_hosted_server_port,
            commands::servers::close_hosted_server_port,
            commands::servers::claim_hosted_server_address,
            commands::servers::release_hosted_server_address,
            commands::servers::hosted_server_properties,
            commands::servers::save_hosted_server_properties,
            commands::servers::hosted_server_players,
            commands::servers::hosted_server_player_action,
            commands::servers::hosted_server_mods,
            commands::servers::hosted_server_mod_compatibility,
            commands::servers::remove_hosted_server_mod,
            commands::servers::set_hosted_server_mod_enabled,
            commands::servers::add_hosted_server_mod_file,
            commands::servers::install_hosted_server_mod,
            commands::servers::check_hosted_server_mod_updates,
            commands::servers::apply_hosted_server_mod_update,
            commands::servers::hosted_server_backups,
            commands::servers::create_hosted_server_backup,
            commands::servers::restore_hosted_server_backup,
            commands::servers::delete_hosted_server_backup,
            commands::servers::diagnose_hosted_server_crash,
            commands::servers::hosted_server_log,
            commands::servers::analyse_instance_for_server,
            commands::servers::build_server_from_instance,
            commands::servers::compare_hosted_server_with_instance,
            commands::servers::search_mods_for_hosted_server,
            commands::servers::detect_server_folder,
            commands::servers::import_hosted_server,
            commands::instances::import_instance,
            commands::instances::import_progress,
            commands::settings::launcher_edition,
            commands::settings::import_theme,
            commands::settings::installed_themes,
            commands::settings::stage_theme_asset,
            commands::accounts::access_status,
            commands::settings::update_refusal,
            commands::accounts::access_headers,
            commands::accounts::access_begin,
            commands::accounts::access_claim,
            commands::accounts::access_disconnect,
            commands::accounts::access_renew,
            commands::settings::remove_theme,
            commands::settings::export_theme,
            commands::mods::optifine_list_releases,
            commands::mods::optifine_install,
            commands::mods::curseforge_list_files,
            commands::mods::curseforge_install_file,
            commands::mods::resolve_mod_dependencies,
            commands::mods::install_mod_with_dependencies,
            commands::mods::install_missing_mods,
            commands::mods::add_missing_mod_file,
            commands::launch::doctor_apply,
            commands::launch::doctor_pending,
            commands::launch::crash_report_preview,
            commands::launch::crash_report_send,
            commands::launch::doctor_undo,
            commands::launch::repair_instance,
            commands::mods::plan_compat_fixes,
            commands::mods::apply_compat_fixes,
            commands::mods::install_missing_dependency,
            commands::settings::update_discord_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum InstallDownloadOutcome {
    Installed {
        instance_id: String,
        instance_name: String,
    },
}


// --- Shader packs ---

fn minecraft_loader_name(loader: &MinecraftLoader) -> &'static str {
    loader.slug()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShaderEngine {
    /// Fabric: shaders are driven by the Iris mod.
    Iris,
    /// Forge: OptiFine provides shader support and is itself the mod, so
    /// nothing extra has to be installed alongside the pack.
    OptiFine,
}

impl ShaderEngine {
    fn modrinth_category(self) -> &'static str {
        match self {
            Self::Iris => "iris",
            Self::OptiFine => "optifine",
        }
    }
}

fn shader_engine_for_loader(loader: &MinecraftLoader) -> Option<ShaderEngine> {
    match loader {
        MinecraftLoader::Fabric => Some(ShaderEngine::Iris),
        MinecraftLoader::Forge => Some(ShaderEngine::OptiFine),
        // NeoForge is deliberately absent. OptiFine does not run on it, and the
        // Forge port of Iris is a separate project with its own version rules
        // that Kiza has never installed or tested. Claiming an engine here
        // would offer a shader install that quietly does nothing; saying so is
        // better than pretending.
        MinecraftLoader::NeoForge | MinecraftLoader::Vanilla => None,
    }
}

fn require_shader_engine(
    minecraft: &game_manager::MinecraftInstanceConfig,
) -> Result<ShaderEngine, String> {
    shader_engine_for_loader(&minecraft.loader).ok_or_else(|| {
        let loader_version = minecraft
            .loader_version
            .as_deref()
            .map(|version| format!(" {version}"))
            .unwrap_or_default();
        format!(
            "No compatible shader engine is available for Minecraft {} with {}{}.",
            minecraft.mc_version,
            minecraft_loader_name(&minecraft.loader),
            loader_version
        )
    })
}

fn shaderpacks_dir(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    minecraft_manager::instance_game_dir_path(app_data_dir, instance_id).join("shaderpacks")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallModrinthContentRequest {
    instance_id: String,
    content_type: content_manager::ContentKind,
    project_id: String,
    version_id: Option<String>,
    world_name: Option<String>,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallCurseForgeContentRequest {
    instance_id: String,
    content_type: content_manager::ContentKind,
    mod_id: u64,
    file_id: u64,
    world_name: Option<String>,
    display_name: Option<String>,
}


#[derive(Serialize)]
struct ShaderPackInfo {
    file_name: String,
    size: u64,
}


/// True when an `iris*.jar` is already present in the instance mods folder.
fn iris_jar_present(install_path: &str) -> bool {
    let mods_dir = PathBuf::from(install_path).join("mods");
    std::fs::read_dir(&mods_dir)
        .map(|entries| {
            entries.flatten().any(|entry| {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                name.starts_with("iris") && name.ends_with(".jar")
            })
        })
        .unwrap_or(false)
}

/// Downloads the Iris loader into the instance mods folder if it is not already
/// present. Shared by the explicit install command and the shader-pack install
/// flow so shader packs "just work" without a separate step.
async fn ensure_iris(install_path: &str, mc_version: &str) -> Result<String, String> {
    if iris_jar_present(install_path) {
        return Ok("Iris already installed".to_string());
    }

    let versions = modrinth_api::get_versions("iris").await?;
    let version = versions
        .iter()
        .find(|version| modrinth_api::version_matches_context(version, mc_version, "fabric"))
        .ok_or_else(|| format!("No Iris build matches Minecraft {mc_version} and Fabric."))?;
    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or("This Iris version has no downloadable file.".to_string())?;

    let mods_dir = PathBuf::from(install_path).join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let dest = mods_dir.join(&file.filename);
    minecraft_manager::download_to_path(&client, &file.url, &dest, Some(&file.hashes.sha1)).await?;
    Ok(file.filename.clone())
}


#[cfg(test)]
mod shader_engine_tests {
    use super::{shader_engine_for_loader, MinecraftLoader, ShaderEngine};

    #[test]
    fn each_modloader_uses_its_own_shader_engine() {
        // Fabric drives shaders through Iris, Forge through OptiFine. Forge was
        // previously refused outright, which blocked shaders on every 1.8-era
        // instance even with OptiFine installed.
        assert_eq!(
            shader_engine_for_loader(&MinecraftLoader::Fabric),
            Some(ShaderEngine::Iris)
        );
        assert_eq!(
            shader_engine_for_loader(&MinecraftLoader::Forge),
            Some(ShaderEngine::OptiFine)
        );
    }

    #[test]
    fn vanilla_has_no_shader_engine() {
        assert_eq!(shader_engine_for_loader(&MinecraftLoader::Vanilla), None);
    }

    #[test]
    fn each_engine_maps_to_its_modrinth_category() {
        assert_eq!(ShaderEngine::Iris.modrinth_category(), "iris");
        assert_eq!(ShaderEngine::OptiFine.modrinth_category(), "optifine");
    }
}


/// The last `max_bytes` of a text file, starting at a line boundary.
fn read_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        // The first line is a fragment; the one after it is whole.
        if let Some(newline) = text.find('\n') {
            text.drain(..=newline);
        }
    }
    Ok(text)
}


#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppliedUpdates {
    /// The snapshot taken before touching anything, so this is undoable.
    restore_point_id: String,
    updated: Vec<String>,
    failed: Vec<String>,
}


/// Downloads the target version, then removes the file it replaces.
///
/// The new release almost always has a different file name, so leaving the old
/// one behind would load both versions of the mod at once.
async fn apply_one_update(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    client: &reqwest::Client,
    candidate: &update_center::UpdateCandidate,
) -> Result<String, String> {
    let target = candidate
        .target
        .as_ref()
        .ok_or("This candidate has no target version.")?;

    install_content_version(
        app_data_dir,
        instance_id,
        game_dir,
        client,
        &candidate.provider,
        &candidate.project_id,
        &target.version_id,
        &candidate.path,
        false,
    )
    .await
}

/// Installs one exact released version of a project, replacing the file that is
/// there.
///
/// `pin` is what makes a deliberate choice stick: a version the user picked by
/// hand must not be quietly replaced by the next "update everything".
#[allow(clippy::too_many_arguments)]
async fn install_content_version(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    client: &reqwest::Client,
    provider: &str,
    project_id: &str,
    version_id: &str,
    current_path: &str,
    pin: bool,
) -> Result<String, String> {
    let (url, file_name, sha1) = match provider {
        "modrinth" => {
            let version = modrinth_api::get_version(version_id).await?;
            let file = version
                .files
                .iter()
                .find(|file| file.primary)
                .or_else(|| version.files.first())
                .ok_or("That Modrinth version has no downloadable file.")?;
            (
                file.url.clone(),
                file.filename.clone(),
                Some(file.hashes.sha1.clone()),
            )
        }
        "curseforge" => {
            let key = curseforge_api_key()?;
            let mod_id: u64 = project_id
                .parse()
                .map_err(|_| "Invalid CurseForge project id.".to_string())?;
            let file_id: u64 = version_id
                .parse()
                .map_err(|_| "Invalid CurseForge file id.".to_string())?;
            let file = curseforge_api::get_file(&key, mod_id, file_id).await?;
            let url = match file.download_url.as_deref() {
                Some(url) => url.to_string(),
                None => curseforge_api::get_download_url(&key, mod_id, file_id).await?,
            };
            let sha1 = file
                .hashes
                .iter()
                .find(|hash| hash.algo == 1)
                .map(|hash| hash.value.clone());
            (url, file.file_name, sha1)
        }
        other => return Err(format!("Kiza cannot install {other} content.")),
    };

    let folder = current_path
        .rsplit_once('/')
        .map(|(folder, _)| folder.to_string())
        .unwrap_or_else(|| "mods".to_string());
    let safe_name = path_security::safe_file_name(&file_name, &["jar", "zip"])
        .map_err(|error| format!("Invalid file name from the platform: {error}"))?;
    let new_relative = format!("{folder}/{safe_name}");
    let destination = game_dir.join(&folder).join(&safe_name);

    minecraft_manager::download_to_path(client, &url, &destination, sha1.as_deref()).await?;

    // Only drop the old file once the new one is safely on disk. The name
    // almost always differs between releases, so leaving it would load two
    // versions of the same mod at once.
    if new_relative != current_path {
        let previous = game_dir.join(current_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let _ = std::fs::remove_file(previous);
        let _ = content_provenance::forget(app_data_dir, instance_id, current_path);
    }

    content_provenance::record(
        app_data_dir,
        instance_id,
        &new_relative,
        content_provenance::ContentOrigin {
            provider: provider.to_string(),
            project_id: project_id.to_string(),
            version_id: version_id.to_string(),
            pinned: pin,
        },
    )?;
    // `record` deliberately keeps whatever pin the path already had, so that
    // reinstalling never silently unpins. Setting it explicitly is therefore
    // the only way a deliberate choice sticks.
    if pin {
        content_provenance::set_pinned(app_data_dir, instance_id, &new_relative, true)?;
    }

    Ok(new_relative)
}


#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceBackfill {
    matched: Vec<String>,
    unmatched: Vec<String>,
}


#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SafeModeState {
    step: safe_mode::BisectionStep,
    runs: u32,
    /// Mods the caller should enable before the next launch.
    enabled: Vec<String>,
    total_candidates: usize,
}

fn safe_mode_state(session: &safe_mode::SafeModeSession) -> SafeModeState {
    let step = session.next_step();
    SafeModeState {
        enabled: session.enabled_for(&step),
        runs: session.runs,
        total_candidates: session.candidates.len(),
        step,
    }
}

/// Applies a step by enabling exactly the listed mods and disabling the rest.
fn apply_safe_mode_selection(
    app_data_dir: &Path,
    instance: &game_manager::GameInstance,
    enabled: &[String],
) -> Result<(), String> {
    let manager = ModManager::new(app_data_dir.to_path_buf());
    for installed in manager.load_mods(&instance.id) {
        let should_enable = enabled.contains(&installed.id);
        if installed.enabled != should_enable {
            manager.toggle_mod(&instance.id, &installed.id, should_enable)?;
        }
    }
    manager.deploy(&instance.id, "minecraft", &instance.install_path)?;
    Ok(())
}


/// The picture on an instance card.
///
/// The user's own choice wins. Failing that, the Minecraft version's own
/// title-screen artwork, read from the assets that version already downloaded —
/// so a 1.8.9 card looks like 1.8.9 without Kiza inventing anything. Failing
/// both, None, and the interface draws its gradient.
///
/// Fetched per card rather than with the instance list: this is a wallpaper,
/// and sending megabytes of base64 through the bridge every time the library
/// reloads would make the list slower for a decoration.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceCover {
    uri: String,
    /// "custom" or "version". The interface offers to go back to the version's
    /// artwork only when there is something to go back from.
    source: &'static str,
}


/// Tells every window which games are running, the moment it changes. The
/// pages used to ask every three seconds for as long as the launcher was
/// open; now they ask once and are told.
fn announce_running_games(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let running = app
        .state::<AppState>()
        .running_games
        .lock()
        .map(|running| running.clone())
        .unwrap_or_default();
    let _ = app.emit("kiza://games", running);
}


/// Resolves the app data directory the same way every command does.
fn app_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}


async fn download_file_to_path(
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let tmp = dest.with_extension("tmp");
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| e.to_string())?;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, dest)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(expected) = expected_sha1 {
        let data = tokio::fs::read(dest).await.map_err(|e| e.to_string())?;
        let mut hasher = sha1::Sha1::new();
        hasher.update(&data);
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(dest).await;
            return Err("SHA1 mismatch".to_string());
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftDownloadModRequest {
    instance_id: String,
    url: String,
    file_name: String,
    sha1: Option<String>,
    mod_name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    cover_url: Option<String>,
    source: Option<String>,
    homepage_url: Option<String>,
    file_size: Option<u64>,
    game_versions: Option<Vec<String>>,
    loaders: Option<Vec<String>>,
    updated_at: Option<String>,
    /// Upstream project and released version, so updates can be offered later.
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    version_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeInstallFileRequest {
    instance_id: String,
    mod_id: u64,
    file_id: u64,
    file_name: Option<String>,
    mod_name: Option<String>,
    description: Option<String>,
    cover_url: Option<String>,
    homepage_url: Option<String>,
    file_size: Option<u64>,
    game_versions: Option<Vec<String>>,
    updated_at: Option<String>,
}


fn instance_minecraft_config(
    app_handle: &tauri::AppHandle,
    instance_id: &str,
) -> Result<game_manager::MinecraftInstanceConfig, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = GameManager::new(app_data_dir).verify_instance(instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("Not a Minecraft instance".to_string());
    }
    instance
        .minecraft
        .ok_or("Minecraft configuration is missing".to_string())
}


/// What each catalogue will and will not honour of a set of filters.
///
/// So the interface can say "CurseForge does not filter by Bug fixes" or
/// "sorted by popularity here; CurseForge has no follows" beside the results,
/// instead of returning everything and letting the person wonder why the
/// chip did nothing.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct SearchFilterSupport {
    modrinth_ignores: Vec<&'static str>,
    curseforge_ignores: Vec<&'static str>,
    /// True when CurseForge substitutes its nearest ordering for the one asked.
    curseforge_sort_approximate: bool,
    /// Modrinth only: whether the side filters apply at all.
    curseforge_has_no_sides: bool,
}


/// Where installed themes live.
fn themes_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?
        .join("themes"))
}


/// Begins downloading Minecraft for an instance that does not have it yet.
///
/// Silent when the runtime is already there, and best-effort when it is not:
/// an import that succeeded must not be reported as a failure because the game
/// download could not be started.
fn start_install_if_missing(
    app_data_dir: &std::path::Path,
    app_state: &tauri::State<'_, AppState>,
    instance_id: &str,
) {
    let Ok(instance) = GameManager::new(app_data_dir.to_path_buf()).get_instance_by_id(instance_id)
    else {
        return;
    };
    if minecraft_manager::is_instance_installed(app_data_dir, &instance) {
        return;
    }
    let Some(minecraft) = instance.minecraft.as_ref() else {
        return;
    };
    if app_state
        .minecraft_install_manager
        .try_start(
            instance_id,
            minecraft_manager::planned_install_steps(&minecraft.loader),
        )
        .is_err()
    {
        return;
    }

    let install_manager = (*app_state.minecraft_install_manager).clone();
    let app_data_dir = app_data_dir.to_path_buf();
    let instance_id = instance_id.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = minecraft_manager::install_minecraft_instance(
            app_data_dir,
            install_manager.clone(),
            instance,
        )
        .await
        {
            install_manager.set_error(&instance_id, error);
        }
    });
}

/// Reads the Kiza sidecar out of an archive, when there is one.
fn read_kiza_manifest(path: &std::path::Path) -> Option<instance_export::KizaManifest> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    content_manager::read_zip_json::<instance_export::KizaManifest>(&mut archive, "kiza.json").ok()
}


fn dependency_api_key(source: dependency_resolver::ModProvider) -> Result<Option<String>, String> {
    match source {
        dependency_resolver::ModProvider::Modrinth => Ok(None),
        dependency_resolver::ModProvider::Curseforge => curseforge_api_key().map(Some),
    }
}

fn dependency_instance(app_data_dir: &Path, instance_id: &str) -> Result<GameInstance, String> {
    let instance = GameManager::new(app_data_dir.to_path_buf()).verify_instance(instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("Dependencies are only supported for Minecraft instances".to_string());
    }
    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err("Cannot modify an invalid Minecraft instance".to_string());
    }
    Ok(instance)
}


/// One mod a pack could not bring, that Modrinth can.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct MissingMod {
    name: String,
    modrinth_project_id: String,
    /// The release to install -- the pack's own build, or the nearest. Absent,
    /// the newest release that fits the instance is taken.
    #[serde(default)]
    modrinth_version_id: Option<String>,
}

/// What became of the missing mods, once asked to fetch them.
#[derive(Serialize, Default)]
#[serde(rename_all = "snake_case")]
struct MissingModsReport {
    installed: Vec<String>,
    failed: Vec<MissingModFailure>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct MissingModFailure {
    name: String,
    reason: String,
}


/// One line per compatibility step, for the doctor's record.
fn step_summary(step: &compat_fixer::FixStep) -> String {
    match step {
        compat_fixer::FixStep::Install { name, version, .. } => format!("Installed {name} {version}"),
        compat_fixer::FixStep::Replace { file_name, version, .. } => {
            format!("Replaced {file_name} with {version}")
        }
        compat_fixer::FixStep::Disable { file_name, .. } => format!("Switched off {file_name}"),
        compat_fixer::FixStep::Unfixable { file_name, .. } => format!("Left {file_name} alone"),
    }
}


/// Everything the fixer needs to know about an instance.
struct CompatFacts {
    instance: GameInstance,
    report: mod_compat::CompatReport,
    provided: Vec<mod_compat::ProvidedMod>,
    required: Vec<mod_compat::ModRequirement>,
    /// File name to where the launcher got it, for files it installed.
    origins: std::collections::BTreeMap<String, content_provenance::ContentOrigin>,
}

/// Reads what the fixer needs to know about an instance: its report, every
/// constraint in its mods folder, and where each file came from.
fn compat_facts(app_data_dir: &Path, instance_id: &str) -> Result<CompatFacts, String> {
    let instance = GameManager::new(app_data_dir.to_path_buf()).get_instance_by_id(instance_id)?;
    let mc = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance".to_string())?;
    let mods_dir = PathBuf::from(&instance.install_path).join("mods");
    let loader = minecraft_loader_name(&mc.loader);
    let report = mod_compat::check_compatibility(
        instance_id,
        &mods_dir,
        &mc.mc_version,
        loader,
        mc.loader_version.as_deref(),
    )?;
    let (provided, required) = mod_compat::requirements(&mods_dir, &mc.mc_version, loader)?;
    // Provenance is keyed "mods/<file>"; the fixer thinks in file names.
    let origins = content_provenance::all(app_data_dir, instance_id)
        .into_iter()
        .filter_map(|(path, origin)| {
            path.strip_prefix("mods/")
                .map(|file| (file.to_string(), origin))
        })
        .collect();
    Ok(CompatFacts {
        instance,
        report,
        provided,
        required,
        origins,
    })
}


/// What became of one step of the plan.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct FixOutcome {
    step: compat_fixer::FixStep,
    ok: bool,
    detail: String,
}


/// Installs one exact release of a Modrinth project into an instance.
async fn install_exact(
    app_data_dir: &Path,
    instance: &GameInstance,
    instance_id: &str,
    project_id: &str,
    version_id: &str,
    api_key: Option<String>,
) -> Result<(), String> {
    let request = dependency_resolver::ResolveDependenciesRequest {
        instance_id: instance_id.to_string(),
        source: dependency_resolver::ModProvider::Modrinth,
        project_id: project_id.to_string(),
        version_id: Some(version_id.to_string()),
        file_id: None,
        author: None,
    };
    dependency_resolver::install_for_instance(app_data_dir, instance, &request, api_key)
        .await
        .map(|_| ())
}

// ---------------------------------------------------------------------------
// Kiza Lockfile
// ---------------------------------------------------------------------------

fn loader_name(loader: &MinecraftLoader) -> &'static str {
    loader.slug()
}

fn locked_runtime(instance: &GameInstance) -> Result<lockfile::LockedRuntime, String> {
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Only Minecraft instances have a lockfile.")?;
    Ok(lockfile::LockedRuntime {
        mc_version: minecraft.mc_version.clone(),
        loader: loader_name(&minecraft.loader).to_string(),
        loader_version: minecraft.loader_version.clone(),
        java_major: minecraft.java_major,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LockfileExport {
    json: String,
    file_count: usize,
    /// Files in this instance that nobody else could fetch, because Kiza never
    /// learned where they came from. Naming them up front is the difference
    /// between a lockfile someone can trust and one that quietly rebuilds a
    /// different instance.
    unreproducible: Vec<String>,
}


#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LockfileApplied {
    /// The snapshot taken before the first write, so this is undoable as one.
    restore_point_id: String,
    installed: Vec<String>,
    failed: Vec<String>,
    /// Locked files nothing knows how to fetch. The instance will not match the
    /// lockfile, and these are the reason.
    unfetchable: Vec<String>,
}


/// Downloads one locked file to the exact path the lockfile names.
async fn install_locked_file(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    client: &reqwest::Client,
    entry: &lockfile::DiffEntry,
) -> Result<(), String> {
    let source = entry
        .source
        .as_ref()
        .ok_or("This file has no recorded source.")?;

    let (url, sha1) = match source.provider.as_str() {
        "modrinth" => {
            let version = modrinth_api::get_version(&source.version_id).await?;
            let file = version
                .files
                .iter()
                .find(|file| file.primary)
                .or_else(|| version.files.first())
                .ok_or("That Modrinth version has no downloadable file.")?;
            (file.url.clone(), Some(file.hashes.sha1.clone()))
        }
        "curseforge" => {
            let key = curseforge_api_key()?;
            let mod_id: u64 = source
                .project_id
                .parse()
                .map_err(|_| "Invalid CurseForge project id.".to_string())?;
            let file_id: u64 = source
                .version_id
                .parse()
                .map_err(|_| "Invalid CurseForge file id.".to_string())?;
            let file = curseforge_api::get_file(&key, mod_id, file_id).await?;
            let url = match file.download_url.as_deref() {
                Some(url) => url.to_string(),
                None => curseforge_api::get_download_url(&key, mod_id, file_id).await?,
            };
            let sha1 = file
                .hashes
                .iter()
                .find(|hash| hash.algo == 1)
                .map(|hash| hash.value.clone());
            (url, sha1)
        }
        other => return Err(format!("Kiza cannot fetch {other} content.")),
    };

    // A lockfile comes from somewhere else, and it names paths. Rather than try
    // to sanitise an arbitrary one, only the three folders that ever hold
    // downloadable content are writable, and the file name still has to survive
    // the same check as any other download.
    const FETCHABLE_FOLDERS: [&str; 3] = ["mods", "resourcepacks", "shaderpacks"];
    let (folder, file_name) = entry
        .path
        .rsplit_once('/')
        .ok_or("That locked path names no folder.")?;
    if !FETCHABLE_FOLDERS.contains(&folder) {
        return Err(format!("Kiza does not download anything into {folder}."));
    }
    let safe_name = path_security::safe_file_name(file_name, &["jar", "zip"])
        .map_err(|error| format!("Invalid locked file name: {error}"))?;
    let destination = game_dir.join(folder).join(&safe_name);

    minecraft_manager::download_to_path(client, &url, &destination, sha1.as_deref()).await?;

    content_provenance::record(
        app_data_dir,
        instance_id,
        &entry.path,
        content_provenance::ContentOrigin {
            provider: source.provider.clone(),
            project_id: source.project_id.clone(),
            version_id: source.version_id.clone(),
            pinned: false,
        },
    )
}

// ---------------------------------------------------------------------------
// World Vault
// ---------------------------------------------------------------------------

fn instance_is_running(app_state: &tauri::State<AppState>, instance_id: &str) -> bool {
    app_state
        .running_games
        .lock()
        .map(|running| running.contains_key(instance_id))
        .unwrap_or(false)
}


// ---------------------------------------------------------------------------
// Performance Advisor
// ---------------------------------------------------------------------------

/// Judges a finished safe-mode test launch, so the player does not have to.
///
/// A hunt that depends on someone interpreting a log correctly reaches the
/// wrong answer. The launcher saw the exit code and whether the game ever
/// reached its menu, so it decides — and the panel still offers both buttons,
/// because the player is the one who can say "it started, but it was broken".
///
/// Does nothing at all when no hunt is running for this instance.
fn record_safe_mode_outcome(
    app_data_dir: &Path,
    instance_id: &str,
    exit_code: Option<i32>,
    reached_menu: Option<bool>,
) {
    let Some(mut session) = safe_mode::load(app_data_dir, instance_id) else {
        return;
    };
    session.record(safe_mode::outcome_of(exit_code, reached_menu));

    let Ok(instance) = GameManager::new(app_data_dir.to_path_buf()).verify_instance(instance_id)
    else {
        return;
    };
    let state = safe_mode_state(&session);
    if let Err(error) = apply_safe_mode_selection(app_data_dir, &instance, &state.enabled) {
        crate::log_warn!("Safe mode", "Could not prepare the next safe mode launch: {error}");
        return;
    }
    let _ = safe_mode::save(app_data_dir, &session);
}

/// Records what a finished run measured. Called from the process watcher, so a
/// run nobody asked to measure simply stores nothing.
fn record_performance_run(app_data_dir: &Path, instance_id: &str, seconds_to_menu: Option<f64>) {
    let gc_log = performance_advisor::gc_log_path(app_data_dir, instance_id);
    let gc = std::fs::read_to_string(&gc_log)
        .ok()
        .map(|raw| performance_advisor::parse_gc_log(&raw))
        .filter(|summary| summary.pauses > 0);

    // Nothing measured, nothing to say.
    if gc.is_none() && seconds_to_menu.is_none() {
        return;
    }

    let (_, xmx_mb) = performance_advisor::parse_heap_args(
        &minecraft_manager::effective_java_args(app_data_dir, instance_id),
    );
    let mod_count = ModManager::new(app_data_dir.to_path_buf())
        .load_mods(instance_id)
        .into_iter()
        .filter(|installed| installed.enabled)
        .count();

    // The Java the run actually used: the instance override when there is one,
    // otherwise what the version JSON declares. Storing a placeholder would make
    // a later comparison look like a Java change that never happened.
    let java_major = GameManager::new(app_data_dir.to_path_buf())
        .verify_instance(instance_id)
        .ok()
        .and_then(|instance| instance.minecraft)
        .and_then(|minecraft| {
            minecraft.java_major.or_else(|| {
                minecraft_manager::declared_java_major(app_data_dir, &minecraft.mc_version)
            })
        })
        .unwrap_or(0);

    let sample = performance_advisor::RunSample {
        id: uuid::Uuid::new_v4().simple().to_string(),
        instance_id: instance_id.to_string(),
        recorded_at: chrono::Utc::now().to_rfc3339(),
        label: String::new(),
        xmx_mb,
        java_major,
        mod_count,
        seconds_to_menu,
        gc,
    };
    let _ = performance_advisor::record_run(app_data_dir, instance_id, sample);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceReport {
    advice: Vec<performance_advisor::Advice>,
    xms_mb: u32,
    xmx_mb: u32,
    total_ram_mb: Option<u32>,
    java_major: u32,
    runs: Vec<performance_advisor::RunSample>,
    /// Only present once two runs measured the same things.
    comparison: Option<performance_advisor::Comparison>,
    measuring_next_launch: bool,
}

/// 21 for "1.21.1". Used only to decide whether a mod exists for this era.
fn minecraft_version_minor(mc_version: &str) -> u32 {
    mc_version
        .split('.')
        .nth(1)
        .and_then(|part| part.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|part| part.parse().ok())
        .unwrap_or(0)
}


/// Changes one memory bound without disturbing the other settings.
///
/// The settings file is written whole, so reading it first is what keeps a
/// custom Java path or extra arguments from being erased by a heap change.
fn set_instance_memory(
    app_data_dir: &Path,
    instance_id: &str,
    min_mb: Option<u32>,
    max_mb: Option<u32>,
) -> Result<(), String> {
    let mut settings = minecraft_manager::load_instance_settings(app_data_dir, instance_id);
    if let Some(mb) = min_mb {
        settings.min_memory_mb = Some(mb);
    }
    if let Some(mb) = max_mb {
        settings.max_memory_mb = Some(mb);
        // A minimum above the new maximum would be clamped back down at launch,
        // silently undoing half of what the user just accepted.
        if settings.min_memory_mb.is_some_and(|min| min > mb) {
            settings.min_memory_mb = Some(mb);
        }
    }
    minecraft_manager::save_instance_settings(app_data_dir, instance_id, settings).map(|_| ())
}


#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct HostedServerView {
    #[serde(flatten)]
    summary: server_host::HostedServerSummary,
    status: server_process::ServerStatus,
}


async fn run_install(
    app_data_dir: &std::path::Path,
    runtime: &Arc<server_process::ServerRuntime>,
    server: &server_host::HostedServer,
    cancel: server_install::Cancel,
) -> Result<server_install::ServerLaunch, String> {
    let reporter = runtime.clone();
    let id = server.id.clone();
    let report: server_install::Report =
        Arc::new(move |progress| reporter.note_install(&id, progress));
    server_install::install(app_data_dir, server, cancel, report).await
}


/// A backup every so many minutes while the server runs, then pruned. The
/// thread ends with the process; a server started again gets a new one.
fn schedule_backups(
    runtime: Arc<server_process::ServerRuntime>,
    server_id: String,
    dir: PathBuf,
    settings: server_host::AutoBackup,
) {
    let every = std::time::Duration::from_secs(u64::from(settings.every_minutes) * 60);
    std::thread::Builder::new()
        .name(format!("kiza-server-backup-{server_id}"))
        .spawn(move || {
            let mut last = std::time::Instant::now();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                if !runtime.is_running(&server_id) {
                    return;
                }
                if last.elapsed() < every {
                    continue;
                }
                // The world on disk is the world in play only after a save.
                let _ = runtime.send(&server_id, "save-all flush");
                std::thread::sleep(std::time::Duration::from_secs(3));
                match server_backup::create(&dir, "automatic") {
                    Ok(_) => {
                        let _ = server_backup::prune_automatic(&dir, settings.keep as usize);
                    }
                    Err(error) => crate::log_warn!("Servers", "Automatic backup of {server_id} failed: {error}"),
                }
                last = std::time::Instant::now();
            }
        })
        .ok();
}


// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------

/// A token good for the profile service, refreshed if it has to be.
async fn minecraft_token(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app_data_dir(app_handle);
    if minecraft_auth::load_auth_state(&app_data_dir).is_none() {
        return Err(
            "Sign in with a Microsoft account (Settings → Accounts) to change your skin."
                .to_string(),
        );
    }
    let client_id = microsoft_client_id()?;
    let state = minecraft_auth::ensure_valid_minecraft_token(app_data_dir, &client_id)
        .await
        .map_err(|error| {
            format!("Saved Minecraft account is unusable: {error}. Reconnect it in Settings → Accounts.")
        })?;
    Ok(state.mc_access_token)
}

/// The bytes a source names. The disk is read off the window thread; the
/// web and the account are awaited.
async fn skin_bytes(
    app_handle: &tauri::AppHandle,
    source: minecraft_skins::SkinSource,
) -> Result<Vec<u8>, String> {
    let app_data_dir = app_data_dir(app_handle);
    match source {
        minecraft_skins::SkinSource::File { path } => {
            off_thread(move || minecraft_skins::read_file(&path)).await
        }
        minecraft_skins::SkinSource::Library { id } => {
            off_thread(move || minecraft_skins::library_read(&app_data_dir, &id)).await
        }
        minecraft_skins::SkinSource::Url { .. } => {
            minecraft_skins::resolve(&app_data_dir, None, &source).await
        }
        minecraft_skins::SkinSource::Current => {
            let token = minecraft_token(app_handle).await?;
            minecraft_skins::resolve(&app_data_dir, Some(&token), &source).await
        }
    }
}

/// The account's profile again, after the service changed it, so the head
/// in the corner and the name follow. Quiet on failure: the skin is on.
async fn note_profile_change(app_handle: &tauri::AppHandle) {
    if let Ok(client_id) = microsoft_client_id() {
        let _ = minecraft_auth::refresh_profile(app_data_dir(app_handle), &client_id).await;
    }
}


/// The server stopped: its name is parked until the next start. Quiet on
/// failure — the record has a sixty-second TTL either way.
fn park_kiza_address(app_handle: &tauri::AppHandle, server: &server_host::HostedServer) {
    let Some(address) = server.kiza_address.clone() else {
        return;
    };
    let Some(origin) = service_origin(app_handle) else {
        return;
    };
    let app_data_dir = app_data_dir(app_handle);
    tauri::async_runtime::spawn(async move {
        let headers = access::headers(&app_data_dir);
        let _ = server_network::park_kiza_address(&origin, headers, &address.name).await;
    });
}

/// A server that holds a name asks for it again on every start, so the
/// records follow whatever address this connection has today. Quiet on
/// failure: the name is unchanged and the Overview still shows it.
fn refresh_kiza_address(app_handle: &tauri::AppHandle, server: &server_host::HostedServer) {
    let Some(address) = server.kiza_address.clone() else {
        return;
    };
    let Some(origin) = service_origin(app_handle) else {
        return;
    };
    let app_data_dir = app_data_dir(app_handle);
    let server_id = server.id.clone();
    let dir = server_host::server_dir(&app_data_dir, &server_id);
    tauri::async_runtime::spawn(async move {
        let port = server_properties::read(&dir).port();
        let headers = access::headers(&app_data_dir);
        if let Ok(claimed) =
            server_network::claim_kiza_address(&origin, headers, &address.name, port).await
        {
            let _ = server_host::set_kiza_address(&app_data_dir, &server_id, Some(claimed));
        }
    });
}


#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct ServerPropertiesView {
    entries: Vec<(String, String)>,
    known: Vec<server_properties::KnownProperty>,
}


/// Runs work that touches the disk off the thread that draws the window.
///
/// A synchronous `#[tauri::command]` runs on the main thread, so anything that
/// walks a directory tree freezes the interface for exactly as long as it
/// takes. Measured on a small install, the storage page alone blocked for
/// **1.55 seconds** — and that install held 1.8 GB. Someone with fifty
/// gigabytes of instances would watch the window stop responding.
async fn off_thread<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("The task stopped unexpectedly: {error}"))?
}

/// Commands that must never run on the thread that draws the window.
///
/// A `#[tauri::command]` without `async` is executed on the main thread, which
/// on Windows is the thread pumping the window's message loop. Anything on this
/// list touches the disk or the credential store, and the settings dialogue
/// calls all of them — which is why the settings pages froze, and why a
/// debounce in the interface only reduced how often it happened.
///
/// Checked by reading this very file, because the mistake is a missing keyword
/// and no type signature catches it.
#[cfg(test)]
const MUST_NOT_BLOCK_THE_WINDOW: [&str; 11] = [
    "get_app_config",
    "save_app_config",
    "reset_app_config",
    "get_api_connections",
    "detect_minecraft_runtime",
    "get_first_run_setup",
    "storage_usage",
    "system_report",
    "logs_overview",
    "list_java_runtimes",
    "notification_readiness",
];

/// Commands that were already running on the window thread when the guard
/// below was written.
///
/// Not an approval list. Each name is a command that hashes, walks a
/// directory or reads the disk on the thread pumping the window's message
/// loop, and every one of them is a hitch waiting for a slow disk. They are
/// written down so the guard can tell an old problem from a new one: the
/// test fails on any synchronous command that is not here, which is what
/// makes it catch the next mistake instead of the last one.
///
/// The correct edit to this list is a deletion.
#[cfg(test)]
const ALREADY_ON_THE_WINDOW_THREAD: [&str; 99] = [
    "add_game_instance",
    "cancel_download",
    "check_mod_compatibility",
    "clear_instance_cover",
    "complete_first_run_setup",
    "content_forget_origin",
    "content_origin",
    "content_origins",
    "content_set_pinned",
    "create_profile",
    "delete_minecraft_content",
    "delete_minecraft_instance_cmd",
    "delete_mod",
    "delete_profile",
    "delete_residual_files",
    "delete_shaderpack",
    "diagnose_instance_crash",
    "dismiss_launch_status",
    "download_concurrency_range",
    "downloads_paused",
    "get_active_profile_id",
    "get_conflicts",
    "get_downloads",
    "get_installed_mods",
    "get_instance_performance_profile",
    "get_instance_settings",
    "get_launch_status",
    "get_minecraft_install_status",
    "get_mod_path",
    "get_running_minecraft_instances",
    "import_minecraft_content",
    "import_shaderpack",
    "instance_cover",
    "instance_play_history",
    "is_iris_installed",
    "list_game_instances",
    "list_minecraft_content",
    "list_minecraft_worlds",
    "list_profiles",
    "list_shaderpacks",
    "lockfile_diff",
    "lockfile_export",
    "lockfile_read",
    "lockfile_save",
    "minecraft_auth_get_account",
    "minecraft_auth_list_accounts",
    "minecraft_auth_logout",
    "minecraft_auth_remove_account",
    "minecraft_auth_set_active",
    "offline_account_create",
    "offline_account_delete",
    "offline_account_import_skin",
    "offline_account_rename",
    "offline_accounts_list",
    "open_console_window",
    "open_instance_folder",
    "open_kiza_folder",
    "open_minecraft_content_folder",
    "open_mod_folder",
    "open_shaderpacks_folder",
    "pause_download",
    "performance_apply_advice",
    "performance_measure_next_launch",
    "performance_report",
    "read_instance_log",
    "remove_api_connection",
    "rename_minecraft_instance_cmd",
    "restore_point_apply",
    "restore_point_create",
    "restore_points_list",
    "restore_points_prune",
    "restore_points_stored_bytes",
    "resume_download",
    "return_to_launcher",
    "safe_mode_record",
    "safe_mode_start",
    "safe_mode_status",
    "safe_mode_stop",
    "save_first_run_setup",
    "save_instance_performance_profile",
    "save_instance_settings",
    "scan_directory",
    "scan_residuals",
    "send_notification",
    "send_test_notification",
    "set_downloads_paused",
    "set_instance_cover",
    "set_minecraft_instance_java_cmd",
    "set_minecraft_instance_version_cmd",
    "start_download",
    "stop_minecraft_instance",
    "support_cooldown_seconds",
    "update_discord_status",
    "world_vault_backup",
    "world_vault_checkpoints",
    "world_vault_delete",
    "world_vault_prune",
    "world_vault_restore",
    "world_vault_worlds",
];

#[cfg(test)]
mod update_handshake_tests {
    use super::QUIT_FOR_UPDATE_ARG;

    /// The installer and the launcher agree on one string, and it lives in two
    /// crates because an installer should not depend on the thing it installs.
    ///
    /// If either side renames it, nothing fails to compile: the installer asks
    /// a launcher that does not answer, gives up, and the update goes back to
    /// leaving the old build in place until the next restart — which is the
    /// exact failure this handshake was written to end.
    #[test]
    fn the_installer_asks_with_the_argument_the_launcher_answers_to() {
        let installer = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../kiza-setup/src-tauri/src/running.rs"
        ))
        .expect("the installer's running.rs should be readable");

        let declaration =
            format!("pub const QUIT_FOR_UPDATE_ARG: &str = \"{QUIT_FOR_UPDATE_ARG}\";");
        assert!(
            installer.contains(&declaration),
            "the installer does not declare {QUIT_FOR_UPDATE_ARG}"
        );
    }
}

#[cfg(test)]
mod main_thread_tests {
    use super::{ALREADY_ON_THE_WINDOW_THREAD, MUST_NOT_BLOCK_THE_WINDOW};
    use std::collections::BTreeSet;

    /// The crate root and every command module: a command lives in one of
    /// these, and a guard that read only the root would have stopped
    /// guarding the day they were moved out.
    fn all_sources() -> String {
        [
            include_str!("lib.rs"),
            include_str!("commands/accounts.rs"),
            include_str!("commands/content.rs"),
            include_str!("commands/instances.rs"),
            include_str!("commands/launch.rs"),
            include_str!("commands/mods.rs"),
            include_str!("commands/servers.rs"),
            include_str!("commands/settings.rs"),
        ]
        .join("
")
    }

    /// Every `#[tauri::command]` in this file, and whether it is `async`.
    ///
    /// Read out of the source because the mistake is a missing keyword: no type
    /// signature, lint or macro catches it.
    fn commands(source: &str) -> Vec<(String, bool)> {
        let mut found = Vec::new();
        let mut rest = source;
        while let Some(at) = rest.find("#[tauri::command") {
            rest = &rest[at + "#[tauri::command".len()..];
            let Some(end) = rest.find(']') else { break };
            let after = &rest[end + 1..];
            let head: String = after.chars().take(96).collect();
            let Some(fn_at) = head.find("fn ") else {
                continue;
            };
            let name: String = head[fn_at + 3..]
                .chars()
                .take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_')
                .collect();
            if name.is_empty() {
                continue;
            }
            found.push((name, head[..fn_at].contains("async ")));
        }
        found
    }

    #[test]
    fn the_settings_commands_do_not_run_on_the_window_thread() {
        let source = all_sources();
        let commands = commands(&source);

        for name in MUST_NOT_BLOCK_THE_WINDOW {
            let (_, is_async) = commands
                .iter()
                .find(|(found, _)| found == name)
                .unwrap_or_else(|| panic!("{name} is not declared in lib.rs"));
            assert!(
                is_async,
                "{name} is synchronous, so it runs on the thread that draws the window"
            );
        }
    }

    /// The guard used to be a list of eleven names somebody had to remember to
    /// extend, so it only ever protected the past: a command added afterwards
    /// blocked the window thread and nothing said so.
    ///
    /// This reads the file instead. Every synchronous command must already be
    /// in the ledger below, so a new one fails here on the day it is written.
    /// The ledger records debt, not permission — it may shrink, never grow.
    #[test]
    fn no_new_command_is_added_on_the_window_thread() {
        let source = all_sources();
        let ledger: BTreeSet<&str> = ALREADY_ON_THE_WINDOW_THREAD.iter().copied().collect();

        let unlisted: Vec<String> = commands(&source)
            .into_iter()
            .filter(|(name, is_async)| !is_async && !ledger.contains(name.as_str()))
            .map(|(name, _)| name)
            .collect();

        assert!(
            unlisted.is_empty(),
            "these commands are synchronous, so they run on the thread that draws the window: {}
             Add `async` and wrap the body in `off_thread(..)`. Only add a name to              ALREADY_ON_THE_WINDOW_THREAD if you are recording pre-existing debt.",
            unlisted.join(", ")
        );
    }

    #[test]
    fn the_ledger_only_lists_commands_that_still_exist() {
        let source = all_sources();
        let synchronous: BTreeSet<String> = commands(&source)
            .into_iter()
            .filter(|(_, is_async)| !is_async)
            .map(|(name, _)| name)
            .collect();

        let stale: Vec<&str> = ALREADY_ON_THE_WINDOW_THREAD
            .iter()
            .copied()
            .filter(|name| !synchronous.contains(*name))
            .collect();

        assert!(
            stale.is_empty(),
            "these are no longer synchronous commands; delete them from the ledger: {}",
            stale.join(", ")
        );
    }
}


/// One service, whether it answered, and how long it took.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct ServiceCheck {
    pub id: String,
    pub label: String,
    pub reachable: bool,
    /// Round trip in milliseconds, when there was one.
    pub latency_ms: Option<u64>,
    /// Why it is not usable, when the server answered but refused.
    pub detail: Option<String>,
}

/// Times one request and reports what happened.
///
/// A HEAD would be lighter, but several of these endpoints answer HEAD with a
/// 405 while being perfectly reachable, which would put a red light next to a
/// service that is up.
///
/// A refusal is not reachability. This used to ask only whether the request
/// completed, so a service answering 401 or 403 on every call was drawn green
/// with a latency beside it, and the page said everything was fine while
/// nothing worked.
async fn timed_probe(id: &str, label: &str, url: &str) -> ServiceCheck {
    let started = std::time::Instant::now();
    let built = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build();

    let (reachable, detail) = match built {
        Ok(client) => match client.get(url).send().await {
            Ok(response) if response.status().is_success() => (true, None),
            Ok(response) => (
                false,
                Some(format!("The service answered HTTP {}.", response.status())),
            ),
            Err(error) => (false, Some(network_reason(&error))),
        },
        Err(error) => (false, Some(error.to_string())),
    };

    ServiceCheck {
        id: id.to_string(),
        label: label.to_string(),
        reachable,
        latency_ms: Some(started.elapsed().as_millis() as u64),
        detail,
    }
}

fn network_reason(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "No answer within eight seconds.".to_string()
    } else if error.is_connect() {
        "Could not connect; check the network or a firewall.".to_string()
    } else {
        error.to_string()
    }
}

/// CurseForge, asked the way Kiza actually uses it.
///
/// An unauthenticated call to `/v1/games` is refused whatever the key is, so
/// probing that URL told us nothing about whether this build can search. This
/// sends the key Kiza would send, which is the question worth asking.
async fn curseforge_probe() -> ServiceCheck {
    let started = std::time::Instant::now();
    let (reachable, detail) = match curseforge_api_key() {
        Err(_) => (
            false,
            Some("No CurseForge key is configured in this build.".to_string()),
        ),
        Ok(key) => match curseforge_api::key_is_accepted(&key).await {
            Ok(()) => (true, None),
            Err(reason) => (false, Some(reason)),
        },
    };

    ServiceCheck {
        id: "curseforge".to_string(),
        label: "CurseForge".to_string(),
        reachable,
        latency_ms: Some(started.elapsed().as_millis() as u64),
        detail,
    }
}

/// Every service Kiza depends on, checked at once.
///
/// Run concurrently: four checks one after another take as long as the slowest
/// four added together, and a diagnostic panel that needs half a minute is one
/// people stop pressing.
async fn check_services_inner() -> Vec<ServiceCheck> {
    let (microsoft, mojang, modrinth, curseforge) = tokio::join!(
        timed_probe(
            "microsoft",
            "Microsoft Auth",
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
        ),
        timed_probe(
            "mojang",
            "Mojang Services",
            "https://api.minecraftservices.com/"
        ),
        timed_probe(
            "modrinth",
            "Modrinth",
            "https://api.modrinth.com/v2/tag/loader"
        ),
        curseforge_probe(),
    );
    vec![microsoft, mojang, modrinth, curseforge]
}


/// Writes a diagnostic report and reveals it in Explorer.
///
/// A file rather than a clipboard copy: the report carries the tail of the last
/// log, which is more than anyone wants pasted into a chat box by accident, and
/// a file can be dragged into a message as an attachment.
///
/// Returns the path so the interface can name it.
/// The diagnostic report as text.
///
/// Shared by the button that writes it to a file and the problem report that
/// attaches it, so the two can never come to describe the machine differently.
async fn diagnostic_facts(app_handle: &tauri::AppHandle) -> Result<diagnostics::Facts, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    let version = app_handle.package_info().version.to_string();
    let instances = GameManager::new(app_data_dir.clone())
        .list_instances()
        .len();
    let services: Vec<(String, Option<u64>)> = check_services_inner()
        .await
        .into_iter()
        .map(|check| (check.label, check.latency_ms))
        .collect();

    off_thread(move || {
        let config = ConfigManager::new(app_data_dir.clone()).load_config();
        let logs_dir = app_data_dir.join("logs");

        Ok(diagnostics::Facts {
            version,
            channel: config.update_channel.clone(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            logs: diagnostics::overview(&logs_dir),
            storage_total_bytes: storage_report::report(&app_data_dir).total_bytes,
            instances,
            java_path: config.minecraft_java_path.clone(),
            install_id: system_report::short_id(&system_report::install_id(&app_data_dir)),
            services,
            recent_log: diagnostics::tail_of_newest(&logs_dir, 80),
            app_data_dir: app_data_dir.clone(),
        })
    })
    .await
}

/// The report as text, for the file and the attachment.
async fn diagnostic_text(app_handle: &tauri::AppHandle) -> Result<String, String> {
    Ok(diagnostics::render(&diagnostic_facts(app_handle).await?))
}

/// The same facts, in the short forms a triage card shows without scrolling.
fn triage_facts(
    facts: &diagnostics::Facts,
    system: &system_report::SystemReport,
) -> support::Facts {
    let disk = facts
        .app_data_dir
        .parent()
        .map(|_| ())
        .and(system.disk.as_ref())
        .map(|disk| format!(", {:.0} GB free", disk.free_bytes as f64 / 1024f64.powi(3)))
        .unwrap_or_default();

    support::Facts {
        // ASCII separators on purpose. These strings cross a shell, a JSON
        // body and Discord's renderer before anyone reads them, and a middle
        // dot came back from that journey as a replacement character.
        system: format!(
            "{} {}, {}, {:.0} GB RAM{}",
            system.os,
            system.os_version,
            system.arch,
            system.total_ram_mb as f64 / 1024.0,
            disk
        ),
        java: facts
            .java_path
            .clone()
            .unwrap_or_else(|| "managed by Kiza".to_string()),
        instances: facts.instances as u32,
        services: facts
            .services
            .iter()
            .map(|(name, latency)| match latency {
                Some(ms) => format!("{name} {ms} ms"),
                None => format!("{name} no answer"),
            })
            .collect::<Vec<_>>()
            .join(", "),
        log_tail: facts
            .recent_log
            .as_deref()
            .map(support::log_tail)
            .unwrap_or_default(),
    }
}


/// Where problem reports go.
///
/// Derived from the update endpoint rather than configured separately: they are
/// the same service, and two addresses to keep in step would eventually not be.
fn support_endpoint(app_handle: &tauri::AppHandle) -> Option<String> {
    let endpoints = app_handle
        .config()
        .plugins
        .0
        .get("updater")?
        .get("endpoints")?
        .as_array()?;

    for endpoint in endpoints {
        let url = endpoint.as_str()?;
        // The GitHub fallback serves release files and nothing else; only
        // Kiza's own service can take a report.
        if let Some(base) = url.split("/v1/").next() {
            if base != url {
                return Some(format!("{base}/v1/support"));
            }
        }
    }
    None
}

/// The update service's own address, without the path.
///
/// Read from the same configuration the updater uses, so there is one place
/// that says where Kiza's service is. The GitHub fallback serves files and
/// nothing else, so it is skipped: only Kiza's own service knows anything
/// about who may have what.
fn service_origin(app_handle: &tauri::AppHandle) -> Option<String> {
    let endpoints = app_handle
        .config()
        .plugins
        .0
        .get("updater")?
        .get("endpoints")?
        .as_array()?;

    for endpoint in endpoints {
        let url = endpoint.as_str()?;
        if let Some(base) = url.split("/v1/").next() {
            if base != url {
                return Some(base.to_string());
            }
        }
    }
    None
}


#[derive(serde::Serialize)]
pub struct UpdateRefusal {
    /// The channel that was asked for, which is usually the surprise.
    pub channel: String,
    /// The service's machine-readable word for why: "needs-installer",
    /// "not-granted", "expired", "another-machine", "not-released".
    pub reason: Option<String>,
    /// And its sentence, which is the part worth showing.
    pub message: Option<String>,
}


/// Posts a prepared ticket and returns the reference the service gave back.
async fn post_ticket(
    endpoint: &str,
    payload: &support::TicketPayload,
) -> Result<support::TicketSent, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not prepare the request: {error}"))?;

    let response = client
        .post(endpoint)
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("The report could not be sent: {error}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        // The service says why in the body; passing its own words through beats
        // inventing a friendlier sentence that hides which of several things
        // went wrong.
        let reason = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("error")?.as_str().map(str::to_string))
            .unwrap_or_else(|| format!("The service answered {status}."));
        return Err(reason);
    }

    let reference = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("reference")?.as_str().map(str::to_string))
        .unwrap_or_else(|| "sent".to_string());
    Ok(support::TicketSent { reference })
}

/// What a crash report for this instance would say, before it is sent.
///
/// Read from the last launch: the record, the doctor's findings, the
/// captured log's counts and the line the game went down on.
async fn crash_report_for(
    app_handle: &tauri::AppHandle,
    instance_id: &str,
) -> Result<crash_telemetry::CrashReport, String> {
    let app_data_dir = app_data_dir(app_handle);
    let status = app_handle
        .try_state::<AppState>()
        .map(|state| state.launch_manager.get(instance_id));
    let exit_code = status.and_then(|status| status.exit_code);
    let id = instance_id.to_string();
    off_thread(move || {
        let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &id);
        let findings = crash_doctor::analyse_instance(&game_dir);
        let record = minecraft_manager::read_launch_record(&app_data_dir, &id);
        let log = crash_doctor::collect_crash_sources(&game_dir);
        let mut warnings = 0;
        let mut errors = 0;
        let mut fatal: Option<String> = None;
        for line in log.lines() {
            if line.contains("/WARN]") {
                warnings += 1;
            }
            if line.contains("/ERROR]") || line.contains("/FATAL]") {
                errors += 1;
            }
            if fatal.is_none()
                && (line.contains("---- Minecraft Crash Report ----")
                    || line.contains("Exception in thread \"main\"")
                    || line.contains("A fatal error has been detected")
                    || line.contains("java.lang.OutOfMemoryError")
                    || line.contains("in java.library.path"))
            {
                fatal = Some(line.to_string());
            }
        }
        let fingerprint = crash_telemetry::fingerprint(&findings, fatal.as_deref());
        let draft = crash_telemetry::describe(
            record.as_ref(),
            &findings,
            fatal.as_deref(),
            warnings,
            errors,
            exit_code,
        );
        let already_sent = crash_telemetry::sent_recently(
            &app_data_dir,
            &fingerprint,
            std::time::SystemTime::now(),
        );
        Ok(crash_telemetry::CrashReport {
            fingerprint,
            draft,
            already_sent,
        })
    })
    .await
}


/// The sending itself, shared by the button and the watcher.
async fn send_crash_report(
    app_handle: &tauri::AppHandle,
    instance_id: &str,
) -> Result<support::TicketSent, String> {
    let app_data_dir = app_data_dir(app_handle);
    let report = crash_report_for(app_handle, instance_id).await?;
    if report.already_sent {
        return Ok(support::TicketSent {
            reference: "already sent today".to_string(),
        });
    }
    let endpoint = support_endpoint(app_handle)
        .ok_or_else(|| "This build has no support service to report to.".to_string())?;
    let payload = commands::settings::support_preview(app_handle.clone(), report.draft).await?;
    let sent = post_ticket(&endpoint, &payload).await?;
    crash_telemetry::record_sent(&app_data_dir, &report.fingerprint, std::time::SystemTime::now());
    crate::log_info!("Crash reports", "Sent crash {} as {}.", report.fingerprint, sent.reference);
    Ok(sent)
}


#[cfg(test)]
mod launch_order_tests {
    /// The watcher has to be started before anything opens a window.
    ///
    /// This is an ordering, so nothing in the type system holds it: both
    /// arrangements compile, and the wrong one only shows itself on somebody
    /// else's computer, days later, as a launcher insisting a closed game is
    /// still running.
    ///
    /// Opening the log window builds a webview, which is a call into the
    /// platform's UI thread. When that call did not come back, neither did
    /// anything after it — and what came after it was the watcher. The game
    /// exited, nothing was following it, and the instance stayed "In game"
    /// with the only way out being a restart of the launcher.
    ///
    /// Read out of the source because the two statements are ordinary lines in
    /// a long function; there is no signature to check and no lint that fires.
    #[test]
    fn the_game_is_watched_before_any_window_is_opened() {
        // The launch command lives with the other launch commands now.
        let source = include_str!("commands/launch.rs");

        let watcher = source
            .find("tauri::async_runtime::spawn_blocking(move || {")
            .expect("the launch watcher should still be spawned");
        let window = source
            .find("let _ = open_console_window(app_handle.clone(), console_instance_id);")
            .expect("the launch path should still offer to open the log window");

        assert!(
            watcher < window,
            "the process watcher must be started before the log window is opened: \
             a window that never finishes building must not be able to stop the \
             launcher from noticing the game exited",
        );
    }
}
