use serde::{Deserialize, Serialize};

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
    pub versions: Vec<String>,
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
    let mut facets = vec![vec![format!("project_type:{project_type}")]];
    if let Some(version) = mc_version.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("versions:{version}")]);
    }
    if let Some(loader) = loader.filter(|value| !value.trim().is_empty()) {
        facets.push(vec![format!("categories:{loader}")]);
    }
    facets
}

pub async fn search(
    query: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<ModrinthSearchResponse, String> {
    search_projects(query, "mod", mc_version, loader, limit, offset).await
}

pub async fn search_projects(
    query: &str,
    project_type: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<ModrinthSearchResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let facets = search_facets(project_type, mc_version, loader);
    let facets_json = serde_json::to_string(&facets).map_err(|e| e.to_string())?;

    let url = reqwest::Url::parse_with_params(
        "https://api.modrinth.com/v2/search",
        &[
            ("query", query),
            ("limit", &limit.to_string()),
            ("offset", &offset.to_string()),
            ("facets", &facets_json),
        ],
    )
    .map_err(|e| e.to_string())?;

    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<ModrinthSearchResponse>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn get_versions(project_id: &str) -> Result<Vec<ModrinthVersion>, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn get_version(version_id: &str) -> Result<ModrinthVersion, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/version/{version_id}");
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<ModrinthVersion>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn get_project(project_id: &str) -> Result<ModrinthProject, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.modrinth.com/v2/project/{project_id}");
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<ModrinthProject>()
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{search_facets, version_matches_context, ModrinthVersion};

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
            dependencies: Vec::new(),
        }
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
