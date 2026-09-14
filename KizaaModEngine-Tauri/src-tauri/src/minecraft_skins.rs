//! The skin on a Microsoft account, and the ones kept for later.
//!
//! A skin lives on the Minecraft account, not on this machine: changing it
//! here is what Minecraft's own profile page does, through the same service,
//! and every launcher and every device sees the result. What Kiza adds is a
//! library — skins saved by name, previewed before they go on, and put back
//! with one click — which is a folder of PNGs and a list beside it.
//!
//! Every image is checked before it goes anywhere: a PNG, 64x64 or the old
//! 64x32, under half a megabyte. The service checks again; the point of
//! checking first is that the message names the problem instead of echoing
//! a 400.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
/// A skin is a few kilobytes; anything past this is not one.
const MAX_SKIN_BYTES: usize = 512 * 1024;
const MAX_LIBRARY: usize = 60;
const USER_AGENT: &str = "KizaLauncherAlpha/0.1";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Variant {
    #[default]
    Classic,
    Slim,
}

impl Variant {
    fn as_str(self) -> &'static str {
        match self {
            Variant::Classic => "classic",
            Variant::Slim => "slim",
        }
    }

    fn parse(value: &str) -> Self {
        if value.eq_ignore_ascii_case("slim") {
            Variant::Slim
        } else {
            Variant::Classic
        }
    }
}

/// A cape the account owns, with its texture so the preview can wear it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Cape {
    pub id: String,
    pub alias: String,
    pub url: String,
    pub png_base64: Option<String>,
    pub active: bool,
}

/// What the account wears right now.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct CurrentSkin {
    pub username: String,
    pub uuid: String,
    /// The texture, base64-encoded PNG, so the preview needs no second
    /// request and no cross-origin permission. None when the account is on
    /// the default skin.
    pub png_base64: Option<String>,
    pub url: Option<String>,
    pub variant: Variant,
    pub capes: Vec<Cape>,
}

/// A skin kept in the library: the PNG beside a name.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct LibrarySkin {
    pub id: String,
    pub name: String,
    pub variant: Variant,
    pub added_at: String,
    /// Filled when listed, never written to the index.
    #[serde(default, skip_deserializing)]
    pub png_base64: Option<String>,
}

/// Where a skin comes from when it is previewed, applied or saved.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SkinSource {
    /// A PNG on this machine, picked with the file dialog.
    File {
        path: String,
    },
    /// A PNG on the web. Fetched here, so the preview shows the exact bytes
    /// that would be applied.
    Url {
        url: String,
    },
    Library {
        id: String,
    },
    /// The skin the account wears now — to put it in the library.
    Current,
}

#[derive(Deserialize)]
struct ProfileAnswer {
    id: String,
    name: String,
    #[serde(default)]
    skins: Vec<ProfileSkin>,
    #[serde(default)]
    capes: Vec<ProfileCape>,
}

#[derive(Deserialize)]
struct ProfileSkin {
    url: String,
    #[serde(default)]
    variant: Option<String>,
    #[serde(default)]
    state: Option<String>,
}

#[derive(Deserialize)]
struct ProfileCape {
    id: String,
    #[serde(default)]
    alias: Option<String>,
    url: String,
    #[serde(default)]
    state: Option<String>,
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())
}

/// A PNG, 64x64 or 64x32, and small. Returns the dimensions.
pub fn validate(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() > MAX_SKIN_BYTES {
        return Err("That file is too large to be a Minecraft skin.".to_string());
    }
    let (width, height) = crate::offline_accounts::png_dimensions(bytes)?;
    if !(width == 64 && (height == 64 || height == 32)) {
        return Err(format!(
            "A Minecraft skin is 64x64 or 64x32 pixels; this image is {width}x{height}."
        ));
    }
    Ok((width, height))
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

// ---------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------

async fn fetch_profile(token: &str) -> Result<ProfileAnswer, String> {
    let response = client(Duration::from_secs(20))?
        .get(PROFILE_URL)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Minecraft's profile service could not be reached: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(crate::minecraft_auth::minecraft_service_error(
            "/minecraft/profile",
            status,
            &text,
        ));
    }
    response
        .json::<ProfileAnswer>()
        .await
        .map_err(|error| format!("Minecraft's profile answer could not be read: {error}"))
}

/// Downloads a texture. Quiet on failure: a preview without a texture is
/// still a page; an error would hide the name and the capes with it.
async fn fetch_texture(url: &str) -> Option<Vec<u8>> {
    let client = client(Duration::from_secs(15)).ok()?;
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    (bytes.len() <= MAX_SKIN_BYTES).then(|| bytes.to_vec())
}

fn is_active(state: &Option<String>) -> bool {
    state
        .as_deref()
        .is_some_and(|s| s.eq_ignore_ascii_case("ACTIVE"))
}

/// What the account wears, textures included.
pub async fn current(token: &str) -> Result<CurrentSkin, String> {
    let profile = fetch_profile(token).await?;
    let skin = profile
        .skins
        .iter()
        .find(|skin| is_active(&skin.state))
        .or(profile.skins.first());

    let skin_png = match skin {
        Some(skin) => fetch_texture(&skin.url).await.map(|bytes| encode(&bytes)),
        None => None,
    };
    let mut capes = Vec::with_capacity(profile.capes.len());
    for cape in &profile.capes {
        let png_base64 = fetch_texture(&cape.url).await.map(|bytes| encode(&bytes));
        capes.push(Cape {
            id: cape.id.clone(),
            alias: cape
                .alias
                .clone()
                .filter(|alias| !alias.trim().is_empty())
                .unwrap_or_else(|| "Cape".to_string()),
            url: cape.url.clone(),
            png_base64,
            active: is_active(&cape.state),
        });
    }

    Ok(CurrentSkin {
        username: profile.name,
        uuid: profile.id,
        png_base64: skin_png,
        url: skin.map(|skin| skin.url.clone()),
        variant: skin
            .and_then(|skin| skin.variant.as_deref())
            .map(Variant::parse)
            .unwrap_or_default(),
        capes,
    })
}

/// Puts `bytes` on the account as its skin.
pub async fn apply(token: &str, bytes: Vec<u8>, variant: Variant) -> Result<(), String> {
    validate(&bytes)?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("variant", variant.as_str())
        .part("file", part);
    let response = client(Duration::from_secs(30))?
        .post(format!("{PROFILE_URL}/skins"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Minecraft's profile service could not be reached: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(
                "Minecraft's service limits how often a skin can change. Wait a minute and try again."
                    .to_string(),
            );
        }
        return Err(crate::minecraft_auth::minecraft_service_error(
            "/minecraft/profile/skins",
            status,
            &text,
        ));
    }
    Ok(())
}

/// Back to the default skin (Steve or Alex, by the account's UUID).
pub async fn reset(token: &str) -> Result<(), String> {
    let response = client(Duration::from_secs(20))?
        .delete(format!("{PROFILE_URL}/skins/active"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Minecraft's profile service could not be reached: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(crate::minecraft_auth::minecraft_service_error(
            "/minecraft/profile/skins/active",
            status,
            &text,
        ));
    }
    Ok(())
}

/// Wears a cape the account owns, or none.
pub async fn set_cape(token: &str, cape_id: Option<&str>) -> Result<(), String> {
    let client = client(Duration::from_secs(20))?;
    let url = format!("{PROFILE_URL}/capes/active");
    let request = match cape_id {
        Some(id) => client.put(&url).json(&serde_json::json!({ "capeId": id })),
        None => client.delete(&url),
    };
    let response =
        request.bearer_auth(token).send().await.map_err(|error| {
            format!("Minecraft's profile service could not be reached: {error}")
        })?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(crate::minecraft_auth::minecraft_service_error(
            "/minecraft/profile/capes/active",
            status,
            &text,
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/// Reads a PNG from the web. HTTPS only, and only from the internet: a
/// skin is public, but the launcher fetching whatever address is typed
/// into it must not become a way to read this machine's own services or
/// the network behind it.
pub async fn fetch_url(url: &str) -> Result<Vec<u8>, String> {
    let parsed =
        reqwest::Url::parse(url.trim()).map_err(|_| "That is not a web address.".to_string())?;
    if parsed.scheme() != "https" {
        return Err("A skin address starts with https://.".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "That is not a web address.".to_string())?;
    if is_local_host(host) {
        return Err("A skin address has to be on the internet.".to_string());
    }
    let response = client(Duration::from_secs(20))?
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("The image could not be fetched: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The image could not be fetched: HTTP {}",
            response.status()
        ));
    }
    if let Some(length) = response.content_length() {
        if length as usize > MAX_SKIN_BYTES {
            return Err("That file is too large to be a Minecraft skin.".to_string());
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("The image could not be fetched: {error}"))?
        .to_vec();
    validate(&bytes)?;
    Ok(bytes)
}

/// Loopback, link-local and private addresses, and the names that mean
/// them.
fn is_local_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return true;
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => {
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
        }
        Ok(std::net::IpAddr::V6(ip)) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback() || v4.is_private() || v4.is_link_local())
        }
        Err(_) => false,
    }
}

pub fn read_file(path: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(path);
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not read the image: {error}"))?;
    if metadata.len() as usize > MAX_SKIN_BYTES {
        return Err("That file is too large to be a Minecraft skin.".to_string());
    }
    let bytes = fs::read(path).map_err(|error| format!("Could not read the image: {error}"))?;
    validate(&bytes)?;
    Ok(bytes)
}

/// The bytes a source names, checked.
pub async fn resolve(
    app_data_dir: &Path,
    token: Option<&str>,
    source: &SkinSource,
) -> Result<Vec<u8>, String> {
    match source {
        SkinSource::File { path } => read_file(path),
        SkinSource::Url { url } => fetch_url(url).await,
        SkinSource::Library { id } => library_read(app_data_dir, id),
        SkinSource::Current => {
            let token =
                token.ok_or_else(|| "Sign in with a Microsoft account first.".to_string())?;
            let profile = fetch_profile(token).await?;
            let skin = profile
                .skins
                .iter()
                .find(|skin| is_active(&skin.state))
                .or(profile.skins.first())
                .ok_or_else(|| {
                    "This account wears the default skin; there is nothing to save.".to_string()
                })?;
            let bytes = fetch_texture(&skin.url)
                .await
                .ok_or_else(|| "The current skin could not be downloaded.".to_string())?;
            validate(&bytes)?;
            Ok(bytes)
        }
    }
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Default)]
struct LibraryIndex {
    #[serde(default)]
    skins: Vec<LibrarySkin>,
}

fn library_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("minecraft").join("skin-library")
}

fn index_path(app_data_dir: &Path) -> PathBuf {
    library_dir(app_data_dir).join("library.json")
}

fn skin_path(app_data_dir: &Path, id: &str) -> PathBuf {
    library_dir(app_data_dir).join(format!("{id}.png"))
}

fn load_index(app_data_dir: &Path) -> LibraryIndex {
    fs::read_to_string(index_path(app_data_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_index(app_data_dir: &Path, index: &LibraryIndex) -> Result<(), String> {
    let dir = library_dir(app_data_dir);
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the skin library: {error}"))?;
    let text = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    let path = index_path(app_data_dir);
    let temp = dir.join("library.json.tmp");
    fs::write(&temp, text).map_err(|error| format!("Could not save the skin library: {error}"))?;
    fs::rename(&temp, &path).map_err(|error| format!("Could not save the skin library: {error}"))
}

fn clean_name(name: &str) -> Result<String, String> {
    let name: String = name.trim().chars().take(40).collect();
    if name.is_empty() {
        return Err("Give the skin a name.".to_string());
    }
    Ok(name)
}

/// Every saved skin, textures included, newest first.
pub fn library_list(app_data_dir: &Path) -> Vec<LibrarySkin> {
    let mut skins = load_index(app_data_dir).skins;
    for skin in &mut skins {
        skin.png_base64 = fs::read(skin_path(app_data_dir, &skin.id))
            .ok()
            .map(|bytes| encode(&bytes));
    }
    skins.reverse();
    skins
}

pub fn library_read(app_data_dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    let index = load_index(app_data_dir);
    if !index.skins.iter().any(|skin| skin.id == id) {
        return Err("That skin is no longer in the library.".to_string());
    }
    let bytes = fs::read(skin_path(app_data_dir, id))
        .map_err(|_| "That skin's file is missing from the library.".to_string())?;
    validate(&bytes)?;
    Ok(bytes)
}

pub fn library_add(
    app_data_dir: &Path,
    name: &str,
    bytes: &[u8],
    variant: Variant,
) -> Result<LibrarySkin, String> {
    validate(bytes)?;
    let name = clean_name(name)?;
    let mut index = load_index(app_data_dir);
    if index.skins.len() >= MAX_LIBRARY {
        return Err(format!(
            "The library holds {MAX_LIBRARY} skins; remove one first."
        ));
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    fs::create_dir_all(library_dir(app_data_dir))
        .map_err(|error| format!("Could not create the skin library: {error}"))?;
    fs::write(skin_path(app_data_dir, &id), bytes)
        .map_err(|error| format!("Could not save the skin: {error}"))?;
    let skin = LibrarySkin {
        id,
        name,
        variant,
        added_at: chrono::Utc::now().to_rfc3339(),
        png_base64: Some(encode(bytes)),
    };
    index.skins.push(skin.clone());
    save_index(app_data_dir, &index)?;
    Ok(skin)
}

pub fn library_rename(app_data_dir: &Path, id: &str, name: &str) -> Result<(), String> {
    let name = clean_name(name)?;
    let mut index = load_index(app_data_dir);
    let skin = index
        .skins
        .iter_mut()
        .find(|skin| skin.id == id)
        .ok_or_else(|| "That skin is no longer in the library.".to_string())?;
    skin.name = name;
    save_index(app_data_dir, &index)
}

pub fn library_set_variant(app_data_dir: &Path, id: &str, variant: Variant) -> Result<(), String> {
    let mut index = load_index(app_data_dir);
    let skin = index
        .skins
        .iter_mut()
        .find(|skin| skin.id == id)
        .ok_or_else(|| "That skin is no longer in the library.".to_string())?;
    skin.variant = variant;
    save_index(app_data_dir, &index)
}

pub fn library_remove(app_data_dir: &Path, id: &str) -> Result<(), String> {
    let mut index = load_index(app_data_dir);
    let before = index.skins.len();
    index.skins.retain(|skin| skin.id != id);
    if index.skins.len() == before {
        return Err("That skin is no longer in the library.".to_string());
    }
    let _ = fs::remove_file(skin_path(app_data_dir, id));
    save_index(app_data_dir, &index)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn only_a_skin_sized_png_passes() {
        assert!(validate(&png(64, 64)).is_ok());
        assert!(validate(&png(64, 32)).is_ok());
        let error = validate(&png(128, 128)).unwrap_err();
        assert!(error.contains("128x128"), "{error}");
        assert!(validate(b"not a png at all").is_err());
        assert!(validate(&vec![0u8; MAX_SKIN_BYTES + 1]).is_err());
    }

    #[test]
    fn the_library_keeps_the_png_beside_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(library_list(root).is_empty());

        let saved = library_add(root, "  Purple hoodie  ", &png(64, 64), Variant::Slim).unwrap();
        assert_eq!(saved.name, "Purple hoodie");
        assert!(skin_path(root, &saved.id).exists());

        let listed = library_list(root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].variant, Variant::Slim);
        assert_eq!(
            listed[0].png_base64.as_deref(),
            Some(encode(&png(64, 64)).as_str())
        );
        assert_eq!(library_read(root, &saved.id).unwrap(), png(64, 64));

        library_rename(root, &saved.id, "Hoodie").unwrap();
        library_set_variant(root, &saved.id, Variant::Classic).unwrap();
        let listed = library_list(root);
        assert_eq!(listed[0].name, "Hoodie");
        assert_eq!(listed[0].variant, Variant::Classic);

        library_remove(root, &saved.id).unwrap();
        assert!(library_list(root).is_empty());
        assert!(!skin_path(root, &saved.id).exists());
        assert!(library_read(root, &saved.id).is_err());
    }

    #[test]
    fn the_library_refuses_what_is_not_a_skin_and_the_nameless() {
        let dir = tempfile::tempdir().unwrap();
        assert!(library_add(dir.path(), "x", &png(32, 32), Variant::Classic).is_err());
        assert!(library_add(dir.path(), "   ", &png(64, 64), Variant::Classic).is_err());
        assert!(library_list(dir.path()).is_empty());
    }

    #[test]
    fn newest_first() {
        let dir = tempfile::tempdir().unwrap();
        library_add(dir.path(), "first", &png(64, 64), Variant::Classic).unwrap();
        library_add(dir.path(), "second", &png(64, 64), Variant::Classic).unwrap();
        let names: Vec<_> = library_list(dir.path())
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, ["second", "first"]);
    }

    #[test]
    fn a_skin_address_is_on_the_internet_or_refused() {
        assert!(is_local_host("localhost"));
        assert!(is_local_host("127.0.0.1"));
        assert!(is_local_host("10.0.0.4"));
        assert!(is_local_host("192.168.1.42"));
        assert!(is_local_host("169.254.169.254"));
        assert!(is_local_host("::1"));
        assert!(is_local_host("[::1]"));
        assert!(is_local_host("fe80::1"));
        assert!(is_local_host("::ffff:127.0.0.1"));
        assert!(is_local_host("printer.local"));
        assert!(!is_local_host("textures.minecraft.net"));
        assert!(!is_local_host("8.8.8.8"));
    }

    #[tokio::test]
    async fn a_skin_address_must_be_https() {
        let error = fetch_url("http://example.com/skin.png").await.unwrap_err();
        assert!(error.contains("https"), "{error}");
        let error = fetch_url("https://127.0.0.1/skin.png").await.unwrap_err();
        assert!(error.contains("internet"), "{error}");
        assert!(fetch_url("not a url").await.is_err());
    }

    #[test]
    fn a_variant_is_read_the_way_the_service_writes_it() {
        assert_eq!(Variant::parse("SLIM"), Variant::Slim);
        assert_eq!(Variant::parse("classic"), Variant::Classic);
        assert_eq!(Variant::parse(""), Variant::Classic);
        assert_eq!(serde_json::to_string(&Variant::Slim).unwrap(), "\"slim\"");
    }
}
