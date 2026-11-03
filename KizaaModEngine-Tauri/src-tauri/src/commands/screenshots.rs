//! An instance's screenshots: what Minecraft saved under `screenshots` when
//! F2 was pressed, listed for the launcher's gallery, with small copies made
//! once for the grid, and the picture itself copied to the clipboard.
//!
//! Every command names a screenshot by its instance and its file name, never
//! by a path: a name with a separator in it, or one that is not a picture, is
//! refused, so nothing outside the instance's own `screenshots` folder can be
//! read or copied through here.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

use crate::minecraft_manager;

/// The longest side of a thumbnail in the grid, in pixels: two columns wide
/// on a large window, sharp on a high-density screen.
const THUMBNAIL_WIDTH: u32 = 480;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct Screenshot {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// When it was taken, in milliseconds since 1970.
    pub taken_at: u64,
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn screenshots_dir(app: &tauri::AppHandle, instance_id: &str) -> PathBuf {
    minecraft_manager::instance_game_dir_path(&app_data_dir(app), instance_id).join("screenshots")
}

/// When the file was last written, in milliseconds since 1970; 0 when the system cannot say.
fn modified_millis(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_millis() as u64)
        .unwrap_or(0)
}

fn is_picture(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg"
            )
        })
}

/// The screenshot called `name` in this instance, or why it cannot be.
fn screenshot_path(
    app: &tauri::AppHandle,
    instance_id: &str,
    name: &str,
) -> Result<PathBuf, String> {
    let plain = Path::new(name)
        .file_name()
        .and_then(|file| file.to_str())
        .is_some_and(|file| file == name);
    if !plain || name.starts_with('.') {
        return Err("That is not the name of a screenshot.".to_string());
    }
    let path = screenshots_dir(app, instance_id).join(name);
    if !is_picture(&path) || !path.is_file() {
        return Err("That screenshot is not there any more.".to_string());
    }
    Ok(path)
}

/// Lets the window show pictures from these folders, and only these.
fn allow_pictures(app: &tauri::AppHandle, folder: &Path) {
    let _ = app.asset_protocol_scope().allow_directory(folder, false);
}

/// The instance's screenshots, newest first.
#[tauri::command(async)]
pub(crate) fn list_screenshots(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<Vec<Screenshot>, String> {
    let dir = screenshots_dir(&app_handle, &instance_id);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    allow_pictures(&app_handle, &dir);
    let mut found: Vec<Screenshot> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !is_picture(&path) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let taken_at = modified_millis(&metadata);
            Some(Screenshot {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                size: metadata.len(),
                taken_at,
            })
        })
        .collect();
    found.sort_by(|left, right| {
        right
            .taken_at
            .cmp(&left.taken_at)
            .then_with(|| right.name.cmp(&left.name))
    });
    Ok(found)
}

/// A small copy of the screenshot for the grid, made once and kept: its path.
///
/// Named after the picture's path, size and time, so a picture replaced
/// under the same name gets a new one.
#[tauri::command(async)]
pub(crate) fn screenshot_thumbnail(
    app_handle: tauri::AppHandle,
    instance_id: String,
    name: String,
) -> Result<String, String> {
    let path = screenshot_path(&app_handle, &instance_id, &name)?;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    let key = format!(
        "{}|{}|{}|{}",
        path.to_string_lossy(),
        metadata.len(),
        modified_millis(&metadata),
        THUMBNAIL_WIDTH
    );
    let cache = app_data_dir(&app_handle)
        .join("cache")
        .join("screenshot-thumbnails");
    std::fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    allow_pictures(&app_handle, &cache);
    let thumbnail = cache.join(format!(
        "{}.jpg",
        crate::base_mod::sha256_hex(key.as_bytes())
    ));
    if !thumbnail.is_file() {
        let picture = image::open(&path)
            .map_err(|error| format!("Could not read the screenshot: {error}"))?;
        let small = picture
            .thumbnail(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH)
            .to_rgb8();
        let temporary = thumbnail.with_extension("part");
        let file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 84)
            .encode_image(&small)
            .map_err(|error| format!("Could not make the thumbnail: {error}"))?;
        drop(writer);
        std::fs::rename(&temporary, &thumbnail).map_err(|error| error.to_string())?;
    }
    Ok(thumbnail.to_string_lossy().into_owned())
}

/// Puts the picture itself on the clipboard, to paste into a message.
#[tauri::command(async)]
pub(crate) fn copy_screenshot(
    app_handle: tauri::AppHandle,
    instance_id: String,
    name: String,
) -> Result<(), String> {
    let path = screenshot_path(&app_handle, &instance_id, &name)?;
    let picture = image::open(&path)
        .map_err(|error| format!("Could not read the screenshot: {error}"))?
        .to_rgba8();
    let (width, height) = picture.dimensions();
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("The clipboard is not available: {error}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::Owned(picture.into_raw()),
        })
        .map_err(|error| format!("Could not copy the screenshot: {error}"))
}

/// Opens the instance's `screenshots` folder, made if Minecraft has not yet.
#[tauri::command(async)]
pub(crate) fn open_screenshots_folder(
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<(), String> {
    let dir = screenshots_dir(&app_handle, &instance_id);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

/// Shows the screenshot in its folder, selected.
#[tauri::command(async)]
pub(crate) fn reveal_screenshot(
    app_handle: tauri::AppHandle,
    instance_id: String,
    name: String,
) -> Result<(), String> {
    let path = screenshot_path(&app_handle, &instance_id, &name)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_picture;
    use std::path::Path;

    #[test]
    fn only_pictures_are_listed() {
        assert!(is_picture(Path::new("2026-10-13_03.21.45.png")));
        assert!(is_picture(Path::new("shot.JPG")));
        assert!(!is_picture(Path::new("notes.txt")));
        assert!(!is_picture(Path::new("screenshots")));
    }
}
