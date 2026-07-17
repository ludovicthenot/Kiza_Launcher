mod app_error;
mod base_mod;
mod config_manager;
mod credential_store;
mod curseforge_api;
mod dependency_resolver;
mod discord_rpc;
mod download_manager;
mod forge;
mod game_manager;
mod minecraft_auth;
mod minecraft_manager;
mod mod_compat;
mod mod_manager;
mod modrinth_api;
mod nexus_api;
mod path_security;
mod setup_manager;

use app_error::AppError;
use config_manager::{AppConfig, ConfigManager};
use discord_rpc::DiscordManager;
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
use uuid::Uuid;

const DEFAULT_MICROSOFT_CLIENT_ID: &str = "3f1d7c79-7a79-45fc-a9e0-41d93e680009";

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

#[tauri::command]
fn get_app_config(app_handle: tauri::AppHandle) -> AppConfig {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ConfigManager::new(app_data_dir);
    manager.load_config()
}

#[tauri::command]
fn save_app_config(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<AppState>,
    config: AppConfig,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ConfigManager::new(app_data_dir);
    let mut config_to_save = config.clone();

    if let Some(api_key) = config_to_save.nexus_api_key.take() {
        if !api_key.trim().is_empty() {
            credential_store::set_secret(credential_store::NEXUS_API_KEY, &api_key)
                .map_err(|e| e.message)?;
        }
    }

    // Side Effect: Toggle Discord RPC based on new config
    if config.enable_discord_rpc {
        app_state.discord_manager.connect();
    } else {
        app_state.discord_manager.disconnect();
    }

    manager.save_config(&config_to_save)
}

#[tauri::command]
fn get_first_run_setup(app_handle: tauri::AppHandle) -> setup_manager::FirstRunSetupState {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    setup_manager::load_setup_state(&app_data_dir)
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
        "microsoft" | "minecraft" => Some(credential_store::MICROSOFT_CLIENT_ID),
        _ => None,
    }
}

fn microsoft_client_id() -> Result<String, String> {
    if let Some(value) = credential_store::get_secret_or_env(
        credential_store::MICROSOFT_CLIENT_ID,
        "MICROSOFT_CLIENT_ID",
    )
    .map_err(|e| e.message)?
    {
        return Ok(value);
    }

    Ok(option_env!("KIZAMODS_MICROSOFT_CLIENT_ID")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_MICROSOFT_CLIENT_ID)
        .to_string())
}

fn curseforge_api_key() -> Result<String, String> {
    if let Some(value) = credential_store::get_secret_or_env(
        credential_store::CURSEFORGE_API_KEY,
        "CURSEFORGE_API_KEY",
    )
    .map_err(|e| e.message)?
    {
        return Ok(value);
    }

    bundled_curseforge_api_key().ok_or("CurseForge is not configured".to_string())
}

#[tauri::command]
fn get_api_connections(app_handle: tauri::AppHandle) -> Vec<ApiConnectionStatus> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let minecraft_account =
        minecraft_auth::load_auth_state(&app_data_dir).map(|state| state.account.username);
    let curseforge_keyring = credential_store::configured(credential_store::CURSEFORGE_API_KEY);
    let curseforge_env =
        std::env::var("CURSEFORGE_API_KEY").is_ok() || bundled_curseforge_api_key().is_some();
    let curseforge_bundled = bundled_curseforge_api_key().is_some();
    let microsoft_configured = microsoft_client_id().is_ok();
    let microsoft_detail = minecraft_account
        .as_deref()
        .map(|name| format!("Minecraft account connected: {name}."))
        .unwrap_or_else(|| {
            "Browser OAuth configured. Online Minecraft login requires a Microsoft App ID approved for Minecraft Services.".to_string()
        });

    vec![
        connection_status(
            "curseforge",
            "CurseForge",
            "api_key",
            curseforge_keyring || curseforge_env || curseforge_bundled,
            if curseforge_keyring || curseforge_env || curseforge_bundled {
                "configured"
            } else {
                "missing"
            },
            if curseforge_keyring {
                "Key stored in the OS vault."
            } else if curseforge_env {
                "Key provided via environment variable."
            } else {
                "No CurseForge key saved."
            },
            Some("Add a CurseForge key for search and download URLs."),
        ),
        connection_status(
            "microsoft",
            "Microsoft / Minecraft",
            "browser_oauth",
            microsoft_configured || minecraft_account.is_some(),
            if minecraft_account.is_some() {
                "connected"
            } else if microsoft_configured {
                "configured"
            } else {
                "offline_ready"
            },
            &microsoft_detail,
            Some("If Minecraft returns 403, submit the Azure App ID at https://aka.ms/mce-reviewappid."),
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
        AppError::config(
            "Provider API inconnu.",
            "Choisissez Nexus, CurseForge ou Microsoft.",
        )
    })?;

    if secret.is_empty() {
        return Err(AppError::config(
            "The secret cannot be empty.",
            "Paste a valid API key or client ID.",
        ));
    }

    if provider == "nexus" {
        let client = NexusClient::new(secret.to_string()).map_err(AppError::from)?;
        client
            .validate_key()
            .await
            .map_err(|e| map_api_error("Nexus", e))?;
    } else if provider == "curseforge" {
        curseforge_api::search_mods(secret, "minecraft", None, None, 1, 0)
            .await
            .map_err(|e| map_api_error("CurseForge", e))?;
    } else if provider == "microsoft" || provider == "minecraft" {
        Uuid::parse_str(secret).map_err(|_| {
            AppError::config(
                "Client ID Microsoft invalide.",
                "Collez l'Application (client) ID Azure, au format UUID.",
            )
        })?;
    }

    credential_store::set_secret(secret_name, secret)?;
    Ok(connection_status(
        &provider,
        match provider.as_str() {
            "nexus" => "Nexus Mods",
            "curseforge" => "CurseForge",
            "microsoft" | "minecraft" => "Microsoft / Minecraft",
            _ => "API",
        },
        if provider == "microsoft" || provider == "minecraft" {
            "browser_oauth"
        } else {
            "api_key"
        },
        true,
        "configured",
        if provider == "microsoft" || provider == "minecraft" {
            "Microsoft Client ID stored in the OS credential vault."
        } else {
            "Secret stored in the OS credential manager."
        },
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
            let result = curseforge_api::search_mods(&key, "minecraft", None, None, 1, 0)
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
        "microsoft" | "minecraft" => {
            let client_id = secret
                .as_ref()
                .filter(|value| !value.trim().is_empty())
                .cloned()
                .unwrap_or(microsoft_client_id().map_err(AppError::from)?);
            Uuid::parse_str(client_id.trim()).map_err(|_| {
                AppError::config(
                    "Client ID Microsoft invalide.",
                    "Collez l'Application (client) ID Azure, au format UUID.",
                )
            })?;
            Ok(connection_status(
                "microsoft",
                "Microsoft / Minecraft",
                "browser_oauth",
                true,
                "configured",
                "Client ID format valid. Minecraft online login also requires App ID approval by Minecraft Services.",
                Some("If login returns 403, submit the Azure App ID at https://aka.ms/mce-reviewappid."),
            ))
        }
        _ => Err(AppError::config(
            "Provider API inconnu.",
            "Choisissez Nexus, Modrinth, CurseForge ou Microsoft.",
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
) {
    if let Some(id) = instance_id {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let game_manager = GameManager::new(app_data_dir);
        if let Ok(instance) = game_manager.get_instance_by_id(&id) {
            if let Some(mc) = instance.minecraft.as_ref() {
                let loader = match mc.loader {
                    game_manager::MinecraftLoader::Fabric => "Fabric",
                    game_manager::MinecraftLoader::Forge => "Forge",
                    game_manager::MinecraftLoader::Vanilla => "Vanilla",
                };
                app_state.discord_manager.update_presence(
                    format!("Minecraft {}", mc.mc_version),
                    format!("In the launcher menu - {loader}"),
                );
            } else {
                app_state.discord_manager.update_presence(
                    "Kiza Launcher Alpha".to_string(),
                    "In the launcher menu".to_string(),
                );
            }
        }
    } else {
        app_state.discord_manager.update_presence(
            "Kiza Launcher Alpha".to_string(),
            "In the launcher menu".to_string(),
        );
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
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
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle();
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            // Config Load
            let config_manager = ConfigManager::new(app_data_dir.clone());
            let config = config_manager.load_config();

            let discord_manager = Arc::new(DiscordManager::new());
            if config.enable_discord_rpc {
                discord_manager.connect();
            }

            let download_manager = Arc::new(DownloadManager::new(
                Some(app_handle.clone()),
                Some(app_data_dir.join("config").join("downloads.json")),
            ));
            let minecraft_install_manager = Arc::new(MinecraftInstallManager::new());
            let minecraft_auth_manager = Arc::new(MinecraftAuthManager::new());

            app.manage(AppState {
                download_manager,
                discord_manager,
                minecraft_install_manager,
                minecraft_auth_manager,
                launch_manager: Arc::new(minecraft_manager::LaunchManager::new()),
                running_games: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            });

            // System Tray
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
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
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Check for NXM link in args
            let args: Vec<String> = std::env::args().collect();
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
            detect_minecraft_runtime,
            install_minecraft_runtime,
            get_performance_profiles,
            get_instance_performance_profile,
            save_instance_performance_profile,
            create_minecraft_instance_cmd,
            rename_minecraft_instance_cmd,
            set_minecraft_instance_version_cmd,
            delete_minecraft_instance_cmd,
            open_instance_folder,
            check_mod_compatibility,
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
            get_running_minecraft_instances,
            get_launch_status,
            read_instance_log,
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
            curseforge_list_files,
            curseforge_install_file,
            resolve_mod_dependencies,
            install_mod_with_dependencies,
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
fn detect_minecraft_runtime(
    app_handle: tauri::AppHandle,
    mc_version: Option<String>,
) -> minecraft_manager::MinecraftRuntimeStatus {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::detect_minecraft_runtime(&app_data_dir, mc_version.as_deref())
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

#[tauri::command]
async fn create_minecraft_instance_cmd(
    app_handle: tauri::AppHandle,
    display_name: String,
    mc_version: String,
    loader: game_manager::MinecraftLoader,
    loader_version: Option<String>,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let loader_version = match loader {
        game_manager::MinecraftLoader::Fabric => {
            Some(minecraft_manager::resolve_fabric_loader_version(loader_version.as_deref()).await)
        }
        game_manager::MinecraftLoader::Forge => {
            let client = reqwest::Client::builder()
                .user_agent("KizaLauncherAlpha/0.1")
                .build()
                .map_err(|error| format!("Forge: failed to create HTTP client: {error}"))?;
            Some(
                forge::resolve_version(
                    &app_data_dir,
                    &client,
                    &mc_version,
                    loader_version.as_deref(),
                )
                .await?,
            )
        }
        game_manager::MinecraftLoader::Vanilla => None,
    };
    minecraft_manager::create_minecraft_instance(
        &app_data_dir,
        display_name,
        mc_version,
        loader,
        loader_version,
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
    match loader {
        MinecraftLoader::Vanilla => "vanilla",
        MinecraftLoader::Fabric => "fabric",
        MinecraftLoader::Forge => "forge",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShaderEngine {
    Iris,
}

impl ShaderEngine {
    fn modrinth_category(self) -> &'static str {
        match self {
            Self::Iris => "iris",
        }
    }
}

fn shader_engine_for_loader(loader: &MinecraftLoader) -> Option<ShaderEngine> {
    match loader {
        MinecraftLoader::Fabric => Some(ShaderEngine::Iris),
        MinecraftLoader::Vanilla | MinecraftLoader::Forge => None,
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
    let mods_dir = PathBuf::from(&instance.install_path).join("mods");
    let found = std::fs::read_dir(&mods_dir)
        .map(|entries| {
            entries.flatten().any(|entry| {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                name.starts_with("iris") && name.ends_with(".jar")
            })
        })
        .unwrap_or(false);
    Ok(found)
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

    let versions = modrinth_api::get_versions("iris").await?;
    let version = versions
        .iter()
        .find(|version| {
            modrinth_api::version_matches_context(version, &minecraft.mc_version, "fabric")
        })
        .ok_or_else(|| {
            format!(
                "No Iris build matches Minecraft {} and Fabric.",
                minecraft.mc_version
            )
        })?;
    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or("This Iris version has no downloadable file.".to_string())?;

    let mods_dir = PathBuf::from(&instance.install_path).join("mods");
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
    fn iris_is_only_available_for_fabric_instances() {
        assert_eq!(
            shader_engine_for_loader(&MinecraftLoader::Fabric),
            Some(ShaderEngine::Iris)
        );
        assert_eq!(shader_engine_for_loader(&MinecraftLoader::Forge), None);
        assert_eq!(shader_engine_for_loader(&MinecraftLoader::Vanilla), None);
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
) -> Result<minecraft_manager::MinecraftLaunchResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.status != game_manager::GameInstanceStatus::Valid {
        return Err("Instance is not valid".to_string());
    }
    minecraft_manager::require_minecraft_launch_ready(
        &app_data_dir,
        &app_state.minecraft_install_manager,
        &instance,
    )?;
    let instance = minecraft_manager::prepare_minecraft_loader(&app_data_dir, instance).await?;

    let mut launch_username = username;
    let mut launch_uuid = None;
    let mut launch_access_token = None;
    let mut launch_user_type = None;

    if instance.game_id == "minecraft" {
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
            .map(|mc| {
                let loader = match mc.loader {
                    game_manager::MinecraftLoader::Fabric => "Fabric",
                    game_manager::MinecraftLoader::Forge => "Forge",
                    game_manager::MinecraftLoader::Vanilla => "Vanilla",
                };
                format!("Minecraft {} ({loader})", mc.mc_version)
            })
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
    app_state.discord_manager.update_presence_with_start(
        presence_details.clone(),
        presence_state.clone(),
        Some(presence_start),
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

    // Watch the game process so the UI and Discord presence reflect when the
    // game actually exits, and surface a crash instead of failing silently.
    let running_games = app_state.running_games.clone();
    let discord_manager = app_state.discord_manager.clone();
    let log_path = result.log_path.clone();
    let watcher_app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut last_player_state = None;
        let exit = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {
                    let player_state = state_bridge
                        .as_ref()
                        .and_then(|bridge| bridge.read_state().ok().flatten());
                    if player_state != last_player_state {
                        match player_state {
                            Some(state) => discord_manager.update_minecraft_presence(
                                presence_details.clone(),
                                presence_instance_name.clone(),
                                state,
                                presence_start,
                            ),
                            None if last_player_state.is_some() => {
                                discord_manager.update_presence_with_start(
                                    presence_details.clone(),
                                    presence_state.clone(),
                                    Some(presence_start),
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
        if let Ok(mut running) = running_games.lock() {
            running.remove(&watched_instance_id);
            if running.is_empty() {
                discord_manager.update_presence(
                    "Kiza Launcher Alpha".to_string(),
                    "In the launcher menu".to_string(),
                );
            }
        }
        // Bring the launcher back once the game is over — unless the console
        // window is open, in which case the user returns from there. Keep the
        // console up so the final logs (and any crash) stay visible.
        let console_open = watcher_app.get_webview_window("console").is_some();
        if hide_to_tray && !console_open {
            if let Some(window) = watcher_app.get_webview_window("main") {
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
        }),
    )?;
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
async fn modrinth_search_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<modrinth_api::ModrinthSearchResponse, String> {
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    modrinth_api::search(
        &query,
        Some(&minecraft.mc_version),
        Some(minecraft_loader_name(&minecraft.loader)),
        limit.unwrap_or(20),
        offset.unwrap_or(0),
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
async fn curseforge_search_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
    query: String,
    page_size: Option<u32>,
    index: Option<u32>,
) -> Result<curseforge_api::CurseForgeSearchResponse, String> {
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    let key = curseforge_api_key()?;
    curseforge_api::search_mods(
        &key,
        &query,
        Some(&minecraft.mc_version),
        Some(minecraft_loader_name(&minecraft.loader)),
        page_size.unwrap_or(20),
        index.unwrap_or(0),
    )
    .await
}

#[tauri::command]
async fn curseforge_list_files(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: u64,
    page_size: Option<u32>,
    index: Option<u32>,
) -> Result<curseforge_api::CurseForgeFilesResponse, String> {
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    let key = curseforge_api_key()?;
    curseforge_api::list_files(
        &key,
        mod_id,
        Some(&minecraft.mc_version),
        Some(minecraft_loader_name(&minecraft.loader)),
        page_size.unwrap_or(20),
        index.unwrap_or(0),
    )
    .await
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
    let url = curseforge_api::get_download_url(&key, mod_id, file_id).await?;

    let game_manager = GameManager::new(app_data_dir.clone());
    let instance = game_manager.verify_instance(&instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("Not a Minecraft instance".to_string());
    }
    let downloads_dir = app_data_dir.join("downloads").join("minecraft");
    let raw_file_name = file_name.unwrap_or_else(|| format!("curseforge-{file_id}.jar"));
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
            author: None,
            homepage_url,
            cover_url,
            file_size,
            game_versions: game_versions.unwrap_or_default(),
            loaders: Vec::new(),
            updated_at,
        }),
    )?;
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
