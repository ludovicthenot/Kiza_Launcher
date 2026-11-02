<div align="center">

<img src=".github/kiza.png" width="112" alt="">

# Kiza Launcher

**A Minecraft launcher that tells the truth.**

Isolated instances · mods and modpacks from Modrinth and CurseForge in one search · servers hosted from the launcher · a Kiza client drawn inside the game

Written in Rust for Windows · in active development

</div>

---

## What it is

Kiza manages Minecraft the way a launcher should: every instance keeps its own
mods, worlds and version, and nothing leaks into its neighbour. Mods come from
Modrinth and CurseForge through a single search. When the game stops, the crash
report names the mod rather than saying an error occurred.

What it does today:

- **A library you arrange yourself.** Press and hold a card to move it or to
  throw it in the trash. Ctrl-click several to act on them together, or
  gather them in groups, folders with their own name, colour and picture.
- **Modpacks in one click.** A pack from the catalogue installs with its
  Minecraft version and loader, and takes its own logo as the instance's
  picture.
- **Host.** Create a server from an instance or a preset and run it from the
  launcher: console, players, mods, files, backups.
- **Two engines.** Java, as Minecraft ships it, or **Kizaflux**, an
  experimental Rust engine built on [Horizon](https://github.com/horizon-rust/horizon)
  (Minecraft 26.3 only, for now).
- **Crashes explained.** The crash report names the mod at fault, and with
  your permission reports itself.

It is in closed beta: the installer is handed out to testers, not downloadable
publicly yet.

## Layout

| | |
|---|---|
| `KizaaModEngine-Tauri/` | the launcher — Tauri, Rust backend, React interface |
| `KizaaModEngine-Tauri/kiza-base-mod/` | the in-game client, built for Fabric and three Forge generations |
| `KizaaModEngine-Tauri/kiza-setup/` | Kiza Setup — the installer, an application rather than a wizard |
| `KizaaModEngine-Tauri/kizaflux/` | Kizaflux — the bridge between the launcher and Horizon, the Rust engine |
| `KizaaModEngine-Tauri/cloudflare/` | the update service: a Worker serving signed releases from R2 |
| `.github/workflows/` | tests on every push, a signed release on every tag |

## Building

```bash
cd KizaaModEngine-Tauri
npm install
npm run tauri dev
```

A release needs `KIZAMODS_CURSEFORGE_API_KEY` and a signing key. It produces one
file — the installer carries the launcher inside it, so nothing is downloaded
during installation.

```bash
npm run build:installer
```

## Updates

Every release is signed at build time with a key that never leaves the release
machine, and checked against a public key compiled into the launcher. A
signature that does not verify is refused, not installed.

The launcher asks a Cloudflare Worker first and falls back to GitHub releases if
it does not answer. Releases go out on a channel: the Beta is the only one open,
and only an installer carrying a Beta key joins it.

## Support

Kiza is written by one person. No studio, no ads in the launcher, no paid
edition planned.

**[Support on Patreon](https://www.patreon.com/cw/nefcode)**

---

<div align="center">
<sub>Independent project. Not affiliated with Mojang, Microsoft, Modrinth or CurseForge.<br>
Minecraft is a trademark of Mojang Synergies AB.</sub>
</div>
