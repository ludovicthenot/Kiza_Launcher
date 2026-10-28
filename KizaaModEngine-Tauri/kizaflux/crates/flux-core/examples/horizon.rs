//! Drives Flux Core's Horizon steps by hand, the way the launcher will:
//!
//! ```text
//! horizon install <zip> <SHA256SUMS> <SHA256SUMS.sig> <tag> <destination>
//! horizon seed    <installed> <mojang version file>
//! horizon prepare <installed> <java home> <minecraft dir> <server jar>
//! horizon sounds  <installed> <java home> <minecraft dir>
//! horizon play    <installed> <game dir> [extra arguments for the game...]
//! ```
//!
//! Each step prints how long it took. The token-free `play` is offline.

use std::path::{Path, PathBuf};
use std::time::Instant;

use flux_core::horizon::{install, launch, layout::Installed, signature};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let path = |i: usize| {
        PathBuf::from(
            args.get(i)
                .unwrap_or_else(|| panic!("argument {i} missing")),
        )
    };
    let started = Instant::now();
    let result = match args.first().map(String::as_str) {
        Some("install") => install_release(&path(1), &path(2), &path(3), &args[4], &path(5)),
        Some("seed") => Installed::open(&path(1))
            .and_then(|i| i.seed_manifest(&std::fs::read(path(2)).map_err(|e| e.to_string())?)),
        Some("prepare") => Installed::open(&path(1))
            .and_then(|i| run(launch::prepare_command(&i, &path(2), &path(3), &path(4)))),
        Some("sounds") => Installed::open(&path(1))
            .and_then(|i| run(launch::sounds_command(&i, &path(2), &path(3)))),
        Some("play") => Installed::open(&path(1)).and_then(|i| {
            let options = launch::PlayOptions {
                game_dir: path(2),
                extra_args: args[3..].to_vec(),
                ..Default::default()
            };
            std::fs::create_dir_all(&options.game_dir).map_err(|e| e.to_string())?;
            run(launch::play_command(&i, &options))
        }),
        _ => Err("install | seed | prepare | sounds | play".into()),
    };
    let elapsed = started.elapsed();
    match result {
        Ok(()) => println!("ok in {elapsed:.2?}"),
        Err(error) => {
            eprintln!("error after {elapsed:.2?}: {error}");
            std::process::exit(1);
        }
    }
}

fn install_release(
    zip: &Path,
    sums: &Path,
    sig: &Path,
    tag: &str,
    destination: &Path,
) -> Result<(), String> {
    let read = |p: &Path| std::fs::read(p).map_err(|e| format!("{}: {e}", p.display()));
    let asset = zip.file_name().unwrap().to_string_lossy().into_owned();
    let sha256 = signature::signed_digest(
        tag,
        &asset,
        &read(sums)?,
        &String::from_utf8_lossy(&read(sig)?),
        &signature::trusted_keys(),
    )?;
    println!("signed SHA-256 of {asset}: {sha256}");
    let record = install::InstallRecord {
        tag: tag.into(),
        asset,
        sha256,
    };
    install::install(
        &read(zip)?,
        &record,
        destination,
        &install::Limits::default(),
    )
}

fn run(mut command: std::process::Command) -> Result<(), String> {
    let status = command.status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("exited with {status}"))
    }
}
