//! Reports on every archive in a folder:
//! `cargo run -p flux-diagnostics --example scan -- <folder> [minecraft] [--json]`.
//! Reads only: nothing is extracted or changed.

use std::collections::BTreeMap;
use std::path::PathBuf;

use flux_diagnostics::{analyze_file, Limits, Status, Target};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");
    let mut positional = args.iter().filter(|a| !a.starts_with("--"));
    let folder = PathBuf::from(positional.next().expect("a folder of mods"));
    let target = Target {
        minecraft: positional.next().cloned().unwrap_or_else(|| "26.3".into()),
    };

    let mut files: Vec<PathBuf> = std::fs::read_dir(&folder)
        .expect("readable folder")
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .is_some_and(|e| e == "jar" || e == "zip" || e == "hmod")
        })
        .collect();
    files.sort();

    let started = std::time::Instant::now();
    let mut reports = Vec::new();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for path in &files {
        match analyze_file(path, &target, &Limits::default()) {
            Ok(report) => {
                *counts.entry(format!("{:?}", report.status)).or_default() += 1;
                if !json {
                    println!(
                        "{:<20} {:<28} {:<42} {}",
                        format!("{:?}", report.status),
                        format!("{:?}", report.kind),
                        report.file_name.chars().take(42).collect::<String>(),
                        report
                            .reasons
                            .first()
                            .map(String::as_str)
                            .unwrap_or_default()
                    );
                }
                reports.push(report);
            }
            Err(error) => {
                *counts.entry("Error".into()).or_default() += 1;
                eprintln!("{}: {error}", path.display());
            }
        }
    }
    if json {
        println!("{}", serde_json::to_string_pretty(&reports).unwrap());
        return;
    }
    let replaced = reports.iter().filter(|r| r.replaced_by_engine).count();
    let compatible = reports
        .iter()
        .filter(|r| r.status == Status::CompatibleTested)
        .count();
    println!(
        "\n{} archives in {:.2?} for Minecraft {}: {counts:?}; {replaced} replaced by the engine; {compatible} compatible and tested",
        files.len(),
        started.elapsed(),
        target.minecraft
    );
}
