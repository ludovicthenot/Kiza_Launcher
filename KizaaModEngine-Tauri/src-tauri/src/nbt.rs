//! Just enough NBT to read a world's own description of itself.
//!
//! `level.dat` is gzipped NBT, and it is the only place that knows what a world
//! is actually called: the folder name is the name the world had when it was
//! created, and Minecraft never renames the folder afterwards. Showing folder
//! names in a backup list means showing the wrong names.
//!
//! This is a reader, not an NBT library. It walks the tree, keeps the handful of
//! values a world list needs, and skips everything else — a level.dat contains
//! hundreds of fields and none of the others are any of our business.

use std::collections::HashMap;
use std::io::Read;

/// The values worth showing about a world. Every one is optional: a level.dat
/// from an old version may not have all of them, and a missing field is not a
/// reason to refuse to back the world up.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LevelSummary {
    pub level_name: Option<String>,
    /// Milliseconds since the epoch, as Minecraft stores it.
    pub last_played_ms: Option<i64>,
    /// The Minecraft version that last wrote this world, e.g. "1.21.1".
    pub version_name: Option<String>,
    pub hardcore: Option<bool>,
    /// 0 survival, 1 creative, 2 adventure, 3 spectator.
    pub game_type: Option<i32>,
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(count)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|slice| slice[0])
    }

    fn u16(&mut self) -> Option<u16> {
        self.take(2)
            .map(|slice| u16::from_be_bytes([slice[0], slice[1]]))
    }

    fn i32(&mut self) -> Option<i32> {
        self.take(4)
            .map(|slice| i32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
    }

    fn i64(&mut self) -> Option<i64> {
        self.take(8).map(|slice| {
            i64::from_be_bytes([
                slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
            ])
        })
    }

    fn string(&mut self) -> Option<String> {
        let length = self.u16()? as usize;
        let bytes = self.take(length)?;
        // Minecraft writes modified UTF-8; for the fields we read, the two
        // encodings agree unless the text contains a NUL or a surrogate pair.
        Some(String::from_utf8_lossy(bytes).into_owned())
    }
}

/// A payload, kept only when it is one of the few shapes we care about.
#[derive(Debug, Clone, PartialEq)]
enum Value {
    Byte(i8),
    Int(i32),
    Long(i64),
    Str(String),
    Compound(HashMap<String, Value>),
    List(Vec<Value>),
    /// Anything read and deliberately discarded.
    Skipped,
}

fn read_payload(cursor: &mut Cursor, tag: u8) -> Option<Value> {
    match tag {
        1 => Some(Value::Byte(cursor.u8()? as i8)),
        2 => {
            cursor.take(2)?;
            Some(Value::Skipped)
        }
        3 => Some(Value::Int(cursor.i32()?)),
        4 => Some(Value::Long(cursor.i64()?)),
        5 => {
            cursor.take(4)?;
            Some(Value::Skipped)
        }
        6 => {
            cursor.take(8)?;
            Some(Value::Skipped)
        }
        7 => {
            let length = cursor.i32()?.max(0) as usize;
            cursor.take(length)?;
            Some(Value::Skipped)
        }
        8 => Some(Value::Str(cursor.string()?)),
        9 => {
            let element = cursor.u8()?;
            let length = cursor.i32()?.max(0) as usize;
            let mut items = Vec::new();
            for _ in 0..length {
                // Every element has to be walked whether or not it is kept,
                // or the cursor lands in the middle of the next field.
                items.push(read_payload(cursor, element)?);
            }
            Some(Value::List(items))
        }
        10 => Some(Value::Compound(read_compound(cursor)?)),
        11 => {
            let length = cursor.i32()?.max(0) as usize;
            cursor.take(length.checked_mul(4)?)?;
            Some(Value::Skipped)
        }
        12 => {
            let length = cursor.i32()?.max(0) as usize;
            cursor.take(length.checked_mul(8)?)?;
            Some(Value::Skipped)
        }
        // TAG_End inside a payload position, or a tag from a future format.
        _ => None,
    }
}

fn read_compound(cursor: &mut Cursor) -> Option<HashMap<String, Value>> {
    let mut entries = HashMap::new();
    loop {
        let tag = cursor.u8()?;
        if tag == 0 {
            return Some(entries);
        }
        let name = cursor.string()?;
        let value = read_payload(cursor, tag)?;
        entries.insert(name, value);
    }
}

/// Reads the useful fields out of raw (already decompressed) NBT.
pub fn parse_level(bytes: &[u8]) -> Option<LevelSummary> {
    let mut cursor = Cursor { bytes, at: 0 };
    // The file starts with a named root compound.
    if cursor.u8()? != 10 {
        return None;
    }
    let _root_name = cursor.string()?;
    let root = read_compound(&mut cursor)?;

    let data = match root.get("Data") {
        Some(Value::Compound(data)) => data,
        // Everything a world list shows lives under Data; without it there is
        // nothing to report, and inventing a name would be worse.
        _ => return Some(LevelSummary::default()),
    };

    let version_name = match data.get("Version") {
        Some(Value::Compound(version)) => match version.get("Name") {
            Some(Value::Str(name)) => Some(name.clone()),
            _ => None,
        },
        _ => None,
    };

    Some(LevelSummary {
        level_name: match data.get("LevelName") {
            Some(Value::Str(name)) => Some(name.clone()),
            _ => None,
        },
        last_played_ms: match data.get("LastPlayed") {
            Some(Value::Long(value)) => Some(*value),
            _ => None,
        },
        version_name,
        hardcore: match data.get("hardcore") {
            Some(Value::Byte(value)) => Some(*value != 0),
            _ => None,
        },
        game_type: match data.get("GameType") {
            Some(Value::Int(value)) => Some(*value),
            _ => None,
        },
    })
}

/// Reads a `level.dat`, which is gzipped in every version that ships one.
///
/// Returns None rather than an error: a world whose level.dat cannot be read is
/// still a world, and it must stay backupable.
pub fn read_level_dat(bytes: &[u8]) -> Option<LevelSummary> {
    with_decompressed(bytes, parse_level)
}

/// Runs a parser on the file, gzipped or not.
///
/// `level.dat` is compressed and `servers.dat` is not, and neither announces
/// which it is. Trying both is cheaper than being wrong.
fn with_decompressed<T>(bytes: &[u8], parse: impl Fn(&[u8]) -> Option<T>) -> Option<T> {
    let mut decoded = Vec::new();
    if flate2::read::GzDecoder::new(bytes)
        .read_to_end(&mut decoded)
        .is_ok()
    {
        if let Some(parsed) = parse(&decoded) {
            return Some(parsed);
        }
    }
    parse(bytes)
}

/// One line of Minecraft's own multiplayer list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerEntry {
    pub name: String,
    /// As Minecraft stores it: `host` or `host:port`.
    pub address: String,
}

/// Reads a `servers.dat` — the multiplayer list the player already built inside
/// the game.
///
/// Entries without an address are dropped rather than imported as blanks: the
/// file is written by the game, but also by mods and by hand, and a server with
/// no address is not a server.
pub fn parse_servers_dat(bytes: &[u8]) -> Option<Vec<ServerEntry>> {
    with_decompressed(bytes, |raw| {
        let mut cursor = Cursor { bytes: raw, at: 0 };
        if cursor.u8()? != 10 {
            return None;
        }
        let _root_name = cursor.string()?;
        let root = read_compound(&mut cursor)?;

        let Some(Value::List(items)) = root.get("servers") else {
            // A multiplayer list with no servers key is not a servers.dat.
            return None;
        };

        Some(
            items
                .iter()
                .filter_map(|item| {
                    let Value::Compound(entry) = item else {
                        return None;
                    };
                    let address = match entry.get("ip") {
                        Some(Value::Str(ip)) if !ip.trim().is_empty() => ip.trim().to_string(),
                        _ => return None,
                    };
                    let name = match entry.get("name") {
                        Some(Value::Str(name)) if !name.trim().is_empty() => {
                            name.trim().to_string()
                        }
                        // Minecraft allows an unnamed entry; the address is the
                        // only honest label left.
                        _ => address.clone(),
                    };
                    Some(ServerEntry { name, address })
                })
                .collect(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Writes NBT by hand so the test exercises the real byte layout.
    struct Builder {
        bytes: Vec<u8>,
    }

    impl Builder {
        fn new() -> Self {
            Self { bytes: Vec::new() }
        }

        fn tag(&mut self, tag: u8, name: &str) -> &mut Self {
            self.bytes.push(tag);
            self.bytes
                .extend_from_slice(&(name.len() as u16).to_be_bytes());
            self.bytes.extend_from_slice(name.as_bytes());
            self
        }

        fn string(&mut self, name: &str, value: &str) -> &mut Self {
            self.tag(8, name);
            self.bytes
                .extend_from_slice(&(value.len() as u16).to_be_bytes());
            self.bytes.extend_from_slice(value.as_bytes());
            self
        }

        fn long(&mut self, name: &str, value: i64) -> &mut Self {
            self.tag(4, name);
            self.bytes.extend_from_slice(&value.to_be_bytes());
            self
        }

        fn int(&mut self, name: &str, value: i32) -> &mut Self {
            self.tag(3, name);
            self.bytes.extend_from_slice(&value.to_be_bytes());
            self
        }

        fn byte(&mut self, name: &str, value: i8) -> &mut Self {
            self.tag(1, name);
            self.bytes.push(value as u8);
            self
        }

        fn double(&mut self, name: &str, value: f64) -> &mut Self {
            self.tag(6, name);
            self.bytes.extend_from_slice(&value.to_be_bytes());
            self
        }

        fn long_array(&mut self, name: &str, values: &[i64]) -> &mut Self {
            self.tag(12, name);
            self.bytes
                .extend_from_slice(&(values.len() as i32).to_be_bytes());
            for value in values {
                self.bytes.extend_from_slice(&value.to_be_bytes());
            }
            self
        }

        fn compound(&mut self, name: &str) -> &mut Self {
            self.tag(10, name)
        }

        fn end(&mut self) -> &mut Self {
            self.bytes.push(0);
            self
        }
    }

    /// A level.dat shaped like the real thing: the fields we want, buried among
    /// fields we must walk past without losing our place.
    fn level_dat() -> Vec<u8> {
        let mut builder = Builder::new();
        builder.compound("");
        builder.compound("Data");
        builder.double("BorderCenterX", 0.0);
        builder.string("LevelName", "Survie de Nefer");
        builder.long_array("WanderingTraderId", &[1, 2, 3, 4]);
        builder.compound("Version");
        builder.int("Id", 3955);
        builder.string("Name", "1.21.1");
        builder.byte("Snapshot", 0);
        builder.end();
        builder.long("LastPlayed", 1_770_000_000_000);
        builder.byte("hardcore", 1);
        builder.int("GameType", 0);
        // A list of compounds, which has to be walked element by element.
        builder.tag(9, "ScheduledEvents");
        builder.bytes.push(10);
        builder.bytes.extend_from_slice(&2i32.to_be_bytes());
        builder.string("Name", "first");
        builder.end();
        builder.string("Name", "second");
        builder.end();
        builder.end(); // Data
        builder.end(); // root
        builder.bytes
    }

    #[test]
    fn a_world_reports_the_name_the_player_gave_it() {
        let summary = parse_level(&level_dat()).unwrap();

        // The folder on disk could be called anything; this is the real name.
        assert_eq!(summary.level_name.as_deref(), Some("Survie de Nefer"));
        assert_eq!(summary.version_name.as_deref(), Some("1.21.1"));
        assert_eq!(summary.last_played_ms, Some(1_770_000_000_000));
        assert_eq!(summary.hardcore, Some(true));
        assert_eq!(summary.game_type, Some(0));
    }

    #[test]
    fn fields_we_do_not_read_are_walked_past_without_losing_place() {
        // GameType comes after a long array and a nested compound; reading it
        // correctly proves the skipping arithmetic, not just the field lookup.
        let summary = parse_level(&level_dat()).unwrap();
        assert_eq!(summary.game_type, Some(0));
    }

    #[test]
    fn a_gzipped_level_dat_is_read_like_the_real_file() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&level_dat()).unwrap();
        let compressed = encoder.finish().unwrap();

        let summary = read_level_dat(&compressed).unwrap();
        assert_eq!(summary.level_name.as_deref(), Some("Survie de Nefer"));
    }

    #[test]
    fn a_truncated_file_is_refused_instead_of_half_read() {
        let full = level_dat();
        // Half a world description is not a world description.
        assert!(parse_level(&full[..full.len() / 2]).is_none());
        assert!(parse_level(&[]).is_none());
    }

    /// A servers.dat as Minecraft writes it: uncompressed, one list of
    /// compounds.
    fn servers_dat() -> Vec<u8> {
        let mut builder = Builder::new();
        builder.compound("");
        builder.tag(9, "servers");
        builder.bytes.push(10);
        builder.bytes.extend_from_slice(&3i32.to_be_bytes());

        builder.string("ip", "mc.hypixel.net");
        builder.string("name", "Hypixel");
        builder.byte("acceptTextures", 1);
        builder.end();

        // No name: Minecraft allows it.
        builder.string("ip", "play.example.net:25566");
        builder.end();

        // No address at all: not a server.
        builder.string("name", "Broken entry");
        builder.end();

        builder.end(); // root
        builder.bytes
    }

    #[test]
    fn the_multiplayer_list_is_read_the_way_the_game_wrote_it() {
        let entries = parse_servers_dat(&servers_dat()).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "Hypixel");
        assert_eq!(entries[0].address, "mc.hypixel.net");
        // Unnamed: the address is the only honest label left.
        assert_eq!(entries[1].name, "play.example.net:25566");
        assert_eq!(entries[1].address, "play.example.net:25566");
        // An entry with no address would import as a blank row.
        assert!(!entries.iter().any(|entry| entry.name == "Broken entry"));
    }

    #[test]
    fn a_gzipped_multiplayer_list_is_read_too() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&servers_dat()).unwrap();

        // Neither file announces whether it is compressed.
        let entries = parse_servers_dat(&encoder.finish().unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn a_file_that_is_not_a_multiplayer_list_is_refused() {
        // A level.dat parses as NBT but has no servers list.
        assert!(parse_servers_dat(&level_dat()).is_none());
        assert!(parse_servers_dat(b"not nbt").is_none());
    }

    #[test]
    fn a_level_dat_without_the_fields_we_want_still_parses() {
        let mut builder = Builder::new();
        builder.compound("");
        builder.compound("Data");
        builder.int("version", 19133);
        builder.end();
        builder.end();

        // An old world must still be listable and backupable, just unnamed.
        let summary = parse_level(&builder.bytes).unwrap();
        assert_eq!(summary.level_name, None);
        assert_eq!(summary.version_name, None);
    }
}
