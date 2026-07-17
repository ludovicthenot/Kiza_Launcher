use std::path::{Component, Path, PathBuf};

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

pub fn safe_file_name(input: &str, allowed_extensions: &[&str]) -> Result<String, String> {
    let name = input.trim();
    if name.is_empty() {
        return Err("File name is empty".to_string());
    }
    if name != input {
        return Err("File name contains leading or trailing whitespace".to_string());
    }
    if name == "." || name == ".." {
        return Err("File name is not allowed".to_string());
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("File name cannot end with a dot or space".to_string());
    }
    if name
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err("File name contains invalid characters".to_string());
    }

    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(part)), None) if part.to_string_lossy() == name => {}
        _ => return Err("File name must not contain path separators".to_string()),
    }

    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(name)
        .to_ascii_lowercase();
    if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
        return Err("File name is reserved by Windows".to_string());
    }

    if !allowed_extensions.is_empty() {
        let ext = Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .ok_or_else(|| "File extension is missing".to_string())?;
        let allowed = allowed_extensions
            .iter()
            .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
            .any(|allowed| allowed == ext);
        if !allowed {
            return Err(format!("File extension '.{ext}' is not allowed"));
        }
    }

    Ok(name.to_string())
}

pub fn safe_child_path(
    parent: &Path,
    file_name: &str,
    allowed_extensions: &[&str],
) -> Result<PathBuf, String> {
    Ok(parent.join(safe_file_name(file_name, allowed_extensions)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_file_name_accepts_normal_names() {
        assert_eq!(
            safe_file_name("sodium-fabric.jar", &["jar"]).unwrap(),
            "sodium-fabric.jar"
        );
    }

    #[test]
    fn safe_file_name_rejects_path_traversal() {
        assert!(safe_file_name("../evil.jar", &["jar"]).is_err());
        assert!(safe_file_name("mods/evil.jar", &["jar"]).is_err());
        assert!(safe_file_name("mods\\evil.jar", &["jar"]).is_err());
    }

    #[test]
    fn safe_file_name_rejects_reserved_and_bad_extensions() {
        assert!(safe_file_name("CON.jar", &["jar"]).is_err());
        assert!(safe_file_name("mod.exe", &["jar"]).is_err());
        assert!(safe_file_name("bad:name.jar", &["jar"]).is_err());
    }
}
