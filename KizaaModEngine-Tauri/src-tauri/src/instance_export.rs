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
    /// What every jar together weighs, which is what a self-contained archive
    /// costs. Shown beside the other figure so the choice between the two
    /// formats is a choice between two numbers rather than two words.
    pub every_jar_bytes: u64,
}

/// What kind of archive to write.
///
/// These are not two settings but two audiences. A CurseForge pack names its
/// catalogue mods by number and carries only what no catalogue holds, which is
/// what every other launcher reads and what CurseForge itself produces. A
/// self-contained archive carries every jar, which needs no network, no API key
/// and no project still being published, and which no other launcher
/// understands as a pack.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    /// Catalogue mods listed by project and file; the rest in `overrides/`.
    #[default]
    CurseForge,
    /// Every jar inside the archive.
    SelfContained,
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
    /// Keep only what a server needs out of the mods.
    ///
    /// A mod nobody could classify is kept rather than dropped, and counted, so
    /// the report can say so. The two failures are not equal: a server pack
    /// carrying one extra client mod wastes a little space, and a server pack
    /// missing a mod the world needs does not start.
    #[serde(default)]
    pub server_only: bool,
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
    #[serde(default)]
    pub format: ExportFormat,
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
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedMod {
    pub name: String,
    pub version: String,
    pub file_name: String,
    /// Where in the game directory it belongs, e.g. `mods/sodium.jar`.
    pub relative_path: String,
    /// What the catalogue said the mod was, and how it looked.
    ///
    /// Carried even for a mod that travels bundled. The first version of this
    /// format dropped all of it, so an imported instance listed twenty-four
    /// mods with the right names, no icons, and "Imported File" under every
    /// one — the launcher had forgotten that the mod came from CurseForge at
    /// all, because only *provenance* travelled and a bundled mod has none.
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage_url: Option<String>,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub file_size: Option<u64>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    /// Which catalogue the mod was installed from, whether or not its exact
    /// release is known. `provider` below only exists when the release is.
    #[serde(default)]
    pub source: Option<String>,
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
    /// Mods a server pack kept because nothing could say which side they run on.
    ///
    /// Reported rather than swallowed: the person is about to hand this archive
    /// to a server, and "three of these might not belong" is something they can
    /// act on. Zero when the whole export was not filtered.
    #[serde(default)]
    pub mods_unclassified: usize,
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
    format: ExportFormat,
) -> (Vec<ExportedMod>, ModsSummary) {
    let mut planned = Vec::new();
    let mut summary = ModsSummary::default();

    // One jar, one entry.
    //
    // The catalogue can hold two records for the same file — a mod installed
    // directly and then pulled in again as somebody else's dependency ends up
    // registered twice. On a real instance that was Fabric API, and the export
    // added `overrides/mods/fabric-api-0.141.6+1.21.11.jar` to the archive
    // twice, which a zip refuses outright: the whole export failed on a
    // duplicate name. The first record wins; they describe the same bytes.
    let mut seen = std::collections::HashSet::new();

    for entry in mods {
        for jar in jars_of(entry) {
            if !seen.insert(jar.clone()) {
                continue;
            }
            let origin = known.get(jar);
            // Only CurseForge can be named in a CurseForge manifest. A Modrinth
            // mod has an origin Kiza knows perfectly well and no way to write
            // it down in this format, so it travels in full — which is also why
            // an export used to lose them for every launcher but Kiza: they
            // were neither listed nor carried, and lived only in `kiza.json`.
            let listable = matches!(format, ExportFormat::CurseForge)
                && origin.is_some_and(|found| found.provider == "curseforge");
            let bundled = !listable;
            let size = size_of(jar);
            summary.count += 1;
            summary.every_jar_bytes += size;
            if bundled {
                summary.bundled += 1;
                summary.bundled_bytes += size;
            } else {
                summary.referenced += 1;
            }

            planned.push(ExportedMod {
                name: entry.name.clone(),
                version: entry.version.clone(),
                file_name: jar.rsplit('/').next().unwrap_or(jar).to_string(),
                relative_path: jar.clone(),
                description: Some(entry.description.clone()).filter(|text| !text.is_empty()),
                author: entry.author.clone(),
                homepage_url: entry.homepage_url.clone(),
                cover_url: entry.cover_url.clone(),
                file_size: entry.file_size,
                game_versions: entry.game_versions.clone(),
                loaders: entry.loaders.clone(),
                source: entry.source.clone(),
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
    // Measured for the format the window offers first; `every_jar_bytes` is
    // what the other one would cost, so both numbers are on screen before the
    // choice is made.
    let (planned, mut mods_summary) = plan_mods(&mods, &known, &size_of, ExportFormat::CurseForge);
    // Counted here too, so the window promises the same archive the writer
    // produces rather than one short of every hand-dropped jar.
    for stray in stray_jars(game_dir, &planned) {
        let size = size_of(&stray.relative_path);
        mods_summary.count += 1;
        mods_summary.bundled += 1;
        mods_summary.bundled_bytes += size;
        mods_summary.every_jar_bytes += size;
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
                description: None,
                author: None,
                homepage_url: None,
                cover_url: None,
                file_size: None,
                game_versions: Vec::new(),
                loaders: Vec::new(),
                source: None,
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

fn add_bytes<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    name: &str,
    bytes: &[u8],
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Write;
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(bytes).map_err(|error| error.to_string())?;
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

/// The human-readable list CurseForge ships beside the manifest.
///
/// Deliberately plain: it is opened in a browser by someone deciding whether to
/// install the pack, not by a launcher.
fn modlist_html(display_name: &str, mods: &[ExportedMod]) -> String {
    let mut page = String::with_capacity(256 + mods.len() * 96);
    page.push_str("<html><head><meta charset=\"utf-8\"><title>");
    page.push_str(&escape_html(display_name));
    page.push_str("</title></head><body><h1>");
    page.push_str(&escape_html(display_name));
    page.push_str("</h1><ul>\n");
    for entry in mods {
        page.push_str("<li>");
        match entry.homepage_url.as_deref() {
            Some(url) if url.starts_with("https://") => {
                page.push_str("<a href=\"");
                page.push_str(&escape_html(url));
                page.push_str("\">");
                page.push_str(&escape_html(&entry.name));
                page.push_str("</a>");
            }
            _ => page.push_str(&escape_html(&entry.name)),
        }
        if !entry.version.trim().is_empty() {
            page.push_str(" (");
            page.push_str(&escape_html(&entry.version));
            page.push(')');
        }
        if let Some(author) = entry
            .author
            .as_deref()
            .filter(|name| !name.trim().is_empty())
        {
            page.push_str(" by ");
            page.push_str(&escape_html(author));
        }
        page.push_str("</li>\n");
    }
    page.push_str("</ul></body></html>\n");
    page
}

/// Mod names and authors are whatever a catalogue returned, so they reach this
/// page as text and must not leave it as markup.
fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Drops the mods a server has no use for.
///
/// The jar is asked first, because the loader that reads its manifest is the
/// one that obeys it and because it answers for a file somebody added by hand.
/// The catalogue's tags are the fallback.
///
/// A mod that neither could classify stays in. Guessing "client" would take a
/// mod out of a pack that may need it, and a server that will not start is a
/// worse outcome than a server carrying a jar it ignores.
fn keep_what_a_server_needs(
    manager: &ModManager,
    instance_id: &str,
    mods: Vec<Mod>,
) -> (Vec<Mod>, usize) {
    let mut kept = Vec::with_capacity(mods.len());
    let mut unclassified = 0;
    for entry in mods {
        let side = jar_side(manager, instance_id, &entry)
            .or_else(|| crate::mod_side::from_catalogue(None, None, &entry.game_versions));
        match side {
            Some(found) => {
                if found.wanted_by_a_server() {
                    kept.push(entry);
                }
            }
            None => {
                unclassified += 1;
                kept.push(entry);
            }
        }
    }
    (kept, unclassified)
}

fn jar_side(
    manager: &ModManager,
    instance_id: &str,
    entry: &Mod,
) -> Option<crate::mod_side::ModSide> {
    let folder = manager.get_mod_path(instance_id, &entry.id).ok()?;
    let root = Path::new(&folder);
    entry
        .files
        .iter()
        .map(|file| root.join(file))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("jar"))
        .find_map(|path| crate::mod_side::from_jar(&path))
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
    let (mods, unclassified) = if selection.mods && selection.server_only {
        keep_what_a_server_needs(&manager, instance_id, mods)
    } else {
        (mods, 0)
    };
    let known = content_provenance::all(app_data_dir, instance_id);
    let size_of = |relative: &str| {
        std::fs::metadata(game_dir.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)))
            .map(|meta| meta.len())
            .unwrap_or(0)
    };
    let (mut planned_mods, mut summary) = plan_mods(&mods, &known, &size_of, selection.format);
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
    // The mods CurseForge can fetch, written the way CurseForge writes them.
    //
    // This was an empty array, and a referenced mod was not bundled either: it
    // existed only in `kiza.json`. So a Kiza export opened by anything but Kiza
    // silently lost every mod that came from a catalogue, and CurseForge saw a
    // pack with no mods in it. A listed mod is not also carried, or it would
    // install twice.
    let listed: Vec<serde_json::Value> = planned_mods
        .iter()
        .filter(|entry| !entry.bundled)
        .filter_map(|entry| {
            let project = entry.project_id.as_deref()?.parse::<u64>().ok()?;
            let file = entry.version_id.as_deref()?.parse::<u64>().ok()?;
            Some(serde_json::json!({
                "projectID": project,
                "fileID": file,
                "required": true,
            }))
        })
        .collect();

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
            "files": listed,
            "overrides": "overrides",
        }),
        options,
    )?;

    // CurseForge puts one of these in every export: a page a person can read
    // without a launcher, listing what is in the pack and who wrote it.
    add_bytes(
        &mut zip,
        "modlist.html",
        modlist_html(display_name, &planned_mods).as_bytes(),
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
        mods_unclassified: unclassified,
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

    fn curseforge_origin(project: &str, file: &str) -> content_provenance::ContentOrigin {
        content_provenance::ContentOrigin {
            provider: "curseforge".to_string(),
            project_id: project.to_string(),
            version_id: file.to_string(),
            pinned: false,
        }
    }

    /// Only what the manifest can name is left out of the archive.
    ///
    /// A CurseForge manifest addresses a mod by two numbers on CurseForge, and
    /// there is no line in it for a Modrinth project. Kiza used to leave those
    /// out of the archive anyway and write them down only in `kiza.json`, so
    /// every launcher but Kiza opened the pack and found them missing. A mod
    /// this format cannot name travels in full.
    #[test]
    fn only_a_mod_the_manifest_can_name_is_left_out_of_the_archive() {
        let mods = vec![
            a_mod("Sodium", "mods/sodium.jar", true, 0),
            a_mod("JEI", "mods/jei.jar", true, 1),
            a_mod("Homemade", "mods/homemade.jar", true, 2),
        ];
        let mut known = BTreeMap::new();
        known.insert("mods/sodium.jar".to_string(), origin("AANobbMI"));
        known.insert(
            "mods/jei.jar".to_string(),
            curseforge_origin("238222", "6123456"),
        );

        let (planned, summary) = plan_mods(&mods, &known, &|_| 4_000_000, ExportFormat::CurseForge);

        assert_eq!(summary.count, 3);
        assert_eq!(
            summary.referenced, 1,
            "only the CurseForge mod can be listed"
        );
        assert_eq!(summary.bundled, 2);
        assert_eq!(summary.bundled_bytes, 8_000_000);
        assert_eq!(summary.every_jar_bytes, 12_000_000);

        let jei = planned.iter().find(|item| item.name == "JEI").unwrap();
        assert!(!jei.bundled);
        assert_eq!(jei.project_id.as_deref(), Some("238222"));

        // Known, and still carried: the format has no way to say where it is.
        let sodium = planned.iter().find(|item| item.name == "Sodium").unwrap();
        assert!(sodium.bundled);
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
        let (planned, _) = plan_mods(&mods, &BTreeMap::new(), &|_| 0, ExportFormat::CurseForge);

        assert!(!planned[0].enabled);
        assert_eq!(planned[0].load_order, 7);
    }

    #[test]
    fn files_that_are_not_jars_are_not_mods() {
        let mut entry = a_mod("JEI", "mods/jei.jar", true, 0);
        entry.files.push("config/jei/jei.toml".to_string());

        let (planned, summary) =
            plan_mods(&[entry], &BTreeMap::new(), &|_| 0, ExportFormat::CurseForge);
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

    /// The other format carries everything, including what could have been a
    /// line in the manifest.
    #[test]
    fn a_self_contained_archive_carries_every_jar() {
        let mods = vec![
            a_mod("JEI", "mods/jei.jar", true, 0),
            a_mod("Homemade", "mods/homemade.jar", true, 1),
        ];
        let mut known = BTreeMap::new();
        known.insert(
            "mods/jei.jar".to_string(),
            curseforge_origin("238222", "6123456"),
        );

        let (planned, summary) =
            plan_mods(&mods, &known, &|_| 4_000_000, ExportFormat::SelfContained);

        assert_eq!(summary.referenced, 0);
        assert_eq!(summary.bundled, 2);
        assert_eq!(summary.bundled_bytes, summary.every_jar_bytes);
        assert!(planned.iter().all(|entry| entry.bundled));
        // Provenance still travels: it is what the launcher needs to offer an
        // update later, and it costs nothing to write down.
        let jei = planned.iter().find(|item| item.name == "JEI").unwrap();
        assert_eq!(jei.project_id.as_deref(), Some("238222"));
    }

    /// Mod names come from a catalogue, so they reach this page as text and
    /// must not leave it as markup.
    #[test]
    fn the_readable_list_escapes_what_a_catalogue_returned() {
        let mut entry = ExportedMod {
            name: "<script>alert(1)</script>".to_string(),
            version: "1.0".to_string(),
            author: Some("me & you".to_string()),
            homepage_url: Some("https://example.test/a?b=1&c=2".to_string()),
            ..Default::default()
        };
        entry.bundled = true;

        let page = modlist_html("A & B", std::slice::from_ref(&entry));
        assert!(page.contains("&lt;script&gt;"), "{page}");
        assert!(!page.contains("<script>"), "{page}");
        assert!(page.contains("me &amp; you"), "{page}");
        assert!(page.contains("<title>A &amp; B</title>"), "{page}");
        assert!(page.contains("b=1&amp;c=2"), "{page}");

        // A page with no link for a mod nobody published.
        let bare = ExportedMod {
            name: "Homemade".to_string(),
            ..Default::default()
        };
        let page = modlist_html("Pack", std::slice::from_ref(&bare));
        assert!(page.contains("<li>Homemade</li>"), "{page}");
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
    /// The archive CurseForge can read.
    ///
    /// `files` was an empty array, so a Kiza export was a manifest saying the
    /// pack has no mods, a folder of overrides, and a `kiza.json` nothing else
    /// knows how to read. It named itself a `minecraftModpack` and was not one.
    #[test]
    fn a_curseforge_export_names_its_catalogue_mods_and_lists_them_for_a_reader() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("data");
        let game = root.path().join("game");
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(game.join("mods").join("jei.jar"), vec![1u8; 64]).unwrap();
        std::fs::write(game.join("mods").join("homemade.jar"), vec![2u8; 32]).unwrap();

        let manager = ModManager::new(app_data.clone());
        for (name, jar) in [("JEI", "mods/jei.jar"), ("Homemade", "mods/homemade.jar")] {
            manager
                .install_mod_file(
                    "abc",
                    &game
                        .join(jar.replace('/', std::path::MAIN_SEPARATOR_STR))
                        .to_string_lossy(),
                    jar,
                    Some(crate::mod_manager::ModMetadata {
                        name: Some(name.to_string()),
                        version: Some("1.0".to_string()),
                        ..Default::default()
                    }),
                )
                .expect("catalogue the mod");
        }
        content_provenance::record(
            &app_data,
            "abc",
            "mods/jei.jar",
            curseforge_origin("238222", "6123456"),
        )
        .expect("record provenance");

        let destination = root.path().join("pack.zip");
        write_archive(
            &ArchiveRequest {
                app_data_dir: &app_data,
                instance_id: "abc",
                game_dir: &game,
                display_name: "Shareable",
                mc_version: "1.21.1",
                loader: "fabric",
                loader_version: Some("0.19.3".to_string()),
            },
            &ExportSelection {
                mods: true,
                format: ExportFormat::CurseForge,
                ..Default::default()
            },
            &destination,
        )
        .expect("write the archive");

        let file = std::fs::File::open(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = archive.file_names().map(str::to_string).collect();

        let manifest: serde_json::Value = {
            let mut text = String::new();
            std::io::Read::read_to_string(
                &mut archive.by_name("manifest.json").unwrap(),
                &mut text,
            )
            .unwrap();
            serde_json::from_str(&text).expect("valid manifest")
        };

        let files = manifest["files"].as_array().expect("a files array");
        assert_eq!(files.len(), 1, "only the CurseForge mod can be named");
        assert_eq!(files[0]["projectID"], 238_222);
        assert_eq!(files[0]["fileID"], 6_123_456);
        assert_eq!(files[0]["required"], true);
        assert_eq!(manifest["manifestType"], "minecraftModpack");

        // Listed, so not also carried: two copies of one mod is a game that
        // will not start.
        assert!(
            !names.iter().any(|name| name.ends_with("mods/jei.jar")),
            "{names:?}"
        );
        // Unnameable, so carried.
        assert!(
            names.iter().any(|name| name.ends_with("mods/homemade.jar")),
            "{names:?}"
        );
        // And the page a person opens without a launcher.
        assert!(names.iter().any(|name| name == "modlist.html"), "{names:?}");
    }

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
            file_name: "sodium.jar".to_string(),
            relative_path: "mods/sodium.jar".to_string(),
            provider: Some("modrinth".to_string()),
            project_id: Some("AANobbMI".to_string()),
            version_id: Some("v".to_string()),
            enabled: true,
            ..Default::default()
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

    /// Reported from a real instance: two catalogue records both named "Fabric
    /// API" owning `mods/fabric-api-0.141.6+1.21.11.jar`, because the mod was
    /// installed directly and then registered again as somebody's dependency.
    /// The export added the same zip entry twice and the whole thing failed
    /// with "Duplicate filename".
    #[test]
    fn one_jar_owned_by_two_catalogue_records_is_planned_once() {
        let jar = "mods/fabric-api-0.141.6+1.21.11.jar";
        let mods = vec![
            a_mod("Fabric API", jar, true, 0),
            a_mod("Fabric API", jar, true, 3),
        ];

        let (planned, summary) = plan_mods(
            &mods,
            &BTreeMap::new(),
            &|_| 1_000_000,
            ExportFormat::CurseForge,
        );

        assert_eq!(planned.len(), 1);
        // And the count is the truth rather than double it, so the window does
        // not promise an archive with a mod that does not exist.
        assert_eq!(summary.count, 1);
        assert_eq!(summary.bundled, 1);
        assert_eq!(summary.bundled_bytes, 1_000_000);
    }

    /// The whole archive, written from a catalogue holding that duplicate.
    /// Asserted through the zip rather than through the plan: the failure the
    /// user saw came from the writer, and a plan that is right while the writer
    /// is wrong helps nobody.
    #[test]
    fn a_duplicated_catalogue_entry_does_not_break_the_archive() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("data");
        let game = root.path().join("game");
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(
            game.join("mods").join("fabric-api-0.141.6+1.21.11.jar"),
            vec![3u8; 512],
        )
        .unwrap();

        // The catalogue Kiza would load, duplicate and all.
        let catalogue = app_data.join("config");
        std::fs::create_dir_all(&catalogue).unwrap();
        let entries = vec![
            a_mod("Fabric API", "mods/fabric-api-0.141.6+1.21.11.jar", true, 0),
            a_mod("Fabric API", "mods/fabric-api-0.141.6+1.21.11.jar", true, 1),
        ];
        std::fs::write(
            catalogue.join("dupe_mods.json"),
            serde_json::to_string(&entries).unwrap(),
        )
        .unwrap();

        let destination = root.path().join("out.zip");
        let report = write_archive(
            &ArchiveRequest {
                app_data_dir: &app_data,
                instance_id: "dupe",
                game_dir: &game,
                display_name: "Duplicated",
                mc_version: "1.21.11",
                loader: "fabric",
                loader_version: Some("0.19.3".to_string()),
            },
            &ExportSelection {
                mods: true,
                ..Default::default()
            },
            &destination,
        )
        .expect("the export must not fail on a duplicated catalogue entry");

        assert_eq!(report.mods_bundled, 1);

        let file = std::fs::File::open(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let jars: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .filter(|name| name.ends_with(".jar"))
            .collect();

        assert_eq!(
            jars,
            vec!["overrides/mods/fabric-api-0.141.6+1.21.11.jar".to_string()]
        );
    }
}
