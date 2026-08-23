//! Builds the archive that gets embedded in Kiza Setup.
//!
//!     pack-payload <folder> <payload.zip>
//!
//! This exists rather than a `Compress-Archive` one-liner because of size.
//! Deflate — all PowerShell offers — turns the 37 MB launcher into 19 MB, where
//! zstd gets it under 10, and that difference is a download every user pays for.
//! Doing it here also guarantees the archive is written by exactly the library
//! that will read it back.

use std::io::Write;
use std::path::Path;

use zip::write::SimpleFileOptions;

/// Near the top of zstd's range. The extra seconds are paid once per release;
/// the smaller download is paid back on every install.
const LEVEL: i64 = 19;

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.len() != 3 {
        eprintln!("usage: pack-payload <folder> <payload.zip>");
        std::process::exit(2);
    }

    let source = Path::new(&arguments[1]);
    let destination = Path::new(&arguments[2]);

    if let Err(error) = pack(source, destination) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn pack(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let file = std::fs::File::create(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    let mut writer = zip::ZipWriter::new(std::io::BufWriter::new(file));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Zstd)
        .compression_level(Some(LEVEL))
        // The launcher is comfortably over 4 GB away from needing it, but a
        // future payload with resources should not silently hit the limit.
        .large_file(false);

    let mut count = 0;
    let mut total = 0u64;
    for entry in walk(source)? {
        let relative = entry
            .strip_prefix(source)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            // Zip paths use forward slashes whatever the platform.
            .replace('\\', "/");

        let bytes = std::fs::read(&entry)
            .map_err(|error| format!("Could not read {}: {error}", entry.display()))?;

        writer
            .start_file(&relative, options)
            .map_err(|error| error.to_string())?;
        writer
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;

        count += 1;
        total += bytes.len() as u64;
        println!("  {relative}  ({} MB)", megabytes(bytes.len() as u64));
    }

    writer.finish().map_err(|error| error.to_string())?;

    if count == 0 {
        return Err(format!("{} held no files to pack.", source.display()));
    }

    let packed = std::fs::metadata(destination)
        .map_err(|error| error.to_string())?
        .len();
    println!(
        "packed {count} file(s): {} MB -> {} MB",
        megabytes(total),
        megabytes(packed)
    );
    Ok(())
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / 1024.0 / 1024.0)
}

/// Every file under `root`, directories flattened away — the extractor recreates
/// them from the entry names.
fn walk(root: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];

    while let Some(directory) = pending.pop() {
        let entries = std::fs::read_dir(&directory)
            .map_err(|error| format!("Could not read {}: {error}", directory.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                found.push(path);
            }
        }
    }

    // Deterministic, so two builds of the same input produce the same archive.
    found.sort();
    Ok(found)
}
