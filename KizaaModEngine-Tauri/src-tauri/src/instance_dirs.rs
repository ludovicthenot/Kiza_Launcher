//! Where each Minecraft instance lives on disk, and what its folder is called.
//!
//! An instance used to live in a folder named after its id, a UUID: right for
//! the launcher, meaningless to anyone opening `minecraft/instances`. Like
//! Prism, MultiMC and the Modrinth App, the folder now carries the instance's
//! own name -- `serv entre anglola`, `Kiza test` -- with a number when two
//! share one, `Kiza test (2)`.
//!
//! The id stays the instance's identity: profiles, backups, accounts and the
//! config file in `games/` are keyed by it, and none of them move. What ties
//! the id to its folder is the instance's `install_path`, `<folder>/game`,
//! which is written whenever the folder is. Everything that needs the folder
//! asks [`dir`] rather than joining the id onto the instances root.
//!
//! Renaming an instance renames its folder. Windows refuses to move a folder
//! a running game holds files in; then only the name changes, and the folder
//! follows at the next start of the launcher ([`migrate_all`]), which is also
//! what moves the UUID folders of instances made before this existed.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// The longest folder name made from an instance's name, in characters.
const MAX_NAME: usize = 40;
const FALLBACK_NAME: &str = "Instance";

pub fn root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("minecraft").join("instances")
}

fn cache() -> &'static Mutex<HashMap<String, PathBuf>> {
    static CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The folder of instance `instance_id`: the parent of its `install_path`
/// when that lies in the instances root, else the folder named after its id,
/// which is where instances lived before.
pub fn dir(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    if let Some(found) = cache().lock().ok().and_then(|cache| cache.get(instance_id).cloned()) {
        return found;
    }
    match from_config(app_data_dir, instance_id) {
        Some(resolved) => {
            // Only what a config said is kept: the fallback for an instance
            // whose config is not written yet must not outlive that.
            if let Ok(mut cache) = cache().lock() {
                cache.insert(instance_id.to_string(), resolved.clone());
            }
            resolved
        }
        None => root(app_data_dir).join(instance_id),
    }
}

/// Forgets where an instance was, after its folder moved or it was deleted.
pub fn forget(instance_id: &str) {
    if let Ok(mut cache) = cache().lock() {
        cache.remove(instance_id);
    }
}

fn config_path(app_data_dir: &Path, instance_id: &str) -> Option<PathBuf> {
    // An id is letters, digits and dashes: never a path of its own.
    if instance_id.is_empty() || !instance_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(app_data_dir.join("games").join(format!("{instance_id}.json")))
}

fn from_config(app_data_dir: &Path, instance_id: &str) -> Option<PathBuf> {
    let text = fs::read_to_string(config_path(app_data_dir, instance_id)?).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let install = PathBuf::from(value.get("install_path")?.as_str()?);
    let folder = install.parent()?;
    let instances = root(app_data_dir);
    let inside = folder.parent().is_some_and(|parent| same_path(parent, &instances));
    if !inside {
        return None;
    }
    Some(instances.join(folder.file_name()?))
}

fn same_path(a: &Path, b: &Path) -> bool {
    let normal = |path: &Path| path.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    normal(a) == normal(b)
}

/// A folder name from an instance's name.
///
/// What Windows forbids in a name goes, as does `!`, which Java reads as the
/// end of a jar path and which made the Modrinth App's instances crash.
/// Accents are folded -- `é` to `e` -- since some old Minecraft versions load
/// their natives badly from a path with other letters; a name left with no
/// letter at all becomes `Instance`.
pub fn folder_name(display_name: &str) -> String {
    let mut name = String::new();
    for original in display_name.chars() {
        let mut single = [0u8; 4];
        let folded: &str = match fold(original) {
            Some(folded) => folded,
            None => original.encode_utf8(&mut single),
        };
        for c in folded.chars() {
            let kept = match c {
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '!' => ' ',
                c if c.is_control() => ' ',
                c if c.is_ascii() => c,
                _ => ' ',
            };
            if kept == ' ' && (name.is_empty() || name.ends_with(' ')) {
                continue;
            }
            name.push(kept);
        }
    }
    let mut name: String = name.chars().take(MAX_NAME).collect();
    // Windows drops a name's trailing dots and spaces, and then cannot find it.
    while name.ends_with('.') || name.ends_with(' ') {
        name.pop();
    }
    if !name.chars().any(|c| c.is_ascii_alphanumeric()) {
        return FALLBACK_NAME.to_string();
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        name.push('_');
    }
    name
}

/// A Latin letter with an accent, without it; None for anything else.
fn fold(c: char) -> Option<&'static str> {
    Some(match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => "a",
        'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' | 'Ā' => "A",
        'æ' => "ae",
        'Æ' => "AE",
        'ç' | 'ć' | 'č' => "c",
        'Ç' | 'Ć' | 'Č' => "C",
        'đ' | 'ď' => "d",
        'Đ' | 'Ď' => "D",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => "e",
        'È' | 'É' | 'Ê' | 'Ë' | 'Ē' | 'Ę' | 'Ě' => "E",
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'ı' => "i",
        'Ì' | 'Í' | 'Î' | 'Ï' | 'Ī' | 'İ' => "I",
        'ł' => "l",
        'Ł' => "L",
        'ñ' | 'ń' | 'ň' => "n",
        'Ñ' | 'Ń' | 'Ň' => "N",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => "o",
        'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ø' | 'Ō' | 'Ő' => "O",
        'œ' => "oe",
        'Œ' => "OE",
        'ř' => "r",
        'Ř' => "R",
        'ś' | 'š' | 'ş' => "s",
        'Ś' | 'Š' | 'Ş' => "S",
        'ß' => "ss",
        'ť' | 'ţ' => "t",
        'Ť' | 'Ţ' => "T",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => "u",
        'Ù' | 'Ú' | 'Û' | 'Ü' | 'Ū' | 'Ů' | 'Ű' => "U",
        'ý' | 'ÿ' => "y",
        'Ý' | 'Ÿ' => "Y",
        'ź' | 'ż' | 'ž' => "z",
        'Ź' | 'Ż' | 'Ž' => "Z",
        _ => return None,
    })
}

/// `base`, or `base (2)`, `base (3)`... -- the first not taken in `root`.
/// `current`, the folder being renamed, does not count as taken: renaming
/// `Kiza test` to `Kiza Test` is allowed to keep its own place.
fn free_name(root: &Path, base: &str, current: Option<&Path>) -> String {
    let taken = |name: &str| {
        let candidate = root.join(name);
        let mine = current.is_some_and(|current| same_path(current, &candidate));
        !mine && candidate.exists()
    };
    if !taken(base) {
        return base.to_string();
    }
    (2..)
        .map(|number| format!("{base} ({number})"))
        .find(|name| !taken(name))
        .unwrap_or_else(|| base.to_string())
}

/// The folder a new instance called `display_name` gets, made.
pub fn create(app_data_dir: &Path, display_name: &str) -> Result<PathBuf, String> {
    let instances = root(app_data_dir);
    fs::create_dir_all(&instances).map_err(|error| error.to_string())?;
    let folder = instances.join(free_name(&instances, &folder_name(display_name), None));
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    Ok(folder)
}

/// Moves an instance's folder to the name `display_name` asks for, and
/// rewrites its `install_path` in `config`, a parsed config file. Answers the
/// new folder, or None when there was nothing to do or the folder could not
/// move -- a game holding files in it -- in which case nothing changed.
fn move_folder(app_data_dir: &Path, instance_id: &str, display_name: &str, config: &mut serde_json::Value) -> Option<PathBuf> {
    let instances = root(app_data_dir);
    let current = dir(app_data_dir, instance_id);
    if !current.is_dir() {
        return None;
    }
    let wanted = instances.join(free_name(&instances, &folder_name(display_name), Some(&current)));
    if wanted.file_name() == current.file_name() {
        return None;
    }
    let moved = if wanted.to_string_lossy().eq_ignore_ascii_case(&current.to_string_lossy()) {
        // Only the case changes: Windows will not rename a folder onto
        // itself, so it goes through a name of its own on the way.
        let between = instances.join(format!("{}.renaming", instance_id));
        fs::rename(&current, &between).and_then(|()| fs::rename(&between, &wanted))
    } else {
        fs::rename(&current, &wanted)
    };
    if let Err(error) = moved {
        crate::log_info!(
            "Instances",
            "The folder of {display_name} stays {} for now: {error}",
            current.display()
        );
        return None;
    }
    let install = wanted.join("game");
    if let Some(object) = config.as_object_mut() {
        object.insert("install_path".to_string(), serde_json::Value::String(install.to_string_lossy().to_string()));
    }
    forget(instance_id);
    Some(wanted)
}

/// Renames an instance's folder after its name: the config file in `games/`
/// is rewritten with the new `install_path` when the folder moved.
pub fn follow_name(app_data_dir: &Path, instance_id: &str) -> Result<Option<PathBuf>, String> {
    let Some(path) = config_path(app_data_dir, instance_id) else {
        return Ok(None);
    };
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut config: serde_json::Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    if config.get("game_id").and_then(|value| value.as_str()) != Some("minecraft") {
        return Ok(None);
    }
    let Some(name) = config.get("display_name").and_then(|value| value.as_str()).map(str::to_string) else {
        return Ok(None);
    };
    let Some(moved) = move_folder(app_data_dir, instance_id, &name, &mut config) else {
        return Ok(None);
    };
    let written = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, written).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    Ok(Some(moved))
}

/// At start-up: every instance's folder after its name. Moves the UUID
/// folders of instances made before folders had names, and finishes renames
/// a running game held back. One that cannot move now is left as it is.
pub fn migrate_all(app_data_dir: &Path) {
    let Ok(entries) = fs::read_dir(app_data_dir.join("games")) else {
        return;
    };
    let mut moved = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|stem| stem.to_str()).map(str::to_string) else {
            continue;
        };
        match follow_name(app_data_dir, &id) {
            Ok(Some(_)) => moved += 1,
            Ok(None) => {}
            Err(error) => crate::log_warn!("Instances", "Instance {id} keeps its folder: {error}"),
        }
    }
    if moved > 0 {
        crate::log_info!("Instances", "{moved} instance folder(s) now named after their instance.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_instance(app: &Path, id: &str, name: &str, folder: &Path) {
        fs::create_dir_all(folder.join("game")).unwrap();
        fs::create_dir_all(app.join("games")).unwrap();
        let config = serde_json::json!({
            "schema_version": 1,
            "id": id,
            "game_id": "minecraft",
            "display_name": name,
            "install_path": folder.join("game").to_string_lossy(),
            "mods_path": app.join("mods").join(id).to_string_lossy(),
            "unknown_field_kept": 7
        });
        fs::write(app.join("games").join(format!("{id}.json")), serde_json::to_string(&config).unwrap()).unwrap();
        forget(id);
    }

    #[test]
    fn names_are_readable_and_safe() {
        assert_eq!(folder_name("serv entre anglola"), "serv entre anglola");
        assert_eq!(folder_name("Kiza test"), "Kiza test");
        assert_eq!(folder_name("Été: créatif!"), "Ete creatif");
        assert_eq!(folder_name("a/b\\c|d?e*"), "a b c d e");
        assert_eq!(folder_name("Сервер"), "Instance");
        assert_eq!(folder_name("   "), "Instance");
        assert_eq!(folder_name("nul"), "nul_");
        assert_eq!(folder_name("COM1"), "COM1_");
        assert_eq!(folder_name("trailing dots..."), "trailing dots");
        assert_eq!(folder_name(&"x".repeat(80)).len(), MAX_NAME);
    }

    #[test]
    fn a_uuid_folder_takes_the_instance_name_and_keeps_everything() {
        let temp = tempfile::tempdir().unwrap();
        let app = temp.path();
        let id = "0d872df4-5ca0-4215-933c-bfd9b2e71a0c";
        let old = root(app).join(id);
        write_instance(app, id, "Kiza test", &old);
        fs::write(old.join("game").join("options.txt"), "lang:fr_fr").unwrap();

        migrate_all(app);

        let new = root(app).join("Kiza test");
        assert!(!old.exists());
        assert_eq!(fs::read_to_string(new.join("game").join("options.txt")).unwrap(), "lang:fr_fr");
        assert_eq!(dir(app, id), new);
        let config: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(app.join("games").join(format!("{id}.json"))).unwrap()).unwrap();
        assert_eq!(config["install_path"].as_str().unwrap(), new.join("game").to_string_lossy());
        assert_eq!(config["unknown_field_kept"], 7);
        // A second start finds nothing to do.
        migrate_all(app);
        assert_eq!(dir(app, id), new);
    }

    #[test]
    fn two_instances_of_one_name_are_numbered() {
        let temp = tempfile::tempdir().unwrap();
        let app = temp.path();
        let first = "11111111-1111-1111-1111-111111111111";
        let second = "22222222-2222-2222-2222-222222222222";
        write_instance(app, first, "Survie", &root(app).join(first));
        write_instance(app, second, "Survie", &root(app).join(second));

        migrate_all(app);

        let mut names: Vec<String> = [first, second]
            .iter()
            .map(|id| dir(app, id).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["Survie".to_string(), "Survie (2)".to_string()]);
    }

    #[test]
    fn a_rename_moves_the_folder_and_a_case_change_is_allowed() {
        let temp = tempfile::tempdir().unwrap();
        let app = temp.path();
        let id = "33333333-3333-3333-3333-333333333333";
        write_instance(app, id, "kiza test", &root(app).join("kiza test"));

        let config_file = app.join("games").join(format!("{id}.json"));
        let mut config: serde_json::Value = serde_json::from_str(&fs::read_to_string(&config_file).unwrap()).unwrap();
        config["display_name"] = serde_json::Value::String("Kiza Test".to_string());
        fs::write(&config_file, serde_json::to_string(&config).unwrap()).unwrap();
        follow_name(app, id).unwrap();
        assert_eq!(dir(app, id).file_name().unwrap(), "Kiza Test");

        config["display_name"] = serde_json::Value::String("Kiza Survie".to_string());
        config["install_path"] = serde_json::Value::String(root(app).join("Kiza Test").join("game").to_string_lossy().to_string());
        fs::write(&config_file, serde_json::to_string(&config).unwrap()).unwrap();
        follow_name(app, id).unwrap();
        assert_eq!(dir(app, id), root(app).join("Kiza Survie"));
        assert!(root(app).join("Kiza Survie").join("game").is_dir());
    }

    #[test]
    fn a_new_instance_gets_a_free_named_folder() {
        let temp = tempfile::tempdir().unwrap();
        let app = temp.path();
        fs::create_dir_all(root(app).join("Survie")).unwrap();
        assert_eq!(create(app, "Survie").unwrap(), root(app).join("Survie (2)"));
    }
}
