//! Why an instance runs badly, from what the launcher can actually measure.
//!
//! The honest constraint here is that the launcher is outside the game: it
//! cannot see frames. So this advisor never claims an FPS number. It works from
//! three things it can genuinely observe:
//!
//! * the JVM the game was given — heap sizes, Java version, collector flags;
//! * the garbage collector's own log, when a run was measured, which is where
//!   Minecraft's stutter overwhelmingly comes from;
//! * how long the game took to reach the menu, timed by the launcher between
//!   spawning the process and the base mod's first heartbeat.
//!
//! Everything below is a pure function of those observations, so the rules can
//! be argued with in tests rather than in a running game. And, like the Crash
//! Doctor, it says nothing when it has nothing to say: a healthy instance must
//! produce an empty list, not a page of filler advice.

use serde::{Deserialize, Serialize};

/// What one measured run's GC log amounts to.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct GcSummary {
    pub pauses: usize,
    pub total_pause_ms: f64,
    pub max_pause_ms: f64,
    /// Highest heap occupancy observed *after* a collection, in MiB. This is the
    /// number that says whether the heap is big enough: what survives a
    /// collection is what the game genuinely needs.
    pub max_heap_after_mb: u32,
    /// Heap size the JVM reported, in MiB.
    pub heap_total_mb: u32,
}

impl GcSummary {
    /// Share of the heap still occupied after the worst collection.
    pub fn pressure(&self) -> Option<f64> {
        if self.heap_total_mb == 0 {
            return None;
        }
        Some(f64::from(self.max_heap_after_mb) / f64::from(self.heap_total_mb))
    }
}

/// Reads a unified-logging (`-Xlog:gc`) log.
///
/// A line looks like:
/// `[3.214s][info][gc] GC(7) Pause Young (Normal) (G1 Evacuation Pause) 250M->48M(1024M) 12.345ms`
///
/// Only lines carrying both a heap transition and a duration are counted. The
/// log also contains starts, concurrent phases and headers, and counting those
/// as pauses would inflate every number here.
pub fn parse_gc_log(text: &str) -> GcSummary {
    let mut summary = GcSummary::default();

    for line in text.lines() {
        if !line.contains("Pause") {
            continue;
        }
        let Some((before_after, duration_ms)) = parse_gc_line(line) else {
            continue;
        };
        let (_before_mb, after_mb, total_mb) = before_after;

        summary.pauses += 1;
        summary.total_pause_ms += duration_ms;
        summary.max_pause_ms = summary.max_pause_ms.max(duration_ms);
        summary.max_heap_after_mb = summary.max_heap_after_mb.max(after_mb);
        // The heap grows during a run; the last value is the one in force.
        summary.heap_total_mb = total_mb;
    }

    summary
}

/// Pulls `250M->48M(1024M)` and the trailing `12.345ms` out of one line.
fn parse_gc_line(line: &str) -> Option<((u32, u32, u32), f64)> {
    let arrow = line.find("->")?;
    let before_start = line[..arrow].rfind(' ').map(|index| index + 1).unwrap_or(0);
    let before = parse_size(&line[before_start..arrow])?;

    let rest = &line[arrow + 2..];
    let open = rest.find('(')?;
    let close = rest[open..].find(')')? + open;
    let after = parse_size(&rest[..open])?;
    let total = parse_size(&rest[open + 1..close])?;

    // The duration is the last whitespace-separated token ending in "ms".
    let duration = rest[close + 1..]
        .split_whitespace()
        .find_map(|token| token.strip_suffix("ms")?.parse::<f64>().ok())?;

    Some(((before, after, total), duration))
}

/// `1024M`, `48K` or `2G` to MiB.
fn parse_size(token: &str) -> Option<u32> {
    let token = token.trim();
    let (number, scale) = match token.chars().last()? {
        'K' => (&token[..token.len() - 1], 1.0 / 1024.0),
        'M' => (&token[..token.len() - 1], 1.0),
        'G' => (&token[..token.len() - 1], 1024.0),
        'B' => (&token[..token.len() - 1], 1.0 / (1024.0 * 1024.0)),
        _ => return None,
    };
    let value: f64 = number.trim().parse().ok()?;
    Some((value * scale).round() as u32)
}

/// Everything the advisor is allowed to reason from.
#[derive(Debug, Clone)]
pub struct Observation {
    pub total_ram_mb: Option<u32>,
    pub xmx_mb: u32,
    pub xms_mb: u32,
    pub jvm_args: Vec<String>,
    pub java_major: u32,
    /// The Java version this Minecraft version is meant to run on.
    pub recommended_java_major: u32,
    /// The minor of the Minecraft version, e.g. 21 for 1.21.1.
    pub mc_minor: u32,
    /// "vanilla", "fabric" or "forge".
    pub loader: String,
    /// File names of the enabled mods, lowercased by the caller or not — the
    /// matching here is case-insensitive either way.
    pub mods: Vec<String>,
    pub gc: Option<GcSummary>,
    pub seconds_to_menu: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdviceSeverity {
    /// Actively costing the player frames or stability right now.
    Critical,
    /// Likely costing something, or a configuration that will bite later.
    Warning,
    /// A real improvement, but the instance is fine without it.
    Tip,
}

/// Something the launcher can do about it, if the user agrees.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum AdviceAction {
    SetMaxMemory(u32),
    SetMinMemory(u32),
    UseJava(u32),
    /// A mod worth installing, by the name a search will find.
    InstallMod(String),
    /// A file name already in the instance that should go.
    RemoveMod(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Advice {
    /// Stable identifier, so the UI can remember a dismissal.
    pub id: String,
    pub severity: AdviceSeverity,
    pub title: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<AdviceAction>,
}

fn has_mod(mods: &[String], needle: &str) -> Option<String> {
    mods.iter()
        .find(|name| name.to_lowercase().contains(needle))
        .cloned()
}

/// The renderer replacement that exists for this loader, if any.
fn renderer_for(loader: &str, mc_minor: u32) -> Option<(&'static str, &'static str)> {
    // Neither project existed before 1.16, and recommending one for 1.8 would
    // send the user looking for something that does not exist.
    if mc_minor < 16 {
        return None;
    }
    match loader {
        "fabric" => Some(("sodium", "Sodium")),
        "forge" => Some(("embeddium", "Embeddium")),
        _ => None,
    }
}

/// Turns observations into advice, most serious first.
pub fn analyse(observation: &Observation) -> Vec<Advice> {
    let mut advice = Vec::new();

    // --- Heap ------------------------------------------------------------
    if let Some(total) = observation.total_ram_mb {
        // Minecraft is not the only thing that needs memory: the OS page cache
        // is what keeps chunk loading off the disk, and the graphics driver has
        // its own. Handing the JVM most of the machine makes the game slower.
        let ceiling = (u64::from(total) * 60 / 100) as u32;
        if observation.xmx_mb > ceiling {
            let suggested = ceiling.max(2048);
            advice.push(Advice {
                id: "heap-too-large-for-machine".to_string(),
                severity: AdviceSeverity::Critical,
                title: "More memory is reserved than this machine can spare".to_string(),
                detail: format!(
                    "{} MB of the {total} MB installed are reserved for Minecraft. Windows and the graphics driver need the rest, and what is left over caches your chunks. Past about {ceiling} MB, more memory makes the game slower, not faster.",
                    observation.xmx_mb
                ),
                action: Some(AdviceAction::SetMaxMemory(suggested)),
            });
        }
    }

    if let Some(gc) = &observation.gc {
        if let Some(pressure) = gc.pressure() {
            if pressure > 0.85 && gc.pauses > 0 {
                // What is still there after a collection is what the game truly
                // needs. If that is nearly the whole heap, the collector is
                // running constantly and freeing almost nothing.
                let suggested = (observation.xmx_mb + observation.xmx_mb / 2).max(4096);
                advice.push(Advice {
                    id: "heap-too-small".to_string(),
                    severity: AdviceSeverity::Critical,
                    title: "The heap is nearly full after every collection".to_string(),
                    detail: format!(
                        "{} MB of the {} MB heap were still in use straight after a collection. The collector is running constantly and freeing almost nothing, which is what long freezes feel like.",
                        gc.max_heap_after_mb, gc.heap_total_mb
                    ),
                    action: Some(AdviceAction::SetMaxMemory(suggested)),
                });
            }
        }

        if gc.max_pause_ms >= 200.0 {
            advice.push(Advice {
                id: "long-gc-pauses".to_string(),
                severity: AdviceSeverity::Warning,
                title: format!("The game froze for {:.0} ms during a collection", gc.max_pause_ms),
                detail: format!(
                    "Across {} collections the longest froze the game for {:.0} ms — at 60 FPS that is {:.0} lost frames in one go. This is the stutter players describe as lag spikes.",
                    gc.pauses,
                    gc.max_pause_ms,
                    gc.max_pause_ms / 16.7
                ),
                action: None,
            });
        }
    }

    if observation.xms_mb != observation.xmx_mb && observation.xmx_mb > 0 {
        advice.push(Advice {
            id: "heap-resizes-during-play".to_string(),
            severity: AdviceSeverity::Tip,
            title: "The heap is allowed to grow while you play".to_string(),
            detail: format!(
                "The JVM starts at {} MB and grows to {} MB, and every growth is a pause. Starting at the maximum costs nothing on a machine that has the memory anyway.",
                observation.xms_mb, observation.xmx_mb
            ),
            action: Some(AdviceAction::SetMinMemory(observation.xmx_mb)),
        });
    }

    // --- Java ------------------------------------------------------------
    if observation.java_major < observation.recommended_java_major {
        advice.push(Advice {
            id: "old-java".to_string(),
            severity: AdviceSeverity::Warning,
            title: format!(
                "Running on Java {} where this version expects Java {}",
                observation.java_major, observation.recommended_java_major
            ),
            detail: "Newer Java releases collect garbage in shorter bursts, which is exactly the pause the game shows as a stutter.".to_string(),
            action: Some(AdviceAction::UseJava(observation.recommended_java_major)),
        });
    }

    let uses_g1 = observation
        .jvm_args
        .iter()
        .any(|argument| argument.contains("UseG1GC"));
    let picks_a_collector = observation.jvm_args.iter().any(|argument| {
        argument.contains("UseG1GC")
            || argument.contains("UseZGC")
            || argument.contains("UseShenandoah")
            || argument.contains("UseParallelGC")
    });
    if !picks_a_collector && observation.xmx_mb >= 4096 {
        advice.push(Advice {
            id: "no-collector-chosen".to_string(),
            severity: AdviceSeverity::Warning,
            title: "No garbage collector is chosen for a large heap".to_string(),
            detail: "On a heap this size the default collector pauses the game for longer than G1 would. Kiza's performance profiles set this for you.".to_string(),
            action: None,
        });
    } else if uses_g1
        && !observation
            .jvm_args
            .iter()
            .any(|argument| argument.contains("MaxGCPauseMillis"))
    {
        advice.push(Advice {
            id: "no-pause-target".to_string(),
            severity: AdviceSeverity::Tip,
            title: "G1 has no pause target".to_string(),
            detail: "G1 aims for 200 ms by default, which is long enough to feel. Asking for shorter pauses trades a little throughput for smoother play.".to_string(),
            action: None,
        });
    }

    // --- Mods ------------------------------------------------------------
    let optifine = has_mod(&observation.mods, "optifine");
    let sodium = has_mod(&observation.mods, "sodium");
    let embeddium =
        has_mod(&observation.mods, "embeddium").or_else(|| has_mod(&observation.mods, "rubidium"));

    if let (Some(optifine), Some(other)) = (optifine.clone(), sodium.clone().or(embeddium.clone()))
    {
        advice.push(Advice {
            id: "two-renderers".to_string(),
            severity: AdviceSeverity::Critical,
            title: "Two renderers are installed at once".to_string(),
            detail: format!(
                "{optifine} and {other} both replace Minecraft's renderer. Together they conflict, and the usual result is a crash or worse performance than either alone."
            ),
            action: Some(AdviceAction::RemoveMod(optifine)),
        });
    } else if optifine.is_none() && sodium.is_none() && embeddium.is_none() {
        if let Some((_, name)) = renderer_for(&observation.loader, observation.mc_minor) {
            advice.push(Advice {
                id: "no-renderer".to_string(),
                severity: AdviceSeverity::Tip,
                title: format!("{name} is not installed"),
                detail: format!(
                    "{name} rewrites Minecraft's chunk renderer and is the single biggest frame-rate change available for this version."
                ),
                action: Some(AdviceAction::InstallMod(name.to_string())),
            });
        }
    }

    // --- Startup ---------------------------------------------------------
    if let Some(seconds) = observation.seconds_to_menu {
        if seconds >= 120.0 {
            advice.push(Advice {
                id: "slow-startup".to_string(),
                severity: AdviceSeverity::Tip,
                title: format!("The game took {:.0} s to reach the menu", seconds),
                detail: format!(
                    "{} mods are loaded at startup. This costs nothing once you are playing, but it is worth knowing where the wait comes from.",
                    observation.mods.len()
                ),
                action: None,
            });
        }
    }

    advice.sort_by_key(|item| match item.severity {
        AdviceSeverity::Critical => 0,
        AdviceSeverity::Warning => 1,
        AdviceSeverity::Tip => 2,
    });
    advice
}

/// One measured launch, kept so a change can be judged against the run before it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunSample {
    pub id: String,
    pub instance_id: String,
    pub recorded_at: String,
    /// What was changed since the previous run, in the user's words.
    #[serde(default)]
    pub label: String,
    pub xmx_mb: u32,
    pub java_major: u32,
    pub mod_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds_to_menu: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gc: Option<GcSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Better,
    Worse,
    /// Within the noise: two runs of the same setup never agree exactly, and
    /// calling a 3 % difference an improvement would make every change look
    /// like a success.
    Unchanged,
    /// One of the two runs did not measure this.
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Comparison {
    pub startup: Direction,
    pub startup_delta_seconds: Option<f64>,
    pub worst_pause: Direction,
    pub worst_pause_delta_ms: Option<f64>,
    pub total_pause: Direction,
    pub total_pause_delta_ms: Option<f64>,
}

/// A difference below this share of the earlier value is noise, not a result.
const NOISE: f64 = 0.10;

fn direction(before: Option<f64>, after: Option<f64>) -> (Direction, Option<f64>) {
    let (Some(before), Some(after)) = (before, after) else {
        return (Direction::Unknown, None);
    };
    let delta = after - before;
    if before <= 0.0 || (delta.abs() / before) < NOISE {
        return (Direction::Unchanged, Some(delta));
    }
    // Every metric here is a duration: lower is better.
    if delta < 0.0 {
        (Direction::Better, Some(delta))
    } else {
        (Direction::Worse, Some(delta))
    }
}

pub fn compare(before: &RunSample, after: &RunSample) -> Comparison {
    let (startup, startup_delta_seconds) = direction(before.seconds_to_menu, after.seconds_to_menu);
    let (worst_pause, worst_pause_delta_ms) = direction(
        before.gc.as_ref().map(|gc| gc.max_pause_ms),
        after.gc.as_ref().map(|gc| gc.max_pause_ms),
    );
    let (total_pause, total_pause_delta_ms) = direction(
        before.gc.as_ref().map(|gc| gc.total_pause_ms),
        after.gc.as_ref().map(|gc| gc.total_pause_ms),
    );

    Comparison {
        startup,
        startup_delta_seconds,
        worst_pause,
        worst_pause_delta_ms,
        total_pause,
        total_pause_delta_ms,
    }
}

/// The flag that makes a run measurable, for the Java in use.
///
/// Unified logging arrived in Java 9; asking Java 8 for it stops the JVM from
/// starting at all, which would turn "measure this launch" into "break this
/// launch".
pub fn gc_log_argument(java_major: u32, log_path: &std::path::Path) -> Option<String> {
    if java_major < 9 {
        return None;
    }
    Some(format!("-Xlog:gc:file={}", log_path.display()))
}

/// Reads the heap sizes back out of the arguments the game is actually given,
/// rather than out of the settings that were meant to produce them.
///
/// A per-instance override, a performance profile and the user's own extra
/// arguments all end up in the same list, and the JVM obeys the last `-Xmx` it
/// sees. Parsing the final list is the only way to report what is really in
/// force.
pub fn parse_heap_args(args: &[String]) -> (u32, u32) {
    let mut xms = 0;
    let mut xmx = 0;
    for argument in args {
        if let Some(value) = argument.strip_prefix("-Xms") {
            if let Some(mb) = parse_jvm_size(value) {
                xms = mb;
            }
        } else if let Some(value) = argument.strip_prefix("-Xmx") {
            if let Some(mb) = parse_jvm_size(value) {
                xmx = mb;
            }
        }
    }
    (xms, xmx)
}

/// `4096M`, `4G`, `4096m` or a bare byte count, to MiB.
fn parse_jvm_size(value: &str) -> Option<u32> {
    let value = value.trim();
    let (number, scale) = match value.chars().last()? {
        'k' | 'K' => (&value[..value.len() - 1], 1.0 / 1024.0),
        'm' | 'M' => (&value[..value.len() - 1], 1.0),
        'g' | 'G' => (&value[..value.len() - 1], 1024.0),
        _ => (value, 1.0 / (1024.0 * 1024.0)),
    };
    let parsed: f64 = number.parse().ok()?;
    Some((parsed * scale).round() as u32)
}

// --- Stored runs ---------------------------------------------------------

/// How many runs are kept per instance. Enough to see a change hold up across a
/// few launches, not so many that the list stops being readable.
const KEPT_RUNS: usize = 20;

fn directory(app_data_dir: &std::path::Path, instance_id: &str) -> std::path::PathBuf {
    app_data_dir.join("performance").join(instance_id)
}

/// Where the JVM writes the log for a measured run.
pub fn gc_log_path(app_data_dir: &std::path::Path, instance_id: &str) -> std::path::PathBuf {
    directory(app_data_dir, instance_id).join("gc.log")
}

fn request_path(app_data_dir: &std::path::Path, instance_id: &str) -> std::path::PathBuf {
    directory(app_data_dir, instance_id).join("measure-next-launch")
}

fn runs_path(app_data_dir: &std::path::Path, instance_id: &str) -> std::path::PathBuf {
    directory(app_data_dir, instance_id).join("runs.json")
}

/// Asks for the next launch to be measured, or cancels that.
///
/// Measurement is opt-in and lasts one launch. Logging every run would write to
/// disk during play forever to answer a question nobody asked.
pub fn request_measurement(
    app_data_dir: &std::path::Path,
    instance_id: &str,
    wanted: bool,
) -> Result<(), String> {
    let path = request_path(app_data_dir, instance_id);
    if !wanted {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not prepare the measurement: {error}"))?;
    }
    std::fs::write(&path, "1")
        .map_err(|error| format!("Could not prepare the measurement: {error}"))
}

pub fn measurement_requested(app_data_dir: &std::path::Path, instance_id: &str) -> bool {
    request_path(app_data_dir, instance_id).exists()
}

/// Consumes the request and clears the previous log, so a run is never credited
/// with the garbage collection of the run before it.
pub fn take_measurement_request(app_data_dir: &std::path::Path, instance_id: &str) -> bool {
    if !measurement_requested(app_data_dir, instance_id) {
        return false;
    }
    let _ = std::fs::remove_file(request_path(app_data_dir, instance_id));
    let _ = std::fs::remove_file(gc_log_path(app_data_dir, instance_id));
    true
}

pub fn runs(app_data_dir: &std::path::Path, instance_id: &str) -> Vec<RunSample> {
    std::fs::read_to_string(runs_path(app_data_dir, instance_id))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<RunSample>>(&raw).ok())
        .unwrap_or_default()
}

/// Stores a run, newest first.
pub fn record_run(
    app_data_dir: &std::path::Path,
    instance_id: &str,
    sample: RunSample,
) -> Result<(), String> {
    let mut history = runs(app_data_dir, instance_id);
    history.insert(0, sample);
    history.truncate(KEPT_RUNS);

    let path = runs_path(app_data_dir, instance_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(&history).map_err(|error| error.to_string())?;
    std::fs::write(&path, json).map_err(|error| format!("Could not save the run: {error}"))
}

/// Names the run against which the newest one should be judged.
///
/// It is the most recent *earlier* run that measured the same things, not simply
/// the one before: comparing a measured run against an unmeasured one produces a
/// page of "unknown" and tells the user nothing.
pub fn baseline_for<'a>(history: &'a [RunSample], latest: &RunSample) -> Option<&'a RunSample> {
    history
        .iter()
        .filter(|sample| sample.id != latest.id)
        .find(|sample| {
            (sample.gc.is_some() && latest.gc.is_some())
                || (sample.seconds_to_menu.is_some() && latest.seconds_to_menu.is_some())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn healthy() -> Observation {
        Observation {
            total_ram_mb: Some(16384),
            xmx_mb: 6144,
            xms_mb: 6144,
            jvm_args: vec![
                "-XX:+UseG1GC".to_string(),
                "-XX:MaxGCPauseMillis=50".to_string(),
            ],
            java_major: 21,
            recommended_java_major: 21,
            mc_minor: 21,
            loader: "fabric".to_string(),
            mods: vec!["sodium-0.6.0.jar".to_string()],
            gc: None,
            seconds_to_menu: Some(18.0),
        }
    }

    fn id_list(advice: &[Advice]) -> Vec<&str> {
        advice.iter().map(|item| item.id.as_str()).collect()
    }

    #[test]
    fn a_well_configured_instance_gets_no_advice_at_all() {
        // Filler advice trains the user to ignore the panel, which costs them
        // the one time it matters.
        assert_eq!(analyse(&healthy()), Vec::new());
    }

    #[test]
    fn reserving_most_of_the_machine_is_called_out_as_the_problem_it_is() {
        let mut observation = healthy();
        observation.total_ram_mb = Some(8192);
        observation.xmx_mb = 7168;
        observation.xms_mb = 7168;

        let advice = analyse(&observation);
        let heap = advice
            .iter()
            .find(|item| item.id == "heap-too-large-for-machine")
            .unwrap();

        assert_eq!(heap.severity, AdviceSeverity::Critical);
        // The suggestion has to be actionable, not just a complaint.
        assert_eq!(heap.action, Some(AdviceAction::SetMaxMemory(4915)));
    }

    #[test]
    fn a_heap_that_stays_full_after_collection_asks_for_more_not_less() {
        let mut observation = healthy();
        observation.xmx_mb = 2048;
        observation.xms_mb = 2048;
        observation.gc = Some(GcSummary {
            pauses: 40,
            total_pause_ms: 2200.0,
            max_pause_ms: 90.0,
            max_heap_after_mb: 1900,
            heap_total_mb: 2048,
        });

        let advice = analyse(&observation);
        let heap = advice
            .iter()
            .find(|item| item.id == "heap-too-small")
            .unwrap();

        assert_eq!(heap.severity, AdviceSeverity::Critical);
        assert_eq!(heap.action, Some(AdviceAction::SetMaxMemory(4096)));
    }

    #[test]
    fn a_roomy_heap_is_not_reported_as_too_small() {
        let mut observation = healthy();
        observation.gc = Some(GcSummary {
            pauses: 30,
            total_pause_ms: 400.0,
            max_pause_ms: 25.0,
            // Half the heap survives a collection: entirely normal.
            max_heap_after_mb: 3000,
            heap_total_mb: 6144,
        });

        assert!(!id_list(&analyse(&observation)).contains(&"heap-too-small"));
    }

    #[test]
    fn a_long_freeze_is_reported_in_frames_the_player_would_notice() {
        let mut observation = healthy();
        observation.gc = Some(GcSummary {
            pauses: 12,
            total_pause_ms: 900.0,
            max_pause_ms: 340.0,
            max_heap_after_mb: 2000,
            heap_total_mb: 6144,
        });

        let advice = analyse(&observation);
        let pause = advice
            .iter()
            .find(|item| item.id == "long-gc-pauses")
            .unwrap();
        assert!(pause.detail.contains("20 lost frames"), "{}", pause.detail);
    }

    #[test]
    fn two_renderers_are_a_conflict_and_optifine_is_the_one_to_drop() {
        let mut observation = healthy();
        observation.mods = vec![
            "OptiFine_1.21_HD_U_J1.jar".to_string(),
            "sodium-0.6.0.jar".to_string(),
        ];

        let advice = analyse(&observation);
        let conflict = advice
            .iter()
            .find(|item| item.id == "two-renderers")
            .unwrap();

        assert_eq!(conflict.severity, AdviceSeverity::Critical);
        assert_eq!(
            conflict.action,
            Some(AdviceAction::RemoveMod(
                "OptiFine_1.21_HD_U_J1.jar".to_string()
            ))
        );
        // With a conflict on the table, suggesting an install as well would be
        // contradictory advice.
        assert!(!id_list(&advice).contains(&"no-renderer"));
    }

    #[test]
    fn optifine_alone_is_left_alone() {
        let mut observation = healthy();
        observation.mods = vec!["OptiFine_1.21_HD_U_J1.jar".to_string()];

        // It is a renderer replacement too. Telling a player to swap a working
        // setup is not performance advice.
        let advice = analyse(&observation);
        assert!(!id_list(&advice).contains(&"two-renderers"));
        assert!(!id_list(&advice).contains(&"no-renderer"));
    }

    #[test]
    fn the_renderer_suggested_matches_the_loader() {
        let mut observation = healthy();
        observation.mods = Vec::new();
        assert!(analyse(&observation)
            .iter()
            .any(|item| item.action == Some(AdviceAction::InstallMod("Sodium".to_string()))));

        observation.loader = "forge".to_string();
        assert!(analyse(&observation)
            .iter()
            .any(|item| item.action == Some(AdviceAction::InstallMod("Embeddium".to_string()))));
    }

    #[test]
    fn no_renderer_is_suggested_for_versions_that_have_none() {
        let mut observation = healthy();
        observation.mods = Vec::new();
        observation.mc_minor = 8;
        observation.java_major = 8;
        observation.recommended_java_major = 8;

        // Sending someone to look for Sodium for 1.8.9 wastes their evening.
        assert!(!id_list(&analyse(&observation)).contains(&"no-renderer"));
    }

    #[test]
    fn an_older_java_than_the_version_expects_is_flagged_with_the_fix() {
        let mut observation = healthy();
        observation.java_major = 17;
        observation.recommended_java_major = 21;

        let advice = analyse(&observation);
        let java = advice.iter().find(|item| item.id == "old-java").unwrap();
        assert_eq!(java.action, Some(AdviceAction::UseJava(21)));
    }

    #[test]
    fn a_growing_heap_is_a_tip_not_an_alarm() {
        let mut observation = healthy();
        observation.xms_mb = 512;

        let advice = analyse(&observation);
        let resize = advice
            .iter()
            .find(|item| item.id == "heap-resizes-during-play")
            .unwrap();
        assert_eq!(resize.severity, AdviceSeverity::Tip);
        assert_eq!(resize.action, Some(AdviceAction::SetMinMemory(6144)));
    }

    #[test]
    fn advice_is_ordered_with_the_serious_things_first() {
        let mut observation = healthy();
        observation.xms_mb = 512;
        observation.total_ram_mb = Some(8192);
        observation.xmx_mb = 7168;

        let advice = analyse(&observation);
        assert_eq!(advice[0].severity, AdviceSeverity::Critical);
        assert_eq!(advice[advice.len() - 1].severity, AdviceSeverity::Tip);
    }

    // --- GC log ----------------------------------------------------------

    const LOG: &str = "\
[0.021s][info][gc] Using G1
[1.180s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 102M->24M(1024M) 8.410ms
[9.032s][info][gc] GC(1) Pause Young (Concurrent Start) (G1 Humongous Allocation) 620M->480M(2048M) 240.117ms
[9.100s][info][gc] GC(2) Concurrent Cycle
[12.400s][info][gc] GC(3) Pause Remark 500M->490M(2048M) 3.200ms
[12.900s][info][gc] GC(4) Concurrent Cycle 3.500ms
";

    #[test]
    fn only_real_pauses_are_counted() {
        let summary = parse_gc_log(LOG);

        // "Using G1", the concurrent cycles and the header are not pauses;
        // counting them would inflate every number the advisor reports.
        assert_eq!(summary.pauses, 3);
        assert!((summary.total_pause_ms - 251.727).abs() < 0.001);
        assert!((summary.max_pause_ms - 240.117).abs() < 0.001);
    }

    #[test]
    fn the_heap_figures_come_from_after_the_collection() {
        let summary = parse_gc_log(LOG);

        // 620M was the occupancy *before* collecting; what matters is what
        // survived, because that is what the game actually needs.
        assert_eq!(summary.max_heap_after_mb, 490);
        assert_eq!(summary.heap_total_mb, 2048);
    }

    #[test]
    fn sizes_in_other_units_are_understood() {
        let log = "[1.0s][info][gc] GC(0) Pause Young 2048K->1G(4G) 5.000ms";
        let summary = parse_gc_log(log);

        assert_eq!(summary.max_heap_after_mb, 1024);
        assert_eq!(summary.heap_total_mb, 4096);
    }

    #[test]
    fn a_log_that_is_not_a_gc_log_yields_nothing_rather_than_noise() {
        let summary = parse_gc_log("[15:02:11] [main/INFO]: Loading Minecraft 1.21.1\n");
        assert_eq!(summary, GcSummary::default());
        assert_eq!(summary.pressure(), None);
    }

    #[test]
    fn java_8_is_never_given_a_flag_that_would_stop_it_starting() {
        let path = std::path::Path::new("gc.log");
        // -Xlog: does not exist before Java 9; the JVM refuses to start.
        assert_eq!(gc_log_argument(8, path), None);
        assert!(gc_log_argument(21, path)
            .unwrap()
            .starts_with("-Xlog:gc:file="));
    }

    // --- Before and after -------------------------------------------------

    fn sample(seconds: f64, max_pause: f64, total_pause: f64) -> RunSample {
        RunSample {
            id: "r".to_string(),
            instance_id: "abc".to_string(),
            recorded_at: "2026-01-01T00:00:00Z".to_string(),
            label: String::new(),
            xmx_mb: 6144,
            java_major: 21,
            mod_count: 40,
            seconds_to_menu: Some(seconds),
            gc: Some(GcSummary {
                pauses: 10,
                total_pause_ms: total_pause,
                max_pause_ms: max_pause,
                max_heap_after_mb: 2000,
                heap_total_mb: 6144,
            }),
        }
    }

    #[test]
    fn a_real_improvement_is_reported_as_one() {
        let result = compare(&sample(60.0, 300.0, 2000.0), &sample(40.0, 120.0, 900.0));

        assert_eq!(result.startup, Direction::Better);
        assert_eq!(result.startup_delta_seconds, Some(-20.0));
        assert_eq!(result.worst_pause, Direction::Better);
        assert_eq!(result.total_pause, Direction::Better);
    }

    #[test]
    fn run_to_run_noise_is_not_reported_as_a_result() {
        // Two launches of an unchanged setup never agree exactly.
        let result = compare(&sample(60.0, 300.0, 2000.0), &sample(62.0, 310.0, 2050.0));

        assert_eq!(result.startup, Direction::Unchanged);
        assert_eq!(result.worst_pause, Direction::Unchanged);
        assert_eq!(result.total_pause, Direction::Unchanged);
    }

    #[test]
    fn a_regression_is_not_dressed_up() {
        let result = compare(&sample(40.0, 120.0, 900.0), &sample(70.0, 400.0, 2600.0));

        assert_eq!(result.startup, Direction::Worse);
        assert_eq!(result.worst_pause, Direction::Worse);
    }

    #[test]
    fn an_unmeasured_run_is_unknown_rather_than_unchanged() {
        let mut after = sample(40.0, 120.0, 900.0);
        after.gc = None;
        after.seconds_to_menu = None;

        let result = compare(&sample(60.0, 300.0, 2000.0), &after);
        assert_eq!(result.startup, Direction::Unknown);
        assert_eq!(result.worst_pause, Direction::Unknown);
        assert_eq!(result.startup_delta_seconds, None);
    }

    // --- Heap arguments ---------------------------------------------------

    #[test]
    fn the_heap_reported_is_the_one_the_jvm_would_obey() {
        let args = vec![
            "-Xms512M".to_string(),
            "-Xmx4096M".to_string(),
            "-XX:+UseG1GC".to_string(),
            // The user's own extra argument, appended after the profile's.
            "-Xmx8G".to_string(),
        ];

        // The JVM takes the last -Xmx, so reporting the first would describe an
        // instance that does not exist.
        assert_eq!(parse_heap_args(&args), (512, 8192));
    }

    #[test]
    fn heap_sizes_are_understood_in_every_form_the_jvm_accepts() {
        assert_eq!(
            parse_heap_args(&["-Xms1g".to_string(), "-Xmx2048m".to_string()]),
            (1024, 2048)
        );
        // A bare byte count is legal too.
        assert_eq!(parse_heap_args(&["-Xmx1073741824".to_string()]), (0, 1024));
        // Nothing said means nothing claimed.
        assert_eq!(parse_heap_args(&["-XX:+UseG1GC".to_string()]), (0, 0));
    }

    // --- Stored runs ------------------------------------------------------

    #[test]
    fn a_measurement_request_lasts_exactly_one_launch() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();

        assert!(!measurement_requested(root, "abc"));
        request_measurement(root, "abc", true).unwrap();
        assert!(measurement_requested(root, "abc"));

        assert!(take_measurement_request(root, "abc"));
        // Otherwise every later launch would keep writing a GC log nobody asked
        // for.
        assert!(!measurement_requested(root, "abc"));
        assert!(!take_measurement_request(root, "abc"));
    }

    #[test]
    fn taking_a_request_clears_the_previous_log() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        request_measurement(root, "abc", true).unwrap();
        std::fs::create_dir_all(gc_log_path(root, "abc").parent().unwrap()).unwrap();
        std::fs::write(gc_log_path(root, "abc"), "an older run").unwrap();

        take_measurement_request(root, "abc");

        // A run credited with the previous run's collections would compare two
        // launches that never happened.
        assert!(!gc_log_path(root, "abc").exists());
    }

    #[test]
    fn only_the_last_twenty_runs_are_kept() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();

        for index in 0..25 {
            let mut run = sample(40.0, 100.0, 800.0);
            run.id = format!("run-{index}");
            record_run(root, "abc", run).unwrap();
        }

        let history = runs(root, "abc");
        assert_eq!(history.len(), 20);
        // Newest first.
        assert_eq!(history[0].id, "run-24");
    }

    #[test]
    fn the_baseline_is_the_last_run_that_measured_the_same_things() {
        let mut latest = sample(40.0, 100.0, 800.0);
        latest.id = "latest".to_string();

        let mut unmeasured = sample(0.0, 0.0, 0.0);
        unmeasured.id = "unmeasured".to_string();
        unmeasured.gc = None;
        unmeasured.seconds_to_menu = None;

        let mut older = sample(60.0, 300.0, 2000.0);
        older.id = "older".to_string();

        let history = vec![latest.clone(), unmeasured, older];

        // Comparing against the unmeasured run would report "unknown" for
        // everything and tell the user nothing.
        assert_eq!(baseline_for(&history, &latest).unwrap().id, "older");
    }

    #[test]
    fn a_first_ever_run_has_nothing_to_compare_against() {
        let latest = sample(40.0, 100.0, 800.0);
        assert!(baseline_for(std::slice::from_ref(&latest), &latest).is_none());
    }
}
