//! What the webview costs while nobody is looking at it.
//!
//! WebView2 is Chromium: a browser process, a GPU process, a renderer, a
//! couple of utility processes. One window, one webview — and still five or
//! six entries in the task manager, because that is how Chromium is built,
//! not how many webviews there are. What can be decided is what those
//! processes do when the window is hidden in the tray: nothing, if they are
//! told so.
//!
//! `doze` puts the webview to sleep the way Edge sleeps a background tab —
//! the renderer stops running script and painting, and the browser is asked
//! to hand memory back. `wake` undoes it before the window is shown again.
//! Both are best-effort: a webview that refuses to sleep is a webview that
//! keeps working, which is the state it was in before.

use tauri::WebviewWindow;

#[cfg(windows)]
pub fn doze(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        };
        use webview2_com::TrySuspendCompletedHandler;
        use windows_core::Interface;

        let controller = webview.controller();
        let Ok(core) = controller.CoreWebView2() else {
            return;
        };
        if let Ok(level) = core.cast::<ICoreWebView2_19>() {
            let _ = level.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
        }
        // Suspension is refused while the webview believes it is visible.
        let _ = controller.SetIsVisible(false);
        if let Ok(suspendable) = core.cast::<ICoreWebView2_3>() {
            let handler = TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
            let _ = suspendable.TrySuspend(&handler);
        }
    });
}

#[cfg(windows)]
pub fn wake(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        let controller = webview.controller();
        let Ok(core) = controller.CoreWebView2() else {
            return;
        };
        if let Ok(suspendable) = core.cast::<ICoreWebView2_3>() {
            let _ = suspendable.Resume();
        }
        let _ = controller.SetIsVisible(true);
        if let Ok(level) = core.cast::<ICoreWebView2_19>() {
            let _ = level.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
        }
    });
}

#[cfg(not(windows))]
pub fn doze(_window: &WebviewWindow) {}

#[cfg(not(windows))]
pub fn wake(_window: &WebviewWindow) {}

/// Hides a window and lets its webview sleep.
pub fn hide(window: &WebviewWindow) {
    let _ = window.hide();
    doze(window);
}

/// Wakes a window's webview and brings the window forward.
pub fn show(window: &WebviewWindow) {
    wake(window);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
