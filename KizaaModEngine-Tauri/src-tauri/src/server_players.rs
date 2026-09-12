//! Who may join, who runs things, who was thrown out: the server's own JSON
//! lists, read as they are.
//!
//! Changing them goes through the running server's commands (`op`,
//! `whitelist add`, `ban`, …) rather than by editing the files: the server
//! holds them in memory while it runs and would write over an edit, and
//! offline it is the only party that can turn a name into the right UUID.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct ListedPlayer {
    #[serde(default)]
    pub uuid: String,
    pub name: String,
    /// Ops: permission level. Bans: reason. Absent elsewhere.
    #[serde(default)]
    pub level: Option<u8>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub expires: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct PlayerLists {
    pub ops: Vec<ListedPlayer>,
    pub whitelist: Vec<ListedPlayer>,
    pub banned: Vec<ListedPlayer>,
    pub whitelist_enabled: bool,
}

fn read_list(path: &Path) -> Vec<ListedPlayer> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn read(server_dir: &Path) -> PlayerLists {
    let props = crate::server_properties::read(server_dir);
    PlayerLists {
        ops: read_list(&server_dir.join("ops.json")),
        whitelist: read_list(&server_dir.join("whitelist.json")),
        banned: read_list(&server_dir.join("banned-players.json")),
        whitelist_enabled: props.get("white-list").is_some_and(|v| v.trim().eq_ignore_ascii_case("true")),
    }
}

/// The command for a player action, or a refusal for a name that would
/// smuggle a second command in.
pub fn command_for(action: &str, player: &str, reason: Option<&str>) -> Result<String, String> {
    let player = player.trim();
    if player.is_empty() || !player.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("A player name is letters, digits and underscores.".to_string());
    }
    let reason = reason
        .map(|r| r.trim().replace(['\n', '\r'], " "))
        .filter(|r| !r.is_empty());
    Ok(match action {
        "kick" => match reason {
            Some(reason) => format!("kick {player} {reason}"),
            None => format!("kick {player}"),
        },
        "ban" => match reason {
            Some(reason) => format!("ban {player} {reason}"),
            None => format!("ban {player}"),
        },
        "pardon" => format!("pardon {player}"),
        "op" => format!("op {player}"),
        "deop" => format!("deop {player}"),
        "whitelist_add" => format!("whitelist add {player}"),
        "whitelist_remove" => format!("whitelist remove {player}"),
        other => return Err(format!("Unknown player action: {other}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_lists_are_read_as_the_server_writes_them() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("ops.json"), r#"[{"uuid":"u1","name":"Neferr","level":4,"bypassesPlayerLimit":false}]"#).unwrap();
        std::fs::write(dir.path().join("banned-players.json"), r#"[{"uuid":"u2","name":"Griefer","created":"2026-09-12 20:00:00 +0200","source":"Server","expires":"forever","reason":"Banned by an operator."}]"#).unwrap();
        std::fs::write(dir.path().join("server.properties"), "white-list=true\n").unwrap();
        let lists = read(dir.path());
        assert_eq!(lists.ops[0].name, "Neferr");
        assert_eq!(lists.ops[0].level, Some(4));
        assert_eq!(lists.banned[0].reason.as_deref(), Some("Banned by an operator."));
        assert!(lists.whitelist.is_empty());
        assert!(lists.whitelist_enabled);
    }

    #[test]
    fn actions_become_commands_and_names_cannot_carry_a_second_one() {
        assert_eq!(command_for("op", "Neferr", None).unwrap(), "op Neferr");
        assert_eq!(command_for("kick", "Steve", Some("afk\nstop")).unwrap(), "kick Steve afk stop");
        assert_eq!(command_for("whitelist_add", "Alex_1", None).unwrap(), "whitelist add Alex_1");
        assert!(command_for("ban", "Steve; stop", None).is_err());
        assert!(command_for("fly", "Steve", None).is_err());
    }
}
