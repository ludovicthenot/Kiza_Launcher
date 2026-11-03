//! The launcher's own voice in the logs.
//!
//! Three things write lines that a person reads together: the launcher, the
//! Kiza client inside the game, and the game itself. They looked the same.
//! `[INFO] [Import]` could have been any of them, and a line with no prefix
//! at all was whichever one you assumed. Now every line the launcher writes
//! says `Kiza Launcher`, every line the client writes says `Kiza Client`,
//! and the game keeps its own voice -- so a log reads as a conversation
//! between three parties rather than one long monologue.
//!
//! The launcher's lines go to `logs/launcher.log` beside the auth log, as
//! well as to the console a developer is watching. The file turns over at
//! a few megabytes; the previous one is kept once.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Who is talking, as the line says it.
pub const LAUNCHER: &str = "Kiza Launcher";
pub const CLIENT: &str = "Kiza Client";

const FILE_NAME: &str = "launcher.log";
const ROLLED_NAME: &str = "launcher-1.log";
const ROLL_AT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn word(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

static FILE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<PathBuf>> {
    FILE.get_or_init(|| Mutex::new(None))
}

/// Points the logger at `logs/launcher.log` under the app data folder.
/// Before this is called, lines go to the console only.
pub fn init(app_data_dir: &Path) {
    let dir = app_data_dir.join("logs");
    let _ = fs::create_dir_all(&dir);
    if let Ok(mut path) = slot().lock() {
        *path = Some(dir.join(FILE_NAME));
    }
    write(
        Level::Info,
        "Launcher",
        &format!("Kiza Launcher {} starting.", env!("CARGO_PKG_VERSION")),
    );
}

/// One line, as the launcher: `[time] [Kiza Launcher/LEVEL] [Area]: message`.
pub fn write(level: Level, area: &str, message: &str) {
    let line = format_line(
        &chrono::Local::now().format("%H:%M:%S").to_string(),
        level,
        area,
        message,
    );
    match level {
        Level::Error => eprintln!("{line}"),
        _ => println!("{line}"),
    }
    let Ok(guard) = slot().lock() else {
        return;
    };
    let Some(path) = guard.as_ref() else {
        return;
    };
    roll_if_large(path);
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

pub(crate) fn format_line(time: &str, level: Level, area: &str, message: &str) -> String {
    format!("[{time}] [{LAUNCHER}/{}] [{area}]: {message}", level.word())
}

fn roll_if_large(path: &Path) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() < ROLL_AT_BYTES {
        return;
    }
    let rolled = path.with_file_name(ROLLED_NAME);
    let _ = fs::remove_file(&rolled);
    let _ = fs::rename(path, rolled);
}

/// `info!("Import", "{done}/{total} {name}")` and the same for warn and error.
#[macro_export]
macro_rules! log_info {
    ($area:expr, $($arg:tt)*) => {
        $crate::launcher_log::write($crate::launcher_log::Level::Info, $area, &format!($($arg)*))
    };
}
#[macro_export]
macro_rules! log_warn {
    ($area:expr, $($arg:tt)*) => {
        $crate::launcher_log::write($crate::launcher_log::Level::Warn, $area, &format!($($arg)*))
    };
}
#[macro_export]
macro_rules! log_error {
    ($area:expr, $($arg:tt)*) => {
        $crate::launcher_log::write($crate::launcher_log::Level::Error, $area, &format!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The line names the launcher, its level and its area, every time.
    #[test]
    fn a_line_says_who_is_talking() {
        assert_eq!(
            format_line(
                "12:00:01",
                Level::Warn,
                "Launch",
                "natives folder was empty"
            ),
            "[12:00:01] [Kiza Launcher/WARN] [Launch]: natives folder was empty"
        );
        assert_eq!(
            format_line("12:00:01", Level::Error, "Import", "x"),
            "[12:00:01] [Kiza Launcher/ERROR] [Import]: x"
        );
    }

    /// A large file is rolled over once, not lost.
    #[test]
    fn a_large_file_rolls_over() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(FILE_NAME);
        fs::write(&path, vec![b'x'; ROLL_AT_BYTES as usize + 1]).unwrap();
        roll_if_large(&path);
        assert!(!path.exists());
        assert!(temp.path().join(ROLLED_NAME).exists());
        // Small: left alone.
        fs::write(&path, b"small").unwrap();
        roll_if_large(&path);
        assert!(path.exists());
    }
}
