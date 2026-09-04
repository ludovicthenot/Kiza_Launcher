use crate::game_manager::{GameInstance, MinecraftLoader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const FABRIC_BASE_MOD_FILE_NAME: &str = "kiza-base-mod-fabric.jar";
const LEGACY_FABRIC_BASE_MOD_FILE_NAME: &str = "kiza-base-mod-fabric-legacy.jar";
const FORGE_BASE_MOD_FILE_NAME: &str = "kiza-base-mod-forge.jar";
const LEGACY_FORGE_BASE_MOD_FILE_NAME: &str = "kiza-base-mod-forge-legacy.jar";
const MID_FORGE_BASE_MOD_FILE_NAME: &str = "kiza-base-mod-forge-mid.jar";
const LEGACY_BASE_MOD_FILE_NAME: &str = "kiza-base-mod.jar";
const FABRIC_BASE_MOD_BYTES: &[u8] = include_bytes!("../assets/kiza-base-mod-fabric.jar");
const LEGACY_FABRIC_BASE_MOD_BYTES: &[u8] =
    include_bytes!("../assets/kiza-base-mod-fabric-legacy.jar");
const FORGE_BASE_MOD_BYTES: &[u8] = include_bytes!("../assets/kiza-base-mod-forge.jar");
const LEGACY_FORGE_BASE_MOD_BYTES: &[u8] =
    include_bytes!("../assets/kiza-base-mod-forge-legacy.jar");
const MID_FORGE_BASE_MOD_BYTES: &[u8] = include_bytes!("../assets/kiza-base-mod-forge-mid.jar");
const BRIDGE_SCHEMA_VERSION: u32 = 1;
const MAX_STATE_FILE_BYTES: u64 = 4 * 1024;
const MAX_RUNTIME_REPORT_BYTES: u64 = 64 * 1024;
const MAX_STATE_AGE_MS: i64 = 10_000;
const MAX_FUTURE_SKEW_MS: i64 = 5_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BaseModInstallAction {
    NotApplicable,
    AlreadyInstalled,
    Installed,
    Repaired,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MinecraftPlayerState {
    Menu,
    Survival,
    Creative,
    Multiplayer,
    Unsupported,
}

#[derive(Clone, Copy)]
struct BaseModArtifact {
    file_name: &'static str,
    bytes: &'static [u8],
    variant: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct KizaClientModuleStatus {
    pub id: String,
    pub name: String,
    pub required: bool,
    pub status: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct KizaClientSupport {
    pub available: bool,
    pub installed: bool,
    /// True when this report was written by a launch that has since ended.
    ///
    /// The report is written once, at game start. Age alone says nothing — a
    /// six-hour session has a six-hour-old report and every word of it is still
    /// true — so what matters is whether the game it describes is still
    /// running. Without this the launcher showed a three-week-old "ready" as
    /// the present tense.
    pub from_last_launch: bool,
    pub runtime_variant: Option<String>,
    pub runtime_state: String,
    pub expected_capabilities: Vec<String>,
    pub active_capabilities: Vec<String>,
    pub modules: Vec<KizaClientModuleStatus>,
    pub last_reported_at_ms: Option<i64>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RuntimeReport {
    schema_version: u32,
    client_version: String,
    minecraft_version: String,
    loader: String,
    /// The loader name the runtime saw from inside the game.
    ///
    /// Checked rather than displayed. Which jar is deployed is already proven
    /// by its hash in `verify_installed`; this says which loader actually
    /// started it.
    platform: String,
    status: String,
    reported_at_ms: i64,
    capabilities: Vec<String>,
    modules: Vec<KizaClientModuleStatus>,
}

fn minecraft_minor(version: &str) -> Option<u32> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    if major >= 26 {
        return Some(u32::MAX);
    }
    if major != 1 {
        return None;
    }
    parts.next()?.parse().ok()
}

fn artifact_for(instance: &GameInstance) -> Option<BaseModArtifact> {
    let minecraft = instance.minecraft.as_ref()?;
    let minor = minecraft_minor(&minecraft.mc_version)?;
    match minecraft.loader {
        MinecraftLoader::Vanilla => None,
        MinecraftLoader::Fabric if minor >= 17 => Some(BaseModArtifact {
            file_name: FABRIC_BASE_MOD_FILE_NAME,
            bytes: FABRIC_BASE_MOD_BYTES,
            variant: "fabric-modern",
        }),
        MinecraftLoader::Fabric if (14..=16).contains(&minor) => Some(BaseModArtifact {
            file_name: LEGACY_FABRIC_BASE_MOD_FILE_NAME,
            bytes: LEGACY_FABRIC_BASE_MOD_BYTES,
            variant: "fabric-java8",
        }),
        MinecraftLoader::Forge if minor >= 17 => Some(BaseModArtifact {
            file_name: FORGE_BASE_MOD_FILE_NAME,
            bytes: FORGE_BASE_MOD_BYTES,
            variant: "forge-modern",
        }),
        // 1.13-1.16 already uses mods.toml, but the game runs on Java 8, so it
        // needs its own jar: same sources as the modern variant, Java 8 target.
        MinecraftLoader::Forge if (13..=16).contains(&minor) => Some(BaseModArtifact {
            file_name: MID_FORGE_BASE_MOD_FILE_NAME,
            bytes: MID_FORGE_BASE_MOD_BYTES,
            variant: "forge-java8-modern-manifest",
        }),
        // 1.7-1.12 Forge runs on Java 8 and predates mods.toml, so it gets the
        // Java 8 jar with mcmod.info and legacy GuiButton reflection.
        MinecraftLoader::Forge if (7..=12).contains(&minor) => Some(BaseModArtifact {
            file_name: LEGACY_FORGE_BASE_MOD_FILE_NAME,
            bytes: LEGACY_FORGE_BASE_MOD_BYTES,
            variant: "forge-java8-legacy",
        }),
        // NeoForge deliberately has no jar yet. Its mod entry point and event
        // bus live under `net.neoforged`, which the Forge variant does not
        // reference, so shipping the Forge jar here would produce a mod the
        // loader silently never starts. The instance still works; it is
        // launcher-only until a NeoForge variant is built and tested.
        MinecraftLoader::NeoForge => None,
        MinecraftLoader::Fabric | MinecraftLoader::Forge => None,
    }
}

pub fn is_supported(instance: &GameInstance) -> bool {
    artifact_for(instance).is_some()
}

pub fn support_for(
    instance: &GameInstance,
    app_data_dir: &Path,
    minecraft_running: bool,
) -> KizaClientSupport {
    let Some(minecraft) = instance.minecraft.as_ref() else {
        return unsupported("This is not a managed Minecraft instance.");
    };
    let Some(artifact) = artifact_for(instance) else {
        let reason = match minecraft.loader {
            MinecraftLoader::Vanilla => {
                "Kiza Client Runtime needs Fabric or Forge; Vanilla remains launcher-only."
            }
            MinecraftLoader::Fabric => {
                "Kiza Client Runtime supports Fabric from Minecraft 1.14 onward."
            }
            MinecraftLoader::Forge => {
                "Kiza Client Runtime supports Forge from Minecraft 1.7 onward."
            }
            MinecraftLoader::NeoForge => {
                "Kiza Client Runtime has no NeoForge build yet; the instance itself runs normally."
            }
        };
        return unsupported(reason);
    };

    let installed = verify_installed(instance).is_ok();
    let expected_capabilities = expected_capabilities()
        .iter()
        .map(|capability| (*capability).to_string())
        .collect();
    let report = installed
        .then(|| read_runtime_report(instance, app_data_dir, minecraft))
        .flatten();
    let reason = if installed {
        None
    } else {
        Some("Install or repair the instance to deploy Kiza Client Runtime.".to_string())
    };

    match report {
        Some(report) => KizaClientSupport {
            available: true,
            installed,
            from_last_launch: !minecraft_running,
            runtime_variant: Some(artifact.variant.to_string()),
            runtime_state: report.status,
            expected_capabilities,
            active_capabilities: report.capabilities,
            modules: report.modules,
            last_reported_at_ms: Some(report.reported_at_ms),
            reason,
        },
        None => KizaClientSupport {
            available: true,
            installed,
            from_last_launch: false,
            runtime_variant: Some(artifact.variant.to_string()),
            runtime_state: if installed {
                "not_started"
            } else {
                "not_installed"
            }
            .to_string(),
            expected_capabilities,
            active_capabilities: Vec::new(),
            modules: Vec::new(),
            last_reported_at_ms: None,
            reason,
        },
    }
}

fn unsupported(reason: &str) -> KizaClientSupport {
    KizaClientSupport {
        available: false,
        installed: false,
        from_last_launch: false,
        runtime_variant: None,
        runtime_state: "launcher_only".to_string(),
        expected_capabilities: Vec::new(),
        active_capabilities: Vec::new(),
        modules: Vec::new(),
        last_reported_at_ms: None,
        reason: Some(reason.to_string()),
    }
}

/// What the client runtime can provide on a version it fully supports.
///
/// Kept in step with the Java modules by `the_launcher_expects_what_the_client_
/// advertises`, which reads both declarations. Two hand-written lists that
/// nothing compares is how `ModInfo.files` took the interface down.
///
/// Writing the report is not on this list. It is not a module and never was:
/// the launcher gets the report whether or not anything else started, so
/// advertising it as a capability told the user nothing.
fn expected_capabilities() -> &'static [&'static str] {
    &[
        "menu-theme",
        "window-branding",
        "in-game-hud",
        "discord-presence-state",
        "local-state-bridge",
    ]
}

fn read_runtime_report(
    instance: &GameInstance,
    app_data_dir: &Path,
    minecraft: &crate::game_manager::MinecraftInstanceConfig,
) -> Option<RuntimeReport> {
    if validate_instance_id(&instance.id).is_err() {
        return None;
    }
    let path = app_data_dir
        .join("minecraft")
        .join("instances")
        .join(&instance.id)
        .join("runtime")
        .join("client-runtime.json");
    let metadata = fs::metadata(&path).ok()?;
    if metadata.len() > MAX_RUNTIME_REPORT_BYTES {
        return None;
    }
    let report: RuntimeReport = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let expected_loader = minecraft.loader.slug();
    if report.schema_version != 1
        || report.client_version != env!("CARGO_PKG_VERSION")
        || report.minecraft_version != minecraft.mc_version
        || report.loader != expected_loader
        || !report.platform.eq_ignore_ascii_case(expected_loader)
        || !matches!(report.status.as_str(), "ready" | "degraded" | "failed")
    {
        return None;
    }

    // A report stamped in the future is a clock nobody can reason about, and
    // the state bridge already refuses one on the same grounds.
    if let Ok(now) = unix_time_ms() {
        if report.reported_at_ms > now + MAX_FUTURE_SKEW_MS {
            return None;
        }
    }
    Some(report)
}

#[derive(Debug, Deserialize)]
struct StatePayload {
    schema_version: u32,
    instance_id: String,
    token: String,
    state: MinecraftPlayerState,
    updated_at_ms: i64,
    sequence: u64,
}

#[derive(Debug)]
pub struct StateBridgeSession {
    instance_id: String,
    token: String,
    state_path: PathBuf,
    config_path: PathBuf,
    report_path: PathBuf,
}

pub fn ensure_installed(instance: &GameInstance) -> Result<BaseModInstallAction, String> {
    let Some(artifact) = artifact_for(instance) else {
        return Ok(BaseModInstallAction::NotApplicable);
    };

    let mods_dir = PathBuf::from(&instance.install_path).join("mods");
    fs::create_dir_all(&mods_dir).map_err(|error| {
        format!(
            "Could not create the Kiza base mod directory {}: {error}",
            mods_dir.display()
        )
    })?;
    let destination = mods_dir.join(artifact.file_name);
    for stale_name in [
        FABRIC_BASE_MOD_FILE_NAME,
        LEGACY_FABRIC_BASE_MOD_FILE_NAME,
        FORGE_BASE_MOD_FILE_NAME,
        LEGACY_FORGE_BASE_MOD_FILE_NAME,
        MID_FORGE_BASE_MOD_FILE_NAME,
        LEGACY_BASE_MOD_FILE_NAME,
    ] {
        if stale_name != artifact.file_name {
            let stale_path = mods_dir.join(stale_name);
            fs::remove_file(&stale_path)
                .or_else(|error| {
                    if error.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(error)
                    }
                })
                .map_err(|error| {
                    format!(
                        "Could not remove the incompatible Kiza base mod {}: {error}",
                        stale_path.display()
                    )
                })?;
        }
    }

    let expected_hash = sha256_hex(artifact.bytes);
    let existed = destination.exists();
    if existed && sha256_hex_of_file(&destination).as_deref() == Ok(expected_hash.as_str()) {
        return Ok(BaseModInstallAction::AlreadyInstalled);
    }

    let temporary = mods_dir.join(format!(".{}.{}.tmp", artifact.file_name, Uuid::new_v4()));
    fs::write(&temporary, artifact.bytes).map_err(|error| {
        format!(
            "Could not stage the Kiza base mod at {}: {error}",
            temporary.display()
        )
    })?;

    if destination.exists() {
        fs::remove_file(&destination).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!(
                "Could not replace the Kiza base mod at {}: {error}",
                destination.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Could not install the Kiza base mod at {}: {error}",
            destination.display()
        ));
    }

    if sha256_hex_of_file(&destination).as_deref() != Ok(expected_hash.as_str()) {
        return Err("The installed Kiza base mod failed its integrity check.".to_string());
    }
    Ok(if existed {
        BaseModInstallAction::Repaired
    } else {
        BaseModInstallAction::Installed
    })
}

pub fn verify_installed(instance: &GameInstance) -> Result<(), String> {
    let Some(artifact) = artifact_for(instance) else {
        return Ok(());
    };
    let path = PathBuf::from(&instance.install_path)
        .join("mods")
        .join(artifact.file_name);
    if !path.exists() {
        return Err(format!(
            "The required Kiza base mod {} is missing.",
            artifact.file_name
        ));
    }
    let expected_hash = sha256_hex(artifact.bytes);
    let actual_hash = sha256_hex_of_file(&path)?;
    if actual_hash != expected_hash {
        return Err(format!(
            "The required Kiza base mod {} failed its integrity check.",
            artifact.file_name
        ));
    }
    Ok(())
}

impl StateBridgeSession {
    pub fn new(app_data_dir: &Path, instance_id: &str) -> Result<Self, String> {
        validate_instance_id(instance_id)?;
        let app_data_dir = absolute_path(app_data_dir)?;
        let state_dir = app_data_dir
            .join("minecraft")
            .join("instances")
            .join(instance_id)
            .join("runtime");
        fs::create_dir_all(&state_dir).map_err(|error| {
            format!(
                "Could not create the Kiza state bridge directory {}: {error}",
                state_dir.display()
            )
        })?;

        let state_path = state_dir.join("player-state.json");
        let config_path = state_dir.join("client.properties");
        let report_path = state_dir.join("client-runtime.json");
        // Both files are cleared, not just the state one. The report survived
        // the session that wrote it, so an instance last played three weeks ago
        // still answered "ready, four capabilities" — and a launch that crashed
        // after writing the report left that claim standing. Whatever is here
        // after this line was written by the launch starting now.
        for previous in [&state_path, &report_path] {
            fs::remove_file(previous)
                .or_else(|error| {
                    if error.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(error)
                    }
                })
                .map_err(|error| {
                    format!(
                        "Could not clear {}: {error}",
                        previous.file_name().unwrap_or_default().to_string_lossy()
                    )
                })?;
        }

        Ok(Self {
            instance_id: instance_id.to_string(),
            token: Uuid::new_v4().simple().to_string(),
            state_path,
            config_path,
            report_path,
        })
    }

    pub fn jvm_args(
        &self,
        minecraft_version: &str,
        loader: &str,
        player_name: &str,
    ) -> Vec<String> {
        vec![
            format!("-Dkiza.state.path={}", self.state_path.to_string_lossy()),
            format!("-Dkiza.state.token={}", self.token),
            format!("-Dkiza.instance.id={}", self.instance_id),
            format!("-Dkiza.client.version={}", env!("CARGO_PKG_VERSION")),
            format!("-Dkiza.minecraft.version={minecraft_version}"),
            format!("-Dkiza.minecraft.loader={loader}"),
            format!("-Dkiza.player.name={player_name}"),
            format!(
                "-Dkiza.client.config.path={}",
                self.config_path.to_string_lossy()
            ),
            format!(
                "-Dkiza.client.report.path={}",
                self.report_path.to_string_lossy()
            ),
        ]
    }

    pub fn read_state(&self) -> Result<Option<MinecraftPlayerState>, String> {
        let metadata = match fs::metadata(&self.state_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("Could not inspect player state: {error}")),
        };
        if metadata.len() > MAX_STATE_FILE_BYTES {
            return Err("Player state payload exceeds the local bridge limit.".to_string());
        }

        let bytes = fs::read(&self.state_path)
            .map_err(|error| format!("Could not read player state: {error}"))?;
        let payload: StatePayload = serde_json::from_slice(&bytes)
            .map_err(|error| format!("Invalid player state payload: {error}"))?;
        if payload.schema_version != BRIDGE_SCHEMA_VERSION
            || payload.instance_id != self.instance_id
            || payload.token != self.token
            || payload.sequence == 0
        {
            return Ok(None);
        }

        let now = unix_time_ms()?;
        if payload.updated_at_ms < now - MAX_STATE_AGE_MS
            || payload.updated_at_ms > now + MAX_FUTURE_SKEW_MS
        {
            return Ok(None);
        }
        Ok(Some(payload.state))
    }

    pub fn cleanup(&self) {
        let _ = fs::remove_file(&self.state_path);
    }
}

impl Drop for StateBridgeSession {
    fn drop(&mut self) {
        self.cleanup();
    }
}

fn validate_instance_id(instance_id: &str) -> Result<(), String> {
    let valid = !instance_id.is_empty()
        && instance_id.len() <= 64
        && instance_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if valid {
        Ok(())
    } else {
        Err("Invalid instance ID for the local player-state bridge.".to_string())
    }
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    std::env::current_dir()
        .map(|current| current.join(path))
        .map_err(|error| format!("Could not resolve the state bridge path: {error}"))
}

fn unix_time_ms() -> Result<i64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock is before the Unix epoch: {error}"))?;
    i64::try_from(duration.as_millis()).map_err(|_| "System time is out of range.".to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn sha256_hex_of_file(path: &Path) -> Result<String, String> {
    fs::read(path)
        .map(|bytes| sha256_hex(&bytes))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_manager::{GameInstanceStatus, MinecraftInstanceConfig};
    use std::time::Duration;

    fn fabric_instance(root: &Path) -> GameInstance {
        GameInstance {
            schema_version: 1,
            id: "12345678-1234-1234-1234-123456789abc".to_string(),
            game_id: "minecraft".to_string(),
            display_name: "Test".to_string(),
            install_path: root.to_string_lossy().to_string(),
            executable_path: String::new(),
            mods_path: root.join("staging").to_string_lossy().to_string(),
            detected_variant: Some("Managed".to_string()),
            minecraft: Some(MinecraftInstanceConfig {
                mc_version: "1.21.8".to_string(),
                loader: MinecraftLoader::Fabric,
                loader_version: Some("0.16.10".to_string()),
                java_major: None,
            }),
            status: GameInstanceStatus::Valid,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            last_verified_at: None,
        }
    }

    #[test]
    fn installs_and_repairs_the_managed_jar() {
        let directory = tempfile::tempdir().unwrap();
        let instance = fabric_instance(directory.path());
        assert_eq!(
            ensure_installed(&instance).unwrap(),
            BaseModInstallAction::Installed
        );
        assert_eq!(
            ensure_installed(&instance).unwrap(),
            BaseModInstallAction::AlreadyInstalled
        );

        let jar = directory
            .path()
            .join("mods")
            .join(FABRIC_BASE_MOD_FILE_NAME);
        fs::write(&jar, b"corrupt").unwrap();
        assert_eq!(
            ensure_installed(&instance).unwrap(),
            BaseModInstallAction::Repaired
        );
        assert_eq!(fs::read(jar).unwrap(), FABRIC_BASE_MOD_BYTES);
    }

    #[test]
    fn keeps_fabric_and_forge_artifacts_separate() {
        let directory = tempfile::tempdir().unwrap();
        let mut instance = fabric_instance(directory.path());
        ensure_installed(&instance).unwrap();
        let mods = directory.path().join("mods");
        assert!(mods.join(FABRIC_BASE_MOD_FILE_NAME).exists());
        assert!(!mods.join(FORGE_BASE_MOD_FILE_NAME).exists());

        instance.minecraft.as_mut().unwrap().loader = MinecraftLoader::Forge;
        ensure_installed(&instance).unwrap();
        assert!(!mods.join(FABRIC_BASE_MOD_FILE_NAME).exists());
        assert!(mods.join(FORGE_BASE_MOD_FILE_NAME).exists());
        assert_eq!(
            fs::read(mods.join(FORGE_BASE_MOD_FILE_NAME)).unwrap(),
            FORGE_BASE_MOD_BYTES
        );
    }

    // This used to assert that 1.8 Forge got nothing at all. It now gets the
    // Java 8 jar instead, so the assertion is that it gets the *legacy* one and
    // never the modern one, which its JVM could not load.
    #[test]
    fn legacy_forge_gets_the_java_8_jar_and_not_the_modern_one() {
        let directory = tempfile::tempdir().unwrap();
        let mut instance = fabric_instance(directory.path());
        let minecraft = instance.minecraft.as_mut().unwrap();
        minecraft.mc_version = "1.8.9".to_string();
        minecraft.loader = MinecraftLoader::Forge;
        minecraft.loader_version = Some("11.15.1.2318".to_string());

        assert!(is_supported(&instance));
        assert_eq!(
            ensure_installed(&instance).unwrap(),
            BaseModInstallAction::Installed
        );

        let mods = directory.path().join("mods");
        assert!(mods.join(LEGACY_FORGE_BASE_MOD_FILE_NAME).exists());
        assert!(!mods.join(FORGE_BASE_MOD_FILE_NAME).exists());
    }

    // 1.13-1.16 used to fall between the two manifest formats. It now has its
    // own jar: mods.toml like modern Forge, Java 8 bytecode like the game.
    #[test]
    fn the_middle_generation_gets_the_java_8_mods_toml_jar() {
        let directory = tempfile::tempdir().unwrap();
        let mut instance = fabric_instance(directory.path());
        let minecraft = instance.minecraft.as_mut().unwrap();
        minecraft.mc_version = "1.16.5".to_string();
        minecraft.loader = MinecraftLoader::Forge;

        assert!(is_supported(&instance));
        ensure_installed(&instance).unwrap();

        let mods = directory.path().join("mods");
        assert!(mods.join(MID_FORGE_BASE_MOD_FILE_NAME).exists());
        // The modern jar would fail to load on Java 8, the legacy one declares
        // mcmod.info which 1.13+ ignores.
        assert!(!mods.join(FORGE_BASE_MOD_FILE_NAME).exists());
        assert!(!mods.join(LEGACY_FORGE_BASE_MOD_FILE_NAME).exists());
    }

    #[test]
    fn old_fabric_gets_the_java_8_jar_and_manifest() {
        let directory = tempfile::tempdir().unwrap();
        let mut instance = fabric_instance(directory.path());
        instance.minecraft.as_mut().unwrap().mc_version = "1.16.5".to_string();

        assert!(is_supported(&instance));
        ensure_installed(&instance).unwrap();

        let mods = directory.path().join("mods");
        assert!(mods.join(LEGACY_FABRIC_BASE_MOD_FILE_NAME).exists());
        assert!(!mods.join(FABRIC_BASE_MOD_FILE_NAME).exists());

        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(LEGACY_FABRIC_BASE_MOD_BYTES))
            .expect("legacy Fabric jar");
        let mut manifest = String::new();
        std::io::Read::read_to_string(
            &mut archive.by_name("fabric.mod.json").expect("fabric.mod.json"),
            &mut manifest,
        )
        .expect("read fabric.mod.json");
        assert!(manifest.contains(r#""minecraft": ">=1.14 <1.17""#));
        assert!(manifest.contains(r#""java": ">=8""#));
    }

    /// The two Fabric manifests meet exactly at 1.17, and the modern one asks
    /// for the Java it was compiled against.
    ///
    /// It used to declare `"java": ">=17"` while the jar targets 16 — which is
    /// deliberate, because 1.17 runs on Java 16 and rejects newer bytecode. So
    /// on the one version that floor existed to serve, Fabric Loader refused to
    /// load the mod for asking for a Java the game does not use. The bound was
    /// `"minecraft": "*"` as well, leaving the modern jar willing to load on
    /// versions that now have a jar of their own.
    #[test]
    fn the_two_fabric_manifests_meet_at_the_version_the_launcher_switches_on() {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(FABRIC_BASE_MOD_BYTES))
            .expect("modern Fabric jar");
        let mut manifest = String::new();
        std::io::Read::read_to_string(
            &mut archive.by_name("fabric.mod.json").expect("fabric.mod.json"),
            &mut manifest,
        )
        .expect("read fabric.mod.json");

        assert!(
            manifest.contains(r#""minecraft": ">=1.17""#),
            "the modern jar does not stop where the Java 8 jar starts: {manifest}"
        );
        assert!(
            manifest.contains(r#""java": ">=16""#),
            "the modern jar asks for a Java it was not compiled for: {manifest}"
        );
    }

    // Each supported loader generation receives bytecode compatible with the
    // Java runtime used by that Minecraft version.
    #[test]
    fn the_support_floor_follows_the_java_the_game_runs_on() {
        let directory = tempfile::tempdir().unwrap();
        let mut instance = fabric_instance(directory.path());

        for (version, loader, expected) in [
            ("1.17.1", MinecraftLoader::Fabric, true),
            ("1.17.1", MinecraftLoader::Forge, true),
            ("1.14.4", MinecraftLoader::Fabric, true),
            ("1.16.5", MinecraftLoader::Fabric, true),
            ("1.16.5", MinecraftLoader::Forge, true),
            // Branding-only, through the Java 8 jar.
            ("1.8.9", MinecraftLoader::Forge, true),
            ("1.12.2", MinecraftLoader::Forge, true),
            ("1.12.2", MinecraftLoader::Fabric, false),
            ("1.21.8", MinecraftLoader::Fabric, true),
            ("1.21.8", MinecraftLoader::Vanilla, false),
        ] {
            let described = format!("{version} {loader:?}");
            let minecraft = instance.minecraft.as_mut().unwrap();
            minecraft.mc_version = version.to_string();
            minecraft.loader = loader;
            assert_eq!(is_supported(&instance), expected, "{described} support");
        }
    }

    // The install gate and the jar's own manifest have to agree: shipping the
    // mod to Forge 1.17 while mods.toml still demands Forge 40 only produces a
    // "Missing language javafml version" rejection at startup.
    #[test]
    fn the_forge_manifest_accepts_every_version_we_ship_it_to() {
        let mut archive =
            zip::ZipArchive::new(std::io::Cursor::new(FORGE_BASE_MOD_BYTES)).expect("forge jar");
        let mut manifest = String::new();
        std::io::Read::read_to_string(
            &mut archive.by_name("META-INF/mods.toml").expect("mods.toml"),
            &mut manifest,
        )
        .expect("read mods.toml");

        assert!(
            manifest.contains("loaderVersion=\"[37,)\""),
            "Forge 1.17.1 ships FML 37: {manifest}"
        );
        assert!(
            manifest.contains("versionRange=\"[1.17,)\""),
            "the mod is installed from 1.17 upwards: {manifest}"
        );
    }

    #[test]
    fn accepts_only_fresh_authenticated_state() {
        let directory = tempfile::tempdir().unwrap();
        let session =
            StateBridgeSession::new(directory.path(), "12345678-1234-1234-1234-123456789abc")
                .unwrap();
        let write_payload = |token: &str, updated_at_ms: i64| {
            fs::write(
                &session.state_path,
                format!(
                    "{{\"schema_version\":1,\"instance_id\":\"{}\",\"token\":\"{}\",\"state\":\"survival\",\"updated_at_ms\":{},\"sequence\":1}}",
                    session.instance_id, token, updated_at_ms
                ),
            )
            .unwrap();
        };

        write_payload(&session.token, unix_time_ms().unwrap());
        assert_eq!(
            session.read_state().unwrap(),
            Some(MinecraftPlayerState::Survival)
        );

        write_payload("00000000000000000000000000000000", unix_time_ms().unwrap());
        assert_eq!(session.read_state().unwrap(), None);

        let stale =
            unix_time_ms().unwrap() - i64::try_from((Duration::from_secs(20)).as_millis()).unwrap();
        write_payload(&session.token, stale);
        assert_eq!(session.read_state().unwrap(), None);
    }

    #[test]
    fn rejects_path_like_instance_ids() {
        let directory = tempfile::tempdir().unwrap();
        assert!(StateBridgeSession::new(directory.path(), "../other").is_err());
    }

    #[test]
    fn bridge_passes_safe_client_branding_to_minecraft() {
        let directory = tempfile::tempdir().unwrap();
        let session =
            StateBridgeSession::new(directory.path(), "12345678-1234-1234-1234-123456789abc")
                .unwrap();
        let args = session.jvm_args("1.21.11", "fabric", "KizaPlayer");

        assert!(args
            .iter()
            .any(|arg| arg == concat!("-Dkiza.client.version=", env!("CARGO_PKG_VERSION"))));
        assert!(args
            .iter()
            .any(|arg| arg == "-Dkiza.minecraft.version=1.21.11"));
        assert!(args
            .iter()
            .any(|arg| arg == "-Dkiza.minecraft.loader=fabric"));
        assert!(args
            .iter()
            .any(|arg| arg == "-Dkiza.player.name=KizaPlayer"));
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("-Dkiza.client.config.path=")));
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("-Dkiza.client.report.path=")));
    }

    /// The launcher's idea of what the client can do, against the client's.
    ///
    /// Two hand-written lists in two languages that nothing compared is exactly
    /// how `ModInfo.files` reached the interface as `undefined` and took the
    /// whole window down. This reads both declarations and fails when they
    /// drift, so the mismatch is a red test rather than a capability the user
    /// is promised and never gets.
    #[test]
    fn the_launcher_expects_what_the_client_advertises() {
        const CLIENT: &str = include_str!(
            "../../kiza-base-mod/src/common/java/fr/kiza/basemod/KizaClientManager.java"
        );

        let mut advertised: Vec<String> = Vec::new();
        let mut rest = CLIENT;
        while let Some(at) = rest.find("capabilities(\"") {
            rest = &rest[at + "capabilities(".len()..];
            let Some(end) = rest.find(')') else { break };
            let (list, after) = rest.split_at(end);
            rest = after;
            for piece in list.split('"').skip(1).step_by(2) {
                advertised.push(piece.to_string());
            }
        }
        advertised.sort();
        advertised.dedup();

        let mut expected: Vec<String> = expected_capabilities()
            .iter()
            .map(|capability| (*capability).to_string())
            .collect();
        expected.sort();

        assert!(
            !advertised.is_empty(),
            "no capabilities were found in KizaClientManager.java; the parser or the file moved"
        );
        assert_eq!(
            expected, advertised,
            "the launcher and the client runtime disagree about what the client provides"
        );
    }

    #[test]
    fn exposes_an_explicit_client_support_contract() {
        let directory = tempfile::tempdir().unwrap();
        let mut instance = fabric_instance(directory.path());
        ensure_installed(&instance).unwrap();

        let support = support_for(&instance, directory.path(), false);
        assert!(support.available);
        assert!(support.installed);
        assert_eq!(support.runtime_variant.as_deref(), Some("fabric-modern"));
        assert_eq!(support.runtime_state, "not_started");
        assert!(support
            .expected_capabilities
            .contains(&"menu-theme".to_string()));

        instance.minecraft.as_mut().unwrap().loader = MinecraftLoader::Vanilla;
        let vanilla = support_for(&instance, directory.path(), false);
        assert!(!vanilla.available);
        assert_eq!(vanilla.runtime_state, "launcher_only");
        assert!(vanilla.reason.unwrap().contains("Fabric or Forge"));
    }

    #[test]
    fn accepts_only_a_report_for_the_current_client_and_instance() {
        let directory = tempfile::tempdir().unwrap();
        let instance = fabric_instance(directory.path());
        ensure_installed(&instance).unwrap();
        let report_dir = directory
            .path()
            .join("minecraft")
            .join("instances")
            .join(&instance.id)
            .join("runtime");
        fs::create_dir_all(&report_dir).unwrap();
        fs::write(
            report_dir.join("client-runtime.json"),
            format!(
                "{{\"schema_version\":1,\"client_version\":\"{}\",\"minecraft_version\":\"1.21.8\",\"loader\":\"fabric\",\"platform\":\"Fabric\",\"status\":\"ready\",\"reported_at_ms\":123,\"capabilities\":[\"menu-theme\"],\"modules\":[{{\"id\":\"ui\",\"name\":\"Launcher UI\",\"required\":false,\"status\":\"ready\",\"detail\":\"Ready\"}}]}}",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .unwrap();

        let support = support_for(&instance, directory.path(), false);
        assert_eq!(support.runtime_state, "ready");
        assert_eq!(support.active_capabilities, vec!["menu-theme"]);
        assert_eq!(support.modules.len(), 1);
        assert_eq!(support.last_reported_at_ms, Some(123));

        let report_path = report_dir.join("client-runtime.json");
        let invalid = fs::read_to_string(&report_path)
            .unwrap()
            .replace("1.21.8", "1.20.1");
        fs::write(report_path, invalid).unwrap();
        assert_eq!(
            support_for(&instance, directory.path(), false).runtime_state,
            "not_started"
        );
    }
}
