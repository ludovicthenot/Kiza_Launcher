use crate::credential_store::{self, NEXUS_API_KEY};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Held for the length of one settings write.
///
/// One process, one settings file, and — since the write moved off the main
/// thread to stop the settings dialogue freezing — more than one thread able to
/// reach it.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

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
    /// How many times a failing transfer is retried before it is given up on.
    /// Clamped by the download manager, which owns the range that helps.
    #[serde(default = "default_download_attempts")]
    pub download_attempts: u32,
    /// Hold the queue while Minecraft is running, so a download does not
    /// compete with the game for bandwidth.
    #[serde(default)]
    pub pause_downloads_in_game: bool,

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

    // --- Storage -----------------------------------------------------------
    /// How many days an untouched cached file is kept. Zero keeps all of it.
    #[serde(default = "default_cache_retention_days")]
    pub cache_retention_days: u32,
    /// Delete a finished download once it has been installed into an instance.
    #[serde(default)]
    pub clear_finished_downloads: bool,

    // --- Region ------------------------------------------------------------
    /// How clocks are written: "system", "24h" or "12h".
    #[serde(default = "default_system")]
    pub time_format: String,
    /// How dates are written: "system", "dmy", "mdy" or "ymd".
    #[serde(default = "default_system")]
    pub date_format: String,
    /// How sizes are written: "auto" (what Explorer shows), "binary" (KiB,
    /// MiB) or "decimal" (1000-based, the way a drive is sold).
    #[serde(default = "default_units")]
    pub storage_units: String,
}

fn default_download_concurrency() -> u32 {
    3
}

fn default_download_attempts() -> u32 {
    4
}

fn default_system() -> String {
    "system".to_string()
}

fn default_units() -> String {
    "auto".to_string()
}

fn default_close_action() -> String {
    "tray".to_string()
}

fn default_crash_action() -> String {
    "report".to_string()
}

/// The channel this edition follows unless told otherwise.
///
/// Not the literal "stable": a Maker build defaults to `maker` and an
/// Experimental one to `experimental`, because an edition following the wrong
/// stream would be offered updates that were never meant for it.
fn default_channel() -> String {
    crate::edition::current().default_channel().to_string()
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

/// A month of cache.
///
/// Long enough that a mod list opened once a fortnight is still instant, short
/// enough that a launcher left alone for a season does not keep a catalogue
/// nobody will read again.
fn default_cache_retention_days() -> u32 {
    30
}

impl AppConfig {
    /// Takes the channel the installer asked for, once.
    ///
    /// Kiza's alpha is the launcher on an earlier stream, not a different
    /// application — so the installer handed to a tester is the ordinary one
    /// with a note beside it saying which stream this copy was for. The note
    /// is read here, applied, and deleted: it is an instruction for the first
    /// launch, not a setting, and leaving it would overrule somebody who
    /// later changed their mind in the interface.
    ///
    /// The channel still has to be one this edition may follow. A note is a
    /// file on disk like any other, and a launcher that obeyed one without
    /// checking would be a launcher that could be moved onto another stream by
    /// writing a word into a text file.
    pub fn adopt_installed_channel(&mut self, app_data_dir: &std::path::Path) -> bool {
        let marker = app_data_dir.join("config").join("channel");
        let Ok(asked) = std::fs::read_to_string(&marker) else {
            return false;
        };
        let _ = std::fs::remove_file(&marker);

        let asked = asked.trim().to_ascii_lowercase();
        if asked.is_empty() || !crate::edition::current().allows(&asked) {
            return false;
        }
        if self.update_channel == asked {
            return false;
        }
        self.update_channel = asked;
        true
    }

    /// Forces the update channel back onto one this edition may follow.
    ///
    /// The stored value is a string in a file anybody can edit, and a settings
    /// file copied from one edition into another carries the wrong channel. A
    /// Stable install must never be handed a Maker or an Experimental build,
    /// and the way to guarantee that is not to trust what is written down.
    pub fn clamp_channel(&mut self) {
        let edition = crate::edition::current();
        if !edition.allows(&self.update_channel) {
            self.update_channel = edition.default_channel().to_string();
        }
    }
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
            download_attempts: default_download_attempts(),
            pause_downloads_in_game: false,
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
            cache_retention_days: default_cache_retention_days(),
            clear_finished_downloads: false,
            time_format: default_system(),
            date_format: default_system(),
            storage_units: default_units(),
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

    /// The settings, with the installer's one instruction obeyed first.
    ///
    /// The note the installer leaves is read here rather than at the call
    /// sites, because every path into the settings — a fresh install with no
    /// file at all, an unreadable one, an ordinary one — has to see the same
    /// answer. It is applied once and written down, so the note can be deleted
    /// and never overrule the person again.
    pub fn load_config(&self) -> AppConfig {
        let mut config = self.read_config();
        if config.adopt_installed_channel(&self.app_data_dir) {
            // Written straight away. A channel that lived only in memory would
            // be forgotten at the next launch, and the note is already gone.
            if let Err(error) = self.save_config(&config) {
                eprintln!("[WARN] [ConfigManager] Could not record the installed channel: {error}");
            }
        }
        config
    }

    fn read_config(&self) -> AppConfig {
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
                            // A settings file can come from another edition,
                            // or simply be edited. The channel is decided by
                            // what this build is, not by what the file says.
                            config.clamp_channel();
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

    /// Writes the settings file: one writer at a time, and all at once.
    ///
    /// Both halves matter, and neither used to need saying. The save command
    /// ran on the main thread, so two writes could not overlap; moving it off
    /// that thread — which is what stopped the settings dialogue freezing —
    /// took that away, so the lock puts it back.
    ///
    /// The rename is the other half. `fs::write` truncates before it writes: a
    /// launcher killed in that window leaves a half-written file, and a
    /// half-written settings file does not parse, which means every setting
    /// back to its default. A rename cannot be caught half done.
    pub fn save_config(&self, config: &AppConfig) -> Result<(), String> {
        let path = self.get_config_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;

        // Poisoning means an earlier writer panicked. What it was holding was
        // the temporary file, so the real settings are untouched and there is
        // nothing to protect by refusing to carry on.
        let _writing = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());

        let temporary = path.with_extension("json.writing");
        fs::write(&temporary, content).map_err(|e| e.to_string())?;
        fs::rename(&temporary, &path).map_err(|error| {
            // A failed rename leaves the previous settings in place, which is
            // the right outcome — but not the temporary file beside them.
            let _ = fs::remove_file(&temporary);
            error.to_string()
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, ConfigManager};

    #[test]
    fn legacy_config_defaults_to_release_versions_only() {
        let config: AppConfig = serde_json::from_str("{}").expect("config should deserialize");
        assert!(config.minecraft_releases_only);
    }

    #[test]
    fn a_saved_config_reads_back_as_itself() {
        let root = tempfile::tempdir().unwrap();
        let manager = ConfigManager::new(root.path().to_path_buf());

        let config = AppConfig {
            download_concurrency: 7,
            notify_sound: true,
            ..AppConfig::default()
        };
        manager.save_config(&config).unwrap();

        let read = manager.load_config();
        assert_eq!(read.download_concurrency, 7);
        assert!(read.notify_sound);
    }

    /// The settings write is no longer on the main thread, so two of them can
    /// now genuinely run at once. Overlapping `fs::write` calls on one path
    /// interleave, and the result is a file that does not parse — which reads
    /// to the user as every setting silently reset.
    #[test]
    fn writes_from_several_threads_never_leave_an_unreadable_file() {
        let root = tempfile::tempdir().unwrap();
        let manager = ConfigManager::new(root.path().to_path_buf());
        manager.save_config(&AppConfig::default()).unwrap();

        std::thread::scope(|scope| {
            for writer in 0..8u32 {
                let dir = root.path().to_path_buf();
                scope.spawn(move || {
                    let writing = ConfigManager::new(dir);
                    for round in 0..25 {
                        let config = AppConfig {
                            download_concurrency: (writer % 8) + 1,
                            cache_retention_days: round,
                            ..AppConfig::default()
                        };
                        writing.save_config(&config).unwrap();
                    }
                });
            }
        });

        // Whichever writer went last, what is on disk has to be one whole
        // configuration rather than two spliced together.
        let path = root.path().join("config").join("app_settings.json");
        let text = std::fs::read_to_string(&path).unwrap();
        serde_json::from_str::<AppConfig>(&text).expect("the settings file must still parse");

        // And nothing half-written left lying beside it.
        let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".writing"))
            .collect();
        assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
    }
}

#[cfg(test)]
mod installed_channel_tests {
    use super::*;

    fn marker(dir: &std::path::Path, value: &str) {
        let config = dir.join("config");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(config.join("channel"), value).unwrap();
    }

    /// The instruction an installer leaves is obeyed once and then gone.
    #[test]
    fn the_installers_note_is_taken_and_removed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        marker(path, "alpha");

        let mut config = AppConfig::default();
        // Only where this edition may follow it; a Stable build may.
        let taken = config.adopt_installed_channel(path);
        if crate::edition::current().allows("alpha") {
            assert!(taken);
            assert_eq!(config.update_channel, "alpha");
        }
        // Read once. A note left behind would overrule the person every time
        // they changed their mind in the interface.
        assert!(!path.join("config").join("channel").exists());
    }

    /// And it is an instruction, not an authority.
    #[test]
    fn a_note_cannot_move_this_build_where_it_may_not_go() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        marker(path, "maker");

        let mut config = AppConfig::default();
        let before = config.update_channel.clone();
        assert!(!config.adopt_installed_channel(path));
        assert_eq!(config.update_channel, before);
    }

    #[test]
    fn nonsense_and_absence_change_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();

        let mut config = AppConfig::default();
        // No note at all: the ordinary installer.
        assert!(!config.adopt_installed_channel(path));

        marker(path, "  \n");
        assert!(!config.adopt_installed_channel(path));
        marker(path, "not-a-channel");
        assert!(!config.adopt_installed_channel(path));
        assert_eq!(config.update_channel, default_channel());
    }
}
