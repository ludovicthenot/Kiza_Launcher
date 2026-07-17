use serde::{Deserialize, Serialize};

const BASE_URL: &str = "https://api.curseforge.com";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeSearchResponse {
    pub data: Vec<CurseForgeMod>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeMod {
    pub id: u64,
    pub name: String,
    pub summary: Option<String>,
    pub download_count: Option<f64>,
    pub links: Option<CurseForgeLinks>,
    pub logo: Option<CurseForgeLogo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeLinks {
    pub website_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeLogo {
    pub thumbnail_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeFilesResponse {
    pub data: Vec<CurseForgeFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeFile {
    pub id: u64,
    #[serde(default)]
    pub mod_id: Option<u64>,
    pub file_name: String,
    pub file_date: String,
    pub download_count: Option<f64>,
    pub file_length: Option<u64>,
    pub game_versions: Vec<String>,
    pub download_url: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<CurseForgeDependency>,
    #[serde(default)]
    pub hashes: Vec<CurseForgeHash>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeDependency {
    pub mod_id: u64,
    pub relation_type: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeHash {
    pub value: String,
    pub algo: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeModResponse {
    pub data: CurseForgeMod,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeFileResponse {
    pub data: CurseForgeFile,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeDownloadUrlResponse {
    pub data: String,
}

fn client(api_key: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                "x-api-key",
                reqwest::header::HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
            );
            h
        })
        .build()
        .map_err(|e| e.to_string())
}

fn mod_loader_type(loader: Option<&str>) -> Option<&'static str> {
    match loader {
        Some("forge") => Some("1"),
        Some("fabric") => Some("4"),
        Some("quilt") => Some("5"),
        Some("neoforge") => Some("6"),
        _ => None,
    }
}

fn normalized_loader(value: &str) -> Option<&'static str> {
    if value.eq_ignore_ascii_case("forge") {
        Some("forge")
    } else if value.eq_ignore_ascii_case("fabric") {
        Some("fabric")
    } else if value.eq_ignore_ascii_case("quilt") {
        Some("quilt")
    } else if value.eq_ignore_ascii_case("neoforge") {
        Some("neoforge")
    } else {
        None
    }
}

pub fn file_matches_context(file: &CurseForgeFile, mc_version: &str, loader: &str) -> bool {
    if !file
        .game_versions
        .iter()
        .any(|candidate| candidate == mc_version)
    {
        return false;
    }

    let declared_loaders = file
        .game_versions
        .iter()
        .filter_map(|candidate| normalized_loader(candidate))
        .collect::<std::collections::HashSet<_>>();
    declared_loaders.len() == 1
        && normalized_loader(loader).is_some_and(|expected| declared_loaders.contains(expected))
}

fn require_supported_loader(loader: Option<&str>) -> Result<(), String> {
    if let Some(loader) = loader.filter(|value| !value.trim().is_empty()) {
        if mod_loader_type(Some(loader)).is_none() {
            return Err(format!("Unsupported CurseForge loader filter: {loader}."));
        }
    }
    Ok(())
}

pub async fn search_mods(
    api_key: &str,
    query: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
    page_size: u32,
    index: u32,
) -> Result<CurseForgeSearchResponse, String> {
    require_supported_loader(loader)?;
    let client = client(api_key)?;
    let mut params = vec![
        ("gameId", "432".to_string()),
        ("classId", "6".to_string()),
        ("searchFilter", query.to_string()),
        ("pageSize", page_size.to_string()),
        ("index", index.to_string()),
    ];
    if let Some(version) = mc_version.filter(|value| !value.trim().is_empty()) {
        params.push(("gameVersion", version.to_string()));
    }
    if let Some(loader_type) = mod_loader_type(loader) {
        params.push(("modLoaderType", loader_type.to_string()));
    }

    let url = reqwest::Url::parse_with_params(&format!("{}/v1/mods/search", BASE_URL), params)
        .map_err(|e| e.to_string())?;

    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<CurseForgeSearchResponse>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn list_files(
    api_key: &str,
    mod_id: u64,
    mc_version: Option<&str>,
    loader: Option<&str>,
    page_size: u32,
    index: u32,
) -> Result<CurseForgeFilesResponse, String> {
    require_supported_loader(loader)?;
    let client = client(api_key)?;
    let mut params = vec![
        ("pageSize", page_size.to_string()),
        ("index", index.to_string()),
    ];
    if let Some(version) = mc_version.filter(|value| !value.trim().is_empty()) {
        params.push(("gameVersion", version.to_string()));
    }
    if let Some(loader_type) = mod_loader_type(loader) {
        params.push(("modLoaderType", loader_type.to_string()));
    }

    let url =
        reqwest::Url::parse_with_params(&format!("{}/v1/mods/{}/files", BASE_URL, mod_id), params)
            .map_err(|e| e.to_string())?;

    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut response = resp
        .json::<CurseForgeFilesResponse>()
        .await
        .map_err(|e| e.to_string())?;
    if let (Some(mc_version), Some(loader)) = (
        mc_version.filter(|value| !value.trim().is_empty()),
        loader.filter(|value| !value.trim().is_empty()),
    ) {
        response
            .data
            .retain(|file| file_matches_context(file, mc_version, loader));
    }
    Ok(response)
}

pub async fn get_download_url(api_key: &str, mod_id: u64, file_id: u64) -> Result<String, String> {
    let client = client(api_key)?;
    let url = format!(
        "{}/v1/mods/{}/files/{}/download-url",
        BASE_URL, mod_id, file_id
    );
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(resp
        .json::<CurseForgeDownloadUrlResponse>()
        .await
        .map_err(|e| e.to_string())?
        .data)
}

pub async fn get_mod(api_key: &str, mod_id: u64) -> Result<CurseForgeMod, String> {
    let client = client(api_key)?;
    let url = format!("{BASE_URL}/v1/mods/{mod_id}");
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(resp
        .json::<CurseForgeModResponse>()
        .await
        .map_err(|e| e.to_string())?
        .data)
}

pub async fn get_file(api_key: &str, mod_id: u64, file_id: u64) -> Result<CurseForgeFile, String> {
    let client = client(api_key)?;
    let url = format!("{BASE_URL}/v1/mods/{mod_id}/files/{file_id}");
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(resp
        .json::<CurseForgeFileResponse>()
        .await
        .map_err(|e| e.to_string())?
        .data)
}

#[cfg(test)]
mod tests {
    use super::{file_matches_context, CurseForgeFile, CurseForgeMod};
    use serde_json::json;

    #[test]
    fn curseforge_mod_deserializes_api_camel_case_and_serializes_for_frontend() {
        let api_payload = json!({
            "id": 238222,
            "name": "Just Enough Items",
            "summary": "View items and recipes.",
            "downloadCount": 410_250_125.0,
            "links": { "websiteUrl": "https://www.curseforge.com/minecraft/mc-mods/jei" },
            "logo": { "thumbnailUrl": "https://media.forgecdn.net/avatars/29/69/635838945588716414.jpeg" }
        });

        let project: CurseForgeMod = serde_json::from_value(api_payload).expect("valid API mod");
        let frontend = serde_json::to_value(project).expect("serializable frontend mod");

        assert_eq!(frontend["download_count"], 410_250_125.0);
        assert_eq!(
            frontend["logo"]["thumbnail_url"],
            "https://media.forgecdn.net/avatars/29/69/635838945588716414.jpeg"
        );
        assert_eq!(
            frontend["links"]["website_url"],
            "https://www.curseforge.com/minecraft/mc-mods/jei"
        );
        assert!(frontend.get("downloadCount").is_none());
    }

    #[test]
    fn curseforge_file_deserializes_api_camel_case_and_serializes_for_frontend() {
        let api_payload = json!({
            "id": 6123456,
            "modId": 238222,
            "fileName": "jei-1.21.5-forge.jar",
            "fileDate": "2026-07-17T10:00:00Z",
            "downloadCount": 42.0,
            "fileLength": 123456,
            "gameVersions": ["1.21.5", "Forge"],
            "downloadUrl": "https://edge.forgecdn.net/files/6123/456/jei.jar",
            "dependencies": [{ "modId": 306612, "relationType": 3 }],
            "hashes": []
        });

        let file: CurseForgeFile = serde_json::from_value(api_payload).expect("valid API file");
        let frontend = serde_json::to_value(file).expect("serializable frontend file");

        assert_eq!(frontend["mod_id"], 238222);
        assert_eq!(frontend["file_name"], "jei-1.21.5-forge.jar");
        assert_eq!(frontend["game_versions"], json!(["1.21.5", "Forge"]));
        assert_eq!(frontend["dependencies"][0]["relation_type"], 3);
        assert!(frontend.get("fileName").is_none());
    }

    #[test]
    fn curseforge_files_must_match_exact_minecraft_and_one_loader() {
        let file = CurseForgeFile {
            id: 1,
            mod_id: Some(2),
            file_name: "example.jar".to_string(),
            file_date: "2026-07-17T00:00:00Z".to_string(),
            download_count: None,
            file_length: None,
            game_versions: vec!["1.21.5".to_string(), "Forge".to_string()],
            download_url: None,
            dependencies: Vec::new(),
            hashes: Vec::new(),
        };

        assert!(file_matches_context(&file, "1.21.5", "forge"));
        assert!(!file_matches_context(&file, "1.21.4", "forge"));
        assert!(!file_matches_context(&file, "1.21.5", "fabric"));

        let mut ambiguous = file.clone();
        ambiguous.game_versions.push("Fabric".to_string());
        assert!(!file_matches_context(&ambiguous, "1.21.5", "forge"));
    }
}
