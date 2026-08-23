//! Instance restore points: everything that makes an instance *an instance*,
//! captured before a risky change so it can be put back.
//!
//! Worlds are deliberately not here. A snapshot must stay small enough to take
//! on every mod change, and a single world can outweigh the whole rest of the
//! instance. Saves belong to the World Vault; a snapshot only remembers which
//! world checkpoint it was taken alongside, via `world_checkpoint_id`.
//!
//! Files are content-addressed: a mod that did not change between two restore
//! points is stored once. Twenty snapshots of a 300 MB modpack cost 300 MB plus
//! whatever actually changed.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// What an instance is made of, worlds excluded.
const CAPTURED_DIRS: [&str; 4] = ["mods", "resourcepacks", "shaderpacks", "config"];
const CAPTURED_FILES: [&str; 2] = ["options.txt", "servers.dat"];
// Capture works by allowlist, so saves, logs, crash-reports and screenshots
// are excluded by simply not being named above. Worlds belong to the World
// Vault; the rest would grow every snapshot for nothing.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotEntry {
    /// Path relative to the instance's game directory, with forward slashes.
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestorePoint {
    pub id: String,
    pub instance_id: String,
    pub created_at: String,
    /// Why it was taken, e.g. "Before updating 4 mods".
    pub reason: String,
    pub entries: Vec<SnapshotEntry>,
    /// Set when the World Vault took a checkpoint at the same moment, so the
    /// user can restore "instance only" or "instance and its worlds".
    pub world_checkpoint_id: Option<String>,
    /// Sum of the captured files, before deduplication.
    pub total_bytes: u64,
}

fn root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("restore-points")
}

fn objects_dir(app_data_dir: &Path) -> PathBuf {
    root(app_data_dir).join("objects")
}

fn index_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    root(app_data_dir).join(instance_id).join("index.json")
}

fn object_path(app_data_dir: &Path, sha256: &str) -> PathBuf {
    // Two-character shard so one directory never holds tens of thousands
    // of files, which Windows handles poorly.
    objects_dir(app_data_dir).join(&sha256[..2]).join(sha256)
}

pub fn list(app_data_dir: &Path, instance_id: &str) -> Vec<RestorePoint> {
    fs::read_to_string(index_path(app_data_dir, instance_id))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<RestorePoint>>(&raw).ok())
        .unwrap_or_default()
}

fn save_index(
    app_data_dir: &Path,
    instance_id: &str,
    points: &[RestorePoint],
) -> Result<(), String> {
    let path = index_path(app_data_dir, instance_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the restore point directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(points).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| format!("Could not save restore points: {error}"))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Every capturable file under the game directory, as relative paths.
fn capturable_files(game_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for name in CAPTURED_FILES {
        if game_dir.join(name).is_file() {
            files.push(PathBuf::from(name));
        }
    }

    for directory in CAPTURED_DIRS {
        let base = game_dir.join(directory);
        if !base.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&base)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            if let Ok(relative) = entry.path().strip_prefix(game_dir) {
                files.push(relative.to_path_buf());
            }
        }
    }

    files
}

fn to_slash(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// Describes the instance as it is right now, without storing anything.
///
/// This is what the Lockfile exports and compares against: the same view of an
/// instance a restore point captures, minus the copying. Taking a snapshot just
/// to read its file list would write a few hundred megabytes to answer a
/// question.
pub fn inspect(game_dir: &Path) -> Vec<SnapshotEntry> {
    let mut entries: Vec<SnapshotEntry> = capturable_files(game_dir)
        .into_iter()
        .filter_map(|relative| {
            let bytes = fs::read(game_dir.join(&relative)).ok()?;
            Some(SnapshotEntry {
                path: to_slash(&relative),
                sha256: hash_bytes(&bytes),
                size: bytes.len() as u64,
            })
        })
        .collect();
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    entries
}

/// Captures the instance as it is right now.
pub fn create(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    reason: &str,
    world_checkpoint_id: Option<String>,
) -> Result<RestorePoint, String> {
    let mut entries = Vec::new();
    let mut total_bytes = 0u64;

    for relative in capturable_files(game_dir) {
        let absolute = game_dir.join(&relative);
        let bytes = match fs::read(&absolute) {
            Ok(bytes) => bytes,
            // A file that vanished mid-capture is not worth failing over.
            Err(_) => continue,
        };
        let sha256 = hash_bytes(&bytes);
        let destination = object_path(app_data_dir, &sha256);
        // Content-addressed: an unchanged mod is already stored.
        if !destination.exists() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create the object store: {error}"))?;
            }
            fs::write(&destination, &bytes)
                .map_err(|error| format!("Could not store {}: {error}", to_slash(&relative)))?;
        }

        total_bytes += bytes.len() as u64;
        entries.push(SnapshotEntry {
            path: to_slash(&relative),
            sha256,
            size: bytes.len() as u64,
        });
    }

    entries.sort_by(|left, right| left.path.cmp(&right.path));

    let point = RestorePoint {
        id: Uuid::new_v4().simple().to_string(),
        instance_id: instance_id.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        reason: reason.to_string(),
        entries,
        world_checkpoint_id,
        total_bytes,
    };

    let mut points = list(app_data_dir, instance_id);
    points.insert(0, point.clone());
    save_index(app_data_dir, instance_id, &points)?;
    Ok(point)
}

/// Puts the instance back to a restore point: missing files return, files added
/// since are removed. Worlds are never touched.
pub fn restore(
    app_data_dir: &Path,
    instance_id: &str,
    point_id: &str,
    game_dir: &Path,
) -> Result<u64, String> {
    let point = list(app_data_dir, instance_id)
        .into_iter()
        .find(|point| point.id == point_id)
        .ok_or_else(|| "That restore point no longer exists.".to_string())?;

    let wanted: HashSet<&str> = point
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();

    // Remove what was added after the snapshot, inside captured areas only.
    for relative in capturable_files(game_dir) {
        let key = to_slash(&relative);
        if !wanted.contains(key.as_str()) {
            let _ = fs::remove_file(game_dir.join(&relative));
        }
    }

    let mut restored = 0u64;
    for entry in &point.entries {
        let source = object_path(app_data_dir, &entry.sha256);
        let bytes = fs::read(&source)
            .map_err(|error| format!("The stored copy of {} is missing: {error}", entry.path))?;
        let destination = game_dir.join(entry.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&destination, &bytes)
            .map_err(|error| format!("Could not restore {}: {error}", entry.path))?;
        restored += 1;
    }

    Ok(restored)
}

/// Keeps the newest `keep` restore points and drops the rest, then removes any
/// stored file no surviving point refers to.
pub fn prune(app_data_dir: &Path, instance_id: &str, keep: usize) -> Result<usize, String> {
    let mut points = list(app_data_dir, instance_id);
    let removed = points.len().saturating_sub(keep);
    points.truncate(keep);
    save_index(app_data_dir, instance_id, &points)?;
    collect_garbage(app_data_dir)?;
    Ok(removed)
}

/// Deletes stored files that no restore point of any instance refers to.
/// Instance snapshots and World Vault backups are cleaned independently.
pub fn collect_garbage(app_data_dir: &Path) -> Result<u64, String> {
    let mut referenced: HashSet<String> = HashSet::new();
    let base = root(app_data_dir);
    if let Ok(entries) = fs::read_dir(&base) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() || entry.file_name() == "objects" {
                continue;
            }
            let instance_id = entry.file_name().to_string_lossy().to_string();
            for point in list(app_data_dir, &instance_id) {
                for snapshot_entry in point.entries {
                    referenced.insert(snapshot_entry.sha256);
                }
            }
        }
    }

    let mut freed = 0u64;
    for entry in walkdir::WalkDir::new(objects_dir(app_data_dir))
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if referenced.contains(&name) {
            continue;
        }
        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        if fs::remove_file(entry.path()).is_ok() {
            freed += size;
        }
    }
    Ok(freed)
}

/// Bytes the object store actually occupies, after deduplication.
pub fn stored_bytes(app_data_dir: &Path) -> u64 {
    walkdir::WalkDir::new(objects_dir(app_data_dir))
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn instance(game_dir: &Path) {
        write(&game_dir.join("mods").join("sodium.jar"), "sodium bytes");
        write(
            &game_dir.join("config").join("sodium.json"),
            "{\"fps\":true}",
        );
        write(&game_dir.join("options.txt"), "fov:90");
        // Must never be captured.
        write(
            &game_dir.join("saves").join("world").join("level.dat"),
            "a world",
        );
        write(&game_dir.join("logs").join("latest.log"), "noise");
    }

    #[test]
    fn worlds_and_logs_stay_out_of_the_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        instance(&game_dir);

        let point = create(root_dir, "abc", &game_dir, "Before update", None).unwrap();
        let paths: Vec<&str> = point.entries.iter().map(|e| e.path.as_str()).collect();

        assert!(paths.contains(&"mods/sodium.jar"));
        assert!(paths.contains(&"config/sodium.json"));
        assert!(paths.contains(&"options.txt"));
        // A snapshot that swallowed worlds would cost gigabytes per mod change.
        assert!(!paths.iter().any(|path| path.starts_with("saves")));
        assert!(!paths.iter().any(|path| path.starts_with("logs")));
    }

    #[test]
    fn inspecting_describes_the_instance_without_copying_it() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        instance(&game_dir);

        let described = inspect(&game_dir);
        let captured = create(root_dir, "abc", &game_dir, "For comparison", None).unwrap();

        // The Lockfile has to see exactly what a restore point would capture,
        // or an export would describe a different instance from the one a
        // restore would put back.
        assert_eq!(described, captured.entries);
        // Nothing was written to answer the question.
        let other = tempfile::tempdir().unwrap();
        inspect(&game_dir);
        assert_eq!(stored_bytes(other.path()), 0);
    }

    #[test]
    fn an_unchanged_file_is_stored_once_across_snapshots() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        instance(&game_dir);

        create(root_dir, "abc", &game_dir, "First", None).unwrap();
        let after_first = stored_bytes(root_dir);

        // Change one file, leave the rest alone.
        write(&game_dir.join("options.txt"), "fov:70");
        create(root_dir, "abc", &game_dir, "Second", None).unwrap();
        let after_second = stored_bytes(root_dir);

        // Only the changed file was added, not the whole instance again.
        assert_eq!(after_second - after_first, "fov:70".len() as u64);
    }

    #[test]
    fn restoring_brings_files_back_and_removes_what_came_after() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        instance(&game_dir);

        let point = create(root_dir, "abc", &game_dir, "Before update", None).unwrap();

        fs::remove_file(game_dir.join("mods").join("sodium.jar")).unwrap();
        write(&game_dir.join("mods").join("broken.jar"), "regret");
        write(&game_dir.join("options.txt"), "fov:30");

        restore(root_dir, "abc", &point.id, &game_dir).unwrap();

        assert_eq!(
            fs::read_to_string(game_dir.join("mods").join("sodium.jar")).unwrap(),
            "sodium bytes"
        );
        assert!(!game_dir.join("mods").join("broken.jar").exists());
        assert_eq!(
            fs::read_to_string(game_dir.join("options.txt")).unwrap(),
            "fov:90"
        );
        // The world was never in the snapshot, so restoring must not have
        // touched it.
        assert_eq!(
            fs::read_to_string(game_dir.join("saves").join("world").join("level.dat")).unwrap(),
            "a world"
        );
    }

    #[test]
    fn pruning_drops_old_points_and_frees_their_files() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        instance(&game_dir);

        create(root_dir, "abc", &game_dir, "First", None).unwrap();
        write(
            &game_dir.join("mods").join("only-in-second.jar"),
            "temporary",
        );
        create(root_dir, "abc", &game_dir, "Second", None).unwrap();
        let before = stored_bytes(root_dir);

        // Keep only the oldest, so the second point's unique file is orphaned.
        let mut points = list(root_dir, "abc");
        points.reverse();
        save_index(root_dir, "abc", &points).unwrap();
        assert_eq!(prune(root_dir, "abc", 1).unwrap(), 1);

        assert_eq!(list(root_dir, "abc").len(), 1);
        assert_eq!(before - stored_bytes(root_dir), "temporary".len() as u64);
    }

    #[test]
    fn a_snapshot_points_at_its_world_checkpoint_without_copying_worlds() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        instance(&game_dir);

        let point = create(
            root_dir,
            "abc",
            &game_dir,
            "Before update",
            Some("checkpoint-42".to_string()),
        )
        .unwrap();

        assert_eq!(point.world_checkpoint_id.as_deref(), Some("checkpoint-42"));
        assert!(!point.entries.iter().any(|e| e.path.starts_with("saves")));
        assert_eq!(
            list(root_dir, "abc")[0].world_checkpoint_id,
            point.world_checkpoint_id
        );
    }
}
