use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const CURRENT_SETUP_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FirstRunSetupState {
    pub schema_version: u32,
    pub setup_version: u32,
    pub setup_completed: bool,
    pub completed_at: Option<String>,
    pub selected_performance_profile: String,
    pub skipped_steps: Vec<String>,
}

impl Default for FirstRunSetupState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            setup_version: CURRENT_SETUP_VERSION,
            setup_completed: false,
            completed_at: None,
            selected_performance_profile: "balanced".to_string(),
            skipped_steps: Vec::new(),
        }
    }
}

fn setup_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config").join("first_run_setup.json")
}

fn has_existing_user_state(app_data_dir: &Path) -> bool {
    app_data_dir
        .join("config")
        .join("app_settings.json")
        .exists()
        || app_data_dir.join("games").exists()
        || app_data_dir.join("minecraft").exists()
}

pub fn load_setup_state(app_data_dir: &Path) -> FirstRunSetupState {
    let path = setup_path(app_data_dir);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mut state) = serde_json::from_str::<FirstRunSetupState>(&content) {
                state.setup_version = state.setup_version.max(CURRENT_SETUP_VERSION);
                if state.selected_performance_profile.trim().is_empty() {
                    state.selected_performance_profile = "balanced".to_string();
                }
                return state;
            }
        }
    }

    let mut state = FirstRunSetupState::default();
    if has_existing_user_state(app_data_dir) {
        state.setup_completed = true;
        state.completed_at = Some(chrono::Local::now().to_rfc3339());
        state
            .skipped_steps
            .push("migration_existing_install".to_string());
        let _ = save_setup_state(app_data_dir, &state);
    }
    state
}

pub fn save_setup_state(app_data_dir: &Path, state: &FirstRunSetupState) -> Result<(), String> {
    let path = setup_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn complete_setup_state(
    app_data_dir: &Path,
    selected_performance_profile: String,
    skipped_steps: Vec<String>,
) -> Result<FirstRunSetupState, String> {
    let mut state = load_setup_state(app_data_dir);
    state.schema_version = 1;
    state.setup_version = CURRENT_SETUP_VERSION;
    state.setup_completed = true;
    state.completed_at = Some(chrono::Local::now().to_rfc3339());
    state.selected_performance_profile = if selected_performance_profile.trim().is_empty() {
        "balanced".to_string()
    } else {
        selected_performance_profile
    };
    state.skipped_steps = skipped_steps;
    save_setup_state(app_data_dir, &state)?;
    Ok(state)
}
