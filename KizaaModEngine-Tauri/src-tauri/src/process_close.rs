//! Asking a game to close, before making it.
//!
//! Killing the process is instant and it is what Stop game did. It is also
//! what a crash looks like from inside the game: the world is not saved,
//! the loader's shutdown hooks never run, and a mod that watches for
//! unclean exits -- Fabulously Optimized ships one -- puts up a crash
//! window the next time the player looks. Closing the window is what the
//! person would do: Minecraft saves and exits with 0. So the window is
//! asked first, given a few seconds, and only then is the process killed.

use std::time::{Duration, Instant};

/// Asks the game's own window to close, then waits for the process to go.
/// Returns whether it went on its own.
///
/// Only the windows a person could click the cross of: visible, and owned
/// by nobody. A Java game has others -- GLFW's hidden helper window, the
/// input-method window, AWT's toolkit window -- and a WM_CLOSE to those
/// destroys them under the game's feet, which is how a polite close turned
/// into a shutdown that hung until it was killed.
#[cfg(windows)]
pub fn close_gracefully(pid: u32, patience: Duration) -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, GW_OWNER,
        WM_CLOSE,
    };

    struct Search {
        pid: u32,
        windows: u32,
        asked: u32,
    }

    unsafe extern "system" fn each_window(window: HWND, search: LPARAM) -> BOOL {
        // SAFETY: the pointer is to the Search below, alive for the call.
        let search = unsafe { &mut *(search.0 as *mut Search) };
        let mut owner = 0u32;
        // SAFETY: a valid window handle handed to us by EnumWindows.
        unsafe { GetWindowThreadProcessId(window, Some(&mut owner)) };
        if owner != search.pid {
            return BOOL(1);
        }
        search.windows += 1;
        // SAFETY: plain queries on the same handle.
        let visible = unsafe { IsWindowVisible(window) }.as_bool();
        let owned = unsafe { GetWindow(window, GW_OWNER) }.is_ok_and(|parent| !parent.is_invalid());
        if visible && !owned {
            // SAFETY: posting a message to a window we did not create is
            // permitted; the window decides what to do with it.
            if unsafe { PostMessageW(Some(window), WM_CLOSE, WPARAM(0), LPARAM(0)) }.is_ok() {
                search.asked += 1;
            }
        }
        BOOL(1)
    }

    // Asked again every half second until it goes. A game stopped while it
    // loads has no window yet -- GLFW creates it a few seconds in -- and a
    // single request then reaches nobody; the reference matrix found exactly
    // that, closing at the menu signal two seconds before the window existed.
    let started = Instant::now();
    let mut asked_any = false;
    let mut windows_seen = 0;
    loop {
        let mut search = Search {
            pid,
            windows: 0,
            asked: 0,
        };
        // SAFETY: the callback only reads the handle, posts a message, and
        // writes to `search`, which outlives the call.
        let _ = unsafe {
            EnumWindows(
                Some(each_window),
                LPARAM(&mut search as *mut Search as isize),
            )
        };
        asked_any |= search.asked > 0;
        windows_seen = windows_seen.max(search.windows);
        if wait_for_exit(pid, Duration::from_millis(500)) {
            crate::log_info!(
                "Launch",
                "Process {pid} closed on request after {:.1}s",
                started.elapsed().as_secs_f32()
            );
            return true;
        }
        if started.elapsed() > patience {
            crate::log_warn!(
                "Launch",
                "Process {pid} did not close within {}s ({}; {windows_seen} windows seen)",
                patience.as_secs(),
                if asked_any {
                    "its window was asked"
                } else {
                    "it never had a window to ask"
                }
            );
            return false;
        }
    }
}

#[cfg(not(windows))]
pub fn close_gracefully(_pid: u32, _patience: Duration) -> bool {
    false
}

/// Whether the process is gone within `patience`.
pub fn wait_for_exit(pid: u32, patience: Duration) -> bool {
    let started = Instant::now();
    let mut system = sysinfo::System::new();
    loop {
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        if system.process(sysinfo::Pid::from_u32(pid)).is_none() {
            return true;
        }
        if started.elapsed() > patience {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Closes, then kills what would not close. Says whether it closed.
pub fn close_or_kill(pid: u32, patience: Duration) -> bool {
    if close_gracefully(pid, patience) {
        return true;
    }
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    if let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) {
        process.kill();
    }
    false
}
