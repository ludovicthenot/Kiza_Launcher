//! What this machine is, and how much room is left on it.
//!
//! Two readings the About and Storage pages want and had no way to get: the
//! system Kiza is running on, and the free space on the drive it is installed
//! to. A storage page that shows what Kiza occupies without showing what is
//! left tells only half the story — 18 GB is nothing on a 2 TB drive and a
//! crisis on a nearly full one.
//!
//! The install identifier lives here too. It is not a user identifier: it is
//! random, generated on this machine, tied to no account, and exists so that
//! two diagnostic reports sent a week apart can be recognised as the same
//! installation.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct DiskSpace {
    /// The drive as the operating system names it, e.g. "C:\\".
    pub mount: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemReport {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub cpu: String,
    pub cores: usize,
    pub total_ram_mb: u64,
    /// `None` when the drive holding the Kiza folder could not be identified.
    pub disk: Option<DiskSpace>,
    pub install_id: String,
}

/// Picks, from `candidates`, the mount point that holds `path`.
///
/// The longest matching prefix wins. On a machine where D:\ is mounted inside
/// C:\games, both match, and the answer that is useful is the more specific
/// one — the drive that actually fills up.
///
/// Taken as a list rather than read from the system so this can be tested,
/// which matters more than it looks: getting it wrong shows free space from
/// the wrong drive, and nothing about that reading looks wrong.
pub fn disk_for<'a>(
    path: &Path,
    candidates: &'a [(PathBuf, u64, u64)],
) -> Option<&'a (PathBuf, u64, u64)> {
    candidates
        .iter()
        .filter(|(mount, _, _)| starts_with_ignoring_case(path, mount))
        .max_by_key(|(mount, _, _)| mount.as_os_str().len())
}

/// Windows path comparison: `C:\Users` and `c:\users` are the same place.
fn starts_with_ignoring_case(path: &Path, prefix: &Path) -> bool {
    let path = path.to_string_lossy().to_lowercase().replace('/', "\\");
    let prefix = prefix.to_string_lossy().to_lowercase().replace('/', "\\");
    // A drive root already ends in a separator; anything else needs one added,
    // or "C:\game" would be read as living inside "C:\games".
    let prefix = if prefix.ends_with('\\') {
        prefix
    } else {
        format!("{prefix}\\")
    };
    let path = if path.ends_with('\\') {
        path
    } else {
        format!("{path}\\")
    };
    path.starts_with(&prefix)
}

/// The random identifier for this installation, created on first read.
///
/// Sixteen bytes from the system clock and the process id, which is enough to
/// separate two installations and carries nothing about the person using
/// either. It is deliberately not derived from the machine name, the account,
/// the disk serial or anything else that could identify someone.
pub fn install_id(app_data_dir: &Path) -> String {
    let path = app_data_dir.join("config").join("install-id");

    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if trimmed.len() == 32 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            return trimmed;
        }
    }

    let generated = generate_id();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // A failed write means a new identifier next time, which is worse than a
    // stable one and better than refusing to show the page.
    let _ = fs::write(&path, &generated);
    generated
}

fn generate_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = u128::from(std::process::id());
    let mixed = now
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(pid.wrapping_mul(0xBF58_476D_1CE4_E5B9));
    format!("{:032x}", mixed)
}

/// The last four characters, which is what the interface shows.
///
/// Enough for someone to confirm two reports came from the same install
/// without printing an identifier in full on a screen that gets shared.
pub fn short_id(id: &str) -> String {
    let tail: String = id
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    tail.to_uppercase()
}

pub fn collect(app_data_dir: &Path) -> SystemReport {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.refresh_cpu_all();

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let candidates: Vec<(PathBuf, u64, u64)> = disks
        .list()
        .iter()
        .map(|disk| {
            (
                disk.mount_point().to_path_buf(),
                disk.total_space(),
                disk.available_space(),
            )
        })
        .collect();

    let disk = disk_for(app_data_dir, &candidates).map(|(mount, total, free)| DiskSpace {
        mount: mount.to_string_lossy().to_string(),
        total_bytes: *total,
        free_bytes: *free,
    });

    SystemReport {
        os: sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
        os_version: sysinfo::System::os_version().unwrap_or_default(),
        arch: std::env::consts::ARCH.to_string(),
        cpu: system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .unwrap_or_default(),
        cores: system.cpus().len(),
        total_ram_mb: system.total_memory() / (1024 * 1024),
        disk,
        install_id: install_id(app_data_dir),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn candidates() -> Vec<(PathBuf, u64, u64)> {
        vec![
            (PathBuf::from(r"C:\"), 500_000_000_000, 120_000_000_000),
            (PathBuf::from(r"D:\"), 2_000_000_000_000, 1_500_000_000_000),
            (PathBuf::from(r"C:\games"), 900_000_000_000, 400_000_000_000),
        ]
    }

    #[test]
    fn finds_the_drive_a_path_lives_on() {
        let disks = candidates();
        let found = disk_for(Path::new(r"C:\Users\someone\AppData\Kiza"), &disks).unwrap();
        assert_eq!(found.0, PathBuf::from(r"C:\"));
    }

    #[test]
    fn prefers_the_more_specific_mount() {
        // A second drive mounted inside the first. The one that fills up is
        // the inner one, so that is the reading worth showing.
        let disks = candidates();
        let found = disk_for(Path::new(r"C:\games\Kiza\instances"), &disks).unwrap();
        assert_eq!(found.0, PathBuf::from(r"C:\games"));
    }

    #[test]
    fn does_not_confuse_a_prefix_with_a_folder_name() {
        // "C:\game" is not inside "C:\games", however alike they read.
        let mounts = vec![(PathBuf::from(r"C:\games"), 1, 1)];
        assert!(disk_for(Path::new(r"C:\game\thing"), &mounts).is_none());
    }

    #[test]
    fn ignores_case_and_separator_style() {
        let disks = candidates();
        assert!(disk_for(Path::new(r"c:/users/someone"), &disks).is_some());
    }

    #[test]
    fn reports_nothing_rather_than_guessing_when_no_drive_matches() {
        let disks = candidates();
        assert!(disk_for(Path::new(r"Z:\somewhere"), &disks).is_none());
    }

    #[test]
    fn the_install_id_survives_a_restart() {
        let dir = TempDir::new().unwrap();
        let first = install_id(dir.path());
        let second = install_id(dir.path());
        assert_eq!(first, second);
        assert_eq!(first.len(), 32);
    }

    #[test]
    fn two_installations_get_different_identifiers() {
        let one = TempDir::new().unwrap();
        let two = TempDir::new().unwrap();
        assert_ne!(install_id(one.path()), install_id(two.path()));
    }

    #[test]
    fn a_corrupted_identifier_is_replaced_rather_than_shown() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config").join("install-id");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "not an identifier").unwrap();

        let id = install_id(dir.path());
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn the_short_form_is_the_last_four_characters() {
        assert_eq!(short_id("0123456789abcdef0123456789ab8f2a"), "8F2A");
    }
}
