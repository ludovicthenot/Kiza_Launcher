mod app_error;
mod base_mod;
mod config_manager;
mod content_manager;
mod content_provenance;
mod crash_doctor;
mod credential_store;
mod curseforge_api;
mod dependency_resolver;
mod diagnostics;
mod discord_rpc;
mod download_manager;
mod edition;
mod forge;
mod game_manager;
mod instance_art;
mod instance_export;
mod instance_import;
mod instance_lock;
mod kizatheme;
mod lockfile;
mod minecraft_auth;
mod minecraft_manager;
mod missing_dependency;
mod mod_compat;
mod mod_manager;
mod modrinth_api;
mod nbt;
mod nexus_api;
mod offline_accounts;
mod optifine;
mod path_security;
mod performance_advisor;
mod provenance_backfill;
mod restore_points;
mod safe_mode;
mod server_hub;
mod setup_manager;
mod startup;
mod storage_report;
mod support;
mod system_report;
mod update_center;
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
use nexus_api::NexusClient;
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
    /// Where an import has got to, read by the window while it waits.
    ///
    /// Polled rather than pushed, like every other progress in this launcher.
    /// A pack of thirty mods is a minute of downloading, and it used to be a
    /// minute of a spinner that could not say whether anything was happening.
    pub import_progress: Arc<std::sync::Mutex<Option<ImportProgress>>>,
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
            files: m.files,
        }
    }
}

fn find_game_executable(_dir: &Path, _depth: u32) -> Option<(String, PathBuf, String)> {
    None
}

#[tauri::command]
fn scan_directory(path: String) -> Option<GameInfo> {
    let dir_path = Path::new(&path);
    if !dir_path.exists() || !dir_path.is_dir() {
        return None;
    }

    find_game_executable(dir_path, 0).map(|(game_id, exe_path, checksum)| GameInfo {
        id: game_id,
        title: "Minecraft".to_string(),
        executable_path: exe_path.to_string_lossy().to_string(),
        version: "Detected".to_string(),
        is_supported: true,
        checksum,
    })
}

#[tauri::command]
fn get_installed_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<ModInfo>, AppError> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|error| {
        AppError::config(error.to_string(), "Restart the launcher, then retry.")
    })?;
    let manager = ModManager::new(app_data_dir);

    let deployed_counts = manager
        .deployed_file_counts(&instance_id)
        .map_err(|error| {
            AppError::new(
                "mod_manifest_invalid",
                error,
                true,
                Some("Run instance repair, then refresh the mod list."),
            )
        })?;
    let mods = manager.load_mods(&instance_id);
    Ok(mods
        .into_iter()
        .map(|mod_info| {
            let deployed_file_count = deployed_counts.get(&mod_info.id).copied().unwrap_or(0);
            let mut info = ModInfo::from(mod_info);
            info.deployed_file_count = deployed_file_count;
            info
        })
        .collect())
}

#[tauri::command]
async fn install_mod(
    app_handle: tauri::AppHandle,
    instance_id: String,
    archive_path: String,
) -> Result<ModInfo, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir.clone());

    // Verify instance validity (Invariant: Cannot install to invalid instance)
    let game_manager = GameManager::new(app_data_dir);
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err("Cannot install mod: Instance is not valid".to_string());
    }

    let new_mod = manager.install_mod(&instance_id, &archive_path)?;
    Ok(ModInfo::from(new_mod))
}

#[tauri::command]
async fn toggle_mod(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: String,
    enabled: bool,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);

    manager.toggle_mod(&instance_id, &mod_id, enabled)
}

#[tauri::command]
async fn deploy_mods(
    app_handle: tauri::AppHandle,
    game_id: String,
    instance_id: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // 1. Verify Instance Status
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;

    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err(format!(
            "Cannot deploy to invalid instance. Status: {:?}",
            instance.status
        ));
    }

    if instance.game_id != game_id {
        return Err("Game ID mismatch between request and instance configuration".to_string());
    }

    // 2. Deploy
    let mod_manager = ModManager::new(app_data_dir);
    let count = mod_manager.deploy(&instance_id, &game_id, &instance.install_path)?;
    Ok(format!("Deployed {} files for {}", count, game_id))
}

#[tauri::command]
async fn verify_mods(
    app_handle: tauri::AppHandle,
    _game_id: String,
    instance_id: String,
) -> Result<mod_manager::VerifyResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // 1. Verify Instance
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;

    // We allow verification on read-only instances, but warn if missing path
    if instance.status == game_manager::GameInstanceStatus::MissingPath {
        return Err("Cannot verify mods: Game folder missing".to_string());
    }

    // 2. Verify Mods
    let mod_manager = ModManager::new(app_data_dir);
    // Safety check: Does manifest exist?
    // verify_state handles missing manifest gracefully (returns OK/Empty), which is correct for fresh installs.
    Ok(mod_manager.verify_state(&instance_id, &instance.install_path))
}

#[tauri::command]
async fn repair_mods(
    app_handle: tauri::AppHandle,
    game_id: String,
    instance_id: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // 1. Verify Instance (Strict)
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;

    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err(format!(
            "Cannot repair mods on invalid instance. Status: {:?}",
            instance.status
        ));
    }

    if instance.game_id != game_id {
        return Err("Game ID mismatch between request and instance configuration".to_string());
    }

    // 2. Repair
    let mod_manager = ModManager::new(app_data_dir);
    mod_manager.repair_state(&instance_id, &instance.install_path, &game_id)
}

#[tauri::command]
async fn undeploy_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;

    let mod_manager = ModManager::new(app_data_dir);
    mod_manager.undeploy(&instance_id, &instance.install_path)
}

#[tauri::command]
async fn refresh_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<ModInfo>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);

    let mods = manager.refresh_mods_from_disk(&instance_id)?;
    Ok(mods.into_iter().map(ModInfo::from).collect())
}

#[tauri::command]
fn add_game_instance(
    app_handle: tauri::AppHandle,
    install_path: String,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = GameManager::new(app_data_dir);
    manager.add_game_instance(&install_path)
}

#[tauri::command]
fn list_game_instances(app_handle: tauri::AppHandle) -> Vec<GameInstanceSummary> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let game_manager = GameManager::new(app_data_dir.clone());
    let mod_manager = ModManager::new(app_data_dir);

    let instances = game_manager.list_instances();

    instances
        .into_iter()
        .map(|instance| {
            let active_profile_id = mod_manager.get_active_profile_id(&instance.id);
            let mods = mod_manager.load_mods(&instance.id);
            let mod_count = mods.len();

            GameInstanceSummary {
                instance,
                active_profile_id,
                mod_count,
            }
        })
        .collect()
}

/// Reads the client runtime report for one instance.
///
/// Asynchronous on purpose: answering this hashes the deployed jar, which is
/// 2.6 MB, and the interface asks again on a timer. On the window thread that
/// is the settings freeze all over again, on a schedule.
#[tauri::command]
async fn get_kiza_client_support(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<base_mod::KizaClientSupport, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the Kiza Launcher data directory: {error}"))?;
    // Whether the game is up decides whether the report is the present tense or
    // a record of the last launch, and it is read here because only the running
    // set knows.
    let running = app_handle
        .state::<AppState>()
        .running_games
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains_key(&instance_id);
    off_thread(move || {
        let manager = GameManager::new(app_data_dir.clone());
        let instance = manager.get_instance_by_id(&instance_id)?;
        Ok(base_mod::support_for(&instance, &app_data_dir, running))
    })
    .await
}

#[tauri::command]
async fn verify_game_instance(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = GameManager::new(app_data_dir);
    manager.verify_instance(&instance_id)
}

#[tauri::command]
fn create_profile(
    app_handle: tauri::AppHandle,
    instance_id: String,
    name: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    manager.create_profile(&instance_id, &name)
}

#[tauri::command]
async fn switch_profile(
    app_handle: tauri::AppHandle,
    instance_id: String,
    profile_id: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir.clone());

    // Invariant: Instance must be valid to switch profile (as it might trigger state changes)
    let game_manager = GameManager::new(app_data_dir);
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err("Cannot switch profile: Instance is not valid".to_string());
    }

    manager.switch_profile(&instance_id, &profile_id)
}

#[tauri::command]
fn list_profiles(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<mod_manager::ProfileConfig, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    manager.list_profiles(&instance_id)
}

#[tauri::command]
fn delete_profile(
    app_handle: tauri::AppHandle,
    instance_id: String,
    profile_id: String,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    manager.delete_profile(&instance_id, &profile_id)
}

#[tauri::command]
fn get_active_profile_id(app_handle: tauri::AppHandle, instance_id: String) -> Option<String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    manager.get_active_profile_id(&instance_id)
}

#[tauri::command]
fn get_conflicts(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> HashMap<String, Vec<String>> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    manager.get_conflicts(&instance_id)
}

#[tauri::command]
fn delete_mod(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<AppState>,
    instance_id: String,
    mod_id: String,
) -> Result<DeleteModResult, AppError> {
    let is_running = app_state
        .running_games
        .lock()
        .map_err(|_| {
            AppError::new(
                "instance_state_unavailable",
                "The launcher could not verify whether this instance is running.",
                true,
                Some("Retry in a moment."),
            )
        })?
        .contains_key(&instance_id);
    if is_running {
        return Err(AppError::new(
            "instance_running",
            "This mod cannot be deleted while Minecraft is running.",
            true,
            Some("Stop the instance, then retry."),
        ));
    }

    let app_data_dir = app_handle.path().app_data_dir().map_err(|error| {
        AppError::config(error.to_string(), "Restart the launcher, then retry.")
    })?;
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager
        .verify_instance(&instance_id)
        .map_err(|error| {
            AppError::new(
                "instance_not_found",
                error,
                true,
                Some("Refresh the instance list, then retry."),
            )
        })?;
    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err(AppError::new(
            "instance_not_writable",
            format!(
                "The instance is not writable. Current status: {:?}.",
                instance.status
            ),
            true,
            Some("Repair or relocate the instance, then retry."),
        ));
    }

    let manager = ModManager::new(app_data_dir.clone());
    dependency_resolver::delete_managed_mod(&app_data_dir, &manager, &instance, &mod_id)
}

#[tauri::command]
fn get_mod_path(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    manager.get_mod_path(&instance_id, &mod_id)
}

// Opens the mod folder from the Rust side: the webview-side opener API is
// ACL-scoped to URLs only, which made the "open mod folder" button fail with
// a permission error.
#[tauri::command]
fn open_mod_folder(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: String,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    let path = manager.get_mod_path(&instance_id, &mod_id)?;
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn scan_residuals(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<String>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;

    let mod_manager = ModManager::new(app_data_dir);
    mod_manager.scan_residuals(&instance_id, &instance.install_path)
}

#[tauri::command]
fn delete_residual_files(
    app_handle: tauri::AppHandle,
    instance_id: String,
    files: Vec<String>,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;

    let mod_manager = ModManager::new(app_data_dir);
    mod_manager.delete_files(&instance_id, &instance.install_path, files)
}

/// Reads the settings file.
///
/// `async` for the same reason the storage report is: a synchronous
/// `#[tauri::command]` runs on the main thread, and on Windows the main thread
/// is the one pumping the window's message loop. Reading and parsing a file
/// there stops the launcher from drawing for as long as the disk takes to
/// answer — which, with an antivirus watching the folder, is not a rounding
/// error.
#[tauri::command]
async fn get_app_config(app_handle: tauri::AppHandle) -> AppConfig {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    off_thread(move || Ok(ConfigManager::new(app_data_dir).load_config()))
        .await
        .unwrap_or_default()
}

/// Writes the settings file, and applies the settings that have a live effect.
///
/// This is the command the settings pages call, and it used to be synchronous —
/// which on Windows means it ran on the thread that draws the window. It writes
/// a file and, when a Nexus key is present, talks to the Windows credential
/// store; doing either between two frames is what made the settings dialogue
/// stutter on every switch and lock solid on a slider drag. The debounce in
/// front of it reduced how often that happened without changing what happened.
///
/// The in-memory side effects stay on this side of the thread hop because they
/// are three atomic stores and a channel send, and they must have taken effect
/// by the time the call returns.
#[tauri::command]
async fn save_app_config(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    config: AppConfig,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // Applied to the live queue, not only written to the file: a limit that
    // waited for the next launch would look like a setting that does nothing.
    app_state
        .download_manager
        .set_concurrency(config.download_concurrency as usize);
    app_state
        .download_manager
        .set_max_attempts(config.download_attempts);

    // Side Effect: Toggle Discord RPC based on new config
    if config.enable_discord_rpc {
        app_state.discord_manager.connect();
    } else {
        app_state.discord_manager.disconnect();
    }

    off_thread(move || {
        let mut config_to_save = config;
        if let Some(api_key) = config_to_save.nexus_api_key.take() {
            if !api_key.trim().is_empty() {
                credential_store::set_secret(credential_store::NEXUS_API_KEY, &api_key)
                    .map_err(|e| e.message)?;
            }
        }
        ConfigManager::new(app_data_dir).save_config(&config_to_save)
    })
    .await
}

#[tauri::command]
async fn get_first_run_setup(app_handle: tauri::AppHandle) -> setup_manager::FirstRunSetupState {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    off_thread(move || Ok(setup_manager::load_setup_state(&app_data_dir)))
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn save_first_run_setup(
    app_handle: tauri::AppHandle,
    state: setup_manager::FirstRunSetupState,
) -> Result<setup_manager::FirstRunSetupState, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    setup_manager::save_setup_state(&app_data_dir, &state)?;
    Ok(state)
}

#[tauri::command]
fn complete_first_run_setup(
    app_handle: tauri::AppHandle,
    selected_performance_profile: String,
    skipped_steps: Vec<String>,
) -> Result<setup_manager::FirstRunSetupState, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    setup_manager::complete_setup_state(&app_data_dir, selected_performance_profile, skipped_steps)
}

#[tauri::command]
async fn validate_nexus_key(api_key: String) -> Result<nexus_api::NexusUser, String> {
    let client = NexusClient::new(api_key)?;
    client.validate_key().await
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
        "nexus" => Some(credential_store::NEXUS_API_KEY),
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

/// Which content services this build can reach.
///
/// `async` because deciding it means asking the Windows credential store
/// whether a CurseForge key is stored, and the credential store is an
/// out-of-process call. The settings dialogue asks for this the moment it
/// opens, so on the main thread it was a stall on every open.
#[tauri::command]
async fn get_api_connections() -> Vec<ApiConnectionStatus> {
    off_thread(|| Ok(api_connections()))
        .await
        .unwrap_or_default()
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

#[tauri::command]
async fn save_api_connection(
    provider: String,
    secret: String,
) -> Result<ApiConnectionStatus, AppError> {
    let provider = provider.to_lowercase();
    let secret = secret.trim();
    let secret_name = provider_secret_name(&provider).ok_or_else(|| {
        AppError::config("Provider API inconnu.", "Choisissez Nexus ou CurseForge.")
    })?;

    if secret.is_empty() {
        return Err(AppError::config(
            "The secret cannot be empty.",
            "Paste a valid API key.",
        ));
    }

    if provider == "nexus" {
        let client = NexusClient::new(secret.to_string()).map_err(AppError::from)?;
        client
            .validate_key()
            .await
            .map_err(|e| map_api_error("Nexus", e))?;
    } else if provider == "curseforge" {
        curseforge_api::search_mods(secret, "minecraft", 6, None, None, 1, 0, None)
            .await
            .map_err(|e| map_api_error("CurseForge", e))?;
    }

    credential_store::set_secret(secret_name, secret)?;
    Ok(connection_status(
        &provider,
        match provider.as_str() {
            "nexus" => "Nexus Mods",
            "curseforge" => "CurseForge",
            _ => "API",
        },
        "api_key",
        true,
        "configured",
        "API key saved.",
        None,
    ))
}

#[tauri::command]
async fn validate_api_connection(
    provider: String,
    secret: Option<String>,
) -> Result<ApiConnectionStatus, AppError> {
    let provider = provider.to_lowercase();
    match provider.as_str() {
        "nexus" => {
            let key = match secret.filter(|s| !s.trim().is_empty()) {
                Some(value) => value,
                None => credential_store::get_secret(credential_store::NEXUS_API_KEY)?
                    .ok_or_else(|| AppError::auth("No Nexus key saved.", "Add a Nexus key."))?,
            };
            let user = NexusClient::new(key)
                .map_err(AppError::from)?
                .validate_key()
                .await
                .map_err(|e| map_api_error("Nexus", e))?;
            Ok(connection_status(
                "nexus",
                "Nexus Mods",
                "api_key",
                true,
                "connected",
                &format!("Connected: {}.", user.name),
                None,
            ))
        }
        "modrinth" => {
            let result = modrinth_api::search("fabric", None, None, 1, 0)
                .await
                .map_err(|e| map_api_error("Modrinth", e))?;
            Ok(connection_status(
                "modrinth",
                "Modrinth",
                "public_api",
                true,
                "available",
                &format!("Public API reachable ({} result(s)).", result.hits.len()),
                None,
            ))
        }
        "curseforge" => {
            let key = match secret.filter(|s| !s.trim().is_empty()) {
                Some(value) => value,
                None => curseforge_api_key().map_err(AppError::from)?,
            };
            let result = curseforge_api::search_mods(&key, "minecraft", 6, None, None, 1, 0, None)
                .await
                .map_err(|e| map_api_error("CurseForge", e))?;
            Ok(connection_status(
                "curseforge",
                "CurseForge",
                "api_key",
                true,
                "connected",
                &format!("API reachable ({} result(s)).", result.data.len()),
                None,
            ))
        }
        _ => Err(AppError::config(
            "Provider API inconnu.",
            "Choisissez Nexus, Modrinth ou CurseForge.",
        )),
    }
}

#[tauri::command]
fn remove_api_connection(provider: String) -> Result<(), AppError> {
    let provider = provider.to_lowercase();
    let secret_name = provider_secret_name(&provider).ok_or_else(|| {
        AppError::config(
            "Provider API inconnu.",
            "Choisissez Nexus, CurseForge ou Microsoft.",
        )
    })?;
    credential_store::delete_secret(secret_name)
}

#[tauri::command]
fn start_download(
    app_state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let downloads_dir = app_data_dir.join("downloads");

    // Ensure downloads dir exists
    if let Some(_parent) = downloads_dir.parent() {
        let _ = std::fs::create_dir_all(&downloads_dir);
    }

    app_state
        .download_manager
        .create_job(url, file_name, downloads_dir)
}

#[tauri::command]
fn get_downloads(app_state: tauri::State<AppState>) -> Vec<DownloadJob> {
    app_state.download_manager.get_jobs()
}

#[tauri::command]
fn pause_download(app_state: tauri::State<AppState>, job_id: String) -> Result<(), String> {
    app_state.download_manager.pause_job(&job_id)
}

#[tauri::command]
fn resume_download(app_state: tauri::State<AppState>, job_id: String) -> Result<(), String> {
    app_state.download_manager.resume_job(&job_id)
}

#[tauri::command]
fn cancel_download(app_state: tauri::State<AppState>, job_id: String) -> Result<(), String> {
    app_state.download_manager.cancel_job(&job_id)
}

#[tauri::command]
fn update_discord_status(
    app_state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
    instance_id: Option<String>,
    activity: Option<LauncherPresenceActivity>,
) {
    let requested_activity = activity.unwrap_or(if instance_id.is_some() {
        LauncherPresenceActivity::ConfiguringInstance
    } else {
        LauncherPresenceActivity::BrowsingInstances
    });
    let Some(id) = instance_id else {
        app_state
            .discord_manager
            .update_launcher_presence(requested_activity, None, None);
        return;
    };

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let config = ConfigManager::new(app_data_dir.clone()).load_config();
    let game_manager = GameManager::new(app_data_dir);
    let Ok(instance) = game_manager.get_instance_by_id(&id) else {
        return;
    };
    let minecraft_version = instance
        .minecraft
        .as_ref()
        .map(|minecraft| minecraft.mc_version.clone());
    let context = discord_instance_context(&instance, &config);
    app_state.discord_manager.update_launcher_presence(
        requested_activity,
        context,
        minecraft_version.as_deref(),
    );
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

async fn handle_nxm_link(app_handle: tauri::AppHandle, link: String) -> Result<(), String> {
    println!("[NXM Handler] Received link: {}", link);

    // 1. Parse Link
    let (game_domain, mod_id, file_id, key, expires) =
        NexusClient::parse_nxm_link(&link).ok_or("Invalid NXM link format".to_string())?;

    println!(
        "[NXM Handler] Parsed: Game={}, Mod={}, File={}",
        game_domain, mod_id, file_id
    );

    // 2. Resolve Download Link
    // We need an API key. Either from config or from the link params?
    // Nexus API requires API Key for the request even if key/expires are in URL (sometimes).
    // Let's try to get the stored key first.
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let config_manager = ConfigManager::new(app_data_dir.clone());
    let _ = config_manager.load_config();

    let api_key = credential_store::get_secret(credential_store::NEXUS_API_KEY)
        .map_err(|e| e.message)?
        .ok_or("No Nexus API Key configured. Please log in first.".to_string())?;
    let client = NexusClient::new(api_key)?;

    let download_url = client
        .get_download_link(
            &game_domain,
            mod_id,
            file_id,
            key.as_deref(),
            expires.as_deref(),
        )
        .await?;

    println!("[NXM Handler] Resolved URL: {}", download_url);

    // 3. Start Download
    let state = app_handle.state::<AppState>();
    let downloads_dir = app_data_dir.join("downloads");

    // Ensure downloads dir exists
    if let Some(_parent) = downloads_dir.parent() {
        let _ = std::fs::create_dir_all(&downloads_dir);
    }

    // Construct a filename
    let file_name = format!("{}-{}-{}.zip", game_domain, mod_id, file_id);

    let job_id = state
        .download_manager
        .create_job(download_url, file_name, downloads_dir)?;

    // 4. Update Job Metadata
    {
        let mut jobs = state.download_manager.lock_jobs()?;
        if let Some(job) = jobs.get_mut(&job_id) {
            job.game_domain = Some(game_domain.clone());
            job.mod_id = Some(mod_id);
            job.file_id = Some(file_id);
            // Initially set display name to something cleaner than filename if possible, or wait for metadata
            job.file_name_display = format!("{} (Mod {})", game_domain, mod_id);
        }
    }
    state.download_manager.persist_jobs();

    println!("[NXM Handler] Download started: {}", job_id);

    // 5. Fetch Metadata (Async, non-blocking for download)
    let client_clone = client.clone();
    let download_manager_clone = state.download_manager.clone();
    let job_id_clone = job_id.clone();
    let game_domain_clone = game_domain.clone();

    tauri::async_runtime::spawn(async move {
        println!("[NXM Handler] Fetching metadata for {}...", job_id_clone);
        match client_clone
            .get_mod_file_details(&game_domain_clone, mod_id, file_id)
            .await
        {
            Ok(details) => {
                let Ok(mut jobs) = download_manager_clone.lock_jobs() else {
                    eprintln!("[NXM Handler] Failed to update metadata: download lock poisoned");
                    return;
                };
                if let Some(job) = jobs.get_mut(&job_id_clone) {
                    job.mod_name = details.name;
                    job.version = Some(details.version);
                    job.file_name_display = details.file_name; // Use the clean filename from Nexus
                    println!(
                        "[NXM Handler] Metadata updated: {} v{}",
                        job.mod_name,
                        job.version.as_deref().unwrap_or("?")
                    );
                }
                drop(jobs);
                download_manager_clone.persist_jobs();
            }
            Err(e) => {
                eprintln!("[NXM Handler] Failed to fetch metadata: {}", e);
                // Fallback is already set (default values)
            }
        }
    });

    Ok(())
}

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
};

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

fn restore_launcher_presence(app: &tauri::AppHandle) {
    if !minecraft_is_running(app) {
        app.state::<AppState>().discord_manager.restore_presence();
    }
}

/// Hides the window instead of quitting, and says so the first time.
///
/// Quitting on the cross would abandon whatever is in flight — a download, a
/// running game, an update being installed — so the window closing and the
/// launcher stopping are deliberately two different things.
fn hide_to_tray(window: &tauri::Window) {
    use tauri_plugin_notification::NotificationExt;

    let _ = window.hide();
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

    let _ = window
        .app_handle()
        .notification()
        .builder()
        .title("Kiza Launcher is still running")
        .body("It stays in the notification area so your downloads and game keep going. Open it from the tray icon, or right-click it and choose Quit.")
        .show();
}

/// Surfaces a `kiza://join/<address>` link to the player.
///
/// The link is an **offer**, not an instruction. Any web page can hand one of
/// these to the launcher, so it never joins anything on its own: the address is
/// validated, the window is brought forward, and the server list opens with the
/// address filled in. Starting a game because a page said so is exactly the
/// behaviour this avoids.
fn offer_join_link(app: &tauri::AppHandle, url: &str) {
    use tauri::Emitter;

    let address = match server_hub::parse_join_link(url) {
        Ok(address) => address,
        Err(error) => {
            eprintln!("Ignoring a Kiza link: {error}");
            return;
        }
    };

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit("kiza://join-offer", address);
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
                println!("[INFO] [Update] Closing so the installer can replace this build.");
                app.exit(0);
                return;
            }

            // Check if subsequent launch has NXM link
            if let Some(arg) = argv.iter().find(|a| a.starts_with("nxm://")) {
                let app_handle = app.clone();
                let link = arg.clone();

                tauri::async_runtime::spawn(async move {
                    if let Err(e) = handle_nxm_link(app_handle, link).await {
                        eprintln!("Failed to handle NXM link: {}", e);
                    }
                });

                // Bring window to front
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }
            if let Some(arg) = argv.iter().find(|a| a.starts_with("kiza://")) {
                offer_join_link(app, arg);
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
                        println!(
                            "[INFO] [Logs] Removed {} old log files ({} bytes).",
                            pruned.files, pruned.bytes
                        );
                    }
                    let freed = storage_report::prune_cache(&root, keep_cache);
                    if freed > 0 {
                        println!("[INFO] [Cache] Removed {freed} bytes of stale cache.");
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
                        println!("[INFO] [Startup] The startup entry now points at this build.");
                    }

                    let Some(programs) = windows_identity::start_menu_programs() else {
                        return;
                    };
                    let state = windows_identity::ensure(
                        &executable,
                        &windows_identity::shortcut_path(&programs),
                    );
                    if !state.can_notify() {
                        println!(
                            "[WARN] [Notifications] No Start menu shortcut carries Kiza's identifier; Windows will not show notifications."
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
                import_progress: Arc::new(std::sync::Mutex::new(None)),
            });

            // System Tray. "Open" comes first: once closing hides the window,
            // the tray menu is the way back, and it must not be only a
            // right-click away from Quit.
            let open_i = MenuItem::with_id(app, "open", "Open Kiza Launcher", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            // The same mark as the app icon, but rendered at 64px: the tray
            // draws at 16 or 32 depending on the display, and both divide into
            // 64 cleanly, so Windows never resamples by an awkward ratio.
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                    .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(tray_icon)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        restore_launcher_presence(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        restore_launcher_presence(app);
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
                        offer_join_link(&link_app, url.as_str());
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
                    offer_join_link(&link_app, &link);
                });
            }

            // Check for NXM link in args
            if let Some(arg) = args.iter().find(|a| a.starts_with("nxm://")) {
                // Handle initial launch with NXM link
                let app_handle = app.handle().clone();
                let link = arg.clone();

                tauri::async_runtime::spawn(async move {
                    if let Err(e) = handle_nxm_link(app_handle, link).await {
                        eprintln!("Failed to handle NXM link: {}", e);
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the main window. The console window is a log viewer, and
            // closing it means closing it.
            if window.label() != "main" {
                return;
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
            scan_directory,
            get_installed_mods,
            install_mod,
            toggle_mod,
            deploy_mods,
            verify_mods,
            repair_mods,
            undeploy_mods,
            refresh_mods,
            add_game_instance,
            list_game_instances,
            get_kiza_client_support,
            verify_game_instance,
            create_profile,
            switch_profile,
            list_profiles,
            delete_profile,
            get_active_profile_id,
            get_conflicts,
            delete_mod,
            get_mod_path,
            open_mod_folder,
            scan_residuals,
            delete_residual_files,
            get_app_config,
            save_app_config,
            get_first_run_setup,
            save_first_run_setup,
            complete_first_run_setup,
            validate_nexus_key,
            get_api_connections,
            save_api_connection,
            validate_api_connection,
            remove_api_connection,
            start_download,
            get_downloads,
            pause_download,
            resume_download,
            cancel_download,
            install_download,
            get_minecraft_versions,
            get_minecraft_loader_versions,
            detect_minecraft_runtime,
            install_minecraft_runtime,
            list_java_runtimes,
            remove_java_runtime,
            get_performance_profiles,
            get_instance_performance_profile,
            save_instance_performance_profile,
            get_instance_settings,
            save_instance_settings,
            export_instance,
            export_plan,
            create_minecraft_instance_cmd,
            rename_minecraft_instance_cmd,
            set_minecraft_instance_version_cmd,
            set_minecraft_instance_java_cmd,
            delete_minecraft_instance_cmd,
            open_instance_folder,
            check_mod_compatibility,
            list_minecraft_worlds,
            list_minecraft_content,
            delete_minecraft_content,
            import_minecraft_content,
            open_minecraft_content_folder,
            install_modrinth_content,
            install_curseforge_content,
            list_shaderpacks,
            delete_shaderpack,
            import_shaderpack,
            open_shaderpacks_folder,
            modrinth_search_shaders,
            install_shaderpack_from_modrinth,
            is_iris_installed,
            install_iris,
            start_minecraft_install,
            get_minecraft_install_status,
            launch_minecraft_instance,
            offline_accounts_list,
            offline_account_create,
            offline_account_rename,
            offline_account_delete,
            offline_account_import_skin,
            get_running_minecraft_instances,
            get_launch_status,
            read_instance_log,
            diagnose_instance_crash,
            restore_points_list,
            restore_point_create,
            restore_point_apply,
            restore_points_prune,
            restore_points_stored_bytes,
            content_origins,
            content_origin,
            content_set_pinned,
            content_forget_origin,
            check_instance_updates,
            apply_instance_updates,
            list_content_versions,
            set_content_version,
            download_content_file,
            backfill_content_origins,
            safe_mode_start,
            safe_mode_record,
            safe_mode_status,
            safe_mode_stop,
            server_hub_list,
            server_hub_add,
            server_hub_remove,
            server_hub_set_instance,
            server_hub_ping,
            server_hub_ping_all,
            server_hub_import_from_instance,
            launch_at_startup_enabled,
            set_launch_at_startup,
            storage_usage,
            reclaim_storage,
            open_kiza_folder,
            send_test_notification,
            notification_readiness,
            send_notification,
            logs_overview,
            prune_logs,
            export_diagnostics,
            support_cooldown_seconds,
            support_preview,
            support_submit,
            check_services,
            system_report,
            clear_metadata_cache,
            prune_cache,
            rebuild_instance_index,
            download_concurrency_range,
            set_downloads_paused,
            downloads_paused,
            reset_app_config,
            instance_cover,
            set_instance_cover,
            clear_instance_cover,
            instance_play_history,
            server_hub_join,
            lockfile_export,
            lockfile_save,
            lockfile_read,
            lockfile_diff,
            lockfile_apply,
            world_vault_worlds,
            world_vault_checkpoints,
            world_vault_backup,
            world_vault_restore,
            world_vault_delete,
            world_vault_prune,
            world_vault_stored_bytes,
            performance_report,
            performance_measure_next_launch,
            performance_apply_advice,
            dismiss_launch_status,
            stop_minecraft_instance,
            open_console_window,
            return_to_launcher,
            minecraft_auth_start,
            minecraft_auth_poll,
            minecraft_auth_get_account,
            minecraft_auth_list_accounts,
            minecraft_auth_set_active,
            minecraft_auth_remove_account,
            minecraft_auth_logout,
            modrinth_search_mods,
            modrinth_get_versions,
            minecraft_download_mod_from_url,
            curseforge_search_mods,
            import_instance,
            import_progress,
            launcher_edition,
            import_theme,
            installed_themes,
            stage_theme_asset,
            stage_theme_bytes,
            remove_theme,
            export_theme,
            optifine_list_releases,
            optifine_install,
            curseforge_list_files,
            curseforge_install_file,
            resolve_mod_dependencies,
            install_mod_with_dependencies,
            install_missing_dependency,
            update_discord_status
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
    NeedsInstanceSelection {
        candidates: Vec<GameInstance>,
    },
}

#[tauri::command]
async fn install_download(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    job_id: String,
    instance_id: Option<String>,
) -> Result<InstallDownloadOutcome, String> {
    // 1. Retrieve Download Job
    let job = {
        let jobs = app_state.download_manager.lock_jobs()?;
        jobs.get(&job_id).ok_or("Download job not found")?.clone()
    };

    // 2. Validate State
    if job.install_status == DownloadInstallStatus::Installing {
        return Err("Installation already in progress".to_string());
    }
    if job.install_status == DownloadInstallStatus::Installed {
        return Err("Mod is already installed".to_string());
    }
    // Allow retrying if Failed, or first time if ReadyToInstall/Downloaded
    if job.state != DownloadState::ReadyToInstall
        && job.state != DownloadState::Downloaded
        && !matches!(job.state, DownloadState::InstallFailed(_))
    {
        return Err("Download is not ready to install".to_string());
    }

    // 3. Resolve Instance
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let game_manager = GameManager::new(app_data_dir.clone());

    let target_instance = if let Some(id) = instance_id {
        // User provided instance ID
        let instance = game_manager.get_instance_by_id(&id)?;
        if instance.status != game_manager::GameInstanceStatus::Valid {
            return Err("Target instance is not valid".to_string());
        }
        // Optional: Check if instance game matches download game domain
        // if let Some(domain) = &job.game_domain {
        //    if !game_manager::instance_matches_game_domain(&instance, domain) { ... }
        // }
        instance
    } else if let Some(domain) = &job.game_domain {
        // Auto-resolve
        match game_manager.resolve_target_instance(domain) {
            game_manager::ResolveResult::Resolved(instance) => *instance,
            game_manager::ResolveResult::Multiple(candidates) => {
                return Ok(InstallDownloadOutcome::NeedsInstanceSelection { candidates });
            }
            game_manager::ResolveResult::NoMatch => {
                return Err(format!(
                    "No instance found for game domain '{}'. Please add the game first.",
                    domain
                ))
            }
        }
    } else {
        return Err(
            "Cannot determine game for this download. Please select an instance manually."
                .to_string(),
        );
    };

    // 4. Update State to Installing
    {
        let mut jobs = app_state.download_manager.lock_jobs()?;
        if let Some(j) = jobs.get_mut(&job_id) {
            j.state = DownloadState::Installing;
            j.install_status = DownloadInstallStatus::Installing;
            j.install_error = None;
        }
    }
    app_state.download_manager.persist_jobs();

    // 5. Perform Installation
    let archive_path = job.destination.to_string_lossy().to_string();
    let target_instance_id = target_instance.id.clone();

    match install_mod(app_handle.clone(), target_instance_id.clone(), archive_path).await {
        Ok(mod_info) => {
            // 6. Update State to Installed
            let mut jobs = app_state.download_manager.lock_jobs()?;
            if let Some(j) = jobs.get_mut(&job_id) {
                j.state = DownloadState::Installed(target_instance_id.clone());
                j.install_status = DownloadInstallStatus::Installed;
                j.installed_instance_id = Some(target_instance_id.clone());
                j.installed_mod_id = Some(mod_info.id);
            }
            drop(jobs);
            app_state.download_manager.persist_jobs();

            // The archive has been unpacked into the instance, so the copy in
            // Downloads is a second one. Deleted only if asked: someone who
            // installs the same mod into four instances would otherwise
            // re-download it four times.
            //
            // A failure here is deliberately silent. The install succeeded,
            // and the leftover file is a storage matter, not something worth
            // turning a success into an error over.
            if ConfigManager::new(app_data_dir.clone())
                .load_config()
                .clear_finished_downloads
            {
                let _ = std::fs::remove_file(&job.destination);
            }

            Ok(InstallDownloadOutcome::Installed {
                instance_id: target_instance_id,
                instance_name: target_instance.display_name,
            })
        }
        Err(e) => {
            // Revert state or set to Failed
            let mut jobs = app_state.download_manager.lock_jobs()?;
            if let Some(j) = jobs.get_mut(&job_id) {
                j.state = DownloadState::InstallFailed(e.clone());
                j.install_status = DownloadInstallStatus::InstallFailed;
                j.install_error = Some(e.clone());
            }
            drop(jobs);
            app_state.download_manager.persist_jobs();
            Err(e)
        }
    }
}

#[tauri::command]
async fn get_minecraft_versions(
    app_handle: tauri::AppHandle,
) -> Result<minecraft_manager::MinecraftVersionList, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::fetch_minecraft_versions_cached(&app_data_dir).await
}

#[tauri::command]
async fn get_minecraft_loader_versions(
    app_handle: tauri::AppHandle,
    mc_version: String,
    loader: game_manager::MinecraftLoader,
) -> Result<Vec<minecraft_manager::MinecraftLoaderVersionEntry>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    match loader {
        game_manager::MinecraftLoader::Vanilla => Ok(Vec::new()),
        game_manager::MinecraftLoader::Fabric => {
            minecraft_manager::list_fabric_loader_versions(&mc_version).await
        }
        loader => {
            let Some(family) = loader.installer_family() else {
                return Ok(Vec::new());
            };
            let client = reqwest::Client::builder()
                .user_agent("KizaLauncherAlpha/0.1")
                .build()
                .map_err(|error| format!("Failed to create HTTP client: {error}"))?;
            forge::list_versions(&app_data_dir, family, &client, &mc_version)
                .await
                .map(|versions| {
                    versions
                        .into_iter()
                        .map(|version| minecraft_manager::MinecraftLoaderVersionEntry {
                            // NeoForge marks pre-releases in the number itself;
                            // Forge publishes only finished builds.
                            stable: !version.contains("-beta") && !version.contains("-rc"),
                            version,
                        })
                        .collect()
                })
        }
    }
}

#[tauri::command]
async fn detect_minecraft_runtime(
    app_handle: tauri::AppHandle,
    mc_version: Option<String>,
) -> minecraft_manager::MinecraftRuntimeStatus {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    // Probing for Java means looking through several install trees, which is
    // the last thing the thread drawing the window should be doing.
    off_thread(move || {
        Ok(minecraft_manager::detect_minecraft_runtime(
            &app_data_dir,
            mc_version.as_deref(),
        ))
    })
    .await
    // A status invented from `Default` would read as "no Java found", which is
    // a different claim from "Kiza could not look".
    .unwrap_or_else(|error| minecraft_manager::MinecraftRuntimeStatus {
        required_major: 0,
        java_path: None,
        source: "unknown".to_string(),
        installed: false,
        valid: false,
        message: format!("Kiza could not check for Java: {error}"),
    })
}

/// The Java versions Kiza manages, and which of them are on this machine.
#[tauri::command]
async fn list_java_runtimes(
    app_handle: tauri::AppHandle,
) -> Result<Vec<minecraft_manager::JavaRuntimeEntry>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    // Measuring four runtime trees walks a few thousand files.
    off_thread(move || Ok(minecraft_manager::list_java_runtimes(&app_data_dir))).await
}

/// Deletes one managed Java runtime, and reports how much it freed.
#[tauri::command]
async fn remove_java_runtime(app_handle: tauri::AppHandle, java_major: u32) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || minecraft_manager::remove_java_runtime(&app_data_dir, java_major)).await
}

#[tauri::command]
async fn install_minecraft_runtime(
    app_handle: tauri::AppHandle,
    mc_version: Option<String>,
    java_major: Option<u32>,
) -> Result<minecraft_manager::MinecraftRuntimeStatus, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let required =
        java_major.unwrap_or_else(|| minecraft_manager::required_java_major(mc_version.as_deref()));
    minecraft_manager::install_minecraft_runtime(&app_data_dir, required).await
}

#[tauri::command]
fn get_performance_profiles() -> Vec<minecraft_manager::MinecraftPerformanceProfile> {
    minecraft_manager::get_performance_profiles()
}

#[tauri::command]
fn get_instance_performance_profile(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> minecraft_manager::InstancePerformanceProfile {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::load_instance_performance_profile(&app_data_dir, &instance_id)
}

#[tauri::command]
fn save_instance_performance_profile(
    app_handle: tauri::AppHandle,
    instance_id: String,
    profile_id: String,
) -> Result<minecraft_manager::InstancePerformanceProfile, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::save_instance_performance_profile(&app_data_dir, &instance_id, &profile_id)
}

/// What an instance could contribute to an archive, measured.
///
/// Asked before the export window is drawn, so every line in it carries a real
/// size and a real count rather than a promise. Worlds are listed one by one:
/// "include your worlds" is not a question anyone can answer without seeing
/// which, and how big.
#[tauri::command]
async fn export_plan(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<instance_export::ExportPlan, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Only Minecraft instances can be exported.")?
        .clone();
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let name = instance.display_name.clone();

    // Walking mods, config, resource packs, shaderpacks and every world is a
    // few thousand files on a busy instance, and the window is waiting.
    off_thread(move || {
        let mut plan = instance_export::plan(&app_data_dir, &instance_id, &game_dir);
        plan.name = name;
        plan.mc_version = minecraft.mc_version.clone();
        plan.loader = loader_name(&minecraft.loader).to_string();
        plan.loader_version = minecraft.loader_version.clone();
        Ok(plan)
    })
    .await
}

/// Writes the archive, with exactly what was ticked in it.
#[tauri::command]
async fn export_instance(
    app_handle: tauri::AppHandle,
    instance_id: String,
    selection: instance_export::ExportSelection,
) -> Result<instance_export::ExportReport, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Only Minecraft instances can be exported.")?
        .clone();
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let name = instance.display_name.clone();

    let destination = app_data_dir
        .join("exports")
        .join(format!("{}.zip", instance_export::archive_name(&name)));

    let report = {
        let app_data_dir = app_data_dir.clone();
        let destination = destination.clone();
        off_thread(move || {
            instance_export::write_archive(
                &instance_export::ArchiveRequest {
                    app_data_dir: &app_data_dir,
                    instance_id: &instance_id,
                    game_dir: &game_dir,
                    display_name: &name,
                    mc_version: &minecraft.mc_version,
                    loader: loader_name(&minecraft.loader),
                    loader_version: minecraft.loader_version.clone(),
                },
                &selection,
                &destination,
            )
        })
        .await?
    };

    if let Some(parent) = destination.parent() {
        let _ = tauri_plugin_opener::open_path(parent.to_string_lossy().to_string(), None::<&str>);
    }
    Ok(report)
}

#[tauri::command]
fn get_instance_settings(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> minecraft_manager::InstanceSettings {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::load_instance_settings(&app_data_dir, &instance_id)
}

#[tauri::command]
fn save_instance_settings(
    app_handle: tauri::AppHandle,
    instance_id: String,
    settings: minecraft_manager::InstanceSettings,
) -> Result<minecraft_manager::InstanceSettings, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::save_instance_settings(&app_data_dir, &instance_id, settings)
}

#[tauri::command]
async fn create_minecraft_instance_cmd(
    app_handle: tauri::AppHandle,
    display_name: String,
    mc_version: String,
    loader: game_manager::MinecraftLoader,
    loader_version: Option<String>,
    java_major: Option<u32>,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let loader_version = match loader {
        game_manager::MinecraftLoader::Fabric => Some(
            minecraft_manager::resolve_fabric_loader_version(
                &mc_version,
                loader_version.as_deref(),
            )
            .await?,
        ),
        ref other => match other.installer_family() {
            None => None,
            Some(family) => {
                let client = reqwest::Client::builder()
                    .user_agent("KizaLauncherAlpha/0.1")
                    .build()
                    .map_err(|error| format!("Failed to create HTTP client: {error}"))?;
                Some(
                    forge::resolve_version(
                        &app_data_dir,
                        family,
                        &client,
                        &mc_version,
                        loader_version.as_deref(),
                    )
                    .await?,
                )
            }
        },
    };
    minecraft_manager::create_minecraft_instance(
        &app_data_dir,
        display_name,
        mc_version,
        loader,
        loader_version,
        java_major,
    )
}

#[tauri::command]
fn rename_minecraft_instance_cmd(
    app_handle: tauri::AppHandle,
    instance_id: String,
    display_name: String,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::rename_minecraft_instance(&app_data_dir, &instance_id, &display_name)
}

#[tauri::command]
fn set_minecraft_instance_version_cmd(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mc_version: String,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::set_minecraft_instance_version(&app_data_dir, &instance_id, &mc_version)
}

#[tauri::command]
fn set_minecraft_instance_java_cmd(
    app_handle: tauri::AppHandle,
    instance_id: String,
    java_major: Option<u32>,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::set_minecraft_instance_java(&app_data_dir, &instance_id, java_major)
}

#[tauri::command]
fn delete_minecraft_instance_cmd(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<AppState>,
    instance_id: String,
) -> Result<(), String> {
    if let Ok(running) = app_state.running_games.lock() {
        if running.contains_key(&instance_id) {
            return Err("Stop the game before deleting this instance.".to_string());
        }
    }
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::delete_minecraft_instance(&app_data_dir, &instance_id)
}

#[tauri::command]
fn open_instance_folder(app_handle: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Static compatibility report for the instance mods folder (no launch needed).
#[tauri::command]
fn check_mod_compatibility(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<mod_compat::CompatReport, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = GameManager::new(app_data_dir.clone()).get_instance_by_id(&instance_id)?;
    let mc = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance".to_string())?;
    let mods_dir = PathBuf::from(&instance.install_path).join("mods");
    mod_compat::check_compatibility(
        &instance_id,
        &mods_dir,
        &mc.mc_version,
        minecraft_loader_name(&mc.loader),
        mc.loader_version.as_deref(),
    )
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

#[tauri::command]
fn list_minecraft_worlds(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<content_manager::MinecraftWorldInfo>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    content_manager::list_worlds(&app_data_dir, &instance_id)
}

#[tauri::command]
fn list_minecraft_content(
    app_handle: tauri::AppHandle,
    instance_id: String,
    content_type: content_manager::ContentKind,
    world_name: Option<String>,
) -> Result<Vec<content_manager::ContentPackInfo>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    content_manager::list_content(
        &app_data_dir,
        &instance_id,
        content_type,
        world_name.as_deref(),
    )
}

#[tauri::command]
fn delete_minecraft_content(
    app_handle: tauri::AppHandle,
    instance_id: String,
    content_type: content_manager::ContentKind,
    file_name: String,
    world_name: Option<String>,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    content_manager::delete_content(
        &app_data_dir,
        &instance_id,
        content_type,
        &file_name,
        world_name.as_deref(),
    )
}

#[tauri::command]
fn import_minecraft_content(
    app_handle: tauri::AppHandle,
    instance_id: String,
    content_type: content_manager::ContentKind,
    source_path: String,
    world_name: Option<String>,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    content_manager::import_content(
        &app_data_dir,
        &instance_id,
        content_type,
        &source_path,
        world_name.as_deref(),
    )
}

#[tauri::command]
fn open_minecraft_content_folder(
    app_handle: tauri::AppHandle,
    instance_id: String,
    content_type: content_manager::ContentKind,
    world_name: Option<String>,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let folder = content_manager::content_dir(
        &app_data_dir,
        &instance_id,
        content_type,
        world_name.as_deref(),
    )?;
    tauri_plugin_opener::open_path(folder.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn install_modrinth_content(
    app_handle: tauri::AppHandle,
    request: InstallModrinthContentRequest,
) -> Result<content_manager::ContentInstallResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    content_manager::install_modrinth_content(
        &app_data_dir,
        &request.instance_id,
        request.content_type,
        &request.project_id,
        request.version_id.as_deref(),
        request.world_name.as_deref(),
        request.display_name.as_deref(),
    )
    .await
}

#[tauri::command]
async fn install_curseforge_content(
    app_handle: tauri::AppHandle,
    request: InstallCurseForgeContentRequest,
) -> Result<content_manager::ContentInstallResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let key = curseforge_api_key()?;
    content_manager::install_curseforge_content(
        &app_data_dir,
        content_manager::CurseForgeContentInstallRequest {
            api_key: &key,
            instance_id: &request.instance_id,
            kind: request.content_type,
            mod_id: request.mod_id,
            file_id: request.file_id,
            world_name: request.world_name.as_deref(),
            display_name: request.display_name.as_deref(),
        },
    )
    .await
}

#[derive(Serialize)]
struct ShaderPackInfo {
    file_name: String,
    size: u64,
}

#[tauri::command]
fn list_shaderpacks(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<ShaderPackInfo>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = shaderpacks_dir(&app_data_dir, &instance_id);
    let mut packs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_zip = path.extension().is_some_and(|ext| ext == "zip");
            if is_zip || path.is_dir() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                packs.push(ShaderPackInfo {
                    file_name: name,
                    size,
                });
            }
        }
    }
    packs.sort_by_key(|pack| pack.file_name.to_lowercase());
    Ok(packs)
}

#[tauri::command]
fn delete_shaderpack(
    app_handle: tauri::AppHandle,
    instance_id: String,
    file_name: String,
) -> Result<(), String> {
    if file_name.contains(['/', '\\']) || file_name.contains("..") {
        return Err("Invalid shader pack name.".to_string());
    }
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let target = shaderpacks_dir(&app_data_dir, &instance_id).join(&file_name);
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn import_shaderpack(
    app_handle: tauri::AppHandle,
    instance_id: String,
    source_path: String,
) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("Invalid file".to_string())?;
    if source.extension().is_none_or(|ext| ext != "zip") {
        return Err("Shader packs must be .zip files.".to_string());
    }
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = shaderpacks_dir(&app_data_dir, &instance_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&source, dir.join(&file_name)).map_err(|e| e.to_string())?;
    Ok(file_name)
}

#[tauri::command]
fn open_shaderpacks_folder(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = shaderpacks_dir(&app_data_dir, &instance_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn modrinth_search_shaders(
    app_handle: tauri::AppHandle,
    instance_id: String,
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<modrinth_api::ModrinthSearchResponse, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = GameManager::new(app_data_dir).get_instance_by_id(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance".to_string())?;
    let engine = require_shader_engine(minecraft)?;

    modrinth_api::search_projects(
        &query,
        "shader",
        Some(&minecraft.mc_version),
        Some(engine.modrinth_category()),
        limit.unwrap_or(20),
        offset.unwrap_or(0),
        None,
    )
    .await
}

/// Downloads the best matching version of a Modrinth shader pack into the
/// instance shaderpacks folder.
#[tauri::command]
async fn install_shaderpack_from_modrinth(
    app_handle: tauri::AppHandle,
    instance_id: String,
    project_id: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = GameManager::new(app_data_dir.clone()).get_instance_by_id(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance".to_string())?;
    let engine = require_shader_engine(minecraft)?;

    let versions = modrinth_api::get_versions(&project_id).await?;
    let version = versions
        .iter()
        .find(|version| {
            modrinth_api::version_matches_context(
                version,
                &minecraft.mc_version,
                engine.modrinth_category(),
            )
        })
        .ok_or_else(|| {
            format!(
                "No shader pack build matches Minecraft {} and {}.",
                minecraft.mc_version,
                engine.modrinth_category()
            )
        })?;
    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or("This version has no downloadable file.".to_string())?;

    let dir = shaderpacks_dir(&app_data_dir, &instance_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let dest = dir.join(&file.filename);
    minecraft_manager::download_to_path(&client, &file.url, &dest, Some(&file.hashes.sha1)).await?;

    // Iris-based instances need the loader mod for packs to load in game.
    // Install it automatically so the user never has to do it separately.
    if engine == ShaderEngine::Iris {
        ensure_iris(&instance.install_path, &minecraft.mc_version).await?;
    }
    Ok(file.filename.clone())
}

/// Reports whether Iris is present on a supported Fabric instance.
#[tauri::command]
fn is_iris_installed(app_handle: tauri::AppHandle, instance_id: String) -> Result<bool, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = GameManager::new(app_data_dir.clone()).get_instance_by_id(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance".to_string())?;
    if shader_engine_for_loader(&minecraft.loader) != Some(ShaderEngine::Iris) {
        return Err(format!(
            "Iris cannot be used with {} instances.",
            minecraft_loader_name(&minecraft.loader)
        ));
    }
    Ok(iris_jar_present(&instance.install_path))
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

/// Installs the Iris shader loader mod on a matching Fabric instance.
#[tauri::command]
async fn install_iris(app_handle: tauri::AppHandle, instance_id: String) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = GameManager::new(app_data_dir.clone()).get_instance_by_id(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance".to_string())?;
    if shader_engine_for_loader(&minecraft.loader) != Some(ShaderEngine::Iris) {
        return Err(format!(
            "Iris cannot be installed on {}. This instance requires a shader engine compatible with {}.",
            minecraft_loader_name(&minecraft.loader),
            minecraft_loader_name(&minecraft.loader)
        ));
    }

    ensure_iris(&instance.install_path, &minecraft.mc_version).await
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

#[tauri::command]
fn get_minecraft_install_status(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<AppState>,
    instance_id: String,
) -> minecraft_manager::MinecraftInstallStatus {
    let status = app_state.minecraft_install_manager.get_status(&instance_id);
    if status.stage != minecraft_manager::MinecraftInstallStage::Idle
        && status.stage != minecraft_manager::MinecraftInstallStage::Done
    {
        return status;
    }

    // The install manager state is in-memory only; after an app restart an
    // already-installed instance would otherwise report Idle forever.
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    if let Ok(instance) = GameManager::new(app_data_dir.clone()).get_instance_by_id(&instance_id) {
        let restored = minecraft_manager::restored_install_status(&app_data_dir, &instance);
        app_state
            .minecraft_install_manager
            .set_status(&instance_id, restored.clone());
        return restored;
    }
    status
}

#[tauri::command]
async fn start_minecraft_install(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    instance_id: String,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("Not a Minecraft instance".to_string());
    }
    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err("The Minecraft instance path is not valid.".to_string());
    }
    if app_state
        .running_games
        .lock()
        .map_err(|_| "Running games lock is poisoned".to_string())?
        .contains_key(&instance_id)
    {
        return Err("This instance is already running and cannot be repaired.".to_string());
    }

    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or_else(|| "Not a Minecraft instance".to_string())?;
    app_state.minecraft_install_manager.try_start(
        &instance_id,
        minecraft_manager::planned_install_steps(&minecraft.loader),
    )?;

    let install_manager = (*app_state.minecraft_install_manager).clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = minecraft_manager::install_minecraft_instance(
            app_data_dir,
            install_manager.clone(),
            instance,
        )
        .await
        {
            install_manager.set_error(&instance_id, e);
        }
    });

    Ok(())
}

#[tauri::command]
async fn launch_minecraft_instance(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    instance_id: String,
    username: String,
    // `offline` plays with the typed name even though an account is connected.
    // Absent keeps the previous behaviour: use the account whenever there is one.
    offline: Option<bool>,
) -> Result<minecraft_manager::MinecraftLaunchResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    // Kept for the watcher, which outlives the launch call and records how the
    // run went once the game exits.
    let performance_dir = app_data_dir.clone();
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err("Instance is not valid".to_string());
    }
    // "Check the files before playing", from General. On by default, and
    // skippable on purpose: the check walks the install, and someone who
    // launches the same instance twenty times a day may not want to pay for it
    // each time. What it costs to skip is said on the settings page — a
    // half-finished install becomes a crash instead of a clear message.
    if ConfigManager::new(app_data_dir.clone())
        .load_config()
        .verify_before_launch
    {
        minecraft_manager::require_minecraft_launch_ready(
            &app_data_dir,
            &app_state.minecraft_install_manager,
            &instance,
        )?;
    }
    let instance = minecraft_manager::prepare_minecraft_loader(&app_data_dir, instance).await?;

    let mut launch_username = username;
    let mut launch_uuid = None;
    let mut launch_access_token = None;
    let mut launch_user_type = None;

    if instance.game_id == "minecraft" && !offline.unwrap_or(false) {
        let saved_account =
            minecraft_auth::load_auth_state(&app_data_dir).map(|state| state.account);
        if saved_account.is_some() {
            let client_id = microsoft_client_id()?;
            let state =
                minecraft_auth::ensure_valid_minecraft_token(app_data_dir.clone(), &client_id)
                    .await
                    .map_err(|error| {
                        format!(
                            "Saved Minecraft account is unusable: {error}. Reconnect the Microsoft account in Settings."
                        )
                    })?;
            launch_username = state.account.username;
            launch_uuid = Some(state.account.uuid);
            launch_access_token = Some(state.mc_access_token);
            launch_user_type = Some("msa".to_string());
        }
    }

    // Build the in-game Discord presence, respecting the privacy settings:
    // the user chooses whether the version and instance name are shown.
    let presence_config = ConfigManager::new(app_data_dir.clone()).load_config();
    let presence_details = if presence_config.discord_show_mc_version {
        instance
            .minecraft
            .as_ref()
            .map(|mc| format!("Minecraft {} ({})", mc.mc_version, mc.loader.display_name()))
            .unwrap_or_else(|| "Minecraft".to_string())
    } else {
        "Minecraft".to_string()
    };
    let presence_state = if presence_config.discord_show_instance_name {
        format!("Playing {}", instance.display_name)
    } else {
        "In game".to_string()
    };
    let presence_instance_name = presence_config
        .discord_show_instance_name
        .then(|| instance.display_name.clone());
    let launcher_presence_context = discord_instance_context(&instance, &presence_config);
    let presence_minecraft_version = instance
        .minecraft
        .as_ref()
        .map(|minecraft| minecraft.mc_version.clone());

    // Prevent launching the same instance twice: reserve the slot atomically
    // (PID 0 = launch in progress) so a rapid double-click cannot pass the
    // guard twice while the first launch is still starting up.
    let watched_instance_id = instance.id.clone();
    {
        let mut running = app_state
            .running_games
            .lock()
            .map_err(|_| "Running games lock is poisoned".to_string())?;
        if running.contains_key(&instance.id) {
            return Err("This instance is already running.".to_string());
        }
        running.insert(watched_instance_id.clone(), 0);
    }
    app_state.discord_manager.update_launcher_presence(
        LauncherPresenceActivity::LaunchingMinecraft,
        launcher_presence_context.clone(),
        presence_minecraft_version.as_deref(),
    );

    let launch_manager = (*app_state.launch_manager).clone();
    let launch_outcome = minecraft_manager::launch_minecraft(
        app_data_dir,
        instance,
        minecraft_manager::MinecraftLaunchRequest {
            instance_id,
            username: launch_username,
            uuid: launch_uuid,
            access_token: launch_access_token,
            user_type: launch_user_type,
        },
        launch_manager.clone(),
    )
    .await;

    let (result, mut child, state_bridge) = match launch_outcome {
        Ok(pair) => pair,
        Err(error) => {
            if let Ok(mut running) = app_state.running_games.lock() {
                running.remove(&watched_instance_id);
            }
            app_state.discord_manager.update_launcher_presence(
                LauncherPresenceActivity::ConfiguringInstance,
                launcher_presence_context.clone(),
                presence_minecraft_version.as_deref(),
            );
            launch_manager.set(
                &watched_instance_id,
                minecraft_manager::LaunchStatus {
                    phase: minecraft_manager::LaunchPhase::Crashed,
                    message: Some(error.clone()),
                    pid: None,
                    exit_code: None,
                    log_path: None,
                },
            );
            return Err(error);
        }
    };

    if let Ok(mut running) = app_state.running_games.lock() {
        running.insert(watched_instance_id.clone(), result.pid);
    }
    // The library shows when each instance was last played; the moment the
    // process exists is the moment that is true.
    let _ = instance_art::mark_played(&performance_dir, &watched_instance_id);
    launch_manager.set(
        &watched_instance_id,
        minecraft_manager::LaunchStatus {
            phase: minecraft_manager::LaunchPhase::Running,
            message: None,
            pid: Some(result.pid),
            exit_code: None,
            log_path: Some(result.log_path.clone()),
        },
    );
    let presence_start = chrono::Utc::now().timestamp();
    app_state
        .discord_manager
        .update_minecraft_starting_presence(
            presence_details.clone(),
            presence_state.clone(),
            presence_start,
        );

    // Optionally open the separate Kiza Manager log window, and hide the
    // launcher to the tray while the game runs.
    let hide_to_tray = presence_config.close_to_tray_on_launch;
    if presence_config.open_log_window_on_launch {
        let _ = open_console_window(app_handle.clone(), watched_instance_id.clone());
    }
    if hide_to_tray {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.hide();
        }
    }

    // "Quit the launcher after the game starts", from General.
    //
    // Deliberately after everything above: the process is running, its pid is
    // recorded and the log window is open, so what is being closed is a
    // launcher with nothing left to do. Quitting takes the watcher with it, so
    // this instance's last-played time is already written by now.
    if presence_config.quit_after_launch {
        let quitting = app_handle.clone();
        // A short delay so the frontend receives the Running status before the
        // window disappears, rather than the game seeming to launch nothing.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1_200));
            quitting.exit(0);
        });
    }

    // Watch the game process so the UI and Discord presence reflect when the
    // game actually exits, and surface a crash instead of failing silently.
    let running_games = app_state.running_games.clone();
    let discord_manager = app_state.discord_manager.clone();
    let log_path = result.log_path.clone();
    let watcher_app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // The base mod's first heartbeat is the moment the game reached the
        // menu, which is the one startup figure the launcher can time from
        // outside the game.
        let launched_at = std::time::Instant::now();
        let mut reached_menu_after: Option<f64> = None;
        let mut last_player_state = None;
        let exit = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {
                    let player_state = state_bridge
                        .as_ref()
                        .and_then(|bridge| bridge.read_state().ok().flatten());
                    if player_state.is_some() && reached_menu_after.is_none() {
                        reached_menu_after = Some(launched_at.elapsed().as_secs_f64());
                    }
                    if player_state != last_player_state {
                        match player_state {
                            Some(state) => discord_manager.update_minecraft_presence(
                                presence_details.clone(),
                                presence_instance_name.clone(),
                                state,
                                presence_start,
                            ),
                            None if last_player_state.is_some() => {
                                discord_manager.update_minecraft_starting_presence(
                                    presence_details.clone(),
                                    presence_state.clone(),
                                    presence_start,
                                );
                            }
                            None => {}
                        }
                        last_player_state = player_state;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
                Err(error) => {
                    eprintln!("Could not poll Minecraft process: {error}");
                    break None;
                }
            }
        };
        let exit_code = exit.and_then(|status| status.code());
        let crashed = exit_code.is_some_and(|code| code != 0);
        record_performance_run(&performance_dir, &watched_instance_id, reached_menu_after);
        // The base mod only reports on versions it supports; where it does not
        // run there is no menu signal, and none must be invented.
        let reached_menu = state_bridge.is_some().then(|| reached_menu_after.is_some());
        record_safe_mode_outcome(
            &performance_dir,
            &watched_instance_id,
            exit_code,
            reached_menu,
        );
        launch_manager.set(
            &watched_instance_id,
            minecraft_manager::LaunchStatus {
                phase: if crashed {
                    minecraft_manager::LaunchPhase::Crashed
                } else {
                    minecraft_manager::LaunchPhase::Exited
                },
                message: crashed
                    .then(|| format!("Minecraft exited with code {}.", exit_code.unwrap_or(-1))),
                pid: None,
                exit_code,
                log_path: Some(log_path),
            },
        );
        let no_running_games = if let Ok(mut running) = running_games.lock() {
            running.remove(&watched_instance_id);
            running.is_empty()
        } else {
            false
        };
        // Bring the launcher back once the game is over — unless the console
        // window is open, in which case the user returns from there. Keep the
        // console up so the final logs (and any crash) stay visible.
        let console_open = watcher_app.get_webview_window("console").is_some();
        let main_window = watcher_app.get_webview_window("main");
        let will_show_launcher = hide_to_tray && !console_open;
        let launcher_is_visible = main_window
            .as_ref()
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        if no_running_games {
            if launcher_is_visible || will_show_launcher {
                discord_manager.update_launcher_presence(
                    LauncherPresenceActivity::ConfiguringInstance,
                    launcher_presence_context,
                    presence_minecraft_version.as_deref(),
                );
            } else {
                discord_manager.set_idle();
            }
        }
        if hide_to_tray && !console_open {
            if let Some(window) = main_window {
                let _ = window.show();
                if crashed {
                    let _ = window.set_focus();
                }
            }
        }
    });

    Ok(result)
}

#[tauri::command]
fn get_launch_status(
    app_state: tauri::State<AppState>,
    instance_id: String,
) -> minecraft_manager::LaunchStatus {
    app_state.launch_manager.get(&instance_id)
}

/// Force-stops the running Minecraft process for an instance.
#[tauri::command]
fn stop_minecraft_instance(
    app_state: tauri::State<AppState>,
    instance_id: String,
) -> Result<(), String> {
    let pid = app_state
        .running_games
        .lock()
        .ok()
        .and_then(|running| running.get(&instance_id).copied())
        .filter(|pid| *pid != 0);
    let Some(pid) = pid else {
        return Err("This instance is not running.".to_string());
    };
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    if let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) {
        process.kill();
        Ok(())
    } else {
        Err("Game process not found (already stopped?).".to_string())
    }
}

/// Opens (or focuses) the separate Kiza Manager log window for an instance.
#[tauri::command]
fn open_console_window(app_handle: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("console") {
        let _ = window.eval(format!("window.location.hash = '#/console/{instance_id}'"));
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app_handle,
        "console",
        tauri::WebviewUrl::App(format!("index.html#/console/{instance_id}").into()),
    )
    .title("Kiza Manager")
    .inner_size(960.0, 660.0)
    .min_inner_size(620.0, 420.0)
    .decorations(false)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Closes the console window and restores the main launcher window.
#[tauri::command]
fn return_to_launcher(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(console) = app_handle.get_webview_window("console") {
        let _ = console.close();
    }
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    Ok(())
}

/// Tail of the instance game log, for the crash panel.
#[tauri::command]
fn read_instance_log(
    app_handle: tauri::AppHandle,
    instance_id: String,
    lines: Option<usize>,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let path = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id)
        .join("logs")
        .join("latest.log");
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let take = lines.unwrap_or(200);
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(take);
    Ok(all[start..].join("\n"))
}

/// Names what went wrong on the last failed launch, reading the game log, the
/// crash report and the JVM dump. An empty list means we could not tell.
#[tauri::command]
fn diagnose_instance_crash(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<crash_doctor::CrashFinding> {
    let game_dir =
        minecraft_manager::instance_game_dir_path(&app_data_dir(&app_handle), &instance_id);
    crash_doctor::analyse_instance(&game_dir)
}

/// Restore points capture what makes an instance an instance: loader files,
/// mods, packs, shaders and configuration. Worlds are the World Vault's job,
/// so a snapshot only records which world checkpoint it was taken beside.
#[tauri::command]
fn restore_points_list(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<restore_points::RestorePoint> {
    restore_points::list(&app_data_dir(&app_handle), &instance_id)
}

#[tauri::command]
fn restore_point_create(
    app_handle: tauri::AppHandle,
    instance_id: String,
    reason: String,
    world_checkpoint_id: Option<String>,
) -> Result<restore_points::RestorePoint, String> {
    // Capturing while another operation writes to the instance would snapshot
    // a half-finished state and restore it faithfully later.
    let _guard = instance_lock::acquire(&instance_id, "taking a restore point")?;
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    restore_points::create(
        &app_data_dir,
        &instance_id,
        &game_dir,
        &reason,
        world_checkpoint_id,
    )
}

#[tauri::command]
fn restore_point_apply(
    app_handle: tauri::AppHandle,
    instance_id: String,
    point_id: String,
) -> Result<u64, String> {
    let _guard = instance_lock::acquire(&instance_id, "restoring a restore point")?;
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    restore_points::restore(&app_data_dir, &instance_id, &point_id, &game_dir)
}

/// Keeps the newest `keep` points and reclaims the space of the others.
#[tauri::command]
fn restore_points_prune(
    app_handle: tauri::AppHandle,
    instance_id: String,
    keep: usize,
) -> Result<usize, String> {
    restore_points::prune(&app_data_dir(&app_handle), &instance_id, keep)
}

/// Bytes the snapshot store occupies after deduplication, for the disk quota.
#[tauri::command]
fn restore_points_stored_bytes(app_handle: tauri::AppHandle) -> u64 {
    restore_points::stored_bytes(&app_data_dir(&app_handle))
}

/// Where each installed file came from, so the Update Center can tell which
/// project a jar belongs to. Files installed before this existed, or added by
/// hand, simply have no entry and are never auto-updated.
#[tauri::command]
fn content_origins(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> std::collections::BTreeMap<String, content_provenance::ContentOrigin> {
    content_provenance::all(&app_data_dir(&app_handle), &instance_id)
}

#[tauri::command]
fn content_origin(
    app_handle: tauri::AppHandle,
    instance_id: String,
    relative_path: String,
) -> Option<content_provenance::ContentOrigin> {
    content_provenance::get(&app_data_dir(&app_handle), &instance_id, &relative_path)
}

/// Pinning keeps a file on the version the user chose; the Update Center will
/// list an update for it but never apply one.
#[tauri::command]
fn content_set_pinned(
    app_handle: tauri::AppHandle,
    instance_id: String,
    relative_path: String,
    pinned: bool,
) -> Result<content_provenance::ContentOrigin, String> {
    content_provenance::set_pinned(
        &app_data_dir(&app_handle),
        &instance_id,
        &relative_path,
        pinned,
    )
}

#[tauri::command]
fn content_forget_origin(
    app_handle: tauri::AppHandle,
    instance_id: String,
    relative_path: String,
) -> Result<(), String> {
    content_provenance::forget(&app_data_dir(&app_handle), &instance_id, &relative_path)
}

/// Lists what could be updated in an instance.
///
/// Only files whose origin was recorded at install time are considered: a mod
/// added by hand has no project to check against, and guessing one from its
/// file name would eventually replace the wrong thing.
#[tauri::command]
async fn check_instance_updates(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<update_center::UpdateCandidate>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Only Minecraft instances can be updated.")?;
    let target = update_center::InstanceTarget {
        mc_version: minecraft.mc_version.clone(),
        loader: minecraft.loader.slug().to_string(),
    };

    // Anything installed before Kiza started recording origins has none, and
    // this loop is the only thing that decides what can be updated — so without
    // a pass to recover them, "Check for updates" on such an instance is
    // guaranteed to find nothing, for ever. One attempt per check, and it does
    // nothing at all once every jar is accounted for.
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    if let Err(error) = provenance_backfill::run(
        &app_data_dir,
        &instance_id,
        &game_dir,
        curseforge_api_key().ok().as_deref(),
    )
    .await
    {
        eprintln!("[WARN] [Updates] Could not work out where some mods came from: {error}");
    }

    let mut candidates = Vec::new();
    for (path, origin) in content_provenance::all(&app_data_dir, &instance_id) {
        let available = match origin.provider.as_str() {
            "modrinth" => modrinth_api::get_versions(&origin.project_id)
                .await
                .map(|versions| {
                    versions
                        .into_iter()
                        .map(|version| update_center::AvailableVersion {
                            version_id: version.id,
                            version_name: version.version_number,
                            game_versions: version.game_versions,
                            loaders: version.loaders,
                            released_at: version.date_published,
                            changelog: None,
                        })
                        .collect::<Vec<_>>()
                }),
            "curseforge" => {
                let key = curseforge_api_key()?;
                let mod_id: u64 = origin
                    .project_id
                    .parse()
                    .map_err(|_| "Invalid CurseForge project id.".to_string())?;
                curseforge_api::list_files(&key, mod_id, None, None, 50, 0)
                    .await
                    .map(|response| {
                        response
                            .data
                            .into_iter()
                            .map(|file| {
                                let (game_versions, loaders) =
                                    update_center::split_curseforge_game_versions(
                                        &file.game_versions,
                                    );
                                update_center::AvailableVersion {
                                    version_id: file.id.to_string(),
                                    version_name: file.file_name,
                                    game_versions,
                                    loaders,
                                    released_at: file.file_date,
                                    changelog: None,
                                }
                            })
                            .collect::<Vec<_>>()
                    })
            }
            // OptiFine and hand-added files have no platform to query.
            _ => continue,
        };

        // One unreachable project must not hide the rest of the report.
        if let Ok(available) = available {
            let mut candidate = update_center::evaluate(&path, &origin, &available, &target);

            // CurseForge keeps changelogs behind a separate endpoint, so it is
            // fetched only for the one version being proposed, never for the
            // whole release list.
            if origin.provider == "curseforge" {
                if let Some(version) = candidate.target.as_mut() {
                    if let (Ok(key), Ok(mod_id), Ok(file_id)) = (
                        curseforge_api_key(),
                        origin.project_id.parse::<u64>(),
                        version.version_id.parse::<u64>(),
                    ) {
                        version.changelog =
                            curseforge_api::get_file_changelog(&key, mod_id, file_id)
                                .await
                                .ok();
                    }
                }
            }

            candidates.push(candidate);
        }
    }

    Ok(candidates)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppliedUpdates {
    /// The snapshot taken before touching anything, so this is undoable.
    restore_point_id: String,
    updated: Vec<String>,
    failed: Vec<String>,
}

/// Applies the selected updates, after snapshotting the instance.
///
/// Only candidates the check marked applicable are touched, so a pinned file is
/// never moved even if its path is passed in.
#[tauri::command]
async fn apply_instance_updates(
    app_handle: tauri::AppHandle,
    instance_id: String,
    paths: Vec<String>,
) -> Result<AppliedUpdates, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let candidates = check_instance_updates(app_handle.clone(), instance_id.clone()).await?;
    let selected: Vec<&update_center::UpdateCandidate> = update_center::applicable(&candidates)
        .into_iter()
        .filter(|candidate| paths.is_empty() || paths.contains(&candidate.path))
        .collect();

    if selected.is_empty() {
        return Err("Nothing to update.".to_string());
    }

    // Hold the instance for the whole operation, and snapshot before the first
    // write so a bad batch can be undone as one.
    let _guard = instance_lock::acquire(&instance_id, "applying updates")?;
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let restore_point = restore_points::create(
        &app_data_dir,
        &instance_id,
        &game_dir,
        &format!("Before updating {} file(s)", selected.len()),
        None,
    )?;

    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;

    let mut updated = Vec::new();
    let mut failed = Vec::new();

    for candidate in selected {
        match apply_one_update(&app_data_dir, &instance_id, &game_dir, &client, candidate).await {
            Ok(new_path) => updated.push(new_path),
            Err(error) => failed.push(format!("{}: {error}", candidate.path)),
        }
    }

    Ok(AppliedUpdates {
        restore_point_id: restore_point.id,
        updated,
        failed,
    })
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

/// Downloads one released file to a path the user chose, without installing it.
///
/// The counterpart of installing: sometimes the file is wanted for a server, a
/// friend, or a manual setup, and putting it in the instance would be the wrong
/// thing. Nothing about the instance changes here, and no provenance is
/// recorded — this file is leaving Kiza's care.
#[tauri::command]
async fn download_content_file(
    provider: String,
    project_id: String,
    version_id: String,
    destination: String,
) -> Result<String, String> {
    let (url, sha1) = match provider.as_str() {
        "modrinth" => {
            let version = modrinth_api::get_version(&version_id).await?;
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
            (url, sha1)
        }
        other => return Err(format!("Kiza cannot download {other} content.")),
    };

    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let path = PathBuf::from(&destination);
    minecraft_manager::download_to_path(&client, &url, &path, sha1.as_deref()).await?;
    Ok(path.to_string_lossy().to_string())
}

/// The release list of one installed file's project, for this instance.
///
/// Fetching it is what makes a deliberate choice possible at all: the Update
/// Center only ever proposes the newest release, and a mod that broke in its
/// latest version leaves the player with nowhere to go otherwise.
#[tauri::command]
async fn list_content_versions(
    app_handle: tauri::AppHandle,
    instance_id: String,
    relative_path: String,
) -> Result<Vec<update_center::AvailableVersion>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Only Minecraft instances have content versions.")?;
    let origin = content_provenance::get(&app_data_dir, &instance_id, &relative_path)
        .ok_or("Kiza does not know where this file came from, so it cannot list its versions.")?;

    let target = update_center::InstanceTarget {
        mc_version: minecraft.mc_version.clone(),
        loader: loader_name(&minecraft.loader).to_string(),
    };

    let available = match origin.provider.as_str() {
        "modrinth" => modrinth_api::get_versions(&origin.project_id)
            .await?
            .into_iter()
            .map(|version| update_center::AvailableVersion {
                version_id: version.id,
                version_name: version.version_number,
                game_versions: version.game_versions,
                loaders: version.loaders,
                released_at: version.date_published,
                changelog: None,
            })
            .collect::<Vec<_>>(),
        "curseforge" => {
            let key = curseforge_api_key()?;
            let mod_id: u64 = origin
                .project_id
                .parse()
                .map_err(|_| "Invalid CurseForge project id.".to_string())?;
            curseforge_api::list_files(&key, mod_id, None, None, 50, 0)
                .await?
                .data
                .into_iter()
                .map(|file| {
                    let (game_versions, loaders) =
                        update_center::split_curseforge_game_versions(&file.game_versions);
                    update_center::AvailableVersion {
                        version_id: file.id.to_string(),
                        version_name: file.file_name,
                        game_versions,
                        loaders,
                        released_at: file.file_date,
                        changelog: None,
                    }
                })
                .collect::<Vec<_>>()
        }
        other => return Err(format!("Kiza cannot list versions for {other} content.")),
    };

    Ok(update_center::compatible_versions(&available, &target)
        .into_iter()
        .cloned()
        .collect())
}

/// Moves a file to the exact version the user chose, in either direction.
///
/// The result is **pinned**. Going back to an older release is a decision about
/// this instance, and the next "update everything" undoing it silently would
/// make the feature useless. Unpinning from the Update Center is one click.
#[tauri::command]
async fn set_content_version(
    app_handle: tauri::AppHandle,
    instance_id: String,
    relative_path: String,
    version_id: String,
) -> Result<String, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let origin = content_provenance::get(&app_data_dir, &instance_id, &relative_path)
        .ok_or("Kiza does not know where this file came from.")?;

    let _guard = instance_lock::acquire(&instance_id, "changing a mod version")?;
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    // Snapshot first: swapping a version is exactly the kind of change worth
    // being able to undo in one step.
    restore_points::create(
        &app_data_dir,
        &instance_id,
        &game_dir,
        &format!("Before changing the version of {relative_path}"),
        None,
    )?;

    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;

    install_content_version(
        &app_data_dir,
        &instance_id,
        &game_dir,
        &client,
        &origin.provider,
        &origin.project_id,
        &version_id,
        &relative_path,
        true,
    )
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceBackfill {
    matched: Vec<String>,
    unmatched: Vec<String>,
}

/// Identifies already-installed files by hashing them and asking Modrinth which
/// version those exact bytes are.
///
/// This is what rescues content installed before Kiza recorded provenance. The
/// bytes are the identity, so nothing is guessed from a file name. Files
/// Modrinth does not recognise stay unknown rather than being attributed to
/// something plausible.
#[tauri::command]
async fn backfill_content_origins(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<ProvenanceBackfill, String> {
    use sha1::{Digest, Sha1};

    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let known = content_provenance::all(&app_data_dir, &instance_id);

    let mut matched: Vec<String> = Vec::new();
    // Path and CurseForge fingerprint, kept so a second pass can ask CurseForge
    // about everything Modrinth did not recognise, in one request.
    let mut unmatched: Vec<(String, u32)> = Vec::new();

    for folder in ["mods", "resourcepacks", "shaderpacks"] {
        let directory = game_dir.join(folder);
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            let relative = format!("{folder}/{file_name}");
            // Already identified: leave it alone, pins included.
            if known.contains_key(&relative) {
                continue;
            }

            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            let sha1 = format!("{:x}", Sha1::digest(&bytes));

            match modrinth_api::version_from_sha1(&sha1).await {
                Ok(Some(version)) => {
                    let _ = content_provenance::record(
                        &app_data_dir,
                        &instance_id,
                        &relative,
                        content_provenance::ContentOrigin {
                            provider: "modrinth".to_string(),
                            project_id: version.project_id,
                            version_id: version.id,
                            pinned: false,
                        },
                    );
                    matched.push(relative);
                }
                // Unknown to Modrinth, or the lookup failed. CurseForge gets a
                // turn below — a great deal of Minecraft content is there and
                // nowhere else.
                _ => unmatched.push((relative, curseforge_api::fingerprint(&bytes))),
            }
        }
    }

    // CurseForge identifies a file by a fingerprint of its own, and answers a
    // whole batch in one request.
    if !unmatched.is_empty() {
        if let Ok(key) = curseforge_api_key() {
            let fingerprints: Vec<u32> = unmatched.iter().map(|(_, print)| *print).collect();
            if let Ok(files) = curseforge_api::files_by_fingerprint(&key, &fingerprints).await {
                for file in files {
                    let Some(mod_id) = file.mod_id else { continue };
                    // The answer comes back unordered and without the
                    // fingerprint that produced it, so files are paired up by
                    // name — the one thing both sides carry.
                    let Some(position) = unmatched
                        .iter()
                        .position(|(path, _)| path.ends_with(&format!("/{}", file.file_name)))
                    else {
                        continue;
                    };
                    let (relative, _) = unmatched.remove(position);
                    let _ = content_provenance::record(
                        &app_data_dir,
                        &instance_id,
                        &relative,
                        content_provenance::ContentOrigin {
                            provider: "curseforge".to_string(),
                            project_id: mod_id.to_string(),
                            version_id: file.id.to_string(),
                            pinned: false,
                        },
                    );
                    matched.push(relative);
                }
            }
        }
    }

    Ok(ProvenanceBackfill {
        matched,
        // Neither platform knows these bytes; they stay unknown rather than
        // being attributed to something plausible.
        unmatched: unmatched.into_iter().map(|(path, _)| path).collect(),
    })
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

/// Starts a hunt for the mod that breaks this instance.
#[tauri::command]
fn safe_mode_start(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<SafeModeState, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let _guard = instance_lock::acquire(&instance_id, "hunting a broken mod")?;

    // Only mods that are on today are suspects; something already disabled
    // cannot be what crashes the game.
    let candidates: Vec<String> = ModManager::new(app_data_dir.clone())
        .load_mods(&instance_id)
        .into_iter()
        .filter(|installed| installed.enabled)
        .map(|installed| installed.id)
        .collect();

    let session = safe_mode::SafeModeSession::new(&instance_id, candidates);
    let state = safe_mode_state(&session);
    apply_safe_mode_selection(&app_data_dir, &instance, &state.enabled)?;
    safe_mode::save(&app_data_dir, &session)?;
    Ok(state)
}

/// Records how the last test launch went and prepares the next one.
///
/// `crashed` is normally decided by the Crash Doctor rather than by the user,
/// so a hunt does not depend on someone judging a log correctly.
#[tauri::command]
fn safe_mode_record(
    app_handle: tauri::AppHandle,
    instance_id: String,
    crashed: bool,
) -> Result<SafeModeState, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let mut session = safe_mode::load(&app_data_dir, &instance_id)
        .ok_or("No safe mode session is running for this instance.")?;

    session.record(if crashed {
        safe_mode::RunOutcome::Crashed
    } else {
        safe_mode::RunOutcome::Started
    });

    let state = safe_mode_state(&session);
    apply_safe_mode_selection(&app_data_dir, &instance, &state.enabled)?;
    safe_mode::save(&app_data_dir, &session)?;
    Ok(state)
}

#[tauri::command]
fn safe_mode_status(app_handle: tauri::AppHandle, instance_id: String) -> Option<SafeModeState> {
    safe_mode::load(&app_data_dir(&app_handle), &instance_id)
        .map(|session| safe_mode_state(&session))
}

/// Ends the hunt and puts every mod back on.
#[tauri::command]
fn safe_mode_stop(app_handle: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    if let Some(session) = safe_mode::load(&app_data_dir, &instance_id) {
        apply_safe_mode_selection(&app_data_dir, &instance, &session.candidates)?;
    }
    safe_mode::clear(&app_data_dir, &instance_id);
    Ok(())
}

/// Saved servers, newest first in the order the user added them.
#[tauri::command]
fn server_hub_list(app_handle: tauri::AppHandle) -> Vec<server_hub::SavedServer> {
    server_hub::list(&app_data_dir(&app_handle))
}

#[tauri::command]
fn server_hub_add(
    app_handle: tauri::AppHandle,
    name: String,
    address: String,
    instance_id: Option<String>,
) -> Result<server_hub::SavedServer, String> {
    server_hub::add(&app_data_dir(&app_handle), &name, &address, instance_id)
}

#[tauri::command]
fn server_hub_remove(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<Vec<server_hub::SavedServer>, String> {
    server_hub::remove(&app_data_dir(&app_handle), &id)
}

/// Binds a server to the instance it should be played with, so joining it
/// starts the right set of mods.
#[tauri::command]
fn server_hub_set_instance(
    app_handle: tauri::AppHandle,
    id: String,
    instance_id: Option<String>,
) -> Result<server_hub::SavedServer, String> {
    server_hub::set_instance(&app_data_dir(&app_handle), &id, instance_id)
}

/// Live status over Minecraft's own protocol. A server that does not answer
/// within the timeout is reported as unreachable rather than stalling the list.
#[tauri::command]
async fn server_hub_ping(address: String) -> Result<server_hub::ServerStatus, String> {
    server_hub::ping(&address, std::time::Duration::from_secs(5)).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerImport {
    added: Vec<server_hub::SavedServer>,
    /// Entries already saved, or whose address Kiza cannot parse.
    skipped: usize,
}

/// Imports the multiplayer list an instance already has.
///
/// The player has usually built that list inside the game long before opening
/// the launcher; re-typing it would be the wrong way round. Servers are matched
/// by address, so importing again after a session adds only what is new.
#[tauri::command]
fn server_hub_import_from_instance(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<ServerImport, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let path = game_dir.join("servers.dat");

    let bytes = std::fs::read(&path).map_err(|_| {
        "This instance has no multiplayer list yet. Play on a server once, then import.".to_string()
    })?;
    let entries =
        nbt::parse_servers_dat(&bytes).ok_or("That servers.dat could not be read.".to_string())?;

    // The imported servers are bound to the instance they came from: it is the
    // one that already runs them.
    let (added, skipped) = server_hub::import_entries(&app_data_dir, &entries, Some(instance_id))?;
    Ok(ServerImport { added, skipped })
}

/// Whether Kiza starts with Windows.
#[tauri::command]
fn launch_at_startup_enabled() -> bool {
    startup::is_enabled()
}

/// Adds or removes Kiza from the Windows startup list.
///
/// Reports the state read back from the registry, not the one requested: a
/// policy or another tool can refuse the write, and a switch that flipped while
/// nothing changed on disk would be a lie.
#[tauri::command]
fn set_launch_at_startup(enabled: bool) -> Result<bool, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the launcher: {error}"))?;
    startup::set_enabled(enabled, &executable)
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

#[tauri::command]
fn instance_cover(app_handle: tauri::AppHandle, instance_id: String) -> Option<InstanceCover> {
    let app_data_dir = app_data_dir(&app_handle);
    if let Some(uri) = instance_art::cover_data_uri(&app_data_dir, &instance_id) {
        return Some(InstanceCover {
            uri,
            source: "custom",
        });
    }

    let instance = GameManager::new(app_data_dir.clone())
        .verify_instance(&instance_id)
        .ok()?;
    let mc_version = instance.minecraft?.mc_version;
    instance_art::version_artwork(&app_data_dir, &mc_version).map(|uri| InstanceCover {
        uri,
        source: "version",
    })
}

#[tauri::command]
fn set_instance_cover(
    app_handle: tauri::AppHandle,
    instance_id: String,
    source_path: String,
) -> Result<String, String> {
    instance_art::set_cover(
        &app_data_dir(&app_handle),
        &instance_id,
        std::path::Path::new(&source_path),
    )
}

#[tauri::command]
fn clear_instance_cover(app_handle: tauri::AppHandle, instance_id: String) {
    instance_art::clear_cover(&app_data_dir(&app_handle), &instance_id);
}

/// When each instance was last launched, for the whole library at once.
#[tauri::command]
fn instance_play_history(
    app_handle: tauri::AppHandle,
) -> std::collections::BTreeMap<String, String> {
    let app_data_dir = app_data_dir(&app_handle);
    GameManager::new(app_data_dir.clone())
        .list_instances()
        .into_iter()
        .filter_map(|instance| {
            instance_art::last_played(&app_data_dir, &instance.id)
                .map(|played| (instance.id, played))
        })
        .collect()
}

/// Refreshes every saved server at once, so the list fills in together instead
/// of waiting out each dead server in turn.
#[tauri::command]
async fn server_hub_ping_all(app_handle: tauri::AppHandle) -> Vec<server_hub::ServerPing> {
    let servers = server_hub::list(&app_data_dir(&app_handle));
    server_hub::ping_all(&servers, std::time::Duration::from_secs(5)).await
}

/// Launches the instance bound to a saved server.
#[tauri::command]
async fn server_hub_join(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    id: String,
    username: String,
) -> Result<minecraft_manager::MinecraftLaunchResult, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let server = server_hub::list(&app_data_dir)
        .into_iter()
        .find(|server| server.id == id)
        .ok_or("That server is no longer saved.")?;
    let instance_id = server
        .instance_id
        .clone()
        .ok_or("Bind this server to an instance before joining.")?;

    let result =
        launch_minecraft_instance(app_handle.clone(), app_state, instance_id, username, None)
            .await?;
    // Only record the visit once the game actually started.
    let _ = server_hub::mark_played(&app_data_dir, &id);
    Ok(result)
}

#[tauri::command]
fn dismiss_launch_status(app_state: tauri::State<AppState>, instance_id: String) {
    app_state
        .launch_manager
        .set(&instance_id, minecraft_manager::LaunchStatus::idle());
}

#[tauri::command]
fn get_running_minecraft_instances(app_state: tauri::State<AppState>) -> HashMap<String, u32> {
    app_state
        .running_games
        .lock()
        .map(|running| running.clone())
        .unwrap_or_default()
}

#[tauri::command]
async fn minecraft_auth_start(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
) -> Result<minecraft_auth::AuthStartResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let client_id = microsoft_client_id()?;
    app_state
        .minecraft_auth_manager
        .start_browser_auth_flow(&client_id, app_data_dir)
        .await
}

#[tauri::command]
async fn minecraft_auth_poll(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    login_id: String,
) -> Result<minecraft_auth::AuthPollStatus, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let client_id = microsoft_client_id()?;
    app_state
        .minecraft_auth_manager
        .poll_login(app_data_dir, &client_id, &login_id)
        .await
}

#[tauri::command]
fn minecraft_auth_get_account(
    app_handle: tauri::AppHandle,
) -> Option<minecraft_auth::MinecraftAccount> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::load_auth_state(&app_data_dir).map(|s| s.account)
}

/// Resolves the app data directory the same way every command does.
fn app_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Offline profiles are local identities: a saved name, and optionally a skin.
/// They never touch Mojang, so none of these commands authenticate anything.
#[tauri::command]
fn offline_accounts_list(app_handle: tauri::AppHandle) -> Vec<offline_accounts::OfflineAccount> {
    offline_accounts::list(&app_data_dir(&app_handle))
}

#[tauri::command]
fn offline_account_create(
    app_handle: tauri::AppHandle,
    username: String,
) -> Result<offline_accounts::OfflineAccount, String> {
    offline_accounts::create(&app_data_dir(&app_handle), &username)
}

#[tauri::command]
fn offline_account_rename(
    app_handle: tauri::AppHandle,
    id: String,
    username: String,
) -> Result<offline_accounts::OfflineAccount, String> {
    offline_accounts::rename(&app_data_dir(&app_handle), &id, &username)
}

#[tauri::command]
fn offline_account_delete(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<Vec<offline_accounts::OfflineAccount>, String> {
    offline_accounts::delete(&app_data_dir(&app_handle), &id)
}

#[tauri::command]
fn offline_account_import_skin(
    app_handle: tauri::AppHandle,
    id: String,
    source_path: String,
) -> Result<offline_accounts::OfflineAccount, String> {
    offline_accounts::import_skin(
        &app_data_dir(&app_handle),
        &id,
        std::path::Path::new(&source_path),
    )
}

#[tauri::command]
fn minecraft_auth_list_accounts(
    app_handle: tauri::AppHandle,
) -> Vec<minecraft_auth::MinecraftAccount> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::list_accounts(&app_data_dir)
}

#[tauri::command]
fn minecraft_auth_set_active(
    app_handle: tauri::AppHandle,
    uuid: String,
) -> Result<minecraft_auth::MinecraftAccount, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::set_active_account(&app_data_dir, &uuid)
}

#[tauri::command]
fn minecraft_auth_remove_account(
    app_handle: tauri::AppHandle,
    uuid: String,
) -> Result<Vec<minecraft_auth::MinecraftAccount>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::remove_account(&app_data_dir, &uuid)
}

#[tauri::command]
fn minecraft_auth_logout(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::logout(&app_data_dir)?;
    app_state.minecraft_auth_manager.clear_pending();
    Ok(())
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

#[tauri::command]
async fn minecraft_download_mod_from_url(
    app_handle: tauri::AppHandle,
    request: MinecraftDownloadModRequest,
) -> Result<String, String> {
    let MinecraftDownloadModRequest {
        instance_id,
        url,
        file_name,
        sha1,
        mod_name,
        version,
        description,
        cover_url,
        source,
        homepage_url,
        file_size,
        game_versions,
        loaders,
        updated_at,
        project_id,
        version_id,
    } = request;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("Not a Minecraft instance".to_string());
    }
    let downloads_dir = app_data_dir.join("downloads").join("minecraft");
    let file_name = path_security::safe_file_name(&file_name, &["jar"])
        .map_err(|e| format!("Invalid Minecraft mod file name: {e}"))?;
    let tmp = path_security::safe_child_path(&downloads_dir, &file_name, &["jar"])
        .map_err(|e| format!("Invalid Minecraft mod file name: {e}"))?;
    download_file_to_path(&url, &tmp, sha1.as_deref()).await?;

    let mod_manager = ModManager::new(app_data_dir.clone());
    let target_rel = format!("mods/{}", file_name);
    let _ = mod_manager.install_mod_file(
        &instance_id,
        &tmp.to_string_lossy(),
        &target_rel,
        Some(mod_manager::ModMetadata {
            name: mod_name,
            version,
            description,
            source,
            author: None,
            homepage_url,
            cover_url,
            file_size,
            game_versions: game_versions.unwrap_or_default(),
            loaders: loaders.unwrap_or_default(),
            updated_at,
            project_id: project_id.clone(),
            version_id: version_id.clone(),
        }),
    )?;
    if let (Some(project_id), Some(version_id)) = (project_id, version_id) {
        let _ = content_provenance::record(
            &app_data_dir,
            &instance_id,
            &target_rel,
            content_provenance::ContentOrigin {
                provider: "modrinth".to_string(),
                project_id,
                version_id,
                pinned: false,
            },
        );
    }
    let _ = mod_manager.deploy(&instance_id, "minecraft", &instance.install_path)?;
    let _ = tokio::fs::remove_file(&tmp).await;
    Ok(target_rel)
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

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn modrinth_search_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
    query: String,
    project_type: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    compatible_only: Option<bool>,
    filter_version: Option<bool>,
    sort: Option<String>,
) -> Result<modrinth_api::ModrinthSearchResponse, String> {
    // The Minecraft version facet is always applied so an instance only browses
    // its own catalogue; the loader facet is opt-in so other-loader projects
    // stay visible and are badged by the UI.
    // `project_type` chooses the content kind (mod, shader, resourcepack, ...).
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    let project_type = project_type.unwrap_or_else(|| "mod".to_string());
    let mc_version = if project_type == "modpack" || filter_version == Some(false) {
        None
    } else {
        Some(minecraft.mc_version.as_str())
    };
    let loader = if compatible_only.unwrap_or(false) && project_type == "mod" {
        Some(minecraft_loader_name(&minecraft.loader))
    } else {
        None
    };
    modrinth_api::search_projects(
        &query,
        &project_type,
        mc_version,
        loader,
        limit.unwrap_or(20),
        offset.unwrap_or(0),
        sort.as_deref(),
    )
    .await
}

#[tauri::command]
async fn modrinth_get_versions(
    project_id: String,
) -> Result<Vec<modrinth_api::ModrinthVersion>, String> {
    modrinth_api::get_versions(&project_id).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn curseforge_search_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
    query: String,
    class_id: Option<u32>,
    page_size: Option<u32>,
    index: Option<u32>,
    compatible_only: Option<bool>,
    content_type: Option<String>,
    filter_version: Option<bool>,
    sort: Option<String>,
) -> Result<curseforge_api::CurseForgeSearchResponse, String> {
    // The Minecraft version filter is always pushed to CurseForge so an instance
    // only ever browses its own catalogue (a 1.8 instance sees every 1.8 mod,
    // not the globally popular modern ones). The loader is only added when the
    // user asks for compatible-only, otherwise other-loader builds stay visible
    // and are badged by the UI.
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    let key = curseforge_api_key()?;
    let content_type = content_type.as_deref().unwrap_or("mod");
    let mc_version = if content_type == "modpack" || filter_version == Some(false) {
        None
    } else {
        Some(minecraft.mc_version.as_str())
    };
    let loader = if compatible_only.unwrap_or(false) && content_type == "mod" {
        Some(minecraft_loader_name(&minecraft.loader))
    } else {
        None
    };
    curseforge_api::search_mods(
        &key,
        &query,
        class_id.unwrap_or(6),
        mc_version,
        loader,
        page_size.unwrap_or(20),
        index.unwrap_or(0),
        sort.as_deref(),
    )
    .await
}

#[tauri::command]
async fn curseforge_list_files(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: u64,
    content_type: Option<String>,
    page_size: Option<u32>,
    index: Option<u32>,
) -> Result<curseforge_api::CurseForgeFilesResponse, String> {
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    let key = curseforge_api_key()?;
    let content_type = content_type.as_deref().unwrap_or("mod");
    let loader = if content_type == "mod" {
        Some(minecraft_loader_name(&minecraft.loader))
    } else {
        None
    };
    let mc_version = if content_type == "modpack" {
        None
    } else {
        Some(minecraft.mc_version.as_str())
    };
    curseforge_api::list_files(
        &key,
        mod_id,
        mc_version,
        loader,
        page_size.unwrap_or(20),
        index.unwrap_or(0),
    )
    .await
}

/// Creates an instance from an archive produced by Share/Export.
///
/// Two shapes arrive here. An archive with a `kiza.json` is one of ours and
/// carries what makes an instance an instance: which release each mod is, what
/// order they load in, which are switched off, and which worlds travelled. An
/// archive without one is older, or from another launcher, and gets the
/// unchanged treatment — its overrides unpacked and nothing claimed about them.
///
/// The mod catalogue is the part that used to be missing entirely. Without it
/// the jars sat in `mods/` and the Mods tab was empty: nothing to enable,
/// nothing to remove, nothing to update.
#[tauri::command]
async fn import_instance(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    archive_path: String,
    display_name: Option<String>,
) -> Result<InstanceImportOutcome, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let path = std::path::PathBuf::from(&archive_path);
    let (imported, kiza) = {
        let app_data_dir = app_data_dir.clone();
        let path = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let imported = content_manager::import_instance_archive(
                &app_data_dir,
                &path,
                display_name.as_deref(),
            )?;
            // Read after the instance exists, so a malformed sidecar cannot
            // leave a half-built instance behind: `import_instance_archive`
            // already cleans up after itself when it fails.
            let kiza = read_kiza_manifest(&path);
            Ok::<_, String>((imported, kiza))
        })
        .await
        .map_err(|error| format!("Instance import task failed: {error}"))??
    };
    let result = imported.result;

    // A CurseForge pack ships a manifest and its overrides; the mods themselves
    // are project and file numbers to be fetched. Kiza did that for a pack
    // opened from the catalogue and refused the identical archive on disk,
    // which is the file someone is handed when a pack is shared with them.
    let mut outcome = InstanceImportOutcome {
        instance_id: result.instance_id.clone(),
        ..Default::default()
    };

    // Skipped when the archive carries a Kiza sidecar: `restore_mods` fetches
    // the same releases below and knows their icon, author and page as well as
    // their numbers. Doing both would install every catalogue mod twice, and
    // two copies of one mod is a game that will not start.
    if !imported.pending.is_empty() && kiza.is_none() {
        let Ok(api_key) = curseforge_api_key() else {
            let _ =
                minecraft_manager::delete_minecraft_instance(&app_data_dir, &result.instance_id);
            return Err(format!(
                "This pack lists {} mods to download from CurseForge, and no CurseForge key is configured.",
                imported.pending.len()
            ));
        };
        let client = reqwest::Client::builder()
            .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| error.to_string())?;
        let game_dir =
            minecraft_manager::instance_game_dir_path(&app_data_dir, &result.instance_id);

        let progress = app_state.import_progress.clone();
        let report = content_manager::fetch_pack_files(
            &app_data_dir,
            &result.instance_id,
            &api_key,
            &client,
            &imported.pending,
            &game_dir,
            |done, total, name| {
                if let Ok(mut slot) = progress.lock() {
                    *slot = Some(ImportProgress {
                        done,
                        total,
                        name: name.to_string(),
                    });
                }
            },
        )
        .await;
        if let Ok(mut slot) = app_state.import_progress.lock() {
            *slot = None;
        }

        // One mod whose author will not let a launcher fetch it is not a reason
        // to delete the instance and the twenty-eight others, the configs and
        // the worlds that came with it. Nothing arriving at all is.
        if !report.worth_keeping() {
            let _ =
                minecraft_manager::delete_minecraft_instance(&app_data_dir, &result.instance_id);
            return Err(report
                .failed
                .first()
                .map(|failure| failure.reason.clone())
                .unwrap_or_else(|| "No mod in this pack could be downloaded.".to_string()));
        }

        outcome.mods_installed = report.installed;
        outcome.failed = report.failed;

        // A mod its CurseForge author will not let a launcher fetch is often
        // published on Modrinth as well, where the API serves downloads by
        // design. That is the author's own choice on that platform, not a way
        // around the one they made on this one — and it turns a dead end into
        // one click. One request per blocked mod, and blocked mods are few.
        outcome.blocked = Vec::with_capacity(report.blocked.len());
        for mut blocked in report.blocked {
            if let Some(found) = missing_dependency::alternative_on_modrinth(
                &blocked.name,
                blocked.page_url.as_deref(),
            )
            .await
            {
                blocked.modrinth_project_id = Some(found.project_id);
                blocked.modrinth_name = Some(found.name);
            }
            outcome.blocked.push(blocked);
        }
    }

    let Some(manifest) = kiza else {
        return Ok(outcome);
    };
    instance_import::readable(manifest.format)?;

    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &result.instance_id);
    let report = instance_import::restore_mods(
        &app_data_dir,
        &result.instance_id,
        &game_dir,
        &manifest,
        curseforge_api_key().ok().as_deref(),
        |done, total, name| {
            println!("[INFO] [Import] {done}/{total} {name}");
        },
    )
    .await;

    if !report.mods_missing.is_empty() {
        // Named rather than counted: "three mods are missing" sends someone
        // looking through twenty-five, and a pack that quietly lost a mod fails
        // at launch instead of here.
        println!(
            "[WARN] [Import] Could not restore: {}",
            report.mods_missing.join(", ")
        );
    }

    // The game itself, when this machine does not already have it.
    //
    // Version files live in one place and are shared by every instance, so
    // importing a pack for a version you already play needs nothing — which is
    // why this looks like it does nothing most of the time. On a machine
    // meeting that version for the first time, the instance would otherwise
    // arrive complete and unplayable until somebody noticed the Install button.
    start_install_if_missing(&app_data_dir, &app_state, &result.instance_id);

    outcome.mods_installed = report.mods_downloaded + report.mods_bundled;
    Ok(outcome)
}

/// Where installed themes live.
fn themes_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?
        .join("themes"))
}

/// Opens a `.kizatheme` and keeps it.
///
/// Everything a theme file is allowed to be is decided in `kizatheme`, which
/// refuses one rather than half-reading it: a manifest from a newer Kiza, a
/// colour that is really a stylesheet, an entry naming its way out of its own
/// folder, a picture bigger than the launcher will carry.
#[tauri::command]
async fn import_theme(
    app_handle: tauri::AppHandle,
    archive_path: String,
) -> Result<kizatheme::InstalledTheme, String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || {
        kizatheme::install(std::path::Path::new(&archive_path), &home).map_err(String::from)
    })
    .await
}

/// Copies a picture a designer chose into the folder the window may read.
///
/// The `asset:` protocol is scoped to one directory on purpose, so a picture
/// has to be brought inside it before it can be drawn. Checked on the way in
/// rather than at export: being told a background is too heavy when you try to
/// save an evening's work is being told too late.
#[tauri::command]
async fn stage_theme_asset(
    app_handle: tauri::AppHandle,
    slot: String,
    source: String,
) -> Result<String, String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || {
        kizatheme::stage_asset(&home, &slot, std::path::Path::new(&source)).map_err(String::from)
    })
    .await
}

/// Takes a picture the page read off a drop and stages it.
///
/// The bytes come base64-encoded because that is what survives the IPC without
/// ceremony, and a picture is capped at eight megabytes anyway — the encoding
/// costs a third of that, once, at the moment somebody drops a file.
#[tauri::command]
async fn stage_theme_bytes(
    app_handle: tauri::AppHandle,
    slot: String,
    name: String,
    data: String,
) -> Result<String, String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|error| format!("That picture could not be read: {error}"))?;
        kizatheme::stage_bytes(&home, &slot, &name, &bytes).map_err(String::from)
    })
    .await
}

/// Every theme that has been installed.
#[tauri::command]
async fn installed_themes(
    app_handle: tauri::AppHandle,
) -> Result<Vec<kizatheme::InstalledTheme>, String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || Ok(kizatheme::installed(&home))).await
}

/// Forgets an installed theme.
#[tauri::command]
async fn remove_theme(app_handle: tauri::AppHandle, theme_id: String) -> Result<(), String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || kizatheme::remove(&home, &theme_id).map_err(String::from)).await
}

/// Writes a theme out as a file somebody can be given.
///
/// Validated before a byte is written: a theme this launcher would refuse to
/// open is not one to hand to anybody else.
#[tauri::command]
async fn export_theme(
    destination: String,
    manifest: kizatheme::ThemeManifest,
    assets: std::collections::BTreeMap<String, String>,
) -> Result<String, String> {
    off_thread(move || {
        let mut bytes = std::collections::BTreeMap::new();
        for (slot, path) in &assets {
            let read = std::fs::read(path)
                .map_err(|error| format!("Could not read the picture for {slot}: {error}"))?;
            bytes.insert(slot.clone(), read);
        }
        let destination = std::path::PathBuf::from(&destination);
        kizatheme::write(&destination, &manifest, &bytes)?;
        Ok(destination.to_string_lossy().to_string())
    })
    .await
}

/// Which Kiza this is, asked of the binary rather than of the bundle.
///
/// The interface has its own copy of the edition, folded in at build time so
/// the Maker tools can be dropped from a Stable bundle entirely. This is the
/// backend's answer to the same question, and the two are compared by a test:
/// a window that believes it is Maker while the binary behind it is Stable
/// would offer tools nothing can serve.
#[tauri::command]
async fn launcher_edition() -> Result<&'static str, String> {
    Ok(edition::current().slug())
}

/// Where the import running right now has got to, if one is.
#[tauri::command]
async fn import_progress(
    app_state: tauri::State<'_, AppState>,
) -> Result<Option<ImportProgress>, String> {
    Ok(app_state
        .import_progress
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone())
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

#[tauri::command]
async fn optifine_list_releases(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<optifine::OptiFineRelease>, String> {
    // OptiFine ships only from optifine.net, so it never shows up in the
    // Modrinth/CurseForge search. This lists the builds for the instance.
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    optifine::list_releases(&minecraft.mc_version).await
}

#[tauri::command]
async fn optifine_install(
    app_handle: tauri::AppHandle,
    instance_id: String,
    file_name: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("Not a Minecraft instance".to_string());
    }

    // The link carries a single-use token, so it is resolved per install.
    let url = optifine::resolve_download_url(&file_name).await?;

    let downloads_dir = app_data_dir.join("downloads").join("minecraft");
    let safe_name = path_security::safe_file_name(&file_name, &["jar"])
        .map_err(|e| format!("Invalid OptiFine file name: {e}"))?;
    let tmp = path_security::safe_child_path(&downloads_dir, &safe_name, &["jar"])
        .map_err(|e| format!("Invalid OptiFine file name: {e}"))?;
    download_file_to_path(&url, &tmp, None).await?;

    let mod_manager = ModManager::new(app_data_dir.clone());
    let target_rel = format!("mods/{}", safe_name);
    let installed = mod_manager.install_mod_file(
        &instance_id,
        &tmp.to_string_lossy(),
        &target_rel,
        Some(mod_manager::ModMetadata {
            name: Some(safe_name.trim_end_matches(".jar").replace('_', " ")),
            version: None,
            description: Some("OptiFine - performance, shaders and video settings.".to_string()),
            source: Some("optifine".to_string()),
            // OptiFine is not on any platform, so it can never be auto-updated.
            project_id: None,
            version_id: None,
            author: Some("sp614x".to_string()),
            homepage_url: Some("https://optifine.net".to_string()),
            cover_url: None,
            file_size: None,
            game_versions: instance
                .minecraft
                .as_ref()
                .map(|mc| vec![mc.mc_version.clone()])
                .unwrap_or_default(),
            loaders: Vec::new(),
            updated_at: None,
        }),
    )?;
    let _ = mod_manager.deploy(&instance_id, "minecraft", &instance.install_path)?;
    let _ = tokio::fs::remove_file(&tmp).await;
    Ok(installed.id)
}

#[tauri::command]
async fn curseforge_install_file(
    app_handle: tauri::AppHandle,
    request: CurseForgeInstallFileRequest,
) -> Result<String, String> {
    let CurseForgeInstallFileRequest {
        instance_id,
        mod_id,
        file_id,
        file_name,
        mod_name,
        description,
        cover_url,
        homepage_url,
        file_size,
        game_versions,
        updated_at,
    } = request;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let key = curseforge_api_key()?;
    let project = curseforge_api::get_mod(&key, mod_id).await?;
    curseforge_api::require_distribution_allowed(&project)?;
    let file = curseforge_api::get_file(&key, mod_id, file_id).await?;
    let url = match file.download_url.as_deref() {
        Some(url) if !url.trim().is_empty() => url.to_string(),
        _ => curseforge_api::get_download_url(&key, mod_id, file_id).await?,
    };

    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("Not a Minecraft instance".to_string());
    }
    let downloads_dir = app_data_dir.join("downloads").join("minecraft");
    let raw_file_name = file_name.unwrap_or(file.file_name);
    let file_name = path_security::safe_file_name(&raw_file_name, &["jar"])
        .map_err(|e| format!("Invalid CurseForge file name: {e}"))?;
    let tmp = path_security::safe_child_path(&downloads_dir, &file_name, &["jar"])
        .map_err(|e| format!("Invalid CurseForge file name: {e}"))?;
    download_file_to_path(&url, &tmp, None).await?;

    let mod_manager = ModManager::new(app_data_dir.clone());
    let target_rel = format!("mods/{}", file_name);
    let _ = mod_manager.install_mod_file(
        &instance_id,
        &tmp.to_string_lossy(),
        &target_rel,
        Some(mod_manager::ModMetadata {
            name: mod_name,
            version: None,
            description,
            source: Some("curseforge".to_string()),
            project_id: Some(mod_id.to_string()),
            version_id: Some(file_id.to_string()),
            author: None,
            homepage_url,
            cover_url,
            file_size,
            game_versions: game_versions.unwrap_or_default(),
            loaders: Vec::new(),
            updated_at,
        }),
    )?;
    let _ = content_provenance::record(
        &app_data_dir,
        &instance_id,
        &target_rel,
        content_provenance::ContentOrigin {
            provider: "curseforge".to_string(),
            project_id: mod_id.to_string(),
            version_id: file_id.to_string(),
            pinned: false,
        },
    );
    let _ = mod_manager.deploy(&instance_id, "minecraft", &instance.install_path)?;
    let _ = tokio::fs::remove_file(&tmp).await;
    Ok(target_rel)
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

#[tauri::command]
async fn resolve_mod_dependencies(
    app_handle: tauri::AppHandle,
    request: dependency_resolver::ResolveDependenciesRequest,
) -> Result<dependency_resolver::DependencyResolution, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = dependency_instance(&app_data_dir, &request.instance_id)?;
    let api_key = dependency_api_key(request.source)?;
    dependency_resolver::resolve_for_instance(&app_data_dir, &instance, &request, api_key).await
}

/// Installs the mod a jar is waiting for, named by its own manifest.
///
/// The compatibility notice has always known which mod is missing — the
/// sentence says so — and a sentence is not something anybody can act on
/// without leaving the launcher, finding the right project among the near
/// misses, and coming back. This looks the id up and hands it to the ordinary
/// install path, dependencies and all.
///
/// It refuses rather than guessing. A mod id that no catalogue publishes under
/// that name, or that only CurseForge has, comes back as "not found", because
/// installing something with a similar name is a worse outcome than the reader
/// being told to go and look.
#[tauri::command]
async fn install_missing_dependency(
    app_handle: tauri::AppHandle,
    instance_id: String,
    dependency_id: String,
) -> Result<dependency_resolver::DependencyInstallResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = dependency_instance(&app_data_dir, &instance_id)?;

    let found = missing_dependency::find(&dependency_id).await?.ok_or_else(|| {
        format!(
            "No catalogue publishes a mod called {dependency_id}. Search for it yourself: the mod that needs it names it exactly that way."
        )
    })?;

    let request = dependency_resolver::ResolveDependenciesRequest {
        instance_id,
        source: dependency_resolver::ModProvider::Modrinth,
        project_id: found.project_id,
        version_id: None,
        file_id: None,
        author: None,
    };
    let api_key = dependency_api_key(request.source)?;
    dependency_resolver::install_for_instance(&app_data_dir, &instance, &request, api_key).await
}

#[tauri::command]
async fn install_mod_with_dependencies(
    app_handle: tauri::AppHandle,
    request: dependency_resolver::ResolveDependenciesRequest,
) -> Result<dependency_resolver::DependencyInstallResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = dependency_instance(&app_data_dir, &request.instance_id)?;
    let api_key = dependency_api_key(request.source)?;
    dependency_resolver::install_for_instance(&app_data_dir, &instance, &request, api_key).await
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

/// Describes the instance exactly enough for someone else to rebuild it.
#[tauri::command]
fn lockfile_export(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<LockfileExport, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);

    let lock = lockfile::build(
        &instance.display_name,
        &chrono::Utc::now().to_rfc3339(),
        locked_runtime(&instance)?,
        &restore_points::inspect(&game_dir),
        &content_provenance::all(&app_data_dir, &instance_id),
    );

    Ok(LockfileExport {
        json: lockfile::to_json(&lock)?,
        file_count: lock.files.len(),
        unreproducible: lock
            .unreproducible()
            .into_iter()
            .map(|file| file.path.clone())
            .collect(),
    })
}

/// Writes the lockfile where the user chose.
#[tauri::command]
fn lockfile_save(
    app_handle: tauri::AppHandle,
    instance_id: String,
    destination: String,
) -> Result<String, String> {
    let export = lockfile_export(app_handle, instance_id)?;
    let path = PathBuf::from(&destination);
    std::fs::write(&path, export.json)
        .map_err(|error| format!("Could not write the lockfile: {error}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Reads a lockfile from disk and hands back its text.
///
/// It is parsed here first, so a file that is not a lockfile is refused at the
/// moment it is opened rather than at the moment a rebuild is attempted.
#[tauri::command]
fn lockfile_read(path: String) -> Result<String, String> {
    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the lockfile: {error}"))?;
    lockfile::parse(&raw)?;
    Ok(raw)
}

/// What separates this instance from the lockfile, right now.
#[tauri::command]
fn lockfile_diff(
    app_handle: tauri::AppHandle,
    instance_id: String,
    raw: String,
) -> Result<Vec<lockfile::DiffEntry>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let lock = lockfile::parse(&raw)?;
    Ok(lockfile::diff(&lock, &restore_points::inspect(&game_dir)))
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

/// Brings the instance to what the lockfile describes.
///
/// Extra files are left alone. Removing everything the lockfile does not mention
/// would delete a private mod, a personal config, or a resource pack the user
/// added on purpose â€” a rebuild is not a wipe.
#[tauri::command]
async fn lockfile_apply(
    app_handle: tauri::AppHandle,
    instance_id: String,
    raw: String,
) -> Result<LockfileApplied, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let lock = lockfile::parse(&raw)?;
    let report = lockfile::diff(&lock, &restore_points::inspect(&game_dir));

    let wanted: Vec<lockfile::DiffEntry> =
        lockfile::fetchable(&report).into_iter().cloned().collect();
    let unfetchable: Vec<String> = lockfile::unfetchable(&report)
        .into_iter()
        .map(|entry| entry.path.clone())
        .collect();

    if wanted.is_empty() {
        return Ok(LockfileApplied {
            restore_point_id: String::new(),
            installed: Vec::new(),
            failed: Vec::new(),
            unfetchable,
        });
    }

    let _guard = instance_lock::acquire(&instance_id, "rebuilding from a lockfile")?;
    let restore_point = restore_points::create(
        &app_data_dir,
        &instance_id,
        &game_dir,
        &format!("Before rebuilding from the lockfile {}", lock.name),
        None,
    )?;

    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;

    let mut installed = Vec::new();
    let mut failed = Vec::new();
    for entry in &wanted {
        match install_locked_file(&app_data_dir, &instance_id, &game_dir, &client, entry).await {
            Ok(()) => installed.push(entry.path.clone()),
            Err(error) => failed.push(format!("{}: {error}", entry.path)),
        }
    }

    Ok(LockfileApplied {
        restore_point_id: restore_point.id,
        installed,
        failed,
        unfetchable,
    })
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

#[tauri::command]
fn world_vault_worlds(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<world_vault::WorldSummary> {
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    world_vault::list_worlds(&app_data_dir, &instance_id, &game_dir)
}

#[tauri::command]
fn world_vault_checkpoints(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<world_vault::WorldCheckpoint> {
    world_vault::list_checkpoints(&app_data_dir(&app_handle), &instance_id)
}

/// Backs one world up. Refused while the game is running: a world copied
/// mid-save restores as a damaged world.
#[tauri::command]
fn world_vault_backup(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<AppState>,
    instance_id: String,
    folder: String,
    reason: String,
) -> Result<world_vault::WorldCheckpoint, String> {
    let running = instance_is_running(&app_state, &instance_id);
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let _guard = instance_lock::acquire(&instance_id, "backing up a world")?;
    world_vault::checkpoint(
        &app_data_dir,
        &instance_id,
        &game_dir,
        &folder,
        &reason,
        running,
    )
}

#[tauri::command]
fn world_vault_restore(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<AppState>,
    instance_id: String,
    checkpoint_id: String,
) -> Result<u64, String> {
    let running = instance_is_running(&app_state, &instance_id);
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let _guard = instance_lock::acquire(&instance_id, "restoring a world")?;
    world_vault::restore(
        &app_data_dir,
        &instance_id,
        &checkpoint_id,
        &game_dir,
        running,
    )
}

#[tauri::command]
fn world_vault_delete(
    app_handle: tauri::AppHandle,
    instance_id: String,
    checkpoint_id: String,
) -> Result<Vec<world_vault::WorldCheckpoint>, String> {
    world_vault::delete(&app_data_dir(&app_handle), &instance_id, &checkpoint_id)
}

/// Trims the backups of one world. Retention is per world, so trimming the world
/// being played never deletes the only backup of one that is not.
#[tauri::command]
fn world_vault_prune(
    app_handle: tauri::AppHandle,
    instance_id: String,
    folder: String,
    keep: usize,
) -> Result<usize, String> {
    world_vault::prune(&app_data_dir(&app_handle), &instance_id, &folder, keep)
}

#[tauri::command]
async fn world_vault_stored_bytes(app_handle: tauri::AppHandle) -> u64 {
    let dir = app_data_dir(&app_handle);
    // Walks every stored object; the vault grows with each backup.
    off_thread(move || Ok(world_vault::stored_bytes(&dir)))
        .await
        .unwrap_or(0)
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
        eprintln!("Could not prepare the next safe mode launch: {error}");
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

#[tauri::command]
fn performance_report(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<PerformanceReport, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    let minecraft = instance
        .minecraft
        .as_ref()
        .ok_or("Only Minecraft instances have performance advice.")?;

    let jvm_args = minecraft_manager::effective_java_args(&app_data_dir, &instance_id);
    let (xms_mb, xmx_mb) = performance_advisor::parse_heap_args(&jvm_args);
    // The version JSON is the authority on the Java a version needs; an instance
    // may override it, and the override is what actually runs.
    let recommended =
        minecraft_manager::declared_java_major(&app_data_dir, &minecraft.mc_version).unwrap_or(8);
    let java_major = minecraft.java_major.unwrap_or(recommended);

    // The jar names, not the display names: a mod is recognised by the file the
    // loader actually sees.
    let mods: Vec<String> = ModManager::new(app_data_dir.clone())
        .load_mods(&instance_id)
        .into_iter()
        .filter(|installed| installed.enabled)
        .flat_map(|installed| installed.files)
        .collect();

    let runs = performance_advisor::runs(&app_data_dir, &instance_id);
    let comparison = runs.first().and_then(|latest| {
        performance_advisor::baseline_for(&runs, latest)
            .map(|baseline| performance_advisor::compare(baseline, latest))
    });

    let observation = performance_advisor::Observation {
        total_ram_mb: minecraft_manager::system_total_memory_mb(),
        xmx_mb,
        xms_mb,
        jvm_args,
        java_major,
        recommended_java_major: recommended,
        mc_minor: minecraft_version_minor(&minecraft.mc_version),
        loader: loader_name(&minecraft.loader).to_string(),
        mods,
        gc: runs.first().and_then(|run| run.gc.clone()),
        seconds_to_menu: runs.first().and_then(|run| run.seconds_to_menu),
    };

    Ok(PerformanceReport {
        advice: performance_advisor::analyse(&observation),
        xms_mb,
        xmx_mb,
        total_ram_mb: observation.total_ram_mb,
        java_major,
        comparison,
        runs,
        measuring_next_launch: performance_advisor::measurement_requested(
            &app_data_dir,
            &instance_id,
        ),
    })
}

/// Asks for the next launch of this instance to be measured.
#[tauri::command]
fn performance_measure_next_launch(
    app_handle: tauri::AppHandle,
    instance_id: String,
    wanted: bool,
) -> Result<(), String> {
    performance_advisor::request_measurement(&app_data_dir(&app_handle), &instance_id, wanted)
}

/// Applies one piece of advice the user accepted.
///
/// Only the settings changes are applied here. Installing or removing a mod goes
/// through the normal mod flows, which ask for confirmation and record where the
/// file came from.
#[tauri::command]
fn performance_apply_advice(
    app_handle: tauri::AppHandle,
    instance_id: String,
    action: performance_advisor::AdviceAction,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    match action {
        performance_advisor::AdviceAction::SetMaxMemory(mb) => {
            set_instance_memory(&app_data_dir, &instance_id, None, Some(mb))
        }
        performance_advisor::AdviceAction::SetMinMemory(mb) => {
            set_instance_memory(&app_data_dir, &instance_id, Some(mb), None)
        }
        // Clearing the override puts the instance back on the Java its version
        // declares, which is what the advice is asking for.
        performance_advisor::AdviceAction::UseJava(_) => {
            minecraft_manager::set_minecraft_instance_java(&app_data_dir, &instance_id, None)
                .map(|_| ())
        }
        // A mod is content, not a setting: it goes through the flows that ask
        // first and record where the file came from.
        performance_advisor::AdviceAction::InstallMod(_)
        | performance_advisor::AdviceAction::RemoveMod(_) => {
            Err("This one is done from the Mods tab.".to_string())
        }
    }
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
const ALREADY_ON_THE_WINDOW_THREAD: [&str; 107] = [
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
    "get_performance_profiles",
    "get_running_minecraft_instances",
    "import_minecraft_content",
    "import_shaderpack",
    "instance_cover",
    "instance_play_history",
    "is_iris_installed",
    "launch_at_startup_enabled",
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
    "server_hub_add",
    "server_hub_import_from_instance",
    "server_hub_list",
    "server_hub_remove",
    "server_hub_set_instance",
    "set_downloads_paused",
    "set_instance_cover",
    "set_launch_at_startup",
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
        let source = include_str!("lib.rs");
        let commands = commands(source);

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
        let source = include_str!("lib.rs");
        let ledger: BTreeSet<&str> = ALREADY_ON_THE_WINDOW_THREAD.iter().copied().collect();

        let unlisted: Vec<String> = commands(source)
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
        let source = include_str!("lib.rs");
        let synchronous: BTreeSet<String> = commands(source)
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

/// What Kiza occupies on disk, measured rather than estimated.
///
/// Every figure comes from walking the directories that exist. A storage page
/// that guesses invites the user to free space that was never taken, or leaves
/// them hunting for gigabytes it failed to mention.
#[tauri::command]
async fn storage_usage(
    app_handle: tauri::AppHandle,
) -> Result<storage_report::StorageReport, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || Ok(storage_report::report(&app_data_dir))).await
}

/// Empties the caches the user asked for.
///
/// Which folders may be emptied is decided in `storage_report`, not here and
/// not by the interface: worlds, instances and backups are the things that
/// cannot be downloaded again, and they are never on the list whatever is
/// asked for.
#[tauri::command]
async fn reclaim_storage(app_handle: tauri::AppHandle, ids: Vec<String>) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    // Deleting thousands of cached files is no quicker than counting them.
    off_thread(move || storage_report::reclaim(&app_data_dir, &ids)).await
}

/// Opens one of Kiza's own folders in Explorer.
///
/// The name is resolved here rather than taken as a path, so the interface can
/// never ask the launcher to open an arbitrary directory on the machine.
#[tauri::command]
fn open_kiza_folder(app_handle: tauri::AppHandle, folder: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;

    let path = match folder.as_str() {
        "root" => app_data_dir,
        "logs" => app_data_dir.join("logs"),
        "instances" => app_data_dir.join("minecraft").join("instances"),
        "downloads" => app_data_dir.join("downloads"),
        "world-backups" => app_data_dir.join("world-vault"),
        other => return Err(format!("Kiza has no folder called {other}.")),
    };

    // Created if it has never been used, so the button opens a window rather
    // than reporting an error the user can do nothing about.
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("Could not open {}: {error}", path.display()))?;

    tauri_plugin_opener::open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| format!("Could not open the folder: {error}"))
}

/// Sends one notification on behalf of the interface.
///
/// The frontend decides *whether* to notify — that is where the switches, the
/// quiet hours and the running-game check live, in `lib/notifications.ts`. This
/// only carries the message to Windows, so there is exactly one place in the
/// codebase that touches the tray.
#[tauri::command]
fn send_notification(
    app_handle: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app_handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("Windows refused the notification: {error}"))
}

/// Sends one notification, so the user can see whether Windows lets them
/// through at all.
///
/// Notifications are the one setting a launcher cannot verify for itself:
/// Focus Assist, a per-app block in Windows settings, or a policy can swallow
/// every one of them while every switch here still reads "on". A button that
/// produces a visible result is the only honest answer to "is this working".
#[tauri::command]
fn send_test_notification(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app_handle
        .notification()
        .builder()
        .title("Kiza Launcher")
        .body("Notifications are getting through.")
        .show()
        .map_err(|error| format!("Windows refused the notification: {error}"))
}

/// Whether Windows is in a position to show a Kiza notification at all.
///
/// `show()` returning `Ok` proves nothing: a toast sent under an AppUserModelID
/// Windows cannot resolve is dropped without an error, which is precisely the
/// failure that made every notification vanish. So the interface asks this
/// first, and can say "the shortcut is missing" instead of leaving the reader
/// to suspect Focus Assist, a policy, or Kiza itself.
#[tauri::command]
async fn notification_readiness() -> windows_identity::Registration {
    off_thread(|| {
        let executable = std::env::current_exe().unwrap_or_default();
        let Some(programs) = windows_identity::start_menu_programs() else {
            return Ok(windows_identity::Registration::default());
        };
        Ok(windows_identity::ensure(
            &executable,
            &windows_identity::shortcut_path(&programs),
        ))
    })
    .await
    .unwrap_or_default()
}

/// What the logs folder holds right now.
#[tauri::command]
async fn logs_overview(app_handle: tauri::AppHandle) -> Result<diagnostics::LogsOverview, String> {
    let logs = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?
        .join("logs");
    off_thread(move || Ok(diagnostics::overview(&logs))).await
}

/// Deletes log files older than the retention period the user chose.
///
/// Called from the settings page and once at startup, so a retention period set
/// months ago keeps being honoured by a launcher whose settings nobody opens.
#[tauri::command]
async fn prune_logs(
    app_handle: tauri::AppHandle,
    keep_days: u32,
) -> Result<diagnostics::Pruned, String> {
    let logs = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?
        .join("logs");
    off_thread(move || Ok(diagnostics::prune(&logs, keep_days))).await
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

/// What this machine is, and how much room is left on the drive Kiza is on.
///
/// Read fresh each time rather than cached: free space is the one figure here
/// that changes while the window is open, and a stale reading is worse than a
/// slow one on a page someone opened to decide whether to delete something.
#[tauri::command]
async fn system_report(
    app_handle: tauri::AppHandle,
) -> Result<system_report::SystemReport, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    // Enumerating drives touches the disk, and one that is asleep takes its
    // time about answering.
    off_thread(move || Ok(system_report::collect(&app_data_dir))).await
}

/// The reachability grid on the Connections page.
#[tauri::command]
async fn check_services() -> Vec<ServiceCheck> {
    check_services_inner().await
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

#[tauri::command]
async fn export_diagnostics(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    let text = diagnostic_text(&app_handle).await?;

    let written = off_thread(move || {
        let destination = app_data_dir.join("diagnostics");
        std::fs::create_dir_all(&destination)
            .map_err(|error| format!("Could not create the diagnostics folder: {error}"))?;

        let path = diagnostics::report_path(&destination, std::time::SystemTime::now());
        std::fs::write(&path, text)
            .map_err(|error| format!("Could not write the report: {error}"))?;
        Ok(path)
    })
    .await?;

    // Revealed rather than opened in an editor: the user is about to attach it
    // to a message, and what they need is the file, not its contents in yet
    // another window.
    let _ = tauri_plugin_opener::reveal_item_in_dir(&written);
    Ok(written.to_string_lossy().to_string())
}

/// Deletes cached files that have not been touched for the chosen period.
///
/// The automatic half of the storage housekeeping, as opposed to
/// `clear_metadata_cache`, which empties the lot on request.
#[tauri::command]
async fn prune_cache(app_handle: tauri::AppHandle, keep_days: u32) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || Ok(storage_report::prune_cache(&app_data_dir, keep_days))).await
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

/// How long is left before another report may be sent.
#[tauri::command]
fn support_cooldown_seconds(app_handle: tauri::AppHandle) -> u64 {
    let Ok(app_data_dir) = app_handle.path().app_data_dir() else {
        return 0;
    };
    support::remaining_cooldown(&app_data_dir, std::time::SystemTime::now())
        .map(|left| left.as_secs())
        .unwrap_or(0)
}

/// Builds exactly what a report would send, without sending it.
///
/// The settings page shows this before the button is pressed. Someone about to
/// hand over a description of their problem is entitled to read it back first,
/// including what the redaction did to it.
#[tauri::command]
async fn support_preview(
    app_handle: tauri::AppHandle,
    draft: support::TicketDraft,
) -> Result<support::TicketPayload, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    let version = app_handle.package_info().version.to_string();

    // The facts are collected whether or not the full report travels: the
    // triage card carries them either way, and they are what makes a report
    // worth opening at all.
    let facts = diagnostic_facts(&app_handle).await?;
    let system = {
        let dir = app_data_dir.clone();
        off_thread(move || Ok(system_report::collect(&dir))).await?
    };
    let triage = triage_facts(&facts, &system);
    let diagnostic = draft
        .include_diagnostic
        .then(|| diagnostics::render(&facts));

    off_thread(move || {
        let config = ConfigManager::new(app_data_dir.clone()).load_config();
        let install = system_report::short_id(&system_report::install_id(&app_data_dir));
        support::prepare(
            &draft,
            diagnostic,
            &version,
            &config.update_channel,
            &install,
            triage,
        )
    })
    .await
}

/// Sends a report, and returns the reference the service gave back.
#[tauri::command]
async fn support_submit(
    app_handle: tauri::AppHandle,
    draft: support::TicketDraft,
) -> Result<support::TicketSent, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;

    if let Some(left) = support::remaining_cooldown(&app_data_dir, std::time::SystemTime::now()) {
        return Err(format!(
            "Another report can be sent in {} seconds.",
            left.as_secs()
        ));
    }

    let endpoint = support_endpoint(&app_handle)
        .ok_or_else(|| "This build has no support service to report to.".to_string())?;
    let payload = support_preview(app_handle.clone(), draft).await?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not prepare the request: {error}"))?;

    let response = client
        .post(&endpoint)
        .json(&payload)
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

    support::record_sent(&app_data_dir, std::time::SystemTime::now());
    Ok(support::TicketSent { reference })
}

/// Empties the metadata cache and reports how many bytes went.
///
/// Which folders may be emptied is decided in `storage_report`, which is where
/// that rule lives for every other caller too.
#[tauri::command]
async fn clear_metadata_cache(app_handle: tauri::AppHandle) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || storage_report::reclaim(&app_data_dir, &["cache".to_string()])).await
}

/// Re-reads every instance from disk and reports how many were found.
///
/// The one repair for an instance list gone stale — a folder renamed by hand, a
/// copy dropped in, an entry left behind by a delete that failed halfway —
/// without touching a single file.
#[tauri::command]
async fn rebuild_instance_index(app_handle: tauri::AppHandle) -> Result<usize, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || Ok(GameManager::new(app_data_dir).list_instances().len())).await
}

/// Holds or releases the download queue.
///
/// Called by the interface when the game starts and stops, if the user has
/// asked for downloads to wait. Transfers already running are left to finish:
/// tearing one down halfway throws away the bytes it had already fetched, and
/// the point of this is to stop competing for bandwidth, which a transfer in
/// its last second is barely doing.
#[tauri::command]
fn set_downloads_paused(app_state: tauri::State<'_, AppState>, paused: bool) {
    app_state.download_manager.set_paused(paused);
}

#[tauri::command]
fn downloads_paused(app_state: tauri::State<'_, AppState>) -> bool {
    app_state.download_manager.is_paused()
}

/// The range the download queue actually honours, so the interface does not
/// have to guess it or repeat it.
#[tauri::command]
fn download_concurrency_range() -> (usize, usize) {
    (
        download_manager::MIN_CONCURRENCY,
        download_manager::MAX_CONCURRENCY,
    )
}

/// Puts every launcher setting back to its default.
///
/// Settings only. Instances, worlds and saved accounts are not touched and are
/// not reachable from here — someone clicking "reset" on a settings page is
/// asking about settings, and a button that also removed their worlds would be
/// the worst kind of surprise.
///
/// Returns the configuration as it now stands, so the interface redraws from
/// the truth rather than from what it assumed the defaults were.
#[tauri::command]
async fn reset_app_config(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
) -> Result<AppConfig, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;

    let defaults = AppConfig::default();
    {
        let to_write = defaults.clone();
        off_thread(move || ConfigManager::new(app_data_dir).save_config(&to_write)).await?;
    }

    // The live side effects of the settings that have them, so the reset is
    // true immediately rather than at the next launch.
    app_state
        .download_manager
        .set_concurrency(defaults.download_concurrency as usize);
    app_state
        .download_manager
        .set_max_attempts(defaults.download_attempts);
    if defaults.enable_discord_rpc {
        app_state.discord_manager.connect();
    } else {
        app_state.discord_manager.disconnect();
    }

    Ok(defaults)
}
