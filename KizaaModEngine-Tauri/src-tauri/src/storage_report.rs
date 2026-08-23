//! What Kiza is actually using on disk, and what is safe to delete.
//!
//! Every figure here is measured by walking the directories that exist, never
//! estimated. A storage page that guesses is worse than none: it invites the
//! user to free space that was never taken, or leaves them hunting for
//! gigabytes it failed to mention.
//!
//! Worlds, instances and backups are never proposed for deletion. They are the
//! things that cannot be downloaded again.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StorageEntry {
    /// Stable key the interface maps to a label and an icon.
    pub id: String,
    pub bytes: u64,
    /// Whether Kiza offers to delete it.
    pub reclaimable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StorageReport {
    pub entries: Vec<StorageEntry>,
    pub total_bytes: u64,
    /// Sum of everything marked reclaimable.
    pub reclaimable_bytes: u64,
}

/// Bytes held by a directory tree. Missing directories count as zero rather
/// than as an error: not having downloaded any Java yet is not a failure.
pub fn directory_size(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum()
}

/// The directories Kiza owns, and whether each may be deleted.
///
/// The `reclaimable` flag is the whole safety story of this feature, so it
/// lives next to the paths rather than being decided later by the interface.
fn measured_paths(app_data_dir: &Path) -> Vec<(&'static str, PathBuf, bool)> {
    let minecraft = app_data_dir.join("minecraft");
    vec![
        // Instances hold worlds. Never offered.
        ("instances", minecraft.join("instances"), false),
        ("versions", minecraft.join("versions"), false),
        ("libraries", minecraft.join("libraries"), false),
        // Assets are re-downloadable, but deleting them means the next launch
        // fetches gigabytes again, so they are not proposed either.
        ("assets", minecraft.join("assets"), false),
        ("java", minecraft.join("runtimes"), false),
        ("world-backups", app_data_dir.join("world-vault"), false),
        ("restore-points", app_data_dir.join("restore-points"), false),
        // Genuinely disposable.
        ("cache", app_data_dir.join("cache"), true),
        ("downloads", app_data_dir.join("downloads"), true),
        ("logs", app_data_dir.join("logs"), true),
    ]
}

pub fn report(app_data_dir: &Path) -> StorageReport {
    let entries: Vec<StorageEntry> = measured_paths(app_data_dir)
        .into_iter()
        .map(|(id, path, reclaimable)| StorageEntry {
            id: id.to_string(),
            bytes: directory_size(&path),
            reclaimable,
        })
        .collect();

    StorageReport {
        total_bytes: entries.iter().map(|entry| entry.bytes).sum(),
        reclaimable_bytes: entries
            .iter()
            .filter(|entry| entry.reclaimable)
            .map(|entry| entry.bytes)
            .sum(),
        entries,
    }
}

/// Deletes the contents of the reclaimable directories the caller named.
///
/// Only ids marked reclaimable are honoured, whatever is asked for: the list of
/// what may be deleted is decided here, not by whoever calls this.
pub fn reclaim(app_data_dir: &Path, ids: &[String]) -> Result<u64, String> {
    let mut freed = 0u64;

    for (id, path, reclaimable) in measured_paths(app_data_dir) {
        if !reclaimable || !ids.iter().any(|wanted| wanted == id) {
            continue;
        }
        let before = directory_size(&path);
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
                .map_err(|error| format!("Could not clear {id}: {error}"))?;
            // Recreated empty so nothing downstream has to test for its
            // absence on the next run.
            std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        }
        freed += before;
    }

    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn populate(root: &Path) {
        write(&root.join("cache").join("a.tmp"), &[0u8; 1000]);
        write(&root.join("logs").join("latest.log"), &[0u8; 500]);
        write(
            &root
                .join("minecraft")
                .join("instances")
                .join("a")
                .join("level.dat"),
            &[0u8; 2000],
        );
        write(
            &root
                .join("world-vault")
                .join("objects")
                .join("aa")
                .join("x"),
            &[0u8; 300],
        );
    }

    #[test]
    fn every_figure_is_measured_rather_than_estimated() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        populate(root);

        let report = report(root);
        let size_of = |id: &str| {
            report
                .entries
                .iter()
                .find(|entry| entry.id == id)
                .unwrap()
                .bytes
        };

        assert_eq!(size_of("cache"), 1000);
        assert_eq!(size_of("logs"), 500);
        assert_eq!(size_of("instances"), 2000);
        assert_eq!(size_of("world-backups"), 300);
        // A directory that does not exist yet is zero, not an error.
        assert_eq!(size_of("java"), 0);
        assert_eq!(report.total_bytes, 3800);
    }

    #[test]
    fn only_the_disposable_directories_are_offered() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        populate(root);

        let report = report(root);
        // Worlds and instances cannot be downloaded again, so they are never
        // presented as space to free.
        assert_eq!(report.reclaimable_bytes, 1500);
        let offered: Vec<&str> = report
            .entries
            .iter()
            .filter(|entry| entry.reclaimable)
            .map(|entry| entry.id.as_str())
            .collect();
        assert!(offered.contains(&"cache"));
        assert!(offered.contains(&"logs"));
        assert!(!offered.contains(&"instances"));
        assert!(!offered.contains(&"world-backups"));
    }

    #[test]
    fn asking_to_delete_something_protected_deletes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        populate(root);

        // The caller does not get to widen the list.
        let freed = reclaim(
            root,
            &["instances".to_string(), "world-backups".to_string()],
        )
        .unwrap();

        assert_eq!(freed, 0);
        assert!(root
            .join("minecraft")
            .join("instances")
            .join("a")
            .join("level.dat")
            .exists());
        assert!(root
            .join("world-vault")
            .join("objects")
            .join("aa")
            .join("x")
            .exists());
    }

    #[test]
    fn clearing_a_cache_frees_it_and_leaves_the_folder_behind() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        populate(root);

        let freed = reclaim(root, &["cache".to_string()]).unwrap();

        assert_eq!(freed, 1000);
        // Recreated empty, so nothing downstream has to handle its absence.
        assert!(root.join("cache").is_dir());
        assert_eq!(directory_size(&root.join("cache")), 0);
        // Untouched.
        assert_eq!(directory_size(&root.join("logs")), 500);
    }
}
