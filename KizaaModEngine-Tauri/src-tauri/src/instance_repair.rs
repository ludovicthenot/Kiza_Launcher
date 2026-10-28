//! One button that looks at everything an instance needs to start, says
//! what it found, and mends what it can.
//!
//! Each check that used to exist lived in one place and answered one
//! question -- "are the game files here", asked at launch; "does the
//! catalogue match the folder", asked by the Mods tab -- and none of them
//! was somewhere a person could go when the game would not start and ask
//! "what is wrong with this instance". This is that place. The report is
//! honest about three things: what is fine, what was put right here and
//! now, and what needs a hand.

use crate::content_provenance;
use crate::game_manager::GameInstance;
use crate::minecraft_manager;
use crate::mod_manager::ModManager;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Nothing to do.
    Ok,
    /// Was wrong, is right now.
    Fixed,
    /// Wrong, and the launcher cannot mend it alone; `detail` says what to do.
    Broken,
    /// Worth knowing, not wrong.
    Info,
}

/// One thing looked at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Check {
    /// `game`, `natives`, `mods`, `catalogue`.
    pub area: String,
    pub title: String,
    pub verdict: Verdict,
    pub detail: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RepairReport {
    pub checks: Vec<Check>,
    /// True when the game files need the installer to run again; the caller
    /// starts it, since that is a long job with its own progress.
    pub reinstall_started: bool,
    /// Mods the catalogue knows, whose file is gone, and whose origin is
    /// recorded -- the caller fetches them, since that needs the network.
    pub refetch: Vec<Refetch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Refetch {
    pub mod_id: String,
    pub name: String,
    pub file: String,
    pub origin: content_provenance::ContentOrigin,
}

impl RepairReport {
    fn note(&mut self, area: &str, title: impl Into<String>, verdict: Verdict, detail: impl Into<String>) {
        self.checks.push(Check {
            area: area.to_string(),
            title: title.into(),
            verdict,
            detail: detail.into(),
        });
    }

}

/// Whether the bytes on disk open as a jar. A download cut short leaves a
/// file with the right name and nothing the loader can read.
fn opens_as_jar(path: &Path) -> bool {
    fs::File::open(path)
        .ok()
        .and_then(|file| zip::ZipArchive::new(file).ok())
        .is_some()
}

/// Everything about the game files and the folder, without the network.
///
/// The game-file check is the same one a launch runs; it says whether the
/// installer has to run again, and the caller starts that. The folder
/// checks mend what a folder check can: nothing, mostly, but they name
/// each thing precisely.
pub fn examine(app_data_dir: &Path, instance: &GameInstance) -> RepairReport {
    let mut report = RepairReport::default();
    let game_dir = PathBuf::from(&instance.install_path);
    let Some(mc) = instance.minecraft.as_ref() else {
        report.note("game", "Not a Minecraft instance", Verdict::Broken, "Nothing here to check.");
        return report;
    };

    // 1. The game itself: client, asset index, every library and native
    //    archive, at the size the manifest says.
    match minecraft_manager::verify_minecraft_installation_ready(app_data_dir, instance, true) {
        Ok(()) => report.note(
            "game",
            format!("Minecraft {} and its libraries", mc.mc_version),
            Verdict::Ok,
            "Client, asset index, libraries and native archives are all present at the expected size.",
        ),
        Err(reason) => {
            report.reinstall_started = true;
            report.note(
                "game",
                format!("Minecraft {} and its libraries", mc.mc_version),
                Verdict::Fixed,
                format!("Something was missing or damaged, so the installer is running again. ({reason})"),
            );
        }
    }

    // 2. The natives folder for this loader build. Filled at launch when
    //    empty, so an empty one is worth a line and not a worry.
    let natives_version = minecraft_manager::natives_version_id(mc, &mc.mc_version);
    let natives_dir = minecraft_manager::instance_natives_dir_path(app_data_dir, &instance.id, &natives_version);
    let dll_count = fs::read_dir(&natives_dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("dll"))
                })
                .count()
        })
        .unwrap_or(0);
    if dll_count > 0 {
        report.note(
            "natives",
            "Native libraries",
            Verdict::Ok,
            format!("{dll_count} native libraries unpacked for this loader build."),
        );
    } else {
        report.note(
            "natives",
            "Native libraries",
            Verdict::Info,
            "The natives folder is empty; it is filled from the downloaded archives at the next launch.",
        );
    }

    // 3. The catalogue against the folder: every mod Kiza lists should be a
    //    readable jar in `mods/`.
    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(&instance.id);
    let mut listed: BTreeSet<String> = BTreeSet::new();
    let mut missing_without_origin = Vec::new();
    let mut damaged = Vec::new();
    for entry in &mods {
        for file in &entry.files {
            let relative = file.replace('\\', "/");
            let Some(name) = relative.strip_prefix("mods/") else {
                continue;
            };
            listed.insert(name.to_string());
            let on_disk = game_dir.join("mods").join(name);
            let disabled = game_dir.join("mods").join(format!("{name}.disabled"));
            let present = if on_disk.is_file() {
                Some(&on_disk)
            } else if disabled.is_file() {
                Some(&disabled)
            } else {
                None
            };
            let gone = present.is_none();
            match present {
                Some(path) if opens_as_jar(path) => {}
                Some(_) | None => {
                    let origin = content_provenance::get(app_data_dir, &instance.id, &relative);
                    match origin {
                        Some(origin) => report.refetch.push(Refetch {
                            mod_id: entry.id.clone(),
                            name: entry.name.clone(),
                            file: relative.clone(),
                            origin,
                        }),
                        None if gone => missing_without_origin.push(format!("{} ({name})", entry.name)),
                        None => damaged.push(format!("{} ({name})", entry.name)),
                    }
                }
            }
        }
    }
    if report.refetch.is_empty() && missing_without_origin.is_empty() && damaged.is_empty() {
        report.note(
            "mods",
            "Catalogued mods",
            Verdict::Ok,
            format!("{} mods listed, every file present and readable.", mods.len()),
        );
    }
    if !report.refetch.is_empty() {
        report.note(
            "mods",
            "Mods to fetch again",
            Verdict::Fixed,
            format!(
                "{} mod file(s) missing or unreadable, with a known origin: fetched again now. {}",
                report.refetch.len(),
                report
                    .refetch
                    .iter()
                    .map(|item| item.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        );
    }
    if !missing_without_origin.is_empty() {
        report.note(
            "mods",
            "Mods whose file is gone",
            Verdict::Broken,
            format!(
                "Listed in the catalogue, absent from the folder, and Kiza does not know where they came from. Add the file again with Add a mod, or remove the entry: {}",
                missing_without_origin.join(", ")
            ),
        );
    }
    if !damaged.is_empty() {
        report.note(
            "mods",
            "Damaged mod files",
            Verdict::Broken,
            format!(
                "These files do not open as jars -- a download cut short, most likely -- and Kiza does not know where to fetch them from. Replace them by hand: {}",
                damaged.join(", ")
            ),
        );
    }

    // 4. The folder against the catalogue: a jar Kiza does not list loads all
    //    the same, and cannot be switched off, updated or exported.
    let mut unlisted = Vec::new();
    let mut disabled = Vec::new();
    if let Ok(entries) = fs::read_dir(game_dir.join("mods")) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !entry.path().is_file() {
                continue;
            }
            if let Some(stem) = name.strip_suffix(".disabled") {
                disabled.push(stem.to_string());
                continue;
            }
            if name.ends_with(".jar") && !listed.contains(&name) {
                unlisted.push(name);
            }
        }
    }
    if unlisted.is_empty() {
        report.note("catalogue", "Files in the mods folder", Verdict::Ok, "Every jar in the folder is in the catalogue.");
    } else {
        report.note(
            "catalogue",
            "Jars Kiza does not list",
            Verdict::Info,
            format!(
                "{} jar(s) in the folder are not in the catalogue. They load, but cannot be switched off or updated from here: {}",
                unlisted.len(),
                unlisted.join(", ")
            ),
        );
    }
    if !disabled.is_empty() {
        report.note(
            "catalogue",
            "Disabled mods",
            Verdict::Info,
            format!(
                "{} mod(s) are switched off. A pack that needs one of them will not start until it is on again: {}",
                disabled.len(),
                disabled.join(", ")
            ),
        );
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_manager::{GameInstanceStatus, MinecraftInstanceConfig, MinecraftLoader};

    fn jar_bytes() -> Vec<u8> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            writer
                .start_file("mcmod.info", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut writer, b"[]").unwrap();
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    fn instance(game: &Path) -> GameInstance {
        GameInstance {
            id: "rl".to_string(),
            game_id: "minecraft".to_string(),
            display_name: "RL".to_string(),
            install_path: game.to_string_lossy().to_string(),
            executable_path: String::new(),
            mods_path: String::new(),
            detected_variant: None,
            minecraft: Some(MinecraftInstanceConfig {
                mc_version: "1.12.2".to_string(),
                loader: MinecraftLoader::Forge,
                loader_version: Some("14.23.5.2860".to_string()),
                java_major: None,
                engine: crate::game_manager::Engine::Java,
            }),
            status: GameInstanceStatus::Valid,
            created_at: String::new(),
            last_verified_at: None,
            schema_version: 1,
        }
    }

    /// A folder where one catalogued mod is gone (with origin: fetched
    /// again), one is a broken download (no origin: named), one jar nobody
    /// listed, and one switched off.
    #[test]
    fn the_report_names_what_is_missing_damaged_unlisted_and_off() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("data");
        let game = root.path().join("game");
        fs::create_dir_all(game.join("mods")).unwrap();
        fs::write(game.join("mods/good.jar"), jar_bytes()).unwrap();
        fs::write(game.join("mods/broken.jar"), b"not a jar").unwrap();
        fs::write(game.join("mods/stray.jar"), jar_bytes()).unwrap();
        fs::write(game.join("mods/switchbow.jar.disabled"), jar_bytes()).unwrap();

        let manager = ModManager::new(app_data.clone());
        for (name, file) in [("Good", "good.jar"), ("Broken", "broken.jar"), ("Gone", "gone.jar")] {
            let source = root.path().join(file);
            fs::write(&source, if file == "broken.jar" { b"not a jar".to_vec() } else { jar_bytes() }).unwrap();
            manager
                .install_mod_file(
                    "rl",
                    &source.to_string_lossy(),
                    &format!("mods/{file}"),
                    Some(crate::mod_manager::ModMetadata {
                        name: Some(name.to_string()),
                        version: Some("1".to_string()),
                        ..Default::default()
                    }),
                )
                .unwrap();
        }
        // The catalogue's staging copy is not the game folder: "gone" is
        // listed and absent from `mods/`, and its origin is known.
        let _ = fs::remove_file(game.join("mods/gone.jar"));
        content_provenance::record(
            &app_data,
            "rl",
            "mods/gone.jar",
            content_provenance::ContentOrigin {
                provider: "modrinth".to_string(),
                project_id: "P".to_string(),
                version_id: "V".to_string(),
                pinned: false,
            },
        )
        .unwrap();

        let report = examine(&app_data, &instance(&game));
        let titled = |title: &str| {
            report
                .checks
                .iter()
                .find(|check| check.title == title)
                .unwrap_or_else(|| panic!("no check {title:?} in {:?}", report.checks))
        };
        assert_eq!(report.refetch.len(), 1);
        assert_eq!(report.refetch[0].file, "mods/gone.jar");
        assert_eq!(titled("Mods to fetch again").verdict, Verdict::Fixed);
        let damaged = titled("Damaged mod files");
        assert_eq!(damaged.verdict, Verdict::Broken);
        assert!(damaged.detail.contains("broken.jar"), "{}", damaged.detail);
        let unlisted = titled("Jars Kiza does not list");
        assert!(unlisted.detail.contains("stray.jar"));
        assert!(!unlisted.detail.contains("good.jar"));
        let off = titled("Disabled mods");
        assert!(off.detail.contains("switchbow.jar"));
        // The game files are not there in a temp folder: the installer runs.
        assert!(report.reinstall_started);
    }
}
