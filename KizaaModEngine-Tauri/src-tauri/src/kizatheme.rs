//! Reading and writing `.kizatheme`.
//!
//! A theme is a zip holding `theme.json` and an `assets/` folder. It is design
//! and nothing else: colours, numbers, and pictures. There is no place in the
//! format for a script, and nothing here executes anything.
//!
//! A theme file arrives from wherever a person found it, so it is read the way
//! the instance importer reads an archive somebody was handed: every entry
//! named before it is opened, every path checked before it is joined, every
//! size known before the bytes are read. The failures this guards against are
//! ordinary and specific — an entry called `../../config.json`, a manifest
//! declaring a hundred megabytes of background, an archive that unpacks to more
//! than the disk holds — and each has a test.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The schema this build writes and the newest it can read.
pub const SCHEMA_VERSION: u32 = 1;

/// Where a theme's pictures live inside the archive.
const ASSET_DIR: &str = "assets/";
const MANIFEST: &str = "theme.json";

/// How much of a theme this launcher will look at.
///
/// Mirrored in `src/lib/theme/assets.ts`, and a test reads that file so the two
/// cannot drift into disagreeing about what a valid theme is.
pub const MAX_ASSET_BYTES: u64 = 8 * 1024 * 1024;
/// What a moving background may weigh.
///
/// Fifteen megabits a second for the thirty seconds a background may run. It
/// is a bitrate rather than a round number because that is what decides
/// whether the thing still looks like itself: at six a gradient survives and a
/// night sky turns to blocks. The interface holds the same figure, and a test
/// reads both.
pub const MAX_VIDEO_BYTES: u64 = 56 * 1024 * 1024;
pub const MAX_TOTAL_ASSET_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
/// Enough for a manifest, a handful of pictures, and nothing that looks like a
/// zip bomb.
pub const MAX_ENTRIES: usize = 64;

/// Picture formats a theme may carry.
///
/// SVG is absent deliberately. It is a document, not an image: it can carry
/// script, reference remote files and be made to render very differently
/// depending on who opens it. A theme is design, and this is the line.
const ALLOWED_EXTENSIONS: [&str; 8] = [
    "png", "jpg", "jpeg", "webp", "gif", "avif", "webm", "mp4",
];

/// The one slot that may hold something that plays.
///
/// A logo is drawn small and beside text; a video there would be a decoder
/// running for motion nobody can see. The background is the whole window,
/// which is the only place where a moving picture is the point.
const MOTION_SLOT: &str = "background";

/// The colours the launcher paints with, in the order the interface declares.
///
/// Kept here because a theme missing one would leave that colour at whatever
/// the previous theme set, which is a fault that only appears after switching
/// themes and is close to unrecognisable as one.
pub const COLOR_TOKENS: [&str; 19] = [
    "background",
    "foreground",
    "card",
    "card-foreground",
    "popover",
    "popover-foreground",
    "primary",
    "primary-foreground",
    "secondary",
    "secondary-foreground",
    "muted",
    "muted-foreground",
    "accent",
    "accent-foreground",
    "destructive",
    "destructive-foreground",
    "border",
    "input",
    "ring",
];

/// Slots a theme may fill. Anything else in the manifest is refused rather than
/// ignored, so a theme written for a newer Kiza fails loudly here.
pub const ASSET_SLOTS: [&str; 3] = ["logo", "logoCompact", "background"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AmbientStop {
    /// An HSL triplet without `hsl()`, as everything else in Kiza stores colour.
    pub color: String,
    pub alpha: f32,
}

/// What a theme recommends, as opposed to what it paints.
///
/// Both optional, and both only ever a recommendation: what somebody chose in
/// the launcher's own settings wins. A theme that says nothing here gets the
/// launcher's defaults, which is why every field is an `Option` rather than a
/// `bool` with a default — "this theme has no opinion" and "this theme wants it
/// off" are different, and only one of them should follow the file around.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEffects {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translucency: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_blur: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    pub colors: BTreeMap<String, String>,
    pub ambient: Vec<AmbientStop>,
    #[serde(default)]
    pub radius: Option<f32>,
    /// The look the designer built the theme around. Advisory; see the type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<ThemeEffects>,
    /// What was changed on individual components, by component and property.
    ///
    /// Deliberately untyped. What a `card` is, and which of its properties a
    /// designer may touch, is the Maker's business; this format's job is to
    /// carry the values without opinions. A theme written for a later Kiza
    /// that names a component this one has never heard of sets a custom
    /// property nothing reads, rather than being refused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub components: Option<BTreeMap<String, BTreeMap<String, String>>>,
    /// Where individual elements sit, by the name the launcher gave them.
    ///
    /// Carried through untouched for the same reason the components are: what
    /// an element is, and what is worth saying about where it sits, is the
    /// Maker's business. A theme written by a later Kiza naming a part this
    /// one has never heard of is read, kept, and written back out — it simply
    /// styles nothing here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<BTreeMap<String, BTreeMap<String, String>>>,
    /// Slot name to the file inside `assets/`, e.g. `"logo": "logo.webp"`.
    #[serde(default)]
    pub assets: BTreeMap<String, String>,
}

/// A theme, opened.
#[derive(Debug, Clone, Serialize)]
pub struct LoadedTheme {
    pub manifest: ThemeManifest,
    /// Slot name to the picture's bytes, ready to become an object URL.
    #[serde(skip)]
    pub assets: BTreeMap<String, Vec<u8>>,
    /// Slot name to the MIME type the interface should give those bytes.
    pub asset_types: BTreeMap<String, String>,
}

/// Why a theme was refused.
///
/// Every one of these names a thing the reader can do something about. "Invalid
/// theme" tells somebody who spent an evening on a theme nothing at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    NotAnArchive(String),
    NoManifest,
    ManifestTooLarge,
    UnreadableManifest(String),
    FromTheFuture { found: u32, supported: u32 },
    MissingColour(String),
    BadColour { token: String, value: String },
    WrongAmbient(usize),
    UnknownSlot(String),
    UnsafePath(String),
    UnsupportedFormat(String),
    AssetTooLarge { name: String, bytes: u64 },
    ThemeTooLarge { bytes: u64 },
    TooManyEntries(usize),
    MissingAsset(String),
    BadIdentifier(String),
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAnArchive(why) => write!(formatter, "This file is not a theme archive: {why}"),
            Self::NoManifest => write!(
                formatter,
                "This archive has no theme.json, so it is not a Kiza theme."
            ),
            Self::ManifestTooLarge => write!(
                formatter,
                "The theme's manifest is far larger than any theme needs."
            ),
            Self::UnreadableManifest(why) => {
                write!(formatter, "The theme's manifest could not be read: {why}")
            }
            Self::FromTheFuture { found, supported } => write!(
                formatter,
                "This theme is written for a newer Kiza (format {found}; this one reads {supported}). Update Kiza to use it."
            ),
            Self::MissingColour(token) => write!(
                formatter,
                "The theme does not say what colour to use for '{token}'."
            ),
            Self::BadColour { token, value } => write!(
                formatter,
                "'{value}' is not a colour Kiza can use for '{token}'. Colours look like '242 30% 5%'."
            ),
            Self::WrongAmbient(found) => write!(
                formatter,
                "A theme needs exactly two background glows; this one has {found}."
            ),
            Self::UnknownSlot(slot) => write!(
                formatter,
                "This theme wants to replace '{slot}', which this Kiza has no place for."
            ),
            Self::UnsafePath(path) => write!(
                formatter,
                "The theme contains a file that tries to escape its own folder: {path}"
            ),
            Self::UnsupportedFormat(name) => write!(
                formatter,
                "'{name}' is not a picture format a theme may use. Use PNG, JPEG, WebP or GIF."
            ),
            Self::AssetTooLarge { name, bytes } => write!(
                formatter,
                "'{name}' is {} MB, over the {} MB a single picture may weigh.",
                bytes / 1024 / 1024,
                MAX_ASSET_BYTES / 1024 / 1024
            ),
            Self::ThemeTooLarge { bytes } => write!(
                formatter,
                "This theme's pictures come to {} MB, over the {} MB a theme may weigh.",
                bytes / 1024 / 1024,
                MAX_TOTAL_ASSET_BYTES / 1024 / 1024
            ),
            Self::TooManyEntries(found) => write!(
                formatter,
                "This archive holds {found} files, far more than a theme needs."
            ),
            Self::MissingAsset(name) => write!(
                formatter,
                "The theme names a picture it does not contain: {name}"
            ),
            Self::BadIdentifier(id) => write!(
                formatter,
                "'{id}' is not a usable theme name. Use letters, digits and dashes."
            ),
        }
    }
}

impl From<Refusal> for String {
    fn from(refusal: Refusal) -> Self {
        refusal.to_string()
    }
}

/// Whether a string is a colour the launcher can paint with.
///
/// The HSL triplet Tailwind reads: `"242 30% 5%"`. Checked rather than trusted,
/// because this value is written straight into a CSS custom property, and a
/// value carrying a `;` or a `}` would be writing CSS rather than a colour.
fn is_colour(value: &str) -> bool {
    let parts: Vec<&str> = value.split_whitespace().collect();
    if parts.len() != 3 {
        return false;
    }
    let hue = parts[0].parse::<f32>().ok();
    let saturation = parts[1]
        .strip_suffix('%')
        .and_then(|n| n.parse::<f32>().ok());
    let lightness = parts[2]
        .strip_suffix('%')
        .and_then(|n| n.parse::<f32>().ok());
    match (hue, saturation, lightness) {
        (Some(h), Some(s), Some(l)) => {
            (0.0..=360.0).contains(&h) && (0.0..=100.0).contains(&s) && (0.0..=100.0).contains(&l)
        }
        _ => false,
    }
}

/// A theme id that is safe as a file name and as a DOM attribute.
fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// The name of a picture inside `assets/`, with nowhere to go but there.
///
/// The whole point: an entry called `../../../config.json` must not be joined
/// to anything. Rather than trying to clean a path, only a plain file name is
/// accepted — no separators, no parents, no drive letters, no leading dot.
fn asset_file_name(raw: &str) -> Result<&str, Refusal> {
    let name = raw.trim();
    let unsafe_path = name.is_empty()
        || name.len() > 128
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains(':')
        || name.starts_with('.');
    if unsafe_path {
        return Err(Refusal::UnsafePath(raw.to_string()));
    }
    Ok(name)
}

/// Whether what this file is may go where it was asked to go.
///
/// Only the background moves. Everything else is a picture, wherever it came
/// from, and a theme that puts a video in a logo slot is refused rather than
/// quietly drawn as a broken image.
fn slot_accepts(slot: &str, mime: &str, name: &str) -> Result<(), Refusal> {
    if mime.starts_with("video/") && slot != MOTION_SLOT {
        return Err(Refusal::UnsupportedFormat(name.to_string()));
    }
    Ok(())
}

/// The most that kind of asset may weigh.
fn ceiling_for(mime: &str) -> u64 {
    if mime.starts_with("video/") {
        MAX_VIDEO_BYTES
    } else {
        MAX_ASSET_BYTES
    }
}

/// The MIME type for a picture, and proof the extension is one we allow.
fn mime_for(name: &str) -> Result<&'static str, Refusal> {
    let extension = name
        .rsplit('.')
        .next()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(Refusal::UnsupportedFormat(name.to_string()));
    }
    Ok(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        _ => "image/gif",
    })
}

/// Checks everything about a manifest that does not need the archive.
pub fn validate(manifest: &ThemeManifest) -> Result<(), Refusal> {
    if manifest.schema_version == 0 || manifest.schema_version > SCHEMA_VERSION {
        return Err(Refusal::FromTheFuture {
            found: manifest.schema_version,
            supported: SCHEMA_VERSION,
        });
    }
    if !is_identifier(&manifest.id) {
        return Err(Refusal::BadIdentifier(manifest.id.clone()));
    }

    for token in COLOR_TOKENS {
        let Some(value) = manifest.colors.get(token) else {
            return Err(Refusal::MissingColour(token.to_string()));
        };
        if !is_colour(value) {
            return Err(Refusal::BadColour {
                token: token.to_string(),
                value: value.clone(),
            });
        }
    }

    if manifest.ambient.len() != 2 {
        return Err(Refusal::WrongAmbient(manifest.ambient.len()));
    }
    for stop in &manifest.ambient {
        if !is_colour(&stop.color) {
            return Err(Refusal::BadColour {
                token: "ambient".to_string(),
                value: stop.color.clone(),
            });
        }
    }

    for (slot, file) in &manifest.assets {
        if !ASSET_SLOTS.contains(&slot.as_str()) {
            return Err(Refusal::UnknownSlot(slot.clone()));
        }
        let name = asset_file_name(file)?;
        mime_for(name)?;
    }
    Ok(())
}

/// Opens a `.kizatheme`.
pub fn read(path: &Path) -> Result<LoadedTheme, Refusal> {
    let file =
        std::fs::File::open(path).map_err(|error| Refusal::NotAnArchive(error.to_string()))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| Refusal::NotAnArchive(error.to_string()))?;

    if archive.len() > MAX_ENTRIES {
        return Err(Refusal::TooManyEntries(archive.len()));
    }

    // Sizes are read from the directory before any entry is opened, so an
    // archive that claims to unpack to a terabyte is refused rather than
    // attempted.
    let mut declared: BTreeMap<String, u64> = BTreeMap::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|error| Refusal::NotAnArchive(error.to_string()))?;
        // `enclosed_name` is None for anything that would escape the folder.
        if entry.enclosed_name().is_none() {
            return Err(Refusal::UnsafePath(entry.name().to_string()));
        }
        declared.insert(entry.name().to_string(), entry.size());
    }

    let manifest_size = *declared.get(MANIFEST).ok_or(Refusal::NoManifest)?;
    if manifest_size > MAX_MANIFEST_BYTES {
        return Err(Refusal::ManifestTooLarge);
    }

    let mut text = String::new();
    archive
        .by_name(MANIFEST)
        .map_err(|_| Refusal::NoManifest)?
        .read_to_string(&mut text)
        .map_err(|error| Refusal::UnreadableManifest(error.to_string()))?;
    let manifest: ThemeManifest = serde_json::from_str(&text)
        .map_err(|error| Refusal::UnreadableManifest(error.to_string()))?;
    validate(&manifest)?;

    let mut assets = BTreeMap::new();
    let mut asset_types = BTreeMap::new();
    let mut total = 0u64;

    for (slot, file) in &manifest.assets {
        let name = asset_file_name(file)?;
        let mime = mime_for(name)?;
        slot_accepts(slot, mime, name)?;
        let entry_name = format!("{ASSET_DIR}{name}");

        let size = *declared
            .get(&entry_name)
            .ok_or_else(|| Refusal::MissingAsset(file.clone()))?;
        if size > ceiling_for(mime) {
            return Err(Refusal::AssetTooLarge {
                name: file.clone(),
                bytes: size,
            });
        }
        total += size;
        if total > MAX_TOTAL_ASSET_BYTES {
            return Err(Refusal::ThemeTooLarge { bytes: total });
        }

        let mut bytes = Vec::with_capacity(size as usize);
        archive
            .by_name(&entry_name)
            .map_err(|_| Refusal::MissingAsset(file.clone()))?
            .read_to_end(&mut bytes)
            .map_err(|error| Refusal::UnreadableManifest(error.to_string()))?;

        assets.insert(slot.clone(), bytes);
        asset_types.insert(slot.clone(), mime.to_string());
    }

    Ok(LoadedTheme {
        manifest,
        assets,
        asset_types,
    })
}

/// A theme unpacked onto disk, ready for the window to draw.
#[derive(Debug, Clone, Serialize)]
pub struct InstalledTheme {
    pub manifest: ThemeManifest,
    /// Slot name to the picture's path on disk.
    ///
    /// A path rather than the bytes: a background can be several megabytes, and
    /// sending that through the IPC as base64 would cost the launcher a copy,
    /// an encode and a decode every time a theme is applied. The window turns
    /// these into URLs the webview loads directly, which is one read by the
    /// thing that was going to decode the picture anyway.
    pub assets: BTreeMap<String, String>,
}

/// Unpacks a theme into the launcher's own folder.
///
/// Everything the archive is allowed to contain has already been decided by
/// `read`; this only writes it down. The destination is built from the theme's
/// id, which `is_identifier` has already restricted to lowercase letters,
/// digits and dashes — so there is no path here that a theme had a say in.
pub fn install(source: &Path, themes_dir: &Path) -> Result<InstalledTheme, Refusal> {
    let loaded = read(source)?;
    let home = themes_dir.join(&loaded.manifest.id);

    // Replaced rather than merged: a theme that used to carry a background and
    // no longer does must not keep showing the old one.
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join("assets"))
        .map_err(|error| Refusal::NotAnArchive(error.to_string()))?;

    let mut assets = BTreeMap::new();
    for (slot, bytes) in &loaded.assets {
        let file = loaded
            .manifest
            .assets
            .get(slot)
            .and_then(|name| asset_file_name(name).ok())
            .ok_or_else(|| Refusal::MissingAsset(slot.clone()))?;
        let path = home.join("assets").join(file);
        std::fs::write(&path, bytes).map_err(|error| Refusal::NotAnArchive(error.to_string()))?;
        assets.insert(slot.clone(), path.to_string_lossy().to_string());
    }

    let manifest_text = serde_json::to_string_pretty(&loaded.manifest)
        .map_err(|error| Refusal::UnreadableManifest(error.to_string()))?;
    std::fs::write(home.join(MANIFEST), manifest_text)
        .map_err(|error| Refusal::NotAnArchive(error.to_string()))?;

    Ok(InstalledTheme {
        manifest: loaded.manifest,
        assets,
    })
}

/// Where a theme being edited keeps its pictures.
///
/// A folder rather than the picked file's own place on disk, and that is not
/// tidiness. The window draws a picture through the `asset:` protocol, whose
/// scope is deliberately one directory: allowing it to read anywhere the file
/// picker can reach would hand the page the user's whole disk. So a picked
/// picture is checked, copied here, and drawn from here.
///
/// Not dot-prefixed. A hidden folder would be tidier and it is not worth one
/// unexplained failure: a leading dot is exactly the sort of thing a path
/// matcher treats specially, and this folder has to be readable through a
/// scope pattern for the Maker to show a picture at all. The underscore keeps
/// it from ever colliding with a theme, whose id may only be lowercase
/// letters, digits and hyphens.
pub const DRAFT_DIR: &str = "_draft";

/// Takes a picture a person chose and puts it where the window may read it.
///
/// Refused for the same reasons a theme's own picture is refused, and refused
/// now rather than at export: finding out that a background is too heavy when
/// you try to save an evening's work is finding out too late.
/// Where a staged picture goes, once it is known to be one.
///
/// Shared by the two ways a picture arrives — chosen from the picker, or
/// dropped on the window — so neither can end up with checks the other does
/// not have.
fn staged_path(themes_dir: &Path, slot: &str, file_name: &str) -> Result<PathBuf, Refusal> {
    if !ASSET_SLOTS.contains(&slot) {
        return Err(Refusal::UnknownSlot(slot.to_string()));
    }
    let name = asset_file_name(file_name)?;
    let mime = mime_for(name)?;
    slot_accepts(slot, mime, name)?;

    let home = themes_dir.join(DRAFT_DIR).join("assets");
    std::fs::create_dir_all(&home).map_err(|error| Refusal::NotAnArchive(error.to_string()))?;

    // Named after the slot and the moment. The slot is what makes the previous
    // attempt findable and deletable, so trying six logos leaves one file
    // rather than six. The moment is what makes the address change: a window
    // that has already drawn `logo.png` will happily show it again from cache,
    // and the designer would swear the new picture had not been taken.
    let extension = name.rsplit('.').next().unwrap_or("png");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or(0);
    let destination = home.join(format!("{slot}-{stamp}.{extension}"));

    for stale in std::fs::read_dir(&home).into_iter().flatten().flatten() {
        let path = stale.path();
        let is_this_slot = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem == slot || stem.starts_with(&format!("{slot}-")));
        if is_this_slot && path != destination {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(destination)
}

pub fn stage_asset(themes_dir: &Path, slot: &str, source: &Path) -> Result<String, Refusal> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| Refusal::UnsafePath(source.to_string_lossy().to_string()))?
        .to_string();

    let size = std::fs::metadata(source)
        .map_err(|error| Refusal::NotAnArchive(error.to_string()))?
        .len();
    if size > ceiling_for(mime_for(asset_file_name(&name)?)?) {
        return Err(Refusal::AssetTooLarge { name, bytes: size });
    }

    let destination = staged_path(themes_dir, slot, &name)?;
    std::fs::copy(source, &destination)
        .map_err(|error| Refusal::NotAnArchive(error.to_string()))?;
    Ok(destination.to_string_lossy().to_string())
}

/// Every theme that has been installed, newest name first.
pub fn installed(themes_dir: &Path) -> Vec<InstalledTheme> {
    let Ok(entries) = std::fs::read_dir(themes_dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let home = entry.path();
        if home.file_name().is_some_and(|name| name == DRAFT_DIR) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(home.join(MANIFEST)) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<ThemeManifest>(&text) else {
            continue;
        };
        // Validated on the way back in as well: the folder is on disk and
        // anything could have edited it since.
        if validate(&manifest).is_err() {
            continue;
        }
        let mut assets = BTreeMap::new();
        for (slot, file) in &manifest.assets {
            let Ok(name) = asset_file_name(file) else {
                continue;
            };
            let path = home.join("assets").join(name);
            if path.is_file() {
                assets.insert(slot.clone(), path.to_string_lossy().to_string());
            }
        }
        found.push(InstalledTheme { manifest, assets });
    }
    found.sort_by(|left, right| left.manifest.name.cmp(&right.manifest.name));
    found
}

/// Forgets an installed theme.
pub fn remove(themes_dir: &Path, id: &str) -> Result<(), Refusal> {
    if !is_identifier(id) {
        return Err(Refusal::BadIdentifier(id.to_string()));
    }
    let home = themes_dir.join(id);
    if home.is_dir() {
        std::fs::remove_dir_all(&home).map_err(|error| Refusal::NotAnArchive(error.to_string()))?;
    }
    Ok(())
}

/// Writes a `.kizatheme`.
///
/// Validated before anything is written: a theme the launcher would refuse to
/// open is not one to hand to somebody else.
pub fn write(
    destination: &Path,
    manifest: &ThemeManifest,
    assets: &BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    validate(manifest).map_err(String::from)?;

    let mut total = 0u64;
    for (slot, file) in &manifest.assets {
        let bytes = assets
            .get(slot)
            .ok_or_else(|| Refusal::MissingAsset(file.clone()).to_string())?;
        let size = bytes.len() as u64;
        if size > ceiling_for(mime_for(asset_file_name(file).map_err(String::from)?).map_err(String::from)?) {
            return Err(Refusal::AssetTooLarge {
                name: file.clone(),
                bytes: size,
            }
            .to_string());
        }
        total += size;
    }
    if total > MAX_TOTAL_ASSET_BYTES {
        return Err(Refusal::ThemeTooLarge { bytes: total }.to_string());
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let file = std::fs::File::create(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    use std::io::Write;
    let text = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    zip.start_file(MANIFEST, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(text.as_bytes())
        .map_err(|error| error.to_string())?;

    for (slot, file_name) in &manifest.assets {
        let name = asset_file_name(file_name).map_err(String::from)?;
        let bytes = &assets[slot];
        zip.start_file(format!("{ASSET_DIR}{name}"), options)
            .map_err(|error| error.to_string())?;
        zip.write_all(bytes).map_err(|error| error.to_string())?;
    }

    zip.finish().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn colours() -> BTreeMap<String, String> {
        COLOR_TOKENS
            .iter()
            .map(|token| (token.to_string(), "242 30% 5%".to_string()))
            .collect()
    }

    fn manifest() -> ThemeManifest {
        ThemeManifest {
            schema_version: SCHEMA_VERSION,
            id: "midnight".to_string(),
            name: "Midnight".to_string(),
            description: "A theme".to_string(),
            author: Some("Jay".to_string()),
            version: Some("1.0.0".to_string()),
            colors: colours(),
            ambient: vec![
                AmbientStop {
                    color: "258 90% 66%".to_string(),
                    alpha: 0.09,
                },
                AmbientStop {
                    color: "224 90% 60%".to_string(),
                    alpha: 0.06,
                },
            ],
            radius: Some(12.0),
            effects: None,
            components: None,
            layout: None,
            assets: BTreeMap::new(),
        }
    }

    /// Writes an archive by hand, so a test can build the malformed ones the
    /// writer would never produce.
    fn archive(path: &Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).expect("create archive");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(*name, options).expect("entry");
            zip.write_all(bytes).expect("write");
        }
        zip.finish().expect("finish");
    }

    #[test]
    fn a_theme_written_here_can_be_read_back() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("midnight.kizatheme");

        let mut wanted = manifest();
        wanted
            .assets
            .insert("logo".to_string(), "logo.webp".to_string());
        let mut assets = BTreeMap::new();
        assets.insert("logo".to_string(), vec![7u8; 512]);

        write(&path, &wanted, &assets).expect("write the theme");
        let loaded = read(&path).expect("read it back");

        assert_eq!(loaded.manifest, wanted);
        assert_eq!(loaded.assets["logo"].len(), 512);
        assert_eq!(loaded.asset_types["logo"], "image/webp");
    }

    /// A theme opened, kept, listed and forgotten.
    #[test]
    fn an_installed_theme_can_be_found_again_and_dropped() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("midnight.kizatheme");
        let themes = directory.path().join("themes");

        let mut wanted = manifest();
        wanted
            .assets
            .insert("logo".to_string(), "logo.png".to_string());
        let mut assets = BTreeMap::new();
        assets.insert("logo".to_string(), vec![3u8; 128]);
        write(&archive_path, &wanted, &assets).unwrap();

        let installed_theme = install(&archive_path, &themes).expect("install");
        assert_eq!(installed_theme.manifest.id, "midnight");
        let logo = std::path::PathBuf::from(&installed_theme.assets["logo"]);
        assert!(logo.is_file());
        assert_eq!(std::fs::read(&logo).unwrap().len(), 128);

        let listed = installed(&themes);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].manifest.name, "Midnight");
        assert!(listed[0].assets.contains_key("logo"));

        remove(&themes, "midnight").expect("remove");
        assert!(installed(&themes).is_empty());
    }

    /// Installing again replaces rather than merges: a theme that dropped its
    /// background must stop showing the old one.
    #[test]
    fn reinstalling_a_theme_forgets_what_it_no_longer_carries() {
        let directory = tempfile::tempdir().unwrap();
        let themes = directory.path().join("themes");

        let with_logo = directory.path().join("a.kizatheme");
        let mut first = manifest();
        first
            .assets
            .insert("logo".to_string(), "logo.png".to_string());
        let mut assets = BTreeMap::new();
        assets.insert("logo".to_string(), vec![1u8; 64]);
        write(&with_logo, &first, &assets).unwrap();
        install(&with_logo, &themes).unwrap();

        let without = directory.path().join("b.kizatheme");
        write(&without, &manifest(), &BTreeMap::new()).unwrap();
        let second = install(&without, &themes).unwrap();

        assert!(second.assets.is_empty());
        assert!(!themes
            .join("midnight")
            .join("assets")
            .join("logo.png")
            .exists());
    }

    /// A folder on disk can be edited after the fact, so what comes back out is
    /// checked as carefully as what went in.
    #[test]
    fn an_installed_theme_edited_on_disk_is_not_listed() {
        let directory = tempfile::tempdir().unwrap();
        let themes = directory.path().join("themes");
        std::fs::create_dir_all(themes.join("tampered")).unwrap();
        std::fs::write(
            themes.join("tampered").join("theme.json"),
            r#"{"schemaVersion":1,"id":"tampered","name":"X","colors":{},"ambient":[]}"#,
        )
        .unwrap();

        assert!(installed(&themes).is_empty());
    }

    #[test]
    fn a_theme_id_cannot_pick_the_folder_it_is_removed_from() {
        let directory = tempfile::tempdir().unwrap();
        assert!(matches!(
            remove(directory.path(), "../.."),
            Err(Refusal::BadIdentifier(_))
        ));
    }

    /// The one that matters most. A theme is a file somebody was handed, and an
    /// entry naming its way out of the folder must not be joined to anything.
    #[test]
    fn a_theme_cannot_name_its_way_out_of_its_own_folder() {
        for escape in [
            "../../secrets.png",
            "..\\..\\secrets.png",
            "/etc/passwd",
            "C:\\Windows\\System32\\config.png",
            ".hidden.png",
        ] {
            assert!(
                matches!(asset_file_name(escape), Err(Refusal::UnsafePath(_))),
                "{escape} was accepted"
            );
        }
        // And a plain name still is one.
        assert_eq!(asset_file_name("logo.webp").unwrap(), "logo.webp");
    }

    /// An archive whose own entry names escape is refused before a single byte
    /// is read out of it.
    #[test]
    fn an_archive_with_an_escaping_entry_is_refused_unopened() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("escape.kizatheme");
        archive(&path, &[("theme.json", b"{}"), ("../outside.png", b"nope")]);
        assert!(matches!(read(&path), Err(Refusal::UnsafePath(_))));
    }

    #[test]
    fn a_colour_is_a_colour_and_not_a_stylesheet() {
        assert!(is_colour("242 30% 5%"));
        assert!(is_colour("0 0% 100%"));

        // Written straight into a custom property, so anything that could end
        // the declaration and start another is not a colour.
        assert!(!is_colour("red; } body { display: none"));
        assert!(!is_colour("242 30% 5%; --primary: 0 100% 50%"));
        assert!(!is_colour("url(https://example.test/x.png)"));
        assert!(!is_colour("242 30 5"));
        assert!(!is_colour("400 30% 5%"));
        assert!(!is_colour(""));
    }

    #[test]
    fn a_theme_must_say_what_every_colour_is() {
        let mut broken = manifest();
        broken.colors.remove("border");
        assert!(
            matches!(validate(&broken), Err(Refusal::MissingColour(token)) if token == "border")
        );

        let mut bad = manifest();
        bad.colors
            .insert("primary".to_string(), "not a colour".to_string());
        assert!(matches!(validate(&bad), Err(Refusal::BadColour { .. })));
    }

    #[test]
    fn a_theme_from_a_newer_kiza_says_so_instead_of_half_loading() {
        let mut future = manifest();
        future.schema_version = SCHEMA_VERSION + 1;
        let refusal = validate(&future).expect_err("a newer schema must be refused");
        assert!(matches!(refusal, Refusal::FromTheFuture { .. }));
        assert!(refusal.to_string().contains("Update Kiza"));

        let mut ancient = manifest();
        ancient.schema_version = 0;
        assert!(validate(&ancient).is_err());
    }

    #[test]
    fn a_theme_only_fills_slots_this_launcher_has() {
        let mut stranger = manifest();
        stranger
            .assets
            .insert("desktop-wallpaper".to_string(), "x.png".to_string());
        assert!(matches!(validate(&stranger), Err(Refusal::UnknownSlot(_))));
    }

    /// SVG is a document that can carry script and reach for remote files. A
    /// theme is design, and that is the line.
    #[test]
    fn only_picture_formats_a_theme_may_carry_are_accepted() {
        for good in ["logo.png", "logo.PNG", "a.jpg", "a.jpeg", "a.webp", "a.gif"] {
            assert!(mime_for(good).is_ok(), "{good}");
        }
        for bad in ["logo.svg", "logo.html", "theme.js", "logo", "logo.exe"] {
            assert!(
                matches!(mime_for(bad), Err(Refusal::UnsupportedFormat(_))),
                "{bad}"
            );
        }
        assert_eq!(mime_for("a.GIF").unwrap(), "image/gif");
    }

    /// Sizes are read from the archive's directory, so a theme that claims to
    /// unpack to something enormous is refused rather than attempted.
    #[test]
    fn a_theme_that_weighs_too_much_is_refused_before_it_is_unpacked() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("heavy.kizatheme");

        let mut heavy = manifest();
        heavy
            .assets
            .insert("logo".to_string(), "logo.png".to_string());
        let json = serde_json::to_vec(&heavy).unwrap();
        let oversized = vec![0u8; (MAX_ASSET_BYTES + 1) as usize];
        archive(
            &path,
            &[("theme.json", &json), ("assets/logo.png", &oversized)],
        );

        assert!(matches!(read(&path), Err(Refusal::AssetTooLarge { .. })));
    }

    #[test]
    fn an_archive_stuffed_with_entries_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("many.kizatheme");
        let names: Vec<String> = (0..MAX_ENTRIES + 1)
            .map(|n| format!("assets/{n}.png"))
            .collect();
        let entries: Vec<(&str, &[u8])> = names
            .iter()
            .map(|name| (name.as_str(), &b"x"[..]))
            .collect();
        archive(&path, &entries);

        assert!(matches!(read(&path), Err(Refusal::TooManyEntries(_))));
    }

    #[test]
    fn a_file_that_is_not_a_theme_says_so() {
        let directory = tempfile::tempdir().unwrap();

        let not_a_zip = directory.path().join("plain.kizatheme");
        std::fs::write(&not_a_zip, b"just some text").unwrap();
        assert!(matches!(read(&not_a_zip), Err(Refusal::NotAnArchive(_))));

        let no_manifest = directory.path().join("empty.kizatheme");
        archive(&no_manifest, &[("assets/logo.png", b"x")]);
        assert!(matches!(read(&no_manifest), Err(Refusal::NoManifest)));

        let absent = directory.path().join("absent.kizatheme");
        assert!(matches!(read(&absent), Err(Refusal::NotAnArchive(_))));
    }

    #[test]
    fn a_theme_naming_a_picture_it_does_not_carry_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing.kizatheme");

        let mut promises = manifest();
        promises
            .assets
            .insert("logo".to_string(), "logo.png".to_string());
        let json = serde_json::to_vec(&promises).unwrap();
        archive(&path, &[("theme.json", &json)]);

        assert!(matches!(read(&path), Err(Refusal::MissingAsset(_))));
    }

    #[test]
    fn a_theme_id_is_safe_as_a_file_name_and_as_an_attribute() {
        assert!(is_identifier("midnight"));
        assert!(is_identifier("deep-space-9"));

        for bad in [
            "",
            "Midnight",
            "mid night",
            "../x",
            "a/b",
            "x\"onload=",
            &"a".repeat(65),
        ] {
            assert!(!is_identifier(bad), "{bad}");
        }
    }

    /// The launcher and the interface must agree about what a valid theme is,
    /// or a theme accepted by one would be refused by the other.
    #[test]
    fn the_interface_knows_the_same_limits() {
        const FRONTEND: &str = include_str!("../../src/lib/theme/assets.ts");

        assert!(
            FRONTEND.contains(&format!(
                "maxBytes: {} * 1024 * 1024",
                MAX_ASSET_BYTES / 1024 / 1024
            )),
            "the interface disagrees about how big one picture may be"
        );
        assert!(
            FRONTEND.contains(&format!(
                "maxTotalBytes: {} * 1024 * 1024",
                MAX_TOTAL_ASSET_BYTES / 1024 / 1024
            )),
            "the interface disagrees about how big a theme may be"
        );
        assert!(
            FRONTEND.contains(&format!(
                "maxVideoBytes: {} * 1024 * 1024",
                MAX_VIDEO_BYTES / 1024 / 1024
            )),
            "the interface disagrees about how heavy a moving background may be"
        );
        for extension in ALLOWED_EXTENSIONS {
            // Every extension resolves through the same function the launcher
            // uses, so a format added on one side and forgotten on the other
            // fails here rather than at the moment somebody drops a file.
            let mime = mime_for(&format!("a.{extension}")).unwrap();
            assert!(
                FRONTEND.contains(mime),
                "the interface does not accept {mime}"
            );
        }
        // The slot rule is the same on both sides: only the background moves.
        assert!(FRONTEND.contains(&format!("MOTION_SLOT: AssetSlot = \"{MOTION_SLOT}\"")));
        // And neither of them accepts SVG.
        assert!(!FRONTEND.contains("image/svg"));
    }

    /// What a theme recommends has to survive being written out and read back,
    /// or a designer's choice quietly reverts the first time they reopen it.
    #[test]
    fn the_look_a_theme_asks_for_survives_a_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("flat.kizatheme");

        let mut wanted = manifest();
        wanted.effects = Some(ThemeEffects {
            translucency: Some(false),
            background_blur: Some(false),
        });
        write(&path, &wanted, &BTreeMap::new()).expect("write");

        let loaded = read(&path).expect("read");
        assert_eq!(loaded.manifest.effects, wanted.effects);
    }

    /// Saying nothing is not the same as asking for today's defaults: a theme
    /// with no opinion must stay that way, so a later Kiza is free to change
    /// what the defaults are.
    #[test]
    fn a_theme_with_no_opinion_does_not_gain_one() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("plain.kizatheme");
        write(&path, &manifest(), &BTreeMap::new()).expect("write");

        let loaded = read(&path).expect("read");
        assert_eq!(loaded.manifest.effects, None);

        let file = std::fs::File::open(&path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut json = String::new();
        std::io::Read::read_to_string(&mut archive.by_name(MANIFEST).unwrap(), &mut json).unwrap();
        assert!(
            !json.contains("effects"),
            "an absent opinion was written down"
        );
    }

    /// A picture a designer picks is copied where the window may read it, and
    /// picking a second one for the same slot replaces the first rather than
    /// leaving the folder full of everything they tried.
    #[test]
    fn a_picked_picture_is_brought_inside_and_replaces_the_last() {
        let directory = tempfile::tempdir().unwrap();
        let themes = directory.path().join("themes");
        let first = directory.path().join("one.png");
        let second = directory.path().join("two.webp");
        std::fs::write(&first, vec![1u8; 64]).unwrap();
        std::fs::write(&second, vec![2u8; 96]).unwrap();

        let staged = stage_asset(&themes, "logo", &first).expect("stage the first");
        assert_eq!(std::fs::read(&staged).unwrap().len(), 64);

        let staged = stage_asset(&themes, "logo", &second).expect("stage the second");
        assert_eq!(std::fs::read(&staged).unwrap().len(), 96);
        let left = std::fs::read_dir(themes.join(DRAFT_DIR).join("assets"))
            .unwrap()
            .count();
        assert_eq!(left, 1, "the picture that was replaced is still there");

        // And the folder it lives in is not mistaken for a theme.
        assert!(installed(&themes).is_empty());
    }

    /// Refused for the same reasons a theme's own picture is refused, and
    /// refused now rather than when somebody tries to save an evening's work.
    #[test]
    fn a_picked_file_that_is_not_a_picture_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let themes = directory.path().join("themes");
        let script = directory.path().join("nice.svg");
        std::fs::write(&script, b"<svg/>").unwrap();
        assert!(stage_asset(&themes, "logo", &script).is_err());

        let picture = directory.path().join("fine.png");
        std::fs::write(&picture, vec![0u8; 8]).unwrap();
        assert!(stage_asset(&themes, "wallpaper", &picture).is_err());

        let heavy = directory.path().join("heavy.png");
        std::fs::write(&heavy, vec![0u8; (MAX_ASSET_BYTES + 1) as usize]).unwrap();
        assert!(matches!(
            stage_asset(&themes, "background", &heavy),
            Err(Refusal::AssetTooLarge { .. })
        ));
    }

    /// The colours this file requires are the colours the interface paints with.
    #[test]
    fn the_interface_paints_with_the_same_colours() {
        const DEFINITION: &str = include_str!("../../src/lib/theme/definition.ts");
        for token in COLOR_TOKENS {
            assert!(
                DEFINITION.contains(&format!("\"{token}\"")),
                "the interface has no token {token}"
            );
        }
        for slot in ASSET_SLOTS {
            assert!(
                DEFINITION.contains(&format!("\"{slot}\"")),
                "the interface has no asset slot {slot}"
            );
        }
    }
}
