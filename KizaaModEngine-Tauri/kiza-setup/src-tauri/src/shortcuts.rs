//! Desktop and Start menu shortcuts.
//!
//! Written through the shell's own `IShellLink`, not by shelling out to
//! PowerShell. A machine with a restrictive execution policy is precisely the
//! machine where a shortcut still has to appear, and spawning a scripting host
//! to write a 1 KB file is a dependency the installer does not need.

use std::path::Path;

use windows::core::{Interface, HSTRING};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

/// Holds COM open for as long as shortcuts are being written, and closes it
/// again on the way out even if a write failed.
struct ComScope {
    owned: bool,
}

impl ComScope {
    fn enter() -> Self {
        // Already-initialised is not a failure: Tauri may have got there first,
        // and in that case this scope simply must not be the one to close it.
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        Self {
            owned: result.is_ok(),
        }
    }
}

impl Drop for ComScope {
    fn drop(&mut self) {
        if self.owned {
            unsafe { CoUninitialize() };
        }
    }
}

/// Creates (or replaces) a `.lnk` pointing at `target`.
///
/// The working directory is set to the executable's own folder: without it a
/// launcher started from a desktop shortcut inherits whatever folder Explorer
/// happened to be in, and any relative path it opens lands somewhere else.
pub fn create(link_path: &Path, target: &Path, description: &str) -> Result<(), String> {
    let _com = ComScope::enter();

    if let Some(parent) = link_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }

    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| format!("The shell would not create a shortcut: {error}"))?;

        link.SetPath(&HSTRING::from(target.as_os_str()))
            .map_err(|error| error.to_string())?;
        if let Some(parent) = target.parent() {
            link.SetWorkingDirectory(&HSTRING::from(parent.as_os_str()))
                .map_err(|error| error.to_string())?;
        }
        link.SetDescription(&HSTRING::from(description))
            .map_err(|error| error.to_string())?;
        // The icon comes from the launcher itself, so the shortcut follows
        // every future change of icon without being rewritten.
        link.SetIconLocation(&HSTRING::from(target.as_os_str()), 0)
            .map_err(|error| error.to_string())?;

        let persist: IPersistFile = link
            .cast()
            .map_err(|error| format!("The shortcut could not be prepared for saving: {error}"))?;
        persist
            .Save(&HSTRING::from(link_path.as_os_str()), true)
            .map_err(|error| format!("Could not save {}: {error}", link_path.display()))?;
    }

    Ok(())
}

/// Removes a shortcut. A shortcut the user already deleted is not an error —
/// the point is that it is gone.
pub fn remove(link_path: &Path) {
    let _ = std::fs::remove_file(link_path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shortcut_is_written_where_it_was_asked_for() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("Kiza Launcher.exe");
        std::fs::write(&target, b"MZ").unwrap();
        let link = root.path().join("Kiza Launcher.lnk");

        create(&link, &target, "Kiza Launcher").unwrap();

        assert!(link.exists());
        // A real shell link, not an empty file: the format starts with a
        // 76-byte header whose first field is the header size itself.
        let bytes = std::fs::read(&link).unwrap();
        assert!(bytes.len() > 76);
        assert_eq!(&bytes[0..4], &[0x4c, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn writing_over_an_existing_shortcut_is_allowed() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("Kiza Launcher.exe");
        std::fs::write(&target, b"MZ").unwrap();
        let link = root.path().join("Kiza Launcher.lnk");

        create(&link, &target, "first").unwrap();
        create(&link, &target, "second").unwrap();

        assert!(link.exists());
    }

    #[test]
    fn a_missing_parent_folder_is_created_rather_than_reported() {
        // The Start menu Programs folder can genuinely be absent on a fresh
        // profile.
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("Kiza Launcher.exe");
        std::fs::write(&target, b"MZ").unwrap();
        let link = root
            .path()
            .join("Start Menu")
            .join("Programs")
            .join("K.lnk");

        create(&link, &target, "Kiza Launcher").unwrap();

        assert!(link.exists());
    }

    #[test]
    fn removing_a_shortcut_that_is_already_gone_is_not_an_error() {
        let root = tempfile::tempdir().unwrap();
        remove(&root.path().join("nothing here.lnk"));
    }
}
