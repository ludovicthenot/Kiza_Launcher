//! Hosting: the servers Kiza runs for people, from creation to backups.
//!
//! Commands only: the interface's entry points, moved out of the crate root
//! so that file is a table of contents rather than the whole book. Helpers
//! and state stay where they were and are reached through the glob below;
//! a child module sees everything its parent does.

#![allow(unused_imports)]

use crate::*;

// --- Hosted servers ---------------------------------------------------------
//
// Registry, install, process, console, properties, players, mods, backups,
// import and the build from an instance. Each command is thin: the work is
// in the `server_*` modules, and the runtime in `AppState::servers` is the
// one place a process is remembered.

/// Every server this launcher hosts, with its live state, for the Host page.
#[tauri::command]
pub(crate) async fn list_hosted_servers(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<HostedServerView>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let runtime = app_state.servers.clone();
    off_thread(move || {
        Ok(server_host::list(&app_data_dir)
            .into_iter()
            .map(|summary| {
                let dir = server_host::server_dir(&app_data_dir, &summary.server.id);
                let status = runtime.status(&dir, &summary.server.id);
                HostedServerView { summary, status }
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<HostedServerView, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let runtime = app_state.servers.clone();
    off_thread(move || {
        let summary = server_host::summary(&app_data_dir, &server_id)?;
        let dir = server_host::server_dir(&app_data_dir, &server_id);
        let status = runtime.status(&dir, &server_id);
        Ok(HostedServerView { summary, status })
    })
    .await
}

/// Deploy: a folder, a registry line and the properties asked for. The
/// server files are fetched on the first start, or by `install_hosted_server`.
#[tauri::command]
pub(crate) async fn create_hosted_server(
    app_handle: tauri::AppHandle,
    server: server_host::NewHostedServer,
) -> Result<server_host::HostedServerSummary, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || server_host::create(&app_data_dir, server)).await
}

#[tauri::command]
pub(crate) async fn update_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
    patch: server_host::ServerPatch,
) -> Result<server_host::HostedServerSummary, String> {
    let app_data_dir = app_data_dir(&app_handle);
    if patch.port.is_some() && app_state.servers.is_running(&server_id) {
        return Err("Stop the server before changing its port.".to_string());
    }
    off_thread(move || server_host::update(&app_data_dir, &server_id, patch)).await
}

/// Forgets a hosted server and deletes its folder, world and backups included.
#[tauri::command]
pub(crate) async fn delete_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<(), String> {
    if app_state.servers.is_running(&server_id) {
        return Err("Stop the server before deleting it.".to_string());
    }
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || server_host::remove(&app_data_dir, &server_id)).await
}

#[tauri::command]
pub(crate) async fn clone_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
    name: String,
) -> Result<server_host::HostedServerSummary, String> {
    if app_state.servers.is_running(&server_id) {
        return Err(
            "Stop the server before cloning it, so the world is not copied mid-write.".to_string(),
        );
    }
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || server_host::clone(&app_data_dir, &server_id, &name)).await
}

#[tauri::command]
pub(crate) async fn open_hosted_server_folder(
    app_handle: tauri::AppHandle,
    server_id: String,
    subfolder: Option<String>,
) -> Result<(), String> {
    let mut dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    if let Some(sub) = subfolder.filter(|s| !s.trim().is_empty()) {
        // One folder name, inside the server: no separators, no climbing.
        dir = crate::path_security::safe_child_path(&dir, &sub, &[])?;
    }
    if !dir.exists() {
        return Err("That folder does not exist yet.".to_string());
    }
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn accept_hosted_server_eula(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || server_host::accept_eula(&app_data_dir, &server_id)).await
}

#[tauri::command]
pub(crate) async fn set_hosted_server_icon(
    app_handle: tauri::AppHandle,
    server_id: String,
    source_path: String,
) -> Result<(), String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || server_host::set_icon_file(&dir, std::path::Path::new(&source_path))).await
}

/// The server icon as a data URI, for the card.
#[tauri::command]
pub(crate) async fn hosted_server_icon(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<Option<String>, String> {
    let path = server_host::server_dir(&app_data_dir(&app_handle), &server_id)
        .join(server_host::ICON_FILE);
    off_thread(move || {
        Ok(std::fs::read(path).ok().map(|bytes| {
            use base64::Engine;
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        }))
    })
    .await
}

/// Fetches the server files without starting. Progress is on the status.
#[tauri::command]
pub(crate) async fn install_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    let server = server_host::get(&app_data_dir, &server_id)?;
    let runtime = app_state.servers.clone();
    let cancel = runtime.begin_install(&server_id)?;
    tauri::async_runtime::spawn(async move {
        let outcome = run_install(&app_data_dir, &runtime, &server, cancel)
            .await
            .map(|_| ());
        runtime.end_install(&server.id, outcome);
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn cancel_hosted_server_install(
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<bool, String> {
    Ok(app_state.servers.cancel_install(&server_id))
}

/// Start: install what is missing, find Java, spawn, follow. Refuses without
/// the EULA, which only the user accepts.
#[tauri::command]
pub(crate) async fn start_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<server_process::ServerStatus, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let server = server_host::get(&app_data_dir, &server_id)?;
    let dir = server_host::server_dir(&app_data_dir, &server_id);
    if !server_host::eula_accepted(&dir) {
        return Err("eula".to_string());
    }
    let runtime = app_state.servers.clone();
    if runtime.is_running(&server_id) {
        return Err("The server is already running.".to_string());
    }

    let launch = match server_install::detect_launch(&dir, &server.loader) {
        Some(launch) => launch,
        None => {
            let cancel = runtime.begin_install(&server_id)?;
            let outcome = run_install(&app_data_dir, &runtime, &server, cancel).await;
            runtime.end_install(
                &server_id,
                outcome.as_ref().map(|_| ()).map_err(|e| e.clone()),
            );
            outcome?
        }
    };
    let report: server_install::Report = Arc::new(|_| {});
    let java = server_install::ensure_java(&app_data_dir, &server, &report).await?;

    if server.auto_backup.before_start {
        let backup_dir = dir.clone();
        let keep = server.auto_backup.keep as usize;
        off_thread(move || {
            server_backup::create(&backup_dir, "before start")?;
            server_backup::prune_automatic(&backup_dir, keep)
        })
        .await?;
    }

    let command = server_process::command_for(&java, &server, &launch);
    runtime.spawn(&server_id, &dir, command)?;
    refresh_kiza_address(&app_handle, &server);

    if server.auto_backup.every_minutes > 0 {
        schedule_backups(
            runtime.clone(),
            server_id.clone(),
            dir.clone(),
            server.auto_backup.clone(),
        );
    }
    Ok(runtime.status(&dir, &server_id))
}

#[tauri::command]
pub(crate) async fn stop_hosted_server(
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<(), String> {
    app_state.servers.stop(&server_id)
}

#[tauri::command]
pub(crate) async fn kill_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<(), String> {
    if app_state.servers.is_running(&server_id) {
        return app_state.servers.kill(&server_id);
    }
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    app_state.servers.kill_detached(&dir)
}

/// Stop, wait for the process to be gone, start again.
#[tauri::command]
pub(crate) async fn restart_hosted_server(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<server_process::ServerStatus, String> {
    let runtime = app_state.servers.clone();
    if runtime.is_running(&server_id) {
        runtime.stop(&server_id)?;
        let deadline = std::time::Instant::now()
            + server_process::STOP_GRACE
            + std::time::Duration::from_secs(5);
        while runtime.is_running(&server_id) {
            if std::time::Instant::now() > deadline {
                return Err("The server did not stop.".to_string());
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
    start_hosted_server(app_handle, app_state, server_id).await
}

#[tauri::command]
pub(crate) async fn hosted_server_status(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<server_process::ServerStatus, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    let runtime = app_state.servers.clone();
    off_thread(move || Ok(runtime.status(&dir, &server_id))).await
}

/// Console lines after `after`; the page keeps its own tail and asks for
/// the rest.
#[tauri::command]
pub(crate) async fn hosted_server_console(
    app_state: tauri::State<'_, AppState>,
    server_id: String,
    after: Option<u64>,
) -> Result<Vec<server_process::ConsoleLine>, String> {
    Ok(app_state
        .servers
        .console_since(&server_id, after.unwrap_or(0)))
}

#[tauri::command]
pub(crate) async fn clear_hosted_server_console(
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<(), String> {
    app_state.servers.clear_console(&server_id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn send_hosted_server_command(
    app_state: tauri::State<'_, AppState>,
    server_id: String,
    command: String,
) -> Result<(), String> {
    app_state.servers.send(&server_id, &command)
}

/// Uptime, memory, CPU, world size, whether the port answers.
#[tauri::command]
pub(crate) async fn hosted_server_metrics(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<server_process::ServerMetrics, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let runtime = app_state.servers.clone();
    off_thread(move || {
        let server = server_host::get(&app_data_dir, &server_id)?;
        let dir = server_host::server_dir(&app_data_dir, &server_id);
        let status = runtime.status(&dir, &server_id);
        let (memory_bytes, cpu_percent) = match status.pid {
            Some(pid) => server_process::process_metrics(pid),
            None => (None, None),
        };
        let level = server_properties::read(&dir).level_name();
        Ok(server_process::ServerMetrics {
            uptime_s: status.started_at_ms.map(|started| {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(started);
                now.saturating_sub(started) / 1000
            }),
            memory_bytes,
            cpu_percent,
            world_bytes: runtime.world_bytes(&server_id, &dir.join(level)),
            port_open: status.pid.is_some() && server_process::port_open(server.port),
        })
    })
    .await
}

/// Where to join from: this machine, the network, and — when asked — the
/// internet, with whether the router forwards the port. The public part
/// costs two network calls, so it is asked for explicitly.
#[tauri::command]
pub(crate) async fn hosted_server_network(
    app_handle: tauri::AppHandle,
    server_id: String,
    with_public: Option<bool>,
) -> Result<server_network::Reachability, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    let port = off_thread(move || Ok(server_properties::read(&dir).port())).await?;
    Ok(server_network::reachability(port, with_public.unwrap_or(false)).await)
}

/// Asks the router, over UPnP, to forward the server's port here.
#[tauri::command]
pub(crate) async fn open_hosted_server_port(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<server_network::Reachability, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    let port = off_thread(move || Ok(server_properties::read(&dir).port())).await?;
    server_network::open_port(port).await
}

/// Asks Kiza's service for `<name>.<zone>` pointing at this connection, and
/// remembers it on the server. Needs a signed-in launcher, and a service
/// with the addresses set up.
#[tauri::command]
pub(crate) async fn claim_hosted_server_address(
    app_handle: tauri::AppHandle,
    server_id: String,
    name: String,
) -> Result<server_network::KizaAddress, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let origin = service_origin(&app_handle)
        .ok_or_else(|| "Kiza's service is not configured.".to_string())?;
    let server = server_host::get(&app_data_dir, &server_id)?;
    let dir = server_host::server_dir(&app_data_dir, &server_id);
    let port = server_properties::read(&dir).port();
    let headers = {
        let dir = app_data_dir.clone();
        off_thread(move || Ok(access::headers(&dir))).await?
    };
    let name = name.trim().to_lowercase();
    let name = if name.is_empty() {
        server_network::suggested_name(&server.name)
    } else {
        name
    };
    let claimed = server_network::claim_kiza_address(&origin, headers, &name, port).await?;
    server_host::set_kiza_address(&app_data_dir, &server_id, Some(claimed.clone()))?;
    Ok(claimed)
}

#[tauri::command]
pub(crate) async fn release_hosted_server_address(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    let server = server_host::get(&app_data_dir, &server_id)?;
    let Some(address) = server.kiza_address else {
        return Ok(());
    };
    let origin = service_origin(&app_handle)
        .ok_or_else(|| "Kiza's service is not configured.".to_string())?;
    let headers = {
        let dir = app_data_dir.clone();
        off_thread(move || Ok(access::headers(&dir))).await?
    };
    server_network::release_kiza_address(&origin, headers, &address.name).await?;
    server_host::set_kiza_address(&app_data_dir, &server_id, None)
}

#[tauri::command]
pub(crate) async fn close_hosted_server_port(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<server_network::Reachability, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    let port = off_thread(move || Ok(server_properties::read(&dir).port())).await?;
    server_network::close_port(port).await?;
    Ok(server_network::reachability(port, false).await)
}

#[tauri::command]
pub(crate) async fn hosted_server_properties(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<ServerPropertiesView, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || {
        Ok(ServerPropertiesView {
            entries: server_properties::read(&dir).entries,
            known: server_properties::KNOWN.to_vec(),
        })
    })
    .await
}

/// Writes the changed keys only; the rest of the file is untouched.
#[tauri::command]
pub(crate) async fn save_hosted_server_properties(
    app_handle: tauri::AppHandle,
    server_id: String,
    changes: std::collections::BTreeMap<String, String>,
) -> Result<ServerPropertiesView, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || {
        let dir = server_host::server_dir(&app_data_dir, &server_id);
        let saved = server_properties::write(&dir, &changes)?;
        server_host::note_port(&app_data_dir, &server_id, saved.port())?;
        Ok(ServerPropertiesView {
            entries: saved.entries,
            known: server_properties::KNOWN.to_vec(),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn hosted_server_players(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<server_players::PlayerLists, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || Ok(server_players::read(&dir))).await
}

/// kick, ban, pardon, op, deop, whitelist_add, whitelist_remove — through
/// the running server's console, which is the only party that can do them.
#[tauri::command]
pub(crate) async fn hosted_server_player_action(
    app_state: tauri::State<'_, AppState>,
    server_id: String,
    action: String,
    player: String,
    reason: Option<String>,
) -> Result<(), String> {
    let command = server_players::command_for(&action, &player, reason.as_deref())?;
    app_state.servers.send(&server_id, &command)
}

#[tauri::command]
pub(crate) async fn hosted_server_mods(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<Vec<server_mods::ServerMod>, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || Ok(server_mods::list(&dir))).await
}

#[tauri::command]
pub(crate) async fn hosted_server_mod_compatibility(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<mod_compat::CompatReport, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || {
        let server = server_host::get(&app_data_dir, &server_id)?;
        let dir = server_host::server_dir(&app_data_dir, &server_id);
        server_mods::compatibility(
            &server_id,
            &dir,
            &server.mc_version,
            &server.loader,
            server.loader_version.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn remove_hosted_server_mod(
    app_handle: tauri::AppHandle,
    server_id: String,
    file: String,
) -> Result<(), String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || server_mods::remove(&dir, &file)).await
}

#[tauri::command]
pub(crate) async fn set_hosted_server_mod_enabled(
    app_handle: tauri::AppHandle,
    server_id: String,
    file: String,
    enabled: bool,
) -> Result<String, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || server_mods::set_enabled(&dir, &file, enabled)).await
}

#[tauri::command]
pub(crate) async fn add_hosted_server_mod_file(
    app_handle: tauri::AppHandle,
    server_id: String,
    source_path: String,
) -> Result<server_mods::ServerMod, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || server_mods::add_file(&dir, std::path::Path::new(&source_path))).await
}

/// Installs a catalogue project on the server: `source` is `modrinth` or
/// `curseforge`, `project_id` theirs, `version_id` optional.
#[tauri::command]
pub(crate) async fn install_hosted_server_mod(
    app_handle: tauri::AppHandle,
    server_id: String,
    source: String,
    project_id: String,
    version_id: Option<String>,
) -> Result<server_mods::ServerMod, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let server = server_host::get(&app_data_dir, &server_id)?;
    let dir = server_host::server_dir(&app_data_dir, &server_id);
    match source.as_str() {
        "modrinth" => {
            server_mods::install_from_modrinth(
                &dir,
                &server.mc_version,
                &server.loader,
                &project_id,
                version_id.as_deref(),
            )
            .await
        }
        "curseforge" => {
            let key = curseforge_api_key()?;
            let mod_id: u64 = project_id
                .parse()
                .map_err(|_| "A CurseForge project id is a number.".to_string())?;
            let file_id = version_id
                .map(|v| v.parse::<u64>())
                .transpose()
                .map_err(|_| "A CurseForge file id is a number.".to_string())?;
            server_mods::install_from_curseforge(
                &dir,
                &server.mc_version,
                &server.loader,
                &key,
                mod_id,
                file_id,
            )
            .await
        }
        other => Err(format!("Unknown catalogue: {other}")),
    }
}

/// Newer releases of the server's mods, from the bytes on disk.
#[tauri::command]
pub(crate) async fn check_hosted_server_mod_updates(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<Vec<server_mods::ServerModUpdate>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let server = server_host::get(&app_data_dir, &server_id)?;
    let dir = server_host::server_dir(&app_data_dir, &server_id);
    let key = curseforge_api_key().ok();
    server_mods::check_updates(&dir, &server.mc_version, &server.loader, key.as_deref()).await
}

#[tauri::command]
pub(crate) async fn apply_hosted_server_mod_update(
    app_handle: tauri::AppHandle,
    server_id: String,
    update: server_mods::ServerModUpdate,
) -> Result<server_mods::ServerMod, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let server = server_host::get(&app_data_dir, &server_id)?;
    let dir = server_host::server_dir(&app_data_dir, &server_id);
    let key = curseforge_api_key().ok();
    server_mods::apply_update(
        &dir,
        &server.mc_version,
        &server.loader,
        key.as_deref(),
        &update,
    )
    .await
}

#[tauri::command]
pub(crate) async fn hosted_server_backups(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<Vec<server_backup::Backup>, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || Ok(server_backup::list(&dir))).await
}

/// A backup, with a `save-all` first when the server is running so the
/// world on disk is the world in memory.
#[tauri::command]
pub(crate) async fn create_hosted_server_backup(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
    label: String,
) -> Result<server_backup::Backup, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    if app_state.servers.is_running(&server_id) {
        let _ = app_state.servers.send(&server_id, "save-all flush");
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    off_thread(move || server_backup::create(&dir, &label)).await
}

#[tauri::command]
pub(crate) async fn restore_hosted_server_backup(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    server_id: String,
    file: String,
) -> Result<server_backup::Backup, String> {
    if app_state.servers.is_running(&server_id) {
        return Err("Stop the server before restoring a backup.".to_string());
    }
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || server_backup::restore(&dir, &file)).await
}

#[tauri::command]
pub(crate) async fn delete_hosted_server_backup(
    app_handle: tauri::AppHandle,
    server_id: String,
    file: String,
) -> Result<(), String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || server_backup::delete(&dir, &file)).await
}

/// What went wrong on the last crash, read the way the instance doctor
/// reads a game folder: `logs/latest.log` and `crash-reports/`.
#[tauri::command]
pub(crate) async fn diagnose_hosted_server_crash(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<Vec<crash_doctor::CrashFinding>, String> {
    let dir = server_host::server_dir(&app_data_dir(&app_handle), &server_id);
    off_thread(move || Ok(crash_doctor::analyse_instance(&dir))).await
}

/// Tail of the server's own log, for when the console ring has scrolled
/// past what is wanted.
#[tauri::command]
pub(crate) async fn hosted_server_log(
    app_handle: tauri::AppHandle,
    server_id: String,
    lines: Option<usize>,
) -> Result<String, String> {
    let path = server_host::server_dir(&app_data_dir(&app_handle), &server_id)
        .join("logs")
        .join("latest.log");
    off_thread(move || {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let take = lines.unwrap_or(400);
        let all: Vec<&str> = content.lines().collect();
        let start = all.len().saturating_sub(take);
        Ok(all[start..].join("\n"))
    })
    .await
}

/// Reads an instance for the "Create server from instance" review screen.
#[tauri::command]
pub(crate) async fn analyse_instance_for_server(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<server_from_instance::InstanceAnalysis, String> {
    let app_data_dir = app_data_dir(&app_handle);
    server_from_instance::analyse(&app_data_dir, &instance_id).await
}

#[tauri::command]
pub(crate) async fn build_server_from_instance(
    app_handle: tauri::AppHandle,
    request: server_from_instance::BuildRequest,
) -> Result<server_from_instance::BuildOutcome, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || server_from_instance::build(&app_data_dir, request)).await
}

/// Server mods against the paired instance's: what is missing where.
#[tauri::command]
pub(crate) async fn compare_hosted_server_with_instance(
    app_handle: tauri::AppHandle,
    server_id: String,
    instance_id: Option<String>,
) -> Result<server_from_instance::SyncReport, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || {
        let server = server_host::get(&app_data_dir, &server_id)?;
        let instance_id = instance_id
            .or(server.linked_instance_id)
            .ok_or_else(|| "This server is not paired with an instance.".to_string())?;
        server_from_instance::compare(&app_data_dir, &server_id, &instance_id)
    })
    .await
}

/// Modrinth, narrowed to what this server can load: its Minecraft, its
/// loader, and not the projects that say they run on the client only.
#[tauri::command]
pub(crate) async fn search_mods_for_hosted_server(
    app_handle: tauri::AppHandle,
    server_id: String,
    query: String,
    limit: Option<u32>,
) -> Result<modrinth_api::ModrinthSearchResponse, String> {
    let server = server_host::get(&app_data_dir(&app_handle), &server_id)?;
    if server.loader == game_manager::MinecraftLoader::Vanilla {
        return Err("A vanilla server loads no mods.".to_string());
    }
    let filters = modrinth_api::SearchFilters {
        mc_version: Some(server.mc_version.as_str()),
        loader: Some(server.loader.slug()),
        categories: &[],
        client_side: None,
        // `required` alone would hide the many that are optional on the
        // server; the install refuses `unsupported` when it comes to it.
        server_side: None,
    };
    modrinth_api::search_projects(
        &query,
        "mod",
        &filters,
        limit.unwrap_or(12),
        0,
        Some("relevance"),
    )
    .await
}

#[tauri::command]
pub(crate) async fn detect_server_folder(folder: String) -> Result<server_import::Detection, String> {
    off_thread(move || {
        let path = std::path::Path::new(&folder);
        if !path.is_dir() {
            return Err("That folder does not exist.".to_string());
        }
        Ok(server_import::detect(path))
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_hosted_server(
    app_handle: tauri::AppHandle,
    request: server_import::ImportRequest,
) -> Result<server_host::HostedServerSummary, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || server_import::import(&app_data_dir, request)).await
}
