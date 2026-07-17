use crate::app_error::AppError;

const SERVICE: &str = "KizaaMod";

pub const NEXUS_API_KEY: &str = "nexus_api_key";
pub const CURSEFORGE_API_KEY: &str = "curseforge_api_key";
pub const MICROSOFT_CLIENT_ID: &str = "microsoft_client_id";
pub const MINECRAFT_AUTH_STATE: &str = "minecraft_auth_state";

fn entry(name: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, name).map_err(|e| {
        AppError::config(
            format!("Failed to access the OS credential manager: {e}"),
            "Check that the Windows credential vault is available.",
        )
    })
}

pub fn get_secret(name: &str) -> Result<Option<String>, AppError> {
    match entry(name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::config(
            format!("Failed to read the secret '{name}': {e}"),
            "Re-save the API connection from System & APIs.",
        )),
    }
}

pub fn set_secret(name: &str, value: &str) -> Result<(), AppError> {
    entry(name)?.set_password(value).map_err(|e| {
        AppError::config(
            format!("Failed to save the secret '{name}': {e}"),
            "Check the OS credential manager permissions.",
        )
    })
}

pub fn delete_secret(name: &str) -> Result<(), AppError> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::config(
            format!("Failed to delete the secret '{name}': {e}"),
            "Try again from System & APIs, or remove the KizaaMod entry from the OS vault if you are migrating old keys.",
        )),
    }
}

pub fn configured(name: &str) -> bool {
    matches!(get_secret(name), Ok(Some(value)) if !value.trim().is_empty())
}

pub fn get_secret_or_env(name: &str, env_name: &str) -> Result<Option<String>, AppError> {
    if let Some(value) = get_secret(name)? {
        return Ok(Some(value));
    }
    Ok(std::env::var(env_name)
        .ok()
        .filter(|value| !value.trim().is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: multi-KB payloads do NOT round-trip through the Windows vault
    // (writes report success but reads return nothing). That is why the
    // Minecraft auth store lives in a JSON file; the vault is only for
    // small secrets like API keys, which this test covers.
    #[test]
    fn keyring_round_trips_small_secrets() {
        let name = "kiza_test_roundtrip";
        let payload = "k".repeat(120);
        let write = set_secret(name, &payload);
        let read = get_secret(name);
        let _ = delete_secret(name);
        assert!(
            write.is_ok(),
            "set_secret failed: {:?}",
            write.err().map(|e| e.message)
        );
        assert_eq!(
            read.ok().flatten().as_deref(),
            Some(payload.as_str()),
            "small secret round-trip through the OS vault lost data"
        );
    }
}
