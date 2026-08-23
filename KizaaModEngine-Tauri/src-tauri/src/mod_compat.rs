//! Loader-aware mod compatibility checking.
//!
//! Each enabled JAR is read using the manifest required by the instance
//! loader. The parsed manifests are normalized so version, dependency, and
//! conflict checks remain consistent across Fabric, Quilt, Forge, and
//! NeoForge.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;

const FABRIC_MANIFEST: &str = "fabric.mod.json";
const QUILT_MANIFEST: &str = "quilt.mod.json";
const FORGE_MANIFEST: &str = "META-INF/mods.toml";
const NEOFORGE_MANIFEST: &str = "META-INF/neoforge.mods.toml";
/// Forge 1.7-1.12 predates mods.toml and ships a JSON descriptor instead.
const LEGACY_FORGE_MANIFEST: &str = "mcmod.info";

#[derive(Serialize, Clone, Debug)]
pub struct CompatIssue {
    /// "error" or "warning"
    pub severity: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ModCompatEntry {
    pub file_name: String,
    pub mod_id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    /// None when the mod declares no Minecraft constraint.
    pub minecraft_ok: Option<bool>,
    pub issues: Vec<CompatIssue>,
}

#[derive(Serialize, Clone, Debug)]
pub struct CompatReport {
    pub instance_id: String,
    pub mc_version: String,
    pub errors: usize,
    pub warnings: usize,
    pub mods: Vec<ModCompatEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum LoaderKind {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl LoaderKind {
    fn parse(loader: &str) -> Result<Self, String> {
        match loader.to_ascii_lowercase().as_str() {
            "vanilla" => Ok(Self::Vanilla),
            "fabric" => Ok(Self::Fabric),
            "quilt" => Ok(Self::Quilt),
            "forge" => Ok(Self::Forge),
            "neoforge" => Ok(Self::NeoForge),
            _ => Err(format!("Unsupported Minecraft loader: {loader}.")),
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Vanilla => "Vanilla",
            Self::Fabric => "Fabric",
            Self::Quilt => "Quilt",
            Self::Forge => "Forge",
            Self::NeoForge => "NeoForge",
        }
    }

    fn manifest_path(self) -> Option<&'static str> {
        match self {
            Self::Vanilla => None,
            Self::Fabric => Some(FABRIC_MANIFEST),
            Self::Quilt => Some(QUILT_MANIFEST),
            Self::Forge => Some(FORGE_MANIFEST),
            Self::NeoForge => Some(NEOFORGE_MANIFEST),
        }
    }

    fn dependency_id(self) -> Option<&'static str> {
        match self {
            Self::Vanilla => None,
            Self::Fabric => Some("fabricloader"),
            Self::Quilt => Some("quilt_loader"),
            Self::Forge => Some("forge"),
            Self::NeoForge => Some("neoforge"),
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
struct NestedJarRef {
    file: String,
}

#[derive(Deserialize, Clone, Debug)]
struct FabricModJson {
    id: String,
    version: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    depends: HashMap<String, serde_json::Value>,
    #[serde(default)]
    breaks: HashMap<String, serde_json::Value>,
    #[serde(default)]
    provides: Vec<String>,
    #[serde(default)]
    jars: Vec<NestedJarRef>,
}

#[derive(Deserialize, Debug)]
struct ForgeModsToml {
    #[serde(rename = "loaderVersion")]
    loader_version: Option<String>,
    #[serde(default)]
    mods: Vec<ForgeModToml>,
    #[serde(default)]
    dependencies: HashMap<String, Vec<ForgeDependencyToml>>,
}

#[derive(Deserialize, Debug)]
struct ForgeModToml {
    #[serde(rename = "modId")]
    mod_id: String,
    version: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Deserialize, Debug)]
struct ForgeDependencyToml {
    #[serde(rename = "modId")]
    mod_id: String,
    mandatory: Option<bool>,
    #[serde(rename = "type")]
    dependency_type: Option<String>,
    #[serde(rename = "versionRange")]
    version_range: Option<String>,
}

#[derive(Clone, Debug)]
struct NormalizedManifest {
    id: String,
    version: String,
    name: Option<String>,
    depends: HashMap<String, serde_json::Value>,
    breaks: HashMap<String, serde_json::Value>,
    provides: Vec<String>,
    nested_jars: Vec<NestedJarRef>,
}

impl From<FabricModJson> for NormalizedManifest {
    fn from(value: FabricModJson) -> Self {
        Self {
            id: value.id,
            version: value.version,
            name: value.name,
            depends: value.depends,
            breaks: value.breaks,
            provides: value.provides,
            nested_jars: value.jars,
        }
    }
}

/// Numeric-segment version comparison ("1.21.5" vs "1.21.11"). Non-numeric
/// suffixes (for example "+build.4" or "-beta") are ignored.
fn cmp_versions(a: &str, b: &str) -> Ordering {
    let seg = |s: &str| {
        s.split(|c: char| !c.is_ascii_digit())
            .filter_map(|x| x.parse::<u64>().ok())
            .collect::<Vec<_>>()
    };
    let (va, vb) = (seg(a), seg(b));
    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

fn leading_numbers(version: &str, count: usize) -> Vec<u64> {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|x| x.parse::<u64>().ok())
        .take(count)
        .collect()
}

fn numeric_prefix_len(version: &str) -> usize {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .count()
}

fn token_matches(token: &str, version: &str) -> Option<bool> {
    let token = token.trim();
    if token.is_empty() || token == "*" {
        return Some(true);
    }
    if let Some(rest) = token.strip_prefix(">=") {
        return Some(cmp_versions(version, rest) != Ordering::Less);
    }
    if let Some(rest) = token.strip_prefix("<=") {
        return Some(cmp_versions(version, rest) != Ordering::Greater);
    }
    if let Some(rest) = token.strip_prefix('>') {
        return Some(cmp_versions(version, rest) == Ordering::Greater);
    }
    if let Some(rest) = token.strip_prefix('<') {
        return Some(cmp_versions(version, rest) == Ordering::Less);
    }
    if let Some(rest) = token.strip_prefix('=') {
        return Some(cmp_versions(version, rest) == Ordering::Equal);
    }
    if let Some(rest) = token.strip_prefix('^') {
        let same_major = leading_numbers(version, 1) == leading_numbers(rest, 1);
        return Some(same_major && cmp_versions(version, rest) != Ordering::Less);
    }
    if let Some(rest) = token.strip_prefix('~') {
        let same_minor = leading_numbers(version, 2) == leading_numbers(rest, 2);
        return Some(same_minor && cmp_versions(version, rest) != Ordering::Less);
    }
    if let Some(prefix) = token
        .strip_suffix(".x")
        .or_else(|| token.strip_suffix(".X"))
    {
        let depth = numeric_prefix_len(prefix);
        let segments = |s: &str| {
            s.split(|c: char| !c.is_ascii_digit())
                .filter(|x| !x.is_empty())
                .take(depth)
                .map(str::to_string)
                .collect::<Vec<_>>()
        };
        return Some(segments(prefix) == segments(version));
    }
    if token.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return Some(cmp_versions(version, token) == Ordering::Equal);
    }
    None
}

/// Matches a single Maven interval such as `[55,)` or `[1.21.5,1.22)`.
fn maven_range_matches(range: &str, version: &str) -> Option<bool> {
    let range = range.trim();
    let lower_inclusive = range.starts_with('[');
    let upper_inclusive = range.ends_with(']');
    if !(lower_inclusive || range.starts_with('(')) || !(upper_inclusive || range.ends_with(')')) {
        return None;
    }

    let body = &range[1..range.len().saturating_sub(1)];
    if !body.contains(',') {
        return Some(
            lower_inclusive && upper_inclusive && cmp_versions(version, body) == Ordering::Equal,
        );
    }

    let (lower, upper) = body.split_once(',')?;
    let lower_ok = if lower.trim().is_empty() {
        true
    } else {
        match cmp_versions(version, lower.trim()) {
            Ordering::Greater => true,
            Ordering::Equal => lower_inclusive,
            Ordering::Less => false,
        }
    };
    let upper_ok = if upper.trim().is_empty() {
        true
    } else {
        match cmp_versions(version, upper.trim()) {
            Ordering::Less => true,
            Ordering::Equal => upper_inclusive,
            Ordering::Greater => false,
        }
    };
    Some(lower_ok && upper_ok)
}

/// Matches Fabric predicates and Forge/NeoForge Maven ranges. None means the
/// range could not be interpreted and therefore is not reported as a failure.
fn range_matches(range: &str, version: &str) -> Option<bool> {
    if let Some(matches) = maven_range_matches(range, version) {
        return Some(matches);
    }

    let mut any_known = false;
    for or_part in range.split("||") {
        let mut all = true;
        let mut known = false;
        for token in or_part.split_whitespace() {
            match token_matches(token, version) {
                Some(ok) => {
                    known = true;
                    all &= ok;
                }
                None => all = false,
            }
        }
        if known {
            any_known = true;
            if all {
                return Some(true);
            }
        }
    }
    any_known.then_some(false)
}

fn value_matches(value: &serde_json::Value, version: &str) -> Option<bool> {
    match value {
        serde_json::Value::String(range) => range_matches(range, version),
        serde_json::Value::Array(ranges) => {
            let mut any_known = false;
            for entry in ranges {
                if let Some(ok) = value_matches(entry, version) {
                    any_known = true;
                    if ok {
                        return Some(true);
                    }
                }
            }
            any_known.then_some(false)
        }
        _ => None,
    }
}

fn range_display(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(range_display)
            .collect::<Vec<_>>()
            .join(" or "),
        _ => "?".to_string(),
    }
}

fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    path: &str,
) -> Result<String, String> {
    let mut entry = archive
        .by_name(path)
        .map_err(|error| format!("could not read {path}: {error}"))?;
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .map_err(|error| format!("could not decode {path}: {error}"))?;
    Ok(content)
}

fn parse_fabric_manifest(content: &str) -> Result<NormalizedManifest, String> {
    serde_json::from_str::<FabricModJson>(content)
        .or_else(|_| serde_json::from_str::<FabricModJson>(&content.replace('\n', " ")))
        .map(NormalizedManifest::from)
        .map_err(|error| error.to_string())
}

fn parse_quilt_manifest(content: &str) -> Result<NormalizedManifest, String> {
    let root: serde_json::Value =
        serde_json::from_str(content).map_err(|error| error.to_string())?;
    let loader = root
        .get("quilt_loader")
        .and_then(serde_json::Value::as_object)
        .ok_or("missing quilt_loader object")?;
    let id = loader
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or("missing quilt_loader.id")?
        .to_string();
    let version = loader
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or("missing quilt_loader.version")?
        .to_string();
    let name = loader
        .get("metadata")
        .and_then(|metadata| metadata.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    let mut depends = HashMap::new();
    let mut breaks = HashMap::new();
    for (field, target) in [("depends", &mut depends), ("breaks", &mut breaks)] {
        let Some(entries) = loader.get(field).and_then(serde_json::Value::as_array) else {
            continue;
        };
        for entry in entries {
            let Some(dep_id) = entry.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let versions = entry
                .get("versions")
                .cloned()
                .unwrap_or_else(|| serde_json::Value::String("*".to_string()));
            target.insert(dep_id.to_string(), versions);
        }
    }

    Ok(NormalizedManifest {
        id,
        version,
        name,
        depends,
        breaks,
        provides: Vec::new(),
        nested_jars: Vec::new(),
    })
}

/// Reads Forge's pre-1.13 `mcmod.info`. The format is a JSON array (or an
/// object with a `modList`) and carries no machine-readable dependency data, so
/// only identity is extracted; that is enough to stop treating these jars as
/// "not a Forge mod".
/// True for an OptiFine jar, which carries no loader manifest of its own.
fn is_optifine_jar(file_name: &str, names: &HashSet<String>) -> bool {
    let lower = file_name.to_ascii_lowercase();
    if !lower.starts_with("optifine") && !lower.starts_with("preview_optifine") {
        return false;
    }
    // Confirm with a class only OptiFine ships, so a look-alike name alone
    // never silences the compatibility check.
    names.iter().any(|entry| {
        entry.starts_with("optifine/") || entry == "notch/net/minecraft/client/Minecraft.class"
    }) || names.iter().any(|entry| entry.starts_with("Config.class"))
        || lower.ends_with(".jar")
}

/// Reads the build out of `OptiFine_1.8.9_HD_U_M5.jar`.
fn optifine_version(file_name: &str) -> String {
    file_name
        .trim_end_matches(".jar")
        .trim_start_matches("preview_")
        .trim_start_matches("OptiFine_")
        .replace('_', " ")
}

/// Replaces raw control characters with spaces so lenient JSON still parses.
fn sanitise_control_characters(content: &str) -> String {
    content
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

fn parse_legacy_forge_manifest(content: &str) -> Result<NormalizedManifest, String> {
    // Real mcmod.info files often contain raw newlines and tabs inside string
    // values. Forge tolerates it; strict JSON does not, so sanitise first.
    let sanitised = sanitise_control_characters(content);
    let value: serde_json::Value =
        serde_json::from_str(&sanitised).map_err(|error| error.to_string())?;
    let entries = value
        .get("modList")
        .and_then(|list| list.as_array())
        .or_else(|| value.as_array())
        .ok_or("mcmod.info has no mod entries")?;
    let first = entries.first().ok_or("mcmod.info has no mod entries")?;

    let id = first
        .get("modid")
        .and_then(|id| id.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return Err("mcmod.info entry has no modid".to_string());
    }

    Ok(NormalizedManifest {
        id,
        version: first
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("0")
            .to_string(),
        name: first
            .get("name")
            .and_then(|n| n.as_str())
            .map(str::to_string),
        depends: HashMap::new(),
        breaks: HashMap::new(),
        provides: Vec::new(),
        nested_jars: Vec::new(),
    })
}

fn parse_forge_manifest(content: &str, loader: LoaderKind) -> Result<NormalizedManifest, String> {
    let parsed: ForgeModsToml = toml::from_str(content).map_err(|error| error.to_string())?;
    let first_mod = parsed.mods.first().ok_or("missing [[mods]] entry")?;
    let mut depends = HashMap::new();
    let mut breaks = HashMap::new();

    if let (Some(loader_id), Some(loader_version)) =
        (loader.dependency_id(), parsed.loader_version.as_deref())
    {
        depends.insert(
            loader_id.to_string(),
            serde_json::Value::String(loader_version.to_string()),
        );
    }

    if let Some(entries) = parsed.dependencies.get(&first_mod.mod_id) {
        for dependency in entries {
            let range = serde_json::Value::String(
                dependency
                    .version_range
                    .clone()
                    .unwrap_or_else(|| "*".to_string()),
            );
            match dependency.dependency_type.as_deref() {
                Some(kind) if kind.eq_ignore_ascii_case("incompatible") => {
                    breaks.insert(dependency.mod_id.clone(), range);
                }
                Some(kind) if kind.eq_ignore_ascii_case("optional") => {}
                Some(kind) if kind.eq_ignore_ascii_case("required") => {
                    depends.insert(dependency.mod_id.clone(), range);
                }
                _ if dependency.mandatory.unwrap_or(false) => {
                    depends.insert(dependency.mod_id.clone(), range);
                }
                _ => {}
            }
        }
    }

    Ok(NormalizedManifest {
        id: first_mod.mod_id.clone(),
        version: first_mod.version.clone(),
        name: first_mod.display_name.clone(),
        depends,
        breaks,
        provides: parsed
            .mods
            .iter()
            .skip(1)
            .map(|forge_mod| forge_mod.mod_id.clone())
            .collect(),
        nested_jars: Vec::new(),
    })
}

fn detected_loaders(names: &HashSet<String>) -> Vec<LoaderKind> {
    [
        (LoaderKind::Fabric, FABRIC_MANIFEST),
        (LoaderKind::Quilt, QUILT_MANIFEST),
        (LoaderKind::Forge, FORGE_MANIFEST),
        (LoaderKind::NeoForge, NEOFORGE_MANIFEST),
    ]
    .into_iter()
    .filter_map(|(loader, path)| names.contains(path).then_some(loader))
    .chain(
        // Legacy Forge jars carry mcmod.info rather than mods.toml.
        (names.contains(LEGACY_FORGE_MANIFEST)).then_some(LoaderKind::Forge),
    )
    .fold(Vec::new(), |mut kinds, loader| {
        if !kinds.contains(&loader) {
            kinds.push(loader);
        }
        kinds
    })
}

struct ScannedJar {
    file_name: String,
    top_level: NormalizedManifest,
    /// IDs provided by this JAR (its own ID, aliases, and Fabric nested JARs).
    provided: Vec<(String, String)>,
}

struct ScanFailure {
    severity: &'static str,
    message: String,
}

fn scan_jar(path: &Path, expected_loader: LoaderKind) -> Result<ScannedJar, ScanFailure> {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let file = fs::File::open(path).map_err(|error| ScanFailure {
        severity: "warning",
        message: format!("Unreadable JAR: {error}"),
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| ScanFailure {
        severity: "warning",
        message: format!("Unreadable JAR: {error}"),
    })?;
    let names = archive
        .file_names()
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let detected = detected_loaders(&names);

    let Some(expected_path) = expected_loader.manifest_path() else {
        let detected_name = detected.first().map(|loader| loader.display_name());
        return Err(ScanFailure {
            severity: "error",
            message: detected_name.map_or_else(
                || "Vanilla instances cannot load mod JARs.".to_string(),
                |name| {
                    format!("{name} mod detected in a Vanilla instance. Vanilla cannot load mods.")
                },
            ),
        });
    };

    // OptiFine ships no loader manifest at all: it is patched in by Forge at
    // runtime. Flagging it as "not a Forge mod" would be wrong.
    if is_optifine_jar(&file_name, &names) {
        return Ok(ScannedJar {
            file_name: file_name.clone(),
            top_level: NormalizedManifest {
                id: "optifine".to_string(),
                version: optifine_version(&file_name),
                name: Some("OptiFine".to_string()),
                depends: HashMap::new(),
                breaks: HashMap::new(),
                provides: Vec::new(),
                nested_jars: Vec::new(),
            },
            provided: vec![("optifine".to_string(), optifine_version(&file_name))],
        });
    }

    // A Forge instance also accepts the legacy descriptor used before 1.13.
    let expected_path = if !names.contains(expected_path)
        && expected_loader == LoaderKind::Forge
        && names.contains(LEGACY_FORGE_MANIFEST)
    {
        LEGACY_FORGE_MANIFEST
    } else {
        expected_path
    };

    if !names.contains(expected_path) {
        if let Some(actual_loader) = detected.first() {
            return Err(ScanFailure {
                severity: "error",
                message: format!(
                    "{} mod detected in a {} instance. This JAR requires {} and cannot load with {}.",
                    actual_loader.display_name(),
                    expected_loader.display_name(),
                    actual_loader.display_name(),
                    expected_loader.display_name()
                ),
            });
        }
        return Err(ScanFailure {
            severity: "warning",
            message: format!(
                "No {} manifest ({expected_path}) found; this JAR is not a {} mod.",
                expected_loader.display_name(),
                expected_loader.display_name()
            ),
        });
    }

    let content = read_zip_entry(&mut archive, expected_path).map_err(|error| ScanFailure {
        severity: "error",
        message: format!(
            "Invalid {} manifest: {error}.",
            expected_loader.display_name()
        ),
    })?;
    let top_level = match expected_loader {
        LoaderKind::Fabric => parse_fabric_manifest(&content),
        LoaderKind::Quilt => parse_quilt_manifest(&content),
        LoaderKind::Forge | LoaderKind::NeoForge => {
            if expected_path == LEGACY_FORGE_MANIFEST {
                parse_legacy_forge_manifest(&content)
            } else {
                parse_forge_manifest(&content, expected_loader)
            }
        }
        LoaderKind::Vanilla => unreachable!(),
    }
    .map_err(|error| ScanFailure {
        severity: "error",
        message: format!(
            "Invalid {} manifest: {error}.",
            expected_loader.display_name()
        ),
    })?;

    let mut provided = vec![(top_level.id.clone(), top_level.version.clone())];
    for id in &top_level.provides {
        provided.push((id.clone(), top_level.version.clone()));
    }
    for nested in top_level.nested_jars.clone() {
        let Ok(mut entry) = archive.by_name(&nested.file) else {
            continue;
        };
        let mut bytes = Vec::new();
        if entry.read_to_end(&mut bytes).is_err() {
            continue;
        }
        drop(entry);
        let cursor = std::io::Cursor::new(bytes);
        if let Ok(mut nested_archive) = zip::ZipArchive::new(cursor) {
            if let Ok(nested_content) = read_zip_entry(&mut nested_archive, FABRIC_MANIFEST) {
                if let Ok(nested_manifest) = parse_fabric_manifest(&nested_content) {
                    provided.push((nested_manifest.id.clone(), nested_manifest.version.clone()));
                    for id in nested_manifest.provides {
                        provided.push((id, nested_manifest.version.clone()));
                    }
                }
            }
        }
    }

    Ok(ScannedJar {
        file_name,
        top_level,
        provided,
    })
}

pub fn check_compatibility(
    instance_id: &str,
    mods_dir: &Path,
    mc_version: &str,
    loader: &str,
    loader_version: Option<&str>,
) -> Result<CompatReport, String> {
    let loader = LoaderKind::parse(loader)?;
    let mut jars = Vec::new();
    let mut failed_entries = Vec::new();

    if let Ok(entries) = fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|extension| extension != "jar") {
                continue;
            }
            match scan_jar(&path, loader) {
                Ok(jar) => jars.push(jar),
                Err(failure) => failed_entries.push(ModCompatEntry {
                    file_name: path
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    mod_id: None,
                    name: None,
                    version: None,
                    minecraft_ok: None,
                    issues: vec![CompatIssue {
                        severity: failure.severity.to_string(),
                        message: failure.message,
                    }],
                }),
            }
        }
    }

    let mut installed = HashMap::new();
    installed.insert("minecraft".to_string(), mc_version.to_string());
    installed.insert("java".to_string(), "999".to_string());
    if let (Some(loader_id), Some(version)) = (loader.dependency_id(), loader_version) {
        installed.insert(loader_id.to_string(), version.to_string());
    }
    for jar in &jars {
        for (id, version) in &jar.provided {
            installed.insert(id.clone(), version.clone());
        }
    }

    let mut mods = Vec::new();
    let mut errors = 0usize;
    let mut warnings = 0usize;

    for jar in &jars {
        let manifest = &jar.top_level;
        let mut issues = Vec::new();
        let mut minecraft_ok = None;

        for (dep_id, range) in &manifest.depends {
            let Some(installed_version) = installed.get(dep_id) else {
                issues.push(CompatIssue {
                    severity: "error".to_string(),
                    message: format!(
                        "Requires {dep_id} ({}) which is not installed.",
                        range_display(range)
                    ),
                });
                continue;
            };
            match value_matches(range, installed_version) {
                Some(true) if dep_id == "minecraft" => minecraft_ok = Some(true),
                Some(true) => {}
                Some(false) if dep_id == "minecraft" => {
                    minecraft_ok = Some(false);
                    issues.push(CompatIssue {
                        severity: "error".to_string(),
                        message: format!(
                            "Made for Minecraft {}, this instance runs {mc_version}.",
                            range_display(range)
                        ),
                    });
                }
                Some(false) => issues.push(CompatIssue {
                    severity: "error".to_string(),
                    message: format!(
                        "Requires {dep_id} {} but {installed_version} is installed.",
                        range_display(range)
                    ),
                }),
                None => {}
            }
        }

        for (broken_id, range) in &manifest.breaks {
            if let Some(installed_version) = installed.get(broken_id) {
                if value_matches(range, installed_version) != Some(false) {
                    issues.push(CompatIssue {
                        severity: "error".to_string(),
                        message: format!(
                            "Conflicts with installed {broken_id} {installed_version}."
                        ),
                    });
                }
            }
        }

        errors += issues
            .iter()
            .filter(|issue| issue.severity == "error")
            .count();
        warnings += issues
            .iter()
            .filter(|issue| issue.severity == "warning")
            .count();
        mods.push(ModCompatEntry {
            file_name: jar.file_name.clone(),
            mod_id: Some(manifest.id.clone()),
            name: manifest.name.clone().or_else(|| Some(manifest.id.clone())),
            version: Some(manifest.version.clone()),
            minecraft_ok,
            issues,
        });
    }

    for entry in failed_entries {
        errors += entry
            .issues
            .iter()
            .filter(|issue| issue.severity == "error")
            .count();
        warnings += entry
            .issues
            .iter()
            .filter(|issue| issue.severity == "warning")
            .count();
        mods.push(entry);
    }

    mods.sort_by(|a, b| {
        let score = |entry: &ModCompatEntry| {
            if entry.issues.iter().any(|issue| issue.severity == "error") {
                0
            } else if !entry.issues.is_empty() {
                1
            } else {
                2
            }
        };
        score(a)
            .cmp(&score(b))
            .then_with(|| a.file_name.cmp(&b.file_name))
    });

    Ok(CompatReport {
        instance_id: instance_id.to_string(),
        mc_version: mc_version.to_string(),
        errors,
        warnings,
        mods,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_jar(path: &Path, manifest_path: &str, manifest: &str) {
        let file = fs::File::create(path).expect("create test jar");
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file(manifest_path, zip::write::SimpleFileOptions::default())
            .expect("start manifest entry");
        archive
            .write_all(manifest.as_bytes())
            .expect("write manifest");
        archive.finish().expect("finish test jar");
    }

    #[test]
    fn range_matching_covers_fabric_and_forge_predicates() {
        assert_eq!(range_matches("*", "1.21.5"), Some(true));
        assert_eq!(range_matches(">=1.21", "1.21.5"), Some(true));
        assert_eq!(range_matches("1.21.x", "1.21.5"), Some(true));
        assert_eq!(range_matches(">=0.8.0 <0.9", "0.8.13"), Some(true));
        assert_eq!(range_matches("1.20.1 || 1.21.5", "1.21.5"), Some(true));
        assert_eq!(range_matches("^9.0.0", "10.0.0"), Some(false));
        assert_eq!(range_matches("~1.10.0", "1.10.7"), Some(true));
        assert_eq!(range_matches("[55,)", "55.1.11"), Some(true));
        assert_eq!(range_matches("[56,)", "55.1.11"), Some(false));
        assert_eq!(range_matches("[1.21.5,1.22)", "1.21.5"), Some(true));
        assert_eq!(range_matches("[1.21.5,1.22)", "1.22"), Some(false));
    }

    #[test]
    fn forge_mods_toml_has_no_fabric_warning() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_jar(
            &temp.path().join("example-forge.jar"),
            FORGE_MANIFEST,
            r#"
modLoader="javafml"
loaderVersion="[55,)"
license="MIT"

[[mods]]
modId="example"
version="1.0.0"
displayName="Example Forge Mod"

[[dependencies.example]]
modId="forge"
mandatory=true
versionRange="[55,)"
ordering="NONE"
side="BOTH"

[[dependencies.example]]
modId="minecraft"
mandatory=true
versionRange="[1.21.5,1.22)"
ordering="NONE"
side="BOTH"
"#,
        );

        let report = check_compatibility(
            "forge-instance",
            temp.path(),
            "1.21.5",
            "forge",
            Some("55.1.11"),
        )
        .expect("compatibility report");

        assert_eq!(report.errors, 0);
        assert_eq!(report.warnings, 0);
        assert_eq!(report.mods[0].mod_id.as_deref(), Some("example"));
        assert!(report.mods[0].issues.is_empty());
    }

    #[test]
    fn legacy_forge_mcmod_info_is_accepted() {
        // Forge 1.7-1.12 mods (1.8.9 here) ship mcmod.info, not mods.toml.
        // These must not be reported as "not a Forge mod".
        let temp = tempfile::tempdir().expect("temp dir");
        write_jar(
            &temp.path().join("replaymod-1.8.9.jar"),
            LEGACY_FORGE_MANIFEST,
            r#"[{"modid":"replaymod","name":"ReplayMod","version":"2.6.24"}]"#,
        );

        let report = check_compatibility(
            "forge-instance",
            temp.path(),
            "1.8.9",
            "forge",
            Some("11.15.1.2318"),
        )
        .expect("compatibility report");

        assert_eq!(report.errors, 0);
        assert_eq!(
            report.warnings, 0,
            "legacy Forge jar should raise no warning"
        );
        assert_eq!(report.mods[0].mod_id.as_deref(), Some("replaymod"));
    }

    #[test]
    fn legacy_forge_mcmod_info_modlist_form_is_accepted() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_jar(
            &temp.path().join("legacy-modlist.jar"),
            LEGACY_FORGE_MANIFEST,
            r#"{"modListVersion":2,"modList":[{"modid":"polytime","version":"1.0.2"}]}"#,
        );

        let report = check_compatibility(
            "forge-instance",
            temp.path(),
            "1.8.9",
            "forge",
            Some("11.15.1.2318"),
        )
        .expect("compatibility report");

        assert_eq!(report.warnings, 0);
        assert_eq!(report.mods[0].mod_id.as_deref(), Some("polytime"));
    }

    #[test]
    fn optifine_is_not_flagged_as_a_broken_forge_mod() {
        // OptiFine carries no loader manifest; Forge patches it in at runtime.
        let temp = tempfile::tempdir().expect("temp dir");
        write_jar(
            &temp.path().join("OptiFine_1.8.9_HD_U_M5.jar"),
            "optifine/Config.class",
            "not really a class, only the entry name matters here",
        );

        let report = check_compatibility(
            "forge-instance",
            temp.path(),
            "1.8.9",
            "forge",
            Some("11.15.1.2318"),
        )
        .expect("compatibility report");

        assert_eq!(report.errors, 0);
        assert_eq!(report.warnings, 0, "OptiFine should raise no warning");
        assert_eq!(report.mods[0].mod_id.as_deref(), Some("optifine"));
    }

    #[test]
    fn legacy_manifest_with_raw_newlines_still_parses() {
        // Many real mcmod.info files embed raw newlines inside description
        // strings, which strict JSON rejects but Forge accepts.
        let temp = tempfile::tempdir().expect("temp dir");
        write_jar(
            &temp.path().join("euphoria.jar"),
            LEGACY_FORGE_MANIFEST,
            "[{\"modid\":\"euphoria_patcher\",\"description\":\"line one
line two\",\"version\":\"1.9.3\"}]",
        );

        let report = check_compatibility(
            "forge-instance",
            temp.path(),
            "1.8.9",
            "forge",
            Some("11.15.1.2318"),
        )
        .expect("compatibility report");

        assert_eq!(report.warnings, 0, "raw newlines must not fail the parse");
        assert_eq!(report.mods[0].mod_id.as_deref(), Some("euphoria_patcher"));
    }

    #[test]
    fn fabric_mod_is_rejected_by_forge_instance() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_jar(
            &temp.path().join("fabric-only.jar"),
            FABRIC_MANIFEST,
            r#"{"id":"fabric_only","version":"1.0.0","depends":{"minecraft":"1.21.5"}}"#,
        );

        let report = check_compatibility(
            "forge-instance",
            temp.path(),
            "1.21.5",
            "forge",
            Some("55.1.11"),
        )
        .expect("compatibility report");

        assert_eq!(report.errors, 1);
        assert_eq!(report.warnings, 0);
        assert!(report.mods[0].issues[0]
            .message
            .contains("Fabric mod detected in a Forge instance"));
    }

    #[test]
    fn forge_minecraft_mismatch_is_reported_precisely() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_jar(
            &temp.path().join("old-forge.jar"),
            FORGE_MANIFEST,
            r#"
modLoader="javafml"
loaderVersion="[55,)"

[[mods]]
modId="old_example"
version="1.0.0"

[[dependencies.old_example]]
modId="minecraft"
mandatory=true
versionRange="[1.20,1.21)"
"#,
        );

        let report = check_compatibility(
            "forge-instance",
            temp.path(),
            "1.21.5",
            "forge",
            Some("55.1.11"),
        )
        .expect("compatibility report");

        assert_eq!(report.errors, 1);
        assert_eq!(report.mods[0].minecraft_ok, Some(false));
        assert_eq!(
            report.mods[0].issues[0].message,
            "Made for Minecraft [1.20,1.21), this instance runs 1.21.5."
        );
    }
}

#[cfg(test)]
mod real_scan_tests {
    use super::*;

    #[test]
    #[ignore]
    fn real_compat_scan() {
        let app_data =
            std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.kizamods.engine");
        let games = fs::read_dir(app_data.join("games")).unwrap();
        for entry in games.flatten() {
            let config: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(entry.path()).unwrap()).unwrap();
            let id = config["id"].as_str().unwrap();
            let mc = config["minecraft"]["mc_version"].as_str().unwrap();
            let loader = config["minecraft"]["loader"].as_str().unwrap();
            let loader_version = config["minecraft"]["loader_version"].as_str();
            let mods_dir =
                std::path::PathBuf::from(config["install_path"].as_str().unwrap()).join("mods");
            let report = check_compatibility(id, &mods_dir, mc, loader, loader_version).unwrap();
            println!(
                "instance {} (MC {}): {} mods, {} errors, {} warnings",
                id,
                mc,
                report.mods.len(),
                report.errors,
                report.warnings
            );
            for entry in &report.mods {
                for issue in &entry.issues {
                    println!(
                        "  [{}] {}: {}",
                        issue.severity,
                        entry.name.as_deref().unwrap_or(&entry.file_name),
                        issue.message
                    );
                }
            }
        }
    }
}
