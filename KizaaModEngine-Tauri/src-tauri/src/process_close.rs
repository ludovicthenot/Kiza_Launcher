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

/// Asks every top-level window of `pid` to close, then waits for the
/// process to go. Returns whether it went on its own.
#[cfg(windows)]
pub fn close_gracefully(pid: u32, patience: Duration) -> bool {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::core::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE,
    };

    unsafe extern "system" fn each_window(window: HWND, wanted: LPARAM) -> BOOL {
        let mut owner = 0u32;
        // SAFETY: a valid window handle handed to us by EnumWindows.
        unsafe { GetWindowThreadProcessId(window, Some(&mut owner)) };
        if owner == wanted.0 as u32 {
            // SAFETY: posting a message to a window we did not create is
            // permitted; the window decides what to do with it.
            let _ = unsafe { PostMessageW(Some(window), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
        BOOL(1)
    }

    // SAFETY: the callback only reads the handle and posts a message.
    let _ = unsafe { EnumWindows(Some(each_window), LPARAM(pid as isize)) };
    wait_for_exit(pid, patience)
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
