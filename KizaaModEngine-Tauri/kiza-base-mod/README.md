# Kiza Base Mod Workspace

This workspace produces two strictly separate client mods embedded by Kiza
Launcher: `kiza-base-mod-fabric.jar` and `kiza-base-mod-forge.jar`. The launcher
selects exactly one from `MinecraftLoader` and repairs it before launch.

Both variants report only the coarse local player state needed by Discord Rich
Presence: Minecraft menus, survival, creative, or multiplayer. Server names,
addresses, account details, chat, and world names are never collected. When a
loader/Minecraft combination cannot be reflected safely, the bridge reports an
explicit `unsupported` state instead of pretending that detection works.

The bridge is a small atomic JSON heartbeat protected by a per-launch nonce.
The launcher passes its path and nonce as JVM system properties; no socket or
network connection is opened.

Build and test from the launcher root:

```powershell
npm run build:base-mod
npm run test:base-mod
```

The deterministic outputs are copied to `src-tauri/assets/` and embedded into
the Rust binary with `include_bytes!`; game launch never downloads either mod.
