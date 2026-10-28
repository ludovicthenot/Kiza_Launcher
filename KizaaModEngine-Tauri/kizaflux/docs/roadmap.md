# Kizaflux roadmap

Each stage ends on evidence, not on code written. ✅ done and tested,
◐ partly, ☐ not started.

## A. Audit ✅

[audit.md](audit.md): Kiza Launcher, Horizon (`e0bf5f6`, `v0.2.95`) and
Pomme (`e4555d3`), licences, the choice of Horizon.

## B. Design ✅

[architecture.md](architecture.md): the six components, the process boundary,
the launcher integration, security.

## C. Prototype ◐ (C4 open)

| # | Goal | State | Evidence |
|---|---|---|---|
| C1 | An engine adapter | ✅ flux-core | 21 tests; real release installed, prepared and run |
| C2 | Read jars | ✅ flux-diagnostics | 23 tests; 270 real archives |
| C3 | Detect loaders and metadata | ✅ Fabric, Quilt, Forge, NeoForge, legacy Forge, Horizon, packs | same |
| C4 | Load a native mod | ☐ | needs `wasm32-unknown-unknown` and `cargo-horizon-mod`; an official mod (`zoom`) is the first candidate |
| C5 | Bring over a Java resource | ✅ flux-bridge, Horizon's `port-pack` at tag v0.2.96 | Cobblemon 1.8.2 carried over (323 blocks, 770 items, 569 recipes, 766 loot tables, 1,886 worldgen files; 177 blocks left out), installed in `horizon-mods/cobblemon/`, loaded by Horizon v0.2.96 ("content from 1 mod(s)"); a survival world generated 80 chunks in 7.8 s with it, 224 in 5.0 s without (one run each) |
| C6 | A diagnostic | ✅ statuses with reasons, JSON (`scan --json`) | |
| C7 | Join a local vanilla server | ✅ | vanilla 26.3 server (offline mode, EULA accepted by the player for the test): the probe says `ProtocolMatches`; Horizon v0.2.95 logged in, spawned at the server's (9.5, 65, 10.5), received and drew 213 chunks over 945 frames, disconnected cleanly |

Measured so far (the machine in compatibility.md):

| Step | Time |
|---|---|
| Signature check + install of v0.2.95 (31.7 MB) | 0.78 s |
| Preparation from Kiza's own 26.3 files, Java 25 | 113.9 s, once per release |
| Sounds | 63.6 s, once per release |
| Offscreen run, new world: first frame | 4.86 s after start |
| Same run: 600 world frames, 277 chunks generated and meshed | 6.2 s; process 11.6 s in all |

The launcher's own path, `kizaflux::tests::end_to_end`, from nothing in a
separate app data folder (2026-10-28, Horizon v0.2.96, released meanwhile):
newest release found, downloaded, signature checked and installed in 5 s;
Java 25 found; preparation 128 s; sounds 13 s; `launch_instance` started the
game, first frame 55 s later (the first start of a fresh release; the
offscreen run of v0.2.95 above drew its first frame in 4.9 s).

## D. In the launcher ◐

| # | Goal | State |
|---|---|---|
| D1 | `engine` on instances, Kizaflux in the creation dialog, launch through flux-core | ✅ `MinecraftInstanceConfig.engine` (absent = Java, never written for Java); the engine choice in New instance (vanilla, the release's version); one branch in `launch_minecraft` to `src-tauri/src/kizaflux.rs`; the launch status, log file and process watcher are the Java ones. Launcher tests: 524 Rust, 449 frontend, all pass; `kizaflux::tests::end_to_end` (ignored, run by hand) passed on the real machine. Signed-in play not tried yet (offline play is) |
| D2 | A Kizaflux tab: statuses with reasons, `.hmod` on/off (`horizon-mods.txt`) | ✅ |
| D3 | Discover for Kizaflux instances | ✅ by construction: a vanilla instance is offered resource packs and data packs only, no Java mod. Horizon mods have no catalogue there yet |
| D4 | Can the engine join a server? | ◐ a check in the Kizaflux tab; not yet beside each entry of the server list; no SRV lookup |
| D5 | "Make a Kizaflux copy" of a Java instance | ✅ in the instance's Settings: a new instance with copies of the worlds, resource packs, options and server list, and the report of the mods that stay behind. The Java instance is only read |
| D6 | Engine update | ✅ "Update the engine" installs and prepares the newest signed release, then removes the older ones. Releases are never updated behind the player's back: a new one costs a 3-minute preparation |

## E. Java bridge research ☐

Only stage E's question, with numbers: what does a Java extension cost when
it talks to Rust through a small API, in a separate JVM? One extension (a
command and a tick counter), pipe and JNI, measured per call and per tick.
It runs no Minecraft mod, and is not meant to.

## F. Further compatibility ☐

Only if E or D say it is worth it: more of Flux API (Horizon's roadmap:
`keys`, `target`, `inventory-read`, `world-read`, `registries`, `net`),
semi-automatic ports of data-tier mods with `port-pack`, more protocol
versions (Pomme's approach, studied, not copied).

## Benchmarks still to make

Java against Kizaflux on the same machine and world, three runs each, median
and 1% low: time to the title screen, to a world, memory, CPU, frame time.
Horizon's `horizon-ctl bench` and the Java client with the same render
distance. None of these numbers exist yet; none is claimed.
