//! Which Horizon release to install, from GitHub's release list.
//!
//! The list mixes the game's releases (`v0.2.95`), the Horizon launcher's
//! (`launcher@0.2.21`) and nightly builds. Kiza takes only game releases that
//! are published, not pre-releases, carry this system's archive and are
//! signed: a release without `SHA256SUMS.sig` cannot be checked, so it is
//! not a candidate at all.

use serde::Deserialize;

use super::signature::{SIGNATURE, SUMS};

/// A release as GitHub's API lists it (`GET /repos/{repo}/releases`).
#[derive(Deserialize, Clone, Debug)]
pub struct GithubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub assets: Vec<GithubAsset>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

/// A release Kiza can install: the three files it downloads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub tag: String,
    pub archive: Asset,
    pub sums: Asset,
    pub signature: Asset,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

/// The newest installable game release in `releases_json`, for an archive
/// named `asset` (see [`super::platform_asset`]).
pub fn newest(releases_json: &str, asset: &str) -> Result<Option<Candidate>, String> {
    let releases: Vec<GithubRelease> =
        serde_json::from_str(releases_json).map_err(|e| format!("GitHub's release list: {e}"))?;
    let mut candidates: Vec<(Vec<u64>, Candidate)> = releases
        .iter()
        .filter(|r| !r.prerelease && !r.draft)
        .filter_map(|r| Some((game_version(&r.tag_name)?, candidate(r, asset)?)))
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(candidates.into_iter().next().map(|(_, c)| c))
}

/// `v0.2.95` as `[0, 2, 95]`; anything else (the launcher's tags, nightly)
/// is not a game release.
pub fn game_version(tag: &str) -> Option<Vec<u64>> {
    let rest = tag.strip_prefix('v')?;
    rest.split('.').map(|p| p.parse().ok()).collect()
}

fn candidate(release: &GithubRelease, asset: &str) -> Option<Candidate> {
    let find = |name: &str| {
        release
            .assets
            .iter()
            .find(|a| a.name == name)
            .map(|a| Asset {
                name: a.name.clone(),
                url: a.browser_download_url.clone(),
                size: a.size,
            })
    };
    Some(Candidate {
        tag: release.tag_name.clone(),
        archive: find(asset)?,
        sums: find(SUMS)?,
        signature: find(SIGNATURE)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELEASES: &str = include_str!("../../tests/fixtures/releases.json");

    #[test]
    fn the_newest_signed_game_release() {
        let c = newest(RELEASES, "horizon-windows-x64.zip")
            .unwrap()
            .unwrap();
        assert_eq!(c.tag, "v0.2.95");
        assert_eq!(c.archive.size, 31_719_977);
        assert!(c.archive.url.ends_with("/v0.2.95/horizon-windows-x64.zip"));
        assert_eq!(c.signature.name, "SHA256SUMS.sig");
    }

    #[test]
    fn launcher_and_nightly_tags_are_not_game_releases() {
        assert_eq!(game_version("v0.2.95"), Some(vec![0, 2, 95]));
        assert_eq!(game_version("launcher@0.2.21"), None);
        assert_eq!(game_version("nightly-2026-10-28"), None);
        assert_eq!(game_version("nightly"), None);
    }

    #[test]
    fn a_release_without_a_signature_is_not_a_candidate() {
        let json = r#"[{"tag_name":"v9.0.0","prerelease":false,"draft":false,"assets":[
            {"name":"horizon-windows-x64.zip","browser_download_url":"u","size":1},
            {"name":"SHA256SUMS","browser_download_url":"s","size":1}]}]"#;
        assert_eq!(newest(json, "horizon-windows-x64.zip").unwrap(), None);
    }

    #[test]
    fn order_comes_from_the_version_not_the_list() {
        let json = r#"[
            {"tag_name":"v0.2.9","assets":[{"name":"a.zip","browser_download_url":"1"},{"name":"SHA256SUMS","browser_download_url":"2"},{"name":"SHA256SUMS.sig","browser_download_url":"3"}]},
            {"tag_name":"v0.2.10","assets":[{"name":"a.zip","browser_download_url":"4"},{"name":"SHA256SUMS","browser_download_url":"5"},{"name":"SHA256SUMS.sig","browser_download_url":"6"}]},
            {"tag_name":"v0.3.0","prerelease":true,"assets":[{"name":"a.zip","browser_download_url":"7"},{"name":"SHA256SUMS","browser_download_url":"8"},{"name":"SHA256SUMS.sig","browser_download_url":"9"}]}
        ]"#;
        assert_eq!(newest(json, "a.zip").unwrap().unwrap().tag, "v0.2.10");
    }
}
