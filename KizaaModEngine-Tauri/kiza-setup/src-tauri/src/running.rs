//! Getting a running launcher out of the way before replacing it.
//!
//! Windows will not let a running executable be overwritten. The installer used
//! to work around that by renaming the old binary aside and writing the new one
//! beside it — which succeeds, reports success, and leaves the user running the
//! old build until they happen to restart it. An update that only takes effect
//! at some unrelated later moment is not an update anyone can reason about.
//!
//! So the launcher is asked to close first. Asked, not killed: it may be
//! holding a download, a running game, or an installation of its own, and the
//! difference between "close, please" and `TerminateProcess` is the difference
//! between a clean shutdown and a corrupt instance.
//!
//! The request travels on the channel the launcher already listens to for
//! `kiza://` links: starting the launcher again with an argument hands that
//! argument to the instance already running, which then quits. Nothing new has
//! to be invented, and nothing has to be left listening.

use std::path::Path;
use std::time::{Duration, Instant};

/// The argument the launcher answers by quitting.
///
/// Duplicated from the launcher rather than shared: they are separate crates,
/// and an installer that depends on the thing it installs is a worse trade than
/// one string written twice. The test below is the contract.
pub const QUIT_FOR_UPDATE_ARG: &str = "--quit-for-update";

/// How long to wait for a launcher that was not asked to close.
///
/// It may simply be in the middle of shutting down: the in-app updater starts
/// this installer and exits, and those two race by a few hundred milliseconds.
pub const SETTLING: Duration = Duration::from_secs(3);

/// How long to wait after asking.
///
/// Long enough for a launcher to finish what it was doing and go, short enough
/// that a launcher which is never going to answer does not hold the install
/// there indefinitely.
pub const AFTER_ASKING: Duration = Duration::from_secs(20);

/// Whether the file can be opened for writing — which on Windows is the same
/// question as whether anything is still running it.
pub fn is_free(path: &Path) -> bool {
    if !path.exists() {
        return true;
    }
    std::fs::OpenOptions::new().write(true).open(path).is_ok()
}

/// Waits for the file to be released, up to `timeout`.
pub fn wait_until_free(path: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if is_free(path) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// Asks whatever is running this executable to close.
///
/// Starting the launcher a second time is how the message is delivered: its
/// single-instance guard hands the arguments to the copy already running and
/// ends the new process straight away. If nothing is running, the launcher sees
/// the argument, finds nothing to do and exits without drawing anything.
pub fn ask_to_quit(executable: &Path) -> Result<(), String> {
    std::process::Command::new(executable)
        .arg(QUIT_FOR_UPDATE_ARG)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not ask Kiza to close: {error}"))
}

/// Asks, then waits. Reports whether the file is now ours to replace.
///
/// Split from the install so that the deciding part can be tested against a
/// file a test holds open, rather than against a launcher.
pub fn make_way(executable: &Path) -> bool {
    // A launcher that is already on its way out needs no message, only a
    // moment. Asking one that is mid-shutdown would start a second process for
    // nothing.
    if wait_until_free(executable, SETTLING) {
        return true;
    }

    if let Err(error) = ask_to_quit(executable) {
        eprintln!("[WARN] [Install] {error}");
    }

    wait_until_free(executable, AFTER_ASKING)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_nobody_holds_is_free_at_once() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Kiza Launcher.exe");
        std::fs::write(&path, b"MZ").unwrap();

        let started = Instant::now();
        assert!(wait_until_free(&path, Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_file_that_is_not_there_is_free() {
        let root = tempfile::tempdir().unwrap();
        assert!(is_free(&root.path().join("nothing.exe")));
    }

    /// The wait has to end. An installer that hangs on a launcher somebody left
    /// open over lunch is worse than one that says what is wrong.
    #[test]
    #[cfg(windows)]
    fn waiting_gives_up_rather_than_hanging() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Kiza Launcher.exe");
        std::fs::write(&path, b"MZ").unwrap();

        // Opened with no sharing, which is how Windows holds a running image.
        let _held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();

        let started = Instant::now();
        assert!(!wait_until_free(&path, Duration::from_millis(400)));
        assert!(started.elapsed() >= Duration::from_millis(400));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    /// The launcher answers to this exact string. If either side renames it,
    /// updates go back to silently leaving the old build in place.
    #[test]
    fn the_argument_is_the_one_the_launcher_answers_to() {
        assert_eq!(QUIT_FOR_UPDATE_ARG, "--quit-for-update");
    }
}
