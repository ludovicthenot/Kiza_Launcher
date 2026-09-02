//! Kiza Setup — the installer for Kiza Launcher.
//!
//! It is a Tauri application rather than a wizard on purpose: the first thing
//! anyone sees of Kiza should look like Kiza. What that costs is spelled out in
//! `webview2.rs`, and handled there.
//!
//! The command line it answers to is not ours to design — see `cli.rs`.

pub mod channel;
pub mod cli;
pub mod folders;
pub mod install;
pub mod layout;
pub mod payload;
pub mod registry;
pub mod running;
pub mod shortcuts;
pub mod uninstall;
pub mod webview2;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Everything the interface needs to draw itself, decided in Rust so the two
/// sides cannot disagree about what is about to happen.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Plan {
    pub product: &'static str,
    pub version: &'static str,
    /// "install" or "uninstall".
    pub mode: &'static str,
    /// A previous install is being replaced.
    pub is_update: bool,
    /// Set when a previous install was found, whatever its version.
    pub previous_version: Option<String>,
    /// Nothing may be asked: the window shows progress and closes itself.
    pub unattended: bool,
    /// `/R` — the launcher is to be started again once this is done. The
    /// interface needs it to know whether an unattended run ends by launching
    /// or just by closing.
    pub restart: bool,
    pub install_dir: PathBuf,
    /// What the launcher will occupy once unpacked.
    pub size_bytes: u64,
    /// This build carries no launcher. The interface refuses to install rather
    /// than running to completion having copied nothing.
    pub payload_missing: bool,
    /// Only meaningful when uninstalling.
    pub user_data_dir: Option<PathBuf>,
}

pub struct Session {
    pub options: cli::Options,
}

/// Where this run should install to: what was asked for on the command line,
/// else where Kiza already is, else the default.
pub fn resolve_install_dir(options: &cli::Options) -> Result<PathBuf, String> {
    if let Some(requested) = &options.install_dir {
        return Ok(requested.clone());
    }
    if let Some(existing) = registry::existing_install() {
        return Ok(existing.install_dir);
    }
    Ok(layout::default_install_dir(&folders::local_app_data()?))
}

/// The folder an uninstall should remove.
///
/// `/D=` comes first, because that is how the uninstaller tells the copy of
/// itself running from the temporary folder which folder to clear — without it
/// that copy would look beside itself, find no launcher, and give up. The value
/// is still checked before anything is deleted; see `uninstall::run`.
pub fn resolve_uninstall_dir(options: &cli::Options) -> Result<PathBuf, String> {
    if let Some(requested) = &options.install_dir {
        return Ok(requested.clone());
    }
    uninstall::install_dir(&std::env::current_exe().map_err(|e| e.to_string())?)
        .ok_or_else(|| "Kiza Launcher does not appear to be installed.".to_string())
}

pub fn build_plan(options: &cli::Options) -> Result<Plan, String> {
    let existing = registry::existing_install();
    let uninstalling = options.mode == cli::Mode::Uninstall;

    let install_dir = if uninstalling {
        resolve_uninstall_dir(options)?
    } else {
        resolve_install_dir(options)?
    };

    Ok(Plan {
        product: layout::product_name(),
        version: VERSION,
        mode: if uninstalling { "uninstall" } else { "install" },
        is_update: options.update || existing.is_some(),
        previous_version: existing.map(|found| found.version),
        unattended: options.unattended(),
        restart: options.restart,
        install_dir,
        size_bytes: payload::installed_size(),
        payload_missing: payload::is_placeholder(),
        user_data_dir: uninstalling.then(uninstall::user_data_dir).flatten(),
    })
}

/// Starts the launcher, passing on whatever arguments the updater asked us to
/// forward — a `kiza://` link the user clicked before the update, typically.
pub fn launch(executable: &PathBuf, args: &[String]) -> Result<(), String> {
    std::process::Command::new(executable)
        .args(args)
        .current_dir(executable.parent().unwrap_or(executable.as_path()))
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start Kiza Launcher: {error}"))
}

#[tauri::command]
fn plan(session: tauri::State<'_, Session>) -> Result<Plan, String> {
    build_plan(&session.options)
}

#[tauri::command]
async fn run_install(
    app: tauri::AppHandle,
    request: install::Request,
) -> Result<install::Report, String> {
    // Unpacking 40 MB would block the runtime that has to deliver the progress
    // events, so it runs on a thread of its own.
    tauri::async_runtime::spawn_blocking(move || {
        install::run(&request, VERSION, |progress| {
            let _ = app.emit("setup://progress", progress);
        })
    })
    .await
    .map_err(|error| format!("The install stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn run_uninstall(
    session: tauri::State<'_, Session>,
    request: uninstall::Request,
) -> Result<uninstall::Summary, String> {
    // Resolved before the thread starts: `State` cannot cross an await.
    let install_dir = resolve_uninstall_dir(&session.options)?;

    tauri::async_runtime::spawn_blocking(move || {
        uninstall::run(&request, &uninstall::targets_for(&install_dir))
    })
    .await
    .map_err(|error| format!("The removal stopped unexpectedly: {error}"))?
}

/// Closes the installer, optionally starting what it just installed.
#[tauri::command]
fn finish(app: tauri::AppHandle, session: tauri::State<'_, Session>, start: bool) {
    if start {
        if let Ok(plan) = build_plan(&session.options) {
            let _ = launch(
                &layout::executable_in(&plan.install_dir),
                &session.options.app_args,
            );
        }
    }
    app.exit(0);
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Runs the whole thing with no window, for `/S`.
pub fn run_headless(options: &cli::Options) -> Result<(), String> {
    if options.mode == cli::Mode::Uninstall {
        let install_dir = resolve_uninstall_dir(options)?;
        uninstall::run(
            &uninstall::Request {
                remove_user_data: false,
            },
            &uninstall::targets_for(&install_dir),
        )?;
        return Ok(());
    }

    if !webview2::is_installed() {
        // Silent means silent: Microsoft's installer gets the same treatment.
        webview2::install(true)?;
    }

    let install_dir = resolve_install_dir(options)?;
    let report = install::run(
        &install::Request {
            install_dir,
            // An unattended run creates the shortcuts a normal install would,
            // because that is what the person who scripted it expects to find.
            desktop_shortcut: !options.update,
            start_menu_shortcut: !options.update,
        },
        VERSION,
        |_| {},
    )?;

    if options.restart {
        launch(&report.executable, &options.app_args)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(options: cli::Options) {
    tauri::Builder::default()
        .manage(Session { options })
        .invoke_handler(tauri::generate_handler![
            plan,
            run_install,
            run_uninstall,
            finish,
            quit
        ])
        .setup(|app| {
            // The window is created hidden and shown from the interface, so the
            // first frame anyone sees is a drawn one rather than a white
            // rectangle.
            if let Some(window) = app.get_webview_window("setup") {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Kiza Setup could not start");
}
