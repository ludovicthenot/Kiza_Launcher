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
    /// The native libraries LWJGL needs were not where Java looked.
    MissingNatives,
    /// A mod is not the release the mods around it were built against.
    ModVersionMismatch,
    /// A mod failed in its own code, and the loader named it.
    ModError,
    /// A mod the pack needs is switched off, and another one noticed.
    DisabledMod,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum CrashAction {
    /// Turn off the named mod file and try again.
    DisableMod(String),
    /// Turn the named `.jar.disabled` file back on.
    EnableMod(String),
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

/// A pack that arrived with mods missing.
///
/// Forge on 1.7 to 1.12 refuses to start when a mod's dependency is absent,
/// and says so once per mod that noticed -- which, in a pack built around a
/// few shared libraries, is nearly every mod in it. What somebody sees is
/// hundreds of lines about coremods and requirements, all of them true and
/// none of them the cause.
///
/// The cause is almost always the same one, and it is ours to explain: a
/// CurseForge pack lists mods whose authors do not let a launcher download
/// them. Those are fetched by hand or not at all, and a pack missing one is a
/// pack that installs, looks healthy, and cannot start.
///
/// Placed before the general dependency rule because both would claim the same
/// category and only the first is kept. This one knows why.
fn detect_missing_coremod(log: &str) -> Option<CrashFinding> {
    let line = line_containing(log, "MissingModsException")
        .or_else(|| line_containing(log, "requires the following mods"))
        .or_else(|| line_containing(log, "required coremod"))
        .or_else(|| {
            // Forge's own phrasing, and specific enough to be worth matching:
            // "Mod x (X) requires [y@[1.0,)]". Guarded by "coremod" or the
            // bracket so an ordinary sentence containing "requires" does not
            // become a diagnosis.
            line_containing(log, "requires [")
        })?;

    Some(CrashFinding {
        category: CrashCategory::MissingDependency,
        title: "The pack is missing mods it needs".to_string(),
        detail:
            "Forge stopped because mods this pack depends on are not in the instance.              When a pack comes from CurseForge, this usually means its author does not              allow launchers to download some of its mods: they have to be fetched from              the mod's own page and dropped into the instance's mods folder. Every mod              that depended on a missing one complains, which is why the log repeats."
                .to_string(),
        evidence: line.to_string(),
        subject: None,
        actions: vec![CrashAction::SafeMode],
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

/// A line of a native crash stack that runs through `driver`:
/// `# C  [nvoglv64.dll+0x8f2a1c]` or `C  [ig9icd64.dll+0x1a2b]`. A driver's
/// name alone proves nothing: healthy logs print it when they list the
/// OpenGL renderer, the loaded libraries or the system report.
fn native_frame_in<'a>(log: &'a str, driver: &str) -> Option<&'a str> {
    log.lines().find(|line| {
        let lower = line.to_ascii_lowercase();
        lower.find(driver).is_some_and(|at| {
            let after = &lower[at..];
            let frame = after.contains(".dll+0x") || after.contains(".so+0x") || after.contains(".so.");
            frame && lower[..at].contains('[')
        })
    })
}

fn detect_graphics(log: &str) -> Option<CrashFinding> {
    for driver in ["nvoglv", "atio6ax", "atioglxx", "ig9icd", "igxel", "amdvlk"] {
        if let Some(line) = native_frame_in(log, driver) {
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

fn detect_missing_natives(log: &str) -> Option<CrashFinding> {
    let line = line_containing(log, "no lwjgl64 in java.library.path")
        .or_else(|| line_containing(log, "no lwjgl in java.library.path"))
        .or_else(|| line_containing(log, "Failed to locate library: lwjgl"))
        .or_else(|| line_containing(log, "no jemalloc in java.library.path"))?;
    Some(CrashFinding {
        category: CrashCategory::MissingNatives,
        title: "The native libraries were not there".to_string(),
        detail: "Java could not find LWJGL's native libraries in the instance's natives folder, so the game died before opening a window. Repairing the instance unpacks them again from the downloaded archives; a launch does the same on its own when the folder is empty.".to_string(),
        evidence: line.to_string(),
        subject: None,
        actions: vec![CrashAction::Repair],
    })
}

/// The Java package a mod's classes live in, from a stack frame.
///
/// `at com.dhanantry.scapeandrunparasites.init.SRPItems.init(SRPItems.java:765)`
/// gives `com/dhanantry/scapeandrunparasites/init/`, which a jar either has
/// or has not. Frames in the game, the loader and Java itself are skipped,
/// since the mod is what changed.
fn mod_package_in(frame: &str) -> Option<String> {
    let rest = frame.trim().strip_prefix("at ")?;
    let call = rest.split('(').next()?;
    let mut parts: Vec<&str> = call.split('.').collect();
    // Drop the method and the class; what is left is the package.
    if parts.len() < 3 {
        return None;
    }
    parts.truncate(parts.len() - 2);
    let package = parts.join("/");
    const NOT_A_MOD: [&str; 8] = [
        "net/minecraft/",
        "net/minecraftforge/",
        "net/fabricmc/",
        "org/spongepowered/",
        "cpw/mods/",
        "java/",
        "sun/",
        "jdk/",
    ];
    if NOT_A_MOD.iter().any(|prefix| package.starts_with(prefix)) {
        return None;
    }
    Some(format!("{package}/"))
}

/// One mod compiled against another mod's older or newer code.
///
/// `NoSuchFieldError: livingDura` at `SRPItems.<clinit>` after RLMixins
/// redirected the call: the mixin was written for SRParasites 1.9.11 and the
/// installed one was 1.9.10. The class that was running when it broke is
/// the mod at fault -- not the mixin's, which is doing what its pack asked
/// -- and its package finds the jar.
fn detect_mod_version_mismatch(log: &str) -> Option<CrashFinding> {
    let error = line_containing(log, "java.lang.NoSuchFieldError")
        .or_else(|| line_containing(log, "java.lang.NoSuchMethodError"))
        .or_else(|| line_containing(log, "java.lang.AbstractMethodError"))
        .or_else(|| line_containing(log, "java.lang.IncompatibleClassChangeError"))?;
    // The first frame after the error that belongs to a mod.
    let package = log
        .lines()
        .skip_while(|line| line.trim() != error)
        .skip(1)
        .take(12)
        .find_map(mod_package_in);
    Some(CrashFinding {
        category: CrashCategory::ModVersionMismatch,
        title: "A mod is not the version its neighbours expect".to_string(),
        detail: "One mod called into another and found the code was not what it was built against: a field or method that exists in one release and not in this one. This happens when a pack's mod was swapped for a newer or older build than the pack pinned. Put the pack's own version back, or switch the mod off to confirm.".to_string(),
        evidence: error.to_string(),
        subject: package,
        actions: vec![CrashAction::SafeMode],
    })
}

/// The loader names the mod whose own code threw.
///
/// Forge: `LoaderExceptionModCrash: Caught exception from Bountiful
/// (bountiful)`. Fabric: `Caught exception from mod 'x'` is rarer but
/// carried by the same text. The id is in the brackets; the crash report's
/// mod table turns it into a file.
fn detect_mod_error(log: &str) -> Option<CrashFinding> {
    let line = line_containing(log, "Caught exception from ")?;
    let after = line.split("Caught exception from ").nth(1)?.trim();
    let mod_id = after
        .rsplit('(')
        .next()
        .and_then(|inside| inside.split(')').next())
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && !id.contains(' '));
    let name = after.split('(').next().unwrap_or(after).trim().to_string();
    // What it choked on, when the cause is on a following line.
    let cause = log
        .lines()
        .skip_while(|candidate| candidate.trim() != line)
        .skip(1)
        .take(6)
        .map(str::trim)
        .find(|candidate| candidate.starts_with("Caused by:") || candidate.contains("Exception:"))
        .unwrap_or("");

    // A namespace in the cause -- `switchbow:switchbow` -- is another mod's
    // content this one asked for. Kept as a hint for the jar resolver.
    let namespace = cause
        .split(|c: char| c.is_whitespace() || c == '[' || c == ',')
        .find_map(|token| {
            let (ns, item) = token.split_once(':')?;
            (!ns.is_empty()
                && !item.is_empty()
                && ns.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                && ns != "minecraft"
                && item.chars().next().is_some_and(|c| c.is_ascii_lowercase()))
            .then(|| ns.to_string())
        });

    Some(CrashFinding {
        category: CrashCategory::ModError,
        title: format!("{name} failed while starting"),
        detail: match &namespace {
            Some(ns) => format!(
                "The loader stopped in {name}'s own code. It was reading content from `{ns}`, which is another mod -- one that is missing or switched off. Put that mod back before blaming this one."
            ),
            None => format!(
                "The loader stopped in {name}'s own code while it was setting up. Its configuration is the usual cause, then a missing mod it relies on; switching it off confirms which."
            ),
        },
        evidence: if cause.is_empty() {
            line.to_string()
        } else {
            format!("{line}\n{cause}")
        },
        subject: mod_id.map(|id| format!("modid:{id}")).or(Some(name)),
        actions: match namespace {
            Some(ns) => vec![CrashAction::EnableMod(format!("modid:{ns}"))],
            None => vec![CrashAction::SafeMode],
        },
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

    let detectors: [fn(&str) -> Option<CrashFinding>; 10] = [
        detect_wrong_java,
        detect_missing_natives,
        detect_module_conflict,
        // Before the general one: both answer with MissingDependency, only the
        // first is kept, and this one can say why the mods are missing.
        detect_missing_coremod,
        detect_missing_dependency,
        detect_mod_version_mismatch,
        detect_mod_error,
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

/// The crash report's mod table: `| LCH | bountiful | 2.2.3 | Bountiful-1.12.2-2.2.3.jar | ... |`.
/// Mod id to jar file, for turning what the loader named into what is on
/// disk.
fn mod_table(log: &str) -> Vec<(String, String)> {
    log.lines()
        .filter(|line| line.trim_start().starts_with('|'))
        .filter_map(|line| {
            let cells: Vec<&str> = line.split('|').map(str::trim).collect();
            // Empty, state, id, version, source, signature, empty.
            if cells.len() < 6 || !cells[4].ends_with(".jar") {
                return None;
            }
            Some((cells[2].to_string(), cells[4].to_string()))
        })
        .collect()
}

/// Which jar in `mods_dir` carries a package, `.disabled` ones included.
fn jar_with_package(mods_dir: &Path, package: &str) -> Option<String> {
    let entries = fs::read_dir(mods_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !(name.ends_with(".jar") || name.ends_with(".jar.disabled")) {
            continue;
        }
        let Ok(file) = fs::File::open(entry.path()) else {
            continue;
        };
        let Ok(archive) = zip::ZipArchive::new(file) else {
            continue;
        };
        if archive.file_names().any(|inner| inner.starts_with(package)) {
            return Some(name);
        }
    }
    None
}

/// The `.jar.disabled` in `mods_dir` whose mod id is `mod_id`.
fn disabled_jar_with_id(mods_dir: &Path, mod_id: &str) -> Option<String> {
    let entries = fs::read_dir(mods_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jar.disabled") {
            continue;
        }
        if crate::mod_compat::identify_jar(&entry.path())
            .is_some_and(|identity| identity.mod_id.eq_ignore_ascii_case(mod_id))
        {
            return Some(name);
        }
    }
    None
}

/// Turns what the log could only name -- a package, a mod id -- into the
/// file in the mods folder, so an action can act on it.
///
/// The log rules are pure functions of text; this is the one step that
/// looks at the disk, and it is what makes "switch it off" a button rather
/// than advice.
pub fn resolve_subjects(findings: &mut [CrashFinding], log: &str, mods_dir: &Path) {
    let table = mod_table(log);
    let jar_for_id = |id: &str| {
        table
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(id))
            .map(|(_, jar)| jar.clone())
    };
    for finding in findings.iter_mut() {
        match finding.category {
            CrashCategory::ModVersionMismatch => {
                if let Some(package) = finding.subject.clone() {
                    if let Some(jar) = jar_with_package(mods_dir, &package) {
                        finding.subject = Some(jar.clone());
                        finding.actions.insert(0, CrashAction::DisableMod(jar));
                    }
                }
            }
            CrashCategory::ModError => {
                if let Some(id) = finding
                    .subject
                    .as_deref()
                    .and_then(|subject| subject.strip_prefix("modid:"))
                {
                    if let Some(jar) = jar_for_id(id) {
                        finding.subject = Some(jar);
                    }
                }
                // The namespace it asked for, turned into the switched-off jar.
                let mut resolved = Vec::with_capacity(finding.actions.len());
                for action in finding.actions.drain(..) {
                    match action {
                        CrashAction::EnableMod(wanted) => {
                            let id = wanted.strip_prefix("modid:").unwrap_or(&wanted);
                            match disabled_jar_with_id(mods_dir, id) {
                                Some(jar) => {
                                    finding.category = CrashCategory::DisabledMod;
                                    finding.title = format!("{} is switched off", jar.trim_end_matches(".disabled"));
                                    resolved.push(CrashAction::EnableMod(jar));
                                }
                                None => {
                                    // Not switched off: it is missing, then.
                                    finding.detail.push_str(" It is not in the mods folder at all: add it, or switch this mod off.");
                                    if let Some(jar) = finding.subject.clone().filter(|s| s.ends_with(".jar")) {
                                        resolved.push(CrashAction::DisableMod(jar));
                                    }
                                    resolved.push(CrashAction::SafeMode);
                                }
                            }
                        }
                        other => resolved.push(other),
                    }
                }
                if let (false, Some(jar)) = (
                    resolved.iter().any(|a| matches!(a, CrashAction::DisableMod(_))),
                    finding.subject.clone().filter(|s| s.ends_with(".jar")),
                ) {
                    resolved.push(CrashAction::DisableMod(jar));
                }
                finding.actions = resolved;
            }
            _ => {}
        }
    }
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
    // What the game printed on its own streams. A JVM that dies before
    // Minecraft's logger exists writes here and nowhere else -- out of memory,
    // a flag it will not accept, a native library that is not there -- which
    // is precisely the crash that used to arrive with nothing to read.
    if let Ok(captured) = fs::read_to_string(
        game_dir
            .join("logs")
            .join(crate::minecraft_manager::LAUNCHER_CAPTURED_LOG),
    ) {
        sources.push(captured);
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
    let log = collect_crash_sources(game_dir);
    let mut findings = analyse(&log);
    resolve_subjects(&mut findings, &log, &game_dir.join("mods"));
    findings
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

    /// The wall of text an imported CurseForge pack produces when mods are
    /// missing, and the reason the launcher used to have nothing to say about
    /// it: no rule matched, so it reported that it did not know either.
    ///
    /// Forge repeats this once per mod that noticed, so what somebody reads is
    /// hundreds of lines naming each other. The answer is not in any one of
    /// them.
    #[test]
    fn explains_a_pack_that_arrived_with_mods_missing() {
        let log = "[Client thread/ERROR] [FML]: net.minecraftforge.fml.common.MissingModsException: Mod lycanitesmobs (Lycanites Mobs) requires [llibrary@[1.7.19,)]";

        let finding = analyse(log)
            .into_iter()
            .find(|finding| finding.category == CrashCategory::MissingDependency)
            .expect("a pack missing its mods should be recognised");

        assert_eq!(finding.title, "The pack is missing mods it needs");
        // The point of the rule: say where the missing mods went, because the
        // log never does.
        assert!(
            finding.detail.contains("CurseForge"),
            "the detail should name the usual cause: {}",
            finding.detail
        );
        assert!(finding.evidence.contains("MissingModsException"));
    }

    /// The natives folder that was empty: the crash that started the RLCraft
    /// week, and one the launcher can mend itself.
    #[test]
    fn an_empty_natives_folder_is_named_and_repairable() {
        let log = "[main/ERROR]: Unable to launch\njava.lang.UnsatisfiedLinkError: no lwjgl64 in java.library.path: C:\\natives\n\tat java.lang.ClassLoader.loadLibrary(ClassLoader.java:1860)";
        let finding = analyse(log)
            .into_iter()
            .find(|f| f.category == CrashCategory::MissingNatives)
            .expect("missing natives");
        assert_eq!(finding.actions, vec![CrashAction::Repair]);
    }

    /// RLCraft with SRParasites 1.9.10 where 1.9.11 was pinned: the mixin
    /// asks for a field the older build does not have. The frame that was
    /// running is SRParasites', so that is the jar named, found by package.
    #[test]
    fn a_field_missing_from_a_mod_names_the_mod_by_its_package() {
        let log = "java.lang.NoSuchFieldError: livingDura
\tat com.dhanantry.scapeandrunparasites.init.SRPItems.redirect$zje000$rlmixins_srparasitesSRPItems_addArmorMaterial(SRPItems.java:628)
\tat com.dhanantry.scapeandrunparasites.init.SRPItems.<clinit>(SRPItems.java:198)
\tat net.minecraftforge.fml.common.eventhandler.ASMEventHandler.invoke(ASMEventHandler.java:90)";
        let mut findings = analyse(log);
        let finding = findings
            .iter()
            .find(|f| f.category == CrashCategory::ModVersionMismatch)
            .expect("a version mismatch");
        assert_eq!(finding.subject.as_deref(), Some("com/dhanantry/scapeandrunparasites/init/"));

        // With the folder at hand, the package becomes the jar and the
        // advice becomes a button.
        let temp = tempfile::tempdir().unwrap();
        let mods = temp.path().join("mods");
        fs::create_dir_all(&mods).unwrap();
        write_jar(&mods.join("SRParasites-1.12.2v1.9.10.jar"), &["com/dhanantry/scapeandrunparasites/init/SRPItems.class"]);
        write_jar(&mods.join("RLMixins-1.2.15.jar"), &["rlmixins/RLMixins.class"]);
        resolve_subjects(&mut findings, log, &mods);
        let finding = findings.iter().find(|f| f.category == CrashCategory::ModVersionMismatch).unwrap();
        assert_eq!(finding.subject.as_deref(), Some("SRParasites-1.12.2v1.9.10.jar"));
        assert_eq!(finding.actions[0], CrashAction::DisableMod("SRParasites-1.12.2v1.9.10.jar".to_string()));
    }

    /// Bountiful crashing over `switchbow:` items, with Switch-Bow lying in
    /// the folder as `.jar.disabled`: the answer is to switch it back on, not
    /// to disable Bountiful.
    #[test]
    fn a_mod_asking_for_a_switched_off_mods_content_names_the_one_to_turn_on() {
        let log = "net.minecraftforge.fml.common.LoaderExceptionModCrash: Caught exception from Bountiful (bountiful)
Caused by: java.lang.Exception: 'bountiful/rewards.json' contains one or more invalid rewards. Invalid rewards: [PickedEntry (Stack) [Item: switchbow:switchbow, Amount: 1000]]
\tat ejektaflex.bountiful.proxy.CommonProxy.postInit(CommonProxy.kt:112)

\t| State | ID        | Version | Source                       | Signature |
\t| LCH   | bountiful | 2.2.3   | Bountiful-1.12.2-2.2.3.jar   | None      |";
        let mut findings = analyse(log);
        let finding = findings.iter().find(|f| f.category == CrashCategory::ModError).expect("a mod error");
        assert_eq!(finding.subject.as_deref(), Some("modid:bountiful"));
        assert_eq!(finding.actions, vec![CrashAction::EnableMod("modid:switchbow".to_string())]);

        let temp = tempfile::tempdir().unwrap();
        let mods = temp.path().join("mods");
        fs::create_dir_all(&mods).unwrap();
        write_jar_with_mcmod(&mods.join("switchbow-1.6.8.jar.disabled"), "switchbow");
        write_jar(&mods.join("Bountiful-1.12.2-2.2.3.jar"), &["ejektaflex/bountiful/Bountiful.class"]);
        resolve_subjects(&mut findings, log, &mods);
        let finding = &findings[0];
        assert_eq!(finding.category, CrashCategory::DisabledMod);
        assert_eq!(finding.title, "switchbow-1.6.8.jar is switched off");
        assert_eq!(finding.subject.as_deref(), Some("Bountiful-1.12.2-2.2.3.jar"));
        assert_eq!(finding.actions[0], CrashAction::EnableMod("switchbow-1.6.8.jar.disabled".to_string()));

        // Not in the folder at all: then it is missing, and the options are
        // to add it or to switch the complaining mod off.
        let mut findings = analyse(log);
        fs::remove_file(mods.join("switchbow-1.6.8.jar.disabled")).unwrap();
        resolve_subjects(&mut findings, log, &mods);
        assert_eq!(findings[0].category, CrashCategory::ModError);
        assert!(findings[0].actions.contains(&CrashAction::DisableMod("Bountiful-1.12.2-2.2.3.jar".to_string())));
        assert!(!findings[0].actions.iter().any(|a| matches!(a, CrashAction::EnableMod(_))));
    }

    fn write_jar(path: &Path, entries: &[&str]) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for entry in entries {
            writer.start_file(*entry, zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut writer, b"x").unwrap();
        }
        writer.finish().unwrap();
    }

    fn write_jar_with_mcmod(path: &Path, mod_id: &str) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer.start_file("mcmod.info", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(
            &mut writer,
            format!(r#"[{{"modid":"{mod_id}","name":"{mod_id}","version":"1.0"}}]"#).as_bytes(),
        )
        .unwrap();
        writer.finish().unwrap();
    }

    /// The specific rule has to win over the general one, or the answer is
    /// "some dependency is missing" -- which the player already knew.
    #[test]
    fn the_pack_rule_is_preferred_over_the_general_dependency_rule() {
        let log = "Mod resolution failed
net.minecraftforge.fml.common.MissingModsException: Mod a requires [b@[1.0,)]";

        let findings = analyse(log);
        let dependency: Vec<_> = findings
            .iter()
            .filter(|finding| finding.category == CrashCategory::MissingDependency)
            .collect();
        assert_eq!(dependency.len(), 1, "one answer per category");
        assert_eq!(dependency[0].title, "The pack is missing mods it needs");
    }

    /// An ordinary sentence must not become a diagnosis. "requires" appears in
    /// plenty of harmless lines, and a crash panel that fires on any of them
    /// is a panel nobody believes the next time.
    #[test]
    fn an_innocent_line_is_not_a_missing_pack() {
        let log = "[main/INFO]: This feature requires a restart to take effect.";
        assert!(
            analyse(log)
                .iter()
                .all(|finding| finding.title != "The pack is missing mods it needs"),
            "plain prose containing \"requires\" is not a crash"
        );
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
    fn a_driver_named_in_a_healthy_log_is_not_a_driver_crash() {
        // What a Forge system report and a library listing print every launch.
        let log = "\
[main/INFO]: Backend library: LWJGL version 3.3.3
\tGL Caps: Using framebuffer using OpenGL 3.2
\tOpenGL: NVIDIA GeForce RTX 3070/PCIe/SSE2 GL version 4.6.0 NVIDIA 560.94
C:\\Windows\\System32\\DriverStore\\FileRepository\\nv_dispi.inf_amd64\\nvoglv64.dll loaded
java.lang.NoSuchFieldError: MOD_ID";

        assert!(analyse(log)
            .iter()
            .all(|finding| finding.category != CrashCategory::Graphics));
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
