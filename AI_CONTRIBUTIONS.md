# AI-assisted contributions

Pull requests written with an AI (Claude, GPT, Gemini, Copilot, Cursor, a local
model, anything) are welcome. They have to say so. A pull request that hides it
is closed without review.

This applies to everything an AI writes on this repository: pull requests,
issues, reviews and comments.

## 1. Mark what an agent posts

**A pull request** starts with two lines: the model introducing itself, then
who ran it, with which tool:

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

## 2. Attribution in commits

Each commit an agent writes ends with a trailer naming it:

```
Assisted-by: Claude Opus 4.5 (Claude Code)
```

Use `Assisted-by:`, **not** `Co-authored-by:`. On this repository a co-author
trailer would add the model's account to the contributors list; this one does
not. (Horizon asks for `Co-Authored-By:`; Kiza does not.)

## 3. A human answers for it

Whoever opens the pull request:

- has **read** every line of the change, and can explain it in review;
- has **run** it: the checks in [CONTRIBUTING.md](CONTRIBUTING.md), and the
  launcher itself when the change touches it;
- answers review comments, with or without the AI's help.

A pull request nobody can explain, or that its author has not run, is closed.

## 4. Only code you may use

An agent copies what it has read. Before it reads another project to borrow from
it, check its licence:

- **Fine to read, copy or adapt**, with the licence kept and the source named in
  the pull request: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, zlib, 0BSD,
  MIT-0, Unlicense, CC0-1.0.
- **Never** read, copy, translate or paraphrase, and never paste into an AI tool:
  GPL and LGPL code, Creative Commons licences other than CC0, "source available"
  or custom licences, all rights reserved (OptiFine), anything with no licence or
  an unclear one, and Mojang's code and files.

## 5. The same rules as everyone

AI pull requests follow [CONTRIBUTING.md](CONTRIBUTING.md) like any other:

- they go to the **`contributor`** branch, not `main`;
- one change per pull request, small enough to review (under about 500 lines);
- English everywhere: code, comments, commits, the pull request;
- before starting, look for an open pull request on the same thing
  (`gh pr list --state open --search <area>`) and never duplicate a person's work;
- no secrets, keys or tokens.

## Why

Kiza is reviewed by one person. Knowing which parts were written by a model, and
by which one, tells the reviewer where to look harder, and keeps the project
honest about where its code comes from. The rules follow the ones
[Horizon](https://github.com/horizon-rust/horizon) uses for its agents.
