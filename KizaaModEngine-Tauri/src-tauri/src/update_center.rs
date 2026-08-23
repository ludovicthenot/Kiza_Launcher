//! Which installed files have an update, and whether it may be applied.
//!
//! The decision is deliberately separated from the network: everything here is
//! pure, so the rules that matter — compatibility, pinning, never downgrading —
//! are testable without calling Modrinth or CurseForge.
//!
//! An update is only ever offered for a file whose origin is known. Guessing a
//! project from a file name would eventually replace the wrong mod.

use crate::content_provenance::ContentOrigin;
use serde::{Deserialize, Serialize};

/// A release as the platform describes it, reduced to what the decision needs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AvailableVersion {
    pub version_id: String,
    /// Human version, e.g. "0.6.0+mc1.21".
    pub version_name: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    /// Newest first is not guaranteed by every API, so the date decides.
    pub released_at: String,
    pub changelog: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStatus {
    /// A newer compatible release exists and may be applied.
    Available,
    /// A newer release exists but the file is pinned to its current version.
    Pinned,
    /// Already on the newest release compatible with this instance.
    UpToDate,
    /// Newer releases exist, but none supports this Minecraft version or loader.
    NoCompatibleRelease,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateCandidate {
    /// Path relative to the game directory, e.g. "mods/sodium.jar".
    pub path: String,
    pub provider: String,
    pub project_id: String,
    pub current_version_id: String,
    pub status: UpdateStatus,
    /// Only set when status is Available or Pinned.
    pub target: Option<AvailableVersion>,
}

/// What the instance can actually run.
#[derive(Debug, Clone)]
pub struct InstanceTarget {
    pub mc_version: String,
    pub loader: String,
}

fn supports(version: &AvailableVersion, target: &InstanceTarget) -> bool {
    let game_ok = version
        .game_versions
        .iter()
        .any(|candidate| candidate == &target.mc_version);
    // Vanilla content (resource packs, shaders) declares no loader at all.
    let loader_ok = version.loaders.is_empty()
        || version
            .loaders
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&target.loader));
    game_ok && loader_ok
}

/// Every release of a project this instance can actually run, newest first.
///
/// Unlike [`evaluate`], this does not stop at releases newer than the installed
/// one. Choosing an older version is a legitimate thing to want — a mod that
/// broke in its latest release, or a server still on the previous one — and the
/// only alternative is uninstalling and hunting the file down by hand.
pub fn compatible_versions<'a>(
    available: &'a [AvailableVersion],
    target: &InstanceTarget,
) -> Vec<&'a AvailableVersion> {
    let mut versions: Vec<&AvailableVersion> = available
        .iter()
        .filter(|version| supports(version, target))
        .collect();
    versions.sort_by(|left, right| right.released_at.cmp(&left.released_at));
    versions
}

/// Decides what to do with one installed file.
///
/// `available` is the project's release list. The current version is located by
/// id, and only releases published *after* it are considered: platforms do not
/// order their lists consistently, and re-installing an older build because it
/// happened to be listed first is a downgrade the user never asked for.
pub fn evaluate(
    path: &str,
    origin: &ContentOrigin,
    available: &[AvailableVersion],
    target: &InstanceTarget,
) -> UpdateCandidate {
    let current = available
        .iter()
        .find(|version| version.version_id == origin.version_id);

    let newer: Vec<&AvailableVersion> = available
        .iter()
        .filter(|version| version.version_id != origin.version_id)
        .filter(|version| match current {
            Some(current) => version.released_at > current.released_at,
            // The installed version is not in the list any more; without a
            // reference point, nothing can be called "newer" honestly.
            None => false,
        })
        .collect();

    let best = newer
        .iter()
        .filter(|version| supports(version, target))
        .max_by(|left, right| left.released_at.cmp(&right.released_at));

    let status = match (best, newer.is_empty()) {
        (Some(_), _) if origin.pinned => UpdateStatus::Pinned,
        (Some(_), _) => UpdateStatus::Available,
        (None, false) => UpdateStatus::NoCompatibleRelease,
        (None, true) => UpdateStatus::UpToDate,
    };

    UpdateCandidate {
        path: path.to_string(),
        provider: origin.provider.clone(),
        project_id: origin.project_id.clone(),
        current_version_id: origin.version_id.clone(),
        status,
        target: best.map(|version| (*version).clone()),
    }
}

/// Loader names CurseForge mixes into its `gameVersions` array alongside real
/// Minecraft versions. Splitting them apart is the only way to tell "1.21" from
/// "Fabric" in that list.
const CURSEFORGE_LOADER_NAMES: [&str; 5] = ["Forge", "Fabric", "Quilt", "NeoForge", "LiteLoader"];

/// Splits a CurseForge `gameVersions` array into Minecraft versions and loaders.
pub fn split_curseforge_game_versions(values: &[String]) -> (Vec<String>, Vec<String>) {
    let mut game_versions = Vec::new();
    let mut loaders = Vec::new();
    for value in values {
        if CURSEFORGE_LOADER_NAMES
            .iter()
            .any(|name| name.eq_ignore_ascii_case(value))
        {
            loaders.push(value.to_lowercase());
        } else {
            game_versions.push(value.clone());
        }
    }
    (game_versions, loaders)
}

/// Candidates that may actually be applied, in the order they were listed.
pub fn applicable(candidates: &[UpdateCandidate]) -> Vec<&UpdateCandidate> {
    candidates
        .iter()
        .filter(|candidate| candidate.status == UpdateStatus::Available)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(version_id: &str, pinned: bool) -> ContentOrigin {
        ContentOrigin {
            provider: "modrinth".to_string(),
            project_id: "AANobbMI".to_string(),
            version_id: version_id.to_string(),
            pinned,
        }
    }

    fn version(id: &str, released_at: &str, game: &[&str], loaders: &[&str]) -> AvailableVersion {
        AvailableVersion {
            version_id: id.to_string(),
            version_name: id.to_string(),
            game_versions: game.iter().map(|value| value.to_string()).collect(),
            loaders: loaders.iter().map(|value| value.to_string()).collect(),
            released_at: released_at.to_string(),
            changelog: None,
        }
    }

    #[test]
    fn every_runnable_release_is_offered_including_older_ones() {
        let available = [
            version("v3", "2026-03-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21"], &["fabric"]),
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            // Runs on another Minecraft version: not a choice at all.
            version("other", "2026-04-01", &["1.20.1"], &["fabric"]),
        ];

        let listed = compatible_versions(&available, &fabric_1_21());
        let ids: Vec<&str> = listed.iter().map(|v| v.version_id.as_str()).collect();

        // Newest first, and the older ones are still there: going back to a
        // release that worked is a legitimate thing to want.
        assert_eq!(ids, vec!["v3", "v2", "v1"]);
    }

    #[test]
    fn a_project_with_nothing_runnable_here_offers_nothing() {
        let available = [version("v1", "2026-01-01", &["1.20.1"], &["forge"])];
        assert!(compatible_versions(&available, &fabric_1_21()).is_empty());
    }

    fn fabric_1_21() -> InstanceTarget {
        InstanceTarget {
            mc_version: "1.21".to_string(),
            loader: "fabric".to_string(),
        }
    }

    #[test]
    fn a_newer_compatible_release_is_offered() {
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21"], &["fabric"]),
        ];

        let candidate = evaluate(
            "mods/sodium.jar",
            &origin("v1", false),
            &available,
            &fabric_1_21(),
        );
        assert_eq!(candidate.status, UpdateStatus::Available);
        assert_eq!(candidate.target.unwrap().version_id, "v2");
    }

    #[test]
    fn an_older_release_is_never_offered_whatever_the_list_order() {
        // Platforms do not order their release lists consistently; picking the
        // first entry would silently downgrade the user.
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21"], &["fabric"]),
        ];

        let candidate = evaluate(
            "mods/sodium.jar",
            &origin("v2", false),
            &available,
            &fabric_1_21(),
        );
        assert_eq!(candidate.status, UpdateStatus::UpToDate);
        assert!(candidate.target.is_none());
    }

    #[test]
    fn a_release_for_another_minecraft_version_is_not_an_update() {
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21.4"], &["fabric"]),
        ];

        let candidate = evaluate(
            "mods/sodium.jar",
            &origin("v1", false),
            &available,
            &fabric_1_21(),
        );
        // Newer, but unusable here: say so instead of hiding it or applying it.
        assert_eq!(candidate.status, UpdateStatus::NoCompatibleRelease);
        assert!(candidate.target.is_none());
    }

    #[test]
    fn a_release_for_another_loader_is_not_an_update() {
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21"], &["forge"]),
        ];

        let candidate = evaluate(
            "mods/sodium.jar",
            &origin("v1", false),
            &available,
            &fabric_1_21(),
        );
        assert_eq!(candidate.status, UpdateStatus::NoCompatibleRelease);
    }

    #[test]
    fn content_without_a_loader_stays_updatable() {
        // Resource packs and shaders declare no loader.
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &[]),
            version("v2", "2026-02-01", &["1.21"], &[]),
        ];

        let candidate = evaluate(
            "shaderpacks/pack.zip",
            &origin("v1", false),
            &available,
            &fabric_1_21(),
        );
        assert_eq!(candidate.status, UpdateStatus::Available);
    }

    #[test]
    fn a_pinned_file_is_listed_but_never_applied() {
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21"], &["fabric"]),
        ];

        let candidate = evaluate(
            "mods/sodium.jar",
            &origin("v1", true),
            &available,
            &fabric_1_21(),
        );
        // The user still sees that an update exists...
        assert_eq!(candidate.status, UpdateStatus::Pinned);
        assert_eq!(candidate.target.as_ref().unwrap().version_id, "v2");
        // ...but a group apply must skip it.
        assert!(applicable(&[candidate]).is_empty());
    }

    #[test]
    fn an_unknown_current_version_yields_no_update() {
        // The installed release was withdrawn from the platform. With no
        // reference point, calling anything "newer" would be a guess.
        let available = vec![version("v2", "2026-02-01", &["1.21"], &["fabric"])];

        let candidate = evaluate(
            "mods/sodium.jar",
            &origin("withdrawn", false),
            &available,
            &fabric_1_21(),
        );
        assert_eq!(candidate.status, UpdateStatus::UpToDate);
        assert!(candidate.target.is_none());
    }

    #[test]
    fn the_newest_compatible_release_wins_over_a_newer_incompatible_one() {
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21"], &["fabric"]),
            version("v3", "2026-03-01", &["1.22"], &["fabric"]),
        ];

        let candidate = evaluate(
            "mods/sodium.jar",
            &origin("v1", false),
            &available,
            &fabric_1_21(),
        );
        assert_eq!(candidate.status, UpdateStatus::Available);
        // v3 is newer but for another Minecraft version.
        assert_eq!(candidate.target.unwrap().version_id, "v2");
    }

    #[test]
    fn curseforge_loaders_are_separated_from_minecraft_versions() {
        // CurseForge puts both in one array, so "Fabric" would otherwise be
        // treated as a Minecraft version and match nothing.
        let raw = vec![
            "1.21".to_string(),
            "Fabric".to_string(),
            "1.21.1".to_string(),
            "Quilt".to_string(),
        ];

        let (game_versions, loaders) = split_curseforge_game_versions(&raw);
        assert_eq!(game_versions, vec!["1.21", "1.21.1"]);
        assert_eq!(loaders, vec!["fabric", "quilt"]);
    }

    #[test]
    fn a_curseforge_file_maps_into_a_usable_candidate() {
        let raw = vec!["1.21".to_string(), "Fabric".to_string()];
        let (game_versions, loaders) = split_curseforge_game_versions(&raw);
        let available = vec![
            AvailableVersion {
                version_id: "100".to_string(),
                version_name: "sodium-0.5.jar".to_string(),
                game_versions: game_versions.clone(),
                loaders: loaders.clone(),
                released_at: "2026-01-01".to_string(),
                changelog: None,
            },
            AvailableVersion {
                version_id: "200".to_string(),
                version_name: "sodium-0.6.jar".to_string(),
                game_versions,
                loaders,
                released_at: "2026-02-01".to_string(),
                changelog: None,
            },
        ];

        let origin = ContentOrigin {
            provider: "curseforge".to_string(),
            project_id: "394468".to_string(),
            version_id: "100".to_string(),
            pinned: false,
        };
        let candidate = evaluate("mods/sodium.jar", &origin, &available, &fabric_1_21());
        assert_eq!(candidate.status, UpdateStatus::Available);
        assert_eq!(candidate.target.unwrap().version_id, "200");
    }

    #[test]
    fn a_group_apply_only_takes_what_is_applicable() {
        let available = vec![
            version("v1", "2026-01-01", &["1.21"], &["fabric"]),
            version("v2", "2026-02-01", &["1.21"], &["fabric"]),
        ];
        let candidates = vec![
            evaluate(
                "mods/a.jar",
                &origin("v1", false),
                &available,
                &fabric_1_21(),
            ),
            evaluate(
                "mods/b.jar",
                &origin("v1", true),
                &available,
                &fabric_1_21(),
            ),
            evaluate(
                "mods/c.jar",
                &origin("v2", false),
                &available,
                &fabric_1_21(),
            ),
        ];

        let selected = applicable(&candidates);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].path, "mods/a.jar");
    }
}
