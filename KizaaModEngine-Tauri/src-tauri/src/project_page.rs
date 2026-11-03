//! A catalogue project's own page: what the launcher shows when a mod, a
//! modpack, a shader or a pack is opened whole rather than glanced at.
//!
//! Its long description comes as its author wrote it -- Markdown on Modrinth,
//! HTML on CurseForge -- and both may carry raw HTML. It is turned into HTML
//! here and cleaned of everything that could run or reach out by itself:
//! scripts, frames, styles, event handlers, `javascript:` links. What is
//! left is text, pictures, links and tables, which the page draws as they are.

use serde::Serialize;
use serde_json::Value;

use crate::{curseforge_api, modrinth_api};

#[derive(Serialize, Clone, Debug, Default)]
pub struct ProjectLink {
    /// `website`, `source`, `issues`, `wiki`, `discord` or `donate`.
    pub kind: String,
    pub url: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ProjectGalleryImage {
    pub url: String,
    pub thumbnail_url: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ProjectPage {
    /// The long description, as clean HTML.
    pub body_html: String,
    pub links: Vec<ProjectLink>,
    pub categories: Vec<String>,
    /// Minecraft versions it is made for, newest first.
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub license: Option<String>,
    pub followers: Option<u64>,
    pub published: Option<String>,
    pub updated: Option<String>,
    pub gallery: Vec<ProjectGalleryImage>,
}

/// Markdown -- with any HTML in it -- to clean HTML.
pub fn markdown_to_html(markdown: &str) -> String {
    let options = pulldown_cmark::Options::ENABLE_TABLES
        | pulldown_cmark::Options::ENABLE_STRIKETHROUGH
        | pulldown_cmark::Options::ENABLE_TASKLISTS;
    let parser = pulldown_cmark::Parser::new_ext(markdown, options);
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);
    clean_html(&html)
}

/// HTML with nothing in it that can run, load a frame or style the launcher.
pub fn clean_html(html: &str) -> String {
    ammonia::Builder::default()
        .url_schemes(["http", "https", "mailto"].into_iter().collect())
        .link_rel(Some("noopener noreferrer"))
        .clean(html)
        .to_string()
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn strings(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Release versions before snapshots, newest first, by their numbers.
fn newest_first(mut versions: Vec<String>) -> Vec<String> {
    versions.sort();
    versions.dedup();
    versions.sort_by_key(|version| std::cmp::Reverse(version_key(version)));
    versions
}

fn version_key(version: &str) -> (bool, Vec<u32>) {
    let numbers: Vec<u32> = version
        .split(['.', '-'])
        .map_while(|part| part.parse().ok())
        .collect();
    let release = version.chars().all(|c| c.is_ascii_digit() || c == '.');
    (release, numbers)
}

pub fn modrinth_page(project: &Value) -> ProjectPage {
    let mut links = Vec::new();
    for (kind, key) in [
        ("source", "source_url"),
        ("issues", "issues_url"),
        ("wiki", "wiki_url"),
        ("discord", "discord_url"),
    ] {
        if let Some(url) = text(project, key) {
            links.push(ProjectLink {
                kind: kind.to_string(),
                url,
            });
        }
    }
    if let Some(donations) = project.get("donation_urls").and_then(Value::as_array) {
        for donation in donations {
            if let Some(url) = text(donation, "url") {
                links.push(ProjectLink {
                    kind: "donate".to_string(),
                    url,
                });
            }
        }
    }
    let gallery = project
        .get("gallery")
        .and_then(Value::as_array)
        .map(|images| {
            let mut images: Vec<&Value> = images.iter().collect();
            // The one its author put forward first, then in their order.
            images.sort_by_key(|image| {
                (
                    !image
                        .get("featured")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    image.get("ordering").and_then(Value::as_i64).unwrap_or(0),
                )
            });
            images
                .into_iter()
                .filter_map(|image| {
                    // `url` is Modrinth's lighter copy, `raw_url` the picture as uploaded.
                    let thumbnail_url = text(image, "url")?;
                    Some(ProjectGalleryImage {
                        url: text(image, "raw_url").unwrap_or_else(|| thumbnail_url.clone()),
                        thumbnail_url,
                        title: text(image, "title"),
                        description: text(image, "description"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let license = project
        .get("license")
        .and_then(|license| text(license, "name").or_else(|| text(license, "id")));
    ProjectPage {
        body_html: markdown_to_html(project.get("body").and_then(Value::as_str).unwrap_or("")),
        links,
        categories: strings(project, "categories"),
        game_versions: newest_first(strings(project, "game_versions")),
        loaders: strings(project, "loaders"),
        license,
        followers: project.get("followers").and_then(Value::as_u64),
        published: text(project, "published"),
        updated: text(project, "updated"),
        gallery,
    }
}

/// CurseForge's numbers for the loaders it knows.
fn curseforge_loader(id: i64) -> Option<&'static str> {
    match id {
        1 => Some("forge"),
        4 => Some("fabric"),
        5 => Some("quilt"),
        6 => Some("neoforge"),
        _ => None,
    }
}

pub fn curseforge_page(project: &Value, description_html: &str) -> ProjectPage {
    let mut links = Vec::new();
    if let Some(project_links) = project.get("links") {
        for (kind, key) in [
            ("website", "websiteUrl"),
            ("source", "sourceUrl"),
            ("issues", "issuesUrl"),
            ("wiki", "wikiUrl"),
        ] {
            if let Some(url) = text(project_links, key) {
                links.push(ProjectLink {
                    kind: kind.to_string(),
                    url,
                });
            }
        }
    }
    let categories = project
        .get("categories")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| text(item, "name")).collect())
        .unwrap_or_default();
    let indexes = project
        .get("latestFilesIndexes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let game_versions = newest_first(
        indexes
            .iter()
            .filter_map(|index| text(index, "gameVersion"))
            .collect(),
    );
    let mut loaders: Vec<String> = indexes
        .iter()
        .filter_map(|index| index.get("modLoader").and_then(Value::as_i64))
        .filter_map(curseforge_loader)
        .map(str::to_string)
        .collect();
    loaders.sort();
    loaders.dedup();
    let gallery = project
        .get("screenshots")
        .and_then(Value::as_array)
        .map(|shots| {
            shots
                .iter()
                .filter_map(|shot| {
                    let url = text(shot, "url")?;
                    Some(ProjectGalleryImage {
                        thumbnail_url: text(shot, "thumbnailUrl").unwrap_or_else(|| url.clone()),
                        url,
                        title: text(shot, "title"),
                        description: text(shot, "description"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    ProjectPage {
        body_html: clean_html(description_html),
        links,
        categories,
        game_versions,
        loaders,
        license: None,
        followers: project
            .get("thumbsUpCount")
            .and_then(Value::as_u64)
            .filter(|count| *count > 0),
        published: text(project, "dateCreated"),
        updated: text(project, "dateModified"),
        gallery,
    }
}

pub async fn modrinth(project_id: &str) -> Result<ProjectPage, String> {
    let project = modrinth_api::get_project_value(project_id).await?;
    Ok(modrinth_page(&project))
}

pub async fn curseforge(api_key: &str, mod_id: u64) -> Result<ProjectPage, String> {
    let (project, description) = tokio::join!(
        curseforge_api::get_mod_value(api_key, mod_id),
        curseforge_api::get_mod_description(api_key, mod_id)
    );
    // A page without its long description is still a page.
    Ok(curseforge_page(&project?, &description.unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_and_frames_never_reach_the_page() {
        let html = markdown_to_html(
            "# Title\n\n<script>alert(1)</script><iframe src=\"https://x\"></iframe>\
             <img src=\"https://cdn/x.png\" onerror=\"alert(1)\">

[go](javascript:alert(1)) [ok](https://modrinth.com)",
        );
        assert!(html.contains("<h1>Title</h1>"));
        assert!(!html.contains("<script"));
        assert!(!html.contains("<iframe"));
        assert!(!html.contains("onerror"));
        assert!(!html.contains("href=\"javascript:"));
        assert!(html.contains(">go</a>"));
        assert!(html.contains("src=\"https://cdn/x.png\""));
        assert!(html.contains("href=\"https://modrinth.com\""));
    }

    #[test]
    fn versions_newest_release_first() {
        let sorted = newest_first(vec![
            "1.20.1".into(),
            "1.21.11".into(),
            "1.21".into(),
            "1.20.1".into(),
            "26.3".into(),
        ]);
        assert_eq!(sorted, vec!["26.3", "1.21.11", "1.21", "1.20.1"]);
    }

    #[test]
    fn modrinth_gallery_puts_the_featured_picture_first() {
        let project = serde_json::json!({
            "body": "Hello",
            "gallery": [
                { "url": "https://a", "featured": false, "ordering": 0 },
                { "url": "https://b", "featured": true, "ordering": 5, "title": "Banner" }
            ],
            "license": { "id": "MIT", "name": "MIT License" },
            "source_url": "https://github.com/x"
        });
        let page = modrinth_page(&project);
        assert_eq!(page.gallery[0].url, "https://b");
        assert_eq!(page.license.as_deref(), Some("MIT License"));
        assert_eq!(page.links[0].kind, "source");
    }
}
