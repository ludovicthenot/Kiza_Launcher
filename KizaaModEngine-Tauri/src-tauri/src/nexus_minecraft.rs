//! Nexus Mods, for Minecraft and nothing else.
//!
//! The launcher grew out of a general Nexus mod manager, and `nexus_api.rs`
//! still knows every game Nexus hosts. This module knows one. The game domain
//! is a constant, not a parameter: there is no call here that could be made
//! about another game, so there is no way to make one by mistake.
//!
//! # Where the catalogue comes from
//!
//! Nexus's REST API (v1) can fetch a mod by id, list its files, and resolve a
//! download -- and cannot search. Searching is what the website does through
//! its GraphQL API (`/v2/graphql`), which is public, needs no key to read, and
//! filters by game domain. Everything that lists or looks for a mod goes
//! through GraphQL; the one thing that downloads goes through v1, because
//! that is where the download keys are honoured.
//!
//! # What Nexus is, for Minecraft
//!
//! Small, and mostly not mods. At the time of writing the whole Minecraft
//! section holds 654 entries; the most downloaded are adult content, and of
//! the rest, most are texture packs, worlds and presets rather than mods a
//! loader would load. So:
//!
//! - adult content is excluded unless the caller asks for it. The filter is
//!   Nexus's own flag, set by uploaders and enforced by their moderation, and
//!   the default view of a game launcher has no business showing it;
//! - Nexus's categories are mapped onto the launcher's kinds where they map
//!   and marked as "other" where they do not, so a world save is never
//!   offered to the mods folder.
//!
//! # What Nexus does not know
//!
//! Which Minecraft version or loader a file is for. Modrinth and CurseForge
//! carry that per release; Nexus has a free-text version field and a file
//! description. Compatibility is therefore unknowable until the jar is on
//! disk and read, which the compatibility checker already does for any jar.
//! Nothing here pretends otherwise: a search result carries no versions
//! list, and the interface must say "unknown" rather than "all".

use serde::{Deserialize, Serialize};

/// Nexus's domain name for the game. The only one this module will ever use.
pub const GAME_DOMAIN: &str = "minecraft";

/// Nexus's numeric id for the same game, as their GraphQL and image URLs use.
pub const GAME_ID: u64 = 197;

const GRAPHQL_URL: &str = "https://api.nexusmods.com/v2/graphql";

/// What Nexus content is, in the launcher's terms.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NexusKind {
    Mod,
    ResourcePack,
    Shader,
    World,
    /// Presets, tools, guides: things a person may want and no folder takes.
    Other,
}

/// Nexus's category names, mapped to what the launcher can do with them.
///
/// Nexus categories are per-game and named by their staff. These are the
/// Minecraft section's, read from the live facet list. Anything not listed
/// is `Other`, which is the honest answer for a category this was not
/// written to understand.
pub fn kind_of(category: &str) -> NexusKind {
    let lowered = category.to_ascii_lowercase();
    if lowered.contains("texture") || lowered.contains("resource") {
        return NexusKind::ResourcePack;
    }
    if lowered.contains("shader") {
        return NexusKind::Shader;
    }
    if lowered.contains("world") || lowered.starts_with("maps") {
        return NexusKind::World;
    }
    match lowered.as_str() {
        "gameplay" | "npcs and creatures" | "items" | "armour" | "weapons" | "magic"
        | "miscellaneous" | "utilities" | "user interface" | "visuals and graphics"
        | "audio" | "bug fixes" | "overhauls" | "quests and adventures" => NexusKind::Mod,
        _ => NexusKind::Other,
    }
}

/// One mod page, as the search lists it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NexusHit {
    pub mod_id: u64,
    pub name: String,
    pub version: String,
    pub summary: String,
    pub author: String,
    pub downloads: u64,
    pub endorsements: u64,
    pub updated_at: String,
    pub picture_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub category: String,
    pub kind: NexusKind,
    pub adult: bool,
    /// The page on nexusmods.com, for the person and for the "Download with
    /// manager" button that produces an nxm link.
    pub page_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NexusSearch {
    pub total: u64,
    pub hits: Vec<NexusHit>,
}

/// One file on a mod page.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NexusFile {
    pub file_id: u64,
    pub name: String,
    pub version: String,
    pub size_bytes: u64,
    /// "MAIN", "OPTIONAL", "OLD_VERSION", "MISCELLANEOUS" as Nexus files them.
    pub category: String,
    pub uploaded_at: u64,
    pub description: String,
}

/* --------------------------------------------------------------- wire shapes */

#[derive(Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Deserialize)]
struct ModsData {
    mods: ModsPage,
}

#[derive(Deserialize)]
struct ModsPage {
    #[serde(rename = "totalCount")]
    total_count: u64,
    nodes: Vec<ModNode>,
}

#[derive(Deserialize)]
struct ModNode {
    #[serde(rename = "modId")]
    mod_id: u64,
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    endorsements: u64,
    #[serde(rename = "updatedAt", default)]
    updated_at: String,
    #[serde(rename = "pictureUrl")]
    picture_url: Option<String>,
    #[serde(rename = "thumbnailUrl")]
    thumbnail_url: Option<String>,
    #[serde(rename = "adultContent", default)]
    adult_content: bool,
    #[serde(rename = "modCategory")]
    mod_category: Option<Named>,
    game: Option<GameNode>,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct GameNode {
    #[serde(rename = "domainName")]
    domain_name: String,
}

#[derive(Deserialize)]
struct FilesData {
    #[serde(rename = "modFiles")]
    mod_files: Vec<FileNode>,
}

#[derive(Deserialize)]
struct FileNode {
    #[serde(rename = "fileId")]
    file_id: u64,
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    category: String,
    #[serde(default)]
    date: u64,
    #[serde(default)]
    description: String,
}

/* ------------------------------------------------------------------ parsing */

/// The search query, with the game pinned and adult content decided here.
fn search_query() -> &'static str {
    "query($f: ModsFilter, $s: [ModsSort!], $count: Int, $offset: Int) { \
       mods(filter: $f, sort: $s, count: $count, offset: $offset) { \
         totalCount \
         nodes { modId name version summary author downloads endorsements updatedAt \
                 pictureUrl thumbnailUrl adultContent modCategory { name } game { domainName } } \
       } \
     }"
}

fn search_variables(text: &str, page: u32, per_page: u32, adult: bool) -> serde_json::Value {
    let mut filter = serde_json::json!({
        "gameDomainName": [{ "op": "EQUALS", "value": GAME_DOMAIN }],
    });
    if !adult {
        filter["adultContent"] = serde_json::json!([{ "op": "EQUALS", "value": false }]);
    }
    let text = text.trim();
    if !text.is_empty() {
        filter["name"] = serde_json::json!([{ "op": "WILDCARD", "value": text }]);
    }
    serde_json::json!({
        "f": filter,
        "s": [{ "downloads": { "direction": "DESC" } }],
        "count": per_page,
        "offset": page.saturating_mul(per_page),
    })
}

/// Reads a search response, and refuses anything not about Minecraft.
///
/// The filter already asked for one game. Checking the answer as well is not
/// distrust of Nexus; it is that this module promises to never hand back
/// another game's mod, and a promise kept by the request alone is a promise
/// one changed line away from broken.
pub fn parse_search(body: &str) -> Result<NexusSearch, String> {
    let response: GraphQlResponse<ModsData> =
        serde_json::from_str(body).map_err(|error| format!("Nexus sent something unreadable: {error}"))?;
    if let Some(error) = response.errors.first() {
        return Err(format!("Nexus refused the search: {}", error.message));
    }
    let data = response.data.ok_or("Nexus sent no data.")?;

    let hits = data
        .mods
        .nodes
        .into_iter()
        .filter(|node| {
            node.game
                .as_ref()
                .is_some_and(|game| game.domain_name == GAME_DOMAIN)
        })
        .map(|node| {
            let category = node
                .mod_category
                .map(|category| category.name)
                .unwrap_or_default();
            NexusHit {
                page_url: format!("https://www.nexusmods.com/{GAME_DOMAIN}/mods/{}", node.mod_id),
                kind: kind_of(&category),
                mod_id: node.mod_id,
                name: node.name,
                version: node.version,
                summary: node.summary,
                author: node.author,
                downloads: node.downloads,
                endorsements: node.endorsements,
                updated_at: node.updated_at,
                picture_url: node.picture_url,
                thumbnail_url: node.thumbnail_url,
                category,
                adult: node.adult_content,
            }
        })
        .collect();

    Ok(NexusSearch {
        total: data.mods.total_count,
        hits,
    })
}

pub fn parse_files(body: &str) -> Result<Vec<NexusFile>, String> {
    let response: GraphQlResponse<FilesData> =
        serde_json::from_str(body).map_err(|error| format!("Nexus sent something unreadable: {error}"))?;
    if let Some(error) = response.errors.first() {
        return Err(format!("Nexus refused the file list: {}", error.message));
    }
    let data = response.data.ok_or("Nexus sent no data.")?;
    Ok(data
        .mod_files
        .into_iter()
        .map(|file| NexusFile {
            file_id: file.file_id,
            name: file.name,
            version: file.version,
            size_bytes: file.size,
            category: file.category,
            uploaded_at: file.date,
            description: file.description,
        })
        .collect())
}

/* ------------------------------------------------------------------ network */

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("KizaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
}

async fn graphql(query: &str, variables: serde_json::Value) -> Result<String, String> {
    let response = client()?
        .post(GRAPHQL_URL)
        .header("application-name", "KizaLauncher")
        .header("application-version", env!("CARGO_PKG_VERSION"))
        .json(&serde_json::json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|error| format!("Could not reach Nexus Mods: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Nexus Mods answered {}.", response.status()));
    }
    response
        .text()
        .await
        .map_err(|error| format!("Could not read Nexus Mods' answer: {error}"))
}

/// Searches the Minecraft section. No key needed; adult content off by default.
pub async fn search(text: &str, page: u32, per_page: u32, adult: bool) -> Result<NexusSearch, String> {
    let body = graphql(search_query(), search_variables(text, page, per_page, adult)).await?;
    parse_search(&body)
}

/// The files on one Minecraft mod page.
pub async fn files(mod_id: u64) -> Result<Vec<NexusFile>, String> {
    let query = "query($modId: ID, $gameId: ID) { modFiles(modId: $modId, gameId: $gameId) { \
                   fileId name version size category date description } }";
    let body = graphql(
        query,
        serde_json::json!({ "modId": mod_id.to_string(), "gameId": GAME_ID.to_string() }),
    )
    .await?;
    parse_files(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real answer from Nexus, captured on 2026-09-12 with the search this
    /// module sends: Minecraft, no adult content, name matching "shader".
    const SEARCH: &str = include_str!("../fixtures/nexus-minecraft-search.json");

    #[test]
    fn reads_what_nexus_actually_sends() {
        let found = parse_search(SEARCH).expect("the captured answer should parse");
        assert_eq!(found.total, 5);
        assert_eq!(found.hits.len(), 3);

        let first = &found.hits[0];
        assert_eq!(first.mod_id, 176);
        assert_eq!(first.name, "Optimal Shader Settings for the Best Shaders by SkonteJonte");
        assert_eq!(first.author, "SkonteJonte");
        assert_eq!(first.downloads, 4358);
        assert_eq!(first.page_url, "https://www.nexusmods.com/minecraft/mods/176");
        assert!(!first.adult);
        // Nexus files it under "Resource/Texture pack"; that is what it is.
        assert_eq!(first.kind, NexusKind::ResourcePack);
    }

    /// The promise this module makes: nothing about another game comes out,
    /// whatever went in.
    #[test]
    fn a_mod_for_another_game_is_dropped_even_if_nexus_sends_it() {
        let body = r#"{"data":{"mods":{"totalCount":2,"nodes":[
            {"modId":1,"name":"Skyrim thing","game":{"domainName":"skyrimspecialedition"},"modCategory":{"name":"Armour"}},
            {"modId":2,"name":"Minecraft thing","game":{"domainName":"minecraft"},"modCategory":{"name":"Armour"}}
        ]}}}"#;
        let found = parse_search(body).unwrap();
        assert_eq!(found.hits.len(), 1);
        assert_eq!(found.hits[0].mod_id, 2);
    }

    #[test]
    fn the_request_always_names_minecraft_and_hides_adult_content_by_default() {
        let variables = search_variables("jei", 2, 20, false);
        let filter = &variables["f"];
        assert_eq!(filter["gameDomainName"][0]["value"], "minecraft");
        assert_eq!(filter["adultContent"][0]["value"], false);
        assert_eq!(filter["name"][0]["value"], "jei");
        assert_eq!(variables["offset"], 40);

        // Asked for, the adult filter is simply absent -- Nexus's own default.
        let with_adult = search_variables("", 0, 20, true);
        assert!(with_adult["f"].get("adultContent").is_none());
        // And an empty search is a listing, not a search for "".
        assert!(with_adult["f"].get("name").is_none());
    }

    /// Nexus's categories are their staff's words. These are the ones the
    /// Minecraft section uses, and what the launcher can do with each.
    #[test]
    fn nexus_categories_map_to_what_the_launcher_can_hold() {
        assert_eq!(kind_of("Resource/Texture pack"), NexusKind::ResourcePack);
        assert_eq!(kind_of("Shaders"), NexusKind::Shader);
        assert_eq!(kind_of("World Save"), NexusKind::World);
        assert_eq!(kind_of("Maps - Miscellaneous"), NexusKind::World);
        assert_eq!(kind_of("NPCs and Creatures"), NexusKind::Mod);
        assert_eq!(kind_of("Miscellaneous"), NexusKind::Mod);
        // A category this was not written for is not guessed at.
        assert_eq!(kind_of("Cheats and God items"), NexusKind::Other);
    }

    #[test]
    fn an_error_from_nexus_is_an_error_here() {
        let body = r#"{"errors":[{"message":"Argument invalid"}]}"#;
        assert!(parse_search(body).unwrap_err().contains("Argument invalid"));
    }

    #[test]
    fn reads_a_file_list() {
        let body = r#"{"data":{"modFiles":[
            {"fileId":240,"name":"preset","version":"1.0","size":0,"category":"MAIN","date":1611969339,"description":"extract this"}
        ]}}"#;
        let files = parse_files(body).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_id, 240);
        assert_eq!(files[0].category, "MAIN");
    }
}
