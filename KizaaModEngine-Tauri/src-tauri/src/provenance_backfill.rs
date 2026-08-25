//! Working out where already-installed mods came from.
//!
//! Kiza records a jar's origin at install time, and for a long stretch it did
//! not: `install_artifact` wrote the mod catalogue entry and nothing else, so
//! every mod installed in that period is a file with no identity. A real
//! instance here held twenty-five mods and three provenance entries — all three
//! of them shaderpacks.
//!
//! Two things need that identity. The Update Centre walks the provenance index
//! and nothing else, so an unrecorded mod can never be offered an update. And an
//! export that travels as *references* rather than as bundled jars can only
//! reference what it can name.
//!
//! Neither can be fixed by asking the user to reinstall twenty-five mods. So the
//! identity is recovered from the file itself: both platforms will answer "which
//! release is this exact file", Modrinth by SHA-1 and CurseForge by the Murmur2
//! fingerprint it uses for the same purpose. A file neither of them recognises
//! stays unknown, which is the honest answer — attributing it to something
//! plausible would be worse than leaving it blank.

use std::collections::HashMap;
use std::path::Path;

use crate::content_provenance::{self, ContentOrigin};
use crate::{curseforge_api, modrinth_api};

/// What a pass over one instance found.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillReport {
    /// Jars looked at.
    pub scanned: usize,
    /// Jars that already had an origin, and were left alone.
    pub already_known: usize,
    /// Jars whose origin was recovered.
    pub matched: usize,
    /// Names of the jars neither platform recognised.
    pub unmatched: Vec<String>,
}

/// A file to identify: where it lives, relative to the game directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub relative_path: String,
    pub file_name: String,
}

/// Which of an instance's mod files still need an origin.
///
/// Split from the network work so the selection rule can be tested without a
/// catalogue: a file that already has an origin must not be re-identified, both
/// because it costs a request and because it would silently drop a pin the user
/// set on it.
pub fn candidates(
    mods: &[crate::mod_manager::Mod],
    known: &std::collections::BTreeMap<String, ContentOrigin>,
) -> Vec<Candidate> {
    let mut found = Vec::new();
    for entry in mods {
        for file in &entry.files {
            if !file.ends_with(".jar") || known.contains_key(file) {
                continue;
            }
            let file_name = file.rsplit('/').next().unwrap_or(file).to_string();
            found.push(Candidate {
                relative_path: file.clone(),
                file_name,
            });
        }
    }
    found
}

/// How many jars already carried an origin.
pub fn already_known(
    mods: &[crate::mod_manager::Mod],
    known: &std::collections::BTreeMap<String, ContentOrigin>,
) -> usize {
    mods.iter()
        .flat_map(|entry| entry.files.iter())
        .filter(|file| file.ends_with(".jar") && known.contains_key(*file))
        .count()
}

fn sha1_of(bytes: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Recovers what it can for one instance, and records it.
///
/// CurseForge is asked in one batch rather than one request per file: it accepts
/// a list of fingerprints, and twenty-five separate requests to identify twenty-
/// five jars would be rude to a service that is doing us a favour.
pub async fn run(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    curseforge_key: Option<&str>,
) -> Result<BackfillReport, String> {
    let manager = crate::mod_manager::ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(instance_id);
    let known = content_provenance::all(app_data_dir, instance_id);

    let mut report = BackfillReport {
        already_known: already_known(&mods, &known),
        ..Default::default()
    };

    let wanted = candidates(&mods, &known);
    report.scanned = wanted.len();
    if wanted.is_empty() {
        return Ok(report);
    }

    // Read once, hashed twice: the file is the expensive part, not the maths.
    let mut fingerprints: HashMap<u32, Candidate> = HashMap::new();
    let mut pending: Vec<Candidate> = Vec::new();

    for candidate in wanted {
        let path = game_dir.join(
            candidate
                .relative_path
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        );
        let Ok(bytes) = std::fs::read(&path) else {
            // A catalogue entry naming a file that is not there is a different
            // problem, and not one this pass should be inventing an answer for.
            report.unmatched.push(candidate.file_name);
            continue;
        };

        match modrinth_api::version_from_sha1(&sha1_of(&bytes)).await {
            Ok(Some(version)) => {
                record(
                    app_data_dir,
                    instance_id,
                    &candidate,
                    "modrinth",
                    &version.project_id,
                    &version.id,
                );
                report.matched += 1;
                continue;
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!(
                    "[WARN] [Provenance] Modrinth would not answer for {}: {error}",
                    candidate.file_name
                );
            }
        }

        fingerprints.insert(curseforge_api::fingerprint(&bytes), candidate.clone());
        pending.push(candidate);
    }

    if fingerprints.is_empty() {
        return Ok(report);
    }

    let Some(key) = curseforge_key else {
        // Without a key CurseForge cannot be asked at all, so the remaining
        // files stay unknown rather than being reported as anything else.
        report
            .unmatched
            .extend(pending.into_iter().map(|candidate| candidate.file_name));
        return Ok(report);
    };

    let keys: Vec<u32> = fingerprints.keys().copied().collect();
    let matches = curseforge_api::files_by_fingerprint(key, &keys).await?;

    let mut resolved: Vec<String> = Vec::new();
    for file in matches {
        let Some(mod_id) = file.mod_id else { continue };
        // Paired back up by file name: the fingerprint response does not echo
        // the fingerprint it matched.
        let Some(candidate) = fingerprints
            .values()
            .find(|candidate| candidate.file_name.eq_ignore_ascii_case(&file.file_name))
        else {
            continue;
        };
        record(
            app_data_dir,
            instance_id,
            candidate,
            "curseforge",
            &mod_id.to_string(),
            &file.id.to_string(),
        );
        resolved.push(candidate.file_name.clone());
        report.matched += 1;
    }

    report.unmatched.extend(
        pending
            .into_iter()
            .filter(|candidate| !resolved.contains(&candidate.file_name))
            .map(|candidate| candidate.file_name),
    );
    Ok(report)
}

fn record(
    app_data_dir: &Path,
    instance_id: &str,
    candidate: &Candidate,
    provider: &str,
    project_id: &str,
    version_id: &str,
) {
    let _ = content_provenance::record(
        app_data_dir,
        instance_id,
        &candidate.relative_path,
        ContentOrigin {
            provider: provider.to_string(),
            project_id: project_id.to_string(),
            version_id: version_id.to_string(),
            pinned: false,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn a_mod(id: &str, files: &[&str]) -> crate::mod_manager::Mod {
        crate::mod_manager::Mod {
            id: id.to_string(),
            name: id.to_string(),
            version: "1.0.0".to_string(),
            description: String::new(),
            source: Some("modrinth".to_string()),
            author: None,
            homepage_url: None,
            cover_url: None,
            cover_path: None,
            file_size: None,
            game_versions: Vec::new(),
            loaders: Vec::new(),
            updated_at: None,
            project_id: None,
            version_id: None,
            enabled: true,
            install_date: String::new(),
            files: files.iter().map(|file| file.to_string()).collect(),
            load_order: 0,
        }
    }

    fn origin() -> ContentOrigin {
        ContentOrigin {
            provider: "modrinth".to_string(),
            project_id: "AANobbMI".to_string(),
            version_id: "abc".to_string(),
            pinned: false,
        }
    }

    #[test]
    fn a_jar_with_no_origin_is_a_candidate() {
        let mods = vec![a_mod("sodium", &["mods/sodium.jar"])];
        let found = candidates(&mods, &BTreeMap::new());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].relative_path, "mods/sodium.jar");
        assert_eq!(found[0].file_name, "sodium.jar");
    }

    /// Re-identifying a file that already has an origin would cost a request
    /// and, worse, overwrite a pin the user set deliberately.
    #[test]
    fn a_jar_that_already_has_one_is_left_alone() {
        let mods = vec![a_mod("sodium", &["mods/sodium.jar"])];
        let mut known = BTreeMap::new();
        known.insert("mods/sodium.jar".to_string(), origin());

        assert!(candidates(&mods, &known).is_empty());
        assert_eq!(already_known(&mods, &known), 1);
    }

    /// A mod's `files` list carries configs and resources too. Only jars are
    /// released artefacts a platform can recognise.
    #[test]
    fn only_jars_are_looked_up() {
        let mods = vec![a_mod("jei", &["mods/jei.jar", "config/jei/jei.toml"])];
        let found = candidates(&mods, &BTreeMap::new());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file_name, "jei.jar");
    }

    #[test]
    fn the_sha1_is_the_one_modrinth_indexes_by() {
        // Modrinth's version_file endpoint takes a lowercase hex SHA-1, and the
        // canonical digest of the empty input is a known constant.
        assert_eq!(sha1_of(b""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(sha1_of(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    }

    #[test]
    fn several_mods_contribute_all_their_jars() {
        let mods = vec![
            a_mod("sodium", &["mods/sodium.jar"]),
            a_mod("jei", &["mods/jei.jar"]),
        ];
        let found = candidates(&mods, &BTreeMap::new());
        assert_eq!(found.len(), 2);
    }
}
