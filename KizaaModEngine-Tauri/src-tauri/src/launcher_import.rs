//! Bringing an instance over from another launcher.
//!
//! Most people who try Kiza already have a Minecraft somewhere: a CurseForge
//! App with three packs, a Modrinth App profile, a Prism instance, the
//! official launcher's `.minecraft` with two years of worlds in it. Asking
//! them to rebuild any of that by hand is asking them not to switch. This
//! reads the places those launchers keep their instances, says what it
//! found, and copies what is chosen: the folder as it is -- mods, configs,
//! worlds, packs, options -- into a fresh Kiza instance whose version and
//! loader are read from the other launcher's own records, never guessed.
//!
//! Nothing is moved or changed in the other launcher. A copy is a copy.

use crate::game_manager::{GameInstance, MinecraftLoader};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    CurseForgeApp,
    ModrinthApp,
    Prism,
    MultiMc,
    OfficialLauncher,
}

impl Source {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn label(self) -> &'static str {
        match self {
            Source::CurseForgeApp => "CurseForge App",
            Source::ModrinthApp => "Modrinth App",
            Source::Prism => "Prism Launcher",
            Source::MultiMc => "MultiMC",
            Source::OfficialLauncher => "Minecraft Launcher",
        }
    }
}

/// An instance another launcher has, as far as its own records say.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FoundInstance {
    pub source: Source,
    pub name: String,
    /// The folder the game runs in: where `mods/`, `saves/` and `options.txt` are.
    pub game_dir: String,
    pub mc_version: String,
    pub loader: MinecraftLoader,
    pub loader_version: Option<String>,
    pub mods: usize,
    pub worlds: usize,
    /// Bytes under the folder, so the person knows what a copy costs.
    pub bytes: u64,
    /// CurseForge's own record of each mod's project and file, when the
    /// source keeps one; it becomes Kiza's provenance so the mods can be
    /// updated afterwards.
    #[serde(default)]
    pub provenance: Vec<KnownMod>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct KnownMod {
    pub file_name: String,
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
}

/// Where each launcher keeps its instances on Windows.
struct Roots {
    curseforge: Vec<PathBuf>,
    modrinth: Vec<PathBuf>,
    prism: Vec<PathBuf>,
    multimc: Vec<PathBuf>,
    official: Vec<PathBuf>,
}

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

fn roots() -> Roots {
    let home = env_dir("USERPROFILE");
    let roaming = env_dir("APPDATA");
    let local = env_dir("LOCALAPPDATA");
    let mut prism = Vec::new();
    if let Some(r) = &roaming {
        prism.push(r.join("PrismLauncher"));
    }
    if let Some(l) = &local {
        prism.push(l.join("Programs").join("PrismLauncher"));
    }
    Roots {
        curseforge: home
            .iter()
            .map(|h| h.join("curseforge").join("minecraft").join("Instances"))
            .collect(),
        modrinth: roaming
            .iter()
            .flat_map(|r| [r.join("ModrinthApp"), r.join("com.modrinth.theseus")])
            .collect(),
        prism,
        multimc: roaming
            .iter()
            .flat_map(|r| [r.join("MultiMC"), r.join("multimc")])
            .collect(),
        official: roaming.iter().map(|r| r.join(".minecraft")).collect(),
    }
}

/// Everything the known launchers have, on this machine.
pub fn scan() -> Vec<FoundInstance> {
    let roots = roots();
    let mut found = Vec::new();
    for root in &roots.curseforge {
        found.extend(scan_curseforge(root));
    }
    for root in &roots.modrinth {
        found.extend(scan_modrinth(root));
    }
    for root in &roots.prism {
        found.extend(scan_mmc_family(&root.join("instances"), Source::Prism));
    }
    for root in &roots.multimc {
        found.extend(scan_mmc_family(&root.join("instances"), Source::MultiMc));
    }
    for root in &roots.official {
        found.extend(scan_official(root));
    }
    found
}

fn count_jars(dir: &Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .ends_with(".jar")
                })
                .count()
        })
        .unwrap_or(0)
}

fn count_worlds(dir: &Path) -> usize {
    fs::read_dir(dir.join("saves"))
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().join("level.dat").is_file())
                .count()
        })
        .unwrap_or(0)
}

fn folder_bytes(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

/// `forge-14.23.5.2860`, `fabric-0.16.9`, `neoforge-21.1.233` -> loader and build.
///
/// The CurseForge App writes Fabric as `fabric-0.19.3-1.21.11`, the game
/// version tacked on; the game version is known separately and is taken
/// off again.
pub(crate) fn parse_loader_tag(tag: &str, mc_version: &str) -> (MinecraftLoader, Option<String>) {
    let lower = tag.trim().to_ascii_lowercase();
    for (prefix, loader) in [
        ("neoforge-", MinecraftLoader::NeoForge),
        ("forge-", MinecraftLoader::Forge),
        ("fabric-", MinecraftLoader::Fabric),
    ] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            let suffix = format!("-{}", mc_version.trim().to_ascii_lowercase());
            let build = rest.strip_suffix(suffix.as_str()).unwrap_or(rest);
            return (loader, Some(build.to_string()).filter(|v| !v.is_empty()));
        }
    }
    (MinecraftLoader::Vanilla, None)
}

// --- CurseForge App --------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfInstance {
    name: String,
    game_version: String,
    #[serde(default)]
    base_mod_loader: Option<CfLoader>,
    #[serde(default)]
    installed_addons: Vec<CfAddon>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfLoader {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfAddon {
    #[serde(rename = "addonID")]
    addon_id: u64,
    installed_file: Option<CfInstalledFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfInstalledFile {
    id: u64,
    file_name: String,
}

fn scan_curseforge(root: &Path) -> Vec<FoundInstance> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        let Some(instance) = read_curseforge(&dir) else {
            continue;
        };
        found.push(instance);
    }
    found
}

pub(crate) fn read_curseforge(dir: &Path) -> Option<FoundInstance> {
    let raw = fs::read_to_string(dir.join("minecraftinstance.json")).ok()?;
    let parsed: CfInstance = serde_json::from_str(&raw).ok()?;
    let (loader, loader_version) = parsed
        .base_mod_loader
        .as_ref()
        .map(|l| parse_loader_tag(&l.name, &parsed.game_version))
        .unwrap_or((MinecraftLoader::Vanilla, None));
    let provenance = parsed
        .installed_addons
        .iter()
        .filter_map(|addon| {
            let file = addon.installed_file.as_ref()?;
            Some(KnownMod {
                file_name: file.file_name.clone(),
                provider: "curseforge".to_string(),
                project_id: addon.addon_id.to_string(),
                version_id: file.id.to_string(),
            })
        })
        .collect();
    Some(FoundInstance {
        source: Source::CurseForgeApp,
        name: if parsed.name.trim().is_empty() {
            dir.file_name()?.to_string_lossy().to_string()
        } else {
            parsed.name
        },
        game_dir: dir.to_string_lossy().to_string(),
        mc_version: parsed.game_version,
        loader,
        loader_version,
        mods: count_jars(&dir.join("mods")),
        worlds: count_worlds(dir),
        bytes: folder_bytes(dir),
        provenance,
    })
}

// --- Modrinth App ----------------------------------------------------------

fn scan_modrinth(root: &Path) -> Vec<FoundInstance> {
    let db = root.join("app.db");
    if !db.is_file() {
        return Vec::new();
    }
    let profiles_dir = root.join("profiles");
    let Ok(connection) = rusqlite::Connection::open_with_flags(
        &db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let Ok(mut statement) = connection
        .prepare("SELECT path, name, game_version, mod_loader, mod_loader_version FROM profiles")
    else {
        return Vec::new();
    };
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };
    rows.flatten()
        .filter_map(|(path, name, version, loader, loader_version)| {
            let dir = profiles_dir.join(&path);
            if !dir.is_dir() {
                return None;
            }
            let loader = match loader.as_str() {
                "fabric" => MinecraftLoader::Fabric,
                "forge" => MinecraftLoader::Forge,
                "neoforge" => MinecraftLoader::NeoForge,
                _ => MinecraftLoader::Vanilla,
            };
            Some(FoundInstance {
                source: Source::ModrinthApp,
                name: if name.trim().is_empty() { path } else { name },
                game_dir: dir.to_string_lossy().to_string(),
                mc_version: version,
                loader: loader.clone(),
                loader_version: if loader == MinecraftLoader::Vanilla {
                    None
                } else {
                    loader_version.filter(|v| !v.is_empty())
                },
                mods: count_jars(&dir.join("mods")),
                worlds: count_worlds(&dir),
                bytes: folder_bytes(&dir),
                provenance: Vec::new(),
            })
        })
        .collect()
}

// --- Prism / MultiMC -------------------------------------------------------

#[derive(Deserialize)]
struct MmcPack {
    #[serde(default)]
    components: Vec<MmcComponent>,
}

#[derive(Deserialize)]
struct MmcComponent {
    uid: String,
    #[serde(default)]
    version: Option<String>,
}

fn scan_mmc_family(instances: &Path, source: Source) -> Vec<FoundInstance> {
    let Ok(entries) = fs::read_dir(instances) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| read_mmc(&entry.path(), source))
        .collect()
}

pub(crate) fn read_mmc(dir: &Path, source: Source) -> Option<FoundInstance> {
    let pack: MmcPack =
        serde_json::from_str(&fs::read_to_string(dir.join("mmc-pack.json")).ok()?).ok()?;
    let cfg = fs::read_to_string(dir.join("instance.cfg")).unwrap_or_default();
    let name = cfg
        .lines()
        .find_map(|line| line.strip_prefix("name="))
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            dir.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        });
    let component = |uid: &str| {
        pack.components
            .iter()
            .find(|c| c.uid == uid)
            .and_then(|c| c.version.clone())
    };
    let mc_version = component("net.minecraft")?;
    let (loader, loader_version) = if let Some(v) = component("net.neoforged.neoforge") {
        (MinecraftLoader::NeoForge, Some(v))
    } else if let Some(v) = component("net.minecraftforge") {
        (MinecraftLoader::Forge, Some(v))
    } else if let Some(v) = component("net.fabricmc.fabric-loader") {
        (MinecraftLoader::Fabric, Some(v))
    } else {
        (MinecraftLoader::Vanilla, None)
    };
    let game_dir = [".minecraft", "minecraft"]
        .iter()
        .map(|folder| dir.join(folder))
        .find(|candidate| candidate.is_dir())
        .unwrap_or_else(|| dir.join(".minecraft"));
    Some(FoundInstance {
        source,
        name,
        game_dir: game_dir.to_string_lossy().to_string(),
        mc_version,
        loader,
        loader_version,
        mods: count_jars(&game_dir.join("mods")),
        worlds: count_worlds(&game_dir),
        bytes: folder_bytes(&game_dir),
        provenance: Vec::new(),
    })
}

// --- The official launcher -------------------------------------------------

#[derive(Deserialize)]
struct LauncherProfiles {
    #[serde(default)]
    profiles: std::collections::BTreeMap<String, LauncherProfile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherProfile {
    #[serde(default)]
    name: String,
    #[serde(default)]
    last_version_id: String,
    #[serde(default)]
    game_dir: Option<String>,
    #[serde(default, rename = "type")]
    kind: String,
}

/// `fabric-loader-0.16.9-1.21.1`, `1.21.1-forge-52.0.1`, `neoforge-21.1.233`,
/// `1.20.1` -> what the official launcher would start.
pub(crate) fn parse_version_id(id: &str) -> Option<(String, MinecraftLoader, Option<String>)> {
    let id = id.trim();
    if id.is_empty() || id.starts_with("latest-") {
        return None;
    }
    if let Some(rest) = id.strip_prefix("fabric-loader-") {
        let (loader, mc) = rest.split_once('-')?;
        return Some((
            mc.to_string(),
            MinecraftLoader::Fabric,
            Some(loader.to_string()),
        ));
    }
    if let Some((mc, build)) = id.split_once("-forge-") {
        return Some((
            mc.to_string(),
            MinecraftLoader::Forge,
            Some(build.to_string()),
        ));
    }
    if let Some(build) = id.strip_prefix("neoforge-") {
        // NeoForge builds carry the Minecraft minor in their first two parts:
        // 21.1.233 is 1.21.1.
        let mut parts = build.split('.');
        let major = parts.next()?;
        let minor = parts.next()?;
        return Some((
            format!("1.{major}.{minor}"),
            MinecraftLoader::NeoForge,
            Some(build.to_string()),
        ));
    }
    if id.chars().next().is_some_and(|c| c.is_ascii_digit()) && !id.contains(' ') {
        return Some((id.to_string(), MinecraftLoader::Vanilla, None));
    }
    None
}

fn scan_official(root: &Path) -> Vec<FoundInstance> {
    let Ok(raw) = fs::read_to_string(root.join("launcher_profiles.json")) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<LauncherProfiles>(&raw) else {
        return Vec::new();
    };
    let mut found: Vec<FoundInstance> = Vec::new();
    for (_, profile) in parsed.profiles {
        let Some((mc_version, loader, loader_version)) = parse_version_id(&profile.last_version_id)
        else {
            continue;
        };
        let game_dir = profile
            .game_dir
            .as_deref()
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .unwrap_or_else(|| root.to_path_buf());
        // Several profiles share `.minecraft`; one import of it is enough,
        // under the first profile's name.
        if found
            .iter()
            .any(|f| f.game_dir == game_dir.to_string_lossy())
        {
            continue;
        }
        let name = if profile.name.trim().is_empty() {
            match profile.kind.as_str() {
                "latest-release" | "latest-snapshot" => continue,
                _ => format!("Minecraft {}", profile.last_version_id),
            }
        } else {
            profile.name.clone()
        };
        found.push(FoundInstance {
            source: Source::OfficialLauncher,
            name,
            game_dir: game_dir.to_string_lossy().to_string(),
            mc_version,
            loader,
            loader_version,
            mods: count_jars(&game_dir.join("mods")),
            worlds: count_worlds(&game_dir),
            bytes: folder_bytes(&game_dir),
            provenance: Vec::new(),
        });
    }
    found
}

// --- The copy --------------------------------------------------------------

/// What a game folder holds that the other launcher owns, not the game.
const SKIPPED: &[&str] = &[
    "logs",
    "crash-reports",
    "natives",
    "libraries",
    "versions",
    "assets",
    "runtime",
    "webcache",
    "webcache2",
    "launcher_profiles.json",
    "launcher_accounts.json",
    "launcher_settings.json",
    "launcher_msa_credentials.bin",
    "launcher_log.txt",
    "usercache.json",
    "usernamecache.json",
    "minecraftinstance.json",
    "instance.cfg",
    "mmc-pack.json",
    "profile.json",
    ".fabric",
    ".mixin.out",
    "essential",
];

/// Copies the game folder into a fresh Kiza instance and says how it went.
///
/// Every mod jar is catalogued so the Mods tab lists it; a CurseForge App
/// instance's own records become provenance, so those mods can be updated
/// from Kiza afterwards. Worlds, configs, packs and options travel as they
/// are. Nothing in the source is touched.
pub fn import(
    app_data_dir: &Path,
    found: &FoundInstance,
    mut on_progress: impl FnMut(usize, usize, &str),
) -> Result<GameInstance, String> {
    let source_dir = PathBuf::from(&found.game_dir);
    if !source_dir.is_dir() {
        return Err(format!("{} is no longer there.", found.game_dir));
    }
    let instance = crate::minecraft_manager::create_minecraft_instance(
        app_data_dir,
        found.name.clone(),
        found.mc_version.clone(),
        found.loader.clone(),
        found.loader_version.clone(),
        None,
    )?;
    let game_dir = PathBuf::from(&instance.install_path);

    let copied = copy_game_folder(&source_dir, &game_dir, &mut on_progress);
    if let Err(error) = copied {
        let _ = crate::minecraft_manager::delete_minecraft_instance(app_data_dir, &instance.id);
        return Err(error);
    }

    // The jars into the catalogue, with what the source knew about them.
    let manager = crate::mod_manager::ModManager::new(app_data_dir.to_path_buf());
    if let Ok(entries) = fs::read_dir(game_dir.join("mods")) {
        let mut jars: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("jar"))
            })
            .collect();
        jars.sort();
        for jar in jars {
            let file_name = jar
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let known = found.provenance.iter().find(|k| k.file_name == file_name);
            let identity = crate::mod_compat::identify_jar(&jar);
            let metadata = crate::mod_manager::ModMetadata {
                name: identity
                    .as_ref()
                    .and_then(|i| i.name.clone())
                    .or_else(|| identity.as_ref().map(|i| i.mod_id.clone()))
                    .or_else(|| Some(file_name.trim_end_matches(".jar").to_string())),
                version: identity.as_ref().map(|i| i.version.clone()),
                source: known.map(|k| k.provider.clone()),
                project_id: known.map(|k| k.project_id.clone()),
                version_id: known.map(|k| k.version_id.clone()),
                ..Default::default()
            };
            let _ = manager.install_mod_file(
                &instance.id,
                &jar.to_string_lossy(),
                &format!("mods/{file_name}"),
                Some(metadata),
            );
            if let Some(k) = known {
                let _ = crate::content_provenance::record(
                    app_data_dir,
                    &instance.id,
                    &format!("mods/{file_name}"),
                    crate::content_provenance::ContentOrigin {
                        provider: k.provider.clone(),
                        project_id: k.project_id.clone(),
                        version_id: k.version_id.clone(),
                        pinned: false,
                    },
                );
            }
        }
    }
    Ok(instance)
}

fn copy_game_folder(
    source: &Path,
    target: &Path,
    on_progress: &mut impl FnMut(usize, usize, &str),
) -> Result<(), String> {
    let files: Vec<walkdir::DirEntry> = walkdir::WalkDir::new(source)
        .min_depth(1)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.depth() == 1 && SKIPPED.contains(&name.as_ref()))
        })
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .collect();
    let total = files.len();
    for (index, entry) in files.iter().enumerate() {
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| error.to_string())?;
        let destination = target.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(entry.path(), &destination)
            .map_err(|error| format!("Could not copy {}: {error}", relative.display()))?;
        if index % 25 == 0 || index + 1 == total {
            on_progress(index + 1, total, &relative.to_string_lossy());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_tags_and_version_ids_are_read_the_way_each_launcher_writes_them() {
        assert_eq!(
            parse_loader_tag("forge-14.23.5.2860", "1.12.2"),
            (MinecraftLoader::Forge, Some("14.23.5.2860".to_string()))
        );
        assert_eq!(
            parse_loader_tag("fabric-0.16.9", "1.21.1"),
            (MinecraftLoader::Fabric, Some("0.16.9".to_string()))
        );
        // The CurseForge App's own spelling.
        assert_eq!(
            parse_loader_tag("fabric-0.19.3-1.21.11", "1.21.11"),
            (MinecraftLoader::Fabric, Some("0.19.3".to_string()))
        );
        assert_eq!(
            parse_loader_tag("neoforge-21.1.233", "1.21.1"),
            (MinecraftLoader::NeoForge, Some("21.1.233".to_string()))
        );
        assert_eq!(
            parse_loader_tag("", "1.21.1"),
            (MinecraftLoader::Vanilla, None)
        );

        assert_eq!(
            parse_version_id("fabric-loader-0.16.9-1.21.1"),
            Some((
                "1.21.1".to_string(),
                MinecraftLoader::Fabric,
                Some("0.16.9".to_string())
            ))
        );
        assert_eq!(
            parse_version_id("1.20.1-forge-47.2.0"),
            Some((
                "1.20.1".to_string(),
                MinecraftLoader::Forge,
                Some("47.2.0".to_string())
            ))
        );
        assert_eq!(
            parse_version_id("neoforge-21.1.233"),
            Some((
                "1.21.1".to_string(),
                MinecraftLoader::NeoForge,
                Some("21.1.233".to_string())
            ))
        );
        assert_eq!(
            parse_version_id("1.19.4"),
            Some(("1.19.4".to_string(), MinecraftLoader::Vanilla, None))
        );
        assert_eq!(parse_version_id("latest-release"), None);
    }

    /// A CurseForge App instance, as the app writes it: the name, the
    /// loader, and each mod's project and file for the provenance.
    #[test]
    fn a_curseforge_app_instance_is_read_with_its_provenance() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("RLCraft");
        fs::create_dir_all(dir.join("mods")).unwrap();
        fs::create_dir_all(dir.join("saves/World/")).unwrap();
        fs::write(dir.join("saves/World/level.dat"), b"x").unwrap();
        fs::write(dir.join("mods/MTLib-3.0.7.jar"), b"jar").unwrap();
        fs::write(
            dir.join("minecraftinstance.json"),
            r#"{"name":"RLCraft","gameVersion":"1.12.2","baseModLoader":{"name":"forge-14.23.5.2860"},
                "installedAddons":[{"addonID":253211,"installedFile":{"id":3308160,"fileName":"MTLib-3.0.7.jar"}}]}"#,
        )
        .unwrap();
        let found = read_curseforge(&dir).expect("an instance");
        assert_eq!(found.source, Source::CurseForgeApp);
        assert_eq!(found.name, "RLCraft");
        assert_eq!(found.mc_version, "1.12.2");
        assert_eq!(found.loader, MinecraftLoader::Forge);
        assert_eq!(found.loader_version.as_deref(), Some("14.23.5.2860"));
        assert_eq!((found.mods, found.worlds), (1, 1));
        assert_eq!(found.provenance[0].project_id, "253211");
        assert_eq!(found.provenance[0].version_id, "3308160");
    }

    /// A Prism instance: the loader from the pack's components, the game
    /// folder found under either of its two names.
    #[test]
    fn a_prism_instance_is_read_from_its_pack_and_cfg() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("Fabric 1.21");
        fs::create_dir_all(dir.join("minecraft/mods")).unwrap();
        fs::write(dir.join("minecraft/mods/sodium.jar"), b"jar").unwrap();
        fs::write(
            dir.join("instance.cfg"),
            "InstanceType=OneSix\nname=My Fabric\n",
        )
        .unwrap();
        fs::write(
            dir.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"1.21.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.16.9"}],"formatVersion":1}"#,
        )
        .unwrap();
        let found = read_mmc(&dir, Source::Prism).expect("an instance");
        assert_eq!(found.name, "My Fabric");
        assert_eq!(found.loader, MinecraftLoader::Fabric);
        assert_eq!(found.loader_version.as_deref(), Some("0.16.9"));
        assert!(found.game_dir.ends_with("minecraft"));
        assert_eq!(found.mods, 1);
    }

    /// The copy brings the game, not the other launcher: mods, configs and
    /// worlds come, logs and the launcher's own records do not, and every
    /// jar is in the catalogue afterwards.
    #[test]
    fn an_import_copies_the_game_and_catalogues_its_mods() {
        let temp = tempfile::tempdir().unwrap();
        let app_data = temp.path().join("data");
        let source = temp.path().join("cf/RLCraft");
        for folder in ["mods", "config", "saves/World", "logs", "resourcepacks"] {
            fs::create_dir_all(source.join(folder)).unwrap();
        }
        fs::write(source.join("mods/a.jar"), jar_with_mcmod("amod")).unwrap();
        fs::write(source.join("config/a.cfg"), b"x=1").unwrap();
        fs::write(source.join("saves/World/level.dat"), b"lvl").unwrap();
        fs::write(source.join("logs/latest.log"), b"noise").unwrap();
        fs::write(source.join("options.txt"), b"fov:70").unwrap();
        fs::write(source.join("minecraftinstance.json"), b"{}").unwrap();
        let found = FoundInstance {
            source: Source::CurseForgeApp,
            name: "RLCraft".into(),
            game_dir: source.to_string_lossy().to_string(),
            mc_version: "1.12.2".into(),
            loader: MinecraftLoader::Forge,
            loader_version: Some("14.23.5.2860".into()),
            mods: 1,
            worlds: 1,
            bytes: 0,
            provenance: vec![KnownMod {
                file_name: "a.jar".into(),
                provider: "curseforge".into(),
                project_id: "1".into(),
                version_id: "2".into(),
            }],
        };
        let instance = import(&app_data, &found, |_, _, _| {}).expect("imported");
        let game = PathBuf::from(&instance.install_path);
        assert!(game.join("mods/a.jar").is_file());
        assert!(game.join("config/a.cfg").is_file());
        assert!(game.join("saves/World/level.dat").is_file());
        assert!(game.join("options.txt").is_file());
        assert!(!game.join("logs").exists());
        assert!(!game.join("minecraftinstance.json").exists());
        // The source is as it was.
        assert!(source.join("logs/latest.log").is_file());

        let mods = crate::mod_manager::ModManager::new(app_data.clone()).load_mods(&instance.id);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].name, "amod");
        let origin = crate::content_provenance::get(&app_data, &instance.id, "mods/a.jar")
            .expect("provenance");
        assert_eq!(origin.project_id, "1");
    }

    /// Whatever is on this machine, printed: a look at the real formats.
    #[test]
    #[ignore = "reads this machine's launchers"]
    fn live_scan_this_machine() {
        for found in scan() {
            println!(
                "{:<18} {:<28} {} {:?} {:?} mods={} worlds={} {} MB",
                found.source.label(),
                found.name,
                found.mc_version,
                found.loader,
                found.loader_version,
                found.mods,
                found.worlds,
                found.bytes / 1_048_576
            );
        }
    }

    /// The smallest real instance on this machine, copied into a scratch
    /// Kiza folder: the whole path, on real files.
    #[test]
    #[ignore = "copies a real instance from this machine"]
    fn live_import_the_smallest_instance_here() {
        let mut found = scan();
        found.sort_by_key(|f| f.bytes);
        let Some(smallest) = found.into_iter().find(|f| f.mods > 0) else {
            println!("nothing to import");
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        let started = std::time::Instant::now();
        let instance = import(temp.path(), &smallest, |done, total, _| {
            if done % 200 == 0 {
                println!("{done}/{total}");
            }
        })
        .expect("imported");
        let game = PathBuf::from(&instance.install_path);
        let mods =
            crate::mod_manager::ModManager::new(temp.path().to_path_buf()).load_mods(&instance.id);
        println!(
            "{} from {} -> {} in {:.1}s: {} mods catalogued, saves={} options={}",
            smallest.name,
            smallest.source.label(),
            instance.id,
            started.elapsed().as_secs_f32(),
            mods.len(),
            game.join("saves").is_dir(),
            game.join("options.txt").is_file()
        );
        assert_eq!(mods.len(), smallest.mods);
        assert!(!game.join("logs").exists());
    }

    fn jar_with_mcmod(mod_id: &str) -> Vec<u8> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            writer
                .start_file("mcmod.info", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(
                &mut writer,
                format!(r#"[{{"modid":"{mod_id}","name":"{mod_id}","version":"1.0"}}]"#).as_bytes(),
            )
            .unwrap();
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }
}
