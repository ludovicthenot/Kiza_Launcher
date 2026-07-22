use crate::credential_store::{self, NEXUS_API_KEY};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    #[serde(default, skip_serializing)]
    pub nexus_api_key: Option<String>,
    #[serde(default = "default_true")]
    pub enable_discord_rpc: bool,
    /// Show the Minecraft version in the Discord presence while in game.
    #[serde(default = "default_true")]
    pub discord_show_mc_version: bool,
    /// Show the instance name in the Discord presence while in game.
    #[serde(default = "default_true")]
    pub discord_show_instance_name: bool,
    /// Hide the launcher to the system tray while the game is running.
    #[serde(default)]
    pub close_to_tray_on_launch: bool,
    /// Open a separate Kiza Manager log window when the game launches.
    #[serde(default = "default_true")]
    pub open_log_window_on_launch: bool,
    #[serde(default)]
    pub minecraft_java_path: Option<String>,
    #[serde(default)]
    pub minecraft_min_memory_mb: Option<u32>,
    #[serde(default)]
    pub minecraft_max_memory_mb: Option<u32>,
    #[serde(default)]
    pub minecraft_extra_args: Option<String>,
    /// Hide snapshots, pre-releases and release candidates in version pickers.
    #[serde(default = "default_true")]
    pub minecraft_releases_only: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            nexus_api_key: None,
            enable_discord_rpc: true,
            discord_show_mc_version: true,
            discord_show_instance_name: true,
            close_to_tray_on_launch: false,
            open_log_window_on_launch: true,
            minecraft_java_path: None,
            // None means "auto": the performance profile sizes memory from the
            // machine's total RAM. Explicit values here override the profile.
            minecraft_min_memory_mb: None,
            minecraft_max_memory_mb: None,
            minecraft_extra_args: None,
            minecraft_releases_only: true,
        }
    }
}

pub struct ConfigManager {
    pub app_data_dir: PathBuf,
}

impl ConfigManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self { app_data_dir }
    }

    fn get_config_path(&self) -> PathBuf {
        self.app_data_dir.join("config").join("app_settings.json")
    }

    pub fn load_config(&self) -> AppConfig {
        let path = self.get_config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    match serde_json::from_str::<AppConfig>(&content) {
                        Ok(mut config) => {
                            if let Some(api_key) = config.nexus_api_key.take() {
                                if !api_key.trim().is_empty() {
                                    if let Err(e) =
                                        credential_store::set_secret(NEXUS_API_KEY, &api_key)
                                    {
                                        eprintln!("[WARN] [ConfigManager] Failed to migrate Nexus key to OS keyring: {}", e);
                                    } else if let Err(e) = self.save_config(&config) {
                                        eprintln!("[WARN] [ConfigManager] Failed to remove migrated Nexus key from config file: {}", e);
                                    }
                                }
                            }
                            config
                        }
                        Err(e) => {
                            eprintln!("[ERROR] [ConfigManager] Failed to parse config file: {}. Returning default.", e);
                            // Option: Backup corrupt config?
                            // For now, safe default is better than crash.
                            AppConfig::default()
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[ERROR] [ConfigManager] Failed to read config file: {}. Returning default.", e);
                    AppConfig::default()
                }
            }
        } else {
            AppConfig::default()
        }
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<(), String> {
        let path = self.get_config_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::AppConfig;

    #[test]
    fn legacy_config_defaults_to_release_versions_only() {
        let config: AppConfig = serde_json::from_str("{}").expect("config should deserialize");
        assert!(config.minecraft_releases_only);
    }
}
