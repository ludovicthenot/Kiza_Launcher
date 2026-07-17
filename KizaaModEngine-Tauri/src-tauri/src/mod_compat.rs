//! Natural mod compatibility checking.
//!
//! Reads `fabric.mod.json` from every enabled jar in the instance mods folder
//! (including one level of nested jars, e.g. Fabric API modules) and reports,
//! without launching the game: Minecraft version compatibility, missing or
//! version-mismatched dependencies, and declared conflicts (`breaks`).

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;

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

/// Numeric-segment version comparison ("1.21.5" vs "1.21.11"). Non-numeric
/// suffixes (e.g. "+build.4", "-beta") are ignored.
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

/// First `count` numeric segments of a version ("26.2-" -> [26, 2]).
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

/// Matches one predicate token against a version. Returns None when the token
/// cannot be interpreted (treated as "unknown", never as a failure).
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
        // Same major version, at least the given version.
        let same_major = leading_numbers(version, 1) == leading_numbers(rest, 1);
        return Some(same_major && cmp_versions(version, rest) != Ordering::Less);
    }
    if let Some(rest) = token.strip_prefix('~') {
        // Same major.minor, at least the given version. Numeric comparison
        // ignores pre-release suffixes like "~26.2-".
        let same_minor = leading_numbers(version, 2) == leading_numbers(rest, 2);
        return Some(same_minor && cmp_versions(version, rest) != Ordering::Less);
    }
    if let Some(prefix) = token
        .strip_suffix(".x")
        .or_else(|| token.strip_suffix(".X"))
    {
        // "1.21.x": the version must start with the same numeric segments.
        let depth = numeric_prefix_len(prefix);
        fn segments(s: &str, depth: usize) -> Vec<String> {
            s.split(|c: char| !c.is_ascii_digit())
                .filter(|x| !x.is_empty())
                .take(depth)
                .map(str::to_string)
                .collect()
        }
        return Some(segments(prefix, depth) == segments(version, depth));
    }
    if token.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return Some(cmp_versions(version, token) == Ordering::Equal);
    }
    None
}

/// Matches a fabric version predicate (space = AND, "||" = OR) against a
/// version. None = could not be interpreted.
fn range_matches(range: &str, version: &str) -> Option<bool> {
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
    if any_known {
        Some(false)
    } else {
        None
    }
}

/// depends/breaks values can be a single range string or an array of ranges (OR).
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
            if any_known {
                Some(false)
            } else {
                None
            }
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

fn read_fabric_mod_json<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Option<FabricModJson> {
    let mut entry = archive.by_name("fabric.mod.json").ok()?;
    let mut content = String::new();
    entry.read_to_string(&mut content).ok()?;
    // Some mods ship raw newlines inside JSON strings; serde tolerates most,
    // fall back to a lenient cleanup if the strict parse fails.
    serde_json::from_str(&content)
        .ok()
        .or_else(|| serde_json::from_str(&content.replace('\n', " ")).ok())
}

struct ScannedJar {
    file_name: String,
    top_level: FabricModJson,
    /// ids provided by this jar (its own id, `provides`, nested jar ids).
    provided: Vec<(String, String)>,
}

fn scan_jar(path: &Path) -> Result<Option<ScannedJar>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let Some(top_level) = read_fabric_mod_json(&mut archive) else {
        return Ok(None);
    };

    let mut provided = vec![(top_level.id.clone(), top_level.version.clone())];
    for id in &top_level.provides {
        provided.push((id.clone(), top_level.version.clone()));
    }
    // One level of nested jars (Fabric API bundles its modules this way).
    for nested in top_level.jars.clone() {
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
            if let Some(nested_json) = read_fabric_mod_json(&mut nested_archive) {
                provided.push((nested_json.id.clone(), nested_json.version.clone()));
                for id in &nested_json.provides {
                    provided.push((id.clone(), nested_json.version.clone()));
                }
            }
        }
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(Some(ScannedJar {
        file_name,
        top_level,
        provided,
    }))
}

pub fn check_compatibility(
    instance_id: &str,
    mods_dir: &Path,
    mc_version: &str,
    loader_version: Option<&str>,
) -> Result<CompatReport, String> {
    let mut jars: Vec<ScannedJar> = Vec::new();
    let mut non_fabric: Vec<String> = Vec::new();

    if let Ok(entries) = fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_jar = path.extension().is_some_and(|ext| ext == "jar");
            if !is_jar {
                continue;
            }
            match scan_jar(&path) {
                Ok(Some(jar)) => jars.push(jar),
                Ok(None) => non_fabric.push(
                    path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                ),
                Err(_) => non_fabric.push(
                    path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                ),
            }
        }
    }

    // Everything installable a dependency can resolve against.
    let mut installed: HashMap<String, String> = HashMap::new();
    installed.insert("minecraft".to_string(), mc_version.to_string());
    // Java always satisfies: the launcher installs the exact major the
    // version JSON declares.
    installed.insert("java".to_string(), "999".to_string());
    if let Some(loader) = loader_version {
        installed.insert("fabricloader".to_string(), loader.to_string());
    }
    for jar in &jars {
        for (id, version) in &jar.provided {
            installed.insert(id.clone(), version.clone());
        }
    }

    let mut mods: Vec<ModCompatEntry> = Vec::new();
    let mut errors = 0usize;
    let mut warnings = 0usize;

    for jar in &jars {
        let json = &jar.top_level;
        let mut issues: Vec<CompatIssue> = Vec::new();
        let mut minecraft_ok: Option<bool> = None;

        for (dep_id, range) in &json.depends {
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
                Some(true) if dep_id == "minecraft" => {
                    minecraft_ok = Some(true);
                }
                Some(true) => {}
                Some(false) => {
                    if dep_id == "minecraft" {
                        minecraft_ok = Some(false);
                        issues.push(CompatIssue {
                            severity: "error".to_string(),
                            message: format!(
                                "Made for Minecraft {}, this instance runs {mc_version}.",
                                range_display(range)
                            ),
                        });
                    } else {
                        issues.push(CompatIssue {
                            severity: "error".to_string(),
                            message: format!(
                                "Requires {dep_id} {} but {installed_version} is installed.",
                                range_display(range)
                            ),
                        });
                    }
                }
                None => {}
            }
        }

        for (broken_id, range) in &json.breaks {
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

        errors += issues.iter().filter(|i| i.severity == "error").count();
        warnings += issues.iter().filter(|i| i.severity == "warning").count();
        mods.push(ModCompatEntry {
            file_name: jar.file_name.clone(),
            mod_id: Some(json.id.clone()),
            name: json.name.clone().or_else(|| Some(json.id.clone())),
            version: Some(json.version.clone()),
            minecraft_ok,
            issues,
        });
    }

    for file_name in non_fabric {
        warnings += 1;
        mods.push(ModCompatEntry {
            file_name: file_name.clone(),
            mod_id: None,
            name: None,
            version: None,
            minecraft_ok: None,
            issues: vec![CompatIssue {
                severity: "warning".to_string(),
                message: "No fabric.mod.json found: not a Fabric mod or an unreadable jar."
                    .to_string(),
            }],
        });
    }

    mods.sort_by(|a, b| {
        let score = |m: &ModCompatEntry| {
            if m.issues.iter().any(|i| i.severity == "error") {
                0
            } else if !m.issues.is_empty() {
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

    #[test]
    fn range_matching_covers_common_fabric_predicates() {
        assert_eq!(range_matches("*", "1.21.5"), Some(true));
        assert_eq!(range_matches(">=1.21", "1.21.5"), Some(true));
        assert_eq!(range_matches(">=1.21.6", "1.21.5"), Some(false));
        assert_eq!(range_matches("1.21.x", "1.21.5"), Some(true));
        assert_eq!(range_matches("1.21.x", "1.22"), Some(false));
        assert_eq!(range_matches(">=0.8.0 <0.9", "0.8.13"), Some(true));
        assert_eq!(range_matches(">=0.8.0 <0.9", "0.9.1"), Some(false));
        assert_eq!(range_matches("1.20.1 || 1.21.5", "1.21.5"), Some(true));
        assert_eq!(range_matches("^9.0.0", "9.7.1"), Some(true));
        assert_eq!(range_matches("^9.0.0", "10.0.0"), Some(false));
        assert_eq!(range_matches("~1.10.0", "1.10.7"), Some(true));
        assert_eq!(range_matches("~1.10.0", "1.11.0"), Some(false));
    }
}

#[cfg(test)]
mod real_scan_tests {
    use super::*;

    // Manual check against the real installed instance.
    // Run with: cargo test --lib real_compat_scan -- --ignored --nocapture
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
            let loader = config["minecraft"]["loader_version"].as_str();
            let mods_dir =
                std::path::PathBuf::from(config["install_path"].as_str().unwrap()).join("mods");
            let report = check_compatibility(id, &mods_dir, mc, loader).unwrap();
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
