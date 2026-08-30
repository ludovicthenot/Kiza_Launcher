use crate::base_mod::MinecraftPlayerState;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const DISCORD_CLIENT_ID: &str = "1211291216751370310";
const DISCORD_APP_NAME: &str = "Kiza Launcher";
const DISCORD_LARGE_IMAGE_KEY: &str = "kizaa_logo_2_purple";
const DISCORD_MINECRAFT_IMAGE_KEY: &str = "mc-logo";

pub struct DiscordManager {
    tx: Mutex<Option<Sender<DiscordCommand>>>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LauncherPresenceActivity {
    BrowsingInstances,
    ConfiguringInstance,
    ExploringMods,
    ExploringShaders,
    ExploringResourcePacks,
    ExploringModpacks,
    ExploringDataPacks,
    ManagingContent,
    ManagingProfiles,
    ManagingWorlds,
    ViewingActivity,
    LaunchingMinecraft,
}

#[derive(Clone, Debug)]
struct PresenceState {
    details: String,
    state: String,
    start: Option<i64>,
    show_minecraft_asset: bool,
}

enum DiscordCommand {
    Update(PresenceState),
    Idle,
    Restore,
    #[allow(dead_code)]
    Clear,
    Quit,
}

fn default_launcher_presence() -> PresenceState {
    PresenceState {
        details: "Browsing Minecraft instances".to_string(),
        state: "Ready to play".to_string(),
        start: None,
        show_minecraft_asset: false,
    }
}

fn idle_presence() -> PresenceState {
    PresenceState {
        details: DISCORD_APP_NAME.to_string(),
        state: "Idle".to_string(),
        start: None,
        show_minecraft_asset: false,
    }
}

fn launcher_presence(
    activity: LauncherPresenceActivity,
    context: Option<String>,
    minecraft_version: Option<&str>,
) -> PresenceState {
    let details = match activity {
        LauncherPresenceActivity::BrowsingInstances => "Browsing Minecraft instances".to_string(),
        LauncherPresenceActivity::ConfiguringInstance => "Configuring an instance".to_string(),
        LauncherPresenceActivity::ExploringMods => "Exploring mods".to_string(),
        LauncherPresenceActivity::ExploringShaders => "Exploring shaders".to_string(),
        LauncherPresenceActivity::ExploringResourcePacks => "Exploring resource packs".to_string(),
        LauncherPresenceActivity::ExploringModpacks => "Exploring modpacks".to_string(),
        LauncherPresenceActivity::ExploringDataPacks => "Exploring data packs".to_string(),
        LauncherPresenceActivity::ManagingContent => "Managing installed content".to_string(),
        LauncherPresenceActivity::ManagingProfiles => "Managing profiles".to_string(),
        LauncherPresenceActivity::ManagingWorlds => "Managing worlds and backups".to_string(),
        LauncherPresenceActivity::ViewingActivity => "Viewing instance activity".to_string(),
        LauncherPresenceActivity::LaunchingMinecraft => minecraft_version
            .filter(|version| !version.trim().is_empty())
            .map(|version| format!("Launching Minecraft {version}"))
            .unwrap_or_else(|| "Launching Minecraft".to_string()),
    };

    PresenceState {
        details,
        state: context
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "In Kiza Launcher".to_string()),
        start: None,
        show_minecraft_asset: false,
    }
}

fn build_activity(state: &PresenceState, with_assets: bool) -> activity::Activity<'_> {
    let mut rich_presence = activity::Activity::new()
        .details(&state.details)
        .state(&state.state);
    if with_assets {
        let mut assets = activity::Assets::new()
            .large_image(DISCORD_LARGE_IMAGE_KEY)
            .large_text(DISCORD_APP_NAME);
        if state.show_minecraft_asset {
            assets = assets
                .small_image(DISCORD_MINECRAFT_IMAGE_KEY)
                .small_text("Minecraft");
        }
        rich_presence = rich_presence.assets(assets);
    }
    if let Some(start) = state.start {
        rich_presence = rich_presence.timestamps(activity::Timestamps::new().start(start));
    }
    rich_presence
}

fn minecraft_presence_state(
    player_state: MinecraftPlayerState,
    instance_name: Option<&str>,
) -> String {
    let activity = match player_state {
        MinecraftPlayerState::Menu => "In Minecraft menus",
        MinecraftPlayerState::Survival => "Playing Survival",
        MinecraftPlayerState::Creative => "Building in Creative",
        MinecraftPlayerState::Multiplayer => "Playing Multiplayer",
        MinecraftPlayerState::Unsupported => "Minecraft state unavailable",
    };
    match instance_name.filter(|name| !name.trim().is_empty()) {
        Some(name) => format!("{activity} - {name}"),
        None => activity.to_string(),
    }
}

impl DiscordManager {
    pub fn new() -> Self {
        Self {
            tx: Mutex::new(None),
        }
    }

    pub fn connect(&self) {
        let (tx, rx) = mpsc::channel();
        {
            let Ok(mut guard) = self.tx.lock() else {
                eprintln!("[Discord RPC] Command lock is poisoned");
                return;
            };
            if guard.is_some() {
                return;
            }
            *guard = Some(tx);
        }

        thread::spawn(move || {
            let mut last_state: Option<PresenceState> = None;
            let mut idle_resume_state: Option<PresenceState> = None;

            loop {
                let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID);

                match client.connect() {
                    Ok(_) => {
                        println!("[Discord RPC] Connected");

                        let initial = last_state.clone().unwrap_or_else(default_launcher_presence);
                        if client.set_activity(build_activity(&initial, true)).is_err() {
                            if let Err(error) = client.set_activity(build_activity(&initial, false))
                            {
                                eprintln!("[Discord RPC] Failed to restore activity: {error}");
                                let _ = client.close();
                                thread::sleep(Duration::from_secs(5));
                                continue;
                            }
                        }

                        loop {
                            let command = match rx.recv() {
                                Ok(command) => command,
                                Err(_) => return,
                            };

                            let presence = match command {
                                DiscordCommand::Update(presence) => {
                                    idle_resume_state = None;
                                    presence
                                }
                                DiscordCommand::Idle => {
                                    if idle_resume_state.is_none() {
                                        idle_resume_state = last_state.clone();
                                    }
                                    idle_presence()
                                }
                                DiscordCommand::Restore => idle_resume_state
                                    .take()
                                    .unwrap_or_else(default_launcher_presence),
                                DiscordCommand::Clear => {
                                    last_state = None;
                                    idle_resume_state = None;
                                    if client.clear_activity().is_err() {
                                        break;
                                    }
                                    continue;
                                }
                                DiscordCommand::Quit => {
                                    let _ = client.close();
                                    return;
                                }
                            };

                            last_state = Some(presence.clone());
                            if client
                                .set_activity(build_activity(&presence, true))
                                .is_err()
                                && client
                                    .set_activity(build_activity(&presence, false))
                                    .is_err()
                            {
                                eprintln!("[Discord RPC] Error setting activity. Reconnecting...");
                                break;
                            }
                        }
                    }
                    Err(_) => thread::sleep(Duration::from_secs(5)),
                }
            }
        });
    }

    pub fn disconnect(&self) {
        let Ok(mut guard) = self.tx.lock() else {
            eprintln!("[Discord RPC] Command lock is poisoned");
            return;
        };
        if let Some(tx) = guard.take() {
            let _ = tx.send(DiscordCommand::Quit);
        }
    }

    fn send(&self, command: DiscordCommand) {
        let Ok(guard) = self.tx.lock() else {
            eprintln!("[Discord RPC] Command lock is poisoned");
            return;
        };
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(command);
        }
    }

    pub fn update_launcher_presence(
        &self,
        activity: LauncherPresenceActivity,
        context: Option<String>,
        minecraft_version: Option<&str>,
    ) {
        self.send(DiscordCommand::Update(launcher_presence(
            activity,
            context,
            minecraft_version,
        )));
    }

    pub fn update_minecraft_starting_presence(&self, details: String, state: String, start: i64) {
        self.send(DiscordCommand::Update(PresenceState {
            details,
            state,
            start: Some(start),
            show_minecraft_asset: true,
        }));
    }

    pub fn update_minecraft_presence(
        &self,
        details: String,
        instance_name: Option<String>,
        player_state: MinecraftPlayerState,
        start: i64,
    ) {
        self.update_minecraft_starting_presence(
            details,
            minecraft_presence_state(player_state, instance_name.as_deref()),
            start,
        );
    }

    pub fn set_idle(&self) {
        self.send(DiscordCommand::Idle);
    }

    pub fn restore_presence(&self) {
        self.send(DiscordCommand::Restore);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_private_and_named_minecraft_states() {
        assert_eq!(
            minecraft_presence_state(MinecraftPlayerState::Survival, None),
            "Playing Survival"
        );
        assert_eq!(
            minecraft_presence_state(MinecraftPlayerState::Creative, Some("Kiza Alpha")),
            "Building in Creative - Kiza Alpha"
        );
        assert_eq!(
            minecraft_presence_state(MinecraftPlayerState::Multiplayer, Some("")),
            "Playing Multiplayer"
        );
    }

    #[test]
    fn formats_precise_launcher_activities() {
        let exploring = launcher_presence(
            LauncherPresenceActivity::ExploringShaders,
            Some("Kiza Alpha | 1.21.1 Fabric".to_string()),
            Some("1.21.1"),
        );
        assert_eq!(exploring.details, "Exploring shaders");
        assert_eq!(exploring.state, "Kiza Alpha | 1.21.1 Fabric");

        let launching = launcher_presence(
            LauncherPresenceActivity::LaunchingMinecraft,
            None,
            Some("1.21.1"),
        );
        assert_eq!(launching.details, "Launching Minecraft 1.21.1");
    }

    #[test]
    fn adds_the_minecraft_asset_only_in_game() {
        let launcher = launcher_presence(LauncherPresenceActivity::BrowsingInstances, None, None);
        let game = PresenceState {
            details: "Minecraft 1.21.1".to_string(),
            state: "Playing Survival".to_string(),
            start: Some(1),
            show_minecraft_asset: true,
        };

        let launcher_json = serde_json::to_value(build_activity(&launcher, true)).unwrap();
        let game_json = serde_json::to_value(build_activity(&game, true)).unwrap();
        assert!(launcher_json["assets"].get("small_image").is_none());
        assert_eq!(game_json["assets"]["small_image"], "mc-logo");
        assert_eq!(game_json["assets"]["large_image"], "kizaa_logo_2_purple");
    }
}
