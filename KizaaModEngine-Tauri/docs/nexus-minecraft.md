# Nexus Mods, for Minecraft only

What Nexus Mods can and cannot do for a Minecraft launcher, found out by asking
its APIs directly on 2026-09-12, and what has been built so far.

## The short version

Nexus is a small, uneven source for Minecraft and it is worth having for what
it is, not for what CurseForge and Modrinth are. Its Minecraft section holds
**654 entries**, of which **556** once adult content is excluded. Most are
texture packs, worlds and presets rather than mods a loader would load. The
most-downloaded content in the section is adult. Nothing on Nexus records which
Minecraft version or loader a file is for.

Everything needed to list and search it is public and needs no key. Downloading
needs a key, and for free accounts, a click on the website.

## The two APIs

### REST v1 — `https://api.nexusmods.com/v1/`

The launcher's `nexus_api.rs` already speaks this. It authenticates with an
`apikey` header and identifies the application with `application-name` and
`application-version`, which Nexus require.

| Endpoint | What it does |
|---|---|
| `GET /users/validate` | Confirms a key and says whether the account is premium |
| `GET /games/minecraft/mods/{id}` | One mod page |
| `GET /games/minecraft/mods/{id}/files` | Its files |
| `GET /games/minecraft/mods/{id}/files/{file}/download_link` | A short-lived download URL |
| `GET /games/minecraft/mods/md5_search/{md5}` | Which mod a file on disk came from |
| `GET /games/minecraft/mods/latest_added`, `latest_updated`, `trending` | Lists, no query |
| `GET /games/minecraft/mods/updated?period=1d\|1w\|1m` | What changed lately |

**v1 has no search.** There is no endpoint that takes a name.

### GraphQL v2 — `https://api.nexusmods.com/v2/graphql`

What the website itself uses. Public, introspectable, and readable without a
key. This is where search lives:

```graphql
mods(filter: ModsFilter, sort: [ModsSort!], count: Int, offset: Int) {
  totalCount
  nodes { modId name version summary author downloads endorsements updatedAt
          pictureUrl thumbnailUrl adultContent modCategory { name } game { domainName } }
}
```

`ModsFilter` takes `gameDomainName`, `name` (with `op: WILDCARD`), `adultContent`,
`categoryName`, `author`, `updatedAt` and more. `modFiles(modId, gameId)` lists
a mod's files with `fileId name version size category date description`.

Nexus's own client (`@nexusmods/nexus-api`, used by Vortex) does its searching
through this same endpoint.

## Downloading

This is the part with rules, and the rules are Nexus's.

- A **premium** account may call `download_link` with only the API key.
- A **free** account may not. The website's "Download with manager" button
  produces an `nxm://minecraft/mods/{id}/files/{file}?key=…&expires=…` link,
  and only with that `key` and `expires` will `download_link` answer. The key
  is short-lived. This is deliberate: it is how Nexus keeps free downloads on
  the website, where the adverts are.
- Download links are short-lived and must not be cached.

The launcher already registers itself as the `nxm://` handler and already
resolves the link (`handle_nxm_link`). What it does with the result is generic
— it saves a zip to `downloads/` — and that is the piece a Minecraft
integration would replace: land the file in the instance the person was
looking at, in the folder its kind belongs in.

### Getting a key

Nexus wants each person to use their own key. Two ways:

1. The person pastes it from their account page. The launcher has this today
   (`validate_nexus_key`, stored in the credential store).
2. **SSO**: the launcher opens a websocket to `wss://sso.nexusmods.com`, sends
   an `application_slug`, and the person approves it on the website, which
   sends the key back. This needs Nexus staff to register the slug. It is the
   nicer flow and it is not available until asked for.

## Rate limits

20,000 requests per day; 500 per hour once the day's are gone. Read from the
`x-rl-daily-remaining` and `x-rl-hourly-remaining` response headers. A search
that pages through results costs one request per page; nothing here comes
close.

## What Nexus does not know, and what that means

Modrinth and CurseForge record, per release, which Minecraft versions and
loaders it is for. Nexus records a free-text version and a file description.
There is no field to ask.

So a Nexus search result **cannot be badged** "works with 1.21.1 / Fabric" the
way the other two sources are. Compatibility is only knowable once the jar is
on disk and read — which the compatibility checker already does for every jar,
whatever its source. The interface has to say "unknown" for a Nexus result,
not "all", and the person has to be told before the download that the
launcher will only know afterwards.

## Content that is not for the mods folder

Nexus's categories for Minecraft, from the live facet list, and what the
launcher can do with each:

| Nexus category | Launcher kind |
|---|---|
| Resource/Texture pack | resource pack |
| Shaders | shader pack |
| World Save, Maps – * | a world, offered to Worlds & backups |
| Gameplay, NPCs and Creatures, Items, Armour, Weapons, Miscellaneous, … | mod |
| anything else | other — shown, with its page, not offered to a folder |

Adult content is filtered out by default with Nexus's own `adultContent` flag,
which uploaders set and Nexus moderates. It is a filter, not a judgement: a
person who wants it can ask.

## What is built

`src-tauri/src/nexus_minecraft.rs`:

- the game domain is a constant, not a parameter — no call in the module can
  be about another game, and a result naming another game is dropped even if
  Nexus sends it;
- `search(text, page, per_page, adult)` over GraphQL, adult off by default,
  sorted by downloads, mapped into `NexusHit` with the launcher's kind and the
  page URL;
- `files(mod_id)` over GraphQL;
- category-to-kind mapping;
- tests, including one against a captured real response
  (`fixtures/nexus-minecraft-search.json`).

Two commands are registered, `nexus_search_minecraft` and
`nexus_minecraft_files`, and nothing in the interface calls them yet.

## What is not built, in the order it should be

1. **A source in Discover.** The tab already has a source picker with Modrinth
   and CurseForge; Nexus is a third entry. Results carry no version badge and
   say so. Kinds other than mod/pack/shader show the page and nothing else.
2. **Downloads that land somewhere.** Premium: call `download_link` and
   install into the instance by kind. Free: open the mod page, and when the
   `nxm://` link comes back, install it into the instance that was open — the
   handler exists; it needs to remember the instance and route by kind.
3. **Provenance.** Record `nexus` / mod id / file id the way Modrinth and
   CurseForge installs are recorded, so the update centre and the fixer know
   where a file came from. `md5_search` can recover this for files already on
   disk.
4. **SSO**, once Nexus have registered an application slug for Kiza.

## What to decide before building step 1

- Whether Nexus appears in "All sources" or only when chosen. Given the
  catalogue — 556 entries, most of them not mods — mixing it into a search
  across sources would mostly add texture packs and worlds to mod results.
  Chosen explicitly seems right.
- Whether to show adult content at all, even behind a switch. The filter is
  one line either way; the question is a product one.
