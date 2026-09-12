//! A server out of an instance: read what the instance is, decide which of
//! its mods a server needs, build the folder.
//!
//! The deciding is the part worth being careful about. Copying every jar
//! makes a server that wastes memory on minimaps and shader loaders, or does
//! not start at all; dropping every jar not proven server-side makes one
//! that refuses the world's own blocks. So each mod gets a verdict *and* the
//! basis for it — the jar's own manifest, a catalogue's tags, or nothing —
//! and a mod nobody could classify is shown as such for the user to decide,
//! included by default because a server missing a mod it needs does not
//! start, while one carrying an extra jar merely ignores it.

use crate::game_manager::MinecraftLoader;
use crate::mod_manager::{Mod, ModManager};
use crate::mod_side::ModSide;
use crate::server_host::{HostedServerSummary, NewHostedServer};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

/// What the analysis decided for one mod.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Needed on the server: side is server or both.
    Server,
    /// Client only; left out.
    Excluded,
    /// Nobody could say; included unless the user says otherwise.
    Unknown,
    /// Disabled in the instance, so not offered.
    Disabled,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ModVerdict {
    pub id: String,
    pub name: String,
    pub version: String,
    pub files: Vec<String>,
    pub side: Option<ModSide>,
    pub verdict: Verdict,
    /// `jar`, `modrinth`, `curseforge`, or `none`.
    pub basis: &'static str,
    pub source: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct InstanceAnalysis {
    pub instance_id: String,
    pub display_name: String,
    pub mc_version: String,
    pub loader: MinecraftLoader,
    pub loader_version: Option<String>,
    pub java_major: u32,
    pub mods: Vec<ModVerdict>,
    pub total: usize,
    pub server_mods: usize,
    pub client_only: usize,
    pub unknown: usize,
    pub disabled: usize,
    /// Dependency and loader problems the instance's own report found; a
    /// server built from it inherits them.
    pub issues: Vec<String>,
    pub has_config: bool,
    pub worlds: Vec<crate::world_vault::WorldSummary>,
}

/// Sides from the catalogues, keyed by mod id, for the mods the jar could
/// not answer for. Modrinth is asked once for all of them.
async fn catalogue_sides(mods: &[&Mod]) -> HashMap<String, (ModSide, &'static str)> {
    let mut sides = HashMap::new();
    let mut modrinth_ids: Vec<(String, String)> = Vec::new();
    for entry in mods {
        match entry.source.as_deref() {
            Some("modrinth") => {
                if let Some(project) = entry.project_id.clone() {
                    modrinth_ids.push((entry.id.clone(), project));
                }
            }
            _ => {
                if let Some(side) = crate::mod_side::from_catalogue(None, None, &entry.game_versions) {
                    sides.insert(entry.id.clone(), (side, "curseforge"));
                }
            }
        }
    }
    if modrinth_ids.is_empty() {
        return sides;
    }
    let ids: Vec<String> = modrinth_ids.iter().map(|(_, project)| project.clone()).collect();
    let Ok(projects) = crate::modrinth_api::get_projects(&ids).await else {
        return sides;
    };
    for (mod_id, project_id) in modrinth_ids {
        let Some(project) = projects.iter().find(|p| p.id == project_id || p.slug == project_id) else {
            continue;
        };
        if let Some(side) =
            crate::mod_side::from_catalogue(project.client_side.as_deref(), project.server_side.as_deref(), &[])
        {
            sides.insert(mod_id, (side, "modrinth"));
        }
    }
    sides
}

fn jar_side(manager: &ModManager, instance_id: &str, entry: &Mod) -> Option<ModSide> {
    let folder = manager.get_mod_path(instance_id, &entry.id).ok()?;
    let root = Path::new(&folder);
    entry
        .files
        .iter()
        .map(|file| root.join(file))
        .filter(|path| path.extension().and_then(|v| v.to_str()) == Some("jar"))
        .find_map(|path| crate::mod_side::from_jar(&path))
}

/// The verdict for a side, or for none.
pub fn verdict_for(side: Option<ModSide>) -> Verdict {
    match side {
        Some(side) if side.wanted_by_a_server() => Verdict::Server,
        Some(_) => Verdict::Excluded,
        None => Verdict::Unknown,
    }
}

pub async fn analyse(app_data_dir: &Path, instance_id: &str) -> Result<InstanceAnalysis, String> {
    let instance = crate::game_manager::GameManager::new(app_data_dir.to_path_buf()).get_instance_by_id(instance_id)?;
    let mc = instance
        .minecraft
        .clone()
        .ok_or_else(|| "That instance is not a Minecraft instance.".to_string())?;
    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(instance_id);
    let game_dir = crate::minecraft_manager::instance_game_dir_path(app_data_dir, instance_id);

    let enabled: Vec<&Mod> = mods.iter().filter(|m| m.enabled).collect();
    let mut verdicts = Vec::with_capacity(mods.len());
    let mut undecided: Vec<&Mod> = Vec::new();
    let mut jar_sides: HashMap<String, ModSide> = HashMap::new();
    for entry in &enabled {
        match jar_side(&manager, instance_id, entry) {
            Some(side) => {
                jar_sides.insert(entry.id.clone(), side);
            }
            None => undecided.push(entry),
        }
    }
    let catalogue = catalogue_sides(&undecided).await;

    for entry in &mods {
        let (side, basis) = if !entry.enabled {
            (None, "none")
        } else if let Some(side) = jar_sides.get(&entry.id) {
            (Some(*side), "jar")
        } else if let Some((side, basis)) = catalogue.get(&entry.id) {
            (Some(*side), *basis)
        } else {
            (None, "none")
        };
        let verdict = if entry.enabled { verdict_for(side) } else { Verdict::Disabled };
        verdicts.push(ModVerdict {
            id: entry.id.clone(),
            name: entry.name.clone(),
            version: entry.version.clone(),
            files: entry.files.clone(),
            side,
            verdict,
            basis,
            source: entry.source.clone(),
            project_id: entry.project_id.clone(),
        });
    }

    let count = |wanted: Verdict| verdicts.iter().filter(|v| v.verdict == wanted).count();
    let issues = crate::mod_compat::check_compatibility(
        instance_id,
        &game_dir.join("mods"),
        &mc.mc_version,
        mc.loader.slug(),
        mc.loader_version.as_deref(),
    )
    .map(|report| {
        report
            .mods
            .iter()
            .flat_map(|entry| {
                entry
                    .issues
                    .iter()
                    .filter(|issue| issue.severity == "error")
                    .map(move |issue| format!("{}: {}", entry.name.clone().unwrap_or(entry.file_name.clone()), issue.message))
            })
            .collect()
    })
    .unwrap_or_default();

    Ok(InstanceAnalysis {
        instance_id: instance_id.to_string(),
        display_name: instance.display_name.clone(),
        mc_version: mc.mc_version.clone(),
        loader: mc.loader.clone(),
        loader_version: mc.loader_version.clone(),
        java_major: mc
            .java_major
            .unwrap_or_else(|| crate::minecraft_manager::required_java_major(Some(&mc.mc_version))),
        total: enabled.len(),
        server_mods: count(Verdict::Server),
        client_only: count(Verdict::Excluded),
        unknown: count(Verdict::Unknown),
        disabled: count(Verdict::Disabled),
        mods: verdicts,
        issues,
        has_config: game_dir.join("config").is_dir(),
        worlds: crate::world_vault::list_worlds(app_data_dir, instance_id, &game_dir),
    })
}

/// What the user confirmed on the review screen.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub struct BuildRequest {
    pub instance_id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// The mods to take, by catalogue id — the review screen's ticks.
    pub mod_ids: Vec<String>,
    #[serde(default)]
    pub copy_config: bool,
    /// A folder under the instance's `saves/`, to become the server's world.
    pub world_folder: Option<String>,
    pub port: Option<u16>,
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub properties: BTreeMap<String, String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub struct BuildOutcome {
    pub server: HostedServerSummary,
    pub mods_copied: usize,
    pub config_copied: bool,
    pub world_copied: bool,
}

pub fn build(app_data_dir: &Path, request: BuildRequest) -> Result<BuildOutcome, String> {
    let instance = crate::game_manager::GameManager::new(app_data_dir.to_path_buf()).get_instance_by_id(&request.instance_id)?;
    let mc = instance
        .minecraft
        .clone()
        .ok_or_else(|| "That instance is not a Minecraft instance.".to_string())?;
    let game_dir = crate::minecraft_manager::instance_game_dir_path(app_data_dir, &request.instance_id);

    let mut properties = request.properties.clone();
    if request.world_folder.is_some() {
        properties.insert("level-name".to_string(), "world".to_string());
    }
    let created = crate::server_host::create(
        app_data_dir,
        NewHostedServer {
            name: request.name.clone(),
            description: request.description.clone(),
            mc_version: mc.mc_version.clone(),
            loader: mc.loader.clone(),
            loader_version: mc.loader_version.clone(),
            preset: None,
            port: request.port,
            java_major: mc.java_major,
            min_memory_mb: request.min_memory_mb,
            max_memory_mb: request.max_memory_mb.or(Some(if mc.loader == MinecraftLoader::Vanilla { 4096 } else { 6144 })),
            jvm_args: Vec::new(),
            properties,
            icon_path: None,
            linked_instance_id: Some(request.instance_id.clone()),
            created_from: Some(format!("instance:{}", request.instance_id)),
        },
    )?;
    let server_dir = PathBuf::from(&created.folder);

    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(&request.instance_id);
    let mut copied = 0;
    for entry in mods.iter().filter(|m| request.mod_ids.contains(&m.id)) {
        let Ok(folder) = manager.get_mod_path(&request.instance_id, &entry.id) else { continue };
        for file in &entry.files {
            let source = Path::new(&folder).join(file);
            if source.extension().and_then(|v| v.to_str()) != Some("jar") || !source.is_file() {
                continue;
            }
            let name = source
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| "A mod file has no name.".to_string())?;
            let target = crate::path_security::safe_child_path(&server_dir.join("mods"), name, &["jar"])?;
            std::fs::copy(&source, &target).map_err(|error| format!("Could not copy {name}: {error}"))?;
            copied += 1;
        }
    }

    let mut config_copied = false;
    if request.copy_config && game_dir.join("config").is_dir() {
        crate::server_host::copy_tree(&game_dir.join("config"), &server_dir.join("config"), &game_dir.join("config"))?;
        config_copied = true;
    }

    let mut world_copied = false;
    if let Some(folder) = request.world_folder.as_deref().filter(|f| !f.trim().is_empty()) {
        let worlds = crate::world_vault::list_worlds(app_data_dir, &request.instance_id, &game_dir);
        let safe = crate::instance_export::safe_world_folders(&[folder.to_string()], &worlds)?;
        let folder = safe.first().ok_or_else(|| "That world is not in the instance.".to_string())?;
        let source = game_dir.join("saves").join(folder);
        crate::server_host::copy_tree(&source, &server_dir.join("world"), &source)?;
        world_copied = true;
    }

    Ok(BuildOutcome {
        server: crate::server_host::summary(app_data_dir, &created.server.id)?,
        mods_copied: copied,
        config_copied,
        world_copied,
    })
}

/// One difference between a server and the instance it is paired with.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct SyncDifference {
    pub mod_id: String,
    pub name: String,
    /// `missing_on_server`, `missing_on_client`, `version_mismatch`
    pub kind: &'static str,
    pub client_version: Option<String>,
    pub server_version: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct SyncReport {
    pub instance_id: String,
    pub differences: Vec<SyncDifference>,
    pub in_step: usize,
}

/// A jar's identity, from the jar; the file name as a last resort.
fn identity(path: &Path) -> (String, String, String) {
    let file = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    match crate::mod_compat::identify_jar(path) {
        Some(found) => (found.mod_id, found.name.unwrap_or(file), found.version),
        None => (file.clone(), file, String::new()),
    }
}

/// Compares the server's `mods/` with the instance's enabled, server-wanted
/// mods. Reports; changes nothing.
pub fn compare(app_data_dir: &Path, server_id: &str, instance_id: &str) -> Result<SyncReport, String> {
    let server_dir = crate::server_host::server_dir(app_data_dir, server_id);
    let manager = ModManager::new(app_data_dir.to_path_buf());

    let mut client: BTreeMap<String, (String, String)> = BTreeMap::new();
    for entry in manager.load_mods(instance_id).iter().filter(|m| m.enabled) {
        let side = jar_side(&manager, instance_id, entry)
            .or_else(|| crate::mod_side::from_catalogue(None, None, &entry.game_versions));
        if side == Some(ModSide::Client) {
            continue;
        }
        let Ok(folder) = manager.get_mod_path(instance_id, &entry.id) else { continue };
        for file in &entry.files {
            let path = Path::new(&folder).join(file);
            if path.extension().and_then(|v| v.to_str()) == Some("jar") {
                let (id, name, version) = identity(&path);
                client.insert(id, (name, version));
            }
        }
    }

    let mut server: BTreeMap<String, (String, String)> = BTreeMap::new();
    if let Ok(entries) = std::fs::read_dir(server_dir.join("mods")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|v| v.to_str()) == Some("jar") {
                let (id, name, version) = identity(&path);
                server.insert(id, (name, version));
            }
        }
    }

    let mut differences = Vec::new();
    let mut in_step = 0;
    for (id, (name, client_version)) in &client {
        match server.get(id) {
            None => differences.push(SyncDifference {
                mod_id: id.clone(),
                name: name.clone(),
                kind: "missing_on_server",
                client_version: Some(client_version.clone()),
                server_version: None,
            }),
            Some((_, server_version)) if server_version != client_version => differences.push(SyncDifference {
                mod_id: id.clone(),
                name: name.clone(),
                kind: "version_mismatch",
                client_version: Some(client_version.clone()),
                server_version: Some(server_version.clone()),
            }),
            Some(_) => in_step += 1,
        }
    }
    for (id, (name, server_version)) in &server {
        if !client.contains_key(id) {
            differences.push(SyncDifference {
                mod_id: id.clone(),
                name: name.clone(),
                kind: "missing_on_client",
                client_version: None,
                server_version: Some(server_version.clone()),
            });
        }
    }
    Ok(SyncReport {
        instance_id: instance_id.to_string(),
        differences,
        in_step,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_side_becomes_a_verdict_and_no_side_is_a_question() {
        assert_eq!(verdict_for(Some(ModSide::Both)), Verdict::Server);
        assert_eq!(verdict_for(Some(ModSide::Server)), Verdict::Server);
        assert_eq!(verdict_for(Some(ModSide::Client)), Verdict::Excluded);
        assert_eq!(verdict_for(None), Verdict::Unknown);
    }
}
