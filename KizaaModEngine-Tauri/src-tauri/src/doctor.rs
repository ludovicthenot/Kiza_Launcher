//! What the doctor did to an instance, and whether it helped.
//!
//! A fix is a guess with evidence: "switch this mod off", "put that one
//! back", "replace this release". The launcher used to make the change and
//! forget it had; when the next launch crashed too, the person was left with
//! a modified instance and no way back but memory. Now every fix is
//! preceded by a restore point and followed by a question the next launch
//! answers -- did it help -- so a fix that did not can be undone in one
//! click, and one that did is quietly retired.

use crate::crash_doctor::CrashAction;
use crate::restore_points;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The game came up after the fix.
    Helped,
    /// The game crashed again after the fix.
    StillCrashing,
}

/// A fix that was applied, waiting for a launch to judge it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PendingFix {
    pub restore_point_id: String,
    pub applied_at: String,
    /// One line for the interface: "Switched off SRParasites-1.10.9.jar".
    pub summary: String,
    /// Every step, in the words the panel used.
    pub steps: Vec<String>,
    /// Absent until a launch has finished.
    pub outcome: Option<Outcome>,
}

fn path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    app_data_dir
        .join("doctor")
        .join(format!("{instance_id}.json"))
}

pub fn load(app_data_dir: &Path, instance_id: &str) -> Option<PendingFix> {
    let raw = fs::read_to_string(path(app_data_dir, instance_id)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save(app_data_dir: &Path, instance_id: &str, fix: &PendingFix) -> Result<(), String> {
    let target = path(app_data_dir, instance_id);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(fix).map_err(|error| error.to_string())?;
    fs::write(target, json).map_err(|error| error.to_string())
}

pub fn clear(app_data_dir: &Path, instance_id: &str) {
    let _ = fs::remove_file(path(app_data_dir, instance_id));
}

/// Takes the restore point a fix will be undone from, and remembers the fix.
///
/// Called before the first change. One fix per instance at a time: a new
/// one replaces the record, not the restore point, which stays in the list
/// like any other.
pub fn begin(
    app_data_dir: &Path,
    instance_id: &str,
    game_dir: &Path,
    summary: &str,
    steps: Vec<String>,
) -> Result<PendingFix, String> {
    let point = restore_points::create(
        app_data_dir,
        instance_id,
        game_dir,
        &format!("Before the doctor's fix: {summary}"),
        None,
    )?;
    let fix = PendingFix {
        restore_point_id: point.id,
        applied_at: chrono::Utc::now().to_rfc3339(),
        summary: summary.to_string(),
        steps,
        outcome: None,
    };
    save(app_data_dir, instance_id, &fix)?;
    Ok(fix)
}

/// What a finished launch says about the last fix.
///
/// A launch that came up retires the fix: the restore point stays, the
/// question is answered. One that crashed keeps it, marked, so the panel
/// can offer to undo. A stop the person asked for says nothing either way.
pub fn note_launch(app_data_dir: &Path, instance_id: &str, crashed: bool) {
    let Some(mut fix) = load(app_data_dir, instance_id) else {
        return;
    };
    if crashed {
        fix.outcome = Some(Outcome::StillCrashing);
        let _ = save(app_data_dir, instance_id, &fix);
    } else {
        clear(app_data_dir, instance_id);
    }
}

/// Puts the instance back as it was before the fix, and forgets the fix.
pub fn undo(app_data_dir: &Path, instance_id: &str, game_dir: &Path) -> Result<PendingFix, String> {
    let fix = load(app_data_dir, instance_id).ok_or("There is no fix to undo.")?;
    restore_points::restore(app_data_dir, instance_id, &fix.restore_point_id, game_dir)?;
    clear(app_data_dir, instance_id);
    Ok(fix)
}

/// The words the record keeps for an action.
pub fn describe(action: &CrashAction) -> String {
    match action {
        CrashAction::DisableMod(file) => format!("Switched off {file}"),
        CrashAction::EnableMod(file) => {
            format!("Switched on {}", file.trim_end_matches(".disabled"))
        }
        CrashAction::UseJava(version) => format!("Switched to Java {version}"),
        CrashAction::IncreaseMemory => "Raised the memory".to_string(),
        CrashAction::Repair => "Repaired the instance files".to_string(),
        CrashAction::SafeMode => "Launched without mods".to_string(),
        CrashAction::UpdateGraphicsDriver => "Updated the graphics driver".to_string(),
    }
}

/// Carries out the folder-side actions: switching a mod off or on.
///
/// The others are settings or long jobs the interface drives itself. The
/// file is renamed rather than moved out, so the restore point and a
/// glance at the folder both tell the same story.
pub fn apply_in_folder(mods_dir: &Path, action: &CrashAction) -> Result<(), String> {
    match action {
        CrashAction::DisableMod(file) => {
            let from = mods_dir.join(file);
            let to = mods_dir.join(format!("{file}.disabled"));
            if !from.is_file() {
                return Err(format!("{file} is not in the mods folder."));
            }
            fs::rename(&from, &to).map_err(|error| format!("Could not switch off {file}: {error}"))
        }
        CrashAction::EnableMod(file) => {
            let from = mods_dir.join(file);
            let to = mods_dir.join(file.trim_end_matches(".disabled"));
            if !from.is_file() {
                return Err(format!("{file} is not in the mods folder."));
            }
            fs::rename(&from, &to).map_err(|error| format!("Could not switch on {file}: {error}"))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole life of a fix: taken with a restore point, judged by the
    /// next launch, undone when that launch crashed.
    #[test]
    fn a_fix_that_did_not_help_is_undone_from_its_restore_point() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("data");
        let game = root.path().join("game");
        let mods = game.join("mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("bad.jar"), b"bad").unwrap();
        fs::write(mods.join("good.jar.disabled"), b"good").unwrap();

        let steps = vec![
            CrashAction::DisableMod("bad.jar".to_string()),
            CrashAction::EnableMod("good.jar.disabled".to_string()),
        ];
        let fix = begin(
            &app_data,
            "i",
            &game,
            "Switched off bad.jar",
            steps.iter().map(describe).collect(),
        )
        .unwrap();
        for step in &steps {
            apply_in_folder(&mods, step).unwrap();
        }
        assert!(mods.join("bad.jar.disabled").is_file());
        assert!(mods.join("good.jar").is_file());
        assert_eq!(load(&app_data, "i").unwrap().outcome, None);

        // The next launch crashed: the fix is kept, marked.
        note_launch(&app_data, "i", true);
        assert_eq!(
            load(&app_data, "i").unwrap().outcome,
            Some(Outcome::StillCrashing)
        );

        // Undone: the folder is as it was, the record is gone.
        let undone = undo(&app_data, "i", &game).unwrap();
        assert_eq!(undone.restore_point_id, fix.restore_point_id);
        assert!(mods.join("bad.jar").is_file());
        assert!(mods.join("good.jar.disabled").is_file());
        assert!(!mods.join("bad.jar.disabled").exists());
        assert!(load(&app_data, "i").is_none());
        assert!(undo(&app_data, "i", &game).is_err());
    }

    /// A launch that came up retires the fix without a word.
    #[test]
    fn a_fix_that_helped_is_retired() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("data");
        let game = root.path().join("game");
        fs::create_dir_all(game.join("mods")).unwrap();
        begin(&app_data, "i", &game, "x", vec![]).unwrap();
        note_launch(&app_data, "i", false);
        assert!(load(&app_data, "i").is_none());
        // Nothing pending: a launch says nothing.
        note_launch(&app_data, "i", true);
        assert!(load(&app_data, "i").is_none());
    }

    #[test]
    fn the_folder_actions_refuse_a_file_that_is_not_there() {
        let root = tempfile::tempdir().unwrap();
        let mods = root.path().join("mods");
        fs::create_dir_all(&mods).unwrap();
        assert!(apply_in_folder(&mods, &CrashAction::DisableMod("nope.jar".to_string())).is_err());
        assert!(apply_in_folder(
            &mods,
            &CrashAction::EnableMod("nope.jar.disabled".to_string())
        )
        .is_err());
        assert!(apply_in_folder(&mods, &CrashAction::Repair).is_ok());
    }
}
