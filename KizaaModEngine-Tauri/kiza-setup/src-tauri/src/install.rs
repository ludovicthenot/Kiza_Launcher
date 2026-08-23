//! The install itself: unpack, make shortcuts, tell Windows about it.
//!
//! The order matters. Files first, then the things that point at files — a
//! shortcut written before the executable exists is a shortcut that is broken
//! for as long as the copy takes, and a registry entry written before the
//! uninstaller is in place describes a program that cannot be removed.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::{layout, payload, registry, shortcuts};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Request {
    pub install_dir: PathBuf,
    pub desktop_shortcut: bool,
    pub start_menu_shortcut: bool,
}

/// Where the interface is in the sequence. Named after what the user is
/// waiting for, not after the function that is running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    /// Making room, and waiting for a launcher that is still closing.
    Preparing,
    Copying,
    Shortcuts,
    Registering,
    Done,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Progress {
    pub step: Step,
    /// 0.0 to 1.0 across the whole install, not just the current step.
    pub fraction: f64,
    /// The file being written, when there is one worth naming.
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Report {
    pub install_dir: PathBuf,
    pub executable: PathBuf,
}

/// Copying dominates the wait, so it owns most of the bar. The remaining
/// fifth covers the steps a user would otherwise see finish instantly and
/// wonder about.
const COPY_SHARE: f64 = 0.8;

pub fn run(
    request: &Request,
    version: &str,
    mut on_progress: impl FnMut(Progress),
) -> Result<Report, String> {
    let install_dir = &request.install_dir;

    if !layout::is_safe_install_dir(install_dir) {
        return Err(format!(
            "{} already holds other files. Kiza will not install into a folder it would later delete.",
            install_dir.display()
        ));
    }

    on_progress(Progress {
        step: Step::Preparing,
        fraction: 0.0,
        detail: String::new(),
    });

    std::fs::create_dir_all(install_dir)
        .map_err(|error| format!("Could not create {}: {error}", install_dir.display()))?;

    // An update starts while the launcher is still shutting down. Giving it a
    // moment avoids leaving a parked copy behind on every single update.
    let executable = layout::executable_in(install_dir);
    wait_until_writable(&executable, Duration::from_secs(10));
    payload::sweep_superseded(install_dir);

    payload::install_into(install_dir, |fraction, name| {
        on_progress(Progress {
            step: Step::Copying,
            fraction: fraction * COPY_SHARE,
            detail: name.to_string(),
        });
    })?;

    // Only once the new launcher is safely on disk: a failed extraction must
    // not leave the user with neither the old binary nor the new one.
    layout::clear_legacy_files(install_dir);

    // The uninstaller is this very binary, kept so the install can always be
    // undone by exactly the code that made it.
    let uninstaller = layout::uninstaller_in(install_dir);
    copy_self_as_uninstaller(&uninstaller)?;

    on_progress(Progress {
        step: Step::Shortcuts,
        fraction: 0.88,
        detail: String::new(),
    });
    write_shortcuts(request, &executable)?;

    on_progress(Progress {
        step: Step::Registering,
        fraction: 0.95,
        detail: String::new(),
    });
    registry::register(
        install_dir,
        &uninstaller,
        version,
        payload::installed_size(),
    )?;

    on_progress(Progress {
        step: Step::Done,
        fraction: 1.0,
        detail: String::new(),
    });

    Ok(Report {
        install_dir: install_dir.clone(),
        executable,
    })
}

fn write_shortcuts(request: &Request, executable: &Path) -> Result<(), String> {
    let desktop = crate::folders::desktop()
        .ok()
        .map(|folder| layout::desktop_shortcut(&folder));
    let start_menu = crate::folders::start_menu_programs()
        .ok()
        .map(|folder| layout::start_menu_shortcut(&folder));

    let wanted = [
        (desktop, request.desktop_shortcut),
        (start_menu, request.start_menu_shortcut),
    ];

    for (path, requested) in wanted {
        let Some(path) = path else { continue };
        write_shortcut(&path, executable, requested)?;
    }
    Ok(())
}

/// Creates the shortcut when it was asked for, and otherwise repoints one that
/// already exists.
///
/// The refresh is what saves an upgrade from the old NSIS install. That one put
/// a Start menu entry pointing at `KizaaMod.exe`, which this install has just
/// deleted — leaving the shortcut alone would leave the user with a Start menu
/// entry that does nothing. A shortcut that is not there and was not asked for
/// stays not there: recreating one the user deliberately deleted, at every
/// release, is its own small betrayal.
fn write_shortcut(path: &Path, executable: &Path, requested: bool) -> Result<(), String> {
    if !requested && !path.exists() {
        return Ok(());
    }
    shortcuts::create(path, executable, layout::PRODUCT_NAME)
}

fn copy_self_as_uninstaller(destination: &Path) -> Result<(), String> {
    let current = std::env::current_exe()
        .map_err(|error| format!("Could not find the installer's own path: {error}"))?;

    // Reinstalling over an existing install means copying onto the uninstaller
    // that may itself be what is running, hence the same park-aside dance the
    // launcher gets.
    if current == destination {
        return Ok(());
    }
    let bytes = std::fs::read(&current)
        .map_err(|error| format!("Could not read the installer: {error}"))?;
    payload::replace_file(destination, &bytes)
}

/// Waits for a file to stop being held open by another process.
///
/// Windows refuses write access to a running executable, so this doubles as
/// "has the old launcher finished exiting". Returns whether it came free; the
/// caller carries on either way, because `payload::replace_file` can still park
/// a locked file aside.
fn wait_until_writable(path: &Path, timeout: Duration) -> bool {
    if !path.exists() {
        return true;
    }
    let deadline = Instant::now() + timeout;
    loop {
        if std::fs::OpenOptions::new().write(true).open(path).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_nobody_holds_is_writable_at_once() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Kiza Launcher.exe");
        std::fs::write(&path, b"MZ").unwrap();

        let started = Instant::now();
        assert!(wait_until_writable(&path, Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_file_that_is_not_there_needs_no_waiting() {
        let root = tempfile::tempdir().unwrap();
        let started = Instant::now();

        assert!(wait_until_writable(
            &root.path().join("absent.exe"),
            Duration::from_secs(30)
        ));

        // The point: a fresh install must not sit through the timeout.
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn the_wait_gives_up_rather_than_hanging_for_ever() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("locked.exe");
        std::fs::write(&path, b"MZ").unwrap();
        // A directory can never be opened for writing, which stands in for a
        // file another process refuses to release.
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        let started = Instant::now();
        assert!(!wait_until_writable(&path, Duration::from_millis(400)));
        assert!(started.elapsed() >= Duration::from_millis(400));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn installing_into_a_folder_holding_someone_elses_files_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("Documents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("thesis.docx"), b"years of work").unwrap();

        let error = run(
            &Request {
                install_dir: dir.clone(),
                desktop_shortcut: false,
                start_menu_shortcut: false,
            },
            "0.0.304",
            |_| {},
        )
        .unwrap_err();

        assert!(error.contains("other files"), "{error}");
        // Nothing was touched on the way to refusing.
        assert!(dir.join("thesis.docx").exists());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }
}

#[cfg(test)]
mod shortcut_tests {
    use super::*;

    fn launcher(root: &Path) -> PathBuf {
        let exe = root.join(layout::EXECUTABLE);
        std::fs::write(&exe, b"MZ").unwrap();
        exe
    }

    #[test]
    fn a_shortcut_that_was_asked_for_is_created() {
        let root = tempfile::tempdir().unwrap();
        let exe = launcher(root.path());
        let link = root.path().join("Desktop").join("Kiza Launcher.lnk");

        write_shortcut(&link, &exe, true).unwrap();

        assert!(link.exists());
    }

    #[test]
    fn a_shortcut_the_user_deleted_is_not_brought_back() {
        // Otherwise every update would put back an icon the user removed on
        // purpose, once per release.
        let root = tempfile::tempdir().unwrap();
        let exe = launcher(root.path());
        let link = root.path().join("Desktop").join("Kiza Launcher.lnk");

        write_shortcut(&link, &exe, false).unwrap();

        assert!(!link.exists());
    }

    #[test]
    fn an_existing_shortcut_is_repointed_even_when_it_was_not_asked_for() {
        // The migration case: the old NSIS install left a Start menu entry
        // aimed at KizaaMod.exe, and this install has just deleted that file.
        let root = tempfile::tempdir().unwrap();
        let exe = launcher(root.path());
        let link = root.path().join("Kiza Launcher.lnk");
        std::fs::write(&link, b"a stale shortcut").unwrap();

        write_shortcut(&link, &exe, false).unwrap();

        let bytes = std::fs::read(&link).unwrap();
        // A real shell link now, not the placeholder that was there.
        assert_eq!(&bytes[0..4], &[0x4c, 0x00, 0x00, 0x00]);
        assert!(bytes.len() > 76);
    }
}
