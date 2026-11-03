//! Kizaflux in the launcher: the instances whose engine is Horizon, the Rust
//! engine, instead of Java (kizaflux/docs/architecture.md).
//!
//! The steps themselves live in the `flux-*` crates, which do no network;
//! this module fetches what they need with the launcher's client, runs what
//! they build, and reports through the launch status the Play button already
//! follows. A Java instance never comes through here.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use flux_core::horizon::{self, install, launch, layout::Installed, release, signature};
use serde::Serialize;
use sha1::{Digest, Sha1};

use crate::base_mod::StateBridgeSession;
use crate::game_manager::{GameInstance, MinecraftLoader};
use crate::minecraft_manager::{
    LaunchManager, LaunchPhase, MinecraftLaunchRequest, MinecraftLaunchResult,
    LAUNCHER_CAPTURED_LOG,
};

/// The Minecraft version Kizaflux offers before any release is installed.
/// Once one is, its `research-lock.json` is what counts.
pub const KNOWN_MINECRAFT: &str = "26.3";

/// One install or preparation at a time: two instances started together
/// would otherwise unpack or prepare the same release twice.
static ENGINE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("kizaflux")
}

fn engines_dir(app_data_dir: &Path) -> PathBuf {
    root(app_data_dir).join("engines").join("horizon")
}

fn client() -> Result<reqwest::Client, String> {
    // GitHub's API refuses requests without a User-Agent.
    reqwest::Client::builder()
        .user_agent(concat!(
            "KizaLauncher/",
            env!("CARGO_PKG_VERSION"),
            " (Kizaflux)"
        ))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{url}: {}", response.status()));
    }
    Ok(response
        .bytes()
        .await
        .map_err(|e| format!("{url}: {e}"))?
        .to_vec())
}

/// The installed releases, newest first.
pub fn installed_releases(app_data_dir: &Path) -> Vec<(Vec<u64>, Installed)> {
    let mut found: Vec<(Vec<u64>, Installed)> = fs::read_dir(engines_dir(app_data_dir))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let tag = entry.file_name().to_string_lossy().into_owned();
            let version = release::game_version(&tag)?;
            let installed = Installed::open(&entry.path()).ok()?;
            install::record(&entry.path())?;
            Some((version, installed))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found
}

/// The newest installed release that plays `minecraft`.
fn installed_for(app_data_dir: &Path, minecraft: &str) -> Option<Installed> {
    installed_releases(app_data_dir)
        .into_iter()
        .map(|(_, installed)| installed)
        .find(|installed| installed.lock.minecraft == minecraft)
}

/// The Minecraft versions the installed releases play, newest first.
fn installed_minecraft_versions(releases: &[(Vec<u64>, Installed)]) -> Vec<String> {
    let mut versions: Vec<String> = Vec::new();
    for (_, installed) in releases {
        if !versions.contains(&installed.lock.minecraft) {
            versions.push(installed.lock.minecraft.clone());
        }
    }
    versions
}

fn tag_of(installed: &Installed) -> String {
    installed
        .dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// What the interface shows about the engine.
#[derive(Serialize, Clone, Debug)]
pub struct KizafluxStatus {
    /// Whether this system has a Horizon build at all.
    pub available: bool,
    /// The Minecraft versions an instance can be made for, newest first:
    /// those of the installed releases, or, with none, the one Kiza knows.
    pub minecraft_versions: Vec<String>,
    pub installed: Option<String>,
    pub prepared: bool,
}

pub fn status(app_data_dir: &Path) -> KizafluxStatus {
    let releases = installed_releases(app_data_dir);
    let mut minecraft_versions = installed_minecraft_versions(&releases);
    if minecraft_versions.is_empty() {
        minecraft_versions.push(KNOWN_MINECRAFT.to_string());
    }
    let installed = releases.into_iter().next().map(|(_, installed)| installed);
    KizafluxStatus {
        available: horizon::platform_asset().is_some(),
        minecraft_versions,
        installed: installed.as_ref().map(tag_of),
        prepared: installed.as_ref().is_some_and(Installed::is_prepared),
    }
}

/// The newest signed release on GitHub, installed if it is not yet.
async fn install_newest(
    app_data_dir: &Path,
    report: &(dyn Fn(&str) + Send + Sync),
) -> Result<Installed, String> {
    let asset = horizon::platform_asset().ok_or("Kizaflux has no build for this system.")?;
    let client = client()?;
    report("Looking for the newest Kizaflux engine");
    let list = fetch(
        &client,
        &format!(
            "https://api.github.com/repos/{}/releases?per_page=30",
            horizon::REPOSITORY
        ),
    )
    .await?;
    let candidate = release::newest(&String::from_utf8_lossy(&list), asset)?
        .ok_or("No signed Horizon release carries a build for this system.")?;
    let destination = engines_dir(app_data_dir).join(&candidate.tag);
    if let Ok(installed) = Installed::open(&destination) {
        return Ok(installed);
    }
    let sums = fetch(&client, &candidate.sums.url).await?;
    let sig = fetch(&client, &candidate.signature.url).await?;
    let sha256 = signature::signed_digest(
        &candidate.tag,
        asset,
        &sums,
        &String::from_utf8_lossy(&sig),
        &signature::trusted_keys(),
    )?;
    report(&format!(
        "Downloading the Kizaflux engine (Horizon {}, {} MB)",
        candidate.tag,
        candidate.archive.size / 1_000_000
    ));
    let archive = fetch(&client, &candidate.archive.url).await?;
    let record = install::InstallRecord {
        tag: candidate.tag.clone(),
        asset: asset.into(),
        sha256,
    };
    let into = destination.clone();
    tokio::task::spawn_blocking(move || {
        install::install(&archive, &record, &into, &install::Limits::default())
    })
    .await
    .map_err(|e| e.to_string())??;
    crate::log_info!("Kizaflux", "Installed Horizon {}", candidate.tag);
    Installed::open(&destination)
}

/// Prepares a release's resources from the launcher's own Minecraft files:
/// once per release, about three minutes.
async fn prepare(
    app_data_dir: &Path,
    installed: &Installed,
    report: &(dyn Fn(&str) + Send + Sync),
) -> Result<(), String> {
    let lock = &installed.lock;
    let minecraft_dir = crate::minecraft_manager::global_root(app_data_dir);
    if !minecraft_installed(app_data_dir, &lock.minecraft) {
        return Err(format!(
            "Minecraft {} is not installed yet: install the instance first.",
            lock.minecraft
        ));
    }

    report(&format!("Getting Java {}", lock.java_major));
    let java = java_home(app_data_dir, lock.java_major).await?;

    let client = client()?;
    // Kiza keeps its version files rewritten; Horizon reads only Mojang's
    // exact bytes, fetched by the SHA-1 the release pins.
    let url = installed
        .manifest_url()
        .ok_or("The release pins no Minecraft version file.")?;
    let manifest = fetch(&client, &url).await?;
    installed.seed_manifest(&manifest)?;

    let server_jar = server_jar(app_data_dir, &client, &manifest).await?;

    report("Preparing Kizaflux from your Minecraft files (once, about 3 minutes)");
    let log = root(app_data_dir)
        .join("logs")
        .join(format!("prepare-{}.log", tag_of(installed)));
    run_logged(
        launch::prepare_command(installed, &java, &minecraft_dir, &server_jar),
        &log,
    )
    .await?;
    report("Copying Minecraft's sounds for Kizaflux");
    // Without sounds the game is silent, not broken: a failure is logged.
    let sounds_log = root(app_data_dir)
        .join("logs")
        .join(format!("sounds-{}.log", tag_of(installed)));
    if let Err(error) = run_logged(
        launch::sounds_command(installed, &java, &minecraft_dir),
        &sounds_log,
    )
    .await
    {
        crate::log_warn!("Kizaflux", "Sounds were not prepared: {error}");
    }
    if !installed.is_prepared() {
        return Err(format!(
            "The preparation did not finish; see {}",
            log.display()
        ));
    }
    Ok(())
}

/// Whether the launcher holds Minecraft `version`'s game jar, which
/// preparing a release reads.
fn minecraft_installed(app_data_dir: &Path, version: &str) -> bool {
    crate::minecraft_manager::global_root(app_data_dir)
        .join("versions")
        .join(version)
        .join(format!("{version}.jar"))
        .is_file()
}

async fn java_home(app_data_dir: &Path, major: u32) -> Result<PathBuf, String> {
    let status = crate::minecraft_manager::detect_minecraft_runtime_major(app_data_dir, major);
    let java = match status.java_path.filter(|_| status.valid) {
        Some(path) => path,
        None => crate::minecraft_manager::install_minecraft_runtime(app_data_dir, major)
            .await?
            .java_path
            .ok_or_else(|| format!("Java {major} could not be installed."))?,
    };
    // .../bin/java(w).exe -> the home.
    PathBuf::from(java)
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| "Java's folder could not be found.".to_string())
}

/// The server jar the version file names, kept by its SHA-1.
async fn server_jar(
    app_data_dir: &Path,
    client: &reqwest::Client,
    manifest: &[u8],
) -> Result<PathBuf, String> {
    let value: serde_json::Value = serde_json::from_slice(manifest).map_err(|e| e.to_string())?;
    let server = value
        .pointer("/downloads/server")
        .ok_or("The version file names no server jar.")?;
    let url = server
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("No server jar address.")?;
    let sha1 = server
        .get("sha1")
        .and_then(|v| v.as_str())
        .ok_or("No server jar SHA-1.")?;
    let path = root(app_data_dir)
        .join("cache")
        .join(format!("server-{sha1}.jar"));
    if path.is_file() {
        return Ok(path);
    }
    let bytes = fetch(client, url).await?;
    let actual: String = Sha1::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if actual != sha1 {
        return Err("The downloaded server jar is not the one Mojang lists.".into());
    }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

async fn run_logged(mut command: std::process::Command, log: &Path) -> Result<(), String> {
    if let Some(parent) = log.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = fs::File::create(log).map_err(|e| e.to_string())?;
    let err = file.try_clone().map_err(|e| e.to_string())?;
    command.stdout(Stdio::from(file)).stderr(Stdio::from(err));
    no_window(&mut command);
    let status = tokio::task::spawn_blocking(move || command.status())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{status}; see {}", log.display()))
    }
}

fn no_window(command: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// An installed and prepared release for `minecraft`: the newest installed
/// one that plays it, or, with none, the newest on GitHub if it plays it.
pub async fn ready_engine(
    app_data_dir: &Path,
    minecraft: &str,
    report: &(dyn Fn(&str) + Send + Sync),
) -> Result<Installed, String> {
    let _guard = ENGINE_LOCK.lock().await;
    let installed = match installed_for(app_data_dir, minecraft) {
        Some(installed) => installed,
        None => install_newest(app_data_dir, report).await?,
    };
    // Horizon follows Minecraft: its newest release can play a newer version
    // than the instance. It stays installed, for instances of that version.
    if installed.lock.minecraft != minecraft {
        return Err(format!(
            "This instance is Minecraft {minecraft}, and the Kizaflux engine now plays Minecraft {}. Make a new Kizaflux instance for {}.",
            installed.lock.minecraft, installed.lock.minecraft
        ));
    }
    if !installed.is_prepared() {
        prepare(app_data_dir, &installed, report).await?;
    }
    Ok(installed)
}

/// Installs the newest release and prepares it when its Minecraft version is
/// installed (otherwise the first Play of an instance of that version does),
/// then removes the older releases of the same Minecraft version with their
/// resources (about 1.3 GB each). Instances of another version keep theirs.
pub async fn update(
    app_data_dir: &Path,
    report: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    let _guard = ENGINE_LOCK.lock().await;
    let installed = install_newest(app_data_dir, report).await?;
    if !installed.is_prepared() && minecraft_installed(app_data_dir, &installed.lock.minecraft) {
        prepare(app_data_dir, &installed, report).await?;
    }
    let keep = tag_of(&installed);
    for (_, old) in installed_releases(app_data_dir) {
        if tag_of(&old) != keep && old.lock.minecraft == installed.lock.minecraft {
            if let Err(error) = fs::remove_dir_all(&old.dir) {
                crate::log_warn!(
                    "Kizaflux",
                    "Could not remove {}: {error}",
                    old.dir.display()
                );
            }
        }
    }
    Ok(keep)
}

/// Whether an instance can be a Kizaflux one: vanilla, a version the
/// engine plays.
pub fn check_instance(
    app_data_dir: &Path,
    mc_version: &str,
    loader: &MinecraftLoader,
) -> Result<(), String> {
    if *loader != MinecraftLoader::Vanilla {
        return Err(
            "Kizaflux plays vanilla Minecraft: its mods are Horizon mods, not a loader's.".into(),
        );
    }
    let status = status(app_data_dir);
    if !status.available {
        return Err("Kizaflux has no build for this system.".into());
    }
    if !status.minecraft_versions.iter().any(|v| v == mc_version) {
        return Err(format!(
            "Kizaflux plays Minecraft {} only.",
            status.minecraft_versions.join(", ")
        ));
    }
    Ok(())
}

/// Starts a Kizaflux instance: what `launch_minecraft` does for Java, with
/// the same result, so the launcher follows the game the same way.
pub async fn launch_instance(
    app_data_dir: PathBuf,
    instance: GameInstance,
    req: MinecraftLaunchRequest,
    launch_manager: LaunchManager,
) -> Result<
    (
        MinecraftLaunchResult,
        std::process::Child,
        Option<StateBridgeSession>,
    ),
    String,
> {
    let id = instance.id.clone();
    let report = |message: &str| {
        launch_manager.set_phase(&id, LaunchPhase::DownloadingGame, Some(message.to_string()));
    };
    let mc = instance
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance")?;
    let installed = ready_engine(&app_data_dir, &mc.mc_version, &report).await?;
    launch_manager.set_phase(&id, LaunchPhase::Starting, Some("Starting Kizaflux".into()));

    let game_dir = PathBuf::from(&instance.install_path);
    fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
    let session_file = match (&req.access_token, &req.uuid) {
        (Some(token), Some(uuid)) => Some(launch::write_session_file(
            &root(&app_data_dir).join("sessions"),
            &launch::Session {
                name: req.username.clone(),
                uuid: uuid.clone(),
                access_token: token.clone(),
                xuid: None,
            },
        )?),
        _ => None,
    };
    let account_mode = if session_file.is_some() {
        "microsoft"
    } else {
        "offline"
    }
    .to_string();
    let mut extra_args = Vec::new();
    if session_file.is_none() {
        // Offline: the typed name, single player and offline servers only.
        extra_args.extend(["--name".to_string(), req.username.clone()]);
    }
    let mut command = launch::play_command(
        &installed,
        &launch::PlayOptions {
            game_dir: game_dir.clone(),
            session_file,
            extra_args,
            ..Default::default()
        },
    );

    let logs_dir = game_dir.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    let log_path = logs_dir.join(LAUNCHER_CAPTURED_LOG);
    let mut log_file = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let header = format!(
        "Kiza Launcher {} · Kizaflux · Horizon {} · Minecraft {} · {} · {}\n",
        env!("CARGO_PKG_VERSION"),
        tag_of(&installed),
        installed.lock.minecraft,
        instance.display_name,
        account_mode,
    );
    let _ = std::io::Write::write_all(&mut log_file, header.as_bytes());
    let err_file = log_file.try_clone().map_err(|e| e.to_string())?;
    command
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(err_file));
    no_window(&mut command);
    let child = command
        .spawn()
        .map_err(|e| format!("Kizaflux did not start: {e}"))?;
    Ok((
        MinecraftLaunchResult {
            pid: child.id(),
            java: format!("Kizaflux (Horizon {})", tag_of(&installed)),
            main_class: horizon::client_program().into(),
            profile_id: String::new(),
            log_path: log_path.to_string_lossy().into_owned(),
            account_mode,
            courtesies: Vec::new(),
        },
        child,
        None,
    ))
}

/// Every archive an instance holds, with its Kizaflux status.
#[derive(Serialize, Clone, Debug)]
pub struct ScannedFile {
    /// The folder it was found in: `horizon-mods`, `mods`, `resourcepacks`.
    pub folder: String,
    pub report: flux_diagnostics::Report,
    /// For a Horizon mod, or a Java mod brought over: whether it is on in
    /// `horizon-mods.txt`.
    pub enabled: Option<bool>,
    /// For a Java mod: what Horizon's carry-over made of it, once checked.
    /// It decides the status: the archive's metadata only guesses.
    pub carry: Option<CarryVerdict>,
}

/// Horizon's carry-over verdict on a jar, for the interface.
#[derive(Serialize, Clone, Debug)]
pub struct CarryVerdict {
    /// `works`, `partly` or `no`.
    pub verdict: flux_bridge::Verdict,
    pub summary: String,
    pub ports: Vec<String>,
    pub skipped: Vec<String>,
    pub mod_id: String,
    /// Its content is in `horizon-mods/<mod id>/`.
    pub installed: bool,
}

fn checks_dir(app_data_dir: &Path) -> PathBuf {
    root(app_data_dir).join("checks")
}

fn sha1_of(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Sha1::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

fn carry_verdict(check: &flux_bridge::Check, game_dir: &Path) -> CarryVerdict {
    CarryVerdict {
        verdict: check.verdict,
        summary: check.summary.clone(),
        ports: check.ports.clone(),
        skipped: check.skipped.clone(),
        mod_id: check.mod_id.clone(),
        installed: game_dir
            .join(flux_bridge::MODS_DIR)
            .join(&check.mod_id)
            .is_dir(),
    }
}

/// The status a carry verdict gives a jar: what came across, not what the
/// metadata suggested.
fn status_of(verdict: flux_bridge::Verdict) -> flux_diagnostics::Status {
    match verdict {
        flux_bridge::Verdict::Works => flux_diagnostics::Status::ResourcesOnly,
        flux_bridge::Verdict::Partly => flux_diagnostics::Status::NeedsAdaptation,
        flux_bridge::Verdict::No => flux_diagnostics::Status::Incompatible,
    }
}

pub fn scan_instance(app_data_dir: &Path, instance: &GameInstance) -> Vec<ScannedFile> {
    let game_dir = PathBuf::from(&instance.install_path);
    let minecraft = instance
        .minecraft
        .as_ref()
        .map(|mc| mc.mc_version.clone())
        .unwrap_or_else(|| KNOWN_MINECRAFT.into());
    let target = flux_diagnostics::Target { minecraft };
    let checks = checks_dir(app_data_dir);
    let mut files = Vec::new();
    for folder in ["horizon-mods", "mods", "resourcepacks"] {
        let Ok(entries) = fs::read_dir(game_dir.join(folder)) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .is_some_and(|e| e == "jar" || e == "zip" || e == "hmod")
            })
            .collect();
        paths.sort();
        for path in paths {
            let mut report = match flux_diagnostics::analyze_file(
                &path,
                &target,
                &flux_diagnostics::Limits::default(),
            ) {
                Ok(report) => report,
                Err(error) => {
                    crate::log_warn!("Kizaflux", "{}: {error}", path.display());
                    continue;
                }
            };
            let horizon = matches!(
                report.kind,
                flux_diagnostics::Kind::Mod(flux_diagnostics::Loader::Horizon)
            );
            let java =
                matches!(report.kind, flux_diagnostics::Kind::Mod(loader) if loader.is_java());
            let carry = java
                .then(|| flux_bridge::cached(&checks, &report.sha1))
                .flatten()
                .map(|check| carry_verdict(&check, &game_dir));
            if let Some(carry) = &carry {
                report.status = status_of(carry.verdict);
            }
            let enabled = if horizon {
                report
                    .mod_ids()
                    .first()
                    .map(|id| flux_bridge::is_enabled(&game_dir, id))
            } else {
                carry
                    .as_ref()
                    .filter(|c| c.installed)
                    .map(|c| flux_bridge::is_enabled(&game_dir, &c.mod_id))
            };
            files.push(ScannedFile {
                folder: folder.into(),
                report,
                enabled,
                carry,
            });
        }
    }
    files
}

/// Brings a Java mod of the instance's `mods/` over: Horizon's carry-over,
/// then, when something ports, the content mod installed and turned on.
pub fn carry_mod(
    app_data_dir: &Path,
    instance: &GameInstance,
    file_name: &str,
) -> Result<CarryVerdict, String> {
    if file_name.contains(['/', '\\']) || file_name.starts_with('.') || !file_name.ends_with(".jar")
    {
        return Err("Not a jar of this instance's mods folder.".into());
    }
    let game_dir = PathBuf::from(&instance.install_path);
    let jar = game_dir.join("mods").join(file_name);
    let checks = checks_dir(app_data_dir);
    let sha1 = sha1_of(&jar)?;
    let check = flux_bridge::check(&jar, &sha1, &checks)?;
    if check.verdict != flux_bridge::Verdict::No {
        flux_bridge::install(&game_dir, &checks, &sha1, &check)?;
    }
    Ok(carry_verdict(&check, &game_dir))
}

/// Turns a Horizon mod, or a brought-over one, on or off for the next start.
pub fn set_mod_enabled(game_dir: &Path, mod_id: &str, enabled: bool) -> Result<(), String> {
    flux_bridge::set_enabled(game_dir, mod_id, enabled)
}

/// Removes a brought-over mod's content; its jar stays in `mods/`.
pub fn remove_carried(game_dir: &Path, mod_id: &str) -> Result<(), String> {
    flux_bridge::remove(game_dir, mod_id)
}

/// What "Make a Kizaflux copy" made and carried over.
#[derive(Serialize, Clone, Debug)]
pub struct KizafluxCopy {
    pub instance: GameInstance,
    pub worlds: usize,
    pub resource_packs: usize,
    pub options: bool,
    /// The source's mods, which stay behind, each with what Kizaflux can do
    /// with it: the report the player reads before choosing.
    pub mods: Vec<ScannedFile>,
}

/// A new Kizaflux instance made from a Java one: copies of its worlds,
/// resource packs, options and server list. The Java instance is only read,
/// so it stays playable as it was, and its worlds stay where they are:
/// Horizon upgrades the copies, never the originals.
pub fn copy_from_java(
    app_data_dir: &Path,
    source: &GameInstance,
    display_name: String,
    report_progress: &dyn Fn(&str),
) -> Result<KizafluxCopy, String> {
    let source_mc = source
        .minecraft
        .as_ref()
        .ok_or("Not a Minecraft instance")?;
    if source_mc.engine != crate::game_manager::Engine::Java {
        return Err("This instance already plays on Kizaflux.".into());
    }
    let status = status(app_data_dir);
    if !status.available {
        return Err("Kizaflux has no build for this system.".into());
    }
    let version = status
        .minecraft_versions
        .first()
        .cloned()
        .ok_or("Kizaflux plays no Minecraft version.")?;
    let mut instance = crate::minecraft_manager::create_minecraft_instance(
        app_data_dir,
        display_name,
        version.clone(),
        MinecraftLoader::Vanilla,
        None,
        None,
    )?;
    if let Some(mc) = instance.minecraft.as_mut() {
        mc.engine = crate::game_manager::Engine::Kizaflux;
    }
    crate::minecraft_manager::save_instance_config(app_data_dir, &instance)?;

    let from = PathBuf::from(&source.install_path);
    let to = PathBuf::from(&instance.install_path);
    let worlds = copy_children(&from.join("saves"), &to.join("saves"), |p| {
        p.join("level.dat").is_file()
    })?;
    let resource_packs = copy_children(
        &from.join("resourcepacks"),
        &to.join("resourcepacks"),
        |_| true,
    )?;
    let mut options = false;
    for file in ["options.txt", "servers.dat"] {
        if from.join(file).is_file() {
            fs::copy(from.join(file), to.join(file)).map_err(|e| format!("{file}: {e}"))?;
            options |= file == "options.txt";
        }
    }

    // Each mod through Horizon's carry-over: what ports goes into the copy's
    // horizon-mods, turned on; the jars themselves stay with the Java one.
    let target = flux_diagnostics::Target { minecraft: version };
    let checks = checks_dir(app_data_dir);
    let mut jars: Vec<PathBuf> = fs::read_dir(from.join("mods"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "jar"))
        .collect();
    jars.sort();
    let mut mods = Vec::new();
    for (index, jar) in jars.iter().enumerate() {
        let Ok(mut report) =
            flux_diagnostics::analyze_file(jar, &target, &flux_diagnostics::Limits::default())
        else {
            continue;
        };
        report_progress(&format!(
            "Bringing mods over ({}/{}): {}",
            index + 1,
            jars.len(),
            report.file_name
        ));
        let carry = match flux_bridge::check(jar, &report.sha1, &checks) {
            Ok(check) => {
                if check.verdict != flux_bridge::Verdict::No {
                    if let Err(error) = flux_bridge::install(&to, &checks, &report.sha1, &check) {
                        report.reasons.push(error);
                    }
                }
                report.status = status_of(check.verdict);
                Some(carry_verdict(&check, &to))
            }
            Err(error) => {
                report
                    .reasons
                    .push(format!("Horizon's carry-over could not read it: {error}"));
                None
            }
        };
        let enabled = carry.as_ref().filter(|c| c.installed).map(|_| true);
        mods.push(ScannedFile {
            folder: "mods".into(),
            report,
            enabled,
            carry,
        });
    }
    Ok(KizafluxCopy {
        instance,
        worlds,
        resource_packs,
        options,
        mods,
    })
}

/// Copies each entry of `from` that `keep` accepts into `to`; returns how
/// many. Links are not followed.
fn copy_children(from: &Path, to: &Path, keep: impl Fn(&Path) -> bool) -> Result<usize, String> {
    let Ok(entries) = fs::read_dir(from) else {
        return Ok(0);
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() || !keep(&path) {
            continue;
        }
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::create_dir_all(to).map_err(|e| e.to_string())?;
            fs::copy(&path, &target).map_err(|e| format!("{}: {e}", path.display()))?;
        }
        count += 1;
    }
    Ok(count)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        // session.lock is held by a running game; a copy does not need it.
        if kind.is_symlink() || entry.file_name() == "session.lock" {
            continue;
        }
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)
                .map_err(|e| format!("{}: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
pub struct ServerCheck {
    pub verdict: flux_network::Verdict,
    pub status: Option<flux_network::ServerStatus>,
    pub engine_minecraft: String,
}

pub async fn check_server(app_data_dir: &Path, address: String) -> Result<ServerCheck, String> {
    let minecraft = status(app_data_dir)
        .minecraft_versions
        .first()
        .cloned()
        .unwrap_or_default();
    let protocol = flux_network::protocol_of(&minecraft)
        .ok_or_else(|| format!("No protocol is known for Minecraft {minecraft}."))?;
    let (verdict, status) = tokio::task::spawn_blocking(move || {
        flux_network::probe(&address, protocol, &flux_network::Options::default())
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(ServerCheck {
        verdict,
        status,
        engine_minecraft: minecraft,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mod_outside_the_mods_folder_is_not_carried() {
        let dir = tempfile::tempdir().unwrap();
        let instance: GameInstance = serde_json::from_value(serde_json::json!({
            "schema_version": 1, "id": "x", "game_id": "minecraft", "display_name": "x",
            "install_path": dir.path(), "executable_path": "", "mods_path": dir.path(),
            "detected_variant": null, "status": "Valid", "created_at": "", "last_verified_at": null,
        }))
        .unwrap();
        for name in ["../evil.jar", "a\\b.jar", ".hidden.jar", "notajar.zip"] {
            assert!(carry_mod(dir.path(), &instance, name).is_err(), "{name}");
        }
    }

    #[test]
    fn only_vanilla_instances_of_the_engines_version() {
        let dir = tempfile::tempdir().unwrap();
        assert!(check_instance(dir.path(), KNOWN_MINECRAFT, &MinecraftLoader::Fabric).is_err());
        assert!(check_instance(dir.path(), "1.21.1", &MinecraftLoader::Vanilla).is_err());
        if horizon::platform_asset().is_some() {
            assert!(check_instance(dir.path(), KNOWN_MINECRAFT, &MinecraftLoader::Vanilla).is_ok());
        }
    }

    #[test]
    fn each_minecraft_version_once_newest_first() {
        let release = |minecraft: &str| Installed {
            dir: PathBuf::new(),
            lock: flux_core::horizon::layout::Lock {
                minecraft: minecraft.into(),
                java_major: 25,
                server_sha1: None,
                manifest_sha1: None,
                accepted_manifest_sha1: Vec::new(),
            },
        };
        let releases = vec![
            (vec![0, 3, 1], release("26.4")),
            (vec![0, 3, 0], release("26.4")),
            (vec![0, 2, 96], release("26.3")),
        ];
        assert_eq!(installed_minecraft_versions(&releases), ["26.4", "26.3"]);
    }

    /// The whole path on a real machine, in an app data folder of its own
    /// whose `minecraft/global` is the launcher's (a junction): the newest
    /// release from GitHub, its signature, the preparation, then a start,
    /// stopped once the first frame is drawn. A window opens for a moment.
    ///
    /// `KIZAFLUX_E2E_APP_DATA=<folder> cargo test --lib kizaflux::tests::end_to_end -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn end_to_end() {
        let dir =
            PathBuf::from(std::env::var("KIZAFLUX_E2E_APP_DATA").expect("KIZAFLUX_E2E_APP_DATA"));
        let started = std::time::Instant::now();
        let report =
            move |message: &str| println!("[{:>6.1} s] {message}", started.elapsed().as_secs_f64());
        let installed = ready_engine(&dir, KNOWN_MINECRAFT, &report).await.unwrap();
        report(&format!(
            "ready: Horizon {} for Minecraft {}",
            tag_of(&installed),
            installed.lock.minecraft
        ));

        let game = dir.join("instances").join("e2e").join("game");
        let instance: GameInstance = serde_json::from_value(serde_json::json!({
            "schema_version": 1, "id": "e2e", "game_id": "minecraft", "display_name": "Kizaflux e2e",
            "install_path": game, "executable_path": "", "mods_path": dir.join("mods"),
            "detected_variant": "Managed", "status": "Valid", "created_at": "", "last_verified_at": null,
            "minecraft": { "mc_version": installed.lock.minecraft, "loader": "vanilla", "loader_version": null, "engine": "kizaflux" },
        }))
        .unwrap();
        let request = MinecraftLaunchRequest {
            instance_id: "e2e".into(),
            username: "KizafluxE2E".into(),
            uuid: None,
            access_token: None,
            user_type: None,
        };
        let (result, mut child, bridge) =
            launch_instance(dir.clone(), instance, request, LaunchManager::new())
                .await
                .unwrap();
        assert!(bridge.is_none());
        report(&format!("started, pid {}", result.pid));
        let mut drawn = false;
        for _ in 0..120 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let log = fs::read_to_string(&result.log_path).unwrap_or_default();
            if log.contains("first frame after") {
                drawn = true;
                break;
            }
            if let Ok(Some(status)) = child.try_wait() {
                panic!("the game exited ({status}):\n{log}");
            }
        }
        report(if drawn {
            "first frame drawn"
        } else {
            "no first frame within 60 s"
        });
        std::thread::sleep(std::time::Duration::from_secs(3));
        let _ = child.kill();
        let _ = child.wait();
        println!(
            "{}",
            fs::read_to_string(&result.log_path)
                .unwrap_or_default()
                .lines()
                .take(3)
                .collect::<Vec<_>>()
                .join("\n")
        );
        assert!(drawn);
    }

    #[test]
    fn a_copy_takes_worlds_and_packs_and_leaves_the_rest() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        let world = from.path().join("saves").join("Survie");
        fs::create_dir_all(world.join("region")).unwrap();
        fs::write(world.join("level.dat"), b"nbt").unwrap();
        fs::write(world.join("session.lock"), b"").unwrap();
        fs::write(world.join("region").join("r.0.0.mca"), b"mca").unwrap();
        fs::create_dir_all(from.path().join("saves").join("not a world")).unwrap();
        let copied = copy_children(&from.path().join("saves"), &to.path().join("saves"), |p| {
            p.join("level.dat").is_file()
        })
        .unwrap();
        assert_eq!(copied, 1);
        assert!(to.path().join("saves/Survie/region/r.0.0.mca").is_file());
        assert!(!to.path().join("saves/Survie/session.lock").exists());
        assert!(!to.path().join("saves/not a world").exists());
        // The original is untouched.
        assert!(world.join("session.lock").is_file());
        assert_eq!(
            copy_children(&from.path().join("nothing"), &to.path().join("x"), |_| true).unwrap(),
            0
        );
    }

    #[test]
    fn an_instance_written_before_kizaflux_reads_as_java() {
        let config: crate::game_manager::MinecraftInstanceConfig = serde_json::from_str(
            r#"{"mc_version":"1.21.1","loader":"fabric","loader_version":"0.16.0","java_major":null}"#,
        )
        .unwrap();
        assert_eq!(config.engine, crate::game_manager::Engine::Java);
        // And a Java instance is written back without the field.
        assert!(!serde_json::to_string(&config).unwrap().contains("engine"));
    }
}
