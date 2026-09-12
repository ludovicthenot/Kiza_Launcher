# Where Minecraft content comes from

What catalogues exist for Minecraft, what each is good for, and what the
launcher asks them. Found by calling the APIs on 2026-09-12, not by reading
about them.

## The short version

For **mods**, there are two catalogues and there is no third. Modrinth and
CurseForge hold essentially every mod that exists; everything else is either
a repost site with no API or a niche (Nexus: 654 entries, mostly not mods,
removed in `ac6258f`). The launcher already has both.

What the launcher did not have was Modrinth's **search**. Modrinth's API is
the best in the ecosystem and the launcher was using a third of it — the words
typed, the game version, the loader, and two orderings. It now uses all of it.

For **modpacks**, there is a real gap: **FTB**. Feed The Beast left CurseForge
in 2021 and their packs — Direwolf20, Skies, Infinity, Stoneblock — are only on
their own API. It is public, clean and structured. It is the one catalogue
that adds something the launcher does not already have.

## Modrinth, fully asked

`https://api.modrinth.com/v2/search` is faceted: each facet is a list of
alternatives, the facets are ANDed. One request:

```
facets=[["versions:1.21.1"],["categories:fabric"],["categories:optimization"],
        ["client_side:required"],["server_side:unsupported"]]
index=downloads
```

returns, in order: Sodium, Iris, Entity Culling, ImmediatelyFast, Sodium Extra.
Which is to say the search already knew the answer to "what makes my game
faster" and the launcher was not asking it.

What can be narrowed by, all now wired through `SearchFilters` in
`modrinth_api.rs` and the `modrinth_search_mods` command:

| Facet | Values | Note |
|---|---|---|
| `versions` | any Minecraft version | already used |
| `categories` (loader) | `fabric`, `forge`, `neoforge`, `quilt` | already used |
| `categories` (kind) | see below | **new** — several are ORed |
| `client_side` / `server_side` | `required`, `optional`, `unsupported` | **new** |
| `index` (ordering) | `relevance`, `downloads`, `follows`, `newest`, `updated` | `follows` and `newest` **new** |

Modrinth's categories, read from `/v2/tag/category`:

- **mods** (19): adventure, cursed, decoration, economy, equipment, food,
  game-mechanics, library, magic, management, minigame, mobs, optimization,
  social, storage, technology, transportation, utility, worldgen
- **shaders**: atmosphere, bloom, cartoon, colored-lighting, cursed, fantasy,
  foliage, high, low, medium, path-tracing, pbr, potato, realistic,
  reflections, screenshot, semi-realistic, shadows, vanilla-like
- **resource packs**: 8x-, 16x, 32x, 48x, 64x, 128x, 256x, 512x+, audio,
  blocks, combat, core-shaders, cursed, decoration, entities, environment,
  equipment, fonts, gui, items, locale, modded, models, realistic, simplistic,
  themed, tweaks, utility, vanilla-like

Two of these deserve their own button rather than a dropdown:

- **`optimization` + `client_side:required`** is "make it faster", and it is
  the exact list the performance conversation keeps coming back to.
- **`server_side:unsupported`** is "client-only": mods that can join any
  server. `client_side:unsupported` is the opposite, what a server needs and
  a player does not — which is what the "server mods only" export already
  reasons about, from the other end.

`follows` is the ordering nobody else offers. Downloads count everyone who
ever tried a mod; follows count people who intend to come back to it.

### What is not wired

The interface. The backend accepts `categories`, `clientSide`, `serverSide`
and the two new orderings; `ModrinthSearchRequest` in `queries.ts` carries
them; nothing in the Discover tab sets them yet. That is a set of filter
chips under the search box, per project type, and a sort menu with five
entries instead of three.

## CurseForge

Already integrated. Its search (`/v1/mods/search`) filters by game version,
loader (`modLoaderType`), class (mods / packs / shaders / worlds) and
category id, and sorts by featured, popularity, last updated, name, author,
total downloads. It has no client/server side and no follows. Nothing to add;
what it has is used.

## FTB — the one worth adding

`https://api.modpacks.ch/public/`, no key, no rate limit stated.

| Endpoint | What it gives |
|---|---|
| `modpack/all` | every pack id (92 at the time of writing) |
| `modpack/search/{limit}?term=…` | pack ids matching a name, plus CurseForge pack ids |
| `modpack/{id}` | name, description, tags (`1.21.1`, `Tech`, `Magic`, `Large`…), art, installs, plays, and every version with its **targets**: `minecraft 1.21.1`, `neoforge 21.1.74`, `java 21.0.4` |
| `modpack/{id}/{version}` | the full file list: path, URL, SHA-1, size, `clientonly` / `serveronly` / `optional`, and the CurseForge project+file each mod came from |

That last table is the point. An FTB version manifest is a complete,
hash-verified, side-aware recipe for an instance — the same shape the
launcher's own export writes — with the loader and Java version declared.
Installing one is: create the instance from the targets, fetch each file to
its path, verify the hash. The CurseForge cross-references mean provenance
can be recorded for every mod, so the update centre and the fixer know where
each came from.

What it does not have: individual mods. It is packs only, and the search is by
name only. Tags carry the version and the theme, so "1.21 tech packs" is a
filter on the `all` list, done locally — 92 packs is nothing to hold.

### What building it looks like

1. `ftb_api.rs`: `all`, `search`, `pack`, `version` — four GETs and their
   types, with a test against a captured manifest.
2. A "Modpacks" source in Discover that lists FTB packs with their tags and
   version targets, filtered locally by Minecraft version.
3. Install: instance from targets, files by manifest, hash-checked, with the
   same progress the import shows; provenance from the CurseForge references.
4. Update: a pack's newer version is a manifest diff — files added, removed,
   changed by hash — which is exactly what `restore_points` and the lockfile
   already model.

## What was rejected, and why

- **Nexus Mods** — 654 Minecraft entries, most not mods, the most-downloaded
  adult, no version or loader metadata anywhere. Removed.
- **Planet Minecraft** — the largest source of maps, skins and packs, and no
  API; scraping only, against their terms.
- **9Minecraft, MinecraftMods.com and the like** — reposts of other people's
  mods, often out of date, no API.
- **Hangar (PaperMC), SpigotMC** — good APIs, but for server plugins, which
  the launcher does not run.
- **Technic, ATLauncher** — older pack platforms; Technic's API is
  unmaintained, ATLauncher's is its own launcher's.
