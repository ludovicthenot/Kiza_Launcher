//! Saved offline profiles: a name, and optionally a skin.
//!
//! These are local identities, not Mojang accounts. Nothing here authenticates
//! anything; the point is that the player picks a saved profile at launch
//! instead of retyping a username every time.
//!
//! The UUID is derived the way Minecraft derives it for offline play, so the
//! same name always maps to the same player and world data survives a relaunch.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Minecraft's own limits: 3-16 characters, letters, digits and underscore.
const MIN_USERNAME: usize = 3;
const MAX_USERNAME: usize = 16;
const MAX_PROFILES: usize = 64;
/// A skin is 64x64 (or 64x32 before 1.8); anything larger is not a skin.
const MAX_SKIN_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OfflineAccount {
    pub id: String,
    pub username: String,
    /// Offline UUID, hex without dashes, as the game expects on the command line.
    pub uuid: String,
    /// Absolute path to the imported skin, if any.
    pub skin_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OfflineStore {
    #[serde(default)]
    accounts: Vec<OfflineAccount>,
}

fn store_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config").join("offline_accounts.json")
}

fn skins_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("minecraft").join("skins")
}

/// The UUID Minecraft gives a nameless player: MD5 of `OfflinePlayer:<name>`
/// with the version and variant bits forced, which is what
/// `UUID.nameUUIDFromBytes` does in the game.
pub fn offline_uuid(username: &str) -> String {
    let digest = md5::compute(format!("OfflinePlayer:{username}").as_bytes());
    let mut bytes = digest.0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).simple().to_string()
}

pub fn validate_username(username: &str) -> Result<String, String> {
    let trimmed = username.trim();
    if trimmed.len() < MIN_USERNAME || trimmed.len() > MAX_USERNAME {
        return Err(format!(
            "A username must be between {MIN_USERNAME} and {MAX_USERNAME} characters."
        ));
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err("A username may only contain letters, digits and underscores.".to_string());
    }
    Ok(trimmed.to_string())
}

fn load_store(app_data_dir: &Path) -> OfflineStore {
    fs::read_to_string(store_path(app_data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_store(app_data_dir: &Path, store: &OfflineStore) -> Result<(), String> {
    let path = store_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the profile directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| format!("Could not save offline profiles: {error}"))
}

pub fn list(app_data_dir: &Path) -> Vec<OfflineAccount> {
    load_store(app_data_dir).accounts
}

pub fn create(app_data_dir: &Path, username: &str) -> Result<OfflineAccount, String> {
    let username = validate_username(username)?;
    let mut store = load_store(app_data_dir);
    if store.accounts.len() >= MAX_PROFILES {
        return Err(format!(
            "You can keep at most {MAX_PROFILES} offline profiles."
        ));
    }
    if store
        .accounts
        .iter()
        .any(|account| account.username.eq_ignore_ascii_case(&username))
    {
        return Err(format!(
            "An offline profile named {username} already exists."
        ));
    }

    let account = OfflineAccount {
        id: Uuid::new_v4().simple().to_string(),
        uuid: offline_uuid(&username),
        username,
        skin_path: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store.accounts.push(account.clone());
    save_store(app_data_dir, &store)?;
    Ok(account)
}

pub fn rename(app_data_dir: &Path, id: &str, username: &str) -> Result<OfflineAccount, String> {
    let username = validate_username(username)?;
    let mut store = load_store(app_data_dir);
    if store
        .accounts
        .iter()
        .any(|account| account.id != id && account.username.eq_ignore_ascii_case(&username))
    {
        return Err(format!(
            "An offline profile named {username} already exists."
        ));
    }

    let account = store
        .accounts
        .iter_mut()
        .find(|account| account.id == id)
        .ok_or_else(|| "That offline profile no longer exists.".to_string())?;
    // The UUID follows the name, exactly as the game derives it.
    account.uuid = offline_uuid(&username);
    account.username = username;
    let updated = account.clone();
    save_store(app_data_dir, &store)?;
    Ok(updated)
}

pub fn delete(app_data_dir: &Path, id: &str) -> Result<Vec<OfflineAccount>, String> {
    let mut store = load_store(app_data_dir);
    if let Some(removed) = store.accounts.iter().find(|account| account.id == id) {
        if let Some(skin) = &removed.skin_path {
            let _ = fs::remove_file(skin);
        }
    }
    store.accounts.retain(|account| account.id != id);
    save_store(app_data_dir, &store)?;
    Ok(store.accounts)
}

/// Copies a PNG next to the profile after checking it really is a skin.
pub fn import_skin(app_data_dir: &Path, id: &str, source: &Path) -> Result<OfflineAccount, String> {
    let metadata =
        fs::metadata(source).map_err(|error| format!("Could not read the image: {error}"))?;
    if metadata.len() > MAX_SKIN_BYTES {
        return Err("That file is too large to be a Minecraft skin.".to_string());
    }
    let bytes = fs::read(source).map_err(|error| format!("Could not read the image: {error}"))?;
    let (width, height) = png_dimensions(&bytes)?;
    if !(width == 64 && (height == 64 || height == 32)) {
        return Err(format!(
            "A Minecraft skin is 64x64 or 64x32 pixels; this image is {width}x{height}."
        ));
    }

    let mut store = load_store(app_data_dir);
    let account = store
        .accounts
        .iter_mut()
        .find(|account| account.id == id)
        .ok_or_else(|| "That offline profile no longer exists.".to_string())?;

    let directory = skins_dir(app_data_dir);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the skin directory: {error}"))?;
    let destination = directory.join(format!("{id}.png"));
    fs::write(&destination, &bytes).map_err(|error| format!("Could not save the skin: {error}"))?;

    account.skin_path = Some(destination.to_string_lossy().to_string());
    let updated = account.clone();
    save_store(app_data_dir, &store)?;
    Ok(updated)
}

/// Reads width and height straight from the PNG header, which also proves the
/// file is a PNG rather than something renamed.
fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    const SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return Err("That file is not a PNG image.".to_string());
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Ok((width, height))
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
    fn offline_uuid_matches_what_minecraft_derives() {
        // Same name, same player: this is what keeps world data across launches.
        assert_eq!(offline_uuid("Nefer"), offline_uuid("Nefer"));
        assert_ne!(offline_uuid("Nefer"), offline_uuid("nefer"));
        let uuid = offline_uuid("Player");
        assert_eq!(uuid.len(), 32);
        // Version 3 and the RFC variant, as UUID.nameUUIDFromBytes sets them.
        assert_eq!(&uuid[12..13], "3");
        assert!(["8", "9", "a", "b"].contains(&&uuid[16..17]));
    }

    #[test]
    fn usernames_follow_the_game_rules() {
        assert_eq!(validate_username("  Nefer  ").unwrap(), "Nefer");
        assert!(validate_username("ab").is_err());
        assert!(validate_username("a".repeat(17).as_str()).is_err());
        assert!(validate_username("has space").is_err());
        assert!(validate_username("accentué").is_err());
        assert!(validate_username("ok_Name9").is_ok());
    }

    #[test]
    fn profiles_round_trip_and_reject_duplicates() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();

        let created = create(root, "Nefer").unwrap();
        assert_eq!(created.uuid, offline_uuid("Nefer"));
        assert_eq!(list(root).len(), 1);

        // Case-insensitive, so two profiles cannot map to the same player.
        assert!(create(root, "nefer").is_err());

        let renamed = rename(root, &created.id, "Kiza").unwrap();
        assert_eq!(renamed.username, "Kiza");
        assert_eq!(renamed.uuid, offline_uuid("Kiza"));

        assert!(delete(root, &created.id).unwrap().is_empty());
    }

    #[test]
    fn only_real_skin_images_are_accepted() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let account = create(root, "Nefer").unwrap();

        let not_png = root.join("nope.png");
        fs::write(&not_png, b"this is not a png").unwrap();
        assert!(import_skin(root, &account.id, &not_png).is_err());

        let wrong_size = root.join("wrong.png");
        fs::write(&wrong_size, png(128, 128)).unwrap();
        let error = import_skin(root, &account.id, &wrong_size).unwrap_err();
        assert!(error.contains("128x128"), "got {error}");

        let skin = root.join("skin.png");
        fs::write(&skin, png(64, 64)).unwrap();
        let updated = import_skin(root, &account.id, &skin).unwrap();
        assert!(updated.skin_path.is_some());
        assert!(PathBuf::from(updated.skin_path.unwrap()).exists());

        // The pre-1.8 layout is still a skin.
        let legacy = root.join("legacy.png");
        fs::write(&legacy, png(64, 32)).unwrap();
        assert!(import_skin(root, &account.id, &legacy).is_ok());
    }

    #[test]
    fn deleting_a_profile_removes_its_skin() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let account = create(root, "Nefer").unwrap();
        let skin = root.join("skin.png");
        fs::write(&skin, png(64, 64)).unwrap();
        let stored = import_skin(root, &account.id, &skin)
            .unwrap()
            .skin_path
            .unwrap();

        delete(root, &account.id).unwrap();
        assert!(!PathBuf::from(stored).exists());
    }
}
