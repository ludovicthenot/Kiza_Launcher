# Kiza Launcher: rules for agents

A Minecraft launcher for Windows: Tauri, a Rust backend (`KizaaModEngine-Tauri/src-tauri/`), a React and
TypeScript interface (`KizaaModEngine-Tauri/src/`), the in-game Kiza Client (`kiza-base-mod/`), the installer
(`kiza-setup/`). Read [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) once: its last part is the full AI policy.

## Rules that bite

- **Mark what you post.** A pull request starts with `<Model name> here:` (your real model, e.g.
  `Claude Opus 4.5 here:`), then `> 🤖 Opened by <login>'s AI agent (<tool>, <model>), not by <login>
  personally.`, where `<login>` is the account it is opened from (`gh api user --jq .login`). Issues say
  "Filed by", reviews "Review by". Every comment starts with `<Model name> here:`. Write only as the person
  you work for.
- **Attribution.** Commits end with `Assisted-by: <model> (<tool>)`. Never `Co-authored-by:`.
- **Pull requests go to `contributor`**, never to `main`. Small (under ~500 lines), one change each.
- **Run the checks first** (.github/CONTRIBUTING.md): `npm run typecheck`, `npm run test`, and for Rust
  `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- **English everywhere**: code, comments, commits, pull requests.
- **Never commit** secrets, keys, tokens (`.tauri-keys/`), Mojang's files, or code whose licence is not on
  the list in .github/CONTRIBUTING.md.
- **Contributors first**: `gh pr list --state open --search <area>` before you start; never duplicate theirs.

The maintainer's own agents follow his instructions instead of the marking and attribution lines above.
