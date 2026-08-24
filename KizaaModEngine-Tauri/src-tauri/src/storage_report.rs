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

/// Deletes cached files that have not been touched for `keep_days`.
///
/// Different from `reclaim`, which empties the cache outright: this is the
/// automatic housekeeping, so it has to leave alone anything still in use.
/// Modification time is the only signal available, and a cache entry that was
/// written last week and read every day since would be removed by an age rule
/// — which is fine, because the whole point of a cache is that losing it costs
/// a re-fetch and nothing else.
///
/// `keep_days == 0` keeps everything, matching how the logs retention reads.
/// Empty directories left behind are removed too, so the folder does not fill
/// with the skeleton of what used to be there.
pub fn prune_cache(app_data_dir: &Path, keep_days: u32) -> u64 {
    if keep_days == 0 {
        return 0;
    }
    let cache = app_data_dir.join("cache");
    if !cache.is_dir() {
        return 0;
    }
    let cutoff = std::time::Duration::from_secs(u64::from(keep_days) * 86_400);
    prune_tree(&cache, cutoff, std::time::SystemTime::now())
}

fn prune_tree(dir: &Path, cutoff: std::time::Duration, now: std::time::SystemTime) -> u64 {
    let Ok(read) = std::fs::read_dir(dir) else {
        return 0;
    };

    let mut freed = 0u64;
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            freed += prune_tree(&path, cutoff, now);
            // Only if it emptied. A directory that still holds something is
            // left exactly as it is.
            if std::fs::read_dir(&path)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false)
            {
                let _ = std::fs::remove_dir(&path);
            }
            continue;
        }

        // A file whose timestamp cannot be read counts as new. Guessing old
        // would delete it.
        let stale = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age > cutoff)
            .unwrap_or(false);

        if stale && std::fs::remove_file(&path).is_ok() {
            freed += metadata.len();
        }
    }
    freed
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

    /// Writes a file and backdates it, so an age rule can be tested without a
    /// test that has to wait a fortnight to mean anything.
    fn write_aged(path: &Path, size: usize, days_old: u64) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = fs::File::create(path).unwrap();
        use std::io::Write;
        (&file).write_all(&vec![0u8; size]).unwrap();
        file.set_modified(
            std::time::SystemTime::now() - std::time::Duration::from_secs(days_old * 86_400 + 60),
        )
        .unwrap();
    }

    #[test]
    fn cache_pruning_removes_only_what_is_stale() {
        let dir = tempfile::TempDir::new().unwrap();
        let cache = dir.path().join("cache");
        write_aged(&cache.join("fresh.json"), 100, 1);
        write_aged(&cache.join("old.json"), 250, 40);

        assert_eq!(prune_cache(dir.path(), 30), 250);
        assert!(cache.join("fresh.json").exists());
        assert!(!cache.join("old.json").exists());
    }

    #[test]
    fn cache_pruning_reaches_into_sub_folders() {
        // Unlike the logs folder, the cache is a tree: thumbnails and version
        // manifests each get their own directory.
        let dir = tempfile::TempDir::new().unwrap();
        let nested = dir.path().join("cache").join("thumbnails").join("modrinth");
        write_aged(&nested.join("old.png"), 500, 90);

        assert_eq!(prune_cache(dir.path(), 30), 500);
        assert!(!nested.join("old.png").exists());
        // And the emptied folders go with it.
        assert!(!nested.exists());
    }

    #[test]
    fn a_sub_folder_that_still_holds_something_is_left_alone() {
        let dir = tempfile::TempDir::new().unwrap();
        let nested = dir.path().join("cache").join("versions");
        write_aged(&nested.join("old.json"), 100, 90);
        write_aged(&nested.join("current.json"), 100, 1);

        prune_cache(dir.path(), 30);
        assert!(nested.is_dir());
        assert!(nested.join("current.json").exists());
    }

    #[test]
    fn zero_days_keeps_the_whole_cache() {
        let dir = tempfile::TempDir::new().unwrap();
        write_aged(&dir.path().join("cache").join("ancient.json"), 100, 3_000);

        assert_eq!(prune_cache(dir.path(), 0), 0);
        assert!(dir.path().join("cache").join("ancient.json").exists());
    }

    #[test]
    fn a_missing_cache_folder_is_not_an_error() {
        let dir = tempfile::TempDir::new().unwrap();
        assert_eq!(prune_cache(dir.path(), 30), 0);
    }
}
