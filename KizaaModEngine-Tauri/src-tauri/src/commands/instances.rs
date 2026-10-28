//! Instances: creating, importing, exporting, settings, restore points and lockfiles.
//!
//! Commands only: the interface's entry points, moved out of the crate root
//! so that file is a table of contents rather than the whole book. Helpers
//! and state stay where they were and are reached through the glob below;
//! a child module sees everything its parent does.

#![allow(unused_imports)]

use crate::*;

#[tauri::command(async)]
pub(crate) fn add_game_instance(
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

#[tauri::command(async)]
pub(crate) fn list_game_instances(app_handle: tauri::AppHandle) -> Vec<GameInstanceSummary> {
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
pub(crate) async fn get_kiza_client_support(
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
pub(crate) async fn verify_game_instance(
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
pub(crate) async fn get_minecraft_versions(
    app_handle: tauri::AppHandle,
) -> Result<minecraft_manager::MinecraftVersionList, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::fetch_minecraft_versions_cached(&app_data_dir).await
}

#[tauri::command]
pub(crate) async fn get_minecraft_loader_versions(
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

/// What an instance could contribute to an archive, measured.
///
/// Asked before the export window is drawn, so every line in it carries a real
/// size and a real count rather than a promise. Worlds are listed one by one:
/// "include your worlds" is not a question anyone can answer without seeing
/// which, and how big.
#[tauri::command]
pub(crate) async fn export_plan(
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
pub(crate) async fn export_instance(
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

#[tauri::command(async)]
pub(crate) fn get_instance_settings(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> minecraft_manager::InstanceSettings {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_manager::load_instance_settings(&app_data_dir, &instance_id)
}

#[tauri::command(async)]
pub(crate) fn save_instance_settings(
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
pub(crate) async fn create_minecraft_instance_cmd(
    app_handle: tauri::AppHandle,
    display_name: String,
    mc_version: String,
    loader: game_manager::MinecraftLoader,
    loader_version: Option<String>,
    java_major: Option<u32>,
    // Absent from older pages: Java.
    engine: Option<game_manager::Engine>,
) -> Result<GameInstance, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let engine = engine.unwrap_or_default();
    if engine == game_manager::Engine::Kizaflux {
        crate::kizaflux::check_instance(&app_data_dir, &mc_version, &loader)?;
    }
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
    let mut instance = minecraft_manager::create_minecraft_instance(
        &app_data_dir,
        display_name,
        mc_version,
        loader,
        loader_version,
        java_major,
    )?;
    if engine != game_manager::Engine::Java {
        if let Some(minecraft) = instance.minecraft.as_mut() {
            minecraft.engine = engine;
        }
        minecraft_manager::save_instance_config(&app_data_dir, &instance)?;
    }
    Ok(instance)
}

#[tauri::command(async)]
pub(crate) fn rename_minecraft_instance_cmd(
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

#[tauri::command(async)]
pub(crate) fn set_minecraft_instance_version_cmd(
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

#[tauri::command(async)]
pub(crate) fn set_minecraft_instance_java_cmd(
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

#[tauri::command(async)]
pub(crate) fn delete_minecraft_instance_cmd(
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

#[tauri::command(async)]
pub(crate) fn open_instance_folder(app_handle: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// What other launchers on this machine have: CurseForge App, Modrinth
/// App, Prism, MultiMC, the official launcher.
#[tauri::command]
pub(crate) async fn scan_other_launchers() -> Result<Vec<launcher_import::FoundInstance>, String> {
    off_thread(|| Ok(launcher_import::scan())).await
}

/// Copies one of them into a fresh Kiza instance. Progress goes through the
/// same slot an import shows.
#[tauri::command]
pub(crate) async fn import_from_other_launcher(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    found: launcher_import::FoundInstance,
) -> Result<GameInstance, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let progress = app_state.import_progress.clone();
    let result = off_thread(move || {
        launcher_import::import(&app_data_dir, &found, |done, total, name| {
            if let Ok(mut slot) = progress.lock() {
                *slot = Some(ImportProgress {
                    done,
                    total,
                    name: name.to_string(),
                });
            }
        })
    })
    .await;
    if let Ok(mut slot) = app_state.import_progress.lock() {
        *slot = None;
    }
    result
}

/// Restore points capture what makes an instance an instance: loader files,
/// mods, packs, shaders and configuration. Worlds are the World Vault's job,
/// so a snapshot only records which world checkpoint it was taken beside.
#[tauri::command(async)]
pub(crate) fn restore_points_list(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<restore_points::RestorePoint> {
    restore_points::list(&app_data_dir(&app_handle), &instance_id)
}

#[tauri::command(async)]
pub(crate) fn restore_point_create(
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

#[tauri::command(async)]
pub(crate) fn restore_point_apply(
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
#[tauri::command(async)]
pub(crate) fn restore_points_prune(
    app_handle: tauri::AppHandle,
    instance_id: String,
    keep: usize,
) -> Result<usize, String> {
    restore_points::prune(&app_data_dir(&app_handle), &instance_id, keep)
}

/// Bytes the snapshot store occupies after deduplication, for the disk quota.
#[tauri::command(async)]
pub(crate) fn restore_points_stored_bytes(app_handle: tauri::AppHandle) -> u64 {
    restore_points::stored_bytes(&app_data_dir(&app_handle))
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
pub(crate) async fn import_instance(
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

    // A Modrinth pack on disk -- one a friend sent, one downloaded by hand --
    // is the same thing the catalogue hands over, and installs the same way.
    let is_mrpack = {
        let path = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let opened = archive::as_zip(&path)?;
            let file = std::fs::File::open(&opened.path).map_err(|e| e.to_string())?;
            let zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            let has_index = zip.file_names().any(|name| name == "modrinth.index.json");
            Ok::<_, String>(has_index)
        })
        .await
        .map_err(|error| format!("Instance import task failed: {error}"))??
    };
    if is_mrpack {
        let opened = {
            let path = path.clone();
            tauri::async_runtime::spawn_blocking(move || archive::as_zip(&path))
                .await
                .map_err(|error| format!("Instance import task failed: {error}"))??
        };
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "pack.mrpack".to_string());
        let result = content_manager::install_modrinth_archive(
            &app_data_dir,
            &opened.path,
            None,
            display_name.as_deref(),
            &file_name,
        )
        .await?;
        return Ok(InstanceImportOutcome {
            instance_id: result.instance_id,
            ..Default::default()
        });
    }

    let (imported, kiza) = {
        let app_data_dir = app_data_dir.clone();
        let path = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // A .7z, a .rar or a tarball is read as the zip it unpacks to;
            // the scratch copy lives until this block ends.
            let opened = archive::as_zip(&path)?;
            let imported = content_manager::import_instance_archive(
                &app_data_dir,
                &opened.path,
                display_name.as_deref(),
            )?;
            // Read after the instance exists, so a malformed sidecar cannot
            // leave a half-built instance behind: `import_instance_archive`
            // already cleans up after itself when it fails.
            let kiza = read_kiza_manifest(&opened.path);
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

    // A CurseForge pack that weighs a third of the official release is one
    // with folders missing; the person is told before they launch it.
    if !imported.pending.is_empty() && kiza.is_none() {
        if let Ok(api_key) = curseforge_api_key() {
            outcome.lighter_than = content_manager::official_pack_if_lighter(
                &api_key,
                &imported.pack_name,
                &imported.pack_version,
                imported.archive_bytes,
            )
            .await;
        }
    }

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
        // design -- and it turns a dead end into one click.
        let mc = GameManager::new(app_data_dir.clone())
            .get_instance_by_id(&result.instance_id)
            .ok()
            .and_then(|instance| instance.minecraft);
        let mc_version = mc
            .as_ref()
            .map(|mc| mc.mc_version.clone())
            .unwrap_or_default();
        let loader = mc
            .as_ref()
            .map(|mc| mc.loader.slug())
            .filter(|slug| *slug != "vanilla");
        outcome.blocked = Vec::with_capacity(report.blocked.len());
        for mut blocked in report.blocked {
            blocked.look_up_on_modrinth(&mc_version, loader).await;
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
            crate::log_info!("Import", "{done}/{total} {name}");
        },
    )
    .await;

    if !report.mods_missing.is_empty() {
        // Named rather than counted: "three mods are missing" sends someone
        // looking through twenty-five, and a pack that quietly lost a mod fails
        // at launch instead of here.
        crate::log_warn!("Import", "Could not restore: {}", report.mods_missing.join(", "));
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

/// Where the import running right now has got to, if one is.
#[tauri::command]
pub(crate) async fn import_progress(
    app_state: tauri::State<'_, AppState>,
) -> Result<Option<ImportProgress>, String> {
    Ok(app_state
        .import_progress
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone())
}

/// Describes the instance exactly enough for someone else to rebuild it.
#[tauri::command(async)]
pub(crate) fn lockfile_export(
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
#[tauri::command(async)]
pub(crate) fn lockfile_save(
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
#[tauri::command(async)]
pub(crate) fn lockfile_read(path: String) -> Result<String, String> {
    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the lockfile: {error}"))?;
    lockfile::parse(&raw)?;
    Ok(raw)
}

/// What separates this instance from the lockfile, right now.
#[tauri::command(async)]
pub(crate) fn lockfile_diff(
    app_handle: tauri::AppHandle,
    instance_id: String,
    raw: String,
) -> Result<Vec<lockfile::DiffEntry>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    let lock = lockfile::parse(&raw)?;
    Ok(lockfile::diff(&lock, &restore_points::inspect(&game_dir)))
}

/// Brings the instance to what the lockfile describes.
///
/// Extra files are left alone. Removing everything the lockfile does not mention
/// would delete a private mod, a personal config, or a resource pack the user
/// added on purpose â€” a rebuild is not a wipe.
#[tauri::command]
pub(crate) async fn lockfile_apply(
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

/// Re-reads every instance from disk and reports how many were found.
///
/// The one repair for an instance list gone stale — a folder renamed by hand, a
/// copy dropped in, an entry left behind by a delete that failed halfway —
/// without touching a single file.
#[tauri::command]
pub(crate) async fn rebuild_instance_index(app_handle: tauri::AppHandle) -> Result<usize, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || Ok(GameManager::new(app_data_dir).list_instances().len())).await
}
