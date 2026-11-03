//! A crash that reports itself, when the person said it may.
//!
//! Until now a crash reached Kiza's maintainers the long way: somebody
//! noticed, found the log, and posted it on Discord -- or did not, and the
//! crash stayed a private event on one machine. This turns a crash into a
//! ticket on its own, sent through the same support service and read in
//! the same channel as a report someone writes by hand, so that nothing new
//! has to be deployed to receive it and nobody has to remember two places.
//!
//! It is opt-in. The setting is "ask" until the person chooses, and "ask"
//! means the banner after a crash offers a button, not that anything is
//! sent. The report carries what the doctor found, what the launch was,
//! and the tail of the log; it carries no account token, no path under the
//! home folder that the redaction does not scrub, and nothing typed.
//!
//! A crash has a fingerprint -- what kind, which mod, which line -- and the
//! same one is not sent again from one machine for a day. A pack that
//! crashes the same way twenty times is one ticket, not twenty.

use crate::crash_doctor::CrashFinding;
use crate::minecraft_manager::LaunchRecord;
use crate::support::TicketDraft;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The person's answer to "may a crash report itself".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Consent {
    /// Not decided: offer a button after a crash.
    Ask,
    Always,
    Never,
}

impl Consent {
    pub fn parse(raw: &str) -> Self {
        match raw.trim() {
            "always" => Consent::Always,
            "never" => Consent::Never,
            _ => Consent::Ask,
        }
    }
}

/// The same crash, seen twice, is one ticket.
const REPEAT_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// A crash, described the way a ticket describes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CrashReport {
    pub fingerprint: String,
    pub draft: TicketDraft,
    /// Whether this fingerprint went out recently and would be a repeat.
    pub already_sent: bool,
}

/// What a crash is, without the parts that change every time.
///
/// Timestamps and memory addresses go; the kind, the mod and the words of
/// the first evidence line stay. RLCraft's Parasites crash is one
/// fingerprint on every machine that has it.
pub fn fingerprint(findings: &[CrashFinding], fatal_line: Option<&str>) -> String {
    let mut hasher = Sha1::new();
    match findings.first() {
        Some(finding) => {
            hasher.update(format!("{:?}", finding.category).as_bytes());
            hasher.update(finding.subject.as_deref().unwrap_or("").as_bytes());
            hasher.update(strip_volatile(finding.evidence.lines().next().unwrap_or("")).as_bytes());
        }
        None => {
            hasher.update(b"unknown");
            hasher.update(strip_volatile(fatal_line.unwrap_or("")).as_bytes());
        }
    }
    format!("{:x}", hasher.finalize())[..12].to_string()
}

/// A line with its timestamp, thread name and hex addresses taken out.
fn strip_volatile(line: &str) -> String {
    let mut text = line.trim().to_string();
    // `[12:34:56] [Client thread/ERROR]: ` and its kin.
    while text.starts_with('[') {
        match text.find("] ") {
            Some(end) if end < 40 => text = text[end + 2..].to_string(),
            _ => break,
        }
    }
    let mut out = String::with_capacity(text.len());
    for token in text.split(' ') {
        let hexish = token.len() >= 6
            && token
                .trim_start_matches("0x")
                .chars()
                .all(|c| c.is_ascii_hexdigit())
            && token.chars().any(|c| c.is_ascii_digit());
        let at_hash = token.contains('@')
            && token.rsplit('@').next().is_some_and(|tail| {
                let tail = tail.trim_end_matches(|c: char| !c.is_ascii_alphanumeric());
                !tail.is_empty() && tail.chars().all(|c| c.is_ascii_hexdigit())
            });
        if hexish || at_hash {
            out.push_str("<n>");
        } else {
            out.push_str(token);
        }
        out.push(' ');
    }
    out.trim_end().to_string()
}

/// Builds the ticket for one crash.
pub fn describe(
    record: Option<&LaunchRecord>,
    findings: &[CrashFinding],
    fatal_line: Option<&str>,
    warnings: usize,
    errors: usize,
    exit_code: Option<i32>,
) -> TicketDraft {
    let instance = record
        .map(|r| {
            format!(
                "{} -- Minecraft {} with {}{}",
                r.instance_name,
                r.minecraft_version,
                r.loader,
                r.loader_version
                    .as_deref()
                    .map(|v| format!(" {v}"))
                    .unwrap_or_default()
            )
        })
        .unwrap_or_else(|| "an instance".to_string());
    let headline = findings
        .first()
        .map(|finding| finding.title.clone())
        .unwrap_or_else(|| "Minecraft crashed and the doctor found no known cause".to_string());
    let summary = truncate(
        &format!("[auto] {headline} -- {instance}"),
        crate::support::MAX_SUMMARY,
    );

    let mut details = String::new();
    details.push_str("Sent by the launcher after a crash, with the player's consent.\n\n");
    if let Some(r) = record {
        details.push_str(&format!(
            "Launch: {} -- Minecraft {} with {}{}\nProfile: {} ({}) -- {} to {} MB -- Java {}\nAccount: {}\nLauncher: {}\n",
            r.instance_name,
            r.minecraft_version,
            r.loader,
            r.loader_version.as_deref().map(|v| format!(" {v}")).unwrap_or_default(),
            r.profile_label,
            r.profile_id,
            r.memory_mb.0,
            r.memory_mb.1,
            r.java_major,
            r.account_mode,
            r.launcher_version,
        ));
        for courtesy in &r.courtesies {
            details.push_str(&format!(
                "{} left to {}\n",
                courtesy.area.key(),
                courtesy.mod_name
            ));
        }
    }
    details.push_str(&format!(
        "Exit code: {}\nLog: {warnings} warning(s), {errors} line(s) at ERROR\n",
        exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "none".to_string())
    ));
    if let Some(line) = fatal_line {
        details.push_str(&format!("\nThe line it turned on:\n{}\n", line.trim()));
    }
    for (index, finding) in findings.iter().enumerate() {
        details.push_str(&format!(
            "\nFinding {}: {}\n{}\n",
            index + 1,
            finding.title,
            finding.detail
        ));
        if let Some(subject) = &finding.subject {
            details.push_str(&format!("Subject: {subject}\n"));
        }
        details.push_str(&format!(
            "Evidence: {}\n",
            finding.evidence.lines().next().unwrap_or("")
        ));
    }
    TicketDraft {
        category: "crash".to_string(),
        summary,
        details: truncate(&details, crate::support::MAX_DETAILS),
        include_diagnostic: true,
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn sent_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("doctor").join("sent-crashes.json")
}

fn sent_index(app_data_dir: &Path) -> BTreeMap<String, u64> {
    fs::read_to_string(sent_path(app_data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Whether this fingerprint went out from this machine within a day.
pub fn sent_recently(app_data_dir: &Path, fingerprint: &str, now: SystemTime) -> bool {
    let Some(at) = sent_index(app_data_dir).get(fingerprint).copied() else {
        return false;
    };
    let then = UNIX_EPOCH + Duration::from_secs(at);
    now.duration_since(then)
        .map(|elapsed| elapsed < REPEAT_AFTER)
        .unwrap_or(false)
}

pub fn record_sent(app_data_dir: &Path, fingerprint: &str, now: SystemTime) {
    let mut index = sent_index(app_data_dir);
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    index.insert(fingerprint.to_string(), seconds);
    // Only what a day can still repeat is worth keeping.
    index.retain(|_, at| seconds.saturating_sub(*at) < REPEAT_AFTER.as_secs() * 7);
    let path = sent_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(&index) {
        let _ = fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crash_doctor::{CrashAction, CrashCategory};

    fn finding(subject: &str, evidence: &str) -> CrashFinding {
        CrashFinding {
            category: CrashCategory::ModVersionMismatch,
            title: "A mod is not the version its neighbours expect".to_string(),
            detail: "d".to_string(),
            evidence: evidence.to_string(),
            subject: Some(subject.to_string()),
            actions: vec![CrashAction::SafeMode],
        }
    }

    /// The same crash on two machines, at two times, is one fingerprint;
    /// a different mod is another.
    #[test]
    fn a_fingerprint_ignores_the_clock_and_keeps_the_cause() {
        let a = fingerprint(&[finding("SRParasites-1.10.9.jar", "[21:20:22] [Client thread/ERROR] [FML]: Exception caught during firing event net.minecraftforge.event.RegistryEvent$Register@2e59a354:")], None);
        let b = fingerprint(&[finding("SRParasites-1.10.9.jar", "[17:55:30] [Client thread/ERROR] [FML]: Exception caught during firing event net.minecraftforge.event.RegistryEvent$Register@49729afc:")], None);
        let c = fingerprint(&[finding("Bountiful-1.12.2-2.2.3.jar", "[17:55:30] [Client thread/ERROR] [FML]: Exception caught during firing event net.minecraftforge.event.RegistryEvent$Register@49729afc:")], None);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 12);
        // No finding: the fatal line stands in.
        assert_eq!(
            fingerprint(
                &[],
                Some("[12:00:00] [main/INFO]: ---- Minecraft Crash Report ----")
            ),
            fingerprint(
                &[],
                Some("[13:45:10] [main/INFO]: ---- Minecraft Crash Report ----")
            )
        );
    }

    #[test]
    fn a_ticket_says_what_the_launch_was_and_what_the_doctor_found() {
        let record = LaunchRecord {
            instance_id: "rl".into(),
            instance_name: "RLCraft".into(),
            minecraft_version: "1.12.2".into(),
            loader: "Forge".into(),
            loader_version: Some("14.23.5.2860".into()),
            profile_id: "quality".into(),
            profile_label: "Quality".into(),
            username: "nefer".into(),
            account_mode: "microsoft".into(),
            java_major: 8,
            java_path: "C:\\\\java".into(),
            memory_mb: (2048, 8192),
            started_at: "now".into(),
            launcher_version: "0.0.344".into(),
            courtesies: Vec::new(),
        };
        let draft = describe(
            Some(&record),
            &[finding(
                "SRParasites-1.10.9.jar",
                "java.lang.NullPointerException",
            )],
            Some("---- Minecraft Crash Report ----"),
            4,
            1,
            Some(-1),
        );
        assert_eq!(draft.category, "crash");
        assert!(
            draft
                .summary
                .starts_with("[auto] A mod is not the version its neighbours expect -- RLCraft"),
            "{}",
            draft.summary
        );
        assert!(draft.details.contains("Forge 14.23.5.2860"));
        assert!(draft.details.contains("Java 8"));
        assert!(draft.details.contains("Subject: SRParasites-1.10.9.jar"));
        assert!(draft.details.contains("4 warning(s), 1 line(s) at ERROR"));
        // Nothing about who: the name is not in the ticket.
        assert!(!draft.details.contains("nefer"));
        assert!(draft.summary.chars().count() <= crate::support::MAX_SUMMARY);
    }

    #[test]
    fn a_fingerprint_is_not_sent_twice_in_a_day() {
        let temp = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        assert!(!sent_recently(temp.path(), "abc", now));
        record_sent(temp.path(), "abc", now);
        assert!(sent_recently(
            temp.path(),
            "abc",
            now + Duration::from_secs(3600)
        ));
        assert!(!sent_recently(
            temp.path(),
            "abc",
            now + Duration::from_secs(25 * 3600)
        ));
        assert!(!sent_recently(temp.path(), "def", now));
    }

    #[test]
    fn consent_reads_the_three_answers() {
        assert_eq!(Consent::parse("always"), Consent::Always);
        assert_eq!(Consent::parse("never"), Consent::Never);
        assert_eq!(Consent::parse("ask"), Consent::Ask);
        assert_eq!(Consent::parse(""), Consent::Ask);
    }
}
