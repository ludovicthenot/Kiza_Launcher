use quick_xml::de::from_str;
use serde::Deserialize;
use sha1::{Digest, Sha1};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;

const FORGE_MAVEN_ROOT: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const MIN_SUPPORTED_MINOR: u32 = 18;

#[derive(Clone, Debug)]
pub struct ForgeLaunchProfile {
    pub version_id: String,
    pub main_class: String,
    pub classpath: Vec<PathBuf>,
    pub library_dir: PathBuf,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
}

#[derive(Deserialize)]
struct MavenMetadata {
    versioning: MavenVersioning,
}

#[derive(Deserialize)]
struct MavenVersioning {
    versions: MavenVersions,
}

#[derive(Deserialize)]
struct MavenVersions {
    #[serde(rename = "version", default)]
    entries: Vec<String>,
}

#[derive(Deserialize)]
struct InstallerProfile {
    version: String,
    minecraft: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionProfile {
    id: String,
    inherits_from: String,
    main_class: String,
    #[serde(default)]
    arguments: ForgeArguments,
    #[serde(default)]
    libraries: Vec<ForgeLibrary>,
}

#[derive(Default, Deserialize)]
struct ForgeArguments {
    #[serde(default)]
    game: Vec<ProfileArgument>,
    #[serde(default)]
    jvm: Vec<ProfileArgument>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ProfileArgument {
    Plain(String),
    Conditional {
        rules: Vec<ForgeRule>,
        value: ProfileArgumentValue,
    },
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ProfileArgumentValue {
    One(String),
    Many(Vec<String>),
}

#[derive(Deserialize)]
struct ForgeLibrary {
    name: String,
    downloads: Option<ForgeLibraryDownloads>,
    rules: Option<Vec<ForgeRule>>,
}

#[derive(Deserialize)]
struct ForgeLibraryDownloads {
    artifact: Option<ForgeArtifact>,
}

#[derive(Deserialize)]
struct ForgeArtifact {
    path: String,
}

#[derive(Deserialize)]
struct ForgeRule {
    action: String,
    os: Option<ForgeRuleOs>,
    features: Option<HashMap<String, bool>>,
}

#[derive(Deserialize)]
struct ForgeRuleOs {
    name: Option<String>,
    arch: Option<String>,
}

fn forge_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("minecraft").join("global").join("forge")
}

fn launcher_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("minecraft").join("global")
}

fn metadata_cache_path(app_data_dir: &Path) -> PathBuf {
    forge_root(app_data_dir).join("maven-metadata.xml")
}

fn coordinate(mc_version: &str, forge_version: &str) -> String {
    format!("{mc_version}-{forge_version}")
}

fn expected_profile_id(mc_version: &str, forge_version: &str) -> String {
    format!("{mc_version}-forge-{forge_version}")
}

fn installer_path(app_data_dir: &Path, mc_version: &str, forge_version: &str) -> PathBuf {
    let coordinate = coordinate(mc_version, forge_version);
    forge_root(app_data_dir)
        .join("installers")
        .join(&coordinate)
        .join(format!("forge-{coordinate}-installer.jar"))
}

fn profile_json_path(app_data_dir: &Path, profile_id: &str) -> PathBuf {
    launcher_root(app_data_dir)
        .join("versions")
        .join(profile_id)
        .join(format!("{profile_id}.json"))
}

fn parse_mc_release(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.split('.');
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

fn validate_supported_mc_version(mc_version: &str) -> Result<(), String> {
    match parse_mc_release(mc_version) {
        Some((1, minor)) if minor >= MIN_SUPPORTED_MINOR => Ok(()),
        Some((major, _)) if major >= 26 => Ok(()),
        Some(_) => Err(format!(
            "Forge: Minecraft {mc_version} is not supported. Kiza supports Forge 1.{MIN_SUPPORTED_MINOR}+ and 26.x+ installers."
        )),
        None => Err(format!(
            "Forge: Minecraft version '{mc_version}' is not a supported release identifier."
        )),
    }
}

fn numeric_version_cmp(left: &str, right: &str) -> Ordering {
    let segments = |value: &str| {
        value
            .split(|character: char| !character.is_ascii_digit())
            .filter_map(|segment| segment.parse::<u64>().ok())
            .collect::<Vec<_>>()
    };
    let left_segments = segments(left);
    let right_segments = segments(right);
    for index in 0..left_segments.len().max(right_segments.len()) {
        let ordering = left_segments
            .get(index)
            .copied()
            .unwrap_or_default()
            .cmp(&right_segments.get(index).copied().unwrap_or_default());
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left.cmp(right)
}

fn resolve_version_from_metadata(
    metadata_xml: &str,
    mc_version: &str,
    requested: Option<&str>,
) -> Result<String, String> {
    let compatible = compatible_versions_from_metadata(metadata_xml, mc_version)?;

    let requested = requested.map(str::trim).filter(|value| !value.is_empty());
    if let Some(requested) = requested.filter(|value| !value.eq_ignore_ascii_case("latest")) {
        let prefix = format!("{mc_version}-");
        let requested_build = requested.strip_prefix(&prefix).unwrap_or(requested);
        return compatible
            .into_iter()
            .find(|version| version == requested_build)
            .ok_or_else(|| {
                format!("Forge: version {requested} is not compatible with Minecraft {mc_version}.")
            });
    }

    compatible
        .into_iter()
        .next()
        .ok_or_else(|| format!("Forge: no compatible build found for Minecraft {mc_version}."))
}

fn compatible_versions_from_metadata(
    metadata_xml: &str,
    mc_version: &str,
) -> Result<Vec<String>, String> {
    validate_supported_mc_version(mc_version)?;
    let metadata: MavenMetadata = from_str(metadata_xml)
        .map_err(|error| format!("Forge: invalid cached Maven metadata: {error}"))?;
    let prefix = format!("{mc_version}-");
    let mut compatible = metadata
        .versioning
        .versions
        .entries
        .into_iter()
        .filter_map(|entry| entry.strip_prefix(&prefix).map(str::to_string))
        .collect::<Vec<_>>();

    if compatible.is_empty() {
        return Err(format!(
            "Forge: no Forge build is published for Minecraft {mc_version}."
        ));
    }
    compatible.sort_by(|left, right| numeric_version_cmp(right, left));
    Ok(compatible)
}

async fn fetch_metadata(client: &reqwest::Client) -> Result<String, String> {
    let url = format!("{FORGE_MAVEN_ROOT}/maven-metadata.xml");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Forge: failed to fetch version metadata: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Forge: version metadata request returned HTTP {}.",
            response.status()
        ));
    }
    response
        .text()
        .await
        .map_err(|error| format!("Forge: failed to read version metadata: {error}"))
}

pub async fn resolve_version(
    app_data_dir: &Path,
    client: &reqwest::Client,
    mc_version: &str,
    requested: Option<&str>,
) -> Result<String, String> {
    validate_supported_mc_version(mc_version)?;
    let cache_path = metadata_cache_path(app_data_dir);
    match fetch_metadata(client).await {
        Ok(metadata) => {
            let resolved = resolve_version_from_metadata(&metadata, mc_version, requested)?;
            if let Some(parent) = cache_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Forge: failed to create metadata cache: {error}"))?;
            }
            fs::write(&cache_path, metadata)
                .map_err(|error| format!("Forge: failed to cache version metadata: {error}"))?;
            Ok(resolved)
        }
        Err(network_error) => {
            let cached = fs::read_to_string(&cache_path).map_err(|_| {
                format!(
                    "{network_error} No cached Forge metadata is available for offline resolution."
                )
            })?;
            resolve_version_from_metadata(&cached, mc_version, requested).map_err(|cache_error| {
                format!("{network_error} Cached metadata is unusable: {cache_error}")
            })
        }
    }
}

pub async fn list_versions(
    app_data_dir: &Path,
    client: &reqwest::Client,
    mc_version: &str,
) -> Result<Vec<String>, String> {
    validate_supported_mc_version(mc_version)?;
    let cache_path = metadata_cache_path(app_data_dir);
    match fetch_metadata(client).await {
        Ok(metadata) => {
            let versions = compatible_versions_from_metadata(&metadata, mc_version)?;
            if let Some(parent) = cache_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Forge: failed to create metadata cache: {error}"))?;
            }
            fs::write(&cache_path, metadata)
                .map_err(|error| format!("Forge: failed to cache version metadata: {error}"))?;
            Ok(versions)
        }
        Err(network_error) => {
            let cached = fs::read_to_string(&cache_path).map_err(|_| {
                format!(
                    "{network_error} No cached Forge metadata is available for offline resolution."
                )
            })?;
            compatible_versions_from_metadata(&cached, mc_version).map_err(|cache_error| {
                format!("{network_error} Cached metadata is unusable: {cache_error}")
            })
        }
    }
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

async fn download_installer(
    app_data_dir: &Path,
    client: &reqwest::Client,
    mc_version: &str,
    forge_version: &str,
) -> Result<PathBuf, String> {
    let path = installer_path(app_data_dir, mc_version, forge_version);
    let checksum_path = path.with_extension("jar.sha1");
    if path.exists() {
        if let Ok(expected) = fs::read_to_string(&checksum_path) {
            if let Ok(bytes) = fs::read(&path) {
                if sha1_hex(&bytes).eq_ignore_ascii_case(expected.trim()) {
                    return Ok(path);
                }
            }
        }
    }

    let coordinate = coordinate(mc_version, forge_version);
    let url = format!("{FORGE_MAVEN_ROOT}/{coordinate}/forge-{coordinate}-installer.jar");
    let checksum_url = format!("{url}.sha1");
    let expected = client
        .get(&checksum_url)
        .send()
        .await
        .map_err(|error| format!("Forge: failed to fetch installer checksum: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Forge: installer checksum request failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Forge: failed to read installer checksum: {error}"))?;
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Forge: failed to download installer: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Forge: installer download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Forge: failed to read installer download: {error}"))?;
    let actual = sha1_hex(&bytes);
    if !actual.eq_ignore_ascii_case(expected.trim()) {
        return Err(format!(
            "Forge: installer checksum mismatch for {coordinate}."
        ));
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Forge: invalid installer cache path.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Forge: failed to create installer cache: {error}"))?;
    let temporary = path.with_extension("jar.part");
    fs::write(&temporary, &bytes)
        .map_err(|error| format!("Forge: failed to write installer cache: {error}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| {
            format!("Forge: failed to replace invalid installer cache: {error}")
        })?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Forge: failed to finalize installer cache: {error}"))?;
    fs::write(checksum_path, expected.trim())
        .map_err(|error| format!("Forge: failed to cache installer checksum: {error}"))?;
    Ok(path)
}

fn read_installer_profile(installer_path: &Path) -> Result<InstallerProfile, String> {
    let file = fs::File::open(installer_path)
        .map_err(|error| format!("Forge: failed to open installer: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Forge: invalid installer archive: {error}"))?;
    let mut entry = archive
        .by_name("install_profile.json")
        .map_err(|_| "Forge: installer does not contain install_profile.json.".to_string())?;
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .map_err(|error| format!("Forge: failed to read installer profile: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Forge: invalid installer profile: {error}"))
}

fn maven_library_path(coordinate: &str) -> Result<PathBuf, String> {
    let (coordinate, extension) = coordinate
        .split_once('@')
        .map_or((coordinate, "jar"), |(value, extension)| (value, extension));
    let parts = coordinate.split(':').collect::<Vec<_>>();
    if !(3..=4).contains(&parts.len()) || parts.iter().any(|part| part.is_empty()) {
        return Err(format!(
            "Forge: invalid Maven library coordinate '{coordinate}'."
        ));
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts
        .get(3)
        .map(|value| format!("-{value}"))
        .unwrap_or_default();
    Ok(PathBuf::from(group)
        .join(artifact)
        .join(version)
        .join(format!("{artifact}-{version}{classifier}.{extension}")))
}

fn current_os() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        std::env::consts::ARCH
    };
    (os, arch)
}

fn rules_allow(rules: Option<&[ForgeRule]>, os: &str, arch: &str) -> bool {
    let Some(rules) = rules else {
        return true;
    };
    let mut allowed = false;
    for rule in rules {
        let os_matches = rule.os.as_ref().is_none_or(|condition| {
            condition.name.as_deref().is_none_or(|name| name == os)
                && condition.arch.as_deref().is_none_or(|value| value == arch)
        });
        let features_match = rule
            .features
            .as_ref()
            .is_none_or(|features| features.values().all(|enabled| !enabled));
        if os_matches && features_match {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

fn profile_arguments(arguments: &[ProfileArgument], os: &str, arch: &str) -> Vec<String> {
    let mut result = Vec::new();
    for argument in arguments {
        match argument {
            ProfileArgument::Plain(value) => result.push(value.clone()),
            ProfileArgument::Conditional { rules, value } if rules_allow(Some(rules), os, arch) => {
                match value {
                    ProfileArgumentValue::One(value) => result.push(value.clone()),
                    ProfileArgumentValue::Many(values) => result.extend(values.iter().cloned()),
                }
            }
            ProfileArgument::Conditional { .. } => {}
        }
    }
    result
}

fn load_launch_profile_by_id(
    app_data_dir: &Path,
    mc_version: &str,
    profile_id: &str,
) -> Result<ForgeLaunchProfile, String> {
    let path = profile_json_path(app_data_dir, profile_id);
    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Forge: installed profile '{}' is missing: {error}",
            path.display()
        )
    })?;
    let profile: VersionProfile = serde_json::from_str(&content)
        .map_err(|error| format!("Forge: invalid installed version profile: {error}"))?;
    if profile.inherits_from != mc_version {
        return Err(format!(
            "Forge: profile {} targets Minecraft {}, expected {mc_version}.",
            profile.id, profile.inherits_from
        ));
    }
    if profile.main_class.trim().is_empty() {
        return Err(format!(
            "Forge: profile {} has no launch main class.",
            profile.id
        ));
    }

    let library_dir = launcher_root(app_data_dir).join("libraries");
    let (os, arch) = current_os();
    let mut classpath = Vec::new();
    let mut missing = Vec::new();
    for library in &profile.libraries {
        if !rules_allow(library.rules.as_deref(), os, arch) {
            continue;
        }
        let relative = library
            .downloads
            .as_ref()
            .and_then(|downloads| downloads.artifact.as_ref())
            .map(|artifact| PathBuf::from(&artifact.path))
            .map_or_else(|| maven_library_path(&library.name), Ok)?;
        let path = library_dir.join(relative);
        if path.exists() {
            classpath.push(path);
        } else {
            missing.push(library.name.clone());
        }
    }
    if !missing.is_empty() {
        return Err(format!(
            "Forge: cached profile {} is incomplete; missing libraries: {}.",
            profile.id,
            missing.into_iter().take(5).collect::<Vec<_>>().join(", ")
        ));
    }

    Ok(ForgeLaunchProfile {
        version_id: profile.id,
        main_class: profile.main_class,
        classpath,
        library_dir,
        jvm_args: profile_arguments(&profile.arguments.jvm, os, arch),
        game_args: profile_arguments(&profile.arguments.game, os, arch),
    })
}

pub fn is_installed(app_data_dir: &Path, mc_version: &str, forge_version: &str) -> bool {
    load_launch_profile_by_id(
        app_data_dir,
        mc_version,
        &expected_profile_id(mc_version, forge_version),
    )
    .is_ok()
}

fn ensure_launcher_layout(
    app_data_dir: &Path,
    mc_version: &str,
    vanilla_client_jar: &Path,
) -> Result<(), String> {
    let root = launcher_root(app_data_dir);
    fs::create_dir_all(root.join("versions"))
        .map_err(|error| format!("Forge: failed to create launcher cache: {error}"))?;
    fs::create_dir_all(root.join("libraries"))
        .map_err(|error| format!("Forge: failed to create library cache: {error}"))?;
    let launcher_profiles = root.join("launcher_profiles.json");
    if !launcher_profiles.exists() {
        fs::write(&launcher_profiles, r#"{"profiles":{}}"#)
            .map_err(|error| format!("Forge: failed to create launcher profile stub: {error}"))?;
    }

    let vanilla_dir = root.join("versions").join(mc_version);
    fs::create_dir_all(&vanilla_dir)
        .map_err(|error| format!("Forge: failed to create vanilla cache: {error}"))?;
    let cached_jar = vanilla_dir.join(format!("{mc_version}.jar"));
    if !cached_jar.exists() {
        fs::copy(vanilla_client_jar, &cached_jar)
            .map_err(|error| format!("Forge: failed to seed the vanilla client jar: {error}"))?;
    }
    Ok(())
}

fn output_tail(bytes: &[u8]) -> String {
    let output = String::from_utf8_lossy(bytes);
    let mut tail = output.chars().rev().take(2000).collect::<String>();
    tail = tail.chars().rev().collect();
    tail.trim().to_string()
}

fn installer_java_path(java_path: &Path) -> PathBuf {
    if java_path
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("javaw.exe"))
    {
        let console_java = java_path.with_file_name("java.exe");
        if console_java.exists() {
            return console_java;
        }
    }
    java_path.to_path_buf()
}

pub async fn ensure_installed(
    app_data_dir: &Path,
    client: &reqwest::Client,
    java_path: &Path,
    mc_version: &str,
    forge_version: &str,
    vanilla_client_jar: &Path,
) -> Result<ForgeLaunchProfile, String> {
    validate_supported_mc_version(mc_version)?;
    let expected_id = expected_profile_id(mc_version, forge_version);
    if let Ok(profile) = load_launch_profile_by_id(app_data_dir, mc_version, &expected_id) {
        return Ok(profile);
    }

    let installer = download_installer(app_data_dir, client, mc_version, forge_version).await?;
    let installer_profile = read_installer_profile(&installer)?;
    if installer_profile.minecraft != mc_version {
        return Err(format!(
            "Forge: installer targets Minecraft {}, expected {mc_version}.",
            installer_profile.minecraft
        ));
    }
    ensure_launcher_layout(app_data_dir, mc_version, vanilla_client_jar)?;

    let root = launcher_root(app_data_dir);
    let installer_java = installer_java_path(java_path);
    let output = tokio::process::Command::new(&installer_java)
        .arg("-jar")
        .arg(&installer)
        .arg("--installClient")
        .arg(&root)
        .current_dir(
            installer
                .parent()
                .ok_or_else(|| "Forge: invalid installer path.".to_string())?,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| format!("Forge: failed to start the installer with Java: {error}"))?;
    if !output.status.success() {
        let stderr = output_tail(&output.stderr);
        let stdout = output_tail(&output.stdout);
        let details = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!(
            "Forge: installer failed with status {}. {}",
            output.status, details
        ));
    }

    load_launch_profile_by_id(app_data_dir, mc_version, &installer_profile.version).map_err(
        |error| format!("Forge: installer completed but the launch profile is unusable: {error}"),
    )
}

pub fn expand_arguments(
    arguments: &[String],
    variables: &HashMap<String, String>,
) -> Result<Vec<String>, String> {
    arguments
        .iter()
        .map(|argument| {
            let mut expanded = String::new();
            let mut remaining = argument.as_str();
            while let Some(start) = remaining.find("${") {
                expanded.push_str(&remaining[..start]);
                let token_start = start + 2;
                let end = remaining[token_start..]
                    .find('}')
                    .map(|offset| token_start + offset)
                    .ok_or_else(|| format!("Forge: unclosed argument token in '{argument}'."))?;
                let token = &remaining[token_start..end];
                let value = variables.get(token).ok_or_else(|| {
                    format!("Forge: unsupported argument token '${{{token}}}' in '{argument}'.")
                })?;
                expanded.push_str(value);
                remaining = &remaining[end + 1..];
            }
            expanded.push_str(remaining);
            Ok(expanded)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const METADATA: &str = r#"
        <metadata>
          <versioning>
            <versions>
              <version>1.20.1-47.2.0</version>
              <version>1.20.1-47.10.2</version>
              <version>1.21.1-52.0.1</version>
            </versions>
          </versioning>
        </metadata>
    "#;

    #[test]
    fn resolves_latest_compatible_forge_build_without_network() {
        let resolved = resolve_version_from_metadata(METADATA, "1.20.1", Some("latest"))
            .expect("compatible version");
        assert_eq!(resolved, "47.10.2");
    }

    #[test]
    fn lists_compatible_forge_builds_newest_first() {
        let versions = compatible_versions_from_metadata(METADATA, "1.20.1")
            .expect("compatible Forge versions");
        assert_eq!(versions, vec!["47.10.2", "47.2.0"]);
    }

    #[test]
    fn validates_requested_version_against_minecraft_version() {
        assert_eq!(
            resolve_version_from_metadata(METADATA, "1.20.1", Some("1.20.1-47.2.0"))
                .expect("full coordinate is accepted"),
            "47.2.0"
        );
        let error = resolve_version_from_metadata(METADATA, "1.20.1", Some("52.0.1"))
            .expect_err("cross-version build must fail");
        assert!(error.contains("not compatible with Minecraft 1.20.1"));
    }

    #[test]
    fn rejects_legacy_forge_installers_explicitly() {
        let error = resolve_version_from_metadata(METADATA, "1.16.5", None)
            .expect_err("legacy versions are outside the supported installer contract");
        assert!(error.contains("supports Forge 1.18+"));
    }

    #[test]
    fn reads_installer_profile_from_local_fixture() {
        let directory = tempfile::tempdir().unwrap();
        let installer = directory.path().join("forge-installer.jar");
        let file = fs::File::create(&installer).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file(
                "install_profile.json",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        archive
            .write_all(br#"{"version":"1.20.1-forge-47.4.21","minecraft":"1.20.1"}"#)
            .unwrap();
        archive.finish().unwrap();

        let profile = read_installer_profile(&installer).expect("local installer profile");
        assert_eq!(profile.minecraft, "1.20.1");
        assert_eq!(profile.version, "1.20.1-forge-47.4.21");
    }

    #[test]
    fn expands_forge_launch_tokens() {
        let variables = HashMap::from([
            (
                "library_directory".to_string(),
                "C:/forge/libraries".to_string(),
            ),
            ("classpath_separator".to_string(), ";".to_string()),
            (
                "version_name".to_string(),
                "1.20.1-forge-47.4.21".to_string(),
            ),
        ]);
        let expanded = expand_arguments(
            &[
                "${library_directory}/bootstrap.jar${classpath_separator}${version_name}.jar"
                    .to_string(),
            ],
            &variables,
        )
        .expect("known tokens expand");
        assert_eq!(
            expanded,
            vec!["C:/forge/libraries/bootstrap.jar;1.20.1-forge-47.4.21.jar"]
        );
    }

    #[test]
    fn rejects_unknown_forge_launch_tokens() {
        let error = expand_arguments(
            &["--unknown=${unsupported_token}".to_string()],
            &HashMap::new(),
        )
        .expect_err("unknown tokens must fail explicitly");
        assert!(error.contains("unsupported argument token '${unsupported_token}'"));
    }

    #[test]
    fn uses_console_java_for_the_headless_installer() {
        let directory = tempfile::tempdir().unwrap();
        let javaw = directory.path().join("javaw.exe");
        let java = directory.path().join("java.exe");
        fs::write(&javaw, b"fixture").unwrap();
        fs::write(&java, b"fixture").unwrap();

        assert_eq!(installer_java_path(&javaw), java);
    }

    #[test]
    fn loads_cached_launch_profile_without_network() {
        let directory = tempfile::tempdir().unwrap();
        let profile_id = "1.20.1-forge-47.4.21";
        let relative_library =
            "net/minecraftforge/forge/1.20.1-47.4.21/forge-1.20.1-47.4.21-universal.jar";
        let library = launcher_root(directory.path())
            .join("libraries")
            .join(relative_library);
        fs::create_dir_all(library.parent().unwrap()).unwrap();
        fs::write(&library, b"fixture").unwrap();

        let profile_path = profile_json_path(directory.path(), profile_id);
        fs::create_dir_all(profile_path.parent().unwrap()).unwrap();
        fs::write(
            profile_path,
            format!(
                r#"{{
                    "id":"{profile_id}",
                    "inheritsFrom":"1.20.1",
                    "mainClass":"cpw.mods.bootstraplauncher.BootstrapLauncher",
                    "arguments":{{
                        "jvm":["-DlibraryDirectory=${{library_directory}}"],
                        "game":["--launchTarget","forgeclient"]
                    }},
                    "libraries":[{{
                        "name":"net.minecraftforge:forge:1.20.1-47.4.21:universal",
                        "downloads":{{"artifact":{{"path":"{relative_library}"}}}}
                    }}]
                }}"#
            ),
        )
        .unwrap();

        let profile = load_launch_profile_by_id(directory.path(), "1.20.1", profile_id)
            .expect("cached Forge profile");
        assert_eq!(
            profile.main_class,
            "cpw.mods.bootstraplauncher.BootstrapLauncher"
        );
        assert_eq!(profile.classpath, vec![library]);
        assert_eq!(profile.game_args, vec!["--launchTarget", "forgeclient"]);
        assert!(is_installed(directory.path(), "1.20.1", "47.4.21"));
    }

    #[test]
    fn maps_maven_coordinates_with_classifier() {
        assert_eq!(
            maven_library_path("net.minecraftforge:forge:1.20.1-47.4.21:universal").unwrap(),
            PathBuf::from(
                "net/minecraftforge/forge/1.20.1-47.4.21/forge-1.20.1-47.4.21-universal.jar"
            )
        );
    }
}
