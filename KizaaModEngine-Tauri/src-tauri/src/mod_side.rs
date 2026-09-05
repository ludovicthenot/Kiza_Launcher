//! Which side of the game a mod runs on.
//!
//! A mod that only draws things — a skin renderer, a minimap, a shader loader —
//! has no business on a server, and a server that installs it wastes memory at
//! best. A mod that adds blocks has to be on both. Knowing which is which is
//! what lets an export produce a server pack rather than a copy of somebody's
//! client.
//!
//! Three sources, and they are not equally trustworthy:
//!
//! 1. **The jar.** Fabric and Quilt mods declare an `environment` in their own
//!    manifest, which the loader itself obeys. Nothing is more authoritative
//!    than that, it needs no network, and it works for a jar somebody dropped in
//!    by hand — which is exactly the case a catalogue cannot help with.
//! 2. **The catalogue.** Modrinth answers with `client_side` and `server_side`
//!    per project; CurseForge does not, and instead puts "Client" or "Server"
//!    among the game versions.
//! 3. **Nothing**, which is a real answer and is reported as such. Forge and
//!    NeoForge have no per-mod side in their manifests at all, so a Forge mod
//!    with no catalogue entry genuinely cannot be classified, and guessing
//!    "both" would put a client-only mod into somebody's server pack.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModSide {
    /// Runs on the player's machine and nowhere else.
    Client,
    /// Runs on the server and nowhere else.
    Server,
    /// Needed at both ends, which is most gameplay mods.
    Both,
}

impl ModSide {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Client => "client",
            Self::Server => "server",
            Self::Both => "both",
        }
    }

    /// Whether a server needs this mod.
    ///
    /// Unknown is not a side, so it is not answered here: an export decides for
    /// itself what to do with a mod nobody could classify, and the honest
    /// choice is to say so rather than to leave it out quietly.
    pub fn wanted_by_a_server(self) -> bool {
        matches!(self, Self::Server | Self::Both)
    }
}

/// Reads the side out of a mod's own manifest.
///
/// Returns `None` when the jar does not say, which is not a failure: Forge and
/// NeoForge manifests have no such field, so most Forge mods land here.
pub fn from_jar(path: &Path) -> Option<ModSide> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;

    if let Some(found) = read_entry(&mut archive, "fabric.mod.json").and_then(|text| {
        let root: serde_json::Value = serde_json::from_str(&text).ok()?;
        environment(root.get("environment")?.as_str()?)
    }) {
        return Some(found);
    }

    // Quilt keeps the same idea one level down, under the Minecraft block.
    read_entry(&mut archive, "quilt.mod.json").and_then(|text| {
        let root: serde_json::Value = serde_json::from_str(&text).ok()?;
        let value = root
            .get("minecraft")
            .and_then(|block| block.get("environment"))
            .or_else(|| {
                root.get("quilt_loader")
                    .and_then(|loader| loader.get("minecraft"))
                    .and_then(|block| block.get("environment"))
            })?;
        environment(value.as_str()?)
    })
}

/// Fabric's spelling: `client`, `server`, or `*` for both.
fn environment(value: &str) -> Option<ModSide> {
    match value.trim().to_ascii_lowercase().as_str() {
        "client" => Some(ModSide::Client),
        "server" => Some(ModSide::Server),
        "*" | "both" | "any" => Some(ModSide::Both),
        _ => None,
    }
}

/// Reads the side out of what a catalogue said about the project.
///
/// Modrinth answers per side with `required`, `optional` or `unsupported`;
/// CurseForge has no such field and tags its releases with "Client" or
/// "Server" among the game versions, which is why those two words keep turning
/// up in a list of Minecraft versions.
pub fn from_catalogue(
    modrinth_client: Option<&str>,
    modrinth_server: Option<&str>,
    game_versions: &[String],
) -> Option<ModSide> {
    if modrinth_client.is_some() || modrinth_server.is_some() {
        let client = supported(modrinth_client);
        let server = supported(modrinth_server);
        return match (client, server) {
            (true, true) => Some(ModSide::Both),
            (true, false) => Some(ModSide::Client),
            (false, true) => Some(ModSide::Server),
            // Both "unsupported" is a project that says it runs nowhere, which
            // is a mistake in the catalogue rather than an answer.
            (false, false) => None,
        };
    }

    let mut client = false;
    let mut server = false;
    for value in game_versions {
        match value.trim().to_ascii_lowercase().as_str() {
            "client" => client = true,
            "server" => server = true,
            _ => {}
        }
    }
    match (client, server) {
        (true, true) => Some(ModSide::Both),
        (true, false) => Some(ModSide::Client),
        (false, true) => Some(ModSide::Server),
        (false, false) => None,
    }
}

/// Modrinth's word for "this side works", as opposed to "unsupported".
fn supported(value: Option<&str>) -> bool {
    !matches!(
        value.unwrap_or("").trim().to_ascii_lowercase().as_str(),
        "unsupported" | "unknown" | ""
    )
}

fn read_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar(entries: &[(&str, &str)]) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().expect("temp jar");
        let mut zip = zip::ZipWriter::new(file.reopen().expect("reopen"));
        for (name, body) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .expect("entry");
            zip.write_all(body.as_bytes()).expect("write");
        }
        zip.finish().expect("finish");
        file
    }

    #[test]
    fn a_fabric_mod_is_taken_at_its_word() {
        let client = jar(&[("fabric.mod.json", r#"{"id":"a","environment":"client"}"#)]);
        assert_eq!(from_jar(client.path()), Some(ModSide::Client));

        let server = jar(&[("fabric.mod.json", r#"{"id":"a","environment":"server"}"#)]);
        assert_eq!(from_jar(server.path()), Some(ModSide::Server));

        let both = jar(&[("fabric.mod.json", r#"{"id":"a","environment":"*"}"#)]);
        assert_eq!(from_jar(both.path()), Some(ModSide::Both));
    }

    /// The common case, and the one that must not be guessed at.
    ///
    /// Fabric's default when the field is absent is "*", but a jar that does not
    /// say is not a jar that said "both" — and treating the two the same is how
    /// a client-only mod ends up in a server pack. The catalogue gets asked
    /// next; if it has nothing either, the answer stays unknown.
    #[test]
    fn a_jar_that_does_not_say_says_nothing() {
        let quiet = jar(&[("fabric.mod.json", r#"{"id":"a","version":"1"}"#)]);
        assert_eq!(from_jar(quiet.path()), None);

        let forge = jar(&[("META-INF/mods.toml", "modLoader=\"javafml\"")]);
        assert_eq!(from_jar(forge.path()), None);

        let empty = jar(&[]);
        assert_eq!(from_jar(empty.path()), None);
    }

    #[test]
    fn a_quilt_mod_keeps_it_one_level_down() {
        let nested = jar(&[(
            "quilt.mod.json",
            r#"{"quilt_loader":{"id":"a"},"minecraft":{"environment":"client"}}"#,
        )]);
        assert_eq!(from_jar(nested.path()), Some(ModSide::Client));

        let deeper = jar(&[(
            "quilt.mod.json",
            r#"{"quilt_loader":{"id":"a","minecraft":{"environment":"server"}}}"#,
        )]);
        assert_eq!(from_jar(deeper.path()), Some(ModSide::Server));
    }

    /// Fabric wins, because the loader that reads it is the one that decides.
    #[test]
    fn the_loaders_own_manifest_is_read_first() {
        let both = jar(&[
            ("fabric.mod.json", r#"{"id":"a","environment":"server"}"#),
            (
                "quilt.mod.json",
                r#"{"minecraft":{"environment":"client"}}"#,
            ),
        ]);
        assert_eq!(from_jar(both.path()), Some(ModSide::Server));
    }

    #[test]
    fn modrinth_answers_per_side() {
        assert_eq!(
            from_catalogue(Some("required"), Some("unsupported"), &[]),
            Some(ModSide::Client)
        );
        assert_eq!(
            from_catalogue(Some("unsupported"), Some("required"), &[]),
            Some(ModSide::Server)
        );
        assert_eq!(
            from_catalogue(Some("required"), Some("optional"), &[]),
            Some(ModSide::Both)
        );
        // A project claiming to run nowhere is a catalogue mistake, not a side.
        assert_eq!(
            from_catalogue(Some("unsupported"), Some("unsupported"), &[]),
            None
        );
    }

    /// This is why "Client" keeps appearing in a list of Minecraft versions.
    #[test]
    fn curseforge_hides_it_among_the_game_versions() {
        let tags = vec![
            "Client".to_string(),
            "Fabric".to_string(),
            "1.21.11".to_string(),
        ];
        assert_eq!(from_catalogue(None, None, &tags), Some(ModSide::Client));

        let both = vec!["Client".to_string(), "Server".to_string()];
        assert_eq!(from_catalogue(None, None, &both), Some(ModSide::Both));

        let silent = vec!["1.21.11".to_string(), "Fabric".to_string()];
        assert_eq!(from_catalogue(None, None, &silent), None);
    }

    #[test]
    fn a_server_wants_what_runs_on_it() {
        assert!(ModSide::Server.wanted_by_a_server());
        assert!(ModSide::Both.wanted_by_a_server());
        assert!(!ModSide::Client.wanted_by_a_server());
    }
}
