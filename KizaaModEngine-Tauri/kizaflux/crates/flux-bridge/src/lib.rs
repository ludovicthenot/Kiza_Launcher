//! Flux Bridge, its content half: a Java mod's blocks, items, recipes, loot
//! and world generation carried over to Kizaflux.
//!
//! The carry-over is Horizon's own (`horizon-port-pack`, at the tag of the
//! release Kiza installs), the same one Horizon's launcher runs: Kizaflux
//! does not write a second one. It reads the jar's files and its classes'
//! constant pools, never runs them, and writes a content mod (API 0.2) that
//! the game loads from `horizon-mods/<mod id>/`. Its verdict comes from that
//! carry, not from the jar's metadata:
//!
//! - `Works`: everything the mod adds came across;
//! - `Partly`: its content came across, and `skipped` says what did not (its
//!   machines, Mixins, custom block behaviour: what Java code does);
//! - `No`: nothing would (code only, or made for Minecraft 1.20 or older).
//!
//! Java code never runs, whatever the verdict.

use std::fs;
use std::path::{Path, PathBuf};

pub use horizon_port_pack::check::{Check, Verdict};

/// Where checks are kept, one folder per jar by its SHA-1: `check.json`
/// and, when something ports, the carried-over mod in `carry/`.
pub fn checked_dir(checks: &Path, sha1: &str) -> PathBuf {
    checks.join(sha1)
}

/// The check of a jar made before, if any.
pub fn cached(checks: &Path, sha1: &str) -> Option<Check> {
    let text = fs::read_to_string(checked_dir(checks, sha1).join("check.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Checks `jar` (whose SHA-1 is `sha1`): the cached answer, else the jar
/// carried over into a fresh folder, moved into place once complete.
pub fn check(jar: &Path, sha1: &str, checks: &Path) -> Result<Check, String> {
    if let Some(check) = cached(checks, sha1) {
        return Ok(check);
    }
    let dir = checked_dir(checks, sha1);
    let part = dir.with_extension("part");
    let _ = fs::remove_dir_all(&part);
    let check = horizon_port_pack::check::check(jar, &part).inspect_err(|_| {
        let _ = fs::remove_dir_all(&part);
    })?;
    if check.verdict == Verdict::No {
        // Nothing to install: keep the answer, not the files.
        for leftover in ["carry", "outside"] {
            let _ = fs::remove_dir_all(part.join(leftover));
        }
    }
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&part, &dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(check)
}

/// The game's mod folder and on-list, beside `options.txt`.
pub const MODS_DIR: &str = "horizon-mods";
pub const MODS_LIST: &str = "horizon-mods.txt";

/// Installs a checked mod into `game_dir`: its carry copied to
/// `horizon-mods/<mod id>/` (replacing an older copy of the same mod) and
/// turned on. Refused when it would share a namespace with another
/// installed mod, which the game does not allow.
pub fn install(
    game_dir: &Path,
    checks: &Path,
    sha1: &str,
    check: &Check,
) -> Result<PathBuf, String> {
    if check.verdict == Verdict::No {
        return Err(format!(
            "{}: nothing of it ports ({})",
            check.name, check.summary
        ));
    }
    if !is_plain_id(&check.mod_id) {
        return Err(format!(
            "{:?} is not a mod id Kizaflux installs.",
            check.mod_id
        ));
    }
    let carry = checked_dir(checks, sha1).join("carry");
    if !carry.is_dir() {
        return Err(format!(
            "{}: its carry-over is missing; check it again.",
            check.name
        ));
    }
    let mods = game_dir.join(MODS_DIR);
    for (other, namespaces) in installed_namespaces(&mods) {
        if other == check.mod_id {
            continue;
        }
        if let Some(shared) = check.namespaces.iter().find(|n| namespaces.contains(n)) {
            return Err(format!(
                "{} shares the namespace {shared} with {other}, installed already: remove one first.",
                check.name
            ));
        }
    }
    let target = mods.join(&check.mod_id);
    let part = mods.join(format!(".{}.part", check.mod_id));
    let _ = fs::remove_dir_all(&part);
    copy_dir(&carry, &part).inspect_err(|_| {
        let _ = fs::remove_dir_all(&part);
    })?;
    let _ = fs::remove_dir_all(&target);
    fs::rename(&part, &target).map_err(|e| format!("{}: {e}", target.display()))?;
    set_enabled(game_dir, &check.mod_id, true)?;
    Ok(target)
}

/// Removes a carried-over mod and its line in the on-list.
pub fn remove(game_dir: &Path, mod_id: &str) -> Result<(), String> {
    if !is_plain_id(mod_id) {
        return Err(format!("{mod_id:?} is not a mod id."));
    }
    let dir = game_dir.join(MODS_DIR).join(mod_id);
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    set_enabled(game_dir, mod_id, false)
}

/// Whether mod `id` is on in `horizon-mods.txt`.
pub fn is_enabled(game_dir: &Path, id: &str) -> bool {
    let key = format!("mod.{id}");
    fs::read_to_string(game_dir.join(MODS_LIST))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once(':'))
        .any(|(k, v)| k.trim() == key && v.trim() == "true")
}

/// Turns mod `id` on or off as the game's own Options > Mods does: on is a
/// `mod.<id>:true` line, off is no line. Every other line is kept.
pub fn set_enabled(game_dir: &Path, id: &str, on: bool) -> Result<(), String> {
    if !is_plain_id(id) {
        return Err(format!("{id:?} is not a mod id."));
    }
    let path = game_dir.join(MODS_LIST);
    let text = fs::read_to_string(&path).unwrap_or_default();
    let key = format!("mod.{id}");
    let mut lines: Vec<String> = text
        .lines()
        .filter(|l| l.split_once(':').is_none_or(|(k, _)| k.trim() != key))
        .map(str::to_owned)
        .collect();
    if on {
        lines.push(format!("{key}:true"));
    }
    let mut out = lines.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    fs::write(&path, out).map_err(|e| format!("{}: {e}", path.display()))
}

/// A Horizon mod id: `[a-z0-9_]{1,64}`, so it is also a safe folder name.
fn is_plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// Each folder mod's namespaces: its folders under `assets/` and `data/`,
/// the shared ones (`minecraft`, `c`) left out.
fn installed_namespaces(mods: &Path) -> Vec<(String, Vec<String>)> {
    let Ok(entries) = fs::read_dir(mods) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| {
            let mut namespaces: Vec<String> = ["assets", "data"]
                .iter()
                .flat_map(|root| {
                    fs::read_dir(e.path().join(root))
                        .into_iter()
                        .flatten()
                        .flatten()
                })
                .filter(|n| n.path().is_dir())
                .map(|n| n.file_name().to_string_lossy().into_owned())
                .filter(|n| n != "minecraft" && n != "c")
                .collect();
            namespaces.sort();
            namespaces.dedup();
            (e.file_name().to_string_lossy().into_owned(), namespaces)
        })
        .collect()
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("{}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("{}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if kind.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            fs::copy(&src, &dst).map_err(|e| format!("{}: {e}", dst.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_on_list_is_the_games() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(MODS_LIST), "key.zoom.zoom:key.keyboard.c\n").unwrap();
        set_enabled(dir.path(), "zoom", true).unwrap();
        assert!(is_enabled(dir.path(), "zoom"));
        set_enabled(dir.path(), "zoom", false).unwrap();
        assert!(!is_enabled(dir.path(), "zoom"));
        // Off is no line, as the game writes it; the key binding stays.
        assert_eq!(
            fs::read_to_string(dir.path().join(MODS_LIST)).unwrap(),
            "key.zoom.zoom:key.keyboard.c\n"
        );
        assert!(set_enabled(dir.path(), "../evil", true).is_err());
        assert!(remove(dir.path(), "a/b").is_err());
    }

    #[test]
    fn two_mods_never_share_a_namespace() {
        let game = tempfile::tempdir().unwrap();
        fs::create_dir_all(game.path().join("horizon-mods/gems/assets/gems")).unwrap();
        let checks = tempfile::tempdir().unwrap();
        fs::create_dir_all(checks.path().join("abc/carry/assets/ruby")).unwrap();
        let mut check: Check = serde_json::from_value(serde_json::json!({
            "mod_id": "ruby", "name": "Ruby", "version": "1", "loader": "fabric", "license": "MIT",
            "verdict": "works", "summary": "", "ports": [], "skipped": [], "depends": [],
            "namespaces": ["ruby", "gems"], "code": serde_json::from_str::<serde_json::Value>(CODE).unwrap(),
        }))
        .unwrap();
        let error = install(game.path(), checks.path(), "abc", &check).unwrap_err();
        assert!(error.contains("gems"), "{error}");
        check.namespaces = vec!["ruby".into()];
        install(game.path(), checks.path(), "abc", &check).unwrap();
        assert!(game.path().join("horizon-mods/ruby/assets/ruby").is_dir());
        assert!(is_enabled(game.path(), "ruby"));
        remove(game.path(), "ruby").unwrap();
        assert!(!game.path().join("horizon-mods/ruby").exists());
        assert!(!is_enabled(game.path(), "ruby"));
    }

    /// An empty code census, as port-pack writes one.
    const CODE: &str = r#"{"classes":0,"features":{},"events":[],"examples":{}}"#;

    /// A real jar, when one is given: `FLUX_BRIDGE_JAR=<jar> cargo test -p
    /// flux-bridge -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn a_real_jar() {
        let jar = PathBuf::from(std::env::var("FLUX_BRIDGE_JAR").expect("FLUX_BRIDGE_JAR"));
        let checks = tempfile::tempdir().unwrap();
        let started = std::time::Instant::now();
        let check = check(&jar, "x", checks.path()).unwrap();
        println!(
            "{:?} in {:.2?}: {}\nports: {:?}\nskipped: {:?}",
            check.verdict,
            started.elapsed(),
            check.summary,
            check.ports,
            check.skipped
        );
    }
}
