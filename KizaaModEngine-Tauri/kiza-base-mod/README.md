# Kiza Base Mod Workspace

This workspace produces two strictly separate client mods embedded by Kiza
Launcher: `kiza-base-mod-fabric.jar` and `kiza-base-mod-forge.jar`. The launcher
selects exactly one from `MinecraftLoader` and repairs it before launch.

Both variants report only the coarse local player state needed by Discord Rich
Presence: Minecraft menus, survival, creative, or multiplayer. Server names,
addresses, account details, chat, and world names are never collected. When a
loader/Minecraft combination cannot be reflected safely, the bridge reports an
explicit `unsupported` state instead of pretending that detection works.

The client variants initialize through a small `KizaClientManager`. It owns the
local state bridge and the loader-specific UI hooks without adding a browser,
socket, account service, or remote asset dependency.

Supported Minecraft menus use Kiza's dark launcher palette, purple interaction
accent, branded background, responsive status panels, and the real Minecraft
buttons underneath the custom presentation. Existing click targets and screen
navigation remain owned by Minecraft, so loader updates cannot leave a fake or
non-interactive menu on screen. If a version cannot be reflected safely, the
renderer leaves the vanilla menu visible instead.

The overlay replaces the operating-system caption with a Kiza title bar while
preserving minimize, maximize/restore, close, drag, double-click maximize,
edge resizing, fullscreen detection, and minimum window dimensions. Fabric
1.17+ and Forge 1.18+ receive the complete renderer. Every instance also
receives the launcher-managed `KizaClient.zip` resource pack as a visual
fallback for Vanilla and legacy loaders.

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
