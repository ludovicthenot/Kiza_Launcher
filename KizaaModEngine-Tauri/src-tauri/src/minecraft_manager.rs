use crate::base_mod::{self, StateBridgeSession};
use crate::config_manager::ConfigManager;
use crate::game_manager::{
    GameInstance, GameInstanceStatus, MinecraftInstanceConfig, MinecraftLoader,
};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MinecraftInstallStage {
    Idle,
    Preparing,
    DownloadingClient,
    DownloadingLibraries,
    DownloadingAssetIndex,
    DownloadingAssets,
    InstallingFabric,
    InstallingForge,
    InstallingBaseMod,
    Verifying,
    Done,
    Cancelled,
    Error,
}

impl MinecraftInstallStage {
    pub fn is_active(&self) -> bool {
        !matches!(
            self,
            Self::Idle | Self::Done | Self::Cancelled | Self::Error
        )
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftInstallStatus {
    pub stage: MinecraftInstallStage,
    pub completed: u64,
    pub total: u64,
    pub overall_completed: u64,
    pub overall_total: u64,
    pub bytes_downloaded: u64,
    pub bytes_total: Option<u64>,
    pub current_item: Option<String>,
    pub current_category: Option<String>,
    pub message: Option<String>,
    pub ready: bool,
}

impl MinecraftInstallStatus {
    pub fn idle() -> Self {
        Self {
            stage: MinecraftInstallStage::Idle,
            completed: 0,
            total: 0,
            overall_completed: 0,
            overall_total: 0,
            bytes_downloaded: 0,
            bytes_total: None,
            current_item: None,
            current_category: None,
            message: None,
            ready: false,
        }
    }

    // Keeping stage construction explicit makes every progress transition
    // auditable at the call site.
    #[allow(clippy::too_many_arguments)]
    fn stage(
        stage: MinecraftInstallStage,
        overall_completed: u64,
        overall_total: u64,
        completed: u64,
        total: u64,
        current_category: Option<String>,
        current_item: Option<String>,
        message: Option<String>,
    ) -> Self {
        Self {
            stage,
            completed,
            total,
            overall_completed,
            overall_total,
            bytes_downloaded: 0,
            bytes_total: None,
            current_item,
            current_category,
            message,
            ready: false,
        }
    }
}

#[derive(Clone)]
pub struct MinecraftInstallManager {
    statuses: Arc<Mutex<HashMap<String, MinecraftInstallStatus>>>,
}

impl MinecraftInstallManager {
    pub fn new() -> Self {
        Self {
            statuses: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_status(&self, instance_id: &str) -> MinecraftInstallStatus {
        self.statuses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(instance_id)
            .cloned()
            .unwrap_or_else(MinecraftInstallStatus::idle)
    }

    pub fn set_status(&self, instance_id: &str, status: MinecraftInstallStatus) {
        self.statuses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(instance_id.to_string(), status);
    }

    pub fn try_start(&self, instance_id: &str, overall_total: u64) -> Result<(), String> {
        let mut statuses = self
            .statuses
            .lock()
            .map_err(|_| "Minecraft install status lock is poisoned".to_string())?;
        if statuses
            .get(instance_id)
            .is_some_and(|status| status.stage.is_active())
        {
            return Err(
                "A Minecraft installation is already running for this instance.".to_string(),
            );
        }
        statuses.insert(
            instance_id.to_string(),
            MinecraftInstallStatus::stage(
                MinecraftInstallStage::Preparing,
                0,
                overall_total,
                0,
                0,
                Some("Installation plan".to_string()),
                None,
                Some("Preparing the Minecraft installation.".to_string()),
            ),
        );
        Ok(())
    }

    pub fn is_active(&self, instance_id: &str) -> bool {
        self.get_status(instance_id).stage.is_active()
    }

    // Progress updates intentionally carry both stage-local and overall
    // counters; bundling them would obscure the install timeline.
    #[allow(clippy::too_many_arguments)]
    fn begin_stage(
        &self,
        instance_id: &str,
        stage: MinecraftInstallStage,
        overall_completed: u64,
        overall_total: u64,
        completed: u64,
        total: u64,
        current_category: impl Into<String>,
        current_item: Option<String>,
        message: Option<String>,
    ) {
        self.set_status(
            instance_id,
            MinecraftInstallStatus::stage(
                stage,
                overall_completed,
                overall_total,
                completed,
                total,
                Some(current_category.into()),
                current_item,
                message,
            ),
        );
    }

    fn update_download(
        &self,
        instance_id: &str,
        current_category: &str,
        current_item: &str,
        bytes_downloaded: u64,
        bytes_total: Option<u64>,
    ) {
        let mut statuses = self
            .statuses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(status) = statuses.get_mut(instance_id) {
            status.current_category = Some(current_category.to_string());
            status.current_item = Some(current_item.to_string());
            status.bytes_downloaded = bytes_downloaded;
            status.bytes_total = bytes_total;
        }
    }

    fn update_counts(&self, instance_id: &str, completed: u64, total: u64) {
        let mut statuses = self
            .statuses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(status) = statuses.get_mut(instance_id) {
            status.completed = completed;
            status.total = total;
        }
    }

    pub fn set_error(&self, instance_id: &str, message: String) {
        let current = self.get_status(instance_id);
        self.set_status(
            instance_id,
            MinecraftInstallStatus {
                stage: MinecraftInstallStage::Error,
                message: Some(message),
                ready: false,
                ..current
            },
        );
    }
}

type DownloadProgressCallback = Arc<dyn Fn(u64, Option<u64>) + Send + Sync>;

#[derive(Clone, Copy)]
struct DownloadByteState {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Clone)]
struct DownloadBatchProgress {
    items: Arc<Mutex<HashMap<String, DownloadByteState>>>,
}

impl DownloadBatchProgress {
    fn new(items: impl IntoIterator<Item = (String, Option<u64>)>) -> Self {
        let items = items
            .into_iter()
            .map(|(key, total)| {
                (
                    key,
                    DownloadByteState {
                        downloaded: 0,
                        total,
                    },
                )
            })
            .collect();
        Self {
            items: Arc::new(Mutex::new(items)),
        }
    }

    fn record(&self, key: &str, downloaded: u64, total: Option<u64>) -> (u64, Option<u64>) {
        let mut items = self
            .items
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = items.entry(key.to_string()).or_insert(DownloadByteState {
            downloaded: 0,
            total: None,
        });
        entry.downloaded = downloaded;
        if total.is_some() {
            entry.total = total;
        }

        let downloaded = items.values().map(|item| item.downloaded).sum();
        let total = items
            .values()
            .map(|item| item.total)
            .collect::<Option<Vec<_>>>()
            .map(|totals| totals.into_iter().sum());
        (downloaded, total)
    }
}

fn tracked_download_callback(
    install_manager: MinecraftInstallManager,
    instance_id: String,
    batch: DownloadBatchProgress,
    key: String,
    category: String,
    item: String,
) -> DownloadProgressCallback {
    Arc::new(move |downloaded, total| {
        let (batch_downloaded, batch_total) = batch.record(&key, downloaded, total);
        install_manager.update_download(
            &instance_id,
            &category,
            &item,
            batch_downloaded,
            batch_total,
        );
    })
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LaunchPhase {
    Idle,
    Preparing,
    DownloadingJava,
    DownloadingGame,
    RepairingMods,
    Starting,
    Running,
    Crashed,
    Exited,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LaunchStatus {
    pub phase: LaunchPhase,
    pub message: Option<String>,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub log_path: Option<String>,
}

impl LaunchStatus {
    pub fn idle() -> Self {
        Self {
            phase: LaunchPhase::Idle,
            message: None,
            pid: None,
            exit_code: None,
            log_path: None,
        }
    }
}

#[derive(Clone)]
pub struct LaunchManager {
    statuses: Arc<Mutex<HashMap<String, LaunchStatus>>>,
}

impl LaunchManager {
    pub fn new() -> Self {
        Self {
            statuses: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get(&self, instance_id: &str) -> LaunchStatus {
        self.statuses
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(instance_id)
            .cloned()
            .unwrap_or_else(LaunchStatus::idle)
    }

    pub fn set(&self, instance_id: &str, status: LaunchStatus) {
        self.statuses
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(instance_id.to_string(), status);
    }

    pub fn set_phase(&self, instance_id: &str, phase: LaunchPhase, message: Option<String>) {
        let mut current = self.get(instance_id);
        current.phase = phase;
        current.message = message;
        self.set(instance_id, current);
    }
}

impl Default for LaunchManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftVersionList {
    pub versions: Vec<MinecraftVersionEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftVersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct MinecraftLoaderVersionEntry {
    pub version: String,
    pub stable: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangVersionInfo {
    pub id: String,
    #[serde(rename = "type", default)]
    pub version_type: Option<String>,
    #[serde(rename = "javaVersion", default)]
    pub java_version: Option<MojangJavaVersion>,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub arguments: Option<MojangArguments>,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments_legacy: Option<String>,
    pub libraries: Vec<MojangLibrary>,
    pub downloads: MojangDownloads,
    #[serde(rename = "assetIndex")]
    pub asset_index: MojangAssetIndex,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangJavaVersion {
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangDownloads {
    pub client: MojangDownload,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangDownload {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangAssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangArguments {
    pub game: Vec<serde_json::Value>,
    pub jvm: Vec<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangLibrary {
    pub name: String,
    pub downloads: Option<MojangLibraryDownloads>,
    pub rules: Option<Vec<MojangRule>>,
    pub natives: Option<HashMap<String, String>>,
    pub extract: Option<MojangExtract>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangExtract {
    pub exclude: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangRule {
    pub action: String,
    pub os: Option<MojangRuleOs>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangRuleOs {
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangLibraryDownloads {
    pub artifact: Option<MojangLibraryArtifact>,
    pub classifiers: Option<HashMap<String, MojangLibraryArtifact>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangLibraryArtifact {
    pub path: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangAssetIndexFile {
    pub objects: HashMap<String, MojangAssetObject>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct MojangAssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricLoaderMeta {
    pub loader: FabricLoaderInfo,
    pub intermediary: FabricIntermediaryInfo,
    #[serde(rename = "launcherMeta")]
    pub launcher_meta: FabricLauncherMeta,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricCompatibleLoaderVersion {
    pub loader: MinecraftLoaderVersionEntry,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricLoaderInfo {
    pub maven: String,
    pub version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricIntermediaryInfo {
    pub maven: String,
    pub version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricLauncherMeta {
    pub libraries: FabricLauncherLibraries,
    #[serde(rename = "mainClass")]
    pub main_class: FabricMainClass,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricLauncherLibraries {
    pub client: Vec<FabricMavenLibrary>,
    pub common: Vec<FabricMavenLibrary>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricMavenLibrary {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FabricMainClass {
    pub client: String,
    pub server: Option<String>,
}

pub fn minecraft_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("minecraft")
}

fn global_root(app_data_dir: &Path) -> PathBuf {
    minecraft_root(app_data_dir).join("global")
}

fn instances_root(app_data_dir: &Path) -> PathBuf {
    minecraft_root(app_data_dir).join("instances")
}

pub fn instance_game_dir(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instances_root(app_data_dir).join(instance_id).join("game")
}

fn instance_natives_dir(app_data_dir: &Path, instance_id: &str, version_id: &str) -> PathBuf {
    instances_root(app_data_dir)
        .join(instance_id)
        .join("natives")
        .join(version_id)
}

fn global_libraries_dir(app_data_dir: &Path) -> PathBuf {
    global_root(app_data_dir).join("libraries")
}

fn global_assets_dir(app_data_dir: &Path) -> PathBuf {
    global_root(app_data_dir).join("assets")
}

fn global_versions_dir(app_data_dir: &Path) -> PathBuf {
    global_root(app_data_dir).join("versions")
}

fn global_runtime_dir(app_data_dir: &Path) -> PathBuf {
    global_root(app_data_dir).join("runtimes")
}

fn runtime_dir(app_data_dir: &Path, java_major: u32) -> PathBuf {
    global_runtime_dir(app_data_dir).join(format!("temurin-{java_major}"))
}

fn instance_state_dir(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instances_root(app_data_dir).join(instance_id)
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

fn sha1_hex_of_file(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    hasher.update(&data);
    let digest = hasher.finalize();
    Ok(format!("{:x}", digest))
}

fn sha256_hex_of_file(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let digest = hasher.finalize();
    Ok(format!("{:x}", digest))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftRuntimeStatus {
    pub required_major: u32,
    pub java_path: Option<String>,
    pub source: String,
    pub installed: bool,
    pub valid: bool,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftPerformanceProfile {
    pub id: String,
    pub label: String,
    pub description: String,
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    pub jvm_args: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstancePerformanceProfile {
    pub instance_id: String,
    pub profile_id: String,
}

const DEFAULT_FABRIC_LOADER_VERSION: &str = "0.16.10";

fn parse_mc_version_parts(version: &str) -> (u32, u32, u32) {
    let clean = version
        .split('-')
        .next()
        .unwrap_or(version)
        .trim_start_matches("Minecraft ");
    let mut parts = clean.split('.').filter_map(|p| p.parse::<u32>().ok());
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

// Heuristic fallback only: the Mojang version JSON's javaVersion field is the
// authority (see required_java_major_for).
/// One Java version Kiza can manage, and whether it is here.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct JavaRuntimeEntry {
    pub major: u32,
    /// Which Minecraft releases this one covers, for a reader rather than a
    /// version comparison.
    pub covers: String,
    pub installed: bool,
    pub bytes: u64,
    /// Present but missing its java binary — the shape a cancelled download
    /// leaves behind.
    pub broken: bool,
}

/// Which Minecraft releases a given Java covers, for a reader rather than a
/// version comparison.
///
/// The inverse of `required_java_major`, written out. The majors themselves
/// come from the constant the installer already validates against, so this
/// page cannot offer to install one that would be refused.
fn java_covers(major: u32) -> &'static str {
    match major {
        8 => "Minecraft 1.7-1.16",
        17 => "Minecraft 1.17-1.20.4",
        21 => "Minecraft 1.20.5+",
        25 => "Recent snapshots",
        _ => "",
    }
}

fn directory_bytes(path: &Path) -> u64 {
    let Ok(read) = fs::read_dir(path) else {
        return 0;
    };
    read.flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => directory_bytes(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}

/// What is installed under `runtimes`, read from disk rather than remembered.
///
/// A runtime folder that exists without a java executable inside it is
/// reported as broken rather than as installed: that is what a cancelled
/// download leaves behind, and calling it installed means the next launch
/// fails with something far less obvious than "this one is broken".
pub fn list_java_runtimes(app_data_dir: &Path) -> Vec<JavaRuntimeEntry> {
    MANAGED_JAVA_MAJORS
        .into_iter()
        .map(|major| {
            let dir = runtime_dir(app_data_dir, major);
            let present = dir.is_dir();
            let usable = present && find_java_binary(&dir).is_some();
            JavaRuntimeEntry {
                major,
                covers: java_covers(major).to_string(),
                installed: usable,
                bytes: if present { directory_bytes(&dir) } else { 0 },
                broken: present && !usable,
            }
        })
        .collect()
}

/// Deletes one managed runtime.
///
/// Refuses anything outside the four Kiza provisions, so the interface cannot
/// name a path and have it removed.
pub fn remove_java_runtime(app_data_dir: &Path, java_major: u32) -> Result<u64, String> {
    if !MANAGED_JAVA_MAJORS.contains(&java_major) {
        return Err(format!("Kiza does not manage a Java {java_major}."));
    }

    let dir = runtime_dir(app_data_dir, java_major);
    if !dir.is_dir() {
        return Ok(0);
    }

    let freed = directory_bytes(&dir);
    fs::remove_dir_all(&dir)
        .map_err(|error| format!("Could not remove Java {java_major}: {error}"))?;
    Ok(freed)
}

pub fn required_java_major(mc_version: Option<&str>) -> u32 {
    let Some(version) = mc_version else {
        return 21;
    };
    let (major, minor, patch) = parse_mc_version_parts(version);
    if major >= 2 {
        // Year-based versions (26.x and later) require modern Java.
        25
    } else if major == 1 && (minor > 20 || (minor == 20 && patch >= 5)) {
        21
    } else if major == 1 && minor >= 17 {
        17
    } else {
        8
    }
}

/// Name Forge's `-DignoreList` needs so the vanilla jar stays off the module
/// path.
///
/// Forge 1.17.x ends that list with `${version_name}.jar` and matches it
/// against classpath *file names*. The jar is `<mc version>.jar`, so expanding
/// the placeholder to the Forge profile id (`1.17.1-forge-37.1.1`) matches
/// nothing: the game jar is then loaded a second time as an automatic module
/// and module resolution fails before the game window ever opens.
fn module_path_version_name(client_jar: &Path, fallback: &str) -> String {
    client_jar
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// Runtimes we can actually hand to the game, newest last.
const MANAGED_JAVA_MAJORS: [u32; 4] = [8, 17, 21, 25];

/// Snaps a version's declared Java to a runtime we can install, rounding up.
///
/// Minecraft 1.17.x declares Java 16, which Adoptium no longer publishes: the
/// managed download comes back empty and the instance can never start. Java 17
/// runs those versions fine, and rounding up is always the safe direction — an
/// older JVM cannot load newer class files, the reverse is fine.
fn provisionable_java_major(declared_major: u32) -> u32 {
    MANAGED_JAVA_MAJORS
        .into_iter()
        .find(|major| *major >= declared_major)
        .unwrap_or(declared_major)
}

fn required_java_major_for(info: &MojangVersionInfo, mc_version: &str) -> u32 {
    let declared = info
        .java_version
        .as_ref()
        .map(|java| java.major_version)
        .unwrap_or_else(|| required_java_major(Some(mc_version)));
    provisionable_java_major(declared)
}

pub fn validate_java_major_selection(java_major: Option<u32>) -> Result<(), String> {
    if java_major.is_none_or(|major| matches!(major, 8 | 17 | 21 | 25)) {
        return Ok(());
    }
    Err("Java selection must be Automatic, 8, 17, 21 or 25.".to_string())
}

fn effective_java_major(
    minecraft: &MinecraftInstanceConfig,
    declared_major: u32,
) -> Result<u32, String> {
    validate_java_major_selection(minecraft.java_major)?;
    if let Some(selected_major) = minecraft.java_major {
        if selected_major != declared_major {
            return Err(format!(
                "Minecraft {} requires Java {declared_major}, but this instance is configured for Java {selected_major}. Select Automatic or Java {declared_major}.",
                minecraft.mc_version
            ));
        }
    }
    Ok(declared_major)
}

fn find_java_binary(root: &Path) -> Option<PathBuf> {
    if root.is_file() {
        return Some(root.to_path_buf());
    }

    let names = if cfg!(windows) {
        ["javaw.exe", "java.exe"]
    } else {
        ["java", "java"]
    };

    for entry in walkdir::WalkDir::new(root)
        .max_depth(6)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if names.iter().any(|candidate| name == *candidate) {
            return Some(entry.path().to_path_buf());
        }
    }
    None
}

fn find_path_java() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let candidates = if cfg!(windows) {
        ["javaw.exe", "java.exe"]
    } else {
        ["java", "java"]
    };
    for dir in std::env::split_paths(&path_var) {
        for candidate in candidates {
            let path = dir.join(candidate);
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

pub fn detect_minecraft_runtime(
    app_data_dir: &Path,
    mc_version: Option<&str>,
) -> MinecraftRuntimeStatus {
    detect_minecraft_runtime_major(app_data_dir, required_java_major(mc_version))
}

pub fn detect_minecraft_runtime_major(
    app_data_dir: &Path,
    required_major: u32,
) -> MinecraftRuntimeStatus {
    let managed_dir = runtime_dir(app_data_dir, required_major);
    if let Some(path) = find_java_binary(&managed_dir) {
        return MinecraftRuntimeStatus {
            required_major,
            java_path: Some(path.to_string_lossy().to_string()),
            source: "managed".to_string(),
            installed: true,
            valid: true,
            message: format!("Managed Temurin Java {required_major} is ready."),
        };
    }

    let config = ConfigManager::new(app_data_dir.to_path_buf()).load_config();
    if let Some(java_path) = config.minecraft_java_path.filter(|p| !p.trim().is_empty()) {
        let path = PathBuf::from(&java_path);
        return MinecraftRuntimeStatus {
            required_major,
            java_path: Some(java_path),
            source: "configured".to_string(),
            installed: path.exists(),
            valid: path.exists(),
            message: if path.exists() {
                "Configured Java path exists.".to_string()
            } else {
                "Configured Java path does not exist.".to_string()
            },
        };
    }

    if let Some(path) = find_path_java() {
        return MinecraftRuntimeStatus {
            required_major,
            java_path: Some(path.to_string_lossy().to_string()),
            source: "path".to_string(),
            installed: true,
            valid: true,
            message: "Java was found on PATH.".to_string(),
        };
    }

    MinecraftRuntimeStatus {
        required_major,
        java_path: None,
        source: "missing".to_string(),
        installed: false,
        valid: false,
        message: format!("Java {required_major} is required and was not found."),
    }
}

pub fn system_total_memory_mb() -> Option<u32> {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total = sys.total_memory() / (1024 * 1024);
    if total == 0 {
        None
    } else {
        Some(total.min(u32::MAX as u64) as u32)
    }
}

// Lunar-style allocation: scale the heap with the machine instead of a fixed
// cap, while always leaving ~3 GB of headroom for the OS and the GPU driver.
fn tune_profile_memory(profile: &mut MinecraftPerformanceProfile, total_mb: u32) {
    let (share, floor, ceiling) = match profile.id.as_str() {
        "low_end" => (0.25, 512, 2048),
        "quality" => (0.50, 3072, 8192),
        _ => (0.35, 2048, 6144),
    };
    let budget = (total_mb as f64 * share) as u32;
    let headroom_cap = total_mb.saturating_sub(3072).max(floor);
    profile.max_memory_mb = budget
        .clamp(floor, ceiling)
        .min(headroom_cap)
        .max(profile.min_memory_mb);
}

pub fn get_performance_profiles() -> Vec<MinecraftPerformanceProfile> {
    let mut profiles = base_performance_profiles();
    if let Some(total_mb) = system_total_memory_mb() {
        for profile in &mut profiles {
            tune_profile_memory(profile, total_mb);
        }
    }
    profiles
}

fn base_performance_profiles() -> Vec<MinecraftPerformanceProfile> {
    vec![
        MinecraftPerformanceProfile {
            id: "low_end".to_string(),
            label: "Low End".to_string(),
            description: "Small RAM budget and conservative GC for lightweight setups.".to_string(),
            min_memory_mb: 512,
            max_memory_mb: 2048,
            jvm_args: vec![
                "-XX:+UseG1GC".to_string(),
                "-XX:+ParallelRefProcEnabled".to_string(),
                "-XX:MaxGCPauseMillis=80".to_string(),
                "-XX:+DisableExplicitGC".to_string(),
                "-XX:G1ReservePercent=20".to_string(),
                "-XX:+UseStringDeduplication".to_string(),
                "-Dfile.encoding=UTF-8".to_string(),
            ],
        },
        MinecraftPerformanceProfile {
            id: "balanced".to_string(),
            label: "Balanced".to_string(),
            description: "Default Kiza Alpha profile for stable FPS on most PCs.".to_string(),
            min_memory_mb: 1024,
            max_memory_mb: 4096,
            jvm_args: vec![
                "-XX:+UseG1GC".to_string(),
                "-XX:+ParallelRefProcEnabled".to_string(),
                "-XX:MaxGCPauseMillis=50".to_string(),
                "-XX:+UnlockExperimentalVMOptions".to_string(),
                "-XX:+DisableExplicitGC".to_string(),
                "-XX:G1NewSizePercent=20".to_string(),
                "-XX:G1ReservePercent=20".to_string(),
                "-XX:InitiatingHeapOccupancyPercent=15".to_string(),
                "-XX:+UseStringDeduplication".to_string(),
                "-Dfile.encoding=UTF-8".to_string(),
            ],
        },
        MinecraftPerformanceProfile {
            id: "quality".to_string(),
            label: "Quality".to_string(),
            description: "More memory for heavier mod lists and higher texture budgets."
                .to_string(),
            min_memory_mb: 2048,
            max_memory_mb: 6144,
            jvm_args: vec![
                "-XX:+UseG1GC".to_string(),
                "-XX:+ParallelRefProcEnabled".to_string(),
                "-XX:MaxGCPauseMillis=50".to_string(),
                "-XX:+UnlockExperimentalVMOptions".to_string(),
                "-XX:+DisableExplicitGC".to_string(),
                "-XX:G1NewSizePercent=20".to_string(),
                "-XX:G1ReservePercent=20".to_string(),
                "-XX:InitiatingHeapOccupancyPercent=15".to_string(),
                "-XX:+AlwaysPreTouch".to_string(),
                "-XX:+UseStringDeduplication".to_string(),
                "-Dfile.encoding=UTF-8".to_string(),
            ],
        },
    ]
}

fn performance_options(profile: &MinecraftPerformanceProfile) -> Vec<(&'static str, String)> {
    match profile.id.as_str() {
        "low_end" => vec![
            ("enableVsync", "false".to_string()),
            ("maxFps", "180".to_string()),
            ("graphicsMode", "fast".to_string()),
            ("clouds", "false".to_string()),
            ("renderDistance", "6".to_string()),
            ("simulationDistance", "4".to_string()),
            ("entityDistanceScaling", "0.5".to_string()),
            ("particles", "2".to_string()),
            ("biomeBlendRadius", "0".to_string()),
            ("mipmapLevels", "1".to_string()),
        ],
        "quality" => vec![
            ("enableVsync", "false".to_string()),
            ("maxFps", "260".to_string()),
            ("graphicsMode", "fast".to_string()),
            ("clouds", "false".to_string()),
            ("renderDistance", "12".to_string()),
            ("simulationDistance", "6".to_string()),
            ("entityDistanceScaling", "0.85".to_string()),
            ("particles", "1".to_string()),
            ("biomeBlendRadius", "1".to_string()),
            ("mipmapLevels", "2".to_string()),
        ],
        _ => vec![
            ("enableVsync", "false".to_string()),
            ("maxFps", "240".to_string()),
            ("graphicsMode", "fast".to_string()),
            ("clouds", "false".to_string()),
            ("renderDistance", "8".to_string()),
            ("simulationDistance", "5".to_string()),
            ("entityDistanceScaling", "0.75".to_string()),
            ("particles", "1".to_string()),
            ("biomeBlendRadius", "0".to_string()),
            ("mipmapLevels", "2".to_string()),
        ],
    }
}

fn write_performance_options(
    game_dir: &Path,
    profile: &MinecraftPerformanceProfile,
) -> Result<(), String> {
    ensure_dir(game_dir)?;
    let path = game_dir.join("options.txt");
    let mut options = std::collections::BTreeMap::<String, String>::new();

    if let Ok(content) = fs::read_to_string(&path) {
        for line in content.lines() {
            if let Some((key, value)) = line.split_once(':') {
                if !key.trim().is_empty() {
                    options.insert(key.to_string(), value.to_string());
                }
            }
        }
    }

    for (key, value) in performance_options(profile) {
        options.insert(key.to_string(), value);
    }

    let content = options
        .into_iter()
        .map(|(key, value)| format!("{key}:{value}"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{content}\n")).map_err(|e| e.to_string())
}

fn applied_options_marker_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instance_state_dir(app_data_dir, instance_id).join("applied_options_profile.txt")
}

// Only rewrite options.txt when the profile changed (or on first setup), so
// settings the player adjusts in-game survive future launches.
fn apply_performance_options_if_needed(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    profile: &MinecraftPerformanceProfile,
) -> Result<(), String> {
    let marker = applied_options_marker_path(app_data_dir, instance_id);
    let options_exist = game_dir.join("options.txt").exists();
    let applied_profile = fs::read_to_string(&marker)
        .ok()
        .map(|content| content.trim().to_string());
    if options_exist && applied_profile.as_deref() == Some(profile.id.as_str()) {
        return Ok(());
    }

    write_performance_options(game_dir, profile)?;
    if let Some(parent) = marker.parent() {
        ensure_dir(parent)?;
    }
    fs::write(marker, &profile.id).map_err(|e| e.to_string())
}

const KIZA_PACK_FILE: &str = "KizaClient.zip";
const KIZA_EDITION_PNG: &[u8] = include_bytes!("../assets/kiza-edition.png");
const KIZA_PACK_ICON_PNG: &[u8] = include_bytes!("../assets/kiza-pack-icon.png");
// The `kiza_base_mod` textures deliberately live in the mod jar only. Shipping
// them here too cost 2.4 MB per instance for nothing: that namespace is read
// only when the mod is loaded, and the jar already provides it.
const KIZA_BUTTON_PNG: &[u8] = include_bytes!("../assets/kiza-ui/button.png");
const KIZA_BUTTON_HIGHLIGHTED_PNG: &[u8] =
    include_bytes!("../assets/kiza-ui/button_highlighted.png");
const KIZA_BUTTON_DISABLED_PNG: &[u8] = include_bytes!("../assets/kiza-ui/button_disabled.png");
const KIZA_LEGACY_WIDGETS_PNG: &[u8] = include_bytes!("../assets/kiza-ui/widgets.png");
const KIZA_SPLASHES: &str =
    "Kiza Client!\nPowered by Kiza Launcher!\nYour instance, your mods!\nPlay your way!\nkiza.gg\n";

/// Reads the resource pack format the client jar expects (version.json is
/// bundled inside the jar). Handles both the modern object shape and the
/// legacy plain number.
fn client_jar_pack_format(client_jar: &Path) -> Option<(u32, u32)> {
    let file = fs::File::open(client_jar).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut entry = archive.by_name("version.json").ok()?;
    let mut content = String::new();
    std::io::Read::read_to_string(&mut entry, &mut content).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    let pack = value.get("pack_version")?;
    if let Some(number) = pack.as_u64() {
        return Some((number as u32, 0));
    }
    let major = pack
        .get("resource_major")
        .or_else(|| pack.get("resource"))
        .and_then(|v| v.as_u64())? as u32;
    let minor = pack
        .get("resource_minor")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    Some((major, minor))
}

/// Builds the Kiza branding resource pack (title screen "KIZA CLIENT" banner
/// + splash lines) in the instance's resourcepacks folder.
fn build_kiza_branding_pack(game_dir: &Path, pack_format: (u32, u32)) -> Result<(), String> {
    let packs_dir = game_dir.join("resourcepacks");
    ensure_dir(&packs_dir)?;
    let pack_path = packs_dir.join(KIZA_PACK_FILE);

    let file = fs::File::create(&pack_path).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    use std::io::Write;
    // pack_format satisfies pre-1.21 parsers; min/max_format is the modern
    // schema required once formats exceed 64. Unknown keys are ignored on
    // both sides, so emitting all three keeps the pack loadable everywhere.
    let (major, minor) = pack_format;
    let mcmeta = format!(
        "{{\"pack\":{{\"description\":\"Kiza Client branding\",\"pack_format\":{major},\"min_format\":[{major},{minor}],\"max_format\":{major}}}}}"
    );
    writer
        .start_file("pack.mcmeta", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(mcmeta.as_bytes())
        .map_err(|e| e.to_string())?;

    writer
        .start_file("pack.png", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(KIZA_PACK_ICON_PNG)
        .map_err(|e| e.to_string())?;

    writer
        .start_file("assets/minecraft/textures/gui/title/edition.png", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(KIZA_EDITION_PNG)
        .map_err(|e| e.to_string())?;

    for (name, bytes) in [
        ("button.png", KIZA_BUTTON_PNG),
        ("button_highlighted.png", KIZA_BUTTON_HIGHLIGHTED_PNG),
        ("button_disabled.png", KIZA_BUTTON_DISABLED_PNG),
    ] {
        writer
            .start_file(
                format!("assets/minecraft/textures/gui/sprites/widget/{name}"),
                options,
            )
            .map_err(|e| e.to_string())?;
        writer.write_all(bytes).map_err(|e| e.to_string())?;
    }

    writer
        .start_file("assets/minecraft/textures/gui/widgets.png", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(KIZA_LEGACY_WIDGETS_PNG)
        .map_err(|e| e.to_string())?;

    writer
        .start_file("assets/minecraft/texts/splashes.txt", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(KIZA_SPLASHES.as_bytes())
        .map_err(|e| e.to_string())?;

    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Ensures the Kiza pack is enabled in options.txt without touching the rest
/// of the user's resource pack selection.
fn enable_kiza_pack_in_options(game_dir: &Path) -> Result<(), String> {
    let path = game_dir.join("options.txt");
    let content = fs::read_to_string(&path).unwrap_or_default();
    let pack_entry = format!("\"file/{KIZA_PACK_FILE}\"");

    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let mut found_key = false;
    for line in &mut lines {
        if let Some(value) = line.strip_prefix("resourcePacks:") {
            found_key = true;
            if !value.contains(&pack_entry) {
                let mut packs: Vec<String> = serde_json::from_str(value).unwrap_or_default();
                packs.retain(|p| p != &format!("file/{KIZA_PACK_FILE}"));
                packs.push(format!("file/{KIZA_PACK_FILE}"));
                *line = format!(
                    "resourcePacks:{}",
                    serde_json::to_string(&packs).map_err(|e| e.to_string())?
                );
            }
        }
    }
    if !found_key {
        lines.push(format!(
            "resourcePacks:[\"vanilla\",\"fabric\",{pack_entry}]"
        ));
    }
    fs::write(&path, format!("{}\n", lines.join("\n"))).map_err(|e| e.to_string())
}

/// Marks the launcher-managed Java binary as "high performance" in Windows
/// graphics settings so laptops with hybrid graphics run the game on the
/// dedicated GPU instead of the integrated one.
#[cfg(windows)]
fn prefer_dedicated_gpu(java_path: &str) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if !Path::new(java_path).is_absolute() {
        return;
    }
    let _ = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\DirectX\UserGpuPreferences",
            "/v",
            java_path,
            "/t",
            "REG_SZ",
            "/d",
            "GpuPreference=2;",
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn prefer_dedicated_gpu(_java_path: &str) {}

pub async fn list_fabric_loader_versions(
    mc_version: &str,
) -> Result<Vec<MinecraftLoaderVersionEntry>, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|error| format!("Fabric: failed to create HTTP client: {error}"))?;
    let mut url = reqwest::Url::parse("https://meta.fabricmc.net/v2/versions/loader/")
        .map_err(|error| format!("Fabric: invalid metadata URL: {error}"))?;
    url.path_segments_mut()
        .map_err(|_| "Fabric: metadata URL cannot accept a Minecraft version.".to_string())?
        .push(mc_version);
    let response =
        client.get(url).send().await.map_err(|error| {
            format!("Fabric: failed to fetch compatible loader versions: {error}")
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Fabric: compatible loader request returned HTTP {}.",
            response.status()
        ));
    }
    let compatible = response
        .json::<Vec<FabricCompatibleLoaderVersion>>()
        .await
        .map_err(|error| format!("Fabric: invalid compatible loader response: {error}"))?;
    let mut versions = Vec::new();
    for item in compatible {
        if !versions
            .iter()
            .any(|entry: &MinecraftLoaderVersionEntry| entry.version == item.loader.version)
        {
            versions.push(item.loader);
        }
    }
    if versions.is_empty() {
        return Err(format!(
            "Fabric: no compatible loader is published for Minecraft {mc_version}."
        ));
    }
    Ok(versions)
}

pub async fn resolve_fabric_loader_version(
    mc_version: &str,
    requested: Option<&str>,
) -> Result<String, String> {
    let versions = list_fabric_loader_versions(mc_version).await?;
    let requested = requested.map(str::trim).filter(|value| !value.is_empty());
    if let Some(requested) = requested.filter(|value| !value.eq_ignore_ascii_case("latest")) {
        return versions
            .into_iter()
            .find(|entry| entry.version == requested)
            .map(|entry| entry.version)
            .ok_or_else(|| {
                format!("Fabric {requested} is not compatible with Minecraft {mc_version}.")
            });
    }
    versions
        .iter()
        .find(|entry| entry.stable)
        .or_else(|| versions.first())
        .map(|entry| entry.version.clone())
        .ok_or_else(|| format!("Fabric: no compatible loader found for Minecraft {mc_version}."))
}

pub async fn prepare_minecraft_loader(
    app_data_dir: &Path,
    mut instance: GameInstance,
) -> Result<GameInstance, String> {
    let Some(mc) = instance.minecraft.as_mut() else {
        return Err("Not a Minecraft instance".to_string());
    };

    let mut changed = false;
    match mc.loader {
        MinecraftLoader::Vanilla => {
            if mc.loader_version.take().is_some() {
                changed = true;
            }
        }
        MinecraftLoader::Fabric => {
            let resolved_loader =
                resolve_fabric_loader_version(&mc.mc_version, mc.loader_version.as_deref()).await?;
            if mc.loader_version.as_deref() != Some(resolved_loader.as_str()) {
                mc.loader_version = Some(resolved_loader);
                changed = true;
            }
        }
        MinecraftLoader::Forge | MinecraftLoader::NeoForge => {
            let family = mc
                .loader
                .installer_family()
                .ok_or_else(|| "This loader has no installer.".to_string())?;
            let needs_resolution = mc
                .loader_version
                .as_deref()
                .map(str::trim)
                .is_none_or(|version| version.is_empty() || version.eq_ignore_ascii_case("latest"));
            if needs_resolution {
                let client = reqwest::Client::builder()
                    .user_agent("KizaLauncherAlpha/0.1")
                    .build()
                    .map_err(|error| format!("Failed to create HTTP client: {error}"))?;
                let resolved = crate::forge::resolve_version(
                    app_data_dir,
                    family,
                    &client,
                    &mc.mc_version,
                    mc.loader_version.as_deref(),
                )
                .await?;
                mc.loader_version = Some(resolved);
                changed = true;
            }
        }
    }

    if changed {
        save_instance_config(app_data_dir, &instance)?;
    }

    Ok(instance)
}

fn instance_profile_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instance_state_dir(app_data_dir, instance_id).join("performance_profile.json")
}

pub fn load_instance_performance_profile(
    app_data_dir: &Path,
    instance_id: &str,
) -> InstancePerformanceProfile {
    let path = instance_profile_path(app_data_dir, instance_id);
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(profile) = serde_json::from_str::<InstancePerformanceProfile>(&content) {
            if !profile.profile_id.trim().is_empty() {
                return profile;
            }
        }
    }

    // Instances without an explicit choice inherit the profile picked during
    // first-run setup instead of silently falling back to Balanced.
    let setup_profile =
        crate::setup_manager::load_setup_state(app_data_dir).selected_performance_profile;
    let profile_id = if get_performance_profiles()
        .iter()
        .any(|profile| profile.id == setup_profile)
    {
        setup_profile
    } else {
        "balanced".to_string()
    };
    InstancePerformanceProfile {
        instance_id: instance_id.to_string(),
        profile_id,
    }
}

pub fn save_instance_performance_profile(
    app_data_dir: &Path,
    instance_id: &str,
    profile_id: &str,
) -> Result<InstancePerformanceProfile, String> {
    let valid = get_performance_profiles()
        .iter()
        .any(|profile| profile.id == profile_id);
    if !valid {
        return Err("Unknown performance profile".to_string());
    }

    let profile = InstancePerformanceProfile {
        instance_id: instance_id.to_string(),
        profile_id: profile_id.to_string(),
    };
    let path = instance_profile_path(app_data_dir, instance_id);
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let content = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(profile)
}

/// Strips the Minecraft version from a loader version for the pack manifest.
///
/// Legacy Forge builds are stored as `11.15.1.2318-1.8.9` (and occasionally
/// `1.8.9-11.15.1.2318`), but a CurseForge manifest expects the loader version
/// alone - `forge-11.15.1.2318-1.8.9` is rejected as an unsupported mod loader.
pub(crate) fn manifest_loader_version(loader_version: &str, mc_version: &str) -> String {
    let trimmed = loader_version.trim();
    if let Some(stripped) = trimmed.strip_suffix(&format!("-{mc_version}")) {
        return stripped.to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix(&format!("{mc_version}-")) {
        return stripped.to_string();
    }
    trimmed.to_string()
}

/// Per-instance launch overrides (Java, RAM, JVM args). Empty fields inherit
/// the global settings / auto behaviour.
#[derive(serde::Serialize, serde::Deserialize, Clone, Default, Debug)]
pub struct InstanceSettings {
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub min_memory_mb: Option<u32>,
    #[serde(default)]
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub extra_args: Option<String>,
}

fn instance_settings_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instance_state_dir(app_data_dir, instance_id).join("settings.json")
}

pub fn load_instance_settings(app_data_dir: &Path, instance_id: &str) -> InstanceSettings {
    fs::read_to_string(instance_settings_path(app_data_dir, instance_id))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_instance_settings(
    app_data_dir: &Path,
    instance_id: &str,
    settings: InstanceSettings,
) -> Result<InstanceSettings, String> {
    let path = instance_settings_path(app_data_dir, instance_id);
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(settings)
}

/// Global config with this instance's overrides applied (instance wins where set).
fn effective_config(
    base: &crate::config_manager::AppConfig,
    settings: &InstanceSettings,
) -> crate::config_manager::AppConfig {
    let mut config = base.clone();
    if settings.java_path.is_some() {
        config.minecraft_java_path = settings.java_path.clone();
    }
    if settings.min_memory_mb.is_some() {
        config.minecraft_min_memory_mb = settings.min_memory_mb;
    }
    if settings.max_memory_mb.is_some() {
        config.minecraft_max_memory_mb = settings.max_memory_mb;
    }
    if settings.extra_args.is_some() {
        config.minecraft_extra_args = settings.extra_args.clone();
    }
    config
}

fn resolve_profile(app_data_dir: &Path, instance_id: &str) -> MinecraftPerformanceProfile {
    let saved = load_instance_performance_profile(app_data_dir, instance_id);
    get_performance_profiles()
        .into_iter()
        .find(|profile| profile.id == saved.profile_id)
        .unwrap_or_else(|| {
            get_performance_profiles()
                .into_iter()
                .find(|profile| profile.id == "balanced")
                .expect("balanced profile exists")
        })
}

fn build_java_args(
    profile: &MinecraftPerformanceProfile,
    config: &crate::config_manager::AppConfig,
) -> Vec<String> {
    // Settings overrides win over the profile; empty settings mean "auto"
    // (profile values tuned to the machine's RAM).
    let max_mb = config
        .minecraft_max_memory_mb
        .filter(|mb| *mb >= 512)
        .unwrap_or(profile.max_memory_mb);
    let mut min_mb = config
        .minecraft_min_memory_mb
        .filter(|mb| *mb >= 256)
        .unwrap_or(profile.min_memory_mb);
    if min_mb > max_mb {
        min_mb = max_mb;
    }
    let mut args = vec![format!("-Xms{min_mb}M"), format!("-Xmx{max_mb}M")];
    args.extend(profile.jvm_args.clone());
    if let Some(extra) = config
        .minecraft_extra_args
        .as_deref()
        .map(str::trim)
        .filter(|extra| !extra.is_empty())
    {
        args.extend(extra.split_whitespace().map(str::to_string));
    }
    args
}

/// The JVM arguments this instance would be launched with right now.
///
/// The Performance Advisor reports on the arguments the game actually gets, not
/// on the settings that were meant to produce them: a per-instance override, the
/// performance profile and the user's own extra arguments all land in the same
/// list, and only the assembled list says what is in force.
pub fn effective_java_args(app_data_dir: &Path, instance_id: &str) -> Vec<String> {
    let profile = resolve_profile(app_data_dir, instance_id);
    let settings = load_instance_settings(app_data_dir, instance_id);
    let config = effective_config(
        &ConfigManager::new(app_data_dir.to_path_buf()).load_config(),
        &settings,
    );
    build_java_args(&profile, &config)
}

/// The Java major this Minecraft version declares it needs, read from the
/// version JSON already on disk. None when the version has never been installed,
/// in which case there is nothing to advise about yet.
pub fn declared_java_major(app_data_dir: &Path, mc_version: &str) -> Option<u32> {
    local_version_info(app_data_dir, mc_version)
        .map(|info| required_java_major_for(&info, mc_version))
}

/// Locates an asset in an index by the end of its name.
///
/// Index keys carry a `minecraft/` prefix in some versions and not in others,
/// and matching the whole key would silently find nothing on one of the two
/// families — which looks exactly like "this version has no artwork".
fn find_asset<'a>(
    objects: &'a HashMap<String, MojangAssetObject>,
    wanted_suffix: &str,
) -> Option<&'a MojangAssetObject> {
    objects
        .iter()
        .find(|(name, _)| name.ends_with(wanted_suffix))
        .map(|(_, object)| object)
}

/// Picks one asset out of an already-downloaded version and returns its bytes.
///
/// Assets are content-addressed, and the index is the only thing that maps a
/// name to a hash. Both are already on disk once a version is installed, so
/// nothing is fetched here.
///
/// `wanted_suffix` is matched on the end of the asset's name because index keys
/// have carried a `minecraft/` prefix in some versions and not others.
pub fn read_version_asset(
    app_data_dir: &Path,
    mc_version: &str,
    wanted_suffix: &str,
) -> Option<Vec<u8>> {
    let info = local_version_info(app_data_dir, mc_version)?;
    let index_path = global_assets_dir(app_data_dir)
        .join("indexes")
        .join(format!("{}.json", info.asset_index.id));
    let index: MojangAssetIndexFile =
        serde_json::from_str(&fs::read_to_string(index_path).ok()?).ok()?;

    let object = find_asset(&index.objects, wanted_suffix)?;

    let path = global_assets_dir(app_data_dir)
        .join("objects")
        .join(asset_hash_prefix(&object.hash).ok()?)
        .join(&object.hash);
    fs::read(path).ok()
}

pub(crate) async fn download_to_path(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
) -> Result<(), String> {
    download_to_path_with_progress(client, url, dest, expected_sha1, None, None).await
}

async fn download_to_path_with_progress(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
    expected_size: Option<u64>,
    progress: Option<DownloadProgressCallback>,
) -> Result<(), String> {
    if dest.exists() {
        if let Some(expected) = expected_sha1 {
            if let Ok(actual) = sha1_hex_of_file(dest) {
                if actual.eq_ignore_ascii_case(expected) {
                    if let Some(progress) = progress.as_ref() {
                        let size = fs::metadata(dest)
                            .map(|metadata| metadata.len())
                            .unwrap_or(0);
                        progress(size, expected_size.or(Some(size)));
                    }
                    return Ok(());
                }
            }
        } else {
            if let Some(progress) = progress.as_ref() {
                let size = fs::metadata(dest)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                progress(size, expected_size.or(Some(size)));
            }
            return Ok(());
        }
    }

    if let Some(parent) = dest.parent() {
        ensure_dir(parent)?;
    }

    let mut last_error = String::new();
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(400 * attempt)).await;
        }
        match download_attempt(
            client,
            url,
            dest,
            expected_sha1,
            expected_size,
            progress.clone(),
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

async fn download_attempt(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
    expected_size: Option<u64>,
    progress: Option<DownloadProgressCallback>,
) -> Result<(), String> {
    // Unique temp name so two concurrent downloads of the same file (e.g.
    // install and launch running at once) cannot clobber each other's temp.
    let tmp = dest.with_extension(format!("{}.tmp", Uuid::new_v4().simple()));
    let result = download_attempt_to_tmp(
        client,
        url,
        &tmp,
        dest,
        expected_sha1,
        expected_size,
        progress,
    )
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    result
}

async fn download_attempt_to_tmp(
    client: &reqwest::Client,
    url: &str,
    tmp: &Path,
    dest: &Path,
    expected_sha1: Option<&str>,
    expected_size: Option<u64>,
    progress: Option<DownloadProgressCallback>,
) -> Result<(), String> {
    let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url));
    }
    let mut file = tokio::fs::File::create(tmp)
        .await
        .map_err(|e| e.to_string())?;
    use tokio::io::AsyncWriteExt;
    let total = resp.content_length().or(expected_size);
    let mut downloaded = 0u64;
    if let Some(progress) = progress.as_ref() {
        progress(0, total);
    }
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if let Some(progress) = progress.as_ref() {
            progress(downloaded, total);
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(tmp, dest)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(expected) = expected_sha1 {
        let actual = sha1_hex_of_file(dest)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(format!("SHA1 mismatch for {}", dest.to_string_lossy()));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct AdoptiumAsset {
    binary: AdoptiumBinary,
}

#[derive(Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(Deserialize)]
struct AdoptiumPackage {
    link: String,
    name: Option<String>,
    checksum: Option<String>,
}

fn unzip_runtime(zip_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    ensure_dir(target_dir)?;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };
        let out_path = target_dir.join(enclosed);

        if file.is_dir() {
            ensure_dir(&out_path)?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            ensure_dir(parent)?;
        }
        let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn install_minecraft_runtime(
    app_data_dir: &Path,
    java_major: u32,
) -> Result<MinecraftRuntimeStatus, String> {
    if !(8..=99).contains(&java_major) {
        return Err(format!("Unsupported Java major version: {java_major}"));
    }

    let target_dir = runtime_dir(app_data_dir, java_major);
    if let Some(path) = find_java_binary(&target_dir) {
        return Ok(MinecraftRuntimeStatus {
            required_major: java_major,
            java_path: Some(path.to_string_lossy().to_string()),
            source: "managed".to_string(),
            installed: true,
            valid: true,
            message: format!("Managed Temurin Java {java_major} is already installed."),
        });
    }

    ensure_dir(&target_dir)?;
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.adoptium.net/v3/assets/latest/{java_major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse");
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Adoptium HTTP {}", resp.status()));
    }
    let assets = resp
        .json::<Vec<AdoptiumAsset>>()
        .await
        .map_err(|e| e.to_string())?;
    let package = assets
        .first()
        .map(|asset| &asset.binary.package)
        .ok_or("No Temurin JRE asset found".to_string())?;
    let file_name = package
        .name
        .clone()
        .unwrap_or_else(|| format!("temurin-jre-{java_major}.zip"));
    let archive_path = global_runtime_dir(app_data_dir).join(file_name);

    download_to_path(&client, &package.link, &archive_path, None).await?;
    if let Some(expected) = &package.checksum {
        let actual = sha256_hex_of_file(&archive_path)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = fs::remove_file(&archive_path);
            return Err("Managed Java checksum mismatch".to_string());
        }
    }

    unzip_runtime(&archive_path, &target_dir)?;
    let _ = fs::remove_file(&archive_path);

    find_java_binary(&target_dir)
        .map(|java_path| MinecraftRuntimeStatus {
            required_major: java_major,
            java_path: Some(java_path.to_string_lossy().to_string()),
            source: "managed".to_string(),
            installed: true,
            valid: true,
            message: format!("Managed Temurin Java {java_major} installed."),
        })
        .ok_or("Temurin JRE was extracted but no Java binary was found.".to_string())
}

/// Libraries listed by old version manifests that Mojang no longer serves.
///
/// 1.7 and 1.8 reference the Twitch streaming integration, a feature that was
/// removed from the game years ago; the files 404 on Mojang's CDN. Treating
/// them as required makes those versions impossible to install, so they are
/// skipped when downloading and when verifying.
fn is_retired_library(name: &str) -> bool {
    name.starts_with("tv.twitch:")
}

fn rules_allow_on_windows(rules: &Option<Vec<MojangRule>>) -> bool {
    let Some(rules) = rules else {
        return true;
    };
    let mut allowed = false;
    for rule in rules {
        let os_ok = rule
            .os
            .as_ref()
            .and_then(|o| o.name.as_ref())
            .map(|n| n == "windows")
            .unwrap_or(true);
        if !os_ok {
            continue;
        }
        if rule.action == "allow" {
            allowed = true;
        } else if rule.action == "disallow" {
            allowed = false;
        }
    }
    allowed
}

/// Maven jar paths look like `.../<group>/<artifact>/<version>/<artifact>-<version>.jar`.
/// Returns (artifact directory as key, version) so duplicates of the same
/// artifact at different versions can be collapsed.
fn maven_artifact_key(path: &Path) -> Option<(String, String)> {
    let file_name = path.file_name()?.to_string_lossy().to_string();
    let version_dir = path.parent()?;
    let artifact_dir = version_dir.parent()?;
    let version = version_dir.file_name()?.to_string_lossy().to_string();
    let artifact = artifact_dir.file_name()?.to_string_lossy().to_string();

    // The classifier ("-natives-windows", ...) makes a distinct artifact:
    // lwjgl-vma-3.3.3.jar and lwjgl-vma-3.3.3-natives-windows.jar must BOTH
    // stay on the classpath. Only same-artifact same-classifier duplicates
    // at different versions collapse.
    let stem = file_name.strip_suffix(".jar").unwrap_or(&file_name);
    let classifier = stem
        .strip_prefix(&format!("{artifact}-{version}"))
        .unwrap_or("")
        .to_lowercase();

    let key = format!(
        "{}|{classifier}",
        artifact_dir.to_string_lossy().to_lowercase()
    );
    Some((key, version))
}

/// Numeric-aware "a >= b" for maven version strings (9.7.1 >= 9.6).
fn version_ge(a: &str, b: &str) -> bool {
    let seg = |s: &str| {
        s.split(|c: char| !c.is_ascii_digit())
            .filter_map(|x| x.parse::<u64>().ok())
            .collect::<Vec<_>>()
    };
    let (va, vb) = (seg(a), seg(b));
    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    true
}

/// Collapses duplicate maven artifacts on the classpath, keeping the highest
/// version. Fixes Fabric's "duplicate ASM classes found on classpath" crash
/// when vanilla and Fabric both ship a copy of a library (e.g. ASM).
fn dedupe_classpath(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut chosen: HashMap<String, (String, usize)> = HashMap::new();
    let mut result: Vec<PathBuf> = Vec::new();
    for path in paths {
        match maven_artifact_key(&path) {
            Some((key, version)) => {
                if let Some((existing_version, idx)) = chosen.get(&key).cloned() {
                    if version_ge(&version, &existing_version) {
                        result[idx] = path;
                        chosen.insert(key, (version, idx));
                    }
                    // Otherwise drop this lower-versioned duplicate.
                } else {
                    let idx = result.len();
                    result.push(path);
                    chosen.insert(key, (version, idx));
                }
            }
            None => result.push(path),
        }
    }
    result
}

fn maven_coord_to_jar_path(coord: &str) -> Result<(String, String, String), String> {
    let parts: Vec<&str> = coord.split(':').collect();
    if parts.len() < 3 {
        return Err("Invalid maven coordinate".to_string());
    }
    let group = parts[0];
    let artifact = parts[1];
    let version = parts[2];
    let group_path = group.replace('.', "/");
    let rel = format!(
        "{}/{}/{}/{}-{}.jar",
        group_path, artifact, version, artifact, version
    );
    Ok((group.to_string(), artifact.to_string(), rel))
}

fn save_instance_config(app_data_dir: &Path, instance: &GameInstance) -> Result<(), String> {
    let dir = app_data_dir.join("games");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", instance.id));
    let content = serde_json::to_string_pretty(instance).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn create_minecraft_instance(
    app_data_dir: &Path,
    display_name: String,
    mc_version: String,
    loader: MinecraftLoader,
    loader_version: Option<String>,
    java_major: Option<u32>,
) -> Result<GameInstance, String> {
    validate_java_major_selection(java_major)?;
    let loader_version = match loader {
        MinecraftLoader::Fabric => Some(
            loader_version
                .filter(|version| !version.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_FABRIC_LOADER_VERSION.to_string()),
        ),
        MinecraftLoader::Forge | MinecraftLoader::NeoForge => Some(
            loader_version
                .filter(|version| !version.trim().is_empty())
                .ok_or_else(|| {
                    format!(
                        "{} loader version must be resolved before creation.",
                        loader.display_name()
                    )
                })?,
        ),
        MinecraftLoader::Vanilla => None,
    };

    let instance_id = Uuid::new_v4().to_string();
    let game_dir = instance_game_dir(app_data_dir, &instance_id);
    ensure_dir(&game_dir)?;
    ensure_dir(&game_dir.join("mods"))?;
    ensure_dir(&game_dir.join("config"))?;
    ensure_dir(&game_dir.join("resourcepacks"))?;
    ensure_dir(&game_dir.join("shaderpacks"))?;

    let config = GameInstance {
        schema_version: 1,
        id: instance_id.clone(),
        game_id: "minecraft".to_string(),
        display_name,
        install_path: game_dir.to_string_lossy().to_string(),
        executable_path: "".to_string(),
        mods_path: app_data_dir
            .join("mods")
            .join(&instance_id)
            .to_string_lossy()
            .to_string(),
        detected_variant: Some("Managed".to_string()),
        minecraft: Some(MinecraftInstanceConfig {
            mc_version,
            loader,
            loader_version,
            java_major,
        }),
        status: GameInstanceStatus::Valid,
        created_at: chrono::Local::now().to_rfc3339(),
        last_verified_at: Some(chrono::Local::now().to_rfc3339()),
    };

    save_instance_config(app_data_dir, &config)?;
    Ok(config)
}

pub fn rename_minecraft_instance(
    app_data_dir: &Path,
    instance_id: &str,
    display_name: &str,
) -> Result<GameInstance, String> {
    let name = display_name.trim();
    if name.is_empty() {
        return Err("Instance name cannot be empty.".to_string());
    }
    let mut instance = load_instance(app_data_dir, instance_id)?;
    instance.display_name = name.to_string();
    save_instance_config(app_data_dir, &instance)?;
    Ok(instance)
}

/// Changes the Minecraft version of an instance and clears derived options so
/// the next install or launch applies settings matching the new version.
pub fn set_minecraft_instance_version(
    app_data_dir: &Path,
    instance_id: &str,
    mc_version: &str,
) -> Result<GameInstance, String> {
    let version = mc_version.trim();
    if version.is_empty() {
        return Err("Minecraft version cannot be empty.".to_string());
    }
    let mut instance = load_instance(app_data_dir, instance_id)?;
    let Some(mc) = instance.minecraft.as_mut() else {
        return Err("Not a Minecraft instance".to_string());
    };
    if mc.mc_version == version {
        return Ok(instance);
    }
    mc.mc_version = version.to_string();
    if mc.loader != MinecraftLoader::Vanilla {
        mc.loader_version = Some("latest".to_string());
    }
    mc.java_major = None;
    instance.status = GameInstanceStatus::Valid;
    instance.last_verified_at = Some(chrono::Local::now().to_rfc3339());
    clear_install_receipt(app_data_dir, instance_id)?;
    save_instance_config(app_data_dir, &instance)?;

    // Keep a legacy optimization manifest until the next install/launch: it
    // is the ownership proof used to remove old Kiza-managed JARs safely.
    let _ = fs::remove_file(applied_options_marker_path(app_data_dir, instance_id));
    Ok(instance)
}

pub fn set_minecraft_instance_java(
    app_data_dir: &Path,
    instance_id: &str,
    java_major: Option<u32>,
) -> Result<GameInstance, String> {
    validate_java_major_selection(java_major)?;
    let mut instance = load_instance(app_data_dir, instance_id)?;
    let Some(mc) = instance.minecraft.as_mut() else {
        return Err("Not a Minecraft instance".to_string());
    };
    let required_major = required_java_major(Some(&mc.mc_version));
    if java_major.is_some_and(|selected| selected != required_major) {
        return Err(format!(
            "Minecraft {} requires Java {required_major}.",
            mc.mc_version
        ));
    }
    mc.java_major = java_major;
    save_instance_config(app_data_dir, &instance)?;
    Ok(instance)
}

fn load_instance(app_data_dir: &Path, instance_id: &str) -> Result<GameInstance, String> {
    let path = app_data_dir
        .join("games")
        .join(format!("{instance_id}.json"));
    let content = fs::read_to_string(path).map_err(|_| "Instance not found".to_string())?;
    serde_json::from_str::<GameInstance>(&content).map_err(|e| e.to_string())
}

/// Deletes an instance and every folder it owns. Refuses if the game is
/// currently running (checked by the caller).
pub fn delete_minecraft_instance(app_data_dir: &Path, instance_id: &str) -> Result<(), String> {
    // Config file
    let config_path = app_data_dir
        .join("games")
        .join(format!("{instance_id}.json"));
    let _ = fs::remove_file(&config_path);

    // Per-instance data: game/, natives/, performance profile and migration
    // markers all live under instances/{id}.
    let state_dir = instance_state_dir(app_data_dir, instance_id);
    if state_dir.exists() {
        fs::remove_dir_all(&state_dir).map_err(|e| e.to_string())?;
    }

    // Managed mods staging folder.
    let mods_dir = app_data_dir.join("mods").join(instance_id);
    if mods_dir.exists() {
        let _ = fs::remove_dir_all(&mods_dir);
    }
    Ok(())
}

/// Absolute path to the instance game directory, for "open folder".
pub fn instance_game_dir_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instance_game_dir(app_data_dir, instance_id)
}

#[derive(Deserialize)]
struct LegacyOptimizationPackManifest {
    #[serde(default)]
    files: Vec<LegacyOptimizationPackFile>,
}

#[derive(Deserialize)]
struct LegacyOptimizationPackFile {
    file_name: String,
    sha1: Option<String>,
}

fn optimization_manifest_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instance_state_dir(app_data_dir, instance_id).join("optimization_pack.json")
}

/// Removes only files that can still be proven to have been installed by the
/// retired Kiza optimization pack. User-replaced files and unknown mods stay.
fn remove_legacy_optimization_pack(
    app_data_dir: &Path,
    instance: &GameInstance,
) -> Result<usize, String> {
    let manifest_path = optimization_manifest_path(app_data_dir, &instance.id);
    let content = match fs::read_to_string(&manifest_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };
    let manifest = match serde_json::from_str::<LegacyOptimizationPackManifest>(&content) {
        Ok(manifest) => manifest,
        Err(_) => {
            // A corrupt manifest cannot prove ownership. Drop only the marker
            // and leave every mod file untouched.
            fs::remove_file(&manifest_path).map_err(|error| error.to_string())?;
            return Ok(0);
        }
    };

    let mods_dir = PathBuf::from(&instance.install_path).join("mods");
    let mut removed = 0usize;
    for file in manifest.files {
        let relative = Path::new(&file.file_name);
        let mut components = relative.components();
        let safe_name = match (components.next(), components.next()) {
            (Some(std::path::Component::Normal(name)), None)
                if relative
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("jar")) =>
            {
                name
            }
            _ => continue,
        };
        let Some(expected_sha1) = file.sha1.as_deref() else {
            continue;
        };
        let path = mods_dir.join(safe_name);
        if !path.is_file() {
            continue;
        }
        let matches_managed_file =
            sha1_hex_of_file(&path).is_ok_and(|actual| actual.eq_ignore_ascii_case(expected_sha1));
        if matches_managed_file {
            fs::remove_file(&path).map_err(|error| {
                format!(
                    "Failed to remove legacy Kiza pack file {}: {error}",
                    path.display()
                )
            })?;
            removed += 1;
        }
    }

    fs::remove_file(&manifest_path).map_err(|error| error.to_string())?;
    Ok(removed)
}
pub async fn fetch_minecraft_versions() -> Result<MinecraftVersionList, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let url = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<MinecraftVersionList>()
        .await
        .map_err(|e| e.to_string())
}

fn version_manifest_cache_path(app_data_dir: &Path) -> PathBuf {
    global_root(app_data_dir).join("version_manifest_v2.json")
}

pub async fn fetch_minecraft_versions_cached(
    app_data_dir: &Path,
) -> Result<MinecraftVersionList, String> {
    match fetch_minecraft_versions().await {
        Ok(list) => {
            let path = version_manifest_cache_path(app_data_dir);
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(content) = serde_json::to_string(&list) {
                let _ = fs::write(&path, content);
            }
            Ok(list)
        }
        Err(network_error) => fs::read_to_string(version_manifest_cache_path(app_data_dir))
            .ok()
            .and_then(|content| serde_json::from_str::<MinecraftVersionList>(&content).ok())
            .ok_or(format!(
                "Failed to fetch Minecraft versions ({network_error}) and no cached manifest is available."
            )),
    }
}

const INSTALL_RECEIPT_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct MinecraftInstallReceipt {
    schema_version: u32,
    instance_id: String,
    mc_version: String,
    loader: MinecraftLoader,
    loader_version: Option<String>,
    #[serde(default)]
    java_major: Option<u32>,
    verified_at: String,
}

fn install_receipt_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    instance_state_dir(app_data_dir, instance_id).join("install-receipt.json")
}

pub fn planned_install_steps(loader: &MinecraftLoader) -> u64 {
    match loader {
        MinecraftLoader::Vanilla => 6,
        MinecraftLoader::Fabric | MinecraftLoader::Forge | MinecraftLoader::NeoForge => 8,
    }
}

fn clear_install_receipt(app_data_dir: &Path, instance_id: &str) -> Result<(), String> {
    let path = install_receipt_path(app_data_dir, instance_id);
    fs::remove_file(&path)
        .or_else(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("Could not clear the previous install receipt: {error}"))
}

fn verify_file_size(path: &Path, expected_size: u64, label: &str) -> Result<(), String> {
    let size = fs::metadata(path)
        .map_err(|_| format!("{label} is missing."))?
        .len();
    if size != expected_size {
        return Err(format!(
            "{label} is incomplete (expected {expected_size} bytes, found {size})."
        ));
    }
    Ok(())
}

fn asset_hash_prefix(hash: &str) -> Result<&str, String> {
    if hash.len() != 40 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("Invalid Minecraft asset SHA-1: {hash}"));
    }
    hash.get(..2)
        .ok_or_else(|| format!("Invalid Minecraft asset SHA-1: {hash}"))
}

fn verify_fabric_installation(
    app_data_dir: &Path,
    mc_version: &str,
    loader_version: &str,
) -> Result<(), String> {
    let meta_path = global_versions_dir(app_data_dir)
        .join("fabric-meta")
        .join(format!("{mc_version}-{loader_version}.json"));
    let content = fs::read_to_string(&meta_path)
        .map_err(|_| "The Fabric loader manifest is missing.".to_string())?;
    let meta: FabricLoaderMeta = serde_json::from_str(&content)
        .map_err(|error| format!("The Fabric loader manifest is invalid: {error}"))?;
    let fabric_maven = "https://maven.fabricmc.net/".to_string();
    let mut libraries = vec![
        FabricMavenLibrary {
            name: meta.loader.maven,
            url: Some(fabric_maven.clone()),
        },
        FabricMavenLibrary {
            name: meta.intermediary.maven,
            url: Some(fabric_maven),
        },
    ];
    libraries.extend(meta.launcher_meta.libraries.common);
    libraries.extend(meta.launcher_meta.libraries.client);
    for library in libraries {
        let (_, _, relative) = maven_coord_to_jar_path(&library.name)?;
        if !global_libraries_dir(app_data_dir).join(relative).exists() {
            return Err(format!("Fabric library {} is missing.", library.name));
        }
    }
    Ok(())
}

fn verify_minecraft_files(
    app_data_dir: &Path,
    instance: &GameInstance,
    verify_all_assets: bool,
) -> Result<(), String> {
    let Some(mc) = &instance.minecraft else {
        return Err("Not a Minecraft instance".to_string());
    };
    if instance.status != GameInstanceStatus::Valid {
        return Err("The instance itself is not verified as valid.".to_string());
    }
    let info = local_version_info(app_data_dir, &mc.mc_version)
        .ok_or_else(|| "The Minecraft version manifest is missing or invalid.".to_string())?;
    let client_path = global_versions_dir(app_data_dir)
        .join(&mc.mc_version)
        .join(format!("{}.jar", mc.mc_version));
    verify_file_size(
        &client_path,
        info.downloads.client.size,
        "The Minecraft client",
    )?;

    let asset_index_path = global_assets_dir(app_data_dir)
        .join("indexes")
        .join(format!("{}.json", info.asset_index.id));
    verify_file_size(
        &asset_index_path,
        info.asset_index.size,
        "The Minecraft asset index",
    )?;
    let asset_index: MojangAssetIndexFile = serde_json::from_str(
        &fs::read_to_string(&asset_index_path)
            .map_err(|error| format!("Could not read the Minecraft asset index: {error}"))?,
    )
    .map_err(|error| format!("The Minecraft asset index is invalid: {error}"))?;

    for library in &info.libraries {
        if !rules_allow_on_windows(&library.rules) || is_retired_library(&library.name) {
            continue;
        }
        let Some(downloads) = &library.downloads else {
            continue;
        };
        if let Some(artifact) = &downloads.artifact {
            verify_file_size(
                &global_libraries_dir(app_data_dir).join(&artifact.path),
                artifact.size,
                &format!("Minecraft library {}", library.name),
            )?;
        }
        if let Some(classifiers) = &downloads.classifiers {
            let selected = library
                .natives
                .as_ref()
                .and_then(|natives| natives.get("windows"))
                .and_then(|key| classifiers.get(key))
                .or_else(|| {
                    classifiers
                        .iter()
                        .find(|(key, _)| key.contains("natives-windows"))
                        .map(|(_, artifact)| artifact)
                });
            if let Some(artifact) = selected {
                verify_file_size(
                    &global_libraries_dir(app_data_dir).join(&artifact.path),
                    artifact.size,
                    &format!("Minecraft native library {}", library.name),
                )?;
            }
        }
    }

    let objects_dir = global_assets_dir(app_data_dir).join("objects");
    if !objects_dir.is_dir() {
        return Err("The Minecraft asset directory is missing.".to_string());
    }
    if verify_all_assets {
        for (name, object) in asset_index.objects {
            let path = objects_dir
                .join(asset_hash_prefix(&object.hash)?)
                .join(&object.hash);
            verify_file_size(&path, object.size, &format!("Minecraft asset {name}"))?;
        }
    }

    let required_java = effective_java_major(mc, required_java_major_for(&info, &mc.mc_version))?;
    let runtime = detect_minecraft_runtime_major(app_data_dir, required_java);
    if !runtime.valid {
        return Err(format!(
            "The required Java {required_java} runtime is not installed."
        ));
    }

    match mc.loader {
        MinecraftLoader::Vanilla => {}
        MinecraftLoader::Fabric => verify_fabric_installation(
            app_data_dir,
            &mc.mc_version,
            mc.loader_version
                .as_deref()
                .ok_or_else(|| "The Fabric loader version is missing.".to_string())?,
        )?,
        MinecraftLoader::Forge | MinecraftLoader::NeoForge => {
            let label = mc.loader.display_name();
            let family = mc
                .loader
                .installer_family()
                .ok_or_else(|| format!("{label} has no installer."))?;
            let forge_version = mc
                .loader_version
                .as_deref()
                .ok_or_else(|| format!("The {label} loader version is missing."))?;
            if !crate::forge::is_installed(app_data_dir, family, &mc.mc_version, forge_version) {
                return Err(format!("{label} {forge_version} is incomplete or missing."));
            }
        }
    }
    // An outdated or missing base mod is not a broken install: the current
    // launcher build carries the jar, so refresh it in place and re-verify.
    if base_mod::verify_installed(instance).is_err() {
        base_mod::ensure_installed(instance)?;
        base_mod::verify_installed(instance)?;
    }
    Ok(())
}

fn matching_install_receipt(
    app_data_dir: &Path,
    instance: &GameInstance,
) -> Result<MinecraftInstallReceipt, String> {
    let mc = instance
        .minecraft
        .as_ref()
        .ok_or_else(|| "Not a Minecraft instance".to_string())?;
    let path = install_receipt_path(app_data_dir, &instance.id);
    let content = fs::read_to_string(&path)
        .map_err(|_| "No verified Minecraft install receipt exists.".to_string())?;
    let receipt: MinecraftInstallReceipt = serde_json::from_str(&content)
        .map_err(|error| format!("The Minecraft install receipt is invalid: {error}"))?;
    if receipt.schema_version != INSTALL_RECEIPT_SCHEMA_VERSION
        || receipt.instance_id != instance.id
        || receipt.mc_version != mc.mc_version
        || receipt.loader != mc.loader
        || receipt.loader_version != mc.loader_version
        || receipt.java_major != mc.java_major
    {
        return Err("The Minecraft install receipt does not match this instance.".to_string());
    }
    Ok(receipt)
}

fn write_install_receipt(app_data_dir: &Path, instance: &GameInstance) -> Result<(), String> {
    let mc = instance
        .minecraft
        .as_ref()
        .ok_or_else(|| "Not a Minecraft instance".to_string())?;
    let path = install_receipt_path(app_data_dir, &instance.id);
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid Minecraft install receipt path.".to_string())?;
    ensure_dir(parent)?;
    let receipt = MinecraftInstallReceipt {
        schema_version: INSTALL_RECEIPT_SCHEMA_VERSION,
        instance_id: instance.id.clone(),
        mc_version: mc.mc_version.clone(),
        loader: mc.loader.clone(),
        loader_version: mc.loader_version.clone(),
        java_major: mc.java_major,
        verified_at: chrono::Utc::now().to_rfc3339(),
    };
    let bytes = serde_json::to_vec_pretty(&receipt).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4().simple()));
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Could not write the Minecraft install receipt: {error}"))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not replace the Minecraft install receipt: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not finalize the Minecraft install receipt: {error}"))
}

pub fn verify_minecraft_installation_ready(
    app_data_dir: &Path,
    instance: &GameInstance,
    verify_all_assets: bool,
) -> Result<(), String> {
    match matching_install_receipt(app_data_dir, instance) {
        Ok(_) => verify_minecraft_files(app_data_dir, instance, verify_all_assets),
        Err(receipt_error) => {
            // Instances installed before the receipt system exist without one.
            // If every launch-critical file still verifies, grandfather the
            // install by writing the receipt instead of demanding a repair.
            verify_minecraft_files(app_data_dir, instance, verify_all_assets)
                .map_err(|files_error| format!("{receipt_error} {files_error}"))?;
            write_install_receipt(app_data_dir, instance)
        }
    }
}

pub fn require_minecraft_launch_ready(
    app_data_dir: &Path,
    install_manager: &MinecraftInstallManager,
    instance: &GameInstance,
) -> Result<(), String> {
    if install_manager.is_active(&instance.id) {
        return Err(
            "Minecraft is still being installed. Wait for verification to finish.".to_string(),
        );
    }
    verify_minecraft_installation_ready(app_data_dir, instance, true).map_err(|error| {
        format!(
            "Minecraft is not installed and verified for launch. Use Retry / Repair first. {error}"
        )
    })
}

/// Reports an installation as complete only when a matching receipt and all
/// launch-critical local files are present. This remains fast enough to poll.
pub fn is_instance_installed(app_data_dir: &Path, instance: &GameInstance) -> bool {
    verify_minecraft_installation_ready(app_data_dir, instance, false).is_ok()
}

pub fn restored_install_status(
    app_data_dir: &Path,
    instance: &GameInstance,
) -> MinecraftInstallStatus {
    let overall_total = instance
        .minecraft
        .as_ref()
        .map(|minecraft| planned_install_steps(&minecraft.loader))
        .unwrap_or(0);
    if is_instance_installed(app_data_dir, instance) {
        return MinecraftInstallStatus {
            stage: MinecraftInstallStage::Done,
            completed: 1,
            total: 1,
            overall_completed: overall_total,
            overall_total,
            bytes_downloaded: 0,
            bytes_total: None,
            current_item: None,
            current_category: Some("Final verification".to_string()),
            message: Some("Minecraft is installed and verified.".to_string()),
            ready: true,
        };
    }

    let receipt_exists = install_receipt_path(app_data_dir, &instance.id).exists();
    let has_partial_files = instance.minecraft.as_ref().is_some_and(|minecraft| {
        let version_dir = global_versions_dir(app_data_dir).join(&minecraft.mc_version);
        version_dir
            .join(format!("{}.json", minecraft.mc_version))
            .exists()
            || version_dir
                .join(format!("{}.jar", minecraft.mc_version))
                .exists()
    });
    if receipt_exists || has_partial_files {
        return MinecraftInstallStatus {
            stage: MinecraftInstallStage::Error,
            completed: 0,
            total: 0,
            overall_completed: 0,
            overall_total,
            bytes_downloaded: 0,
            bytes_total: None,
            current_item: None,
            current_category: Some("Installation verification".to_string()),
            message: Some(
                "This Minecraft installation is incomplete or no longer verified. Run Retry / Repair."
                    .to_string(),
            ),
            ready: false,
        };
    }
    MinecraftInstallStatus::idle()
}

fn local_version_info(app_data_dir: &Path, version_id: &str) -> Option<MojangVersionInfo> {
    let path = global_versions_dir(app_data_dir)
        .join(version_id)
        .join(format!("{version_id}.json"));
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<MojangVersionInfo>(&content).ok()
}

async fn read_or_download_version_info(
    app_data_dir: &Path,
    client: &reqwest::Client,
    version: &MinecraftVersionEntry,
) -> Result<MojangVersionInfo, String> {
    let version_dir = global_versions_dir(app_data_dir).join(&version.id);
    let version_json_path = version_dir.join(format!("{}.json", version.id));
    if version_json_path.exists() {
        let content = tokio::fs::read_to_string(&version_json_path)
            .await
            .map_err(|e| e.to_string())?;
        return serde_json::from_str::<MojangVersionInfo>(&content).map_err(|e| e.to_string());
    }

    ensure_dir(&version_dir)?;
    let resp = client
        .get(&version.url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&version_json_path, &text)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::from_str::<MojangVersionInfo>(&text).map_err(|e| e.to_string())
}

async fn ensure_client_jar(
    app_data_dir: &Path,
    client: &reqwest::Client,
    info: &MojangVersionInfo,
) -> Result<PathBuf, String> {
    let version_dir = global_versions_dir(app_data_dir).join(&info.id);
    ensure_dir(&version_dir)?;
    let jar_path = version_dir.join(format!("{}.jar", info.id));
    download_to_path(
        client,
        &info.downloads.client.url,
        &jar_path,
        Some(&info.downloads.client.sha1),
    )
    .await?;
    Ok(jar_path)
}

async fn ensure_client_jar_with_progress(
    app_data_dir: &Path,
    client: &reqwest::Client,
    info: &MojangVersionInfo,
    install_manager: &MinecraftInstallManager,
    instance_id: &str,
    overall_completed: u64,
    overall_total: u64,
) -> Result<PathBuf, String> {
    let version_dir = global_versions_dir(app_data_dir).join(&info.id);
    ensure_dir(&version_dir)?;
    let jar_path = version_dir.join(format!("{}.jar", info.id));
    let item = format!("Minecraft {} client", info.id);
    install_manager.begin_stage(
        instance_id,
        MinecraftInstallStage::DownloadingClient,
        overall_completed,
        overall_total,
        0,
        1,
        "Minecraft client",
        Some(item.clone()),
        None,
    );
    let key = jar_path.to_string_lossy().to_string();
    let batch = DownloadBatchProgress::new([(key.clone(), Some(info.downloads.client.size))]);
    let progress = tracked_download_callback(
        install_manager.clone(),
        instance_id.to_string(),
        batch,
        key,
        "Minecraft client".to_string(),
        item,
    );
    download_to_path_with_progress(
        client,
        &info.downloads.client.url,
        &jar_path,
        Some(&info.downloads.client.sha1),
        Some(info.downloads.client.size),
        Some(progress),
    )
    .await?;
    install_manager.update_counts(instance_id, 1, 1);
    Ok(jar_path)
}

async fn ensure_asset_index(
    app_data_dir: &Path,
    client: &reqwest::Client,
    info: &MojangVersionInfo,
    install_manager: &MinecraftInstallManager,
    instance_id: &str,
    overall_completed: u64,
    overall_total: u64,
) -> Result<(String, PathBuf), String> {
    let assets_dir = global_assets_dir(app_data_dir);
    let indexes_dir = assets_dir.join("indexes");
    ensure_dir(&indexes_dir)?;
    let idx_path = indexes_dir.join(format!("{}.json", info.asset_index.id));
    let item = format!("Asset index {}", info.asset_index.id);
    install_manager.begin_stage(
        instance_id,
        MinecraftInstallStage::DownloadingAssetIndex,
        overall_completed,
        overall_total,
        0,
        1,
        "Asset index",
        Some(item.clone()),
        None,
    );
    let key = idx_path.to_string_lossy().to_string();
    let batch = DownloadBatchProgress::new([(key.clone(), Some(info.asset_index.size))]);
    let progress = tracked_download_callback(
        install_manager.clone(),
        instance_id.to_string(),
        batch,
        key,
        "Asset index".to_string(),
        item,
    );
    download_to_path_with_progress(
        client,
        &info.asset_index.url,
        &idx_path,
        Some(&info.asset_index.sha1),
        Some(info.asset_index.size),
        Some(progress),
    )
    .await?;
    install_manager.update_counts(instance_id, 1, 1);
    Ok((info.asset_index.id.clone(), idx_path))
}

#[allow(clippy::too_many_arguments)]
async fn download_libraries(
    app_data_dir: &Path,
    client: &reqwest::Client,
    info: &MojangVersionInfo,
    natives_dir: &Path,
    status: &MinecraftInstallManager,
    instance_id: &str,
    overall_completed: u64,
    overall_total: u64,
) -> Result<Vec<PathBuf>, String> {
    let libs_root = global_libraries_dir(app_data_dir);
    ensure_dir(&libs_root)?;
    ensure_dir(natives_dir)?;

    let mut artifacts: Vec<(String, PathBuf, String, u64, String)> = Vec::new();
    type NativeArchive = (String, PathBuf, String, u64, String, Option<Vec<String>>);
    let mut native_archives: Vec<NativeArchive> = Vec::new();

    for lib in &info.libraries {
        if !rules_allow_on_windows(&lib.rules) || is_retired_library(&lib.name) {
            continue;
        }
        let Some(downloads) = &lib.downloads else {
            continue;
        };
        if let Some(artifact) = &downloads.artifact {
            let dest = libs_root.join(&artifact.path);
            artifacts.push((
                artifact.url.clone(),
                dest,
                artifact.sha1.clone(),
                artifact.size,
                lib.name.clone(),
            ));
        }

        if let Some(classifiers) = &downloads.classifiers {
            let mut selected: Option<&MojangLibraryArtifact> = None;
            if let Some(natives) = &lib.natives {
                if let Some(key) = natives.get("windows") {
                    selected = classifiers.get(key);
                }
            }
            if selected.is_none() {
                selected = classifiers
                    .iter()
                    .find(|(k, _)| k.contains("natives-windows"))
                    .map(|(_, v)| v);
            }
            if let Some(artifact) = selected {
                let dest = libs_root.join(&artifact.path);
                let exclude = lib.extract.as_ref().and_then(|e| e.exclude.clone());
                native_archives.push((
                    artifact.url.clone(),
                    dest,
                    artifact.sha1.clone(),
                    artifact.size,
                    format!("{} native", lib.name),
                    exclude,
                ));
            }
        }
    }

    let total = (artifacts.len() + native_archives.len()) as u64;
    status.begin_stage(
        instance_id,
        MinecraftInstallStage::DownloadingLibraries,
        overall_completed,
        overall_total,
        0,
        total,
        "Game libraries",
        None,
        None,
    );

    let batch =
        DownloadBatchProgress::new(
            artifacts
                .iter()
                .map(|(_, dest, _, size, _)| (dest.to_string_lossy().to_string(), Some(*size)))
                .chain(native_archives.iter().map(|(_, dest, _, size, _, _)| {
                    (dest.to_string_lossy().to_string(), Some(*size))
                })),
        );

    let sem = Arc::new(Semaphore::new(8));
    let completed = Arc::new(Mutex::new(0u64));

    let mut classpath = Vec::new();

    let mut tasks = Vec::new();
    for (url, dest, sha1, size, label) in artifacts {
        classpath.push(dest.clone());
        let client = client.clone();
        let sem = sem.clone();
        let status = status.clone();
        let instance_id = instance_id.to_string();
        let completed = completed.clone();
        let key = dest.to_string_lossy().to_string();
        let progress = tracked_download_callback(
            status.clone(),
            instance_id.clone(),
            batch.clone(),
            key,
            "Game libraries".to_string(),
            label,
        );
        tasks.push(tauri::async_runtime::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            download_to_path_with_progress(
                &client,
                &url,
                &dest,
                Some(&sha1),
                Some(size),
                Some(progress),
            )
            .await?;
            let mut c = completed
                .lock()
                .map_err(|_| "Minecraft install progress lock is poisoned".to_string())?;
            *c += 1;
            status.update_counts(&instance_id, *c, total);
            Ok::<(), String>(())
        }));
    }

    for (url, dest, sha1, size, label, exclude) in native_archives {
        let client = client.clone();
        let sem = sem.clone();
        let natives_dir = natives_dir.to_path_buf();
        let status = status.clone();
        let instance_id = instance_id.to_string();
        let completed = completed.clone();
        let key = dest.to_string_lossy().to_string();
        let progress = tracked_download_callback(
            status.clone(),
            instance_id.clone(),
            batch.clone(),
            key,
            "Native libraries".to_string(),
            label,
        );
        tasks.push(tauri::async_runtime::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            download_to_path_with_progress(
                &client,
                &url,
                &dest,
                Some(&sha1),
                Some(size),
                Some(progress),
            )
            .await?;
            extract_native_archive(&dest, &natives_dir, exclude.as_deref())?;
            let mut c = completed
                .lock()
                .map_err(|_| "Minecraft install progress lock is poisoned".to_string())?;
            *c += 1;
            status.update_counts(&instance_id, *c, total);
            Ok::<(), String>(())
        }));
    }

    for t in tasks {
        t.await.map_err(|e| e.to_string())??;
    }

    Ok(classpath)
}

fn extract_native_archive(
    archive_path: &Path,
    natives_dir: &Path,
    exclude: Option<&[String]>,
) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().ends_with('/') {
            continue;
        }
        if let Some(exclude) = exclude {
            if exclude.iter().any(|p| entry.name().starts_with(p)) {
                continue;
            }
        }
        let outpath = natives_dir.join(entry.name());
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn download_assets(
    app_data_dir: &Path,
    client: &reqwest::Client,
    asset_index_path: &Path,
    status: &MinecraftInstallManager,
    instance_id: &str,
    overall_completed: u64,
    overall_total: u64,
) -> Result<(), String> {
    let assets_dir = global_assets_dir(app_data_dir);
    ensure_dir(&assets_dir)?;
    let objects_dir = assets_dir.join("objects");
    ensure_dir(&objects_dir)?;

    let content = tokio::fs::read_to_string(asset_index_path)
        .await
        .map_err(|e| e.to_string())?;
    let index =
        serde_json::from_str::<MojangAssetIndexFile>(&content).map_err(|e| e.to_string())?;

    let total = index.objects.len() as u64;
    status.begin_stage(
        instance_id,
        MinecraftInstallStage::DownloadingAssets,
        overall_completed,
        overall_total,
        0,
        total,
        "Game assets",
        None,
        None,
    );

    let batch_items = index
        .objects
        .values()
        .map(|object| {
            let prefix = asset_hash_prefix(&object.hash)?;
            let dest = objects_dir.join(prefix).join(&object.hash);
            Ok((dest.to_string_lossy().to_string(), Some(object.size)))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let batch = DownloadBatchProgress::new(batch_items);

    let sem = Arc::new(Semaphore::new(16));
    let completed = Arc::new(Mutex::new(0u64));
    let mut tasks = Vec::new();

    for (name, obj) in index.objects {
        let hash = obj.hash.clone();
        let prefix = asset_hash_prefix(&hash)?;
        let url = format!(
            "https://resources.download.minecraft.net/{}/{}",
            prefix, hash
        );
        let dest = objects_dir.join(prefix).join(&hash);
        let client = client.clone();
        let sem = sem.clone();
        let status = status.clone();
        let instance_id = instance_id.to_string();
        let completed = completed.clone();
        let key = dest.to_string_lossy().to_string();
        let progress = tracked_download_callback(
            status.clone(),
            instance_id.clone(),
            batch.clone(),
            key,
            "Game assets".to_string(),
            name,
        );
        tasks.push(tauri::async_runtime::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            download_to_path_with_progress(
                &client,
                &url,
                &dest,
                Some(&hash),
                Some(obj.size),
                Some(progress),
            )
            .await?;
            let mut c = completed
                .lock()
                .map_err(|_| "Minecraft install progress lock is poisoned".to_string())?;
            *c += 1;
            status.update_counts(&instance_id, *c, total);
            Ok::<(), String>(())
        }));
    }

    for t in tasks {
        t.await.map_err(|e| e.to_string())??;
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn download_fabric_loader_libs(
    app_data_dir: &Path,
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: &str,
    status: &MinecraftInstallManager,
    instance_id: &str,
    overall_completed: u64,
    overall_total: u64,
) -> Result<(String, Vec<PathBuf>), String> {
    status.begin_stage(
        instance_id,
        MinecraftInstallStage::InstallingFabric,
        overall_completed,
        overall_total,
        0,
        0,
        "Fabric loader",
        Some(format!("Fabric {loader_version}")),
        Some("Resolving the Fabric loader manifest.".to_string()),
    );

    // Fabric meta for a fixed (game, loader) version pair is immutable, so a
    // disk cache lets subsequent launches skip the network entirely.
    let meta_dir = global_versions_dir(app_data_dir).join("fabric-meta");
    let meta_path = meta_dir.join(format!("{mc_version}-{loader_version}.json"));
    let cached_meta = fs::read_to_string(&meta_path)
        .ok()
        .and_then(|content| serde_json::from_str::<FabricLoaderMeta>(&content).ok());

    let meta = match cached_meta {
        Some(meta) => meta,
        None => {
            let url = format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}/{}",
                mc_version, loader_version
            );
            let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            let text = resp.text().await.map_err(|e| e.to_string())?;
            let meta =
                serde_json::from_str::<FabricLoaderMeta>(&text).map_err(|e| e.to_string())?;
            ensure_dir(&meta_dir)?;
            let _ = fs::write(&meta_path, &text);
            meta
        }
    };

    // launcherMeta.libraries only lists the support libraries (ASM, mixin).
    // The Fabric loader jar itself (which contains the KnotClient main class)
    // and the intermediary mappings are declared separately and MUST be on
    // the classpath, otherwise the JVM exits with ClassNotFoundException.
    let fabric_maven = "https://maven.fabricmc.net/".to_string();
    let mut libs: Vec<FabricMavenLibrary> = vec![
        FabricMavenLibrary {
            name: meta.loader.maven.clone(),
            url: Some(fabric_maven.clone()),
        },
        FabricMavenLibrary {
            name: meta.intermediary.maven.clone(),
            url: Some(fabric_maven),
        },
    ];
    libs.extend(meta.launcher_meta.libraries.common.clone());
    libs.extend(meta.launcher_meta.libraries.client.clone());

    let mut coords: Vec<(String, PathBuf, String)> = Vec::new();
    for lib in libs {
        let base = lib
            .url
            .unwrap_or_else(|| "https://maven.fabricmc.net/".to_string());
        let (_, _, rel) = maven_coord_to_jar_path(&lib.name)?;
        let full_url = format!("{}{}", base, rel);
        let dest = global_libraries_dir(app_data_dir).join(&rel);
        coords.push((full_url, dest, lib.name));
    }

    let total = coords.len() as u64;
    status.begin_stage(
        instance_id,
        MinecraftInstallStage::InstallingFabric,
        overall_completed,
        overall_total,
        0,
        total,
        "Fabric loader",
        Some(format!("Fabric {loader_version}")),
        None,
    );

    let batch = DownloadBatchProgress::new(
        coords
            .iter()
            .map(|(_, dest, _)| (dest.to_string_lossy().to_string(), None)),
    );

    let sem = Arc::new(Semaphore::new(8));
    let completed = Arc::new(Mutex::new(0u64));
    let mut tasks = Vec::new();
    let mut classpath = Vec::new();

    for (url, dest, label) in coords {
        classpath.push(dest.clone());
        let client = client.clone();
        let sem = sem.clone();
        let status = status.clone();
        let instance_id = instance_id.to_string();
        let completed = completed.clone();
        let key = dest.to_string_lossy().to_string();
        let progress = tracked_download_callback(
            status.clone(),
            instance_id.clone(),
            batch.clone(),
            key,
            "Fabric loader".to_string(),
            label,
        );
        tasks.push(tauri::async_runtime::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            download_to_path_with_progress(&client, &url, &dest, None, None, Some(progress))
                .await?;
            let mut c = completed
                .lock()
                .map_err(|_| "Minecraft install progress lock is poisoned".to_string())?;
            *c += 1;
            status.update_counts(&instance_id, *c, total);
            Ok::<(), String>(())
        }));
    }

    for t in tasks {
        t.await.map_err(|e| e.to_string())??;
    }

    Ok((meta.launcher_meta.main_class.client, classpath))
}

pub async fn install_minecraft_instance(
    app_data_dir: PathBuf,
    install_manager: MinecraftInstallManager,
    instance: GameInstance,
) -> Result<(), String> {
    let loader = instance
        .minecraft
        .as_ref()
        .map(|minecraft| minecraft.loader.clone())
        .ok_or_else(|| "Not a Minecraft instance".to_string())?;
    let overall_total = planned_install_steps(&loader);
    clear_install_receipt(&app_data_dir, &instance.id)?;
    install_manager.begin_stage(
        &instance.id,
        MinecraftInstallStage::Preparing,
        0,
        overall_total,
        0,
        0,
        "Version manifest",
        instance
            .minecraft
            .as_ref()
            .map(|minecraft| format!("Minecraft {}", minecraft.mc_version)),
        Some("Resolving the Minecraft version manifest.".to_string()),
    );

    let instance = prepare_minecraft_loader(&app_data_dir, instance).await?;
    remove_legacy_optimization_pack(&app_data_dir, &instance)?;
    let Some(mc) = &instance.minecraft else {
        return Err("Not a Minecraft instance".to_string());
    };
    let versions = fetch_minecraft_versions_cached(&app_data_dir).await?;
    let version_entry = versions
        .versions
        .into_iter()
        .find(|v| v.id == mc.mc_version)
        .ok_or("Minecraft version not found".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    install_manager.begin_stage(
        &instance.id,
        MinecraftInstallStage::Preparing,
        0,
        overall_total,
        0,
        0,
        "Version manifest",
        Some(format!("Minecraft {}", mc.mc_version)),
        Some("Reading the Minecraft version manifest.".to_string()),
    );
    let info = read_or_download_version_info(&app_data_dir, &client, &version_entry).await?;

    // Pre-install the exact Java runtime this version declares so the first
    // launch does not have to download it.
    let required_major = effective_java_major(mc, required_java_major_for(&info, &mc.mc_version))?;
    let mut runtime = detect_minecraft_runtime_major(&app_data_dir, required_major);
    if !runtime.valid || (mc.loader == MinecraftLoader::Forge && runtime.source == "path") {
        install_manager.begin_stage(
            &instance.id,
            MinecraftInstallStage::Preparing,
            0,
            overall_total,
            0,
            0,
            "Java runtime",
            Some(format!("Java {required_major}")),
            Some("Preparing the required local Java runtime.".to_string()),
        );
        runtime = install_minecraft_runtime(&app_data_dir, required_major)
            .await
            .map_err(|error| format!("Java {required_major} installation failed: {error}"))?;
    }

    let client_jar = ensure_client_jar_with_progress(
        &app_data_dir,
        &client,
        &info,
        &install_manager,
        &instance.id,
        1,
        overall_total,
    )
    .await?;

    // One natives folder per loader build: two loaders unpacking their own
    // copies of LWJGL into a shared directory is how a game starts with the
    // wrong native library.
    let version_id_for_natives = match mc.loader {
        MinecraftLoader::Vanilla => info.id.clone(),
        ref loader => format!(
            "{}-{}-{}",
            loader.slug(),
            mc.loader_version
                .clone()
                .unwrap_or_else(|| "missing".to_string()),
            info.id
        ),
    };
    let natives_dir = instance_natives_dir(&app_data_dir, &instance.id, &version_id_for_natives);
    let _classpath = download_libraries(
        &app_data_dir,
        &client,
        &info,
        &natives_dir,
        &install_manager,
        &instance.id,
        2,
        overall_total,
    )
    .await?;

    let (_asset_id, asset_index_path) = ensure_asset_index(
        &app_data_dir,
        &client,
        &info,
        &install_manager,
        &instance.id,
        3,
        overall_total,
    )
    .await?;
    download_assets(
        &app_data_dir,
        &client,
        &asset_index_path,
        &install_manager,
        &instance.id,
        4,
        overall_total,
    )
    .await?;

    if mc.loader == MinecraftLoader::Fabric {
        let loader_version = mc
            .loader_version
            .clone()
            .ok_or("Fabric loader version missing".to_string())?;
        let _ = download_fabric_loader_libs(
            &app_data_dir,
            &client,
            &mc.mc_version,
            &loader_version,
            &install_manager,
            &instance.id,
            5,
            overall_total,
        )
        .await?;
    }
    if let Some(family) = mc.loader.installer_family() {
        let label = mc.loader.display_name();
        let forge_version = mc
            .loader_version
            .as_deref()
            .ok_or_else(|| format!("{label}: loader version is missing from the instance."))?;
        let java_path = runtime
            .java_path
            .as_deref()
            .ok_or_else(|| format!("{label}: managed Java {required_major} is unavailable."))?;
        install_manager.begin_stage(
            &instance.id,
            MinecraftInstallStage::InstallingForge,
            5,
            overall_total,
            0,
            1,
            "Mod loader",
            Some(format!("{label} {forge_version}")),
            Some(format!("Installing {label} {forge_version}.")),
        );
        crate::forge::ensure_installed(
            &app_data_dir,
            family,
            &client,
            Path::new(java_path),
            &mc.mc_version,
            forge_version,
            &client_jar,
        )
        .await?;
        install_manager.update_counts(&instance.id, 1, 1);
    }

    if mc.loader != MinecraftLoader::Vanilla {
        let artifact = format!("{} artifact", mc.loader.display_name());
        install_manager.begin_stage(
            &instance.id,
            MinecraftInstallStage::InstallingBaseMod,
            6,
            overall_total,
            0,
            1,
            "Kiza Client Runtime",
            Some(artifact.to_string()),
            Some("Installing or repairing the local Kiza Client Runtime.".to_string()),
        );
        base_mod::ensure_installed(&instance)?;
        install_manager.update_counts(&instance.id, 1, 1);
    }

    let verification_step = if mc.loader == MinecraftLoader::Vanilla {
        5
    } else {
        7
    };
    install_manager.begin_stage(
        &instance.id,
        MinecraftInstallStage::Verifying,
        verification_step,
        overall_total,
        0,
        1,
        "Final verification",
        Some("Local installation".to_string()),
        Some("Checking every required local component.".to_string()),
    );
    let performance_profile = resolve_profile(&app_data_dir, &instance.id);
    apply_performance_options_if_needed(
        &app_data_dir,
        &instance.id,
        &PathBuf::from(&instance.install_path),
        &performance_profile,
    )?;
    verify_minecraft_files(&app_data_dir, &instance, true)?;
    write_install_receipt(&app_data_dir, &instance)?;
    verify_minecraft_installation_ready(&app_data_dir, &instance, false)?;
    install_manager.update_counts(&instance.id, 1, 1);

    install_manager.set_status(
        &instance.id,
        MinecraftInstallStatus {
            stage: MinecraftInstallStage::Done,
            completed: 1,
            total: 1,
            overall_completed: overall_total,
            overall_total,
            bytes_downloaded: 0,
            bytes_total: None,
            current_item: None,
            current_category: Some("Final verification".to_string()),
            message: Some("Minecraft is installed, verified, and ready to play.".to_string()),
            ready: true,
        },
    );
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftLaunchRequest {
    pub instance_id: String,
    pub username: String,
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub user_type: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftLaunchResult {
    pub pid: u32,
    pub java: String,
    pub main_class: String,
    pub profile_id: String,
    pub log_path: String,
    pub account_mode: String,
}

pub async fn launch_minecraft(
    app_data_dir: PathBuf,
    instance: GameInstance,
    req: MinecraftLaunchRequest,
    launch_manager: LaunchManager,
) -> Result<
    (
        MinecraftLaunchResult,
        std::process::Child,
        Option<StateBridgeSession>,
    ),
    String,
> {
    let reported_id = instance.id.clone();
    let report = |phase: LaunchPhase, message: &str| {
        launch_manager.set_phase(&reported_id, phase, Some(message.to_string()));
    };
    report(LaunchPhase::Preparing, "Preparing launch");

    let instance = prepare_minecraft_loader(&app_data_dir, instance).await?;
    remove_legacy_optimization_pack(&app_data_dir, &instance)?;
    let Some(mc) = &instance.minecraft else {
        return Err("Not a Minecraft instance".to_string());
    };
    base_mod::ensure_installed(&instance)?;
    let state_bridge = if base_mod::is_supported(&instance) {
        Some(StateBridgeSession::new(&app_data_dir, &instance.id)?)
    } else {
        None
    };

    let performance_profile = resolve_profile(&app_data_dir, &instance.id);

    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    // Local-first: once installed, launching must not depend on Mojang being
    // reachable. Only fall back to the version manifest when the version JSON
    // is not on disk yet.
    let info = match local_version_info(&app_data_dir, &mc.mc_version) {
        Some(info) => info,
        None => {
            let versions = fetch_minecraft_versions_cached(&app_data_dir).await?;
            let version_entry = versions
                .versions
                .into_iter()
                .find(|v| v.id == mc.mc_version)
                .ok_or("Minecraft version not found".to_string())?;
            read_or_download_version_info(&app_data_dir, &client, &version_entry).await?
        }
    };
    // Shown in-game (F3 debug screen version line) as the version type:
    // "Minecraft 1.x.x (1.x.x/Kiza Client)".
    let version_type = "Kiza Client".to_string();

    // The version JSON declares the exact Java major it needs. Self-heal:
    // install the managed Temurin runtime when it is missing.
    let required_major = effective_java_major(mc, required_java_major_for(&info, &mc.mc_version))?;
    let mut runtime = detect_minecraft_runtime_major(&app_data_dir, required_major);
    // PATH java has an unknown major version; only managed Temurin or an
    // explicit user override are trusted to match the required major.
    if !runtime.valid || runtime.source == "path" {
        report(
            LaunchPhase::DownloadingJava,
            &format!("Downloading Java {required_major} runtime"),
        );
        runtime = install_minecraft_runtime(&app_data_dir, required_major).await?;
    }
    // Per-instance overrides (RAM, JVM args, Java path) win over the globals.
    let instance_settings = load_instance_settings(&app_data_dir, &instance.id);
    let java_path = instance_settings
        .java_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty() && Path::new(path).exists())
        .map(str::to_string)
        .or_else(|| runtime.java_path.clone())
        .unwrap_or_else(|| {
            if cfg!(windows) {
                "javaw".to_string()
            } else {
                "java".to_string()
            }
        });

    report(LaunchPhase::DownloadingGame, "Verifying game files");
    let client_jar = ensure_client_jar(&app_data_dir, &client, &info).await?;

    let game_dir = PathBuf::from(&instance.install_path);
    ensure_dir(&game_dir.join("mods"))?;
    apply_performance_options_if_needed(
        &app_data_dir,
        &instance.id,
        &game_dir,
        &performance_profile,
    )?;

    // Kiza branding on the title screen + splashes, and run the game on the
    // dedicated GPU on hybrid-graphics machines. Both are best-effort.
    let pack_format = client_jar_pack_format(&client_jar).unwrap_or((15, 0));
    if let Err(error) = build_kiza_branding_pack(&game_dir, pack_format)
        .and_then(|()| enable_kiza_pack_in_options(&game_dir))
    {
        eprintln!("Kiza branding pack skipped: {error}");
    }
    prefer_dedicated_gpu(&java_path);

    let assets_dir = global_assets_dir(&app_data_dir);
    let libraries_dir = global_libraries_dir(&app_data_dir);

    // One natives folder per loader build: two loaders unpacking their own
    // copies of LWJGL into a shared directory is how a game starts with the
    // wrong native library.
    let version_id_for_natives = match mc.loader {
        MinecraftLoader::Vanilla => info.id.clone(),
        ref loader => format!(
            "{}-{}-{}",
            loader.slug(),
            mc.loader_version
                .clone()
                .unwrap_or_else(|| "missing".to_string()),
            info.id
        ),
    };
    let natives_dir = instance_natives_dir(&app_data_dir, &instance.id, &version_id_for_natives);

    // Classpath convention: libraries first, the game jar last, so library
    // classes (Fabric loader, ASM, LWJGL) always win over anything bundled
    // in the client jar.
    let mut classpath: Vec<PathBuf> = Vec::new();

    for lib in &info.libraries {
        if !rules_allow_on_windows(&lib.rules) || is_retired_library(&lib.name) {
            continue;
        }
        let Some(downloads) = &lib.downloads else {
            continue;
        };
        if let Some(artifact) = &downloads.artifact {
            let dest = libraries_dir.join(&artifact.path);
            classpath.push(dest);
        }
    }

    let mut main_class = info.main_class.clone();
    let mut forge_profile = None;
    match mc.loader {
        MinecraftLoader::Vanilla => {}
        MinecraftLoader::Fabric => {
            let loader_version = mc
                .loader_version
                .clone()
                .ok_or("Fabric loader version missing".to_string())?;
            let (fabric_main, fabric_cp) = download_fabric_loader_libs(
                &app_data_dir,
                &client,
                &mc.mc_version,
                &loader_version,
                &MinecraftInstallManager::new(),
                &instance.id,
                0,
                0,
            )
            .await?;
            main_class = fabric_main;
            classpath.extend(fabric_cp);
        }
        MinecraftLoader::Forge | MinecraftLoader::NeoForge => {
            let label = mc.loader.display_name();
            let family = mc
                .loader
                .installer_family()
                .ok_or_else(|| format!("{label} has no installer."))?;
            let forge_version = mc
                .loader_version
                .as_deref()
                .ok_or_else(|| format!("{label}: loader version is missing from the instance."))?;
            let profile = crate::forge::ensure_installed(
                &app_data_dir,
                family,
                &client,
                Path::new(&java_path),
                &mc.mc_version,
                forge_version,
                &client_jar,
            )
            .await?;
            main_class = profile.main_class.clone();
            let forge_overrides = profile
                .classpath
                .iter()
                .filter_map(|path| maven_artifact_key(path))
                .map(|(key, _)| key)
                .collect::<HashSet<_>>();
            classpath.retain(|path| {
                maven_artifact_key(path).is_none_or(|(key, _)| !forge_overrides.contains(&key))
            });
            let mut forge_first_classpath = profile.classpath.clone();
            forge_first_classpath.extend(classpath);
            classpath = forge_first_classpath;
            forge_profile = Some(profile);
        }
    }

    report(LaunchPhase::Starting, "Starting Minecraft");

    // Collapse duplicate libraries (vanilla vs Fabric both ship ASM, etc.)
    // before adding the game jar last (see classpath convention above).
    let mut classpath = dedupe_classpath(classpath);
    let module_path_version_name = module_path_version_name(&client_jar, &info.id);
    classpath.push(client_jar);

    let classpath_separator = if cfg!(windows) { ";" } else { ":" };
    let cp = classpath
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(classpath_separator);

    let uuid = req
        .uuid
        .unwrap_or_else(|| Uuid::new_v4().to_string().replace('-', ""));
    let account_mode = if req
        .access_token
        .as_deref()
        .is_some_and(|token| token != "0")
    {
        "microsoft".to_string()
    } else {
        "offline".to_string()
    };
    let access_token = req.access_token.unwrap_or_else(|| "0".to_string());
    let user_type = req.user_type.unwrap_or_else(|| "legacy".to_string());
    let launch_version_id = forge_profile
        .as_ref()
        .map(|profile| profile.version_id.clone())
        .unwrap_or_else(|| info.id.clone());
    let mut forge_jvm_args = Vec::new();
    let mut forge_game_args = Vec::new();
    if let Some(profile) = &forge_profile {
        let variables = HashMap::from([
            (
                "library_directory".to_string(),
                profile.library_dir.to_string_lossy().to_string(),
            ),
            (
                "classpath_separator".to_string(),
                classpath_separator.to_string(),
            ),
            ("classpath".to_string(), cp.clone()),
            // Forge only reads ${version_name} inside -DignoreList, where it
            // must name the vanilla client jar. The Forge profile id would not
            // match any classpath entry (see module_path_version_name).
            ("version_name".to_string(), module_path_version_name.clone()),
            (
                "natives_directory".to_string(),
                natives_dir.to_string_lossy().to_string(),
            ),
            ("launcher_name".to_string(), "Kiza Launcher".to_string()),
            ("launcher_version".to_string(), "0.1".to_string()),
            ("auth_player_name".to_string(), req.username.clone()),
            ("auth_uuid".to_string(), uuid.clone()),
            ("auth_access_token".to_string(), access_token.clone()),
            (
                "game_directory".to_string(),
                game_dir.to_string_lossy().to_string(),
            ),
            (
                "assets_root".to_string(),
                assets_dir.to_string_lossy().to_string(),
            ),
            ("assets_index_name".to_string(), info.asset_index.id.clone()),
            ("user_type".to_string(), user_type.clone()),
            ("version_type".to_string(), version_type.clone()),
            ("user_properties".to_string(), "{}".to_string()),
            ("clientid".to_string(), String::new()),
            ("xuid".to_string(), String::new()),
        ]);
        forge_jvm_args = crate::forge::expand_arguments(&profile.jvm_args, &variables)?;
        forge_game_args = crate::forge::expand_arguments(&profile.game_args, &variables)?;
    }

    let app_config = effective_config(
        &ConfigManager::new(app_data_dir.clone()).load_config(),
        &instance_settings,
    );
    let mut cmd = std::process::Command::new(&java_path);
    cmd.current_dir(&game_dir);
    for arg in build_java_args(&performance_profile, &app_config) {
        cmd.arg(arg);
    }
    // The Performance Advisor measures a run only when the user asked for it,
    // and the request lasts exactly this launch: logging every session would
    // write to disk during play forever to answer a question nobody asked.
    if crate::performance_advisor::take_measurement_request(&app_data_dir, &instance.id) {
        let log_path = crate::performance_advisor::gc_log_path(&app_data_dir, &instance.id);
        if let Some(parent) = log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        // None on Java 8, where unified logging does not exist and the flag
        // would stop the JVM from starting at all.
        if let Some(argument) =
            crate::performance_advisor::gc_log_argument(required_major, &log_path)
        {
            cmd.arg(argument);
        }
    }
    if let Some(bridge) = &state_bridge {
        cmd.args(bridge.jvm_args(&mc.mc_version, mc.loader.slug(), &req.username));
    }
    cmd.args(&forge_jvm_args);
    cmd.arg(format!(
        "-Djava.library.path={}",
        natives_dir.to_string_lossy()
    ));
    cmd.arg("-cp");
    cmd.arg(cp);
    cmd.arg(&main_class);
    if !forge_profile
        .as_ref()
        .is_some_and(|profile| profile.replaces_vanilla_game_args)
    {
        cmd.arg("--username");
        cmd.arg(&req.username);
        cmd.arg("--version");
        cmd.arg(&launch_version_id);
        cmd.arg("--gameDir");
        cmd.arg(game_dir.to_string_lossy().to_string());
        cmd.arg("--assetsDir");
        cmd.arg(assets_dir.to_string_lossy().to_string());
        cmd.arg("--assetIndex");
        cmd.arg(&info.asset_index.id);
        cmd.arg("--uuid");
        cmd.arg(uuid);
        cmd.arg("--accessToken");
        cmd.arg(access_token);
        cmd.arg("--userType");
        cmd.arg(user_type);
        cmd.arg("--versionType");
        cmd.arg(&version_type);
    }
    cmd.args(&forge_game_args);

    let logs_dir = game_dir.join("logs");
    ensure_dir(&logs_dir)?;
    let log_path = logs_dir.join("latest.log");
    let log_file = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let err_file = log_file.try_clone().map_err(|e| e.to_string())?;
    cmd.stdout(Stdio::from(log_file));
    cmd.stderr(Stdio::from(err_file));

    // Never pop up a console window: even with javaw, spawning from a GUI app
    // can flash a cmd window without this flag.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    Ok((
        MinecraftLaunchResult {
            pid,
            java: java_path,
            main_class,
            profile_id: performance_profile.id,
            log_path: log_path.to_string_lossy().to_string(),
            account_mode,
        },
        child,
        state_bridge,
    ))
}

#[cfg(test)]
mod tests {
    use std::fs;

    /// Lays out a runtime folder the way the installer does.
    fn place_runtime(root: &std::path::Path, major: u32, with_binary: bool) {
        // Mirrors `runtime_dir`: minecraft/global/runtimes/temurin-N.
        let dir = super::runtime_dir(root, major).join("bin");
        fs::create_dir_all(&dir).unwrap();
        if with_binary {
            fs::write(
                dir.join(if cfg!(windows) { "javaw.exe" } else { "java" }),
                [0u8; 64],
            )
            .unwrap();
        }
    }

    #[test]
    fn every_managed_java_is_listed_even_when_none_is_installed() {
        // The page has to be able to offer an install, which means showing the
        // ones that are absent rather than only the ones that are here.
        let dir = tempfile::TempDir::new().unwrap();
        let listed = super::list_java_runtimes(dir.path());

        assert_eq!(listed.len(), 4);
        assert!(listed.iter().all(|entry| !entry.installed));
        assert!(listed.iter().all(|entry| !entry.covers.is_empty()));
    }

    #[test]
    fn an_installed_runtime_is_reported_with_its_size() {
        let dir = tempfile::TempDir::new().unwrap();
        place_runtime(dir.path(), 21, true);

        let listed = super::list_java_runtimes(dir.path());
        let java21 = listed.iter().find(|entry| entry.major == 21).unwrap();
        assert!(java21.installed);
        assert!(!java21.broken);
        assert_eq!(java21.bytes, 64);
    }

    #[test]
    fn a_folder_without_a_java_binary_is_broken_rather_than_installed() {
        // This is the shape a cancelled download leaves behind. Calling it
        // installed means the next launch fails with something far less
        // obvious than "this one is broken".
        let dir = tempfile::TempDir::new().unwrap();
        place_runtime(dir.path(), 17, false);

        let listed = super::list_java_runtimes(dir.path());
        let java17 = listed.iter().find(|entry| entry.major == 17).unwrap();
        assert!(!java17.installed);
        assert!(java17.broken);
    }

    #[test]
    fn removing_a_runtime_frees_it_and_reports_how_much() {
        let dir = tempfile::TempDir::new().unwrap();
        place_runtime(dir.path(), 8, true);

        assert_eq!(super::remove_java_runtime(dir.path(), 8).unwrap(), 64);
        let listed = super::list_java_runtimes(dir.path());
        assert!(
            !listed
                .iter()
                .find(|entry| entry.major == 8)
                .unwrap()
                .installed
        );
    }

    #[test]
    fn removing_one_that_is_not_there_is_not_an_error() {
        let dir = tempfile::TempDir::new().unwrap();
        assert_eq!(super::remove_java_runtime(dir.path(), 25).unwrap(), 0);
    }

    #[test]
    fn a_java_kiza_does_not_manage_is_refused() {
        // The major arrives from the interface. Without this guard, a value
        // Kiza never installed would name a folder to delete.
        let dir = tempfile::TempDir::new().unwrap();
        assert!(super::remove_java_runtime(dir.path(), 11).is_err());
        assert!(super::remove_java_runtime(dir.path(), 0).is_err());
    }

    #[test]
    fn exported_manifest_drops_the_minecraft_version_from_the_loader_id() {
        // CurseForge rejects "forge-11.15.1.2318-1.8.9" as an unsupported mod
        // loader; it expects the loader version on its own.
        assert_eq!(
            super::manifest_loader_version("11.15.1.2318-1.8.9", "1.8.9"),
            "11.15.1.2318"
        );
        assert_eq!(
            super::manifest_loader_version("1.8.9-11.15.1.2318", "1.8.9"),
            "11.15.1.2318"
        );
    }

    #[test]
    fn exported_manifest_keeps_plain_loader_versions() {
        assert_eq!(super::manifest_loader_version("47.3.0", "1.20.1"), "47.3.0");
        assert_eq!(super::manifest_loader_version("0.16.9", "1.21.1"), "0.16.9");
    }

    #[test]
    fn retired_twitch_libraries_are_skipped() {
        // 1.7/1.8 manifests list these; Mojang no longer serves them, and the
        // removed streaming feature is not needed to launch the game.
        assert!(super::is_retired_library(
            "tv.twitch:twitch-external-platform:4.5"
        ));
        assert!(super::is_retired_library("tv.twitch:twitch-platform:6.5"));
        assert!(super::is_retired_library("tv.twitch:twitch:6.5"));
    }

    #[test]
    fn real_libraries_are_still_required() {
        assert!(!super::is_retired_library(
            "org.lwjgl.lwjgl:lwjgl:2.9.4-nightly-20150209"
        ));
        assert!(!super::is_retired_library("com.mojang:authlib:1.5.21"));
        assert!(!super::is_retired_library("net.java.jinput:jinput:2.0.5"));
    }

    use super::*;

    fn profile(id: &str) -> MinecraftPerformanceProfile {
        base_performance_profiles()
            .into_iter()
            .find(|p| p.id == id)
            .expect("profile exists")
    }

    #[test]
    fn vanilla_instance_is_not_forced_to_fabric() {
        let temp = tempfile::tempdir().expect("temp dir");
        let instance = create_minecraft_instance(
            temp.path(),
            "Vanilla".to_string(),
            "1.21.8".to_string(),
            MinecraftLoader::Vanilla,
            Some("latest".to_string()),
            None,
        )
        .expect("instance");
        let minecraft = instance.minecraft.expect("minecraft config");
        assert_eq!(minecraft.loader, MinecraftLoader::Vanilla);
        assert_eq!(minecraft.loader_version, None);
    }

    #[test]
    fn forge_ignore_list_names_the_vanilla_jar_not_the_forge_profile() {
        let client_jar = Path::new("C:/kiza/versions/1.17.1/1.17.1.jar");

        // Expanding to the Forge profile id matches no classpath entry, and
        // the vanilla jar then lands on the module path twice.
        assert_eq!(
            module_path_version_name(client_jar, "1.17.1-forge-37.1.1"),
            "1.17.1"
        );
        assert_eq!(
            module_path_version_name(Path::new(""), "1.20.1-forge-47.4.21"),
            "1.20.1-forge-47.4.21"
        );
    }

    #[test]
    fn declared_java_is_snapped_to_a_runtime_we_can_install() {
        // 1.17.x declares 16; Adoptium has no Temurin 16 JRE left, so an
        // untranslated 16 leaves the instance unlaunchable.
        assert_eq!(provisionable_java_major(16), 17);
        assert_eq!(provisionable_java_major(8), 8);
        assert_eq!(provisionable_java_major(17), 17);
        assert_eq!(provisionable_java_major(21), 21);
        assert_eq!(provisionable_java_major(25), 25);
        // Never round down: an older JVM cannot load newer class files.
        assert_eq!(provisionable_java_major(9), 17);
        assert_eq!(provisionable_java_major(26), 26);
    }

    #[test]
    fn selecting_java_17_is_accepted_for_a_version_that_declares_16() {
        let minecraft = MinecraftInstanceConfig {
            mc_version: "1.17.1".to_string(),
            loader: MinecraftLoader::Forge,
            loader_version: Some("37.1.1".to_string()),
            java_major: Some(17),
        };

        assert_eq!(
            effective_java_major(&minecraft, provisionable_java_major(16)).expect("java 17"),
            17
        );
    }

    #[test]
    fn branding_pack_ships_only_what_the_jar_cannot_provide() {
        let temp = tempfile::tempdir().expect("temp dir");
        build_kiza_branding_pack(temp.path(), (15, 0)).expect("branding pack");
        enable_kiza_pack_in_options(temp.path()).expect("enable branding pack");

        let pack_path = temp.path().join("resourcepacks").join(KIZA_PACK_FILE);
        // The pack exists for the vanilla side only. The mod's own namespace is
        // served from the jar, so duplicating it here would just cost megabytes
        // in every instance.
        let pack_size = fs::metadata(&pack_path).expect("pack metadata").len();
        assert!(
            pack_size < 64 * 1024,
            "branding pack grew to {pack_size} bytes; it must stay vanilla-side only"
        );

        let file = fs::File::open(&pack_path).expect("open branding pack");
        let mut archive = zip::ZipArchive::new(file).expect("read branding pack");
        let entries: Vec<String> = archive.file_names().map(str::to_string).collect();
        assert!(
            !entries
                .iter()
                .any(|name| name.starts_with("assets/kiza_base_mod/")),
            "the mod jar already ships its own namespace: {entries:?}"
        );

        let mut edition = Vec::new();
        std::io::Read::read_to_end(
            &mut archive
                .by_name("assets/minecraft/textures/gui/title/edition.png")
                .expect("edition banner"),
            &mut edition,
        )
        .expect("read edition banner");
        assert_eq!(edition, KIZA_EDITION_PNG);

        let mut splashes = String::new();
        std::io::Read::read_to_string(
            &mut archive
                .by_name("assets/minecraft/texts/splashes.txt")
                .expect("splashes"),
            &mut splashes,
        )
        .expect("read splashes");
        assert_eq!(splashes, KIZA_SPLASHES);

        for name in [
            "button.png",
            "button_highlighted.png",
            "button_disabled.png",
        ] {
            archive
                .by_name(&format!(
                    "assets/minecraft/textures/gui/sprites/widget/{name}"
                ))
                .unwrap_or_else(|_| panic!("missing Kiza widget sprite: {name}"));
        }
        let mut legacy_widgets = Vec::new();
        std::io::Read::read_to_end(
            &mut archive
                .by_name("assets/minecraft/textures/gui/widgets.png")
                .expect("legacy widgets in branding pack"),
            &mut legacy_widgets,
        )
        .expect("read legacy widgets");
        assert_eq!(legacy_widgets, KIZA_LEGACY_WIDGETS_PNG);
        let options = fs::read_to_string(temp.path().join("options.txt")).expect("options");
        assert!(options.contains("file/KizaClient.zip"));
    }

    #[test]
    fn forge_instance_requires_and_preserves_a_resolved_version() {
        let temp = tempfile::tempdir().expect("temp dir");
        let error = create_minecraft_instance(
            temp.path(),
            "Forge without build".to_string(),
            "1.20.1".to_string(),
            MinecraftLoader::Forge,
            None,
            None,
        )
        .expect_err("Forge creation must reject an unresolved build");
        assert!(error.contains("must be resolved before creation"));

        let instance = create_minecraft_instance(
            temp.path(),
            "Forge".to_string(),
            "1.20.1".to_string(),
            MinecraftLoader::Forge,
            Some("47.4.21".to_string()),
            None,
        )
        .expect("Forge instance");
        let minecraft = instance.minecraft.expect("minecraft config");
        assert_eq!(minecraft.loader, MinecraftLoader::Forge);
        assert_eq!(minecraft.loader_version.as_deref(), Some("47.4.21"));
    }

    #[test]
    fn instance_preserves_and_validates_an_explicit_java_choice() {
        let temp = tempfile::tempdir().expect("temp dir");
        let instance = create_minecraft_instance(
            temp.path(),
            "Java 8".to_string(),
            "1.16.5".to_string(),
            MinecraftLoader::Vanilla,
            None,
            Some(8),
        )
        .expect("instance");
        let minecraft = instance.minecraft.expect("minecraft config");
        assert_eq!(minecraft.java_major, Some(8));
        assert_eq!(effective_java_major(&minecraft, 8).unwrap(), 8);
        assert!(effective_java_major(&minecraft, 17)
            .expect_err("mismatched Java must be rejected")
            .contains("requires Java 17"));
    }

    #[test]
    fn instance_rejects_an_unknown_java_major() {
        let temp = tempfile::tempdir().expect("temp dir");
        let error = create_minecraft_instance(
            temp.path(),
            "Unsupported Java".to_string(),
            "1.21.8".to_string(),
            MinecraftLoader::Vanilla,
            None,
            Some(11),
        )
        .expect_err("unsupported Java must be rejected");
        assert!(error.contains("Automatic, 8, 17, 21 or 25"));
    }

    #[test]
    fn launch_guard_rejects_an_incomplete_unverified_installation() {
        let temp = tempfile::tempdir().expect("temp dir");
        let instance = create_minecraft_instance(
            temp.path(),
            "Not installed".to_string(),
            "1.21.8".to_string(),
            MinecraftLoader::Vanilla,
            None,
            None,
        )
        .expect("instance");

        let error =
            require_minecraft_launch_ready(temp.path(), &MinecraftInstallManager::new(), &instance)
                .expect_err("launch must remain locked until final verification");

        assert!(error.contains("not installed and verified"));
        assert!(error.contains("Retry / Repair"));
    }

    #[test]
    fn install_manager_rejects_duplicate_installations() {
        let manager = MinecraftInstallManager::new();
        manager.try_start("instance-a", 8).expect("first install");
        let error = manager
            .try_start("instance-a", 8)
            .expect_err("second install must be rejected atomically");
        assert!(error.contains("already running"));
    }

    #[test]
    fn invalid_asset_hashes_are_rejected_without_panicking() {
        assert_eq!(
            asset_hash_prefix("0123456789abcdef0123456789abcdef01234567").unwrap(),
            "01"
        );
        assert!(asset_hash_prefix("x").is_err());
        assert!(asset_hash_prefix("zz23456789abcdef0123456789abcdef01234567").is_err());
    }

    #[test]
    fn partial_installation_is_restored_as_repairable_error() {
        let temp = tempfile::tempdir().expect("temp dir");
        let instance = create_minecraft_instance(
            temp.path(),
            "Partial".to_string(),
            "1.21.8".to_string(),
            MinecraftLoader::Vanilla,
            None,
            None,
        )
        .expect("instance");
        let version_dir = global_versions_dir(temp.path()).join("1.21.8");
        ensure_dir(&version_dir).expect("version dir");
        fs::write(version_dir.join("1.21.8.jar"), b"partial").expect("partial client");

        let status = restored_install_status(temp.path(), &instance);
        assert_eq!(status.stage, MinecraftInstallStage::Error);
        assert!(!status.ready);
        assert!(status.message.unwrap().contains("Retry / Repair"));
    }

    #[test]
    fn legacy_pack_cleanup_removes_only_hash_matched_managed_jars() {
        let temp = tempfile::tempdir().expect("temp dir");
        let app_data_dir = temp.path();
        let instance_id = "legacy-pack";
        let game_dir = instance_game_dir(app_data_dir, instance_id);
        let mods_dir = game_dir.join("mods");
        ensure_dir(&mods_dir).expect("mods dir");

        let managed = mods_dir.join("sodium-managed.jar");
        fs::write(&managed, b"managed by kiza").expect("managed jar");
        let managed_sha1 = sha1_hex_of_file(&managed).expect("managed sha1");

        let replaced = mods_dir.join("lithium-replaced.jar");
        fs::write(&replaced, b"user replacement").expect("replacement jar");
        let outside = game_dir.join("outside.jar");
        fs::write(&outside, b"outside").expect("outside jar");

        let manifest_path = optimization_manifest_path(app_data_dir, instance_id);
        ensure_dir(manifest_path.parent().expect("manifest parent")).expect("state dir");
        fs::write(
            &manifest_path,
            serde_json::json!({
                "files": [
                    { "file_name": "sodium-managed.jar", "sha1": managed_sha1 },
                    { "file_name": "lithium-replaced.jar", "sha1": "0000000000000000000000000000000000000000" },
                    { "file_name": "../outside.jar", "sha1": sha1_hex_of_file(&outside).unwrap() }
                ]
            })
            .to_string(),
        )
        .expect("manifest");

        let instance = GameInstance {
            schema_version: 1,
            id: instance_id.to_string(),
            game_id: "minecraft".to_string(),
            display_name: "Legacy".to_string(),
            install_path: game_dir.to_string_lossy().to_string(),
            executable_path: String::new(),
            mods_path: app_data_dir
                .join("mods")
                .join(instance_id)
                .to_string_lossy()
                .to_string(),
            detected_variant: Some("Managed".to_string()),
            minecraft: Some(MinecraftInstanceConfig {
                mc_version: "1.21.8".to_string(),
                loader: MinecraftLoader::Fabric,
                loader_version: Some(DEFAULT_FABRIC_LOADER_VERSION.to_string()),
                java_major: None,
            }),
            status: GameInstanceStatus::Valid,
            created_at: chrono::Local::now().to_rfc3339(),
            last_verified_at: None,
        };

        let removed =
            remove_legacy_optimization_pack(app_data_dir, &instance).expect("legacy cleanup");
        assert_eq!(removed, 1);
        assert!(!managed.exists());
        assert!(replaced.exists());
        assert!(outside.exists());
        assert!(!manifest_path.exists());
    }

    #[test]
    fn tune_profile_memory_scales_up_on_big_machines() {
        let mut balanced = profile("balanced");
        tune_profile_memory(&mut balanced, 16 * 1024);
        assert_eq!(balanced.max_memory_mb, 5734);

        let mut quality = profile("quality");
        tune_profile_memory(&mut quality, 32 * 1024);
        assert_eq!(quality.max_memory_mb, 8192);
    }

    #[test]
    fn tune_profile_memory_leaves_headroom_on_small_machines() {
        let mut balanced = profile("balanced");
        tune_profile_memory(&mut balanced, 4 * 1024);
        assert!(balanced.max_memory_mb <= 2048);
        assert!(balanced.max_memory_mb >= balanced.min_memory_mb);

        let mut quality = profile("quality");
        tune_profile_memory(&mut quality, 8 * 1024);
        assert!(quality.max_memory_mb <= 8 * 1024 - 3072);
    }

    #[test]
    fn a_version_asset_is_found_whichever_prefix_the_index_uses() {
        let object = MojangAssetObject {
            hash: "abc123".to_string(),
            size: 42,
        };

        // Modern indexes prefix every key with the namespace.
        let mut modern = HashMap::new();
        modern.insert(
            "minecraft/textures/gui/title/background/panorama_0.png".to_string(),
            object.clone(),
        );
        assert_eq!(
            find_asset(&modern, "gui/title/background/panorama_0.png")
                .map(|found| found.hash.as_str()),
            Some("abc123")
        );

        // Older ones do not, and matching the whole key would find nothing
        // here — which looks exactly like "this version has no artwork".
        let mut legacy = HashMap::new();
        legacy.insert(
            "textures/gui/title/background/panorama_0.png".to_string(),
            object.clone(),
        );
        assert_eq!(
            find_asset(&legacy, "gui/title/background/panorama_0.png")
                .map(|found| found.hash.as_str()),
            Some("abc123")
        );

        // A version whose assets genuinely lack it reports nothing rather than
        // returning some other image.
        let mut without = HashMap::new();
        without.insert("minecraft/sounds/music/menu.ogg".to_string(), object);
        assert!(find_asset(&without, "gui/title/background/panorama_0.png").is_none());
    }

    #[test]
    fn build_java_args_uses_profile_when_config_is_auto() {
        let profile = profile("balanced");
        let config = crate::config_manager::AppConfig::default();
        let args = build_java_args(&profile, &config);
        assert_eq!(args[0], format!("-Xms{}M", profile.min_memory_mb));
        assert_eq!(args[1], format!("-Xmx{}M", profile.max_memory_mb));
    }

    #[test]
    fn build_java_args_applies_config_overrides_and_extra_args() {
        let profile = profile("balanced");
        let config = crate::config_manager::AppConfig {
            minecraft_min_memory_mb: Some(1024),
            minecraft_max_memory_mb: Some(8192),
            minecraft_extra_args: Some("-XX:MaxGCPauseMillis=40 -Dtest=1".to_string()),
            ..Default::default()
        };
        let args = build_java_args(&profile, &config);
        assert_eq!(args[0], "-Xms1024M");
        assert_eq!(args[1], "-Xmx8192M");
        assert!(args.contains(&"-XX:MaxGCPauseMillis=40".to_string()));
        assert!(args.contains(&"-Dtest=1".to_string()));
    }

    #[test]
    fn build_java_args_clamps_min_above_max() {
        let profile = profile("balanced");
        let config = crate::config_manager::AppConfig {
            minecraft_min_memory_mb: Some(6000),
            minecraft_max_memory_mb: Some(2048),
            ..Default::default()
        };
        let args = build_java_args(&profile, &config);
        assert_eq!(args[0], "-Xms2048M");
        assert_eq!(args[1], "-Xmx2048M");
    }

    // Network test: verifies the Fabric classpath actually contains the
    // loader jar (KnotClient main class) and the intermediary mappings.
    // Run manually with: cargo test --lib fabric_classpath -- --ignored
    #[tokio::test]
    #[ignore]
    async fn fabric_classpath_includes_loader_and_intermediary() {
        let dir = tempfile::tempdir().unwrap();
        let client = reqwest::Client::builder()
            .user_agent("KizaLauncherAlpha/0.1")
            .build()
            .unwrap();
        let (main_class, classpath) = download_fabric_loader_libs(
            dir.path(),
            &client,
            "1.21.8",
            "0.16.10",
            &MinecraftInstallManager::new(),
            "test-instance",
            0,
            0,
        )
        .await
        .expect("fabric libs must download");

        assert_eq!(
            main_class,
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        let has = |needle: &str| {
            classpath
                .iter()
                .any(|p| p.to_string_lossy().replace('\\', "/").contains(needle))
        };
        assert!(
            has("net/fabricmc/fabric-loader/"),
            "fabric-loader jar missing from classpath"
        );
        assert!(
            has("net/fabricmc/intermediary/"),
            "intermediary jar missing from classpath"
        );
        for path in &classpath {
            assert!(
                path.exists(),
                "classpath entry not downloaded: {}",
                path.display()
            );
        }
    }

    // Manual smoke test: launches the first installed instance offline for
    // ~30s, prints the game log tail, then kills the process.
    // Run with: cargo test --lib real_launch_smoke -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_launch_smoke() {
        let app_data_dir =
            PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("com.kizamods.engine");
        let games_dir = app_data_dir.join("games");
        let requested_instance = std::env::var("KIZA_SMOKE_INSTANCE_ID").ok();
        let instance_file = fs::read_dir(&games_dir)
            .expect("games dir")
            .filter_map(Result::ok)
            .find(|entry| {
                entry.path().extension().is_some_and(|ext| ext == "json")
                    && requested_instance.as_ref().is_none_or(|requested| {
                        entry
                            .path()
                            .file_stem()
                            .is_some_and(|stem| stem == std::ffi::OsStr::new(requested))
                    })
            })
            .expect("an installed instance");
        let instance: GameInstance =
            serde_json::from_str(&fs::read_to_string(instance_file.path()).unwrap()).unwrap();
        let instance_id = instance.id.clone();

        let (result, mut child, _state_bridge) = launch_minecraft(
            app_data_dir,
            instance,
            MinecraftLaunchRequest {
                instance_id,
                username: "KizaSmoke".to_string(),
                uuid: None,
                access_token: None,
                user_type: None,
            },
            LaunchManager::new(),
        )
        .await
        .expect("launch must spawn");
        println!("Launched PID {} via {}", result.pid, result.java);
        println!("Main class: {}", result.main_class);

        let smoke_duration = std::env::var("KIZA_SMOKE_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(30);
        tokio::time::sleep(std::time::Duration::from_secs(smoke_duration)).await;
        let still_running = child.try_wait().expect("try_wait").is_none();
        let log = fs::read_to_string(&result.log_path).unwrap_or_default();
        let tail: String = log
            .lines()
            .rev()
            .take(25)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        println!("--- latest.log tail ---\n{tail}");
        let _ = child.kill();
        assert!(
            still_running,
            "game process exited within 30s - check the log tail above"
        );
    }

    #[test]
    fn dedupe_classpath_keeps_highest_asm_version() {
        let libs = "libraries";
        let paths = vec![
            PathBuf::from(libs).join("org/ow2/asm/asm/9.6/asm-9.6.jar"),
            PathBuf::from(libs).join("org/ow2/asm/asm/9.7.1/asm-9.7.1.jar"),
            PathBuf::from(libs).join("net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar"),
        ];
        let out = dedupe_classpath(paths);
        assert_eq!(out.len(), 2, "the two ASM copies must collapse to one");
        // Natives classifier jars are distinct artifacts: keep BOTH the main
        // jar and its natives sibling (regression for the LWJGL module crash).
        let lwjgl = vec![
            PathBuf::from(libs).join("org/lwjgl/lwjgl-vma/3.3.3/lwjgl-vma-3.3.3.jar"),
            PathBuf::from(libs)
                .join("org/lwjgl/lwjgl-vma/3.3.3/lwjgl-vma-3.3.3-natives-windows.jar"),
        ];
        assert_eq!(dedupe_classpath(lwjgl).len(), 2);
        assert!(out
            .iter()
            .any(|p| p.to_string_lossy().contains("asm-9.7.1.jar")));
        assert!(!out
            .iter()
            .any(|p| p.to_string_lossy().contains("asm-9.6.jar")));
        assert!(out
            .iter()
            .any(|p| p.to_string_lossy().contains("fabric-loader-0.19.3.jar")));
    }

    #[test]
    fn required_java_major_matches_version_ranges() {
        assert_eq!(required_java_major(Some("1.7.10")), 8);
        assert_eq!(required_java_major(Some("1.16.5")), 8);
        assert_eq!(required_java_major(Some("1.17.1")), 17);
        assert_eq!(required_java_major(Some("1.20.4")), 17);
        assert_eq!(required_java_major(Some("1.20.5")), 21);
        assert_eq!(required_java_major(Some("1.21.1")), 21);
        assert_eq!(required_java_major(Some("26.2")), 25);
        assert_eq!(required_java_major(None), 21);
    }
}

#[cfg(test)]
mod account_launch_tests {
    use super::*;

    // Full command-path smoke test: refreshes the saved Microsoft account
    // token exactly like the launch command does, then launches with it.
    // Run with: cargo test --lib real_account_launch -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_account_launch_smoke() {
        let app_data_dir =
            PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("com.kizamods.engine");

        // Same auth path as launch_minecraft_instance.
        let client_id = crate::DEFAULT_MICROSOFT_CLIENT_ID.to_string();

        let state =
            crate::minecraft_auth::ensure_valid_minecraft_token(app_data_dir.clone(), &client_id)
                .await
                .expect("token refresh must succeed");
        println!(
            "Token OK for {} (uuid {})",
            state.account.username, state.account.uuid
        );

        let games_dir = app_data_dir.join("games");
        let instance_file = fs::read_dir(&games_dir)
            .expect("games dir")
            .filter_map(Result::ok)
            .find(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .expect("an installed instance");
        let instance: GameInstance =
            serde_json::from_str(&fs::read_to_string(instance_file.path()).unwrap()).unwrap();
        let instance_id = instance.id.clone();

        let (result, mut child, _state_bridge) = launch_minecraft(
            app_data_dir,
            instance,
            MinecraftLaunchRequest {
                instance_id,
                username: state.account.username,
                uuid: Some(state.account.uuid),
                access_token: Some(state.mc_access_token),
                user_type: Some("msa".to_string()),
            },
            LaunchManager::new(),
        )
        .await
        .expect("launch must spawn");
        println!("Launched PID {} via {}", result.pid, result.java);

        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let still_running = child.try_wait().expect("try_wait").is_none();
        let log = fs::read_to_string(&result.log_path).unwrap_or_default();
        let tail: String = log
            .lines()
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        println!("--- latest.log tail ---\n{tail}");
        let _ = child.kill();
        assert!(still_running, "game exited within 30s - see log tail above");
    }

    // Launches EVERY installed instance (fabric / vanilla / forge) for ~25s
    // each and asserts none of them crashes at boot.
    // Run with: cargo test --lib real_all_loaders -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_all_loaders_smoke() {
        let app_data_dir =
            PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("com.kizamods.engine");
        let games_dir = app_data_dir.join("games");
        let mut failures: Vec<String> = Vec::new();

        for entry in fs::read_dir(&games_dir).expect("games dir").flatten() {
            if entry.path().extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let instance: GameInstance =
                serde_json::from_str(&fs::read_to_string(entry.path()).unwrap()).unwrap();
            let label = instance
                .minecraft
                .as_ref()
                .map(|mc| format!("{:?} {}", mc.loader, mc.mc_version))
                .unwrap_or_default();
            let instance_id = instance.id.clone();
            println!("=== Launching {label} ({instance_id}) ===");

            let launched = launch_minecraft(
                app_data_dir.clone(),
                instance,
                MinecraftLaunchRequest {
                    instance_id,
                    username: "KizaSmoke".to_string(),
                    uuid: None,
                    access_token: None,
                    user_type: None,
                },
                LaunchManager::new(),
            )
            .await;

            match launched {
                Ok((result, mut child, _bridge)) => {
                    tokio::time::sleep(std::time::Duration::from_secs(25)).await;
                    let alive = child.try_wait().expect("try_wait").is_none();
                    if alive {
                        println!("{label}: ALIVE after 25s");
                    } else {
                        let log = fs::read_to_string(&result.log_path).unwrap_or_default();
                        let tail: String = log
                            .lines()
                            .rev()
                            .take(12)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect::<Vec<_>>()
                            .join("\n");
                        println!("{label}: CRASHED\n{tail}");
                        failures.push(label.clone());
                    }
                    let _ = child.kill();
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
                Err(error) => {
                    println!("{label}: launch error: {error}");
                    failures.push(label.clone());
                }
            }
        }

        assert!(failures.is_empty(), "loaders crashed: {failures:?}");
    }
}

#[cfg(test)]
mod receipt_migration_tests {
    use super::*;

    // Probe against the real instances: pre-receipt installs must self-heal
    // to Done instead of reporting a false "incomplete" error.
    // Run with: cargo test --lib real_receipt_probe -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_receipt_probe() {
        let app_data_dir =
            PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("com.kizamods.engine");
        for entry in fs::read_dir(app_data_dir.join("games"))
            .expect("games dir")
            .flatten()
        {
            if entry.path().extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let instance: GameInstance =
                serde_json::from_str(&fs::read_to_string(entry.path()).unwrap()).unwrap();
            let label = instance
                .minecraft
                .as_ref()
                .map(|mc| format!("{:?} {}", mc.loader, mc.mc_version))
                .unwrap_or_default();
            let status = restored_install_status(&app_data_dir, &instance);
            println!(
                "{label}: stage={:?} ready={} message={:?}",
                status.stage, status.ready, status.message
            );
            if let Err(error) = verify_minecraft_installation_ready(&app_data_dir, &instance, false)
            {
                println!("{label}: verify error -> {error}");
            }
        }
    }
}
