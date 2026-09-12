//! Backups of a hosted server: one zip each, in the server's own `backups/`.
//!
//! A backup is the server as it would be cloned — world, mods, config,
//! properties, the player lists — and not its history or the loader's
//! `libraries/`, which reinstall. Restoring is the risky direction, so it is
//! done the way a careful person would: the server must be stopped, the
//! current state is backed up first, the zip is checked before anything is
//! touched, and if putting it back fails halfway the previous state is
//! put back instead.

use crate::server_host::{is_transient, BACKUPS_DIR};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct Backup {
    /// The file name, which is also the id.
    pub file: String,
    pub label: String,
    pub created_at: String,
    pub bytes: u64,
}

fn backups_dir(server_dir: &Path) -> PathBuf {
    server_dir.join(BACKUPS_DIR)
}

/// `20260912-214500-before-restore.zip`: sorts by date, says why.
fn file_name(label: &str) -> String {
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let slug = crate::server_host::slug(label);
    format!("{stamp}-{slug}.zip")
}

fn parse_name(file: &str) -> Option<(String, String)> {
    let stem = file.strip_suffix(".zip")?;
    let (date, rest) = stem.split_at(stem.find('-').map(|i| i + 7)?.min(stem.len()));
    let date = date.trim_end_matches('-');
    let created = chrono::NaiveDateTime::parse_from_str(date, "%Y%m%d-%H%M%S").ok()?;
    let label = rest.trim_start_matches('-').replace('-', " ");
    Some((created.and_utc().to_rfc3339(), label))
}

pub fn list(server_dir: &Path) -> Vec<Backup> {
    let mut backups: Vec<Backup> = std::fs::read_dir(backups_dir(server_dir))
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let file = entry.file_name().to_string_lossy().into_owned();
                    let (created_at, label) = parse_name(&file)?;
                    let bytes = entry.metadata().ok()?.len();
                    Some(Backup { file, label, created_at, bytes })
                })
                .collect()
        })
        .unwrap_or_default();
    backups.sort_by(|a, b| b.file.cmp(&a.file));
    backups
}

/// Zips the server into `backups/`. Safe while the server runs — the world
/// may be mid-write, which is why `save-all` is sent first when it is.
pub fn create(server_dir: &Path, label: &str) -> Result<Backup, String> {
    let dir = backups_dir(server_dir);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let file = file_name(if label.trim().is_empty() { "manual" } else { label });
    let path = dir.join(&file);
    let out = std::fs::File::create(&path).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipWriter::new(out);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);

    let mut buffer = Vec::new();
    for entry in walkdir::WalkDir::new(server_dir).min_depth(1).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        let relative = entry.path().strip_prefix(server_dir).map_err(|error| error.to_string())?;
        if is_transient(relative) {
            continue;
        }
        let name = relative.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() {
            zip.add_directory(format!("{name}/"), options).map_err(|error| error.to_string())?;
        } else if entry.file_type().is_file() {
            zip.start_file(&name, options).map_err(|error| error.to_string())?;
            buffer.clear();
            match std::fs::File::open(entry.path()) {
                Ok(mut source) => {
                    source.read_to_end(&mut buffer).map_err(|error| format!("Could not read {name}: {error}"))?;
                }
                // A lock file the server holds — session.lock — is not worth
                // failing the whole backup over.
                Err(_) => continue,
            }
            zip.write_all(&buffer).map_err(|error| error.to_string())?;
        }
    }
    zip.finish().map_err(|error| error.to_string())?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let (created_at, label) = parse_name(&file).unwrap_or_default();
    Ok(Backup { file, label, created_at, bytes })
}

pub fn delete(server_dir: &Path, file: &str) -> Result<(), String> {
    let path = safe_backup_path(server_dir, file)?;
    std::fs::remove_file(path).map_err(|error| error.to_string())
}

fn safe_backup_path(server_dir: &Path, file: &str) -> Result<PathBuf, String> {
    crate::path_security::safe_child_path(&backups_dir(server_dir), file, &["zip"])
}

/// A zip entry name that stays inside the folder it is extracted into.
pub fn safe_entry(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            // `..`, a root, a drive letter: none of these belong in an archive.
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Reads every entry name first; a single bad one refuses the whole archive
/// before a byte is written.
fn checked_entries(archive: &mut zip::ZipArchive<std::fs::File>) -> Result<Vec<(usize, PathBuf, bool)>, String> {
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(|error| error.to_string())?;
        let name = entry.name().to_string();
        let path = safe_entry(&name).ok_or_else(|| format!("The archive contains an unsafe path: {name}"))?;
        entries.push((index, path, entry.is_dir()));
    }
    Ok(entries)
}

/// Puts a backup back. The current state is zipped first as "before
/// restore", then the live files are moved aside, the archive extracted, and
/// the aside copy removed — or moved back, if extraction failed.
pub fn restore(server_dir: &Path, file: &str) -> Result<Backup, String> {
    let path = safe_backup_path(server_dir, file)?;
    let archive_file = std::fs::File::open(&path).map_err(|error| format!("Could not open the backup: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file).map_err(|error| format!("Not a zip: {error}"))?;
    let entries = checked_entries(&mut archive)?;

    let safety = create(server_dir, "before restore")?;

    // Aside, inside backups/ so it is transient and never restored over.
    let aside = backups_dir(server_dir).join(".restoring");
    let _ = std::fs::remove_dir_all(&aside);
    std::fs::create_dir_all(&aside).map_err(|error| error.to_string())?;
    let mut moved = Vec::new();
    for entry in std::fs::read_dir(server_dir).map_err(|error| error.to_string())?.flatten() {
        let name = entry.file_name();
        let relative = PathBuf::from(&name);
        if is_transient(&relative) {
            continue;
        }
        let target = aside.join(&name);
        std::fs::rename(entry.path(), &target).map_err(|error| format!("Could not set aside {}: {error}", name.to_string_lossy()))?;
        moved.push(name);
    }

    let extracted = extract(&mut archive, &entries, server_dir);
    match extracted {
        Ok(()) => {
            let _ = std::fs::remove_dir_all(&aside);
            Ok(safety)
        }
        Err(error) => {
            // Undo: drop what was half-written, bring the aside copy back.
            for entry in std::fs::read_dir(server_dir).map_err(|e| e.to_string())?.flatten() {
                if !is_transient(&PathBuf::from(entry.file_name())) {
                    let _ = if entry.path().is_dir() {
                        std::fs::remove_dir_all(entry.path())
                    } else {
                        std::fs::remove_file(entry.path())
                    };
                }
            }
            for name in moved {
                let _ = std::fs::rename(aside.join(&name), server_dir.join(&name));
            }
            let _ = std::fs::remove_dir_all(&aside);
            Err(format!("The backup could not be restored, so nothing was changed: {error}"))
        }
    }
}

fn extract(
    archive: &mut zip::ZipArchive<std::fs::File>,
    entries: &[(usize, PathBuf, bool)],
    into: &Path,
) -> Result<(), String> {
    for (index, relative, is_dir) in entries {
        let target = into.join(relative);
        if *is_dir {
            std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut entry = archive.by_index(*index).map_err(|error| error.to_string())?;
        let mut out = std::fs::File::create(&target).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(dir: &Path) {
        std::fs::create_dir_all(dir.join("world/region")).unwrap();
        std::fs::write(dir.join("world/region/r.0.0.mca"), b"chunks").unwrap();
        std::fs::write(dir.join("server.properties"), b"motd=one\n").unwrap();
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        std::fs::write(dir.join("logs/latest.log"), b"noise").unwrap();
        std::fs::create_dir_all(dir.join("libraries/x")).unwrap();
        std::fs::write(dir.join("libraries/x/big.jar"), vec![0u8; 10_000]).unwrap();
    }

    #[test]
    fn a_backup_holds_the_server_and_not_its_history() {
        let dir = tempfile::tempdir().unwrap();
        server(dir.path());
        let backup = create(dir.path(), "Before update").unwrap();
        assert_eq!(backup.label, "before update");
        assert!(backup.bytes > 0 && backup.bytes < 5_000, "libraries were left out: {}", backup.bytes);
        let listed = list(dir.path());
        assert_eq!(listed, vec![backup.clone()]);

        let file = std::fs::File::open(dir.path().join(BACKUPS_DIR).join(&backup.file)).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len()).map(|i| archive.by_index(i).unwrap().name().to_string()).collect();
        assert!(names.contains(&"world/region/r.0.0.mca".to_string()));
        assert!(names.contains(&"server.properties".to_string()));
        assert!(!names.iter().any(|n| n.starts_with("logs") || n.starts_with("libraries") || n.starts_with("backups")));
    }

    #[test]
    fn restoring_brings_the_world_back_and_keeps_a_copy_of_what_it_replaced() {
        let dir = tempfile::tempdir().unwrap();
        server(dir.path());
        let backup = create(dir.path(), "good").unwrap();
        std::fs::write(dir.path().join("world/region/r.0.0.mca"), b"corrupted").unwrap();
        std::fs::write(dir.path().join("server.properties"), b"motd=two\n").unwrap();
        std::fs::write(dir.path().join("stray.txt"), b"added later").unwrap();

        let safety = restore(dir.path(), &backup.file).unwrap();
        assert_eq!(std::fs::read(dir.path().join("world/region/r.0.0.mca")).unwrap(), b"chunks");
        assert_eq!(std::fs::read(dir.path().join("server.properties")).unwrap(), b"motd=one\n");
        assert!(!dir.path().join("stray.txt").exists(), "a restore is the backup, not a merge");
        assert!(dir.path().join("logs/latest.log").exists(), "history is not touched");
        assert_eq!(safety.label, "before restore");
        assert_eq!(list(dir.path()).len(), 2);
        assert!(!dir.path().join(BACKUPS_DIR).join(".restoring").exists());
    }

    #[test]
    fn an_archive_that_climbs_out_is_refused_before_anything_moves() {
        let dir = tempfile::tempdir().unwrap();
        server(dir.path());
        let evil = dir.path().join(BACKUPS_DIR).join("20260101-000000-evil.zip");
        std::fs::create_dir_all(evil.parent().unwrap()).unwrap();
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&evil).unwrap());
        zip.start_file("../outside.txt", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"x").unwrap();
        zip.finish().unwrap();

        let error = restore(dir.path(), "20260101-000000-evil.zip").unwrap_err();
        assert!(error.contains("unsafe path"), "{error}");
        assert_eq!(std::fs::read(dir.path().join("server.properties")).unwrap(), b"motd=one\n");
        assert!(!dir.path().parent().unwrap().join("outside.txt").exists());
        // Refused before the safety copy, so nothing was added either.
        assert_eq!(list(dir.path()).len(), 1);
    }

    #[test]
    fn safe_entry_keeps_paths_inside() {
        assert_eq!(safe_entry("world/level.dat"), Some(PathBuf::from("world/level.dat")));
        assert_eq!(safe_entry("./mods/a.jar"), Some(PathBuf::from("mods/a.jar")));
        assert_eq!(safe_entry("../x"), None);
        assert_eq!(safe_entry("/etc/passwd"), None);
        assert_eq!(safe_entry("world/../../x"), None);
        assert_eq!(safe_entry(""), None);
    }

    #[test]
    fn a_backup_name_carries_its_date_and_its_reason() {
        let (created, label) = parse_name("20260912-214500-before-restore.zip").unwrap();
        assert_eq!(created, "2026-09-12T21:45:00+00:00");
        assert_eq!(label, "before restore");
        assert_eq!(parse_name("notes.txt"), None);
        assert!(delete(Path::new("."), "../../x.zip").is_err());
    }
}
