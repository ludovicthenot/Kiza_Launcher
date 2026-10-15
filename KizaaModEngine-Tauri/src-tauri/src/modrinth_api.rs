use serde::{Deserialize, Serialize};

const USER_AGENT: &str = concat!(
    "KizaLauncher/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/ludovicthenot/Kiza_Launcher)"
);

fn status_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        403 => "Modrinth a refuse la requete (403). Reessaie plus tard ou verifie que le reseau ne bloque pas api.modrinth.com.".to_string(),
        404 => "Projet ou version Modrinth introuvable.".to_string(),
        429 => "Limite de requetes Modrinth atteinte, reessaie dans un instant.".to_string(),
        other => format!("Erreur Modrinth HTTP {other}."),
    }
}

fn ensure_success(response: reqwest::Response) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(status_error(response.status()))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthSearchResponse {
    pub hits: Vec<ModrinthProjectHit>,
    pub limit: u32,
    pub offset: u32,
    pub total_hits: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthProjectHit {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub downloads: u64,
    pub follows: u64,
    pub icon_url: Option<String>,
    pub author: String,
    pub date_modified: String,
    /// First published. What "newest" orders by.
    #[serde(default)]
    pub date_created: Option<String>,
    /// Supported Minecraft versions.
    pub versions: Vec<String>,
    /// Categories include loader names ("fabric", "forge", ...), so the UI can
    /// badge loader compatibility on unfiltered search results.
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub slug: Option<String>,
    /// The project's pictures — screenshots, and the odd GIF.
    #[serde(default)]
    pub gallery: Vec<String>,
    /// The one its author put forward, of those: the banner.
    #[serde(default)]
    pub featured_gallery: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthVersion {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<ModrinthFile>,
    pub date_published: String,
    #[serde(default)]
    pub changelog: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<ModrinthDependency>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthDependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthProject {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    /// `required`, `optional` or `unsupported` — which side the project runs
    /// on, as its author declared. Absent for project types without sides.
    #[serde(default)]
    pub client_side: Option<String>,
    #[serde(default)]
    pub server_side: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
    pub hashes: ModrinthHashes,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthHashes {
    pub sha1: String,
    pub sha512: String,
}

pub fn version_matches_context(version: &ModrinthVersion, mc_version: &str, loader: &str) -> bool {
    version
        .game_versions
        .iter()
        .any(|candidate| candidate == mc_version)
        && version
            .loaders
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(loader))
}

/// Everything a search may narrow by, beyond the words typed.
///
/// Modrinth's search is faceted: each facet is a list of alternatives, and
/// the facets are ANDed. "1.21.1, Fabric, optimization, client-only" is four
/// facets and one request, and it returns Sodium, Iris, Entity Culling and
/// ImmediatelyFast in that order -- which is to say the search already knew
/// the answer to "what makes my game faster" and the launcher was not asking
/// it. This is the asking.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SearchFilters<'a> {
    pub mc_version: Option<&'a str>,
    pub loader: Option<&'a str>,
    /// Modrinth's own category names for the project type: "optimization",
    /// "worldgen", "technology"... for mods; "realistic", "potato"... for
    /// shaders; "16x", "vanilla-like"... for packs. Several are ORed: a mod
    /// tagged either counts.
    pub categories: &'a [String],
    /// "required" | "optional" | "unsupported", as Modrinth records them.
    pub client_side: Option<&'a str>,
    pub server_side: Option<&'a str>,
}

fn search_facets(project_type: &str, filters: &SearchFilters<'_>) -> Vec<Vec<String>> {
    let type_facet = if project_type == "datapack" {
        "all_project_types:datapack".to_string()
    } else {
        format!("project_type:{project_type}")
    };
    let mut facets = vec![vec![type_facet]];
    if let Some(version) = filters.mc_version.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("versions:{version}")]);
    }
    if let Some(loader) = filters.loader.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("categories:{loader}")]);
    }
    // One facet holding every wanted category: alternatives, not a chain of
    // requirements. Asking for "optimization AND utility" would mean a mod
    // tagged both, which is nearly none; a person ticking two boxes means
    // either.
    let categories: Vec<String> = filters
        .categories
        .iter()
        .map(|category| category.trim())
        .filter(|category| !category.is_empty())
        .map(|category| format!("categories:{category}"))
        .collect();
    if !categories.is_empty() {
        facets.push(categories);
    }
    if let Some(side) = filters.client_side.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("client_side:{side}")]);
    }
    if let Some(side) = filters.server_side.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("server_side:{side}")]);
    }
    facets
}

/// Which of Modrinth's orderings to ask for.
///
/// "follows" is the one nobody else offers and the one that finds the mods
/// people keep: a project followed by many is one they intend to come back
/// to. "newest" is first publication, "updated" the last release.
fn search_index(query: &str, sort: Option<&str>) -> &'static str {
    match crate::content_filters::Sort::parse(sort) {
        Some(sort) => sort.modrinth_index(),
        // No ordering asked for: relevance when there are words to be
        // relevant to, downloads when there are not.
        None if query.trim().is_empty() => "downloads",
        None => "relevance",
    }
}

pub async fn search(
    query: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<ModrinthSearchResponse, String> {
    let filters = SearchFilters {
        mc_version,
        loader,
        ..SearchFilters::default()
    };
    search_projects(query, "mod", &filters, limit, offset, None).await
}

pub async fn search_projects(
    query: &str,
    project_type: &str,
    filters: &SearchFilters<'_>,
    limit: u32,
    offset: u32,
    sort: Option<&str>,
) -> Result<ModrinthSearchResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let facets = search_facets(project_type, filters);
    let facets_json = serde_json::to_string(&facets).map_err(|e| e.to_string())?;

    let url = reqwest::Url::parse_with_params(
        "https://api.modrinth.com/v2/search",
        &[
            ("query", query),
            ("index", search_index(query, sort)),
            ("limit", &limit.to_string()),
            ("offset", &offset.to_string()),
            ("facets", &facets_json),
        ],
    )
    .map_err(|e| e.to_string())?;

    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
    resp.json::<ModrinthSearchResponse>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn get_versions(project_id: &str) -> Result<Vec<ModrinthVersion>, String> {
    get_versions_for(project_id, None, None).await
}

/// A project's releases, narrowed by Modrinth rather than here.
///
/// `/project/{id}/version` takes `loaders` and `game_versions` as JSON
/// arrays and answers with only the releases that match both. A mod like
/// JEI has hundreds of releases across ten years of Minecraft; asking for
/// all of them to keep the four that fit this instance was the difference
/// between one small answer and one large one, on every plan the fixer drew
/// up. Modrinth already knows the answer; this asks for it.
pub async fn get_versions_for(
    project_id: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
) -> Result<Vec<ModrinthVersion>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let params = version_params(mc_version, loader);
    let url = reqwest::Url::parse_with_params(
        &format!("https://api.modrinth.com/v2/project/{project_id}/version"),
        &params,
    )
    .map_err(|e| e.to_string())?;
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
    resp.json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|e| e.to_string())
}

/// The query string for a filtered version list: each filter a JSON array,
/// as Modrinth reads them, and absent when there is nothing to narrow by.
fn version_params(mc_version: Option<&str>, loader: Option<&str>) -> Vec<(&'static str, String)> {
    let mut params = Vec::new();
    if let Some(loader) = loader.filter(|value| !value.trim().is_empty()) {
        params.push(("loaders", format!("[\"{}\"]", loader.trim())));
    }
    if let Some(version) = mc_version.filter(|value| !value.trim().is_empty()) {
        params.push(("game_versions", format!("[\"{}\"]", version.trim())));
    }
    params
}

pub async fn get_version(version_id: &str) -> Result<ModrinthVersion, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/version/{version_id}");
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
    resp.json::<ModrinthVersion>()
        .await
        .map_err(|e| e.to_string())
}

/// Resolves a file's SHA-1 back to the version it belongs to.
///
/// This is how a mod installed before Kiza recorded provenance can still be
/// identified: the bytes on disk are the identity, no guessing from file names.
/// A 404 simply means Modrinth does not know this file.
pub async fn version_from_sha1(sha1: &str) -> Result<Option<ModrinthVersion>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/version_file/{sha1}?algorithm=sha1");
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let response = ensure_success(response)?;
    response
        .json::<ModrinthVersion>()
        .await
        .map(Some)
        .map_err(|e| e.to_string())
}

/// The project whole, as Modrinth answers it: its page reads more of it
/// than any one struct here keeps.
pub async fn get_project_value(project_id: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/project/{project_id}");
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

pub async fn get_project(project_id: &str) -> Result<ModrinthProject, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/project/{project_id}");
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
    resp.json::<ModrinthProject>()
        .await
        .map_err(|e| e.to_string())
}

/// Several files' SHA-1s back to their versions, in one request. Files
/// Modrinth does not know are simply absent from the answer.
pub async fn versions_from_sha1s(
    hashes: &[String],
) -> Result<std::collections::HashMap<String, ModrinthVersion>, String> {
    if hashes.is_empty() {
        return Ok(Default::default());
    }
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = ensure_success(
        client
            .post("https://api.modrinth.com/v2/version_files")
            .json(&serde_json::json!({ "hashes": hashes, "algorithm": "sha1" }))
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )?;
    resp.json().await.map_err(|e| e.to_string())
}

/// Several projects in one search, by id: the search hit is the one shape
/// that carries the author's name and the gallery together, which the
/// project object does not.
pub async fn projects_by_ids(
    project_type: &str,
    ids: &[String],
) -> Result<Vec<ModrinthProjectHit>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut all = Vec::new();
    for chunk in ids.chunks(50) {
        let facets = vec![
            vec![format!("project_type:{project_type}")],
            chunk.iter().map(|id| format!("project_id:{id}")).collect::<Vec<_>>(),
        ];
        let facets_json = serde_json::to_string(&facets).map_err(|e| e.to_string())?;
        let url = reqwest::Url::parse_with_params(
            "https://api.modrinth.com/v2/search",
            &[
                ("limit", chunk.len().to_string().as_str()),
                ("facets", facets_json.as_str()),
            ],
        )
        .map_err(|e| e.to_string())?;
        let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
        let page: ModrinthSearchResponse = resp.json().await.map_err(|e| e.to_string())?;
        all.extend(page.hits);
    }
    Ok(all)
}

/// Several projects in one request, by id or slug. Modrinth answers with the
/// ones it knows and silently drops the rest, so the result may be shorter
/// than the question.
pub async fn get_projects(ids: &[String]) -> Result<Vec<ModrinthProject>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut all = Vec::new();
    // Kept well under the URL length a proxy might refuse.
    for chunk in ids.chunks(100) {
        let ids_json = serde_json::to_string(chunk).map_err(|e| e.to_string())?;
        let url = reqwest::Url::parse_with_params(
            "https://api.modrinth.com/v2/projects",
            [("ids", ids_json.as_str())],
        )
        .map_err(|e| e.to_string())?;
        let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
        let mut page: Vec<ModrinthProject> = resp.json().await.map_err(|e| e.to_string())?;
        all.append(&mut page);
    }
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::{
        search_facets, search_index, version_matches_context, version_params, ModrinthVersion,
        SearchFilters,
    };

    #[test]
    fn empty_searches_use_the_popular_catalog() {
        assert_eq!(search_index("", None), "downloads");
        assert_eq!(search_index("   ", None), "downloads");
        assert_eq!(search_index("sodium", None), "relevance");
        assert_eq!(search_index("sodium", Some("downloads")), "downloads");
        assert_eq!(search_index("sodium", Some("updated")), "updated");
    }

    fn version(game_versions: &[&str], loaders: &[&str]) -> ModrinthVersion {
        ModrinthVersion {
            id: "version-id".to_string(),
            project_id: "project-id".to_string(),
            name: "Example".to_string(),
            version_number: "1.0.0".to_string(),
            game_versions: game_versions
                .iter()
                .map(|value| value.to_string())
                .collect(),
            loaders: loaders.iter().map(|value| value.to_string()).collect(),
            files: Vec::new(),
            date_published: "2026-07-17T00:00:00Z".to_string(),
            changelog: None,
            dependencies: Vec::new(),
        }
    }

    #[test]
    fn search_hit_exposes_categories_for_loader_badges() {
        let payload = serde_json::json!({
            "project_id": "sk9rgfiA",
            "title": "Oculus",
            "description": "OptiFine shaders on Forge.",
            "downloads": 12_000_000,
            "follows": 40_000,
            "icon_url": null,
            "author": "Asek3",
            "date_modified": "2026-07-17T00:00:00Z",
            "versions": ["1.20.1", "1.21.1"],
            "categories": ["forge", "optimization"]
        });
        let hit: super::ModrinthProjectHit = serde_json::from_value(payload).expect("valid hit");
        assert_eq!(hit.categories, vec!["forge", "optimization"]);
        // Older cached payloads without categories still deserialize.
        let bare = serde_json::json!({
            "project_id": "x", "title": "x", "description": "x", "downloads": 0,
            "follows": 0, "icon_url": null, "author": "x",
            "date_modified": "2026-07-17T00:00:00Z", "versions": []
        });
        let hit: super::ModrinthProjectHit = serde_json::from_value(bare).expect("valid bare hit");
        assert!(hit.categories.is_empty());
    }

    #[test]
    fn search_facets_require_exact_version_and_loader() {
        let filters = SearchFilters {
            mc_version: Some("1.21.5"),
            loader: Some("forge"),
            ..SearchFilters::default()
        };
        assert_eq!(
            search_facets("mod", &filters),
            vec![
                vec!["project_type:mod".to_string()],
                vec!["versions:1.21.5".to_string()],
                vec!["categories:forge".to_string()],
            ]
        );
    }

    /// Narrowed by Modrinth, not here: each filter is a JSON array in the
    /// query string, and nothing is sent for a filter nobody set.
    #[test]
    fn version_lists_are_narrowed_by_the_catalogue() {
        let params = version_params(Some("1.21.1"), Some("fabric"));
        assert_eq!(
            params,
            vec![
                ("loaders", "[\"fabric\"]".to_string()),
                ("game_versions", "[\"1.21.1\"]".to_string()),
            ]
        );
        assert!(version_params(None, None).is_empty());
        assert!(version_params(Some("  "), Some("")).is_empty());
    }

    #[test]
    fn datapacks_use_the_all_project_types_facet() {
        assert_eq!(
            search_facets("datapack", &SearchFilters::default()),
            vec![vec!["all_project_types:datapack".to_string()]],
        );
    }

    /// The request that finds the FPS mods: four facets, ANDed, with the
    /// categories ORed inside their own -- a mod tagged either counts.
    #[test]
    fn categories_are_alternatives_and_sides_are_requirements() {
        let categories = vec!["optimization".to_string(), " utility ".to_string(), String::new()];
        let filters = SearchFilters {
            mc_version: Some("1.21.1"),
            loader: Some("fabric"),
            categories: &categories,
            client_side: Some("required"),
            server_side: Some("unsupported"),
        };
        assert_eq!(
            search_facets("mod", &filters),
            vec![
                vec!["project_type:mod".to_string()],
                vec!["versions:1.21.1".to_string()],
                vec!["categories:fabric".to_string()],
                // One facet, two alternatives; the blank one is dropped.
                vec!["categories:optimization".to_string(), "categories:utility".to_string()],
                vec!["client_side:required".to_string()],
                vec!["server_side:unsupported".to_string()],
            ]
        );
    }

    #[test]
    fn every_modrinth_ordering_is_reachable_and_nothing_else_is() {
        assert_eq!(search_index("x", Some("follows")), "follows");
        assert_eq!(search_index("x", Some("newest")), "newest");
        assert_eq!(search_index("x", Some("relevance")), "relevance");
        // Unknown words fall back, never pass through to the API.
        assert_eq!(search_index("x", Some("popularity")), "relevance");
        assert_eq!(search_index("", Some("popularity")), "downloads");
    }

    #[test]
    fn versions_must_match_both_minecraft_and_loader() {
        assert!(version_matches_context(
            &version(&["1.21.5"], &["forge"]),
            "1.21.5",
            "forge"
        ));
        assert!(!version_matches_context(
            &version(&["1.21.4"], &["forge"]),
            "1.21.5",
            "forge"
        ));
        assert!(!version_matches_context(
            &version(&["1.21.5"], &["fabric"]),
            "1.21.5",
            "forge"
        ));
    }
}
