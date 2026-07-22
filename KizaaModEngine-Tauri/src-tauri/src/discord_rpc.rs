use crate::base_mod::MinecraftPlayerState;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

// Application ID
const DISCORD_CLIENT_ID: &str = "1211291216751370310";
const DISCORD_APP_NAME: &str = "Kiza Launcher";
const DISCORD_LARGE_IMAGE_KEY: &str = "kizaa_logo_2_purple";

pub struct DiscordManager {
    tx: Mutex<Option<Sender<DiscordCommand>>>,
}

#[derive(Clone, Debug)]
struct PresenceState {
    details: String,
    state: String,
    start: Option<i64>,
}

enum DiscordCommand {
    Update(String, String, Option<i64>), // Details, State, start unix timestamp
    #[allow(dead_code)]
    Clear,
    Quit,
}

fn build_activity(state: &PresenceState, with_assets: bool) -> activity::Activity<'_> {
    let mut act = activity::Activity::new()
        .details(&state.details)
        .state(&state.state);
    if with_assets {
        act = act.assets(
            activity::Assets::new()
                .large_image(DISCORD_LARGE_IMAGE_KEY)
                .large_text(DISCORD_APP_NAME),
        );
    }
    if let Some(start) = state.start {
        act = act.timestamps(activity::Timestamps::new().start(start));
    }
    act
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
                return; // Already connected
            }
            *guard = Some(tx);
        }

        thread::spawn(move || {
            let mut last_state: Option<PresenceState> = None;

            loop {
                // Outer loop: Connection attempts
                // DiscordIpcClient::new returns the client directly in v1.1.0
                let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID);

                // Try to connect
                match client.connect() {
                    Ok(_) => {
                        println!("[Discord RPC] Connected");

                        // Restore last state, or fall back to the default menu state.
                        let initial = last_state.clone().unwrap_or_else(|| PresenceState {
                            details: DISCORD_APP_NAME.to_string(),
                            state: "In the launcher menu".to_string(),
                            start: None,
                        });
                        if client.set_activity(build_activity(&initial, true)).is_err() {
                            // Fallback without assets
                            if let Err(e) = client.set_activity(build_activity(&initial, false)) {
                                eprintln!("[Discord RPC] Failed to restore activity: {}", e);
                                let _ = client.close();
                                thread::sleep(Duration::from_secs(5));
                                continue;
                            }
                        }

                        // Inner loop: Command processing
                        loop {
                            match rx.recv() {
                                Ok(cmd) => {
                                    match cmd {
                                        DiscordCommand::Update(details, state, start) => {
                                            let presence = PresenceState {
                                                details,
                                                state,
                                                start,
                                            };
                                            last_state = Some(presence.clone());

                                            if client
                                                .set_activity(build_activity(&presence, true))
                                                .is_err()
                                            {
                                                // Fallback without assets
                                                if let Err(e) = client
                                                    .set_activity(build_activity(&presence, false))
                                                {
                                                    eprintln!("[Discord RPC] Error setting activity: {}. Reconnecting...", e);
                                                    break; // Break inner loop to reconnect
                                                }
                                            }
                                        }
                                        DiscordCommand::Clear => {
                                            last_state = None;
                                            if client.clear_activity().is_err() {
                                                break;
                                            }
                                        }
                                        DiscordCommand::Quit => {
                                            let _ = client.close();
                                            return; // Exit thread completely
                                        }
                                    }
                                }
                                Err(_) => {
                                    // Channel closed (App shutting down?)
                                    return;
                                }
                            }
                        }
                    }
                    Err(_) => {
                        // Connection failed (Discord likely not running)
                        // Silent retry to avoid spamming logs, or log once?
                        // eprintln!("[Discord RPC] Connection failed: {}", e);
                        thread::sleep(Duration::from_secs(5));
                    }
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

    pub fn update_presence(&self, details: String, state: String) {
        self.update_presence_with_start(details, state, None);
    }

    /// `start` is a unix timestamp; Discord renders it as elapsed session time.
    pub fn update_presence_with_start(&self, details: String, state: String, start: Option<i64>) {
        let Ok(guard) = self.tx.lock() else {
            eprintln!("[Discord RPC] Command lock is poisoned");
            return;
        };
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(DiscordCommand::Update(details, state, start));
        }
    }

    pub fn update_minecraft_presence(
        &self,
        details: String,
        instance_name: Option<String>,
        player_state: MinecraftPlayerState,
        start: i64,
    ) {
        self.update_presence_with_start(
            details,
            minecraft_presence_state(player_state, instance_name.as_deref()),
            Some(start),
        );
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
    fn uses_the_configured_kiza_discord_asset() {
        assert_eq!(DISCORD_LARGE_IMAGE_KEY, "kizaa_logo_2_purple");
    }
}
