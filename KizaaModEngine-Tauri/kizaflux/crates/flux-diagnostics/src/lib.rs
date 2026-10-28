//! Flux Diagnostics: what a mod archive is and what Kizaflux can do with it.
//!
//! It reads an archive's central directory and its descriptors, and nothing
//! else: no class is loaded, no file is extracted, nothing runs. From that it
//! gives every archive one of six statuses ([`Status`]), with the reasons in
//! plain words.
//!
//! The rule it holds to: a Java mod is never called compatible because its
//! jar could be read. Kizaflux's engine (Horizon) runs no Java, so a mod's
//! code never runs there; what can come across is its assets and data. Only a
//! recorded test result ([`TestResults`]) makes anything "compatible and
//! tested".

pub mod metadata;
pub mod versions;

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Seek};
use std::path::Path;

use serde::Serialize;
use sha1::{Digest, Sha1};

pub use metadata::{Dependency, Descriptor, Loader, ModMetadata};
pub use versions::VersionMatch;

/// What a mod can be to Kizaflux. "Untested" is never read as "compatible".
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// A test run on this exact file passed (see [`TestResults`]).
    CompatibleTested,
    /// A test run found part of it working; the report says what does not.
    PartiallyCompatible,
    /// No code to run: its assets and data can come across as content.
    ResourcesOnly,
    /// Java code with content of its own: its assets and data can come
    /// across, its behaviour needs a port to Kizaflux's API.
    NeedsAdaptation,
    /// Java code and nothing that can come across, or an archive refused.
    Incompatible,
    /// Made for Kizaflux, or of a kind not recognised, and not tested yet.
    Untested,
}

/// What kind of archive it is, from its descriptors and layout.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// A mod for one of the loaders in [`Loader`].
    Mod(Loader),
    /// `pack.mcmeta` with `assets/` and no code.
    ResourcePack,
    /// `pack.mcmeta` with `data/` and no code.
    DataPack,
    /// Classes and no descriptor: a library, or something not a mod.
    PlainJar,
    Unknown,
}

/// The engine a report is made for.
#[derive(Clone, Debug)]
pub struct Target {
    /// The Minecraft version the engine plays, e.g. `26.3` for Horizon.
    pub minecraft: String,
}

/// Limits that keep a hostile archive from costing more than a look.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_entries: usize,
    /// Bytes read out of any one descriptor or manifest.
    pub max_descriptor_bytes: u64,
    /// Bytes read out of a nested jar to look inside it, and in all of them.
    pub max_nested_bytes: u64,
    pub max_nested_total: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            // All the Mods' largest jars hold about 30,000 entries.
            max_entries: 200_000,
            max_descriptor_bytes: 1 << 20,
            max_nested_bytes: 32 << 20,
            max_nested_total: 256 << 20,
        }
    }
}

/// What the archive holds, from its central directory.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Contents {
    pub entries: usize,
    pub uncompressed_bytes: u64,
    pub class_files: usize,
    /// Every file under `assets/`, a pack's icon and translations included.
    pub asset_files: usize,
    /// Namespaces under `assets/` holding content (not just an icon or
    /// translations), and under `data/`.
    pub asset_namespaces: BTreeSet<String>,
    pub data_namespaces: BTreeSet<String>,
    pub pack_mcmeta: bool,
    /// `.dll`, `.so`, `.dylib`, `.jnilib`: code for one system, outside Java.
    pub native_libraries: Vec<String>,
    /// `*.mixins.json` files, whether or not a descriptor names them.
    pub mixin_files: Vec<String>,
    pub access_transformer: bool,
    pub access_widener: bool,
    /// Jars inside the jar (Fabric's jar-in-jar, Forge's JarJar).
    pub nested_jars: Vec<String>,
    /// Entries whose names escape the archive (`../`, absolute, a drive).
    pub unsafe_entries: Vec<String>,
    /// `mod.wasm`: a Horizon mod's code.
    pub wasm: bool,
}

/// One archive's report.
#[derive(Serialize, Clone, Debug)]
pub struct Report {
    pub file_name: String,
    pub sha1: String,
    pub kind: Kind,
    pub descriptors: Vec<Descriptor>,
    pub contents: Contents,
    /// Whether the archive's Minecraft requirement covers the engine's.
    pub minecraft_match: VersionMatch,
    pub status: Status,
    /// Why it has that status, one line each.
    pub reasons: Vec<String>,
    /// What the mod does on Java that it would not do on Kizaflux.
    pub unavailable: Vec<String>,
    /// The engine already does what this mod is for (a renderer or
    /// performance mod): installing it is not needed, not just impossible.
    pub replaced_by_engine: bool,
    /// One of Horizon's official mods that does what this one is for, by
    /// its Horizon id (`zoom`, `minimap`...): what to install instead.
    pub horizon_equivalent: Option<&'static str>,
    /// Reports for the jars inside it, one level down.
    pub nested: Vec<Report>,
}

impl Report {
    /// The mod ids this archive declares.
    pub fn mod_ids(&self) -> Vec<&str> {
        self.descriptors
            .iter()
            .flat_map(|d| d.mods.iter().map(|m| m.id.as_str()))
            .collect()
    }
}

/// Results of test runs, by SHA-1 of the file tested. The only way anything
/// becomes "compatible and tested".
#[derive(Clone, Debug, Default)]
pub struct TestResults {
    pub by_sha1: BTreeMap<String, TestResult>,
}

#[derive(Clone, Debug)]
pub struct TestResult {
    pub status: Status,
    /// What the test found not working, for a partial result.
    pub notes: Vec<String>,
}

/// Mods whose whole purpose the engine already serves: renderers,
/// performance and memory work. By mod id, as their descriptors declare.
const REPLACED_BY_ENGINE: &[&str] = &[
    "sodium",
    "sodium-extra",
    "reeses-sodium-options",
    "embeddium",
    "rubidium",
    "lithium",
    "canary",
    "radium",
    "phosphor",
    "starlight",
    "ferritecore",
    "modernfix",
    "immediatelyfast",
    "c2me",
    "krypton",
    "entityculling",
    "moreculling",
    "lazydfu",
    "smoothboot",
    "dynamic_fps",
    "dynamicfps",
    "memoryleakfix",
    "fastload",
    "enhancedblockentities",
    "badoptimizations",
    "nvidium",
    "vulkanmod",
    "optifine",
];

/// Java mods with an official Horizon mod for the same purpose
/// (mods/official/ in Horizon's repository, 2026-10-28), by mod id.
const HORIZON_EQUIVALENTS: &[(&str, &[&str])] = &[
    (
        "zoom",
        &[
            "zoomify",
            "ok_zoomer",
            "okzoomer",
            "logical_zoom",
            "wi_zoom",
            "zoom",
        ],
    ),
    (
        "minimap",
        &["xaerominimap", "journeymap", "voxelmap", "minimap"],
    ),
    ("far_view", &["distanthorizons", "bobby", "voxy"]),
    ("recipes", &["jei", "emi", "roughlyenoughitems", "rei"]),
    (
        "fps_overlay",
        &["fpsdisplay", "fps_display", "betterfpsdisplay"],
    ),
    (
        "keystrokes",
        &["keystrokes", "keystrokesmod", "kmod_keystrokes"],
    ),
];

/// Reads the archive at `path`.
pub fn analyze_file(path: &Path, target: &Target, limits: &Limits) -> Result<Report, String> {
    let bytes_file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let sha1 = file_sha1(path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut budget = limits.max_nested_total;
    analyze(bytes_file, name, sha1, target, limits, 1, &mut budget)
}

/// Reads an archive held in memory.
pub fn analyze_bytes(
    name: &str,
    bytes: &[u8],
    target: &Target,
    limits: &Limits,
) -> Result<Report, String> {
    let sha1 = hex(&Sha1::digest(bytes));
    let mut budget = limits.max_nested_total;
    analyze(
        Cursor::new(bytes),
        name.into(),
        sha1,
        target,
        limits,
        1,
        &mut budget,
    )
}

/// Overrides statuses with recorded test results, this report and its
/// nested ones. A test is the only source of "compatible".
pub fn apply_test_results(report: &mut Report, results: &TestResults) {
    if let Some(result) = results.by_sha1.get(&report.sha1) {
        report.status = result.status;
        report
            .reasons
            .push("A test run recorded this result for this exact file.".into());
        report.unavailable.extend(result.notes.iter().cloned());
    }
    for nested in &mut report.nested {
        apply_test_results(nested, results);
    }
}

fn analyze<R: Read + Seek>(
    reader: R,
    file_name: String,
    sha1: String,
    target: &Target,
    limits: &Limits,
    nested_depth: u32,
    nested_budget: &mut u64,
) -> Result<Report, String> {
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("{file_name}: not a zip archive ({e})"))?;
    let mut contents = Contents {
        entries: archive.len(),
        ..Default::default()
    };
    let mut report = Report {
        file_name,
        sha1,
        kind: Kind::Unknown,
        descriptors: Vec::new(),
        contents: Contents::default(),
        minecraft_match: VersionMatch::Unknown,
        status: Status::Untested,
        reasons: Vec::new(),
        unavailable: Vec::new(),
        replaced_by_engine: false,
        horizon_equivalent: None,
        nested: Vec::new(),
    };
    if archive.len() > limits.max_entries {
        report.contents = contents;
        report.status = Status::Incompatible;
        report.reasons.push(format!(
            "The archive holds {} entries, more than the {} Kizaflux reads.",
            archive.len(),
            limits.max_entries
        ));
        return Ok(report);
    }

    let mut descriptor_texts: Vec<(Loader, String, String)> = Vec::new();
    let mut manifest = None;
    let mut nested_names = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        contents.uncompressed_bytes = contents.uncompressed_bytes.saturating_add(entry.size());
        if entry.enclosed_name().is_none() {
            contents.unsafe_entries.push(name);
            continue;
        }
        if entry.is_dir() {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".class") {
            contents.class_files += 1;
        }
        // A mod's icon and its translations are not content: every code-only
        // mod has them.
        if let Some(namespace) = namespace_under(&name, "assets/") {
            contents.asset_files += 1;
            let rest = &name["assets/".len() + namespace.len() + 1..];
            if rest.contains('/') && !rest.starts_with("lang/") {
                contents.asset_namespaces.insert(namespace);
            }
        }
        if let Some(namespace) = namespace_under(&name, "data/") {
            contents.data_namespaces.insert(namespace);
        }
        if name == "pack.mcmeta" {
            contents.pack_mcmeta = true;
        }
        if name == "mod.wasm" {
            contents.wasm = true;
        }
        if [".dll", ".so", ".dylib", ".jnilib"]
            .iter()
            .any(|ext| lower.ends_with(ext))
        {
            contents.native_libraries.push(name.clone());
        }
        // `sodium.mixins.json`, `mixins.examplemod.json`: at the root, by convention.
        if !name.contains('/') && lower.ends_with(".json") && lower.contains("mixins") {
            contents.mixin_files.push(name.clone());
        }
        if name == "META-INF/accesstransformer.cfg" {
            contents.access_transformer = true;
        }
        if lower.ends_with(".accesswidener") || lower.ends_with(".classtweaker") {
            contents.access_widener = true;
        }
        if lower.ends_with(".jar") && !name.contains('\\') {
            contents.nested_jars.push(name.clone());
            nested_names.push((index, name.clone(), entry.size()));
        }
        let descriptor = metadata::DESCRIPTORS.iter().find(|(path, _)| *path == name);
        let is_manifest = name == "META-INF/MANIFEST.MF";
        if descriptor.is_some() || is_manifest {
            if entry.size() > limits.max_descriptor_bytes {
                report.reasons.push(format!(
                    "{name} is larger than {} bytes and was not read.",
                    limits.max_descriptor_bytes
                ));
                continue;
            }
            drop(entry);
            let text = read_text(&mut archive, index, limits.max_descriptor_bytes)?;
            match descriptor {
                Some((path, loader)) => descriptor_texts.push((*loader, (*path).to_string(), text)),
                None => manifest = Some(metadata::parse_manifest(&text)),
            }
        }
    }

    for (loader, path, text) in descriptor_texts {
        report
            .descriptors
            .push(metadata::parse(loader, &path, &text, &target.minecraft));
    }
    // Forge registers Mixins in the manifest; give them to the mods it declares.
    if let Some(manifest) = &manifest {
        for descriptor in &mut report.descriptors {
            for m in &mut descriptor.mods {
                for config in &manifest.mixin_configs {
                    if !m.mixin_configs.contains(config) {
                        m.mixin_configs.push(config.clone());
                    }
                }
            }
        }
    }

    if nested_depth > 0 {
        for (index, name, size) in nested_names {
            if size > limits.max_nested_bytes || size > *nested_budget {
                report.reasons.push(format!(
                    "{name} was not opened: larger than the limit for nested jars."
                ));
                continue;
            }
            *nested_budget -= size;
            let bytes = read_bytes(&mut archive, index, limits.max_nested_bytes)?;
            let nested_sha1 = hex(&Sha1::digest(&bytes));
            match analyze(
                Cursor::new(bytes),
                name.clone(),
                nested_sha1,
                target,
                limits,
                nested_depth - 1,
                nested_budget,
            ) {
                Ok(nested) => report.nested.push(nested),
                Err(error) => report.reasons.push(format!("{name}: {error}")),
            }
        }
    }

    report.contents = contents;
    classify(&mut report, manifest.as_ref());
    Ok(report)
}

/// Gives a report its kind and status, with the reasons.
fn classify(report: &mut Report, manifest: Option<&metadata::Manifest>) {
    let contents = &report.contents;
    let loaders: BTreeSet<Loader> = report.descriptors.iter().map(|d| d.loader).collect();
    report.kind = match loaders.iter().next() {
        // Horizon first: a Horizon mod that also carries a Java descriptor is
        // still the mod Kizaflux runs.
        Some(loader) => Kind::Mod(*loader),
        None if contents.class_files > 0 => Kind::PlainJar,
        None if contents.pack_mcmeta && contents.asset_files > 0 => Kind::ResourcePack,
        None if contents.pack_mcmeta && !contents.data_namespaces.is_empty() => Kind::DataPack,
        None => Kind::Unknown,
    };
    report.minecraft_match = minecraft_match(&report.descriptors);
    report.replaced_by_engine = report
        .mod_ids()
        .iter()
        .any(|id| REPLACED_BY_ENGINE.contains(id));
    report.horizon_equivalent = report.mod_ids().iter().find_map(|id| {
        HORIZON_EQUIVALENTS
            .iter()
            .find(|(_, ids)| ids.contains(id))
            .map(|(equivalent, _)| *equivalent)
    });

    let mut reasons = Vec::new();
    let mut unavailable = Vec::new();
    for descriptor in &report.descriptors {
        if let Some(error) = &descriptor.error {
            reasons.push(format!("{} could not be read: {error}", descriptor.path));
        }
    }

    if !contents.unsafe_entries.is_empty() {
        reasons.push(format!(
            "Refused: {} entries name paths outside the archive ({}).",
            contents.unsafe_entries.len(),
            contents
                .unsafe_entries
                .first()
                .map(String::as_str)
                .unwrap_or_default()
        ));
        report.status = Status::Incompatible;
        report.reasons.extend(reasons);
        return;
    }

    let own_content = own_content(contents);
    let mixins: BTreeSet<&str> = report
        .descriptors
        .iter()
        .flat_map(|d| {
            d.mods
                .iter()
                .flat_map(|m| m.mixin_configs.iter().map(String::as_str))
        })
        .chain(contents.mixin_files.iter().map(String::as_str))
        .collect();

    let status = match report.kind {
        Kind::Mod(Loader::Horizon) => {
            reasons.push(
                "A Horizon mod: Kizaflux runs it in its sandbox, which checks its capabilities when it loads."
                    .into(),
            );
            if !contents.wasm && own_content.is_empty() {
                reasons.push("It holds neither code (mod.wasm) nor content.".into());
            }
            Status::Untested
        }
        Kind::ResourcePack => {
            reasons.push(
                "A resource pack: textures, models, sounds and text, no code. Turn it on in the game's Resource Packs screen."
                    .into(),
            );
            Status::ResourcesOnly
        }
        Kind::DataPack => {
            // What Horizon applies of one: playhorizon.dev/docs/mods, 2026-10-28.
            reasons.push(
                "A data pack, for a world's datapacks folder: Horizon runs its functions, predicates and item modifiers."
                    .into(),
            );
            unavailable.push(
                "Its recipes, loot tables, advancements and world generation are not applied by Horizon yet."
                    .into(),
            );
            Status::ResourcesOnly
        }
        Kind::Mod(loader) => {
            let name = loader_name(loader);
            if contents.class_files == 0 {
                reasons.push(format!(
                    "A {name} mod with no Java code: only assets and data."
                ));
                Status::ResourcesOnly
            } else {
                unavailable.push(format!(
                    "Its Java code ({} classes) does not run on Kizaflux, which runs no Java.",
                    contents.class_files
                ));
                if !mixins.is_empty() {
                    unavailable.push(format!(
                        "{} Mixin configuration{} patch Minecraft's Java classes, which Kizaflux does not have.",
                        mixins.len(),
                        if mixins.len() == 1 { "" } else { "s" }
                    ));
                }
                if contents.access_transformer || contents.access_widener {
                    unavailable.push("It widens access to Minecraft's Java classes.".into());
                }
                if let Some(manifest) = manifest {
                    if manifest.core_plugin.is_some() || manifest.tweak_class.is_some() {
                        unavailable.push(
                            "It is a coremod: it rewrites Minecraft's classes as they load.".into(),
                        );
                    }
                }
                if report.replaced_by_engine {
                    reasons.push(
                        "Not needed: Kizaflux's engine does what this mod does for Java (rendering or performance)."
                            .into(),
                    );
                    Status::Incompatible
                } else if own_content.is_empty() {
                    reasons.push(format!(
                        "A {name} mod made of Java code, with no content Kizaflux can carry."
                    ));
                    Status::Incompatible
                } else {
                    reasons.push(format!(
                        "A {name} mod: its assets and data ({}) can come across; what its code does needs a port.",
                        own_content.iter().cloned().collect::<Vec<_>>().join(", ")
                    ));
                    Status::NeedsAdaptation
                }
            }
        }
        Kind::PlainJar => {
            reasons.push("Java classes with no mod descriptor: a library or not a mod. Kizaflux runs no Java.".into());
            Status::Incompatible
        }
        Kind::Unknown => {
            reasons.push("No descriptor, code or pack metadata Kizaflux recognises.".into());
            Status::Untested
        }
    };

    if let Some(equivalent) = report.horizon_equivalent {
        reasons.push(format!(
            "Horizon's official mod `{equivalent}` does what this one is for."
        ));
    }
    if !contents.native_libraries.is_empty() {
        unavailable.push(format!(
            "It ships native libraries ({}), loaded by Java code.",
            contents.native_libraries.len()
        ));
    }
    if report.minecraft_match == VersionMatch::Differs {
        let asked: Vec<&str> = report
            .descriptors
            .iter()
            .flat_map(|d| d.mods.iter().filter_map(|m| m.minecraft.as_deref()))
            .collect();
        reasons.push(format!(
            "Made for Minecraft {}: its files may use formats that need upgrading.",
            asked.join(", ")
        ));
    }

    report.status = status;
    report.reasons.extend(reasons);
    report.unavailable.extend(unavailable);
}

/// The namespaces under `assets/` and `data/` that are the mod's own: not
/// `minecraft` (vanilla overrides) and not the shared tag namespace `c`.
fn own_content(contents: &Contents) -> BTreeSet<String> {
    contents
        .asset_namespaces
        .iter()
        .chain(contents.data_namespaces.iter())
        .filter(|ns| {
            !matches!(
                ns.as_str(),
                "minecraft" | "c" | "forge" | "neoforge" | "fabric"
            )
        })
        .cloned()
        .collect()
}

fn minecraft_match(descriptors: &[Descriptor]) -> VersionMatch {
    let matches: Vec<VersionMatch> = descriptors
        .iter()
        .flat_map(|d| d.mods.iter().filter_map(|m| m.minecraft_match))
        .collect();
    if matches.contains(&VersionMatch::Matches) {
        VersionMatch::Matches
    } else if matches.contains(&VersionMatch::Differs) {
        VersionMatch::Differs
    } else {
        VersionMatch::Unknown
    }
}

fn loader_name(loader: Loader) -> &'static str {
    match loader {
        Loader::Horizon => "Horizon",
        Loader::Fabric => "Fabric",
        Loader::Quilt => "Quilt",
        Loader::Forge => "Forge",
        Loader::NeoForge => "NeoForge",
        Loader::LegacyForge => "Forge (legacy)",
    }
}

fn namespace_under(name: &str, root: &str) -> Option<String> {
    let rest = name.strip_prefix(root)?;
    let (namespace, rest) = rest.split_once('/')?;
    (!namespace.is_empty() && !rest.is_empty()).then(|| namespace.to_string())
}

fn read_text<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    index: usize,
    limit: u64,
) -> Result<String, String> {
    let bytes = read_bytes(archive, index, limit)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Reads at most `limit` bytes of an entry, whatever its header claims.
fn read_bytes<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    index: usize,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let entry = archive.by_index(index).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    entry
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn file_sha1(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests;
