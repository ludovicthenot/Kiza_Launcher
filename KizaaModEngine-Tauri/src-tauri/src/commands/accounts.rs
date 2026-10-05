//! Who is playing: Microsoft sign-in, offline names, skins, and the access pass.
//!
//! Commands only: the interface's entry points, moved out of the crate root
//! so that file is a table of contents rather than the whole book. Helpers
//! and state stay where they were and are reached through the glob below;
//! a child module sees everything its parent does.

#![allow(unused_imports)]

use crate::*;

#[tauri::command]
pub(crate) async fn minecraft_auth_start(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
) -> Result<minecraft_auth::AuthStartResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let client_id = microsoft_client_id()?;
    app_state
        .minecraft_auth_manager
        .start_browser_auth_flow(&client_id, app_data_dir)
        .await
}

#[tauri::command]
pub(crate) async fn minecraft_auth_poll(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
    login_id: String,
) -> Result<minecraft_auth::AuthPollStatus, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let client_id = microsoft_client_id()?;
    app_state
        .minecraft_auth_manager
        .poll_login(app_data_dir, &client_id, &login_id)
        .await
}

#[tauri::command(async)]
pub(crate) fn minecraft_auth_get_account(
    app_handle: tauri::AppHandle,
) -> Option<minecraft_auth::MinecraftAccount> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::load_auth_state(&app_data_dir).map(|s| s.account)
}

/// Offline profiles are local identities: a saved name, and optionally a skin.
/// They never touch Mojang, so none of these commands authenticate anything.
#[tauri::command(async)]
pub(crate) fn offline_accounts_list(app_handle: tauri::AppHandle) -> Vec<offline_accounts::OfflineAccount> {
    offline_accounts::list(&app_data_dir(&app_handle))
}

#[tauri::command(async)]
pub(crate) fn offline_account_create(
    app_handle: tauri::AppHandle,
    username: String,
) -> Result<offline_accounts::OfflineAccount, String> {
    offline_accounts::create(&app_data_dir(&app_handle), &username)
}

#[tauri::command(async)]
pub(crate) fn offline_account_rename(
    app_handle: tauri::AppHandle,
    id: String,
    username: String,
) -> Result<offline_accounts::OfflineAccount, String> {
    offline_accounts::rename(&app_data_dir(&app_handle), &id, &username)
}

#[tauri::command(async)]
pub(crate) fn offline_account_delete(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<Vec<offline_accounts::OfflineAccount>, String> {
    offline_accounts::delete(&app_data_dir(&app_handle), &id)
}

#[tauri::command(async)]
pub(crate) fn offline_account_import_skin(
    app_handle: tauri::AppHandle,
    id: String,
    source_path: String,
) -> Result<offline_accounts::OfflineAccount, String> {
    offline_accounts::import_skin(
        &app_data_dir(&app_handle),
        &id,
        std::path::Path::new(&source_path),
    )
}

#[tauri::command(async)]
pub(crate) fn minecraft_auth_list_accounts(
    app_handle: tauri::AppHandle,
) -> Vec<minecraft_auth::MinecraftAccount> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::list_accounts(&app_data_dir)
}

#[tauri::command(async)]
pub(crate) fn minecraft_auth_set_active(
    app_handle: tauri::AppHandle,
    uuid: String,
) -> Result<minecraft_auth::MinecraftAccount, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::set_active_account(&app_data_dir, &uuid)
}

#[tauri::command(async)]
pub(crate) fn minecraft_auth_remove_account(
    app_handle: tauri::AppHandle,
    uuid: String,
) -> Result<Vec<minecraft_auth::MinecraftAccount>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::remove_account(&app_data_dir, &uuid)
}

#[tauri::command(async)]
pub(crate) fn minecraft_auth_logout(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    minecraft_auth::logout(&app_data_dir)?;
    app_state.minecraft_auth_manager.clear_pending();
    Ok(())
}

#[tauri::command]
pub(crate) async fn minecraft_skin_current(
    app_handle: tauri::AppHandle,
) -> Result<minecraft_skins::CurrentSkin, String> {
    let token = minecraft_token(&app_handle).await?;
    minecraft_skins::current(&token).await
}

/// The bytes a source names, as base64, for the preview. Nothing is applied.
#[tauri::command]
pub(crate) async fn minecraft_skin_preview(
    app_handle: tauri::AppHandle,
    source: minecraft_skins::SkinSource,
) -> Result<String, String> {
    let bytes = skin_bytes(&app_handle, source).await?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub(crate) async fn minecraft_skin_apply(
    app_handle: tauri::AppHandle,
    source: minecraft_skins::SkinSource,
    variant: minecraft_skins::Variant,
) -> Result<minecraft_skins::CurrentSkin, String> {
    let bytes = skin_bytes(&app_handle, source).await?;
    let token = minecraft_token(&app_handle).await?;
    minecraft_skins::apply(&token, bytes, variant).await?;
    note_profile_change(&app_handle).await;
    minecraft_skins::current(&token).await
}

#[tauri::command]
pub(crate) async fn minecraft_skin_reset(
    app_handle: tauri::AppHandle,
) -> Result<minecraft_skins::CurrentSkin, String> {
    let token = minecraft_token(&app_handle).await?;
    minecraft_skins::reset(&token).await?;
    note_profile_change(&app_handle).await;
    minecraft_skins::current(&token).await
}

#[tauri::command]
pub(crate) async fn minecraft_skin_set_cape(
    app_handle: tauri::AppHandle,
    cape_id: Option<String>,
) -> Result<minecraft_skins::CurrentSkin, String> {
    let token = minecraft_token(&app_handle).await?;
    minecraft_skins::set_cape(&token, cape_id.as_deref()).await?;
    minecraft_skins::current(&token).await
}

#[tauri::command]
pub(crate) async fn minecraft_skin_library(
    app_handle: tauri::AppHandle,
) -> Result<Vec<minecraft_skins::LibrarySkin>, String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || Ok(minecraft_skins::library_list(&app_data_dir))).await
}

#[tauri::command]
pub(crate) async fn minecraft_skin_library_add(
    app_handle: tauri::AppHandle,
    source: minecraft_skins::SkinSource,
    name: String,
    variant: minecraft_skins::Variant,
) -> Result<minecraft_skins::LibrarySkin, String> {
    let bytes = skin_bytes(&app_handle, source).await?;
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || minecraft_skins::library_add(&app_data_dir, &name, &bytes, variant)).await
}

#[tauri::command]
pub(crate) async fn minecraft_skin_library_rename(
    app_handle: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || minecraft_skins::library_rename(&app_data_dir, &id, &name)).await
}

#[tauri::command]
pub(crate) async fn minecraft_skin_library_set_variant(
    app_handle: tauri::AppHandle,
    id: String,
    variant: minecraft_skins::Variant,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || minecraft_skins::library_set_variant(&app_data_dir, &id, variant)).await
}

#[tauri::command]
pub(crate) async fn minecraft_skin_library_remove(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app_handle);
    off_thread(move || minecraft_skins::library_remove(&app_data_dir, &id)).await
}

/// What the launcher shows about its own access.
#[tauri::command]
pub(crate) async fn access_status(app_handle: tauri::AppHandle) -> Result<access::Status, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || Ok(access::status(&dir))).await
}

/// The headers a request for a build must carry, for the updater to send.
#[tauri::command]
pub(crate) async fn access_headers(app_handle: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || Ok(access::headers(&dir))).await
}

/// Starts a sign-in: remembers a state, and opens Discord in the browser.
///
/// The state is written down *before* the browser opens. A launcher that
/// opened the browser first and remembered afterwards would have a window in
/// which a link arriving from anywhere would be claimed as if it were the
/// answer to a question this launcher had asked.
#[tauri::command]
pub(crate) async fn access_begin(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    let origin = service_origin(&app_handle)
        .ok_or_else(|| "This build has no update service to sign in to.".to_string())?;

    let state = access::new_state();
    {
        let dir = dir.clone();
        let state = state.clone();
        off_thread(move || {
            let mut stored = access::load(&dir);
            stored.pending_state = Some(state);
            access::save(&dir, &stored)
        })
        .await?;
    }

    let url = format!("{origin}/v1/access/start?state={state}");
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|error| format!("Could not open the browser: {error}"))?;
    Ok(url)
}

/// Exchanges the code the browser handed back for the pass itself.
///
/// The state is checked here as well as at the service. Ours is the only copy
/// that proves this launcher started the sign-in; the service only knows that
/// *a* launcher did.
#[tauri::command]
pub(crate) async fn access_claim(
    app_handle: tauri::AppHandle,
    code: String,
    state: String,
) -> Result<access::Status, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    let origin = service_origin(&app_handle)
        .ok_or_else(|| "This build has no update service to sign in to.".to_string())?;

    let mut stored = access::load(&dir);
    match stored.pending_state.as_deref() {
        Some(expected) if expected == state => {}
        _ => return Err("That sign-in did not start here.".to_string()),
    }

    #[derive(serde::Deserialize)]
    struct Claimed {
        pass: String,
        #[serde(default)]
        channels: Vec<String>,
    }

    let machine = {
        let dir = dir.clone();
        off_thread(move || Ok(access::machine_id(&dir))).await?
    };

    let response = reqwest::Client::new()
        .post(format!("{origin}/v1/access/claim"))
        .header("X-Kiza-Machine", &machine)
        .json(&serde_json::json!({ "code": code, "state": state, "machine": machine }))
        .send()
        .await
        .map_err(|error| format!("Could not reach the update service: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let said = response.text().await.unwrap_or_default();
        let reason = serde_json::from_str::<serde_json::Value>(&said)
            .ok()
            .and_then(|body| body.get("error")?.as_str().map(str::to_string))
            .unwrap_or_else(|| format!("The service answered {status}."));
        return Err(reason);
    }

    let claimed: Claimed = response
        .json()
        .await
        .map_err(|error| format!("The service sent something unreadable: {error}"))?;

    // Read for display only. What it opens is decided by the service on every
    // request; this is so the interface can say which account and until when
    // without asking again.
    let (account, expires) = access::describe(&claimed.pass);

    stored.pass = Some(claimed.pass);
    stored.channels = claimed.channels;
    stored.account = account;
    stored.expires = expires;
    stored.pending_state = None;
    access::save(&dir, &stored)?;

    Ok(access::status(&dir))
}

/// Replaces a pass that is about to run out, without telling anybody.
///
/// A pass lasts a week because that is how long a revocation may take to land,
/// not because access is meant to be re-earned weekly. Without this the two
/// were the same thing: somebody nobody had removed from anything opened the
/// launcher on the eighth day and found it locked.
///
/// Silent in both directions. Nothing is shown when it works, and nothing is
/// shown when it does not: a service that cannot be reached, a machine offline,
/// a launcher opened on a train — none of those are the person's problem, and
/// the pass they already have keeps working until it genuinely runs out. What
/// they see then is the sign-in, which is the honest answer.
///
/// The rule lives here rather than in the interface so there is one of it. The
/// frontend calls this on every launch and this decides whether anything
/// happens, which means a second caller cannot renew on a different schedule.
#[tauri::command]
pub(crate) async fn access_renew(app_handle: tauri::AppHandle) -> Result<access::Status, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;

    let mut stored = access::load(&dir);
    if stored.pass.is_none()
        || !access::worth_renewing(stored.expires.as_deref(), chrono::Utc::now())
    {
        return Ok(access::status(&dir));
    }
    let Some(origin) = service_origin(&app_handle) else {
        return Ok(access::status(&dir));
    };

    #[derive(serde::Deserialize)]
    struct Renewed {
        pass: String,
        #[serde(default)]
        channels: Vec<String>,
    }

    let mut request = reqwest::Client::new().post(format!("{origin}/v1/access/renew"));
    // The same proof every other request carries: the pass, and the machine it
    // names. The service compares them before it will write a new one.
    for (name, value) in {
        let dir = dir.clone();
        off_thread(move || Ok(access::headers(&dir))).await?
    } {
        request = request.header(name, value);
    }

    let Ok(response) = request.send().await else {
        return Ok(access::status(&dir));
    };
    if !response.status().is_success() {
        // Refused on purpose -- removed from the list, or a pass from another
        // machine. Left alone rather than forgotten: this is not the place
        // that decides somebody is out, and deleting their pass here would
        // sign them out over a service having a bad minute.
        return Ok(access::status(&dir));
    }
    let Ok(renewed) = response.json::<Renewed>().await else {
        return Ok(access::status(&dir));
    };

    let (account, expires) = access::describe(&renewed.pass);
    stored.pass = Some(renewed.pass);
    stored.channels = renewed.channels;
    stored.account = account;
    stored.expires = expires;
    access::save(&dir, &stored)?;

    Ok(access::status(&dir))
}

/// Forgets the pass. The service is not told: it has nothing to forget.
#[tauri::command]
pub(crate) async fn access_disconnect(app_handle: tauri::AppHandle) -> Result<access::Status, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Kiza folder: {error}"))?;
    off_thread(move || {
        access::forget(&dir)?;
        Ok(access::status(&dir))
    })
    .await
}
