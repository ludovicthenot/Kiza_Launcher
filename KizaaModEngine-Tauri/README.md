# Kiza Launcher Alpha

A Minecraft launcher for isolated instances, user-selected mod loaders and controlled performance settings, built with Tauri 2 (Rust) and React/TypeScript.

## Features

- **Managed, isolated instances** - each instance lives in its own folder; the official Minecraft launcher is never touched.
- **User-controlled modloaders and mods** - Kiza installs no third-party FPS pack automatically; players choose their own performance and gameplay mods.
- **Performance profiles** (Low End / Balanced / Quality) - JVM flags, memory sizing scaled to the machine's RAM, and tuned `options.txt`. Selectable per instance from the launch dialog.
- **Offline-capable launches** - Minecraft, Fabric and Forge metadata are cached on disk; once all required files are installed, an instance can launch without network access.
- **Managed Java runtimes** - Temurin 17/21 downloaded and selected automatically per Minecraft version.
- **Microsoft account authentication** with skin display, plus offline fallback.
- **Mod management** - Modrinth/CurseForge discovery, recursive dependencies, profiles, conflict detection and deployment manifests.
- **Game process tracking** - live menu/survival/creative/multiplayer state, double-launch protection and Discord Rich Presence that resets when the game exits.

## Development

```bash
npm install
npm run tauri dev
```

## Quality checks

```bash
npm run quality        # typecheck + unit tests + frontend build
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Release

```bash
npm run build:app      # bumps the version everywhere, then builds the installers
```

The NSIS installer is produced in `src-tauri/target/release/bundle/nsis/`. The full pre-release gate is `npm run release:check`.

## Layout

- `src/` - React frontend (views, instance tabs, queries via TanStack Query).
- `src-tauri/src/` - Rust backend: `minecraft_manager` (install/launch/runtime), `minecraft_auth` (Microsoft OAuth), `mod_manager` (profiles/deployment), `dependency_resolver`, `download_manager`, `discord_rpc`, `config_manager`.
