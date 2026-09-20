//! Packs the launcher must be able to play before a release.
//!
//! Every bug of the RLCraft week had one thing in common: the launcher had
//! never played RLCraft. A Forge 1.12 pack with a hundred and eighty mods,
//! coremods, jars without descriptors and a mod its author blocks on
//! CurseForge is a different animal from a Fabric instance with Sodium in
//! it, and a launcher tested on the second can ship broken for the first.
//!
//! This is the matrix: one pack per shape of instance, installed from the
//! catalogue exactly as a player would, launched, and watched until the
//! Kiza client reports the main menu. Run it before a release:
//!
//! ```text
//! cargo test --lib reference_packs -- --ignored --nocapture --test-threads=1
//! ```
//!
//! It uses the real Kiza folder so the shared libraries and assets are
//! not downloaded again; the instances it makes are named for what they
//! are and deleted afterwards. The main-menu signal is the state bridge's
//! first heartbeat, which the Kiza client sends once the title screen is
//! up; a pack that runs where the client cannot (NeoForge, for now) is
//! judged by staying alive instead, which is what the older smoke test
//! did for everything.

#[cfg(test)]
mod tests {
    use crate::content_manager::{self, ContentKind};
    use crate::game_manager::GameManager;
    use crate::minecraft_manager::{
        self, LaunchManager, MinecraftInstallManager, MinecraftLaunchRequest,
    };
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    /// Where the pack comes from.
    enum Pack {
        CurseForge { project: u64, file: u64 },
        Modrinth { slug: &'static str },
    }

    /// The matrix. One pack per loader generation the launcher supports.
    const MATRIX: &[(&str, Pack, u64)] = &[
        // Forge 1.12, the pack that found three bugs in a week.
        ("RLCraft 2.9.3", Pack::CurseForge { project: 285109, file: 4612979 }, 240),
        // Fabric, the newest Minecraft, the most-downloaded pack there is.
        ("Fabulously Optimized", Pack::Modrinth { slug: "fabulously-optimized" }, 180),
        // NeoForge 1.21, a large pack.
        ("Create+", Pack::Modrinth { slug: "create_plus" }, 240),
        // Forge 1.20, medium.
        ("Cobblemon [Fabric]", Pack::Modrinth { slug: "cobblemon-fabric" }, 240),
    ];

    fn app_data_dir() -> PathBuf {
        PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("com.kizamods.engine")
    }

    async fn install_pack(app_data_dir: &PathBuf, name: &str, pack: &Pack) -> Result<String, String> {
        let display = format!("Kiza check: {name}");
        let result = match pack {
            Pack::CurseForge { project, file } => {
                let key = std::env::var("KIZAMODS_CURSEFORGE_API_KEY").map_err(|_| "no CurseForge key")?;
                content_manager::install_curseforge_content(
                    app_data_dir,
                    content_manager::CurseForgeContentInstallRequest {
                        api_key: &key,
                        instance_id: "",
                        kind: ContentKind::Modpack,
                        mod_id: *project,
                        file_id: *file,
                        world_name: None,
                        display_name: Some(&display),
                    },
                )
                .await?
            }
            Pack::Modrinth { slug } => {
                let project = crate::modrinth_api::get_project(slug).await?;
                content_manager::install_modrinth_content(
                    app_data_dir,
                    "",
                    ContentKind::Modpack,
                    &project.id,
                    None,
                    None,
                    Some(&display),
                )
                .await?
            }
        };
        Ok(result.instance_id)
    }

    /// Installs, launches and watches one pack; says how it went.
    async fn check(name: &str, pack: &Pack, patience: Duration) -> Result<String, String> {
        let app_data_dir = app_data_dir();
        let started = Instant::now();
        let instance_id = install_pack(&app_data_dir, name, pack).await?;
        let installed_in = started.elapsed();

        // Everything the launcher does before Play: game files, loader,
        // then the blocked mods it can fetch from Modrinth in the pack's
        // own build.
        let manager = GameManager::new(app_data_dir.clone());
        let instance = manager.get_instance_by_id(&instance_id)?;
        let install_manager = MinecraftInstallManager::new();
        minecraft_manager::install_minecraft_instance(
            app_data_dir.clone(),
            install_manager,
            instance.clone(),
        )
        .await?;
        let instance = manager.get_instance_by_id(&instance_id)?;

        let (result, mut child, bridge) = minecraft_manager::launch_minecraft(
            app_data_dir.clone(),
            instance,
            MinecraftLaunchRequest {
                instance_id: instance_id.clone(),
                username: "KizaCheck".to_string(),
                uuid: None,
                access_token: None,
                user_type: None,
            },
            LaunchManager::new(),
        )
        .await?;
        let launched = Instant::now();

        let outcome = loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break Err(format!("exited with {status} after {:.0}s", launched.elapsed().as_secs_f32()));
            }
            let at_menu = bridge
                .as_ref()
                .and_then(|bridge| bridge.read_state().ok().flatten())
                .is_some();
            if at_menu {
                break Ok(format!("main menu after {:.0}s", launched.elapsed().as_secs_f32()));
            }
            if launched.elapsed() > patience {
                break if bridge.is_some() {
                    Err(format!("no main menu within {:.0}s", patience.as_secs_f32()))
                } else {
                    // No client on this loader: alive this long is the best
                    // the outside can tell.
                    Ok(format!("still running after {:.0}s (no client signal on this loader)", patience.as_secs_f32()))
                };
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        };
        let _ = child.kill();
        tokio::time::sleep(Duration::from_secs(2)).await;

        let verdict = match &outcome {
            Ok(text) => format!("OK   {name}: {text} (installed in {:.0}s)", installed_in.as_secs_f32()),
            Err(text) => {
                let log = std::fs::read_to_string(&result.log_path).unwrap_or_default();
                let tail: Vec<&str> = log.lines().rev().take(15).collect();
                let findings = crate::crash_doctor::analyse_instance(
                    &minecraft_manager::instance_game_dir_path(&app_data_dir, &instance_id),
                );
                format!(
                    "FAIL {name}: {text}\n  doctor: {}\n  tail:\n    {}",
                    findings
                        .iter()
                        .map(|f| f.title.clone())
                        .collect::<Vec<_>>()
                        .join(" / "),
                    tail.into_iter().rev().collect::<Vec<_>>().join("\n    ")
                )
            }
        };
        // Kept on failure so the log can be read; gone on success.
        if outcome.is_ok() || std::env::var("KIZA_KEEP_CHECKS").is_err() {
            let _ = minecraft_manager::delete_minecraft_instance(&app_data_dir, &instance_id);
        }
        outcome.map(|_| verdict.clone()).map_err(|_| verdict)
    }

    #[tokio::test]
    #[ignore = "installs and plays every reference pack; minutes, and network"]
    async fn every_reference_pack_reaches_its_menu() {
        let only = std::env::var("KIZA_PACK").ok();
        let mut failures = Vec::new();
        for (name, pack, patience) in MATRIX {
            if only.as_deref().is_some_and(|wanted| !name.to_ascii_lowercase().contains(&wanted.to_ascii_lowercase())) {
                continue;
            }
            println!("=== {name} ===");
            match check(name, pack, Duration::from_secs(*patience)).await {
                Ok(verdict) => println!("{verdict}"),
                Err(verdict) => {
                    println!("{verdict}");
                    failures.push(name.to_string());
                }
            }
        }
        assert!(failures.is_empty(), "packs that did not reach their menu: {failures:?}");
    }
}
