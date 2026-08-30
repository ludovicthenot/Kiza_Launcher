use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum GameInstanceStatus {
    Valid,
    MissingPath,
    InvalidSignature,
    NoWriteAccess,
    Unverified,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GameInstance {
    pub schema_version: i32,
    pub id: String,
    pub game_id: String, // "cyberpunk_2077", etc.
    pub display_name: String,
    pub install_path: String,
    pub executable_path: String,
    pub mods_path: String, // Staging/Storage path for this instance
    pub detected_variant: Option<String>,
    #[serde(default)]
    pub minecraft: Option<MinecraftInstanceConfig>,
    pub status: GameInstanceStatus,
    pub created_at: String,
    pub last_verified_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MinecraftLoader {
    Vanilla,
    Fabric,
    Forge,
    /// Named explicitly, because `snake_case` would make this `neo_forge`.
    ///
    /// The interface, the catalogues, every mod manifest and NeoForge itself
    /// write it as one word. Left to the rename rule the launcher was the only
    /// thing in the chain calling it something else, so asking for its loader
    /// versions failed to deserialize before reaching any of this code and the
    /// window reported that no build existed for a Minecraft version NeoForge
    /// has published forty-five of.
    #[serde(rename = "neoforge")]
    NeoForge,
}

impl MinecraftLoader {
    /// The installer family this loader is driven by, when it has one.
    ///
    /// NeoForge is a fork of Forge and kept its installer format, so the two
    /// share every step after the download; what differs is where the builds
    /// come from and how they are numbered.
    pub fn installer_family(&self) -> Option<crate::forge::Family> {
        match self {
            Self::Forge => Some(crate::forge::Family::Forge),
            Self::NeoForge => Some(crate::forge::Family::NeoForge),
            Self::Vanilla | Self::Fabric => None,
        }
    }

    /// The name shown to a person.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Vanilla => "Vanilla",
            Self::Fabric => "Fabric",
            Self::Forge => "Forge",
            Self::NeoForge => "NeoForge",
        }
    }

    /// The name the catalogues and mod manifests use.
    pub fn slug(&self) -> &'static str {
        match self {
            Self::Vanilla => "vanilla",
            Self::Fabric => "fabric",
            Self::Forge => "forge",
            Self::NeoForge => "neoforge",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftInstanceConfig {
    pub mc_version: String,
    pub loader: MinecraftLoader,
    pub loader_version: Option<String>,
    /// None uses the Java major declared by Mojang for the selected game version.
    #[serde(default)]
    pub java_major: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct GameInstanceSummary {
    #[serde(flatten)]
    pub instance: GameInstance,
    pub active_profile_id: Option<String>,
    pub mod_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GameSignature {
    pub id: String,
    pub name: String,
    pub executables: Vec<String>,
    pub required_paths: Vec<String>,
    pub optional_paths: Vec<String>,
}

pub struct GameManager {
    pub app_data_dir: PathBuf,
    signatures: Vec<GameSignature>,
}

impl GameManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let signatures = Vec::new();

        Self {
            app_data_dir,
            signatures,
        }
    }

    fn get_games_config_dir(&self) -> PathBuf {
        self.app_data_dir.join("games")
    }

    pub fn detect_game(
        &self,
        install_path: &Path,
    ) -> Option<(GameSignature, PathBuf, Option<String>)> {
        for sig in &self.signatures {
            let mut all_requirements_met = true;
            let mut found_exe = None;

            // Check required paths
            for req in &sig.required_paths {
                if !install_path.join(req).exists() {
                    all_requirements_met = false;
                    break;
                }
            }

            if all_requirements_met {
                // Determine executable location
                // 1. Try paths in required_paths that end with .exe
                for req in &sig.required_paths {
                    if req.to_lowercase().ends_with(".exe") {
                        found_exe = Some(install_path.join(req));
                        break;
                    }
                }

                // 2. If not found, try known executable names in common locations
                if found_exe.is_none() {
                    for exe in &sig.executables {
                        let root_try = install_path.join(exe);
                        if root_try.exists() {
                            found_exe = Some(root_try);
                            break;
                        }
                        let bin_try = install_path.join("bin/x64").join(exe);
                        if bin_try.exists() {
                            found_exe = Some(bin_try);
                            break;
                        }
                    }
                }

                if let Some(exe) = found_exe {
                    // Detect variant (simplified)
                    let variant = if install_path.join("goggame.info").exists() {
                        Some("GOG".to_string())
                    } else if install_path.join("steam_api64.dll").exists() || 
                              install_path.join("steam_api.dll").exists() ||
                              // Check common subfolders for Steam DLLs
                              install_path.join("bin/x64/steam_api64.dll").exists() ||
                              install_path.join("bin/x64/steam_api.dll").exists() ||
                              install_path.join("Engine/Binaries/ThirdParty/Steamworks").exists()
                    {
                        Some("Steam".to_string())
                    } else if install_path.join(".egstore").exists() {
                        Some("Epic".to_string())
                    } else {
                        Some("Generic".to_string())
                    };

                    return Some((sig.clone(), exe, variant));
                }
            }
        }
        None
    }

    pub fn add_game_instance(&self, _install_path_str: &str) -> Result<GameInstance, String> {
        Err(
            "Kiza Launcher only manages Minecraft instances. Create a Minecraft instance from the library."
                .to_string(),
        )
    }

    fn save_game_instance(&self, config: &GameInstance) -> Result<(), String> {
        let dir = self.get_games_config_dir();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let path = dir.join(format!("{}.json", config.id));
        let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_instances(&self) -> Vec<GameInstance> {
        let dir = self.get_games_config_dir();
        let mut instances = Vec::new();

        if dir.exists() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
                        match fs::read_to_string(entry.path()) {
                            Ok(content) => {
                                match serde_json::from_str::<GameInstance>(&content) {
                                    Ok(config) => {
                                        if config.game_id == "minecraft"
                                            || config.minecraft.is_some()
                                        {
                                            instances.push(config);
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "Failed to parse instance config {:?}: {}",
                                            entry.path(),
                                            e
                                        );
                                        // Skip corrupt instances instead of crashing
                                    }
                                }
                            }
                            Err(e) => eprintln!(
                                "Failed to read instance config {:?}: {}",
                                entry.path(),
                                e
                            ),
                        }
                    }
                }
            }
        }
        instances
    }
} // End of impl GameManager

pub enum ResolveResult {
    Resolved(Box<GameInstance>),
    Multiple(Vec<GameInstance>),
    NoMatch,
}

pub fn map_nexus_domain_to_game_id(game_domain: &str) -> Option<&'static str> {
    match game_domain {
        "minecraft" => Some("minecraft"),
        _ => None,
    }
}

impl GameManager {
    pub fn get_instance_by_id(&self, instance_id: &str) -> Result<GameInstance, String> {
        let path = self
            .get_games_config_dir()
            .join(format!("{}.json", instance_id));
        if !path.exists() {
            return Err("Instance not found".to_string());
        }

        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str::<GameInstance>(&content).map_err(|e| e.to_string())
    }

    pub fn resolve_target_instance(&self, game_domain: &str) -> ResolveResult {
        // Try mapped ID first, then fallback to exact match (custom games?)
        let expected_game_id = map_nexus_domain_to_game_id(game_domain);

        let all_instances = self.list_instances();
        let matches: Vec<GameInstance> = all_instances
            .into_iter()
            .filter(|instance| {
                if let Some(id) = expected_game_id {
                    instance.game_id == id
                } else {
                    instance.game_id == game_domain
                }
            })
            // Only valid instances are candidates for auto-install
            .filter(|instance| instance.status == GameInstanceStatus::Valid)
            .collect();

        if matches.is_empty() {
            ResolveResult::NoMatch
        } else if matches.len() == 1 {
            ResolveResult::Resolved(Box::new(matches[0].clone()))
        } else {
            ResolveResult::Multiple(matches)
        }
    }

    pub fn verify_instance(&self, instance_id: &str) -> Result<GameInstance, String> {
        let dir = self.get_games_config_dir();
        let path = dir.join(format!("{}.json", instance_id));

        if !path.exists() {
            return Err("Instance not found".to_string());
        }

        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut instance: GameInstance =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;

        let install_path = PathBuf::from(&instance.install_path);

        let mut new_status = GameInstanceStatus::Valid;

        if !install_path.exists() {
            new_status = GameInstanceStatus::MissingPath;
        } else if let Ok(metadata) = fs::metadata(&install_path) {
            if metadata.permissions().readonly() {
                new_status = GameInstanceStatus::NoWriteAccess;
            } else if instance.game_id != "minecraft" && self.detect_game(&install_path).is_none() {
                new_status = GameInstanceStatus::InvalidSignature;
            }
        } else {
            new_status = GameInstanceStatus::MissingPath;
        }

        if instance.status != new_status {
            instance.status = new_status;
            instance.last_verified_at = Some(chrono::Local::now().to_rfc3339());
            self.save_game_instance(&instance)?;
        }

        Ok(instance)
    }
}

#[cfg(test)]
mod loader_name_tests {
    use super::MinecraftLoader;

    /// What the interface sends is what serde has to accept.
    ///
    /// `rename_all = "snake_case"` turns `NeoForge` into `neo_forge`, and
    /// nothing else in the chain spells it that way: not the interface, not
    /// Modrinth, not CurseForge, not a mod manifest, not NeoForge. Every call
    /// naming the loader failed to deserialize before reaching any of this
    /// code, so the window said NeoForge had no build for a Minecraft version
    /// it has published forty-five of.
    #[test]
    fn a_loader_is_written_the_same_way_everywhere() {
        for (loader, expected) in [
            (MinecraftLoader::Vanilla, "vanilla"),
            (MinecraftLoader::Fabric, "fabric"),
            (MinecraftLoader::Forge, "forge"),
            (MinecraftLoader::NeoForge, "neoforge"),
        ] {
            let wire = serde_json::to_string(&loader).expect("serialisable");
            assert_eq!(wire, format!("\"{expected}\""));

            let back: MinecraftLoader =
                serde_json::from_str(&wire).expect("the launcher accepts what it sends");
            assert_eq!(back, loader);

            // The catalogues and the mod manifests use the same word, so the
            // two must not be allowed to drift apart.
            assert_eq!(loader.slug(), expected);
        }
    }
}
