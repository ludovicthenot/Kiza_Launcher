//! The descriptors each loader reads from a jar, parsed into one shape.
//!
//! Only what Kizaflux decides on is kept: who the mod is, which Minecraft it
//! asks for, what it depends on and which Mixin configurations it registers.
//! A descriptor that does not parse is reported, never guessed at.

use serde::Serialize;
use serde_json::Value;

use crate::versions::{self, VersionMatch};

/// The loader a descriptor belongs to.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Loader {
    /// A Horizon mod (`horizon-mod.toml`): WebAssembly, runs on Kizaflux.
    Horizon,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
    /// Forge before 1.13 (`mcmod.info`).
    LegacyForge,
}

impl Loader {
    pub fn is_java(self) -> bool {
        !matches!(self, Self::Horizon)
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Dependency {
    pub id: String,
    /// The requirement as written: a version range in the loader's grammar.
    pub requirement: Option<String>,
    pub required: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ModMetadata {
    pub id: String,
    pub name: Option<String>,
    pub version: Option<String>,
    /// The Minecraft requirement as written, for the report.
    pub minecraft: Option<String>,
    /// Whether that requirement covers the engine's version.
    pub minecraft_match: Option<VersionMatch>,
    pub dependencies: Vec<Dependency>,
    /// Mixin configurations the descriptor (or the manifest) registers.
    pub mixin_configs: Vec<String>,
    /// For a Horizon mod: the API it targets and the capabilities it asks for.
    pub horizon_api: Option<String>,
    pub capabilities: Vec<String>,
    /// `client`, `server`, `both` or `*`, when the descriptor says.
    pub environment: Option<String>,
}

/// One descriptor found in an archive.
#[derive(Serialize, Clone, Debug)]
pub struct Descriptor {
    pub loader: Loader,
    pub path: String,
    /// The mods it declares; a Forge `mods.toml` may declare several.
    pub mods: Vec<ModMetadata>,
    /// Why it could not be read, when it could not.
    pub error: Option<String>,
}

/// The descriptor file names, by loader.
pub const DESCRIPTORS: &[(&str, Loader)] = &[
    ("horizon-mod.toml", Loader::Horizon),
    ("fabric.mod.json", Loader::Fabric),
    ("quilt.mod.json", Loader::Quilt),
    ("META-INF/neoforge.mods.toml", Loader::NeoForge),
    ("META-INF/mods.toml", Loader::Forge),
    ("mcmod.info", Loader::LegacyForge),
];

pub fn parse(loader: Loader, path: &str, text: &str, minecraft: &str) -> Descriptor {
    let parsed = match loader {
        Loader::Horizon => parse_horizon(text),
        Loader::Fabric => parse_fabric(text, minecraft),
        Loader::Quilt => parse_quilt(text, minecraft),
        Loader::Forge | Loader::NeoForge => parse_mods_toml(text, minecraft),
        Loader::LegacyForge => parse_mcmod_info(text, minecraft),
    };
    match parsed {
        Ok(mods) => Descriptor {
            loader,
            path: path.into(),
            mods,
            error: None,
        },
        Err(error) => Descriptor {
            loader,
            path: path.into(),
            mods: Vec::new(),
            error: Some(error),
        },
    }
}

fn parse_horizon(text: &str) -> Result<Vec<ModMetadata>, String> {
    let value: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    let id = value.get("id").and_then(|v| v.as_str()).ok_or("no id")?;
    Ok(vec![ModMetadata {
        id: id.into(),
        name: toml_string(&value, "name"),
        version: toml_string(&value, "version"),
        horizon_api: toml_string(&value, "api"),
        environment: toml_string(&value, "side"),
        capabilities: value
            .get("capabilities")
            .and_then(|v| v.as_array())
            .map(|list| {
                list.iter()
                    .filter_map(|c| c.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        ..Default::default()
    }])
}

fn parse_fabric(text: &str, minecraft: &str) -> Result<Vec<ModMetadata>, String> {
    let value = lenient_json(text)?;
    let id = value.get("id").and_then(Value::as_str).ok_or("no id")?;
    let mut dependencies = Vec::new();
    let mut minecraft_alternatives = Vec::new();
    for (key, required) in [
        ("depends", true),
        ("recommends", false),
        ("suggests", false),
    ] {
        let Some(map) = value.get(key).and_then(Value::as_object) else {
            continue;
        };
        for (dep, requirement) in map {
            let alternatives = string_or_list(requirement);
            if dep == "minecraft" && required {
                minecraft_alternatives = alternatives.clone();
            }
            dependencies.push(Dependency {
                id: dep.clone(),
                requirement: (!alternatives.is_empty()).then(|| alternatives.join(" || ")),
                required,
            });
        }
    }
    let mixin_configs = value
        .get("mixins")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|m| {
                    m.as_str()
                        .or_else(|| m.get("config").and_then(Value::as_str))
                })
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let (minecraft_text, minecraft_match) = requirement(&minecraft_alternatives, |alternatives| {
        versions::fabric_matches(alternatives, minecraft)
    });
    Ok(vec![ModMetadata {
        id: id.into(),
        name: json_string(&value, "name"),
        version: json_string(&value, "version"),
        minecraft: minecraft_text,
        minecraft_match,
        dependencies,
        mixin_configs,
        environment: json_string(&value, "environment"),
        ..Default::default()
    }])
}

fn parse_quilt(text: &str, minecraft: &str) -> Result<Vec<ModMetadata>, String> {
    let value = lenient_json(text)?;
    let loader = value.get("quilt_loader").ok_or("no quilt_loader")?;
    let id = loader.get("id").and_then(Value::as_str).ok_or("no id")?;
    let mut dependencies = Vec::new();
    let mut minecraft_alternatives = Vec::new();
    for dep in loader
        .get("depends")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (dep_id, alternatives, optional) = match dep {
            Value::String(s) => (s.clone(), Vec::new(), false),
            Value::Object(o) => (
                o.get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                o.get("versions").map(string_or_list).unwrap_or_default(),
                o.get("optional").and_then(Value::as_bool).unwrap_or(false),
            ),
            _ => continue,
        };
        if dep_id == "minecraft" && !optional {
            minecraft_alternatives = alternatives.clone();
        }
        dependencies.push(Dependency {
            id: dep_id,
            requirement: (!alternatives.is_empty()).then(|| alternatives.join(" || ")),
            required: !optional,
        });
    }
    let mixin_configs = value.get("mixin").map(string_or_list).unwrap_or_default();
    let (minecraft_text, minecraft_match) = requirement(&minecraft_alternatives, |alternatives| {
        versions::fabric_matches(alternatives, minecraft)
    });
    Ok(vec![ModMetadata {
        id: id.into(),
        name: loader.get("metadata").and_then(|m| json_string(m, "name")),
        version: json_string(loader, "version"),
        minecraft: minecraft_text,
        minecraft_match,
        dependencies,
        mixin_configs,
        environment: value
            .get("minecraft")
            .and_then(|m| json_string(m, "environment")),
        ..Default::default()
    }])
}

/// Forge's and NeoForge's TOML: `[[mods]]` tables, and dependencies under
/// `[[dependencies.<modId>]]`, Minecraft among them.
fn parse_mods_toml(text: &str, minecraft: &str) -> Result<Vec<ModMetadata>, String> {
    let value: toml::Value = toml::from_str(strip_bom(text)).map_err(|e| e.to_string())?;
    let mods = value
        .get("mods")
        .and_then(|m| m.as_array())
        .ok_or("no [[mods]]")?;
    let mixin_configs: Vec<String> = value
        .get("mixins")
        .and_then(|m| m.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|m| m.get("config").and_then(|c| c.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let mut out = Vec::new();
    for entry in mods {
        let Some(id) = entry.get("modId").and_then(|v| v.as_str()) else {
            continue;
        };
        let mut dependencies = Vec::new();
        let mut minecraft_range = None;
        let declared = value
            .get("dependencies")
            .and_then(|d| d.get(id))
            .and_then(|d| d.as_array());
        for dep in declared.into_iter().flatten() {
            let Some(dep_id) = dep.get("modId").and_then(|v| v.as_str()) else {
                continue;
            };
            let range = toml_string(dep, "versionRange");
            // Forge says `mandatory = true`; NeoForge says `type = "required"`.
            let required = dep
                .get("mandatory")
                .and_then(|v| v.as_bool())
                .unwrap_or_else(|| {
                    dep.get("type")
                        .and_then(|v| v.as_str())
                        .is_none_or(|t| t == "required")
                });
            if dep_id == "minecraft" {
                minecraft_range = range.clone();
            }
            dependencies.push(Dependency {
                id: dep_id.into(),
                requirement: range,
                required,
            });
        }
        let minecraft_match = minecraft_range
            .as_deref()
            .map(|range| versions::maven_matches(range, minecraft));
        out.push(ModMetadata {
            id: id.into(),
            name: toml_string(entry, "displayName"),
            version: toml_string(entry, "version"),
            minecraft: minecraft_range,
            minecraft_match,
            dependencies,
            mixin_configs: mixin_configs.clone(),
            environment: None,
            ..Default::default()
        });
    }
    if out.is_empty() {
        return Err("[[mods]] declares no modId".into());
    }
    Ok(out)
}

/// `mcmod.info`: a JSON list of mods, or `{ "modList": [...] }`.
fn parse_mcmod_info(text: &str, minecraft: &str) -> Result<Vec<ModMetadata>, String> {
    let value: Value = serde_json::from_str(strip_bom(text)).map_err(|e| e.to_string())?;
    let list = match &value {
        Value::Array(list) => list.clone(),
        Value::Object(o) => o
            .get("modList")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    let mods: Vec<ModMetadata> = list
        .iter()
        .filter_map(|entry| {
            let id = entry.get("modid").and_then(Value::as_str)?;
            let mc = json_string(entry, "mcversion");
            let minecraft_match = mc.as_deref().map(|mc| {
                if mc.contains("${") {
                    VersionMatch::Unknown
                } else if mc == minecraft {
                    VersionMatch::Matches
                } else {
                    VersionMatch::Differs
                }
            });
            Some(ModMetadata {
                id: id.into(),
                name: json_string(entry, "name"),
                version: json_string(entry, "version"),
                minecraft: mc,
                minecraft_match,
                ..Default::default()
            })
        })
        .collect();
    if mods.is_empty() {
        return Err("no modid".into());
    }
    Ok(mods)
}

/// The jar manifest's attributes that matter to a loader, joined across
/// continuation lines (a line starting with a space continues the last).
#[derive(Serialize, Clone, Debug, Default)]
pub struct Manifest {
    pub mixin_configs: Vec<String>,
    /// `FMLCorePlugin`: a Forge coremod, which rewrites Minecraft's classes.
    pub core_plugin: Option<String>,
    /// `TweakClass`: a LaunchWrapper tweaker, same story on older versions.
    pub tweak_class: Option<String>,
}

pub fn parse_manifest(text: &str) -> Manifest {
    let mut lines: Vec<String> = Vec::new();
    for line in text.lines() {
        match (line.strip_prefix(' '), lines.last_mut()) {
            (Some(rest), Some(last)) => last.push_str(rest),
            _ => lines.push(line.to_string()),
        }
    }
    let mut manifest = Manifest::default();
    for line in lines {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "MixinConfigs" => {
                manifest.mixin_configs = value
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect();
            }
            "FMLCorePlugin" => manifest.core_plugin = Some(value.into()),
            "TweakClass" => manifest.tweak_class = Some(value.into()),
            _ => {}
        }
    }
    manifest
}

fn requirement(
    alternatives: &[String],
    check: impl Fn(&[String]) -> VersionMatch,
) -> (Option<String>, Option<VersionMatch>) {
    if alternatives.is_empty() {
        return (None, None);
    }
    (Some(alternatives.join(" || ")), Some(check(alternatives)))
}

fn string_or_list(value: &Value) -> Vec<String> {
    match value {
        Value::String(s) => vec![s.clone()],
        Value::Array(list) => list
            .iter()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect(),
        _ => Vec::new(),
    }
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(String::from)
}

fn toml_string(value: &toml::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(String::from)
}

/// JSON as Fabric's loader reads it: Gson in lenient mode, which lets a
/// line break or tab stand inside a string. Strict first; on failure, those
/// characters are escaped and it is read again.
fn lenient_json(text: &str) -> Result<Value, String> {
    let text = strip_bom(text);
    serde_json::from_str(text).or_else(|strict: serde_json::Error| {
        let mut escaped = String::with_capacity(text.len());
        let (mut in_string, mut escape) = (false, false);
        for c in text.chars() {
            if in_string && !escape && (c as u32) < 0x20 {
                escaped.push_str(&format!("\\u{:04x}", c as u32));
                continue;
            }
            if c == '"' && !escape {
                in_string = !in_string;
            }
            escape = in_string && c == '\\' && !escape;
            escaped.push(c);
        }
        serde_json::from_str(&escaped).map_err(|_| strict.to_string())
    })
}

fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fabric_descriptor() {
        let text = r#"{
            "schemaVersion": 1, "id": "sodium", "version": "0.6.0", "name": "Sodium",
            "environment": "client",
            "depends": { "minecraft": ["1.21.1", "1.21.2"], "fabricloader": ">=0.16" },
            "mixins": ["sodium.mixins.json", { "config": "sodium-extra.mixins.json", "environment": "client" }]
        }"#;
        let d = parse(Loader::Fabric, "fabric.mod.json", text, "26.3");
        assert!(d.error.is_none(), "{:?}", d.error);
        let m = &d.mods[0];
        assert_eq!(m.id, "sodium");
        assert_eq!(m.minecraft.as_deref(), Some("1.21.1 || 1.21.2"));
        assert_eq!(m.minecraft_match, Some(VersionMatch::Differs));
        assert_eq!(
            m.mixin_configs,
            ["sodium.mixins.json", "sodium-extra.mixins.json"]
        );
        assert_eq!(m.environment.as_deref(), Some("client"));
        assert!(m
            .dependencies
            .iter()
            .any(|d| d.id == "fabricloader" && d.required));
    }

    #[test]
    fn a_neoforge_descriptor() {
        let text = r#"
modLoader = "javafml"
loaderVersion = "[4,)"
[[mods]]
modId = "examplemod"
version = "1.0.0"
displayName = "Example"
[[mixins]]
config = "examplemod.mixins.json"
[[dependencies.examplemod]]
modId = "neoforge"
type = "required"
versionRange = "[21.1,)"
[[dependencies.examplemod]]
modId = "minecraft"
type = "required"
versionRange = "[1.21.1,1.22)"
[[dependencies.examplemod]]
modId = "jei"
type = "optional"
versionRange = "[19,)"
"#;
        let d = parse(
            Loader::NeoForge,
            "META-INF/neoforge.mods.toml",
            text,
            "1.21.1",
        );
        let m = &d.mods[0];
        assert_eq!(m.minecraft_match, Some(VersionMatch::Matches));
        assert_eq!(m.mixin_configs, ["examplemod.mixins.json"]);
        assert!(
            !m.dependencies
                .iter()
                .find(|d| d.id == "jei")
                .unwrap()
                .required
        );
    }

    #[test]
    fn a_line_break_inside_a_string_is_read_as_fabric_does() {
        let text =
            "{\"schemaVersion\":1,\"id\":\"vt\",\"description\":\"two\nlines \\\"quoted\\\"\"}";
        let d = parse(Loader::Fabric, "fabric.mod.json", text, "26.3");
        assert!(d.error.is_none(), "{:?}", d.error);
        assert_eq!(d.mods[0].id, "vt");
    }

    #[test]
    fn a_broken_descriptor_says_why() {
        let d = parse(Loader::Fabric, "fabric.mod.json", "{ not json", "26.3");
        assert!(d.mods.is_empty());
        assert!(d.error.is_some());
    }

    #[test]
    fn manifest_attributes_across_continuation_lines() {
        let text = "Manifest-Version: 1.0\r\nMixinConfigs: a.mixins.json,b.mi\r\n xins.json\r\nFMLCorePlugin: x.Core\r\n";
        let m = parse_manifest(text);
        assert_eq!(m.mixin_configs, ["a.mixins.json", "b.mixins.json"]);
        assert_eq!(m.core_plugin.as_deref(), Some("x.Core"));
    }

    #[test]
    fn a_horizon_manifest() {
        let text = "id = \"coords_hud\"\nname = \"Coordinates HUD\"\nversion = \"0.1.0\"\napi = \"0.1\"\nside = \"client\"\ncapabilities = [\"game-read\", \"hud\"]\n";
        let d = parse(Loader::Horizon, "horizon-mod.toml", text, "26.3");
        let m = &d.mods[0];
        assert_eq!(m.horizon_api.as_deref(), Some("0.1"));
        assert_eq!(m.capabilities, ["game-read", "hud"]);
    }
}
