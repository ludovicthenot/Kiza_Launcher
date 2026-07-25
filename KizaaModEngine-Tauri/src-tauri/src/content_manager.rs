use crate::curseforge_api;
use crate::game_manager::{GameInstance, GameManager, MinecraftLoader};
use crate::minecraft_manager;
use crate::modrinth_api;
use crate::path_security;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

const MAX_PACK_FILES: usize = 5_000;
const MAX_OVERRIDE_BYTES: u64 = 1_073_741_824;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    Shader,
    Resourcepack,
    Datapack,
    Modpack,
}

impl ContentKind {
    fn allowed_extensions(self) -> &'static [&'static str] {
        match self {
            Self::Modpack => &["mrpack", "zip"],
            Self::Shader | Self::Resourcepack | Self::Datapack => &["zip"],
        }
    }

    fn folder_name(self) -> Result<&'static str, String> {
        match self {
            Self::Shader => Ok("shaderpacks"),
            Self::Resourcepack => Ok("resourcepacks"),
            Self::Datapack => Ok("datapacks"),
            Self::Modpack => Err("Modpacks create a separate instance.".to_string()),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct ContentPackInfo {
    pub file_name: String,
    pub size: u64,
    pub world_name: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct MinecraftWorldInfo {
    pub name: String,
    pub data_pack_count: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct ContentInstallResult {
    pub content_type: ContentKind,
    pub file_name: String,
    pub instance_id: String,
    pub created_instance_id: Option<String>,
    pub world_name: Option<String>,
}

#[derive(Deserialize)]
struct ModrinthPackIndex {
    #[serde(rename = "formatVersion")]
    format_version: u32,
    #[serde(default)]
    name: String,
    #[serde(default)]
    files: Vec<ModrinthPackFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
struct ModrinthPackFile {
    path: String,
    hashes: modrinth_api::ModrinthHashes,
    downloads: Vec<String>,
    #[serde(default)]
    env: Option<ModrinthPackEnvironment>,
}

#[derive(Deserialize)]
struct ModrinthPackEnvironment {
    #[serde(default)]
    client: String,
}

#[derive(Deserialize)]
struct CurseForgePackManifest {
    minecraft: CurseForgePackMinecraft,
    #[serde(default)]
    name: String,
    #[serde(default)]
    files: Vec<CurseForgePackFile>,
    #[serde(default = "default_overrides_folder")]
    overrides: String,
}

#[derive(Deserialize)]
struct CurseForgePackMinecraft {
    version: String,
    #[serde(rename = "modLoaders", default)]
    mod_loaders: Vec<CurseForgePackLoader>,
}

#[derive(Deserialize)]
struct CurseForgePackLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Deserialize)]
struct CurseForgePackFile {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
    #[serde(default)]
    required: bool,
}

fn default_overrides_folder() -> String {
    "overrides".to_string()
}

fn minecraft_instance(app_data_dir: &Path, instance_id: &str) -> Result<GameInstance, String> {
    let instance = GameManager::new(app_data_dir.to_path_buf()).verify_instance(instance_id)?;
    if instance.game_id != "minecraft" {
        return Err("This content can only be installed into Minecraft instances.".to_string());
    }
    if instance.minecraft.is_none() {
        return Err("Minecraft configuration is missing.".to_string());
    }
    Ok(instance)
}

fn safe_world_dir(game_dir: &Path, world_name: &str) -> Result<PathBuf, String> {
    let safe_name = path_security::safe_file_name(world_name, &[])
        .map_err(|error| format!("Invalid Minecraft world name: {error}"))?;
    let world_dir = game_dir.join("saves").join(safe_name);
    if !world_dir.is_dir() || !world_dir.join("level.dat").is_file() {
        return Err("The selected Minecraft world no longer exists.".to_string());
    }
    Ok(world_dir)
}

pub fn content_dir(
    app_data_dir: &Path,
    instance_id: &str,
    kind: ContentKind,
    world_name: Option<&str>,
) -> Result<PathBuf, String> {
    let instance = minecraft_instance(app_data_dir, instance_id)?;
    let game_dir = PathBuf::from(instance.install_path);
    let dir = match kind {
        ContentKind::Datapack => safe_world_dir(
            &game_dir,
            world_name.ok_or("Select a Minecraft world before installing a data pack.")?,
        )?
        .join(kind.folder_name()?),
        ContentKind::Shader | ContentKind::Resourcepack => game_dir.join(kind.folder_name()?),
        ContentKind::Modpack => return Err("Modpacks create a separate instance.".to_string()),
    };
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

pub fn list_worlds(
    app_data_dir: &Path,
    instance_id: &str,
) -> Result<Vec<MinecraftWorldInfo>, String> {
    let instance = minecraft_instance(app_data_dir, instance_id)?;
    let saves_dir = PathBuf::from(instance.install_path).join("saves");
    let mut worlds = Vec::new();
    let Ok(entries) = fs::read_dir(saves_dir) else {
        return Ok(worlds);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("level.dat").is_file() {
            continue;
        }
        let data_pack_count = fs::read_dir(path.join("datapacks"))
            .map(|items| items.flatten().count())
            .unwrap_or(0);
        worlds.push(MinecraftWorldInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            data_pack_count,
        });
    }
    worlds.sort_by_key(|world| world.name.to_lowercase());
    Ok(worlds)
}

pub fn list_content(
    app_data_dir: &Path,
    instance_id: &str,
    kind: ContentKind,
    world_name: Option<&str>,
) -> Result<Vec<ContentPackInfo>, String> {
    let dir = content_dir(app_data_dir, instance_id, kind, world_name)?;
    let mut packs = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_pack = path.is_dir()
                || path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        kind.allowed_extensions()
                            .iter()
                            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
                    });
            if !is_pack {
                continue;
            }
            packs.push(ContentPackInfo {
                file_name: entry.file_name().to_string_lossy().to_string(),
                size: entry.metadata().map(|metadata| metadata.len()).unwrap_or(0),
                world_name: world_name.map(str::to_string),
            });
        }
    }
    packs.sort_by_key(|pack| pack.file_name.to_lowercase());
    Ok(packs)
}

pub fn delete_content(
    app_data_dir: &Path,
    instance_id: &str,
    kind: ContentKind,
    file_name: &str,
    world_name: Option<&str>,
) -> Result<(), String> {
    let dir = content_dir(app_data_dir, instance_id, kind, world_name)?;
    let safe_name = path_security::safe_file_name(file_name, &[])
        .map_err(|error| format!("Invalid content file name: {error}"))?;
    let target = dir.join(safe_name);
    let metadata =
        fs::symlink_metadata(&target).map_err(|_| "Content file not found.".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symbolic links cannot be managed as Minecraft content.".to_string());
    }
    if metadata.is_dir() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())
    } else {
        fs::remove_file(target).map_err(|error| error.to_string())
    }
}

fn copy_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or("Content destination has no parent folder.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4().simple()));
    let result = (|| {
        fs::copy(source, &temporary).map_err(|error| error.to_string())?;
        if destination.exists() {
            fs::remove_file(destination).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, destination).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn import_content(
    app_data_dir: &Path,
    instance_id: &str,
    kind: ContentKind,
    source_path: &str,
    world_name: Option<&str>,
) -> Result<String, String> {
    if kind == ContentKind::Modpack {
        return Err("Use the modpack installer to create a separate instance.".to_string());
    }
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Selected content archive was not found.".to_string());
    }
    let raw_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid content archive name.")?;
    let file_name = path_security::safe_file_name(raw_name, kind.allowed_extensions())
        .map_err(|error| format!("Invalid content archive name: {error}"))?;
    let destination = content_dir(app_data_dir, instance_id, kind, world_name)?.join(&file_name);
    copy_atomically(&source, &destination)?;
    Ok(file_name)
}

fn safe_relative_pack_path(raw_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw_path);
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(format!("Unsafe modpack path rejected: {raw_path}"));
    }
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => safe.push(value),
            _ => return Err(format!("Unsafe modpack path rejected: {raw_path}")),
        }
    }
    if safe.as_os_str().is_empty() {
        return Err(format!("Unsafe modpack path rejected: {raw_path}"));
    }
    Ok(safe)
}

fn require_https_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url).map_err(|error| error.to_string())?;
    if url.scheme() != "https" {
        return Err("Minecraft content downloads must use HTTPS.".to_string());
    }
    Ok(url)
}

async fn install_remote_archive(
    app_data_dir: &Path,
    instance_id: &str,
    kind: ContentKind,
    world_name: Option<&str>,
    url: &str,
    file_name: &str,
    expected_sha1: Option<&str>,
) -> Result<ContentInstallResult, String> {
    let file_name = path_security::safe_file_name(file_name, kind.allowed_extensions())
        .map_err(|error| format!("Invalid content archive name: {error}"))?;
    let url = require_https_url(url)?;
    let destination = content_dir(app_data_dir, instance_id, kind, world_name)?.join(&file_name);
    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    minecraft_manager::download_to_path(&client, url.as_str(), &destination, expected_sha1).await?;
    Ok(ContentInstallResult {
        content_type: kind,
        file_name,
        instance_id: instance_id.to_string(),
        created_instance_id: None,
        world_name: world_name.map(str::to_string),
    })
}

fn modrinth_version_matches(version: &modrinth_api::ModrinthVersion, mc_version: &str) -> bool {
    version
        .game_versions
        .iter()
        .any(|candidate| candidate == mc_version)
}

fn file_has_allowed_extension(file_name: &str, allowed_extensions: &[&str]) -> bool {
    Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            allowed_extensions
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn select_modrinth_file<'a>(
    version: &'a modrinth_api::ModrinthVersion,
    allowed_extensions: &[&str],
) -> Option<&'a modrinth_api::ModrinthFile> {
    version
        .files
        .iter()
        .filter(|file| file_has_allowed_extension(&file.filename, allowed_extensions))
        .find(|file| file.primary)
        .or_else(|| {
            version
                .files
                .iter()
                .find(|file| file_has_allowed_extension(&file.filename, allowed_extensions))
        })
}

pub async fn install_modrinth_content(
    app_data_dir: &Path,
    instance_id: &str,
    kind: ContentKind,
    project_id: &str,
    version_id: Option<&str>,
    world_name: Option<&str>,
    display_name: Option<&str>,
) -> Result<ContentInstallResult, String> {
    if kind == ContentKind::Modpack {
        return install_modrinth_modpack(app_data_dir, project_id, version_id, display_name).await;
    }

    let instance = minecraft_instance(app_data_dir, instance_id)?;
    let minecraft = instance.minecraft.as_ref().expect("validated above");
    let versions = if let Some(version_id) = version_id {
        vec![modrinth_api::get_version(version_id).await?]
    } else {
        modrinth_api::get_versions(project_id).await?
    };
    let version = versions
        .iter()
        .find(|version| {
            version.project_id == project_id
                && modrinth_version_matches(version, &minecraft.mc_version)
                && select_modrinth_file(version, kind.allowed_extensions()).is_some()
        })
        .ok_or_else(|| {
            format!(
                "No compatible content file was found for Minecraft {}.",
                minecraft.mc_version
            )
        })?;
    let file = select_modrinth_file(version, kind.allowed_extensions())
        .ok_or("This Modrinth version has no compatible downloadable archive.")?;
    install_remote_archive(
        app_data_dir,
        instance_id,
        kind,
        world_name,
        &file.url,
        &file.filename,
        Some(&file.hashes.sha1),
    )
    .await
}

pub struct CurseForgeContentInstallRequest<'a> {
    pub api_key: &'a str,
    pub instance_id: &'a str,
    pub kind: ContentKind,
    pub mod_id: u64,
    pub file_id: u64,
    pub world_name: Option<&'a str>,
    pub display_name: Option<&'a str>,
}

pub async fn install_curseforge_content(
    app_data_dir: &Path,
    request: CurseForgeContentInstallRequest<'_>,
) -> Result<ContentInstallResult, String> {
    if request.kind == ContentKind::Modpack {
        return install_curseforge_modpack(
            app_data_dir,
            request.api_key,
            request.mod_id,
            request.file_id,
            request.display_name,
        )
        .await;
    }

    let instance = minecraft_instance(app_data_dir, request.instance_id)?;
    let minecraft = instance.minecraft.as_ref().expect("validated above");
    let file = curseforge_api::get_file(request.api_key, request.mod_id, request.file_id).await?;
    if !file
        .game_versions
        .iter()
        .any(|candidate| candidate == &minecraft.mc_version)
    {
        return Err(format!(
            "This CurseForge file does not support Minecraft {}.",
            minecraft.mc_version
        ));
    }
    let url = match file.download_url.as_deref() {
        Some(url) => url.to_string(),
        None => {
            curseforge_api::get_download_url(request.api_key, request.mod_id, request.file_id)
                .await?
        }
    };
    let sha1 = file
        .hashes
        .iter()
        .find(|hash| hash.algo == 1)
        .map(|hash| hash.value.as_str());
    install_remote_archive(
        app_data_dir,
        request.instance_id,
        request.kind,
        request.world_name,
        &url,
        &file.file_name,
        sha1,
    )
    .await
}

fn modrinth_pack_loader(
    dependencies: &HashMap<String, String>,
) -> Result<(MinecraftLoader, Option<String>), String> {
    if let Some(version) = dependencies.get("fabric-loader") {
        return Ok((MinecraftLoader::Fabric, Some(version.clone())));
    }
    if let Some(version) = dependencies.get("forge") {
        return Ok((MinecraftLoader::Forge, Some(version.clone())));
    }
    if dependencies.contains_key("neoforge") || dependencies.contains_key("quilt-loader") {
        return Err(
            "This modpack uses NeoForge or Quilt, which this launcher does not support yet."
                .to_string(),
        );
    }
    Ok((MinecraftLoader::Vanilla, None))
}

fn curseforge_pack_loader(
    loaders: &[CurseForgePackLoader],
) -> Result<(MinecraftLoader, Option<String>), String> {
    let loader = loaders
        .iter()
        .find(|loader| loader.primary)
        .or_else(|| loaders.first());
    let Some(loader) = loader else {
        return Ok((MinecraftLoader::Vanilla, None));
    };
    if let Some(version) = loader.id.strip_prefix("fabric-") {
        return Ok((MinecraftLoader::Fabric, Some(version.to_string())));
    }
    if let Some(version) = loader.id.strip_prefix("forge-") {
        return Ok((MinecraftLoader::Forge, Some(version.to_string())));
    }
    Err(format!(
        "The modpack loader '{}' is not supported by this launcher.",
        loader.id
    ))
}

fn write_modpack_marker(
    app_data_dir: &Path,
    instance: &mut GameInstance,
    provider: &str,
    project_id: &str,
) -> Result<(), String> {
    instance.detected_variant = Some(format!("Modpack {provider}:{project_id}"));
    let path = app_data_dir
        .join("games")
        .join(format!("{}.json", instance.id));
    let json = serde_json::to_vec_pretty(instance).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn extract_overrides(
    archive: &mut zip::ZipArchive<fs::File>,
    prefix: &str,
    game_dir: &Path,
) -> Result<(), String> {
    let prefix = safe_relative_pack_path(prefix)?;
    let mut extracted_bytes = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else {
            return Err(format!("Unsafe modpack archive path: {}", entry.name()));
        };
        let Ok(relative) = enclosed.strip_prefix(&prefix) else {
            continue;
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Symbolic links are not allowed in modpack overrides.".to_string());
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if extracted_bytes > MAX_OVERRIDE_BYTES {
            return Err("Modpack overrides exceed the 1 GiB safety limit.".to_string());
        }
        let destination = game_dir.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(destination).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = fs::File::create(destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_zip_json<T: for<'de> Deserialize<'de>>(
    archive: &mut zip::ZipArchive<fs::File>,
    file_name: &str,
) -> Result<T, String> {
    let mut entry = archive
        .by_name(file_name)
        .map_err(|_| format!("Modpack manifest '{file_name}' is missing."))?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid {file_name}: {error}"))
}

async fn download_modpack_archive(
    app_data_dir: &Path,
    url: &str,
    file_name: &str,
    expected_sha1: Option<&str>,
) -> Result<PathBuf, String> {
    let file_name = path_security::safe_file_name(file_name, &["mrpack", "zip"])
        .map_err(|error| format!("Invalid modpack file name: {error}"))?;
    let url = require_https_url(url)?;
    let directory = app_data_dir.join("downloads").join("modpacks");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join(format!("{}-{file_name}", Uuid::new_v4().simple()));
    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    minecraft_manager::download_to_path(&client, url.as_str(), &destination, expected_sha1).await?;
    Ok(destination)
}

async fn install_modrinth_modpack(
    app_data_dir: &Path,
    project_id: &str,
    version_id: Option<&str>,
    display_name: Option<&str>,
) -> Result<ContentInstallResult, String> {
    let version = if let Some(version_id) = version_id {
        modrinth_api::get_version(version_id).await?
    } else {
        modrinth_api::get_versions(project_id)
            .await?
            .into_iter()
            .next()
            .ok_or("This Modrinth modpack has no published version.")?
    };
    if version.project_id != project_id {
        return Err("The selected Modrinth version belongs to another project.".to_string());
    }
    let file = select_modrinth_file(&version, ContentKind::Modpack.allowed_extensions())
        .ok_or("This Modrinth modpack version has no compatible downloadable archive.")?;
    let archive_path = download_modpack_archive(
        app_data_dir,
        &file.url,
        &file.filename,
        Some(&file.hashes.sha1),
    )
    .await?;

    let install_result = async {
        let archive_file = fs::File::open(&archive_path).map_err(|error| error.to_string())?;
        let mut archive = zip::ZipArchive::new(archive_file).map_err(|error| error.to_string())?;
        let index: ModrinthPackIndex = read_zip_json(&mut archive, "modrinth.index.json")?;
        if index.format_version != 1 {
            return Err(format!(
                "Unsupported Modrinth pack format version {}.",
                index.format_version
            ));
        }
        if index.files.len() > MAX_PACK_FILES {
            return Err("This modpack contains too many files.".to_string());
        }
        let mc_version = index
            .dependencies
            .get("minecraft")
            .cloned()
            .ok_or("The modpack does not declare a Minecraft version.")?;
        let (loader, loader_version) = modrinth_pack_loader(&index.dependencies)?;
        let name = display_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&index.name)
            .trim();
        let name = if name.is_empty() {
            "Modrinth modpack"
        } else {
            name
        };
        let mut instance = minecraft_manager::create_minecraft_instance(
            app_data_dir,
            name.to_string(),
            mc_version,
            loader,
            loader_version,
            None,
        )?;
        write_modpack_marker(app_data_dir, &mut instance, "modrinth", project_id)?;
        let game_dir = PathBuf::from(&instance.install_path);
        let client = reqwest::Client::builder()
            .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| error.to_string())?;

        let install_files = async {
            for pack_file in &index.files {
                if pack_file
                    .env
                    .as_ref()
                    .is_some_and(|environment| environment.client == "unsupported")
                {
                    continue;
                }
                let relative = safe_relative_pack_path(&pack_file.path)?;
                let destination = game_dir.join(relative);
                let download = pack_file
                    .downloads
                    .first()
                    .ok_or_else(|| format!("No download URL for {}.", pack_file.path))?;
                let url = require_https_url(download)?;
                minecraft_manager::download_to_path(
                    &client,
                    url.as_str(),
                    &destination,
                    Some(&pack_file.hashes.sha1),
                )
                .await?;
            }
            extract_overrides(&mut archive, "overrides", &game_dir)
        }
        .await;
        if let Err(error) = install_files {
            let _ = minecraft_manager::delete_minecraft_instance(app_data_dir, &instance.id);
            return Err(error);
        }

        Ok(ContentInstallResult {
            content_type: ContentKind::Modpack,
            file_name: file.filename.clone(),
            instance_id: instance.id.clone(),
            created_instance_id: Some(instance.id),
            world_name: None,
        })
    }
    .await;
    let _ = fs::remove_file(archive_path);
    install_result
}

async fn install_curseforge_modpack(
    app_data_dir: &Path,
    api_key: &str,
    mod_id: u64,
    file_id: u64,
    display_name: Option<&str>,
) -> Result<ContentInstallResult, String> {
    let pack_file = curseforge_api::get_file(api_key, mod_id, file_id).await?;
    let url = match pack_file.download_url.as_deref() {
        Some(url) => url.to_string(),
        None => curseforge_api::get_download_url(api_key, mod_id, file_id).await?,
    };
    let sha1 = pack_file
        .hashes
        .iter()
        .find(|hash| hash.algo == 1)
        .map(|hash| hash.value.as_str());
    let archive_path =
        download_modpack_archive(app_data_dir, &url, &pack_file.file_name, sha1).await?;

    let install_result = async {
        let archive_file = fs::File::open(&archive_path).map_err(|error| error.to_string())?;
        let mut archive = zip::ZipArchive::new(archive_file).map_err(|error| error.to_string())?;
        let manifest: CurseForgePackManifest = read_zip_json(&mut archive, "manifest.json")?;
        if manifest.files.len() > MAX_PACK_FILES {
            return Err("This modpack contains too many files.".to_string());
        }
        let (loader, loader_version) = curseforge_pack_loader(&manifest.minecraft.mod_loaders)?;
        let name = display_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&manifest.name)
            .trim();
        let name = if name.is_empty() {
            "CurseForge modpack"
        } else {
            name
        };
        let mut instance = minecraft_manager::create_minecraft_instance(
            app_data_dir,
            name.to_string(),
            manifest.minecraft.version,
            loader,
            loader_version,
            None,
        )?;
        write_modpack_marker(
            app_data_dir,
            &mut instance,
            "curseforge",
            &mod_id.to_string(),
        )?;
        let game_dir = PathBuf::from(&instance.install_path);
        let client = reqwest::Client::builder()
            .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| error.to_string())?;

        let install_files = async {
            for pack_entry in &manifest.files {
                if !pack_entry.required {
                    continue;
                }
                let file =
                    curseforge_api::get_file(api_key, pack_entry.project_id, pack_entry.file_id)
                        .await?;
                let project = curseforge_api::get_mod(api_key, pack_entry.project_id).await?;
                let folder = match project.class_id {
                    Some(12) => "resourcepacks",
                    Some(6552) => "shaderpacks",
                    _ => "mods",
                };
                let allowed_extensions = if folder == "mods" {
                    &["jar", "zip"][..]
                } else {
                    &["zip"][..]
                };
                let file_name = path_security::safe_file_name(&file.file_name, allowed_extensions)
                    .map_err(|error| format!("Invalid CurseForge pack file: {error}"))?;
                let download_url = match file.download_url.as_deref() {
                    Some(url) => url.to_string(),
                    None => {
                        curseforge_api::get_download_url(
                            api_key,
                            pack_entry.project_id,
                            pack_entry.file_id,
                        )
                        .await?
                    }
                };
                let download_url = require_https_url(&download_url)?;
                let expected_sha1 = file
                    .hashes
                    .iter()
                    .find(|hash| hash.algo == 1)
                    .map(|hash| hash.value.as_str());
                minecraft_manager::download_to_path(
                    &client,
                    download_url.as_str(),
                    &game_dir.join(folder).join(file_name),
                    expected_sha1,
                )
                .await?;
            }
            extract_overrides(&mut archive, &manifest.overrides, &game_dir)
        }
        .await;
        if let Err(error) = install_files {
            let _ = minecraft_manager::delete_minecraft_instance(app_data_dir, &instance.id);
            return Err(error);
        }

        Ok(ContentInstallResult {
            content_type: ContentKind::Modpack,
            file_name: pack_file.file_name.clone(),
            instance_id: instance.id.clone(),
            created_instance_id: Some(instance.id),
            world_name: None,
        })
    }
    .await;
    let _ = fs::remove_file(archive_path);
    install_result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modrinth_file(filename: &str, primary: bool) -> modrinth_api::ModrinthFile {
        modrinth_api::ModrinthFile {
            url: format!("https://cdn.modrinth.com/{filename}"),
            filename: filename.to_string(),
            primary,
            size: 1,
            hashes: modrinth_api::ModrinthHashes {
                sha1: "sha1".to_string(),
                sha512: "sha512".to_string(),
            },
        }
    }

    fn modrinth_version(files: Vec<modrinth_api::ModrinthFile>) -> modrinth_api::ModrinthVersion {
        modrinth_api::ModrinthVersion {
            id: "version".to_string(),
            project_id: "project".to_string(),
            name: "Version".to_string(),
            version_number: "1.0.0".to_string(),
            game_versions: vec!["1.21.1".to_string()],
            loaders: vec!["datapack".to_string()],
            files,
            date_published: "2026-01-01T00:00:00Z".to_string(),
            dependencies: Vec::new(),
        }
    }

    #[test]
    fn safe_pack_paths_reject_traversal_and_absolute_paths() {
        assert!(safe_relative_pack_path("../mods/evil.jar").is_err());
        assert!(safe_relative_pack_path("C:\\mods\\evil.jar").is_err());
        assert!(safe_relative_pack_path("/mods/evil.jar").is_err());
        assert_eq!(
            safe_relative_pack_path("mods/example.jar").unwrap(),
            PathBuf::from("mods/example.jar")
        );
    }

    #[test]
    fn modrinth_pack_loader_selects_supported_loader() {
        let dependencies = HashMap::from([
            ("minecraft".to_string(), "1.21.1".to_string()),
            ("fabric-loader".to_string(), "0.16.10".to_string()),
        ]);
        assert_eq!(
            modrinth_pack_loader(&dependencies).unwrap(),
            (MinecraftLoader::Fabric, Some("0.16.10".to_string()))
        );
    }

    #[test]
    fn unsupported_modpack_loaders_are_explicit() {
        let dependencies = HashMap::from([("neoforge".to_string(), "21.1.0".to_string())]);
        assert!(modrinth_pack_loader(&dependencies)
            .unwrap_err()
            .contains("does not support"));
    }

    #[test]
    fn modrinth_file_selection_ignores_wrong_content_archives() {
        let version = modrinth_version(vec![
            modrinth_file("terralith-neoforge.jar", true),
            modrinth_file("terralith-datapack.zip", false),
        ]);

        let selected =
            select_modrinth_file(&version, ContentKind::Datapack.allowed_extensions()).unwrap();

        assert_eq!(selected.filename, "terralith-datapack.zip");
    }

    #[test]
    fn modrinth_file_selection_rejects_jar_only_datapack_versions() {
        let version = modrinth_version(vec![modrinth_file("terralith-fabric.jar", true)]);

        assert!(
            select_modrinth_file(&version, ContentKind::Datapack.allowed_extensions()).is_none()
        );
    }
}
