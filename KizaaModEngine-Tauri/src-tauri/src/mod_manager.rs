use crate::app_error::AppError;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

/// # Data Architecture and Sources of Truth
///
/// This module manages mods, profiles and deployments.
/// The architecture relies on a strict separation of responsibilities to avoid duplicated state.
///
/// ## Sources of Truth
///
/// 1. **Instances (`games/{instance_id}.json`)**:
///    - Defines the physical identity of the game installation (path, type, status).
///    - **Single source of truth** for the existence of an instance.
///
/// 2. **Profiles (`config/{instance_id}_profiles.json`)**:
///    - Defines the logical mod configuration (which mods, which order, which state).
///    - Contains `active_profile_id`.
///    - **Single source of truth** for the active profile and profile definitions.
///
/// 3. **Mod catalog (`config/{instance_id}_mods.json`)**:
///    - Inventory of installed mods (metadata, files).
///    - **Single source of truth** for the intrinsic properties of mods (version, name).
///    - *Note: the `enabled` and `load_order` state here reflects the current/last applied state; the Profile is the intent.*
///
/// 4. **Global manifest (`config/{instance_id}_global_manifest.json`)**:
///    - Actual state deployed on disk (which files are linked, by whom).
///    - **Single source of truth** for physical file tracking and cleanup (undeploy).
///
/// ## System Invariants
/// - An invalid instance cannot be modified in any way.
/// - A profile can only reference mods known to the instance.
/// - `active_profile_id` must always point to an existing profile or be `None`.

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Mod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage_url: Option<String>,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub cover_path: Option<String>,
    #[serde(default)]
    pub file_size: Option<u64>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    /// Project on the source platform, e.g. a Modrinth slug or a CurseForge id.
    /// Without it an installed mod cannot be matched to its upstream project,
    /// so no update can ever be offered for it.
    #[serde(default)]
    pub project_id: Option<String>,
    /// Exact released version this file came from.
    #[serde(default)]
    pub version_id: Option<String>,
    pub enabled: bool,
    pub install_date: String,
    pub files: Vec<String>, // Relative paths of files in this mod
    pub load_order: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ModMetadata {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub cover_url: Option<String>,
    pub file_size: Option<u64>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Manifest {
    pub id: String,
    pub version: String,
    pub files: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProfileModState {
    pub mod_id: String,
    pub enabled: bool,
    pub load_order: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub instance_id: String, // Enforce linkage to specific instance
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
    pub mods_state: Vec<ProfileModState>,
    pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProfileConfig {
    pub schema_version: i32,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<Profile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeployedFile {
    pub mod_id: String,
    pub link_type: String, // "hardlink", "symlink", "copy"
    pub source_path: String,
    pub deployed_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GlobalManifest {
    pub game_id: String,
    pub files: HashMap<String, DeployedFile>, // Key: relative path in game dir
}

#[derive(Serialize, Clone, Debug)]
pub struct DeleteModResult {
    pub mod_id: String,
    pub mod_name: String,
    pub was_enabled: bool,
    pub deployed_files_removed: usize,
    pub profile_references_removed: usize,
    pub preserved_unmanaged_files: usize,
    pub shared_dependencies_preserved: usize,
    pub orphan_dependencies_removed: usize,
    pub orphan_dependencies_preserved: usize,
    pub cleanup_pending: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VerifyResult {
    pub ok: bool,
    pub issues: Vec<VerifyIssue>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VerifyIssue {
    pub issue_type: String, // "missing_source", "broken_target", "orphan", "wrong_owner"
    pub path: String,
    pub mod_id: Option<String>,
    pub details: String,
}

pub struct ModManager {
    pub app_data_dir: PathBuf,
}

struct StagedDeletion {
    original_path: PathBuf,
    quarantine_path: PathBuf,
}

struct MetadataUpdate {
    path: PathBuf,
    original: Vec<u8>,
    replacement: Vec<u8>,
}

impl ModManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self { app_data_dir }
    }

    fn normalize_rel_path(rel_path: &str) -> Result<PathBuf, String> {
        let path = Path::new(rel_path);
        let mut normalized = PathBuf::new();

        for component in path.components() {
            match component {
                std::path::Component::Normal(part) => normalized.push(part),
                std::path::Component::CurDir => {}
                std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_) => {
                    return Err(format!("Unsafe relative path rejected: {rel_path}"));
                }
            }
        }

        if normalized.as_os_str().is_empty() {
            return Err("Empty relative path rejected".to_string());
        }

        Ok(normalized)
    }

    fn normalize_rel_string(rel_path: &str) -> Result<String, String> {
        let normalized = Self::normalize_rel_path(rel_path)?;
        Ok(normalized.to_string_lossy().replace('\\', "/"))
    }

    fn canonical_game_root(game_root: &Path) -> Result<PathBuf, String> {
        game_root
            .canonicalize()
            .map_err(|e| format!("Invalid game folder '{}': {e}", game_root.display()))
    }

    fn nearest_existing_parent(path: &Path, game_root: &Path) -> PathBuf {
        let mut current = path;
        loop {
            if current.exists() {
                return current.to_path_buf();
            }
            match current.parent() {
                Some(parent) if parent.starts_with(game_root) => current = parent,
                _ => return game_root.to_path_buf(),
            }
        }
    }

    fn safe_game_path(game_root: &Path, rel_path: &str) -> Result<PathBuf, String> {
        let rel = Self::normalize_rel_path(rel_path)?;
        let target = game_root.join(rel);
        let parent = target.parent().unwrap_or(game_root);
        let existing_parent = Self::nearest_existing_parent(parent, game_root);
        let canonical_parent = existing_parent.canonicalize().map_err(|e| {
            format!(
                "Failed to validate target parent '{}': {e}",
                existing_parent.display()
            )
        })?;

        if !canonical_parent.starts_with(game_root) {
            return Err(format!("Target escapes game folder: {rel_path}"));
        }

        Ok(target)
    }

    fn backup_unmanaged_target(
        target_path: &Path,
        game_root: &Path,
    ) -> Result<Option<PathBuf>, String> {
        if !target_path.exists() {
            return Ok(None);
        }
        if target_path.is_dir() {
            return Err(format!(
                "Cannot overwrite directory '{}'",
                target_path.display()
            ));
        }

        let rel_path = target_path.strip_prefix(game_root).map_err(|_| {
            format!(
                "Backup target escapes game folder: '{}'",
                target_path.display()
            )
        })?;
        let backup_path = game_root
            .join(".kiza_backups")
            .join(chrono::Local::now().format("%Y%m%d-%H%M%S").to_string())
            .join(rel_path);

        if let Some(parent) = backup_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        fs::rename(target_path, &backup_path)
            .or_else(|_| {
                fs::copy(target_path, &backup_path)?;
                fs::remove_file(target_path)
            })
            .map_err(|e| {
                format!(
                    "Failed to backup existing file '{}': {e}",
                    target_path.display()
                )
            })?;

        Ok(Some(backup_path))
    }

    fn remove_empty_parent(target_path: &Path, game_root: &Path) {
        let mut current = target_path.parent();
        while let Some(parent) = current {
            if parent == game_root || !parent.starts_with(game_root) {
                break;
            }
            if fs::remove_dir(parent).is_err() {
                break;
            }
            current = parent.parent();
        }
    }

    fn is_cover_candidate(path: &Path) -> bool {
        let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
            return false;
        };
        matches!(
            ext.to_ascii_lowercase().as_str(),
            "png" | "jpg" | "jpeg" | "webp"
        )
    }

    fn apply_metadata_to_mod(mod_info: &mut Mod, metadata: ModMetadata) {
        if let Some(value) = metadata.name.filter(|value| !value.trim().is_empty()) {
            mod_info.name = value;
        }
        if let Some(value) = metadata.version.filter(|value| !value.trim().is_empty()) {
            mod_info.version = value;
        }
        if let Some(value) = metadata
            .description
            .filter(|value| !value.trim().is_empty())
        {
            mod_info.description = value;
        }
        mod_info.source = metadata.source;
        mod_info.author = metadata.author;
        mod_info.homepage_url = metadata.homepage_url;
        mod_info.cover_url = metadata.cover_url;
        mod_info.file_size = metadata.file_size;
        mod_info.game_versions = metadata.game_versions;
        mod_info.loaders = metadata.loaders;
        mod_info.updated_at = metadata.updated_at;
    }

    fn get_staging_dir(&self, instance_id: &str) -> PathBuf {
        self.app_data_dir.join("staging").join(instance_id)
    }

    #[allow(dead_code)]
    fn get_storage_dir(&self) -> PathBuf {
        self.app_data_dir.join("storage")
    }

    fn get_mods_config_path(&self, instance_id: &str) -> PathBuf {
        self.app_data_dir
            .join("config")
            .join(format!("{}_mods.json", instance_id))
    }

    fn get_profiles_config_path(&self, instance_id: &str) -> PathBuf {
        self.app_data_dir
            .join("config")
            .join(format!("{}_profiles.json", instance_id))
    }

    fn get_global_manifest_path(&self, instance_id: &str) -> PathBuf {
        self.app_data_dir
            .join("config")
            .join(format!("{}_global_manifest.json", instance_id))
    }

    pub fn load_mods(&self, instance_id: &str) -> Vec<Mod> {
        let path = self.get_mods_config_path(instance_id);
        let mut mods = Vec::new();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    match serde_json::from_str::<Vec<Mod>>(&content) {
                        Ok(loaded_mods) => mods = loaded_mods,
                        Err(e) => {
                            eprintln!(
                                "[ERROR] [ModManager] Failed to parse mods config for {}: {}",
                                instance_id, e
                            );
                            // Corrupt mods config -> Return empty list to avoid crash, but log error.
                            // Ideally we might want to backup the corrupt file.
                        }
                    }
                }
                Err(e) => eprintln!(
                    "[ERROR] [ModManager] Failed to read mods config for {}: {}",
                    instance_id, e
                ),
            }
        }

        // Sort by load order
        mods.sort_by_key(|m| m.load_order);
        mods
    }

    pub fn save_atomic<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temp_path = path.with_extension("tmp");
        let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        fs::write(&temp_path, content).map_err(|e| e.to_string())?;
        fs::rename(&temp_path, path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_mods(&self, instance_id: &str, mods: &Vec<Mod>) -> Result<(), String> {
        let path = self.get_mods_config_path(instance_id);
        Self::save_atomic(&path, mods)
    }

    fn read_json_strict<T: DeserializeOwned>(
        path: &Path,
        label: &str,
    ) -> Result<Option<T>, AppError> {
        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read(path).map_err(|error| {
            AppError::new(
                "mod_metadata_read_failed",
                format!("Failed to read {label}: {error}"),
                true,
                Some("Check file permissions, then retry."),
            )
        })?;
        serde_json::from_slice(&content).map(Some).map_err(|error| {
            AppError::new(
                "mod_metadata_invalid",
                format!("The {label} metadata is invalid: {error}"),
                false,
                Some("Open diagnostics and repair the instance metadata before retrying."),
            )
        })
    }

    fn serialize_metadata<T: Serialize>(data: &T, label: &str) -> Result<Vec<u8>, AppError> {
        serde_json::to_vec_pretty(data).map_err(|error| {
            AppError::new(
                "mod_metadata_write_failed",
                format!("Failed to prepare {label}: {error}"),
                true,
                Some("Retry the deletion. No mod files were removed."),
            )
        })
    }

    fn replace_file_bytes(path: &Path, content: &[u8]) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| format!("Metadata path has no parent: {}", path.display()))?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;

        let operation_id = Uuid::new_v4();
        let temp_path = parent.join(format!(
            ".{}.{}.tmp",
            operation_id,
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
        let backup_path = parent.join(format!(
            ".{}.{}.bak",
            operation_id,
            path.file_name().unwrap_or_default().to_string_lossy()
        ));

        fs::write(&temp_path, content).map_err(|error| error.to_string())?;
        let had_original = path.exists();

        if had_original {
            if let Err(error) = fs::rename(path, &backup_path) {
                let _ = fs::remove_file(&temp_path);
                return Err(format!(
                    "Failed to stage metadata '{}': {error}",
                    path.display()
                ));
            }
        }

        if let Err(error) = fs::rename(&temp_path, path) {
            if had_original {
                let _ = fs::rename(&backup_path, path);
            }
            let _ = fs::remove_file(&temp_path);
            return Err(format!(
                "Failed to replace metadata '{}': {error}",
                path.display()
            ));
        }

        if had_original {
            if let Err(error) = fs::remove_file(&backup_path) {
                eprintln!(
                    "[WARN] [ModManager] Failed to remove metadata backup '{}': {error}",
                    backup_path.display()
                );
            }
        }

        Ok(())
    }

    fn commit_metadata_updates(updates: &[MetadataUpdate]) -> Result<(), String> {
        for update in updates {
            let current = fs::read(&update.path).map_err(|error| {
                format!(
                    "Failed to verify metadata '{}': {error}",
                    update.path.display()
                )
            })?;
            if current != update.original {
                return Err(format!(
                    "Metadata changed while deleting the mod: '{}'",
                    update.path.display()
                ));
            }
        }

        for (applied, update) in updates.iter().enumerate() {
            if let Err(error) = Self::replace_file_bytes(&update.path, &update.replacement) {
                let mut rollback_errors = Vec::new();
                for applied_update in updates.iter().take(applied).rev() {
                    if let Err(rollback_error) =
                        Self::replace_file_bytes(&applied_update.path, &applied_update.original)
                    {
                        rollback_errors.push(rollback_error);
                    }
                }

                if rollback_errors.is_empty() {
                    return Err(error);
                }
                return Err(format!(
                    "{error}. Metadata rollback also failed: {}",
                    rollback_errors.join("; ")
                ));
            }
        }

        Ok(())
    }

    fn path_exists(path: &Path) -> bool {
        fs::symlink_metadata(path).is_ok()
    }

    fn file_digest(path: &Path) -> Result<Vec<u8>, String> {
        let mut file = fs::File::open(path)
            .map_err(|error| format!("Failed to inspect '{}': {error}", path.display()))?;
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("Failed to inspect '{}': {error}", path.display()))?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }

        Ok(digest.finalize().to_vec())
    }

    fn deployment_target_is_managed(
        target_path: &Path,
        expected_source: &Path,
        link_type: &str,
    ) -> Result<bool, String> {
        let metadata = fs::symlink_metadata(target_path).map_err(|error| {
            format!(
                "Failed to inspect deployed file '{}': {error}",
                target_path.display()
            )
        })?;

        if metadata.file_type().is_symlink() {
            let link_target = fs::read_link(target_path).map_err(|error| {
                format!(
                    "Failed to inspect deployed link '{}': {error}",
                    target_path.display()
                )
            })?;
            let resolved_target = if link_target.is_absolute() {
                link_target
            } else {
                target_path
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join(link_target)
            };

            let resolved_target = resolved_target.canonicalize().ok();
            let expected_source = expected_source.canonicalize().ok();
            return Ok(resolved_target.is_some() && resolved_target == expected_source);
        }

        if !metadata.file_type().is_file() || !matches!(link_type, "hardlink" | "copy") {
            return Ok(false);
        }

        if !expected_source.is_file() {
            return Ok(false);
        }

        Ok(Self::file_digest(target_path)? == Self::file_digest(expected_source)?)
    }

    fn stage_path_for_deletion(
        original_path: &Path,
        quarantine_path: &Path,
    ) -> Result<StagedDeletion, String> {
        if let Some(parent) = quarantine_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create deletion quarantine '{}': {error}",
                    parent.display()
                )
            })?;
        }

        fs::rename(original_path, quarantine_path).map_err(|error| {
            format!(
                "Failed to stage '{}' for deletion: {error}",
                original_path.display()
            )
        })?;

        Ok(StagedDeletion {
            original_path: original_path.to_path_buf(),
            quarantine_path: quarantine_path.to_path_buf(),
        })
    }

    fn rollback_staged_deletions(staged: &[StagedDeletion]) -> Vec<String> {
        let mut errors = Vec::new();

        for deletion in staged.iter().rev() {
            if !Self::path_exists(&deletion.quarantine_path) {
                continue;
            }
            if let Some(parent) = deletion.original_path.parent() {
                if let Err(error) = fs::create_dir_all(parent) {
                    errors.push(format!(
                        "Failed to recreate '{}': {error}",
                        parent.display()
                    ));
                    continue;
                }
            }
            if let Err(error) = fs::rename(&deletion.quarantine_path, &deletion.original_path) {
                errors.push(format!(
                    "Failed to restore '{}': {error}",
                    deletion.original_path.display()
                ));
            }
        }

        errors
    }

    fn deletion_file_error(message: String, rollback_errors: Vec<String>) -> AppError {
        let message = if rollback_errors.is_empty() {
            message
        } else {
            format!(
                "{message}. Rollback also failed: {}",
                rollback_errors.join("; ")
            )
        };
        AppError::new(
            "mod_delete_files_failed",
            message,
            true,
            Some("Close Minecraft and any program using the mod files, then retry."),
        )
    }

    #[allow(dead_code)]
    #[allow(dead_code)]
    pub fn reorder_mods(&self, instance_id: &str, new_order: Vec<String>) -> Result<(), String> {
        let mods = self.load_mods(instance_id);
        let mut mod_map: HashMap<String, Mod> =
            mods.into_iter().map(|m| (m.id.clone(), m)).collect();
        let mut ordered_mods = Vec::new();

        for (index, mod_id) in new_order.iter().enumerate() {
            if let Some(mut m) = mod_map.remove(mod_id) {
                m.load_order = index as i32;
                ordered_mods.push(m);
            }
        }

        // Append any remaining mods (shouldn't happen if frontend is correct, but safety first)
        for (_, mut m) in mod_map {
            m.load_order = ordered_mods.len() as i32;
            ordered_mods.push(m);
        }

        ordered_mods.sort_by_key(|m| m.load_order);
        self.save_mods(instance_id, &ordered_mods)
    }

    pub fn verify_state(&self, instance_id: &str, game_root: &str) -> VerifyResult {
        let manifest_path = self.get_global_manifest_path(instance_id);
        let mut issues = Vec::new();

        if !manifest_path.exists() {
            return VerifyResult {
                ok: true,
                issues: Vec::new(),
            }; // Fresh state
        }

        let content = match fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(e) => {
                return VerifyResult {
                    ok: false,
                    issues: vec![VerifyIssue {
                        issue_type: "manifest_error".to_string(),
                        path: manifest_path.to_string_lossy().to_string(),
                        mod_id: None,
                        details: e.to_string(),
                    }],
                }
            }
        };

        let manifest: GlobalManifest = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                return VerifyResult {
                    ok: false,
                    issues: vec![VerifyIssue {
                        issue_type: "manifest_corrupt".to_string(),
                        path: manifest_path.to_string_lossy().to_string(),
                        mod_id: None,
                        details: e.to_string(),
                    }],
                }
            }
        };

        let game_root_path = match Self::canonical_game_root(Path::new(game_root)) {
            Ok(path) => path,
            Err(e) => {
                return VerifyResult {
                    ok: false,
                    issues: vec![VerifyIssue {
                        issue_type: "invalid_game_root".to_string(),
                        path: game_root.to_string(),
                        mod_id: None,
                        details: e,
                    }],
                }
            }
        };

        for (rel_path, deployed_file) in &manifest.files {
            let target_path = match Self::safe_game_path(&game_root_path, rel_path) {
                Ok(path) => path,
                Err(e) => {
                    issues.push(VerifyIssue {
                        issue_type: "unsafe_path".to_string(),
                        path: rel_path.clone(),
                        mod_id: Some(deployed_file.mod_id.clone()),
                        details: e,
                    });
                    continue;
                }
            };
            let source_path = Path::new(&deployed_file.source_path);

            // 1. Check Source
            if !source_path.exists() {
                issues.push(VerifyIssue {
                    issue_type: "missing_source".to_string(),
                    path: rel_path.clone(),
                    mod_id: Some(deployed_file.mod_id.clone()),
                    details: format!("Source missing at {:?}", source_path),
                });
            }

            // 2. Check Target
            if !target_path.exists() {
                issues.push(VerifyIssue {
                    issue_type: "missing_target".to_string(),
                    path: rel_path.clone(),
                    mod_id: Some(deployed_file.mod_id.clone()),
                    details: "Deployed file is missing in game folder".to_string(),
                });
            } else {
                // 3. Check Integrity (Basic: is it a link?)
                // In a real robust system, we would check inode/fileID equality or reparse points
                let metadata = fs::symlink_metadata(&target_path);
                match metadata {
                    Ok(meta) => {
                        let is_link = meta.file_type().is_symlink();
                        // On Windows, hardlinks look like files. We can't easily distinguish without low-level API.
                        // But if we expected a symlink and it's a file, that might be suspicious (or just user copy).
                        if deployed_file.link_type == "symlink" && !is_link {
                            issues.push(VerifyIssue {
                                issue_type: "integrity_mismatch".to_string(),
                                path: rel_path.clone(),
                                mod_id: Some(deployed_file.mod_id.clone()),
                                details: "Expected symlink, found file".to_string(),
                            });
                        }
                    }
                    Err(e) => {
                        issues.push(VerifyIssue {
                            issue_type: "target_error".to_string(),
                            path: rel_path.clone(),
                            mod_id: Some(deployed_file.mod_id.clone()),
                            details: e.to_string(),
                        });
                    }
                }
            }
        }

        VerifyResult {
            ok: issues.is_empty(),
            issues,
        }
    }

    pub fn repair_state(
        &self,
        instance_id: &str,
        game_root: &str,
        game_id: &str,
    ) -> Result<String, String> {
        let verify = self.verify_state(instance_id, game_root);
        if verify.ok {
            return Ok("State is clean, no repair needed.".to_string());
        }

        // Strategy: Force re-deploy enabled mods
        // This will overwrite broken links and missing targets
        // For missing sources, we can't do much except warn, or disable the mod.

        // 1. Disable mods with missing sources
        let mut mods_disabled_count = 0;
        let mut mods = self.load_mods(instance_id);
        let mut mods_changed = false;

        for issue in &verify.issues {
            if issue.issue_type == "missing_source" {
                if let Some(mod_id) = &issue.mod_id {
                    if let Some(m) = mods.iter_mut().find(|m| &m.id == mod_id) {
                        if m.enabled {
                            m.enabled = false;
                            mods_changed = true;
                            mods_disabled_count += 1;
                        }
                    }
                }
            }
        }

        if mods_changed {
            self.save_mods(instance_id, &mods)?;
        }

        // 2. Re-deploy
        // Force re-deployment by re-running deploy logic which is idempotent/self-healing by design
        let count = self.deploy(instance_id, game_id, game_root)?;

        Ok(format!(
            "Repaired state. Disabled {} broken mods. Re-deployed {} files.",
            mods_disabled_count, count
        ))
    }

    pub fn get_conflicts(&self, instance_id: &str) -> HashMap<String, Vec<String>> {
        let mods = self.load_mods(instance_id);
        let mut file_map: HashMap<String, Vec<String>> = HashMap::new();
        let mut conflicts: HashMap<String, Vec<String>> = HashMap::new();

        for m in mods {
            if !m.enabled {
                continue;
            }
            for file in m.files {
                file_map.entry(file).or_default().push(m.name.clone());
            }
        }

        for (file, owners) in file_map {
            if owners.len() > 1 {
                conflicts.insert(file, owners);
            }
        }

        conflicts
    }

    pub fn refresh_mods_from_disk(&self, instance_id: &str) -> Result<Vec<Mod>, String> {
        let staging_dir = self.get_staging_dir(instance_id);
        if !staging_dir.exists() {
            return Ok(Vec::new());
        }

        let mut current_mods = self.load_mods(instance_id);
        let mut mod_map: HashMap<String, Mod> =
            current_mods.drain(..).map(|m| (m.id.clone(), m)).collect();
        let mut updated_mods = Vec::new();

        if let Ok(entries) = fs::read_dir(staging_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let manifest_path = path.join("manifest.json");
                    if manifest_path.exists() {
                        if let Ok(content) = fs::read_to_string(&manifest_path) {
                            if let Ok(manifest) = serde_json::from_str::<Manifest>(&content) {
                                let mod_id = manifest.id.clone();
                                let mut mod_info = mod_map.remove(&mod_id).unwrap_or_else(|| {
                                    // New mod found on disk (manually added?)
                                    Mod {
                                        id: mod_id.clone(),
                                        name: path
                                            .file_name()
                                            .map(|name| name.to_string_lossy().to_string())
                                            .unwrap_or_else(|| mod_id.clone()),
                                        version: manifest.version.clone(),
                                        // Found on disk, so nothing is known
                                        // about where it came from.
                                        project_id: None,
                                        version_id: None,
                                        description: "Detected from disk".to_string(),
                                        source: None,
                                        author: None,
                                        homepage_url: None,
                                        cover_url: None,
                                        cover_path: None,
                                        file_size: None,
                                        game_versions: Vec::new(),
                                        loaders: Vec::new(),
                                        updated_at: None,
                                        enabled: false, // Default to disabled for safety
                                        install_date: chrono::Local::now().to_rfc3339(),
                                        files: manifest.files.clone(),
                                        load_order: 9999, // Append at end
                                    }
                                });

                                // Update files from manifest
                                mod_info.files = manifest.files;
                                updated_mods.push(mod_info);
                            }
                        }
                    }
                }
            }
        }

        // Sort and fix load orders
        updated_mods.sort_by_key(|m| m.load_order);
        for (i, m) in updated_mods.iter_mut().enumerate() {
            m.load_order = i as i32;
        }

        self.save_mods(instance_id, &updated_mods)?;
        Ok(updated_mods)
    }

    pub fn install_mod(&self, instance_id: &str, archive_path: &str) -> Result<Mod, String> {
        let archive_path = Path::new(archive_path);
        if !archive_path.exists() {
            return Err("Archive file not found".to_string());
        }

        let file_name = archive_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let mod_id = Uuid::new_v4().to_string();
        let staging_path = self.get_staging_dir(instance_id).join(&mod_id);

        // Create staging directory
        fs::create_dir_all(&staging_path).map_err(|e| e.to_string())?;

        // Extract archive
        let file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

        let mut mod_files = Vec::new();
        let mut cover_path: Option<String> = None;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = file
                .enclosed_name()
                .map(|path| staging_path.join(path))
                .ok_or_else(|| format!("Unsafe archive path rejected: {}", file.name()))?;

            if (*file.name()).ends_with('/') {
                fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(|e| e.to_string())?;
                    }
                }
                let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
                io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }

            // Store relative path for tracking
            if let Ok(rel_path) = outpath.strip_prefix(&staging_path) {
                let normalized = Self::normalize_rel_string(&rel_path.to_string_lossy())?;
                if cover_path.is_none() && Self::is_cover_candidate(Path::new(&normalized)) {
                    cover_path = Some(outpath.to_string_lossy().to_string());
                }
                mod_files.push(normalized);
            }
        }

        // Generate Manifest
        let manifest = Manifest {
            id: mod_id.clone(),
            version: "1.0.0".to_string(),
            files: mod_files.clone(),
        };
        let manifest_path = staging_path.join("manifest.json");
        if let Ok(content) = serde_json::to_string_pretty(&manifest) {
            let _ = fs::write(manifest_path, content);
        }

        let mut mods = self.load_mods(instance_id);

        let new_load_order = if let Some(last) = mods.last() {
            last.load_order + 1
        } else {
            0
        };

        let new_mod = Mod {
            id: mod_id,
            name: file_name,
            version: "1.0.0".to_string(), // TODO: Detect from manifest if possible
            description: "Imported Mod".to_string(),
            source: Some("local_archive".to_string()),
            project_id: None,
            version_id: None,
            author: None,
            homepage_url: None,
            cover_url: None,
            cover_path,
            file_size: fs::metadata(archive_path).ok().map(|meta| meta.len()),
            game_versions: Vec::new(),
            loaders: Vec::new(),
            updated_at: None,
            enabled: true,
            install_date: chrono::Local::now().to_rfc3339(),
            files: mod_files,
            load_order: new_load_order,
        };

        mods.push(new_mod.clone());
        self.save_mods(instance_id, &mods)?;

        Ok(new_mod)
    }

    pub fn install_mod_file(
        &self,
        instance_id: &str,
        file_path: &str,
        target_rel_path: &str,
        metadata: Option<ModMetadata>,
    ) -> Result<Mod, String> {
        let source = Path::new(file_path);
        if !source.exists() || !source.is_file() {
            return Err("File not found".to_string());
        }

        let file_name = source
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let mod_id = Uuid::new_v4().to_string();
        let staging_path = self.get_staging_dir(instance_id).join(&mod_id);
        fs::create_dir_all(&staging_path).map_err(|e| e.to_string())?;

        let rel = Self::normalize_rel_path(target_rel_path)?;
        let dest = staging_path.join(&rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(source, &dest).map_err(|e| e.to_string())?;

        let mod_files = vec![rel.to_string_lossy().replace('\\', "/")];

        let manifest = Manifest {
            id: mod_id.clone(),
            version: "1.0.0".to_string(),
            files: mod_files.clone(),
        };
        let manifest_path = staging_path.join("manifest.json");
        if let Ok(content) = serde_json::to_string_pretty(&manifest) {
            let _ = fs::write(manifest_path, content);
        }

        let mut mods = self.load_mods(instance_id);
        let new_load_order = mods.last().map(|m| m.load_order + 1).unwrap_or(0);

        let new_mod = Mod {
            id: mod_id,
            name: file_name,
            version: "1.0.0".to_string(),
            description: "Imported File".to_string(),
            source: Some("direct_download".to_string()),
            project_id: None,
            version_id: None,
            author: None,
            homepage_url: None,
            cover_url: None,
            cover_path: None,
            file_size: fs::metadata(source).ok().map(|meta| meta.len()),
            game_versions: Vec::new(),
            loaders: Vec::new(),
            updated_at: None,
            enabled: true,
            install_date: chrono::Local::now().to_rfc3339(),
            files: mod_files,
            load_order: new_load_order,
        };
        let mut new_mod = new_mod;
        if let Some(metadata) = metadata {
            Self::apply_metadata_to_mod(&mut new_mod, metadata);
        }

        mods.push(new_mod.clone());
        self.save_mods(instance_id, &mods)?;
        Ok(new_mod)
    }

    pub fn deploy(
        &self,
        instance_id: &str,
        game_id: &str,
        game_root: &str,
    ) -> Result<usize, String> {
        let mods = self.load_mods(instance_id);
        let game_root_path = Self::canonical_game_root(Path::new(game_root))?;
        let staging_base = self.get_staging_dir(instance_id);

        // Load Global Manifest
        let manifest_path = self.get_global_manifest_path(instance_id);
        let mut global_manifest = if manifest_path.exists() {
            if let Ok(content) = fs::read_to_string(&manifest_path) {
                serde_json::from_str::<GlobalManifest>(&content).unwrap_or(GlobalManifest {
                    game_id: game_id.to_string(),
                    files: HashMap::new(),
                })
            } else {
                GlobalManifest {
                    game_id: game_id.to_string(),
                    files: HashMap::new(),
                }
            }
        } else {
            GlobalManifest {
                game_id: game_id.to_string(),
                files: HashMap::new(),
            }
        };

        // Calculate desired state
        // Map: Target Path (relative) -> (Source Path (Staging), Mod ID)
        let mut desired_state: HashMap<String, (PathBuf, String)> = HashMap::new();

        // Process mods in order (last one wins)
        for mod_info in mods.iter() {
            if !mod_info.enabled {
                continue;
            }
            let mod_staging_path = staging_base.join(&mod_info.id);
            for rel_file_path in &mod_info.files {
                let rel_path = Self::normalize_rel_string(rel_file_path)?;
                let source_path = mod_staging_path.join(Path::new(&rel_path));
                if source_path.is_file() {
                    desired_state.insert(rel_path, (source_path, mod_info.id.clone()));
                }
            }
        }

        let mut deploy_count = 0;
        let mut paths_to_remove = Vec::new();

        // 1. Identify files to remove (obsolete or owner changed)
        for (rel_path, deployed_info) in &global_manifest.files {
            if !desired_state.contains_key(rel_path) {
                // Not in desired state anymore -> Remove
                paths_to_remove.push(rel_path.clone());
            } else if let Some((_, new_mod_id)) = desired_state.get(rel_path) {
                if &deployed_info.mod_id != new_mod_id {
                    // Owner changed -> Remove old link first (clean slate for new owner)
                    paths_to_remove.push(rel_path.clone());
                }
            }
        }

        // Apply removals
        for rel_path in paths_to_remove {
            let target_path = Self::safe_game_path(&game_root_path, &rel_path)?;
            if target_path.exists() {
                // Safety: We only remove files tracked in our GlobalManifest
                let _ = fs::remove_file(&target_path);
            }
            Self::remove_empty_parent(&target_path, &game_root_path);
            global_manifest.files.remove(&rel_path);
        }

        // 2. Create/Update links
        for (rel_path, (source_path, mod_id)) in desired_state {
            let target_path = Self::safe_game_path(&game_root_path, &rel_path)?;

            // Check if already deployed correctly
            if let Some(deployed_info) = global_manifest.files.get(&rel_path) {
                if deployed_info.mod_id == mod_id && target_path.exists() {
                    // Already deployed by this mod. Skip.
                    // (Optimization: In a real robust system, we might verify the link target is correct)
                    continue;
                }
            }

            // Ensure parent dir exists
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }

            // Conflict resolution: backup unmanaged files before replacing them.
            if target_path.exists() {
                let tracked_by_manifest = global_manifest.files.contains_key(&rel_path);
                if tracked_by_manifest {
                    fs::remove_file(&target_path).map_err(|e| e.to_string())?;
                } else {
                    let backup_path = Self::backup_unmanaged_target(&target_path, &game_root_path)?;
                    if let Some(path) = backup_path {
                        eprintln!(
                            "[INFO] [ModManager] Backed up unmanaged file to {}",
                            path.display()
                        );
                    }
                }
            }

            // Create Link (Hardlink first, Symlink fallback)
            let mut _link_type = "unknown".to_string();

            #[cfg(windows)]
            {
                if fs::hard_link(&source_path, &target_path).is_err() {
                    if let Err(e) = std::os::windows::fs::symlink_file(&source_path, &target_path) {
                        return Err(format!("Failed to link {:?}: {}", rel_path, e));
                    }
                    _link_type = "symlink".to_string();
                } else {
                    _link_type = "hardlink".to_string();
                }
            }
            #[cfg(unix)]
            {
                std::os::unix::fs::symlink(&source_path, &target_path)
                    .map_err(|e| e.to_string())?;
                _link_type = "symlink".to_string();
            }

            // Update Manifest in memory
            global_manifest.files.insert(
                rel_path.clone(),
                DeployedFile {
                    mod_id,
                    link_type: _link_type,
                    source_path: source_path.to_string_lossy().to_string(),
                    deployed_at: chrono::Local::now().to_rfc3339(),
                },
            );
            deploy_count += 1;
        }

        // Save Global Manifest (Atomic)
        Self::save_atomic(&manifest_path, &global_manifest)?;

        Ok(deploy_count)
    }

    pub fn undeploy(&self, instance_id: &str, game_root: &str) -> Result<String, String> {
        let manifest_path = self.get_global_manifest_path(instance_id);
        if !manifest_path.exists() {
            return Ok("No files to undeploy.".to_string());
        }

        let content = match fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(e) => return Err(format!("Failed to read manifest: {}", e)),
        };

        let manifest: GlobalManifest = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => return Err(format!("Corrupt manifest file: {}", e)),
        };

        let game_root_path = Self::canonical_game_root(Path::new(game_root))?;
        let mut removed_count = 0;
        let mut failed_count = 0;
        let mut errors = Vec::new();

        // Remove files tracked in manifest
        // We use keys and iterate.
        // Sorting reverse alphabetically helps with directory cleanup but not strictly required if we just remove files.
        let mut files_to_remove: Vec<String> = manifest.files.keys().cloned().collect();
        files_to_remove.sort_by(|a, b| b.cmp(a)); // Reverse sort

        for rel_path in files_to_remove {
            let target_path = match Self::safe_game_path(&game_root_path, &rel_path) {
                Ok(path) => path,
                Err(e) => {
                    failed_count += 1;
                    errors.push(e);
                    continue;
                }
            };
            if target_path.exists() {
                // Safety: We only remove files tracked in our GlobalManifest
                if let Err(e) = fs::remove_file(&target_path) {
                    failed_count += 1;
                    errors.push(format!("Failed to remove {:?}: {}", rel_path, e));
                } else {
                    removed_count += 1;
                }
            }

            Self::remove_empty_parent(&target_path, &game_root_path);
        }

        // Remove manifest file
        let _ = fs::remove_file(manifest_path);

        if failed_count > 0 {
            // Log details for debugging but return a summary
            eprintln!(
                "[WARN] [ModManager] Partial undeploy. Failures: {:?}",
                errors
            );
            Ok(format!("Partially undeployed. Removed {} files. Failed to remove {} files (locked or permission denied).", removed_count, failed_count))
        } else {
            Ok(format!("Successfully undeployed {} files.", removed_count))
        }
    }

    pub fn toggle_mod(&self, instance_id: &str, mod_id: &str, enabled: bool) -> Result<(), String> {
        let mut mods = self.load_mods(instance_id);
        if let Some(m) = mods.iter_mut().find(|m| m.id == mod_id) {
            m.enabled = enabled;
            self.save_mods(instance_id, &mods)?;
            Ok(())
        } else {
            Err("Mod not found".to_string())
        }
    }

    pub fn load_profiles_config(&self, instance_id: &str) -> Result<ProfileConfig, String> {
        let path = self.get_profiles_config_path(instance_id);
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    match serde_json::from_str::<ProfileConfig>(&content) {
                        Ok(config) => {
                            // Consistency Check
                            if let Some(active_id) = &config.active_profile_id {
                                if !config.profiles.iter().any(|p| &p.id == active_id) {
                                    // Soft failure: Reset active profile instead of crashing
                                    eprintln!("[WARN] [ModManager] Active profile '{}' not found in profiles list. Resetting to None.", active_id);
                                    let mut fixed_config = config.clone();
                                    fixed_config.active_profile_id = None;
                                    return Ok(fixed_config);
                                }
                            }
                            return Ok(config);
                        }
                        Err(e) => {
                            eprintln!("[ERROR] [ModManager] Failed to parse profiles config: {}. Using default.", e);
                            // Return default if corrupt
                            return Ok(ProfileConfig {
                                schema_version: 1,
                                active_profile_id: None,
                                profiles: Vec::new(),
                            });
                        }
                    }
                }
                Err(e) => return Err(format!("Failed to read profiles config: {}", e)),
            }
        }
        // Default clean state
        Ok(ProfileConfig {
            schema_version: 1,
            active_profile_id: None,
            profiles: Vec::new(),
        })
    }

    pub fn save_profiles_config(
        &self,
        instance_id: &str,
        config: &ProfileConfig,
    ) -> Result<(), String> {
        let path = self.get_profiles_config_path(instance_id);
        Self::save_atomic(&path, config)
    }

    pub fn create_profile(&self, instance_id: &str, name: &str) -> Result<String, String> {
        let mut config = self.load_profiles_config(instance_id)?;
        let mods = self.load_mods(instance_id);

        // Collect enabled mods IDs in current load order
        let mods_state: Vec<ProfileModState> = mods
            .iter()
            .map(|m| ProfileModState {
                mod_id: m.id.clone(),
                enabled: m.enabled,
                load_order: m.load_order,
            })
            .collect();

        let profile_id = Uuid::new_v4().to_string();
        let timestamp = chrono::Local::now().to_rfc3339();

        let new_profile = Profile {
            id: profile_id.clone(),
            name: name.to_string(),
            instance_id: instance_id.to_string(),
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            last_used_at: Some(timestamp),
            mods_state,
            notes: None,
        };

        config.profiles.push(new_profile);
        config.active_profile_id = Some(profile_id.clone());

        self.save_profiles_config(instance_id, &config)?;
        Ok(profile_id)
    }

    pub fn switch_profile(&self, instance_id: &str, profile_id: &str) -> Result<String, String> {
        let mut config = self.load_profiles_config(instance_id)?;

        // Use position to get mutable reference later
        let profile_idx = config
            .profiles
            .iter()
            .position(|p| p.id == profile_id)
            .ok_or("Profile not found")?;

        // Clone for read access
        let profile = config.profiles[profile_idx].clone();

        let mut mods = self.load_mods(instance_id);
        let mut changes_count = 0;

        // Create lookup map for profile state
        let profile_map: HashMap<String, ProfileModState> = profile
            .mods_state
            .iter()
            .map(|ps| (ps.mod_id.clone(), ps.clone()))
            .collect();

        // Differential Update: Apply profile state to mods
        for m in mods.iter_mut() {
            if let Some(target_state) = profile_map.get(&m.id) {
                // Mod exists in profile -> Enforce profile state
                if m.enabled != target_state.enabled || m.load_order != target_state.load_order {
                    m.enabled = target_state.enabled;
                    m.load_order = target_state.load_order;
                    changes_count += 1;
                }
            } else {
                // Mod not in profile -> Disable it (Safety rule: Unknown mods shouldn't be active)
                if m.enabled {
                    m.enabled = false;
                    // Push disabled mods to the end to keep clean list
                    m.load_order += 9999;
                    changes_count += 1;
                }
            }
        }

        if changes_count > 0 {
            // Sort by load order
            mods.sort_by_key(|m| m.load_order);

            // Re-normalize load orders (0, 1, 2...) for enabled mods only?
            // Or just save as is? Saving as is respects the profile's intent better.
            // But let's keep the re-normalization for consistency if needed.
            // Actually, if we just applied explicit load orders, we should probably trust them.
            // But to be safe and clean:
            let mut current_order = 0;
            for m in mods.iter_mut() {
                if m.enabled {
                    m.load_order = current_order;
                    current_order += 1;
                }
            }

            self.save_mods(instance_id, &mods)?;
        }

        // Update active profile and timestamps
        config.active_profile_id = Some(profile_id.to_string());
        config.profiles[profile_idx].last_used_at = Some(chrono::Local::now().to_rfc3339());

        self.save_profiles_config(instance_id, &config)?;

        Ok(format!(
            "Switched to profile '{}'. Updated {} mods.",
            profile.name, changes_count
        ))
    }

    pub fn list_profiles(&self, instance_id: &str) -> Result<ProfileConfig, String> {
        self.load_profiles_config(instance_id)
    }

    pub fn delete_profile(&self, instance_id: &str, profile_id: &str) -> Result<(), String> {
        let mut config = self.load_profiles_config(instance_id)?;

        if let Some(pos) = config.profiles.iter().position(|p| p.id == profile_id) {
            config.profiles.remove(pos);

            if config.active_profile_id.as_deref() == Some(profile_id) {
                config.active_profile_id = None;
            }

            self.save_profiles_config(instance_id, &config)?;
            Ok(())
        } else {
            Err("Profile not found".to_string())
        }
    }

    pub fn get_active_profile_id(&self, instance_id: &str) -> Option<String> {
        match self.load_profiles_config(instance_id) {
            Ok(config) => config.active_profile_id,
            Err(_) => None,
        }
    }

    pub fn deployed_file_counts(
        &self,
        instance_id: &str,
    ) -> Result<HashMap<String, usize>, String> {
        let manifest_path = self.get_global_manifest_path(instance_id);
        if !manifest_path.exists() {
            return Ok(HashMap::new());
        }

        let content = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Failed to read deployment manifest: {error}"))?;
        let manifest: GlobalManifest = serde_json::from_str(&content)
            .map_err(|error| format!("Invalid deployment manifest: {error}"))?;
        let mut counts = HashMap::new();
        for deployed_file in manifest.files.values() {
            *counts.entry(deployed_file.mod_id.clone()).or_insert(0) += 1;
        }
        Ok(counts)
    }

    pub fn delete_mod(
        &self,
        instance_id: &str,
        mod_id: &str,
        game_root: &str,
    ) -> Result<DeleteModResult, AppError> {
        let normalized_mod_id = Self::normalize_rel_path(mod_id).map_err(|error| {
            AppError::new(
                "unsafe_mod_id",
                error,
                false,
                Some("Refresh the mod list and inspect the instance metadata."),
            )
        })?;
        if normalized_mod_id.components().count() != 1
            || normalized_mod_id.to_string_lossy() != mod_id
        {
            return Err(AppError::new(
                "unsafe_mod_id",
                "The mod identifier is not safe to use as a folder name.",
                false,
                Some("Refresh the mod list and inspect the instance metadata."),
            ));
        }

        let mods_path = self.get_mods_config_path(instance_id);
        let mut mods: Vec<Mod> =
            Self::read_json_strict(&mods_path, "mod catalog")?.ok_or_else(|| {
                AppError::new(
                    "mod_not_found",
                    "The mod is no longer present in this instance.",
                    true,
                    Some("Refresh the mod list."),
                )
            })?;
        let mod_position = mods
            .iter()
            .position(|mod_info| mod_info.id == mod_id)
            .ok_or_else(|| {
                AppError::new(
                    "mod_not_found",
                    "The mod is no longer present in this instance.",
                    true,
                    Some("Refresh the mod list."),
                )
            })?;
        let mod_info = mods[mod_position].clone();

        let game_root_path = Self::canonical_game_root(Path::new(game_root)).map_err(|error| {
            AppError::new(
                "instance_path_invalid",
                error,
                true,
                Some("Repair or relocate the instance, then retry."),
            )
        })?;
        let staging_base = self.get_staging_dir(instance_id);
        let staging_path = staging_base.join(mod_id);
        let profiles_path = self.get_profiles_config_path(instance_id);
        let manifest_path = self.get_global_manifest_path(instance_id);

        let mut profiles =
            Self::read_json_strict::<ProfileConfig>(&profiles_path, "profile configuration")?;
        let mut manifest =
            Self::read_json_strict::<GlobalManifest>(&manifest_path, "deployment manifest")?;

        let mut profile_references_removed = 0;
        if let Some(profile_config) = profiles.as_mut() {
            for profile in &mut profile_config.profiles {
                let previous_len = profile.mods_state.len();
                profile.mods_state.retain(|state| state.mod_id != mod_id);
                let removed = previous_len - profile.mods_state.len();
                if removed > 0 {
                    profile.updated_at = chrono::Local::now().to_rfc3339();
                    profile_references_removed += removed;
                }
            }
        }

        let deployed_entries: Vec<(String, DeployedFile)> = manifest
            .as_ref()
            .map(|deployment_manifest| {
                deployment_manifest
                    .files
                    .iter()
                    .filter(|(_, deployed_file)| deployed_file.mod_id == mod_id)
                    .map(|(path, deployed_file)| (path.clone(), deployed_file.clone()))
                    .collect()
            })
            .unwrap_or_default();

        mods.remove(mod_position);
        let mut metadata_updates = vec![MetadataUpdate {
            path: mods_path.clone(),
            original: fs::read(&mods_path).map_err(|error| {
                AppError::new(
                    "mod_metadata_read_failed",
                    format!("Failed to snapshot the mod catalog: {error}"),
                    true,
                    Some("Check file permissions, then retry."),
                )
            })?,
            replacement: Self::serialize_metadata(&mods, "mod catalog")?,
        }];

        if profile_references_removed > 0 {
            let profile_config = profiles.as_ref().ok_or_else(|| {
                AppError::new(
                    "mod_metadata_invalid",
                    "Profile references were found without a profile configuration.",
                    false,
                    Some("Open diagnostics and repair the instance metadata."),
                )
            })?;
            metadata_updates.push(MetadataUpdate {
                path: profiles_path.clone(),
                original: fs::read(&profiles_path).map_err(|error| {
                    AppError::new(
                        "mod_metadata_read_failed",
                        format!("Failed to snapshot the profile configuration: {error}"),
                        true,
                        Some("Check file permissions, then retry."),
                    )
                })?,
                replacement: Self::serialize_metadata(profile_config, "profile configuration")?,
            });
        }

        if !deployed_entries.is_empty() {
            let deployment_manifest = manifest.as_mut().ok_or_else(|| {
                AppError::new(
                    "mod_metadata_invalid",
                    "Deployed files were found without a deployment manifest.",
                    false,
                    Some("Run instance repair before deleting this mod."),
                )
            })?;
            for (relative_path, _) in &deployed_entries {
                deployment_manifest.files.remove(relative_path);
            }
            metadata_updates.push(MetadataUpdate {
                path: manifest_path.clone(),
                original: fs::read(&manifest_path).map_err(|error| {
                    AppError::new(
                        "mod_metadata_read_failed",
                        format!("Failed to snapshot the deployment manifest: {error}"),
                        true,
                        Some("Check file permissions, then retry."),
                    )
                })?,
                replacement: Self::serialize_metadata(deployment_manifest, "deployment manifest")?,
            });
        }

        let operation_id = Uuid::new_v4();
        let deployment_quarantine_root = Self::safe_game_path(
            &game_root_path,
            &format!(".kiza_trash/delete-{operation_id}"),
        )
        .map_err(|error| {
            AppError::new(
                "unsafe_deletion_quarantine",
                error,
                false,
                Some("Remove the unsafe .kiza_trash link, then retry."),
            )
        })?;
        let staging_quarantine_root = staging_base.join(format!(".delete-{operation_id}"));
        let mut staged_deletions = Vec::new();
        let mut deployed_files_removed = 0;
        let mut preserved_unmanaged_files = 0;
        let mut deployment_candidates = Vec::new();

        for (relative_path, deployed_file) in &deployed_entries {
            let normalized_path = Self::normalize_rel_string(relative_path).map_err(|error| {
                AppError::new(
                    "unsafe_deployment_path",
                    error,
                    false,
                    Some("Run instance repair before deleting this mod."),
                )
            })?;
            let target_path =
                Self::safe_game_path(&game_root_path, &normalized_path).map_err(|error| {
                    AppError::new(
                        "unsafe_deployment_path",
                        error,
                        false,
                        Some("Run instance repair before deleting this mod."),
                    )
                })?;

            if !Self::path_exists(&target_path) {
                continue;
            }

            let expected_source = staging_path.join(Path::new(&normalized_path));
            let is_managed = Self::deployment_target_is_managed(
                &target_path,
                &expected_source,
                &deployed_file.link_type,
            )
            .map_err(|error| {
                AppError::new(
                    "mod_delete_validation_failed",
                    error,
                    true,
                    Some("Close programs using the instance files, then retry."),
                )
            })?;

            if !is_managed {
                preserved_unmanaged_files += 1;
                continue;
            }

            let quarantine_path = deployment_quarantine_root
                .join("deployed")
                .join(Path::new(&normalized_path));
            deployment_candidates.push((target_path, quarantine_path));
        }

        for (target_path, quarantine_path) in deployment_candidates {
            match Self::stage_path_for_deletion(&target_path, &quarantine_path) {
                Ok(staged) => {
                    staged_deletions.push(staged);
                    deployed_files_removed += 1;
                }
                Err(error) => {
                    let rollback_errors = Self::rollback_staged_deletions(&staged_deletions);
                    return Err(Self::deletion_file_error(error, rollback_errors));
                }
            }
        }

        if Self::path_exists(&staging_path) {
            let quarantine_path = staging_quarantine_root.join(mod_id);
            match Self::stage_path_for_deletion(&staging_path, &quarantine_path) {
                Ok(staged) => staged_deletions.push(staged),
                Err(error) => {
                    let rollback_errors = Self::rollback_staged_deletions(&staged_deletions);
                    return Err(Self::deletion_file_error(error, rollback_errors));
                }
            }
        }

        if let Err(error) = Self::commit_metadata_updates(&metadata_updates) {
            let rollback_errors = Self::rollback_staged_deletions(&staged_deletions);
            let message = if rollback_errors.is_empty() {
                error
            } else {
                format!(
                    "{error}. File rollback also failed: {}",
                    rollback_errors.join("; ")
                )
            };
            return Err(AppError::new(
                "mod_delete_metadata_failed",
                message,
                true,
                Some("Retry the deletion or open diagnostics."),
            ));
        }

        for staged in staged_deletions.iter().take(deployed_files_removed) {
            Self::remove_empty_parent(&staged.original_path, &game_root_path);
        }

        let mut cleanup_pending = false;
        for quarantine_root in [&deployment_quarantine_root, &staging_quarantine_root] {
            if quarantine_root.exists() {
                if let Err(error) = fs::remove_dir_all(quarantine_root) {
                    cleanup_pending = true;
                    eprintln!(
                        "[WARN] [ModManager] Failed to clean deletion quarantine '{}': {error}",
                        quarantine_root.display()
                    );
                }
            }
        }

        Ok(DeleteModResult {
            mod_id: mod_info.id,
            mod_name: mod_info.name,
            was_enabled: mod_info.enabled,
            deployed_files_removed,
            profile_references_removed,
            preserved_unmanaged_files,
            shared_dependencies_preserved: 0,
            orphan_dependencies_removed: 0,
            orphan_dependencies_preserved: 0,
            cleanup_pending,
        })
    }

    #[allow(dead_code)]
    pub fn get_active_mod_count(&self, instance_id: &str) -> usize {
        self.load_mods(instance_id)
            .iter()
            .filter(|m| m.enabled)
            .count()
    }

    pub fn scan_residuals(
        &self,
        instance_id: &str,
        game_root: &str,
    ) -> Result<Vec<String>, String> {
        let manifest_path = self.get_global_manifest_path(instance_id);

        // 1. Load known deployed files (KizaaMod managed)
        let mut managed_files: std::collections::HashSet<String> = std::collections::HashSet::new();
        if manifest_path.exists() {
            if let Ok(content) = fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<GlobalManifest>(&content) {
                    for key in manifest.files.keys() {
                        managed_files.insert(key.clone());
                    }
                }
            }
        }

        let game_root_path = Self::canonical_game_root(Path::new(game_root))?;
        let mut residuals = Vec::new();

        // 2. Scan directory
        // Walkdir recursively
        for entry in WalkDir::new(&game_root_path)
            .min_depth(1)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() || entry.file_type().is_symlink() {
                // Get relative path
                if let Ok(rel_path) = entry.path().strip_prefix(&game_root_path) {
                    let rel_str = rel_path.to_string_lossy().to_string().replace("\\", "/");
                    if rel_str.starts_with(".kiza_backups/") || rel_str.starts_with(".kiza_trash/")
                    {
                        continue;
                    }

                    // Filter Logic:
                    // 1. Is it managed by us?
                    if managed_files.contains(&rel_str) {
                        continue;
                    }

                    // 2. Is it a vanilla file? (TODO: We need a vanilla manifest for this to be perfect)
                    // For now, we only detect "obvious" mod residuals like .archive, .esp, .pak in specific folders if possible?
                    // OR: We return ALL non-managed files and let user decide? That's dangerous for root files.

                    // Safer Heuristic:
                    // Only scan specific mod directories known for pollution?
                    // e.g. /archive/pc/mod, /mods, /Data

                    // MVP: Just list everything non-managed but allow frontend to filter?
                    // Or maybe exclude common executable types at root?

                    // Let's implement a basic exclusion list for root files to be safe
                    if entry.depth() == 1 {
                        if let Some(ext) = entry.path().extension() {
                            let ext_str = ext.to_string_lossy().to_lowercase();
                            if ext_str == "exe" || ext_str == "dll" || ext_str == "json" {
                                // Likely game files or important stuff, skip for now to reduce noise/danger
                                // Unless we are sure.
                                continue;
                            }
                        }
                    }

                    residuals.push(rel_str);
                }
            }
        }

        Ok(residuals)
    }

    pub fn delete_files(
        &self,
        _instance_id: &str,
        game_root: &str,
        files: Vec<String>,
    ) -> Result<String, String> {
        let game_root_path = Self::canonical_game_root(Path::new(game_root))?;
        let mut deleted_count = 0;
        let mut errors = Vec::new();

        for rel_path in files {
            let target_path = match Self::safe_game_path(&game_root_path, &rel_path) {
                Ok(path) => path,
                Err(e) => {
                    errors.push(e);
                    continue;
                }
            };
            if target_path.exists() {
                if let Err(e) = fs::remove_file(&target_path) {
                    errors.push(format!("Failed to delete {}: {}", rel_path, e));
                } else {
                    deleted_count += 1;
                    Self::remove_empty_parent(&target_path, &game_root_path);
                }
            }
        }

        if errors.is_empty() {
            Ok(format!("Deleted {} residual files.", deleted_count))
        } else {
            Ok(format!(
                "Deleted {} files. Failed to delete {} files.",
                deleted_count,
                errors.len()
            ))
        }
    }

    pub fn get_mod_path(&self, instance_id: &str, mod_id: &str) -> Result<String, String> {
        let path = self.get_staging_dir(instance_id).join(mod_id);
        if path.exists() {
            Ok(path.to_string_lossy().to_string())
        } else {
            Err("Mod folder not found".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn test_mod(mod_id: &str, enabled: bool) -> Mod {
        Mod {
            id: mod_id.to_string(),
            name: "Example Mod".to_string(),
            version: "1.0.0".to_string(),
            description: "Test fixture".to_string(),
            source: None,
            project_id: None,
            version_id: None,
            author: None,
            homepage_url: None,
            cover_url: None,
            cover_path: None,
            file_size: Some(3),
            game_versions: vec!["1.21.8".to_string()],
            loaders: vec!["fabric".to_string()],
            updated_at: None,
            enabled,
            install_date: "2026-07-17T00:00:00Z".to_string(),
            files: vec!["mods/example.jar".to_string()],
            load_order: 0,
        }
    }

    fn write_deployment_fixture(
        manager: &ModManager,
        instance_id: &str,
        game_root: &Path,
        target_contents_match: bool,
    ) -> (PathBuf, PathBuf) {
        let staging_file = manager
            .get_staging_dir(instance_id)
            .join("mod-a")
            .join("mods/example.jar");
        fs::create_dir_all(staging_file.parent().unwrap()).unwrap();
        fs::write(&staging_file, b"jar").unwrap();

        let target_file = game_root.join("mods/example.jar");
        fs::create_dir_all(target_file.parent().unwrap()).unwrap();
        if target_contents_match {
            fs::hard_link(&staging_file, &target_file).unwrap();
        } else {
            fs::write(&target_file, b"user replacement").unwrap();
        }

        let manifest = GlobalManifest {
            game_id: "minecraft".to_string(),
            files: HashMap::from([(
                "mods/example.jar".to_string(),
                DeployedFile {
                    mod_id: "mod-a".to_string(),
                    link_type: "hardlink".to_string(),
                    source_path: staging_file.to_string_lossy().to_string(),
                    deployed_at: "2026-07-17T00:00:00Z".to_string(),
                },
            )]),
        };
        ModManager::save_atomic(&manager.get_global_manifest_path(instance_id), &manifest).unwrap();

        (staging_file, target_file)
    }

    #[test]
    fn normalize_rel_path_rejects_escape_paths() {
        assert!(ModManager::normalize_rel_path("../evil.jar").is_err());
        assert!(ModManager::normalize_rel_path("/absolute/evil.jar").is_err());
        assert!(ModManager::normalize_rel_path("mods/../evil.jar").is_err());
        assert!(ModManager::normalize_rel_path("mods/sodium.jar").is_ok());
    }

    #[test]
    fn install_mod_file_rejects_target_traversal() {
        let temp = tempfile::tempdir().unwrap();
        let source_path = temp.path().join("source.jar");
        fs::write(&source_path, b"jar").unwrap();

        let manager = ModManager::new(temp.path().join("appdata"));
        let result = manager.install_mod_file(
            "instance-a",
            &source_path.to_string_lossy(),
            "../outside.jar",
            None,
        );

        assert!(result.is_err());
        assert!(!temp.path().join("appdata").join("outside.jar").exists());
    }

    #[test]
    fn install_mod_rejects_zip_path_traversal() {
        let temp = tempfile::tempdir().unwrap();
        let archive_path = temp.path().join("bad.zip");
        let file = fs::File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("../evil.txt", options).unwrap();
        zip.write_all(b"bad").unwrap();
        zip.finish().unwrap();

        let manager = ModManager::new(temp.path().join("appdata"));
        let result = manager.install_mod("instance-a", &archive_path.to_string_lossy());

        assert!(result.is_err());
        assert!(!temp.path().join("evil.txt").exists());
    }

    #[test]
    fn delete_mod_removes_deployed_files_catalog_and_profile_references() {
        let temp = tempfile::tempdir().unwrap();
        let app_data_dir = temp.path().join("appdata");
        let game_root = temp.path().join("instance");
        fs::create_dir_all(&game_root).unwrap();
        let manager = ModManager::new(app_data_dir);
        let instance_id = "instance-a";
        manager
            .save_mods(instance_id, &vec![test_mod("mod-a", true)])
            .unwrap();

        let profile_config = ProfileConfig {
            schema_version: 1,
            active_profile_id: Some("profile-a".to_string()),
            profiles: vec![Profile {
                id: "profile-a".to_string(),
                name: "Default".to_string(),
                instance_id: instance_id.to_string(),
                created_at: "2026-07-17T00:00:00Z".to_string(),
                updated_at: "2026-07-17T00:00:00Z".to_string(),
                last_used_at: None,
                mods_state: vec![ProfileModState {
                    mod_id: "mod-a".to_string(),
                    enabled: true,
                    load_order: 0,
                }],
                notes: None,
            }],
        };
        manager
            .save_profiles_config(instance_id, &profile_config)
            .unwrap();
        let (staging_file, target_file) =
            write_deployment_fixture(&manager, instance_id, &game_root, true);

        let result = manager
            .delete_mod(instance_id, "mod-a", &game_root.to_string_lossy())
            .unwrap();

        assert!(result.was_enabled);
        assert_eq!(result.deployed_files_removed, 1);
        assert_eq!(result.profile_references_removed, 1);
        assert_eq!(result.preserved_unmanaged_files, 0);
        assert!(!result.cleanup_pending);
        assert!(!target_file.exists());
        assert!(!staging_file.exists());
        assert!(manager.load_mods(instance_id).is_empty());

        let profiles = manager.load_profiles_config(instance_id).unwrap();
        assert!(profiles.profiles[0].mods_state.is_empty());
        assert_eq!(profiles.active_profile_id.as_deref(), Some("profile-a"));

        let manifest_content =
            fs::read_to_string(manager.get_global_manifest_path(instance_id)).unwrap();
        let manifest: GlobalManifest = serde_json::from_str(&manifest_content).unwrap();
        assert!(manifest.files.is_empty());
    }

    #[test]
    fn delete_mod_preserves_a_deployed_target_replaced_by_the_user() {
        let temp = tempfile::tempdir().unwrap();
        let app_data_dir = temp.path().join("appdata");
        let game_root = temp.path().join("instance");
        fs::create_dir_all(&game_root).unwrap();
        let manager = ModManager::new(app_data_dir);
        let instance_id = "instance-a";
        manager
            .save_mods(instance_id, &vec![test_mod("mod-a", false)])
            .unwrap();
        let (staging_file, target_file) =
            write_deployment_fixture(&manager, instance_id, &game_root, false);

        let result = manager
            .delete_mod(instance_id, "mod-a", &game_root.to_string_lossy())
            .unwrap();

        assert_eq!(result.deployed_files_removed, 0);
        assert_eq!(result.preserved_unmanaged_files, 1);
        assert_eq!(fs::read(&target_file).unwrap(), b"user replacement");
        assert!(!staging_file.exists());
        assert!(manager.load_mods(instance_id).is_empty());
    }

    #[test]
    fn delete_mod_does_not_touch_files_when_profile_metadata_is_invalid() {
        let temp = tempfile::tempdir().unwrap();
        let app_data_dir = temp.path().join("appdata");
        let game_root = temp.path().join("instance");
        fs::create_dir_all(&game_root).unwrap();
        let manager = ModManager::new(app_data_dir);
        let instance_id = "instance-a";
        manager
            .save_mods(instance_id, &vec![test_mod("mod-a", true)])
            .unwrap();
        let (staging_file, target_file) =
            write_deployment_fixture(&manager, instance_id, &game_root, true);
        let profiles_path = manager.get_profiles_config_path(instance_id);
        fs::create_dir_all(profiles_path.parent().unwrap()).unwrap();
        fs::write(&profiles_path, b"not-json").unwrap();

        let error = manager
            .delete_mod(instance_id, "mod-a", &game_root.to_string_lossy())
            .unwrap_err();

        assert_eq!(error.code, "mod_metadata_invalid");
        assert!(staging_file.exists());
        assert!(target_file.exists());
        assert_eq!(manager.load_mods(instance_id).len(), 1);
    }
}
