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
    /// Mods the pack lists that CurseForge would not let us fetch.
    ///
    /// Carried out rather than counted and dropped. A pack installed without
    /// them creates an instance that looks finished -- the mods folder has
    /// files in it, the instance reads as healthy -- and cannot start, because
    /// everything that depended on the missing mod fails at load. The launcher
    /// knew exactly which ones and used to say nothing, which left somebody
    /// reading a thousand lines of Forge naming mods at each other.
    #[serde(default)]
    pub blocked: Vec<BlockedPackFile>,
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
    version: String,
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
    /// The build the pack pinned, as CurseForge describes it without serving
    /// it: the file's name, its SHA-1 and when it came out. Enough to find
    /// the same build elsewhere, or the nearest one.
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub file_id: u64,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub published: Option<String>,
    /// The Modrinth release to install in its place: the pinned build when
    /// Modrinth has it, otherwise the nearest, marked as such.
    #[serde(default)]
    pub modrinth_build: Option<crate::missing_dependency::ModrinthBuild>,
}

impl BlockedPackFile {
    /// Looks for the same mod on Modrinth and, once found, for the pack's own
    /// build of it.
    ///
    /// A mod its CurseForge author will not let a launcher fetch is often on
    /// Modrinth too, where downloads are served by design -- the same author's
    /// own choice on that platform, not a way around the one they made here.
    /// The build matters as much as the mod: a pack pins the release its other
    /// mods were tuned against, and the newest one can crash the game at
    /// start. Two requests per blocked mod, and there are never many.
    pub async fn look_up_on_modrinth(&mut self, mc_version: &str, loader: Option<&str>) {
        let Some(found) = crate::missing_dependency::alternative_on_modrinth(
            &self.name,
            self.page_url.as_deref(),
        )
        .await
        else {
            return;
        };
        self.modrinth_build = crate::missing_dependency::build_on_modrinth(
            &found.project_id,
            crate::missing_dependency::PinnedBuild {
                file_name: &self.file_name,
                sha1: self.sha1.as_deref(),
                published: self.published.as_deref(),
            },
            mc_version,
            loader,
        )
        .await;
        self.modrinth_project_id = Some(found.project_id);
        self.modrinth_name = Some(found.name);
    }
}

/// What became of a file somebody fetched by hand for a blocked mod.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum HandAddedFile {
    /// Installed and catalogued, exactly as if the launcher had fetched it.
    Installed { file_name: String, exact: bool },
    /// Not the file the pack asks for. Nothing was installed; the person
    /// decides whether it goes in anyway.
    Mismatch {
        file_name: String,
        expected_file_name: String,
        sha1: String,
    },
}

/// Puts in a file the person went and downloaded for a mod the launcher was
/// not allowed to fetch.
///
/// The missing-mods window said "download it from the project page and add
/// it" -- and then left the person to find the folder, drop the jar in, and
/// discover that the Mods tab does not list a jar dropped into a folder.
/// This is the other half of that sentence. The file is checked against the
/// SHA-1 the pack manifest carries, so a wrong build is caught here rather
/// than at launch, and it is installed the way a fetched mod is: catalogued,
/// with the pack's own provenance, so the update check and the export know
/// it.
pub fn add_blocked_file_by_hand(
    app_data_dir: &Path,
    instance_id: &str,
    blocked: &BlockedPackFile,
    path: &Path,
    accept_mismatch: bool,
) -> Result<HandAddedFile, String> {
    if !path.is_file() {
        return Err("That file does not exist.".to_string());
    }
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "That path has no file name.".to_string())?;
    let file_name = path_security::safe_file_name(&file_name, &["jar", "zip"])
        .map_err(|error| format!("Not a mod file: {error}"))?;

    let sha1 = minecraft_manager::sha1_hex_of_file(path)?;
    let exact = blocked
        .sha1
        .as_deref()
        .is_some_and(|expected| expected.eq_ignore_ascii_case(&sha1));
    if !exact && !accept_mismatch {
        return Ok(HandAddedFile::Mismatch {
            file_name,
            expected_file_name: blocked.file_name.clone(),
            sha1,
        });
    }

    // Under the pack's own name when it is the pack's own file: that is what
    // the configs and the other mods were written against.
    let installed_name = if exact && !blocked.file_name.is_empty() {
        blocked.file_name.clone()
    } else {
        file_name
    };
    let manager = crate::mod_manager::ModManager::new(app_data_dir.to_path_buf());
    let metadata = crate::mod_manager::ModMetadata {
        name: Some(blocked.name.clone()),
        version: Some(installed_name.clone()),
        source: Some("curseforge".to_string()),
        homepage_url: blocked.page_url.clone(),
        project_id: Some(blocked.project_id.to_string()),
        version_id: exact.then(|| blocked.file_id.to_string()),
        ..Default::default()
    };
    manager.install_mod_file(
        instance_id,
        &path.to_string_lossy(),
        &format!("mods/{installed_name}"),
        Some(metadata),
    )?;
    if exact {
        let _ = crate::content_provenance::record(
            app_data_dir,
            instance_id,
            &format!("mods/{installed_name}"),
            crate::content_provenance::ContentOrigin {
                provider: "curseforge".to_string(),
                project_id: blocked.project_id.to_string(),
                version_id: blocked.file_id.to_string(),
                pinned: false,
            },
        );
    }
    Ok(HandAddedFile::Installed {
        file_name: installed_name,
        exact,
    })
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
    /// What the manifest calls the pack, for finding it on CurseForge.
    pub pack_name: String,
    pub pack_version: String,
    /// The archive's own size, to hold against the official one.
    pub archive_bytes: u64,
}

/// The pack on CurseForge an imported archive says it is, when the official
/// file is a good deal heavier than the one that was imported.
///
/// RLCraft's official zip is 51 MB: manifest, configs, and the `resources`,
/// `scripts` and `structures` folders the pack does not run right without.
/// The 12 MB copy that went around had the manifest and the configs, and the
/// launcher imported it without a word, leaving a magenta main menu and
/// missing recipes for someone to puzzle over. The manifest names the pack
/// and its version; CurseForge knows how big that release really is.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct OfficialPack {
    pub project_id: u64,
    pub file_id: u64,
    pub name: String,
    pub file_name: String,
    pub official_bytes: u64,
    pub archive_bytes: u64,
}

/// Whether the official release outweighs the imported archive by enough
/// to mean files are missing, not merely compressed differently.
pub(crate) fn is_much_lighter(archive_bytes: u64, official_bytes: u64) -> bool {
    archive_bytes > 0 && official_bytes > archive_bytes.saturating_mul(3) / 2
}

/// Looks the imported pack up on CurseForge and says when the official
/// release is much heavier. Silent on any doubt: a pack CurseForge does not
/// know, a version it cannot match, a network that is down.
pub async fn official_pack_if_lighter(
    api_key: &str,
    pack_name: &str,
    pack_version: &str,
    archive_bytes: u64,
) -> Option<OfficialPack> {
    let name = pack_name.trim();
    let version = pack_version.trim();
    if name.is_empty() || version.is_empty() || archive_bytes == 0 {
        return None;
    }
    const MODPACKS: u32 = 4471;
    let hits = curseforge_api::search_mods(
        api_key,
        name,
        MODPACKS,
        &curseforge_api::SearchFilters::default(),
        10,
        0,
        None,
    )
    .await
    .ok()?;
    let wanted = crate::dependency_resolver::comparable_name(name);
    let project = hits
        .data
        .into_iter()
        .find(|hit| crate::dependency_resolver::comparable_name(&hit.name) == wanted)?;
    let files = curseforge_api::list_files(api_key, project.id, None, None, 50, 0)
        .await
        .ok()?;
    let release = files.data.into_iter().find(|file| {
        crate::missing_dependency::file_name_carries_version(&file.file_name, version)
    })?;
    let official_bytes = release.file_length?;
    if !is_much_lighter(archive_bytes, official_bytes) {
        return None;
    }
    Some(OfficialPack {
        project_id: project.id,
        file_id: release.id,
        name: project.name,
        file_name: release.file_name,
        official_bytes,
        archive_bytes,
    })
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
        blocked: Vec::new(),
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
    // NeoForge was refused here long after the launcher learned it: the
    // CurseForge path accepted it, instances ran it, and a Modrinth pack
    // built on it was turned away with a sentence that had stopped being
    // true. The reference matrix found the sentence.
    if let Some(version) = dependencies.get("neoforge") {
        return Ok((MinecraftLoader::NeoForge, Some(version.clone())));
    }
    if dependencies.contains_key("quilt-loader") {
        return Err(
            "This modpack uses Quilt, which this launcher does not support yet.".to_string(),
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

    let install_result =
        install_modrinth_archive(app_data_dir, &archive_path, Some(project_id), display_name, &file.filename)
            .await;
    let _ = fs::remove_file(archive_path);
    install_result
}

/// Installs a `.mrpack` that is already on disk: the one just downloaded
/// from the catalogue, or one a friend sent. `project_id` marks the
/// instance as that catalogue pack when there is one to mark it as.
pub(crate) async fn install_modrinth_archive(
    app_data_dir: &Path,
    archive_path: &Path,
    project_id: Option<&str>,
    display_name: Option<&str>,
    file_name: &str,
) -> Result<ContentInstallResult, String> {
    let install_result = async {
        let archive_file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
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
        if let Some(project_id) = project_id {
            write_modpack_marker(app_data_dir, &mut instance, "modrinth", project_id)?;
        }
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
            file_name: file_name.to_string(),
            instance_id: instance.id.clone(),
            created_instance_id: Some(instance.id),
            world_name: None,
            blocked: Vec::new(),
        })
    }
    .await;
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
    use futures::StreamExt;

    let manager = crate::mod_manager::ModManager::new(app_data_dir.to_path_buf());
    let staging = app_data_dir.join("downloads").join("minecraft");
    let _ = fs::create_dir_all(&staging);
    let mut report = PackFetchReport::default();
    let wanted: Vec<&PendingPackFile> = files.iter().filter(|entry| entry.required).collect();
    let total = wanted.len();
    if total == 0 {
        return report;
    }

    // Three passes, each as wide as its bottleneck allows. It used to be one
    // loop doing everything for one mod before touching the next: two API
    // requests, a download, a catalogue write, a hundred and eighty times
    // over, one after the other. RLCraft took three minutes. The metadata
    // now comes in two batched requests, the downloads run six abreast, and
    // only the catalogue -- one file nobody may write twice at once -- is
    // still one at a time, which is the one part that was never slow.

    // 1. What each file is: the batched endpoints, then a fallback per file
    //    for anything the batch left out (a file CurseForge no longer lists).
    let project_ids: Vec<u64> = {
        let mut ids: Vec<u64> = wanted.iter().map(|entry| entry.project_id).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    let file_ids: Vec<u64> = wanted.iter().map(|entry| entry.file_id).collect();
    on_progress(0, total, "");
    let (projects, files_found) = futures::join!(
        curseforge_api::get_mods(api_key, &project_ids),
        curseforge_api::get_files(api_key, &file_ids)
    );
    let mut projects: HashMap<u64, curseforge_api::CurseForgeMod> = projects
        .unwrap_or_default()
        .into_iter()
        .map(|project| (project.id, project))
        .collect();
    let mut files_by_id: HashMap<u64, curseforge_api::CurseForgeFile> = files_found
        .unwrap_or_default()
        .into_iter()
        .map(|file| (file.id, file))
        .collect();

    struct Resolved {
        entry: PendingPackFile,
        file: curseforge_api::CurseForgeFile,
        project: curseforge_api::CurseForgeMod,
    }
    let mut resolved: Vec<Resolved> = Vec::with_capacity(total);
    let mut done = 0usize;
    for entry in &wanted {
        // One failure is one mod. The whole import used to stop at the first
        // one and delete the instance behind it, so a pack of twenty-nine mods
        // was lost because the author of one of them does not let launchers
        // download it -- a decision nothing here can change and the reader
        // can work around in a minute.
        let file = match files_by_id.remove(&entry.file_id) {
            Some(file) => file,
            None => match curseforge_api::get_file(api_key, entry.project_id, entry.file_id).await {
                Ok(file) => file,
                Err(reason) => {
                    done += 1;
                    on_progress(done, total, "");
                    report.failed.push(FailedPackFile {
                        project_id: entry.project_id,
                        reason,
                    });
                    continue;
                }
            },
        };
        let project = match projects.get(&entry.project_id).cloned() {
            Some(project) => project,
            None => match curseforge_api::get_mod(api_key, entry.project_id).await {
                Ok(project) => {
                    projects.insert(project.id, project.clone());
                    project
                }
                Err(reason) => {
                    done += 1;
                    on_progress(done, total, &file.file_name);
                    report.failed.push(FailedPackFile {
                        project_id: entry.project_id,
                        reason,
                    });
                    continue;
                }
            },
        };
        if curseforge_api::require_distribution_allowed(&project).is_err() {
            done += 1;
            on_progress(done, total, &project.name);
            report.blocked.push(BlockedPackFile {
                project_id: entry.project_id,
                name: project.name.clone(),
                page_url: project
                    .links
                    .as_ref()
                    .and_then(|links| links.website_url.clone()),
                modrinth_project_id: None,
                modrinth_name: None,
                file_name: file.file_name.clone(),
                file_id: entry.file_id,
                // CurseForge numbers its algorithms: 1 is SHA-1, 2 is MD5.
                sha1: file
                    .hashes
                    .iter()
                    .find(|hash| hash.algo == 1)
                    .map(|hash| hash.value.clone()),
                published: Some(file.file_date.clone()),
                modrinth_build: None,
            });
            continue;
        }
        resolved.push(Resolved {
            entry: **entry,
            file,
            project,
        });
    }

    // 2. The bytes, six at a time. A mod goes to the staging folder for the
    //    catalogue to install; a resource pack or shader pack goes straight
    //    to its folder, which is where it is listed from.
    struct Downloaded {
        resolved: Resolved,
        folder: &'static str,
        file_name: String,
        staged: Option<PathBuf>,
    }
    let downloads = futures::stream::iter(resolved.into_iter().map(|item| {
        let staging = staging.clone();
        async move {
            let outcome: Result<Downloaded, String> = async {
                // The pack lists resource packs and shader packs beside its
                // mods, and only the class id says which is which.
                let folder = match item.project.class_id {
                    Some(12) => "resourcepacks",
                    Some(6552) => "shaderpacks",
                    _ => "mods",
                };
                let allowed_extensions = if folder == "mods" {
                    &["jar", "zip"][..]
                } else {
                    &["zip"][..]
                };
                let file_name = path_security::safe_file_name(&item.file.file_name, allowed_extensions)
                    .map_err(|error| format!("Invalid CurseForge pack file: {error}"))?;
                let download_url = match item.file.download_url.as_deref() {
                    Some(url) => url.to_string(),
                    None => {
                        curseforge_api::get_download_url(
                            api_key,
                            item.entry.project_id,
                            item.entry.file_id,
                        )
                        .await?
                    }
                };
                let download_url = require_https_url(&download_url)?;
                let expected_sha1 = item
                    .file
                    .hashes
                    .iter()
                    .find(|hash| hash.algo == 1)
                    .map(|hash| hash.value.as_str());
                if folder != "mods" {
                    minecraft_manager::download_to_path(
                        client,
                        download_url.as_str(),
                        &game_dir.join(folder).join(&file_name),
                        expected_sha1,
                    )
                    .await?;
                    return Ok(Downloaded {
                        resolved: item,
                        folder,
                        file_name,
                        staged: None,
                    });
                }
                let staged = staging.join(format!("{}-{}", uuid::Uuid::new_v4(), file_name));
                minecraft_manager::download_to_path(
                    client,
                    download_url.as_str(),
                    &staged,
                    expected_sha1,
                )
                .await?;
                Ok(Downloaded {
                    resolved: item,
                    folder,
                    file_name,
                    staged: Some(staged),
                })
            }
            .await;
            outcome
        }
    }))
    .buffer_unordered(6);
    futures::pin_mut!(downloads);

    // 3. The catalogue, one at a time, as each download lands.
    while let Some(outcome) = downloads.next().await {
        done += 1;
        match outcome {
            Err(reason) => {
                on_progress(done, total, "");
                report.failed.push(FailedPackFile {
                    project_id: 0,
                    reason,
                });
            }
            Ok(Downloaded {
                resolved,
                folder,
                file_name,
                staged,
            }) => {
                on_progress(done, total, &resolved.project.name);
                if folder != "mods" {
                    report.installed += 1;
                    continue;
                }
                // A mod is staged and then installed the same way as one
                // added from the catalogue, with everything CurseForge said
                // about it: the Mods tab, the update check, the enable switch
                // and the export all read the launcher's own catalogue, and a
                // jar dropped into `mods/` is in none of it.
                let Some(staged) = staged else { continue };
                let metadata = crate::mod_manager::ModMetadata {
                    name: Some(resolved.project.name.clone()),
                    version: Some(resolved.file.file_name.clone()),
                    description: resolved.project.summary.clone(),
                    source: Some("curseforge".to_string()),
                    author: resolved.project.authors.first().map(|author| author.name.clone()),
                    homepage_url: resolved
                        .project
                        .links
                        .as_ref()
                        .and_then(|links| links.website_url.clone()),
                    cover_url: resolved
                        .project
                        .logo
                        .as_ref()
                        .and_then(|logo| logo.thumbnail_url.clone()),
                    file_size: resolved.file.file_length,
                    game_versions: resolved.file.game_versions.clone(),
                    loaders: Vec::new(),
                    updated_at: Some(resolved.file.file_date.clone()),
                    project_id: Some(resolved.entry.project_id.to_string()),
                    version_id: Some(resolved.entry.file_id.to_string()),
                };
                let installed = manager.install_mod_file(
                    instance_id,
                    &staged.to_string_lossy(),
                    &format!("mods/{}", file_name),
                    Some(metadata),
                );
                let _ = fs::remove_file(&staged);
                match installed {
                    Ok(_) => {
                        // Recorded so the update check can offer this mod a
                        // newer build. Without it the mod is in the list and
                        // can never be updated.
                        let _ = crate::content_provenance::record(
                            app_data_dir,
                            instance_id,
                            &format!("mods/{}", file_name),
                            crate::content_provenance::ContentOrigin {
                                provider: "curseforge".to_string(),
                                project_id: resolved.entry.project_id.to_string(),
                                version_id: resolved.entry.file_id.to_string(),
                                pinned: false,
                            },
                        );
                        report.installed += 1;
                    }
                    Err(reason) => report.failed.push(FailedPackFile {
                        project_id: resolved.entry.project_id,
                        reason: format!("{}: {reason}", resolved.project.name),
                    }),
                }
            }
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
    path_security::safe_file_name(archive_name, crate::archive::EXTENSIONS)
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
        pack_name: manifest.name.clone(),
        pack_version: manifest.version.clone(),
        archive_bytes: fs::metadata(archive_path)
            .map(|meta| meta.len())
            .unwrap_or(0),
        result: ContentInstallResult {
            content_type: ContentKind::Modpack,
            file_name: archive_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
            instance_id: instance.id.clone(),
            created_instance_id: Some(instance.id),
            world_name: None,
            blocked: Vec::new(),
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
            manifest.minecraft.version.clone(),
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

        let mut blocked: Vec<BlockedPackFile> = Vec::new();
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
            let loader = instance
                .minecraft
                .as_ref()
                .map(|mc| mc.loader.slug())
                .filter(|slug| *slug != "vanilla");
            for mut file in report.blocked {
                file.look_up_on_modrinth(&manifest.minecraft.version, loader)
                    .await;
                blocked.push(file);
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
            blocked,
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
                file_name: "NotEnoughAnimations-1.0.jar".to_string(),
                file_id: 1,
                sha1: None,
                published: None,
                modrinth_build: None,
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
                file_name: "one-mod-1.0.jar".to_string(),
                file_id: 2,
                sha1: None,
                published: None,
                modrinth_build: None,
            }],
            failed: Vec::new(),
        };
        assert!(only_blocked.worth_keeping());
    }

    /// The jar somebody fetched by hand is checked against the pack before
    /// it goes in, and goes in under the pack's own name when it is the one.
    #[test]
    fn a_file_added_by_hand_is_checked_against_the_pack_and_catalogued() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("data");
        let downloads = root.path().join("downloads");
        fs::create_dir_all(&downloads).unwrap();
        let right = downloads.join("SRParasites-1.12.2v1.9.11 (1).jar");
        fs::write(&right, b"the pack's own bytes").unwrap();
        let wrong = downloads.join("SRParasites-1.10.9.jar");
        fs::write(&wrong, b"something newer").unwrap();
        let sha1 = minecraft_manager::sha1_hex_of_file(&right).unwrap();

        let blocked = BlockedPackFile {
            project_id: 348025,
            name: "Scape and Run: Parasites".to_string(),
            page_url: None,
            modrinth_project_id: None,
            modrinth_name: None,
            file_name: "SRParasites-1.12.2v1.9.11.jar".to_string(),
            file_id: 4436467,
            sha1: Some(sha1),
            published: None,
            modrinth_build: None,
        };

        // The wrong build is named, and nothing is installed until agreed.
        let outcome = add_blocked_file_by_hand(&app_data, "rl", &blocked, &wrong, false).unwrap();
        assert!(matches!(outcome, HandAddedFile::Mismatch { ref expected_file_name, .. }
            if expected_file_name == "SRParasites-1.12.2v1.9.11.jar"));
        assert!(crate::mod_manager::ModManager::new(app_data.clone()).load_mods("rl").is_empty());

        // The right one is installed under the pack's name, with its provenance.
        let outcome = add_blocked_file_by_hand(&app_data, "rl", &blocked, &right, false).unwrap();
        assert_eq!(
            outcome,
            HandAddedFile::Installed {
                file_name: "SRParasites-1.12.2v1.9.11.jar".to_string(),
                exact: true
            }
        );
        let mods = crate::mod_manager::ModManager::new(app_data.clone()).load_mods("rl");
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].name, "Scape and Run: Parasites");
        assert_eq!(mods[0].files, vec!["mods/SRParasites-1.12.2v1.9.11.jar"]);
        let origin = crate::content_provenance::get(&app_data, "rl", "mods/SRParasites-1.12.2v1.9.11.jar")
            .expect("provenance");
        assert_eq!((origin.provider.as_str(), origin.version_id.as_str()), ("curseforge", "4436467"));

        // Agreed to anyway: installed under its own name, without provenance
        // that would claim it is the pack's build.
        let outcome = add_blocked_file_by_hand(&app_data, "rl2", &blocked, &wrong, true).unwrap();
        assert_eq!(
            outcome,
            HandAddedFile::Installed {
                file_name: "SRParasites-1.10.9.jar".to_string(),
                exact: false
            }
        );
        assert!(crate::content_provenance::get(&app_data, "rl2", "mods/SRParasites-1.10.9.jar").is_none());

        // A file that is not a mod at all is refused.
        let text = downloads.join("readme.txt");
        fs::write(&text, b"hello").unwrap();
        assert!(add_blocked_file_by_hand(&app_data, "rl", &blocked, &text, true).is_err());
    }

    /// Against CurseForge itself: the 12 MB RLCraft zip that went around,
    /// held against the 51 MB release.
    #[tokio::test]
    #[ignore = "asks CurseForge"]
    async fn live_the_light_rlcraft_zip_is_told_apart_from_the_release() {
        let key = std::env::var("KIZAMODS_CURSEFORGE_API_KEY").expect("a key");
        let official = official_pack_if_lighter(&key, "RLCraft", "2.9.3", 12_706_834)
            .await
            .expect("the official pack");
        assert_eq!(official.project_id, 285109);
        assert_eq!(official.file_id, 4612979);
        assert!(official.official_bytes > 50_000_000);
        // The real thing is not lighter than itself.
        assert!(official_pack_if_lighter(&key, "RLCraft", "2.9.3", official.official_bytes)
            .await
            .is_none());
    }

    /// A whole CurseForge pack fetched into a scratch folder, timed: the
    /// batched metadata and the six-wide downloads against the real API.
    #[tokio::test]
    #[ignore = "downloads a pack from CurseForge"]
    async fn live_fetch_a_pack_into_scratch() {
        let key = std::env::var("KIZAMODS_CURSEFORGE_API_KEY").expect("a key");
        let archive = std::env::var("KIZA_PACK_ZIP").expect("KIZA_PACK_ZIP=<curseforge pack zip>");
        let temp = tempfile::tempdir().unwrap();
        let imported = import_instance_archive(temp.path(), Path::new(&archive), None).expect("imported");
        let client = reqwest::Client::new();
        let game_dir = minecraft_manager::instance_game_dir_path(temp.path(), &imported.result.instance_id);
        let started = std::time::Instant::now();
        let mut last = 0;
        let report = fetch_pack_files(temp.path(), &imported.result.instance_id, &key, &client, &imported.pending, &game_dir, |done, total, _| {
            if done / 20 != last / 20 {
                println!("{done}/{total} at {:.1}s", started.elapsed().as_secs_f32());
            }
            last = done;
        })
        .await;
        println!(
            "{} files: {} installed, {} blocked, {} failed in {:.1}s",
            imported.pending.len(),
            report.installed,
            report.blocked.len(),
            report.failed.len(),
            started.elapsed().as_secs_f32()
        );
        for failure in &report.failed {
            println!("  failed: {}", failure.reason);
        }
        assert!(report.installed > 0);
    }

    /// Half the size is missing files; a few percent is a different zipper.
    #[test]
    fn a_much_lighter_archive_is_one_with_files_missing() {
        assert!(is_much_lighter(12_706_834, 51_324_367));
        assert!(!is_much_lighter(50_000_000, 51_324_367));
        assert!(!is_much_lighter(51_324_367, 51_324_367));
        assert!(!is_much_lighter(0, 51_324_367));
        assert!(!is_much_lighter(40_000_000, 59_000_000));
        assert!(is_much_lighter(40_000_000, 61_000_000));
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
    fn neoforge_packs_are_accepted_and_quilt_is_refused_by_name() {
        let neoforge = HashMap::from([("neoforge".to_string(), "21.1.233".to_string())]);
        assert_eq!(
            modrinth_pack_loader(&neoforge).unwrap(),
            (MinecraftLoader::NeoForge, Some("21.1.233".to_string()))
        );
        let quilt = HashMap::from([("quilt-loader".to_string(), "0.26.0".to_string())]);
        assert!(modrinth_pack_loader(&quilt)
            .unwrap_err()
            .contains("Quilt"));
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
