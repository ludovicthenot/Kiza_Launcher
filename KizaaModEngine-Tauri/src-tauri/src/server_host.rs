//! The servers this launcher hosts, as opposed to the ones it joins.
//!
//! A hosted server is a folder under `servers/` and a line in `servers.json`.
//! The folder is where the server jar, the world and `server.properties` will
//! live; the line is what the Host page lists before any of that exists. The
//! two are kept together on purpose: a folder without a line is invisible, and
//! a line without a folder would be a server that cannot be opened.
//!
//! What lives here is the registry. Fetching a server jar, running it and
//! reading its console are separate pieces on top of this one.

use crate::game_manager::MinecraftLoader;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The folder every hosted server sits under, beside `instances/`.
pub const SERVERS_DIR: &str = "servers";
const REGISTRY_FILE: &str = "servers.json";

/// The Minecraft default, and what a port left blank means.
pub const DEFAULT_PORT: u16 = 25565;
/// Enough for a vanilla world with a few friends; a modded preset asks for more.
pub const DEFAULT_MEMORY_MB: u32 = 4096;

/// One hosted server, as the registry remembers it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct HostedServer {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: MinecraftLoader,
    pub loader_version: Option<String>,
    /// The preset it was created from, if any — a label, not a behaviour.
    pub preset: Option<String>,
    pub port: u16,
    pub max_memory_mb: u32,
    /// RFC 3339, UTC.
    pub created_at: String,
}

/// What a server looks like to the page: the registry line plus what the
/// folder says about it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct HostedServerSummary {
    #[serde(flatten)]
    pub server: HostedServer,
    /// Whether a server jar is in the folder yet. Created and installed are
    /// different moments, and the card says which one this is.
    pub installed: bool,
    pub folder: String,
}

/// What Deploy sends.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub struct NewHostedServer {
    pub name: String,
    pub mc_version: String,
    pub loader: MinecraftLoader,
    pub loader_version: Option<String>,
    pub preset: Option<String>,
    pub port: Option<u16>,
    pub max_memory_mb: Option<u32>,
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
    std::fs::write(registry_path(app_data_dir), text).map_err(|error| error.to_string())
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

fn summarise(app_data_dir: &Path, server: HostedServer) -> HostedServerSummary {
    let folder = server_dir(app_data_dir, &server.id);
    HostedServerSummary {
        installed: folder.join("server.jar").is_file(),
        folder: folder.to_string_lossy().into_owned(),
        server,
    }
}

pub fn create(app_data_dir: &Path, new: NewHostedServer) -> Result<HostedServerSummary, String> {
    let name = new.name.trim();
    if name.is_empty() {
        return Err("Give the server a name.".to_string());
    }
    if new.mc_version.trim().is_empty() {
        return Err("Choose a Minecraft version.".to_string());
    }
    if new.loader != MinecraftLoader::Vanilla
        && new.loader_version.as_deref().is_none_or(|v| v.trim().is_empty())
    {
        return Err(format!("Choose a {} version.", new.loader.slug()));
    }

    let mut servers = read_registry(app_data_dir);
    let id = unique_id(&slug(name), &servers);
    let folder = server_dir(app_data_dir, &id);
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;

    let vanilla = new.loader == MinecraftLoader::Vanilla;
    let server = HostedServer {
        id,
        name: name.to_string(),
        mc_version: new.mc_version.trim().to_string(),
        loader: new.loader,
        loader_version: if vanilla {
            None
        } else {
            new.loader_version.map(|v| v.trim().to_string())
        },
        preset: new.preset.filter(|p| !p.trim().is_empty()),
        port: new.port.unwrap_or(DEFAULT_PORT),
        max_memory_mb: new.max_memory_mb.unwrap_or(DEFAULT_MEMORY_MB),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    servers.push(server.clone());
    write_registry(app_data_dir, &servers)?;
    Ok(summarise(app_data_dir, server))
}

/// Forgets the server and removes its folder, world included.
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

#[cfg(test)]
mod tests {
    use super::*;

    fn new(name: &str, loader: MinecraftLoader, loader_version: Option<&str>) -> NewHostedServer {
        NewHostedServer {
            name: name.to_string(),
            mc_version: "1.21.1".to_string(),
            loader,
            loader_version: loader_version.map(str::to_string),
            preset: None,
            port: None,
            max_memory_mb: None,
        }
    }

    #[test]
    fn a_name_becomes_a_folder_name() {
        assert_eq!(slug("My Awesome Server"), "my-awesome-server");
        assert_eq!(slug("  Été — survie !!  "), "t-survie");
        assert_eq!(slug("!!!"), "server");
    }

    #[test]
    fn deploy_writes_a_folder_and_a_line_and_list_reads_them_back() {
        let dir = tempfile::tempdir().unwrap();
        let created = create(dir.path(), new("My Awesome Server", MinecraftLoader::Vanilla, None)).unwrap();
        assert_eq!(created.server.id, "my-awesome-server");
        assert_eq!(created.server.port, DEFAULT_PORT);
        assert!(!created.installed, "no jar has been fetched yet");
        assert!(server_dir(dir.path(), "my-awesome-server").is_dir());

        let listed = list(dir.path());
        assert_eq!(listed, vec![created]);
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
        let ok = create(dir.path(), new("Modded", MinecraftLoader::Fabric, Some("0.16.9"))).unwrap();
        assert_eq!(ok.server.loader_version.as_deref(), Some("0.16.9"));
        // Vanilla carries no loader version, whatever the form sent.
        let vanilla = create(dir.path(), new("Plain", MinecraftLoader::Vanilla, Some("junk"))).unwrap();
        assert_eq!(vanilla.server.loader_version, None);
    }

    #[test]
    fn removing_forgets_the_line_and_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let created = create(dir.path(), new("Gone", MinecraftLoader::Vanilla, None)).unwrap();
        std::fs::write(server_dir(dir.path(), &created.server.id).join("server.jar"), b"jar").unwrap();
        assert!(list(dir.path())[0].installed);

        remove(dir.path(), &created.server.id).unwrap();
        assert!(list(dir.path()).is_empty());
        assert!(!server_dir(dir.path(), &created.server.id).exists());
        assert!(remove(dir.path(), &created.server.id).is_err());
    }
}
