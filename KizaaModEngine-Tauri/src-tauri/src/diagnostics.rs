//! Log housekeeping and the diagnostic report.
//!
//! Two jobs that belong together because they share one folder. Kiza writes a
//! log for every session and never used to delete one, so a launcher opened
//! daily for a year kept a year of them. And when something goes wrong, the
//! first thing anyone helping is going to ask for is a file they can read —
//! which, until now, meant asking the user to find a folder and pick out the
//! right lines.
//!
//! Everything here takes the directory as an argument rather than reaching for
//! the real one, so the tests run against a temporary folder and can never
//! delete a log someone still needs.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

/// What the logs folder currently holds.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct LogsOverview {
    pub files: u32,
    pub bytes: u64,
    /// Age of the oldest file, in whole days. `None` when the folder is empty.
    pub oldest_days: Option<u32>,
}

/// What a prune actually removed.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct Pruned {
    pub files: u32,
    pub bytes: u64,
}

/// Every plain file directly inside `dir`, with its size and age in days.
///
/// Sub-directories are ignored rather than walked: the logs folder is flat, and
/// a recursive delete here would be one refactor away from removing something
/// that is not a log at all.
fn entries(dir: &Path, now: SystemTime) -> Vec<(PathBuf, u64, u32)> {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(_) => return Vec::new(),
    };

    let mut found = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }

        // A file whose timestamp cannot be read, or that claims to be from the
        // future, counts as brand new. Guessing old would delete it.
        let age_days = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| (age.as_secs() / 86_400) as u32)
            .unwrap_or(0);

        found.push((path, metadata.len(), age_days));
    }
    found
}

pub fn overview(dir: &Path) -> LogsOverview {
    let found = entries(dir, SystemTime::now());
    LogsOverview {
        files: found.len() as u32,
        bytes: found.iter().map(|(_, size, _)| size).sum(),
        oldest_days: found.iter().map(|(_, _, age)| *age).max(),
    }
}

/// Deletes log files older than `keep_days`, and reports what went.
///
/// `keep_days == 0` means "keep everything" and removes nothing: the setting
/// offers a retention period, and zero is how "never delete" is spelled. A
/// zero that meant "delete all of it" would turn the mildest-looking value in
/// the dropdown into the most destructive one.
///
/// The file Kiza is writing right now is never a candidate — it is today's, so
/// its age is zero for any retention period worth offering.
pub fn prune(dir: &Path, keep_days: u32) -> Pruned {
    if keep_days == 0 {
        return Pruned::default();
    }

    let mut pruned = Pruned::default();
    for (path, size, age_days) in entries(dir, SystemTime::now()) {
        if age_days <= keep_days {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            pruned.files += 1;
            pruned.bytes += size;
        }
    }
    pruned
}

/// The facts a diagnostic report is built from.
///
/// Collected by the caller and handed over as data so that rendering can be
/// tested without a running launcher, and so that it is obvious at a glance
/// what leaves the machine.
pub struct Facts {
    pub version: String,
    pub channel: String,
    pub os: String,
    pub arch: String,
    pub app_data_dir: PathBuf,
    pub logs: LogsOverview,
    pub storage_total_bytes: u64,
    pub instances: usize,
    pub java_path: Option<String>,
    /// Service name and, when it answered, how long it took.
    pub services: Vec<(String, Option<u64>)>,
    pub recent_log: Option<String>,
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
}

/// The report, as plain text.
///
/// Plain text rather than JSON or a zip because of who reads it: someone
/// pasting it into a Discord message. A format that needs opening is a format
/// that does not get sent.
///
/// No account name, no e-mail, no access token, and paths only as far as the
/// Kiza folder itself. Someone posting this in a public channel should not be
/// handing over anything they would not have said out loud.
pub fn render(facts: &Facts) -> String {
    let mut out = String::new();

    out.push_str("Kiza Launcher — diagnostic report\n");
    out.push_str("=================================\n\n");

    out.push_str(&format!(
        "Version      {} ({})\n",
        facts.version, facts.channel
    ));
    out.push_str(&format!("System       {} {}\n", facts.os, facts.arch));
    out.push_str(&format!(
        "Java         {}\n",
        facts.java_path.as_deref().unwrap_or("managed by Kiza")
    ));
    out.push_str(&format!("Instances    {}\n", facts.instances));
    out.push_str(&format!(
        "Kiza folder  {} ({})\n",
        facts
            .app_data_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        megabytes(facts.storage_total_bytes)
    ));
    out.push_str(&format!(
        "Logs         {} files, {}{}\n",
        facts.logs.files,
        megabytes(facts.logs.bytes),
        match facts.logs.oldest_days {
            Some(days) => format!(", oldest {days} days"),
            None => String::new(),
        }
    ));

    out.push_str("\nServices\n--------\n");
    if facts.services.is_empty() {
        out.push_str("  not checked\n");
    }
    for (name, latency) in &facts.services {
        match latency {
            Some(ms) => out.push_str(&format!("  {name:<14} reachable, {ms} ms\n")),
            None => out.push_str(&format!("  {name:<14} no answer\n")),
        }
    }

    if let Some(log) = &facts.recent_log {
        out.push_str("\nEnd of the most recent log\n--------------------------\n");
        out.push_str(log);
        if !log.ends_with('\n') {
            out.push('\n');
        }
    }

    out.push_str("\nThis report contains no account name, e-mail or token.\n");
    out
}

/// The last `lines` lines of the most recently written file in `dir`.
///
/// Capped, because the point is the tail where the failure is, and a report
/// nobody can scroll through is a report nobody reads.
pub fn tail_of_newest(dir: &Path, lines: usize) -> Option<String> {
    // Compared on the timestamp itself rather than on the age in days that
    // `entries` reports: a launcher opened three times today writes three logs
    // that are all nought days old, and the interesting one is the last.
    let newest = entries(dir, SystemTime::now())
        .into_iter()
        .filter(|(path, _, _)| {
            path.extension()
                .map(|ext| ext.eq_ignore_ascii_case("log") || ext.eq_ignore_ascii_case("txt"))
                .unwrap_or(false)
        })
        .filter_map(|(path, _, _)| {
            let modified = fs::metadata(&path).ok()?.modified().ok()?;
            Some((path, modified))
        })
        .max_by_key(|(_, modified)| *modified)?;

    let content = fs::read_to_string(&newest.0).ok()?;
    let collected: Vec<&str> = content.lines().collect();
    let start = collected.len().saturating_sub(lines);
    Some(collected[start..].join("\n"))
}

/// Where a written report goes, named so two of them never collide.
pub fn report_path(dir: &Path, now: SystemTime) -> PathBuf {
    let stamp = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs();
    dir.join(format!("kiza-diagnostic-{stamp}.txt"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    fn temp_dir() -> TempDir {
        TempDir::new().unwrap()
    }

    /// Writes a file and backdates it, so the age rules can be tested without
    /// a test that has to wait a week to mean anything.
    fn write_aged(dir: &Path, name: &str, size: usize, days_old: u64) {
        let path = dir.join(name);
        let mut file = File::create(&path).unwrap();
        file.write_all(&vec![b'x'; size]).unwrap();

        // The extra minute keeps a file written "0 days ago" from rounding
        // into the previous day on a slow machine.
        let when = SystemTime::now() - Duration::from_secs(days_old * 86_400 + 60);
        file.set_modified(when).unwrap();
    }

    fn backdate(path: &Path, days: u64) {
        let file = File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(days * 86_400 + 60))
            .unwrap();
    }

    #[test]
    fn an_empty_folder_reports_nothing_rather_than_failing() {
        let dir = temp_dir();
        assert_eq!(overview(dir.path()), LogsOverview::default());
    }

    #[test]
    fn a_folder_that_does_not_exist_is_not_an_error() {
        // The logs folder is created on first write, so a launcher that has
        // never logged has no folder at all.
        let dir = temp_dir();
        assert_eq!(overview(&dir.path().join("nope")).files, 0);
    }

    #[test]
    fn the_overview_counts_files_bytes_and_the_oldest() {
        let dir = temp_dir();
        write_aged(dir.path(), "a.log", 100, 0);
        write_aged(dir.path(), "b.log", 250, 12);

        let overview = overview(dir.path());
        assert_eq!(overview.files, 2);
        assert_eq!(overview.bytes, 350);
        assert_eq!(overview.oldest_days, Some(12));
    }

    #[test]
    fn sub_directories_are_left_alone() {
        let dir = temp_dir();
        let nested = dir.path().join("crash-reports");
        fs::create_dir_all(&nested).unwrap();
        write_aged(&nested, "old.log", 900, 400);
        write_aged(dir.path(), "today.log", 10, 0);

        assert_eq!(overview(dir.path()).files, 1);
        // And a prune must not reach into it either.
        prune(dir.path(), 7);
        assert!(nested.join("old.log").exists());
    }

    #[test]
    fn pruning_removes_only_what_is_older_than_the_period() {
        let dir = temp_dir();
        write_aged(dir.path(), "today.log", 10, 0);
        write_aged(dir.path(), "week.log", 20, 6);
        write_aged(dir.path(), "month.log", 30, 40);

        let pruned = prune(dir.path(), 7);
        assert_eq!(pruned.files, 1);
        assert_eq!(pruned.bytes, 30);
        assert!(dir.path().join("today.log").exists());
        assert!(dir.path().join("week.log").exists());
        assert!(!dir.path().join("month.log").exists());
    }

    #[test]
    fn a_file_exactly_at_the_boundary_is_kept() {
        // "Keep 7 days" has to keep the file from seven days ago, or the
        // dropdown means something one day shorter than it says.
        let dir = temp_dir();
        write_aged(dir.path(), "seven.log", 10, 7);
        assert_eq!(prune(dir.path(), 7).files, 0);
        assert!(dir.path().join("seven.log").exists());
    }

    #[test]
    fn zero_days_keeps_everything() {
        // Zero is how the interface spells "never delete". Reading it as
        // "delete everything" would make the safest-looking choice the one
        // that wipes the folder.
        let dir = temp_dir();
        write_aged(dir.path(), "ancient.log", 10, 3_000);

        assert_eq!(prune(dir.path(), 0), Pruned::default());
        assert!(dir.path().join("ancient.log").exists());
    }

    #[test]
    fn the_tail_takes_the_end_of_the_newest_log() {
        let dir = temp_dir();
        let old = dir.path().join("old.log");
        fs::write(
            &old, "one
two
",
        )
        .unwrap();
        backdate(&old, 3);
        fs::write(
            dir.path().join("new.log"),
            "alpha
beta
gamma
",
        )
        .unwrap();

        assert_eq!(
            tail_of_newest(dir.path(), 2).unwrap(),
            "beta
gamma"
        );
    }

    #[test]
    fn the_report_never_carries_an_account_or_a_token() {
        let facts = Facts {
            version: "0.0.308".into(),
            channel: "stable".into(),
            os: "Windows 11".into(),
            arch: "x86_64".into(),
            app_data_dir: PathBuf::from(r"C:\Users\someone\AppData\Roaming\Kiza"),
            logs: LogsOverview {
                files: 3,
                bytes: 2048,
                oldest_days: Some(9),
            },
            storage_total_bytes: 1024 * 1024 * 1024,
            instances: 4,
            java_path: None,
            services: vec![("Modrinth".into(), Some(128)), ("CurseForge".into(), None)],
            recent_log: Some("something went wrong".into()),
        };

        let text = render(&facts);
        // The home directory is the usual way a username escapes in a report
        // someone pastes into a public channel.
        assert!(!text.contains("someone"));
        assert!(text.contains("Kiza"));
        assert!(text.contains("0.0.308"));
        assert!(text.contains("128 ms"));
        assert!(text.contains("no answer"));
        assert!(text.contains("something went wrong"));
    }

    #[test]
    fn two_reports_written_in_the_same_session_do_not_collide() {
        let dir = temp_dir();
        let first = report_path(
            dir.path(),
            SystemTime::UNIX_EPOCH + Duration::from_secs(1_000),
        );
        let second = report_path(
            dir.path(),
            SystemTime::UNIX_EPOCH + Duration::from_secs(2_000),
        );
        assert_ne!(first, second);
    }
}
