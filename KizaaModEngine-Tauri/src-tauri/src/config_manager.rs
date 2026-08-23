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
    /// Closing the window hides the launcher to the tray instead of quitting,
    /// so downloads and a running game survive a stray click on the cross.
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
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

    // --- General -----------------------------------------------------------
    /// What the window's close button does: "tray" or "quit".
    #[serde(default = "default_close_action")]
    pub close_button_action: String,
    /// Quit the launcher once the game has started.
    #[serde(default)]
    pub quit_after_launch: bool,
    /// Check the instance's files before playing.
    #[serde(default = "default_true")]
    pub verify_before_launch: bool,
    /// What happens after a crash: "report", "silent" or "safe_mode".
    #[serde(default = "default_crash_action")]
    pub crash_action: String,
    /// Fetch an available update in the background; installing stays a choice.
    #[serde(default = "default_true")]
    pub auto_download_updates: bool,
    /// Release channel followed by the updater.
    #[serde(default = "default_channel")]
    pub update_channel: String,

    // --- Downloads ---------------------------------------------------------
    /// How many files may download at once. Clamped by the download manager,
    /// which owns the range that actually helps.
    #[serde(default = "default_download_concurrency")]
    pub download_concurrency: u32,

    // --- Notifications -----------------------------------------------------
    /// The Windows notice shown the first time closing the window hides Kiza
    /// rather than quitting it. Without it, a launcher that vanishes from the
    /// screen but keeps downloading looks like a launcher that crashed.
    #[serde(default = "default_true")]
    pub notify_background: bool,
    /// Tell the user when an update has finished downloading and is ready.
    #[serde(default = "default_true")]
    pub notify_update_ready: bool,
    /// Tell the user when the download queue empties.
    #[serde(default)]
    pub notify_downloads_finished: bool,

    // --- Notification channels ---------------------------------------------
    /// The master switch for Windows notifications. Off means Kiza never
    /// reaches outside its own window, whatever the per-event switches say.
    #[serde(default = "default_true")]
    pub notify_windows: bool,
    /// Messages inside the launcher window.
    #[serde(default = "default_true")]
    pub notify_in_app: bool,
    /// A short sound alongside an in-app message.
    #[serde(default)]
    pub notify_sound: bool,
    /// Where in-app messages appear: "top-left", "top-center", "top-right",
    /// "bottom-left", "bottom-center" or "bottom-right".
    #[serde(default = "default_toast_position")]
    pub notify_position: String,
    /// Tell the user when the game has started.
    #[serde(default)]
    pub notify_game_started: bool,
    /// Tell the user when a world backup has finished.
    #[serde(default = "default_true")]
    pub notify_backup_done: bool,

    // --- Quiet hours -------------------------------------------------------
    /// Hold notifications back while Minecraft is running.
    #[serde(default = "default_true")]
    pub dnd_during_game: bool,
    /// Hold notifications back between `dnd_from` and `dnd_to`.
    #[serde(default)]
    pub dnd_quiet_hours: bool,
    /// Start of the quiet period, as "HH:MM".
    #[serde(default = "default_quiet_from")]
    pub dnd_from: String,
    /// End of the quiet period, as "HH:MM". Earlier than the start means the
    /// period runs over midnight.
    #[serde(default = "default_quiet_to")]
    pub dnd_to: String,
    /// Let a crash or a failed update through the quiet period anyway.
    #[serde(default = "default_true")]
    pub dnd_allow_critical: bool,

    // --- Advanced ----------------------------------------------------------
    /// How many days of log files to keep. Zero keeps every one of them.
    #[serde(default = "default_log_retention_days")]
    pub log_retention_days: u32,

    // --- Region ------------------------------------------------------------
    /// How clocks are written: "system", "24h" or "12h".
    #[serde(default = "default_system")]
    pub time_format: String,
    /// How dates are written: "system", "dmy", "mdy" or "ymd".
    #[serde(default = "default_system")]
    pub date_format: String,
}

fn default_download_concurrency() -> u32 {
    3
}

fn default_system() -> String {
    "system".to_string()
}

fn default_close_action() -> String {
    "tray".to_string()
}

fn default_crash_action() -> String {
    "report".to_string()
}

fn default_channel() -> String {
    "stable".to_string()
}

fn default_true() -> bool {
    true
}

fn default_toast_position() -> String {
    "bottom-right".to_string()
}

fn default_quiet_from() -> String {
    "22:00".to_string()
}

fn default_quiet_to() -> String {
    "08:00".to_string()
}

/// Two weeks of logs.
///
/// Long enough that a problem reported on Monday about something that happened
/// a week ago still has its evidence, short enough that a launcher opened daily
/// does not accumulate a folder nobody ever looks at.
fn default_log_retention_days() -> u32 {
    14
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            nexus_api_key: None,
            enable_discord_rpc: true,
            discord_show_mc_version: true,
            discord_show_instance_name: true,
            close_to_tray_on_launch: false,
            close_to_tray: true,
            open_log_window_on_launch: true,
            minecraft_java_path: None,
            // None means "auto": the performance profile sizes memory from the
            // machine's total RAM. Explicit values here override the profile.
            minecraft_min_memory_mb: None,
            minecraft_max_memory_mb: None,
            minecraft_extra_args: None,
            minecraft_releases_only: true,
            close_button_action: default_close_action(),
            quit_after_launch: false,
            verify_before_launch: true,
            crash_action: default_crash_action(),
            auto_download_updates: true,
            update_channel: default_channel(),
            download_concurrency: default_download_concurrency(),
            notify_background: true,
            notify_update_ready: true,
            // Off by default: a queue of forty files would otherwise mean a
            // notification the moment the user looked away.
            notify_downloads_finished: false,
            notify_windows: true,
            notify_in_app: true,
            // Off by default: a launcher that beeps is a launcher people
            // silence at the operating system, switches and all.
            notify_sound: false,
            notify_position: default_toast_position(),
            notify_game_started: false,
            notify_backup_done: true,
            dnd_during_game: true,
            dnd_quiet_hours: false,
            dnd_from: default_quiet_from(),
            dnd_to: default_quiet_to(),
            dnd_allow_critical: true,
            log_retention_days: default_log_retention_days(),
            time_format: default_system(),
            date_format: default_system(),
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
