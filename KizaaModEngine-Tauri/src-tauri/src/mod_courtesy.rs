//! Standing aside for a mod that does the same job.
//!
//! Kiza restyles the title screen, replaces the window's caption and tells
//! Discord what the player is doing. So do mods -- CustomMainMenu draws
//! RLCraft's menu, Borderless Mining owns the window, CraftPresence owns
//! the presence -- and a pack that ships one of them chose it on purpose.
//! Two things painting the same menu is a fight nobody watching can win, so
//! before a launch the mods folder is read, and for each job a known mod
//! does, Kiza's own version of it is switched off: the launcher's part
//! here, the client's part in the game, told through one JVM property.
//! What was stood aside for is written beside the runtime report, so the
//! instance page can say "Menu: CustomMainMenu" rather than "Menu: off".

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Area {
    /// The title and pause menus.
    Menu,
    /// The window's caption and borders.
    Window,
    /// Discord Rich Presence.
    Presence,
}

impl Area {
    /// The word the JVM property and the client use for it.
    pub fn key(self) -> &'static str {
        match self {
            Area::Menu => "menu",
            Area::Window => "window",
            Area::Presence => "presence",
        }
    }
}

/// One job Kiza leaves to a mod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Courtesy {
    pub area: Area,
    pub mod_id: String,
    pub mod_name: String,
    pub file: String,
}

/// Mods known to do one of Kiza's jobs, by the id they declare.
///
/// Kept to mods that really take the job over. MainMenuScale only resizes
/// the vanilla menu, which Kiza's overlay follows, so it is not here.
const KNOWN: &[(&str, Area, &str)] = &[
    ("custommainmenu", Area::Menu, "CustomMainMenu"),
    ("fancymenu", Area::Menu, "FancyMenu"),
    ("bettertitlescreen", Area::Menu, "Better Title Screen"),
    ("packmenu", Area::Menu, "PackMenu"),
    ("modernui", Area::Menu, "Modern UI"),
    ("borderlessmining", Area::Window, "Borderless Mining"),
    ("cubes-without-borders", Area::Window, "Cubes Without Borders"),
    ("cubeswithoutborders", Area::Window, "Cubes Without Borders"),
    ("borderlesswindow", Area::Window, "Borderless Window"),
    ("borderless_window", Area::Window, "Borderless Window"),
    ("fullscreenwindowed", Area::Window, "Fullscreen Windowed"),
    ("windowedfullscreen", Area::Window, "Windowed Fullscreen"),
    ("titlechanger", Area::Window, "Title Changer"),
    ("customwindowtitle", Area::Window, "Custom Window Title"),
    ("craftpresence", Area::Presence, "CraftPresence"),
    ("simple-rpc", Area::Presence, "Simple RPC"),
    ("simplerpc", Area::Presence, "Simple RPC"),
    ("discordrpc", Area::Presence, "Discord RPC"),
    ("discordrp", Area::Presence, "Discord Rich Presence"),
    ("discordrichpresence", Area::Presence, "Discord Rich Presence"),
    ("mcdiscordrpc", Area::Presence, "MC Discord RPC"),
];

fn known(mod_id: &str) -> Option<(Area, &'static str)> {
    let wanted = mod_id.trim().to_ascii_lowercase();
    KNOWN
        .iter()
        .find(|(id, _, _)| *id == wanted)
        .map(|(_, area, name)| (*area, *name))
}

/// Reads the enabled jars in `mods_dir` and says which of Kiza's jobs one
/// of them does. One entry per area: the first mod found keeps it.
pub fn detect(mods_dir: &Path) -> Vec<Courtesy> {
    let mut found: Vec<Courtesy> = Vec::new();
    let Ok(entries) = fs::read_dir(mods_dir) else {
        return found;
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter(|entry| {
            entry.path().is_file()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(".jar")
        })
        .collect();
    files.sort_by_key(|entry| entry.file_name());
    for entry in files {
        let Some(identity) = crate::mod_compat::identify_jar(&entry.path()) else {
            continue;
        };
        let Some((area, name)) = known(&identity.mod_id) else {
            continue;
        };
        if found.iter().any(|courtesy| courtesy.area == area) {
            continue;
        }
        found.push(Courtesy {
            area,
            mod_id: identity.mod_id,
            mod_name: identity.name.unwrap_or_else(|| name.to_string()),
            file: entry.file_name().to_string_lossy().to_string(),
        });
    }
    found
}

/// The mod that has this job, if any.
pub fn yielded_to(courtesies: &[Courtesy], area: Area) -> Option<&Courtesy> {
    courtesies.iter().find(|courtesy| courtesy.area == area)
}

/// The JVM property the client reads: `menu:custommainmenu,window:borderlessmining`.
pub fn jvm_property(courtesies: &[Courtesy]) -> Option<String> {
    if courtesies.is_empty() {
        return None;
    }
    let value = courtesies
        .iter()
        .map(|courtesy| format!("{}:{}", courtesy.area.key(), courtesy.mod_id))
        .collect::<Vec<_>>()
        .join(",");
    Some(format!("-Dkiza.yield={value}"))
}

/// Where a launch writes what it stood aside for, for the instance page.
pub fn record_path(runtime_dir: &Path) -> std::path::PathBuf {
    runtime_dir.join("courtesies.json")
}

pub fn record(runtime_dir: &Path, courtesies: &[Courtesy]) {
    let _ = fs::create_dir_all(runtime_dir);
    if let Ok(json) = serde_json::to_string_pretty(courtesies) {
        let _ = fs::write(record_path(runtime_dir), json);
    }
}

pub fn recorded(runtime_dir: &Path) -> Vec<Courtesy> {
    fs::read_to_string(record_path(runtime_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jar_with_mcmod(path: &Path, mod_id: &str, name: &str) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("mcmod.info", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(
            &mut writer,
            format!(r#"[{{"modid":"{mod_id}","name":"{name}","version":"1.0"}}]"#).as_bytes(),
        )
        .unwrap();
        writer.finish().unwrap();
    }

    /// RLCraft's folder: CustomMainMenu takes the menu, nothing takes the
    /// window or the presence, and a mod switched off takes nothing.
    #[test]
    fn a_menu_mod_in_the_folder_takes_the_menu_and_nothing_else() {
        let temp = tempfile::tempdir().unwrap();
        let mods = temp.path().join("mods");
        fs::create_dir_all(&mods).unwrap();
        jar_with_mcmod(&mods.join("CustomMainMenu-MC1.12.2-2.0.9.jar"), "custommainmenu", "Custom Main Menu");
        jar_with_mcmod(&mods.join("jei.jar"), "jei", "JEI");
        jar_with_mcmod(&mods.join("CraftPresence.jar.disabled"), "craftpresence", "CraftPresence");

        let found = detect(&mods);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].area, Area::Menu);
        assert_eq!(found[0].mod_name, "Custom Main Menu");
        assert_eq!(found[0].file, "CustomMainMenu-MC1.12.2-2.0.9.jar");
        assert!(yielded_to(&found, Area::Menu).is_some());
        assert!(yielded_to(&found, Area::Window).is_none());
        assert!(yielded_to(&found, Area::Presence).is_none());
        assert_eq!(
            jvm_property(&found).as_deref(),
            Some("-Dkiza.yield=menu:custommainmenu")
        );
        assert_eq!(jvm_property(&[]), None);

        // Written for the instance page, read back the same.
        let runtime = temp.path().join("runtime");
        record(&runtime, &found);
        assert_eq!(recorded(&runtime), found);
        assert!(recorded(&temp.path().join("nowhere")).is_empty());
    }

    /// Two mods for one job: the first by name keeps it, and the property
    /// lists each area once.
    #[test]
    fn one_mod_per_job() {
        let temp = tempfile::tempdir().unwrap();
        let mods = temp.path().join("mods");
        fs::create_dir_all(&mods).unwrap();
        jar_with_mcmod(&mods.join("a-fancymenu.jar"), "FancyMenu", "FancyMenu");
        jar_with_mcmod(&mods.join("b-custommainmenu.jar"), "custommainmenu", "CMM");
        jar_with_mcmod(&mods.join("craftpresence.jar"), "craftpresence", "CraftPresence");
        let found = detect(&mods);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].mod_id, "FancyMenu");
        assert_eq!(
            jvm_property(&found).as_deref(),
            Some("-Dkiza.yield=menu:FancyMenu,presence:craftpresence")
        );
    }
}
