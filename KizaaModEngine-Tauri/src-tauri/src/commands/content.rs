//! Packs and worlds: shaders, resource packs, data packs, covers and the world vault.
//!
//! Commands only: the interface's entry points, moved out of the crate root
//! so that file is a table of contents rather than the whole book. Helpers
//! and state stay where they were and are reached through the glob below;
//! a child module sees everything its parent does.

#![allow(unused_imports)]

use crate::*;

#[tauri::command(async)]
pub(crate) fn list_minecraft_worlds(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<content_manager::MinecraftWorldInfo>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    content_manager::list_worlds(&app_data_dir, &instance_id)
}

#[tauri::command(async)]
pub(crate) fn list_minecraft_content(
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

/// Every pack in the folder with what the file and the catalogue say about
/// it. The folder is read and hashed off the window thread; Modrinth is
/// asked only about hashes the cache has not seen.
#[tauri::command]
pub(crate) async fn identify_minecraft_content(
    app_handle: tauri::AppHandle,
    instance_id: String,
    content_type: content_manager::ContentKind,
    world_name: Option<String>,
) -> Result<Vec<content_identity::ContentIdentity>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let local = {
        let app_data_dir = app_data_dir.clone();
        off_thread(move || {
            let dir = content_manager::content_dir(
                &app_data_dir,
                &instance_id,
                content_type,
                world_name.as_deref(),
            )?;
            Ok(content_identity::read_local(&app_data_dir, &dir))
        })
        .await?
    };
    Ok(content_identity::ask_catalogue(&app_data_dir, content_type, local).await)
}

#[tauri::command(async)]
pub(crate) fn delete_minecraft_content(
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

#[tauri::command(async)]
pub(crate) fn import_minecraft_content(
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

#[tauri::command(async)]
pub(crate) fn open_minecraft_content_folder(
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
pub(crate) async fn install_curseforge_content(
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

#[tauri::command(async)]
pub(crate) fn list_shaderpacks(
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

#[tauri::command(async)]
pub(crate) fn delete_shaderpack(
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

#[tauri::command(async)]
pub(crate) fn import_shaderpack(
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

#[tauri::command(async)]
pub(crate) fn open_shaderpacks_folder(
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
pub(crate) async fn modrinth_search_shaders(
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

    let filters = modrinth_api::SearchFilters {
        mc_version: Some(&minecraft.mc_version),
        loader: Some(engine.modrinth_category()),
        ..modrinth_api::SearchFilters::default()
    };
    modrinth_api::search_projects(
        &query,
        "shader",
        &filters,
        limit.unwrap_or(20),
        offset.unwrap_or(0),
        None,
    )
    .await
}

/// Downloads the best matching version of a Modrinth shader pack into the
/// instance shaderpacks folder.
#[tauri::command]
pub(crate) async fn install_shaderpack_from_modrinth(
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
#[tauri::command(async)]
pub(crate) fn is_iris_installed(app_handle: tauri::AppHandle, instance_id: String) -> Result<bool, String> {
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

/// Installs the Iris shader loader mod on a matching Fabric instance.
#[tauri::command]
pub(crate) async fn install_iris(app_handle: tauri::AppHandle, instance_id: String) -> Result<String, String> {
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

#[tauri::command(async)]
pub(crate) fn instance_cover(app_handle: tauri::AppHandle, instance_id: String) -> Option<InstanceCover> {
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

#[tauri::command(async)]
pub(crate) fn set_instance_cover(
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

#[tauri::command(async)]
pub(crate) fn clear_instance_cover(app_handle: tauri::AppHandle, instance_id: String) {
    instance_art::clear_cover(&app_data_dir(&app_handle), &instance_id);
}

#[tauri::command(async)]
pub(crate) fn world_vault_worlds(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<world_vault::WorldSummary> {
    let app_data_dir = app_data_dir(&app_handle);
    let game_dir = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id);
    world_vault::list_worlds(&app_data_dir, &instance_id, &game_dir)
}

#[tauri::command(async)]
pub(crate) fn world_vault_checkpoints(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<world_vault::WorldCheckpoint> {
    world_vault::list_checkpoints(&app_data_dir(&app_handle), &instance_id)
}

/// Backs one world up. Refused while the game is running: a world copied
/// mid-save restores as a damaged world.
#[tauri::command(async)]
pub(crate) fn world_vault_backup(
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

#[tauri::command(async)]
pub(crate) fn world_vault_restore(
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

#[tauri::command(async)]
pub(crate) fn world_vault_delete(
    app_handle: tauri::AppHandle,
    instance_id: String,
    checkpoint_id: String,
) -> Result<Vec<world_vault::WorldCheckpoint>, String> {
    world_vault::delete(&app_data_dir(&app_handle), &instance_id, &checkpoint_id)
}

/// Trims the backups of one world. Retention is per world, so trimming the world
/// being played never deletes the only backup of one that is not.
#[tauri::command(async)]
pub(crate) fn world_vault_prune(
    app_handle: tauri::AppHandle,
    instance_id: String,
    folder: String,
    keep: usize,
) -> Result<usize, String> {
    world_vault::prune(&app_data_dir(&app_handle), &instance_id, &folder, keep)
}

#[tauri::command]
pub(crate) async fn world_vault_stored_bytes(app_handle: tauri::AppHandle) -> u64 {
    let dir = app_data_dir(&app_handle);
    // Walks every stored object; the vault grows with each backup.
    off_thread(move || Ok(world_vault::stored_bytes(&dir)))
        .await
        .unwrap_or(0)
}
