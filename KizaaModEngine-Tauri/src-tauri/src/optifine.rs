//! OptiFine support.
//!
//! OptiFine is published only on optifine.net — it is on neither Modrinth nor
//! CurseForge — so searching for it in the content browser finds nothing. This
//! module reads the official downloads page and resolves the real jar URL so
//! the launcher can fetch it for the user.
//!
//! Nothing is mirrored or redistributed: the jar is always downloaded from
//! optifine.net itself, at the moment the user asks for it. The site hands out
//! a per-request token, so the link must be resolved live rather than cached.

use serde::{Deserialize, Serialize};

const BASE_URL: &str = "https://optifine.net";
const DOWNLOADS_URL: &str = "https://optifine.net/downloads";
const USER_AGENT: &str = "KizaLauncher/1.0 (+https://github.com/ludovicthenot/Kiza-Client)";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OptiFineRelease {
    /// Jar file name, e.g. `OptiFine_1.8.9_HD_U_M5.jar`.
    pub file_name: String,
    /// Human label, e.g. `OptiFine 1.8.9 HD U M5`.
    pub display_name: String,
    pub mc_version: String,
    /// Preview builds are published alongside stable ones.
    pub preview: bool,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())
}

/// Extracts every `adloadx?f=<jar>` entry from the downloads page.
fn parse_downloads_page(html: &str) -> Vec<OptiFineRelease> {
    let mut releases = Vec::new();
    let mut cursor = 0;

    while let Some(found) = html[cursor..].find("adloadx?f=") {
        let start = cursor + found + "adloadx?f=".len();
        let rest = &html[start..];
        let end = rest
            .find(".jar")
            .map(|index| index + ".jar".len())
            .unwrap_or(0);
        cursor = start + end.max(1);
        if end == 0 {
            continue;
        }

        let file_name = &rest[..end];
        // The download button wraps the same link in an ad redirect, so the
        // file appears twice; keep the first occurrence only.
        if releases
            .iter()
            .any(|release: &OptiFineRelease| release.file_name == file_name)
        {
            continue;
        }
        if let Some(release) = release_from_file_name(file_name) {
            releases.push(release);
        }
    }

    releases
}

/// Reads the Minecraft version and label out of an OptiFine jar name.
fn release_from_file_name(file_name: &str) -> Option<OptiFineRelease> {
    let trimmed = file_name.strip_suffix(".jar")?;
    let (preview, body) = match trimmed.strip_prefix("preview_") {
        Some(rest) => (true, rest),
        None => (false, trimmed),
    };
    let rest = body.strip_prefix("OptiFine_")?;

    // The Minecraft version is the leading dotted-numeric segment.
    let mc_version = rest.split('_').next()?.to_string();
    if mc_version.is_empty() || !mc_version.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }

    Some(OptiFineRelease {
        file_name: file_name.to_string(),
        display_name: body.replace('_', " "),
        mc_version,
        preview,
    })
}

/// Pulls the tokenised `downloadx?f=...&x=...` link out of an adloadx page.
fn parse_download_link(html: &str) -> Option<String> {
    let start = html.find("downloadx?f=")?;
    let rest = &html[start..];
    let end = rest.find(['"', '\'', '<', ' ']).unwrap_or(rest.len());
    let link = &rest[..end];
    if !link.contains("&x=") {
        return None;
    }
    Some(format!("{BASE_URL}/{link}"))
}

/// Every OptiFine build published for `mc_version`, newest first.
pub async fn list_releases(mc_version: &str) -> Result<Vec<OptiFineRelease>, String> {
    let response = client()?
        .get(DOWNLOADS_URL)
        .send()
        .await
        .map_err(|error| format!("Could not reach optifine.net: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "optifine.net returned HTTP {} for the downloads page.",
            response.status().as_u16()
        ));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("Could not read the OptiFine downloads page: {error}"))?;

    Ok(parse_downloads_page(&html)
        .into_iter()
        .filter(|release| release.mc_version == mc_version)
        .collect())
}

/// Resolves the direct jar URL, which carries a single-use token.
pub async fn resolve_download_url(file_name: &str) -> Result<String, String> {
    if !file_name.ends_with(".jar") || file_name.contains('/') || file_name.contains('\\') {
        return Err("Invalid OptiFine file name.".to_string());
    }

    let url = reqwest::Url::parse_with_params(&format!("{BASE_URL}/adloadx"), &[("f", file_name)])
        .map_err(|error| error.to_string())?;

    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach optifine.net: {error}"))?;
    let html = response
        .text()
        .await
        .map_err(|error| format!("Could not read the OptiFine download page: {error}"))?;

    parse_download_link(&html).ok_or_else(|| {
        "OptiFine did not return a download link; the site layout may have changed.".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOWNLOADS_SAMPLE: &str = r#"
        <tr><td class="downloadLineFile">OptiFine 1.8.9 HD U M5</td>
        <td class="downloadLineDownload">
          <a href="http://adfoc.us/serve/sitelinks/?id=475250&url=http://optifine.net/adloadx?f=OptiFine_1.8.9_HD_U_M5.jar&x=27d4">Download</a>
        </td>
        <td class="downloadLineMirror">
          <a href="http://optifine.net/adloadx?f=OptiFine_1.8.9_HD_U_M5.jar">(Mirror)</a>
        </td></tr>
        <tr><td class="downloadLineFile">OptiFine 1.8.9 HD U M6 pre2</td>
        <td><a href="http://optifine.net/adloadx?f=preview_OptiFine_1.8.9_HD_U_M6_pre2.jar">(Mirror)</a></td></tr>
        <tr><td class="downloadLineFile">OptiFine 1.21.4 HD U J3</td>
        <td><a href="http://optifine.net/adloadx?f=OptiFine_1.21.4_HD_U_J3.jar">(Mirror)</a></td></tr>
    "#;

    #[test]
    fn reads_every_release_once_from_the_downloads_page() {
        let releases = parse_downloads_page(DOWNLOADS_SAMPLE);

        // The 1.8.9 stable build is linked twice (download + mirror).
        assert_eq!(releases.len(), 3, "got {releases:?}");
        assert_eq!(releases[0].file_name, "OptiFine_1.8.9_HD_U_M5.jar");
        assert_eq!(releases[0].mc_version, "1.8.9");
        assert_eq!(releases[0].display_name, "OptiFine 1.8.9 HD U M5");
        assert!(!releases[0].preview);
    }

    #[test]
    fn flags_preview_builds() {
        let releases = parse_downloads_page(DOWNLOADS_SAMPLE);
        let preview = releases
            .iter()
            .find(|release| release.file_name.starts_with("preview_"))
            .expect("preview build");

        assert!(preview.preview);
        assert_eq!(preview.mc_version, "1.8.9");
        assert_eq!(preview.display_name, "OptiFine 1.8.9 HD U M6 pre2");
    }

    #[test]
    fn keeps_versions_apart() {
        let releases = parse_downloads_page(DOWNLOADS_SAMPLE);
        let modern: Vec<_> = releases
            .iter()
            .filter(|release| release.mc_version == "1.21.4")
            .collect();

        assert_eq!(modern.len(), 1);
        assert_eq!(modern[0].file_name, "OptiFine_1.21.4_HD_U_J3.jar");
    }

    #[test]
    fn resolves_the_tokenised_download_link() {
        let page = r#"<a href="downloadx?f=OptiFine_1.8.9_HD_U_M5.jar&x=de3c3eb24dbfa8ad" onclick="a()">Download</a>"#;

        assert_eq!(
            parse_download_link(page).as_deref(),
            Some("https://optifine.net/downloadx?f=OptiFine_1.8.9_HD_U_M5.jar&x=de3c3eb24dbfa8ad")
        );
    }

    #[test]
    fn rejects_a_page_without_a_token() {
        // Without the token the link 404s, so it must not be treated as valid.
        assert_eq!(
            parse_download_link("<a href=\"downloadx?f=x.jar\">D</a>"),
            None
        );
        assert_eq!(parse_download_link("<html>no link here</html>"), None);
    }

    #[test]
    fn ignores_names_that_are_not_optifine_jars() {
        assert!(release_from_file_name("random.jar").is_none());
        assert!(release_from_file_name("OptiFine_HD_U.jar").is_none());
        assert!(release_from_file_name("OptiFine_1.8.9_HD_U_M5.zip").is_none());
    }
}
