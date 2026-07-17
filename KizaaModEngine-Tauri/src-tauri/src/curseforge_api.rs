use serde::{Deserialize, Serialize};

const BASE_URL: &str = "https://api.curseforge.com";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeSearchResponse {
    pub data: Vec<CurseForgeMod>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeMod {
    pub id: u64,
    pub name: String,
    pub summary: Option<String>,
    pub download_count: Option<f64>,
    pub links: Option<CurseForgeLinks>,
    pub logo: Option<CurseForgeLogo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeLinks {
    pub website_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeLogo {
    pub thumbnail_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeFilesResponse {
    pub data: Vec<CurseForgeFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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

pub async fn search_mods(
    api_key: &str,
    query: &str,
    mc_version: Option<&str>,
    loader: Option<&str>,
    page_size: u32,
    index: u32,
) -> Result<CurseForgeSearchResponse, String> {
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
    resp.json::<CurseForgeFilesResponse>()
        .await
        .map_err(|e| e.to_string())
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
