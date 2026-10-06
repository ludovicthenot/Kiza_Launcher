//! Putting the server files into a server folder.
//!
//! Four loaders, four shapes of "installed":
//!
//! - **Vanilla**: Mojang's `server.jar`, from the same version JSON the
//!   client install reads, checked against its SHA-1.
//! - **Fabric**: the launcher jar Fabric's meta server builds for a given
//!   Minecraft, loader and installer; plus the vanilla `server.jar` beside it,
//!   so the first start does not have to fetch anything.
//! - **Forge / NeoForge**: the same installer the client path downloads,
//!   run with `--installServer`. Modern installers leave a `libraries/` tree
//!   and an arguments file the JVM is pointed at; old ones leave a single
//!   `forge-<version>.jar`.
//!
//! What was installed is never written down: `detect_launch` reads it off
//! the folder each time, so a folder someone imported or repaired by hand is
//! as good as one Kiza filled.

use crate::game_manager::MinecraftLoader;
use crate::server_host::HostedServer;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const VANILLA_JAR: &str = "server.jar";
pub const FABRIC_LAUNCHER_JAR: &str = "fabric-server-launch.jar";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions";
const USER_AGENT: &str = "KizaLauncherAlpha/0.1";

/// How to start what is in the folder.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "kind", content = "path")]
pub enum ServerLaunch {
    /// `java … -jar <path> nogui`
    Jar(String),
    /// `java … @<path> nogui` — Forge and NeoForge since 1.17.
    ArgsFile(String),
}

impl ServerLaunch {
    /// The arguments after the JVM's own, relative to the server folder.
    pub fn arguments(&self) -> Vec<String> {
        match self {
            Self::Jar(path) => vec!["-jar".to_string(), path.clone(), "nogui".to_string()],
            Self::ArgsFile(path) => vec![format!("@{path}"), "nogui".to_string()],
        }
    }
}

/// Reads off the folder how the server starts, or `None` when nothing
/// startable is there yet.
pub fn detect_launch(server_dir: &Path, loader: &MinecraftLoader) -> Option<ServerLaunch> {
    match loader {
        MinecraftLoader::Vanilla => server_dir
            .join(VANILLA_JAR)
            .is_file()
            .then(|| ServerLaunch::Jar(VANILLA_JAR.to_string())),
        MinecraftLoader::Fabric => server_dir
            .join(FABRIC_LAUNCHER_JAR)
            .is_file()
            .then(|| ServerLaunch::Jar(FABRIC_LAUNCHER_JAR.to_string())),
        MinecraftLoader::Forge => detect_forge_like(server_dir, "net/minecraftforge/forge", "forge-"),
        MinecraftLoader::NeoForge => {
            detect_forge_like(server_dir, "net/neoforged/neoforge", "neoforge-")
        }
    }
}

/// Modern: `libraries/<group>/<version>/{win,unix}_args.txt`. Legacy: a
/// `forge-*.jar` in the root that is not the installer.
fn detect_forge_like(server_dir: &Path, group: &str, jar_prefix: &str) -> Option<ServerLaunch> {
    let args_name = if cfg!(windows) { "win_args.txt" } else { "unix_args.txt" };
    let group_dir = server_dir.join("libraries").join(group);
    if let Ok(entries) = std::fs::read_dir(&group_dir) {
        let mut versions: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        // Newest version folder first, should an upgrade have left two.
        versions.sort();
        versions.reverse();
        for version_dir in versions {
            let args = version_dir.join(args_name);
            if args.is_file() {
                let relative = args.strip_prefix(server_dir).ok()?;
                return Some(ServerLaunch::ArgsFile(to_slash(relative)));
            }
        }
    }
    let entries = std::fs::read_dir(server_dir).ok()?;
    entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            name.starts_with(jar_prefix)
                && name.ends_with(".jar")
                && !name.contains("installer")
        })
        .max()
        .map(ServerLaunch::Jar)
}

fn to_slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Where an install has got to, polled by the page.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct InstallProgress {
    pub phase: String,
    pub message: String,
    pub done: u64,
    pub total: Option<u64>,
    pub finished: bool,
    pub error: Option<String>,
    pub cancelled: bool,
}

/// A handle the install checks between steps; set from the page's Cancel.
#[derive(Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn check(&self) -> Result<(), String> {
        if self.0.load(Ordering::SeqCst) {
            Err("Cancelled.".to_string())
        } else {
            Ok(())
        }
    }
}

pub type Report = Arc<dyn Fn(InstallProgress) + Send + Sync>;

fn report(report: &Report, phase: &str, message: impl Into<String>, done: u64, total: Option<u64>) {
    report(InstallProgress {
        phase: phase.to_string(),
        message: message.into(),
        done,
        total,
        ..Default::default()
    });
}

/// The Java a server needs: the one it was told, else the one its Minecraft
/// version needs. Installed by Kiza's own runtime manager when missing.
pub async fn ensure_java(
    app_data_dir: &Path,
    server: &HostedServer,
    report_to: &Report,
) -> Result<PathBuf, String> {
    let major = server
        .java_major
        .unwrap_or_else(|| crate::minecraft_manager::required_java_major(Some(&server.mc_version)));
    let status = crate::minecraft_manager::detect_minecraft_runtime_major(app_data_dir, major);
    if let Some(path) = status.java_path.filter(|_| status.valid) {
        return Ok(PathBuf::from(path));
    }
    report(report_to, "java", format!("Installing Java {major}"), 0, None);
    let installed = crate::minecraft_manager::install_minecraft_runtime(app_data_dir, major).await?;
    installed
        .java_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("Java {major} could not be installed."))
}

/// Fetches everything the server needs to start. Idempotent: a jar already
/// there with the right hash is not fetched again.
pub async fn install(
    app_data_dir: &Path,
    server: &HostedServer,
    cancel: Cancel,
    report_to: Report,
) -> Result<ServerLaunch, String> {
    let dir = crate::server_host::server_dir(app_data_dir, &server.id);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())?;

    cancel.check()?;
    let java = ensure_java(app_data_dir, server, &report_to).await?;
    cancel.check()?;

    match server.loader {
        MinecraftLoader::Vanilla => {
            install_vanilla_jar(app_data_dir, &client, &dir, &server.mc_version, &report_to).await?;
        }
        MinecraftLoader::Fabric => {
            install_vanilla_jar(app_data_dir, &client, &dir, &server.mc_version, &report_to).await?;
            cancel.check()?;
            let loader = server
                .loader_version
                .as_deref()
                .ok_or_else(|| "Fabric needs a loader version.".to_string())?;
            let installer = latest_fabric_installer(&client).await?;
            report(&report_to, "loader", format!("Fetching Fabric {loader}"), 0, None);
            let url = format!(
                "{FABRIC_META}/loader/{}/{loader}/{installer}/server/jar",
                server.mc_version
            );
            let target = dir.join(FABRIC_LAUNCHER_JAR);
            // The meta server builds this jar per request, so there is no
            // published hash to check; a bad download fails at start, loudly.
            let _ = std::fs::remove_file(&target);
            crate::minecraft_manager::download_to_path(&client, &url, &target, None).await?;
        }
        MinecraftLoader::Forge | MinecraftLoader::NeoForge => {
            let family = if server.loader == MinecraftLoader::Forge {
                crate::forge::Family::Forge
            } else {
                crate::forge::Family::NeoForge
            };
            let version = server
                .loader_version
                .as_deref()
                .ok_or_else(|| format!("{} needs a loader version.", server.loader.slug()))?;
            report(&report_to, "loader", format!("Fetching the {} installer", server.loader.slug()), 0, None);
            let installer =
                crate::forge::download_installer(app_data_dir, family, &client, &server.mc_version, version).await?;
            cancel.check()?;
            report(&report_to, "loader", format!("Running the {} installer", server.loader.slug()), 0, None);
            run_server_installer(&java, &installer, &dir).await?;
        }
    }

    detect_launch(&dir, &server.loader)
        .ok_or_else(|| "The install finished but left nothing to start.".to_string())
}

async fn install_vanilla_jar(
    app_data_dir: &Path,
    client: &reqwest::Client,
    dir: &Path,
    mc_version: &str,
    report_to: &Report,
) -> Result<(), String> {
    report(report_to, "server", format!("Fetching the Minecraft {mc_version} server"), 0, None);
    let (url, sha1, size) =
        crate::minecraft_manager::server_jar_download(app_data_dir, client, mc_version).await?;
    report(report_to, "server", format!("Fetching the Minecraft {mc_version} server"), 0, Some(size));
    crate::minecraft_manager::download_to_path(client, &url, &dir.join(VANILLA_JAR), Some(&sha1)).await?;
    report(report_to, "server", "Server fetched", size, Some(size));
    Ok(())
}

#[derive(serde::Deserialize)]
struct FabricInstaller {
    version: String,
    stable: bool,
}

async fn latest_fabric_installer(client: &reqwest::Client) -> Result<String, String> {
    let list: Vec<FabricInstaller> = client
        .get(format!("{FABRIC_META}/installer"))
        .send()
        .await
        .map_err(|error| format!("Fabric: could not list installers: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Fabric: unreadable installer list: {error}"))?;
    list.iter()
        .find(|entry| entry.stable)
        .or_else(|| list.first())
        .map(|entry| entry.version.clone())
        .ok_or_else(|| "Fabric publishes no installer.".to_string())
}

/// `java -jar <installer> --installServer <dir>`, the way the client path
/// runs `--installClient`. The installer writes its own log into the folder.
async fn run_server_installer(java: &Path, installer: &Path, dir: &Path) -> Result<(), String> {
    let java = crate::forge::installer_java_path(java);
    let mut command = tokio::process::Command::new(&java);
    // The console `java.exe`, which would open a terminal of its own.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let output = command
        .arg("-jar")
        .arg(installer)
        .arg("--installServer")
        .arg(dir)
        .current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .map_err(|error| format!("Could not start the installer with Java: {error}"))?;
    if !output.status.success() {
        let stderr = crate::forge::output_tail(&output.stderr);
        let stdout = crate::forge::output_tail(&output.stdout);
        let details = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!("The installer failed with status {}. {details}", output.status));
    }
    // The installer drops helper scripts nobody in Kiza runs; they stay,
    // harmlessly, for whoever opens the folder. Its own log too.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_in_the_folder_is_nothing_to_start() {
        let dir = tempfile::tempdir().unwrap();
        for loader in [MinecraftLoader::Vanilla, MinecraftLoader::Fabric, MinecraftLoader::Forge, MinecraftLoader::NeoForge] {
            assert_eq!(detect_launch(dir.path(), &loader), None);
        }
    }

    #[test]
    fn a_vanilla_or_fabric_jar_is_started_with_dash_jar() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(VANILLA_JAR), b"jar").unwrap();
        assert_eq!(
            detect_launch(dir.path(), &MinecraftLoader::Vanilla),
            Some(ServerLaunch::Jar("server.jar".into()))
        );
        // A vanilla jar alone is not a Fabric server.
        assert_eq!(detect_launch(dir.path(), &MinecraftLoader::Fabric), None);
        std::fs::write(dir.path().join(FABRIC_LAUNCHER_JAR), b"jar").unwrap();
        let launch = detect_launch(dir.path(), &MinecraftLoader::Fabric).unwrap();
        assert_eq!(launch.arguments(), vec!["-jar", "fabric-server-launch.jar", "nogui"]);
    }

    #[test]
    fn a_modern_forge_install_is_started_from_its_arguments_file() {
        let dir = tempfile::tempdir().unwrap();
        let version_dir = dir.path().join("libraries/net/neoforged/neoforge/21.1.74");
        std::fs::create_dir_all(&version_dir).unwrap();
        std::fs::write(version_dir.join("win_args.txt"), b"-p ...").unwrap();
        std::fs::write(version_dir.join("unix_args.txt"), b"-p ...").unwrap();
        let launch = detect_launch(dir.path(), &MinecraftLoader::NeoForge).unwrap();
        let expected = if cfg!(windows) { "win_args.txt" } else { "unix_args.txt" };
        assert_eq!(
            launch,
            ServerLaunch::ArgsFile(format!("libraries/net/neoforged/neoforge/21.1.74/{expected}"))
        );
        assert_eq!(launch.arguments()[0], format!("@libraries/net/neoforged/neoforge/21.1.74/{expected}"));
        // Forge does not answer for NeoForge's folder.
        assert_eq!(detect_launch(dir.path(), &MinecraftLoader::Forge), None);
    }

    #[test]
    fn an_old_forge_install_is_its_jar_and_never_the_installer() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("forge-1.16.5-36.2.39-installer.jar"), b"i").unwrap();
        assert_eq!(detect_launch(dir.path(), &MinecraftLoader::Forge), None);
        std::fs::write(dir.path().join("forge-1.16.5-36.2.39.jar"), b"j").unwrap();
        assert_eq!(
            detect_launch(dir.path(), &MinecraftLoader::Forge),
            Some(ServerLaunch::Jar("forge-1.16.5-36.2.39.jar".into()))
        );
    }
}
