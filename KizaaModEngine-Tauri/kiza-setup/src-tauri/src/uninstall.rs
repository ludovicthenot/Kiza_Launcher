//! Undoing the install.
//!
//! The program is removed by default; the player's worlds are not. Those live
//! in `%APPDATA%\com.kizamods.engine` alongside the instances and the saved
//! accounts, and deleting them is the one action here that cannot be undone by
//! reinstalling. It happens only when asked for in as many words.
//!
//! `run` is given everything it may delete rather than looking those places up
//! itself. That is not ceremony: this module removes shortcuts and registry
//! entries, and a version that reached for the real Desktop and the real
//! uninstall key on its own could only be tested by letting it delete them.

use std::path::{Path, PathBuf};

use crate::{folders, layout, registry, shortcuts};

/// Where the launcher keeps instances, worlds, accounts and logs.
///
/// Tauri derives this from the launcher's bundle identifier, so it is spelled
/// out here rather than guessed from the product name.
const DATA_FOLDER: &str = "com.kizamods.engine";

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Request {
    /// Also delete instances, worlds and saved accounts. Off unless the user
    /// turns it on.
    #[serde(default)]
    pub remove_user_data: bool,
}

/// Everything a removal is allowed to touch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Targets {
    pub install_dir: PathBuf,
    /// The `.lnk` files to delete. Absent ones are fine.
    pub shortcuts: Vec<PathBuf>,
    pub user_data_dir: Option<PathBuf>,
    /// Whether to remove the machine's real "Apps & features" entry. Tests
    /// leave it off; a real uninstall is the only thing that sets it.
    pub deregister: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Summary {
    /// Left behind because something still held it. Worth telling the user
    /// about rather than reporting a clean removal that was not one.
    pub files_left_behind: usize,
    pub user_data_removed: bool,
}

/// What a real uninstall of `install_dir` may delete.
pub fn targets_for(install_dir: &Path) -> Targets {
    let mut shortcuts = Vec::new();
    if let Ok(desktop) = folders::desktop() {
        shortcuts.push(layout::desktop_shortcut(&desktop));
    }
    if let Ok(programs) = folders::start_menu_programs() {
        shortcuts.push(layout::start_menu_shortcut(&programs));
    }

    Targets {
        install_dir: install_dir.to_path_buf(),
        shortcuts,
        user_data_dir: user_data_dir(),
        deregister: true,
    }
}

/// The folder to remove, from the registry if Windows knows, otherwise from
/// where this binary is sitting.
pub fn install_dir(current_exe: &Path) -> Option<PathBuf> {
    resolve_install_dir(
        registry::existing_install().map(|found| found.install_dir),
        current_exe,
    )
}

/// The rule behind `install_dir`, separated so it can be checked without a
/// registry.
///
/// The fallback matters: someone who runs the uninstaller straight out of the
/// install folder after the registry entry was lost still deserves a working
/// uninstall. It only applies when the launcher is sitting right there, so an
/// uninstaller copied to the Desktop cannot propose deleting the Desktop.
fn resolve_install_dir(registered: Option<PathBuf>, current_exe: &Path) -> Option<PathBuf> {
    if let Some(registered) = registered {
        return Some(registered);
    }
    let parent = current_exe.parent()?;
    layout::executable_in(parent)
        .exists()
        .then(|| parent.to_path_buf())
}

/// Everything the launcher wrote outside its install folder.
pub fn user_data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|roaming| PathBuf::from(roaming).join(DATA_FOLDER))
}

pub fn run(request: &Request, targets: &Targets) -> Result<Summary, String> {
    // The install folder can be named on the command line, so it is not to be
    // trusted just because it arrived here. `uninstall.exe /S /D=C:\...\Documents`
    // would otherwise empty Documents without a word.
    //
    // The `is_dir` half is not redundant. `is_safe_install_dir` answers "may
    // Kiza write here", and a folder that does not exist is a perfectly good
    // answer of yes — for an install. For a removal it means the path is wrong,
    // and without this a mistyped or mangled path would sail through, take the
    // shortcuts and the registry entry with it, and report a clean uninstall
    // having deleted no files at all.
    if !targets.install_dir.is_dir() || !layout::is_safe_install_dir(&targets.install_dir) {
        return Err(format!(
            "{} does not look like a Kiza Launcher install. Nothing was removed.",
            targets.install_dir.display()
        ));
    }

    // Shortcuts first: they are what the user sees, so a removal that stalls
    // half way should at least have taken the visible traces with it.
    for shortcut in &targets.shortcuts {
        shortcuts::remove(shortcut);
    }

    if targets.deregister {
        registry::unregister()?;
    }

    let files_left_behind = remove_program_files(&targets.install_dir);

    let mut user_data_removed = false;
    if request.remove_user_data {
        if let Some(data) = &targets.user_data_dir {
            if data.is_dir() {
                std::fs::remove_dir_all(data)
                    .map_err(|error| format!("Could not remove {}: {error}", data.display()))?;
            }
            user_data_removed = true;
        }
    }

    Ok(Summary {
        files_left_behind,
        user_data_removed,
    })
}

/// Deletes the install folder, counting whatever refuses to go.
///
/// Files are removed one by one rather than with a single recursive delete, so
/// that one locked file does not abandon the other forty.
fn remove_program_files(install_dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(install_dir) else {
        return 0;
    };

    let mut left_behind = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(&path).is_ok()
        } else {
            std::fs::remove_file(&path).is_ok()
        };
        if !removed {
            left_behind += 1;
        }
    }

    // Only succeeds once it is empty, which is exactly the condition wanted.
    let _ = std::fs::remove_dir(install_dir);
    left_behind
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A complete pretend install, with the Desktop, the Start menu and the
    /// data folder all inside one temporary directory. Nothing a test does can
    /// reach the machine it runs on.
    struct Fake {
        _root: tempfile::TempDir,
        install_dir: PathBuf,
        desktop_shortcut: PathBuf,
        data_dir: PathBuf,
    }

    fn fake_install() -> Fake {
        let root = tempfile::tempdir().unwrap();
        let install_dir = root.path().join("Kiza Launcher");
        std::fs::create_dir_all(&install_dir).unwrap();
        std::fs::write(install_dir.join(layout::executable()), b"MZ").unwrap();
        std::fs::create_dir_all(install_dir.join("resources")).unwrap();
        std::fs::write(install_dir.join("resources").join("icon.ico"), b"icon").unwrap();

        let desktop = root.path().join("Desktop");
        std::fs::create_dir_all(&desktop).unwrap();
        let desktop_shortcut = layout::desktop_shortcut(&desktop);
        std::fs::write(&desktop_shortcut, b"lnk").unwrap();

        let data_dir = root.path().join("Roaming").join(DATA_FOLDER);
        std::fs::create_dir_all(data_dir.join("minecraft").join("instances")).unwrap();
        std::fs::write(data_dir.join("minecraft").join("worlds.dat"), b"a world").unwrap();

        Fake {
            install_dir,
            desktop_shortcut,
            data_dir,
            _root: root,
        }
    }

    impl Fake {
        fn targets(&self) -> Targets {
            Targets {
                install_dir: self.install_dir.clone(),
                shortcuts: vec![self.desktop_shortcut.clone()],
                user_data_dir: Some(self.data_dir.clone()),
                // Never true in a test: this is the machine's real
                // "Apps & features" entry.
                deregister: false,
            }
        }
    }

    #[test]
    fn the_program_and_its_shortcut_go_but_the_worlds_stay() {
        let fake = fake_install();

        let summary = run(
            &Request {
                remove_user_data: false,
            },
            &fake.targets(),
        )
        .unwrap();

        assert_eq!(summary.files_left_behind, 0);
        assert!(!summary.user_data_removed);
        assert!(!fake.install_dir.exists());
        assert!(!fake.desktop_shortcut.exists());
        // The whole point: reinstalling brings everything back.
        assert!(fake.data_dir.join("minecraft").join("worlds.dat").exists());
    }

    #[test]
    fn the_worlds_go_only_when_that_is_what_was_asked_for() {
        let fake = fake_install();

        let summary = run(
            &Request {
                remove_user_data: true,
            },
            &fake.targets(),
        )
        .unwrap();

        assert!(summary.user_data_removed);
        assert!(!fake.data_dir.exists());
    }

    #[test]
    fn a_shortcut_the_user_already_deleted_is_not_an_error() {
        let fake = fake_install();
        std::fs::remove_file(&fake.desktop_shortcut).unwrap();

        run(
            &Request {
                remove_user_data: false,
            },
            &fake.targets(),
        )
        .unwrap();
    }

    #[test]
    fn removing_a_folder_that_is_already_gone_is_not_an_error() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(remove_program_files(&root.path().join("never existed")), 0);
    }

    #[test]
    fn the_uninstaller_finds_its_own_folder_without_the_registry() {
        let fake = fake_install();

        let found = resolve_install_dir(None, &fake.install_dir.join(layout::uninstaller()));

        assert_eq!(found.as_deref(), Some(fake.install_dir.as_path()));
    }

    #[test]
    fn a_stray_uninstaller_does_not_claim_the_folder_it_was_copied_to() {
        // An uninstaller dragged onto the Desktop must not offer to delete the
        // Desktop. Nothing but a launcher sitting beside it counts.
        let root = tempfile::tempdir().unwrap();
        let downloads = root.path().join("Downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        std::fs::write(downloads.join("holiday.jpg"), b"pixels").unwrap();

        assert_eq!(
            resolve_install_dir(None, &downloads.join(layout::uninstaller())),
            None
        );
    }

    #[test]
    fn the_registry_wins_over_the_folder_the_uninstaller_sits_in() {
        // A copy left in the old folder after the user moved the install must
        // not delete the old folder.
        let fake = fake_install();
        let registered = PathBuf::from(r"D:\Games\Kiza");

        let found = resolve_install_dir(
            Some(registered.clone()),
            &fake.install_dir.join(layout::uninstaller()),
        );

        assert_eq!(found, Some(registered));
    }

    #[test]
    fn the_data_folder_is_the_one_the_launcher_actually_writes_to() {
        let data = user_data_dir().unwrap();
        assert!(data.ends_with("com.kizamods.engine"));
        assert!(data.to_string_lossy().contains("Roaming"));
    }
}

#[cfg(test)]
mod safety_tests {
    use super::*;

    #[test]
    fn a_folder_that_is_not_a_kiza_install_is_refused() {
        // The command line can name the folder: `uninstall.exe /S /D=<anything>`.
        // Without this check that is a one-line way to empty someone's Documents.
        let root = tempfile::tempdir().unwrap();
        let documents = root.path().join("Documents");
        std::fs::create_dir_all(&documents).unwrap();
        std::fs::write(documents.join("thesis.docx"), b"years of work").unwrap();

        let error = run(
            &Request {
                remove_user_data: false,
            },
            &Targets {
                install_dir: documents.clone(),
                shortcuts: Vec::new(),
                user_data_dir: None,
                deregister: false,
            },
        )
        .unwrap_err();

        assert!(error.contains("does not look like"), "{error}");
        assert!(documents.join("thesis.docx").exists());
    }

    #[test]
    fn the_refusal_happens_before_anything_is_touched() {
        let root = tempfile::tempdir().unwrap();
        let elsewhere = root.path().join("Pictures");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("holiday.jpg"), b"pixels").unwrap();

        let shortcut = root.path().join("Kiza Launcher.lnk");
        std::fs::write(&shortcut, b"lnk").unwrap();

        let _ = run(
            &Request {
                remove_user_data: true,
            },
            &Targets {
                install_dir: elsewhere,
                shortcuts: vec![shortcut.clone()],
                user_data_dir: Some(root.path().join("data")),
                deregister: false,
            },
        );

        // Not even the shortcut, which is removed first in the happy path.
        assert!(shortcut.exists());
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    /// The failure this guards against was observed, not imagined: a mangled
    /// `/D=` produced a path that existed nowhere, and the removal went on to
    /// delete the shortcuts and the registry entry before finding nothing to
    /// remove — and reported success.
    #[test]
    fn a_folder_that_does_not_exist_stops_the_removal_before_anything_goes() {
        let root = tempfile::tempdir().unwrap();
        let shortcut = root.path().join("Kiza Launcher.lnk");
        std::fs::write(&shortcut, b"lnk").unwrap();

        let error = run(
            &Request {
                remove_user_data: false,
            },
            &Targets {
                install_dir: root.path().join("=C-nonsense-Kiza Launcher"),
                shortcuts: vec![shortcut.clone()],
                user_data_dir: None,
                deregister: false,
            },
        )
        .unwrap_err();

        assert!(error.contains("does not look like"), "{error}");
        assert!(shortcut.exists(), "the shortcut went before the check did");
    }

    #[test]
    fn a_real_install_still_passes_the_check() {
        let root = tempfile::tempdir().unwrap();
        let install = root.path().join("Kiza Launcher");
        std::fs::create_dir_all(&install).unwrap();
        std::fs::write(install.join(layout::executable()), b"MZ").unwrap();
        std::fs::write(install.join(layout::uninstaller()), b"MZ").unwrap();

        let summary = run(
            &Request {
                remove_user_data: false,
            },
            &Targets {
                install_dir: install.clone(),
                shortcuts: Vec::new(),
                user_data_dir: None,
                deregister: false,
            },
        )
        .unwrap();

        assert_eq!(summary.files_left_behind, 0);
        assert!(!install.exists());
    }
}
