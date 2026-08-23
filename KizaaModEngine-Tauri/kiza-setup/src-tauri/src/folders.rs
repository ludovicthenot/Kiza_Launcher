//! The user's own folders, asked of Windows rather than assembled by hand.
//!
//! `%USERPROFILE%\Desktop` is wrong on a large share of real machines: OneDrive
//! moves the Desktop and the Start menu can be redirected by policy. Building
//! those paths from strings puts a shortcut somewhere the user will never see
//! it, which looks exactly like an installer that quietly did nothing.

use std::path::PathBuf;

use windows::core::PWSTR;
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_LocalAppData, FOLDERID_Programs, SHGetKnownFolderPath,
    KF_FLAG_CREATE,
};

fn known_folder(id: &windows::core::GUID) -> Result<PathBuf, String> {
    unsafe {
        // KF_FLAG_CREATE so a folder that has never been used yet — Programs on
        // a fresh profile — exists by the time we write into it.
        let raw: PWSTR = SHGetKnownFolderPath(id, KF_FLAG_CREATE, None).map_err(|error| {
            format!("Windows could not resolve one of its own folders: {error}")
        })?;
        if raw.is_null() {
            return Err("Windows returned no path for one of its own folders.".to_string());
        }
        let path = raw.to_string().map_err(|error| error.to_string())?;
        windows::Win32::System::Com::CoTaskMemFree(Some(raw.0 as *const _));
        Ok(PathBuf::from(path))
    }
}

/// `%LOCALAPPDATA%` — where Kiza installs.
pub fn local_app_data() -> Result<PathBuf, String> {
    known_folder(&FOLDERID_LocalAppData)
}

/// The real Desktop, wherever OneDrive has put it.
pub fn desktop() -> Result<PathBuf, String> {
    known_folder(&FOLDERID_Desktop)
}

/// The per-user Start menu Programs folder.
pub fn start_menu_programs() -> Result<PathBuf, String> {
    known_folder(&FOLDERID_Programs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_gives_a_real_local_app_data() {
        let path = local_app_data().unwrap();
        assert!(path.is_absolute(), "{}", path.display());
        assert!(path.is_dir(), "{}", path.display());
    }

    #[test]
    fn the_desktop_is_found_even_when_onedrive_has_moved_it() {
        let path = desktop().unwrap();
        assert!(path.is_dir(), "{}", path.display());
        // The point of asking Windows: this may legitimately be under OneDrive
        // rather than under the user profile, and either answer is correct.
        assert!(path.file_name().is_some());
    }

    #[test]
    fn the_start_menu_folder_exists_by_the_time_we_get_it() {
        // KF_FLAG_CREATE is what guarantees this on a profile that has never
        // had a Start menu entry written to it.
        let path = start_menu_programs().unwrap();
        assert!(path.is_dir(), "{}", path.display());
    }
}
