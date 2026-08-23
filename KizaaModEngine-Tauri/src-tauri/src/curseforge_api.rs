use serde::{Deserialize, Serialize};

const BASE_URL: &str = "https://api.curseforge.com";

/// Maps CurseForge HTTP status codes to clear, actionable messages instead of a
/// raw "HTTP 403" the UI would otherwise surface.
fn status_error(status: reqwest::StatusCode, response_body: &str) -> String {
    let detail = response_body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let detail = if detail.is_empty() {
        String::new()
    } else {
        format!(
            " Détail API : {}",
            detail.chars().take(300).collect::<String>()
        )
    };

    match status.as_u16() {
        400 => format!(
            "Requête CurseForge mal formée (400). Vérifie gameId, classId, gameVersion et modLoaderType ; la clé n'est normalement pas en cause.{detail}"
        ),
        401 => "Clé API CurseForge absente ou invalide.".to_string(),
        403 => {
            "CurseForge a refusé la requête (403). Si la navigation fonctionne mais pas l'installation, l'auteur a désactivé le téléchargement par les launchers tiers. Ouvre la page du projet ; sinon, vérifie la clé API."
                .to_string()
        }
        404 => "Projet ou fichier CurseForge introuvable.".to_string(),
        429 => "Limite de requêtes CurseForge atteinte, réessaie dans un instant.".to_string(),
        other => format!("Erreur CurseForge HTTP {other}."),
    }
}

async fn ensure_success(response: reqwest::Response) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        Ok(response)
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(status_error(status, &body))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CurseForgeSearchResponse {
    pub data: Vec<CurseForgeMod>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeMod {
    pub id: u64,
    #[serde(default)]
    pub class_id: Option<u32>,
    #[serde(default)]
    pub allow_mod_distribution: Option<bool>,
    pub name: String,
    pub summary: Option<String>,
    pub download_count: Option<f64>,
    #[serde(default)]
    pub date_modified: Option<String>,
    pub links: Option<CurseForgeLinks>,
    pub logo: Option<CurseForgeLogo>,
    #[serde(default)]
    pub authors: Vec<CurseForgeAuthor>,
    /// Per-file version/loader index — lets the UI show compatibility on
    /// unfiltered search results, like the CurseForge website does.
    #[serde(default)]
    pub latest_files_indexes: Vec<CurseForgeFileIndex>,
}

pub fn require_distribution_allowed(project: &CurseForgeMod) -> Result<(), String> {
    if project.allow_mod_distribution != Some(false) {
        return Ok(());
    }

    let page = project
        .links
        .as_ref()
        .and_then(|links| links.website_url.as_deref())
        .map(|url| format!(" Ouvre la page officielle : {url}"))
        .unwrap_or_default();
    Err(format!(
        "Le projet CurseForge '{}' interdit le téléchargement depuis un launcher tiers.{page}",
        project.name
    ))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeAuthor {
    pub id: u64,
    pub name: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all(deserialize = "camelCase", serialize = "snake_case"))]
pub struct CurseForgeFileIndex {
    pub game_version: String,
    #[serde(default)]
    pub mod_loader: Option<u32>,
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
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("Clé API CurseForge vide.".to_string());
    }
    if api_key.starts_with(['\'', '"']) || api_key.ends_with(['\'', '"']) {
        return Err(
            "La clé CurseForge contient des guillemets. Stocke uniquement sa valeur brute."
                .to_string(),
        );
    }

    reqwest::Client::builder()
        .user_agent(concat!(
            "KizaLauncher/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/ludovicthenot/Kiza-Client)"
        ))
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/json"),
            );
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
    // Accept when the file declares no loader (universal / older versions where
    // loaders aren't tagged) or when the instance loader is one of possibly
    // several declared loaders (e.g. Fabric+Quilt, Forge+NeoForge). Requiring a
    // single loader wrongly hid most files, so whole versions looked mod-less.
    declared_loaders.is_empty()
        || normalized_loader(loader).is_some_and(|expected| declared_loaders.contains(expected))
}

fn require_supported_loader(loader: Option<&str>) -> Result<(), String> {
    if let Some(loader) = loader.filter(|value| !value.trim().is_empty()) {
        if mod_loader_type(Some(loader)).is_none() {
            return Err(format!("Unsupported CurseForge loader filter: {loader}."));
        }
    }
    Ok(())
}

fn search_sort_field(sort: Option<&str>) -> &'static str {
    match sort {
        Some("downloads") => "6",
        Some("updated") => "3",
        _ => "2",
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn search_mods(
    api_key: &str,
    query: &str,
    class_id: u32,
    mc_version: Option<&str>,
    loader: Option<&str>,
    page_size: u32,
    index: u32,
    sort: Option<&str>,
) -> Result<CurseForgeSearchResponse, String> {
    require_supported_loader(loader)?;
    let client = client(api_key)?;
    let sort_field = search_sort_field(sort);
    let mut params = vec![
        ("gameId", "432".to_string()),
        ("classId", class_id.to_string()),
        // CurseForge otherwise prioritizes loose textual matches. Popularity
        // keeps the canonical project first for searches such as "iris".
        ("sortField", sort_field.to_string()),
        ("sortOrder", "desc".to_string()),
        ("pageSize", page_size.to_string()),
        ("index", index.to_string()),
    ];
    if !query.trim().is_empty() {
        params.push(("searchFilter", query.trim().to_string()));
    }
    if let Some(version) = mc_version.filter(|value| !value.trim().is_empty()) {
        params.push(("gameVersion", version.to_string()));
    }
    if let Some(loader_type) = mod_loader_type(loader) {
        params.push(("modLoaderType", loader_type.to_string()));
    }

    let url = reqwest::Url::parse_with_params(&format!("{}/v1/mods/search", BASE_URL), params)
        .map_err(|e| e.to_string())?;

    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?).await?;
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

    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?).await?;
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
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?).await?;
    Ok(resp
        .json::<CurseForgeDownloadUrlResponse>()
        .await
        .map_err(|e| e.to_string())?
        .data)
}

pub async fn get_mod(api_key: &str, mod_id: u64) -> Result<CurseForgeMod, String> {
    let client = client(api_key)?;
    let url = format!("{BASE_URL}/v1/mods/{mod_id}");
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?).await?;
    Ok(resp
        .json::<CurseForgeModResponse>()
        .await
        .map_err(|e| e.to_string())?
        .data)
}

/// CurseForge does not include the changelog in the file object: it needs its
/// own request, so it is only ever fetched for a version actually being offered.
pub async fn get_file_changelog(
    api_key: &str,
    mod_id: u64,
    file_id: u64,
) -> Result<String, String> {
    #[derive(Deserialize)]
    struct ChangelogResponse {
        data: String,
    }

    let client = client(api_key)?;
    let url = format!("https://api.curseforge.com/v1/mods/{mod_id}/files/{file_id}/changelog");
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("CurseForge returned HTTP {}", response.status()));
    }
    response
        .json::<ChangelogResponse>()
        .await
        .map(|body| body.data)
        .map_err(|e| e.to_string())
}

pub async fn get_file(api_key: &str, mod_id: u64, file_id: u64) -> Result<CurseForgeFile, String> {
    let client = client(api_key)?;
    let url = format!("{BASE_URL}/v1/mods/{mod_id}/files/{file_id}");
    let resp = ensure_success(client.get(url).send().await.map_err(|e| e.to_string())?).await?;
    Ok(resp
        .json::<CurseForgeFileResponse>()
        .await
        .map_err(|e| e.to_string())?
        .data)
}

/// CurseForge's file fingerprint.
///
/// It is MurmurHash2 (32-bit, seed 1) over the file's bytes **with whitespace
/// removed** — tab, newline, carriage return and space. That normalisation is
/// CurseForge's own: it makes the fingerprint survive a file being checked out
/// with different line endings. Hashing the raw bytes gives a number their API
/// has never seen, which looks exactly like "this mod is unknown".
pub fn fingerprint(bytes: &[u8]) -> u32 {
    let normalised: Vec<u8> = bytes
        .iter()
        .copied()
        .filter(|byte| !matches!(byte, 9 | 10 | 13 | 32))
        .collect();
    murmur2_32(&normalised, 1)
}

/// MurmurHash2, 32-bit, as CurseForge uses it.
fn murmur2_32(data: &[u8], seed: u32) -> u32 {
    const M: u32 = 0x5bd1_e995;
    const R: u32 = 24;

    let mut hash = seed ^ (data.len() as u32);
    // `as_chunks` hands back fixed-size arrays and the leftover in one go, so
    // the four bytes below need no indexing that could be out of range.
    let (blocks, tail) = data.as_chunks::<4>();

    for block in blocks {
        let mut k = u32::from_le_bytes(*block);
        k = k.wrapping_mul(M);
        k ^= k >> R;
        k = k.wrapping_mul(M);
        hash = hash.wrapping_mul(M);
        hash ^= k;
    }

    // The trailing one to three bytes, in the order the algorithm specifies.
    if !tail.is_empty() {
        if tail.len() >= 3 {
            hash ^= (tail[2] as u32) << 16;
        }
        if tail.len() >= 2 {
            hash ^= (tail[1] as u32) << 8;
        }
        hash ^= tail[0] as u32;
        hash = hash.wrapping_mul(M);
    }

    hash ^= hash >> 13;
    hash = hash.wrapping_mul(M);
    hash ^ (hash >> 15)
}

#[derive(Deserialize)]
struct FingerprintMatch {
    file: CurseForgeFile,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintData {
    #[serde(default)]
    exact_matches: Vec<FingerprintMatch>,
}

#[derive(Deserialize)]
struct FingerprintResponse {
    data: FingerprintData,
}

/// Asks CurseForge which files these fingerprints are.
///
/// Returns only exact matches, in no particular order — the caller pairs them
/// back up by fingerprint. A file CurseForge does not recognise simply is not
/// in the answer, which is the honest outcome: it stays unknown rather than
/// being attributed to something plausible.
pub async fn files_by_fingerprint(
    api_key: &str,
    fingerprints: &[u32],
) -> Result<Vec<CurseForgeFile>, String> {
    if fingerprints.is_empty() {
        return Ok(Vec::new());
    }

    let client = client(api_key)?;
    let url = format!("{BASE_URL}/v1/fingerprints");
    let response = ensure_success(
        client
            .post(url)
            .json(&serde_json::json!({ "fingerprints": fingerprints }))
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?;

    Ok(response
        .json::<FingerprintResponse>()
        .await
        .map_err(|e| e.to_string())?
        .data
        .exact_matches
        .into_iter()
        .map(|matched| matched.file)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        client, file_matches_context, fingerprint, murmur2_32, require_distribution_allowed,
        search_sort_field, status_error, CurseForgeFile, CurseForgeMod,
    };
    use serde_json::json;

    #[test]
    fn murmur2_matches_the_reference_implementation() {
        // Values produced by a separate implementation of MurmurHash2 32-bit,
        // not by this code. Getting the algorithm subtly wrong would return
        // numbers CurseForge has never seen, which is indistinguishable from
        // "this mod is unknown" — a silent wrong answer.
        assert_eq!(murmur2_32(b"", 0), 0);
        assert_eq!(murmur2_32(b"hello", 0), 0xE561_29CB);
        assert_eq!(murmur2_32(b"hello", 1), 0xA631_918E);
        assert_eq!(
            murmur2_32(b"The quick brown fox jumps over the lazy dog", 0),
            0x2127_29D0
        );
    }

    #[test]
    fn a_fingerprint_ignores_whitespace_the_way_curseforge_does() {
        // CurseForge strips tab, newline, carriage return and space before
        // hashing, so the same file checked out with different line endings
        // fingerprints identically.
        assert_eq!(fingerprint(b"a b\tc\r\nd"), fingerprint(b"abcd"));
        assert_ne!(fingerprint(b"abcd"), fingerprint(b"abce"));
    }

    #[test]
    fn every_tail_length_is_hashed_not_dropped() {
        // One, two and three trailing bytes each take a different branch; a
        // dropped tail would make two different files share a fingerprint.
        let hashes: Vec<u32> = ["abcd", "abcde", "abcdef", "abcdefg"]
            .iter()
            .map(|value| fingerprint(value.as_bytes()))
            .collect();
        let mut unique = hashes.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), hashes.len());
    }

    #[test]
    fn curseforge_http_errors_distinguish_request_and_authentication() {
        let malformed = status_error(reqwest::StatusCode::BAD_REQUEST, "invalid classId");
        assert!(malformed.contains("mal formée (400)"));
        assert!(malformed.contains("invalid classId"));

        let forbidden = status_error(reqwest::StatusCode::FORBIDDEN, "");
        assert!(forbidden.contains("launchers tiers"));
    }

    #[test]
    fn curseforge_client_rejects_empty_and_quoted_keys() {
        assert!(client("   ").is_err());
        assert!(client("'$2a$10$example'").is_err());
        assert!(client("\"$2a$10$example\"").is_err());
    }

    #[test]
    fn catalogue_sort_modes_map_to_curseforge_fields() {
        assert_eq!(search_sort_field(None), "2");
        assert_eq!(search_sort_field(Some("relevance")), "2");
        assert_eq!(search_sort_field(Some("downloads")), "6");
        assert_eq!(search_sort_field(Some("updated")), "3");
    }

    #[test]
    fn curseforge_mod_deserializes_api_camel_case_and_serializes_for_frontend() {
        let api_payload = json!({
            "id": 238222,
            "name": "Just Enough Items",
            "allowModDistribution": false,
            "summary": "View items and recipes.",
            "downloadCount": 410_250_125.0,
            "dateModified": "2026-08-07T10:00:00Z",
            "links": { "websiteUrl": "https://www.curseforge.com/minecraft/mc-mods/jei" },
            "logo": { "thumbnailUrl": "https://media.forgecdn.net/avatars/29/69/635838945588716414.jpeg" },
            "authors": [{ "id": 123, "name": "mezz", "url": "https://www.curseforge.com/members/mezz" }]
        });

        let project: CurseForgeMod = serde_json::from_value(api_payload).expect("valid API mod");
        let distribution_error =
            require_distribution_allowed(&project).expect_err("distribution must be blocked");
        assert!(distribution_error.contains("launcher tiers"));
        assert!(distribution_error.contains("https://www.curseforge.com/minecraft/mc-mods/jei"));

        let frontend = serde_json::to_value(project).expect("serializable frontend mod");

        assert_eq!(frontend["download_count"], 410_250_125.0);
        assert_eq!(frontend["date_modified"], "2026-08-07T10:00:00Z");
        assert_eq!(frontend["allow_mod_distribution"], false);
        assert_eq!(
            frontend["logo"]["thumbnail_url"],
            "https://media.forgecdn.net/avatars/29/69/635838945588716414.jpeg"
        );
        assert_eq!(
            frontend["links"]["website_url"],
            "https://www.curseforge.com/minecraft/mc-mods/jei"
        );
        assert_eq!(frontend["authors"][0]["name"], "mezz");
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
    fn curseforge_mod_keeps_latest_files_indexes_for_compat_badges() {
        let api_payload = json!({
            "id": 581495,
            "name": "Oculus",
            "latestFilesIndexes": [
                { "gameVersion": "1.21.1", "modLoader": 1 },
                { "gameVersion": "1.20.1", "modLoader": 1 }
            ]
        });

        let project: CurseForgeMod = serde_json::from_value(api_payload).expect("valid API mod");
        assert_eq!(project.latest_files_indexes.len(), 2);
        assert_eq!(project.latest_files_indexes[0].game_version, "1.21.1");
        assert_eq!(project.latest_files_indexes[0].mod_loader, Some(1));

        // Missing field defaults to empty rather than failing.
        let bare: CurseForgeMod =
            serde_json::from_value(json!({ "id": 1, "name": "Bare" })).expect("valid bare mod");
        assert!(bare.latest_files_indexes.is_empty());
    }

    #[test]
    fn curseforge_files_match_version_and_any_declared_loader() {
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
        // Forge-only file is not for a Fabric instance.
        assert!(!file_matches_context(&file, "1.21.5", "fabric"));

        // A file tagged for several loaders stays compatible with each of them.
        let mut multi_loader = file.clone();
        multi_loader.game_versions.push("Fabric".to_string());
        assert!(file_matches_context(&multi_loader, "1.21.5", "forge"));
        assert!(file_matches_context(&multi_loader, "1.21.5", "fabric"));

        // A version-only file (no loader tag, common on older versions) matches
        // any loader as long as the Minecraft version lines up.
        let mut version_only = file.clone();
        version_only.game_versions = vec!["1.21.5".to_string()];
        assert!(file_matches_context(&version_only, "1.21.5", "forge"));
        assert!(!file_matches_context(&version_only, "1.21.4", "forge"));
    }
}
