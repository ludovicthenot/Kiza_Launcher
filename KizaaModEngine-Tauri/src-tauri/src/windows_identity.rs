//! Who Kiza is, as far as the Windows notification system is concerned.
//!
//! A Windows toast is not addressed to a running process. It is addressed to an
//! **AppUserModelID** — a string Windows must already know about — and the
//! notification platform silently drops anything sent under an identifier it
//! cannot resolve. No error is raised, no permission is refused; the toast is
//! simply never drawn.
//!
//! That is what happened to Kiza. The NSIS bundle Tauri used to build wrote the
//! identifier into the Start menu shortcut; KizaSetup, which replaced it, wrote
//! a perfectly good shortcut without one. Every switch on the Notifications
//! page still read "on", the Rust call still returned `Ok`, and nothing ever
//! appeared.
//!
//! Windows accepts two registrations, and Kiza performs both, because they
//! answer different questions:
//!
//! * the **registry key** under `Software\Classes\AppUserModelId` says what the
//!   identifier is called and which icon it wears in the Action Centre;
//! * the **`System.AppUserModel.ID` property on the Start menu shortcut** is
//!   what makes an unpackaged desktop program a legitimate sender at all.
//!
//! Both are per-user and need no elevation. Both are repaired at every launch
//! rather than at install time only, so an install that predates this code
//! starts working the next time Kiza opens instead of requiring a reinstall.

/// The identifier Kiza sends notifications under.
///
/// It must equal the bundle identifier this build was compiled with, because
/// that is what `tauri-plugin-notification` passes to Windows; the two drifting
/// apart would break notifications in exactly the silent way this module exists
/// to prevent. The test at the bottom of this file reads the manifest and fails
/// if they ever differ.
///
/// One per edition. Windows keys a notification identity, a Start-menu
/// shortcut and an uninstall entry on this string, so three editions sharing it
/// would be three products overwriting each other's registration — and the last
/// one launched would own every notification the others sent.
pub fn app_user_model_id() -> &'static str {
    match crate::edition::current() {
        crate::edition::Edition::Stable => "com.kizamods.engine",
        crate::edition::Edition::Maker => "com.kizamods.maker",
        crate::edition::Edition::Experimental => "com.kizamods.experimental",
    }
}

/// The name Windows shows above a Kiza notification.
pub fn display_name() -> &'static str {
    crate::edition::current().display_name()
}

/// The Start menu shortcut KizaSetup writes, relative to the Programs folder.
pub fn shortcut_name() -> String {
    format!("{}.lnk", display_name())
}

/// What a registration attempt found or changed.
///
/// Returned rather than logged so the Notifications page can say *why* a test
/// notification produced nothing, instead of leaving the user to guess between
/// Focus Assist, a policy, and a launcher bug.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    /// The registry entry exists and names Kiza.
    pub registered: bool,
    /// A Start menu shortcut exists and carries the identifier.
    pub shortcut_tagged: bool,
}

impl Registration {
    /// Whether Windows can be expected to deliver a toast at all.
    ///
    /// The shortcut is the part Windows actually insists on for an unpackaged
    /// program; the registry entry only dresses the result up.
    pub fn can_notify(&self) -> bool {
        self.shortcut_tagged
    }
}

/// The path Kiza's Start menu shortcut should have.
///
/// Split from the work so the path rule can be tested without a Start menu:
/// the alternative is a test that writes into the real one.
pub fn shortcut_path(programs: &std::path::Path) -> std::path::PathBuf {
    programs.join(shortcut_name())
}

#[cfg(windows)]
mod windows_impl {
    use super::{app_user_model_id, display_name, Registration};
    use std::path::Path;

    use windows::core::{Interface, GUID, HSTRING, PCWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        IShellLinkW, SetCurrentProcessExplicitAppUserModelID, ShellLink,
    };

    /// `System.AppUserModel.ID`.
    ///
    /// Written out by hand because windows-rs generates interfaces and
    /// functions but not the property-key constants, and this is the one key
    /// the whole notification path depends on.
    const PKEY_APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3),
        pid: 5,
    };

    /// Holds COM open for the length of one operation.
    ///
    /// Already-initialised is not a failure — Tauri gets there first on the
    /// main thread — and in that case this guard must not be the one to close
    /// it again.
    struct ComScope {
        owned: bool,
    }

    impl ComScope {
        fn enter() -> Self {
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

    /// Tells Windows which identifier this process is running under.
    ///
    /// Without it a toast that does get through is attributed to whatever
    /// Windows infers from the executable, which is how a notification ends up
    /// grouped under the wrong name in the Action Centre.
    pub fn claim_identity() {
        let id = HSTRING::from(app_user_model_id());
        // A failure here costs the grouping, not the notification, so it is not
        // worth interrupting startup over.
        let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(PCWSTR(id.as_ptr())) };
    }

    /// Writes the registry entry that names the identifier.
    pub fn register_identifier(executable: &Path) -> Result<(), String> {
        let key = windows_registry::CURRENT_USER
            .create(format!(
                r"Software\Classes\AppUserModelId\{}",
                app_user_model_id()
            ))
            .map_err(|error| format!("Could not write the notification identity: {error}"))?;

        key.set_string("DisplayName", display_name())
            .map_err(|error| error.to_string())?;
        // Windows reads the icon straight out of the executable, so the Action
        // Centre follows every future change of icon without being rewritten.
        key.set_string("IconUri", executable.to_string_lossy())
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Reads the identifier already stored on a shortcut, if any.
    pub fn shortcut_identifier(link_path: &Path) -> Option<String> {
        let _com = ComScope::enter();
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let persist: IPersistFile = link.cast().ok()?;
            persist
                .Load(&HSTRING::from(link_path.as_os_str()), STGM_READWRITE)
                .ok()?;

            let store: IPropertyStore = link.cast().ok()?;
            let value = store.GetValue(&PKEY_APP_USER_MODEL_ID).ok()?;
            let text = value.to_string();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
    }

    /// Stamps the identifier onto an existing shortcut, in place.
    ///
    /// The shortcut is loaded and saved rather than rebuilt: its target,
    /// working directory and icon were set by the installer and are none of
    /// this code's business. Only the one missing property is added.
    pub fn tag_shortcut(link_path: &Path) -> Result<(), String> {
        let _com = ComScope::enter();
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| format!("The shell would not open the shortcut: {error}"))?;
            let persist: IPersistFile = link
                .cast()
                .map_err(|error| format!("The shortcut could not be read: {error}"))?;
            persist
                .Load(&HSTRING::from(link_path.as_os_str()), STGM_READWRITE)
                .map_err(|error| format!("Could not read {}: {error}", link_path.display()))?;

            let store: IPropertyStore = link
                .cast()
                .map_err(|error| format!("The shortcut has no property store: {error}"))?;
            let value = PROPVARIANT::from(app_user_model_id());
            store
                .SetValue(&PKEY_APP_USER_MODEL_ID, &value)
                .map_err(|error| format!("Could not set the identifier: {error}"))?;
            store
                .Commit()
                .map_err(|error| format!("Could not save the identifier: {error}"))?;

            persist
                .Save(PCWSTR::null(), true)
                .map_err(|error| format!("Could not save {}: {error}", link_path.display()))?;
        }
        Ok(())
    }

    /// The per-user Start menu Programs folder, asked of Windows.
    ///
    /// `%APPDATA%\Microsoft\Windows\Start Menu\Programs` is wrong on a real
    /// share of machines: the Start menu can be redirected by policy, and a
    /// shortcut written to the assembled path is a shortcut Windows never sees.
    pub fn start_menu_programs() -> Option<std::path::PathBuf> {
        use windows::core::PWSTR;
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{FOLDERID_Programs, SHGetKnownFolderPath, KF_FLAG_CREATE};

        unsafe {
            let raw: PWSTR = SHGetKnownFolderPath(&FOLDERID_Programs, KF_FLAG_CREATE, None).ok()?;
            if raw.is_null() {
                return None;
            }
            let path = raw.to_string().ok();
            CoTaskMemFree(Some(raw.0 as *const _));
            path.map(std::path::PathBuf::from)
        }
    }

    /// Whether the shortcut carries the identifier by the time this returns.
    ///
    /// Separate from `ensure` so it can be tested without the registry half.
    /// `ensure` writes to `HKEY_CURRENT_USER`, and a test that calls it writes
    /// to the registry of the machine running the tests — which is how this
    /// module's own test came to leave `IconUri = kiza.exe` on a real install.
    pub fn tag_shortcut_if_needed(shortcut: &Path) -> bool {
        // A shortcut that already carries the right identifier is left alone:
        // rewriting a shell link on every launch is a file write nobody asked
        // for, and it resets the pin state on some builds of Windows.
        if !shortcut.exists() {
            false
        } else if shortcut_identifier(shortcut).as_deref() == Some(app_user_model_id()) {
            true
        } else {
            tag_shortcut(shortcut).is_ok()
        }
    }

    /// Everything above, in the order Windows wants it, reporting what stuck.
    pub fn ensure(executable: &Path, shortcut: &Path) -> Registration {
        claim_identity();

        Registration {
            registered: register_identifier(executable).is_ok(),
            shortcut_tagged: tag_shortcut_if_needed(shortcut),
        }
    }
}

#[cfg(windows)]
pub use windows_impl::{claim_identity, ensure, start_menu_programs};

#[cfg(not(windows))]
mod other_impl {
    use super::Registration;
    use std::path::Path;

    pub fn claim_identity() {}

    pub fn start_menu_programs() -> Option<std::path::PathBuf> {
        None
    }

    /// Nothing to register: every other platform delivers a notification
    /// without being told who is sending it.
    pub fn ensure(_executable: &Path, _shortcut: &Path) -> Registration {
        Registration {
            registered: true,
            shortcut_tagged: true,
        }
    }
}

#[cfg(not(windows))]
pub use other_impl::{claim_identity, ensure, start_menu_programs};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_identifier_matches_the_bundle_identifier() {
        // The notification plugin sends under `tauri.conf.json`'s identifier,
        // not under this constant. If someone renames the bundle, every
        // notification stops appearing and nothing reports an error — so the
        // mismatch is caught here instead.
        let manifest =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))
                .expect("tauri.conf.json should be readable");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("tauri.conf.json should parse");

        assert_eq!(
            parsed["identifier"].as_str(),
            Some(app_user_model_id()),
            "the notification identifier must equal the bundle identifier"
        );
    }

    #[test]
    fn the_display_name_matches_the_product_name() {
        let manifest =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))
                .expect("tauri.conf.json should be readable");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("tauri.conf.json should parse");

        assert_eq!(parsed["productName"].as_str(), Some(display_name()));
    }

    #[test]
    fn the_shortcut_sits_in_the_programs_folder() {
        let path = shortcut_path(std::path::Path::new(r"C:\Programs"));
        assert_eq!(path.file_name().unwrap().to_string_lossy(), shortcut_name());
        assert_eq!(path.parent().unwrap(), std::path::Path::new(r"C:\Programs"));
    }

    /// A shortcut that is not there cannot be tagged, and saying it was would
    /// hide the one condition the Notifications page needs to report.
    ///
    /// Deliberately not through `ensure`: that also registers the identifier,
    /// which writes to `HKEY_CURRENT_USER` — the real one, on whatever machine
    /// runs the tests. An earlier version of this test did exactly that and
    /// left `IconUri = kiza.exe` behind on a working install.
    #[test]
    #[cfg(windows)]
    fn a_missing_shortcut_is_not_reported_as_ready() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("nothing.lnk");

        assert!(!windows_impl::tag_shortcut_if_needed(&missing));
    }

    /// The registration half touches the machine's own registry, so nothing
    /// here may call it. Checked by reading this file rather than by trusting
    /// it: the damage is invisible until someone looks at the registry.
    #[test]
    fn no_test_in_this_module_touches_the_real_registry() {
        let source = include_str!("windows_identity.rs");
        let tests = source
            .split_once("mod tests {")
            .expect("this module has tests")
            .1;

        // Built rather than written out, so this check does not trip over its
        // own needles, and comments are dropped so prose about them is allowed.
        let code: String = tests
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        for name in ["ensure", "register_identifier"] {
            let call = format!("{name}(");
            assert!(
                !code.contains(&call),
                "a test calls {call}, which writes to HKEY_CURRENT_USER"
            );
        }
    }
}
