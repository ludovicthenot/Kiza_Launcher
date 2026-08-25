//! Sending a problem report.
//!
//! The launcher does not know the address of the support channel. It posts to
//! Kiza's own service, which holds the webhook as a secret — because a Discord
//! webhook URL is a write credential for a channel, and anything compiled into
//! a downloadable .exe can be read back out of it.
//!
//! Everything here that makes a decision is a plain function taking its inputs
//! as arguments, so the cooldown and the redaction can be tested without a
//! network and without waiting a minute between assertions.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// What a report may be about. Mirrors the list the service accepts.
pub const CATEGORIES: [&str; 7] = [
    "crash",
    "launch",
    "mods",
    "account",
    "download",
    "interface",
    "other",
];

/// How long the launcher makes someone wait between reports.
///
/// This is politeness, not protection: it lives in a file on a machine its
/// owner controls. The limit that counts is the one at the edge.
pub const COOLDOWN: Duration = Duration::from_secs(120);

pub const MAX_SUMMARY: usize = 160;
pub const MAX_DETAILS: usize = 4000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TicketDraft {
    pub category: String,
    pub summary: String,
    pub details: String,
    /// Whether the diagnostic report travels with it.
    pub include_diagnostic: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TicketSent {
    /// The short reference the service gave back, e.g. "KZ-1A2B3C".
    pub reference: String,
}

/// What is actually sent, once checked.
///
/// The fields below `diagnostic` are the same facts, pulled out separately.
/// They are duplicated on purpose: the full report travels as an attachment,
/// and an attachment has to be opened. Whoever is triaging needs the machine,
/// the Java, and the last few log lines in front of them without clicking
/// anything, because that is what decides whether a report is worth opening at
/// all.
#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct TicketPayload {
    pub category: String,
    pub summary: String,
    pub details: String,
    pub diagnostic: String,
    pub version: String,
    #[serde(rename = "installId")]
    pub install_id: String,
    pub channel: String,
    /// "Windows 11 · x86_64 · 32 GB RAM · 311 GB free".
    pub system: String,
    /// A path when the user chose one, or how Kiza is managing it.
    pub java: String,
    pub instances: u32,
    /// "Modrinth 128 ms · CurseForge no answer".
    pub services: String,
    /// The end of the last log, short enough to sit inside a Discord embed.
    #[serde(rename = "logTail")]
    pub log_tail: String,
}

/// What Kiza knows about the machine, for the fields above.
#[derive(Clone, Debug, Default)]
pub struct Facts {
    pub system: String,
    pub java: String,
    pub instances: u32,
    pub services: String,
    pub log_tail: String,
}

/// How much of the log rides in the message itself.
///
/// Discord caps an embed description at four thousand characters and the
/// details share it. Twenty lines is about what fits while leaving room for
/// what the person wrote, and the failure is almost always in the last few.
pub const LOG_TAIL_LINES: usize = 20;
pub const LOG_TAIL_CHARS: usize = 900;

/// The end of a log, trimmed to fit in a message.
///
/// Taken from the end rather than the start: a Minecraft log opens with
/// hundreds of lines of mods loading and closes with the reason it stopped.
pub fn log_tail(full: &str) -> String {
    let lines: Vec<&str> = full.lines().collect();
    let start = lines.len().saturating_sub(LOG_TAIL_LINES);
    let tail = lines[start..].join(
        "
",
    );

    if tail.chars().count() <= LOG_TAIL_CHARS {
        return tail;
    }
    // Cut from the front, so the last line — the one that says what happened —
    // always survives.
    let keep: String = tail
        .chars()
        .skip(tail.chars().count() - LOG_TAIL_CHARS)
        .collect();
    format!("…{keep}")
}

/// Removes the shapes that should never leave a machine.
///
/// Someone describing a problem pastes what they were looking at, and what they
/// were looking at sometimes contains a token or an e-mail address. The
/// diagnostic report is built to carry neither; free text has no such promise,
/// so it is scrubbed on the way past.
///
/// Deliberately conservative. It replaces what it is sure about and leaves
/// everything else exactly as written — a report that has been quietly reworded
/// is a report that no longer describes the problem.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());

    for word in text.split_inclusive(char::is_whitespace) {
        let trimmed = word.trim_end();
        let trailing = &word[trimmed.len()..];

        // An e-mail address: something, an @, something with a dot after it.
        let is_email = trimmed
            .split_once('@')
            .map(|(user, host)| !user.is_empty() && host.contains('.') && !host.starts_with('.'))
            .unwrap_or(false);

        // A Microsoft or Minecraft token: long, and made of the alphabet those
        // use. Short words are left alone, or every mod name would go.
        let is_token = trimmed.len() >= 40
            && trimmed
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
            && trimmed.chars().any(|c| c.is_ascii_digit())
            && trimmed.chars().any(|c| c.is_ascii_uppercase());

        if is_email {
            out.push_str("[e-mail removed]");
        } else if is_token {
            out.push_str("[token removed]");
        } else {
            out.push_str(trimmed);
        }
        out.push_str(trailing);
    }

    out
}

/// Checks a draft and turns it into what will be sent.
pub fn prepare(
    draft: &TicketDraft,
    diagnostic: Option<String>,
    version: &str,
    channel: &str,
    install_id: &str,
    facts: Facts,
) -> Result<TicketPayload, String> {
    let category = if CATEGORIES.contains(&draft.category.as_str()) {
        draft.category.clone()
    } else {
        "other".to_string()
    };

    let summary = redact(draft.summary.trim());
    if summary.is_empty() {
        return Err("Say in one line what went wrong.".to_string());
    }
    if summary.chars().count() > MAX_SUMMARY {
        return Err(format!("Keep the summary under {MAX_SUMMARY} characters."));
    }

    let details = redact(draft.details.trim());
    if details.chars().count() > MAX_DETAILS {
        return Err(format!("Keep the details under {MAX_DETAILS} characters."));
    }

    Ok(TicketPayload {
        category,
        summary,
        details,
        diagnostic: if draft.include_diagnostic {
            diagnostic.unwrap_or_default()
        } else {
            String::new()
        },
        version: version.to_string(),
        install_id: install_id.to_string(),
        channel: channel.to_string(),
        system: facts.system,
        java: facts.java,
        instances: facts.instances,
        services: facts.services,
        log_tail: facts.log_tail,
    })
}

fn cooldown_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config").join("last-report")
}

/// How long is left of the cooldown, or `None` when a report may be sent.
pub fn remaining_cooldown(app_data_dir: &Path, now: SystemTime) -> Option<Duration> {
    let recorded = std::fs::read_to_string(cooldown_path(app_data_dir)).ok()?;
    let seconds: u64 = recorded.trim().parse().ok()?;
    let last = UNIX_EPOCH + Duration::from_secs(seconds);

    // A clock that has moved backwards since the last report — a time zone
    // change, or a machine correcting itself — must not lock reporting out
    // until it catches up.
    let elapsed = now.duration_since(last).ok()?;
    COOLDOWN.checked_sub(elapsed)
}

pub fn record_sent(app_data_dir: &Path, now: SystemTime) {
    let path = cooldown_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(since) = now.duration_since(UNIX_EPOCH) {
        // A failure here means one extra report gets through, which is a much
        // smaller problem than refusing to send one.
        let _ = std::fs::write(path, since.as_secs().to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn draft(summary: &str) -> TicketDraft {
        TicketDraft {
            category: "crash".into(),
            summary: summary.into(),
            details: String::new(),
            include_diagnostic: false,
        }
    }

    #[test]
    fn an_e_mail_address_never_leaves() {
        let text = redact("my account is someone@example.com and it broke");
        assert!(!text.contains("someone@example.com"));
        assert!(text.contains("[e-mail removed]"));
        // The rest of the sentence is untouched.
        assert!(text.contains("my account is"));
        assert!(text.contains("and it broke"));
    }

    #[test]
    fn a_long_token_never_leaves() {
        let token = "eyJhbGciOiJIUzI1NiJ9aBcDeF0123456789abcdefGHIJKL";
        let text = redact(&format!("it said {token} then stopped"));
        assert!(!text.contains(token));
        assert!(text.contains("[token removed]"));
    }

    #[test]
    fn ordinary_words_are_left_exactly_as_written() {
        // A report that has been quietly reworded no longer describes the
        // problem it was written about.
        let original = "Sodium 0.5.8 crashes on 1.20.4 with OptiFine installed.";
        assert_eq!(redact(original), original);
    }

    #[test]
    fn a_long_file_name_is_not_mistaken_for_a_token() {
        // Lower case only, so it fails the "has an upper case letter" test.
        let name = "sodium-fabric-mc1.20.1-0.5.3-with-a-very-long-suffix.jar";
        assert_eq!(redact(name), name);
    }

    #[test]
    fn something_that_only_looks_like_an_address_is_kept() {
        // No dot after the @, so it is not an address.
        assert_eq!(redact("player@localhost"), "player@localhost");
    }

    #[test]
    fn a_summary_is_required() {
        let error = prepare(
            &draft("   "),
            None,
            "0.0.310",
            "stable",
            "8F2A",
            Facts::default(),
        )
        .unwrap_err();
        assert!(error.contains("one line"));
    }

    #[test]
    fn an_overlong_summary_is_refused_rather_than_cut() {
        // Cutting it would send half a sentence and say nothing about it.
        let long = "a".repeat(MAX_SUMMARY + 1);
        assert!(prepare(
            &draft(&long),
            None,
            "0.0.310",
            "stable",
            "",
            Facts::default()
        )
        .is_err());
    }

    #[test]
    fn an_unknown_category_becomes_other_rather_than_failing() {
        let mut d = draft("it broke");
        d.category = "sabotage".into();
        let payload = prepare(&d, None, "0.0.310", "stable", "", Facts::default()).unwrap();
        assert_eq!(payload.category, "other");
    }

    #[test]
    fn the_diagnostic_travels_only_when_it_was_asked_for() {
        let mut d = draft("it broke");
        let report = Some("the whole report".to_string());

        d.include_diagnostic = false;
        assert_eq!(
            prepare(
                &d,
                report.clone(),
                "0.0.310",
                "stable",
                "",
                Facts::default()
            )
            .unwrap()
            .diagnostic,
            ""
        );

        d.include_diagnostic = true;
        assert_eq!(
            prepare(&d, report, "0.0.310", "stable", "", Facts::default())
                .unwrap()
                .diagnostic,
            "the whole report"
        );
    }

    #[test]
    fn the_log_tail_keeps_the_end_not_the_beginning() {
        // A Minecraft log opens with hundreds of lines of mods loading and
        // closes with the reason it stopped.
        let log = (1..=200)
            .map(|n| format!("line {n}"))
            .collect::<Vec<_>>()
            .join(
                "
",
            );
        let tail = log_tail(&log);

        assert!(tail.contains("line 200"));
        assert!(!tail.contains(
            "line 1
"
        ));
        assert!(tail.lines().count() <= LOG_TAIL_LINES);
    }

    #[test]
    fn a_very_long_last_line_still_ends_with_what_happened() {
        let log = format!(
            "noise
{}",
            "x".repeat(5_000)
        );
        let tail = log_tail(&log);
        assert!(tail.chars().count() <= LOG_TAIL_CHARS + 1);
        assert!(tail.starts_with('…'));
    }

    #[test]
    fn a_short_log_is_passed_through_whole() {
        assert_eq!(
            log_tail(
                "one
two"
            ),
            "one
two"
        );
        assert_eq!(log_tail(""), "");
    }

    #[test]
    fn the_first_report_is_never_held_back() {
        let dir = TempDir::new().unwrap();
        assert!(remaining_cooldown(dir.path(), SystemTime::now()).is_none());
    }

    #[test]
    fn a_second_report_waits() {
        let dir = TempDir::new().unwrap();
        let now = SystemTime::now();
        record_sent(dir.path(), now);

        let left = remaining_cooldown(dir.path(), now).unwrap();
        assert!(left <= COOLDOWN && left > Duration::from_secs(0));
    }

    #[test]
    fn the_wait_ends() {
        let dir = TempDir::new().unwrap();
        let now = SystemTime::now();
        record_sent(dir.path(), now);
        assert!(remaining_cooldown(dir.path(), now + COOLDOWN).is_none());
    }

    #[test]
    fn a_clock_that_moved_backwards_does_not_lock_reporting_out() {
        // A time zone change, or a machine correcting itself, would otherwise
        // leave someone unable to report anything until it caught up.
        let dir = TempDir::new().unwrap();
        let now = SystemTime::now();
        record_sent(dir.path(), now + Duration::from_secs(86_400));
        assert!(remaining_cooldown(dir.path(), now).is_none());
    }

    #[test]
    fn a_corrupted_record_does_not_block_a_report() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("config")).unwrap();
        std::fs::write(cooldown_path(dir.path()), "not a time").unwrap();
        assert!(remaining_cooldown(dir.path(), SystemTime::now()).is_none());
    }
}
