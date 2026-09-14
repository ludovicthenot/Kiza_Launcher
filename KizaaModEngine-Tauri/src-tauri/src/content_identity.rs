//! Who a shader pack or resource pack is, beyond its file name.
//!
//! A mod is installed from a catalogue and keeps the record; a pack is a
//! zip somebody dropped in a folder, and all the launcher knew about it was
//! its name and its size. This reads what the file itself says — the
//! description and the picture a resource pack carries in `pack.mcmeta` and
//! `pack.png` — and asks Modrinth, by the file's hash, which project it is:
//! title, author, description, icon, gallery, version.
//!
//! Hashes and answers are kept in one cache beside the launcher's data, so
//! a folder is hashed once per file and Modrinth is asked once per hash. A
//! file Modrinth does not know is remembered as unknown for a day, then
//! asked about again.

use crate::content_manager::ContentKind;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The largest `pack.png` embedded as a data URL. Past this the picture
/// stays on disk and the Modrinth icon, when there is one, stands in.
const MAX_ICON_BYTES: u64 = 512 * 1024;
const UNKNOWN_RETRY_SECS: u64 = 24 * 60 * 60;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ContentIdentity {
    pub file_name: String,
    pub size: u64,
    pub sha1: Option<String>,
    /// The catalogue's title, else the file's own description, else nothing.
    pub title: Option<String>,
    pub description: Option<String>,
    /// A URL from the catalogue, or a `data:` URL of the pack's own picture.
    pub icon: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub published: Option<String>,
    pub updated: Option<String>,
    pub downloads: Option<u64>,
    pub source: Option<String>,
    pub project_id: Option<String>,
    pub project_url: Option<String>,
    #[serde(default)]
    pub gallery: Vec<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    /// From `pack.mcmeta`: which Minecraft generation the pack was made for.
    pub pack_format: Option<u32>,
    /// What the pack says about itself, as opposed to what the catalogue says.
    pub local_description: Option<String>,
}

/// What the catalogue said about one hash, kept.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct Known {
    title: String,
    description: String,
    icon_url: Option<String>,
    author: String,
    version: String,
    published: String,
    updated: String,
    downloads: u64,
    project_id: String,
    project_url: String,
    gallery: Vec<String>,
    categories: Vec<String>,
    game_versions: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Cache {
    /// `path|size|mtime` → sha1, so a file is hashed once.
    #[serde(default)]
    hashes: BTreeMap<String, String>,
    /// sha1 → what Modrinth answered.
    #[serde(default)]
    known: BTreeMap<String, Known>,
    /// sha1 → when Modrinth last said it did not know the file.
    #[serde(default)]
    unknown: BTreeMap<String, u64>,
}

fn cache_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("minecraft").join("content-identity.json")
}

fn load_cache(app_data_dir: &Path) -> Cache {
    fs::read_to_string(cache_path(app_data_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_cache(app_data_dir: &Path, cache: &Cache) {
    let path = cache_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(cache) {
        let temp = path.with_extension("json.tmp");
        if fs::write(&temp, text).is_ok() {
            let _ = fs::rename(&temp, &path);
        }
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn file_key(path: &Path, meta: &fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}|{}|{}", path.to_string_lossy(), meta.len(), mtime)
}

fn sha1_of(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

/// What a pack says about itself: `pack.mcmeta` and `pack.png`, from a zip
/// or an unpacked folder.
#[derive(Default)]
struct PackSelf {
    description: Option<String>,
    pack_format: Option<u32>,
    icon: Option<String>,
}

fn read_pack_self(path: &Path) -> PackSelf {
    let mut out = PackSelf::default();
    let (mcmeta, png) = if path.is_dir() {
        (
            fs::read(path.join("pack.mcmeta")).ok(),
            fs::metadata(path.join("pack.png"))
                .ok()
                .filter(|m| m.len() <= MAX_ICON_BYTES)
                .and_then(|_| fs::read(path.join("pack.png")).ok()),
        )
    } else {
        read_from_zip(path)
    };
    if let Some(bytes) = mcmeta {
        if let Ok(meta) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            let pack = &meta["pack"];
            out.pack_format = pack["pack_format"].as_u64().map(|n| n as u32);
            out.description = mcmeta_text(&pack["description"]);
        }
    }
    if let Some(bytes) = png {
        out.icon = Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    }
    out
}

/// `pack.mcmeta` and `pack.png` at the root of the zip — or one folder down,
/// which is how a pack zipped from its parent folder arrives.
fn read_from_zip(path: &Path) -> (Option<Vec<u8>>, Option<Vec<u8>>) {
    let Ok(file) = fs::File::open(path) else {
        return (None, None);
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return (None, None);
    };
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().to_string()))
        .collect();
    let find = |wanted: &str| -> Option<String> {
        names
            .iter()
            .find(|n| n.as_str() == wanted)
            .or_else(|| {
                names
                    .iter()
                    .find(|n| n.ends_with(&format!("/{wanted}")) && n.matches('/').count() == 1)
            })
            .cloned()
    };
    let read = |archive: &mut zip::ZipArchive<fs::File>, name: Option<String>, cap: u64| {
        let name = name?;
        let mut entry = archive.by_name(&name).ok()?;
        if entry.size() > cap {
            return None;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).ok()?;
        Some(bytes)
    };
    let mcmeta = read(&mut archive, find("pack.mcmeta"), 64 * 1024);
    let png = read(&mut archive, find("pack.png"), MAX_ICON_BYTES);
    (mcmeta, png)
}

/// A pack description is a string, or a text component, or a list of them;
/// this reads the words out and drops the formatting codes.
fn mcmeta_text(value: &serde_json::Value) -> Option<String> {
    fn walk(value: &serde_json::Value, out: &mut String) {
        match value {
            serde_json::Value::String(s) => out.push_str(s),
            serde_json::Value::Array(items) => items.iter().for_each(|item| walk(item, out)),
            serde_json::Value::Object(map) => {
                if let Some(text) = map.get("text") {
                    walk(text, out);
                }
                if let Some(extra) = map.get("extra") {
                    walk(extra, out);
                }
            }
            _ => {}
        }
    }
    let mut text = String::new();
    walk(value, &mut text);
    let text = strip_formatting(&text).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// `§a`, `§l`, `§r`…: Minecraft's colour and style codes, gone.
pub fn strip_formatting(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out
}

fn project_type(kind: ContentKind) -> &'static str {
    match kind {
        ContentKind::Shader => "shader",
        ContentKind::Resourcepack => "resourcepack",
        ContentKind::Datapack => "datapack",
        ContentKind::Modpack => "modpack",
    }
}

/// Every pack in the folder, identified. Local reading and hashing happen
/// here; the caller awaits the catalogue.
pub struct Local {
    pub identities: Vec<ContentIdentity>,
    pub cache: Cache,
    /// Hashes the cache has no fresh answer for.
    pub to_ask: Vec<String>,
}

pub fn read_local(app_data_dir: &Path, dir: &Path) -> Local {
    let mut cache = load_cache(app_data_dir);
    let mut identities = Vec::new();
    let mut to_ask = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return Local {
            identities,
            cache,
            to_ask,
        };
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    for path in paths {
        let Ok(meta) = fs::metadata(&path) else { continue };
        let is_zip = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"));
        if !(is_zip || meta.is_dir()) {
            continue;
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let sha1 = if meta.is_file() {
            let key = file_key(&path, &meta);
            match cache.hashes.get(&key) {
                Some(hash) => Some(hash.clone()),
                None => {
                    let hash = sha1_of(&path);
                    if let Some(hash) = &hash {
                        cache.hashes.insert(key, hash.clone());
                    }
                    hash
                }
            }
        } else {
            None
        };
        let own = read_pack_self(&path);
        let mut identity = ContentIdentity {
            file_name,
            size: meta.len(),
            sha1: sha1.clone(),
            icon: own.icon,
            pack_format: own.pack_format,
            local_description: own.description.clone(),
            description: own.description,
            ..Default::default()
        };
        if let Some(hash) = &sha1 {
            if let Some(known) = cache.known.get(hash) {
                apply_known(&mut identity, known);
            } else {
                let stale = cache
                    .unknown
                    .get(hash)
                    .is_none_or(|asked| now().saturating_sub(*asked) > UNKNOWN_RETRY_SECS);
                if stale {
                    to_ask.push(hash.clone());
                }
            }
        }
        identities.push(identity);
    }
    Local {
        identities,
        cache,
        to_ask,
    }
}

fn apply_known(identity: &mut ContentIdentity, known: &Known) {
    identity.title = Some(known.title.clone());
    if !known.description.is_empty() {
        identity.description = Some(known.description.clone());
    }
    if known.icon_url.is_some() {
        identity.icon = known.icon_url.clone();
    }
    identity.author = Some(known.author.clone());
    identity.version = Some(known.version.clone());
    identity.published = Some(known.published.clone());
    identity.updated = Some(known.updated.clone());
    identity.downloads = Some(known.downloads);
    identity.source = Some("modrinth".to_string());
    identity.project_id = Some(known.project_id.clone());
    identity.project_url = Some(known.project_url.clone());
    identity.gallery = known.gallery.clone();
    identity.categories = known.categories.clone();
    identity.game_versions = known.game_versions.clone();
}

/// Asks Modrinth about the hashes the cache could not answer, and fills
/// the identities in. Quiet on a network failure: the packs are still
/// listed with what the files themselves said.
pub async fn ask_catalogue(app_data_dir: &Path, kind: ContentKind, mut local: Local) -> Vec<ContentIdentity> {
    if local.to_ask.is_empty() {
        save_cache(app_data_dir, &local.cache);
        return local.identities;
    }
    let versions = crate::modrinth_api::versions_from_sha1s(&local.to_ask)
        .await
        .unwrap_or_default();
    let ids: Vec<String> = versions
        .values()
        .map(|v| v.project_id.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let hits: HashMap<String, crate::modrinth_api::ModrinthProjectHit> =
        crate::modrinth_api::projects_by_ids(project_type(kind), &ids)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|hit| (hit.project_id.clone(), hit))
            .collect();

    let asked_at = now();
    for hash in &local.to_ask {
        match versions.get(hash).and_then(|v| hits.get(&v.project_id).map(|h| (v, h))) {
            Some((version, hit)) => {
                let known = Known {
                    title: hit.title.clone(),
                    description: hit.description.clone(),
                    icon_url: hit.icon_url.clone(),
                    author: hit.author.clone(),
                    version: version.version_number.clone(),
                    published: version.date_published.clone(),
                    updated: hit.date_modified.clone(),
                    downloads: hit.downloads,
                    project_id: hit.project_id.clone(),
                    project_url: format!(
                        "https://modrinth.com/{}/{}",
                        project_type(kind),
                        hit.slug.clone().unwrap_or_else(|| hit.project_id.clone())
                    ),
                    gallery: hit.gallery.clone(),
                    categories: hit.categories.clone(),
                    game_versions: version.game_versions.clone(),
                };
                local.cache.unknown.remove(hash);
                local.cache.known.insert(hash.clone(), known);
            }
            None => {
                local.cache.unknown.insert(hash.clone(), asked_at);
            }
        }
    }
    for identity in &mut local.identities {
        if let Some(known) = identity.sha1.as_ref().and_then(|h| local.cache.known.get(h)) {
            apply_known(identity, known);
        }
    }
    save_cache(app_data_dir, &local.cache);
    local.identities
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pack_description_loses_its_colour_codes() {
        assert_eq!(strip_formatting("§r§lAstra§4§lLex"), "AstraLex");
        assert_eq!(strip_formatting("plain"), "plain");
        assert_eq!(
            mcmeta_text(&serde_json::json!("§aBetter Leaves §7v9.5")).as_deref(),
            Some("Better Leaves v9.5")
        );
        assert_eq!(
            mcmeta_text(&serde_json::json!([{"text": "Hello ", "color": "red"}, {"text": "world"}])).as_deref(),
            Some("Hello world")
        );
        assert_eq!(mcmeta_text(&serde_json::json!({"text": "  "})), None);
    }

    #[test]
    fn a_zipped_pack_reveals_its_own_words_and_picture() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("pack.zip");
        {
            let file = fs::File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            use std::io::Write;
            writer.start_file("pack.mcmeta", options).unwrap();
            writer
                .write_all(r#"{"pack": {"pack_format": 34, "description": "§bNicer leaves"}}"#.as_bytes())
                .unwrap();
            writer.start_file("pack.png", options).unwrap();
            writer.write_all(&[137, 80, 78, 71, 1, 2, 3]).unwrap();
            writer.finish().unwrap();
        }
        let own = read_pack_self(&zip_path);
        assert_eq!(own.pack_format, Some(34));
        assert_eq!(own.description.as_deref(), Some("Nicer leaves"));
        assert!(own.icon.unwrap().starts_with("data:image/png;base64,"));

        // The same pack zipped with its folder: one level down still counts.
        let nested = dir.path().join("nested.zip");
        {
            let file = fs::File::create(&nested).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            use std::io::Write;
            writer.start_file("Pack/pack.mcmeta", options).unwrap();
            writer.write_all(br#"{"pack": {"pack_format": 15, "description": "Deep"}}"#).unwrap();
            writer.finish().unwrap();
        }
        assert_eq!(read_pack_self(&nested).pack_format, Some(15));
    }

    #[test]
    fn a_folder_is_hashed_once_and_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let packs = dir.path().join("packs");
        fs::create_dir_all(&packs).unwrap();
        fs::write(packs.join("a.zip"), b"not really a zip").unwrap();
        fs::write(packs.join("notes.txt"), b"ignored").unwrap();

        let local = read_local(&data, &packs);
        assert_eq!(local.identities.len(), 1);
        assert_eq!(local.identities[0].file_name, "a.zip");
        let hash = local.identities[0].sha1.clone().unwrap();
        assert_eq!(local.to_ask, vec![hash.clone()]);
        save_cache(&data, &local.cache);

        let again = read_local(&data, &packs);
        assert_eq!(again.cache.hashes.len(), 1);
        assert_eq!(again.identities[0].sha1.as_deref(), Some(hash.as_str()));
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// Asks Modrinth about a real folder. Run by hand:
    /// `KIZA_PACKS_DIR=... cargo test content_identity::live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn identifies_a_real_folder() {
        let Ok(dir) = std::env::var("KIZA_PACKS_DIR") else { return };
        let data = tempfile::tempdir().unwrap();
        let kind = if dir.contains("shader") { ContentKind::Shader } else { ContentKind::Resourcepack };
        let local = read_local(data.path(), Path::new(&dir));
        let found = ask_catalogue(data.path(), kind, local).await;
        for item in &found {
            println!(
                "{:<50} title={:?} author={:?} version={:?} icon={} gallery={} desc={:?}",
                item.file_name,
                item.title,
                item.author,
                item.version,
                item.icon.as_ref().map(|i| if i.starts_with("data:") { "pack.png" } else { "modrinth" }).unwrap_or("none"),
                item.gallery.len(),
                item.description.as_ref().map(|d| d.chars().take(40).collect::<String>())
            );
        }
        assert!(!found.is_empty());
    }
}
