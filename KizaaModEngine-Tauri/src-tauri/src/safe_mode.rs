//! Finds which mod breaks the game, by halving.
//!
//! The player would otherwise disable mods one at a time: 40 mods, 40 launches.
//! Halving finds the culprit in about 6. The search itself is pure — the launch
//! results come in from outside — so the strategy is testable without ever
//! starting Minecraft.
//!
//! What it does *not* do: claim a culprit when the game was already broken
//! without mods. That case is reported as such, because disabling mods would
//! never fix it.

use serde::{Deserialize, Serialize};

/// One launch outcome, as observed by the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    Started,
    Crashed,
}

/// Decides whether a finished test launch counts as a crash, from what the
/// launcher observed rather than from what the player thought they saw.
///
/// A hunt that depends on someone reading a log correctly is a hunt that
/// reaches the wrong answer, so the launcher judges it:
///
/// * a non-zero exit code is decisive;
/// * a clean exit is normally a success — except that a game which never
///   reached its menu did not run, whatever it returned, and that is exactly
///   what a mod breaking startup produces.
///
/// The menu signal is only trusted when the base mod was present to report it.
/// On a version it does not support, `reached_menu` is None and the exit code
/// is all there is.
pub fn outcome_of(exit_code: Option<i32>, reached_menu: Option<bool>) -> RunOutcome {
    if exit_code.is_some_and(|code| code != 0) {
        return RunOutcome::Crashed;
    }
    match reached_menu {
        Some(false) => RunOutcome::Crashed,
        _ => RunOutcome::Started,
    }
}

/// What the session wants next.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum BisectionStep {
    /// Launch with mods disabled, to prove the game itself is fine.
    TestVanilla,
    /// Launch with exactly these mods enabled.
    TestSubset(Vec<String>),
    /// This single mod is responsible.
    Culprit(String),
    /// Every mod was enabled and nothing crashed.
    NoCulprit,
    /// The game crashed with no mods at all: mods are not the problem.
    BrokenWithoutMods,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeModeSession {
    pub instance_id: String,
    /// Mods that were enabled when the session started, in a stable order.
    pub candidates: Vec<String>,
    /// Narrowed range still under suspicion, as indices into `candidates`.
    pub low: usize,
    pub high: usize,
    /// Outcome of the vanilla run, once known.
    pub vanilla_outcome: Option<RunOutcome>,
    /// Outcome with every mod enabled. Without this the search would narrow
    /// down to a single mod and accuse it even when nothing ever crashed.
    pub all_outcome: Option<RunOutcome>,
    /// Launches performed so far, for the UI.
    pub runs: u32,
}

impl SafeModeSession {
    pub fn new(instance_id: &str, candidates: Vec<String>) -> Self {
        let high = candidates.len();
        Self {
            instance_id: instance_id.to_string(),
            candidates,
            low: 0,
            high,
            vanilla_outcome: None,
            all_outcome: None,
            runs: 0,
        }
    }

    /// The suspects still in play.
    fn suspects(&self) -> &[String] {
        &self.candidates[self.low..self.high]
    }

    /// What to launch next, given everything known so far.
    pub fn next_step(&self) -> BisectionStep {
        match self.vanilla_outcome {
            // Always establish the baseline first: without it, a "culprit"
            // could just be a game that never started.
            None => return BisectionStep::TestVanilla,
            Some(RunOutcome::Crashed) => return BisectionStep::BrokenWithoutMods,
            Some(RunOutcome::Started) => {}
        }

        if self.candidates.is_empty() {
            return BisectionStep::NoCulprit;
        }

        // Reproduce the crash with everything on before hunting. Skipping this
        // would let the search narrow to one mod and blame it even when the
        // instance never crashed at all.
        match self.all_outcome {
            None => return BisectionStep::TestSubset(self.candidates.clone()),
            Some(RunOutcome::Started) => return BisectionStep::NoCulprit,
            Some(RunOutcome::Crashed) => {}
        }

        match self.suspects().len() {
            0 => BisectionStep::NoCulprit,
            1 => BisectionStep::Culprit(self.suspects()[0].clone()),
            _ => {
                let middle = self.low + self.suspects().len() / 2;
                BisectionStep::TestSubset(self.candidates[self.low..middle].to_vec())
            }
        }
    }

    /// Feeds back the outcome of the step that was just run.
    pub fn record(&mut self, outcome: RunOutcome) {
        self.runs += 1;

        if self.vanilla_outcome.is_none() {
            self.vanilla_outcome = Some(outcome);
            return;
        }
        if self.vanilla_outcome == Some(RunOutcome::Crashed) {
            return;
        }
        if self.all_outcome.is_none() {
            self.all_outcome = Some(outcome);
            return;
        }
        if self.all_outcome == Some(RunOutcome::Started) || self.suspects().len() <= 1 {
            return;
        }

        let middle = self.low + self.suspects().len() / 2;
        match outcome {
            // The crash followed the first half: the culprit is in it.
            RunOutcome::Crashed => self.high = middle,
            // The first half is innocent; look in the other one.
            RunOutcome::Started => self.low = middle,
        }
    }

    /// Mods that must be enabled for the step about to run.
    pub fn enabled_for(&self, step: &BisectionStep) -> Vec<String> {
        match step {
            BisectionStep::TestVanilla => Vec::new(),
            BisectionStep::TestSubset(subset) => subset.clone(),
            BisectionStep::Culprit(mod_id) => vec![mod_id.clone()],
            // Nothing left to prove: put the instance back as it was.
            BisectionStep::NoCulprit | BisectionStep::BrokenWithoutMods => self.candidates.clone(),
        }
    }
}

/// Sessions live on disk so a hunt survives the launcher being closed between
/// two test launches — which is exactly what happens when the game crashes.
fn session_path(app_data_dir: &std::path::Path, instance_id: &str) -> std::path::PathBuf {
    app_data_dir
        .join("minecraft")
        .join("instances")
        .join(instance_id)
        .join("safe-mode.json")
}

pub fn load(app_data_dir: &std::path::Path, instance_id: &str) -> Option<SafeModeSession> {
    std::fs::read_to_string(session_path(app_data_dir, instance_id))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

pub fn save(app_data_dir: &std::path::Path, session: &SafeModeSession) -> Result<(), String> {
    let path = session_path(app_data_dir, &session.instance_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(session).map_err(|error| error.to_string())?;
    std::fs::write(&path, json)
        .map_err(|error| format!("Could not save the safe mode session: {error}"))
}

pub fn clear(app_data_dir: &std::path::Path, instance_id: &str) {
    let _ = std::fs::remove_file(session_path(app_data_dir, instance_id));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mods(count: usize) -> Vec<String> {
        (0..count).map(|index| format!("mod-{index}")).collect()
    }

    /// Drives a whole session against a known culprit and returns it plus the
    /// number of launches it took.
    fn hunt(count: usize, guilty: Option<&str>) -> (BisectionStep, u32) {
        let mut session = SafeModeSession::new("instance", mods(count));
        loop {
            let step = session.next_step();
            match &step {
                BisectionStep::Culprit(_)
                | BisectionStep::NoCulprit
                | BisectionStep::BrokenWithoutMods => return (step, session.runs),
                BisectionStep::TestVanilla => session.record(RunOutcome::Started),
                BisectionStep::TestSubset(subset) => {
                    let crashes = guilty.is_some_and(|id| subset.iter().any(|m| m == id));
                    session.record(if crashes {
                        RunOutcome::Crashed
                    } else {
                        RunOutcome::Started
                    });
                }
            }
        }
    }

    #[test]
    fn the_baseline_run_comes_first() {
        let session = SafeModeSession::new("instance", mods(8));
        // Without it, a crash could be the game's fault and we would still
        // accuse a mod.
        assert_eq!(session.next_step(), BisectionStep::TestVanilla);
        assert!(session.enabled_for(&BisectionStep::TestVanilla).is_empty());
    }

    #[test]
    fn a_game_that_crashes_without_mods_is_not_blamed_on_a_mod() {
        let mut session = SafeModeSession::new("instance", mods(8));
        session.record(RunOutcome::Crashed);

        assert_eq!(session.next_step(), BisectionStep::BrokenWithoutMods);
        // And the instance is put back as the user had it.
        assert_eq!(
            session.enabled_for(&BisectionStep::BrokenWithoutMods).len(),
            8
        );
    }

    #[test]
    fn the_culprit_is_found_wherever_it_sits() {
        for guilty in ["mod-0", "mod-3", "mod-7"] {
            let (step, _) = hunt(8, Some(guilty));
            assert_eq!(step, BisectionStep::Culprit(guilty.to_string()));
        }
    }

    #[test]
    fn halving_beats_one_at_a_time() {
        // 40 mods disabled one by one is 40 launches; halving is logarithmic.
        let (step, runs) = hunt(40, Some("mod-37"));
        assert_eq!(step, BisectionStep::Culprit("mod-37".to_string()));
        // 1 baseline + ceil(log2(40)) = 7 at most.
        assert!(runs <= 8, "took {runs} launches");
    }

    #[test]
    fn an_instance_that_never_crashes_reports_no_culprit() {
        let (step, _) = hunt(8, None);
        assert_eq!(step, BisectionStep::NoCulprit);
    }

    #[test]
    fn a_single_mod_is_accused_only_after_it_actually_crashed() {
        let mut session = SafeModeSession::new("instance", mods(1));
        assert_eq!(session.next_step(), BisectionStep::TestVanilla);

        session.record(RunOutcome::Started);
        // Even with one candidate, the crash has to be reproduced first.
        assert_eq!(
            session.next_step(),
            BisectionStep::TestSubset(vec!["mod-0".to_string()])
        );

        session.record(RunOutcome::Crashed);
        assert_eq!(
            session.next_step(),
            BisectionStep::Culprit("mod-0".to_string())
        );
    }

    #[test]
    fn a_lone_mod_that_runs_fine_is_not_accused() {
        let mut session = SafeModeSession::new("instance", mods(1));
        session.record(RunOutcome::Started); // vanilla
        session.record(RunOutcome::Started); // with the mod
        assert_eq!(session.next_step(), BisectionStep::NoCulprit);
    }

    #[test]
    fn an_instance_without_mods_has_nothing_to_hunt() {
        let mut session = SafeModeSession::new("instance", Vec::new());
        session.record(RunOutcome::Started);
        assert_eq!(session.next_step(), BisectionStep::NoCulprit);
    }

    #[test]
    fn a_non_zero_exit_is_a_crash_whatever_else_happened() {
        assert_eq!(outcome_of(Some(1), Some(true)), RunOutcome::Crashed);
        assert_eq!(outcome_of(Some(-1), None), RunOutcome::Crashed);
    }

    #[test]
    fn a_game_that_never_reached_its_menu_did_not_run() {
        // The case a mod breaking startup produces: the process tidies itself
        // up and returns 0, but nothing ever loaded.
        assert_eq!(outcome_of(Some(0), Some(false)), RunOutcome::Crashed);
    }

    #[test]
    fn a_clean_launch_the_player_simply_quit_is_not_a_crash() {
        assert_eq!(outcome_of(Some(0), Some(true)), RunOutcome::Started);
        // Killed from outside, with no code to read, having reached the menu.
        assert_eq!(outcome_of(None, Some(true)), RunOutcome::Started);
    }

    #[test]
    fn without_the_base_mod_the_exit_code_is_all_there_is() {
        // On a version the mod does not support there is no menu signal at all,
        // and treating its absence as a crash would accuse every mod in turn.
        assert_eq!(outcome_of(Some(0), None), RunOutcome::Started);
    }
}
