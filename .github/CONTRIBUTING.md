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

- One change per pull request, small enough to review (under about 500 lines),
  with a title that says what it does.
- What you changed, why, and how you tested it (the template asks for it).
- English everywhere: code, comments, commits, the pull request.
- Before starting, look for an open pull request on the same thing
  (`gh pr list --state open --search <area>`) and never duplicate someone's work.
- No secrets, keys or tokens, and no files from Mojang.

## Only code you may use

Before borrowing from another project, check its licence:

- **Fine to read, copy or adapt**, with the licence kept and the source named in
  the pull request: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, zlib, 0BSD,
  MIT-0, Unlicense, CC0-1.0.
- **Never** read, copy, translate or paraphrase, and never paste into an AI tool:
  GPL and LGPL code, Creative Commons licences other than CC0, "source available"
  or custom licences, all rights reserved (OptiFine), anything with no licence or
  an unclear one, and Mojang's code and files.

## Written with an AI

Pull requests written with an AI (Claude, GPT, Gemini, Copilot, Cursor, a local
model, anything) are welcome. They have to say so: one that hides it is closed
without review. This applies to everything an AI writes here: pull requests,
issues, reviews and comments. Agents find the same rules in
[AGENTS.md](../AGENTS.md).

### Mark what an agent posts

A **pull request** starts with two lines: the model introducing itself, then who
ran it, with which tool:

```
Claude Opus 4.5 here:

> 🤖 Opened by <login>'s AI agent (Claude Code, Claude Opus 4.5), not by <login> personally.
```

- `<Model name> here:` uses the model's real name, never just "AI":
  `Claude Opus 4.5 here:`, `GPT-5 here:`, `Gemini 2.5 Pro here:`, `Qwen3 Coder here:`.
- `<login>` is the GitHub account the pull request is opened from
  (`gh api user --jq .login`). Write only as the person you work for: never
  another account, never the maintainer's.

**Issues** say "Filed by" instead of "Opened by", **reviews** "Review by".
**Every comment** an agent writes starts with `<Model name> here:`. A human
writing their own reply under it does not use the prefix.

### Attribution in commits

Each commit an agent writes ends with a trailer naming it:

```
Assisted-by: Claude Opus 4.5 (Claude Code)
```

Use `Assisted-by:`, **not** `Co-authored-by:`: a co-author trailer would add the
model's account to the repository's contributors; this one does not.

### A human answers for it

Whoever opens the pull request:

- has **read** every line of the change, and can explain it in review;
- has **run** it: the checks above, and the launcher itself when the change
  touches it;
- answers review comments, with or without the AI's help.

A pull request nobody can explain, or that its author has not run, is closed.

Kiza is reviewed by one person. Knowing which parts were written by a model, and
by which one, tells the reviewer where to look harder, and keeps the project
honest about where its code comes from.

## Talk first

For anything bigger than a fix, say what you plan on the
[Discord](https://discord.gg/VRJKU4u3pU) before you start, so no work is lost.
