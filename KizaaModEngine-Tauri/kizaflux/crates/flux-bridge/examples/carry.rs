//! Carries every jar of a folder over with Horizon's port-pack and prints
//! each verdict: `cargo run -p flux-bridge --release --example carry -- <mods folder> <checks folder>`.
//! The jars are only read; the carries land in the checks folder.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let folder = PathBuf::from(&args[0]);
    let checks = PathBuf::from(&args[1]);
    let mut jars: Vec<PathBuf> = std::fs::read_dir(&folder)
        .expect("readable folder")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jar"))
        .collect();
    jars.sort();
    let started = Instant::now();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for (index, jar) in jars.iter().enumerate() {
        let name = jar.file_name().unwrap().to_string_lossy().into_owned();
        let one = Instant::now();
        match flux_bridge::check(jar, &format!("{index:04}"), &checks) {
            Ok(check) => {
                *counts.entry(check.verdict.label().to_string()).or_default() += 1;
                println!(
                    "{:<12} {:>6.2}s {:<44} {} | ports: {}",
                    check.verdict.label(),
                    one.elapsed().as_secs_f64(),
                    name.chars().take(44).collect::<String>(),
                    check.summary,
                    check.ports.join(", ")
                );
            }
            Err(error) => {
                *counts.entry("error".into()).or_default() += 1;
                println!("{:<12} {name}: {error}", "error");
            }
        }
    }
    println!(
        "\n{} jars in {:.1?}: {counts:?}",
        jars.len(),
        started.elapsed()
    );
}
