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
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_MANIFEST_BYTES: u64 = 1_048_576;
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
    /// CurseForge omits this on a required file, and it writes it as `true`
    /// when it is there. Defaulting to `false` meant a pack that left the field
    /// out installed none of its mods and reported success.
    #[serde(default = "yes")]
    required: bool,
}

fn yes() -> bool {
    true
}

/// A mod a pack names that this launcher was not allowed to fetch.
///
/// Its author has switched off third-party downloads on CurseForge. Nobody can
/// change that from here, and the file is a click away on the project's own
/// page, so it travels back to the interface as something to offer rather than
/// as an error.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct BlockedPackFile {
    pub project_id: u64,
    pub name: String,
    pub page_url: Option<String>,
    /// The same mod on Modrinth, when it is published there.
    ///
    /// Filled in after the download pass, because it costs a request each and
    /// only a mod nobody was allowed to fetch needs one.
    #[serde(default)]
    pub modrinth_project_id: Option<String>,
    #[serde(default)]
    pub modrinth_name: Option<String>,
}

/// A mod that failed for a reason nobody chose.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct FailedPackFile {
    pub project_id: u64,
    pub reason: String,
}

/// What came of fetching a pack's files.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct PackFetchReport {
    pub installed: usize,
    pub blocked: Vec<BlockedPackFile>,
    pub failed: Vec<FailedPackFile>,
}

impl PackFetchReport {
    /// Whether the instance is worth keeping.
    ///
    /// One mod its author will not let a launcher fetch is not a reason to
    /// delete an instance and the twenty-eight mods, the configs and the worlds
    /// that came with it. Nothing at all arriving is.
    pub fn worth_keeping(&self) -> bool {
        self.installed > 0 || !self.blocked.is_empty()
    }
}

/// One catalogue file a pack references but does not carry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingPackFile {
    pub project_id: u64,
    pub file_id: u64,
    pub required: bool,
}

impl From<&CurseForgePackFile> for PendingPackFile {
    fn from(value: &CurseForgePackFile) -> Self {
        Self {
            project_id: value.project_id,
            file_id: value.file_id,
            required: value.required,
        }
    }
}

/// What an imported archive produced, and what it still owes.
pub struct ImportedArchive {
    pub result: ContentInstallResult,
    /// Files the manifest names and the archive does not contain, to be
    /// fetched from CurseForge once the caller has a key.
    pub pending: Vec<PendingPackFile>,
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

/// Grouped so the signature stays readable, matching the request structs the
/// rest of this module already uses.
struct RemoteArchiveInstall<'a> {
    instance_id: &'a str,
    kind: ContentKind,
    world_name: Option<&'a str>,
    url: &'a str,
    file_name: &'a str,
    expected_sha1: Option<&'a str>,
    origin: Option<crate::content_provenance::ContentOrigin>,
}

async fn install_remote_archive(
    app_data_dir: &Path,
    request: RemoteArchiveInstall<'_>,
) -> Result<ContentInstallResult, String> {
    let RemoteArchiveInstall {
        instance_id,
        kind,
        world_name,
        url,
        file_name,
        expected_sha1,
        origin,
    } = request;
    let file_name = path_security::safe_file_name(file_name, kind.allowed_extensions())
        .map_err(|error| format!("Invalid content archive name: {error}"))?;
    let url = require_https_url(url)?;
    let destination = content_dir(app_data_dir, instance_id, kind, world_name)?.join(&file_name);
    let client = reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    minecraft_manager::download_to_path(&client, url.as_str(), &destination, expected_sha1).await?;

    // Remember which project this file is, or no update can ever be offered
    // for it: a file name is not an identity.
    if let Some(origin) = origin {
        let game_dir = minecraft_manager::instance_game_dir_path(app_data_dir, instance_id);
        if let Ok(relative) = destination.strip_prefix(&game_dir) {
            let key = relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            let _ = crate::content_provenance::record(app_data_dir, instance_id, &key, origin);
        }
    }

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
        RemoteArchiveInstall {
            instance_id,
            kind,
            world_name,
            url: &file.url,
            file_name: &file.filename,
            expected_sha1: Some(&file.hashes.sha1),
            origin: Some(crate::content_provenance::ContentOrigin {
                provider: "modrinth".to_string(),
                project_id: project_id.to_string(),
                version_id: version.id.clone(),
                pinned: false,
            }),
        },
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
    let project = curseforge_api::get_mod(request.api_key, request.mod_id).await?;
    curseforge_api::require_distribution_allowed(&project)?;
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
        RemoteArchiveInstall {
            instance_id: request.instance_id,
            kind: request.kind,
            world_name: request.world_name,
            url: &url,
            file_name: &file.file_name,
            expected_sha1: sha1,
            origin: Some(crate::content_provenance::ContentOrigin {
                provider: "curseforge".to_string(),
                project_id: request.mod_id.to_string(),
                version_id: request.file_id.to_string(),
                pinned: false,
            }),
        },
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
    // Ahead of Forge, though it would be right after it too: `neoforge-21.11.0`
    // does not start with `forge-`, so the old list refused NeoForge packs
    // outright rather than mistaking them for Forge ones.
    if let Some(version) = loader.id.strip_prefix("neoforge-") {
        return Ok((MinecraftLoader::NeoForge, Some(version.to_string())));
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

pub(crate) fn extract_overrides(
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

pub(crate) fn read_zip_json<T: for<'de> Deserialize<'de>>(
    archive: &mut zip::ZipArchive<fs::File>,
    file_name: &str,
) -> Result<T, String> {
    let mut entry = archive
        .by_name(file_name)
        .map_err(|_| format!("Modpack manifest '{file_name}' is missing."))?;
    if entry.size() > MAX_MANIFEST_BYTES {
        return Err(format!(
            "Modpack manifest '{file_name}' exceeds the 1 MiB safety limit."
        ));
    }
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

/// Imports an instance archive produced by the launcher's Share/Export.
///
/// The archive is a CurseForge-format pack whose mods and config ship inside
/// `overrides/`, so nothing has to be downloaded and no API key is needed. A
/// pack that instead lists remote `files` belongs in the modpack browser, which
/// can resolve those downloads.
/// Downloads every catalogue file a CurseForge pack lists.
///
/// A CurseForge pack is a manifest and a folder of overrides: the mods
/// themselves are not in the archive, only their project and file numbers, and
/// the launcher is expected to fetch each one. Kiza did this for packs opened
/// from the catalogue and refused to do it for the same archive sitting on
/// disk, which is the file people are actually given when someone shares a
/// pack.
#[allow(clippy::too_many_arguments)]
pub async fn fetch_pack_files(
    app_data_dir: &Path,
    instance_id: &str,
    api_key: &str,
    client: &reqwest::Client,
    files: &[PendingPackFile],
    game_dir: &Path,
    mut on_progress: impl FnMut(usize, usize, &str),
) -> PackFetchReport {
    let manager = crate::mod_manager::ModManager::new(app_data_dir.to_path_buf());
    let staging = app_data_dir.join("downloads").join("minecraft");
    let _ = fs::create_dir_all(&staging);
    let mut report = PackFetchReport::default();
    let wanted: Vec<&PendingPackFile> = files.iter().filter(|entry| entry.required).collect();
    let total = wanted.len();

    for (index, pack_entry) in wanted.into_iter().enumerate() {
        // One failure is one mod. The whole import used to stop at the first
        // one and delete the instance behind it, so a pack of twenty-nine mods
        // was lost because the author of one of them does not let launchers
        // download it — a decision nothing here can change and the reader can
        // work around in a minute.
        let file = match curseforge_api::get_file(
            api_key,
            pack_entry.project_id,
            pack_entry.file_id,
        )
        .await
        {
            Ok(file) => file,
            Err(reason) => {
                on_progress(index + 1, total, "");
                report.failed.push(FailedPackFile {
                    project_id: pack_entry.project_id,
                    reason,
                });
                continue;
            }
        };
        let project = match curseforge_api::get_mod(api_key, pack_entry.project_id).await {
            Ok(project) => project,
            Err(reason) => {
                on_progress(index + 1, total, &file.file_name);
                report.failed.push(FailedPackFile {
                    project_id: pack_entry.project_id,
                    reason,
                });
                continue;
            }
        };
        on_progress(index + 1, total, &project.name);

        if curseforge_api::require_distribution_allowed(&project).is_err() {
            report.blocked.push(BlockedPackFile {
                project_id: pack_entry.project_id,
                name: project.name.clone(),
                page_url: project
                    .links
                    .as_ref()
                    .and_then(|links| links.website_url.clone()),
                modrinth_project_id: None,
                modrinth_name: None,
            });
            continue;
        }
        // The pack lists resource packs and shader packs beside its mods, and
        // only the class id says which is which.
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
        let fetched = async {
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

            // Resource packs and shader packs are listed from the folder they
            // live in, so they are written straight there. A mod is not: the
            // Mods tab, the update check, the enable switch and the export all
            // read the launcher's own catalogue, and a jar dropped into
            // `mods/` is in none of it.
            //
            // That is what happened. A pack of twenty-nine mods downloaded, the
            // game would have loaded every one of them, and the launcher showed
            // "0 installed" — because nothing had ever been told they were
            // there. So a mod is staged and then installed the same way as one
            // added from the catalogue, with everything CurseForge said about
            // it.
            if folder != "mods" {
                return minecraft_manager::download_to_path(
                    client,
                    download_url.as_str(),
                    &game_dir.join(folder).join(&file_name),
                    expected_sha1,
                )
                .await;
            }

            let staged = staging.join(format!("{}-{}", uuid::Uuid::new_v4(), file_name));
            minecraft_manager::download_to_path(
                client,
                download_url.as_str(),
                &staged,
                expected_sha1,
            )
            .await?;

            let metadata = crate::mod_manager::ModMetadata {
                name: Some(project.name.clone()),
                version: Some(file.file_name.clone()),
                description: project.summary.clone(),
                source: Some("curseforge".to_string()),
                author: project.authors.first().map(|author| author.name.clone()),
                homepage_url: project
                    .links
                    .as_ref()
                    .and_then(|links| links.website_url.clone()),
                cover_url: project
                    .logo
                    .as_ref()
                    .and_then(|logo| logo.thumbnail_url.clone()),
                file_size: file.file_length,
                game_versions: file.game_versions.clone(),
                loaders: Vec::new(),
                updated_at: Some(file.file_date.clone()),
                project_id: Some(pack_entry.project_id.to_string()),
                version_id: Some(pack_entry.file_id.to_string()),
            };
            let installed = manager.install_mod_file(
                instance_id,
                &staged.to_string_lossy(),
                &format!("mods/{}", file_name),
                Some(metadata),
            );
            let _ = fs::remove_file(&staged);
            installed.map(|_| ())?;

            // Recorded so the update check can offer this mod a newer build.
            // Without it the mod is in the list and can never be updated.
            let _ = crate::content_provenance::record(
                app_data_dir,
                instance_id,
                &format!("mods/{}", file_name),
                crate::content_provenance::ContentOrigin {
                    provider: "curseforge".to_string(),
                    project_id: pack_entry.project_id.to_string(),
                    version_id: pack_entry.file_id.to_string(),
                    pinned: false,
                },
            );
            Ok(())
        }
        .await;

        match fetched {
            Ok(()) => report.installed += 1,
            Err(reason) => report.failed.push(FailedPackFile {
                project_id: pack_entry.project_id,
                reason: format!("{}: {reason}", project.name),
            }),
        }
    }
    report
}

pub fn import_instance_archive(
    app_data_dir: &Path,
    archive_path: &Path,
    display_name: Option<&str>,
) -> Result<ImportedArchive, String> {
    let archive_name = archive_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid instance archive name.")?;
    path_security::safe_file_name(archive_name, &["zip"])
        .map_err(|error| format!("Invalid instance archive name: {error}"))?;

    let archive_file = fs::File::open(archive_path)
        .map_err(|error| format!("Could not open the archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("The archive is not a valid zip: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("This instance archive contains too many entries.".to_string());
    }
    let manifest: CurseForgePackManifest =
        read_zip_json(&mut archive, "manifest.json").map_err(|error| {
            if error.contains("is missing") {
                "This archive has no manifest.json; it is not a Kiza instance export.".to_string()
            } else {
                error
            }
        })?;

    if manifest.minecraft.version.trim().is_empty() {
        return Err("The instance archive does not declare a Minecraft version.".to_string());
    }

    if manifest.files.len() > MAX_PACK_FILES {
        return Err("This modpack contains too many files.".to_string());
    }

    let (loader, loader_version) = curseforge_pack_loader(&manifest.minecraft.mod_loaders)?;
    let name = display_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(&manifest.name)
        .trim();
    let name = if name.is_empty() {
        "Imported instance"
    } else {
        name
    };

    let instance = minecraft_manager::create_minecraft_instance(
        app_data_dir,
        name.to_string(),
        manifest.minecraft.version.clone(),
        loader,
        loader_version,
        None,
    )?;

    let game_dir = PathBuf::from(&instance.install_path);
    if let Err(error) = extract_overrides(&mut archive, &manifest.overrides, &game_dir) {
        // Never leave a half-built instance behind.
        let _ = minecraft_manager::delete_minecraft_instance(app_data_dir, &instance.id);
        return Err(error);
    }

    Ok(ImportedArchive {
        pending: manifest.files.iter().map(PendingPackFile::from).collect(),
        result: ContentInstallResult {
            content_type: ContentKind::Modpack,
            file_name: archive_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
            instance_id: instance.id.clone(),
            created_instance_id: Some(instance.id),
            world_name: None,
        },
    })
}

async fn install_curseforge_modpack(
    app_data_dir: &Path,
    api_key: &str,
    mod_id: u64,
    file_id: u64,
    display_name: Option<&str>,
) -> Result<ContentInstallResult, String> {
    let project = curseforge_api::get_mod(api_key, mod_id).await?;
    curseforge_api::require_distribution_allowed(&project)?;
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
            let pending: Vec<PendingPackFile> =
                manifest.files.iter().map(PendingPackFile::from).collect();
            let report = fetch_pack_files(
                app_data_dir,
                &instance.id,
                api_key,
                &client,
                &pending,
                &game_dir,
                |_, _, _| {},
            )
            .await;
            if !report.worth_keeping() {
                return Err(report
                    .failed
                    .first()
                    .map(|failure| failure.reason.clone())
                    .unwrap_or_else(|| {
                        "No file in this modpack could be downloaded.".to_string()
                    }));
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
    use std::io::Write as _;

    /// One mod nobody is allowed to fetch is one mod, not a failed import.
    ///
    /// A pack whose files cannot all be downloaded used to stop at the first
    /// refusal and delete the instance behind it, so twenty-nine mods, the
    /// configs and the worlds were lost because one author does not let
    /// launchers download their mod — a decision nothing in this launcher can
    /// change, and one the reader can work around in a minute if they are told
    /// which mod and where.
    #[test]
    fn an_instance_survives_the_mods_it_was_not_allowed_to_fetch() {
        let with_one_installed = PackFetchReport {
            installed: 28,
            blocked: vec![BlockedPackFile {
                project_id: 517601,
                name: "Not Enough Animations".to_string(),
                page_url: Some(
                    "https://www.curseforge.com/minecraft/mc-mods/not-enough-animations"
                        .to_string(),
                ),
                modrinth_project_id: None,
                modrinth_name: None,
            }],
            failed: Vec::new(),
        };
        assert!(with_one_installed.worth_keeping());

        // Nothing downloaded and nothing blocked is a failed import: an empty
        // instance is litter, and retrying is the right move.
        let nothing = PackFetchReport {
            installed: 0,
            blocked: Vec::new(),
            failed: vec![FailedPackFile {
                project_id: 1,
                reason: "the network went away".to_string(),
            }],
        };
        assert!(!nothing.worth_keeping());

        // Blocked but nothing else: still worth keeping. The overrides are
        // already on disk and the reader has one file to fetch.
        let only_blocked = PackFetchReport {
            installed: 0,
            blocked: vec![BlockedPackFile {
                project_id: 2,
                name: "One Mod".to_string(),
                page_url: None,
                modrinth_project_id: None,
                modrinth_name: None,
            }],
            failed: Vec::new(),
        };
        assert!(only_blocked.worth_keeping());
    }

    /// Every loader id a pack can declare, and what it means.
    ///
    /// `neoforge-21.11.0` does not start with `forge-`, so a NeoForge pack was
    /// not mistaken for a Forge one: it fell past both and was refused as an
    /// unsupported loader, which is the one pack format NeoForge users have.
    #[test]
    fn a_pack_declares_its_loader_and_the_launcher_knows_all_of_them() {
        let declared = |id: &str| {
            curseforge_pack_loader(&[CurseForgePackLoader {
                id: id.to_string(),
                primary: true,
            }])
        };

        assert_eq!(
            declared("fabric-0.19.3").unwrap(),
            (MinecraftLoader::Fabric, Some("0.19.3".to_string()))
        );
        assert_eq!(
            declared("forge-47.4.21").unwrap(),
            (MinecraftLoader::Forge, Some("47.4.21".to_string()))
        );
        assert_eq!(
            declared("neoforge-21.11.4").unwrap(),
            (MinecraftLoader::NeoForge, Some("21.11.4".to_string()))
        );
        assert!(declared("quilt-0.26.0").is_err());
    }

    /// A CurseForge share, opened from the file someone was given.
    ///
    /// CurseForge exports a manifest naming each mod by project and file
    /// number, an `overrides/` folder for everything the catalogue does not
    /// hold, and a `modlist.html` for a person to read. Kiza used to look at
    /// the manifest, see a non-empty `files`, and refuse the archive outright
    /// with a note to go and find the pack in the catalogue — which does not
    /// help at all when the pack was never published there and the zip is the
    /// only copy of it.
    ///
    /// The instance is created and the overrides are laid down here; the files
    /// come back as work to do, because fetching them needs a key and a
    /// network and this function has neither.
    #[test]
    fn a_curseforge_share_is_accepted_and_reports_what_it_still_needs() {
        let temp = tempfile::tempdir().expect("temp dir");
        let archive_path = temp.path().join("shared-pack.zip");
        {
            let file = fs::File::create(&archive_path).expect("create archive");
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("manifest.json", options).expect("manifest");
            zip.write_all(
                br#"{
                    "minecraft": {
                        "version": "1.21.1",
                        "modLoaders": [{ "id": "fabric-0.16.10", "primary": true }]
                    },
                    "manifestType": "minecraftModpack",
                    "manifestVersion": 1,
                    "name": "Shared pack",
                    "version": "",
                    "author": "",
                    "overrides": "overrides",
                    "files": [
                        { "projectID": 60089, "fileID": 7323625, "required": true },
                        { "projectID": 419699, "fileID": 7339256 }
                    ]
                }"#,
            )
            .expect("write manifest");
            zip.start_file("overrides/config/example.toml", options)
                .expect("override entry");
            zip.write_all(b"enabled=true").expect("write override");
            zip.finish().expect("finish archive");
        }

        let imported = import_instance_archive(temp.path(), &archive_path, None)
            .expect("a CurseForge share is a thing Kiza can open");

        let instance = GameManager::new(temp.path().to_path_buf())
            .verify_instance(&imported.result.instance_id)
            .expect("read the created instance");
        let minecraft = instance.minecraft.expect("minecraft config");
        assert_eq!(minecraft.mc_version, "1.21.1");
        assert_eq!(minecraft.loader, MinecraftLoader::Fabric);
        assert_eq!(minecraft.loader_version.as_deref(), Some("0.16.10"));
        assert_eq!(instance.display_name, "Shared pack");

        // The overrides are already on disk; they are in the archive.
        assert_eq!(
            fs::read_to_string(
                PathBuf::from(&instance.install_path)
                    .join("config")
                    .join("example.toml")
            )
            .expect("override written"),
            "enabled=true"
        );

        // Both files are owed, including the one that never said it was
        // required: CurseForge omits the flag on a required file, and reading
        // that as "optional" installed nothing and called it a success.
        assert_eq!(imported.pending.len(), 2);
        assert!(imported.pending.iter().all(|file| file.required));
        assert_eq!(imported.pending[0].project_id, 60089);
        assert_eq!(imported.pending[0].file_id, 7323625);
    }

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
            changelog: None,
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

    #[test]
    fn exported_instance_round_trips_with_loader_mods_and_config() {
        let temp = tempfile::tempdir().expect("temp dir");
        let original = minecraft_manager::create_minecraft_instance(
            temp.path(),
            "Original instance".to_string(),
            "1.21.1".to_string(),
            MinecraftLoader::Fabric,
            Some("0.16.10".to_string()),
            None,
        )
        .expect("create source instance");
        let source_game_dir = PathBuf::from(&original.install_path);
        fs::write(
            source_game_dir.join("mods").join("example.jar"),
            b"mod bytes",
        )
        .expect("write source mod");
        fs::write(
            source_game_dir.join("config").join("example.toml"),
            b"enabled=true",
        )
        .expect("write source config");

        let original_minecraft = original.minecraft.clone().expect("minecraft config");
        let archive = temp.path().join("exported.zip");
        crate::instance_export::write_archive(
            &crate::instance_export::ArchiveRequest {
                app_data_dir: temp.path(),
                instance_id: &original.id,
                game_dir: &source_game_dir,
                display_name: &original.display_name,
                // Taken from the instance rather than written out: the loader
                // version the launcher picked is what has to survive the trip.
                mc_version: &original_minecraft.mc_version,
                loader: "fabric",
                loader_version: original_minecraft.loader_version.clone(),
            },
            &crate::instance_export::ExportSelection {
                mods: true,
                config: true,
                ..Default::default()
            },
            &archive,
        )
        .expect("export source instance");
        let result: ImportedArchive =
            import_instance_archive(temp.path(), &archive, Some("Imported copy"))
                .expect("import exported instance");
        let imported = GameManager::new(temp.path().to_path_buf())
            .verify_instance(&result.result.instance_id)
            .expect("read imported instance");
        let minecraft = imported.minecraft.expect("minecraft config");
        let imported_game_dir = PathBuf::from(imported.install_path);

        assert_ne!(result.result.instance_id, original.id);
        assert!(
            result.pending.is_empty(),
            "a Kiza export carries its own jars"
        );
        assert_eq!(imported.display_name, "Imported copy");
        assert_eq!(minecraft.mc_version, "1.21.1");
        assert_eq!(minecraft.loader, MinecraftLoader::Fabric);
        assert_eq!(minecraft.loader_version.as_deref(), Some("0.16.10"));
        assert_eq!(
            fs::read(imported_game_dir.join("mods").join("example.jar"))
                .expect("read imported mod"),
            b"mod bytes"
        );
        assert_eq!(
            fs::read(imported_game_dir.join("config").join("example.toml"))
                .expect("read imported config"),
            b"enabled=true"
        );
    }
}
