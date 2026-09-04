//! The access key this installer carries, if it carries one.
//!
//! Some builds cannot be reached from inside the launcher at all. There is no
//! button for them, no sign-in that leads to them, nothing to be added to a
//! list for — the only way in is that somebody handed you this executable. The
//! Maker is one; Stable, until release day, is the other.
//!
//! The key is what makes that true. The service stores only its hash, so a key
//! is issued once, written here on install, and sent with every request the
//! launcher makes afterwards. Revoking one person's access is deleting one
//! record, with nothing rebuilt and nobody else affected.
//!
//! Written beside the channel marker and for the same reasons: its own small
//! file rather than a line in the launcher's settings, because two programs
//! editing one JSON document is how somebody's settings get replaced by an
//! installer's defaults.
//!
//! Unlike the channel marker, this one is **not** consumed and deleted. The
//! channel is a decision the launcher adopts once; the key is a credential it
//! has to keep presenting.

use std::path::{Path, PathBuf};

/// The key this build of the installer carries.
///
/// Set at build time with `KIZA_SETUP_KEY`. Absent for the ordinary installer,
/// which is most of them: a key in every copy would be a key in everybody's
/// hands, which is the same as no key at all.
pub fn carried() -> Option<&'static str> {
    let key = option_env!("KIZA_SETUP_KEY")?.trim();
    // Shape-checked, not merely non-empty. The service issues a token of
    // url-safe characters; anything else here is a build script that passed
    // along a shell error message, and writing that to disk would leave an
    // install that fails every request with no clue why.
    if key.is_empty() || key.len() > 128 {
        return None;
    }
    if !key
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return None;
    }
    Some(key)
}

/// Where the launcher looks for it: beside its configuration, in roaming data.
pub fn key_path(roaming_app_data: &Path) -> PathBuf {
    roaming_app_data
        .join(crate::layout::app_user_model_id())
        .join("config")
        .join("setup.key")
}

/// Leaves the key, if this installer was built with one.
///
/// Failure is reported and not fatal, like the channel marker. An install that
/// copied the launcher and registered itself has done what was asked; refusing
/// it at the end over a one-line file would be losing the install to save the
/// note. The launcher will say it has no access, which is a thing the person
/// can act on — unlike a failed install.
pub fn leave_key(roaming_app_data: &Path) -> Result<Option<&'static str>, String> {
    let Some(key) = carried() else {
        return Ok(None);
    };
    let path = key_path(roaming_app_data);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    std::fs::write(&path, key).map_err(|error| {
        // The key itself never appears in the message. A failed install is
        // something people paste into a chat.
        format!("Could not write {}: {error}", path.display())
    })?;
    Ok(Some(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_installer_carries_nothing() {
        if option_env!("KIZA_SETUP_KEY").is_none() {
            assert_eq!(carried(), None);
            let directory = tempfile::tempdir().unwrap();
            assert_eq!(leave_key(directory.path()).unwrap(), None);
            assert!(!key_path(directory.path()).exists());
        }
    }

    /// The other half, run by building this crate with the flag set:
    /// `KIZA_SETUP_KEY=abc cargo test`.
    #[test]
    fn an_installer_built_with_a_key_writes_it() {
        let Some(key) = option_env!("KIZA_SETUP_KEY") else {
            return;
        };
        // Only a well-formed key gets this far; a malformed one is treated as
        // no key, which the assertion below would catch as a mismatch.
        if carried().is_none() {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(leave_key(directory.path()).unwrap(), Some(key));
        assert_eq!(
            std::fs::read_to_string(key_path(directory.path())).unwrap(),
            key
        );
    }

    #[test]
    fn the_key_goes_where_the_launcher_reads_it() {
        let path = key_path(Path::new(r"C:\Users\someone\AppData\Roaming"));
        assert!(path.ends_with("config\\setup.key"));
        assert!(path
            .to_string_lossy()
            .contains(crate::layout::app_user_model_id()));
    }
}
