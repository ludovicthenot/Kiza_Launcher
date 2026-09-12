//! One set of filters, spoken to two catalogues in their own words.
//!
//! Modrinth and CurseForge both let a search be narrowed by what a mod *is*
//! -- an optimisation, a tech mod, a library -- and neither uses the other's
//! names. Modrinth has nineteen lowercase slugs; CurseForge has numeric ids
//! per content class, fifty-odd for mods alone, including one per famous mod
//! it has a section for. A person choosing "Optimisation" should not have to
//! know that this is `optimization` on one and `6814` on the other.
//!
//! So the launcher has its own short list, and each entry says what it is on
//! each catalogue. Where a catalogue has no equivalent the entry says so, and
//! the search simply does not narrow by it there -- which the interface can
//! show -- rather than pretending with a near miss.
//!
//! The same for ordering: five ways to sort, each mapped to the nearest thing
//! the catalogue offers, and where the catalogue has no such thing the
//! fallback is written down here and not improvised at the call site.
//!
//! The ids and slugs below were read from the catalogues themselves on
//! 2026-09-12 (`/v2/tag/category` on Modrinth, `/v1/categories?gameId=432`
//! on CurseForge), never guessed.

use serde::{Deserialize, Serialize};

/// What kind of content is being searched for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentKind {
    Mod,
    Shader,
    ResourcePack,
}

impl ContentKind {
    pub fn parse(project_type: &str) -> Option<Self> {
        match project_type {
            "mod" => Some(Self::Mod),
            "shader" => Some(Self::Shader),
            "resourcepack" => Some(Self::ResourcePack),
            _ => None,
        }
    }
}

/// A category as the launcher names it, and as each catalogue does.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Category {
    /// The launcher's own id, stable across catalogues: "optimization".
    pub id: &'static str,
    /// What to show.
    pub label: &'static str,
    /// Modrinth's slug, or none if Modrinth has no such category.
    pub modrinth: Option<&'static str>,
    /// CurseForge's category ids, several where CurseForge splits what one
    /// word covers, or none if CurseForge has no such category.
    pub curseforge: &'static [u32],
}

const MOD_CATEGORIES: &[Category] = &[
    Category { id: "optimization", label: "Optimisation", modrinth: Some("optimization"), curseforge: &[6814] },
    Category { id: "utility", label: "Utility", modrinth: Some("utility"), curseforge: &[5191] },
    Category { id: "technology", label: "Technology", modrinth: Some("technology"), curseforge: &[412] },
    Category { id: "magic", label: "Magic", modrinth: Some("magic"), curseforge: &[419] },
    Category { id: "adventure", label: "Adventure", modrinth: Some("adventure"), curseforge: &[422] },
    Category { id: "worldgen", label: "World generation", modrinth: Some("worldgen"), curseforge: &[406, 407, 409, 410] },
    Category { id: "decoration", label: "Decoration", modrinth: Some("decoration"), curseforge: &[424] },
    Category { id: "storage", label: "Storage", modrinth: Some("storage"), curseforge: &[420] },
    Category { id: "equipment", label: "Equipment", modrinth: Some("equipment"), curseforge: &[434] },
    Category { id: "mobs", label: "Mobs", modrinth: Some("mobs"), curseforge: &[411] },
    Category { id: "food", label: "Food", modrinth: Some("food"), curseforge: &[436, 416] },
    Category { id: "transportation", label: "Transport", modrinth: Some("transportation"), curseforge: &[414] },
    Category { id: "library", label: "Library", modrinth: Some("library"), curseforge: &[421] },
    Category { id: "game-mechanics", label: "Game mechanics", modrinth: Some("game-mechanics"), curseforge: &[] },
    Category { id: "bug-fixes", label: "Bug fixes", modrinth: None, curseforge: &[6821] },
];

const SHADER_CATEGORIES: &[Category] = &[
    Category { id: "realistic", label: "Realistic", modrinth: Some("realistic"), curseforge: &[6553] },
    Category { id: "fantasy", label: "Fantasy", modrinth: Some("fantasy"), curseforge: &[6554] },
    Category { id: "vanilla-like", label: "Vanilla-like", modrinth: Some("vanilla-like"), curseforge: &[6555] },
    Category { id: "potato", label: "Low-end", modrinth: Some("potato"), curseforge: &[] },
    Category { id: "high", label: "High-end", modrinth: Some("high"), curseforge: &[] },
    Category { id: "path-tracing", label: "Path tracing", modrinth: Some("path-tracing"), curseforge: &[] },
];

const RESOURCE_PACK_CATEGORIES: &[Category] = &[
    Category { id: "16x", label: "16x", modrinth: Some("16x"), curseforge: &[393] },
    Category { id: "32x", label: "32x", modrinth: Some("32x"), curseforge: &[394] },
    Category { id: "64x", label: "64x", modrinth: Some("64x"), curseforge: &[395] },
    Category { id: "128x", label: "128x", modrinth: Some("128x"), curseforge: &[396] },
    Category { id: "256x+", label: "256x and up", modrinth: Some("256x"), curseforge: &[397, 398] },
    Category { id: "realistic", label: "Realistic", modrinth: Some("realistic"), curseforge: &[400] },
    Category { id: "themed", label: "Themed", modrinth: Some("themed"), curseforge: &[399, 401, 402, 403] },
    Category { id: "vanilla-like", label: "Vanilla-like", modrinth: Some("vanilla-like"), curseforge: &[] },
    Category { id: "modded", label: "Mod support", modrinth: Some("modded"), curseforge: &[4465] },
    Category { id: "fonts", label: "Fonts", modrinth: Some("fonts"), curseforge: &[5244] },
];

/// The categories offered for a kind of content.
pub fn categories_for(kind: ContentKind) -> &'static [Category] {
    match kind {
        ContentKind::Mod => MOD_CATEGORIES,
        ContentKind::Shader => SHADER_CATEGORIES,
        ContentKind::ResourcePack => RESOURCE_PACK_CATEGORIES,
    }
}

/// Modrinth's slugs for the chosen launcher categories. Unknown ids and
/// categories Modrinth lacks are dropped, not passed through.
pub fn modrinth_slugs(kind: ContentKind, chosen: &[String]) -> Vec<String> {
    categories_for(kind)
        .iter()
        .filter(|category| chosen.iter().any(|id| id == category.id))
        .filter_map(|category| category.modrinth)
        .map(str::to_string)
        .collect()
}

/// CurseForge's ids for the chosen launcher categories, likewise.
pub fn curseforge_ids(kind: ContentKind, chosen: &[String]) -> Vec<u32> {
    categories_for(kind)
        .iter()
        .filter(|category| chosen.iter().any(|id| id == category.id))
        .flat_map(|category| category.curseforge.iter().copied())
        .collect()
}

/// Which chosen categories a catalogue cannot narrow by.
///
/// For the interface to say "CurseForge does not filter by Bug fixes" rather
/// than silently returning everything.
pub fn unsupported_by_curseforge(kind: ContentKind, chosen: &[String]) -> Vec<&'static str> {
    categories_for(kind)
        .iter()
        .filter(|category| chosen.iter().any(|id| id == category.id))
        .filter(|category| category.curseforge.is_empty())
        .map(|category| category.label)
        .collect()
}

pub fn unsupported_by_modrinth(kind: ContentKind, chosen: &[String]) -> Vec<&'static str> {
    categories_for(kind)
        .iter()
        .filter(|category| chosen.iter().any(|id| id == category.id))
        .filter(|category| category.modrinth.is_none())
        .map(|category| category.label)
        .collect()
}

/// How results may be ordered, in the launcher's words.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    Relevance,
    Downloads,
    /// People who intend to come back, not everyone who ever tried it.
    Follows,
    Newest,
    Updated,
}

impl Sort {
    pub fn parse(text: Option<&str>) -> Option<Self> {
        match text? {
            "relevance" => Some(Self::Relevance),
            "downloads" => Some(Self::Downloads),
            "follows" => Some(Self::Follows),
            "newest" => Some(Self::Newest),
            "updated" => Some(Self::Updated),
            _ => None,
        }
    }

    /// Modrinth offers all five by these names.
    pub fn modrinth_index(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::Downloads => "downloads",
            Self::Follows => "follows",
            Self::Newest => "newest",
            Self::Updated => "updated",
        }
    }

    /// CurseForge's `sortField`: 2 Popularity, 3 LastUpdated, 6 TotalDownloads,
    /// 11 ReleasedDate. It has no relevance ordering and no follows, and
    /// popularity is the nearest thing to either -- it is what CurseForge
    /// itself shows for a search.
    pub fn curseforge_field(self) -> u32 {
        match self {
            Self::Relevance | Self::Follows => 2,
            Self::Downloads => 6,
            Self::Newest => 11,
            Self::Updated => 3,
        }
    }

    /// Whether CurseForge honours this ordering or substitutes its nearest.
    pub fn exact_on_curseforge(self) -> bool {
        !matches!(self, Self::Relevance | Self::Follows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reason this module exists: one word, two catalogues, and a person
    /// who should not have to know that they disagree.
    #[test]
    fn one_choice_becomes_each_catalogue_s_own_name() {
        let chosen = vec!["optimization".to_string(), "worldgen".to_string()];
        assert_eq!(
            modrinth_slugs(ContentKind::Mod, &chosen),
            vec!["optimization".to_string(), "worldgen".to_string()]
        );
        // CurseForge splits world generation four ways; all four are asked.
        assert_eq!(curseforge_ids(ContentKind::Mod, &chosen), vec![6814, 406, 407, 409, 410]);
    }

    /// What one catalogue lacks is named, not faked with a near miss.
    #[test]
    fn a_category_a_catalogue_lacks_is_reported_rather_than_approximated() {
        let chosen = vec!["bug-fixes".to_string(), "game-mechanics".to_string()];
        assert_eq!(modrinth_slugs(ContentKind::Mod, &chosen), vec!["game-mechanics".to_string()]);
        assert_eq!(curseforge_ids(ContentKind::Mod, &chosen), vec![6821]);
        assert_eq!(unsupported_by_modrinth(ContentKind::Mod, &chosen), vec!["Bug fixes"]);
        assert_eq!(unsupported_by_curseforge(ContentKind::Mod, &chosen), vec!["Game mechanics"]);
    }

    #[test]
    fn an_unknown_id_is_ignored_not_forwarded() {
        let chosen = vec!["definitely-not-a-category".to_string()];
        assert!(modrinth_slugs(ContentKind::Mod, &chosen).is_empty());
        assert!(curseforge_ids(ContentKind::Mod, &chosen).is_empty());
    }

    /// Every launcher category maps somewhere on at least one catalogue, and
    /// every id is unique within its kind -- otherwise a chip would do
    /// nothing anywhere, or two chips would be one.
    #[test]
    fn every_category_is_reachable_and_distinct() {
        for kind in [ContentKind::Mod, ContentKind::Shader, ContentKind::ResourcePack] {
            let list = categories_for(kind);
            for category in list {
                assert!(
                    category.modrinth.is_some() || !category.curseforge.is_empty(),
                    "{} maps to nothing",
                    category.id
                );
            }
            let mut ids: Vec<&str> = list.iter().map(|c| c.id).collect();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), list.len(), "duplicate id in {kind:?}");
        }
    }

    #[test]
    fn orderings_map_to_what_each_catalogue_has() {
        assert_eq!(Sort::parse(Some("follows")), Some(Sort::Follows));
        assert_eq!(Sort::parse(Some("popularity")), None);

        assert_eq!(Sort::Follows.modrinth_index(), "follows");
        // CurseForge has no follows; popularity stands in and says so.
        assert_eq!(Sort::Follows.curseforge_field(), 2);
        assert!(!Sort::Follows.exact_on_curseforge());
        assert_eq!(Sort::Newest.curseforge_field(), 11);
        assert!(Sort::Newest.exact_on_curseforge());
    }
}
