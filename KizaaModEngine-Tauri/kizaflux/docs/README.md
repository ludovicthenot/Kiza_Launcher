# Kizaflux

**Native Minecraft Mod Loader & Compatibility Engine**, part of Kiza
Launcher.

Kizaflux lets a Kiza instance run on a Rust engine instead of Java. The engine
is [Horizon](https://github.com/horizon-rust/horizon) (MIT), Minecraft: Java
Edition 26.3 rewritten in Rust with its own sandboxed mod system. Kizaflux is
what connects it to the launcher: install, prepare, play, and an honest answer
to "will my mods and my server work?".

It does not run Java mods. [Why](architecture.md#7-flux-bridge-the-java-path),
and what comes across instead: [compatibility.md](compatibility.md).

| Document | |
|---|---|
| [audit.md](audit.md) | Kiza Launcher, Horizon and Pomme as read; the choice |
| [architecture.md](architecture.md) | components, boundaries, launcher integration, security |
| [compatibility.md](compatibility.md) | mods and servers, by evidence |
| [roadmap.md](roadmap.md) | stages, what is done, measurements |

## State, 2026-10-28

| | |
|---|---|
| **Implemented and tested** | Signed release choice and install; Mojang file seeding; preparation and launch; session file; archive statuses for every loader; Horizon's own carry-over of Java mods (Flux Bridge); server ping verdicts. In the launcher: the engine choice, the Kizaflux tab, copies from Java instances, engine updates. 56 tests here, 525 in the launcher. Run for real: releases v0.2.95 and v0.2.96 installed, prepared from Kiza's own files and played; a local vanilla 26.3 server joined; Cobblemon's content carried over and loaded in game; 270 real mods classified |
| **Feasible, not done** | Signed-in play from the launcher (offline play is tested); loading a Horizon `.hmod`; the verdict beside each server of the server list |
| **Needs research** | A Java API for extensions written for Kizaflux (stage E); other Minecraft versions |
| **Unrealistic** | Unmodified Fabric, Forge or NeoForge mods on the Rust engine |

## Workspace

```
kizaflux/
├── Cargo.toml                 workspace; only dependencies the launcher already ships
├── crates/
│   ├── flux-bridge/           Java mods' content, through Horizon's port-pack
│   │   └── examples/carry.rs      a folder of jars → Horizon's verdicts
│   ├── flux-core/             Horizon: release, signature, install, layout, launch
│   │   ├── examples/horizon.rs    install | seed | prepare | sounds | play, by hand
│   │   └── tests/fixtures/        GitHub's release list, v0.2.95's signed checksums
│   ├── flux-diagnostics/      archive statuses
│   │   └── examples/scan.rs       a folder of mods → statuses (or --json)
│   └── flux-network/          server list ping → verdict
└── docs/
```

```sh
cd kizaflux
cargo test --workspace
cargo clippy --workspace --all-targets
cargo run -p flux-diagnostics --release --example scan -- "<instance>/game/mods"
KIZAFLUX_SERVER=localhost:25565 cargo test -p flux-network -- --ignored --nocapture
```

Flux API and Flux Runtime are Horizon's mod API and runtime, adopted rather
than rewritten: write a mod with
[Horizon's guide](https://github.com/horizon-rust/horizon/blob/main/docs/mods.md).

Kizaflux is not an official Minecraft product, nor affiliated with Mojang,
Microsoft or the Horizon project. Horizon contains no Minecraft code or
assets; it prepares them from the player's own copy.
