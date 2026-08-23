//! Backups of the one thing in an instance that cannot be re-downloaded.
//!
//! Mods, packs and configuration can always be fetched again; a world cannot.
//! That is why worlds are deliberately kept out of restore points — a snapshot
//! must be cheap enough to take before every mod change — and why they get their
//! own store here, with their own retention.
//!
//! Backups are differential in the only way that matters for a Minecraft world:
//! files are content-addressed, so the region files that did not change between
//! two checkpoints are stored once. A world that is played in a corner of the
//! map costs, per checkpoint, roughly the chunks that were touched.
//!
//! ## Never while the game is writing
//!
//! A world copied mid-save is a world with half-written region files, and it
//! restores exactly as badly as it was captured. So a checkpoint is refused
//! while the instance is running.
//!
//! The check is the launcher's own record of running games, not the presence of
//! `session.lock`: Minecraft leaves that file behind after every session, so its
//! presence says nothing at all, and treating it as a signal would refuse every
//! backup of every world that has ever been opened.

use crate::nbt;
use crate::restore_points::SnapshotEntry;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Files that describe the running session rather than the world itself.
const EXCLUDED_FILES: [&str; 1] = ["session.lock"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldSummary {
    /// The directory under `saves/`.
    pub folder: String,
    /// The name the player gave the world, when level.dat could be read. The
    /// folder is only the name it had on the day it was created.
    pub display_name: String,
    pub size_bytes: u64,
    pub file_count: usize,
    /// From level.dat, milliseconds since the epoch.
    pub last_played_ms: Option<i64>,
    /// The Minecraft version that last wrote the world, e.g. "1.21.1".
    pub version_name: Option<String>,
    pub hardcore: bool,
    /// Minecraft's own thumbnail, `icon.png`, as a data URI. Absent for a world
    /// that has never been opened in a version that writes one.
    pub icon: Option<String>,
    pub checkpoint_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldCheckpoint {
    pub id: String,
    pub instance_id: String,
    /// The `saves/` directory this captured.
    pub folder: String,
    /// The world's name at the time of the backup, kept so a checkpoint is still
    /// recognisable after the world is renamed or deleted.
    pub display_name: String,
    pub created_at: String,
    pub reason: String,
    pub entries: Vec<SnapshotEntry>,
    /// Sum of the captured files, before deduplication.
    pub total_bytes: u64,
}

fn root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("world-vault")
}

fn objects_dir(app_data_dir: &Path) -> PathBuf {
    root(app_data_dir).join("objects")
}

fn index_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    root(app_data_dir).join(instance_id).join("index.json")
}

fn object_path(app_data_dir: &Path, sha256: &str) -> PathBuf {
    // Two-character shard, so one directory never holds tens of thousands of
    // files — a world is thousands of region files on its own.
    objects_dir(app_data_dir).join(&sha256[..2]).join(sha256)
}

fn saves_dir(game_dir: &Path) -> PathBuf {
    game_dir.join("saves")
}

fn to_slash(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Every file of one world, as paths relative to the world directory.
fn world_files(world_dir: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(world_dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            entry
                .path()
                .strip_prefix(world_dir)
                .ok()
                .map(Path::to_path_buf)
        })
        .filter(|relative| {
            !relative
                .file_name()
                .map(|name| EXCLUDED_FILES.contains(&name.to_string_lossy().as_ref()))
                .unwrap_or(false)
        })
        .collect()
}

pub fn list_checkpoints(app_data_dir: &Path, instance_id: &str) -> Vec<WorldCheckpoint> {
    fs::read_to_string(index_path(app_data_dir, instance_id))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<WorldCheckpoint>>(&raw).ok())
        .unwrap_or_default()
}

fn save_index(
    app_data_dir: &Path,
    instance_id: &str,
    checkpoints: &[WorldCheckpoint],
) -> Result<(), String> {
    let path = index_path(app_data_dir, instance_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the world vault: {error}"))?;
    }
    let json = serde_json::to_string_pretty(checkpoints).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| format!("Could not save the world vault: {error}"))
}

fn level_summary(world_dir: &Path) -> nbt::LevelSummary {
    fs::read(world_dir.join("level.dat"))
        .ok()
        .and_then(|bytes| nbt::read_level_dat(&bytes))
        .unwrap_or_default()
}

/// Minecraft's own thumbnail, small enough to inline.
fn world_icon(world_dir: &Path) -> Option<String> {
    // Minecraft writes a 64×64 PNG; anything much larger is not that file and is
    // not worth pushing through the bridge.
    const MAX_ICON_BYTES: u64 = 256 * 1024;
    let path = world_dir.join("icon.png");
    if fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) > MAX_ICON_BYTES {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// The worlds of an instance, newest played first.
pub fn list_worlds(app_data_dir: &Path, instance_id: &str, game_dir: &Path) -> Vec<WorldSummary> {
    let checkpoints = list_checkpoints(app_data_dir, instance_id);
    let Ok(entries) = fs::read_dir(saves_dir(game_dir)) else {
        return Vec::new();
    };

    let mut worlds: Vec<WorldSummary> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| {
            let world_dir = entry.path();
            let folder = entry.file_name().to_string_lossy().to_string();
            let files = world_files(&world_dir);
            let size_bytes = files
                .iter()
                .filter_map(|relative| fs::metadata(world_dir.join(relative)).ok())
                .map(|metadata| metadata.len())
                .sum();
            let summary = level_summary(&world_dir);

            WorldSummary {
                display_name: summary.level_name.clone().unwrap_or_else(|| folder.clone()),
                checkpoint_count: checkpoints
                    .iter()
                    .filter(|checkpoint| checkpoint.folder == folder)
                    .count(),
                folder,
                size_bytes,
                file_count: files.len(),
                last_played_ms: summary.last_played_ms,
                version_name: summary.version_name,
                hardcore: summary.hardcore.unwrap_or(false),
                icon: world_icon(&world_dir),
            }
        })
        .collect();

    worlds.sort_by(|left, right| {
        right
            .last_played_ms
            .cmp(&left.last_played_ms)
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    worlds
}

/// Captures one world as it is on disk.
///
/// `game_is_running` is the launcher's own record. Copying a world while
/// Minecraft is writing to it produces a backup that restores to a corrupt
/// world, which is worse than no backup, so this refuses rather than trying.
pub fn checkpoint(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    folder: &str,
    reason: &str,
    game_is_running: bool,
) -> Result<WorldCheckpoint, String> {
    if game_is_running {
        return Err(
            "Close Minecraft before backing up a world. A copy taken while the game is saving would restore as a damaged world.".to_string(),
        );
    }

    let world_dir = saves_dir(game_dir).join(folder);
    if !world_dir.is_dir() {
        return Err(format!(
            "There is no world called {folder} in this instance."
        ));
    }

    let mut entries = Vec::new();
    let mut total_bytes = 0u64;

    for relative in world_files(&world_dir) {
        let bytes = match fs::read(world_dir.join(&relative)) {
            Ok(bytes) => bytes,
            // A file that vanished mid-capture is not worth failing over.
            Err(_) => continue,
        };
        let sha256 = hash_bytes(&bytes);
        let destination = object_path(app_data_dir, &sha256);
        // A region file untouched since the last checkpoint is already stored.
        if !destination.exists() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create the world store: {error}"))?;
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

    let checkpoint = WorldCheckpoint {
        id: Uuid::new_v4().simple().to_string(),
        instance_id: instance_id.to_string(),
        display_name: level_summary(&world_dir)
            .level_name
            .unwrap_or_else(|| folder.to_string()),
        folder: folder.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        reason: reason.to_string(),
        entries,
        total_bytes,
    };

    let mut checkpoints = list_checkpoints(app_data_dir, instance_id);
    checkpoints.insert(0, checkpoint.clone());
    save_index(app_data_dir, instance_id, &checkpoints)?;
    Ok(checkpoint)
}

/// Puts a world back to a checkpoint. Files added since are removed, so the
/// result is the world as it was, not a merge of two worlds.
pub fn restore(
    app_data_dir: &Path,
    instance_id: &str,
    checkpoint_id: &str,
    game_dir: &Path,
    game_is_running: bool,
) -> Result<u64, String> {
    if game_is_running {
        return Err(
            "Close Minecraft before restoring a world. The game holds the world open while it runs."
                .to_string(),
        );
    }

    let checkpoint = list_checkpoints(app_data_dir, instance_id)
        .into_iter()
        .find(|candidate| candidate.id == checkpoint_id)
        .ok_or_else(|| "That backup no longer exists.".to_string())?;

    let world_dir = saves_dir(game_dir).join(&checkpoint.folder);
    fs::create_dir_all(&world_dir)
        .map_err(|error| format!("Could not create the world directory: {error}"))?;

    let wanted: HashSet<&str> = checkpoint
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();

    // Chunks generated after the backup have to go, or the world would be a
    // mixture of two different states of the same map.
    for relative in world_files(&world_dir) {
        if !wanted.contains(to_slash(&relative).as_str()) {
            let _ = fs::remove_file(world_dir.join(&relative));
        }
    }

    let mut restored = 0u64;
    for entry in &checkpoint.entries {
        let bytes = fs::read(object_path(app_data_dir, &entry.sha256))
            .map_err(|error| format!("The stored copy of {} is missing: {error}", entry.path))?;
        let destination = world_dir.join(entry.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&destination, &bytes)
            .map_err(|error| format!("Could not restore {}: {error}", entry.path))?;
        restored += 1;
    }

    // The session lock belongs to the session that made it, not to the backup.
    let _ = fs::remove_file(world_dir.join("session.lock"));
    Ok(restored)
}

pub fn delete(
    app_data_dir: &Path,
    instance_id: &str,
    checkpoint_id: &str,
) -> Result<Vec<WorldCheckpoint>, String> {
    let mut checkpoints = list_checkpoints(app_data_dir, instance_id);
    checkpoints.retain(|checkpoint| checkpoint.id != checkpoint_id);
    save_index(app_data_dir, instance_id, &checkpoints)?;
    collect_garbage(app_data_dir)?;
    Ok(checkpoints)
}

/// Keeps the newest `keep` checkpoints **of one world** and drops the rest.
///
/// Retention is per world: keeping "the ten newest backups" across an instance
/// would quietly delete every backup of a world that has not been played lately,
/// which is exactly the world whose backups matter most.
pub fn prune(
    app_data_dir: &Path,
    instance_id: &str,
    folder: &str,
    keep: usize,
) -> Result<usize, String> {
    let checkpoints = list_checkpoints(app_data_dir, instance_id);
    let mut seen = 0usize;
    let mut removed = 0usize;
    let kept: Vec<WorldCheckpoint> = checkpoints
        .into_iter()
        .filter(|checkpoint| {
            if checkpoint.folder != folder {
                return true;
            }
            seen += 1;
            if seen <= keep {
                true
            } else {
                removed += 1;
                false
            }
        })
        .collect();

    save_index(app_data_dir, instance_id, &kept)?;
    collect_garbage(app_data_dir)?;
    Ok(removed)
}

/// Drops stored files no checkpoint of any instance refers to.
pub fn collect_garbage(app_data_dir: &Path) -> Result<u64, String> {
    let mut referenced: HashSet<String> = HashSet::new();
    if let Ok(entries) = fs::read_dir(root(app_data_dir)) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() || entry.file_name() == "objects" {
                continue;
            }
            let instance_id = entry.file_name().to_string_lossy().to_string();
            for checkpoint in list_checkpoints(app_data_dir, &instance_id) {
                for snapshot_entry in checkpoint.entries {
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
        if referenced.contains(&entry.file_name().to_string_lossy().to_string()) {
            continue;
        }
        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        if fs::remove_file(entry.path()).is_ok() {
            freed += size;
        }
    }
    Ok(freed)
}

/// Bytes the world store occupies after deduplication.
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

    fn write(path: &Path, content: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn world(game_dir: &Path, folder: &str) -> PathBuf {
        let world_dir = saves_dir(game_dir).join(folder);
        write(&world_dir.join("level.dat"), b"not real nbt");
        write(&world_dir.join("session.lock"), b"snowman");
        write(
            &world_dir.join("region").join("r.0.0.mca"),
            b"the spawn chunks",
        );
        write(
            &world_dir.join("region").join("r.1.0.mca"),
            b"the mineshaft",
        );
        world_dir
    }

    #[test]
    fn a_backup_is_refused_while_the_game_is_running() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        world(&game_dir, "Survie");

        let error = checkpoint(root_dir, "abc", &game_dir, "Survie", "Manual", true).unwrap_err();

        // A world copied mid-save restores as a damaged world.
        assert!(error.contains("Close Minecraft"), "{error}");
        assert!(list_checkpoints(root_dir, "abc").is_empty());
    }

    #[test]
    fn the_session_lock_is_never_part_of_a_backup() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        world(&game_dir, "Survie");

        let point = checkpoint(root_dir, "abc", &game_dir, "Survie", "Manual", false).unwrap();
        let paths: Vec<&str> = point.entries.iter().map(|e| e.path.as_str()).collect();

        assert!(paths.contains(&"region/r.0.0.mca"));
        assert!(paths.contains(&"level.dat"));
        // It describes the session that made it, not the world.
        assert!(!paths.contains(&"session.lock"));
    }

    #[test]
    fn an_untouched_region_file_is_stored_once_across_backups() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        let world_dir = world(&game_dir, "Survie");

        checkpoint(root_dir, "abc", &game_dir, "Survie", "First", false).unwrap();
        let after_first = stored_bytes(root_dir);

        // Play in one corner of the map: one region file changes.
        write(
            &world_dir.join("region").join("r.1.0.mca"),
            b"the mineshaft, now lit",
        );
        checkpoint(root_dir, "abc", &game_dir, "Survie", "Second", false).unwrap();

        // The spawn chunks are not stored a second time.
        assert_eq!(
            stored_bytes(root_dir) - after_first,
            "the mineshaft, now lit".len() as u64
        );
    }

    #[test]
    fn restoring_undoes_what_happened_after_the_backup() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        let world_dir = world(&game_dir, "Survie");

        let point = checkpoint(root_dir, "abc", &game_dir, "Survie", "Before", false).unwrap();

        // Blow the base up, generate new chunks, lose a file.
        write(&world_dir.join("region").join("r.0.0.mca"), b"a crater");
        write(&world_dir.join("region").join("r.9.9.mca"), b"new chunks");
        fs::remove_file(world_dir.join("region").join("r.1.0.mca")).unwrap();

        restore(root_dir, "abc", &point.id, &game_dir, false).unwrap();

        assert_eq!(
            fs::read(world_dir.join("region").join("r.0.0.mca")).unwrap(),
            b"the spawn chunks"
        );
        assert_eq!(
            fs::read(world_dir.join("region").join("r.1.0.mca")).unwrap(),
            b"the mineshaft"
        );
        // Chunks generated after the backup would make the world a mixture of
        // two states of the same map.
        assert!(!world_dir.join("region").join("r.9.9.mca").exists());
        // The lock belongs to a session that is over.
        assert!(!world_dir.join("session.lock").exists());
    }

    #[test]
    fn restoring_is_refused_while_the_game_is_running() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        world(&game_dir, "Survie");
        let point = checkpoint(root_dir, "abc", &game_dir, "Survie", "Before", false).unwrap();

        assert!(restore(root_dir, "abc", &point.id, &game_dir, true).is_err());
    }

    #[test]
    fn a_world_that_is_not_there_is_refused_rather_than_backed_up_empty() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        world(&game_dir, "Survie");

        // An empty backup would look like a successful one and restore to an
        // empty world.
        let error = checkpoint(root_dir, "abc", &game_dir, "Créatif", "Manual", false).unwrap_err();
        assert!(error.contains("Créatif"), "{error}");
    }

    #[test]
    fn retention_is_per_world_not_per_instance() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        world(&game_dir, "Survie");
        world(&game_dir, "Créatif");

        checkpoint(root_dir, "abc", &game_dir, "Créatif", "Only one", false).unwrap();
        for reason in ["First", "Second", "Third"] {
            checkpoint(root_dir, "abc", &game_dir, "Survie", reason, false).unwrap();
        }

        assert_eq!(prune(root_dir, "abc", "Survie", 1).unwrap(), 2);

        let left = list_checkpoints(root_dir, "abc");
        // Trimming the world being played must not delete the only backup of a
        // world that has not been touched in months.
        assert_eq!(left.iter().filter(|c| c.folder == "Créatif").count(), 1);
        assert_eq!(left.iter().filter(|c| c.folder == "Survie").count(), 1);
        assert_eq!(
            left.iter().find(|c| c.folder == "Survie").unwrap().reason,
            "Third"
        );
    }

    #[test]
    fn deleting_the_last_backup_of_a_world_frees_its_files() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        world(&game_dir, "Survie");

        let point = checkpoint(root_dir, "abc", &game_dir, "Survie", "Only", false).unwrap();
        assert!(stored_bytes(root_dir) > 0);

        delete(root_dir, "abc", &point.id).unwrap();
        assert_eq!(stored_bytes(root_dir), 0);
    }

    #[test]
    fn a_world_is_listed_under_the_name_the_player_gave_it() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        // The folder keeps the name the world had the day it was created.
        let world_dir = world(&game_dir, "New World");
        write(
            &world_dir.join("level.dat"),
            &named_level_dat("Survie hardcore"),
        );

        let worlds = list_worlds(root_dir, "abc", &game_dir);
        assert_eq!(worlds.len(), 1);
        assert_eq!(worlds[0].folder, "New World");
        assert_eq!(worlds[0].display_name, "Survie hardcore");
        // session.lock is excluded from the size, as it is from the backup.
        assert_eq!(worlds[0].file_count, 3);
    }

    #[test]
    fn an_unreadable_level_dat_falls_back_to_the_folder_name() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        world(&game_dir, "Survie");

        // The level.dat written by `world` is not NBT at all.
        let worlds = list_worlds(root_dir, "abc", &game_dir);
        assert_eq!(worlds[0].display_name, "Survie");
    }

    /// A minimal gzipped level.dat carrying just a name.
    fn named_level_dat(name: &str) -> Vec<u8> {
        use std::io::Write;
        let mut raw = Vec::new();
        raw.push(10u8);
        raw.extend_from_slice(&0u16.to_be_bytes());
        raw.push(10u8);
        raw.extend_from_slice(&4u16.to_be_bytes());
        raw.extend_from_slice(b"Data");
        raw.push(8u8);
        raw.extend_from_slice(&9u16.to_be_bytes());
        raw.extend_from_slice(b"LevelName");
        raw.extend_from_slice(&(name.len() as u16).to_be_bytes());
        raw.extend_from_slice(name.as_bytes());
        raw.push(0u8);
        raw.push(0u8);

        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&raw).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn the_world_thumbnail_is_inlined_when_minecraft_wrote_one() {
        let directory = tempfile::tempdir().unwrap();
        let root_dir = directory.path();
        let game_dir = root_dir.join("game");
        let world_dir = world(&game_dir, "Survie");

        assert!(list_worlds(root_dir, "abc", &game_dir)[0].icon.is_none());

        write(&world_dir.join("icon.png"), b"PNG");
        let icon = list_worlds(root_dir, "abc", &game_dir)[0]
            .icon
            .clone()
            .unwrap();
        assert_eq!(icon, "data:image/png;base64,UE5H");
    }
}
