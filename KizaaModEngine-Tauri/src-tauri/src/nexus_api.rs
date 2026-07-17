use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};

const NEXUS_API_BASE: &str = "https://api.nexusmods.com/v1";
const APP_NAME: &str = "KizaaMod";
const APP_VERSION: &str = "0.2.0"; // Future version
type NxmLinkParts = (String, u64, u64, Option<String>, Option<String>);

#[derive(Clone)]
#[allow(dead_code)]
pub struct NexusClient {
    client: reqwest::Client,
    api_key: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct NexusGame {
    pub id: u64,
    pub name: String,
    pub forum_url: String,
    pub nexus_game_id: u64,
    pub genre: String,
    pub file_count: u64,
    pub downloads: u64,
    pub domain_name: String,
    pub approved_date: u64,
    pub nexus_theme_id: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct NexusUser {
    pub user_id: u64,
    pub key: String,
    pub name: String,
    pub is_premium: bool,
    pub is_supporter: bool,
    pub email: String,
    pub profile_url: String,
}

impl NexusClient {
    pub fn new(api_key: String) -> Result<Self, String> {
        if api_key.trim().is_empty() {
            return Err("API Key cannot be empty".to_string());
        }

        let mut headers = HeaderMap::new();

        // Nexus API Requirements
        headers.insert(
            "apikey",
            HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
        );
        headers.insert("application-name", HeaderValue::from_static(APP_NAME));
        headers.insert("application-version", HeaderValue::from_static(APP_VERSION));

        let client = reqwest::Client::builder()
            .user_agent(format!("{}/{}", APP_NAME, APP_VERSION))
            .default_headers(headers)
            .build()
            .map_err(|e| e.to_string())?;

        Ok(Self { client, api_key })
    }

    pub async fn validate_key(&self) -> Result<NexusUser, String> {
        let url = format!("{}/users/validate.json", NEXUS_API_BASE);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API Error: {}", response.status()));
        }

        let user = response
            .json::<NexusUser>()
            .await
            .map_err(|e| format!("Failed to parse user data: {}", e))?;

        Ok(user)
    }

    pub async fn get_download_link(
        &self,
        game_domain: &str,
        mod_id: u64,
        file_id: u64,
        key: Option<&str>,
        expires: Option<&str>,
    ) -> Result<String, String> {
        let mut url = format!(
            "{}/games/{}/mods/{}/files/{}/download_link.json",
            NEXUS_API_BASE, game_domain, mod_id, file_id
        );

        // If we have key/expires from NXM link, we append them
        if let (Some(k), Some(e)) = (key, expires) {
            url = format!("{}?key={}&expires={}", url, k, e);
        }

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API Error: {}", response.status()));
        }

        // Nexus returns array of CDN links, we pick the first one
        #[derive(Deserialize)]
        struct DownloadLink {
            #[allow(dead_code)]
            name: String,
            #[allow(dead_code)]
            short_name: String,
            uri: String,
        }

        let links: Vec<DownloadLink> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse download links: {}", e))?;

        if let Some(link) = links.first() {
            Ok(link.uri.clone())
        } else {
            Err("No download links returned by Nexus".to_string())
        }
    }

    pub fn parse_nxm_link(link: &str) -> Option<NxmLinkParts> {
        // ... (implementation)
        // Format: nxm://game_domain/mods/mod_id/files/file_id?key=...&expires=...&user_id=...
        if !link.starts_with("nxm://") {
            return None;
        }

        let content = &link[6..]; // Strip nxm://
                                  // Split by ? to separate path and query
        let parts: Vec<&str> = content.split('?').collect();
        // Path part: game_domain/mods/mod_id/files/file_id
        let path_str = parts[0];
        let path_parts: Vec<&str> = path_str.split('/').collect();

        if path_parts.len() < 5 {
            // game/mods/id/files/file_id
            return None;
        }

        // Validate structure
        if path_parts[1] != "mods" || path_parts[3] != "files" {
            return None;
        }

        let game_domain = path_parts[0].to_string();
        // Basic alphanumeric check for game_domain to avoid path traversal or weird injections
        if !game_domain.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return None;
        }

        let mod_id = path_parts[2].parse::<u64>().ok()?;
        let file_id = path_parts[4].parse::<u64>().ok()?;

        let mut key = None;
        let mut expires = None;

        if parts.len() > 1 {
            for param in parts[1].split('&') {
                if let Some((name, value)) = param.split_once('=') {
                    match name {
                        "key"
                            if value
                                .chars()
                                .all(|c| c.is_alphanumeric() || c == '-' || c == '_') =>
                        {
                            key = Some(value.to_string());
                        }
                        "expires" if value.chars().all(|c| c.is_ascii_digit()) => {
                            expires = Some(value.to_string());
                        }
                        _ => {}
                    }
                }
            }
        }

        Some((game_domain, mod_id, file_id, key, expires))
    }
} // End of first impl NexusClient

#[derive(Deserialize)]
pub struct NexusFileDetails {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "version")]
    pub version: String,
    #[serde(rename = "file_name")]
    pub file_name: String,
}

impl NexusClient {
    pub async fn get_mod_file_details(
        &self,
        game_domain: &str,
        mod_id: u64,
        file_id: u64,
    ) -> Result<NexusFileDetails, String> {
        let url = format!(
            "{}/games/{}/mods/{}/files/{}.json",
            NEXUS_API_BASE, game_domain, mod_id, file_id
        );

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API Error: {}", response.status()));
        }

        let details = response
            .json::<NexusFileDetails>()
            .await
            .map_err(|e| format!("Failed to parse file details: {}", e))?;

        Ok(details)
    }

    #[allow(dead_code)]
    pub async fn get_games(&self) -> Result<Vec<NexusGame>, String> {
        let url = format!("{}/games.json", NEXUS_API_BASE);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API Error: {}", response.status()));
        }

        let games = response
            .json::<Vec<NexusGame>>()
            .await
            .map_err(|e| format!("Failed to parse games list: {}", e))?;

        Ok(games)
    }
}
