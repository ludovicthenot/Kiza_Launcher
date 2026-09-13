//! Bringing a server that exists somewhere on disk into the launcher.
//!
//! The folder is read for what it can prove: a vanilla jar carries its
//! version inside, Fabric's launcher jar its `install.properties`, a Forge
//! or NeoForge install the version in its `libraries/` path. What cannot be
//! read is reported as missing and asked of the user, never invented — a
//! server registered under the wrong Minecraft version would be offered
//! the wrong Java and the wrong mods.
//!
//! The folder is an outside file. It is copied, never moved or linked, and
//! nothing in it is executed to find out what it is.

use crate::game_manager::MinecraftLoader;
use crate::server_host::{HostedServer, HostedServerSummary};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct Detection {
    pub mc_version: Option<String>,
    pub loader: Option<MinecraftLoader>,
    pub loader_version: Option<String>,
    pub mod_count: usize,
    pub level_name: String,
    pub has_world: bool,
    pub has_properties: bool,
    pub port: Option<u16>,
    pub eula_accepted: bool,
    /// What could not be read and must be asked for.
    pub missing: Vec<&'static str>,
    pub notes: Vec<String>,
}

fn jar_entry(jar: &Path, name: &str) -> Option<String> {
    let file = std::fs::File::open(jar).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut entry = archive.by_name(name).ok()?;
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    Some(text)
}

/// Mojang's `version.json`, inside every server jar since 1.14.
fn vanilla_version(jar: &Path) -> Option<String> {
    let text = jar_entry(jar, "version.json")?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("id")?.as_str().map(str::to_string)
}

/// The launcher jar's `install.properties`: `fabric-loader-version=…` and
/// `game-version=…`.
fn fabric_install(jar: &Path) -> Option<(Option<String>, Option<String>)> {
    let text = jar_entry(jar, "install.properties")?;
    let props = crate::server_properties::parse(&text);
    Some((
        props.get("game-version").map(str::to_string),
        props.get("fabric-loader-version").map(str::to_string),
    ))
}

/// `1.21.1-52.0.20` → (1.21.1, 52.0.20)
fn split_forge_folder(name: &str) -> Option<(String, String)> {
    let (mc, version) = name.split_once('-')?;
    Some((mc.to_string(), version.to_string()))
}

/// NeoForge names its versions after the Minecraft they are for:
/// `21.1.74` is 1.21.1, `21.0.166` is 1.21, `20.4.237` is 1.20.4.
pub fn neoforge_minecraft(version: &str) -> Option<String> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    Some(if minor == 0 {
        format!("1.{major}")
    } else {
        format!("1.{major}.{minor}")
    })
}

fn newest_child(dir: &Path) -> Option<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names.pop()
}

pub fn detect(folder: &Path) -> Detection {
    let mut found = Detection::default();
    let props = crate::server_properties::read(folder);
    found.has_properties = folder.join(crate::server_properties::FILE_NAME).is_file();
    found.level_name = props.level_name();
    found.has_world = folder.join(&found.level_name).join("level.dat").is_file();
    found.port = props.get("server-port").and_then(|p| p.trim().parse().ok());
    found.eula_accepted = crate::server_host::eula_accepted(folder);
    found.mod_count = crate::server_host::count_jars(&folder.join("mods"));

    if let Some(name) = newest_child(&folder.join("libraries/net/neoforged/neoforge")) {
        found.loader = Some(MinecraftLoader::NeoForge);
        found.mc_version = neoforge_minecraft(&name);
        found.loader_version = Some(name);
    } else if let Some(name) = newest_child(&folder.join("libraries/net/minecraftforge/forge")) {
        found.loader = Some(MinecraftLoader::Forge);
        if let Some((mc, version)) = split_forge_folder(&name) {
            found.mc_version = Some(mc);
            found.loader_version = Some(version);
        }
    } else if folder.join(crate::server_install::FABRIC_LAUNCHER_JAR).is_file() {
        found.loader = Some(MinecraftLoader::Fabric);
        if let Some((mc, loader)) = fabric_install(&folder.join(crate::server_install::FABRIC_LAUNCHER_JAR)) {
            found.mc_version = mc;
            found.loader_version = loader;
        }
        if found.mc_version.is_none() {
            found.mc_version = vanilla_version(&folder.join(crate::server_install::VANILLA_JAR));
        }
    } else if let Some(legacy) = std::fs::read_dir(folder).ok().and_then(|entries| {
        entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .find(|n| n.starts_with("forge-") && n.ends_with(".jar") && !n.contains("installer"))
    }) {
        found.loader = Some(MinecraftLoader::Forge);
        // forge-1.16.5-36.2.39.jar
        let stem = legacy.trim_start_matches("forge-").trim_end_matches(".jar");
        if let Some((mc, version)) = split_forge_folder(stem) {
            found.mc_version = Some(mc);
            found.loader_version = Some(version);
        }
    } else if folder.join(crate::server_install::VANILLA_JAR).is_file() {
        found.loader = Some(MinecraftLoader::Vanilla);
        found.mc_version = vanilla_version(&folder.join(crate::server_install::VANILLA_JAR));
        if found.mc_version.is_none() {
            found.notes.push("The server jar carries no version.json; older than 1.14, or not Mojang's.".to_string());
        }
    } else {
        found.notes.push("No server jar or loader install was found; the server files will be fetched after import.".to_string());
    }

    if found.mc_version.is_none() {
        found.missing.push("mc_version");
    }
    if found.loader.is_none() {
        found.missing.push("loader");
    }
    if found.loader.as_ref().is_some_and(|l| *l != MinecraftLoader::Vanilla) && found.loader_version.is_none() {
        found.missing.push("loader_version");
    }
    found
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub struct ImportRequest {
    pub folder: String,
    pub name: String,
    /// Fill in what detection could not; ignored where it could.
    pub mc_version: Option<String>,
    pub loader: Option<MinecraftLoader>,
    pub loader_version: Option<String>,
    pub max_memory_mb: Option<u32>,
}

/// Copies the folder in and registers it. Logs and a previous launcher's
/// pid file stay behind; everything else, libraries included, comes.
pub fn import(app_data_dir: &Path, request: ImportRequest) -> Result<HostedServerSummary, String> {
    let source = Path::new(&request.folder);
    if !source.is_dir() {
        return Err("That folder does not exist.".to_string());
    }
    let servers_root = crate::server_host::servers_dir(app_data_dir);
    if source.starts_with(&servers_root) {
        return Err("That folder is already one of Kiza's servers.".to_string());
    }
    let detected = detect(source);
    let mc_version = detected
        .mc_version
        .clone()
        .or(request.mc_version.clone())
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| "Which Minecraft version is this server? It could not be read from the folder.".to_string())?;
    let loader = detected
        .loader
        .clone()
        .or(request.loader.clone())
        .ok_or_else(|| "Which loader does this server use? It could not be read from the folder.".to_string())?;
    let loader_version = if loader == MinecraftLoader::Vanilla {
        None
    } else {
        Some(
            detected
                .loader_version
                .clone()
                .or(request.loader_version.clone())
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| format!("Which {} version does this server use?", loader.slug()))?,
        )
    };

    let id = crate::server_host::next_id(app_data_dir, &request.name);
    let target = crate::server_host::server_dir(app_data_dir, &id);
    copy_for_import(source, &target)?;
    std::fs::create_dir_all(target.join(crate::server_host::BACKUPS_DIR)).map_err(|e| e.to_string())?;

    let server = HostedServer {
        id,
        name: request.name.trim().to_string(),
        description: String::new(),
        mc_version,
        loader,
        loader_version,
        preset: None,
        port: detected.port.unwrap_or(crate::server_host::DEFAULT_PORT),
        java_major: None,
        min_memory_mb: crate::server_host::DEFAULT_MIN_MEMORY_MB,
        max_memory_mb: request.max_memory_mb.unwrap_or(crate::server_host::DEFAULT_MEMORY_MB),
        jvm_args: Vec::new(),
        linked_instance_id: None,
        created_from: Some(format!("import:{}", source.display())),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
        auto_backup: Default::default(),
        kiza_address: None,
    };
    crate::server_host::register(app_data_dir, server)
}

fn copy_for_import(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "logs" || name_str == crate::server_host::BACKUPS_DIR || name_str == crate::server_process::PID_FILE {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let target = to.join(&name);
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| format!("Could not copy {name_str}: {e}"))?;
        }
    }
    Ok(())
}

fn copy_dir_all(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let target = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar_with(path: &Path, entry: &str, body: &str) {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        zip.start_file(entry, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(body.as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn a_vanilla_jar_says_its_version() {
        let dir = tempfile::tempdir().unwrap();
        jar_with(&dir.path().join("server.jar"), "version.json", r#"{"id":"1.21.1","name":"1.21.1"}"#);
        std::fs::write(dir.path().join("server.properties"), "server-port=25570\nlevel-name=survie\n").unwrap();
        std::fs::create_dir_all(dir.path().join("survie")).unwrap();
        std::fs::write(dir.path().join("survie/level.dat"), b"nbt").unwrap();
        let found = detect(dir.path());
        assert_eq!(found.loader, Some(MinecraftLoader::Vanilla));
        assert_eq!(found.mc_version.as_deref(), Some("1.21.1"));
        assert_eq!(found.port, Some(25570));
        assert!(found.has_world);
        assert!(found.missing.is_empty());
    }

    #[test]
    fn fabric_and_neoforge_are_read_from_what_they_leave_behind() {
        let dir = tempfile::tempdir().unwrap();
        jar_with(
            &dir.path().join("fabric-server-launch.jar"),
            "install.properties",
            "fabric-loader-version=0.16.9\ngame-version=1.21.1\n",
        );
        let found = detect(dir.path());
        assert_eq!(found.loader, Some(MinecraftLoader::Fabric));
        assert_eq!(found.loader_version.as_deref(), Some("0.16.9"));
        assert_eq!(found.mc_version.as_deref(), Some("1.21.1"));

        let neo = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(neo.path().join("libraries/net/neoforged/neoforge/21.1.74")).unwrap();
        let found = detect(neo.path());
        assert_eq!(found.loader, Some(MinecraftLoader::NeoForge));
        assert_eq!(found.loader_version.as_deref(), Some("21.1.74"));
        assert_eq!(found.mc_version.as_deref(), Some("1.21.1"));
        assert_eq!(neoforge_minecraft("21.0.166").as_deref(), Some("1.21"));
        assert_eq!(neoforge_minecraft("20.4.237").as_deref(), Some("1.20.4"));
    }

    #[test]
    fn what_cannot_be_read_is_asked_for_not_guessed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("server.jar"), b"not a zip").unwrap();
        let found = detect(dir.path());
        assert_eq!(found.loader, Some(MinecraftLoader::Vanilla));
        assert_eq!(found.mc_version, None);
        assert_eq!(found.missing, vec!["mc_version"]);

        let empty = tempfile::tempdir().unwrap();
        let found = detect(empty.path());
        assert_eq!(found.missing, vec!["mc_version", "loader"]);
    }

    #[test]
    fn an_import_copies_the_folder_and_takes_the_answers_it_was_given() {
        let app = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("server.jar"), b"opaque").unwrap();
        std::fs::create_dir_all(source.path().join("logs")).unwrap();
        std::fs::write(source.path().join("logs/latest.log"), b"old").unwrap();
        std::fs::write(source.path().join("server.properties"), "motd=hi\n").unwrap();

        let refused = import(
            app.path(),
            ImportRequest { folder: source.path().to_string_lossy().into(), name: "Old".into(), mc_version: None, loader: None, loader_version: None, max_memory_mb: None },
        );
        assert!(refused.unwrap_err().contains("Minecraft version"));

        let imported = import(
            app.path(),
            ImportRequest { folder: source.path().to_string_lossy().into(), name: "Old".into(), mc_version: Some("1.12.2".into()), loader: None, loader_version: None, max_memory_mb: None },
        )
        .unwrap();
        assert_eq!(imported.server.mc_version, "1.12.2");
        assert_eq!(imported.server.loader, MinecraftLoader::Vanilla);
        let folder = Path::new(&imported.folder);
        assert!(folder.join("server.jar").exists());
        assert!(!folder.join("logs").exists());
        assert!(imported.installed);
        assert!(source.path().join("server.jar").exists(), "the original is left where it was");
    }
}
