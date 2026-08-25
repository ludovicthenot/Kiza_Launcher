//! Launching Kiza when Windows starts.
//!
//! Windows reads a per-user list of programs to start from the registry, under
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Writing there needs no
//! elevation, which is why it is the per-user key and not the machine-wide one:
//! a launcher has no business asking for administrator rights to add itself to
//! a startup list.
//!
//! The registry is driven through `reg.exe` rather than a new dependency. It
//! ships with Windows, and the whole surface used here is three commands.

/// The value name under the Run key. Stable, so toggling twice does not leave
/// a second entry behind.
const VALUE_NAME: &str = "KizaLauncher";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

/// The command line Windows should run.
///
/// Quoted because the path contains spaces on any normal install
/// (`C:\Program Files\…`), and an unquoted path would be read as several
/// arguments and simply fail to start.
pub fn startup_command(executable: &std::path::Path) -> String {
    format!("\"{}\"", executable.display())
}

/// Arguments that add the entry.
pub fn add_arguments(executable: &std::path::Path) -> Vec<String> {
    vec![
        "add".to_string(),
        RUN_KEY.to_string(),
        "/v".to_string(),
        VALUE_NAME.to_string(),
        "/t".to_string(),
        "REG_SZ".to_string(),
        "/d".to_string(),
        startup_command(executable),
        // Overwrite silently: without this, re-enabling after an upgrade would
        // stall on a confirmation prompt nobody can answer.
        "/f".to_string(),
    ]
}

/// Arguments that remove it.
pub fn remove_arguments() -> Vec<String> {
    vec![
        "delete".to_string(),
        RUN_KEY.to_string(),
        "/v".to_string(),
        VALUE_NAME.to_string(),
        "/f".to_string(),
    ]
}

fn run_reg(arguments: &[String]) -> Result<std::process::Output, String> {
    std::process::Command::new("reg")
        .args(arguments)
        .output()
        .map_err(|error| format!("Could not reach the Windows registry: {error}"))
}

/// Whether Kiza is currently in the startup list.
pub fn is_enabled() -> bool {
    run_reg(&[
        "query".to_string(),
        RUN_KEY.to_string(),
        "/v".to_string(),
        VALUE_NAME.to_string(),
    ])
    .map(|output| output.status.success())
    .unwrap_or(false)
}

/// The command line the entry currently holds, if it holds one.
///
/// `reg query` prints a header, a blank line, and then one indented line per
/// value: `    KizaLauncher    REG_SZ    "C:\...\Kiza Launcher.exe"`. Only the
/// third column is wanted, and the path itself contains spaces, so the split is
/// on the type rather than on whitespace.
pub fn stored_command(query_output: &str) -> Option<String> {
    query_output
        .lines()
        .find(|line| line.contains(VALUE_NAME) && line.contains("REG_SZ"))
        .and_then(|line| line.split_once("REG_SZ"))
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Whether the entry names something other than the launcher that is running.
///
/// This is what makes an upgrade stick. Kiza used to be called `KizaaMod.exe`,
/// and the entry is written once — when the switch is turned on — and never
/// looked at again. Someone who enabled "start with Windows" on an old build
/// therefore kept a startup entry pointing at the old executable, and every
/// reboot started the version they thought they had replaced. The new build was
/// on disk, the shortcuts pointed at it, and it still was not what opened.
pub fn needs_refresh(stored: Option<&str>, wanted: &str) -> bool {
    match stored {
        // Not in the list at all: the user did not ask for this, and adding it
        // would be turning a setting on for them.
        None => false,
        // Compared case-insensitively because Windows paths are, and a rewrite
        // that changes nothing is a registry write on every launch.
        Some(current) => !current.eq_ignore_ascii_case(wanted),
    }
}

/// Repoints the startup entry at this executable, when it points elsewhere.
///
/// Returns whether anything was rewritten, so a caller can say so in the log
/// rather than leaving a silent registry write to be discovered later.
pub fn refresh(executable: &std::path::Path) -> bool {
    let Ok(output) = run_reg(&[
        "query".to_string(),
        RUN_KEY.to_string(),
        "/v".to_string(),
        VALUE_NAME.to_string(),
    ]) else {
        return false;
    };
    if !output.status.success() {
        return false;
    }

    let stored = stored_command(&String::from_utf8_lossy(&output.stdout));
    let wanted = startup_command(executable);
    if !needs_refresh(stored.as_deref(), &wanted) {
        return false;
    }

    run_reg(&add_arguments(executable))
        .map(|result| result.status.success())
        .unwrap_or(false)
}

/// Adds or removes the entry, and reports the state that actually resulted.
///
/// The returned value is read back from the registry rather than echoed from
/// the request: a policy or another tool can refuse the write, and a switch
/// that flipped in the interface while nothing changed on disk would be a lie.
pub fn set_enabled(enabled: bool, executable: &std::path::Path) -> Result<bool, String> {
    let arguments = if enabled {
        add_arguments(executable)
    } else {
        remove_arguments()
    };

    let output = run_reg(&arguments)?;
    // Deleting a value that is not there reports failure; that is the wanted
    // state either way, so it is not an error to report.
    if !output.status.success() && enabled {
        return Err(format!(
            "Windows refused the startup entry: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(is_enabled())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn the_command_is_quoted_so_a_spaced_path_still_starts() {
        let path = Path::new(r"C:\Program Files\Kiza Launcher\KizaaMod.exe");
        // Unquoted, Windows would read this as "C:\Program" plus arguments.
        assert_eq!(
            startup_command(path),
            "\"C:\\Program Files\\Kiza Launcher\\KizaaMod.exe\""
        );
    }

    #[test]
    fn adding_overwrites_instead_of_prompting() {
        let arguments = add_arguments(Path::new(r"C:\Kiza\KizaaMod.exe"));
        // Without /f, re-enabling after an upgrade would wait forever on a
        // confirmation nobody can answer.
        assert!(arguments.contains(&"/f".to_string()));
        assert!(arguments.contains(&VALUE_NAME.to_string()));
        assert_eq!(arguments[0], "add");
    }

    #[test]
    fn both_operations_target_the_per_user_key() {
        // The machine-wide key would need administrator rights, which a
        // launcher has no business asking for to add itself to a list.
        assert!(add_arguments(Path::new("k.exe")).contains(&RUN_KEY.to_string()));
        assert!(remove_arguments().contains(&RUN_KEY.to_string()));
        assert!(RUN_KEY.starts_with("HKCU"));
    }

    #[test]
    fn the_value_name_is_stable_so_toggling_leaves_nothing_behind() {
        let added = add_arguments(Path::new("k.exe"));
        let removed = remove_arguments();
        let name_of = |args: &[String]| {
            let index = args.iter().position(|value| value == "/v").unwrap();
            args[index + 1].clone()
        };
        assert_eq!(name_of(&added), name_of(&removed));
    }

    /// What `reg query` actually prints, spaces in the path and all.
    #[test]
    fn the_stored_command_is_read_out_of_a_real_reg_query() {
        let output = concat!(
            "\r\n",
            "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n",
            "    KizaLauncher    REG_SZ    ",
            "\"C:\\Users\\a\\AppData\\Local\\Kiza Launcher\\Kiza Launcher.exe\"\r\n\r\n",
        );

        assert_eq!(
            stored_command(output).as_deref(),
            Some("\"C:\\Users\\a\\AppData\\Local\\Kiza Launcher\\Kiza Launcher.exe\"")
        );
    }

    #[test]
    fn an_absent_value_reads_as_nothing_stored() {
        assert_eq!(stored_command("ERROR: The system was unable to find"), None);
    }

    /// The upgrade this exists for: an entry written when the launcher was
    /// still called KizaaMod.exe, on a machine that now runs the new one.
    ///
    /// Nothing rewrote it, so every reboot started the version the user thought
    /// they had replaced — with the new build sitting on disk beside it.
    #[test]
    fn an_entry_left_by_an_older_build_is_repointed() {
        let old = "\"C:\\Users\\a\\AppData\\Local\\Kiza Launcher\\KizaaMod.exe\"";
        let new = startup_command(Path::new(
            r"C:\Users\a\AppData\Local\Kiza Launcher\Kiza Launcher.exe",
        ));

        assert!(needs_refresh(Some(old), &new));
    }

    #[test]
    fn an_entry_that_already_points_here_is_left_alone() {
        let wanted = startup_command(Path::new(r"C:\Kiza\Kiza Launcher.exe"));
        assert!(!needs_refresh(Some(&wanted), &wanted));
        // Windows paths are case-insensitive, and rewriting on every launch
        // over a difference in case would be a registry write per start.
        assert!(!needs_refresh(Some(&wanted.to_uppercase()), &wanted));
    }

    /// Someone who never asked to start with Windows must not be signed up for
    /// it by an upgrade.
    #[test]
    fn an_absent_entry_is_not_created() {
        assert!(!needs_refresh(
            None,
            &startup_command(Path::new(r"C:\Kiza\Kiza Launcher.exe"))
        ));
    }
}
