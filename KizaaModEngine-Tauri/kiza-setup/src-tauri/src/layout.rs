//! Where everything goes, and what it is called.
//!
//! Every function here takes the folder it works from rather than reading the
//! environment, so the whole layout can be exercised against a temporary
//! directory instead of against the machine running the tests.

use std::path::{Path, PathBuf};

/// Shown in Windows' own lists: the Start menu, "Apps & features", the shortcut
/// under the mouse. It has to match the launcher's `productName`, because the
/// two are the same product to everyone but us.
pub const PRODUCT_NAME: &str = "Kiza Launcher";

/// The launcher, as Tauri names it when it bundles.
pub const EXECUTABLE: &str = "Kiza Launcher.exe";

/// A copy of this very binary, left behind so the install can be undone.
pub const UNINSTALLER: &str = "Uninstall Kiza Launcher.exe";

/// Under `HKEY_CURRENT_USER`. Windows reads this to populate "Apps & features";
/// an install that skips it is an install the user cannot remove.
pub const UNINSTALL_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Kiza Launcher";

/// The identifier Windows addresses Kiza's notifications to.
///
/// It must equal the launcher's bundle identifier, because that is what the
/// launcher sends under. A Windows toast raised under an identifier Windows
/// cannot resolve is dropped without an error — so an installer that writes a
/// shortcut without this property produces a launcher whose notifications
/// silently never appear, which is exactly what happened when KizaSetup
/// replaced the NSIS bundle.
pub const APP_USER_MODEL_ID: &str = "com.kizamods.engine";

/// Where Windows looks up the display name and icon for that identifier.
pub const APP_ID_KEY: &str = r"Software\Classes\AppUserModelId\com.kizamods.engine";

/// A launcher exe that could not be deleted is renamed to this and swept away
/// on the next run. See `payload::replace_file`.
pub const SUPERSEDED_SUFFIX: &str = ".superseded";

/// `%LOCALAPPDATA%\Kiza Launcher`.
///
/// Local AppData rather than Program Files on purpose: the launcher installs
/// per user, so it never needs an administrator, and an update never has to
/// raise a prompt the user cannot answer at work.
pub fn default_install_dir(local_app_data: &Path) -> PathBuf {
    local_app_data.join(PRODUCT_NAME)
}

pub fn executable_in(install_dir: &Path) -> PathBuf {
    install_dir.join(EXECUTABLE)
}

pub fn uninstaller_in(install_dir: &Path) -> PathBuf {
    install_dir.join(UNINSTALLER)
}

/// `Desktop\Kiza Launcher.lnk`.
pub fn desktop_shortcut(desktop: &Path) -> PathBuf {
    desktop.join(format!("{PRODUCT_NAME}.lnk"))
}

/// The Start menu entry sits directly in Programs rather than in a folder of
/// its own: a folder holding a single shortcut is a folder the user has to open
/// before they can start the thing they searched for.
pub fn start_menu_shortcut(programs: &Path) -> PathBuf {
    programs.join(format!("{PRODUCT_NAME}.lnk"))
}

/// What the NSIS installer used to leave in the same folder.
///
/// Tauri's bundler names the binary after the Cargo package rather than after
/// the product, so every install made before Kiza Setup existed holds a
/// `KizaaMod.exe` and an `uninstall.exe`. Installing on top of one has to
/// recognise them — otherwise the folder reads as "someone else's files" and
/// every existing user is refused an upgrade.
pub const LEGACY_FILES: [&str; 2] = ["KizaaMod.exe", "uninstall.exe"];

/// True for a file Kiza put there itself, at any point in its history.
fn is_ours(name: &str) -> bool {
    name == EXECUTABLE
        || name == UNINSTALLER
        || name == "resources"
        || name.ends_with(SUPERSEDED_SUFFIX)
        || name.contains(SUPERSEDED_SUFFIX)
        || LEGACY_FILES.contains(&name)
}

/// Whether a directory looks like somewhere Kiza may write freely.
///
/// The uninstaller deletes this folder whole, so it must never be pointed at a
/// place that holds anything else. A path that is a drive root, or that already
/// contains files Kiza did not put there, is refused.
pub fn is_safe_install_dir(dir: &Path) -> bool {
    // A drive root, or something with no name at all, would take the whole
    // drive with it.
    if dir.parent().is_none() || dir.file_name().is_none() {
        return false;
    }

    match std::fs::read_dir(dir) {
        // Never used: an empty folder, or a folder we are about to create.
        Err(_) => true,
        Ok(entries) => entries
            .flatten()
            .all(|entry| is_ours(&entry.file_name().to_string_lossy())),
    }
}

/// Removes what an older NSIS install left in the folder.
///
/// Without this the folder would end up holding two launchers — the old
/// `KizaaMod.exe` and the new `Kiza Launcher.exe` — and a stale uninstaller
/// wired to an NSIS install that no longer exists. Anything still locked is
/// left alone; it is dead weight, not a reason to fail an install.
pub fn clear_legacy_files(dir: &Path) {
    for name in LEGACY_FILES {
        let path = dir.join(name);
        if path.is_file() {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn the_launcher_lands_beside_the_users_own_data() {
        let dir = default_install_dir(Path::new(r"C:\Users\nefer\AppData\Local"));
        assert_eq!(
            dir,
            PathBuf::from(r"C:\Users\nefer\AppData\Local\Kiza Launcher")
        );
        assert_eq!(
            executable_in(&dir),
            PathBuf::from(r"C:\Users\nefer\AppData\Local\Kiza Launcher\Kiza Launcher.exe")
        );
    }

    #[test]
    fn shortcuts_are_named_after_the_product_not_the_binary() {
        // "KizaSetup.lnk" on a desktop would be a mystery a week later.
        assert!(desktop_shortcut(Path::new("D"))
            .to_string_lossy()
            .ends_with("Kiza Launcher.lnk"));
        assert!(start_menu_shortcut(Path::new("P"))
            .to_string_lossy()
            .ends_with("Kiza Launcher.lnk"));
    }

    #[test]
    fn a_folder_that_does_not_exist_yet_is_fine() {
        let root = tempfile::tempdir().unwrap();
        assert!(is_safe_install_dir(&root.path().join("Kiza Launcher")));
    }

    #[test]
    fn a_previous_kiza_install_may_be_written_over() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("Kiza Launcher");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(EXECUTABLE), b"old").unwrap();
        fs::write(dir.join(UNINSTALLER), b"old").unwrap();
        fs::write(dir.join(format!("{EXECUTABLE}{SUPERSEDED_SUFFIX}")), b"x").unwrap();

        assert!(is_safe_install_dir(&dir));
    }

    #[test]
    fn a_folder_holding_someone_elses_files_is_refused() {
        // The uninstaller removes the install folder whole. Installing into
        // Documents would mean uninstalling took Documents with it.
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("Documents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("thesis.docx"), b"years of work").unwrap();

        assert!(!is_safe_install_dir(&dir));
    }

    #[test]
    fn a_drive_root_is_refused() {
        assert!(!is_safe_install_dir(Path::new(r"C:\")));
    }

    #[test]
    fn a_folder_left_by_the_old_nsis_installer_may_be_upgraded() {
        // Every user who installed Kiza before this existed has exactly this
        // folder. Refusing it would refuse all of them.
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("Kiza Launcher");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("KizaaMod.exe"), b"the old binary name").unwrap();
        fs::write(dir.join("uninstall.exe"), b"the nsis uninstaller").unwrap();

        assert!(is_safe_install_dir(&dir));
    }

    #[test]
    fn the_old_binary_and_uninstaller_are_cleared_out() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("Kiza Launcher");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("KizaaMod.exe"), b"old").unwrap();
        fs::write(dir.join("uninstall.exe"), b"old").unwrap();
        fs::write(dir.join(EXECUTABLE), b"new").unwrap();

        clear_legacy_files(&dir);

        // Otherwise the folder holds two launchers and an uninstaller wired to
        // an install that no longer exists.
        assert!(!dir.join("KizaaMod.exe").exists());
        assert!(!dir.join("uninstall.exe").exists());
        assert!(dir.join(EXECUTABLE).exists());
    }

    #[test]
    fn clearing_legacy_files_that_are_not_there_is_not_an_error() {
        let root = tempfile::tempdir().unwrap();
        clear_legacy_files(root.path());
        clear_legacy_files(&root.path().join("missing"));
    }
}
