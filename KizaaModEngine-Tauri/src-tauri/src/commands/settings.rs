//! The launcher itself: settings, downloads, Java, themes, diagnostics and support.
//!
//! Commands only: the interface's entry points, moved out of the crate root
//! so that file is a table of contents rather than the whole book. Helpers
//! and state stay where they were and are reached through the glob below;
//! a child module sees everything its parent does.

#![allow(unused_imports)]

use crate::*;
use crate::commands::mods::install_mod;

/// The page says the library is on screen; the launcher writes down how
/// long that took from the moment the process began. One line per start,
/// in launcher.log, so a slow machine's number is there to be read rather
/// than guessed at.
#[tauri::command]
pub(crate) async fn interface_ready(page_ms: f64) -> Result<(), String> {
    let since_start = LAUNCHED_AT
        .get()
        .map(|at| at.elapsed().as_millis())
        .unwrap_or(0);
    crate::log_info!(
        "Startup",
        "Interface ready {since_start} ms after the process began ({page_ms:.0} ms after the page started)."
    );
    Ok(())
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
pub(crate) async fn get_app_config(app_handle: tauri::AppHandle) -> AppConfig {
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
/// a file.
/// store; doing either between two frames is what made the settings dialogue
/// stutter on every switch and lock solid on a slider drag. The debounce in
/// front of it reduced how often that happened without changing what happened.
///
/// The in-memory side effects stay on this side of the thread hop because they
/// are three atomic stores and a channel send, and they must have taken effect
/// by the time the call returns.
#[tauri::command]
pub(crate) async fn save_app_config(
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

    off_thread(move || ConfigManager::new(app_data_dir).save_config(&config)).await
}

#[tauri::command]
pub(crate) async fn get_first_run_setup(app_handle: tauri::AppHandle) -> setup_manager::FirstRunSetupState {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    off_thread(move || Ok(setup_manager::load_setup_state(&app_data_dir)))
        .await
        .unwrap_or_default()
}

#[tauri::command(async)]
pub(crate) fn save_first_run_setup(
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

#[tauri::command(async)]
pub(crate) fn complete_first_run_setup(
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

/// Which content services this build can reach.
///
/// `async` because deciding it means asking the Windows credential store
/// whether a CurseForge key is stored, and the credential store is an
/// out-of-process call. The settings dialogue asks for this the moment it
/// opens, so on the main thread it was a stall on every open.
#[tauri::command]
pub(crate) async fn get_api_connections() -> Vec<ApiConnectionStatus> {
    off_thread(|| Ok(api_connections()))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) async fn save_api_connection(
    provider: String,
    secret: String,
) -> Result<ApiConnectionStatus, AppError> {
    let provider = provider.to_lowercase();
    let secret = secret.trim();
    let secret_name = provider_secret_name(&provider)
        .ok_or_else(|| AppError::config("Provider API inconnu.", "Choisissez CurseForge."))?;

    if secret.is_empty() {
        return Err(AppError::config(
            "The secret cannot be empty.",
            "Paste a valid API key.",
        ));
    }

    if provider == "curseforge" {
        curseforge_api::search_mods(
            secret,
            "minecraft",
            6,
            &curseforge_api::SearchFilters::default(),
            1,
            0,
            None,
        )
        .await
        .map_err(|e| map_api_error("CurseForge", e))?;
    }

    credential_store::set_secret(secret_name, secret)?;
    Ok(connection_status(
        &provider,
        match provider.as_str() {
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
pub(crate) async fn validate_api_connection(
    provider: String,
    secret: Option<String>,
) -> Result<ApiConnectionStatus, AppError> {
    let provider = provider.to_lowercase();
    match provider.as_str() {
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
            let result = curseforge_api::search_mods(
                &key,
                "minecraft",
                6,
                &curseforge_api::SearchFilters::default(),
                1,
                0,
                None,
            )
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
            "Choisissez Modrinth ou CurseForge.",
        )),
    }
}

#[tauri::command(async)]
pub(crate) fn remove_api_connection(provider: String) -> Result<(), AppError> {
    let provider = provider.to_lowercase();
    let secret_name = provider_secret_name(&provider).ok_or_else(|| {
        AppError::config(
            "Provider API inconnu.",
            "Choisissez CurseForge ou Microsoft.",
        )
    })?;
    credential_store::delete_secret(secret_name)
}

#[tauri::command(async)]
pub(crate) fn start_download(
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

#[tauri::command(async)]
pub(crate) fn get_downloads(app_state: tauri::State<AppState>) -> Vec<DownloadJob> {
    app_state.download_manager.get_jobs()
}

#[tauri::command(async)]
pub(crate) fn pause_download(app_state: tauri::State<AppState>, job_id: String) -> Result<(), String> {
    app_state.download_manager.pause_job(&job_id)
}

#[tauri::command(async)]
pub(crate) fn resume_download(app_state: tauri::State<AppState>, job_id: String) -> Result<(), String> {
    app_state.download_manager.resume_job(&job_id)
}

#[tauri::command(async)]
pub(crate) fn cancel_download(app_state: tauri::State<AppState>, job_id: String) -> Result<(), String> {
    app_state.download_manager.cancel_job(&job_id)
}

#[tauri::command(async)]
pub(crate) fn update_discord_status(
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
    // A server that is up keeps the presence while its host walks around
    // the launcher; the pages are not news, the server is.
    if refresh_hosting_presence(&app_state, &app_data_dir(&app_handle)) {
        return;
    }
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

#[tauri::command]
pub(crate) async fn install_download(
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
        instance
    } else {
        return Err("Select the instance this download belongs to.".to_string());
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
pub(crate) async fn detect_minecraft_runtime(
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
pub(crate) async fn list_java_runtimes(
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
pub(crate) async fn remove_java_runtime(app_handle: tauri::AppHandle, java_major: u32) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || minecraft_manager::remove_java_runtime(&app_data_dir, java_major)).await
}

#[tauri::command]
pub(crate) async fn install_minecraft_runtime(
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

/// What the tray menu asks of the launcher. The menu is its own window;
/// the launcher's page is told what was chosen and does the rest.
#[tauri::command]
pub(crate) async fn tray_action(
    app_handle: tauri::AppHandle,
    action: String,
    id: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;

    tray_menu::close(&app_handle);
    match action.as_str() {
        "close" => {}
        "quit" => {
            app_handle.exit(0);
        }
        "open" | "settings" | "host" | "instance" | "updates" => {
            show_launcher(&app_handle);
            let _ = app_handle.emit_to(
                "main",
                "kiza://tray",
                serde_json::json!({ "action": action, "id": id }),
            );
        }
        other => return Err(format!("Unknown tray action: {other}")),
    }
    Ok(())
}

/// Saved servers, newest first in the order the user added them.
#[tauri::command]
pub(crate) async fn launch_at_startup_enabled() -> bool {
    off_thread(|| Ok(startup::is_enabled()))
        .await
        .unwrap_or(false)
}

/// Adds or removes Kiza from the Windows startup list.
///
/// Reports the state read back from the registry, not the one requested: a
/// policy or another tool can refuse the write, and a switch that flipped while
/// nothing changed on disk would be a lie.
#[tauri::command]
pub(crate) async fn set_launch_at_startup(enabled: bool) -> Result<bool, String> {
    off_thread(move || {
        let executable = std::env::current_exe()
            .map_err(|error| format!("Could not locate the launcher: {error}"))?;
        startup::set_enabled(enabled, &executable)
    })
    .await
}

/// Opens a `.kizatheme` and keeps it.
///
/// Everything a theme file is allowed to be is decided in `kizatheme`, which
/// refuses one rather than half-reading it: a manifest from a newer Kiza, a
/// colour that is really a stylesheet, an entry naming its way out of its own
/// folder, a picture bigger than the launcher will carry.
#[tauri::command]
pub(crate) async fn import_theme(
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
pub(crate) async fn stage_theme_asset(
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

/// Every theme that has been installed.
#[tauri::command]
pub(crate) async fn installed_themes(
    app_handle: tauri::AppHandle,
) -> Result<Vec<kizatheme::InstalledTheme>, String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || Ok(kizatheme::installed(&home))).await
}

/// Forgets an installed theme.
#[tauri::command]
pub(crate) async fn remove_theme(app_handle: tauri::AppHandle, theme_id: String) -> Result<(), String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || kizatheme::remove(&home, &theme_id).map_err(String::from)).await
}

/// Writes a theme out as a file somebody can be given.
///
/// Validated before a byte is written: a theme this launcher would refuse to
/// open is not one to hand to anybody else.
#[tauri::command]
pub(crate) async fn export_theme(
    app_handle: tauri::AppHandle,
    destination: String,
    manifest: kizatheme::ThemeManifest,
    assets: std::collections::BTreeMap<String, String>,
) -> Result<String, String> {
    let home = themes_dir(&app_handle)?;
    off_thread(move || {
        // A theme is written to a theme file, and nowhere else: this command
        // takes its destination from the page, and a page is not trusted to
        // name any file on the disk.
        let destination = std::path::PathBuf::from(&destination);
        let is_theme_file = destination
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("kizatheme"));
        if !is_theme_file {
            return Err("A theme can only be saved as a .kizatheme file.".to_string());
        }

        // And its pictures come from the themes folder — the ones the Maker
        // brought inside, or an installed theme's own — never from wherever
        // the page says. Otherwise this would read any file it was handed
        // and pack it into an archive.
        let home = home.canonicalize().map_err(|error| error.to_string())?;
        let mut bytes = std::collections::BTreeMap::new();
        for (slot, path) in &assets {
            let inside = std::path::Path::new(path)
                .canonicalize()
                .is_ok_and(|real| real.starts_with(&home));
            if !inside {
                return Err(format!(
                    "The picture for {slot} is not one the Maker brought in. Choose it again."
                ));
            }
            let read = std::fs::read(path)
                .map_err(|error| format!("Could not read the picture for {slot}: {error}"))?;
            bytes.insert(slot.clone(), read);
        }
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
pub(crate) async fn launcher_edition() -> Result<&'static str, String> {
    Ok(edition::current().slug())
}

/// What Kiza occupies on disk, measured rather than estimated.
///
/// Every figure comes from walking the directories that exist. A storage page
/// that guesses invites the user to free space that was never taken, or leaves
/// them hunting for gigabytes it failed to mention.
#[tauri::command]
pub(crate) async fn storage_usage(
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
pub(crate) async fn reclaim_storage(app_handle: tauri::AppHandle, ids: Vec<String>) -> Result<u64, String> {
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
#[tauri::command(async)]
pub(crate) fn open_kiza_folder(app_handle: tauri::AppHandle, folder: String) -> Result<(), String> {
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
#[tauri::command(async)]
pub(crate) fn send_notification(
    app_handle: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let mut notice = app_handle.notification().builder().title(title).body(body);
    if let Some(icon) = notification_icon(&app_handle) {
        notice = notice.icon(icon);
    }
    notice
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
#[tauri::command(async)]
pub(crate) fn send_test_notification(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let mut notice = app_handle
        .notification()
        .builder()
        .title("Kiza Launcher")
        .body("Notifications are getting through.");
    if let Some(icon) = notification_icon(&app_handle) {
        notice = notice.icon(icon);
    }
    notice
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
pub(crate) async fn notification_readiness(app_handle: tauri::AppHandle) -> windows_identity::Registration {
    let icon = notification_icon(&app_handle).map(PathBuf::from);
    off_thread(move || {
        let executable = std::env::current_exe().unwrap_or_default();
        let Some(programs) = windows_identity::start_menu_programs() else {
            return Ok(windows_identity::Registration::default());
        };
        Ok(windows_identity::ensure(
            &executable,
            &windows_identity::shortcut_path(&programs),
            icon.as_deref(),
        ))
    })
    .await
    .unwrap_or_default()
}

/// What the logs folder holds right now.
#[tauri::command]
pub(crate) async fn logs_overview(app_handle: tauri::AppHandle) -> Result<diagnostics::LogsOverview, String> {
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
pub(crate) async fn prune_logs(
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

/// What this machine is, and how much room is left on the drive Kiza is on.
///
/// Read fresh each time rather than cached: free space is the one figure here
/// that changes while the window is open, and a stale reading is worse than a
/// slow one on a page someone opened to decide whether to delete something.
#[tauri::command]
pub(crate) async fn system_report(
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
pub(crate) async fn check_services() -> Vec<ServiceCheck> {
    check_services_inner().await
}

#[tauri::command]
pub(crate) async fn export_diagnostics(app_handle: tauri::AppHandle) -> Result<String, String> {
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
pub(crate) async fn prune_cache(app_handle: tauri::AppHandle, keep_days: u32) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || Ok(storage_report::prune_cache(&app_data_dir, keep_days))).await
}

/// Why the update service turned this launcher away, in its own words.
///
/// The updater plugin reports a refusal as an HTTP status, which is true and
/// useless: "403" does not tell somebody they are following a channel their
/// installer never gave them a key for. The service already answers with a
/// sentence and a machine-readable reason, and this asks it again to read them.
///
/// Only called after a check has already failed, so it costs one request on a
/// path that has gone wrong rather than one on every launch. Returns `None`
/// when the service is not the problem -- an offline machine, a DNS failure, a
/// GitHub fallback -- because inventing an explanation for those would be worse
/// than the status code.
#[tauri::command]
pub(crate) async fn update_refusal(app_handle: tauri::AppHandle) -> Option<UpdateRefusal> {
    let origin = service_origin(&app_handle)?;
    let app_data_dir = app_handle.path().app_data_dir().ok()?;
    let channel = {
        let config = ConfigManager::new(app_data_dir.clone()).load_config();
        let asked = config.update_channel.trim().to_string();
        if asked.is_empty() {
            "stable".to_string()
        } else {
            asked
        }
    };

    let version = app_handle.package_info().version.to_string();
    let url = format!(
        "{origin}/v1/latest/windows/x86_64/{version}?channel={channel}",
        origin = origin.trim_end_matches('/'),
    );

    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;
    let mut request = client.get(url);
    for (name, value) in access::headers(&app_data_dir) {
        request = request.header(name, value);
    }

    let response = request.send().await.ok()?;
    if response.status() != reqwest::StatusCode::FORBIDDEN {
        return None;
    }
    // The reason travels in a header as well as the body, so a body this cannot
    // parse still leaves something to act on.
    let reason = response
        .headers()
        .get("x-kiza-access")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|parsed| {
            parsed
                .get("error")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        });

    Some(UpdateRefusal {
        channel,
        reason,
        message,
    })
}

/// What the update service says about the channel this launcher follows.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChannelNotice {
    pub channel: String,
    /// `open`, `retired` (closed for good) or `moved` (now called `to`).
    pub state: String,
    #[serde(default)]
    pub to: Option<String>,
}

/// Asks whether the channel this launcher follows is still open.
///
/// A channel can close (Alpha did) or change its name (Stable became Beta),
/// and a launcher only learns either from the service. `None` when the
/// service cannot be reached: the launcher carries on as it was rather than
/// guessing.
#[tauri::command]
pub(crate) async fn channel_notice(app_handle: tauri::AppHandle) -> Option<ChannelNotice> {
    let origin = service_origin(&app_handle)?;
    let app_data_dir = app_handle.path().app_data_dir().ok()?;
    let channel = {
        let config = ConfigManager::new(app_data_dir).load_config();
        let asked = config.update_channel.trim().to_ascii_lowercase();
        if asked.is_empty() { "stable".to_string() } else { asked }
    };
    let url = format!("{}/v1/channel/{channel}", origin.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let notice = response.json::<ChannelNotice>().await.ok()?;
    (notice.channel == channel).then_some(notice)
}

/// Follows the channel a moved one now lives under.
#[tauri::command]
pub(crate) async fn follow_channel(app_handle: tauri::AppHandle, channel: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || {
        let channel = channel.trim().to_ascii_lowercase();
        if !crate::edition::current().allows(&channel) {
            return Err(format!("This launcher cannot follow {channel}."));
        }
        let manager = ConfigManager::new(app_data_dir);
        let mut config = manager.load_config();
        config.update_channel = channel;
        manager.save_config(&config)
    })
    .await
}

/// Removes this launcher from the computer, as its own uninstaller would,
/// and closes it.
///
/// For a channel that has closed. The program goes; instances, worlds,
/// accounts and skins stay, because Kiza Setup's uninstaller keeps them unless
/// told otherwise -- so the same player installing the Beta finds everything
/// where they left it. The uninstaller is started a few seconds late, from a
/// detached shell, so the launcher has closed before its files are removed.
#[tauri::command]
pub(crate) async fn uninstall_launcher(app_handle: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| format!("Could not find the launcher: {error}"))?;
    let folder = exe.parent().ok_or("The launcher has no folder.")?.to_path_buf();
    let name = exe
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or("The launcher has no name.")?
        .to_string();
    let uninstaller = folder.join(format!("Uninstall {name}.exe"));
    if !uninstaller.is_file() {
        return Err(format!(
            "This copy of Kiza was not installed by Kiza Setup ({} is missing). Delete its folder by hand.",
            uninstaller.display()
        ));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        std::process::Command::new("cmd")
            .raw_arg(format!(
                "/c ping -n 5 127.0.0.1 >nul & \"{}\" --uninstall /S",
                uninstaller.display()
            ))
            .current_dir(std::env::temp_dir())
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn()
            .map_err(|error| format!("Could not start the uninstaller: {error}"))?;
    }
    #[cfg(not(windows))]
    {
        return Err("Removing itself is only done on Windows.".to_string());
    }

    crate::log_info!("Launcher", "Channel closed: uninstalling, keeping the player's data");
    app_handle.exit(0);
    Ok(())
}

/// How long is left before another report may be sent.
#[tauri::command(async)]
pub(crate) fn support_cooldown_seconds(app_handle: tauri::AppHandle) -> u64 {
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
pub(crate) async fn support_preview(
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
pub(crate) async fn support_submit(
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
    let sent = post_ticket(&endpoint, &payload).await?;
    support::record_sent(&app_data_dir, std::time::SystemTime::now());
    Ok(sent)
}

/// Empties the metadata cache and reports how many bytes went.
///
/// Which folders may be emptied is decided in `storage_report`, which is where
/// that rule lives for every other caller too.
#[tauri::command]
pub(crate) async fn clear_metadata_cache(app_handle: tauri::AppHandle) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || storage_report::reclaim(&app_data_dir, &["cache".to_string()])).await
}

/// Holds or releases the download queue.
///
/// Called by the interface when the game starts and stops, if the user has
/// asked for downloads to wait. Transfers already running are left to finish:
/// tearing one down halfway throws away the bytes it had already fetched, and
/// the point of this is to stop competing for bandwidth, which a transfer in
/// its last second is barely doing.
#[tauri::command(async)]
pub(crate) fn set_downloads_paused(app_state: tauri::State<'_, AppState>, paused: bool) {
    app_state.download_manager.set_paused(paused);
}

#[tauri::command(async)]
pub(crate) fn downloads_paused(app_state: tauri::State<'_, AppState>) -> bool {
    app_state.download_manager.is_paused()
}

/// The range the download queue actually honours, so the interface does not
/// have to guess it or repeat it.
#[tauri::command(async)]
pub(crate) fn download_concurrency_range() -> (usize, usize) {
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
pub(crate) async fn reset_app_config(
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
