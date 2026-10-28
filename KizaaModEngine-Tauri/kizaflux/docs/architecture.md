# Kizaflux architecture

Stage B of [the roadmap](roadmap.md). Kizaflux is an engine Kiza Launcher
offers beside Java, not a program of its own: the player picks
"Kizaflux (Experimental)" when creating an instance, and the launcher
installs, prepares and starts it.

## 1. The shape

```
 Kiza Launcher (Tauri)                                  separate processes
 ─────────────────────                                  ──────────────────
 src-tauri  ── instances, accounts, Java, downloads ──┐
    │                                                 │
    ├─ flux-core ─────── install (signed) ────────────┼─▶ Horizon release folder
    │                    prepare  ────────────────────┼─▶ horizon-prepare.exe (Java 25)
    │                    play     ────────────────────┼─▶ horizon-client.exe
    │                                                 │      ├─ Flux Runtime = horizon-mods (wasmtime)
    ├─ flux-diagnostics ─ what a jar/pack/.hmod is    │      ├─ Flux API     = horizon-mod-sdk (WIT)
    │                                                 │      └─ its own network (protocol 777)
    └─ flux-network ───── server list ping, verdict ──┘
```

Kizaflux's crates live in `kizaflux/`, a Cargo workspace of their own, so the
launcher's build does not change until it depends on them. Each one uses only
dependencies the launcher already ships.

## 2. Why a process and not a library

- **Isolation.** A game crash, a GPU driver fault or a mod overrunning its
  sandbox ends the game, not the launcher, as with Java today.
- **Updates.** Horizon releases several times a day. A process is updated by
  installing a folder; a linked library would need a new launcher build for
  each release.
- **Contracts.** Horizon's launcher contract (its CLI, the session file) is
  documented and tested by Horizon. Its internal crates are not a stable API:
  linking them would tie Kiza to whatever changes in them.
- **Licences.** Shipping a program beside the launcher keeps the two products'
  licences apart (MIT notice included).

The cost: Kiza cannot hook into the game's frames or ticks. It does not need
to. Hooks are what Flux API is for, inside the game.

## 3. The six components

The names are fixed. What each one is today:

| Component | What it is | State |
|---|---|---|
| **Flux Core** (`flux-core`) | The engine as the launcher sees it: release choice, signature, install, Mojang files, preparation, launch, session | implemented and tested ([§4](#4-flux-core)) |
| **Flux Diagnostics** (`flux-diagnostics`) | A status for every archive, with reasons | implemented and tested ([compatibility.md](compatibility.md)) |
| **Flux Network** (`flux-network`) | Before Play: can the engine join this server? | implemented and tested, ping only ([§6](#6-flux-network)) |
| **Flux API** | Horizon's mod API: the WIT contract and `horizon-mod-sdk`, versioned 0.x | Horizon's, adopted as is. Not duplicated: a second API would split authors |
| **Flux Runtime** | Horizon's `horizon-mods`: wasmtime, capabilities, fuel, crash isolation, reload of dev mods | Horizon's, runs in the game process. Kiza's part is turning mods on and off per instance (`horizon-mods.txt`), roadmap D2 |
| **Flux Bridge** | The Java path | research ([§7](#7-flux-bridge-the-java-path)). The content half exists in Horizon (`horizon-port-pack`) |

No empty crate stands for a component that has no code of Kiza's.

## 4. Flux Core

`kizaflux/crates/flux-core/src/horizon/`:

| Module | Does | Checked by |
|---|---|---|
| `release.rs` | The newest **game** release (`vX.Y.Z`, not `launcher@`, not nightly, not pre-release) carrying this system's archive *and* a signature | a fixture of GitHub's real list |
| `signature.rs` | Ed25519 over `horizon release <tag>\n` + `SHA256SUMS`, with Horizon's key built in; the archive's SHA-256 is taken from the signed list only | v0.2.95's real `SHA256SUMS` and `.sig`; changed list, other tag, other key, unlisted asset |
| `install.rs` | SHA-256 check, unpack into a staging folder, move into place when complete; refuses escaping paths, oversized archives, an existing version | five tests; the real v0.2.95 archive installed in 0.78 s |
| `layout.rs` | Reads the release's `research-lock.json` (Minecraft version, Java major, pinned file hashes); where resources go; `seed_manifest` for Mojang's exact version file | tests; the real release |
| `launch.rs` | The prepare, sounds and play commands; the session file | tests; the real preparation and an offscreen run |

flux-core does no network and no async: the launcher fetches with its own
client and hands bytes over. The order the launcher follows:

1. `release::newest(github_json, platform_asset())` → three URLs.
2. Download them; `signature::signed_digest` → the archive's SHA-256.
3. `install::install` into `<app data>/kizaflux/engines/horizon/<tag>/`.
4. `Installed::open`; if not `is_prepared()`:
   - ensure Kiza has Minecraft `lock.minecraft` installed (the existing installer);
   - ensure Java `lock.java_major` (`install_minecraft_runtime`);
   - fetch `manifest_url()` and `seed_manifest` it;
   - fetch the server jar (`downloads.server` of that file, SHA-1 checked);
   - run `prepare_command`, then `sounds_command`.
5. `write_session_file` with the active account, `play_command`, run.

Resources are prepared per release (about 1.3 GB: 916 MB of resources and
377 MB of sounds for v0.2.95). Two releases kept means twice that: the
launcher keeps the newest and the one an instance pins, and removes the rest.

## 5. Integration in the launcher (stage D)

Written as planned here; what is done and tested is in roadmap.md, stage D.
The launcher side lives in `src-tauri/src/kizaflux.rs` (the steps) and
`src-tauri/src/commands/kizaflux.rs` (the interface's commands).

**Instances.** `MinecraftInstanceConfig` gains

```rust
#[serde(default, skip_serializing_if = "Engine::is_java")]
pub engine: Engine,          // Java (default) | Kizaflux
```

Every instance plays the newest installed release; there is no per-instance
pin yet.

`#[serde(default)]` reads every existing instance file as `Java`: no
migration, no rewrite of a player's file. The loader stays `Vanilla` for a
Kizaflux instance.

**Launch.** One branch where the launcher starts a game: `Engine::Java` goes
the way it goes today, untouched; `Engine::Kizaflux` goes through flux-core.
The process handling (logs, "stop", the window) is shared.

**Creation.** The engine picker lists Kizaflux only for the Minecraft
versions the installed release plays (read from its lock); before any
release is installed, `kizaflux::KNOWN_MINECRAFT` (26.3) stands in.

**Mods tab.** In a Kizaflux instance:
- installed files with their Flux Diagnostics status and reasons;
- Horizon mods (`.hmod`) in `horizon-mods/`, with their capabilities, on/off;
- Modrinth and CurseForge results flagged by status, never "compatible"
  without a test; resource packs and data packs offered as they are.

**From a Java instance.** "Make a Kizaflux copy": a *new* instance that gets
copies of what can come across (worlds, after a backup, since Horizon upgrades
them on load; resource packs; options), and a report listing every mod with
its status. The Java instance is never changed, and both stay playable.

## 6. Flux Network

The game speaks the network itself. The launcher asks before Play with a
server list ping (`flux_network::probe`) and gets one of:

| Verdict | Means | Launcher |
|---|---|---|
| `ProtocolMatches` | the server is the engine's version, asks for no client mods | Play with Kizaflux; "not tested on this server" until it is |
| `MultiVersionProxy` | it answered with whatever version it was asked (asked twice, two answers) | may work; say so |
| `VersionMismatch` | another Minecraft version | play it with Java |
| `NeedsJavaClient` | `forgeData`, a non-empty `modinfo` list, `isModded` | play it with Java, and say which mods |
| `Unreachable` | no answer, or not Minecraft | say why |

A ping says nothing of login, anti-cheat, plugins or gameplay. Those come
from playing, recorded in compatibility.md. SRV records are not looked up
yet (roadmap D4).

## 7. Flux Bridge: the Java path

**Unmodified Fabric, Forge and NeoForge mods cannot run on Kizaflux.** Not
for lack of a JVM: a Java mod is compiled against Minecraft's Java classes
(`net.minecraft.world.level.block.Block` and thousands more), calls them,
subclasses them, and its Mixins rewrite their bytecode as they load. Running
it needs those classes, with their behaviour, in the same JVM. That is
Minecraft: Java Edition itself, which is what the Java engine already runs.
A JVM embedded beside Horizon would hold mods with nothing to call.

What can exist, in order of cost:

1. **Content carry-over** (exists in Horizon: `horizon-port-pack`).
   `assets/` and `data/` become a content mod. Measured statuses:
   compatibility.md.
2. **Native ports.** A mod rewritten against Flux API: Horizon's official mods
   (Zoom, Minimap...) are this. Flux Diagnostics points at one when it exists
   (`horizon_equivalent`).
3. **A Java API of Kizaflux's own** (stage E research). Java extensions
   written *for* Kizaflux, not for Minecraft: a small typed API (events,
   registries by id, chat, commands) served by Rust, in a separate JVM
   process so a Java fault cannot take the game down. The research is to
   measure what a round trip costs per tick (pipe vs JNI), and whether anyone
   would write for it rather than for WASM.
4. **Unmodified Java mods through a reimplementation of Minecraft's Java
   API**: unrealistic. It means reimplementing, in Java over Rust, the classes
   every mod touches, with their exact behaviour, bug for bug, plus a Mixin
   target for every method a Mixin can name. It is a second Minecraft.

## 8. Security

| Risk | Rule | Where |
|---|---|---|
| A tampered release | Ed25519 signature over the checksum list and tag; no unsigned release, ever | `signature.rs` |
| A path outside the folder | `enclosed_name`, plain components only, refuse on the first bad entry and leave nothing | `install.rs`, `flux-diagnostics` |
| Zip bombs | entry and byte limits from the central directory, then hard caps while reading | both |
| Half an install | staging folder, rename when complete | `install.rs` |
| The Microsoft token | never on a command line, never in Debug output; a fresh file in Kiza's data folder, deleted by the game; leftovers removed after two minutes | `launch.rs` |
| Hostile mod code | Horizon's sandbox (capabilities, fuel, memory); native mods only behind Horizon's own trust step, never turned on by Kiza | Flux Runtime |
| Worlds | Horizon upgrades older saves in place, as vanilla does: a Kizaflux copy of a world is backed up first (World Vault) | stage D |
| A server's network data | a ping reads at most 1 MiB, five-byte numbers, timeouts | `flux-network` |

What Kizaflux never does: bypass authentication or anti-cheat, change a
player's instance without asking, run a mod Horizon's sandbox refused.
