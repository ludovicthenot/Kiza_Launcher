# Kiza Client Runtime

Kiza is distributed as two cooperating products:

1. **Kiza Launcher** owns authentication, official Minecraft installation, Java, instances,
   content, updates and diagnostics.
2. **Kiza Client Runtime** is Kiza-owned mod code injected through a supported modloader. It
   owns the in-game interface, launcher state bridge and future client-side modules.

The installer never contains Mojang's game JAR, libraries, assets or account tokens. The
launcher downloads the selected Minecraft version from the official manifests after the user
signs in and keeps every version in an isolated instance. This separation must remain true for
local builds, GitHub releases and future update channels.

## Support contract

| Minecraft | Loader | Runtime variant | Status |
| --- | --- | --- | --- |
| 1.14+ | Fabric | `fabric-java8` or `fabric-modern` | Supported |
| 1.7-1.12 | Forge | `forge-java8-legacy` | Supported |
| 1.13-1.16 | Forge | `forge-java8-modern-manifest` | Supported |
| 1.17+ | Forge | `forge-modern` | Supported |
| Any | Vanilla | none | Launcher-only |

Support means the matching Kiza-owned JAR can load on the Java generation used by that game.
It does not imply that every future module is available on every version. The launcher reads a
runtime report and displays the capabilities that actually started.

## Runtime lifecycle

Each module declares:

- a stable identifier;
- required module dependencies;
- whether failure makes the runtime unhealthy;
- the capabilities it provides;
- a start action that cannot expose launcher secrets.

The runtime starts modules in dependency order. Missing dependencies, cycles and startup
failures become `failed` states instead of crashing Minecraft. Failures include `Error`s, not
only exceptions: across four loader generations a module fails by not linking — a class that
moved, a method whose signature changed one version over — and those are the failures this
runtime exists to absorb. Only a `VirtualMachineError` is passed through, because after one
nothing the runtime reports would be true.

Two modules are declared. `ui` is optional: a Minecraft version whose render hooks Kiza cannot
reach is a plain-looking client, not a broken one. `state_bridge` is required, because it is
plain Java against the launcher's own files and has no version-specific way to fail. Writing the
report is not a module — the launcher receives it whether or not anything else started, so it is
not a capability anybody can be promised or denied.

Current capabilities are menu theming, window branding, the local Discord state bridge and the
local state bridge itself. `expected_capabilities` in Rust and the module declarations in
`KizaClientManager` are compared by a test that reads both files; they cannot drift silently.
Performance, replay, cosmetics or competitive modules must be added as separate modules with
their own compatibility tests, and must not be advertised before they exist.

Modules only claim what actually happened. On Fabric the interface is entirely mixins, every one
of them optional so an unknown version cannot crash the game, so the entry point asks the
version table whether any screen hook covers this version and fails the module when none does.
On both Forge generations a hook that cannot be installed throws instead of printing to stderr.

## The report

Settings live in `client.properties` beside the report, one file per instance, editable by hand.
Its keys are derived from the modules that were registered rather than listed separately, so a
switch cannot exist for a module that is gone or be missing for one that is new. Keys this build
does not recognise are read and written back untouched, so running an older Kiza once does not
erase what a newer one wrote. The file is written on the first launch and thereafter only when a
module appears that it has never heard of.

The report is written atomically to the instance runtime folder and accepted by Rust only when
its schema, client version, Minecraft version, loader and reported loader match the current
instance, and its timestamp is not in the future.

Both the report and the player-state file are deleted when a launch begins. The report describes
one launch and nothing expires it — a six-hour session has a six-hour-old report and every word
of it is still true — so what makes it trustworthy is that it cannot outlive the run that wrote
it. The launcher marks a report as describing the last launch whenever that instance is not
currently playing, and the interface says so rather than implying the present tense. Capabilities
shown are the ones a report listed; an instance that has never been launched shows none.

## Distribution gate

`npm run verify:client-distribution` rejects Mojang runtime layouts and well-known game JAR
names, and requires `src-tauri/assets` to hold exactly the five Kiza-owned runtime variants, by
name and non-empty. It walks the working tree rather than asking git for tracked files: what
ships is what is on disk, `include_bytes!` reads the working tree and so does the bundler, so an
untracked game JAR dropped into the assets folder would have passed a check that only looked at
the index. Tracked files are checked as well, since a forbidden file can be committed and then
deleted.

`npm run quality` runs that gate before frontend and Rust release checks. The gate is an
engineering safeguard, not a substitute for reviewing the Minecraft EULA and Usage Guidelines
before a public release.

Official references:

- <https://www.minecraft.net/eula>
- <https://www.minecraft.net/usage-guidelines>
