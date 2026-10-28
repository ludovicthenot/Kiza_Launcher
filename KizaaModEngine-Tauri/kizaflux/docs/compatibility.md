# Kizaflux compatibility

What Kizaflux can run, by evidence. Every row says how it is known, and
"not tested" means exactly that: never "probably works".

Engine: Horizon `v0.2.95`, Minecraft 26.3, protocol 777. Machine for the
measurements: Intel Core 7 240H, NVIDIA GeForce RTX 5070 Laptop GPU, 31.6 GB,
Windows 11, 2026-10-28.

## Mods

### Statuses

Flux Diagnostics gives every archive one of these, from its descriptors and
layout ([architecture.md §7](architecture.md#7-flux-bridge-the-java-path)
explains why Java code does not run):

| Status | When | Source |
|---|---|---|
| Compatible and tested | a test run passed on this exact file (by SHA-1) | test results only |
| Partially compatible | a test run found part of it working | test results only |
| Resources only | no Java code: resource packs, data packs, code-free mods | the archive |
| Needs adaptation | Java code, and content of its own that can come across | the archive |
| Incompatible | Java code and nothing to carry; or a refused archive | the archive |
| Not tested | a Horizon mod not tested yet, or an unknown kind | the archive |

Besides the status, a report names: the Mixin configurations, access wideners
and coremods (what will not carry over); native libraries; whether the mod's
Minecraft requirement covers 26.3; mods the engine makes unneeded (Sodium,
Lithium, FerriteCore...); and Horizon's official mod for the same purpose
(Zoomify → Zoom, Xaero's Minimap → Minimap, JEI/EMI → Recipes, Distant
Horizons → Far View).

### By loader and kind

| Archive | Code runs | What comes across | Status |
|---|---|---|---|
| Horizon mod (`.hmod`, WASM) | yes, sandboxed | everything | not tested until tested |
| Horizon native mod (`.hnmod`) | after a build the player trusts | everything | not offered by Kiza (Horizon's trust step) |
| Resource pack | no code | textures, models, sounds, fonts, text | resources only |
| Data pack | no code | recipes, loot, tags, worldgen, functions | resources only |
| Fabric / Quilt mod | **no** | its `assets/`, `data/` | needs adaptation, or incompatible |
| Forge / NeoForge mod | **no** | its `assets/`, `data/` | needs adaptation, or incompatible |
| Forge 1.12 coremod | **no** | its `assets/` | incompatible in practice |
| Performance / renderer mod | **no**, and not needed | nothing | incompatible, "replaced by the engine" |

"What comes across" is what Horizon's carry-over can load: Horizon's own
measures and limits apply ([its modpacks.md](https://github.com/horizon-rust/horizon/blob/main/docs/modpacks.md)).
A mod's blocks and items appear; what its code made them do does not.

### Horizon's carry-over on real instances

Flux Bridge runs Horizon's own carry-over (`horizon-port-pack`, tag v0.2.96)
on each jar: it carries the content and reads the classes, and its verdict
replaces the estimate below once a jar has been through it.
`cargo run -p flux-bridge --release --example carry -- <mods> <checks>`:

| Instance | Jars | Works | Partly | Doesn't run | Could not be read | Time |
|---|---:|---:|---:|---:|---:|---:|
| Fresh & Smooth (Fabric 26.2) | 105 | 0 | 1 (Bedrockify: 87 recipes) | 100 | 4 | 12.6 s |
| Cobblemon Official Modpack (Fabric 1.21.1) | 76 | 0 | 2 (Cobblemon, EMI) | 73 | 1 | 122 s (Cobblemon alone 111 s) |

"Could not be read": five jars whose `fabric.mod.json` has a raw line break
inside a string, which Fabric's loader accepts and port-pack refuses.
Flux Diagnostics' estimate (the table below) was far too hopeful: it counted
any namespace of a mod's own as content, where the carry-over counts what
actually comes across.

Data packs: Horizon runs their functions, predicates and item modifiers;
their recipes, loot tables, advancements and world generation are not applied
yet (playhorizon.dev/docs/mods, 2026-10-28). Resource packs are turned on in
the game's Resource Packs screen.

### Estimated from the archives



`cargo run -p flux-diagnostics --release --example scan -- <mods folder>`,
on three instances of this machine, read only:

| Instance | Made for | Archives | Incompatible | Needs adaptation | Resources only | Replaced by the engine | Compatible |
|---|---|---:|---:|---:|---:|---:|---:|
| Fresh & Smooth | Fabric 26.2 | 105 | 55 | 47 | 3 | 10 | 0 |
| Fabulously Refined | Fabric 1.20.1 | 89 | 49 | 38 | 2 | 12 | 0 |
| Cobblemon Official Modpack | Fabric 1.21.1 | 76 | 37 | 38 | 1 | 7 | 0 |

0.4 to 0.9 s per instance once the files are in the OS cache (6 to 7 s cold).
What it says: these packs are client and performance packs; their value is
the code, which does not come across. A content pack (structures, decoration
blocks) would show far more "resources only" and "needs adaptation".

## Servers

### What the launcher can tell before Play

`flux_network::probe`, a server list ping:

| Verdict | Tested against |
|---|---|
| `ProtocolMatches` | a local fake vanilla 26.3 server (unit test) |
| `VersionMismatch` | a fake 1.21.1 server (unit test) |
| `MultiVersionProxy` | a fake proxy (unit test); **mc.hypixel.net** and **play.cubecraft.net**, real, 2026-10-28 |
| `NeedsJavaClient` | a fake Forge 1.20.1 server with Create (unit test); a NeoForge `isModded` answer |
| `Unreachable` | a closed port; an HTTP server |

CubeCraft sends `"modinfo": {"type": "FML", "modList": []}` without needing
any mod. The first version of the probe read that as modded; the real ping
caught it, and an empty list no longer counts.

### By kind of server

Joining was tested on one server, a local vanilla one; the other rows are
what is known from the protocol and Horizon's documentation, and what to test.

| Server | Expected | Why | Tested |
|---|---|---|---|
| Vanilla 26.3, offline mode | joins | Horizon's own differential tests | **yes**, login, spawn, 213 chunks, clean disconnect (2026-10-28, local server); gameplay rows below not played yet |
| Vanilla 26.3, online mode | joins | Horizon signs in with the launcher's account | no |
| Vanilla, other versions | does not join | one protocol, 777 | n/a: `VersionMismatch` |
| Paper / Spigot / Purpur 26.3 | should join | vanilla's protocol; plugins are server-side | no |
| Behind Velocity / BungeeCord | depends on the backend's version | the proxy forwards | no |
| ViaVersion and similar | may join | translation on the server | no (`MultiVersionProxy`) |
| Plugins with custom payloads | joins; their client features absent | channels with no client handler | no |
| Fabric server, server-side mods only | should join | vanilla's protocol on the wire | no |
| Fabric server, client mods required | no | needs Java mods | n/a |
| Forge / NeoForge | no | needs Java mods and Forge's handshake | n/a: `NeedsJavaClient` |
| Anti-cheat | unknown | a different client's movement may be flagged; nothing is done to avoid it | no |

To test a row, play it and record: login, world load, movement, blocks,
entities, inventory, crafting, dimension change, chat, server resource pack,
disconnect and reconnect.
