//! What an installed Horizon release holds and plays.
//!
//! The Minecraft version and the Java the preparation needs are read from the
//! release's own `research-lock.json`, not written down in Kiza: a release
//! that moves to another Minecraft says so there, and the launcher follows.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// One installed release, by its folder.
#[derive(Clone, Debug)]
pub struct Installed {
    pub dir: PathBuf,
    pub lock: Lock,
}

/// The part of `research-lock.json` the launcher needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lock {
    /// The Minecraft: Java Edition version Horizon is, e.g. `26.3`.
    pub minecraft: String,
    /// The Java the preparation runs Minecraft's own code with.
    pub java_major: u32,
    /// The SHA-1 of the server jar the preparation accepts.
    pub server_sha1: Option<String>,
    /// Mojang's version file the release was made against, and the other
    /// copies of it (Mojang republishes) it accepts, by SHA-1.
    pub manifest_sha1: Option<String>,
    pub accepted_manifest_sha1: Vec<String>,
}

pub fn parse_lock(text: &str) -> Result<Lock, String> {
    let value: Value =
        serde_json::from_str(text).map_err(|e| format!("research-lock.json: {e}"))?;
    let minecraft = value
        .get("minecraft")
        .ok_or("research-lock.json has no minecraft")?;
    let version = minecraft
        .get("version")
        .and_then(Value::as_str)
        .ok_or("research-lock.json has no minecraft.version")?;
    let java_major = minecraft
        .get("java_major")
        .and_then(Value::as_u64)
        .ok_or("research-lock.json has no minecraft.java_major")?;
    Ok(Lock {
        minecraft: version.to_string(),
        java_major: u32::try_from(java_major).map_err(|e| e.to_string())?,
        server_sha1: minecraft
            .get("server_sha1")
            .and_then(Value::as_str)
            .map(String::from),
        manifest_sha1: minecraft
            .get("manifest_sha1")
            .and_then(Value::as_str)
            .map(String::from),
        accepted_manifest_sha1: minecraft
            .get("accepted_manifest_sha1")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default(),
    })
}

impl Installed {
    pub fn open(dir: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(dir.join("research-lock.json"))
            .map_err(|e| format!("{}: not a Horizon release ({e})", dir.display()))?;
        let installed = Self {
            dir: dir.to_path_buf(),
            lock: parse_lock(&text)?,
        };
        for program in [installed.client(), installed.preparer()] {
            if !program.is_file() {
                return Err(format!(
                    "{} is missing: install the release again.",
                    program.display()
                ));
            }
        }
        Ok(installed)
    }

    pub fn client(&self) -> PathBuf {
        self.dir.join(super::client_program())
    }

    pub fn preparer(&self) -> PathBuf {
        self.dir.join(super::prepare_program())
    }

    /// Where the preparation writes the game's resources: Horizon's own
    /// layout (`.local/horizon-client/<minecraft>`), so its tools find them.
    pub fn resources(&self) -> PathBuf {
        self.dir
            .join(".local")
            .join("horizon-client")
            .join(&self.lock.minecraft)
    }

    /// Mojang's own copy of the version file this release was made
    /// against. Mojang keeps every copy at an address made of its SHA-1, so
    /// what comes back is checked by its name.
    pub fn manifest_url(&self) -> Option<String> {
        let sha1 = self.lock.manifest_sha1.as_deref()?;
        Some(format!(
            "https://piston-meta.mojang.com/v1/packages/{sha1}/{}.json",
            self.lock.minecraft
        ))
    }

    /// Hands the preparation Mojang's version file byte for byte. Kiza
    /// stores the version files it installs rewritten (its own JSON
    /// formatting), and Horizon accepts only Mojang's exact bytes: given
    /// these, it takes the jars, libraries and assets from Kiza's folder.
    pub fn seed_manifest(&self, mojang_bytes: &[u8]) -> Result<(), String> {
        use sha1::{Digest, Sha1};
        let sha1: String = Sha1::digest(mojang_bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let known = self.lock.manifest_sha1.as_deref() == Some(sha1.as_str())
            || self.lock.accepted_manifest_sha1.contains(&sha1);
        if !known {
            return Err(format!(
                "Horizon {} does not know this {} version file (SHA-1 {sha1}).",
                self.dir.display(),
                self.lock.minecraft
            ));
        }
        let directory = self
            .dir
            .join(".local")
            .join("minecraft")
            .join(&self.lock.minecraft);
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        std::fs::write(directory.join("manifest.json"), mojang_bytes).map_err(|e| e.to_string())
    }

    /// Whether the preparation finished: it writes this manifest last.
    pub fn is_prepared(&self) -> bool {
        self.resources().join("horizon-resources.json").is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCK: &str = r#"{"minecraft":{"version":"26.3","manifest_sha1":"11f1","java_major":25,"client_sha1":"c","server_sha1":"s"}}"#;

    #[test]
    fn the_lock_names_the_version_and_its_java() {
        let lock = parse_lock(LOCK).unwrap();
        assert_eq!(lock.minecraft, "26.3");
        assert_eq!(lock.java_major, 25);
        assert_eq!(lock.server_sha1.as_deref(), Some("s"));
        assert_eq!(lock.manifest_sha1.as_deref(), Some("11f1"));
        assert!(parse_lock("{}").is_err());
    }

    #[test]
    fn an_installed_release_and_its_resources() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("research-lock.json"), LOCK).unwrap();
        assert!(Installed::open(dir.path()).is_err(), "no programs yet");
        std::fs::write(dir.path().join(crate::horizon::client_program()), b"").unwrap();
        std::fs::write(dir.path().join(crate::horizon::prepare_program()), b"").unwrap();
        let installed = Installed::open(dir.path()).unwrap();
        assert!(!installed.is_prepared());
        std::fs::create_dir_all(installed.resources()).unwrap();
        std::fs::write(installed.resources().join("horizon-resources.json"), b"{}").unwrap();
        assert!(installed.is_prepared());
        assert!(installed
            .resources()
            .ends_with(".local/horizon-client/26.3"));
    }

    #[test]
    fn only_a_version_file_the_release_knows_is_seeded() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"{\"id\":\"26.3\"}";
        let sha1 = {
            use sha1::{Digest, Sha1};
            Sha1::digest(bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        };
        let mut installed = Installed {
            dir: dir.path().to_path_buf(),
            lock: parse_lock(LOCK).unwrap(),
        };
        assert!(installed.seed_manifest(bytes).is_err());
        installed.lock.accepted_manifest_sha1.push(sha1);
        installed.seed_manifest(bytes).unwrap();
        let seeded = dir.path().join(".local/minecraft/26.3/manifest.json");
        assert_eq!(std::fs::read(seeded).unwrap(), bytes);
        assert_eq!(
            installed.manifest_url().unwrap(),
            "https://piston-meta.mojang.com/v1/packages/11f1/26.3.json"
        );
    }
}
