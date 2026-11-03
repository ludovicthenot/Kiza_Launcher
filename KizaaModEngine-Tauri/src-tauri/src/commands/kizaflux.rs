//! Kizaflux's commands: the engine's state, its update, an instance's
//! files with their statuses, Horizon mods on and off, and a server check.

use std::path::PathBuf;

use tauri::{Emitter, Manager};

use crate::game_manager::{Engine, GameManager};
use crate::kizaflux;

fn app_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn kizaflux_instance(
    app_handle: &tauri::AppHandle,
    instance_id: &str,
) -> Result<crate::game_manager::GameInstance, String> {
    let instance = GameManager::new(app_data_dir(app_handle)).verify_instance(instance_id)?;
    match instance.minecraft.as_ref().map(|mc| mc.engine) {
        Some(Engine::Kizaflux) => Ok(instance),
        _ => Err("This instance does not play on Kizaflux.".into()),
    }
}

#[tauri::command]
pub(crate) async fn kizaflux_status(app_handle: tauri::AppHandle) -> kizaflux::KizafluxStatus {
    kizaflux::status(&app_data_dir(&app_handle))
}

/// Installs and prepares the newest engine, removing the older ones. Says
/// how it goes as `kizaflux-progress` events.
#[tauri::command]
pub(crate) async fn kizaflux_update(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app_handle);
    let emitter = app_handle.clone();
    let report = move |message: &str| {
        let _ = emitter.emit("kizaflux-progress", message.to_string());
    };
    kizaflux::update(&dir, &report).await
}

#[tauri::command]
pub(crate) async fn kizaflux_scan_instance(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<kizaflux::ScannedFile>, String> {
    let instance = kizaflux_instance(&app_handle, &instance_id)?;
    let dir = app_data_dir(&app_handle);
    tokio::task::spawn_blocking(move || kizaflux::scan_instance(&dir, &instance))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn kizaflux_set_mod_enabled(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: String,
    enabled: bool,
) -> Result<(), String> {
    let instance = kizaflux_instance(&app_handle, &instance_id)?;
    kizaflux::set_mod_enabled(&PathBuf::from(&instance.install_path), &mod_id, enabled)
}

#[tauri::command]
pub(crate) async fn kizaflux_check_server(
    app_handle: tauri::AppHandle,
    address: String,
) -> Result<kizaflux::ServerCheck, String> {
    kizaflux::check_server(&app_data_dir(&app_handle), address).await
}

/// "Make a Kizaflux copy" of a Java instance: a new instance, the Java one
/// left exactly as it is.
#[tauri::command]
pub(crate) async fn kizaflux_copy_instance(
    app_handle: tauri::AppHandle,
    source_id: String,
    display_name: String,
) -> Result<kizaflux::KizafluxCopy, String> {
    let dir = app_data_dir(&app_handle);
    let source = GameManager::new(dir.clone()).verify_instance(&source_id)?;
    let emitter = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let report = |message: &str| {
            let _ = emitter.emit("kizaflux-progress", message.to_string());
        };
        kizaflux::copy_from_java(&dir, &source, display_name, &report)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Brings one Java mod of the instance's `mods/` over with Horizon's
/// carry-over, and installs what ports.
#[tauri::command]
pub(crate) async fn kizaflux_carry_mod(
    app_handle: tauri::AppHandle,
    instance_id: String,
    file_name: String,
) -> Result<kizaflux::CarryVerdict, String> {
    let instance = kizaflux_instance(&app_handle, &instance_id)?;
    let dir = app_data_dir(&app_handle);
    tokio::task::spawn_blocking(move || kizaflux::carry_mod(&dir, &instance, &file_name))
        .await
        .map_err(|e| e.to_string())?
}

/// Removes what a Java mod brought over; its jar stays.
#[tauri::command]
pub(crate) async fn kizaflux_remove_carried(
    app_handle: tauri::AppHandle,
    instance_id: String,
    mod_id: String,
) -> Result<(), String> {
    let instance = kizaflux_instance(&app_handle, &instance_id)?;
    kizaflux::remove_carried(&PathBuf::from(&instance.install_path), &mod_id)
}
