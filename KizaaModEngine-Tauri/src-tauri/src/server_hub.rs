//! Saved Minecraft servers, with live status.
//!
//! The wire format is Minecraft's own Server List Ping: a handshake announcing
//! we only want status, then a status request, then a JSON blob. Every piece of
//! that encoding is pure and tested here; only the socket itself is not.
//!
//! A saved server can be bound to an instance, so "join this server" knows
//! which mods it needs.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Minecraft's default port, used whenever the address omits one.
const DEFAULT_PORT: u16 = 25565;
/// Protocol number sent in the handshake. For a status ping any value works;
/// -1 is the conventional "I am just asking".
const STATUS_PROTOCOL: i32 = -1;
/// A status response is small; anything larger is not a Minecraft server.
const MAX_RESPONSE_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedServer {
    pub id: String,
    pub name: String,
    /// As typed by the user, e.g. `play.example.net` or `example.net:25566`.
    pub address: String,
    /// Instance this server should be played with, when the user bound one.
    #[serde(default)]
    pub instance_id: Option<String>,
    pub added_at: String,
    /// Last successful connection, for the history column.
    #[serde(default)]
    pub last_played_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerStatus {
    pub motd: String,
    pub players_online: u32,
    pub players_max: u32,
    pub version: String,
    pub latency_ms: u64,
    /// The server's own icon, as a `data:image/png;base64,…` URI, once it has
    /// been checked. None when the server sent none or sent something else.
    #[serde(default)]
    pub favicon: Option<String>,
}

/// One entry of a bulk refresh: either a status, or the reason there is none.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerPing {
    pub id: String,
    pub status: Option<ServerStatus>,
    pub error: Option<String>,
}

/// Splits `host:port`, defaulting to Minecraft's port.
///
/// IPv6 literals are bracketed (`[::1]:25565`), so a bare colon count is not
/// enough to decide where the port starts.
pub fn split_host_port(address: &str) -> Result<(String, u16), String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return Err("A server address is required.".to_string());
    }

    if let Some(rest) = trimmed.strip_prefix('[') {
        let (host, tail) = rest
            .split_once(']')
            .ok_or_else(|| "Unbalanced brackets in the address.".to_string())?;
        let port = match tail.strip_prefix(':') {
            Some(port) => port
                .parse()
                .map_err(|_| "The port is not a number.".to_string())?,
            None => DEFAULT_PORT,
        };
        return Ok((host.to_string(), port));
    }

    match trimmed.rsplit_once(':') {
        // More than one colon and no brackets: a bare IPv6 address.
        Some(_) if trimmed.matches(':').count() > 1 => Ok((trimmed.to_string(), DEFAULT_PORT)),
        Some((host, port)) => {
            let port = port
                .parse()
                .map_err(|_| "The port is not a number.".to_string())?;
            Ok((host.to_string(), port))
        }
        None => Ok((trimmed.to_string(), DEFAULT_PORT)),
    }
}

/// Minecraft's VarInt: seven bits per byte, high bit means "more follows".
pub fn write_varint(mut value: i32) -> Vec<u8> {
    let mut bytes = Vec::new();
    loop {
        let mut byte = (value & 0x7F) as u8;
        // Logical shift: a negative protocol number must not sign-extend
        // forever.
        value = ((value as u32) >> 7) as i32;
        if value != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if value == 0 {
            return bytes;
        }
    }
}

/// Reads a VarInt, advancing `cursor`. None when the bytes run out or the
/// value is longer than five bytes, which no valid VarInt is.
pub fn read_varint(bytes: &[u8], cursor: &mut usize) -> Option<i32> {
    let mut result: i32 = 0;
    for position in 0..5 {
        let byte = *bytes.get(*cursor)?;
        *cursor += 1;
        result |= ((byte & 0x7F) as i32) << (7 * position);
        if byte & 0x80 == 0 {
            return Some(result);
        }
    }
    None
}

fn write_string(value: &str) -> Vec<u8> {
    let mut bytes = write_varint(value.len() as i32);
    bytes.extend_from_slice(value.as_bytes());
    bytes
}

/// Wraps a payload in Minecraft's length-prefixed packet framing.
fn frame(payload: Vec<u8>) -> Vec<u8> {
    let mut packet = write_varint(payload.len() as i32);
    packet.extend(payload);
    packet
}

/// Handshake asking only for status (next state = 1).
pub fn build_handshake(host: &str, port: u16) -> Vec<u8> {
    let mut payload = write_varint(0x00);
    payload.extend(write_varint(STATUS_PROTOCOL));
    payload.extend(write_string(host));
    payload.extend_from_slice(&port.to_be_bytes());
    payload.extend(write_varint(1));
    frame(payload)
}

pub fn build_status_request() -> Vec<u8> {
    frame(write_varint(0x00))
}

/// Flattens Minecraft's chat component tree into plain text.
///
/// The MOTD is a string on old servers and a nested object on modern ones;
/// showing raw JSON to the player would be worse than showing nothing.
fn flatten_chat(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Object(map) => {
            let mut text = map
                .get("text")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            if let Some(extra) = map.get("extra").and_then(|value| value.as_array()) {
                for child in extra {
                    text.push_str(&flatten_chat(child));
                }
            }
            text
        }
        serde_json::Value::Array(items) => items.iter().map(flatten_chat).collect(),
        _ => String::new(),
    }
}

/// Strips Minecraft's section-sign colour codes.
fn strip_formatting(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(character) = chars.next() {
        if character == '§' {
            chars.next();
        } else {
            out.push(character);
        }
    }
    out
}

/// Checks a server-supplied icon before it is ever handed to the webview.
///
/// This value comes from a remote machine nobody vetted, and it ends up in an
/// `<img src>`. Minecraft's protocol says it is a 64×64 PNG as a data URI, so
/// anything else is dropped rather than displayed: an SVG data URI can carry
/// script, a `javascript:` URL is not an image at all, and an enormous payload
/// would be pushed through the bridge for nothing.
pub fn sanitise_favicon(value: Option<&str>) -> Option<String> {
    use base64::Engine as _;

    /// A 64×64 PNG is a couple of kilobytes; this is generous.
    const MAX_FAVICON_BYTES: usize = 128 * 1024;
    const PREFIX: &str = "data:image/png;base64,";
    const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    let value = value?.trim();
    if value.len() > MAX_FAVICON_BYTES {
        return None;
    }
    // Exact prefix, not "starts with data:image" — the media type is what the
    // webview trusts, so it has to be the one we expect.
    let payload = value.strip_prefix(PREFIX)?;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .ok()?;
    // The declared type must match the actual bytes.
    if !decoded.starts_with(&PNG_SIGNATURE) {
        return None;
    }

    Some(format!("{PREFIX}{}", payload.trim()))
}

pub fn parse_status_json(json: &str, latency_ms: u64) -> Result<ServerStatus, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|error| format!("Unreadable server status: {error}"))?;

    let motd = value
        .get("description")
        .map(flatten_chat)
        .unwrap_or_default();

    Ok(ServerStatus {
        motd: strip_formatting(motd.trim()),
        players_online: value
            .pointer("/players/online")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32,
        players_max: value
            .pointer("/players/max")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32,
        version: value
            .pointer("/version/name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string(),
        latency_ms,
        favicon: sanitise_favicon(value.get("favicon").and_then(|value| value.as_str())),
    })
}

/// Asks a server for its status over Minecraft's own protocol.
///
/// Everything before the socket is covered by the tests above; this function
/// only sequences it and enforces the timeout, because an unreachable host
/// would otherwise hang the whole list.
pub async fn ping(address: &str, timeout: std::time::Duration) -> Result<ServerStatus, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (host, port) = split_host_port(address)?;
    let started = std::time::Instant::now();

    let result = tokio::time::timeout(timeout, async {
        let mut stream = tokio::net::TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|error| format!("Could not reach {host}:{port}: {error}"))?;

        stream
            .write_all(&build_handshake(&host, port))
            .await
            .map_err(|error| error.to_string())?;
        stream
            .write_all(&build_status_request())
            .await
            .map_err(|error| error.to_string())?;

        // The reply is length-prefixed, so read enough to decode the header
        // before trusting any size it claims.
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let read = stream
                .read(&mut chunk)
                .await
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if buffer.len() > MAX_RESPONSE_BYTES {
                return Err("The server sent an implausibly large status.".to_string());
            }

            let mut cursor = 0;
            let Some(packet_len) = read_varint(&buffer, &mut cursor) else {
                continue;
            };
            if buffer.len() >= cursor + packet_len as usize {
                break;
            }
        }

        let mut cursor = 0;
        read_varint(&buffer, &mut cursor).ok_or("Truncated response.")?;
        let packet_id = read_varint(&buffer, &mut cursor).ok_or("Truncated response.")?;
        if packet_id != 0x00 {
            return Err(format!("Unexpected packet {packet_id} from the server."));
        }
        let json_len = read_varint(&buffer, &mut cursor).ok_or("Truncated response.")? as usize;
        let json = buffer
            .get(cursor..cursor + json_len)
            .ok_or("The server status was cut short.")?;

        std::str::from_utf8(json)
            .map_err(|_| "The server status is not valid UTF-8.".to_string())
            .map(str::to_string)
    })
    .await
    .map_err(|_| format!("{address} did not answer in time."))??;

    parse_status_json(&result, started.elapsed().as_millis() as u64)
}

/// Pings every saved server at once.
///
/// One at a time, a list of ten servers with two dead ones would take the whole
/// timeout twice before showing anything. In parallel the slowest server sets
/// the wait, and each entry carries either a status or the reason it has none —
/// a server that is down is a fact worth showing, not an error to swallow.
pub async fn ping_all(servers: &[SavedServer], timeout: std::time::Duration) -> Vec<ServerPing> {
    let pings = servers.iter().map(|server| async move {
        match ping(&server.address, timeout).await {
            Ok(status) => ServerPing {
                id: server.id.clone(),
                status: Some(status),
                error: None,
            },
            Err(error) => ServerPing {
                id: server.id.clone(),
                status: None,
                error: Some(error),
            },
        }
    });
    futures::future::join_all(pings).await
}

// ---- kiza://join links ---------------------------------------------------

/// Decodes `%XX` escapes. Anything malformed is left as written rather than
/// guessed at, so a broken link fails the address check below instead of
/// turning into a different address.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Reads a `kiza://join/<address>` link.
///
/// **A link is a suggestion, never a command.** Any web page can hand one of
/// these to the launcher, so this only ever produces an address to *offer*:
/// nothing that arrives from the internet starts a game by itself. The launcher
/// opens the server list with the address filled in, and the player clicks.
///
/// The address is validated here so a malformed or hostile link is refused at
/// the door rather than stored and pinged later.
pub fn parse_join_link(url: &str) -> Result<String, String> {
    let rest = url
        .trim()
        .strip_prefix("kiza://")
        .ok_or_else(|| "Not a Kiza link.".to_string())?;

    let (action, argument) = rest
        .split_once('/')
        .ok_or_else(|| "That Kiza link says nothing to do.".to_string())?;
    if !action.eq_ignore_ascii_case("join") {
        return Err(format!("Kiza does not know the link action \"{action}\"."));
    }

    // A query string or fragment is not part of an address; dropping them
    // silently would ping something other than what the link named.
    let address = argument
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/');
    let address = percent_decode(address);

    if address.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("That link's address contains characters an address cannot have.".to_string());
    }
    // The real check: it has to parse as a host and port.
    split_host_port(&address)?;
    Ok(address)
}

// ---- storage -------------------------------------------------------------

fn store_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config").join("servers.json")
}

pub fn list(app_data_dir: &Path) -> Vec<SavedServer> {
    fs::read_to_string(store_path(app_data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(app_data_dir: &Path, servers: &[SavedServer]) -> Result<(), String> {
    let path = store_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(servers).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| format!("Could not save the server list: {error}"))
}

pub fn add(
    app_data_dir: &Path,
    name: &str,
    address: &str,
    instance_id: Option<String>,
) -> Result<SavedServer, String> {
    // Reject an unusable address here rather than at ping time.
    split_host_port(address)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("A server name is required.".to_string());
    }

    let mut servers = list(app_data_dir);
    let server = SavedServer {
        id: Uuid::new_v4().simple().to_string(),
        name: name.to_string(),
        address: address.trim().to_string(),
        instance_id,
        added_at: chrono::Utc::now().to_rfc3339(),
        last_played_at: None,
    };
    servers.push(server.clone());
    save(app_data_dir, &servers)?;
    Ok(server)
}

/// Adds the entries of a `servers.dat` that are not already saved.
///
/// Addresses are compared, not names: the same server saved twice under two
/// names is still one server, and re-importing after playing must not fill the
/// list with duplicates. Entries whose address Kiza cannot parse are counted as
/// skipped rather than saved as something that will never ping.
pub fn import_entries(
    app_data_dir: &Path,
    entries: &[crate::nbt::ServerEntry],
    instance_id: Option<String>,
) -> Result<(Vec<SavedServer>, usize), String> {
    let mut servers = list(app_data_dir);
    let mut added = Vec::new();
    let mut skipped = 0usize;

    for entry in entries {
        let already_saved = servers
            .iter()
            .any(|server| server.address.eq_ignore_ascii_case(&entry.address));
        if already_saved || split_host_port(&entry.address).is_err() {
            skipped += 1;
            continue;
        }

        let server = SavedServer {
            id: Uuid::new_v4().simple().to_string(),
            name: entry.name.clone(),
            address: entry.address.clone(),
            instance_id: instance_id.clone(),
            added_at: chrono::Utc::now().to_rfc3339(),
            last_played_at: None,
        };
        servers.push(server.clone());
        added.push(server);
    }

    if !added.is_empty() {
        save(app_data_dir, &servers)?;
    }
    Ok((added, skipped))
}

pub fn remove(app_data_dir: &Path, id: &str) -> Result<Vec<SavedServer>, String> {
    let mut servers = list(app_data_dir);
    servers.retain(|server| server.id != id);
    save(app_data_dir, &servers)?;
    Ok(servers)
}

/// Binds (or unbinds) the instance a server should be played with.
pub fn set_instance(
    app_data_dir: &Path,
    id: &str,
    instance_id: Option<String>,
) -> Result<SavedServer, String> {
    let mut servers = list(app_data_dir);
    let server = servers
        .iter_mut()
        .find(|server| server.id == id)
        .ok_or_else(|| "That server is no longer saved.".to_string())?;
    server.instance_id = instance_id;
    let updated = server.clone();
    save(app_data_dir, &servers)?;
    Ok(updated)
}

pub fn mark_played(app_data_dir: &Path, id: &str) -> Result<(), String> {
    let mut servers = list(app_data_dir);
    if let Some(server) = servers.iter_mut().find(|server| server.id == id) {
        server.last_played_at = Some(chrono::Utc::now().to_rfc3339());
    }
    save(app_data_dir, &servers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_default_to_the_minecraft_port() {
        assert_eq!(
            split_host_port("play.example.net").unwrap(),
            ("play.example.net".to_string(), 25565)
        );
        assert_eq!(
            split_host_port(" example.net:25566 ").unwrap(),
            ("example.net".to_string(), 25566)
        );
        // A bare IPv6 address has colons but no port.
        assert_eq!(split_host_port("::1").unwrap(), ("::1".to_string(), 25565));
        // Bracketed IPv6 does carry one.
        assert_eq!(
            split_host_port("[::1]:25566").unwrap(),
            ("::1".to_string(), 25566)
        );
        assert!(split_host_port("example.net:not-a-port").is_err());
        assert!(split_host_port("   ").is_err());
    }

    #[test]
    fn varints_round_trip_including_negative_values() {
        for value in [
            0,
            1,
            127,
            128,
            255,
            2_097_151,
            i32::MAX,
            -1,
            STATUS_PROTOCOL,
        ] {
            let encoded = write_varint(value);
            let mut cursor = 0;
            assert_eq!(read_varint(&encoded, &mut cursor), Some(value), "{value}");
            assert_eq!(cursor, encoded.len());
        }
        // -1 must not sign-extend into an endless stream of bytes.
        assert_eq!(write_varint(-1).len(), 5);
    }

    #[test]
    fn a_truncated_varint_is_rejected_rather_than_guessed() {
        let mut cursor = 0;
        assert_eq!(read_varint(&[0x80], &mut cursor), None);
        // Six continuation bytes is not a valid VarInt.
        let mut cursor = 0;
        assert_eq!(read_varint(&[0x80; 6], &mut cursor), None);
    }

    #[test]
    fn the_handshake_announces_a_status_request() {
        let packet = build_handshake("play.example.net", 25565);

        let mut cursor = 0;
        let length = read_varint(&packet, &mut cursor).unwrap() as usize;
        assert_eq!(
            length,
            packet.len() - cursor,
            "length prefix covers the body"
        );
        assert_eq!(read_varint(&packet, &mut cursor), Some(0x00), "packet id");
        assert_eq!(read_varint(&packet, &mut cursor), Some(STATUS_PROTOCOL));

        let host_len = read_varint(&packet, &mut cursor).unwrap() as usize;
        let host = std::str::from_utf8(&packet[cursor..cursor + host_len]).unwrap();
        assert_eq!(host, "play.example.net");
        cursor += host_len;

        assert_eq!(&packet[cursor..cursor + 2], &25565u16.to_be_bytes());
        cursor += 2;
        // Next state 1 = status. Sending 2 would try to actually log in.
        assert_eq!(read_varint(&packet, &mut cursor), Some(1));
    }

    #[test]
    fn a_modern_motd_object_becomes_plain_text() {
        let json = r#"{
            "version": {"name": "1.21.1", "protocol": 767},
            "players": {"online": 42, "max": 100},
            "description": {"text": "§aKiza ", "extra": [{"text": "§bNetwork"}]}
        }"#;

        let status = parse_status_json(json, 31).unwrap();
        // Colour codes would render as raw section signs in the launcher.
        assert_eq!(status.motd, "Kiza Network");
        assert_eq!(status.players_online, 42);
        assert_eq!(status.players_max, 100);
        assert_eq!(status.version, "1.21.1");
        assert_eq!(status.latency_ms, 31);
    }

    #[test]
    fn an_old_string_motd_still_works() {
        let json = r#"{"version":{"name":"1.8.9"},"players":{"online":3,"max":20},"description":"A Minecraft Server"}"#;

        let status = parse_status_json(json, 12).unwrap();
        assert_eq!(status.motd, "A Minecraft Server");
        assert_eq!(status.version, "1.8.9");
    }

    #[test]
    fn missing_fields_fall_back_instead_of_failing() {
        // Some proxies answer with almost nothing; a server that responds at
        // all is still online.
        let status = parse_status_json("{}", 5).unwrap();
        assert_eq!(status.players_online, 0);
        assert_eq!(status.version, "unknown");
        assert!(status.motd.is_empty());

        assert!(parse_status_json("not json", 5).is_err());
    }

    /// The smallest valid PNG: signature plus an IHDR header.
    fn png_data_uri() -> String {
        use base64::Engine as _;
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(&[0, 0, 0, 13]);
        bytes.extend_from_slice(b"IHDR");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        )
    }

    #[test]
    fn a_real_server_icon_is_kept() {
        let uri = png_data_uri();
        let json =
            format!(r#"{{"players":{{"online":1,"max":2}},"description":"hi","favicon":"{uri}"}}"#);

        let status = parse_status_json(&json, 10).unwrap();
        assert_eq!(status.favicon.as_deref(), Some(uri.as_str()));
    }

    #[test]
    fn anything_that_is_not_a_png_icon_is_dropped() {
        // This value comes from a remote machine and lands in an <img src>.
        // An SVG data URI can carry script.
        assert_eq!(
            sanitise_favicon(Some(
                "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"
            )),
            None
        );
        assert_eq!(sanitise_favicon(Some("javascript:alert(1)")), None);
        // The declared type must match the actual bytes.
        assert_eq!(
            sanitise_favicon(Some("data:image/png;base64,bm90IGEgcG5n")),
            None
        );
        assert_eq!(sanitise_favicon(Some("data:image/png;base64,%%%")), None);
        assert_eq!(sanitise_favicon(None), None);

        // A payload far larger than any 64×64 PNG is refused before decoding.
        let huge = format!("data:image/png;base64,{}", "A".repeat(200_000));
        assert_eq!(sanitise_favicon(Some(&huge)), None);
    }

    #[test]
    fn a_server_without_an_icon_is_still_a_server() {
        let status = parse_status_json(r#"{"description":"hi"}"#, 5).unwrap();
        assert_eq!(status.favicon, None);
    }

    #[tokio::test]
    async fn a_bulk_refresh_reports_a_dead_server_instead_of_failing() {
        let servers = vec![SavedServer {
            id: "a".to_string(),
            name: "Dead".to_string(),
            // Reserved for documentation, so nothing answers here.
            address: "192.0.2.1:25565".to_string(),
            instance_id: None,
            added_at: String::new(),
            last_played_at: None,
        }];

        let results = ping_all(&servers, std::time::Duration::from_millis(200)).await;

        // A server that is down is a fact to show, not an error that hides the
        // rest of the list.
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "a");
        assert!(results[0].status.is_none());
        assert!(results[0].error.is_some());
    }

    #[test]
    fn importing_twice_does_not_duplicate_the_list() {
        use crate::nbt::ServerEntry;

        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let entries = vec![
            ServerEntry {
                name: "Hypixel".to_string(),
                address: "mc.hypixel.net".to_string(),
            },
            ServerEntry {
                name: "Local".to_string(),
                address: "example.net:25566".to_string(),
            },
            ServerEntry {
                name: "Broken".to_string(),
                address: "example.net:not-a-port".to_string(),
            },
        ];

        let (added, skipped) = import_entries(root, &entries, None).unwrap();
        assert_eq!(added.len(), 2);
        // An address that cannot be parsed would never ping.
        assert_eq!(skipped, 1);

        // Re-importing after a session of play is a normal thing to do.
        let (added_again, skipped_again) = import_entries(root, &entries, None).unwrap();
        assert!(added_again.is_empty());
        assert_eq!(skipped_again, 3);
        assert_eq!(list(root).len(), 2);
    }

    #[test]
    fn a_server_renamed_in_kiza_is_still_recognised_on_reimport() {
        use crate::nbt::ServerEntry;

        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        add(root, "My favourite", "mc.hypixel.net", None).unwrap();

        let (added, _) = import_entries(
            root,
            &[ServerEntry {
                name: "Hypixel".to_string(),
                address: "MC.HYPIXEL.NET".to_string(),
            }],
            None,
        )
        .unwrap();

        // Same server, different name and different case: still one server.
        assert!(added.is_empty());
        assert_eq!(list(root).len(), 1);
        assert_eq!(list(root)[0].name, "My favourite");
    }

    #[test]
    fn a_join_link_yields_the_address_it_names() {
        assert_eq!(
            parse_join_link("kiza://join/play.example.net").unwrap(),
            "play.example.net"
        );
        assert_eq!(
            parse_join_link("kiza://join/example.net:25566").unwrap(),
            "example.net:25566"
        );
        // A trailing slash, a query string and a fragment are not part of an
        // address; keeping them would ping something the link did not name.
        assert_eq!(
            parse_join_link("kiza://join/play.example.net/?ref=twitter#top").unwrap(),
            "play.example.net"
        );
        // Percent-encoded brackets around an IPv6 literal.
        assert_eq!(
            parse_join_link("kiza://join/%5B::1%5D:25566").unwrap(),
            "[::1]:25566"
        );
    }

    #[test]
    fn a_hostile_or_broken_link_is_refused_at_the_door() {
        // Anyone's web page can hand the launcher one of these.
        assert!(parse_join_link("https://example.net/join/evil").is_err());
        assert!(parse_join_link("kiza://delete-everything/now").is_err());
        assert!(parse_join_link("kiza://join").is_err());
        assert!(parse_join_link("kiza://join/").is_err());
        assert!(parse_join_link("kiza://join/example.net:not-a-port").is_err());
        // A newline could split a line in anything that later logs the address.
        assert!(parse_join_link("kiza://join/example.net%0Aevil").is_err());
        assert!(parse_join_link("kiza://join/example.net evil").is_err());
    }

    #[test]
    fn servers_round_trip_and_reject_bad_input() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();

        let server = add(root, "Kiza Network", "play.example.net", None).unwrap();
        assert_eq!(list(root).len(), 1);

        // Binding an instance is what lets "join" know which mods to use.
        let bound = set_instance(root, &server.id, Some("instance-a".to_string())).unwrap();
        assert_eq!(bound.instance_id.as_deref(), Some("instance-a"));

        assert!(add(root, "", "play.example.net", None).is_err());
        assert!(add(root, "Broken", "example.net:port", None).is_err());

        assert!(remove(root, &server.id).unwrap().is_empty());
    }
}
