//! Playing: launching, watching, stopping, and what to do when it crashed.
//!
//! Commands only: the interface's entry points, moved out of the crate root
//! so that file is a table of contents rather than the whole book. Helpers
//! and state stay where they were and are reached through the glob below;
//! a child module sees everything its parent does.

#![allow(unused_imports)]

use crate::*;

#[tauri::command]
pub(crate) async fn get_performance_profiles() -> Vec<minecraft_manager::MinecraftPerformanceProfile> {
    minecraft_manager::get_performance_profiles()
}

#[tauri::command]
pub(crate) fn get_instance_performance_profile(
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
pub(crate) fn save_instance_performance_profile(
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
pub(crate) fn get_minecraft_install_status(
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
pub(crate) async fn start_minecraft_install(
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
pub(crate) async fn launch_minecraft_instance(
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
    announce_running_games(&app_handle);
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
    // A presence mod in the instance owns Discord for this run: two hands on
    // one status is a status that flickers. The launcher's goes quiet until
    // the game exits.
    let presence_yielded =
        mod_courtesy::yielded_to(&result.courtesies, mod_courtesy::Area::Presence).is_some();
    if presence_yielded {
        app_state.discord_manager.set_idle();
    } else {
        app_state
            .discord_manager
            .update_minecraft_starting_presence(
                presence_details.clone(),
                presence_state.clone(),
                presence_start,
            );
    }

    let hide_to_tray = presence_config.close_to_tray_on_launch;

    // Watch the game process so the UI and Discord presence reflect when the
    // game actually exits, and surface a crash instead of failing silently.
    //
    // Started before anything that touches a window, and that ordering is the
    // fix for a bug rather than a preference. Opening the log window used to
    // come first, and building a webview is a call into the platform's UI
    // thread: when it did not come back, neither did anything after it, so the
    // watcher was never started and the launcher believed the game was still
    // running long after it had closed. Nothing about following a process
    // should depend on a window appearing.
    let running_games = app_state.running_games.clone();
    let stop_requested = app_state.stop_requested.clone();
    let discord_manager = app_state.discord_manager.clone();
    let log_path = result.log_path.clone();
    let watcher_app = app_handle.clone();
    // The watcher takes the id with it, and the log window below still needs
    // one to open on.
    let console_instance_id = watched_instance_id.clone();
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
                    if player_state != last_player_state && !presence_yielded {
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
                    crate::log_warn!("Launch", "Could not poll Minecraft process: {error}");
                    break None;
                }
            }
        };
        let exit_code = exit.and_then(|status| status.code());
        // A game the person stopped from the launcher exits like a crash
        // would, with a non-zero code. It was asked to; that is not a crash,
        // and a safe-mode bisection must not count it as one either.
        let stopped_on_request = stop_requested
            .lock()
            .map(|mut stops| stops.remove(&watched_instance_id))
            .unwrap_or(false);
        let crashed = !stopped_on_request && exit_code.is_some_and(|code| code != 0);
        record_performance_run(&performance_dir, &watched_instance_id, reached_menu_after);
        // The base mod only reports on versions it supports; where it does not
        // run there is no menu signal, and none must be invented.
        let reached_menu = state_bridge.is_some().then(|| reached_menu_after.is_some());
        if !stopped_on_request {
            record_safe_mode_outcome(
                &performance_dir,
                &watched_instance_id,
                exit_code,
                reached_menu,
            );
            // A crash after a fix keeps the fix on offer to undo; a game
            // that came up retires it.
            doctor::note_launch(
                &performance_dir,
                &watched_instance_id,
                crashed || reached_menu == Some(false),
            );
            // A crash reports itself when the person said it always may.
            if crashed
                && crash_telemetry::Consent::parse(
                    &ConfigManager::new(performance_dir.clone())
                        .load_config()
                        .crash_reports,
                ) == crash_telemetry::Consent::Always
            {
                let app = watcher_app.clone();
                let id = watched_instance_id.clone();
                tauri::async_runtime::spawn(async move {
                    // The status is written just below; give it a moment so
                    // the report carries the exit code.
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    if let Err(error) = send_crash_report(&app, &id).await {
                        crate::log_warn!("Crash reports", "Could not send the crash report: {error}");
                    }
                });
            }
        }
        launch_manager.set(
            &watched_instance_id,
            minecraft_manager::LaunchStatus {
                phase: if crashed {
                    minecraft_manager::LaunchPhase::Crashed
                } else {
                    minecraft_manager::LaunchPhase::Exited
                },
                message: if crashed {
                    Some(format!(
                        "Minecraft exited with code {}.",
                        exit_code.unwrap_or(-1)
                    ))
                } else if stopped_on_request {
                    Some("Stopped from the launcher.".to_string())
                } else {
                    None
                },
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
        announce_running_games(&watcher_app);
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
        // A server that stayed up through the game session takes the
        // presence back before the launcher's own page does.
        let hosting = no_running_games
            && watcher_app.try_state::<AppState>().is_some_and(|state| {
                refresh_hosting_presence(&state, &crate::app_data_dir(&watcher_app))
            });
        if no_running_games && !hosting {
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
                webview_power::wake(&window);
                let _ = window.show();
                if crashed {
                    let _ = window.set_focus();
                }
            }
        }
    });

    // Now the windows. The game is spawned, its status is Running and the
    // watcher is following it, so everything below is presentation: if any of
    // it fails, the launcher still knows what the game is doing.
    if presence_config.open_log_window_on_launch {
        let _ = open_console_window(app_handle.clone(), console_instance_id);
    }
    if hide_to_tray {
        if let Some(window) = app_handle.get_webview_window("main") {
            webview_power::hide(&window);
        }
    }

    // "Quit the launcher after the game starts", from General.
    //
    // Deliberately last: the process is running, its pid is recorded, the
    // watcher is following it and the log window is open, so what is being
    // closed is a launcher with nothing left to do. Quitting takes the watcher
    // with it, so this instance's last-played time is already written by now.
    if presence_config.quit_after_launch {
        let quitting = app_handle.clone();
        // A short delay so the frontend receives the Running status before the
        // window disappears, rather than the game seeming to launch nothing.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1_200));
            quitting.exit(0);
        });
    }

    Ok(result)
}

#[tauri::command]
pub(crate) fn get_launch_status(
    app_state: tauri::State<AppState>,
    instance_id: String,
) -> minecraft_manager::LaunchStatus {
    app_state.launch_manager.get(&instance_id)
}

/// Force-stops the running Minecraft process for an instance.
///
/// A process that cannot be found has already stopped, and saying so as an
/// error was the wrong answer to the only situation where this is the button
/// somebody needs. If the launcher believed a game was running and it was not,
/// Stop refused to do anything about it and the instance stayed "In game"
/// until the launcher was restarted -- the one case where the escape hatch
/// existed and would not open. Gone now means recorded as stopped.
#[tauri::command]
pub(crate) fn stop_minecraft_instance(
    app_handle: tauri::AppHandle,
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
    if system.process(sysinfo::Pid::from_u32(pid)).is_some() {
        // Marked before anything, so the watcher cannot see the exit first.
        if let Ok(mut stops) = app_state.stop_requested.lock() {
            stops.insert(instance_id.clone());
        }
        // Asked to close first -- the world saves, the loader shuts down,
        // no mod mistakes it for a crash -- and killed only if it will not.
        // Twenty seconds: a game stopped while it loads takes the request
        // when the load ends, not before. Off the window thread: it waits.
        tauri::async_runtime::spawn_blocking(move || {
            process_close::close_or_kill(pid, std::time::Duration::from_secs(20));
        });
        return Ok(());
    }

    // Not running any more. The watcher would normally have noticed and
    // written this; it did not, so the launcher's own record is what is wrong
    // and this corrects it rather than reporting a failure at the person who
    // pressed the only button that could help.
    if let Ok(mut running) = app_state.running_games.lock() {
        running.remove(&instance_id);
    }
    announce_running_games(&app_handle);
    app_state.launch_manager.set(
        &instance_id,
        minecraft_manager::LaunchStatus {
            phase: minecraft_manager::LaunchPhase::Exited,
            message: None,
            pid: None,
            exit_code: None,
            log_path: app_state.launch_manager.get(&instance_id).log_path,
        },
    );
    Ok(())
}

/// Opens (or focuses) the separate Kiza Manager log window for an instance.
#[tauri::command]
pub(crate) fn open_console_window(app_handle: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("console") {
        // Reloaded, not just re-hashed. The window reads its instance out of
        // the address once, when it boots, so setting the hash on a window
        // that is already running left it showing the logs of whichever
        // instance it was opened for first.
        let _ = window.eval(format!(
            "window.location.replace('index.html#/console/{instance_id}')"
        ));
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
pub(crate) fn return_to_launcher(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(console) = app_handle.get_webview_window("console") {
        let _ = console.close();
    }
    show_launcher(&app_handle);
    Ok(())
}

/// Tail of the instance game log, for the crash panel.
#[tauri::command]
pub(crate) fn read_instance_log(
    app_handle: tauri::AppHandle,
    instance_id: String,
    lines: Option<usize>,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let logs = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id).join("logs");
    // The captured log is the game's console: it opens with the launcher's
    // header, carries the Kiza client's lines and what the JVM said as it
    // died, none of which latest.log has. An instance played before the
    // capture existed still has a latest.log to show.
    let captured = logs.join(minecraft_manager::LAUNCHER_CAPTURED_LOG);
    let path = if captured.is_file() {
        captured
    } else {
        logs.join("latest.log")
    };
    let take = lines.unwrap_or(200);
    // Only the tail is read. The Manager asks every second, and a long
    // session's console runs to tens of megabytes; six hundred lines never
    // need more than the last half megabyte of it.
    let content = read_tail(&path, 512 * 1024).map_err(|e| e.to_string())?;
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(take);
    Ok(all[start..].join("\n"))
}

/// What the last launch of this instance was: version, loader, profile,
/// account, Java, memory -- the header of the Kiza Manager.
#[tauri::command]
pub(crate) async fn read_launch_record(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Option<minecraft_manager::LaunchRecord>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || Ok(minecraft_manager::read_launch_record(&app_data_dir, &instance_id))).await
}

/// Opens the game's log in whatever the system opens .log files with.
///
/// From Rust rather than the window: opening a path from the page needs a
/// scope the opener plugin was never given, so the button did nothing.
#[tauri::command]
pub(crate) async fn open_instance_log(
    app_handle: tauri::AppHandle,
    instance_id: String,
    which: Option<String>,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    let logs = minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id).join("logs");
    let file = match which.as_deref() {
        Some("captured") => logs.join(minecraft_manager::LAUNCHER_CAPTURED_LOG),
        Some("folder") => logs.clone(),
        _ => logs.join("latest.log"),
    };
    if !file.exists() {
        return Err("There is no log yet.".to_string());
    }
    off_thread(move || {
        tauri_plugin_opener::open_path(file.to_string_lossy().to_string(), None::<&str>)
            .map_err(|e| e.to_string())
    })
    .await
}

/// Names what went wrong on the last failed launch, reading the game log, the
/// crash report and the JVM dump. An empty list means we could not tell.
#[tauri::command]
pub(crate) fn diagnose_instance_crash(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Vec<crash_doctor::CrashFinding> {
    let game_dir =
        minecraft_manager::instance_game_dir_path(&app_data_dir(&app_handle), &instance_id);
    crash_doctor::analyse_instance(&game_dir)
}

/// Starts a hunt for the mod that breaks this instance.
#[tauri::command]
pub(crate) fn safe_mode_start(
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
pub(crate) fn safe_mode_record(
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
pub(crate) fn safe_mode_status(app_handle: tauri::AppHandle, instance_id: String) -> Option<SafeModeState> {
    safe_mode::load(&app_data_dir(&app_handle), &instance_id)
        .map(|session| safe_mode_state(&session))
}

/// Ends the hunt and puts every mod back on.
#[tauri::command]
pub(crate) fn safe_mode_stop(app_handle: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = GameManager::new(app_data_dir.clone()).verify_instance(&instance_id)?;
    if let Some(session) = safe_mode::load(&app_data_dir, &instance_id) {
        apply_safe_mode_selection(&app_data_dir, &instance, &session.candidates)?;
    }
    safe_mode::clear(&app_data_dir, &instance_id);
    Ok(())
}

/// When each instance was last launched, for the whole library at once.
#[tauri::command]
pub(crate) fn instance_play_history(
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
pub(crate) fn dismiss_launch_status(app_state: tauri::State<AppState>, instance_id: String) {
    app_state
        .launch_manager
        .set(&instance_id, minecraft_manager::LaunchStatus::idle());
}

#[tauri::command]
pub(crate) fn get_running_minecraft_instances(app_state: tauri::State<AppState>) -> HashMap<String, u32> {
    app_state
        .running_games
        .lock()
        .map(|running| running.clone())
        .unwrap_or_default()
}

/// Carries out what the crash doctor proposed, with a way back.
///
/// A restore point first, then the folder-side actions in order; the
/// record of it waits for the next launch. Settings and long jobs (Java,
/// memory, repair) are not done here -- the panel drives those -- but they
/// are written into the record all the same, so "what did the doctor do"
/// has one answer.
#[tauri::command]
pub(crate) async fn doctor_apply(
    app_handle: tauri::AppHandle,
    instance_id: String,
    actions: Vec<crash_doctor::CrashAction>,
) -> Result<doctor::PendingFix, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = dependency_instance(&app_data_dir, &instance_id)?;
    if actions.is_empty() {
        return Err("Nothing to do.".to_string());
    }
    off_thread(move || {
        let game_dir = PathBuf::from(&instance.install_path);
        let mods_dir = game_dir.join("mods");
        let summary = match actions.len() {
            1 => doctor::describe(&actions[0]),
            n => format!("{n} fixes"),
        };
        let fix = doctor::begin(
            &app_data_dir,
            &instance_id,
            &game_dir,
            &summary,
            actions.iter().map(doctor::describe).collect(),
        )?;
        for action in &actions {
            doctor::apply_in_folder(&mods_dir, action)?;
        }
        // The catalogue follows the folder: a mod switched off by file is
        // switched off in the list too, or the Mods tab would say otherwise.
        let manager = ModManager::new(app_data_dir.clone());
        let mut mods = manager.load_mods(&instance_id);
        let mut changed = false;
        for action in &actions {
            let (file, enabled) = match action {
                crash_doctor::CrashAction::DisableMod(file) => (file.as_str(), false),
                crash_doctor::CrashAction::EnableMod(file) => (file.trim_end_matches(".disabled"), true),
                _ => continue,
            };
            for entry in mods.iter_mut() {
                let owns = entry
                    .files
                    .iter()
                    .any(|path| path.rsplit(['/', '\\']).next() == Some(file));
                if owns && entry.enabled != enabled {
                    entry.enabled = enabled;
                    changed = true;
                }
            }
        }
        if changed {
            manager.save_mods(&instance_id, &mods)?;
        }
        Ok(fix)
    })
    .await
}

/// The fix waiting on a launch, if any.
#[tauri::command]
pub(crate) async fn doctor_pending(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Option<doctor::PendingFix>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || Ok(doctor::load(&app_data_dir, &instance_id))).await
}

/// Puts the instance back as it was before the last fix.
#[tauri::command]
pub(crate) async fn doctor_undo(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<doctor::PendingFix, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = dependency_instance(&app_data_dir, &instance_id)?;
    off_thread(move || {
        let game_dir = PathBuf::from(&instance.install_path);
        let fix = doctor::undo(&app_data_dir, &instance_id, &game_dir)?;
        // The catalogue follows the folder back.
        let manager = ModManager::new(app_data_dir.clone());
        let mut mods = manager.load_mods(&instance_id);
        let mods_dir = game_dir.join("mods");
        let mut changed = false;
        for entry in mods.iter_mut() {
            let on_disk = entry.files.iter().any(|path| {
                path.rsplit(['/', '\\'])
                    .next()
                    .is_some_and(|name| mods_dir.join(name).is_file())
            });
            let off_disk = entry.files.iter().any(|path| {
                path.rsplit(['/', '\\'])
                    .next()
                    .is_some_and(|name| mods_dir.join(format!("{name}.disabled")).is_file())
            });
            let enabled = on_disk || !off_disk;
            if entry.enabled != enabled {
                entry.enabled = enabled;
                changed = true;
            }
        }
        if changed {
            manager.save_mods(&instance_id, &mods)?;
        }
        Ok(fix)
    })
    .await
}

/// Looks at everything the instance needs, mends what it can, and reports.
///
/// The game files are checked the way a launch checks them and the
/// installer is started if they fail. Catalogued mods whose file is gone
/// and whose origin is known are fetched again. The rest is named.
#[tauri::command]
pub(crate) async fn repair_instance(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    instance_id: String,
) -> Result<instance_repair::RepairReport, String> {
    let app_data_dir = app_data_dir(&app_handle);
    let instance = dependency_instance(&app_data_dir, &instance_id)?;
    if app_state
        .running_games
        .lock()
        .map_err(|_| "Running games lock is poisoned".to_string())?
        .contains_key(&instance_id)
    {
        return Err("This instance is running; stop the game first.".to_string());
    }

    let examined = {
        let app_data_dir = app_data_dir.clone();
        let instance = instance.clone();
        off_thread(move || Ok(instance_repair::examine(&app_data_dir, &instance))).await?
    };
    let mut report = examined;

    if report.reinstall_started {
        let minecraft = instance
            .minecraft
            .as_ref()
            .ok_or_else(|| "Not a Minecraft instance".to_string())?;
        match app_state.minecraft_install_manager.try_start(
            &instance_id,
            minecraft_manager::planned_install_steps(&minecraft.loader),
        ) {
            Ok(()) => {
                let install_manager = (*app_state.minecraft_install_manager).clone();
                let app_data_dir = app_data_dir.clone();
                let instance = instance.clone();
                let id = instance_id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = minecraft_manager::install_minecraft_instance(
                        app_data_dir,
                        install_manager.clone(),
                        instance,
                    )
                    .await
                    {
                        install_manager.set_error(&id, error);
                    }
                });
            }
            Err(reason) => {
                report.reinstall_started = false;
                report.checks.push(instance_repair::Check {
                    area: "game".to_string(),
                    title: "Installer".to_string(),
                    verdict: instance_repair::Verdict::Broken,
                    detail: reason,
                });
            }
        }
    }

    // Mods with a known origin are fetched again, one by one, and the
    // report says which came back and which did not.
    let refetch = std::mem::take(&mut report.refetch);
    let mut came_back = Vec::new();
    let mut did_not = Vec::new();
    for item in refetch {
        let request = dependency_resolver::ResolveDependenciesRequest {
            instance_id: instance_id.clone(),
            source: match item.origin.provider.as_str() {
                "curseforge" => dependency_resolver::ModProvider::Curseforge,
                _ => dependency_resolver::ModProvider::Modrinth,
            },
            project_id: item.origin.project_id.clone(),
            version_id: Some(item.origin.version_id.clone()),
            file_id: item.origin.version_id.parse::<u64>().ok(),
            author: None,
        };
        let api_key = dependency_api_key(request.source).ok().flatten();
        match dependency_resolver::install_for_instance(&app_data_dir, &instance, &request, api_key)
            .await
        {
            Ok(_) => came_back.push(item.name),
            Err(reason) => did_not.push(format!("{} ({reason})", item.name)),
        }
    }
    if let Some(check) = report
        .checks
        .iter_mut()
        .find(|check| check.title == "Mods to fetch again")
    {
        check.detail = if did_not.is_empty() {
            format!("Fetched again: {}.", came_back.join(", "))
        } else {
            check.verdict = instance_repair::Verdict::Broken;
            format!(
                "Fetched again: {}. Could not fetch: {}.",
                if came_back.is_empty() { "none".to_string() } else { came_back.join(", ") },
                did_not.join("; ")
            )
        };
    }
    Ok(report)
}

#[tauri::command]
pub(crate) fn performance_report(
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
pub(crate) fn performance_measure_next_launch(
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
pub(crate) fn performance_apply_advice(
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

/// The ticket a crash would send, so the banner can show it first.
#[tauri::command]
pub(crate) async fn crash_report_preview(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<crash_telemetry::CrashReport, String> {
    crash_report_for(&app_handle, &instance_id).await
}

/// Sends the crash report for an instance, once per fingerprint per day.
///
/// `remember` writes the answer into the settings: "always" or "never", so
/// the question is not asked again. Sent through the support service like
/// a ticket typed by hand, and read in the same place.
#[tauri::command]
pub(crate) async fn crash_report_send(
    app_handle: tauri::AppHandle,
    instance_id: String,
    remember: Option<String>,
) -> Result<Option<support::TicketSent>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    if let Some(answer) = remember.as_deref().filter(|a| *a == "always" || *a == "never") {
        let manager = ConfigManager::new(app_data_dir.clone());
        let mut config = manager.load_config();
        config.crash_reports = answer.to_string();
        manager.save_config(&config)?;
        if answer == "never" {
            return Ok(None);
        }
    }
    send_crash_report(&app_handle, &instance_id).await.map(Some)
}
