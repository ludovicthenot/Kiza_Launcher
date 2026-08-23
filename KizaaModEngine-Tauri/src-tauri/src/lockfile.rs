//! A reproducible description of an instance, in one file.
//!
//! An exported instance is a zip of bytes: it copies what is installed, but it
//! cannot say what any of it *is*. A lockfile is the opposite — it carries no
//! bytes at all, only the identity of every file: which project, which released
//! version, and the hash the result must have.
//!
//! That difference is what makes it shareable. A lockfile is small enough to
//! commit next to a server's configuration, and rebuilding from it downloads
//! from the original platforms rather than from whoever made the archive.
//!
//! Two rules keep it honest:
//!
//! * A file whose origin was never recorded is still locked, by hash — but it is
//!   marked as such. Somebody else's machine cannot rebuild it, and saying so is
//!   better than silently producing a different instance.
//! * The output is ordered, so exporting the same instance twice gives the same
//!   bytes. A lockfile that churned on every export would be useless in git.

use crate::content_provenance::ContentOrigin;
use crate::restore_points::SnapshotEntry;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Bumped when the meaning of a field changes. A reader that does not know a
/// format refuses the file instead of reading it as if it were the old one.
pub const FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockedSource {
    /// "modrinth" or "curseforge".
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockedFile {
    /// Path relative to the game directory, with forward slashes.
    pub path: String,
    pub sha256: String,
    pub size: u64,
    /// None for anything added by hand: it can be checked, but not refetched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<LockedSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockedRuntime {
    pub mc_version: String,
    /// "vanilla", "fabric" or "forge".
    pub loader: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    /// Only set when the instance overrides the Java version Mojang declares.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub java_major: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Lockfile {
    pub format: u32,
    pub name: String,
    pub generated_at: String,
    pub generated_by: String,
    pub runtime: LockedRuntime,
    pub files: Vec<LockedFile>,
}

impl Lockfile {
    /// Files nobody else could rebuild, because Kiza never learned where they
    /// came from.
    pub fn unreproducible(&self) -> Vec<&LockedFile> {
        self.files
            .iter()
            .filter(|file| file.source.is_none())
            .collect()
    }
}

/// Turns a snapshot of the instance plus its provenance index into a lockfile.
///
/// The snapshot decides *what* is in the instance and what each file hashes to;
/// the provenance index decides where each one can be fetched from again. A file
/// present in one and not the other is not an error: an unrecorded file is
/// locked without a source, and a recorded path that is no longer installed is
/// simply not part of the instance any more.
pub fn build(
    name: &str,
    generated_at: &str,
    runtime: LockedRuntime,
    entries: &[SnapshotEntry],
    origins: &BTreeMap<String, ContentOrigin>,
) -> Lockfile {
    let mut files: Vec<LockedFile> = entries
        .iter()
        .map(|entry| LockedFile {
            path: entry.path.clone(),
            sha256: entry.sha256.clone(),
            size: entry.size,
            source: origins.get(&entry.path).map(|origin| LockedSource {
                provider: origin.provider.clone(),
                project_id: origin.project_id.clone(),
                version_id: origin.version_id.clone(),
            }),
        })
        .collect();

    // Sorted so two exports of an unchanged instance are byte-identical.
    files.sort_by(|left, right| left.path.cmp(&right.path));

    Lockfile {
        format: FORMAT,
        name: name.to_string(),
        generated_at: generated_at.to_string(),
        generated_by: format!("Kiza Launcher {}", env!("CARGO_PKG_VERSION")),
        runtime,
        files,
    }
}

pub fn to_json(lock: &Lockfile) -> Result<String, String> {
    serde_json::to_string_pretty(lock).map_err(|error| format!("Could not write lockfile: {error}"))
}

/// Reads a lockfile, refusing anything this build does not understand.
pub fn parse(raw: &str) -> Result<Lockfile, String> {
    // The format is read first, so a newer file gives that reason rather than a
    // confusing complaint about a missing field.
    #[derive(Deserialize)]
    struct FormatProbe {
        format: u32,
    }
    let probe: FormatProbe =
        serde_json::from_str(raw).map_err(|_| "This file is not a Kiza lockfile.".to_string())?;
    if probe.format > FORMAT {
        return Err(format!(
            "This lockfile was written in format {} and this version of Kiza reads up to {FORMAT}. Update Kiza to use it.",
            probe.format
        ));
    }

    serde_json::from_str(raw).map_err(|error| format!("This lockfile is damaged: {error}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileVerdict {
    /// Installed, with exactly the locked bytes.
    Match,
    /// Not installed at all.
    Missing,
    /// Installed under this path, but not the locked bytes.
    Different,
    /// Installed and not in the lockfile.
    Extra,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffEntry {
    pub path: String,
    pub verdict: FileVerdict,
    /// Where the locked version can be fetched from, when that is known. Absent
    /// on `Extra`, and on locked files with no recorded origin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<LockedSource>,
}

/// Compares a lockfile against what is installed right now.
///
/// `Different` is reported separately from `Missing` on purpose: a mod that is
/// there but at the wrong version is a normal drift, while a mod that is gone
/// may mean the lockfile describes an instance this one is not.
pub fn diff(lock: &Lockfile, current: &[SnapshotEntry]) -> Vec<DiffEntry> {
    let installed: BTreeMap<&str, &SnapshotEntry> = current
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let locked: BTreeSet<&str> = lock.files.iter().map(|file| file.path.as_str()).collect();

    let mut result: Vec<DiffEntry> = lock
        .files
        .iter()
        .map(|file| {
            let verdict = match installed.get(file.path.as_str()) {
                None => FileVerdict::Missing,
                Some(entry) if entry.sha256 == file.sha256 => FileVerdict::Match,
                Some(_) => FileVerdict::Different,
            };
            DiffEntry {
                path: file.path.clone(),
                verdict,
                source: file.source.clone(),
            }
        })
        .collect();

    result.extend(
        current
            .iter()
            .filter(|entry| !locked.contains(entry.path.as_str()))
            .map(|entry| DiffEntry {
                path: entry.path.clone(),
                verdict: FileVerdict::Extra,
                source: None,
            }),
    );

    result.sort_by(|left, right| left.path.cmp(&right.path));
    result
}

/// The entries a rebuild would have to download: everything absent or wrong that
/// has somewhere to be fetched from.
pub fn fetchable(diff: &[DiffEntry]) -> Vec<&DiffEntry> {
    diff.iter()
        .filter(|entry| {
            matches!(entry.verdict, FileVerdict::Missing | FileVerdict::Different)
                && entry.source.is_some()
        })
        .collect()
}

/// The entries a rebuild cannot satisfy, because nothing records where they came
/// from. Naming them is the point: the result will not match the lockfile, and
/// the user is told which files are responsible.
pub fn unfetchable(diff: &[DiffEntry]) -> Vec<&DiffEntry> {
    diff.iter()
        .filter(|entry| {
            matches!(entry.verdict, FileVerdict::Missing | FileVerdict::Different)
                && entry.source.is_none()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> LockedRuntime {
        LockedRuntime {
            mc_version: "1.21.1".to_string(),
            loader: "fabric".to_string(),
            loader_version: Some("0.16.5".to_string()),
            java_major: Some(21),
        }
    }

    fn entry(path: &str, sha256: &str) -> SnapshotEntry {
        SnapshotEntry {
            path: path.to_string(),
            sha256: sha256.to_string(),
            size: 10,
        }
    }

    fn origins() -> BTreeMap<String, ContentOrigin> {
        let mut origins = BTreeMap::new();
        origins.insert(
            "mods/sodium.jar".to_string(),
            ContentOrigin {
                provider: "modrinth".to_string(),
                project_id: "AANobbMI".to_string(),
                version_id: "mc1.21-0.6.0".to_string(),
                pinned: false,
            },
        );
        origins
    }

    #[test]
    fn exporting_the_same_instance_twice_gives_the_same_bytes() {
        // Entries arrive in whatever order the filesystem walked them.
        let one = [
            entry("mods/sodium.jar", "aaa"),
            entry("config/sodium.json", "bbb"),
        ];
        let other = [
            entry("config/sodium.json", "bbb"),
            entry("mods/sodium.jar", "aaa"),
        ];

        let first = build(
            "Survie",
            "2026-01-01T00:00:00Z",
            runtime(),
            &one,
            &origins(),
        );
        let second = build(
            "Survie",
            "2026-01-01T00:00:00Z",
            runtime(),
            &other,
            &origins(),
        );

        // Otherwise a lockfile kept in git would show a diff on every export.
        assert_eq!(to_json(&first).unwrap(), to_json(&second).unwrap());
    }

    #[test]
    fn a_hand_added_file_is_locked_by_hash_but_named_as_unreproducible() {
        let entries = [
            entry("mods/sodium.jar", "aaa"),
            entry("mods/secret-private-mod.jar", "bbb"),
        ];

        let lock = build(
            "Survie",
            "2026-01-01T00:00:00Z",
            runtime(),
            &entries,
            &origins(),
        );

        let sodium = lock
            .files
            .iter()
            .find(|file| file.path == "mods/sodium.jar")
            .unwrap();
        assert_eq!(sodium.source.as_ref().unwrap().project_id, "AANobbMI");

        // It is still locked — the hash is known — but nobody else can rebuild
        // it, and the lockfile says so rather than pretending otherwise.
        let unknown = lock.unreproducible();
        assert_eq!(unknown.len(), 1);
        assert_eq!(unknown[0].path, "mods/secret-private-mod.jar");
        assert_eq!(unknown[0].sha256, "bbb");
    }

    #[test]
    fn a_lockfile_survives_a_round_trip() {
        let entries = [entry("mods/sodium.jar", "aaa")];
        let lock = build(
            "Survie",
            "2026-01-01T00:00:00Z",
            runtime(),
            &entries,
            &origins(),
        );

        let parsed = parse(&to_json(&lock).unwrap()).unwrap();
        assert_eq!(parsed, lock);
        assert_eq!(parsed.runtime.loader_version.as_deref(), Some("0.16.5"));
    }

    #[test]
    fn a_newer_format_is_refused_rather_than_misread() {
        let raw = r#"{"format":99,"name":"x","generated_at":"","generated_by":"","runtime":{"mc_version":"1.21.1","loader":"fabric"},"files":[]}"#;

        let error = parse(raw).unwrap_err();
        // Reading unknown fields as if they were the old ones would rebuild the
        // wrong instance, which is worse than refusing.
        assert!(error.contains("format 99"), "{error}");
    }

    #[test]
    fn something_that_is_not_a_lockfile_is_rejected_clearly() {
        assert!(parse("not json at all").is_err());
        assert!(parse(r#"{"mods":[]}"#).is_err());
    }

    #[test]
    fn the_diff_separates_missing_changed_and_extra_files() {
        let locked = [
            entry("mods/sodium.jar", "aaa"),
            entry("mods/iris.jar", "bbb"),
            entry("config/sodium.json", "ccc"),
        ];
        let lock = build(
            "Survie",
            "2026-01-01T00:00:00Z",
            runtime(),
            &locked,
            &origins(),
        );

        let installed = [
            // Right file, right bytes.
            entry("mods/sodium.jar", "aaa"),
            // Right path, different bytes: drift, not absence.
            entry("config/sodium.json", "zzz"),
            // Never in the lockfile.
            entry("mods/extra.jar", "ddd"),
            // mods/iris.jar is simply gone.
        ];

        let report = diff(&lock, &installed);
        let verdict = |path: &str| {
            report
                .iter()
                .find(|entry| entry.path == path)
                .map(|entry| entry.verdict)
        };

        assert_eq!(verdict("mods/sodium.jar"), Some(FileVerdict::Match));
        assert_eq!(verdict("mods/iris.jar"), Some(FileVerdict::Missing));
        assert_eq!(verdict("config/sodium.json"), Some(FileVerdict::Different));
        assert_eq!(verdict("mods/extra.jar"), Some(FileVerdict::Extra));
    }

    #[test]
    fn a_rebuild_separates_what_it_can_fetch_from_what_it_cannot() {
        let locked = [
            entry("mods/sodium.jar", "aaa"),
            entry("mods/secret-private-mod.jar", "bbb"),
        ];
        let lock = build(
            "Survie",
            "2026-01-01T00:00:00Z",
            runtime(),
            &locked,
            &origins(),
        );

        // Nothing installed: both files are missing.
        let report = diff(&lock, &[]);

        let can = fetchable(&report);
        assert_eq!(can.len(), 1);
        assert_eq!(can[0].path, "mods/sodium.jar");
        assert_eq!(can[0].source.as_ref().unwrap().version_id, "mc1.21-0.6.0");

        // The rebuild will not match the lockfile, and this is the honest reason.
        let cannot = unfetchable(&report);
        assert_eq!(cannot.len(), 1);
        assert_eq!(cannot[0].path, "mods/secret-private-mod.jar");
    }

    #[test]
    fn an_extra_file_is_never_offered_for_download() {
        let lock = build("Survie", "2026-01-01T00:00:00Z", runtime(), &[], &origins());
        let report = diff(&lock, &[entry("mods/extra.jar", "ddd")]);

        // An extra file exists locally; there is nothing to fetch for it, and
        // treating it as fetchable would try to download a file we have.
        assert!(fetchable(&report).is_empty());
        assert!(unfetchable(&report).is_empty());
    }
}
