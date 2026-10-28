# Kizaflux audit: Kiza Launcher, Horizon and Pomme

Stage A of [the roadmap](roadmap.md). Everything here was read in the source
or measured on 2026-10-28. Where a statement is a project's own claim and was
not checked here, it says so.

| Studied | Revision |
|---|---|
| Kiza Launcher | branch `client-runtime-and-neoforge`, `f3bdcf3` (0.0.381) |
| Horizon | `horizon-rust/horizon` `e0bf5f6` (main, 2026-10-28 20:32), release `v0.2.95` |
| Pomme | `PommeMC/Client` `e4555d3` (main, 2026-10-28 16:32) |

## 1. Kiza Launcher, what Kizaflux builds on

A Tauri 2 desktop app: React and TypeScript in `src/`, Rust in `src-tauri/src`
(about 49,000 lines, one crate).

| Need | Where it already is | Reused by Kizaflux |
|---|---|---|
| Instances | `game_manager.rs` (`GameInstance`, `MinecraftInstanceConfig { mc_version, loader, loader_version, java_major }`), `commands/instances.rs` | yes: an `engine` field beside `loader` (architecture.md §5) |
| Loaders | `MinecraftLoader { Vanilla, Fabric, Forge, NeoForge }`, matched in 15 files (178 places) | **not** extended: Kizaflux is not a loader of the Java game |
| Minecraft files | `minecraft_manager.rs`: shared `minecraft/global/{versions,libraries,assets}` | yes: horizon-prepare reads them as a launcher folder |
| Java | `install_minecraft_runtime(app_data_dir, major)`, `minecraft/global/runtimes/temurin-*` | yes: Java 25 for the preparation |
| Microsoft account | `minecraft_auth.rs`, `ensure_valid_minecraft_token` | yes: the session file Horizon reads |
| Server jars | `server_install.rs` (hosting) | yes: the 26.3 server jar the preparation needs |
| Downloads | `download_manager.rs` (reqwest, hashes) | yes: releases, Mojang files |
| Archive safety | `archive.rs`, `path_security.rs` | the same rules, restated in flux-core's installer |
| Modrinth, CurseForge | `modrinth_api.rs`, `curseforge_api.rs`, `content_manager.rs` | later: compatibility filters (roadmap D3) |
| Diagnostics | `crash_doctor.rs`, `mod_compat.rs`, `diagnostics.rs` | Flux Diagnostics stays separate: other rules |

Two facts from this audit shape the integration:

- **Kiza rewrites Mojang's version files.** Its `versions/26.3/26.3.json` is
  re-serialized (SHA-1 `96c00d95…`), and Horizon accepts only Mojang's exact
  bytes. flux-core fetches Mojang's own copy by its SHA-1 address and hands it
  to the preparation (`Installed::seed_manifest`). Jars, libraries and assets
  are taken from Kiza's folder unchanged: the 26.3 client jar matched
  Horizon's pin (`e877b6a0…`).
- **The loader enum is everywhere.** A new variant would reach every match on
  it, server code included, for something that is not a Java loader. A
  separate `engine` field, `java` by default, leaves every existing instance
  and code path as it is.

## 2. Horizon

MIT ("for the project's original work only"; dependencies keep their own
licences, listed in its `THIRD_PARTY_NOTICES.md`). By Ludovic Marie and
contributors. Contains no Minecraft code or assets: it derives its resources
from the player's own copy.

**What it is.** Minecraft: Java Edition **26.3 only**, rewritten in Rust:
about 410,000 lines in `horizon-client` alone, 31 workspace crates. Protocol
777. Rendering with wgpu 30 (Vulkan on Windows and Linux, Metal on macOS).
Single player runs an integrated server on its own thread. The project
reports 281 differential "harnesses" against vanilla and 100% parity by its
own scoring; that score was not re-checked here.

**Architecture, as read.** `horizon-core` (shared types), `horizon-world`
(chunks, generation, lighting, saves), `horizon-protocol` (network, secure
chat, compression, encryption), `horizon-server` and `horizon-server-files`
(dedicated server), `horizon-client`, `horizon-assets`, `horizon-items`,
`horizon-command`. Not an ECS: the ports mirror vanilla's Java structure one
to one so they can be checked against it (its clippy settings say so).

**Mods.** Two systems, both Horizon's own:

1. **Sandboxed mods** (`horizon-mods`, `horizon-mod-sdk`, `cargo-horizon-mod`):
   Rust compiled to WebAssembly components, run by wasmtime 48 LTS. The WIT
   file is the whole API. Capabilities are the component's imports, checked
   against its manifest at load. Fuel and a 64 MiB memory cap per mod. A trap
   stops that mod only. API 0.1 (log, game-read, chat, hud, storage, command;
   `ui`, `render`, `input` experimental), 0.2 adds data-driven content
   (`registries`: blocks and items from JSON templates), server mods 0.3 are
   experimental. Its measured cost: 85 ns per empty hook call, 50 ms to load a
   small mod (its numbers, on an M4 Pro).
2. **Native mods** (experimental): "mixin bundles" that patch Horizon's Rust
   source before compiling it, pinned to one Horizon commit. Not sandboxed;
   the launcher builds them behind an explicit trust step.

Six official mods (`mods/official`): FPS Counter, Keystrokes, Zoom, Minimap,
Far View, Recipes.

**Java content.** `horizon-port-pack` imports a Modrinth or CurseForge pack,
classifies its mods and carries `assets/` and `data/` over into content mods,
upgrading formats to 26.3. Java code does not run. Its own measure of All the
Mods 10 (495 jars): 125 need no port (libraries, performance mods), 68 are
"data tier" (come over without code), the rest need code ports, the big
systems (Create, AE2, Mekanism) "a long campaign".

**Launcher contract** (how Kiza starts it), read in `launcher/src/backend.rs`,
`account.rs` and the client's argument parser:

- `horizon-client --resources <release>/.local/horizon-client/26.3`, run in
  the game folder (saves, options.txt, `horizon-mods/`);
- `--session-file <file>`: `{name, uuid, access_token, user_type: "msa",
  xuid}`, written fresh, deleted by the game once read, refused after two
  minutes;
- `horizon-prepare --prepare --server-jar <jar> --minecraft-dir <dir>`, with
  Java 25 found through `JAVA_HOME`; then `horizon-prepare sounds`.

**Releases.** GitHub releases, several a day (`v0.2.92` to `v0.2.95` on
2026-10-28 alone). `horizon-windows-x64.zip`, 31.7 MB, holding
`horizon-client.exe`, `horizon-prepare.exe`, `horizon-server.exe`,
`horizon-ctl.exe`, the Java exporters and `research-lock.json`. Each release
carries `SHA256SUMS` and `SHA256SUMS.sig`, an Ed25519 signature over
`horizon release <tag>\n` + the list; the public key is in
`crates/horizon-release-sign/release-keys.txt`.

**Multiplayer.** Joins vanilla 26.3 servers, online mode with the launcher's
account; LAN; its own friends relay. Its documentation does not claim Paper,
Spigot, proxies or modded servers; nothing was tested here (compatibility.md).

**Limits that matter to Kiza.** One Minecraft version. No Java mod runs. A
fast release cadence: what is tested today is a release, not "Horizon".
Development and parity runs are Linux and macOS; Windows is a release target.

## 3. Pomme

**GPL-3.0-or-later** (client, protocol, auth); `pomme-singleplayer` links
SteelMC and is **AGPL-3.0-or-later**; two small crates are MIT. Copyright
Purdze.

**What it is.** A Minecraft client written from scratch in Rust on Vulkan
(about 170,000 lines in `pomme-client`), joining vanilla servers **1.20 to
26.3**: it speaks 26.2 (protocol 776) natively and translates 13 other
protocols (`pomme-protocol/src/version.rs`, `TRANSLATED`). Wire code from the
azalea crates, pinned to a git revision. Single player through SteelMC, an
embedded Rust server. Microsoft sign-in (device code and PKCE), tokens in the
OS keyring. Android and iOS builds from source. In-game tests run against a
vanilla 26.2 server.

**Extensibility.** No mod or plugin system: no WebAssembly, no scripting, no
plugin API anywhere in its tree. Shader packs (`add a shader pack runtime`,
its newest commit) are the one extension point.

## 4. Which base, and why

| | Horizon | Pomme |
|---|---|---|
| Licence | MIT | GPL-3.0 (AGPL for single player) |
| Mod system | sandboxed WASM API, data-driven content, native mixins | none |
| Java content path | port-pack: classification and carry-over | none |
| Versions | 26.3 only | 1.20 to 26.3 (joins) |
| Single player | own integrated server, saves in vanilla's format | SteelMC (AGPL) |
| Release signing | Ed25519, verified here against a real release | not studied |
| Launcher contract | documented CLI, session file | its own Tauri launcher |

**Horizon.** Kizaflux needs a mod system, and Horizon has one that is
sandboxed, versioned and already carries Java packs' content; Pomme would need
one written from nothing. Horizon's MIT licence lets Kiza ship and integrate
it under Kiza's own terms (with its notice); Pomme's GPL would bind any
program it is linked into, and its single player is AGPL.

Pomme's real strength, joining many versions, is a gap in Horizon (one
version). It is kept as a reference for a later "Flux Network" research item,
by study only: its code is not copied.

**One library is linked**, for the content half of Flux Bridge:
`horizon-port-pack` (MIT) at tag `v0.2.96`, the carry-over Horizon's own
launcher runs. With what it pulls in (ureq, rustls, webpki-roots, zip 2,
toml 1...), 100 crates, all permissive: MIT or Apache-2.0 for most,
Unicode-3.0, ISC, BSD-3-Clause, Zlib, and CDLA-Permissive-2.0 for the CA
certificates (`cargo metadata`, 2026-10-28).

**No engine is written.** Horizon is a separate program Kiza installs and
starts, as Kiza starts Java: no Horizon code is copied into Kiza, and only
port-pack is linked in. The one thing restated is the signature check (a
dozen lines of Horizon's MIT scheme, credited in `flux-core/src/horizon/signature.rs`).
