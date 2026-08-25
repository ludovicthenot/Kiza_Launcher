//! Taking an instance somewhere else, and bringing it back whole.
//!
//! What "export" used to mean here was a `manifest.json` declaring no mods at
//! all, plus `mods/` and `config/` copied into `overrides/`. A real archive on
//! this machine held sixty-eight entries — forty-two configs, twenty-five jars
//! and the manifest — for an instance whose nine-megabyte world it did not
//! mention. Worlds, resource packs, shaderpacks and `options.txt` were simply
//! not in it, and there was nothing to choose: you got that, or nothing.
//!
//! Worse, what came back was not an instance. Kiza keeps its mod catalogue in
//! `config/{id}_mods.json`, the export left it out and the import never rebuilt
//! it, so an imported instance had its jars on disk and an empty Mods tab: no
//! enable, no remove, no update. The files were there and Kiza did not know
//! them.
//!
//! So the archive now carries two manifests. `manifest.json` stays
//! CurseForge-shaped and overrides-only, which is what other launchers and
//! Kiza's own older importer understand. `kiza.json` beside it is the one that
//! makes an instance again: every mod with the project and release it came
//! from, whether it is enabled, what order it loads in, and which worlds
//! travelled.
//!
//! A mod that came from Modrinth or CurseForge travels as a *reference* — a few
//! hundred bytes instead of a few megabytes, and the importer fetches the exact
//! release rather than a plausible one. A mod added from a local file has no
//! release to name, so it is bundled: it is the only copy that exists.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::content_provenance;
use crate::mod_manager::{Mod, ModManager};
use crate::world_vault::{self, WorldSummary};

/// The format version written into `kiza.json`.
///
/// An importer that meets a number it does not know refuses rather than
/// guessing: a half-understood instance is harder to diagnose than a refused
/// one.
pub const FORMAT_VERSION: u32 = 1;

/// What one folder would contribute to the archive.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
    pub present: bool,
    pub file_count: usize,
    pub size_bytes: u64,
}

/// What the mods of an instance would cost, split by how they travel.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModsSummary {
    pub count: usize,
    /// Mods that travel as a project and release, costing nothing but a line.
    pub referenced: usize,
    /// Mods with no known origin, which have to be carried in full.
    pub bundled: usize,
    /// Bytes the bundled ones add to the archive.
    pub bundled_bytes: u64,
}

/// Everything the export window offers, measured rather than assumed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    pub instance_id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub mods: ModsSummary,
    pub config: FolderSummary,
    pub resourcepacks: FolderSummary,
    pub shaderpacks: FolderSummary,
    pub options: FolderSummary,
    /// Listed one by one, with a size each: "include your worlds" is not a
    /// question anyone can answer without knowing which, and how big.
    pub worlds: Vec<WorldSummary>,
}

/// What the user ticked.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSelection {
    #[serde(default)]
    pub mods: bool,
    #[serde(default)]
    pub config: bool,
    #[serde(default)]
    pub resourcepacks: bool,
    #[serde(default)]
    pub shaderpacks: bool,
    #[serde(default)]
    pub options: bool,
    /// Folder names under `saves/`. Empty means no world travels.
    #[serde(default)]
    pub worlds: Vec<String>,
}

impl ExportSelection {
    /// Whether anything at all was chosen.
    ///
    /// Nothing is ticked to begin with, so an archive of a manifest and no
    /// content is the easiest mistake to make here.
    pub fn is_empty(&self) -> bool {
        !self.mods
            && !self.config
            && !self.resourcepacks
            && !self.shaderpacks
            && !self.options
            && self.worlds.is_empty()
    }
}

/// One mod, as it travels.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedMod {
    pub name: String,
    pub version: String,
    pub file_name: String,
    /// Where in the game directory it belongs, e.g. `mods/sodium.jar`.
    pub relative_path: String,
    /// "modrinth" or "curseforge", when the origin is known.
    pub provider: Option<String>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    /// True when the jar itself is inside `overrides/`, because nothing else
    /// could fetch it.
    pub bundled: bool,
    pub enabled: bool,
    pub load_order: i32,
}

/// `kiza.json`: what makes the archive an instance rather than a folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KizaManifest {
    pub format: u32,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub exported_at: String,
    pub mods: Vec<ExportedMod>,
    pub worlds: Vec<String>,
}

/// What an export produced.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub path: String,
    pub size_bytes: u64,
    pub mods_referenced: usize,
    pub mods_bundled: usize,
    pub worlds: usize,
}

fn measure(dir: &Path) -> FolderSummary {
    if !dir.is_dir() {
        return FolderSummary::default();
    }
    let mut summary = FolderSummary {
        present: true,
        ..Default::default()
    };
    for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            summary.file_count += 1;
            summary.size_bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        }
    }
    summary.present = summary.file_count > 0;
    summary
}

fn measure_file(path: &Path) -> FolderSummary {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => FolderSummary {
            present: true,
            file_count: 1,
            size_bytes: meta.len(),
        },
        _ => FolderSummary::default(),
    }
}

/// The jar files a mod owns.
fn jars_of(entry: &Mod) -> Vec<&String> {
    entry
        .files
        .iter()
        .filter(|file| file.ends_with(".jar"))
        .collect()
}

/// Splits the mods into the ones that can be named and the ones that cannot.
///
/// Kept pure so the rule can be tested without an instance on disk: this is the
/// decision that separates a three-hundred-kilobyte archive from a
/// sixty-megabyte one, and it should not be discovered by exporting.
pub fn plan_mods(
    mods: &[Mod],
    known: &std::collections::BTreeMap<String, content_provenance::ContentOrigin>,
    size_of: &dyn Fn(&str) -> u64,
) -> (Vec<ExportedMod>, ModsSummary) {
    let mut planned = Vec::new();
    let mut summary = ModsSummary::default();

    for entry in mods {
        for jar in jars_of(entry) {
            let origin = known.get(jar);
            let bundled = origin.is_none();
            summary.count += 1;
            if bundled {
                summary.bundled += 1;
                summary.bundled_bytes += size_of(jar);
            } else {
                summary.referenced += 1;
            }

            planned.push(ExportedMod {
                name: entry.name.clone(),
                version: entry.version.clone(),
                file_name: jar.rsplit('/').next().unwrap_or(jar).to_string(),
                relative_path: jar.clone(),
                provider: origin.map(|found| found.provider.clone()),
                project_id: origin.map(|found| found.project_id.clone()),
                version_id: origin.map(|found| found.version_id.clone()),
                bundled,
                enabled: entry.enabled,
                load_order: entry.load_order,
            });
        }
    }

    (planned, summary)
}

/// Measures what an instance could contribute, without writing anything.
pub fn plan(app_data_dir: &Path, instance_id: &str, game_dir: &Path) -> ExportPlan {
    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(instance_id);
    let known = content_provenance::all(app_data_dir, instance_id);

    let size_of = |relative: &str| {
        std::fs::metadata(game_dir.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)))
            .map(|meta| meta.len())
            .unwrap_or(0)
    };
    let (planned, mut mods_summary) = plan_mods(&mods, &known, &size_of);
    // Counted here too, so the window promises the same archive the writer
    // produces rather than one short of every hand-dropped jar.
    for stray in stray_jars(game_dir, &planned) {
        mods_summary.count += 1;
        mods_summary.bundled += 1;
        mods_summary.bundled_bytes += size_of(&stray.relative_path);
    }

    ExportPlan {
        instance_id: instance_id.to_string(),
        mods: mods_summary,
        config: measure(&game_dir.join("config")),
        resourcepacks: measure(&game_dir.join("resourcepacks")),
        shaderpacks: measure(&game_dir.join("shaderpacks")),
        options: measure_file(&game_dir.join("options.txt")),
        worlds: world_vault::list_worlds(app_data_dir, instance_id, game_dir),
        ..Default::default()
    }
}

/// The folder names a world selection resolves to, refusing anything that tries
/// to leave `saves/`.
///
/// The names come from the interface, which got them from `plan`, but an
/// argument that reached a zip path unchecked is an argument worth checking.
pub fn safe_world_folders(
    selection: &[String],
    available: &[WorldSummary],
) -> Result<Vec<String>, String> {
    let mut folders = Vec::new();
    for wanted in selection {
        if !available.iter().any(|world| &world.folder == wanted) {
            return Err(format!(
                "There is no world called \"{wanted}\" in this instance."
            ));
        }
        // An empty extension list means "a name, any name" — which is what a
        // world folder is — while every other rule still applies.
        crate::path_security::safe_file_name(wanted, &[])
            .map_err(|error| format!("Invalid world name: {error}"))?;
        folders.push(wanted.clone());
    }
    Ok(folders)
}

/// Jars sitting in `mods/` that Kiza's catalogue says nothing about.
///
/// The game loads the folder, not the catalogue, so a jar dropped in by hand is
/// as much part of the instance as one installed through Discover. The previous
/// export copied the whole folder and caught these by accident; an export built
/// from the catalogue would drop them silently, which is the worse failure —
/// the archive would look complete and the pack would not run.
///
/// They travel bundled, because a file nobody registered has no release to name.
pub fn stray_jars(game_dir: &Path, planned: &[ExportedMod]) -> Vec<ExportedMod> {
    let known: std::collections::HashSet<&str> = planned
        .iter()
        .map(|entry| entry.file_name.as_str())
        .collect();

    let Ok(entries) = std::fs::read_dir(game_dir.join("mods")) else {
        return Vec::new();
    };

    let mut found: Vec<ExportedMod> = entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.ends_with(".jar") || known.contains(file_name.as_str()) {
                return None;
            }
            Some(ExportedMod {
                name: file_name.trim_end_matches(".jar").to_string(),
                version: String::new(),
                relative_path: format!("mods/{file_name}"),
                file_name,
                provider: None,
                project_id: None,
                version_id: None,
                bundled: true,
                enabled: true,
                load_order: 0,
            })
        })
        .collect();

    // Ordered, so two exports of an unchanged instance produce the same
    // manifest rather than whatever order the filesystem felt like.
    found.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    found
}

/// Copies a folder into the archive under `prefix`, if it is there at all.
fn add_folder<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<usize, String> {
    if !dir.is_dir() {
        return Ok(0);
    }
    let mut written = 0;
    for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(dir) else {
            continue;
        };
        // Zip paths are `/`-separated whatever the platform wrote them on; a
        // backslash here produces an entry every other tool reads as one long
        // file name.
        let name = format!("{prefix}/{}", relative.to_string_lossy().replace('\\', "/"));
        add_file(zip, entry.path(), &name, options)?;
        written += 1;
    }
    Ok(written)
}

fn add_file<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    source: &Path,
    name: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Write;
    let bytes = std::fs::read(source)
        .map_err(|error| format!("Could not read {}: {error}", source.display()))?;
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(())
}

fn add_json<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    name: &str,
    value: &serde_json::Value,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Write;
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(text.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// A file name for the archive that Windows will accept.
pub fn archive_name(display_name: &str) -> String {
    let cleaned: String = display_name
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "instance".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Writes the archive. Everything that was ticked, and nothing that was not.
///
/// The CurseForge manifest keeps `files` empty on purpose. Filling it would
/// describe the referenced mods to other launchers, but Kiza's own older
/// importer refuses any pack with a non-empty `files` — it hands those to the
/// modpack browser — so an archive that used it would be rejected by the very
/// launcher that wrote it. The references live in `kiza.json` instead, and
/// `manifest.json` stays a truthful description of what is inside `overrides/`.
/// Everything one archive needs to know about the instance it describes.
///
/// A struct rather than nine arguments, which is both a lint and a real hazard:
/// four of them are strings, and swapping two would produce an archive that
/// looks right and imports as the wrong Minecraft version.
pub struct ArchiveRequest<'a> {
    pub app_data_dir: &'a Path,
    pub instance_id: &'a str,
    pub game_dir: &'a Path,
    pub display_name: &'a str,
    pub mc_version: &'a str,
    pub loader: &'a str,
    pub loader_version: Option<String>,
}

pub fn write_archive(
    request: &ArchiveRequest<'_>,
    selection: &ExportSelection,
    destination: &Path,
) -> Result<ExportReport, String> {
    let ArchiveRequest {
        app_data_dir,
        instance_id,
        game_dir,
        display_name,
        mc_version,
        loader,
        loader_version,
    } = request;
    let loader_version = loader_version.clone();
    if selection.is_empty() {
        return Err("Nothing was chosen, so there is nothing to export.".to_string());
    }

    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(instance_id);
    let known = content_provenance::all(app_data_dir, instance_id);
    let size_of = |relative: &str| {
        std::fs::metadata(game_dir.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)))
            .map(|meta| meta.len())
            .unwrap_or(0)
    };
    let (mut planned_mods, mut summary) = plan_mods(&mods, &known, &size_of);
    let planned_mods = if selection.mods {
        for stray in stray_jars(game_dir, &planned_mods) {
            summary.count += 1;
            summary.bundled += 1;
            summary.bundled_bytes += size_of(&stray.relative_path);
            planned_mods.push(stray);
        }
        planned_mods
    } else {
        Vec::new()
    };

    let worlds = safe_world_folders(
        &selection.worlds,
        &world_vault::list_worlds(app_data_dir, instance_id, game_dir),
    )?;

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let file = std::fs::File::create(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mod_loaders = if *loader == "vanilla" {
        serde_json::json!([])
    } else {
        // Legacy Forge is stored as "11.15.1.2318-1.8.9"; a CurseForge manifest
        // rejects "forge-11.15.1.2318-1.8.9" as an unsupported loader.
        let version = crate::minecraft_manager::manifest_loader_version(
            &loader_version.clone().unwrap_or_default(),
            mc_version,
        );
        serde_json::json!([{ "id": format!("{loader}-{version}"), "primary": true }])
    };
    add_json(
        &mut zip,
        "manifest.json",
        &serde_json::json!({
            "minecraft": { "version": mc_version, "modLoaders": mod_loaders },
            "manifestType": "minecraftModpack",
            "manifestVersion": 1,
            "name": display_name,
            "version": "1.0.0",
            "author": "",
            "files": [],
            "overrides": "overrides",
        }),
        options,
    )?;

    let kiza = KizaManifest {
        format: FORMAT_VERSION,
        name: display_name.to_string(),
        mc_version: mc_version.to_string(),
        loader: loader.to_string(),
        loader_version,
        exported_at: chrono::Utc::now().to_rfc3339(),
        mods: planned_mods.clone(),
        worlds: worlds.clone(),
    };
    add_json(
        &mut zip,
        "kiza.json",
        &serde_json::to_value(&kiza).map_err(|error| error.to_string())?,
        options,
    )?;

    // Only the jars nobody else can fetch. A referenced mod that was also
    // bundled would double the archive for nothing.
    for entry in planned_mods.iter().filter(|entry| entry.bundled) {
        let source = game_dir.join(
            entry
                .relative_path
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        );
        if source.is_file() {
            add_file(
                &mut zip,
                &source,
                &format!("overrides/{}", entry.relative_path),
                options,
            )?;
        }
    }

    if selection.config {
        add_folder(
            &mut zip,
            &game_dir.join("config"),
            "overrides/config",
            options,
        )?;
    }
    if selection.resourcepacks {
        add_folder(
            &mut zip,
            &game_dir.join("resourcepacks"),
            "overrides/resourcepacks",
            options,
        )?;
    }
    if selection.shaderpacks {
        add_folder(
            &mut zip,
            &game_dir.join("shaderpacks"),
            "overrides/shaderpacks",
            options,
        )?;
    }
    if selection.options {
        let options_file = game_dir.join("options.txt");
        if options_file.is_file() {
            add_file(&mut zip, &options_file, "overrides/options.txt", options)?;
        }
    }
    for world in &worlds {
        add_folder(
            &mut zip,
            &game_dir.join("saves").join(world),
            &format!("overrides/saves/{world}"),
            options,
        )?;
    }

    zip.finish()
        .map_err(|error| format!("Could not finish the archive: {error}"))?;

    let size_bytes = std::fs::metadata(destination)
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(ExportReport {
        path: destination.to_string_lossy().to_string(),
        size_bytes,
        mods_referenced: if selection.mods {
            summary.referenced
        } else {
            0
        },
        mods_bundled: if selection.mods { summary.bundled } else { 0 },
        worlds: worlds.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn a_mod(name: &str, jar: &str, enabled: bool, order: i32) -> Mod {
        Mod {
            id: name.to_string(),
            name: name.to_string(),
            version: "1.0.0".to_string(),
            description: String::new(),
            source: Some("modrinth".to_string()),
            author: None,
            homepage_url: None,
            cover_url: None,
            cover_path: None,
            file_size: None,
            game_versions: Vec::new(),
            loaders: Vec::new(),
            updated_at: None,
            project_id: None,
            version_id: None,
            enabled,
            install_date: String::new(),
            files: vec![jar.to_string()],
            load_order: order,
        }
    }

    fn origin(project: &str) -> content_provenance::ContentOrigin {
        content_provenance::ContentOrigin {
            provider: "modrinth".to_string(),
            project_id: project.to_string(),
            version_id: "v1".to_string(),
            pinned: false,
        }
    }

    /// The whole point of the format: a mod the platform can hand back is not
    /// carried, and one nobody else has is.
    #[test]
    fn a_known_mod_is_referenced_and_an_unknown_one_is_carried() {
        let mods = vec![
            a_mod("Sodium", "mods/sodium.jar", true, 0),
            a_mod("Homemade", "mods/homemade.jar", true, 1),
        ];
        let mut known = BTreeMap::new();
        known.insert("mods/sodium.jar".to_string(), origin("AANobbMI"));

        let (planned, summary) = plan_mods(&mods, &known, &|_| 4_000_000);

        assert_eq!(summary.count, 2);
        assert_eq!(summary.referenced, 1);
        assert_eq!(summary.bundled, 1);
        // Only the unknown one weighs anything.
        assert_eq!(summary.bundled_bytes, 4_000_000);

        let sodium = planned.iter().find(|item| item.name == "Sodium").unwrap();
        assert!(!sodium.bundled);
        assert_eq!(sodium.project_id.as_deref(), Some("AANobbMI"));

        let homemade = planned.iter().find(|item| item.name == "Homemade").unwrap();
        assert!(homemade.bundled);
        assert_eq!(homemade.project_id, None);
    }

    /// A disabled mod is part of the instance too, and comes back disabled.
    /// Exporting it as enabled would silently change what the game loads.
    #[test]
    fn the_enabled_state_and_load_order_travel() {
        let mods = vec![a_mod("Iris", "mods/iris.jar", false, 7)];
        let (planned, _) = plan_mods(&mods, &BTreeMap::new(), &|_| 0);

        assert!(!planned[0].enabled);
        assert_eq!(planned[0].load_order, 7);
    }

    #[test]
    fn files_that_are_not_jars_are_not_mods() {
        let mut entry = a_mod("JEI", "mods/jei.jar", true, 0);
        entry.files.push("config/jei/jei.toml".to_string());

        let (planned, summary) = plan_mods(&[entry], &BTreeMap::new(), &|_| 0);
        assert_eq!(summary.count, 1);
        assert_eq!(planned.len(), 1);
    }

    #[test]
    fn nothing_ticked_is_recognised_as_nothing() {
        assert!(ExportSelection::default().is_empty());
        assert!(!ExportSelection {
            worlds: vec!["New World".to_string()],
            ..Default::default()
        }
        .is_empty());
        assert!(!ExportSelection {
            mods: true,
            ..Default::default()
        }
        .is_empty());
    }

    fn world(folder: &str) -> WorldSummary {
        WorldSummary {
            folder: folder.to_string(),
            display_name: folder.to_string(),
            size_bytes: 0,
            file_count: 0,
            last_played_ms: None,
            version_name: None,
            hardcore: false,
            icon: None,
            checkpoint_count: 0,
        }
    }

    #[test]
    fn a_world_that_is_not_there_is_refused() {
        let available = vec![world("New World")];
        assert!(safe_world_folders(&["Other".to_string()], &available).is_err());
        assert_eq!(
            safe_world_folders(&["New World".to_string()], &available).unwrap(),
            vec!["New World".to_string()]
        );
    }

    /// The names come from the interface, and the interface is not a trust
    /// boundary: an export driven by a crafted name must not reach outside
    /// `saves/`.
    #[test]
    fn a_world_name_cannot_climb_out_of_the_saves_folder() {
        let escape = "../../config".to_string();
        let available = vec![world(&escape)];
        assert!(safe_world_folders(&[escape], &available).is_err());
    }

    /// The failure this whole module exists to end: an export that left the
    /// world behind. Written against a real archive rather than against the
    /// selection struct, because "we intended to include it" is not the claim
    /// that matters.
    #[test]
    fn a_chosen_world_is_actually_inside_the_archive() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("data");
        let game = root.path().join("game");

        std::fs::create_dir_all(game.join("saves").join("New World").join("region")).unwrap();
        std::fs::write(
            game.join("saves").join("New World").join("level.dat"),
            b"NBT",
        )
        .unwrap();
        std::fs::write(
            game.join("saves")
                .join("New World")
                .join("region")
                .join("r.0.0.mca"),
            vec![7u8; 2048],
        )
        .unwrap();
        std::fs::create_dir_all(game.join("config")).unwrap();
        std::fs::write(game.join("config").join("jei.toml"), b"x = 1").unwrap();
        std::fs::write(game.join("options.txt"), b"fov:80").unwrap();

        let destination = root.path().join("out.zip");
        let report = write_archive(
            &ArchiveRequest {
                app_data_dir: &app_data,
                instance_id: "abc",
                game_dir: &game,
                display_name: "Alone and just alone",
                mc_version: "1.21.1",
                loader: "fabric",
                loader_version: Some("0.19.3".to_string()),
            },
            &ExportSelection {
                options: true,
                worlds: vec!["New World".to_string()],
                ..Default::default()
            },
            &destination,
        )
        .unwrap();

        assert_eq!(report.worlds, 1);

        let file = std::fs::File::open(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect();

        assert!(
            names.contains(&"overrides/saves/New World/level.dat".to_string()),
            "{names:?}"
        );
        assert!(
            names.contains(&"overrides/saves/New World/region/r.0.0.mca".to_string()),
            "{names:?}"
        );
        assert!(
            names.contains(&"overrides/options.txt".to_string()),
            "{names:?}"
        );
        // Config was not ticked, so it is not there. Exporting more than was
        // asked for is its own kind of wrong when worlds are in the box.
        assert!(
            !names
                .iter()
                .any(|name| name.starts_with("overrides/config")),
            "{names:?}"
        );

        // And the archive says what it carries.
        let mut kiza = archive.by_name("kiza.json").unwrap();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut kiza, &mut text).unwrap();
        let manifest: KizaManifest = serde_json::from_str(&text).unwrap();
        assert_eq!(manifest.format, FORMAT_VERSION);
        assert_eq!(manifest.worlds, vec!["New World".to_string()]);
        assert_eq!(manifest.mc_version, "1.21.1");
    }

    /// An archive of nothing is a mistake worth refusing, since nothing is
    /// ticked to begin with.
    #[test]
    fn exporting_with_nothing_ticked_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let error = write_archive(
            &ArchiveRequest {
                app_data_dir: &root.path().join("data"),
                instance_id: "abc",
                game_dir: &root.path().join("game"),
                display_name: "Test",
                mc_version: "1.21.1",
                loader: "fabric",
                loader_version: None,
            },
            &ExportSelection::default(),
            &root.path().join("out.zip"),
        )
        .unwrap_err();

        assert!(error.contains("nothing to export"), "{error}");
    }

    #[test]
    fn an_archive_name_survives_a_display_name_full_of_punctuation() {
        assert_eq!(archive_name("Alone and just alone"), "Alone_and_just_alone");
        assert_eq!(archive_name("  ???  "), "instance");
        assert_eq!(archive_name("1.21 / Fabric"), "1_21___Fabric");
    }

    /// The game loads the folder, not the catalogue. A jar somebody dropped in
    /// by hand has to travel, or the archive looks complete and the pack does
    /// not run.
    #[test]
    fn a_jar_kiza_never_installed_still_travels() {
        let root = tempfile::tempdir().unwrap();
        let game = root.path().join("game");
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(game.join("mods").join("mystery.jar"), vec![1u8; 128]).unwrap();
        std::fs::write(game.join("mods").join("sodium.jar"), vec![2u8; 128]).unwrap();
        std::fs::write(game.join("mods").join("notes.txt"), b"not a mod").unwrap();

        let planned = vec![ExportedMod {
            name: "Sodium".to_string(),
            version: "0.6".to_string(),
            file_name: "sodium.jar".to_string(),
            relative_path: "mods/sodium.jar".to_string(),
            provider: Some("modrinth".to_string()),
            project_id: Some("AANobbMI".to_string()),
            version_id: Some("v".to_string()),
            bundled: false,
            enabled: true,
            load_order: 0,
        }];

        let strays = stray_jars(&game, &planned);

        // The catalogued one is already accounted for, and a text file is not a
        // mod however hopefully it was dropped there.
        assert_eq!(strays.len(), 1);
        assert_eq!(strays[0].file_name, "mystery.jar");
        assert!(strays[0].bundled);
        assert_eq!(strays[0].provider, None);
    }

    #[test]
    fn an_instance_with_no_mods_folder_has_no_strays() {
        let root = tempfile::tempdir().unwrap();
        assert!(stray_jars(root.path(), &[]).is_empty());
    }
}
