# Contributing to Kiza

Thanks for helping. Kiza is written by one person, so a pull request that is
easy to read is the one that gets merged.

## Where to open your pull request

Open it on the **`contributor`** branch, not on `main`.

```bash
git clone https://github.com/ludovicthenot/Kiza_Launcher.git
cd Kiza_Launcher
git switch contributor
git switch -c my-change
```

Pull requests on `contributor` are reviewed there. What is kept is then moved
to `main` by the maintainer, in a pull request of its own.

## Before you open it

From `KizaaModEngine-Tauri/`:

```bash
npm ci
npm run typecheck
npm run test
```

And for the Rust side, in `KizaaModEngine-Tauri/src-tauri/`:

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
```

The same checks run on every pull request (`.github/workflows/ci.yml`). A
first-time contributor's checks start once the maintainer approves them.

## What makes a good pull request

- One change per pull request, with a title that says what it does.
- What you changed, why, and how you tested it (the template asks for it).
- Commits and comments in English.
- No secrets, keys or tokens, and no files from Mojang.

## Talk first

For anything bigger than a fix, say what you plan on the
[Discord](https://discord.gg/VRJKU4u3pU) before you start, so no work is lost.
