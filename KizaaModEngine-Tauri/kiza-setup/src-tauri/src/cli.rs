//! The command line Kiza Setup answers to.
//!
//! This is not a free choice. `tauri-plugin-updater` launches whatever
//! installer it downloaded with a fixed line:
//!
//! ```text
//! KizaSetup.exe /P /R /UPDATE /ARGS <the launcher's own arguments>
//! ```
//!
//! so those switches have to mean here what they mean in an NSIS installer, or
//! automatic updates break silently — the worst kind of breakage, because the
//! launcher would go on reporting that the update was applied.
//!
//! `/D=` is honoured for the same reason: it is what every Windows user and
//! every deployment script expects an installer to accept, and NSIS gives it an
//! unusual rule — it takes the *rest of the raw line*, unquoted, so that a path
//! with spaces needs no quoting. That rule is reproduced exactly.

use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presentation {
    /// The window is shown and waits for the user to start the install.
    Interactive,
    /// `/P` — the window is shown but asks nothing: it installs immediately and
    /// closes. This is what an update looks like.
    Passive,
    /// `/S` — no window at all.
    Silent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Install,
    Uninstall,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub mode: Mode,
    pub presentation: Presentation,
    /// `/R` — start the launcher once the files are in place.
    pub restart: bool,
    /// `/UPDATE` — an existing install is being replaced. Nothing may be asked,
    /// and the install location is taken from the previous install rather than
    /// from a default.
    pub update: bool,
    /// `/D=` — where to install.
    pub install_dir: Option<PathBuf>,
    /// Everything after `/ARGS`: the command line to give the launcher when it
    /// is started again.
    pub app_args: Vec<String>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            mode: Mode::Install,
            presentation: Presentation::Interactive,
            restart: false,
            update: false,
            install_dir: None,
            app_args: Vec::new(),
        }
    }
}

impl Options {
    /// True when the install must run without asking the user anything.
    pub fn unattended(&self) -> bool {
        matches!(
            self.presentation,
            Presentation::Passive | Presentation::Silent
        )
    }
}

/// Splits a raw Windows command line the way `CommandLineToArgvW` does.
///
/// The updater escapes the launcher's arguments with the MSVC rules before
/// handing them over, so anything looser than the real algorithm would corrupt
/// a path containing a quote or a trailing backslash on the way through.
///
/// Returns each argument together with the byte offset it started at, because
/// `/D=` needs to reach back into the untouched line.
fn tokenise(line: &str) -> Vec<(usize, String)> {
    let chars: Vec<char> = line.chars().collect();
    // Byte offset of each character, so a token can point back into `line`.
    let mut offsets = Vec::with_capacity(chars.len() + 1);
    let mut offset = 0;
    for character in &chars {
        offsets.push(offset);
        offset += character.len_utf8();
    }
    offsets.push(offset);

    let mut tokens = Vec::new();
    let mut index = 0;

    while index < chars.len() {
        if chars[index].is_whitespace() {
            index += 1;
            continue;
        }

        let start = offsets[index];
        let mut current = String::new();
        let mut in_quotes = false;

        while index < chars.len() {
            if !in_quotes && chars[index].is_whitespace() {
                break;
            }

            if chars[index] == '\\' {
                // Backslashes are only an escape when they run into a quote.
                let mut slashes = 0;
                while index < chars.len() && chars[index] == '\\' {
                    slashes += 1;
                    index += 1;
                }
                if index < chars.len() && chars[index] == '"' {
                    for _ in 0..slashes / 2 {
                        current.push('\\');
                    }
                    if slashes % 2 == 1 {
                        current.push('"');
                        index += 1;
                    } else {
                        in_quotes = !in_quotes;
                        index += 1;
                    }
                } else {
                    for _ in 0..slashes {
                        current.push('\\');
                    }
                }
                continue;
            }

            if chars[index] == '"' {
                in_quotes = !in_quotes;
                index += 1;
                continue;
            }

            current.push(chars[index]);
            index += 1;
        }

        tokens.push((start, current));
    }

    tokens
}

/// Whether a program path names the uninstaller.
///
/// The installer and the uninstaller are the same binary under two names, so
/// without this the copy left in the install folder as
/// `Uninstall Kiza Launcher.exe` would run as an installer — and someone who
/// double-clicked it to remove Kiza would silently reinstall it instead.
///
/// Matched on "uninstall" anywhere in the file name so that the temporary copy,
/// `Kiza Uninstall <pid>.exe`, is recognised too.
fn names_the_uninstaller(program: &str) -> bool {
    std::path::Path::new(program)
        .file_name()
        .map(|name| {
            name.to_string_lossy()
                .to_ascii_lowercase()
                .contains("uninstall")
        })
        .unwrap_or(false)
}

/// Reads the switches out of a raw command line, program name included.
pub fn parse(command_line: &str) -> Options {
    let tokens = tokenise(command_line);
    let mut options = Options::default();

    if let Some((_, program)) = tokens.first() {
        if names_the_uninstaller(program) {
            options.mode = Mode::Uninstall;
        }
    }

    // Skip the program name.
    let mut index = 1;
    while index < tokens.len() {
        let (start, token) = &tokens[index];
        let upper = token.to_ascii_uppercase();

        match upper.as_str() {
            "/S" => options.presentation = Presentation::Silent,
            "/P" => {
                // A line that says both stays at the quieter of the two: /S
                // promises no window, and showing one anyway would break a
                // deployment script that is not watching a screen.
                if options.presentation != Presentation::Silent {
                    options.presentation = Presentation::Passive;
                }
            }
            "/R" => options.restart = true,
            "/UPDATE" => options.update = true,
            // NSIS accepts and ignores it; scripts in the wild pass it.
            "/NCRC" => {}
            "/UNINSTALL" | "--UNINSTALL" => options.mode = Mode::Uninstall,
            "/ARGS" => {
                // Everything left belongs to the launcher, already unescaped
                // by the tokeniser.
                options.app_args = tokens[index + 1..]
                    .iter()
                    .map(|(_, value)| value.clone())
                    .collect();
                break;
            }
            _ => {
                if upper.starts_with("/D=") {
                    let path = if command_line[*start..].starts_with('"') {
                        // The whole switch arrived as one quoted argument. That
                        // is what Rust's own `Command` produces when the path
                        // contains a space — which is how the uninstaller talks
                        // to the copy of itself in the temporary folder. Reading
                        // the raw tail here would keep the closing quote and
                        // start one character late, giving a path that matches
                        // nothing, and a removal that reports success having
                        // deleted nothing.
                        token[..]
                            .get("/D=".len()..)
                            .unwrap_or_default()
                            .trim()
                            .to_string()
                    } else {
                        // NSIS's rule: the rest of the untouched line is the
                        // path, spaces and all, quotes taken literally.
                        command_line[start + "/D=".len()..].trim().to_string()
                    };

                    if !path.is_empty() {
                        options.install_dir = Some(PathBuf::from(path));
                    }
                    break;
                }
            }
        }

        index += 1;
    }

    options
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact line `tauri-plugin-updater` builds for an NSIS installer when
    /// `installMode` is `passive`. If this test ever fails, automatic updates
    /// are broken.
    #[test]
    fn the_updaters_own_command_line_is_understood() {
        let options = parse(r#""C:\Temp\KizaSetup.exe" /P /R /UPDATE /ARGS"#);

        assert_eq!(options.presentation, Presentation::Passive);
        assert!(options.restart);
        assert!(options.update);
        assert!(options.unattended());
        assert!(options.app_args.is_empty());
    }

    #[test]
    fn arguments_meant_for_the_launcher_are_handed_back_unescaped() {
        // What `escape_nsis_current_exe_arg` produces for a kiza:// link and a
        // path with a space: both get quoted, the first because of its slashes.
        let line =
            r#"setup.exe /P /R /UPDATE /ARGS "kiza://join/mc.hypixel.net" "C:\Program Files\x""#;
        let options = parse(line);

        assert_eq!(
            options.app_args,
            vec![
                "kiza://join/mc.hypixel.net".to_string(),
                r"C:\Program Files\x".to_string(),
            ]
        );
    }

    #[test]
    fn a_backslash_before_a_quote_survives_the_round_trip() {
        // MSVC rules: \\" is one literal backslash then a quote delimiter,
        // \" is a literal quote. Getting this wrong corrupts Windows paths.
        let options = parse(r#"setup.exe /ARGS "a\\" "b\"c""#);
        assert_eq!(
            options.app_args,
            vec![r"a\".to_string(), r#"b"c"#.to_string()]
        );
    }

    #[test]
    fn an_install_path_with_spaces_needs_no_quotes() {
        let options = parse(r"setup.exe /S /D=C:\Program Files\Kiza Launcher");

        assert_eq!(options.presentation, Presentation::Silent);
        assert_eq!(
            options.install_dir,
            Some(PathBuf::from(r"C:\Program Files\Kiza Launcher"))
        );
    }

    #[test]
    fn quotes_around_a_d_path_are_part_of_the_path_as_nsis_has_it() {
        // Deliberate: NSIS takes /D= literally, so a user who quotes it gets a
        // folder with quotes in the name. Reproducing the quirk beats inventing
        // a kinder rule that no other installer follows.
        let options = parse(r#"setup.exe /D="C:\Kiza""#);
        assert_eq!(options.install_dir, Some(PathBuf::from(r#""C:\Kiza""#)));
    }

    #[test]
    fn nothing_is_assumed_without_switches() {
        let options = parse(r#""C:\Temp\KizaSetup.exe""#);

        assert_eq!(options.mode, Mode::Install);
        assert_eq!(options.presentation, Presentation::Interactive);
        assert!(!options.restart);
        assert!(!options.update);
        assert!(!options.unattended());
        assert_eq!(options.install_dir, None);
    }

    #[test]
    fn silent_wins_over_passive_whichever_order_they_arrive_in() {
        assert_eq!(parse("s.exe /S /P").presentation, Presentation::Silent);
        assert_eq!(parse("s.exe /P /S").presentation, Presentation::Silent);
    }

    #[test]
    fn switches_are_case_insensitive_like_every_other_windows_installer() {
        let options = parse("setup.exe /p /r /update");
        assert_eq!(options.presentation, Presentation::Passive);
        assert!(options.restart);
        assert!(options.update);
    }

    #[test]
    fn the_uninstaller_is_the_same_binary_under_another_name() {
        assert_eq!(parse("uninstall.exe --uninstall").mode, Mode::Uninstall);
        assert_eq!(parse("uninstall.exe /uninstall /S").mode, Mode::Uninstall);
    }

    /// The bug this test exists for: the copy left in the install folder was
    /// being run with no switch at all, so it started installing. Someone
    /// double-clicking it to remove Kiza would have reinstalled it.
    #[test]
    fn the_uninstaller_knows_itself_by_its_name_alone() {
        let options =
            parse(r#""C:\Users\x\AppData\Local\Kiza Launcher\Uninstall Kiza Launcher.exe" /S"#);

        assert_eq!(options.mode, Mode::Uninstall);
        assert_eq!(options.presentation, Presentation::Silent);
    }

    #[test]
    fn the_temporary_copy_of_the_uninstaller_is_recognised_too() {
        // It is named "Kiza Uninstall 1234.exe", so a prefix match would miss.
        assert_eq!(
            parse(r#""C:\Users\x\AppData\Local\Temp\Kiza Uninstall 4812.exe""#).mode,
            Mode::Uninstall
        );
    }

    #[test]
    fn the_installer_is_not_mistaken_for_the_uninstaller() {
        for program in [
            r#""C:\Downloads\Kiza Launcher_0.0.305_x64-setup.exe""#,
            "KizaSetup.exe",
            r#""C:\Users\x\Desktop\install kiza.exe""#,
        ] {
            assert_eq!(parse(program).mode, Mode::Install, "{program}");
        }
    }

    #[test]
    fn a_switch_after_args_belongs_to_the_launcher_not_to_us() {
        // Otherwise a launcher started with its own /S would silently turn the
        // installer silent on the next update.
        let options = parse("setup.exe /ARGS /S /R");
        assert_eq!(options.presentation, Presentation::Interactive);
        assert!(!options.restart);
        assert_eq!(options.app_args, vec!["/S".to_string(), "/R".to_string()]);
    }
}

#[cfg(test)]
mod install_dir_tests {
    use super::*;

    /// The exact line the uninstaller builds for the copy of itself it leaves
    /// in the temporary folder. `std::process::Command` quotes any argument
    /// holding a space, so the whole switch arrives wrapped.
    ///
    /// This is the line that made a silent uninstall remove the shortcuts and
    /// the registry entry and then leave every file on disk, reporting success.
    #[test]
    fn a_quoted_switch_yields_the_path_and_not_the_quoting_around_it() {
        let line = concat!(
            r#""C:\Users\nefer\AppData\Local\Temp\Kiza Uninstall 28408.exe" "#,
            r#"--uninstall /S "/D=C:\Users\nefer\AppData\Local\Kiza Launcher""#
        );

        let options = parse(line);

        assert_eq!(
            options.install_dir,
            Some(PathBuf::from(r"C:\Users\nefer\AppData\Local\Kiza Launcher"))
        );
        assert_eq!(options.mode, Mode::Uninstall);
        assert_eq!(options.presentation, Presentation::Silent);
    }

    #[test]
    fn an_unquoted_switch_still_follows_the_nsis_rest_of_line_rule() {
        let options = parse(r"setup.exe /S /D=C:\Program Files\Kiza Launcher");
        assert_eq!(
            options.install_dir,
            Some(PathBuf::from(r"C:\Program Files\Kiza Launcher"))
        );
    }

    #[test]
    fn a_quoted_switch_with_no_path_after_it_sets_nothing() {
        assert_eq!(parse(r#"setup.exe "/D=""#).install_dir, None);
        assert_eq!(parse("setup.exe /D=").install_dir, None);
    }
}
