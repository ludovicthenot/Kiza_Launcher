//! Turning an archive back into an instance.
//!
//! The other half of `instance_export`, and the half that used to be missing.
//! Importing an archive created an instance, unpacked `overrides/` into it, and
//! stopped there — which left the jars on disk and Kiza's mod catalogue empty,
//! so the Mods tab of an imported instance showed nothing at all. Every jar was
//! present and none of them could be switched off, removed or updated.
//!
//! So this reads `kiza.json`, fetches each referenced mod at the exact release
//! it was exported at, unpacks whatever travelled bundled, and then writes the
//! catalogue and the provenance index. What comes out is an instance, not a
//! folder that resembles one.

use std::path::Path;

use crate::content_provenance::{self, ContentOrigin};
use crate::instance_export::{ExportedMod, KizaManifest, FORMAT_VERSION};
use crate::mod_manager::{ModManager, ModMetadata};

/// What an import managed to put back.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub instance_id: String,
    pub name: String,
    /// Mods fetched from the platform they came from.
    pub mods_downloaded: usize,
    /// Mods that travelled inside the archive.
    pub mods_bundled: usize,
    /// Mods that could not be fetched, named so the gap is visible rather than
    /// discovered at launch.
    pub mods_missing: Vec<String>,
    pub worlds: Vec<String>,
}

/// Whether this archive is one this build understands.
///
/// A format from the future is refused rather than half-read: an instance built
/// from a manifest whose meaning has changed is harder to diagnose than an
/// import that declined.
pub fn readable(format: u32) -> Result<(), String> {
    if format == 0 || format > FORMAT_VERSION {
        return Err(format!(
            "This archive was written by a newer version of Kiza (format {format}). Update Kiza, then import it again."
        ));
    }
    Ok(())
}

/// Where a referenced mod is fetched from, resolved per platform.
pub struct Fetched {
    pub url: String,
    pub sha1: Option<String>,
    pub file_name: String,
}

/// Works out the download for one referenced mod.
async fn resolve(entry: &ExportedMod, curseforge_key: Option<&str>) -> Result<Fetched, String> {
    let provider = entry.provider.as_deref().unwrap_or_default();
    let version_id = entry
        .version_id
        .as_deref()
        .ok_or_else(|| format!("{} has no release recorded.", entry.name))?;

    match provider {
        "modrinth" => {
            let version = crate::modrinth_api::get_version(version_id).await?;
            // The primary file when the release marks one, otherwise the first:
            // a release can carry sources and a javadoc beside the mod itself.
            let file = version
                .files
                .iter()
                .find(|file| file.primary)
                .or_else(|| version.files.first())
                .ok_or_else(|| format!("{} has no file to download.", entry.name))?;
            Ok(Fetched {
                url: file.url.clone(),
                sha1: Some(file.hashes.sha1.clone()),
                file_name: file.filename.clone(),
            })
        }
        "curseforge" => {
            let key = curseforge_key.ok_or_else(|| {
                format!(
                    "{} comes from CurseForge, which needs an API key. Add one under Connections, then import again.",
                    entry.name
                )
            })?;
            let project_id: u64 = entry
                .project_id
                .as_deref()
                .and_then(|id| id.parse().ok())
                .ok_or_else(|| format!("{} has no CurseForge project recorded.", entry.name))?;
            let file_id: u64 = version_id
                .parse()
                .map_err(|_| format!("{} has no CurseForge release recorded.", entry.name))?;

            let file = crate::curseforge_api::get_file(key, project_id, file_id).await?;
            let url = match file.download_url.clone() {
                Some(url) => url,
                None => crate::curseforge_api::get_download_url(key, project_id, file_id).await?,
            };
            Ok(Fetched {
                url,
                sha1: file
                    .hashes
                    .iter()
                    .find(|hash| hash.algo == 1)
                    .map(|hash| hash.value.clone()),
                file_name: file.file_name.clone(),
            })
        }
        other => Err(format!(
            "{} came from \"{other}\", which this version of Kiza cannot fetch from.",
            entry.name
        )),
    }
}

/// Fetches the referenced mods and writes the catalogue.
///
/// Runs after the overrides are unpacked, so a bundled jar is already in place
/// and only needs recording rather than downloading.
pub async fn restore_mods(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    manifest: &KizaManifest,
    curseforge_key: Option<&str>,
    mut on_progress: impl FnMut(usize, usize, &str),
) -> ImportReport {
    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mut report = ImportReport {
        instance_id: instance_id.to_string(),
        name: manifest.name.clone(),
        worlds: manifest.worlds.clone(),
        ..Default::default()
    };

    let total = manifest.mods.len();
    let downloads_dir = app_data_dir.join("downloads").join("minecraft");
    let _ = std::fs::create_dir_all(&downloads_dir);

    for (index, entry) in manifest.mods.iter().enumerate() {
        on_progress(index + 1, total, &entry.name);

        let metadata = ModMetadata {
            name: Some(entry.name.clone()),
            version: Some(entry.version.clone()),
            source: entry.provider.clone(),
            project_id: entry.project_id.clone(),
            version_id: entry.version_id.clone(),
            ..Default::default()
        };

        // Bundled: the file arrived with the archive and is already where it
        // belongs, so it only has to be entered into the catalogue.
        if entry.bundled {
            let placed = game_dir.join(
                entry
                    .relative_path
                    .replace('/', std::path::MAIN_SEPARATOR_STR),
            );
            if !placed.is_file() {
                report.mods_missing.push(entry.name.clone());
                continue;
            }
            match manager.install_mod_file(
                instance_id,
                &placed.to_string_lossy(),
                &entry.relative_path,
                Some(metadata),
            ) {
                Ok(_) => report.mods_bundled += 1,
                Err(_) => report.mods_missing.push(entry.name.clone()),
            }
            continue;
        }

        let fetched = match resolve(entry, curseforge_key).await {
            Ok(fetched) => fetched,
            Err(error) => {
                eprintln!("[WARN] [Import] {error}");
                report.mods_missing.push(entry.name.clone());
                continue;
            }
        };

        let staged = downloads_dir.join(format!("{}-{}", uuid::Uuid::new_v4(), fetched.file_name));
        let client = reqwest::Client::new();
        if let Err(error) = crate::minecraft_manager::download_to_path(
            &client,
            &fetched.url,
            &staged,
            fetched.sha1.as_deref(),
        )
        .await
        {
            eprintln!("[WARN] [Import] Could not fetch {}: {error}", entry.name);
            report.mods_missing.push(entry.name.clone());
            continue;
        }

        let target = format!("mods/{}", fetched.file_name);
        match manager.install_mod_file(
            instance_id,
            &staged.to_string_lossy(),
            &target,
            Some(metadata),
        ) {
            Ok(_) => {
                report.mods_downloaded += 1;
                if let (Some(provider), Some(project), Some(version)) = (
                    entry.provider.clone(),
                    entry.project_id.clone(),
                    entry.version_id.clone(),
                ) {
                    let _ = content_provenance::record(
                        app_data_dir,
                        instance_id,
                        &target,
                        ContentOrigin {
                            provider,
                            project_id: project,
                            version_id: version,
                            pinned: false,
                        },
                    );
                }
            }
            Err(error) => {
                eprintln!("[WARN] [Import] Could not install {}: {error}", entry.name);
                report.mods_missing.push(entry.name.clone());
            }
        }
        let _ = std::fs::remove_file(&staged);
    }

    // The enabled state and the load order were part of the instance, so they
    // are part of what comes back. Applied after every mod is in the catalogue,
    // because the catalogue is what they are applied to.
    apply_states(&manager, instance_id, &manifest.mods);
    report
}

/// Puts each restored mod back in the state it was exported in.
fn apply_states(manager: &ModManager, instance_id: &str, exported: &[ExportedMod]) {
    let mut mods = manager.load_mods(instance_id);
    let mut changed = false;

    for entry in &mut mods {
        let Some(source) = exported
            .iter()
            .find(|candidate| candidate.name == entry.name)
        else {
            continue;
        };
        if entry.enabled != source.enabled || entry.load_order != source.load_order {
            entry.enabled = source.enabled;
            entry.load_order = source.load_order;
            changed = true;
        }
    }

    if changed {
        let _ = manager.save_mods(instance_id, &mods);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_archive_from_a_newer_kiza_is_refused_rather_than_half_read() {
        assert!(readable(FORMAT_VERSION).is_ok());
        assert!(readable(FORMAT_VERSION + 1).is_err());
        // A manifest with no format at all is not one of ours.
        assert!(readable(0).is_err());
    }

    fn exported(name: &str, enabled: bool, order: i32) -> ExportedMod {
        ExportedMod {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            file_name: format!("{name}.jar"),
            relative_path: format!("mods/{name}.jar"),
            provider: Some("modrinth".to_string()),
            project_id: Some("p".to_string()),
            version_id: Some("v".to_string()),
            bundled: false,
            enabled,
            load_order: order,
        }
    }

    /// A mod exported switched off must come back switched off. Restoring it
    /// enabled changes what the game loads, silently.
    #[test]
    fn the_exported_states_are_what_get_applied() {
        let root = tempfile::tempdir().unwrap();
        let manager = ModManager::new(root.path().to_path_buf());

        let jar = root.path().join("iris.jar");
        std::fs::write(&jar, b"PK").unwrap();
        manager
            .install_mod_file(
                "abc",
                &jar.to_string_lossy(),
                "mods/iris.jar",
                Some(ModMetadata {
                    name: Some("Iris".to_string()),
                    ..Default::default()
                }),
            )
            .unwrap();

        // Installed enabled, by default.
        assert!(manager.load_mods("abc")[0].enabled);

        apply_states(&manager, "abc", &[exported("Iris", false, 9)]);

        let restored = &manager.load_mods("abc")[0];
        assert!(!restored.enabled);
        assert_eq!(restored.load_order, 9);
    }

    #[test]
    fn a_mod_the_archive_says_nothing_about_is_left_as_it_is() {
        let root = tempfile::tempdir().unwrap();
        let manager = ModManager::new(root.path().to_path_buf());
        let jar = root.path().join("sodium.jar");
        std::fs::write(&jar, b"PK").unwrap();
        manager
            .install_mod_file(
                "abc",
                &jar.to_string_lossy(),
                "mods/sodium.jar",
                Some(ModMetadata {
                    name: Some("Sodium".to_string()),
                    ..Default::default()
                }),
            )
            .unwrap();

        apply_states(&manager, "abc", &[exported("Iris", false, 9)]);

        assert!(manager.load_mods("abc")[0].enabled);
    }
}
