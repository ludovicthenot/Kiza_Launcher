//! The launcher itself, carried inside this binary.
//!
//! Kiza Setup ships the whole product rather than downloading it: an installer
//! that needs the network is an installer that fails on the machine of the
//! person who was already having trouble.
//!
//! The archive is a plain zip, added at build time by `build.rs`. A build that
//! was never given one still compiles — it just carries an empty archive and
//! says so, which is far better than a binary that looks installable and writes
//! nothing.

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use crate::layout::SUPERSEDED_SUFFIX;

/// Written by `build.rs`, into `OUT_DIR` so that no 40 MB blob ever has to live
/// in the repository.
const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.zip"));

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub bytes: u64,
}

/// True when this binary was built without a payload.
///
/// The interface uses it to refuse the install outright. A setup that runs to
/// "Done" having copied nothing is the one failure mode nobody would think to
/// check for.
pub fn is_placeholder() -> bool {
    entries(PAYLOAD).map(|list| list.is_empty()).unwrap_or(true)
}

pub fn installed_size() -> u64 {
    entries(PAYLOAD)
        .map(|list| list.iter().map(|entry| entry.bytes).sum())
        .unwrap_or(0)
}

fn entries(archive: &[u8]) -> Result<Vec<Entry>, String> {
    if archive.is_empty() {
        return Ok(Vec::new());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(|error| error.to_string())?;
    let mut list = Vec::new();
    for index in 0..zip.len() {
        let file = zip.by_index(index).map_err(|error| error.to_string())?;
        if file.is_dir() {
            continue;
        }
        list.push(Entry {
            name: file.name().to_string(),
            bytes: file.size(),
        });
    }
    Ok(list)
}

/// Unpacks the payload into `install_dir`, reporting progress as a fraction of
/// the total bytes written.
pub fn install_into(
    install_dir: &Path,
    mut on_progress: impl FnMut(f64, &str),
) -> Result<(), String> {
    extract(PAYLOAD, install_dir, &mut on_progress)
}

fn extract(
    archive: &[u8],
    install_dir: &Path,
    on_progress: &mut impl FnMut(f64, &str),
) -> Result<(), String> {
    if archive.is_empty() {
        return Err("This build of Kiza Setup carries no launcher to install.".to_string());
    }

    std::fs::create_dir_all(install_dir)
        .map_err(|error| format!("Could not create {}: {error}", install_dir.display()))?;

    let total: u64 = entries(archive)?.iter().map(|entry| entry.bytes).sum();
    let total = total.max(1);
    let mut written = 0u64;

    let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(|error| error.to_string())?;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|error| error.to_string())?;

        // `enclosed_name` refuses `..` and absolute paths. Without it a crafted
        // archive could write anywhere on the disk the installer can reach.
        let relative = file
            .enclosed_name()
            .ok_or_else(|| format!("The payload holds an unsafe path: {}", file.name()))?;
        let destination = install_dir.join(&relative);

        if file.is_dir() {
            std::fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        replace_file(&destination, &bytes)?;

        written += bytes.len() as u64;
        on_progress(
            (written as f64 / total as f64).clamp(0.0, 1.0),
            &relative.to_string_lossy(),
        );
    }

    Ok(())
}

/// Writes `bytes` to `path`, even when the file that is already there is
/// running.
///
/// Windows will not let a running executable be deleted, but it will let it be
/// renamed. That is the whole trick behind updating a launcher that is, at that
/// moment, still shutting down: move the old one aside, put the new one in
/// place, and clear the leftovers on the next run.
pub fn replace_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() && std::fs::remove_file(path).is_err() {
        let aside = next_superseded_name(path);
        std::fs::rename(path, &aside).map_err(|error| {
            format!(
                "{} is in use and could not be moved aside: {error}",
                path.display()
            )
        })?;
    }

    std::fs::write(path, bytes)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))
}

/// A free name to park a locked file under. Numbered, because an update can run
/// twice before Windows releases the first one.
fn next_superseded_name(path: &Path) -> PathBuf {
    let base = format!("{}{SUPERSEDED_SUFFIX}", path.to_string_lossy());
    let first = PathBuf::from(&base);
    if !first.exists() {
        return first;
    }
    for attempt in 1..1000 {
        let candidate = PathBuf::from(format!("{base}.{attempt}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from(format!("{base}.{}", std::process::id()))
}

/// Deletes the files an earlier update had to park aside.
///
/// Returns how many are still locked, so a caller can decide whether it is
/// worth saying anything. Failing to remove one is not an error: the process
/// holding it will exit eventually, and the next run will get it.
pub fn sweep_superseded(install_dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(install_dir) else {
        return 0;
    };

    let mut still_locked = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_string_lossy().contains(SUPERSEDED_SUFFIX) {
            continue;
        }
        if std::fs::remove_file(entry.path()).is_err() {
            still_locked += 1;
        }
    }
    still_locked
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn archive_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            for (name, bytes) in files {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(bytes).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    #[test]
    fn every_file_in_the_payload_reaches_the_install_folder() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("Kiza Launcher");
        let archive = archive_of(&[
            ("Kiza Launcher.exe", b"the launcher"),
            ("resources/icon.ico", b"an icon"),
        ]);

        extract(&archive, &target, &mut |_, _| {}).unwrap();

        assert_eq!(
            std::fs::read(target.join("Kiza Launcher.exe")).unwrap(),
            b"the launcher"
        );
        assert_eq!(
            std::fs::read(target.join("resources").join("icon.ico")).unwrap(),
            b"an icon"
        );
    }

    #[test]
    fn progress_ends_at_one_and_never_goes_backwards() {
        let root = tempfile::tempdir().unwrap();
        let archive = archive_of(&[("a", &[0u8; 100]), ("b", &[0u8; 300])]);

        let mut seen = Vec::new();
        extract(&archive, root.path(), &mut |fraction, _| {
            seen.push(fraction)
        })
        .unwrap();

        assert!(seen.windows(2).all(|pair| pair[1] >= pair[0]));
        assert_eq!(seen.last().copied(), Some(1.0));
    }

    #[test]
    fn an_archive_that_tries_to_escape_the_install_folder_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("install");
        let archive = archive_of(&[("../../evil.exe", b"nope")]);

        let error = extract(&archive, &target, &mut |_, _| {}).unwrap_err();

        assert!(error.contains("unsafe path"), "{error}");
        assert!(!root.path().join("evil.exe").exists());
    }

    #[test]
    fn a_build_without_a_payload_says_so_instead_of_installing_nothing() {
        let root = tempfile::tempdir().unwrap();
        let error = extract(&[], root.path(), &mut |_, _| {}).unwrap_err();
        assert!(error.contains("no launcher"), "{error}");
    }

    #[test]
    fn an_existing_install_is_written_over() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("Kiza Launcher.exe"), b"version 1").unwrap();

        extract(
            &archive_of(&[("Kiza Launcher.exe", b"version 2")]),
            root.path(),
            &mut |_, _| {},
        )
        .unwrap();

        assert_eq!(
            std::fs::read(root.path().join("Kiza Launcher.exe")).unwrap(),
            b"version 2"
        );
    }

    #[test]
    fn a_file_parked_aside_gets_a_free_name_each_time() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Kiza Launcher.exe");
        std::fs::write(&path, b"x").unwrap();

        let first = next_superseded_name(&path);
        std::fs::write(&first, b"x").unwrap();
        let second = next_superseded_name(&path);

        assert_ne!(first, second);
        assert!(second.to_string_lossy().ends_with(".1"));
    }

    #[test]
    fn leftovers_from_an_earlier_update_are_cleared() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("Kiza Launcher.exe"), b"current").unwrap();
        std::fs::write(
            root.path()
                .join(format!("Kiza Launcher.exe{SUPERSEDED_SUFFIX}")),
            b"old",
        )
        .unwrap();
        std::fs::write(
            root.path()
                .join(format!("Kiza Launcher.exe{SUPERSEDED_SUFFIX}.1")),
            b"older",
        )
        .unwrap();

        assert_eq!(sweep_superseded(root.path()), 0);

        assert!(root.path().join("Kiza Launcher.exe").exists());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn sweeping_a_folder_that_is_not_there_is_not_an_error() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(sweep_superseded(&root.path().join("missing")), 0);
    }
}
