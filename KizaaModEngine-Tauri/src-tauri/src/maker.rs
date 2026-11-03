//! Kiza Maker's own start-up: a theme editor, not a launcher.
//!
//! The Maker draws the launcher's pages so a designer sees a theme on the real
//! thing — but it is not a launcher, and nothing in it may behave like one.
//! Built from the same crate, it starts here instead of in `run`, and this
//! builder registers what making a theme needs and nothing else:
//!
//! - the theme commands (open, stage a picture, save, list, forget);
//! - the window, the file dialogue and the file drop;
//! - the editor's own window, for a panel taken out of the launcher;
//! - which edition this is.
//!
//! What is *not* here is the point. No Minecraft launch or install, no
//! accounts, no downloads, no servers, no Discord presence, no tray, no
//! updater, no deep links. Those commands are not registered, so a page that
//! asked for one — or anything that got into a page — would be told the
//! command does not exist. The interface answers the launcher's questions
//! itself, from a demonstration library (`src/lib/maker/demo.ts`): test
//! instances to theme, and launches that are only acted out.
//!
//! Its data lives apart from the launcher's (`com.kizamods.maker`), so a
//! staff member's real instances, accounts and settings are never in reach.

use crate::{commands, launcher_log, windows_identity};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// The editor's own window, when the panel is taken out of the launcher.
const PANEL_WINDOW: &str = "maker-panel";

/// Opens the editor in a window of its own, so the launcher can be seen
/// whole — on a second screen, or simply beside it.
#[tauri::command]
async fn open_maker_panel(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PANEL_WINDOW) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        PANEL_WINDOW,
        WebviewUrl::App("index.html#/maker-panel".into()),
    )
    .title("Kiza Maker — Editor")
    .inner_size(400.0, 880.0)
    .min_inner_size(360.0, 520.0)
    .theme(Some(tauri::Theme::Dark))
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

/// Closes the editor's window: the panel is going back into the launcher.
#[tauri::command]
async fn close_maker_panel(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(PANEL_WINDOW) {
        let _ = window.destroy();
    }
}

pub fn run() {
    windows_identity::claim_identity();

    tauri::Builder::default()
        // One Maker at a time: two editors writing the same draft folder would
        // overwrite each other's pictures.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                launcher_log::init(&dir);
            }
            crate::log_info!(
                "Maker",
                "Kiza Maker started: themes only, nothing to launch."
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            // The editor's window closed by its own frame: the panel goes back
            // into the launcher rather than vanishing with the work in it.
            if window.label() == PANEL_WINDOW {
                if let tauri::WindowEvent::Destroyed = event {
                    let _ = window
                        .app_handle()
                        .emit_to("main", "maker://panel-closed", ());
                }
                return;
            }
            // Closing the launcher closes the editor with it.
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Some(panel) = window.app_handle().get_webview_window(PANEL_WINDOW) {
                        let _ = panel.destroy();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::import_theme,
            commands::settings::installed_themes,
            commands::settings::stage_theme_asset,
            commands::settings::remove_theme,
            commands::settings::export_theme,
            commands::settings::launcher_edition,
            open_maker_panel,
            close_maker_panel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kiza Maker");
}
