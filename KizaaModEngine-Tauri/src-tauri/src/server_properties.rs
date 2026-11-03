//! `server.properties`, read and written without losing anything.
//!
//! The file is Java's properties format: `key=value` lines, `#` comments, and
//! whatever order the server last wrote it in. A settings page that knows
//! fifteen keys must not throw away the sixteenth, so a save here is an edit
//! of the existing lines — a known key is rewritten in place, a new one is
//! appended, a comment or an unknown key is left exactly as it was.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const FILE_NAME: &str = "server.properties";

/// One key the settings page offers, with enough said about it to draw a
/// control rather than a text box.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub struct KnownProperty {
    pub key: &'static str,
    pub label: &'static str,
    pub kind: PropertyKind,
    pub default: &'static str,
    /// For `Choice`: the values the server accepts.
    pub choices: &'static [&'static str],
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PropertyKind {
    Text,
    Bool,
    Int,
    Choice,
}

/// The properties worth a control of their own. Everything else stays in the
/// file and is reachable through "open the file".
pub const KNOWN: &[KnownProperty] = &[
    KnownProperty {
        key: "motd",
        label: "Message of the day",
        kind: PropertyKind::Text,
        default: "A Minecraft Server",
        choices: &[],
    },
    KnownProperty {
        key: "server-port",
        label: "Port",
        kind: PropertyKind::Int,
        default: "25565",
        choices: &[],
    },
    KnownProperty {
        key: "max-players",
        label: "Max players",
        kind: PropertyKind::Int,
        default: "20",
        choices: &[],
    },
    KnownProperty {
        key: "gamemode",
        label: "Game mode",
        kind: PropertyKind::Choice,
        default: "survival",
        choices: &["survival", "creative", "adventure", "spectator"],
    },
    KnownProperty {
        key: "difficulty",
        label: "Difficulty",
        kind: PropertyKind::Choice,
        default: "easy",
        choices: &["peaceful", "easy", "normal", "hard"],
    },
    KnownProperty {
        key: "hardcore",
        label: "Hardcore",
        kind: PropertyKind::Bool,
        default: "false",
        choices: &[],
    },
    KnownProperty {
        key: "pvp",
        label: "PvP",
        kind: PropertyKind::Bool,
        default: "true",
        choices: &[],
    },
    KnownProperty {
        key: "online-mode",
        label: "Online mode",
        kind: PropertyKind::Bool,
        default: "true",
        choices: &[],
    },
    KnownProperty {
        key: "white-list",
        label: "Whitelist",
        kind: PropertyKind::Bool,
        default: "false",
        choices: &[],
    },
    KnownProperty {
        key: "enforce-whitelist",
        label: "Enforce whitelist",
        kind: PropertyKind::Bool,
        default: "false",
        choices: &[],
    },
    KnownProperty {
        key: "level-name",
        label: "World folder",
        kind: PropertyKind::Text,
        default: "world",
        choices: &[],
    },
    KnownProperty {
        key: "level-seed",
        label: "Seed",
        kind: PropertyKind::Text,
        default: "",
        choices: &[],
    },
    KnownProperty {
        key: "level-type",
        label: "World type",
        kind: PropertyKind::Choice,
        default: "minecraft:normal",
        choices: &[
            "minecraft:normal",
            "minecraft:flat",
            "minecraft:large_biomes",
            "minecraft:amplified",
        ],
    },
    KnownProperty {
        key: "view-distance",
        label: "View distance",
        kind: PropertyKind::Int,
        default: "10",
        choices: &[],
    },
    KnownProperty {
        key: "simulation-distance",
        label: "Simulation distance",
        kind: PropertyKind::Int,
        default: "10",
        choices: &[],
    },
    KnownProperty {
        key: "spawn-protection",
        label: "Spawn protection",
        kind: PropertyKind::Int,
        default: "16",
        choices: &[],
    },
    KnownProperty {
        key: "allow-flight",
        label: "Allow flight",
        kind: PropertyKind::Bool,
        default: "false",
        choices: &[],
    },
    KnownProperty {
        key: "enable-command-block",
        label: "Command blocks",
        kind: PropertyKind::Bool,
        default: "false",
        choices: &[],
    },
    KnownProperty {
        key: "enforce-secure-profile",
        label: "Enforce secure profile",
        kind: PropertyKind::Bool,
        default: "true",
        choices: &[],
    },
    KnownProperty {
        key: "spawn-monsters",
        label: "Spawn monsters",
        kind: PropertyKind::Bool,
        default: "true",
        choices: &[],
    },
    KnownProperty {
        key: "allow-nether",
        label: "Allow the Nether",
        kind: PropertyKind::Bool,
        default: "true",
        choices: &[],
    },
];

/// The whole file as the page sees it: every key with a value, plus which
/// ones the page knows how to draw.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct Properties {
    /// Every `key=value` in the file, in file order.
    pub entries: Vec<(String, String)>,
}

impl Properties {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    pub fn port(&self) -> u16 {
        self.get("server-port")
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(25565)
    }

    pub fn level_name(&self) -> String {
        self.get("level-name")
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or("world")
            .to_string()
    }
}

/// Reads the file. A server that has never started has none, and that is an
/// empty set of entries rather than an error.
pub fn read(server_dir: &Path) -> Properties {
    let text = std::fs::read_to_string(server_dir.join(FILE_NAME)).unwrap_or_default();
    parse(&text)
}

pub fn parse(text: &str) -> Properties {
    let entries = text
        .lines()
        .filter_map(|line| {
            let line = line.trim_end_matches('\r');
            if line.trim().is_empty()
                || line.trim_start().starts_with('#')
                || line.trim_start().starts_with('!')
            {
                return None;
            }
            let (key, value) = split_line(line)?;
            Some((key.to_string(), unescape(value)))
        })
        .collect();
    Properties { entries }
}

/// Java's rule: the key ends at the first unescaped `=`, `:` or whitespace.
fn split_line(line: &str) -> Option<(&str, &str)> {
    let mut escaped = false;
    for (index, c) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '=' | ':' => {
                let key = line[..index].trim();
                let value = line[index + 1..].trim_start();
                return Some((key, value));
            }
            _ => {}
        }
    }
    Some((line.trim(), ""))
}

fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    Some(decoded) => out.push(decoded),
                    None => {
                        out.push_str("\\u");
                        out.push_str(&hex);
                    }
                }
            }
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// The server's own escaping, so a MOTD with a colon or a `\` survives.
fn escape_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            ':' | '=' | '#' | '!' => {
                out.push('\\');
                out.push(c);
            }
            c if (c as u32) > 0x7e => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn escape_key(key: &str) -> String {
    let mut out = escape_value(key);
    // Keys additionally may not contain bare spaces.
    out = out.replace(' ', "\\ ");
    out
}

/// Applies changes to the file's text: known lines rewritten in place, new
/// keys appended, everything else untouched.
pub fn apply(text: &str, changes: &BTreeMap<String, String>) -> String {
    let mut remaining = changes.clone();
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            out.push(line.to_string());
            continue;
        }
        match split_line(line) {
            Some((key, _)) if remaining.contains_key(key) => {
                let value = remaining.remove(key).unwrap_or_default();
                out.push(format!("{}={}", escape_key(key), escape_value(&value)));
            }
            _ => out.push(line.to_string()),
        }
    }
    for (key, value) in remaining {
        out.push(format!("{}={}", escape_key(&key), escape_value(&value)));
    }
    let mut joined = out.join("\n");
    joined.push('\n');
    joined
}

/// Writes the changes into the server's file, creating it when absent.
pub fn write(server_dir: &Path, changes: &BTreeMap<String, String>) -> Result<Properties, String> {
    let path = server_dir.join(FILE_NAME);
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let updated = apply(&existing, changes);
    std::fs::write(&path, updated)
        .map_err(|error| format!("Could not write {FILE_NAME}: {error}"))?;
    Ok(read(server_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_the_server_writes() {
        let text = "#Minecraft server properties\n#Sat Sep 12 20:00:00 CEST 2026\nmotd=A Minecraft Server\nserver-port=25565\nlevel-seed=\nonline-mode=true\n";
        let props = parse(text);
        assert_eq!(props.get("motd"), Some("A Minecraft Server"));
        assert_eq!(props.port(), 25565);
        assert_eq!(props.get("level-seed"), Some(""));
        assert_eq!(props.level_name(), "world");
    }

    #[test]
    fn a_save_keeps_the_comments_the_order_and_the_keys_it_does_not_know() {
        let text = "#Minecraft server properties\nmotd=Old\nsome-mod-key=kept\nmax-players=20\n";
        let mut changes = BTreeMap::new();
        changes.insert("motd".to_string(), "New".to_string());
        changes.insert("pvp".to_string(), "false".to_string());
        let out = apply(text, &changes);
        assert_eq!(
            out,
            "#Minecraft server properties\nmotd=New\nsome-mod-key=kept\nmax-players=20\npvp=false\n"
        );
    }

    #[test]
    fn a_motd_with_a_colon_survives_the_round_trip() {
        let mut changes = BTreeMap::new();
        changes.insert("motd".to_string(), "Kiza: survie été".to_string());
        let out = apply("", &changes);
        assert_eq!(parse(&out).get("motd"), Some("Kiza: survie été"));
    }

    #[test]
    fn every_known_choice_has_its_default_among_its_choices() {
        for property in KNOWN {
            if property.kind == PropertyKind::Choice {
                assert!(
                    property.choices.contains(&property.default),
                    "{}",
                    property.key
                );
            }
        }
    }
}
