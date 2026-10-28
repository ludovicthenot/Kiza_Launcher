//! That a Horizon release is the one Horizon signed.
//!
//! Every release carries `SHA256SUMS` (`<sha256>  <file>` per line) and
//! `SHA256SUMS.sig`: base64 Ed25519 signatures, one per line, each over
//! `horizon release <tag>\n` followed by the list's bytes, so a list cannot
//! be passed off under another tag. This is Horizon's own scheme
//! (crates/horizon-release-sign in its repository, MIT), checked here with
//! the `ring` the launcher already ships.
//!
//! Unlike Horizon's launcher, Kiza accepts no unsigned release, not even an
//! old one pinned by hash: there is no rollback to support.

use base64::{engine::general_purpose::STANDARD, Engine};
use ring::signature::{UnparsedPublicKey, ED25519};

pub const SUMS: &str = "SHA256SUMS";
pub const SIGNATURE: &str = "SHA256SUMS.sig";

/// Horizon's release key, from crates/horizon-release-sign/release-keys.txt
/// at commit e0bf5f6 (2026-10-28). Changing it is a decision, not an update:
/// it is who Kiza trusts to send code to run on the player's computer.
pub const RELEASE_KEYS: &[&str] = &["MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw="];

pub type PublicKey = [u8; 32];

pub fn trusted_keys() -> Vec<PublicKey> {
    RELEASE_KEYS
        .iter()
        .filter_map(|key| STANDARD.decode(key).ok()?.try_into().ok())
        .collect()
}

/// What a signature covers.
pub fn message(tag: &str, sums: &[u8]) -> Vec<u8> {
    let mut message = format!("horizon release {tag}\n").into_bytes();
    message.extend_from_slice(sums);
    message
}

/// The `(file, sha256)` pairs of a checksum list.
pub fn parse_sums(text: &str) -> Result<Vec<(String, String)>, String> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let (hex, name) = line
                .split_once(' ')
                .ok_or_else(|| format!("{SUMS}: {line:?} is not `<sha256>  <file>`"))?;
            let name = name.strip_prefix([' ', '*']).unwrap_or(name);
            if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) || name.is_empty() {
                return Err(format!("{SUMS}: {line:?} is not `<sha256>  <file>`"));
            }
            Ok((name.to_string(), hex.to_ascii_lowercase()))
        })
        .collect()
}

/// The SHA-256 the signed list gives `asset` in release `tag`, or why the
/// download must be refused.
pub fn signed_digest(
    tag: &str,
    asset: &str,
    sums: &[u8],
    signature: &str,
    keys: &[PublicKey],
) -> Result<String, String> {
    if keys.is_empty() {
        return Err("No Horizon release key is built in, so no release can be checked.".into());
    }
    let message = message(tag, sums);
    let signed = signature
        .lines()
        .filter_map(|line| STANDARD.decode(line.trim()).ok())
        .any(|sig| {
            keys.iter().any(|key| {
                UnparsedPublicKey::new(&ED25519, key)
                    .verify(&message, &sig)
                    .is_ok()
            })
        });
    if !signed {
        return Err(format!(
            "Horizon {tag}'s checksums are not signed by Horizon's release key: the download was refused."
        ));
    }
    let text = std::str::from_utf8(sums).map_err(|_| format!("{SUMS} is not text"))?;
    parse_sums(text)?
        .into_iter()
        .find(|(name, _)| name == asset)
        .map(|(_, hex)| hex)
        .ok_or_else(|| format!("Horizon {tag}'s signed checksums do not list {asset}."))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUMS_095: &[u8] = include_bytes!("../../tests/fixtures/v0.2.95.SHA256SUMS");
    const SIG_095: &str = include_str!("../../tests/fixtures/v0.2.95.SHA256SUMS.sig");
    const WINDOWS: &str = "horizon-windows-x64.zip";

    #[test]
    fn a_real_release_checks_out() {
        let digest = signed_digest("v0.2.95", WINDOWS, SUMS_095, SIG_095, &trusted_keys()).unwrap();
        assert_eq!(
            digest,
            "49e44857e1a3141422e420d4017b973859877bc65e90295552f9c7eaed975a96"
        );
    }

    #[test]
    fn the_same_list_under_another_tag_is_refused() {
        let error =
            signed_digest("v0.2.96", WINDOWS, SUMS_095, SIG_095, &trusted_keys()).unwrap_err();
        assert!(error.contains("not signed"), "{error}");
    }

    #[test]
    fn a_changed_list_is_refused() {
        let mut sums = SUMS_095.to_vec();
        // One hex digit of the Windows archive's hash.
        let at = sums.windows(4).position(|w| w == b"49e4").unwrap();
        sums[at] = b'5';
        assert!(signed_digest("v0.2.95", WINDOWS, &sums, SIG_095, &trusted_keys()).is_err());
    }

    #[test]
    fn another_key_is_refused() {
        let other = [7u8; 32];
        assert!(signed_digest("v0.2.95", WINDOWS, SUMS_095, SIG_095, &[other]).is_err());
        assert!(signed_digest("v0.2.95", WINDOWS, SUMS_095, SIG_095, &[]).is_err());
    }

    #[test]
    fn an_asset_not_listed_is_refused() {
        let error =
            signed_digest("v0.2.95", "evil.zip", SUMS_095, SIG_095, &trusted_keys()).unwrap_err();
        assert!(error.contains("do not list"), "{error}");
    }

    #[test]
    fn checksum_lines() {
        let parsed = parse_sums(&format!(
            "{}  a.zip\n{} *b.zip\n",
            "A".repeat(64),
            "b".repeat(64)
        ))
        .unwrap();
        assert_eq!(parsed[0], ("a.zip".into(), "a".repeat(64)));
        assert_eq!(parsed[1].0, "b.zip");
        assert!(parse_sums("abc  a.zip").is_err());
    }
}
