use crate::credential_store::{self, MINECRAFT_AUTH_STATE};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest as ShaDigest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

pub const MICROSOFT_AUTHORITY: &str = "https://login.microsoftonline.com/consumers";
pub const MICROSOFT_REDIRECT_URI: &str = "http://localhost:3000/auth/callback";
pub const MICROSOFT_SCOPES: [&str; 2] = ["XboxLive.signin", "offline_access"];

fn microsoft_scope_string() -> String {
    MICROSOFT_SCOPES.join(" ")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftAccount {
    pub uuid: String,
    pub username: String,
    #[serde(default)]
    pub skin_url: Option<String>,
    #[serde(default)]
    pub skin_head_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftAuthState {
    pub account: MinecraftAccount,
    pub mc_access_token: String,
    pub mc_expires_at: String,
    pub msa_refresh_token: String,
    pub msa_access_token: String,
    pub msa_expires_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MinecraftAuthStore {
    pub schema_version: u32,
    pub active_account_id: Option<String>,
    pub accounts: Vec<MinecraftAuthState>,
}

impl MinecraftAuthStore {
    fn from_state(state: MinecraftAuthState) -> Self {
        Self {
            schema_version: 2,
            active_account_id: Some(state.account.uuid.clone()),
            accounts: vec![state],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceCodeResponse {
    pub user_code: String,
    pub device_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthStartResult {
    pub login_id: String,
    pub user_code: String,
    pub verification_uri: String,
    pub message: String,
    pub expires_in: u64,
    pub interval: u64,
    pub authority: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AuthPollStatus {
    Pending,
    Success(MinecraftAccount),
    Error(String),
}

#[derive(Clone)]
pub struct MinecraftAuthManager {
    pending: Arc<Mutex<HashMap<String, PendingLogin>>>,
    browser_pending: Arc<Mutex<HashMap<String, BrowserLogin>>>,
    /// The task holding the localhost callback listeners. Aborted when a new
    /// sign-in starts so an abandoned attempt cannot keep port 3000 bound.
    browser_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
}

#[derive(Clone)]
struct PendingLogin {
    device_code: String,
    expires_at: DateTime<Utc>,
}

#[derive(Clone)]
struct BrowserLogin {
    expires_at: DateTime<Utc>,
    result: BrowserLoginResult,
}

#[derive(Clone)]
enum BrowserLoginResult {
    Pending,
    Success(MinecraftAuthState),
    Error(String),
}

impl MinecraftAuthManager {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            browser_pending: Arc::new(Mutex::new(HashMap::new())),
            browser_task: Arc::new(Mutex::new(None)),
        }
    }

    fn lock_pending(&self) -> Result<MutexGuard<'_, HashMap<String, PendingLogin>>, String> {
        self.pending
            .lock()
            .map_err(|_| "Minecraft auth pending lock is poisoned".to_string())
    }

    fn lock_browser_pending(
        &self,
    ) -> Result<MutexGuard<'_, HashMap<String, BrowserLogin>>, String> {
        self.browser_pending
            .lock()
            .map_err(|_| "Minecraft browser auth lock is poisoned".to_string())
    }

    fn lock_browser_pending_arc(
        pending: &Arc<Mutex<HashMap<String, BrowserLogin>>>,
    ) -> Result<MutexGuard<'_, HashMap<String, BrowserLogin>>, String> {
        pending
            .lock()
            .map_err(|_| "Minecraft browser auth lock is poisoned".to_string())
    }

    pub async fn start_browser_auth_flow(
        &self,
        client_id: &str,
        app_data_dir: PathBuf,
    ) -> Result<AuthStartResult, String> {
        // Cancel any previous attempt so an abandoned sign-in cannot keep the
        // callback port bound (which made every retry fail for 10 minutes).
        if let Ok(mut task) = self.browser_task.lock() {
            if let Some(handle) = task.take() {
                handle.abort();
            }
        }
        if let Ok(mut map) = self.lock_browser_pending() {
            for entry in map.values_mut() {
                if matches!(entry.result, BrowserLoginResult::Pending) {
                    entry.result = BrowserLoginResult::Error(
                        "Sign-in canceled: a newer sign-in was started.".to_string(),
                    );
                }
            }
        }

        // The OS can take a moment to release the port after the abort.
        let mut listeners = bind_callback_listeners().await;
        for _ in 0..4 {
            if listeners.is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            listeners = bind_callback_listeners().await;
        }
        let listeners = listeners?;
        let login_id = Uuid::new_v4().to_string();
        let state = Uuid::new_v4().to_string();
        let code_verifier = pkce_verifier();
        let code_challenge = pkce_challenge(&code_verifier);
        let expires_at = Utc::now() + Duration::minutes(10);
        let scopes = microsoft_scope_string();
        let authorize_url = reqwest::Url::parse_with_params(
            &format!("{MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize"),
            &[
                ("client_id", client_id),
                ("response_type", "code"),
                ("redirect_uri", MICROSOFT_REDIRECT_URI),
                ("scope", scopes.as_str()),
                ("state", state.as_str()),
                ("code_challenge", code_challenge.as_str()),
                ("code_challenge_method", "S256"),
                ("prompt", "select_account"),
            ],
        )
        .map_err(|e| e.to_string())?;

        self.lock_browser_pending()?.insert(
            login_id.clone(),
            BrowserLogin {
                expires_at,
                result: BrowserLoginResult::Pending,
            },
        );

        let pending = self.browser_pending.clone();
        let login_id_for_task = login_id.clone();
        let client_id = client_id.to_string();
        let handle = tauri::async_runtime::spawn(async move {
            let log_dir = app_data_dir.clone();
            log_auth_event(&log_dir, "Browser sign-in started.");
            let result =
                handle_browser_callback(listeners, app_data_dir, client_id, state, code_verifier)
                    .await;
            match &result {
                Ok(auth) => log_auth_event(
                    &log_dir,
                    &format!("Browser sign-in succeeded for {}.", auth.account.username),
                ),
                Err(error) => log_auth_event(&log_dir, &format!("Browser sign-in failed: {error}")),
            }
            let Ok(mut map) = Self::lock_browser_pending_arc(&pending) else {
                eprintln!("[Minecraft Auth] Browser auth lock is poisoned");
                return;
            };
            if let Some(entry) = map.get_mut(&login_id_for_task) {
                entry.result = match result {
                    Ok(auth) => BrowserLoginResult::Success(auth),
                    Err(error) => BrowserLoginResult::Error(error),
                };
            }
        });
        if let Ok(mut task) = self.browser_task.lock() {
            *task = Some(handle);
        }

        Ok(AuthStartResult {
            login_id,
            user_code: String::new(),
            verification_uri: authorize_url.to_string(),
            message: "Open Microsoft login in your browser.".to_string(),
            expires_in: 600,
            interval: 2,
            authority: MICROSOFT_AUTHORITY.to_string(),
            redirect_uri: MICROSOFT_REDIRECT_URI.to_string(),
            scopes: MICROSOFT_SCOPES
                .iter()
                .map(|scope| scope.to_string())
                .collect(),
        })
    }

    pub async fn start_device_code_flow(&self, client_id: &str) -> Result<AuthStartResult, String> {
        let dc = request_device_code(client_id).await?;
        let login_id = Uuid::new_v4().to_string();
        let expires_at = Utc::now() + Duration::seconds(dc.expires_in as i64);

        self.lock_pending()?.insert(
            login_id.clone(),
            PendingLogin {
                device_code: dc.device_code,
                expires_at,
            },
        );

        Ok(AuthStartResult {
            login_id,
            user_code: dc.user_code,
            verification_uri: dc.verification_uri,
            message: dc.message,
            expires_in: dc.expires_in,
            interval: dc.interval,
            authority: MICROSOFT_AUTHORITY.to_string(),
            redirect_uri: MICROSOFT_REDIRECT_URI.to_string(),
            scopes: MICROSOFT_SCOPES
                .iter()
                .map(|scope| scope.to_string())
                .collect(),
        })
    }

    pub async fn poll_login(
        &self,
        app_data_dir: PathBuf,
        client_id: &str,
        login_id: &str,
    ) -> Result<AuthPollStatus, String> {
        let browser = {
            let mut map = self.lock_browser_pending()?;
            if let Some(entry) = map.get(login_id).cloned() {
                if Utc::now() > entry.expires_at {
                    map.remove(login_id);
                    return Ok(AuthPollStatus::Error("Login expired".to_string()));
                }
                Some(entry)
            } else {
                None
            }
        };

        if let Some(browser) = browser {
            return match browser.result {
                BrowserLoginResult::Pending => Ok(AuthPollStatus::Pending),
                BrowserLoginResult::Success(auth) => {
                    self.lock_browser_pending()?.remove(login_id);
                    Ok(AuthPollStatus::Success(auth.account))
                }
                BrowserLoginResult::Error(error) => {
                    self.lock_browser_pending()?.remove(login_id);
                    Ok(AuthPollStatus::Error(error))
                }
            };
        }

        let pending = {
            let map = self.lock_pending()?;
            map.get(login_id)
                .cloned()
                .ok_or("Login not found".to_string())?
        };

        if Utc::now() > pending.expires_at {
            self.lock_pending()?.remove(login_id);
            return Ok(AuthPollStatus::Error("Login expired".to_string()));
        }

        match poll_token(client_id, &pending.device_code).await {
            Ok(TokenResponse::Success(msa)) => {
                let auth = exchange_for_minecraft(app_data_dir.clone(), &msa).await?;
                save_auth_state(&app_data_dir, &auth)?;
                self.lock_pending()?.remove(login_id);
                Ok(AuthPollStatus::Success(auth.account))
            }
            Ok(TokenResponse::Pending) => Ok(AuthPollStatus::Pending),
            Ok(TokenResponse::SlowDown) => Ok(AuthPollStatus::Pending),
            Err(e) => Ok(AuthPollStatus::Error(e)),
        }
    }

    pub fn clear_pending(&self) {
        if let Ok(mut pending) = self.lock_pending() {
            pending.clear();
        }
        if let Ok(mut browser_pending) = self.lock_browser_pending() {
            browser_pending.clear();
        }
    }
}

fn auth_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config").join("minecraft_auth.json")
}

/// Append an auth event to logs/auth.log so sign-in failures are diagnosable
/// in release builds (no token or secret is ever written here).
pub fn log_auth_event(app_data_dir: &Path, message: &str) {
    let dir = app_data_dir.join("logs");
    let _ = fs::create_dir_all(&dir);
    let line = format!("[{}] {}\n", Utc::now().to_rfc3339(), message);
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("auth.log"))
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Head avatar rendered by mc-heads.net (crafatar.com is unreliable/down).
fn skin_head_url_for(uuid: &str) -> String {
    format!("https://mc-heads.net/avatar/{uuid}/96")
}

fn parse_auth_store(content: &str) -> Option<MinecraftAuthStore> {
    let mut store = serde_json::from_str::<MinecraftAuthStore>(content)
        .ok()
        .or_else(|| {
            serde_json::from_str::<MinecraftAuthState>(content)
                .ok()
                .map(MinecraftAuthStore::from_state)
        })?;

    // Migrate avatar URLs saved when crafatar.com was still the provider.
    for state in &mut store.accounts {
        let stale = state
            .account
            .skin_head_url
            .as_deref()
            .is_none_or(|url| url.contains("crafatar.com"));
        if stale {
            state.account.skin_head_url = Some(skin_head_url_for(&state.account.uuid));
        }
    }
    Some(store)
}

pub fn load_auth_store(app_data_dir: &Path) -> Option<MinecraftAuthStore> {
    // Primary storage is the JSON file: the Windows credential vault silently
    // fails to round-trip multi-KB payloads (writes report success but reads
    // return nothing), which lost the account right after a successful login.
    let path = auth_path(app_data_dir);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Some(store) = parse_auth_store(&content) {
            return Some(store);
        }
    }

    // Legacy migration: recover any store still readable from the OS vault.
    if let Ok(Some(content)) = credential_store::get_secret(MINECRAFT_AUTH_STATE) {
        if let Some(store) = parse_auth_store(&content) {
            if save_auth_store(app_data_dir, &store).is_ok() {
                let _ = credential_store::delete_secret(MINECRAFT_AUTH_STATE);
            }
            return Some(store);
        }
    }
    None
}

pub fn save_auth_store(app_data_dir: &Path, store: &MinecraftAuthStore) -> Result<(), String> {
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    let path = auth_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())?;
    // Remove any legacy vault copy so the file stays the single source of truth.
    let _ = credential_store::delete_secret(MINECRAFT_AUTH_STATE);
    Ok(())
}

pub fn load_auth_state(app_data_dir: &Path) -> Option<MinecraftAuthState> {
    let store = load_auth_store(app_data_dir)?;
    if let Some(active_id) = store.active_account_id.as_deref() {
        if let Some(state) = store
            .accounts
            .iter()
            .find(|state| state.account.uuid == active_id)
            .cloned()
        {
            return Some(state);
        }
    }
    store.accounts.first().cloned()
}

pub fn save_auth_state(app_data_dir: &Path, state: &MinecraftAuthState) -> Result<(), String> {
    let mut store = load_auth_store(app_data_dir).unwrap_or(MinecraftAuthStore {
        schema_version: 2,
        active_account_id: None,
        accounts: Vec::new(),
    });
    store.schema_version = 2;
    store.active_account_id = Some(state.account.uuid.clone());
    if let Some(existing) = store
        .accounts
        .iter_mut()
        .find(|existing| existing.account.uuid == state.account.uuid)
    {
        *existing = state.clone();
    } else {
        store.accounts.push(state.clone());
    }
    save_auth_store(app_data_dir, &store)
}

pub fn list_accounts(app_data_dir: &Path) -> Vec<MinecraftAccount> {
    load_auth_store(app_data_dir)
        .map(|store| {
            store
                .accounts
                .into_iter()
                .map(|state| state.account)
                .collect()
        })
        .unwrap_or_default()
}

pub fn set_active_account(app_data_dir: &Path, uuid: &str) -> Result<MinecraftAccount, String> {
    let mut store =
        load_auth_store(app_data_dir).ok_or("No Minecraft accounts saved".to_string())?;
    let account = store
        .accounts
        .iter()
        .find(|state| state.account.uuid == uuid)
        .map(|state| state.account.clone())
        .ok_or("Minecraft account not found".to_string())?;
    store.active_account_id = Some(uuid.to_string());
    save_auth_store(app_data_dir, &store)?;
    Ok(account)
}

pub fn remove_account(app_data_dir: &Path, uuid: &str) -> Result<Vec<MinecraftAccount>, String> {
    let mut store =
        load_auth_store(app_data_dir).ok_or("No Minecraft accounts saved".to_string())?;
    store.accounts.retain(|state| state.account.uuid != uuid);
    if store.active_account_id.as_deref() == Some(uuid) {
        store.active_account_id = store
            .accounts
            .first()
            .map(|state| state.account.uuid.clone());
    }
    let accounts = store
        .accounts
        .iter()
        .map(|state| state.account.clone())
        .collect::<Vec<_>>();
    if accounts.is_empty() {
        logout(app_data_dir)?;
    } else {
        save_auth_store(app_data_dir, &store)?;
    }
    Ok(accounts)
}

pub fn logout(app_data_dir: &Path) -> Result<(), String> {
    let path = auth_path(app_data_dir);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    let _ = credential_store::delete_secret(MINECRAFT_AUTH_STATE);
    Ok(())
}

fn parse_rfc3339(s: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(s)
        .map_err(|e| e.to_string())
        .map(|dt| dt.with_timezone(&Utc))
}

fn now_plus_seconds(seconds: u64) -> DateTime<Utc> {
    Utc::now() + Duration::seconds(seconds as i64)
}

fn pkce_verifier() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The OAuth callback page. Kept in the launcher's own palette rather than a
/// generic blue, since it is the only Kiza surface that opens in a browser.
const CALLBACK_PAGE: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;
  font-family:"Segoe UI Variable Text","Segoe UI",Inter,system-ui,sans-serif;
  background:radial-gradient(circle at 18% 8%,rgba(139,92,246,.18),transparent 38%),#0b0a12;
  color:#f4f2fa}
main{width:min(560px,calc(100vw - 40px));padding:36px;border:1px solid #352c4a;
  border-radius:18px;background:#141021;box-shadow:0 24px 80px rgba(0,0,0,.5)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px;color:#aaa5ba;
  font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.mark{width:34px;height:34px;border-radius:10px;
  background:linear-gradient(135deg,#8b5cf6,#c4b5fd);display:grid;place-items:center;
  color:#fff;font-weight:900}
.status{display:inline-flex;align-items:center;gap:10px;margin-bottom:16px;
  color:__ACCENT__;font-size:14px;font-weight:700}
.dot{width:10px;height:10px;border-radius:999px;background:__ACCENT__;
  box-shadow:0 0 24px __ACCENT__}
h1{margin:0 0 12px;font-size:30px;line-height:1.08}
p{margin:0;color:#aaa5ba;font-size:15px;line-height:1.65}
.hint{margin-top:22px;padding:14px 16px;border-radius:12px;background:#0f0c19;
  border:1px solid #352c4a;color:#dcd6ec}
button{margin-top:26px;height:42px;padding:0 18px;border:1px solid rgba(139,92,246,.4);
  border-radius:10px;background:#8b5cf6;color:#fff;
  font:700 14px "Segoe UI Variable Text","Segoe UI",Inter,system-ui,sans-serif;
  cursor:pointer;transition:background-color .15s}
button:hover{background:#7c3aed}
button[disabled]{background:transparent;color:#aaa5ba;border-color:#352c4a;cursor:default}
</style></head>
<body><main>
<div class="brand"><div class="mark">K</div><span>Kiza Launcher</span></div>
<div class="status"><span class="dot"></span><span>__STATUS__</span></div>
<h1>__TITLE__</h1>
<p>__BODY__</p>
<p class="hint">You can go back to Kiza Launcher. This page can now be closed.</p>
<button id="kiza-close">Close this page</button>
<script>
// window.close() only works on windows opened by script, which this is not
// when the browser reuses an existing one. Say so instead of doing nothing.
document.getElementById("kiza-close").addEventListener("click", function () {
  var button = this;
  window.close();
  setTimeout(function () {
    button.disabled = true;
    button.textContent = "Close this tab yourself to finish";
  }, 200);
});
</script>
</main></body></html>"##;

fn html_response(title: &str, body: &str) -> String {
    let title = escape_html(title);
    let body = escape_html(body);
    let title_lower = title.to_ascii_lowercase();
    let is_failed = title_lower.contains("failed") || title_lower.contains("error");
    let is_waiting = title_lower.contains("waiting");
    let accent = if is_failed {
        "#fb7185"
    } else if is_waiting {
        "#c4b5fd"
    } else {
        "#7cdd9b"
    };
    let status = if is_failed {
        "Microsoft sign-in interrupted"
    } else if is_waiting {
        "Microsoft sign-in pending"
    } else {
        "Microsoft sign-in complete"
    };

    let page = CALLBACK_PAGE
        .replace("__TITLE__", &title)
        .replace("__BODY__", &body)
        .replace("__ACCENT__", accent)
        .replace("__STATUS__", status);
    format!(
        "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\nconnection: close\r\n\r\n{page}"
    )
}

async fn bind_callback_listeners() -> Result<Vec<TcpListener>, String> {
    let mut listeners = Vec::new();
    let mut errors = Vec::new();

    for address in ["127.0.0.1:3000", "[::1]:3000"] {
        match TcpListener::bind(address).await {
            Ok(listener) => listeners.push(listener),
            Err(error) => errors.push(format!("{address}: {error}")),
        }
    }

    if listeners.is_empty() {
        Err(format!(
            "Cannot listen on {MICROSOFT_REDIRECT_URI}. {}",
            errors.join("; ")
        ))
    } else {
        Ok(listeners)
    }
}

enum CallbackRequestResult {
    Continue,
    Done(Box<MinecraftAuthState>),
}

// Accept on whichever listener (IPv4/IPv6 localhost) gets a connection first.
async fn accept_any(
    first: &TcpListener,
    second: Option<&TcpListener>,
) -> std::io::Result<(tokio::net::TcpStream, std::net::SocketAddr)> {
    match second {
        Some(second) => tokio::select! {
            result = first.accept() => result,
            result = second.accept() => result,
        },
        None => first.accept().await,
    }
}

// Owns the listeners for the whole flow: when the task is aborted (a newer
// sign-in starts) the listeners drop and the callback port is released.
async fn handle_browser_callback(
    listeners: Vec<TcpListener>,
    app_data_dir: PathBuf,
    client_id: String,
    expected_state: String,
    code_verifier: String,
) -> Result<MinecraftAuthState, String> {
    let mut iter = listeners.into_iter();
    let first = iter
        .next()
        .ok_or("No callback listener bound".to_string())?;
    let second = iter.next();

    let timeout = tokio::time::sleep(std::time::Duration::from_secs(600));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            _ = &mut timeout => return Err("Microsoft login timed out".to_string()),
            accepted = accept_any(&first, second.as_ref()) => {
                // Transient socket issues (e.g. browsers opening and resetting
                // speculative connections) must not abort the sign-in.
                let Ok((mut stream, _)) = accepted else {
                    continue;
                };
                match handle_callback_request(
                    &mut stream,
                    &app_data_dir,
                    &client_id,
                    &expected_state,
                    &code_verifier,
                )
                .await
                {
                    Ok(CallbackRequestResult::Continue) => continue,
                    Ok(CallbackRequestResult::Done(auth)) => return Ok(*auth),
                    Err(error) => return Err(error),
                }
            }
        }
    }
}

async fn handle_callback_request(
    stream: &mut tokio::net::TcpStream,
    app_data_dir: &Path,
    client_id: &str,
    expected_state: &str,
    code_verifier: &str,
) -> Result<CallbackRequestResult, String> {
    let mut buffer = vec![0u8; 8192];
    // Read errors are transient (reset speculative connections): keep listening.
    let Ok(len) = stream.read(&mut buffer).await else {
        return Ok(CallbackRequestResult::Continue);
    };
    if len == 0 {
        return Ok(CallbackRequestResult::Continue);
    }

    let request = String::from_utf8_lossy(&buffer[..len]);
    let first_line = request.lines().next().unwrap_or_default();
    let request_target = first_line.split_whitespace().nth(1).unwrap_or("/");

    let callback_url =
        if request_target.starts_with("http://") || request_target.starts_with("https://") {
            reqwest::Url::parse(request_target)
        } else {
            reqwest::Url::parse(&format!("http://localhost:3000{request_target}"))
        };

    let Ok(callback_url) = callback_url else {
        let _ = stream
            .write_all(
                html_response(
                    "Kiza Launcher is waiting for Microsoft",
                    "The sign-in is still in progress. Go back to the Microsoft page if it is open.",
                )
                .as_bytes(),
            )
            .await;
        return Ok(CallbackRequestResult::Continue);
    };

    if callback_url.path() != "/auth/callback" {
        let _ = stream
            .write_all(
                html_response(
                    "Kiza Launcher is waiting for Microsoft",
                    "The sign-in is still in progress. This page will update automatically after Microsoft validation.",
                )
                .as_bytes(),
            )
            .await;
        return Ok(CallbackRequestResult::Continue);
    }

    let state = callback_url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();
    if state != expected_state {
        // A stale tab from an earlier attempt: reject that tab but keep the
        // current sign-in alive.
        let _ = stream
            .write_all(
                html_response(
                    "Kiza Launcher login failed",
                    "This sign-in tab is outdated. Close it and use the most recent one.",
                )
                .as_bytes(),
            )
            .await;
        return Ok(CallbackRequestResult::Continue);
    }

    if let Some(error) = callback_url
        .query_pairs()
        .find(|(key, _)| key == "error_description" || key == "error")
        .map(|(_, value)| value.to_string())
    {
        let _ = stream
            .write_all(html_response("Kiza Launcher login failed", &error).as_bytes())
            .await;
        return Err(error);
    }

    let code = callback_url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string())
        .ok_or("Microsoft callback did not include an authorization code".to_string())?;

    let token = exchange_authorization_code(client_id, &code, code_verifier).await;
    match token {
        Ok(msa) => {
            let auth = match exchange_for_minecraft(app_data_dir.to_path_buf(), &msa)
                .await
                .and_then(|auth| {
                    save_auth_state(app_data_dir, &auth)?;
                    Ok(auth)
                }) {
                Ok(auth) => auth,
                Err(error) => {
                    let _ = stream
                        .write_all(html_response("Kiza Launcher login failed", &error).as_bytes())
                        .await;
                    return Err(error);
                }
            };
            let _ = stream
                .write_all(html_response("Kiza Launcher login complete", "Your Microsoft Minecraft account is connected. You can go back to Kiza Launcher.").as_bytes())
                .await;
            Ok(CallbackRequestResult::Done(Box::new(auth)))
        }
        Err(error) => {
            let _ = stream
                .write_all(html_response("Kiza Launcher login failed", &error).as_bytes())
                .await;
            Err(error)
        }
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct TokenSuccess {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    token_type: String,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    error_description: Option<String>,
}

enum TokenResponse {
    Pending,
    SlowDown,
    Success(TokenSuccess),
}

async fn request_device_code(client_id: &str) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{MICROSOFT_AUTHORITY}/oauth2/v2.0/devicecode");
    let scope = microsoft_scope_string();
    let resp = client
        .post(url)
        .form(&[("client_id", client_id), ("scope", scope.as_str())])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if let Ok(err) = serde_json::from_str::<TokenError>(&text) {
            return Err(err.error_description.unwrap_or(err.error));
        }
        return Err(format!("Microsoft devicecode HTTP {status}: {text}"));
    }
    resp.json::<DeviceCodeResponse>()
        .await
        .map_err(|e| e.to_string())
}

async fn poll_token(client_id: &str, device_code: &str) -> Result<TokenResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{MICROSOFT_AUTHORITY}/oauth2/v2.0/token");
    let resp = client
        .post(url)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", client_id),
            ("device_code", device_code),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if status.is_success() {
        let ok = serde_json::from_str::<TokenSuccess>(&text).map_err(|e| e.to_string())?;
        return Ok(TokenResponse::Success(ok));
    }

    let err = serde_json::from_str::<TokenError>(&text).map_err(|e| e.to_string())?;
    match err.error.as_str() {
        "authorization_pending" => Ok(TokenResponse::Pending),
        "slow_down" => Ok(TokenResponse::SlowDown),
        "expired_token" => Err("Login expired".to_string()),
        _ => Err(err.error_description.unwrap_or(err.error)),
    }
}

async fn exchange_authorization_code(
    client_id: &str,
    code: &str,
    code_verifier: &str,
) -> Result<TokenSuccess, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{MICROSOFT_AUTHORITY}/oauth2/v2.0/token");
    let scope = microsoft_scope_string();
    let resp = client
        .post(url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", MICROSOFT_REDIRECT_URI),
            ("code_verifier", code_verifier),
            ("scope", scope.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        return serde_json::from_str::<TokenSuccess>(&text).map_err(|e| e.to_string());
    }
    if let Ok(err) = serde_json::from_str::<TokenError>(&text) {
        return Err(err.error_description.unwrap_or(err.error));
    }
    Err(format!("Microsoft token HTTP {status}: {text}"))
}

async fn refresh_msa_token(client_id: &str, refresh_token: &str) -> Result<TokenSuccess, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{MICROSOFT_AUTHORITY}/oauth2/v2.0/token");
    let scope = microsoft_scope_string();
    let resp = client
        .post(url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("scope", scope.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Microsoft refresh failed: {}", text));
    }
    resp.json::<TokenSuccess>().await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct XblAuthResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: XblDisplayClaims,
}

#[derive(Deserialize)]
struct XblDisplayClaims {
    xui: Vec<XblXui>,
}

#[derive(Deserialize)]
struct XblXui {
    uhs: String,
}

async fn xbox_live_authenticate(msa_access_token: &str) -> Result<(String, String), String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://user.auth.xboxlive.com/user/authenticate";
    let body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", msa_access_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let resp = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("XBL auth HTTP {}", resp.status()));
    }
    let parsed = resp
        .json::<XblAuthResponse>()
        .await
        .map_err(|e| e.to_string())?;
    let uhs = parsed
        .display_claims
        .xui
        .first()
        .ok_or("Missing uhs".to_string())?
        .uhs
        .clone();
    Ok((parsed.token, uhs))
}

async fn xsts_authorize(xbl_token: &str) -> Result<(String, String), String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://xsts.auth.xboxlive.com/xsts/authorize";
    let body = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl_token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });

    let resp = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("XSTS HTTP {}", resp.status()));
    }
    let parsed = resp
        .json::<XblAuthResponse>()
        .await
        .map_err(|e| e.to_string())?;
    let uhs = parsed
        .display_claims
        .xui
        .first()
        .ok_or("Missing uhs".to_string())?
        .uhs
        .clone();
    Ok((parsed.token, uhs))
}

#[derive(Deserialize)]
struct MinecraftLoginResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct MinecraftErrorResponse {
    #[serde(default)]
    error: Option<String>,
    #[serde(default, rename = "errorMessage")]
    error_message: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

fn compact_error_body(text: &str) -> String {
    let trimmed = text.trim();
    let mut shortened = trimmed.chars().take(600).collect::<String>();
    if shortened.len() < trimmed.len() {
        shortened.push_str("...");
        shortened
    } else {
        trimmed.to_string()
    }
}

fn minecraft_service_error(context: &str, status: reqwest::StatusCode, text: &str) -> String {
    let parsed = serde_json::from_str::<MinecraftErrorResponse>(text).ok();
    let detail = parsed
        .as_ref()
        .and_then(|error| error.error_message.as_deref().or(error.error.as_deref()))
        .filter(|message| !message.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| compact_error_body(text));

    let path = parsed
        .and_then(|error| error.path)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| context.to_string());

    if status == reqwest::StatusCode::FORBIDDEN
        && detail
            .to_ascii_lowercase()
            .contains("invalid app registration")
    {
        return format!(
            "Minecraft Services refused this Microsoft App ID. Submit the Azure Application ID for Minecraft API access: https://aka.ms/mce-reviewappid. Server detail: {detail}"
        );
    }

    if detail.is_empty() {
        format!("Minecraft {path} HTTP {status}")
    } else {
        format!("Minecraft {path} HTTP {status}: {detail}")
    }
}

async fn minecraft_login_with_xbox(
    uhs: &str,
    xsts_token: &str,
) -> Result<(String, DateTime<Utc>), String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://api.minecraftservices.com/authentication/login_with_xbox";
    let identity_token = format!("XBL3.0 x={};{}", uhs, xsts_token);
    let resp = client
        .post(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&serde_json::json!({ "identityToken": identity_token }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(minecraft_service_error(
            "/authentication/login_with_xbox",
            status,
            &text,
        ));
    }
    let parsed = resp
        .json::<MinecraftLoginResponse>()
        .await
        .map_err(|e| e.to_string())?;
    Ok((parsed.access_token, now_plus_seconds(parsed.expires_in)))
}

#[derive(Deserialize)]
struct MinecraftProfile {
    id: String,
    name: String,
    #[serde(default)]
    skins: Vec<MinecraftSkin>,
}

#[derive(Deserialize)]
struct MinecraftSkin {
    url: String,
    #[serde(rename = "variant")]
    _variant: Option<String>,
}

async fn minecraft_get_profile(mc_access_token: &str) -> Result<MinecraftAccount, String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://api.minecraftservices.com/minecraft/profile";
    let resp = client
        .get(url)
        .bearer_auth(mc_access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Minecraft account not found (game not owned?)".to_string());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(minecraft_service_error("/minecraft/profile", status, &text));
    }
    let prof = resp
        .json::<MinecraftProfile>()
        .await
        .map_err(|e| e.to_string())?;
    let uuid = prof.id;
    let skin_url = prof.skins.first().map(|skin| skin.url.clone());
    let skin_head_url = Some(skin_head_url_for(&uuid));
    Ok(MinecraftAccount {
        uuid,
        username: prof.name,
        skin_url,
        skin_head_url,
    })
}

async fn exchange_for_minecraft(
    _app_data_dir: PathBuf,
    msa: &TokenSuccess,
) -> Result<MinecraftAuthState, String> {
    let msa_access = msa.access_token.clone();
    let msa_expires = now_plus_seconds(msa.expires_in).to_rfc3339();
    let msa_refresh = msa
        .refresh_token
        .clone()
        .ok_or("No refresh token received".to_string())?;

    let (xbl_token, _uhs) = xbox_live_authenticate(&msa_access).await?;
    let (xsts_token, uhs) = xsts_authorize(&xbl_token).await?;
    let (mc_token, mc_expires_at) = minecraft_login_with_xbox(&uhs, &xsts_token).await?;
    let account = minecraft_get_profile(&mc_token).await?;

    Ok(MinecraftAuthState {
        account,
        mc_access_token: mc_token,
        mc_expires_at: mc_expires_at.to_rfc3339(),
        msa_refresh_token: msa_refresh,
        msa_access_token: msa_access,
        msa_expires_at: msa_expires,
    })
}

pub async fn ensure_valid_minecraft_token(
    app_data_dir: PathBuf,
    client_id: &str,
) -> Result<MinecraftAuthState, String> {
    let mut state = load_auth_state(&app_data_dir).ok_or("Not logged in".to_string())?;

    let msa_exp = parse_rfc3339(&state.msa_expires_at)?;
    if Utc::now() + Duration::seconds(60) > msa_exp {
        let refreshed = refresh_msa_token(client_id, &state.msa_refresh_token).await?;
        state.msa_access_token = refreshed.access_token;
        if let Some(r) = refreshed.refresh_token {
            state.msa_refresh_token = r;
        }
        state.msa_expires_at = now_plus_seconds(refreshed.expires_in).to_rfc3339();
        save_auth_state(&app_data_dir, &state)?;
    }

    let mc_exp = parse_rfc3339(&state.mc_expires_at)?;
    if Utc::now() + Duration::seconds(60) > mc_exp {
        let (xbl_token, _uhs) = xbox_live_authenticate(&state.msa_access_token).await?;
        let (xsts_token, uhs) = xsts_authorize(&xbl_token).await?;
        let (mc_token, mc_expires_at) = minecraft_login_with_xbox(&uhs, &xsts_token).await?;
        state.mc_access_token = mc_token;
        state.mc_expires_at = mc_expires_at.to_rfc3339();
        state.account = minecraft_get_profile(&state.mc_access_token).await?;
        save_auth_state(&app_data_dir, &state)?;
    }

    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_callback_page_uses_the_launcher_palette() {
        let page = html_response(
            "Kiza Launcher login complete",
            "Your Microsoft Minecraft account is connected.",
        );

        // Every placeholder has to be substituted or the page shows its markers.
        assert!(!page.contains("__"), "unsubstituted placeholder in {page}");
        assert!(page.contains("Kiza Launcher login complete"));
        // Launcher violet and background, not the generic blue this page had.
        assert!(page.contains("#8b5cf6"));
        assert!(page.contains("#0b0a12"));
        assert!(!page.contains("#2563eb"));
        // The close button must say something when the browser refuses to close.
        assert!(page.contains("Close this tab yourself to finish"));
    }

    #[test]
    fn the_callback_page_escapes_what_it_is_given() {
        let page = html_response("Kiza Launcher login failed", "<script>alert(1)</script>");

        assert!(!page.contains("<script>alert(1)</script>"));
        assert!(page.contains("&lt;script&gt;"));
        assert!(page.contains("#fb7185"), "failures keep the red accent");
    }

    #[test]
    fn auth_store_round_trips_multi_kb_state_via_file() {
        let dir = tempfile::tempdir().unwrap();
        let state = MinecraftAuthState {
            account: MinecraftAccount {
                uuid: "11111111222233334444555555555555".to_string(),
                username: "Nefer".to_string(),
                skin_url: None,
                skin_head_url: Some("https://crafatar.com/avatars/x".to_string()),
            },
            mc_access_token: "t".repeat(3000),
            mc_expires_at: Utc::now().to_rfc3339(),
            msa_refresh_token: "r".repeat(2000),
            msa_access_token: "a".repeat(2000),
            msa_expires_at: Utc::now().to_rfc3339(),
        };

        save_auth_state(dir.path(), &state).expect("save must succeed");
        let loaded = load_auth_state(dir.path()).expect("state must load back");
        assert_eq!(loaded.account.username, "Nefer");
        assert_eq!(loaded.mc_access_token, state.mc_access_token);
        assert_eq!(list_accounts(dir.path()).len(), 1);

        logout(dir.path()).expect("logout must succeed");
        assert!(load_auth_state(dir.path()).is_none());
    }
}
