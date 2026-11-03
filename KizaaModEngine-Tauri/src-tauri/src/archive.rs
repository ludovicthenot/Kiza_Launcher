//! Whatever archive the reader hands over, opened as a zip.
//!
//! A modpack arrives as a `.zip` from CurseForge, an `.mrpack` from Modrinth,
//! and from everywhere else as whatever the person who packed it had to hand:
//! a `.7z`, a `.rar`, a `.tar.gz`. Everything downstream -- the pack
//! importers, the mod installer -- reads a zip, and teaching each of them
//! four more formats would be four copies of the same care about paths and
//! sizes. So a foreign archive is unpacked once, here, into a temporary zip
//! that lives as long as the handle, and the rest never learns it was not a
//! zip to begin with.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

/// Every extension this module reads, for the file pickers.
pub const EXTENSIONS: &[&str] = &[
    "zip", "jar", "mrpack", "7z", "rar", "tar", "gz", "tgz", "xz", "txz", "bz2", "tbz2", "tbz",
    "zst", "tzst", "lzma", "tlz",
];

/// What no unpacked archive may exceed: a pack is hundreds of megabytes at
/// the very most, and a bomb is not a pack.
const MAX_UNPACKED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Zip,
    SevenZ,
    Rar,
    Tar,
    TarGz,
    TarXz,
    TarBz2,
    /// Zstandard: the modern one, much faster to unpack than xz at a
    /// similar size, and what more and more packs and backups are made with.
    TarZst,
    /// The raw LZMA stream that came before xz, still met in older packs.
    TarLzma,
}

/// The kind, from the name first and the first bytes second: a `.zip`
/// renamed `.rar` is still a zip, and a file with no extension can still be
/// read.
fn kind_of(path: &Path) -> Option<Kind> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let by_name = if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        Some(Kind::TarGz)
    } else if name.ends_with(".tar.xz") || name.ends_with(".txz") {
        Some(Kind::TarXz)
    } else if name.ends_with(".tar.bz2") || name.ends_with(".tbz2") || name.ends_with(".tbz") {
        Some(Kind::TarBz2)
    } else if name.ends_with(".tar.zst") || name.ends_with(".tzst") {
        Some(Kind::TarZst)
    } else if name.ends_with(".tar.lzma") || name.ends_with(".tlz") {
        Some(Kind::TarLzma)
    } else {
        match name.rsplit('.').next() {
            Some("zip" | "jar" | "mrpack") => Some(Kind::Zip),
            Some("7z") => Some(Kind::SevenZ),
            Some("rar") => Some(Kind::Rar),
            Some("tar") => Some(Kind::Tar),
            Some("gz") => Some(Kind::TarGz),
            Some("xz") => Some(Kind::TarXz),
            Some("bz2") => Some(Kind::TarBz2),
            Some("zst") => Some(Kind::TarZst),
            Some("lzma") => Some(Kind::TarLzma),
            _ => None,
        }
    };
    let by_magic = magic_kind(path);
    match (by_magic, by_name) {
        // The bytes know better than the name, when they say anything.
        (Some(kind), _) => Some(kind),
        (None, kind) => kind,
    }
}

fn magic_kind(path: &Path) -> Option<Kind> {
    let mut head = [0u8; 8];
    let read = fs::File::open(path).ok()?.read(&mut head).ok()?;
    let head = &head[..read];
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        Some(Kind::Zip)
    } else if head.starts_with(b"7z\xBC\xAF\x27\x1C") {
        Some(Kind::SevenZ)
    } else if head.starts_with(b"Rar!\x1A\x07") {
        Some(Kind::Rar)
    } else if head.starts_with(&[0x1F, 0x8B]) {
        Some(Kind::TarGz)
    } else if head.starts_with(&[0xFD, b'7', b'z', b'X', b'Z', 0x00]) {
        Some(Kind::TarXz)
    } else if head.starts_with(b"BZh") {
        Some(Kind::TarBz2)
    } else if head.starts_with(&[0x28, 0xB5, 0x2F, 0xFD]) {
        Some(Kind::TarZst)
    } else {
        None
    }
}

/// An archive readable as a zip, for as long as this is held.
#[derive(Debug)]
pub struct AsZip {
    pub path: PathBuf,
    /// The unpacked copy of a foreign archive, deleted with the handle.
    _scratch: Option<tempfile::TempDir>,
}

/// Opens any supported archive as a zip on disk.
///
/// A zip is returned as it is. Anything else is unpacked into a scratch
/// folder with every path checked, then stored -- not compressed, it is
/// read once and thrown away -- into a zip beside it.
pub fn as_zip(path: &Path) -> Result<AsZip, String> {
    let kind = kind_of(path).ok_or_else(|| {
        format!(
            "{} is not an archive this launcher can read (zip, mrpack, 7z, rar, tar, tar.gz, tar.xz, tar.bz2, tar.zst, tar.lzma).",
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default()
        )
    })?;
    if kind == Kind::Zip {
        return Ok(AsZip {
            path: path.to_path_buf(),
            _scratch: None,
        });
    }

    let scratch = tempfile::Builder::new()
        .prefix("kiza-archive-")
        .tempdir()
        .map_err(|error| format!("Could not make a scratch folder: {error}"))?;
    let files = scratch.path().join("files");
    fs::create_dir_all(&files).map_err(|error| error.to_string())?;
    match kind {
        Kind::Zip => unreachable!("returned above"),
        Kind::SevenZ => unpack_7z(path, &files)?,
        Kind::Rar => unpack_rar(path, &files)?,
        Kind::Tar => unpack_tar(fs::File::open(path).map_err(|e| e.to_string())?, &files)?,
        Kind::TarGz => unpack_tar(
            flate2::read::MultiGzDecoder::new(fs::File::open(path).map_err(|e| e.to_string())?),
            &files,
        )?,
        Kind::TarXz => unpack_tar(
            liblzma::read::XzDecoder::new(fs::File::open(path).map_err(|e| e.to_string())?),
            &files,
        )?,
        Kind::TarBz2 => unpack_tar(
            bzip2::read::MultiBzDecoder::new(fs::File::open(path).map_err(|e| e.to_string())?),
            &files,
        )?,
        Kind::TarZst => unpack_tar(
            zstd::stream::read::Decoder::new(fs::File::open(path).map_err(|e| e.to_string())?)
                .map_err(|error| format!("Could not read the Zstandard stream: {error}"))?,
            &files,
        )?,
        Kind::TarLzma => unpack_tar(
            liblzma::read::XzDecoder::new_stream(
                fs::File::open(path).map_err(|e| e.to_string())?,
                liblzma::stream::Stream::new_lzma_decoder(u64::MAX)
                    .map_err(|error| format!("Could not read the LZMA stream: {error}"))?,
            ),
            &files,
        )?,
    }

    let zip_path = scratch.path().join("archive.zip");
    zip_folder(&files, &zip_path)?;
    Ok(AsZip {
        path: zip_path,
        _scratch: Some(scratch),
    })
}

/// A relative path with nothing in it that leaves the folder: no root, no
/// drive, no `..`. Empty for the folder itself (`./`), which a tarball
/// often lists first.
fn safe_relative(raw: &Path) -> Option<PathBuf> {
    let mut safe = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(safe)
}

/// Counts what has been written so far, and refuses the bomb.
struct Budget {
    bytes: u64,
    entries: usize,
}

impl Budget {
    fn new() -> Self {
        Self {
            bytes: 0,
            entries: 0,
        }
    }

    fn entry(&mut self) -> Result<(), String> {
        self.entries += 1;
        if self.entries > MAX_ENTRIES {
            return Err("This archive has too many files.".to_string());
        }
        Ok(())
    }

    fn bytes(&mut self, more: u64) -> Result<(), String> {
        self.bytes = self.bytes.saturating_add(more);
        if self.bytes > MAX_UNPACKED_BYTES {
            return Err("This archive unpacks to more than 4 GiB.".to_string());
        }
        Ok(())
    }
}

/// Copies a stream into `dest`, counting against the budget as it goes,
/// so a stream that lies about its size is still stopped.
fn write_counted(reader: &mut dyn Read, dest: &Path, budget: &mut Budget) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut out = fs::File::create(dest).map_err(|error| error.to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        budget.bytes(read as u64)?;
        out.write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn unpack_7z(path: &Path, dest: &Path) -> Result<(), String> {
    let mut budget = Budget::new();
    let mut failure: Option<String> = None;
    let outcome = sevenz_rust2::decompress_file_with_extract_fn(path, dest, |entry, reader, _| {
        if failure.is_some() {
            return Ok(false);
        }
        let result = (|| -> Result<(), String> {
            budget.entry()?;
            let Some(relative) = safe_relative(Path::new(&entry.name)) else {
                return Err(format!("Unsafe path in archive: {}", entry.name));
            };
            if relative.as_os_str().is_empty() {
                return Ok(());
            }
            let target = dest.join(relative);
            if entry.is_directory {
                fs::create_dir_all(&target).map_err(|error| error.to_string())
            } else {
                write_counted(reader, &target, &mut budget)
            }
        })();
        match result {
            Ok(()) => Ok(true),
            Err(message) => {
                failure = Some(message);
                Ok(false)
            }
        }
    });
    if let Some(message) = failure {
        return Err(message);
    }
    outcome.map_err(|error| format!("Could not read the 7z archive: {error}"))
}

fn unpack_rar(path: &Path, dest: &Path) -> Result<(), String> {
    let mut budget = Budget::new();
    let mut archive = unrar::Archive::new(path)
        .open_for_processing()
        .map_err(|error| format!("Could not open the rar archive: {error}"))?;
    loop {
        let Some(before_file) = archive
            .read_header()
            .map_err(|error| format!("Could not read the rar archive: {error}"))?
        else {
            break;
        };
        budget.entry()?;
        let header = before_file.entry();
        let Some(relative) = safe_relative(&header.filename) else {
            return Err(format!(
                "Unsafe path in archive: {}",
                header.filename.display()
            ));
        };
        if header.is_directory() || relative.as_os_str().is_empty() {
            fs::create_dir_all(dest.join(&relative)).map_err(|error| error.to_string())?;
            archive = before_file
                .skip()
                .map_err(|error| format!("Could not read the rar archive: {error}"))?;
            continue;
        }
        budget.bytes(header.unpacked_size)?;
        let target = dest.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        archive = before_file
            .extract_to(&target)
            .map_err(|error| format!("Could not extract {}: {error}", relative.display()))?;
    }
    Ok(())
}

fn unpack_tar<R: Read>(reader: R, dest: &Path) -> Result<(), String> {
    let mut budget = Budget::new();
    let mut archive = tar::Archive::new(reader);
    for entry in archive
        .entries()
        .map_err(|error| format!("Could not read the tar archive: {error}"))?
    {
        let mut entry =
            entry.map_err(|error| format!("Could not read the tar archive: {error}"))?;
        budget.entry()?;
        let raw = entry
            .path()
            .map_err(|error| error.to_string())?
            .into_owned();
        let Some(relative) = safe_relative(&raw) else {
            return Err(format!("Unsafe path in archive: {}", raw.display()));
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = dest.join(relative);
        match entry.header().entry_type() {
            tar::EntryType::Directory => {
                fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            }
            tar::EntryType::Regular | tar::EntryType::Continuous | tar::EntryType::GNUSparse => {
                write_counted(&mut entry, &target, &mut budget)?;
            }
            // Links and devices have no business in a modpack.
            _ => {}
        }
    }
    Ok(())
}

/// Stores a folder into a zip, uncompressed: it is read once and dropped.
fn zip_folder(folder: &Path, zip_path: &Path) -> Result<(), String> {
    let file = fs::File::create(zip_path).map_err(|error| error.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .large_file(true);
    for entry in walkdir::WalkDir::new(folder)
        .min_depth(1)
        .sort_by_file_name()
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let relative = entry
            .path()
            .strip_prefix(folder)
            .map_err(|error| error.to_string())?;
        let name = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");
        if entry.file_type().is_dir() {
            writer
                .add_directory(format!("{name}/"), options)
                .map_err(|error| error.to_string())?;
        } else if entry.file_type().is_file() {
            writer
                .start_file(name, options)
                .map_err(|error| error.to_string())?;
            let mut source = fs::File::open(entry.path()).map_err(|error| error.to_string())?;
            io::copy(&mut source, &mut writer).map_err(|error| error.to_string())?;
        }
    }
    writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names_in(zip_path: &Path) -> Vec<String> {
        let file = fs::File::open(zip_path).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        let mut names: Vec<String> = archive.file_names().map(str::to_string).collect();
        names.sort();
        names
    }

    fn folder_with_a_pack(root: &Path) -> PathBuf {
        let src = root.join("src");
        fs::create_dir_all(src.join("overrides/config")).unwrap();
        fs::write(src.join("manifest.json"), br#"{"name":"P"}"#).unwrap();
        fs::write(src.join("overrides/config/a.cfg"), b"x=1").unwrap();
        src
    }

    /// A zip is handed back untouched: nothing to unpack, nothing to delete.
    #[test]
    fn a_zip_is_itself() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("pack.zip");
        zip_folder(&folder_with_a_pack(temp.path()), &path).unwrap();
        let opened = as_zip(&path).unwrap();
        assert_eq!(opened.path, path);
        assert!(opened._scratch.is_none());
        assert_eq!(
            names_in(&opened.path),
            vec![
                "manifest.json",
                "overrides/",
                "overrides/config/",
                "overrides/config/a.cfg"
            ]
        );
    }

    /// The same pack as a tar.gz, a tar.xz, a tar.bz2 and a plain tar reads
    /// as the same zip.
    #[test]
    fn a_tarball_becomes_the_same_zip() {
        let temp = tempfile::tempdir().unwrap();
        let src = folder_with_a_pack(temp.path());

        let build_tar = |writer: Box<dyn Write>| {
            let mut tar = tar::Builder::new(writer);
            tar.append_dir_all(".", &src).unwrap();
            tar.finish().unwrap();
        };
        let tar_path = temp.path().join("pack.tar");
        build_tar(Box::new(fs::File::create(&tar_path).unwrap()));
        let gz_path = temp.path().join("pack.tar.gz");
        build_tar(Box::new(flate2::write::GzEncoder::new(
            fs::File::create(&gz_path).unwrap(),
            flate2::Compression::fast(),
        )));
        let xz_path = temp.path().join("pack.txz");
        build_tar(Box::new(liblzma::write::XzEncoder::new(
            fs::File::create(&xz_path).unwrap(),
            1,
        )));
        let bz_path = temp.path().join("pack.tar.bz2");
        build_tar(Box::new(bzip2::write::BzEncoder::new(
            fs::File::create(&bz_path).unwrap(),
            bzip2::Compression::fast(),
        )));

        let zst_path = temp.path().join("pack.tar.zst");
        build_tar(Box::new(
            zstd::stream::write::Encoder::new(fs::File::create(&zst_path).unwrap(), 3)
                .unwrap()
                .auto_finish(),
        ));
        let lzma_path = temp.path().join("pack.tar.lzma");
        build_tar(Box::new(liblzma::write::XzEncoder::new_stream(
            fs::File::create(&lzma_path).unwrap(),
            liblzma::stream::Stream::new_lzma_encoder(
                &liblzma::stream::LzmaOptions::new_preset(1).unwrap(),
            )
            .unwrap(),
        )));

        for path in [tar_path, gz_path, xz_path, bz_path, zst_path, lzma_path] {
            let opened = as_zip(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            assert_ne!(opened.path, path);
            let names = names_in(&opened.path);
            assert!(names.contains(&"manifest.json".to_string()), "{names:?}");
            assert!(
                names.contains(&"overrides/config/a.cfg".to_string()),
                "{names:?}"
            );
        }
    }

    /// A 7z, made with the same crate that reads it.
    #[test]
    fn a_7z_becomes_a_zip() {
        let temp = tempfile::tempdir().unwrap();
        let src = folder_with_a_pack(temp.path());
        let path = temp.path().join("pack.7z");
        sevenz_rust2::compress_to_path(&src, &path).unwrap();
        let opened = as_zip(&path).unwrap();
        let names = names_in(&opened.path);
        assert!(names.contains(&"manifest.json".to_string()), "{names:?}");
        assert!(
            names.contains(&"overrides/config/a.cfg".to_string()),
            "{names:?}"
        );
    }

    /// A rar made by WinRAR itself (tests/fixtures/pack.rar: manifest.json
    /// and overrides/config/a.cfg), since nothing here can write one.
    #[test]
    fn a_rar_becomes_a_zip() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pack.rar");
        let opened = as_zip(&path).unwrap();
        let names = names_in(&opened.path);
        assert!(names.contains(&"manifest.json".to_string()), "{names:?}");
        assert!(
            names.contains(&"overrides/config/a.cfg".to_string()),
            "{names:?}"
        );
        let mut zip = zip::ZipArchive::new(fs::File::open(&opened.path).unwrap()).unwrap();
        let mut text = String::new();
        zip.by_name("overrides/config/a.cfg")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text.trim(), "x=1");
    }

    /// The bytes decide when the name lies, and a name nobody knows is refused.
    #[test]
    fn the_kind_is_read_from_the_bytes_before_the_name() {
        let temp = tempfile::tempdir().unwrap();
        let src = folder_with_a_pack(temp.path());
        let mislabelled = temp.path().join("pack.rar");
        zip_folder(&src, &mislabelled).unwrap();
        assert_eq!(kind_of(&mislabelled), Some(Kind::Zip));
        assert!(as_zip(&mislabelled).is_ok());

        let text = temp.path().join("notes.txt");
        fs::write(&text, b"just text").unwrap();
        assert_eq!(kind_of(&text), None);
        assert!(as_zip(&text).unwrap_err().contains("not an archive"));
    }

    /// A tarball that reaches outside its folder is refused whole.
    #[test]
    fn a_path_that_climbs_out_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("evil.tar");
        {
            let mut tar = tar::Builder::new(fs::File::create(&path).unwrap());
            let data = b"boo";
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            // The tar crate refuses `..` in append_data's path, so the header
            // is written by hand, the way an attacker would.
            let mut raw = tar::Header::new_gnu();
            raw.as_gnu_mut().unwrap().name[..12].copy_from_slice(b"../../escape");
            raw.set_size(data.len() as u64);
            raw.set_mode(0o644);
            raw.set_cksum();
            tar.append(&raw, &data[..]).unwrap();
            tar.finish().unwrap();
        }
        let error = as_zip(&path).unwrap_err();
        assert!(error.contains("Unsafe path"), "{error}");
        assert!(safe_relative(Path::new("a/../b")).is_none());
        assert!(safe_relative(Path::new("/abs")).is_none());
        assert_eq!(
            safe_relative(Path::new("./a/b")),
            Some(PathBuf::from("a/b"))
        );
        assert_eq!(safe_relative(Path::new("./")), Some(PathBuf::new()));
    }
}
