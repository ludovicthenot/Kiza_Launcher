//! Turning "requires mixinextras" into something the launcher can fetch.
//!
//! A mod declares what it needs by mod id — the name written inside the jar's
//! own manifest. A catalogue knows projects by slug and by title, and the two
//! agree often enough to be useful and not often enough to be trusted: MixinExtras
//! is `mixinextras` on both, while Fabric API declares itself `fabric` and is
//! published as `fabric-api`.
//!
//! So the id is looked up, and the answer is either confident or absent. A near
//! match is not installed on the reader's behalf; a launcher that fetches
//! something plausible when it cannot find the right thing is worse than one
//! that says it could not find it.

use crate::dependency_resolver::comparable_name;
use crate::modrinth_api;
use serde::{Deserialize, Serialize};

/// A dependency the launcher found in a catalogue, ready to install.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct FoundDependency {
    /// The mod id that was asked for.
    pub dependency_id: String,
    pub provider: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    /// How the match was made, so the interface can be honest about it.
    pub matched_by: MatchKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    /// The catalogue has a project under exactly this id.
    Slug,
    /// A search returned a project whose name is the same word.
    Name,
}

/// Ids a mod declares that are not published under that name.
///
/// Short, and it stays short: every entry is a promise that has to be kept
/// correct by hand. Only the ones common enough that failing on them would look
/// like the feature is broken.
const KNOWN_ALIASES: [(&str, &str); 4] = [
    // Fabric API declares itself `fabric` and is published as `fabric-api`.
    ("fabric", "fabric-api"),
    ("fabric-api", "fabric-api"),
    // Cloth Config's mod id keeps a major-version suffix its slug does not.
    ("cloth-config2", "cloth-config"),
    ("cloth_config", "cloth-config"),
];

fn aliased(dependency_id: &str) -> &str {
    let lowered = dependency_id.trim();
    KNOWN_ALIASES
        .iter()
        .find(|(id, _)| id.eq_ignore_ascii_case(lowered))
        .map(|(_, slug)| *slug)
        .unwrap_or(lowered)
}

/// Whether a search hit is the project that was asked for.
///
/// Compared with punctuation and case removed, the same way the resolver
/// decides whether two catalogues are describing one mod. "MixinExtras" answers
/// for `mixinextras`; "Mixin Extras Fork" does not.
fn is_the_same_mod(dependency_id: &str, slug: &str, title: &str) -> bool {
    let wanted = comparable_name(dependency_id);
    !wanted.is_empty() && (comparable_name(slug) == wanted || comparable_name(title) == wanted)
}

/// Looks up a missing mod id in Modrinth.
///
/// CurseForge is not searched: it has no slug lookup, its search matches
/// loosely, and its keys are per-build — a wrong project installed silently is
/// the failure this whole module is arranged to avoid. A mod only CurseForge
/// publishes stays a sentence telling the reader what to look for.
pub async fn find(dependency_id: &str) -> Result<Option<FoundDependency>, String> {
    let asked = dependency_id.trim();
    if asked.is_empty() {
        return Ok(None);
    }

    if let Ok(project) = modrinth_api::get_project(aliased(asked)).await {
        return Ok(Some(FoundDependency {
            dependency_id: asked.to_string(),
            provider: "modrinth".to_string(),
            project_id: project.id,
            name: project.title,
            description: project.description,
            icon_url: project.icon_url,
            matched_by: MatchKind::Slug,
        }));
    }

    let results = modrinth_api::search(asked, None, None, 10, 0).await?;
    let hit = results
        .hits
        .into_iter()
        .find(|hit| is_the_same_mod(asked, &hit.project_id, &hit.title));

    Ok(hit.map(|hit| FoundDependency {
        dependency_id: asked.to_string(),
        provider: "modrinth".to_string(),
        project_id: hit.project_id,
        name: hit.title,
        description: hit.description,
        icon_url: hit.icon_url,
        matched_by: MatchKind::Name,
    }))
}

/// The mod's own name in a CurseForge project page URL.
///
/// `https://www.curseforge.com/minecraft/mc-mods/not-enough-animations` is the
/// last segment and nothing else. Both sites build that segment from the mod's
/// name, which is why it agrees between them far more often than a search does.
pub fn curseforge_slug(page_url: &str) -> Option<&str> {
    let slug = page_url.trim_end_matches('/').rsplit('/').next()?;
    let plausible = !slug.is_empty()
        && slug.len() <= 128
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    plausible.then_some(slug)
}

/// The same mod on Modrinth, for one a CurseForge author will not let a
/// launcher download.
///
/// This is not a way around anybody's decision. The switch an author flips is
/// on CurseForge and applies to CurseForge; a mod also published on Modrinth is
/// published there under Modrinth's terms, where the API serves downloads by
/// design. An author who wants neither is on neither, and then nothing is found
/// and the project page is all the launcher can offer.
///
/// The build will not be the one the pack pinned — it is whichever Modrinth
/// release fits the instance — so this is offered rather than done.
pub async fn alternative_on_modrinth(
    name: &str,
    page_url: Option<&str>,
) -> Option<FoundDependency> {
    let asked = name.trim();

    if let Some(slug) = page_url.and_then(curseforge_slug) {
        if let Ok(project) = modrinth_api::get_project(slug).await {
            // Either the names agree, or the slug does exactly — a project
            // published under the same name on both sites is the same mod far
            // more often than it is a coincidence, and the titles differ
            // legitimately ("Just Enough Items (JEI)" against "JEI").
            let same_slug = comparable_name(slug) == comparable_name(&project.slug);
            if same_slug || is_the_same_mod(asked, &project.slug, &project.title) {
                return Some(FoundDependency {
                    dependency_id: slug.to_string(),
                    provider: "modrinth".to_string(),
                    project_id: project.id,
                    name: project.title,
                    description: project.description,
                    icon_url: project.icon_url,
                    matched_by: MatchKind::Slug,
                });
            }
        }
    }

    if asked.is_empty() {
        return None;
    }
    let results = modrinth_api::search(asked, None, None, 10, 0).await.ok()?;
    results
        .hits
        .into_iter()
        .find(|hit| is_the_same_mod(asked, &hit.project_id, &hit.title))
        .map(|hit| FoundDependency {
            dependency_id: asked.to_string(),
            provider: "modrinth".to_string(),
            project_id: hit.project_id,
            name: hit.title,
            description: hit.description,
            icon_url: hit.icon_url,
            matched_by: MatchKind::Name,
        })
}

/// The Modrinth release to install in place of a build CurseForge would not
/// serve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ModrinthBuild {
    pub version_id: String,
    pub version_number: String,
    /// True when this is the build the pack asked for -- the same bytes, or
    /// the same release under Modrinth's name for it. False when it is the
    /// nearest one Modrinth has, which is a guess the reader should see.
    pub exact: bool,
}

/// The build a pack pinned, as CurseForge describes it without serving it:
/// its name, its SHA-1 and when it came out.
#[derive(Debug, Clone, Copy)]
pub struct PinnedBuild<'a> {
    pub file_name: &'a str,
    pub sha1: Option<&'a str>,
    /// ISO 8601, as both catalogues write dates.
    pub published: Option<&'a str>,
}

/// The pack's own build of a mod on Modrinth, or the nearest one.
///
/// A pack pins a build for a reason: RLCraft ships an SRParasites its own
/// mixins know the fields of, and the newest release two years later has a
/// new armour material those mixins turn into a null and the game into a
/// crash at "Initializing game". So the pinned build is looked for first, by
/// the bytes and then by the name; only when Modrinth never had that release
/// is the closest one taken -- the last one out before the pack was built,
/// which is what the pack was built against -- and it is marked as a guess.
pub async fn build_on_modrinth(
    project_id: &str,
    pinned: PinnedBuild<'_>,
    mc_version: &str,
    loader: Option<&str>,
) -> Option<ModrinthBuild> {
    if let Some(sha1) = pinned.sha1.filter(|hash| !hash.trim().is_empty()) {
        if let Ok(Some(version)) = modrinth_api::version_from_sha1(sha1.trim()).await {
            if version.project_id == project_id {
                return Some(ModrinthBuild {
                    version_id: version.id,
                    version_number: version.version_number,
                    exact: true,
                });
            }
        }
    }
    let versions = modrinth_api::get_versions_for(project_id, Some(mc_version), loader)
        .await
        .ok()?;
    pick_build(&versions, pinned)
}

/// Which of a project's releases stands in for the pinned build.
fn pick_build(
    versions: &[modrinth_api::ModrinthVersion],
    pinned: PinnedBuild<'_>,
) -> Option<ModrinthBuild> {
    let mut versions: Vec<&modrinth_api::ModrinthVersion> = versions.iter().collect();
    versions.sort_by(|left, right| right.date_published.cmp(&left.date_published));

    let same_release = versions.iter().find(|version| {
        version
            .files
            .iter()
            .any(|file| file.filename.eq_ignore_ascii_case(pinned.file_name))
            || file_name_carries_version(pinned.file_name, &version.version_number)
    });
    if let Some(version) = same_release {
        return Some(ModrinthBuild {
            version_id: version.id.clone(),
            version_number: version.version_number.clone(),
            exact: true,
        });
    }

    // Nothing by that name: the last release out before the pack was built,
    // or failing that the first one after it. Newest-first, so "last before"
    // is the first that is not after.
    let nearest = pinned
        .published
        .map(date_key)
        .filter(|date| !date.is_empty())
        .and_then(|pack_date| {
            versions
                .iter()
                .find(|version| date_key(&version.date_published) <= pack_date)
                .or_else(|| versions.last())
        })
        .or_else(|| versions.first())?;
    Some(ModrinthBuild {
        version_id: nearest.id.clone(),
        version_number: nearest.version_number.clone(),
        exact: false,
    })
}

/// The part of an ISO 8601 date that orders it: both catalogues write
/// `YYYY-MM-DDTHH:MM:SS` and then differ in fractions and zone.
fn date_key(date: &str) -> &str {
    let end = date
        .char_indices()
        .nth(19)
        .map(|(index, _)| index)
        .unwrap_or(date.len());
    &date[..end]
}

/// Whether a file name names this release: `SRParasites-1.12.2v1.9.11.jar`
/// carries `1.9.11` and not `1.9.1`, so the version has to stand on its own,
/// with neither a digit nor a dotted digit continuing it on either side.
fn file_name_carries_version(file_name: &str, version_number: &str) -> bool {
    let version = version_number.trim();
    if version.is_empty() || !version.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let file_name = file_name.to_ascii_lowercase();
    let version = version.to_ascii_lowercase();
    let continues = |slice: &str| {
        let mut chars = slice.chars();
        match chars.next() {
            Some(c) if c.is_ascii_digit() => true,
            Some('.') => chars.next().is_some_and(|c| c.is_ascii_digit()),
            _ => false,
        }
    };
    let precedes = |slice: &str| {
        let mut chars = slice.chars().rev();
        match chars.next() {
            Some(c) if c.is_ascii_digit() => true,
            Some('.') => chars.next().is_some_and(|c| c.is_ascii_digit()),
            _ => false,
        }
    };
    file_name.match_indices(&version).any(|(start, _)| {
        !precedes(&file_name[..start]) && !continues(&file_name[start + version.len()..])
    })
}

#[cfg(test)]
mod tests {
    use super::{
        aliased, curseforge_slug, file_name_carries_version, is_the_same_mod, pick_build,
        PinnedBuild,
    };
    use crate::modrinth_api::{ModrinthFile, ModrinthHashes, ModrinthVersion};

    fn release(id: &str, number: &str, file: &str, date: &str) -> ModrinthVersion {
        ModrinthVersion {
            id: id.to_string(),
            project_id: "MJX7HTHx".to_string(),
            name: number.to_string(),
            version_number: number.to_string(),
            game_versions: vec!["1.12.2".to_string()],
            loaders: vec!["forge".to_string()],
            files: vec![ModrinthFile {
                url: String::new(),
                filename: file.to_string(),
                primary: true,
                size: 1,
                hashes: ModrinthHashes {
                    sha1: id.repeat(8),
                    sha512: String::new(),
                },
            }],
            date_published: format!("{date}T12:00:00Z"),
            changelog: None,
            dependencies: Vec::new(),
        }
    }

    /// What RLCraft 2.9.3 pins against what Modrinth has: no 1.9.11, so the
    /// last release before the pack, not the newest one two years on.
    #[test]
    fn the_pinned_build_is_found_by_name_and_otherwise_by_date() {
        let versions = vec![
            release("new", "1.10.9", "SRParasites-1.10.9.jar", "2026-09-01"),
            release("after", "1.9.12", "SRParasites-1.12.2v1.9.12.jar", "2023-04-17"),
            release("before", "1.9.10", "SRParasites-1.12.2v1.9.10.jar", "2023-02-07"),
            release("old", "1.9.7", "SRParasites-1.12.2v1.9.7.jar", "2022-11-21"),
        ];
        let pinned = PinnedBuild {
            file_name: "SRParasites-1.12.2v1.9.11.jar",
            sha1: None,
            published: Some("2023-03-14T05:48:03.53Z"),
        };
        let chosen = pick_build(&versions, pinned).expect("a release");
        assert_eq!(chosen.version_id, "before");
        assert!(!chosen.exact);

        // The release itself, when Modrinth has it, even under another file name.
        let chosen = pick_build(
            &versions,
            PinnedBuild {
                file_name: "SRParasites-1.9.12-forge.jar",
                sha1: None,
                published: Some("2023-04-17T00:00:00Z"),
            },
        )
        .expect("a release");
        assert_eq!(chosen.version_id, "after");
        assert!(chosen.exact);

        // A pack older than every release gets the earliest; one with no
        // date gets the newest, which is all there is to go on.
        let chosen = pick_build(
            &versions,
            PinnedBuild {
                file_name: "SRParasites-1.12.2v1.8.0.jar",
                sha1: None,
                published: Some("2021-01-01T00:00:00Z"),
            },
        )
        .expect("a release");
        assert_eq!(chosen.version_id, "old");
        let chosen = pick_build(
            &versions,
            PinnedBuild {
                file_name: "SRParasites-1.12.2v1.8.0.jar",
                sha1: None,
                published: None,
            },
        )
        .expect("a release");
        assert_eq!(chosen.version_id, "new");
        assert!(pick_build(&[], pinned).is_none());
    }

    /// Against the live catalogue: what RLCraft 2.9.3 pins, which Modrinth
    /// never had, so the release just before it and not the newest.
    #[tokio::test]
    #[ignore = "asks Modrinth"]
    async fn live_rlcraft_gets_the_parasites_release_its_mixins_know() {
        let build = super::build_on_modrinth(
            "MJX7HTHx",
            PinnedBuild {
                file_name: "SRParasites-1.12.2v1.9.11.jar",
                sha1: Some("1429fcf63bb015b94d66816be70dc5c0a4e0ab72"),
                published: Some("2023-03-14T05:48:03.53Z"),
            },
            "1.12.2",
            Some("forge"),
        )
        .await
        .expect("a release");
        assert_eq!(build.version_number, "1.9.10");
        assert!(!build.exact);
    }

    #[test]
    fn a_version_has_to_stand_on_its_own_in_a_file_name() {
        assert!(file_name_carries_version("SRParasites-1.12.2v1.9.11.jar", "1.9.11"));
        assert!(file_name_carries_version("jei_1.12.2-4.16.1.301.jar", "4.16.1.301"));
        assert!(file_name_carries_version(
            "RTG-1.12.2-6.1.0.0-snapshot.1.jar",
            "6.1.0.0-snapshot.1"
        ));
        // 1.9.1 is inside 1.9.11 and 1.9.11 is inside 1.9.110.
        assert!(!file_name_carries_version("SRParasites-1.12.2v1.9.11.jar", "1.9.1"));
        assert!(!file_name_carries_version("SRParasites-1.12.2v1.9.110.jar", "1.9.11"));
        assert!(!file_name_carries_version("SRParasites-1.12.2v1.9.11.jar", "2.2v1"));
        assert!(!file_name_carries_version("SRParasites-1.12.2v1.9.11.jar", ""));
        assert!(!file_name_carries_version("SRParasites-1.12.2v1.9.11.jar", "jar"));
    }

    #[test]
    fn a_mod_id_that_is_published_under_another_name_is_translated() {
        assert_eq!(aliased("fabric"), "fabric-api");
        assert_eq!(aliased("Fabric"), "fabric-api");
        assert_eq!(aliased("cloth-config2"), "cloth-config");
        // Everything else is asked for as written, which is the common case.
        assert_eq!(aliased("mixinextras"), "mixinextras");
        assert_eq!(aliased(" sodium "), "sodium");
    }

    /// The name in the URL is the thing both sites agree on.
    #[test]
    fn a_project_page_gives_up_the_mods_own_name() {
        assert_eq!(
            curseforge_slug("https://www.curseforge.com/minecraft/mc-mods/not-enough-animations"),
            Some("not-enough-animations")
        );
        assert_eq!(
            curseforge_slug("https://www.curseforge.com/minecraft/mc-mods/jei/"),
            Some("jei")
        );
        // Anything that is not a plain name is not one.
        assert_eq!(curseforge_slug("https://www.curseforge.com/"), None);
        assert_eq!(curseforge_slug("https://example.test/a b"), None);
        assert_eq!(curseforge_slug(""), None);
    }

    /// A near miss is a wrong install, and a wrong install is worse than a
    /// sentence saying what to look for.
    #[test]
    fn only_the_same_word_answers_for_a_mod_id() {
        assert!(is_the_same_mod("mixinextras", "mixinextras", "MixinExtras"));
        // Punctuation and case do not make it a different mod.
        assert!(is_the_same_mod(
            "cloth_config",
            "cloth-config",
            "Cloth Config API"
        ));
        assert!(is_the_same_mod("jei", "AbCdEf12", "JEI"));

        assert!(!is_the_same_mod(
            "mixinextras",
            "mixinextras-fork",
            "MixinExtras Fork"
        ));
        assert!(!is_the_same_mod("sodium", "embeddium", "Embeddium"));
        assert!(!is_the_same_mod("", "anything", "Anything"));
    }
}
