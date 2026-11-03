//! The servers this launcher hosts, as opposed to the ones it joins.
//!
//! A hosted server is a folder under `servers/` and a line in `servers.json`.
//! The folder is the server's working directory — the jar or the loader's
//! launch files, `mods/`, `config/`, the world, `logs/`, and a `backups/`
//! folder of its own — and the line is what the Host page lists before any of
//! that exists. The two are kept together on purpose: a folder without a line
//! is invisible, and a line without a folder is a server that cannot be opened.
//!
//! What lives here is the registry and the folder. Fetching a server
//! (`server_install`), running it (`server_process`), its properties
//! (`server_properties`) and its backups (`server_backup`) are built on top.

use crate::game_manager::MinecraftLoader;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// The folder every hosted server sits under, beside `minecraft/instances/`.
pub const SERVERS_DIR: &str = "servers";
const REGISTRY_FILE: &str = "servers.json";
/// Inside a server folder: its own backups, never part of a backup or a clone.
pub const BACKUPS_DIR: &str = "backups";
pub const ICON_FILE: &str = "server-icon.png";
pub const EULA_FILE: &str = "eula.txt";

/// The Minecraft default, and what a port left blank means.
pub const DEFAULT_PORT: u16 = 25565;
/// Enough for a vanilla world with a few friends; a modded preset asks for more.
pub const DEFAULT_MEMORY_MB: u32 = 4096;
pub const DEFAULT_MIN_MEMORY_MB: u32 = 1024;

/// One hosted server, as the registry remembers it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct HostedServer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub mc_version: String,
    pub loader: MinecraftLoader,
    pub loader_version: Option<String>,
    /// The preset it was created from, if any — a label, not a behaviour.
    pub preset: Option<String>,
    pub port: u16,
    /// None means "what this Minecraft version needs", decided at start.
    #[serde(default)]
    pub java_major: Option<u32>,
    #[serde(default = "default_min_memory")]
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    /// Extra JVM arguments, one per entry, placed before `-jar`.
    #[serde(default)]
    pub jvm_args: Vec<String>,
    /// The Kiza instance this server is paired with, for the client/server
    /// comparison. Set when created from an instance; changeable after.
    #[serde(default)]
    pub linked_instance_id: Option<String>,
    /// Where it came from, for the card: "scratch", "instance", "import", "clone".
    #[serde(default)]
    pub created_from: Option<String>,
    /// RFC 3339, UTC.
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub auto_backup: AutoBackup,
    /// The name Kiza's service points at this machine, once claimed.
    #[serde(default)]
    pub kiza_address: Option<crate::server_network::KizaAddress>,
}

fn default_min_memory() -> u32 {
    DEFAULT_MIN_MEMORY_MB
}

/// Backups the launcher takes on its own: before a start, every so many
/// minutes while running, and how many of those to keep. Manual backups
/// are never pruned; only the ones Kiza made.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AutoBackup {
    #[serde(default)]
    pub before_start: bool,
    /// 0 is off.
    #[serde(default)]
    pub every_minutes: u32,
    #[serde(default = "default_keep")]
    pub keep: u32,
}

fn default_keep() -> u32 {
    10
}

impl Default for AutoBackup {
    fn default() -> Self {
        Self {
            before_start: false,
            every_minutes: 0,
            keep: 10,
        }
    }
}

/// What a server looks like to the page: the registry line plus what the
/// folder says about it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct HostedServerSummary {
    #[serde(flatten)]
    pub server: HostedServer,
    /// Whether the server files are in the folder yet. Created and installed
    /// are different moments, and the card says which one this is.
    pub installed: bool,
    pub eula_accepted: bool,
    pub has_icon: bool,
    pub mod_count: usize,
    pub folder: String,
}

/// What Deploy sends.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub struct NewHostedServer {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub mc_version: String,
    pub loader: MinecraftLoader,
    pub loader_version: Option<String>,
    pub preset: Option<String>,
    pub port: Option<u16>,
    pub java_major: Option<u32>,
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub jvm_args: Vec<String>,
    /// Initial `server.properties`: seed, difficulty, gamemode, motd and the
    /// rest, written before the first start so the world is generated the
    /// way it was asked for.
    #[serde(default)]
    pub properties: BTreeMap<String, String>,
    /// A PNG to become `server-icon.png`. Minecraft wants 64×64; the file is
    /// copied as given and the server ignores one it cannot use.
    pub icon_path: Option<String>,
    pub linked_instance_id: Option<String>,
    pub created_from: Option<String>,
}

/// What the settings page may change after creation.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub struct ServerPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub java_major: Option<Option<u32>>,
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    pub jvm_args: Option<Vec<String>>,
    pub linked_instance_id: Option<Option<String>>,
    pub port: Option<u16>,
    pub auto_backup: Option<AutoBackup>,
}

pub fn servers_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SERVERS_DIR)
}

pub fn server_dir(app_data_dir: &Path, id: &str) -> PathBuf {
    servers_dir(app_data_dir).join(id)
}

fn registry_path(app_data_dir: &Path) -> PathBuf {
    servers_dir(app_data_dir).join(REGISTRY_FILE)
}

fn read_registry(app_data_dir: &Path) -> Vec<HostedServer> {
    let Ok(text) = std::fs::read_to_string(registry_path(app_data_dir)) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_registry(app_data_dir: &Path, servers: &[HostedServer]) -> Result<(), String> {
    std::fs::create_dir_all(servers_dir(app_data_dir)).map_err(|error| error.to_string())?;
    let text = serde_json::to_string_pretty(servers).map_err(|error| error.to_string())?;
    // Written beside and renamed over: a crash mid-write must not leave half
    // a registry, which would list no server at all.
    let path = registry_path(app_data_dir);
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, &path).map_err(|error| error.to_string())
}

/// A folder name from a display name: lowercase, dashes, nothing a path
/// would object to. "My Awesome Server" becomes `my-awesome-server`.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "server".to_string()
    } else {
        out
    }
}

/// A slug no existing server uses: `name`, then `name-2`, `name-3`, …
fn unique_id(base: &str, taken: &[HostedServer]) -> String {
    if !taken.iter().any(|server| server.id == base) {
        return base.to_string();
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|candidate| !taken.iter().any(|server| &server.id == candidate))
        .expect("the integers do not run out")
}

pub fn list(app_data_dir: &Path) -> Vec<HostedServerSummary> {
    read_registry(app_data_dir)
        .into_iter()
        .map(|server| summarise(app_data_dir, server))
        .collect()
}

pub fn get(app_data_dir: &Path, id: &str) -> Result<HostedServer, String> {
    read_registry(app_data_dir)
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| "That server is not in the list.".to_string())
}

pub fn summary(app_data_dir: &Path, id: &str) -> Result<HostedServerSummary, String> {
    get(app_data_dir, id).map(|server| summarise(app_data_dir, server))
}

fn summarise(app_data_dir: &Path, server: HostedServer) -> HostedServerSummary {
    let folder = server_dir(app_data_dir, &server.id);
    HostedServerSummary {
        installed: crate::server_install::detect_launch(&folder, &server.loader).is_some(),
        eula_accepted: eula_accepted(&folder),
        has_icon: folder.join(ICON_FILE).is_file(),
        mod_count: count_jars(&folder.join("mods")),
        folder: folder.to_string_lossy().into_owned(),
        server,
    }
}

pub fn count_jars(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("jar"))
                })
                .count()
        })
        .unwrap_or(0)
}

/// Whether `eula.txt` says `eula=true`. Only the user writes that, through
/// `accept_eula`, after reading it.
pub fn eula_accepted(server_dir: &Path) -> bool {
    std::fs::read_to_string(server_dir.join(EULA_FILE))
        .map(|text| {
            text.lines().any(|line| {
                let line = line.trim();
                !line.starts_with('#') && line.replace(' ', "").eq_ignore_ascii_case("eula=true")
            })
        })
        .unwrap_or(false)
}

pub fn accept_eula(app_data_dir: &Path, id: &str) -> Result<(), String> {
    let dir = server_dir(app_data_dir, id);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    std::fs::write(
        dir.join(EULA_FILE),
        format!(
            "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#Accepted in Kiza Launcher on {}\neula=true\n",
            chrono::Utc::now().to_rfc3339()
        ),
    )
    .map_err(|error| format!("Could not write {EULA_FILE}: {error}"))
}

fn validate(
    name: &str,
    mc_version: &str,
    loader: &MinecraftLoader,
    loader_version: Option<&str>,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Give the server a name.".to_string());
    }
    if mc_version.trim().is_empty() {
        return Err("Choose a Minecraft version.".to_string());
    }
    if *loader != MinecraftLoader::Vanilla && loader_version.is_none_or(|v| v.trim().is_empty()) {
        return Err(format!("Choose a {} version.", loader.slug()));
    }
    Ok(())
}

pub fn create(app_data_dir: &Path, new: NewHostedServer) -> Result<HostedServerSummary, String> {
    validate(
        &new.name,
        &new.mc_version,
        &new.loader,
        new.loader_version.as_deref(),
    )?;
    let name = new.name.trim();

    let mut servers = read_registry(app_data_dir);
    let id = unique_id(&slug(name), &servers);
    let folder = server_dir(app_data_dir, &id);
    std::fs::create_dir_all(folder.join("mods")).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(folder.join("config")).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(folder.join(BACKUPS_DIR)).map_err(|error| error.to_string())?;

    let port = new.port.unwrap_or(DEFAULT_PORT);
    let vanilla = new.loader == MinecraftLoader::Vanilla;
    let max_memory_mb = new.max_memory_mb.unwrap_or(DEFAULT_MEMORY_MB).max(512);
    let server = HostedServer {
        id,
        name: name.to_string(),
        description: new.description.trim().to_string(),
        mc_version: new.mc_version.trim().to_string(),
        loader: new.loader,
        loader_version: if vanilla {
            None
        } else {
            new.loader_version.map(|v| v.trim().to_string())
        },
        preset: new.preset.filter(|p| !p.trim().is_empty()),
        port,
        java_major: new.java_major,
        min_memory_mb: new
            .min_memory_mb
            .unwrap_or(DEFAULT_MIN_MEMORY_MB)
            .min(max_memory_mb),
        max_memory_mb,
        jvm_args: new
            .jvm_args
            .into_iter()
            .filter(|a| !a.trim().is_empty())
            .collect(),
        linked_instance_id: new.linked_instance_id,
        created_from: new.created_from.or(Some("scratch".to_string())),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
        auto_backup: AutoBackup::default(),
        kiza_address: None,
    };

    // The properties the form asked for, port included, so the first start
    // generates the world that was described rather than the default one.
    let mut properties = new.properties;
    properties.insert("server-port".to_string(), port.to_string());
    if !server.description.is_empty() && !properties.contains_key("motd") {
        properties.insert("motd".to_string(), server.description.clone());
    }
    crate::server_properties::write(&folder, &properties)?;

    if let Some(icon) = new.icon_path.as_deref().filter(|p| !p.trim().is_empty()) {
        set_icon_file(&folder, Path::new(icon))?;
    }

    servers.push(server.clone());
    write_registry(app_data_dir, &servers)?;
    Ok(summarise(app_data_dir, server))
}

/// Copies a PNG in as the server icon. Only the extension is checked here;
/// the server itself ignores an icon it cannot read.
pub fn set_icon_file(server_dir: &Path, source: &Path) -> Result<(), String> {
    if !source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        return Err("The server icon must be a PNG (64×64).".to_string());
    }
    std::fs::copy(source, server_dir.join(ICON_FILE))
        .map(|_| ())
        .map_err(|error| format!("Could not copy the icon: {error}"))
}

pub fn update(
    app_data_dir: &Path,
    id: &str,
    patch: ServerPatch,
) -> Result<HostedServerSummary, String> {
    let mut servers = read_registry(app_data_dir);
    let server = servers
        .iter_mut()
        .find(|server| server.id == id)
        .ok_or_else(|| "That server is not in the list.".to_string())?;
    if let Some(name) = patch.name {
        if name.trim().is_empty() {
            return Err("Give the server a name.".to_string());
        }
        server.name = name.trim().to_string();
    }
    if let Some(description) = patch.description {
        server.description = description.trim().to_string();
    }
    if let Some(java_major) = patch.java_major {
        server.java_major = java_major;
    }
    if let Some(max) = patch.max_memory_mb {
        server.max_memory_mb = max.max(512);
    }
    if let Some(min) = patch.min_memory_mb {
        server.min_memory_mb = min.max(256);
    }
    if server.min_memory_mb > server.max_memory_mb {
        server.min_memory_mb = server.max_memory_mb;
    }
    if let Some(args) = patch.jvm_args {
        server.jvm_args = args.into_iter().filter(|a| !a.trim().is_empty()).collect();
    }
    if let Some(linked) = patch.linked_instance_id {
        server.linked_instance_id = linked;
    }
    if let Some(auto_backup) = patch.auto_backup {
        server.auto_backup = AutoBackup {
            keep: auto_backup.keep.max(1),
            ..auto_backup
        };
    }
    if let Some(port) = patch.port {
        server.port = port;
        let mut changes = BTreeMap::new();
        changes.insert("server-port".to_string(), port.to_string());
        crate::server_properties::write(&server_dir(app_data_dir, id), &changes)?;
    }
    server.updated_at = Some(chrono::Utc::now().to_rfc3339());
    let updated = server.clone();
    write_registry(app_data_dir, &servers)?;
    Ok(summarise(app_data_dir, updated))
}

pub fn set_kiza_address(
    app_data_dir: &Path,
    id: &str,
    address: Option<crate::server_network::KizaAddress>,
) -> Result<(), String> {
    let mut servers = read_registry(app_data_dir);
    let server = servers
        .iter_mut()
        .find(|server| server.id == id)
        .ok_or_else(|| "That server is not in the list.".to_string())?;
    server.kiza_address = address;
    write_registry(app_data_dir, &servers)
}

/// Keeps the registry's port in step with the file when the properties page
/// changes it there.
pub fn note_port(app_data_dir: &Path, id: &str, port: u16) -> Result<(), String> {
    let mut servers = read_registry(app_data_dir);
    if let Some(server) = servers.iter_mut().find(|server| server.id == id) {
        if server.port != port {
            server.port = port;
            write_registry(app_data_dir, &servers)?;
        }
    }
    Ok(())
}

/// Forgets the server and removes its folder, world and backups included.
pub fn remove(app_data_dir: &Path, id: &str) -> Result<(), String> {
    let mut servers = read_registry(app_data_dir);
    let before = servers.len();
    servers.retain(|server| server.id != id);
    if servers.len() == before {
        return Err("That server is not in the list.".to_string());
    }
    write_registry(app_data_dir, &servers)?;
    let folder = server_dir(app_data_dir, id);
    if folder.is_dir() {
        std::fs::remove_dir_all(&folder).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// What a clone and a backup both leave out of a server folder.
///
/// Logs and backups are history, not the server; the loader's `libraries/`
/// and cached jars are reinstalled rather than copied, which is what keeps a
/// clone or a backup at the size of the world and the mods.
pub fn is_transient(relative: &Path) -> bool {
    let first = relative
        .components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .unwrap_or("");
    matches!(
        first,
        "backups" | "logs" | "crash-reports" | "libraries" | "cache" | "versions" | ".fabric"
    ) || first == crate::server_process::PID_FILE
}

/// A second server with the first one's world, mods and settings.
pub fn clone(app_data_dir: &Path, id: &str, new_name: &str) -> Result<HostedServerSummary, String> {
    let source = get(app_data_dir, id)?;
    if new_name.trim().is_empty() {
        return Err("Give the clone a name.".to_string());
    }
    let mut servers = read_registry(app_data_dir);
    let new_id = unique_id(&slug(new_name), &servers);
    let from = server_dir(app_data_dir, id);
    let to = server_dir(app_data_dir, &new_id);
    copy_tree(&from, &to, &from)?;
    std::fs::create_dir_all(to.join(BACKUPS_DIR)).map_err(|error| error.to_string())?;

    let server = HostedServer {
        id: new_id,
        name: new_name.trim().to_string(),
        created_from: Some(format!("clone:{id}")),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
        kiza_address: None,
        ..source
    };
    servers.push(server.clone());
    write_registry(app_data_dir, &servers)?;
    Ok(summarise(app_data_dir, server))
}

/// Copies a server folder, transient folders left out, symlinks not followed.
pub fn copy_tree(from: &Path, to: &Path, root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in std::fs::read_dir(from)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if is_transient(relative) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let target = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_tree(&path, &target, root)?;
        } else {
            std::fs::copy(&path, &target)
                .map_err(|error| format!("Could not copy {}: {error}", relative.display()))?;
        }
    }
    Ok(())
}

/// Adds a registry line for a folder that already holds a server — the tail
/// end of an import, once `server_import` has read what it could.
pub fn register(app_data_dir: &Path, server: HostedServer) -> Result<HostedServerSummary, String> {
    let mut servers = read_registry(app_data_dir);
    if servers.iter().any(|existing| existing.id == server.id) {
        return Err("A server with that folder already exists.".to_string());
    }
    servers.push(server.clone());
    write_registry(app_data_dir, &servers)?;
    Ok(summarise(app_data_dir, server))
}

pub fn next_id(app_data_dir: &Path, name: &str) -> String {
    unique_id(&slug(name), &read_registry(app_data_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new(name: &str, loader: MinecraftLoader, loader_version: Option<&str>) -> NewHostedServer {
        NewHostedServer {
            name: name.to_string(),
            mc_version: "1.21.1".to_string(),
            loader,
            loader_version: loader_version.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn a_name_becomes_a_folder_name() {
        assert_eq!(slug("My Awesome Server"), "my-awesome-server");
        assert_eq!(slug("  Été — survie !!  "), "t-survie");
        assert_eq!(slug("!!!"), "server");
    }

    #[test]
    fn deploy_writes_a_folder_a_line_and_the_properties_it_was_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        let mut request = new("My Awesome Server", MinecraftLoader::Vanilla, None);
        request
            .properties
            .insert("difficulty".into(), "hard".into());
        request
            .properties
            .insert("level-seed".into(), "kiza".into());
        request.description = "Bienvenue".into();
        let created = create(dir.path(), request).unwrap();
        assert_eq!(created.server.id, "my-awesome-server");
        assert_eq!(created.server.port, DEFAULT_PORT);
        assert!(!created.installed, "no jar has been fetched yet");
        assert!(!created.eula_accepted);
        let folder = server_dir(dir.path(), "my-awesome-server");
        assert!(folder.join("mods").is_dir());

        let props = crate::server_properties::read(&folder);
        assert_eq!(props.get("difficulty"), Some("hard"));
        assert_eq!(props.get("level-seed"), Some("kiza"));
        assert_eq!(props.get("motd"), Some("Bienvenue"));
        assert_eq!(props.port(), DEFAULT_PORT);

        assert_eq!(list(dir.path()), vec![created]);
    }

    #[test]
    fn two_servers_with_one_name_get_two_folders() {
        let dir = tempfile::tempdir().unwrap();
        create(dir.path(), new("Survie", MinecraftLoader::Vanilla, None)).unwrap();
        let second = create(dir.path(), new("Survie", MinecraftLoader::Vanilla, None)).unwrap();
        assert_eq!(second.server.id, "survie-2");
        assert_eq!(list(dir.path()).len(), 2);
    }

    #[test]
    fn a_modded_server_needs_its_loader_version() {
        let dir = tempfile::tempdir().unwrap();
        assert!(create(dir.path(), new("Modded", MinecraftLoader::Fabric, None)).is_err());
        let ok = create(
            dir.path(),
            new("Modded", MinecraftLoader::Fabric, Some("0.16.9")),
        )
        .unwrap();
        assert_eq!(ok.server.loader_version.as_deref(), Some("0.16.9"));
        let vanilla = create(
            dir.path(),
            new("Plain", MinecraftLoader::Vanilla, Some("junk")),
        )
        .unwrap();
        assert_eq!(vanilla.server.loader_version, None);
    }

    #[test]
    fn the_eula_is_only_ever_accepted_on_purpose() {
        let dir = tempfile::tempdir().unwrap();
        let created = create(dir.path(), new("Eula", MinecraftLoader::Vanilla, None)).unwrap();
        let folder = server_dir(dir.path(), &created.server.id);
        assert!(!eula_accepted(&folder));
        std::fs::write(folder.join(EULA_FILE), "#comment\neula=false\n").unwrap();
        assert!(!eula_accepted(&folder));
        accept_eula(dir.path(), &created.server.id).unwrap();
        assert!(eula_accepted(&folder));
        assert!(
            summary(dir.path(), &created.server.id)
                .unwrap()
                .eula_accepted
        );
    }

    #[test]
    fn settings_change_the_line_and_the_port_reaches_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let created = create(dir.path(), new("Tune", MinecraftLoader::Vanilla, None)).unwrap();
        let updated = update(
            dir.path(),
            &created.server.id,
            ServerPatch {
                max_memory_mb: Some(2048),
                min_memory_mb: Some(4096),
                port: Some(25570),
                jvm_args: Some(vec!["-XX:+UseG1GC".into(), "".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.server.max_memory_mb, 2048);
        assert_eq!(
            updated.server.min_memory_mb, 2048,
            "a minimum above the maximum is clamped"
        );
        assert_eq!(updated.server.jvm_args, vec!["-XX:+UseG1GC"]);
        let props = crate::server_properties::read(&server_dir(dir.path(), &created.server.id));
        assert_eq!(props.port(), 25570);
    }

    #[test]
    fn a_clone_copies_the_world_and_leaves_the_history_behind() {
        let dir = tempfile::tempdir().unwrap();
        let created = create(dir.path(), new("Origin", MinecraftLoader::Vanilla, None)).unwrap();
        let folder = server_dir(dir.path(), &created.server.id);
        std::fs::create_dir_all(folder.join("world/region")).unwrap();
        std::fs::write(folder.join("world/region/r.0.0.mca"), b"chunks").unwrap();
        std::fs::create_dir_all(folder.join("logs")).unwrap();
        std::fs::write(folder.join("logs/latest.log"), b"old").unwrap();
        std::fs::write(folder.join(BACKUPS_DIR).join("x.zip"), b"zip").unwrap();

        let cloned = clone(dir.path(), &created.server.id, "Copy").unwrap();
        let copy = server_dir(dir.path(), &cloned.server.id);
        assert_eq!(
            std::fs::read(copy.join("world/region/r.0.0.mca")).unwrap(),
            b"chunks"
        );
        assert!(!copy.join("logs").exists());
        assert!(
            copy.join(BACKUPS_DIR).is_dir()
                && std::fs::read_dir(copy.join(BACKUPS_DIR)).unwrap().count() == 0
        );
        assert_eq!(cloned.server.mc_version, "1.21.1");
        assert_eq!(cloned.server.created_from.as_deref(), Some("clone:origin"));
    }

    #[test]
    fn removing_forgets_the_line_and_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let created = create(dir.path(), new("Gone", MinecraftLoader::Vanilla, None)).unwrap();
        remove(dir.path(), &created.server.id).unwrap();
        assert!(list(dir.path()).is_empty());
        assert!(!server_dir(dir.path(), &created.server.id).exists());
        assert!(remove(dir.path(), &created.server.id).is_err());
    }
}
