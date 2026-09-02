//! The launcher's half of "who may have this build".
//!
//! Everything that decides lives in the update service; this file only carries
//! the proof. That is not a detail of the implementation, it is the design: a
//! launcher on somebody else's computer cannot be trusted to judge its own
//! access, so it holds a pass the service wrote and shows it on every request.
//! Nothing here can grant anything, and a pass edited by hand fails at the
//! service rather than here.
//!
//! Two kinds of proof, because there are two kinds of question:
//!
//! - A **pass**, earned by signing in with Discord once. Kept on disk, sent as
//!   `Authorization: Bearer`, good for a month.
//! - A **Setup key**, for the Maker edition, written beside the launcher by the
//!   installer that carried it. There is no account to sign in to: the fact
//!   worth proving is "this came from a Setup somebody was given".
//!
//! The sign-in leaves and comes back through the browser, so the launcher
//! invents a `state` before it goes and refuses anything that returns without
//! it. Otherwise any page could send a link at the launcher and have it claim
//! a code it never asked for.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Where the pass lives, beside the configuration rather than inside it.
///
/// Kept out of `app_settings.json` on purpose: that file is copied between
/// machines, pasted into support threads and read by people comparing setups.
/// A credential in it would be a credential in all of those places.
const PASS_FILE: &str = "access.json";

/// What Kiza Setup leaves behind for the Maker edition.
const SETUP_KEY_FILE: &str = "setup.key";

fn config_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config")
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Stored {
    /// The signed statement the service issued. Opaque here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pass: Option<String>,
    /// What the service said it opens, for showing without decoding anything.
    #[serde(default)]
    pub channels: Vec<String>,
    /// When it stops working, as the service reckoned it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    /// Who it is for, as Discord knows them. Shown so a person can tell which
    /// account they connected — several people have two.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    /// The sign-in that is out at the browser right now, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_state: Option<String>,
}

pub fn load(app_data_dir: &Path) -> Stored {
    let path = config_dir(app_data_dir).join(PASS_FILE);
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app_data_dir: &Path, stored: &Stored) -> Result<(), String> {
    let dir = config_dir(app_data_dir);
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not write access: {error}"))?;
    let text = serde_json::to_string_pretty(stored)
        .map_err(|error| format!("Could not write access: {error}"))?;
    std::fs::write(dir.join(PASS_FILE), text)
        .map_err(|error| format!("Could not write access: {error}"))
}

pub fn forget(app_data_dir: &Path) -> Result<(), String> {
    let path = config_dir(app_data_dir).join(PASS_FILE);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not forget the pass: {error}")),
    }
}

/// The Setup key this install was given, if it was given one.
///
/// A file rather than something compiled in, because the key belongs to the
/// install and not to the build: two people given the Maker get two keys, and
/// one of them can be revoked without rebuilding anything.
pub fn setup_key(app_data_dir: &Path) -> Option<String> {
    let path = config_dir(app_data_dir).join(SETUP_KEY_FILE);
    let key = std::fs::read_to_string(path).ok()?;
    let key = key.trim().to_string();
    (!key.is_empty()).then_some(key)
}

/// A state for a sign-in: long, random, and ours.
///
/// Two version-4 UUIDs rather than one. A UUID is 122 bits of randomness from
/// the operating system, which is already beyond guessing; two of them means
/// the state is also long enough that the service's own floor — sixteen
/// characters — is met with room to spare. This is the one value in the
/// launcher that has to be unpredictable rather than merely unique, which is
/// why it is not a timestamp and not a counter.
pub fn new_state() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// What the interface shows about the current state of access.
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub connected: bool,
    pub channels: Vec<String>,
    pub expires: Option<String>,
    pub account: Option<String>,
    /// True when this install carries a Setup key, which opens Maker on its
    /// own and is not something a person can do anything about.
    pub has_setup_key: bool,
}

pub fn status(app_data_dir: &Path) -> Status {
    let stored = load(app_data_dir);
    Status {
        connected: stored.pass.is_some(),
        channels: stored.channels,
        expires: stored.expires,
        account: stored.account,
        has_setup_key: setup_key(app_data_dir).is_some(),
    }
}

/// The headers a request for a build must carry.
///
/// Returned as a map for the frontend to hand to the updater, because the
/// updater is the thing that makes those requests and it is on that side. An
/// install with neither a pass nor a key gets an empty map and is refused by
/// the service, which is the correct outcome and not an error here.
pub fn headers(app_data_dir: &Path) -> Vec<(String, String)> {
    let mut headers = Vec::new();
    if let Some(pass) = load(app_data_dir).pass {
        headers.push(("Authorization".to_string(), format!("Bearer {pass}")));
    }
    if let Some(key) = setup_key(app_data_dir) {
        headers.push(("X-Kiza-Setup".to_string(), key));
    }
    headers
}

/// Who a pass is for and when it runs out, for showing.
///
/// The signature is not checked here, and that is on purpose rather than an
/// omission: this launcher cannot check it — the secret belongs to the service
/// — and it has no reason to. Every request is judged where the secret is. All
/// this reads is what to put on a settings page, and a person who edits their
/// own pass to read a different date has changed a label, not their access.
pub fn describe(pass: &str) -> (Option<String>, Option<String>) {
    use base64::Engine;

    let Some((body, _)) = pass.split_once('.') else {
        return (None, None);
    };
    let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body) else {
        return (None, None);
    };
    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return (None, None);
    };

    let account = payload
        .get("sub")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let expires = payload
        .get("exp")
        .and_then(|value| value.as_i64())
        .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        .map(|moment| moment.to_rfc3339());
    (account, expires)
}

/// The `code` and `state` out of a `kiza://access?...` link.
///
/// Parsed rather than trusted: this arrives from the browser, which means it
/// arrives from anywhere. What comes back is checked against the state the
/// launcher generated before it opened the browser, and a link that does not
/// carry both is not a sign-in.
pub fn parse_access_link(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("kiza://access")?;
    let query = rest.strip_prefix('?').or_else(|| rest.strip_prefix("/?"))?;

    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=')?;
        let value = percent_decode(value);
        match name {
            "code" => code = Some(value),
            "state" => state = Some(value),
            _ => {}
        }
    }
    match (code, state) {
        (Some(code), Some(state)) if !code.is_empty() && !state.is_empty() => Some((code, state)),
        _ => None,
    }
}

/// Enough percent-decoding for a code and a state, both of which are url-safe
/// to begin with. Anything malformed is left as it is and then fails to match.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = String::with_capacity(value.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' && at + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[at + 1..at + 3], 16) {
                out.push(byte as char);
                at += 3;
                continue;
            }
        }
        out.push(bytes[at] as char);
        at += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_state_is_unpredictable_and_long_enough() {
        let first = new_state();
        assert_eq!(first.len(), 64);
        // The service refuses anything under sixteen characters, and anything
        // outside this alphabet.
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, new_state());
    }

    #[test]
    fn a_link_has_to_carry_both_halves() {
        assert_eq!(
            parse_access_link("kiza://access?code=abc&state=xyz"),
            Some(("abc".to_string(), "xyz".to_string()))
        );
        // The order is whatever the service wrote.
        assert_eq!(
            parse_access_link("kiza://access?state=xyz&code=abc"),
            Some(("abc".to_string(), "xyz".to_string()))
        );

        for bad in [
            "kiza://access?code=abc",
            "kiza://access?state=xyz",
            "kiza://access",
            "kiza://join/1.2.3.4",
            "https://example.test/access?code=a&state=b",
            "kiza://access?code=&state=xyz",
        ] {
            assert!(parse_access_link(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn a_pass_survives_being_written_and_read() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();

        assert!(!status(path).connected);

        save(
            path,
            &Stored {
                pass: Some("body.signature".to_string()),
                channels: vec!["experimental".to_string()],
                expires: Some("2026-10-01T00:00:00Z".to_string()),
                account: Some("someone".to_string()),
                pending_state: None,
            },
        )
        .unwrap();

        let now = status(path);
        assert!(now.connected);
        assert_eq!(now.channels, vec!["experimental".to_string()]);

        let sent = headers(path);
        assert_eq!(
            sent,
            vec![(
                "Authorization".to_string(),
                "Bearer body.signature".to_string()
            )]
        );

        forget(path).unwrap();
        assert!(!status(path).connected);
        assert!(headers(path).is_empty());
    }

    /// The Maker's key opens its channel without anybody signing in to
    /// anything, which is the whole point of it.
    #[test]
    fn a_setup_key_is_sent_when_the_install_has_one() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        std::fs::create_dir_all(path.join("config")).unwrap();
        std::fs::write(path.join("config").join(SETUP_KEY_FILE), "  a-key  \n").unwrap();

        assert_eq!(setup_key(path).as_deref(), Some("a-key"));
        assert!(status(path).has_setup_key);
        assert_eq!(
            headers(path),
            vec![("X-Kiza-Setup".to_string(), "a-key".to_string())]
        );
    }

    #[test]
    fn a_pass_can_be_read_for_display_without_being_believed() {
        use base64::Engine;
        let payload = serde_json::json!({
            "v": 1,
            "sub": "184700731213480000",
            "ch": ["experimental"],
            "iat": 1_780_000_000,
            "exp": 1_790_000_000
        });
        let body = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&payload).unwrap());

        // The signature is deliberately nonsense: reading it for a label is
        // not the same as trusting it, and the service is the one that checks.
        let (account, expires) = describe(&format!("{body}.not-a-real-signature"));
        assert_eq!(account.as_deref(), Some("184700731213480000"));
        assert!(expires.unwrap().starts_with("2026-"));

        assert_eq!(describe("rubbish"), (None, None));
        assert_eq!(describe("not-base64.sig"), (None, None));
    }

    /// A credential does not belong in the file people copy between machines
    /// and paste into support threads.
    #[test]
    fn the_pass_is_not_kept_in_the_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        save(
            path,
            &Stored {
                pass: Some("secret".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let settings = path.join("config").join("app_settings.json");
        if settings.exists() {
            let text = std::fs::read_to_string(settings).unwrap();
            assert!(!text.contains("secret"));
        }
        assert!(path.join("config").join(PASS_FILE).exists());
    }
}
