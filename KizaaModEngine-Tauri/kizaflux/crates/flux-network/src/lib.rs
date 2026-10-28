//! Flux Network: whether Kizaflux's engine can join a server, asked before
//! the game starts.
//!
//! The engine speaks the network itself (Horizon implements Minecraft's
//! protocol 777, 26.3's); Kizaflux does not stand in the middle of a game's
//! connection. What the launcher needs is an answer before pressing Play: is
//! this server the version the engine is, and does it expect mods on the
//! client the engine cannot run? That is what a server list ping tells, the
//! same request the multiplayer screen sends, and nothing more:
//!
//! - it does not log in, so it says nothing of authentication, anti-cheat or
//!   whether the world plays correctly: [`Verdict::ProtocolMatches`] means
//!   the versions agree, not that everything on the server works;
//! - a proxy that accepts several versions (ViaVersion and the like) answers
//!   with whatever version it is asked about; [`probe`] asks twice to tell.
//!
//! `docs/compatibility.md` keeps what has actually been played, per server.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// A protocol number for each Minecraft version an engine of Kizaflux
/// plays. Horizon is 26.3 (horizon-protocol: "version 777").
pub fn protocol_of(minecraft: &str) -> Option<i32> {
    match minecraft {
        "26.3" => Some(777),
        "26.2" => Some(776),
        _ => None,
    }
}

/// What a server's status answer says about it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ServerStatus {
    pub version_name: String,
    pub protocol: i32,
    pub players_online: Option<i64>,
    pub players_max: Option<i64>,
    /// Mods the server says a client must have (Forge's `forgeData` or
    /// `modinfo`), without the loader's own entries.
    pub required_mods: Vec<String>,
    /// The server says it is modded (Forge, NeoForge) even with no list.
    pub modded: bool,
    pub enforces_secure_chat: Option<bool>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum Verdict {
    /// The server is the engine's version and asks for no client mods. Not a
    /// promise that every feature works: nothing was played.
    ProtocolMatches,
    /// It accepts several versions; joining may work and is not verified.
    MultiVersionProxy { server_version: String },
    /// Another Minecraft version than the engine's.
    VersionMismatch {
        server_version: String,
        server_protocol: i32,
    },
    /// It expects Java mods on the client: play it with the Java engine.
    NeedsJavaClient { mods: Vec<String> },
    /// No answer, or one that is not a Minecraft server's.
    Unreachable { reason: String },
}

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub timeout: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(5),
        }
    }
}

/// Pings `address` (`host` or `host:port`; SRV records are not looked up)
/// and says whether an engine speaking `protocol` can join it.
pub fn probe(address: &str, protocol: i32, options: &Options) -> (Verdict, Option<ServerStatus>) {
    let first = match status(address, protocol, options) {
        Ok(status) => status,
        Err(reason) => return (Verdict::Unreachable { reason }, None),
    };
    // A proxy answers with the version it was asked about. Ask about another
    // to tell it from a server that is simply the same version.
    let echoes = first.protocol == protocol
        && status(address, protocol - 1, options)
            .is_ok_and(|second| second.protocol == protocol - 1);
    let verdict = verdict(&first, protocol, echoes);
    (verdict, Some(first))
}

pub fn verdict(status: &ServerStatus, protocol: i32, echoes: bool) -> Verdict {
    if !status.required_mods.is_empty() || status.modded {
        return Verdict::NeedsJavaClient {
            mods: status.required_mods.clone(),
        };
    }
    if echoes {
        return Verdict::MultiVersionProxy {
            server_version: status.version_name.clone(),
        };
    }
    if status.protocol == protocol {
        Verdict::ProtocolMatches
    } else {
        Verdict::VersionMismatch {
            server_version: status.version_name.clone(),
            server_protocol: status.protocol,
        }
    }
}

/// One server list ping: handshake to the status state, status request,
/// the JSON answer.
pub fn status(address: &str, protocol: i32, options: &Options) -> Result<ServerStatus, String> {
    let (host, port) = split_address(address)?;
    let socket = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("{host}: {e}"))?
        .next()
        .ok_or_else(|| format!("{host}: no address"))?;
    let mut stream =
        TcpStream::connect_timeout(&socket, options.timeout).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(options.timeout))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(options.timeout))
        .map_err(|e| e.to_string())?;

    let mut handshake = Vec::new();
    write_varint(&mut handshake, 0x00);
    write_varint(&mut handshake, protocol);
    write_string(&mut handshake, &host);
    handshake.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake, 1);
    send(&mut stream, &handshake)?;
    send(&mut stream, &[0x00])?;

    let packet = receive(&mut stream)?;
    let mut cursor = packet.as_slice();
    if read_varint(&mut cursor)? != 0x00 {
        return Err("Not a status answer.".into());
    }
    let length = usize::try_from(read_varint(&mut cursor)?).map_err(|_| "Bad length.")?;
    if length > cursor.len() {
        return Err("The status answer is cut short.".into());
    }
    let text =
        std::str::from_utf8(&cursor[..length]).map_err(|_| "The status answer is not text.")?;
    parse_status(text)
}

/// Reads a status JSON, vanilla's or a modded server's.
pub fn parse_status(text: &str) -> Result<ServerStatus, String> {
    let value: Value =
        serde_json::from_str(text).map_err(|e| format!("Not a status answer: {e}"))?;
    let version = value.get("version").ok_or("The answer has no version.")?;
    let protocol = version
        .get("protocol")
        .and_then(Value::as_i64)
        .and_then(|p| i32::try_from(p).ok())
        .ok_or("The answer has no protocol.")?;
    let mut required_mods = Vec::new();
    // Forge 1.13+: forgeData.mods; 1.12 and older: modinfo.modList.
    let lists = [
        value.pointer("/forgeData/mods").and_then(Value::as_array),
        value.pointer("/modinfo/modList").and_then(Value::as_array),
    ];
    for list in lists.into_iter().flatten() {
        for entry in list {
            let id = entry
                .get("modId")
                .or_else(|| entry.get("modid"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            // Forge marks a mod the client need not have with this value
            // (IExtensionPoint.DisplayTest.IGNORESERVERONLY).
            let server_only = entry
                .get("modmarker")
                .and_then(Value::as_str)
                .is_some_and(|m| m.starts_with("OHNOES"));
            if !id.is_empty() && !server_only && !LOADER_ENTRIES.contains(&id) {
                required_mods.push(id.to_string());
            }
        }
    }
    // `modinfo` with an empty list is a courtesy to old Forge clients, not a
    // requirement: CubeCraft sends `{"type":"FML","modList":[]}`.
    let legacy_list = value
        .pointer("/modinfo/modList")
        .and_then(Value::as_array)
        .is_some_and(|list| !list.is_empty());
    let modded = value.get("forgeData").is_some()
        || legacy_list
        || value
            .get("isModded")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    // Forge 1.18+ packs its list into `forgeData.d`, unread here. Whether
    // such a server lets in a client without Forge the ping does not say,
    // so it counts as modded: the safe answer is the Java engine.
    Ok(ServerStatus {
        version_name: version
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        protocol,
        players_online: value.pointer("/players/online").and_then(Value::as_i64),
        players_max: value.pointer("/players/max").and_then(Value::as_i64),
        required_mods,
        modded,
        enforces_secure_chat: value.get("enforcesSecureChat").and_then(Value::as_bool),
    })
}

/// What Forge and NeoForge list for themselves.
const LOADER_ENTRIES: &[&str] = &["minecraft", "forge", "neoforge", "mcp", "FML", "fml"];

fn split_address(address: &str) -> Result<(String, u16), String> {
    let address = address.trim();
    if address.is_empty() {
        return Err("No address.".into());
    }
    // [::1]:25565 and plain IPv6 literals.
    if let Some(rest) = address.strip_prefix('[') {
        let (host, after) = rest.split_once(']').ok_or("Bad IPv6 address.")?;
        let port = match after.strip_prefix(':') {
            Some(port) => port.parse().map_err(|_| "Bad port.")?,
            None => 25565,
        };
        return Ok((host.to_string(), port));
    }
    match address.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => {
            Ok((host.to_string(), port.parse().map_err(|_| "Bad port.")?))
        }
        _ => Ok((address.to_string(), 25565)),
    }
}

/// A status answer is at most 32,767 characters; anything near a megabyte
/// is not a Minecraft server.
const MAX_PACKET: usize = 1 << 20;

fn send(stream: &mut TcpStream, body: &[u8]) -> Result<(), String> {
    let mut packet = Vec::new();
    write_varint(&mut packet, body.len() as i32);
    packet.extend_from_slice(body);
    stream.write_all(&packet).map_err(|e| e.to_string())
}

fn receive(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let length = read_varint(&mut ReadAdapter(stream))?;
    let length = usize::try_from(length).map_err(|_| "Bad packet length.")?;
    if length == 0 || length > MAX_PACKET {
        return Err("The answer is not a Minecraft packet.".into());
    }
    let mut packet = vec![0u8; length];
    stream.read_exact(&mut packet).map_err(|e| e.to_string())?;
    Ok(packet)
}

struct ReadAdapter<'a>(&'a mut TcpStream);

trait ByteSource {
    fn byte(&mut self) -> Result<u8, String>;
}

impl ByteSource for ReadAdapter<'_> {
    fn byte(&mut self) -> Result<u8, String> {
        let mut b = [0u8; 1];
        self.0.read_exact(&mut b).map_err(|e| e.to_string())?;
        Ok(b[0])
    }
}

impl ByteSource for &[u8] {
    fn byte(&mut self) -> Result<u8, String> {
        let (&first, rest) = self.split_first().ok_or("The packet is cut short.")?;
        *self = rest;
        Ok(first)
    }
}

fn read_varint(source: &mut impl ByteSource) -> Result<i32, String> {
    let mut value: u32 = 0;
    for i in 0..5 {
        let byte = source.byte()?;
        value |= u32::from(byte & 0x7f) << (7 * i);
        if byte & 0x80 == 0 {
            return Ok(value as i32);
        }
    }
    Err("A number longer than five bytes.".into())
}

fn write_varint(out: &mut Vec<u8>, value: i32) {
    let mut value = value as u32;
    loop {
        if value & !0x7f == 0 {
            out.push(value as u8);
            return;
        }
        out.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
}

fn write_string(out: &mut Vec<u8>, text: &str) {
    write_varint(out, text.len() as i32);
    out.extend_from_slice(text.as_bytes());
}

#[cfg(test)]
mod tests;
