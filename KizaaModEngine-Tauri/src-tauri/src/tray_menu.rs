//! The menu behind the tray icon: a small window of Kiza's own, not the
//! system's two-line list.
//!
//! A native tray menu is a Win32 menu — black, unstyled, and limited to
//! text rows. This is a frameless, transparent, always-on-top window that
//! the launcher's own page draws, so it looks like the launcher and can
//! show what a menu cannot: the last instance with a Play button, the
//! servers that are up, the update that is waiting.
//!
//! Made once, on the first right-click, then hidden and put to sleep
//! between uses: a menu that took a quarter of a second to open would feel
//! broken, and a sleeping webview costs close to nothing. It closes itself
//! the moment it loses focus, which is what a menu does.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "tray";

/// When the menu was last opened. A window being created reports "not
/// focused" once before it is even shown, and that report reaches the
/// event handler after the show — so a blur in the first moments of a menu
/// is its birth, not the user looking away.
static OPENED_AT: Mutex<Option<Instant>> = Mutex::new(None);
const SETTLING: Duration = Duration::from_millis(400);

const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 420.0;
/// Between the cursor and the menu's edge.
const GAP: f64 = 12.0;

/// Opens the menu with its bottom-right corner near `at` (physical pixels),
/// kept inside the monitor the cursor is on.
pub fn open(app: &AppHandle, at: PhysicalPosition<f64>) -> tauri::Result<()> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#/tray".into()))
            .title("Kiza Launcher")
            .inner_size(WIDTH, HEIGHT)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .visible(false)
            .build()?,
    };

    let scale = app
        .monitor_from_point(at.x, at.y)
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let width = WIDTH * scale;
    let height = HEIGHT * scale;

    // Up and to the left of the cursor, the way a taskbar menu opens, then
    // clamped to the monitor so a cursor at the very edge still gets a whole
    // menu.
    let mut x = at.x - width + 24.0 * scale;
    let mut y = at.y - height - GAP * scale;
    if let Ok(Some(monitor)) = app.monitor_from_point(at.x, at.y) {
        let origin = monitor.position();
        let size = monitor.size();
        let left = origin.x as f64;
        let top = origin.y as f64;
        let right = left + size.width as f64;
        let bottom = top + size.height as f64;
        x = x.max(left).min(right - width);
        y = y.max(top).min(bottom - height);
    }

    let _ = window.set_position(PhysicalPosition::new(x, y));
    crate::webview_power::wake(&window);
    *OPENED_AT.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// The menu lost focus: closed, unless it only just opened.
pub fn blurred(app: &AppHandle) {
    let just_opened = OPENED_AT
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_some_and(|at| at.elapsed() < SETTLING);
    if !just_opened {
        close(app);
    }
}

/// Closes the menu: hidden and asleep, ready for the next click.
pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        crate::webview_power::hide(&window);
    }
}
