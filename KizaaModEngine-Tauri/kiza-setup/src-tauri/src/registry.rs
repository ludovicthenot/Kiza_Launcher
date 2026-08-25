//! The entry Windows reads to show Kiza in "Apps & features".
//!
//! An install that skips this is an install the user cannot remove through the
//! normal route, and that is the difference between a program and something
//! that behaves like malware.
//!
//! Everything lives under `HKEY_CURRENT_USER`, because Kiza installs for one
//! user and never asks for an administrator.

use std::path::{Path, PathBuf};

use crate::layout::{APP_ID_KEY, PRODUCT_NAME, UNINSTALL_KEY};

/// What an existing install looks like from the outside.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExistingInstall {
    pub install_dir: PathBuf,
    pub version: String,
}

/// Reads the previous install, if there is one.
///
/// An update must land on top of wherever the user actually put Kiza, not on
/// top of today's default: someone who installed to another drive would
/// otherwise end up with two copies and an updater pointing at the wrong one.
pub fn existing_install() -> Option<ExistingInstall> {
    read_at(UNINSTALL_KEY)
}

fn read_at(key_path: &str) -> Option<ExistingInstall> {
    let key = windows_registry::CURRENT_USER.open(key_path).ok()?;
    let install_dir = unquote(&key.get_string("InstallLocation").ok()?);
    if install_dir.is_empty() {
        return None;
    }
    Some(ExistingInstall {
        install_dir: PathBuf::from(install_dir),
        version: key.get_string("DisplayVersion").unwrap_or_default(),
    })
}

/// Strips the quotes some installers wrap `InstallLocation` in.
///
/// The NSIS installer Kiza used to ship wrote the value quoted, and a path that
/// still has its quotes attached is a path that matches nothing on disk. Every
/// existing install carries one, so reading it correctly is what makes the
/// first upgrade land in the right folder instead of creating a second copy.
fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(trimmed)
        .to_string()
}

/// Names the identifier Windows files Kiza's notifications under.
///
/// The shortcut is what makes the identifier valid; this is what gives it a
/// name and an icon in the Action Centre. Without it a notification that does
/// arrive is headed by a raw reverse-domain string, which reads as something
/// that got loose rather than as the launcher.
pub fn register_notification_identity(executable: &Path) -> Result<(), String> {
    let key = windows_registry::CURRENT_USER
        .create(APP_ID_KEY)
        .map_err(|error| format!("Could not register the notification identity: {error}"))?;
    key.set_string("DisplayName", PRODUCT_NAME)
        .map_err(|error| error.to_string())?;
    // Read straight out of the launcher, so the Action Centre follows any
    // future change of icon without the key being rewritten.
    key.set_string("IconUri", executable.to_string_lossy())
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Describes the install to Windows.
pub fn register(
    install_dir: &Path,
    uninstaller: &Path,
    version: &str,
    installed_bytes: u64,
) -> Result<(), String> {
    write_at(
        UNINSTALL_KEY,
        install_dir,
        uninstaller,
        version,
        installed_bytes,
    )
}

fn write_at(
    key_path: &str,
    install_dir: &Path,
    uninstaller: &Path,
    version: &str,
    installed_bytes: u64,
) -> Result<(), String> {
    let key = windows_registry::CURRENT_USER
        .create(key_path)
        .map_err(|error| format!("Could not write to the registry: {error}"))?;

    let quoted_uninstaller = format!("\"{}\"", uninstaller.display());
    let executable = install_dir.join(crate::layout::EXECUTABLE);

    let values: [(&str, String); 8] = [
        ("DisplayName", PRODUCT_NAME.to_string()),
        ("DisplayVersion", version.to_string()),
        // The `,0` picks the first icon in the executable, which is the one
        // Windows shows beside the entry.
        ("DisplayIcon", format!("{},0", executable.display())),
        ("Publisher", "Nefer".to_string()),
        ("InstallLocation", install_dir.display().to_string()),
        // `--uninstall` spelled out rather than left to the file name. The
        // installer and the uninstaller are one binary, and the switch is what
        // says which of the two Windows is asking for.
        (
            "UninstallString",
            format!("{quoted_uninstaller} --uninstall"),
        ),
        // Windows uses this when it removes the app without a dialogue, during
        // a reset or a bulk uninstall.
        (
            "QuietUninstallString",
            format!("{quoted_uninstaller} --uninstall /S"),
        ),
        (
            "URLInfoAbout",
            "https://github.com/ludovicthenot/Kiza_Launcher".to_string(),
        ),
    ];

    for (name, value) in values {
        key.set_string(name, &value)
            .map_err(|error| format!("Could not write {name}: {error}"))?;
    }

    // Windows shows this figure in kilobytes and nothing else; a size in bytes
    // here would read as a terabyte.
    key.set_u32("EstimatedSize", estimated_size_kb(installed_bytes))
        .map_err(|error| format!("Could not write EstimatedSize: {error}"))?;

    // There is no repair path and nothing to modify, so Windows should not
    // offer buttons that would do nothing.
    for flag in ["NoModify", "NoRepair"] {
        key.set_u32(flag, 1)
            .map_err(|error| format!("Could not write {flag}: {error}"))?;
    }

    Ok(())
}

/// Windows stores `EstimatedSize` in kilobytes, as a 32-bit value.
///
/// Rounded up so a small install never reports zero, and capped so an absurd
/// figure cannot wrap around into a tiny one.
fn estimated_size_kb(bytes: u64) -> u32 {
    let kb = bytes.div_ceil(1024);
    kb.min(u32::MAX as u64) as u32
}

/// Removes the entry. Used by the uninstaller.
pub fn unregister() -> Result<(), String> {
    // The notification identity goes with it. Leaving it behind would leave a
    // key naming a program that is no longer on the machine, pointing its icon
    // at an executable that no longer exists.
    let _ = remove_at(APP_ID_KEY);
    remove_at(UNINSTALL_KEY)
}

fn remove_at(key_path: &str) -> Result<(), String> {
    match windows_registry::CURRENT_USER.remove_tree(key_path) {
        Ok(()) => Ok(()),
        // Already gone is the outcome that was wanted.
        Err(error) if error.code() == windows::Win32::Foundation::ERROR_FILE_NOT_FOUND.into() => {
            Ok(())
        }
        Err(error) => Err(format!("Could not remove the registry entry: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every test gets a key of its own under a scratch branch.
    ///
    /// One shared key would be worse than untidy: these tests run in parallel,
    /// and a `remove_tree` from one lands in the middle of another one's write.
    /// Nothing here ever names the real uninstall key either — this module
    /// deletes registry entries, and a test that reached the real one would
    /// take the machine's own Kiza install out of "Apps & features".
    struct Scratch {
        path: String,
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let path = format!(r"Software\Kiza Launcher Setup Tests\{name}");
            let _ = windows_registry::CURRENT_USER.remove_tree(&path);
            Self { path }
        }

        fn key(&self) -> &str {
            &self.path
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = windows_registry::CURRENT_USER.remove_tree(&self.path);
        }
    }

    #[test]
    fn a_kilobyte_figure_is_rounded_up_so_nothing_reports_zero() {
        assert_eq!(estimated_size_kb(0), 0);
        assert_eq!(estimated_size_kb(1), 1);
        assert_eq!(estimated_size_kb(1024), 1);
        assert_eq!(estimated_size_kb(1025), 2);
        // 40 MB, roughly what the launcher weighs.
        assert_eq!(estimated_size_kb(40 * 1024 * 1024), 40 * 1024);
    }

    #[test]
    fn an_absurd_size_cannot_wrap_around_into_a_small_one() {
        assert_eq!(estimated_size_kb(u64::MAX), u32::MAX);
    }

    #[test]
    fn windows_can_find_the_install_after_it_is_registered() {
        let scratch = Scratch::new("registered");
        let install = PathBuf::from(r"C:\Users\test\AppData\Local\Kiza Launcher");
        let uninstaller = install.join(crate::layout::UNINSTALLER);

        write_at(
            scratch.key(),
            &install,
            &uninstaller,
            "0.0.304",
            40 * 1024 * 1024,
        )
        .unwrap();

        let key = windows_registry::CURRENT_USER.open(scratch.key()).unwrap();
        assert_eq!(key.get_string("DisplayName").unwrap(), "Kiza Launcher");
        assert_eq!(key.get_string("DisplayVersion").unwrap(), "0.0.304");
        assert_eq!(key.get_u32("EstimatedSize").unwrap(), 40 * 1024);
        // Quoted, or a path with spaces would be read as a command plus
        // arguments and the uninstall would fail.
        let uninstall = key.get_string("UninstallString").unwrap();
        assert!(uninstall.starts_with('"'), "{uninstall}");
        // Without the switch the binary runs as an installer, and Windows'
        // "Uninstall" button would reinstall Kiza.
        assert!(uninstall.ends_with("--uninstall"), "{uninstall}");

        let quiet = key.get_string("QuietUninstallString").unwrap();
        assert!(quiet.contains("--uninstall"), "{quiet}");
        assert!(quiet.ends_with("/S"), "{quiet}");
    }

    #[test]
    fn an_update_finds_where_the_previous_install_went() {
        let scratch = Scratch::new("previous");
        let install = PathBuf::from(r"D:\Games\Kiza");
        write_at(
            scratch.key(),
            &install,
            &install.join("u.exe"),
            "0.0.300",
            1,
        )
        .unwrap();

        let found = read_at(scratch.key()).unwrap();

        assert_eq!(found.install_dir, install);
        assert_eq!(found.version, "0.0.300");
    }

    /// The value the old NSIS installer actually wrote on the machine this was
    /// developed on. Left as it comes, an upgrade would be sent to a folder
    /// whose name contains quote characters, and a second copy of Kiza would
    /// appear beside the first instead of replacing it.
    #[test]
    fn a_quoted_install_location_from_the_old_installer_is_read_correctly() {
        let scratch = Scratch::new("quoted");
        let key = windows_registry::CURRENT_USER
            .create(scratch.key())
            .unwrap();
        key.set_string(
            "InstallLocation",
            r#""C:\Users\nefer\AppData\Local\Kiza Launcher""#,
        )
        .unwrap();
        key.set_string("DisplayVersion", "0.0.304").unwrap();

        let found = read_at(scratch.key()).unwrap();

        assert_eq!(
            found.install_dir,
            PathBuf::from(r"C:\Users\nefer\AppData\Local\Kiza Launcher")
        );
    }

    #[test]
    fn unquoting_leaves_an_ordinary_path_alone() {
        assert_eq!(unquote(r"C:\Kiza"), r"C:\Kiza");
        assert_eq!(unquote(r#""C:\Kiza""#), r"C:\Kiza");
        assert_eq!(unquote("  "), "");
        // A lone quote is not a pair, and trimming it would invent a path.
        assert_eq!(unquote(r#""C:\Kiza"#), r#""C:\Kiza"#);
    }

    #[test]
    fn nothing_is_reported_when_kiza_was_never_installed() {
        let scratch = Scratch::new("never-written");
        assert_eq!(read_at(scratch.key()), None);
    }

    #[test]
    fn an_entry_without_an_install_location_is_not_an_install() {
        let scratch = Scratch::new("empty-location");
        let key = windows_registry::CURRENT_USER
            .create(scratch.key())
            .unwrap();
        key.set_string("InstallLocation", "   ").unwrap();

        assert_eq!(read_at(scratch.key()), None);
    }

    #[test]
    fn removing_the_entry_twice_is_not_an_error() {
        let scratch = Scratch::new("removed-twice");
        write_at(
            scratch.key(),
            Path::new(r"C:\x"),
            Path::new(r"C:\x\u.exe"),
            "1",
            1,
        )
        .unwrap();

        remove_at(scratch.key()).unwrap();
        remove_at(scratch.key()).unwrap();

        assert_eq!(read_at(scratch.key()), None);
    }
}
