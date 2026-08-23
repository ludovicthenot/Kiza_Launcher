//! Microsoft Edge WebView2 — the component both Kiza Launcher and this
//! installer draw their interface with.
//!
//! This is the one awkward corner of shipping an installer that is itself a
//! Tauri application: on a machine without WebView2 the installer cannot draw
//! its own window to explain the problem. So the check runs in `main`, before
//! any window is created, and the only interface available at that point is a
//! plain Windows message box.
//!
//! Windows 11 has WebView2 in the box, and so does any Windows 10 that has seen
//! a recent update, which is why this path almost never runs. It still has to
//! exist: "almost never" is not "never", and the person it happens to is the
//! person who would otherwise see a program that starts and vanishes.

use std::path::PathBuf;
use std::process::Command;

/// The update client's identifier for the Evergreen runtime. Microsoft writes a
/// version under it once the runtime is present.
const RUNTIME_CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/// Microsoft's permanent redirect to the Evergreen bootstrapper. This is the
/// vendor's own documented way to install the runtime, and the same address
/// Tauri's stock NSIS installer uses.
const BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// Whether a usable runtime is already on the machine.
pub fn is_installed() -> bool {
    // Machine-wide installs land under WOW6432Node on 64-bit Windows; a
    // per-user install lands in HKCU. Any of the three counts.
    let machine_wide =
        format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{RUNTIME_CLIENT}");
    let machine_wide_native = format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{RUNTIME_CLIENT}");
    let per_user = format!(r"Software\Microsoft\EdgeUpdate\Clients\{RUNTIME_CLIENT}");

    has_version(windows_registry::LOCAL_MACHINE, &machine_wide)
        || has_version(windows_registry::LOCAL_MACHINE, &machine_wide_native)
        || has_version(windows_registry::CURRENT_USER, &per_user)
}

fn has_version(root: &windows_registry::Key, path: &str) -> bool {
    root.open(path)
        .and_then(|key| key.get_string("pv"))
        .map(|version| !version.trim().is_empty() && version != "0.0.0.0")
        .unwrap_or(false)
}

/// Fetches and runs Microsoft's bootstrapper.
///
/// `silent` follows the installer's own presentation: during an automatic
/// update nothing may pop up, but a first install may show Microsoft's progress
/// window so the wait is explained rather than mysterious.
pub fn install(silent: bool) -> Result<(), String> {
    let bootstrapper = download_bootstrapper()?;

    let mut command = Command::new(&bootstrapper);
    // Documented switches of the Evergreen bootstrapper.
    command.arg("/install");
    if silent {
        command.arg("/silent");
    }

    let status = command
        .status()
        .map_err(|error| format!("The WebView2 installer would not start: {error}"))?;

    let _ = std::fs::remove_file(&bootstrapper);

    if !status.success() {
        return Err(format!(
            "Microsoft's WebView2 installer stopped with code {}.",
            status.code().unwrap_or(-1)
        ));
    }
    if !is_installed() {
        return Err("WebView2 still is not present after its installer ran.".to_string());
    }
    Ok(())
}

/// Downloads with `curl.exe`, which every Windows 10 build since 2018 ships.
///
/// Pulling in an HTTP stack for one download that happens on almost no machine
/// would cost every user the size of it.
fn download_bootstrapper() -> Result<PathBuf, String> {
    let destination = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
    let _ = std::fs::remove_file(&destination);

    let status = Command::new("curl.exe")
        .arg("--location")
        .arg("--silent")
        .arg("--show-error")
        .arg("--fail")
        .arg("--output")
        .arg(&destination)
        .arg(BOOTSTRAPPER_URL)
        .status()
        .map_err(|error| format!("Could not run curl to fetch WebView2: {error}"))?;

    if !status.success() || !destination.exists() {
        return Err(
            "Could not download the WebView2 installer. Check the internet connection.".to_string(),
        );
    }
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_without_a_version_does_not_count_as_installed() {
        // A leftover key with no `pv`, or a zeroed one, is what an uninstalled
        // runtime leaves behind. Reading either as "present" would send the
        // installer on to a window it cannot draw.
        let key = windows_registry::CURRENT_USER
            .create(r"Software\Kiza Launcher Setup Tests\WebView2 Detection")
            .unwrap();
        assert!(!has_version(
            windows_registry::CURRENT_USER,
            r"Software\Kiza Launcher Setup Tests\WebView2 Detection"
        ));

        key.set_string("pv", "0.0.0.0").unwrap();
        assert!(!has_version(
            windows_registry::CURRENT_USER,
            r"Software\Kiza Launcher Setup Tests\WebView2 Detection"
        ));

        key.set_string("pv", "120.0.2210.91").unwrap();
        assert!(has_version(
            windows_registry::CURRENT_USER,
            r"Software\Kiza Launcher Setup Tests\WebView2 Detection"
        ));

        let _ = windows_registry::CURRENT_USER
            .remove_tree(r"Software\Kiza Launcher Setup Tests\WebView2 Detection");
    }

    #[test]
    fn a_key_that_was_never_written_does_not_count_as_installed() {
        assert!(!has_version(
            windows_registry::CURRENT_USER,
            r"Software\Kiza Launcher Setup Tests\Never Written"
        ));
    }

    #[test]
    fn this_machine_can_draw_a_webview_since_it_is_running_these_tests() {
        // Not a tautology: it proves the detection agrees with reality on at
        // least one real machine, which is what the whole check is for.
        assert!(is_installed());
    }
}
