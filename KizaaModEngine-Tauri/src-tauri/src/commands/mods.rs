//! Mods: the catalogue, the profiles, the fixer, the updates, the searches.
//!
//! Commands only: the interface's entry points, moved out of the crate root
//! so that file is a table of contents rather than the whole book. Helpers
//! and state stay where they were and are reached through the glob below;
//! a child module sees everything its parent does.

#![allow(unused_imports)]

use crate::*;

#[tauri::command]
pub(crate) fn scan_directory(path: String) -> Option<GameInfo> {
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
pub(crate) fn get_installed_mods(
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
            let side = side_of(&manager, &instance_id, &mod_info);
            let mut info = ModInfo::from(mod_info);
            info.deployed_file_count = deployed_file_count;
            info.side = side.map(|found| found.as_str().to_string());
            info
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn install_mod(
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
pub(crate) async fn toggle_mod(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: String,
    enabled: bool,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    // Renames on disk, and may link a file: off the window thread.
    off_thread(move || {
        let instance = GameManager::new(app_data_dir.clone()).get_instance_by_id(&instance_id)?;
        ModManager::new(app_data_dir).set_mod_enabled(
            &instance_id,
            &mod_id,
            enabled,
            &instance.game_id,
            &instance.install_path,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn deploy_mods(
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
pub(crate) async fn verify_mods(
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
pub(crate) async fn repair_mods(
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
pub(crate) async fn undeploy_mods(
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
pub(crate) async fn refresh_mods(
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
pub(crate) fn create_profile(
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
pub(crate) async fn switch_profile(
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
pub(crate) fn list_profiles(
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
pub(crate) fn delete_profile(
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
pub(crate) fn get_active_profile_id(app_handle: tauri::AppHandle, instance_id: String) -> Option<String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let manager = ModManager::new(app_data_dir);
    manager.get_active_profile_id(&instance_id)
}

#[tauri::command]
pub(crate) fn get_conflicts(
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
pub(crate) fn delete_mod(
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
pub(crate) fn get_mod_path(
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
pub(crate) fn open_mod_folder(
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
pub(crate) fn scan_residuals(
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
pub(crate) fn delete_residual_files(
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

/// Static compatibility report for the instance mods folder (no launch needed).
#[tauri::command]
pub(crate) fn check_mod_compatibility(
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

#[tauri::command]
pub(crate) async fn install_modrinth_content(
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

/// Where each installed file came from, so the Update Center can tell which
/// project a jar belongs to. Files installed before this existed, or added by
/// hand, simply have no entry and are never auto-updated.
#[tauri::command]
pub(crate) fn content_origins(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> std::collections::BTreeMap<String, content_provenance::ContentOrigin> {
    content_provenance::all(&app_data_dir(&app_handle), &instance_id)
}

#[tauri::command]
pub(crate) fn content_origin(
    app_handle: tauri::AppHandle,
    instance_id: String,
    relative_path: String,
) -> Option<content_provenance::ContentOrigin> {
    content_provenance::get(&app_data_dir(&app_handle), &instance_id, &relative_path)
}

/// Pinning keeps a file on the version the user chose; the Update Center will
/// list an update for it but never apply one.
#[tauri::command]
pub(crate) fn content_set_pinned(
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
pub(crate) fn content_forget_origin(
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
pub(crate) async fn check_instance_updates(
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
        crate::log_warn!("Updates", "Could not work out where some mods came from: {error}");
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

/// Applies the selected updates, after snapshotting the instance.
///
/// Only candidates the check marked applicable are touched, so a pinned file is
/// never moved even if its path is passed in.
#[tauri::command]
pub(crate) async fn apply_instance_updates(
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

/// Downloads one released file to a path the user chose, without installing it.
///
/// The counterpart of installing: sometimes the file is wanted for a server, a
/// friend, or a manual setup, and putting it in the instance would be the wrong
/// thing. Nothing about the instance changes here, and no provenance is
/// recorded — this file is leaving Kiza's care.
#[tauri::command]
pub(crate) async fn download_content_file(
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
pub(crate) async fn list_content_versions(
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
pub(crate) async fn set_content_version(
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

/// Identifies already-installed files by hashing them and asking Modrinth which
/// version those exact bytes are.
///
/// This is what rescues content installed before Kiza recorded provenance. The
/// bytes are the identity, so nothing is guessed from a file name. Files
/// Modrinth does not recognise stay unknown rather than being attributed to
/// something plausible.
#[tauri::command]
pub(crate) async fn backfill_content_origins(
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

#[tauri::command]
pub(crate) async fn minecraft_download_mod_from_url(
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

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn modrinth_search_mods(
    app_handle: tauri::AppHandle,
    instance_id: String,
    query: String,
    project_type: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    compatible_only: Option<bool>,
    filter_version: Option<bool>,
    sort: Option<String>,
    categories: Option<Vec<String>>,
    client_side: Option<String>,
    server_side: Option<String>,
) -> Result<modrinth_api::ModrinthSearchResponse, String> {
    // The Minecraft version facet is always applied so an instance only browses
    // its own catalogue; the loader facet is opt-in so other-loader projects
    // stay visible and are badged by the UI.
    // `project_type` chooses the content kind (mod, shader, resourcepack, ...).
    // `categories`, `client_side` and `server_side` are Modrinth's own facets,
    // passed through as the person set them: they are what turns a list of
    // everything into "the optimisation mods that run on my side".
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
    let categories = content_filters::ContentKind::parse(&project_type)
        .map(|kind| content_filters::modrinth_slugs(kind, categories.as_deref().unwrap_or(&[])))
        .unwrap_or_default();
    let filters = modrinth_api::SearchFilters {
        mc_version,
        loader,
        categories: &categories,
        client_side: client_side.as_deref(),
        server_side: server_side.as_deref(),
    };
    modrinth_api::search_projects(
        &query,
        &project_type,
        &filters,
        limit.unwrap_or(20),
        offset.unwrap_or(0),
        sort.as_deref(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn modrinth_get_versions(
    project_id: String,
) -> Result<Vec<modrinth_api::ModrinthVersion>, String> {
    modrinth_api::get_versions(&project_id).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn curseforge_search_mods(
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
    categories: Option<Vec<String>>,
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
    // The launcher's category names, translated to CurseForge's ids for
    // this class of content. What CurseForge cannot narrow by is left out
    // here and reported by `search_filter_support`.
    let category_ids = content_filters::ContentKind::parse(content_type)
        .map(|kind| content_filters::curseforge_ids(kind, categories.as_deref().unwrap_or(&[])))
        .unwrap_or_default();
    let filters = curseforge_api::SearchFilters {
        mc_version,
        loader,
        category_ids: &category_ids,
    };
    curseforge_api::search_mods(
        &key,
        &query,
        class_id.unwrap_or(6),
        &filters,
        page_size.unwrap_or(20),
        index.unwrap_or(0),
        sort.as_deref(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn search_filter_support(
    content_type: String,
    categories: Vec<String>,
    sort: Option<String>,
    client_side: Option<String>,
    server_side: Option<String>,
) -> SearchFilterSupport {
    let kind = content_filters::ContentKind::parse(&content_type);
    let sort = content_filters::Sort::parse(sort.as_deref());
    SearchFilterSupport {
        modrinth_ignores: kind
            .map(|kind| content_filters::unsupported_by_modrinth(kind, &categories))
            .unwrap_or_default(),
        curseforge_ignores: kind
            .map(|kind| content_filters::unsupported_by_curseforge(kind, &categories))
            .unwrap_or_default(),
        curseforge_sort_approximate: sort.is_some_and(|sort| !sort.exact_on_curseforge()),
        curseforge_has_no_sides: client_side.is_some() || server_side.is_some(),
    }
}

/// The categories the interface may offer for a kind of content.
#[tauri::command]
pub(crate) async fn search_categories(content_type: String) -> Vec<content_filters::Category> {
    content_filters::ContentKind::parse(&content_type)
        .map(|kind| content_filters::categories_for(kind).to_vec())
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) async fn curseforge_list_files(
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

#[tauri::command]
pub(crate) async fn optifine_list_releases(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<optifine::OptiFineRelease>, String> {
    // OptiFine ships only from optifine.net, so it never shows up in the
    // Modrinth/CurseForge search. This lists the builds for the instance.
    let minecraft = instance_minecraft_config(&app_handle, &instance_id)?;
    optifine::list_releases(&minecraft.mc_version).await
}

#[tauri::command]
pub(crate) async fn optifine_install(
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
pub(crate) async fn curseforge_install_file(
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

#[tauri::command]
pub(crate) async fn resolve_mod_dependencies(
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
pub(crate) async fn install_missing_dependency(
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
pub(crate) async fn install_mod_with_dependencies(
    app_handle: tauri::AppHandle,
    request: dependency_resolver::ResolveDependenciesRequest,
) -> Result<dependency_resolver::DependencyInstallResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = dependency_instance(&app_data_dir, &request.instance_id)?;
    let api_key = dependency_api_key(request.source)?;
    // The install window follows along: which file is downloading, how many
    // are in place.
    let emitter = app_handle.clone();
    let instance_id = instance.id.clone();
    dependency_resolver::install_for_instance_reporting(
        &app_data_dir,
        &instance,
        &request,
        api_key,
        &move |step| {
            let _ = tauri::Emitter::emit(
                &emitter,
                "kiza://mod-install",
                serde_json::json!({ "instanceId": instance_id, "step": step }),
            );
        },
    )
    .await
}

/// Fetches every mod a pack arrived without, in one go.
///
/// The list was already shown, with a button beside each entry. Five missing
/// mods was five clicks and five separate waits, and the person doing the
/// clicking was doing what a loop does. This is the loop. One request, and
/// the same progress the import itself reports -- which mod, how many done --
/// so the wait has a number on it.
///
/// One failing does not stop the rest: the point is to end up with as much of
/// the pack as can be had, and a mod that could not be fetched is named in
/// the report rather than silently skipped or allowed to abort the others.
#[tauri::command]
pub(crate) async fn install_missing_mods(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    instance_id: String,
    mods: Vec<MissingMod>,
) -> Result<MissingModsReport, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let instance = dependency_instance(&app_data_dir, &instance_id)?;
    let api_key = dependency_api_key(dependency_resolver::ModProvider::Modrinth)?;

    let total = mods.len();
    let progress = app_state.import_progress.clone();
    let mut report = MissingModsReport::default();

    for (index, missing) in mods.into_iter().enumerate() {
        if let Ok(mut slot) = progress.lock() {
            *slot = Some(ImportProgress {
                done: index,
                total,
                name: missing.name.clone(),
            });
        }

        let request = dependency_resolver::ResolveDependenciesRequest {
            instance_id: instance_id.clone(),
            source: dependency_resolver::ModProvider::Modrinth,
            project_id: missing.modrinth_project_id.clone(),
            version_id: missing.modrinth_version_id.clone(),
            file_id: None,
            author: None,
        };
        match dependency_resolver::install_for_instance(
            &app_data_dir,
            &instance,
            &request,
            api_key.clone(),
        )
        .await
        {
            Ok(_) => report.installed.push(missing.name),
            Err(reason) => report.failed.push(MissingModFailure {
                name: missing.name,
                reason,
            }),
        }
    }

    if let Ok(mut slot) = progress.lock() {
        *slot = None;
    }
    Ok(report)
}

/// Adds a file the person downloaded themselves for a mod a pack could not
/// bring. See `content_manager::add_blocked_file_by_hand`.
#[tauri::command]
pub(crate) async fn add_missing_mod_file(
    app_handle: tauri::AppHandle,
    instance_id: String,
    blocked: content_manager::BlockedPackFile,
    path: String,
    accept_mismatch: bool,
) -> Result<content_manager::HandAddedFile, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dependency_instance(&app_data_dir, &instance_id)?;
    off_thread(move || {
        content_manager::add_blocked_file_by_hand(
            &app_data_dir,
            &instance_id,
            &blocked,
            Path::new(&path),
            accept_mismatch,
        )
    })
    .await
}

/// What the launcher would do about an instance's compatibility problems.
///
/// The network first, the decision second. Everything the plan will ask a
/// catalogue for is gathered here -- which project publishes a missing mod,
/// which releases a project has for this Minecraft and loader -- and handed
/// to the planner as answers, so the planner itself is a function of facts
/// and can be tested without a network.
#[tauri::command]
pub(crate) async fn plan_compat_fixes(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<compat_fixer::FixPlan, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let CompatFacts {
        instance,
        report,
        provided,
        required,
        origins,
    } = compat_facts(&app_data_dir, &instance_id)?;
    let mc = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance")?;
    let loader = minecraft_loader_name(&mc.loader).to_string();

    let facts = compat_fixer::Facts {
        report: &report,
        provided: &provided,
        required: &required,
        origins: &origins,
        mc_version: &mc.mc_version,
        loader: &loader,
    };
    let lookups = compat_fixer::lookups(&facts);

    let mut catalogue = compat_fixer::Prefetched::default();
    let mut projects_to_list = lookups.project_ids.clone();
    for mod_id in &lookups.mod_ids {
        if let Ok(Some(found)) = missing_dependency::find(mod_id).await {
            projects_to_list.push(found.project_id.clone());
            catalogue
                .projects
                .insert(mod_id.clone(), (found.project_id, found.name));
        }
    }
    for project_id in projects_to_list {
        if catalogue.versions.contains_key(&project_id) {
            continue;
        }
        // Narrowed by Modrinth: only releases for this Minecraft and loader
        // come back, instead of every release the project ever had.
        let Ok(mut versions) =
            modrinth_api::get_versions_for(&project_id, Some(&mc.mc_version), Some(&loader)).await
        else {
            continue;
        };
        versions.sort_by(|left, right| right.date_published.cmp(&left.date_published));
        let candidates = versions
            .into_iter()
            .map(|version| compat_fixer::Candidate {
                version_id: version.id,
                version_number: version.version_number,
            })
            .collect();
        catalogue.versions.insert(project_id, candidates);
    }

    Ok(compat_fixer::plan(&facts, &catalogue))
}

/// Carries out a plan, one step at a time, and reports on each.
///
/// Installs and replacements only. A Disable step is done here because the
/// person saw it in the plan and chose to apply the plan; an Unfixable step
/// is skipped, since it was never a thing to do. One step failing does not
/// stop the rest -- the point is to end with as much fixed as can be, and to
/// say precisely which step could not be.
#[tauri::command]
pub(crate) async fn apply_compat_fixes(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    instance_id: String,
    plan: compat_fixer::FixPlan,
) -> Result<Vec<FixOutcome>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = dependency_instance(&app_data_dir, &instance_id)?;
    let api_key = dependency_api_key(dependency_resolver::ModProvider::Modrinth)?;
    let mods_dir = PathBuf::from(&instance.install_path).join("mods");

    let doing: Vec<compat_fixer::FixStep> = plan
        .steps
        .into_iter()
        .filter(|step| !matches!(step, compat_fixer::FixStep::Unfixable { .. }))
        .collect();
    let total = doing.len();
    let progress = app_state.import_progress.clone();
    let mut outcomes = Vec::with_capacity(total);

    // Before the first change: what this is about to do, and the way back.
    if total > 0 {
        let summary = match doing.len() {
            1 => step_summary(&doing[0]),
            n => format!("{n} compatibility fixes"),
        };
        doctor::begin(
            &app_data_dir,
            &instance_id,
            &PathBuf::from(&instance.install_path),
            &summary,
            doing.iter().map(step_summary).collect(),
        )?;
    }

    for (index, step) in doing.into_iter().enumerate() {
        let label = match &step {
            compat_fixer::FixStep::Install { name, .. } => name.clone(),
            compat_fixer::FixStep::Replace { file_name, .. }
            | compat_fixer::FixStep::Disable { file_name, .. }
            | compat_fixer::FixStep::Unfixable { file_name, .. } => file_name.clone(),
        };
        if let Ok(mut slot) = progress.lock() {
            *slot = Some(ImportProgress {
                done: index,
                total,
                name: label,
            });
        }

        let result: Result<String, String> = match &step {
            compat_fixer::FixStep::Install {
                project_id,
                version_id,
                name,
                version,
                ..
            } => install_exact(
                &app_data_dir,
                &instance,
                &instance_id,
                project_id,
                version_id,
                api_key.clone(),
            )
            .await
            .map(|_| format!("{name} {version} installed.")),
            compat_fixer::FixStep::Replace {
                file_name,
                project_id,
                version_id,
                version,
                ..
            } => {
                // The old file goes first, and its record with it: two
                // releases of one mod in the folder is a game that will not
                // start, which is the thing being fixed.
                let old = mods_dir.join(file_name);
                let removed = match std::fs::remove_file(&old) {
                    Ok(()) => Ok(()),
                    Err(_) if !old.exists() => Ok(()),
                    Err(error) => Err(format!("Could not remove {file_name}: {error}")),
                };
                match removed {
                    Ok(()) => {
                        let _ = content_provenance::forget(
                            &app_data_dir,
                            &instance_id,
                            &format!("mods/{file_name}"),
                        );
                        install_exact(
                            &app_data_dir,
                            &instance,
                            &instance_id,
                            project_id,
                            version_id,
                            api_key.clone(),
                        )
                        .await
                        .map(|_| format!("Replaced with {version}."))
                    }
                    Err(error) => Err(error),
                }
            }
            compat_fixer::FixStep::Disable { file_name, .. } => {
                let from = mods_dir.join(file_name);
                let to = mods_dir.join(format!("{file_name}.disabled"));
                std::fs::rename(&from, &to)
                    .map(|_| "Disabled.".to_string())
                    .map_err(|error| format!("Could not disable {file_name}: {error}"))
            }
            compat_fixer::FixStep::Unfixable { .. } => unreachable!("filtered above"),
        };

        outcomes.push(match result {
            Ok(detail) => FixOutcome {
                step,
                ok: true,
                detail,
            },
            Err(detail) => FixOutcome {
                step,
                ok: false,
                detail,
            },
        });
    }

    if let Ok(mut slot) = progress.lock() {
        *slot = None;
    }
    Ok(outcomes)
}
