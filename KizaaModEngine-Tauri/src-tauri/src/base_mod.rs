use crate::game_manager::{GameInstance, MinecraftLoader};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const FABRIC_BASE_MOD_FILE_NAME: &str = "kiza-base-mod-fabric.jar";
const FORGE_BASE_MOD_FILE_NAME: &str = "kiza-base-mod-forge.jar";
const LEGACY_BASE_MOD_FILE_NAME: &str = "kiza-base-mod.jar";
const FABRIC_BASE_MOD_BYTES: &[u8] = include_bytes!("../assets/kiza-base-mod-fabric.jar");
const FORGE_BASE_MOD_BYTES: &[u8] = include_bytes!("../assets/kiza-base-mod-forge.jar");
const BRIDGE_SCHEMA_VERSION: u32 = 1;
const MAX_STATE_FILE_BYTES: u64 = 4 * 1024;
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
}

fn artifact_for(instance: &GameInstance) -> Option<BaseModArtifact> {
    let minecraft = instance.minecraft.as_ref()?;
    match minecraft.loader {
        MinecraftLoader::Vanilla => None,
        MinecraftLoader::Fabric => Some(BaseModArtifact {
            file_name: FABRIC_BASE_MOD_FILE_NAME,
            bytes: FABRIC_BASE_MOD_BYTES,
        }),
        MinecraftLoader::Forge => Some(BaseModArtifact {
            file_name: FORGE_BASE_MOD_FILE_NAME,
            bytes: FORGE_BASE_MOD_BYTES,
        }),
    }
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
        FORGE_BASE_MOD_FILE_NAME,
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
        fs::remove_file(&state_path)
            .or_else(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(error)
                }
            })
            .map_err(|error| format!("Could not clear the previous player state: {error}"))?;

        Ok(Self {
            instance_id: instance_id.to_string(),
            token: Uuid::new_v4().simple().to_string(),
            state_path,
        })
    }

    pub fn jvm_args(&self) -> [String; 3] {
        [
            format!("-Dkiza.state.path={}", self.state_path.to_string_lossy()),
            format!("-Dkiza.state.token={}", self.token),
            format!("-Dkiza.instance.id={}", self.instance_id),
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
}
