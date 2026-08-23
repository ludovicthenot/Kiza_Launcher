//! Where each installed file came from.
//!
//! Content installed from Modrinth or CurseForge is written straight into the
//! instance, which leaves no record of *which project* a jar belongs to. Without
//! that, no update can ever be offered for it: a file name is not an identity.
//!
//! This index is that record, kept beside the instance and keyed by the file's
//! path relative to the game directory.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContentOrigin {
    /// "modrinth" or "curseforge".
    pub provider: String,
    /// Project identifier on that platform.
    pub project_id: String,
    /// The exact released version this file is.
    pub version_id: String,
    /// Kept so a pinned mod is never moved off the version the user chose.
    #[serde(default)]
    pub pinned: bool,
}

fn index_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    app_data_dir
        .join("minecraft")
        .join("instances")
        .join(instance_id)
        .join("content-provenance.json")
}

fn load(app_data_dir: &Path, instance_id: &str) -> BTreeMap<String, ContentOrigin> {
    fs::read_to_string(index_path(app_data_dir, instance_id))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(
    app_data_dir: &Path,
    instance_id: &str,
    index: &BTreeMap<String, ContentOrigin>,
) -> Result<(), String> {
    let path = index_path(app_data_dir, instance_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| format!("Could not record content origin: {error}"))
}

pub fn all(app_data_dir: &Path, instance_id: &str) -> BTreeMap<String, ContentOrigin> {
    load(app_data_dir, instance_id)
}

pub fn get(app_data_dir: &Path, instance_id: &str, relative_path: &str) -> Option<ContentOrigin> {
    load(app_data_dir, instance_id).remove(relative_path)
}

/// Records where a freshly installed file came from. Re-installing the same
/// path overwrites the entry but keeps the pin, so updating a pinned mod stays
/// a deliberate act.
pub fn record(
    app_data_dir: &Path,
    instance_id: &str,
    relative_path: &str,
    origin: ContentOrigin,
) -> Result<(), String> {
    let mut index = load(app_data_dir, instance_id);
    let pinned = index
        .get(relative_path)
        .map(|existing| existing.pinned)
        .unwrap_or(origin.pinned);
    index.insert(
        relative_path.to_string(),
        ContentOrigin { pinned, ..origin },
    );
    save(app_data_dir, instance_id, &index)
}

pub fn forget(app_data_dir: &Path, instance_id: &str, relative_path: &str) -> Result<(), String> {
    let mut index = load(app_data_dir, instance_id);
    index.remove(relative_path);
    save(app_data_dir, instance_id, &index)
}

/// Pins or unpins a file, which the Update Center reads to decide whether an
/// update may be offered.
pub fn set_pinned(
    app_data_dir: &Path,
    instance_id: &str,
    relative_path: &str,
    pinned: bool,
) -> Result<ContentOrigin, String> {
    let mut index = load(app_data_dir, instance_id);
    let origin = index
        .get_mut(relative_path)
        .ok_or_else(|| "Kiza does not know where this file came from.".to_string())?;
    origin.pinned = pinned;
    let updated = origin.clone();
    save(app_data_dir, instance_id, &index)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(version: &str) -> ContentOrigin {
        ContentOrigin {
            provider: "modrinth".to_string(),
            project_id: "AANobbMI".to_string(),
            version_id: version.to_string(),
            pinned: false,
        }
    }

    #[test]
    fn an_installed_file_remembers_its_project_and_version() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();

        record(root, "abc", "mods/sodium.jar", origin("mc1.21-0.5.8")).unwrap();

        let stored = get(root, "abc", "mods/sodium.jar").unwrap();
        assert_eq!(stored.project_id, "AANobbMI");
        assert_eq!(stored.version_id, "mc1.21-0.5.8");
        // A file we never installed has no origin, and must not be guessed.
        assert!(get(root, "abc", "mods/unknown.jar").is_none());
    }

    #[test]
    fn reinstalling_keeps_the_pin() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        record(root, "abc", "mods/sodium.jar", origin("mc1.21-0.5.8")).unwrap();
        set_pinned(root, "abc", "mods/sodium.jar", true).unwrap();

        // A later install of the same path must not silently unpin it.
        record(root, "abc", "mods/sodium.jar", origin("mc1.21-0.6.0")).unwrap();

        let stored = get(root, "abc", "mods/sodium.jar").unwrap();
        assert!(stored.pinned, "the pin is the user's decision, not ours");
        assert_eq!(stored.version_id, "mc1.21-0.6.0");
    }

    #[test]
    fn pinning_an_unknown_file_is_refused_rather_than_invented() {
        let directory = tempfile::tempdir().unwrap();
        assert!(set_pinned(directory.path(), "abc", "mods/ghost.jar", true).is_err());
    }

    #[test]
    fn removing_content_removes_its_record() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        record(root, "abc", "mods/sodium.jar", origin("mc1.21-0.5.8")).unwrap();

        forget(root, "abc", "mods/sodium.jar").unwrap();
        assert!(all(root, "abc").is_empty());
    }
}
