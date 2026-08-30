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

#[cfg(test)]
mod tests {
    use super::{aliased, curseforge_slug, is_the_same_mod};

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
