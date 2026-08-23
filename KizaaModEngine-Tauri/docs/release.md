# Releasing Kiza Launcher Alpha

Kiza Launcher Alpha ships a Windows NSIS installer and Tauri v2 updater
artifacts through GitHub Releases. The updater only trusts artifacts signed by
the public key embedded in `src-tauri/tauri.conf.json`.

## One-time setup

1. Keep `origin` set to `https://github.com/ludovicthenot/Kiza_Launcher.git`.
2. In GitHub, open **Settings -> Secrets and variables -> Actions** and add:
   - `TAURI_SIGNING_PRIVATE_KEY` (required): the complete private updater key.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional): the key password. Create
     the secret with an empty value only if the key is not password protected.
   - `KIZAMODS_CURSEFORGE_API_KEY` (required): the CurseForge API key embedded
     at compile time by the existing `option_env!` integration.
3. Back up the private key and password in a secure vault. Never commit either.
   Losing the key prevents installed versions from trusting future updates.

`GITHUB_TOKEN` is supplied automatically by GitHub Actions. It is used only by
the release job and must not be embedded in the launcher.

## Private repository limitation

The configured endpoint is exactly:

`https://github.com/ludovicthenot/Kiza_Launcher/releases/latest/download/latest.json`

GitHub requires authentication to download release assets from a private
repository. A launcher installed on an end-user machine has no safe GitHub
token, so this endpoint will return an authorization/not-found response while
the repository remains private. Before distributing automatic updates, either
make this repository public or publish the same signed artifacts and manifest
from a public update host. Do not solve this by embedding a GitHub token.

## Cut a release

From `KizaaModEngine-Tauri/`, update all three version files together:

```powershell
npm run bump-version
node scripts/verify-release-config.js
```

After committing the integrated changes, create and push the matching tag:

```powershell
git tag v0.0.225
git push origin main
git push origin v0.0.225
```

The tag must equal `v` plus the version in `package.json`, `Cargo.toml`, and
`tauri.conf.json`. `.github/workflows/release.yml` then builds NSIS, signs its
updater bundle, uploads the installer and `.sig`, and publishes `latest.json`.
The manifest contains the updater artifact signature; the private signing key
never leaves GitHub Actions.

## Launcher update flow

The Tauri desktop app performs one silent metadata check at startup. When an
update exists, a global notification opens the updater section in Settings.
The user then starts the download and separately chooses **Install and
restart** or **Later**; no check ever downloads or installs automatically.

Tauri's JavaScript `Update` object owns the verified downloaded bytes as a
native resource. Kiza keeps that object in a global store, so closing and
reopening Settings does not lose a ready update. The resource lasts for the
current launcher process only. If the launcher exits before installation, the
next launch checks again and the user downloads the update again.

## CI versus release

Pull requests and pushes run `.github/workflows/ci.yml`. Its NSIS build merges
`src-tauri/tauri.ci.conf.json`, which disables updater artifact generation, so
CI never needs release secrets. Only a `v*` tag invokes the signed release job.

## Local verification

```powershell
npm run typecheck
npm run test
node scripts/verify-release-config.js
npm run tauri -- build --bundles nsis --config src-tauri/tauri.ci.conf.json
```

For an intentionally signed local release build, set
`TAURI_SIGNING_PRIVATE_KEY` and, when applicable,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the process environment, then run
`node scripts/tauri-build-signed.js`. Never place those values in a tracked
file or shell history.

For local CurseForge access, either enter the key in the launcher settings so
it is stored by the OS credential keyring, or set
`KIZAMODS_CURSEFORGE_API_KEY` only in the build process environment. Do not use
a committed `.env` file. Any key compiled into a desktop executable can be
extracted; a server-side proxy that owns the CurseForge credential is the
recommended production design once distribution expands.

The Tauri updater signature does not provide Windows Authenticode signing. A
separate trusted code-signing certificate is required to reduce SmartScreen
warnings for first-time installs.
