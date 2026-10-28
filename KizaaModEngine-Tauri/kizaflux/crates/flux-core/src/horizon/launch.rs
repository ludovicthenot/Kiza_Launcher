//! The commands that prepare and play an installed Horizon release.
//!
//! Both are built, not run: the launcher runs them with its own process
//! handling (logs, the window to bring forward, "stop"), exactly as it runs
//! Java. Nothing here prints a token.
//!
//! The arguments are Horizon's own, as its launcher passes them
//! (launcher/src/backend.rs, `client_command`) and `horizon-client --help`
//! lists them: `--resources`, `--session-file`, `--quickPlayMultiplayer`,
//! `--quickPlaySingleplayer`, `--width`, `--height`.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use ring::rand::{SecureRandom, SystemRandom};
use serde_json::json;

use super::layout::Installed;

/// The preparation: Horizon reads the player's own Minecraft files (a
/// launcher folder holding `versions/<v>/`, `libraries/` and `assets/`, such
/// as Kiza's shared one) and the server jar, checks them against its lock and
/// derives its resources. It runs Minecraft's code with `java_home`'s Java,
/// which must be the lock's major (25 for 26.3).
pub fn prepare_command(
    installed: &Installed,
    java_home: &Path,
    minecraft_dir: &Path,
    server_jar: &Path,
) -> Command {
    let mut command = Command::new(installed.preparer());
    command
        .current_dir(&installed.dir)
        .arg("--prepare")
        .arg("--server-jar")
        .arg(server_jar)
        .arg("--minecraft-dir")
        .arg(minecraft_dir);
    with_java(&mut command, java_home);
    command
}

/// The optional second step: Minecraft's sounds, copied from the same
/// install. A game prepared without it is silent.
pub fn sounds_command(installed: &Installed, java_home: &Path, minecraft_dir: &Path) -> Command {
    let mut command = Command::new(installed.preparer());
    command
        .current_dir(&installed.dir)
        .arg("sounds")
        .arg("--minecraft-dir")
        .arg(minecraft_dir);
    with_java(&mut command, java_home);
    command
}

/// Horizon finds Java through `JAVA_HOME`, then the PATH: both point at the
/// launcher's runtime so another Java on the machine is never picked.
fn with_java(command: &mut Command, java_home: &Path) {
    let mut path = OsString::from(java_home.join("bin"));
    if let Some(existing) = std::env::var_os("PATH") {
        path.push(if cfg!(windows) { ";" } else { ":" });
        path.push(existing);
    }
    command.env("JAVA_HOME", java_home).env("PATH", path);
}

#[derive(Clone, Debug, Default)]
pub struct PlayOptions {
    /// The instance's folder: saves, options.txt, resource packs, Horizon's
    /// mods. The game runs in it, as Java's does.
    pub game_dir: PathBuf,
    /// From [`write_session_file`]; None plays offline (single player only).
    pub session_file: Option<PathBuf>,
    /// Join this server at once (`host[:port]`).
    pub server: Option<String>,
    /// Open this world of `saves/` at once.
    pub world: Option<String>,
    pub window: Option<(u32, u32)>,
    pub extra_args: Vec<String>,
}

pub fn play_command(installed: &Installed, options: &PlayOptions) -> Command {
    let mut command = Command::new(installed.client());
    command
        .current_dir(&options.game_dir)
        .arg("--resources")
        .arg(installed.resources());
    if let Some(session) = &options.session_file {
        command.arg("--session-file").arg(session);
    }
    if let Some(server) = &options.server {
        command.arg("--quickPlayMultiplayer").arg(server);
    }
    if let Some(world) = &options.world {
        command.arg("--quickPlaySingleplayer").arg(world);
    }
    if let Some((width, height)) = options.window {
        command
            .arg("--width")
            .arg(width.to_string())
            .arg("--height")
            .arg(height.to_string());
    }
    command.args(&options.extra_args);
    command
}

/// The signed-in account, for the game. Its Debug never shows the token.
#[derive(Clone)]
pub struct Session {
    pub name: String,
    pub uuid: String,
    pub access_token: String,
    pub xuid: Option<String>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("name", &self.name)
            .field("uuid", &self.uuid)
            .field("access_token", &"<hidden>")
            .finish()
    }
}

/// How long an unread session file may stay: Horizon itself refuses one
/// older than two minutes.
const SESSION_LIFETIME: Duration = Duration::from_secs(120);

/// Writes the session the way Horizon reads it: a fresh file with a random
/// name, which the game deletes once it has read it. Files earlier games
/// never read are removed first. `dir` belongs to Kiza's own data folder,
/// which Windows keeps to the user's account; the token never goes on the
/// command line, where any process could read it.
pub fn write_session_file(dir: &Path, session: &Session) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .is_ok_and(|m| m.elapsed().is_ok_and(|age| age > SESSION_LIFETIME));
            let ours = entry.file_name().to_string_lossy().starts_with("session-");
            if stale && ours {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let mut name = [0u8; 12];
    SystemRandom::new()
        .fill(&mut name)
        .map_err(|_| "No randomness for the session file name.")?;
    let path = dir.join(format!(
        "session-{}.json",
        name.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    let body = json!({
        "name": session.name,
        "uuid": session.uuid,
        "access_token": session.access_token,
        "user_type": "msa",
        "xuid": session.xuid,
    });
    std::io::Write::write_all(&mut file, body.to_string().as_bytes()).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::horizon::layout::{Installed, Lock};

    fn installed(dir: &Path) -> Installed {
        Installed {
            dir: dir.to_path_buf(),
            lock: Lock {
                minecraft: "26.3".into(),
                java_major: 25,
                server_sha1: None,
                manifest_sha1: None,
                accepted_manifest_sha1: Vec::new(),
            },
        }
    }

    fn args(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn the_play_command_runs_in_the_instance() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("instance");
        let options = PlayOptions {
            game_dir: game.clone(),
            session_file: Some(dir.path().join("session-x.json")),
            server: Some("localhost:25565".into()),
            window: Some((1280, 720)),
            ..Default::default()
        };
        let command = play_command(&installed(dir.path()), &options);
        assert_eq!(command.get_current_dir(), Some(game.as_path()));
        let args = args(&command);
        assert_eq!(args[0], "--resources");
        assert!(args[1].ends_with("26.3"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--quickPlayMultiplayer" && w[1] == "localhost:25565"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--session-file" && w[1].ends_with("session-x.json")));
        assert!(args
            .windows(4)
            .any(|w| w == ["--width", "1280", "--height", "720"]));
    }

    #[test]
    fn the_preparation_uses_the_launchers_java() {
        let dir = tempfile::tempdir().unwrap();
        let java = dir.path().join("java-25");
        let command = prepare_command(
            &installed(dir.path()),
            &java,
            Path::new("mc"),
            Path::new("server.jar"),
        );
        assert_eq!(
            args(&command),
            [
                "--prepare",
                "--server-jar",
                "server.jar",
                "--minecraft-dir",
                "mc"
            ]
        );
        let env: Vec<(String, String)> = command
            .get_envs()
            .filter_map(|(k, v)| {
                Some((
                    k.to_string_lossy().into_owned(),
                    v?.to_string_lossy().into_owned(),
                ))
            })
            .collect();
        assert!(env
            .iter()
            .any(|(k, v)| k == "JAVA_HOME" && Path::new(v) == java));
        assert!(env
            .iter()
            .any(|(k, v)| k == "PATH" && v.starts_with(&*java.join("bin").to_string_lossy())));
    }

    #[test]
    fn the_session_file_is_fresh_and_its_token_stays_out_of_logs() {
        let dir = tempfile::tempdir().unwrap();
        let session = Session {
            name: "Steve".into(),
            uuid: "uuid".into(),
            access_token: "secret-token".into(),
            xuid: None,
        };
        assert!(!format!("{session:?}").contains("secret-token"));
        let a = write_session_file(dir.path(), &session).unwrap();
        let b = write_session_file(dir.path(), &session).unwrap();
        assert_ne!(a, b);
        let body: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&a).unwrap()).unwrap();
        assert_eq!(body["access_token"], "secret-token");
        assert_eq!(body["user_type"], "msa");
    }
}
