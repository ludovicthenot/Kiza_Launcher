//! Reads a failed launch and says what actually went wrong.
//!
//! The log viewer already tells the player "the game reported an error". This
//! module names the cause, quotes the line that proves it, and proposes what to
//! do about it.
//!
//! Every detector matches on strings the game and the loaders really print;
//! the tests below are built from crashes this launcher has actually produced.
//! When nothing matches we say so rather than inventing a cause.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Logs can reach tens of megabytes; only the tail matters for a crash.
const MAX_SCANNED_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrashCategory {
    MissingDependency,
    WrongJava,
    OutOfMemory,
    MixinConflict,
    ModuleConflict,
    Graphics,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum CrashAction {
    /// Turn off the named mod file and try again.
    DisableMod(String),
    /// Switch the instance to this Java major version.
    UseJava(u32),
    IncreaseMemory,
    /// Re-download the instance's managed files.
    Repair,
    /// Launch with mods disabled to confirm the game itself is fine.
    SafeMode,
    UpdateGraphicsDriver,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrashFinding {
    pub category: CrashCategory,
    pub title: String,
    pub detail: String,
    /// The log line the diagnosis rests on, so the player can check us.
    pub evidence: String,
    /// Mod file or component at fault, when the log names one.
    pub subject: Option<String>,
    pub actions: Vec<CrashAction>,
}

/// Class file major version -> the Java release that produces it.
fn java_release_for_class_version(major: u32) -> Option<u32> {
    // 52 is Java 8, and every release after that adds one.
    if (45..=99).contains(&major) {
        Some(major - 44)
    } else {
        None
    }
}

fn line_containing<'a>(log: &'a str, needle: &str) -> Option<&'a str> {
    log.lines()
        .find(|line| line.contains(needle))
        .map(str::trim)
}

/// Pulls a `name.jar` out of a line, which is how both loaders name the mod.
fn jar_in(line: &str) -> Option<String> {
    let end = line.find(".jar")? + ".jar".len();
    let start = line[..end]
        .rfind(|character: char| character.is_whitespace() || character == '[' || character == '\'')
        .map(|index| index + 1)
        .unwrap_or(0);
    let candidate = line[start..end].trim_matches(|c| c == '\'' || c == '"');
    if candidate.len() > ".jar".len() {
        Some(candidate.to_string())
    } else {
        None
    }
}

fn detect_wrong_java(log: &str) -> Option<CrashFinding> {
    let line = line_containing(log, "UnsupportedClassVersionError")
        .or_else(|| line_containing(log, "has been compiled by a more recent version"))?;

    // "class file version 61.0" -> Java 17.
    let needed = line
        .split("class file version")
        .nth(1)
        .and_then(|rest| rest.trim().split(['.', ' ', ')']).next())
        .and_then(|value| value.parse::<u32>().ok())
        .and_then(java_release_for_class_version);

    let detail = match needed {
        Some(release) => format!(
            "A file in this instance was built for Java {release}, but the instance is running an older Java. Minecraft and the loader must agree on the Java version."
        ),
        None => "Something in this instance was built for a newer Java than the one running it."
            .to_string(),
    };

    Some(CrashFinding {
        category: CrashCategory::WrongJava,
        title: "The wrong Java version is being used".to_string(),
        detail,
        evidence: line.to_string(),
        subject: jar_in(line),
        actions: needed.map(CrashAction::UseJava).into_iter().collect(),
    })
}

fn detect_out_of_memory(log: &str) -> Option<CrashFinding> {
    let line = line_containing(log, "java.lang.OutOfMemoryError")?;
    let heap = line.contains("Java heap space");
    Some(CrashFinding {
        category: CrashCategory::OutOfMemory,
        title: "The game ran out of memory".to_string(),
        detail: if heap {
            "The Java heap filled up. Raise the instance's maximum memory, or remove some of the heaviest mods.".to_string()
        } else {
            "The JVM could not allocate what it needed. Raise the instance's maximum memory."
                .to_string()
        },
        evidence: line.to_string(),
        subject: None,
        actions: vec![CrashAction::IncreaseMemory],
    })
}

fn detect_missing_dependency(log: &str) -> Option<CrashFinding> {
    // Forge: the mod asks for a loader generation this build does not have.
    if let Some(line) = line_containing(log, "Missing language javafml version") {
        let jar = jar_in(line);
        return Some(CrashFinding {
            category: CrashCategory::MissingDependency,
            title: "A mod needs a newer Forge".to_string(),
            detail: format!(
                "{} declares a Forge version range this instance does not satisfy, so Forge refused to load it.",
                jar.clone().unwrap_or_else(|| "A mod".to_string())
            ),
            evidence: line.to_string(),
            subject: jar.clone(),
            actions: jar.map(CrashAction::DisableMod).into_iter().collect(),
        });
    }

    // Fabric names the missing dependency directly.
    let line = line_containing(log, "requires any version of")
        .or_else(|| line_containing(log, "Incompatible mods found"))
        .or_else(|| line_containing(log, "Mod resolution failed"))?;
    let jar = jar_in(line);
    Some(CrashFinding {
        category: CrashCategory::MissingDependency,
        title: "A mod is missing something it depends on".to_string(),
        detail:
            "The loader stopped because a mod's dependencies are not all installed, or two mods disagree on a version."
                .to_string(),
        evidence: line.to_string(),
        subject: jar.clone(),
        actions: jar
            .map(CrashAction::DisableMod)
            .into_iter()
            .chain([CrashAction::SafeMode])
            .collect(),
    })
}

fn detect_mixin_conflict(log: &str) -> Option<CrashFinding> {
    let line = line_containing(log, "InvalidInjectionException")
        .or_else(|| line_containing(log, "org.spongepowered.asm.mixin.injection.throwables"))
        .or_else(|| line_containing(log, "Mixin apply failed"))?;

    // "kiza_base_mod.fabric.mixins.json:FabricTitleScreenLegacyMixin" names it.
    let subject = line
        .split_whitespace()
        .find(|token| token.contains("mixins.json"))
        .map(|token| token.trim_matches(|c| c == '[' || c == ']').to_string())
        .or_else(|| jar_in(line));

    Some(CrashFinding {
        category: CrashCategory::MixinConflict,
        title: "A mod could not patch the game".to_string(),
        detail:
            "A mixin failed to apply. This usually means a mod is built for a different Minecraft version, or two mods patch the same code."
                .to_string(),
        evidence: line.to_string(),
        subject,
        actions: vec![CrashAction::SafeMode],
    })
}

fn detect_module_conflict(log: &str) -> Option<CrashFinding> {
    let line = line_containing(log, "java.lang.module.ResolutionException")
        .or_else(|| line_containing(log, "contains package"))?;
    Some(CrashFinding {
        category: CrashCategory::ModuleConflict,
        title: "The game was loaded twice".to_string(),
        detail:
            "The same Minecraft package was supplied by two modules at once, so the JVM refused to start. This is a launcher-side classpath problem, not a broken mod."
                .to_string(),
        evidence: line.to_string(),
        subject: None,
        actions: vec![CrashAction::Repair],
    })
}

fn detect_graphics(log: &str) -> Option<CrashFinding> {
    for driver in ["nvoglv", "atio6ax", "atioglxx", "ig9icd", "igxel", "amdvlk"] {
        if let Some(line) = line_containing(log, driver) {
            return Some(CrashFinding {
                category: CrashCategory::Graphics,
                title: "The graphics driver crashed".to_string(),
                detail:
                    "The game died inside the graphics driver. Updating the driver fixes this far more often than changing mods does."
                        .to_string(),
                evidence: line.to_string(),
                subject: Some(driver.to_string()),
                actions: vec![CrashAction::UpdateGraphicsDriver, CrashAction::SafeMode],
            });
        }
    }

    let line = line_containing(log, "Failed to initialize GLFW")
        .or_else(|| line_containing(log, "Pixel format not accelerated"))
        .or_else(|| line_containing(log, "shader compilation failed"))
        .or_else(|| line_containing(log, "Shader compilation failed"))?;
    Some(CrashFinding {
        category: CrashCategory::Graphics,
        title: "The game could not start rendering".to_string(),
        detail:
            "Minecraft failed to set up OpenGL. A driver update is the usual fix; a shader pack can also be the cause."
                .to_string(),
        evidence: line.to_string(),
        subject: None,
        actions: vec![CrashAction::UpdateGraphicsDriver, CrashAction::SafeMode],
    })
}

/// Analyses whatever log text is available and names the causes it recognises,
/// most specific first. An empty result means "we do not know", which is a more
/// useful answer than a guess.
pub fn analyse(log: &str) -> Vec<CrashFinding> {
    let scanned = if log.len() > MAX_SCANNED_BYTES {
        // Keep the tail: the crash is at the end.
        let start = log.len() - MAX_SCANNED_BYTES;
        let boundary = log
            .char_indices()
            .find(|(index, _)| *index >= start)
            .map(|(index, _)| index)
            .unwrap_or(0);
        &log[boundary..]
    } else {
        log
    };

    let detectors: [fn(&str) -> Option<CrashFinding>; 6] = [
        detect_wrong_java,
        detect_module_conflict,
        detect_missing_dependency,
        detect_mixin_conflict,
        detect_out_of_memory,
        detect_graphics,
    ];

    let mut findings = Vec::new();
    for detector in detectors {
        if let Some(finding) = detector(scanned) {
            if !findings
                .iter()
                .any(|existing: &CrashFinding| existing.category == finding.category)
            {
                findings.push(finding);
            }
        }
    }
    findings
}

/// Newest file in `directory` whose name passes `accept`.
fn newest_file(directory: &Path, accept: impl Fn(&str) -> bool) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(directory).ok()?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !accept(&name) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()?;
        if best
            .as_ref()
            .is_none_or(|(best_time, _)| modified > *best_time)
        {
            best = Some((modified, path));
        }
    }
    best.map(|(_, path)| path)
}

/// Gathers the three places a Minecraft failure leaves a trace: the running
/// log, the crash report the game writes on a clean crash, and the JVM's own
/// hs_err file when it dies at the native level.
pub fn collect_crash_sources(game_dir: &Path) -> String {
    let mut sources = Vec::new();

    if let Ok(latest) = fs::read_to_string(game_dir.join("logs").join("latest.log")) {
        sources.push(latest);
    }
    if let Some(report) = newest_file(&game_dir.join("crash-reports"), |name| {
        name.ends_with(".txt")
    }) {
        if let Ok(content) = fs::read_to_string(report) {
            sources.push(content);
        }
    }
    // The JVM drops hs_err_pid<N>.log next to the working directory.
    if let Some(hs_err) = newest_file(game_dir, |name| {
        name.starts_with("hs_err_pid") && name.ends_with(".log")
    }) {
        if let Ok(content) = fs::read_to_string(hs_err) {
            sources.push(content);
        }
    }

    sources.join("\n")
}

pub fn analyse_instance(game_dir: &Path) -> Vec<CrashFinding> {
    analyse(&collect_crash_sources(game_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every fixture below is a line this launcher has really produced.

    #[test]
    fn names_the_forge_1_17_module_clash() {
        let log = "Exception in thread \"main\" java.lang.module.ResolutionException: Module minecraft contains package net.minecraft.world.level, module _1._17._1 exports package net.minecraft.world.level to minecraft";

        let findings = analyse(log);
        let module = findings
            .iter()
            .find(|finding| finding.category == CrashCategory::ModuleConflict)
            .expect("module conflict");
        assert!(module.evidence.contains("ResolutionException"));
        // It is our classpath, not the player's mods: never blame a mod here.
        assert_eq!(module.actions, vec![CrashAction::Repair]);
    }

    #[test]
    fn names_the_mod_that_wants_a_newer_forge() {
        let log = "[main/ERROR] [ne.mi.fm.lo.LanguageLoadingProvider/LOADING]: Missing language javafml version [40,) wanted by kiza-base-mod-forge.jar";

        let finding = analyse(log)
            .into_iter()
            .find(|finding| finding.category == CrashCategory::MissingDependency)
            .expect("missing dependency");
        assert_eq!(finding.subject.as_deref(), Some("kiza-base-mod-forge.jar"));
        assert_eq!(
            finding.actions,
            vec![CrashAction::DisableMod(
                "kiza-base-mod-forge.jar".to_string()
            )]
        );
    }

    #[test]
    fn reads_the_java_version_out_of_the_class_file_error() {
        let log = "java.lang.UnsupportedClassVersionError: fr/kiza/basemod/MenuLogoRenderer has been compiled by a more recent version of the Java Runtime (class file version 61.0), this version of the Java Runtime only recognizes class file versions up to 60.0";

        let finding = analyse(log)
            .into_iter()
            .find(|finding| finding.category == CrashCategory::WrongJava)
            .expect("wrong java");
        // 61 is Java 17, which is exactly the 1.17 trap we hit.
        assert_eq!(finding.actions, vec![CrashAction::UseJava(17)]);
        assert!(finding.detail.contains("Java 17"));
    }

    #[test]
    fn class_file_versions_map_to_java_releases() {
        assert_eq!(java_release_for_class_version(52), Some(8));
        assert_eq!(java_release_for_class_version(60), Some(16));
        assert_eq!(java_release_for_class_version(61), Some(17));
        assert_eq!(java_release_for_class_version(65), Some(21));
        assert_eq!(java_release_for_class_version(200), None);
    }

    #[test]
    fn spots_a_driver_crash_rather_than_blaming_mods() {
        let log = "# C  [nvoglv64.dll+0x8f2a1c]\n# Problematic frame:";

        let finding = analyse(log)
            .into_iter()
            .find(|finding| finding.category == CrashCategory::Graphics)
            .expect("graphics");
        assert!(finding.actions.contains(&CrashAction::UpdateGraphicsDriver));
    }

    #[test]
    fn spots_memory_exhaustion() {
        let log = "[Render thread/ERROR]: java.lang.OutOfMemoryError: Java heap space";

        let finding = analyse(log)
            .into_iter()
            .find(|finding| finding.category == CrashCategory::OutOfMemory)
            .expect("out of memory");
        assert_eq!(finding.actions, vec![CrashAction::IncreaseMemory]);
    }

    #[test]
    fn spots_a_failed_mixin_and_names_its_config() {
        let log = "org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure: @Inject annotation on kiza$renderLauncherForeground could not find any targets in kiza_base_mod.fabric.mixins.json:FabricTitleScreenLegacyMixin";

        let finding = analyse(log)
            .into_iter()
            .find(|finding| finding.category == CrashCategory::MixinConflict)
            .expect("mixin conflict");
        assert_eq!(
            finding.subject.as_deref(),
            Some("kiza_base_mod.fabric.mixins.json:FabricTitleScreenLegacyMixin")
        );
    }

    #[test]
    fn reads_the_log_the_crash_report_and_the_jvm_dump() {
        let directory = tempfile::tempdir().unwrap();
        let game_dir = directory.path();
        fs::create_dir_all(game_dir.join("logs")).unwrap();
        fs::create_dir_all(game_dir.join("crash-reports")).unwrap();

        fs::write(
            game_dir.join("logs").join("latest.log"),
            "[INFO]: nothing here",
        )
        .unwrap();
        fs::write(
            game_dir.join("crash-reports").join("crash-2026-08-06.txt"),
            "java.lang.OutOfMemoryError: Java heap space",
        )
        .unwrap();
        fs::write(
            game_dir.join("hs_err_pid1234.log"),
            "# C  [nvoglv64.dll+0x8f2a1c]",
        )
        .unwrap();

        let findings = analyse_instance(game_dir);
        // Both non-log sources must be read, not just latest.log.
        assert!(findings
            .iter()
            .any(|finding| finding.category == CrashCategory::OutOfMemory));
        assert!(findings
            .iter()
            .any(|finding| finding.category == CrashCategory::Graphics));
    }

    #[test]
    fn a_missing_instance_directory_is_not_an_error() {
        assert!(analyse_instance(Path::new("does-not-exist")).is_empty());
    }

    #[test]
    fn says_nothing_rather_than_guessing() {
        // A clean run must not produce a diagnosis.
        let log =
            "[main/INFO]: Loading Minecraft 1.21.8\n[Render thread/INFO]: OpenAL initialized.";
        assert!(analyse(log).is_empty());
    }

    #[test]
    fn scans_the_tail_of_a_huge_log() {
        let mut log = "[INFO]: noise\n".repeat(200_000);
        log.push_str("java.lang.OutOfMemoryError: Java heap space\n");

        assert!(log.len() > MAX_SCANNED_BYTES);
        assert!(analyse(&log)
            .iter()
            .any(|finding| finding.category == CrashCategory::OutOfMemory));
    }
}
