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
    /// Supported Minecraft versions.
    pub versions: Vec<String>,
    /// Categories include loader names ("fabric", "forge", ...), so the UI can
    /// badge loader compatibility on unfiltered search results.
    #[serde(default)]
    pub categories: Vec<String>,
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

fn search_facets(
    project_type: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
) -> Vec<Vec<String>> {
    let type_facet = if project_type == "datapack" {
        "all_project_types:datapack".to_string()
    } else {
        format!("project_type:{project_type}")
    };
    let mut facets = vec![vec![type_facet]];
    if let Some(version) = mc_version.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("versions:{version}")]);
    }
    if let Some(loader) = loader.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("categories:{loader}")]);
    }
    facets
}

fn search_index(query: &str, sort: Option<&str>) -> &'static str {
    match sort {
        Some("downloads") => "downloads",
        Some("updated") => "updated",
        _ if query.trim().is_empty() => "downloads",
        _ => "relevance",
    }
}

pub async fn search(
    query: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<ModrinthSearchResponse, String> {
    search_projects(query, "mod", mc_version, loader, limit, offset, None).await
}

pub async fn search_projects(
    query: &str,
    project_type: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
    limit: u32,
    offset: u32,
    sort: Option<&str>,
) -> Result<ModrinthSearchResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let facets = search_facets(project_type, mc_version, loader);
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
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?)?;
    resp.json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::{search_facets, search_index, version_matches_context, ModrinthVersion};

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
        assert_eq!(
            search_facets("mod", Some("1.21.5"), Some("forge")),
            vec![
                vec!["project_type:mod".to_string()],
                vec!["versions:1.21.5".to_string()],
                vec!["categories:forge".to_string()],
            ]
        );
    }

    #[test]
    fn datapacks_use_the_all_project_types_facet() {
        assert_eq!(
            search_facets("datapack", None, None),
            vec![vec!["all_project_types:datapack".to_string()]],
        );
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
