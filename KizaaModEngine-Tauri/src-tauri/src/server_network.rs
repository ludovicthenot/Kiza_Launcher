//! How a hosted server is reached from outside this machine.
//!
//! Three addresses, in widening circles: this computer, the network, the
//! internet. The first two the launcher knows by itself. The third means
//! asking the router to forward the port — UPnP, when the router allows
//! it — and asking the internet what address this connection has.
//!
//! Nothing here happens on its own. The port is opened when the user presses
//! the button, closed when they press the other one or when the server that
//! used it stops, and the router is never asked to keep anything Kiza did not
//! ask for. A router that refuses is reported as refusing, with the manual
//! way out spelled beside it; the mapping is never pretended.

use igd_next::aio::tokio::Tokio;
use igd_next::{PortMappingProtocol, SearchOptions};
use serde::Serialize;
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;

/// The ports Kiza opened on the router, to close again when their server
/// stops and to report honestly as "opened by Kiza".
static OPENED: Mutex<Option<HashSet<u16>>> = Mutex::new(None);

fn opened() -> std::sync::MutexGuard<'static, Option<HashSet<u16>>> {
    let mut guard = OPENED.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_none() {
        *guard = Some(HashSet::new());
    }
    guard
}

pub fn was_opened_by_kiza(port: u16) -> bool {
    opened().as_ref().is_some_and(|set| set.contains(&port))
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct Reachability {
    pub port: u16,
    pub local_address: String,
    pub lan_address: Option<String>,
    /// What the internet sees this connection as, with the port.
    pub public_address: Option<String>,
    /// Whether a UPnP gateway answered at all.
    pub upnp_available: bool,
    /// Whether the router currently forwards this port to this machine.
    pub forwarded: bool,
    pub opened_by_kiza: bool,
    /// The router's own idea of the external address, when it has one.
    pub router_external_ip: Option<String>,
    pub error: Option<String>,
}

const UPNP_TIMEOUT: Duration = Duration::from_secs(4);
const PUBLIC_IP_TIMEOUT: Duration = Duration::from_secs(4);

async fn gateway() -> Result<igd_next::aio::Gateway<Tokio>, String> {
    let options = SearchOptions {
        timeout: Some(UPNP_TIMEOUT),
        single_search_timeout: Some(Duration::from_secs(2)),
        ..Default::default()
    };
    tokio::time::timeout(UPNP_TIMEOUT + Duration::from_secs(1), igd_next::aio::tokio::search_gateway(options))
        .await
        .map_err(|_| "No UPnP router answered.".to_string())?
        .map_err(|error| format!("No UPnP router answered: {error}"))
}

/// The address the internet sees, asked of a public echo service. A
/// request this machine makes anyway the moment it opens a browser; the
/// answer is an address and nothing else.
pub async fn public_ip() -> Option<IpAddr> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .timeout(PUBLIC_IP_TIMEOUT)
        .build()
        .ok()?;
    for url in ["https://api.ipify.org", "https://ipv4.icanhazip.com"] {
        if let Ok(response) = client.get(url).send().await {
            if let Ok(text) = response.text().await {
                if let Ok(ip) = text.trim().parse::<IpAddr>() {
                    return Some(ip);
                }
            }
        }
    }
    None
}

/// Whether the router forwards `port` (TCP) to `lan_ip`, read from its own
/// mapping table. Routers list at most a few dozen; sixty-four is a cap,
/// not a claim.
async fn is_forwarded(gateway: &igd_next::aio::Gateway<Tokio>, port: u16, lan_ip: &str) -> bool {
    for index in 0..64u32 {
        match gateway.get_generic_port_mapping_entry(index).await {
            Ok(entry) => {
                if entry.external_port == port
                    && entry.protocol == PortMappingProtocol::TCP
                    && entry.internal_client == lan_ip
                {
                    return true;
                }
            }
            Err(_) => return false,
        }
    }
    false
}

/// Everything the Overview shows under "Join from".
pub async fn reachability(port: u16, with_public: bool) -> Reachability {
    let lan_ip = crate::server_process::lan_address();
    let mut out = Reachability {
        port,
        local_address: format!("localhost:{port}"),
        lan_address: lan_ip.as_ref().map(|ip| format!("{ip}:{port}")),
        opened_by_kiza: was_opened_by_kiza(port),
        ..Default::default()
    };
    if !with_public {
        return out;
    }
    let (gateway, public) = tokio::join!(gateway(), public_ip());
    out.public_address = public.map(|ip| format!("{ip}:{port}"));
    match gateway {
        Ok(gateway) => {
            out.upnp_available = true;
            out.router_external_ip = gateway.get_external_ip().await.ok().map(|ip| ip.to_string());
            if let Some(lan_ip) = lan_ip.as_deref() {
                out.forwarded = is_forwarded(&gateway, port, lan_ip).await;
            }
        }
        Err(error) => out.error = Some(error),
    }
    out
}

/// Asks the router to forward `port` to this machine, for as long as the
/// router keeps it (lease 0 — closed again by `close_port`).
pub async fn open_port(port: u16) -> Result<Reachability, String> {
    let lan_ip: IpAddr = crate::server_process::lan_address()
        .ok_or_else(|| "This machine has no network address to forward to.".to_string())?
        .parse()
        .map_err(|_| "This machine's network address could not be read.".to_string())?;
    let gateway = gateway().await?;
    gateway
        .add_port(
            PortMappingProtocol::TCP,
            port,
            SocketAddr::new(lan_ip, port),
            0,
            "Kiza Launcher - Minecraft server",
        )
        .await
        .map_err(|error| format!("The router refused to forward port {port}: {error}"))?;
    if let Some(set) = opened().as_mut() {
        set.insert(port);
    }
    Ok(reachability(port, true).await)
}

pub async fn close_port(port: u16) -> Result<(), String> {
    let gateway = gateway().await?;
    let result = gateway
        .remove_port(PortMappingProtocol::TCP, port)
        .await
        .map_err(|error| format!("The router did not remove the forward for port {port}: {error}"));
    if let Some(set) = opened().as_mut() {
        set.remove(&port);
    }
    result
}

/// A name for the server, from Kiza's own service: `<name>.<zone>`, pointed
/// at whatever address this machine has when it asks. Asked again on every
/// start, so a connection whose address changed overnight is followed.
#[derive(Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct KizaAddress {
    pub name: String,
    pub address: String,
    pub ip: String,
    pub port: u16,
}

#[derive(serde::Deserialize)]
struct ClaimAnswer {
    address: String,
    ip: String,
    port: u16,
}

#[derive(serde::Deserialize)]
struct ServiceError {
    error: String,
}

/// The name a server is offered by default: its own, made DNS-safe.
pub fn suggested_name(label: &str) -> String {
    let slug = crate::server_host::slug(label);
    let slug: String = slug.chars().take(32).collect();
    let slug = slug.trim_end_matches('-').to_string();
    if slug.len() >= 3 {
        slug
    } else {
        format!("{slug}-server").trim_start_matches('-').to_string()
    }
}

/// Asks the service for `<name>.<zone>` on this connection's address.
pub async fn claim_kiza_address(
    origin: &str,
    headers: Vec<(String, String)>,
    name: &str,
    port: u16,
) -> Result<KizaAddress, String> {
    if headers.iter().all(|(key, _)| key != "Authorization") {
        return Err("Sign in to Kiza (Settings → Account) to get an address.".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client
        .post(format!("{origin}/v1/play/claim"))
        .json(&serde_json::json!({ "name": name, "port": port }));
    for (key, value) in headers {
        request = request.header(key, value);
    }
    let response = request.send().await.map_err(|e| format!("Kiza's service could not be reached: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response
            .json::<ServiceError>()
            .await
            .map(|e| e.error)
            .unwrap_or_else(|_| format!("HTTP {status}"));
        return Err(message);
    }
    let answer: ClaimAnswer = response.json().await.map_err(|e| e.to_string())?;
    Ok(KizaAddress {
        name: name.to_string(),
        address: answer.address,
        ip: answer.ip,
        port: answer.port,
    })
}

/// The server stopped: the name stays owned but points at nothing, so the
/// address is public only while there is something to join at it.
pub async fn park_kiza_address(origin: &str, headers: Vec<(String, String)>, name: &str) -> Result<(), String> {
    post_name(origin, headers, "park", name).await
}

pub async fn release_kiza_address(origin: &str, headers: Vec<(String, String)>, name: &str) -> Result<(), String> {
    post_name(origin, headers, "release", name).await
}

async fn post_name(origin: &str, headers: Vec<(String, String)>, action: &str, name: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("KizaLauncherAlpha/0.1")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client
        .post(format!("{origin}/v1/play/{action}"))
        .json(&serde_json::json!({ "name": name }));
    for (key, value) in headers {
        request = request.header(key, value);
    }
    let response = request.send().await.map_err(|e| format!("Kiza's service could not be reached: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let message = response
            .json::<ServiceError>()
            .await
            .map(|e| e.error)
            .unwrap_or_else(|_| format!("HTTP {status}"));
        return Err(message);
    }
    Ok(())
}

/// Closes a port Kiza opened, when its server has stopped. Quiet on
/// failure: the server is already down and there is nobody to tell.
pub async fn close_if_opened(port: u16) {
    if was_opened_by_kiza(port) {
        let _ = close_port(port).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_server_name_becomes_a_dns_label() {
        assert_eq!(suggested_name("Survie des potes"), "survie-des-potes");
        assert_eq!(suggested_name("Ab"), "ab-server");
        assert_eq!(suggested_name("!!!"), "server");
        assert!(suggested_name("a very long server name that goes on and on and on forever").len() <= 32);
    }

    #[test]
    fn a_port_is_only_ever_reported_as_opened_by_kiza_when_it_was() {
        assert!(!was_opened_by_kiza(25599));
        opened().as_mut().unwrap().insert(25599);
        assert!(was_opened_by_kiza(25599));
        opened().as_mut().unwrap().remove(&25599);
        assert!(!was_opened_by_kiza(25599));
    }
}
