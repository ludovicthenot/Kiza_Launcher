//! Unpacking a downloaded release, once it is known to be Horizon's.
//!
//! The archive's SHA-256 must be the one the signed list gives it; then it is
//! unpacked into a staging folder beside the destination and moved into place
//! only once complete, so a failed or interrupted install never leaves half a
//! game where the launcher would start it. Entries that would land outside
//! the folder are refused, and so is an archive that unpacks to more than a
//! release ever has.

use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// What Kiza writes beside an installed release.
pub const RECORD: &str = "kizaflux-install.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct InstallRecord {
    pub tag: String,
    pub asset: String,
    pub sha256: String,
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_entries: usize,
    pub max_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        // v0.2.95 for Windows: 881 entries, about 90 MB unpacked.
        Self {
            max_entries: 20_000,
            max_bytes: 2 << 30,
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Installs `archive` (the release's zip, already downloaded) into
/// `destination`, which must not exist yet. `expected_sha256` comes from
/// [`super::signature::signed_digest`], never from the download itself.
pub fn install(
    archive: &[u8],
    record: &InstallRecord,
    destination: &Path,
    limits: &Limits,
) -> Result<(), String> {
    let actual = sha256_hex(archive);
    if actual != record.sha256 {
        return Err(format!(
            "The downloaded {} is not the file Horizon signed (SHA-256 {actual}, expected {}).",
            record.asset, record.sha256
        ));
    }
    if destination.exists() {
        return Err(format!("{} is already installed.", record.tag));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| format!("{} has no parent folder.", destination.display()))?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(
        ".{}.staging-{}",
        destination
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        std::process::id()
    ));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    let result = unpack(archive, &staging, limits).and_then(|()| {
        let text = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
        fs::write(staging.join(RECORD), text).map_err(|e| e.to_string())?;
        fs::rename(&staging, destination).map_err(|e| e.to_string())
    });
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Reads the record of an installed release.
pub fn record(installed: &Path) -> Option<InstallRecord> {
    let text = fs::read_to_string(installed.join(RECORD)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Unpacks a release archive, dropping the one folder every release wraps
/// its files in (`horizon-windows-x64/`).
fn unpack(archive: &[u8], into: &Path, limits: &Limits) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|e| format!("Not a zip archive: {e}"))?;
    if zip.len() > limits.max_entries {
        return Err(format!(
            "The archive holds {} entries, more than a release does.",
            zip.len()
        ));
    }
    let declared: u64 = (0..zip.len())
        .filter_map(|i| zip.by_index_raw(i).ok().map(|e| e.size()))
        .sum();
    if declared > limits.max_bytes {
        return Err("The archive unpacks to more than a release does.".into());
    }
    let wrapper = common_root(&mut zip);
    fs::create_dir_all(into).map_err(|e| e.to_string())?;
    let mut written: u64 = 0;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name() else {
            return Err(format!(
                "Refused: {} would land outside the game's folder.",
                entry.name()
            ));
        };
        let relative = match &wrapper {
            Some(root) => match name.strip_prefix(root) {
                Ok(rest) => rest.to_path_buf(),
                Err(_) => name.clone(),
            },
            None => name.clone(),
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        if !relative
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        {
            return Err(format!("Refused: {} is not a plain path.", entry.name()));
        }
        let path = into.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // The headers' sizes were checked; this holds whatever they claimed.
        let mut out = fs::File::create(&path).map_err(|e| e.to_string())?;
        let remaining = limits.max_bytes.saturating_sub(written);
        let copied = std::io::copy(&mut (&mut entry).take(remaining + 1), &mut out)
            .map_err(|e| e.to_string())?;
        written += copied;
        if copied > remaining {
            return Err("The archive unpacks to more than a release does.".into());
        }
    }
    Ok(())
}

/// The single top-level folder all entries share, if there is one.
fn common_root<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>) -> Option<PathBuf> {
    let mut root: Option<PathBuf> = None;
    for index in 0..zip.len() {
        let entry = zip.by_index_raw(index).ok()?;
        let name = entry.enclosed_name()?;
        let first = PathBuf::from(name.components().next()?.as_os_str());
        // A file at the top level means there is no wrapper.
        if name.components().count() == 1 && !entry.is_dir() {
            return None;
        }
        match &root {
            None => root = Some(first),
            Some(existing) if *existing == first => {}
            Some(_) => return None,
        }
    }
    root
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in files {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn record_for(bytes: &[u8]) -> InstallRecord {
        InstallRecord {
            tag: "v0.2.95".into(),
            asset: "horizon-windows-x64.zip".into(),
            sha256: sha256_hex(bytes),
        }
    }

    #[test]
    fn installs_without_the_wrapper_folder() {
        let bytes = archive(&[
            ("horizon-windows-x64/horizon-client.exe", b"MZ"),
            ("horizon-windows-x64/research-lock.json", b"{}"),
            ("horizon-windows-x64/exporters/manifest.json", b"{}"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("v0.2.95");
        install(
            &bytes,
            &record_for(&bytes),
            &destination,
            &Limits::default(),
        )
        .unwrap();
        assert!(destination.join("horizon-client.exe").is_file());
        assert!(destination.join("exporters/manifest.json").is_file());
        assert_eq!(record(&destination).unwrap().tag, "v0.2.95");
        // Nothing left behind beside it.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_file_that_is_not_the_signed_one_is_refused() {
        let bytes = archive(&[("a/b.txt", b"x")]);
        let mut record = record_for(&bytes);
        record.sha256 = "0".repeat(64);
        let dir = tempfile::tempdir().unwrap();
        let error =
            install(&bytes, &record, &dir.path().join("v"), &Limits::default()).unwrap_err();
        assert!(error.contains("not the file Horizon signed"), "{error}");
        assert!(!dir.path().join("v").exists());
    }

    #[test]
    fn an_escaping_entry_leaves_nothing_behind() {
        let bytes = archive(&[("horizon/ok.txt", b"x"), ("../escape.txt", b"x")]);
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("game").join("v1");
        let error = install(
            &bytes,
            &record_for(&bytes),
            &destination,
            &Limits::default(),
        )
        .unwrap_err();
        assert!(error.starts_with("Refused"), "{error}");
        assert!(!destination.exists());
        assert!(!dir.path().join("escape.txt").exists());
        assert_eq!(fs::read_dir(dir.path().join("game")).unwrap().count(), 0);
    }

    #[test]
    fn an_archive_larger_than_a_release_is_refused() {
        let bytes = archive(&[("a/big.bin", &[0u8; 4096])]);
        let dir = tempfile::tempdir().unwrap();
        let limits = Limits {
            max_entries: 10,
            max_bytes: 1024,
        };
        assert!(install(&bytes, &record_for(&bytes), &dir.path().join("v"), &limits).is_err());
    }

    #[test]
    fn an_installed_version_is_not_overwritten() {
        let bytes = archive(&[("a/b.txt", b"x")]);
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("v");
        fs::create_dir_all(&destination).unwrap();
        assert!(install(
            &bytes,
            &record_for(&bytes),
            &destination,
            &Limits::default()
        )
        .is_err());
    }
}
