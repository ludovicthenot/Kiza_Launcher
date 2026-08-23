//! The picture and the "last played" line on an instance card.
//!
//! Kiza ships no artwork of its own and invents none. A card is illustrated
//! from one of three sources, in this order:
//!
//! 1. **An image the user picked.** Their instance, their choice.
//! 2. **The Minecraft version's own title-screen panorama**, read out of the
//!    assets that version already downloaded. It is genuinely that version's
//!    artwork — 1.8.9 and 1.21 do not look alike — and it costs no network.
//! 3. **Nothing**, and the interface draws a gradient derived from the
//!    instance's identifier. Always the same for the same instance, and
//!    obviously a placeholder.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// A cover is a wallpaper, not a photo library. Anything past this is a file
/// the user meant for something else.
const MAX_COVER_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageKind {
    Png,
    Jpeg,
}

impl ImageKind {
    pub fn extension(self) -> &'static str {
        match self {
            ImageKind::Png => "png",
            ImageKind::Jpeg => "jpg",
        }
    }

    pub fn media_type(self) -> &'static str {
        match self {
            ImageKind::Png => "image/png",
            ImageKind::Jpeg => "image/jpeg",
        }
    }
}

/// Identifies an image by its own bytes.
///
/// The file name is not evidence: anything can be renamed to `.png`, and the
/// media type declared to the webview has to match what the file actually is.
pub fn image_kind(bytes: &[u8]) -> Option<ImageKind> {
    const PNG: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if bytes.starts_with(&PNG) {
        return Some(ImageKind::Png);
    }
    // JPEG starts with SOI and its first marker.
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(ImageKind::Jpeg);
    }
    None
}

fn art_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("instance-art")
}

fn cover_path(app_data_dir: &Path, instance_id: &str, kind: ImageKind) -> PathBuf {
    art_dir(app_data_dir).join(format!("{instance_id}.{}", kind.extension()))
}

/// The cover file of an instance, whichever format it was saved in.
pub fn find_cover(app_data_dir: &Path, instance_id: &str) -> Option<(PathBuf, ImageKind)> {
    for kind in [ImageKind::Png, ImageKind::Jpeg] {
        let path = cover_path(app_data_dir, instance_id, kind);
        if path.is_file() {
            return Some((path, kind));
        }
    }
    None
}

/// Saves an image the user chose as this instance's cover.
pub fn set_cover(app_data_dir: &Path, instance_id: &str, source: &Path) -> Result<String, String> {
    let metadata =
        fs::metadata(source).map_err(|error| format!("Could not read the image: {error}"))?;
    if metadata.len() > MAX_COVER_BYTES {
        return Err("That image is larger than 8 MB.".to_string());
    }

    let bytes = fs::read(source).map_err(|error| format!("Could not read the image: {error}"))?;
    let kind = image_kind(&bytes).ok_or("That file is not a PNG or JPEG image.")?;

    let directory = art_dir(app_data_dir);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the artwork directory: {error}"))?;

    // One cover per instance: drop any file in the other format, or the old one
    // would win the lookup above.
    clear_cover(app_data_dir, instance_id);

    let destination = cover_path(app_data_dir, instance_id, kind);
    fs::write(&destination, &bytes)
        .map_err(|error| format!("Could not save the cover: {error}"))?;
    Ok(destination.to_string_lossy().to_string())
}

pub fn clear_cover(app_data_dir: &Path, instance_id: &str) {
    for kind in [ImageKind::Png, ImageKind::Jpeg] {
        let _ = fs::remove_file(cover_path(app_data_dir, instance_id, kind));
    }
}

fn to_data_uri(bytes: &[u8]) -> Option<String> {
    use base64::Engine as _;

    // The media type is decided by the bytes, never by a file name.
    let kind = image_kind(bytes)?;
    Some(format!(
        "data:{};base64,{}",
        kind.media_type(),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// The cover the user chose, as a data URI ready for an `<img src>`.
pub fn cover_data_uri(app_data_dir: &Path, instance_id: &str) -> Option<String> {
    let (path, kind) = find_cover(app_data_dir, instance_id)?;
    let bytes = fs::read(path).ok()?;
    // Re-check the bytes rather than trusting the extension the file was saved
    // under: the directory is on disk and anything could have replaced it.
    if image_kind(&bytes)? != kind {
        return None;
    }
    to_data_uri(&bytes)
}

/// Where a version's title-screen panorama lives inside its assets. Every
/// version that has one stores it under this name.
const PANORAMA_ASSET: &str = "gui/title/background/panorama_0.png";

/// The Minecraft version's own artwork, when its assets are already on disk.
///
/// This is the default illustration for an instance nobody gave a picture to.
/// It is not decoration Kiza chose: it is what that exact version shows behind
/// its own title screen, so the card looks like the game it launches.
///
/// None before the version is installed, which is correct — there is nothing to
/// show yet, and downloading artwork to fill a card would be the wrong trade.
pub fn version_artwork(app_data_dir: &Path, mc_version: &str) -> Option<String> {
    let bytes =
        crate::minecraft_manager::read_version_asset(app_data_dir, mc_version, PANORAMA_ASSET)?;
    to_data_uri(&bytes)
}

// ---- play history --------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PlayHistory {
    /// Instance id to the RFC 3339 timestamp of its last launch.
    #[serde(default)]
    last_played: std::collections::BTreeMap<String, String>,
}

fn history_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config").join("play-history.json")
}

fn load_history(app_data_dir: &Path) -> PlayHistory {
    fs::read_to_string(history_path(app_data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Records that an instance was launched, now.
pub fn mark_played(app_data_dir: &Path, instance_id: &str) -> Result<(), String> {
    let mut history = load_history(app_data_dir);
    history
        .last_played
        .insert(instance_id.to_string(), chrono::Utc::now().to_rfc3339());

    let path = history_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(&history).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| format!("Could not save the play history: {error}"))
}

pub fn last_played(app_data_dir: &Path, instance_id: &str) -> Option<String> {
    load_history(app_data_dir).last_played.remove(instance_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
        bytes.extend_from_slice(b"the rest of a png");
        bytes
    }

    fn jpeg() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        bytes.extend_from_slice(b"the rest of a jpeg");
        bytes
    }

    #[test]
    fn an_image_is_identified_by_its_bytes_not_its_name() {
        assert_eq!(image_kind(&png()), Some(ImageKind::Png));
        assert_eq!(image_kind(&jpeg()), Some(ImageKind::Jpeg));
        // The media type handed to the webview has to match the real file.
        assert_eq!(image_kind(b"<svg onload=alert(1)>"), None);
        assert_eq!(image_kind(b"GIF89a"), None);
        assert_eq!(image_kind(b""), None);
    }

    #[test]
    fn a_cover_round_trips_as_a_data_uri() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let source = root.join("wallpaper.png");
        fs::write(&source, png()).unwrap();

        assert!(cover_data_uri(root, "abc").is_none());
        set_cover(root, "abc", &source).unwrap();

        let uri = cover_data_uri(root, "abc").unwrap();
        assert!(uri.starts_with("data:image/png;base64,"), "{uri}");
    }

    #[test]
    fn replacing_a_cover_in_another_format_leaves_only_one() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let as_png = root.join("first.png");
        fs::write(&as_png, png()).unwrap();
        let as_jpeg = root.join("second.jpg");
        fs::write(&as_jpeg, jpeg()).unwrap();

        set_cover(root, "abc", &as_png).unwrap();
        set_cover(root, "abc", &as_jpeg).unwrap();

        // The old PNG would otherwise win the lookup and the new cover would
        // never appear.
        let uri = cover_data_uri(root, "abc").unwrap();
        assert!(uri.starts_with("data:image/jpeg;base64,"), "{uri}");
    }

    #[test]
    fn a_file_that_is_not_an_image_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let fake = root.join("cover.png");
        fs::write(&fake, b"<svg onload=alert(1)></svg>").unwrap();

        assert!(set_cover(root, "abc", &fake).is_err());
        assert!(cover_data_uri(root, "abc").is_none());
    }

    #[test]
    fn clearing_a_cover_removes_it() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let source = root.join("wallpaper.png");
        fs::write(&source, png()).unwrap();
        set_cover(root, "abc", &source).unwrap();

        clear_cover(root, "abc");
        assert!(cover_data_uri(root, "abc").is_none());
    }

    #[test]
    fn play_history_survives_and_stays_per_instance() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();

        assert_eq!(last_played(root, "abc"), None);
        mark_played(root, "abc").unwrap();
        mark_played(root, "def").unwrap();

        assert!(last_played(root, "abc").is_some());
        assert!(last_played(root, "def").is_some());
        // Launching one instance says nothing about another.
        assert_eq!(last_played(root, "ghi"), None);
    }
}
