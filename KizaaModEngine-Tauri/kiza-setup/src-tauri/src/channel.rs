//! The stream this installer is handing out.
//!
//! Kiza's alpha is not a different application — it is the launcher, on an
//! earlier stream. So the installer given to a tester is the same installer as
//! everybody else's, with one thing added: it says which stream this copy was
//! handed out for, and the launcher reads it once on its first run.
//!
//! Written as its own small file rather than into the launcher's settings.
//! Two programs editing one JSON document is how somebody's carefully chosen
//! settings get replaced by an installer's defaults; and the launcher may not
//! even have a settings file yet, since it writes one on first launch. A file
//! that says one thing, consumed and deleted by whoever it is addressed to,
//! cannot take anything else with it.
//!
//! Compiled in, not asked at install time. A tester should not have to know
//! what a channel is, and an installer that asks is an installer that can be
//! answered wrongly.

use std::path::{Path, PathBuf};

/// The channel this build of the installer hands out, if it hands out one.
///
/// Set at build time with `KIZA_SETUP_CHANNEL`. Absent for the ordinary
/// installer, which leaves the launcher on whatever it already follows.
pub fn requested() -> Option<&'static str> {
    let channel = option_env!("KIZA_SETUP_CHANNEL")?.trim();
    // Spelled out rather than passed through: this ends up deciding which
    // builds a person receives, and a typo in a build script should not be
    // able to write an unknown word into somebody's launcher.
    match channel {
        "stable" | "beta" | "alpha" | "experimental" | "maker" => Some(channel),
        _ => None,
    }
}

/// Where the launcher looks for it: beside its configuration, in roaming data.
pub fn marker_path(roaming_app_data: &Path) -> PathBuf {
    roaming_app_data
        .join(crate::layout::app_user_model_id())
        .join("config")
        .join("channel")
}

/// Leaves the marker, if this installer was built to hand out a channel.
///
/// Failure is reported and not fatal. An install that copied the launcher,
/// wrote its shortcuts and registered itself has done the thing somebody
/// asked for; refusing it at the end over a one-line file would be losing the
/// install to save the note.
pub fn leave_marker(roaming_app_data: &Path) -> Result<Option<&'static str>, String> {
    let Some(channel) = requested() else {
        return Ok(None);
    };
    let path = marker_path(roaming_app_data);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    std::fs::write(&path, channel)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    Ok(Some(channel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_installer_hands_out_nothing() {
        // Nothing is set when this test runs, which is the ordinary installer:
        // it must leave the launcher on whatever stream it already follows.
        if option_env!("KIZA_SETUP_CHANNEL").is_none() {
            assert_eq!(requested(), None);
            let directory = tempfile::tempdir().unwrap();
            assert_eq!(leave_marker(directory.path()).unwrap(), None);
            assert!(!marker_path(directory.path()).exists());
        }
    }

    /// The other half, run by building this crate with the flag set.
    ///
    /// `option_env!` reads at compile time, so the only way to test the
    /// channel-carrying installer is to compile one — which is exactly what
    /// the release build does, and what
    /// `KIZA_SETUP_CHANNEL=alpha cargo test` does here.
    #[test]
    fn an_installer_built_for_a_channel_hands_it_out() {
        let Some(channel) = option_env!("KIZA_SETUP_CHANNEL") else {
            return;
        };
        assert_eq!(requested(), Some(channel));

        let directory = tempfile::tempdir().unwrap();
        assert_eq!(leave_marker(directory.path()).unwrap(), Some(channel));

        let written = std::fs::read_to_string(marker_path(directory.path())).unwrap();
        assert_eq!(written, channel);
    }

    #[test]
    fn the_marker_goes_where_the_launcher_reads_it() {
        let path = marker_path(Path::new(r"C:\Users\someone\AppData\Roaming"));
        assert!(path.ends_with("config\\channel"));
        // Under the launcher's own identifier: a Maker install and a launcher
        // install keep their own, in their own folders.
        assert!(path.to_string_lossy().contains(crate::layout::app_user_model_id()));
    }
}
