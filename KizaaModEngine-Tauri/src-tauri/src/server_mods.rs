//! The mods in a hosted server's `mods/`.
//!
//! A server has no catalogue of its own the way an instance does: the folder
//! is the list. Each jar is asked who it is through the same manifest
//! readers the compatibility report uses, so a mod dropped in by hand shows
//! its real name and version, and the report itself runs on the folder as
//! it does for an instance.
//!
//! Installing goes through the catalogues the launcher already speaks to,
//! with two refusals a client install does not need: a project that says it
//! does not run on a server is not installed on one, and a release for the
//! wrong loader or Minecraft is not offered at all.

use crate::game_manager::MinecraftLoader;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::Path;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ServerMod {
    pub file: String,
    pub mod_id: Option<String>,
    pub name: String,
    pub version: Option<String>,
    pub bytes: u64,
    pub enabled: bool,
}

fn mods_dir(server_dir: &Path) -> std::path::PathBuf {
    server_dir.join("mods")
}

pub fn list(server_dir: &Path) -> Vec<ServerMod> {
    let mut mods: Vec<ServerMod> = std::fs::read_dir(mods_dir(server_dir))
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let path = entry.path();
                    let file = entry.file_name().to_string_lossy().into_owned();
                    let enabled = file.ends_with(".jar");
                    if !enabled && !file.ends_with(".jar.disabled") {
                        return None;
                    }
                    let bytes = entry.metadata().ok()?.len();
                    let identity = crate::mod_compat::identify_jar(&path);
                    Some(ServerMod {
                        name: identity
                            .as_ref()
                            .and_then(|i| i.name.clone())
                            .unwrap_or_else(|| {
                                file.trim_end_matches(".disabled")
                                    .trim_end_matches(".jar")
                                    .to_string()
                            }),
                        mod_id: identity.as_ref().map(|i| i.mod_id.clone()),
                        version: identity.map(|i| i.version),
                        file,
                        bytes,
                        enabled,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    mods.sort_by_key(|m| m.name.to_lowercase());
    mods
}

fn safe_mod_path(server_dir: &Path, file: &str) -> Result<std::path::PathBuf, String> {
    crate::path_security::safe_child_path(&mods_dir(server_dir), file, &["jar", "disabled"])
}

pub fn remove(server_dir: &Path, file: &str) -> Result<(), String> {
    std::fs::remove_file(safe_mod_path(server_dir, file)?).map_err(|error| error.to_string())
}

/// `x.jar` ↔ `x.jar.disabled`: the loader skips what does not end in `.jar`.
pub fn set_enabled(server_dir: &Path, file: &str, enabled: bool) -> Result<String, String> {
    let from = safe_mod_path(server_dir, file)?;
    let target_name = if enabled {
        file.trim_end_matches(".disabled").to_string()
    } else if file.ends_with(".disabled") {
        file.to_string()
    } else {
        format!("{file}.disabled")
    };
    let to = safe_mod_path(server_dir, &target_name)?;
    if from != to {
        std::fs::rename(&from, &to).map_err(|error| error.to_string())?;
    }
    Ok(target_name)
}

/// Copies a jar from anywhere on disk into `mods/`.
pub fn add_file(server_dir: &Path, source: &Path) -> Result<ServerMod, String> {
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "That file has no name.".to_string())?;
    if !name.ends_with(".jar") {
        return Err("Only .jar files can be added.".to_string());
    }
    std::fs::create_dir_all(mods_dir(server_dir)).map_err(|error| error.to_string())?;
    let target = safe_mod_path(server_dir, name)?;
    std::fs::copy(source, &target).map_err(|error| format!("Could not copy {name}: {error}"))?;
    list(server_dir)
        .into_iter()
        .find(|m| m.file == name)
        .ok_or_else(|| "The file was copied but could not be read back.".to_string())
}

pub fn compatibility(
    server_id: &str,
    server_dir: &Path,
    mc_version: &str,
    loader: &MinecraftLoader,
    loader_version: Option<&str>,
) -> Result<crate::mod_compat::CompatReport, String> {
    crate::mod_compat::check_compatibility(
        server_id,
        &mods_dir(server_dir),
        mc_version,
        loader.slug(),
        loader_version,
    )
}

/// Whether a Modrinth project may go on a server, from what its author said.
pub fn modrinth_allows_server(server_side: Option<&str>) -> Result<(), String> {
    match server_side
        .map(|s| s.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("unsupported") => {
            Err("This mod runs on the client only; a server has no use for it.".to_string())
        }
        _ => Ok(()),
    }
}

/// Installs a Modrinth project's release for this server's Minecraft and
/// loader: the newest one that fits, or the exact version asked for.
pub async fn install_from_modrinth(
    server_dir: &Path,
    mc_version: &str,
    loader: &MinecraftLoader,
    project_id: &str,
    version_id: Option<&str>,
) -> Result<ServerMod, String> {
    if *loader == MinecraftLoader::Vanilla {
        return Err("A vanilla server loads no mods.".to_string());
    }
    let project = crate::modrinth_api::get_project(project_id).await?;
    modrinth_allows_server(project.server_side.as_deref())?;
    let version = match version_id {
        Some(id) => {
            let version = crate::modrinth_api::get_version(id).await?;
            if !crate::modrinth_api::version_matches_context(&version, mc_version, loader.slug()) {
                return Err(format!(
                    "{} {} is not for Minecraft {mc_version} on {}.",
                    project.title,
                    version.version_number,
                    loader.slug()
                ));
            }
            version
        }
        None => {
            crate::modrinth_api::get_versions_for(project_id, Some(mc_version), Some(loader.slug()))
                .await?
                .into_iter()
                .next()
                .ok_or_else(|| {
                    format!(
                        "{} has no release for Minecraft {mc_version} on {}.",
                        project.title,
                        loader.slug()
                    )
                })?
        }
    };
    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| "That release has no file.".to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(mods_dir(server_dir)).map_err(|error| error.to_string())?;
    let target = safe_mod_path(server_dir, &file.filename)?;
    crate::minecraft_manager::download_to_path(
        &client,
        &file.url,
        &target,
        Some(&file.hashes.sha1),
    )
    .await?;
    list(server_dir)
        .into_iter()
        .find(|m| m.file == file.filename)
        .ok_or_else(|| "Downloaded, but the file could not be read back.".to_string())
}

/// Installs a CurseForge file. CurseForge has no per-project side, so the
/// file's own "Client"/"Server" tags are the only refusal available.
pub async fn install_from_curseforge(
    server_dir: &Path,
    mc_version: &str,
    loader: &MinecraftLoader,
    api_key: &str,
    mod_id: u64,
    file_id: Option<u64>,
) -> Result<ServerMod, String> {
    if *loader == MinecraftLoader::Vanilla {
        return Err("A vanilla server loads no mods.".to_string());
    }
    let project = crate::curseforge_api::get_mod(api_key, mod_id).await?;
    crate::curseforge_api::require_distribution_allowed(&project)?;
    let file = match file_id {
        Some(id) => crate::curseforge_api::get_file(api_key, mod_id, id).await?,
        None => crate::curseforge_api::list_files(
            api_key,
            mod_id,
            Some(mc_version),
            Some(loader.slug()),
            20,
            0,
        )
        .await?
        .data
        .into_iter()
        .find(|f| crate::curseforge_api::file_matches_context(f, mc_version, loader.slug()))
        .ok_or_else(|| {
            format!(
                "{} has no file for Minecraft {mc_version} on {}.",
                project.name,
                loader.slug()
            )
        })?,
    };
    if crate::mod_side::from_catalogue(None, None, &file.game_versions)
        == Some(crate::mod_side::ModSide::Client)
    {
        return Err("This file is tagged client-only on CurseForge.".to_string());
    }
    let url = match file.download_url.clone() {
        Some(url) => url,
        None => crate::curseforge_api::get_download_url(api_key, mod_id, file.id).await?,
    };
    let sha1 = file
        .hashes
        .iter()
        .find(|h| h.algo == 1)
        .map(|h| h.value.clone());
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(mods_dir(server_dir)).map_err(|error| error.to_string())?;
    let target = safe_mod_path(server_dir, &file.file_name)?;
    crate::minecraft_manager::download_to_path(&client, &url, &target, sha1.as_deref()).await?;
    list(server_dir)
        .into_iter()
        .find(|m| m.file == file.file_name)
        .ok_or_else(|| "Downloaded, but the file could not be read back.".to_string())
}

/// A newer release of an installed jar, for this Minecraft and loader.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ServerModUpdate {
    pub file: String,
    pub name: String,
    pub current_version: String,
    pub new_version: String,
    /// `modrinth` or `curseforge`.
    pub source: String,
    pub project_id: String,
    pub version_id: String,
    pub published: String,
}

fn sha1_of(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Sha1::new();
    hasher.update(&bytes);
    Some(format!("{:x}", hasher.finalize()))
}

/// What is newer than what is installed, found from the bytes on disk.
///
/// The jar's hash identifies it — no guessing from file names. Modrinth is
/// asked first, for every jar at once; what it does not know is asked of
/// CurseForge by fingerprint when a key is available. A release counts as
/// newer only if it was published after the installed one and fits this
/// server's Minecraft and loader: platforms do not order their lists, and
/// a downgrade nobody asked for is worse than no update.
pub async fn check_updates(
    server_dir: &Path,
    mc_version: &str,
    loader: &MinecraftLoader,
    curseforge_key: Option<&str>,
) -> Result<Vec<ServerModUpdate>, String> {
    let installed: Vec<ServerMod> = list(server_dir).into_iter().filter(|m| m.enabled).collect();
    let mut hashed: Vec<(ServerMod, String)> = Vec::new();
    for entry in installed {
        if let Some(hash) = sha1_of(&mods_dir(server_dir).join(&entry.file)) {
            hashed.push((entry, hash));
        }
    }
    let hashes: Vec<String> = hashed.iter().map(|(_, h)| h.clone()).collect();
    let known = crate::modrinth_api::versions_from_sha1s(&hashes)
        .await
        .unwrap_or_default();

    let mut updates = Vec::new();
    let mut not_on_modrinth: Vec<&(ServerMod, String)> = Vec::new();
    for pair in &hashed {
        let (entry, hash) = pair;
        let Some(current) = known.get(hash) else {
            not_on_modrinth.push(pair);
            continue;
        };
        let Ok(versions) = crate::modrinth_api::get_versions_for(
            &current.project_id,
            Some(mc_version),
            Some(loader.slug()),
        )
        .await
        else {
            continue;
        };
        let newest = versions
            .into_iter()
            .filter(|v| v.id != current.id && v.date_published > current.date_published)
            .max_by(|a, b| a.date_published.cmp(&b.date_published));
        if let Some(newer) = newest {
            updates.push(ServerModUpdate {
                file: entry.file.clone(),
                name: entry.name.clone(),
                current_version: current.version_number.clone(),
                new_version: newer.version_number.clone(),
                source: "modrinth".to_string(),
                project_id: current.project_id.clone(),
                version_id: newer.id,
                published: newer.date_published,
            });
        }
    }

    if let Some(key) = curseforge_key.filter(|_| !not_on_modrinth.is_empty()) {
        let mut prints: Vec<(u32, &ServerMod)> = Vec::new();
        for (entry, _) in &not_on_modrinth {
            if let Ok(bytes) = std::fs::read(mods_dir(server_dir).join(&entry.file)) {
                prints.push((crate::curseforge_api::fingerprint(&bytes), entry));
            }
        }
        let fingerprints: Vec<u32> = prints.iter().map(|(f, _)| *f).collect();
        let matched = crate::curseforge_api::files_by_fingerprint(key, &fingerprints)
            .await
            .unwrap_or_default();
        for current in matched {
            let Some(mod_id) = current.mod_id else {
                continue;
            };
            let Some((_, entry)) = prints
                .iter()
                .find(|(f, _)| matches!(current.file_fingerprint, Some(fp) if fp == *f))
            else {
                continue;
            };
            let Ok(files) = crate::curseforge_api::list_files(
                key,
                mod_id,
                Some(mc_version),
                Some(loader.slug()),
                20,
                0,
            )
            .await
            else {
                continue;
            };
            let newest = files
                .data
                .into_iter()
                .filter(|f| f.id != current.id && f.file_date > current.file_date)
                .filter(|f| {
                    crate::curseforge_api::file_matches_context(f, mc_version, loader.slug())
                })
                .max_by(|a, b| a.file_date.cmp(&b.file_date));
            if let Some(newer) = newest {
                updates.push(ServerModUpdate {
                    file: entry.file.clone(),
                    name: entry.name.clone(),
                    current_version: current.file_name.clone(),
                    new_version: newer.file_name.clone(),
                    source: "curseforge".to_string(),
                    project_id: mod_id.to_string(),
                    version_id: newer.id.to_string(),
                    published: newer.file_date,
                });
            }
        }
    }
    updates.sort_by_key(|u| u.name.to_lowercase());
    Ok(updates)
}

/// Installs the newer release and removes the file it replaces.
pub async fn apply_update(
    server_dir: &Path,
    mc_version: &str,
    loader: &MinecraftLoader,
    curseforge_key: Option<&str>,
    update: &ServerModUpdate,
) -> Result<ServerMod, String> {
    let installed = match update.source.as_str() {
        "modrinth" => {
            install_from_modrinth(
                server_dir,
                mc_version,
                loader,
                &update.project_id,
                Some(&update.version_id),
            )
            .await?
        }
        "curseforge" => {
            let key = curseforge_key.ok_or_else(|| "CurseForge needs a key.".to_string())?;
            let mod_id: u64 = update
                .project_id
                .parse()
                .map_err(|_| "A CurseForge project id is a number.".to_string())?;
            let file_id: u64 = update
                .version_id
                .parse()
                .map_err(|_| "A CurseForge file id is a number.".to_string())?;
            install_from_curseforge(server_dir, mc_version, loader, key, mod_id, Some(file_id))
                .await?
        }
        other => return Err(format!("Unknown catalogue: {other}")),
    };
    // The old jar goes only once the new one is in place, and only if it is
    // a different file: a same-named release simply overwrote it.
    if installed.file != update.file {
        let _ = remove(server_dir, &update.file);
    }
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_is_the_list_and_disabled_jars_stay_in_it() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("mods")).unwrap();
        std::fs::write(dir.path().join("mods/b-mod.jar"), b"not a real jar").unwrap();
        std::fs::write(dir.path().join("mods/a-mod.jar.disabled"), b"nope").unwrap();
        std::fs::write(dir.path().join("mods/readme.txt"), b"ignored").unwrap();
        let mods = list(dir.path());
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0].name, "a-mod");
        assert!(!mods[0].enabled);
        assert_eq!(mods[1].name, "b-mod");
        assert!(mods[1].enabled);
        assert_eq!(
            mods[1].mod_id, None,
            "an unreadable jar has no identity, not a made-up one"
        );
    }

    #[test]
    fn disabling_renames_and_enabling_renames_back() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("mods")).unwrap();
        std::fs::write(dir.path().join("mods/x.jar"), b"j").unwrap();
        assert_eq!(
            set_enabled(dir.path(), "x.jar", false).unwrap(),
            "x.jar.disabled"
        );
        assert!(dir.path().join("mods/x.jar.disabled").exists());
        assert_eq!(
            set_enabled(dir.path(), "x.jar.disabled", true).unwrap(),
            "x.jar"
        );
        assert!(dir.path().join("mods/x.jar").exists());
        assert!(remove(dir.path(), "../server.properties").is_err());
        remove(dir.path(), "x.jar").unwrap();
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn a_client_only_project_is_refused_and_a_silent_one_is_not() {
        assert!(modrinth_allows_server(Some("unsupported")).is_err());
        assert!(modrinth_allows_server(Some("required")).is_ok());
        assert!(modrinth_allows_server(Some("optional")).is_ok());
        assert!(modrinth_allows_server(None).is_ok());
    }
}
