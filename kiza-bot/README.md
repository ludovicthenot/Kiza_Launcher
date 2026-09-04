# Kiza's test-access bot

Decides who may have Kiza's test builds, and writes that down where the update
service reads it. It is the only part of the system with an opinion about
people; everything downstream checks a list and a signature.

## What it does

- **Follows roles.** Somebody who gains the patron, booster or alpha role is
  granted; somebody who loses it is revoked. Leaving the server revokes.
- **Takes decisions by hand.** `/alpha add @someone` for the people no rule
  covers. A grant made by hand is never undone by a role change — the note is
  what tells the two apart.
- **Watches how many machines an account uses.** Two is the limit, because a
  desktop and a laptop is the ordinary case and a third is somebody else's.
  `/alpha check` shows the count; `/alpha reset` forgets it for somebody who
  genuinely changed computer.
- **Issues Maker keys.** `/makerkey` prints one, once, privately. The service
  keeps only its hash, so it genuinely cannot be shown again.
- **Runs a complete ticket workflow.** A button opens a configurable Discord
  modal, creates a private channel and lets the team accept, reject, close and
  finally delete the ticket. Decisions can automatically add the matching
  Discord role and remove the opposite one.

It never listens to ordinary messages. The only intents it asks for are Guilds
and Guild Members; ticket content comes from Discord interactions and modals.

## Ticket setup

Run this once as an administrator:

```text
/kiza-ticket setup [salon] [categorie] [en_attente] [accepter] [refuser] [staff] [role_accepte] [role_refuse]
```

- When `salon` is omitted, the bot creates `creer-un-ticket` and publishes the
  ticket panel there. Supplying a text channel publishes the panel in that
  existing channel instead.
- `categorie`, `en_attente`, `accepter` and `refuser` let you select existing
  locations. Any omitted location is reused from the current setup or created
  automatically. Selected tracking channels are moved into the ticket category
  and inherit its private permissions.
- `staff` is the optional team role that may see and process tickets.
- `role_accepte` and `role_refuse` are optional roles applied to the ticket
  author after the decision. The opposite role is removed automatically.

Other administrator commands:

| Command                       | Purpose                                     |
| ----------------------------- | ------------------------------------------- |
| `/kiza-ticket configuration`  | Show channels, team role and decision roles |
| `/kiza-ticket panel [salon]`  | Refresh or move the creation panel          |
| `/kiza-ticket role definir`   | Change the accepted or rejected role        |
| `/kiza-ticket role supprimer` | Disable a decision role                     |

The panel text, colours, channel names and the complete question definitions
also live in `tickets.config.json`. The eleven requested application topics are
grouped into five thematic questions so the candidate completes one modal without
intermediate buttons — five is also the most Discord will show. Runtime channel
IDs and ticket records are stored in `tickets.data.json`; keep this file on the
panel when updating the bot, but do not commit it.

`grantOnAccept` is the channel a candidate receives the moment their ticket is
accepted; it is set to `alpha`. Left at `null`, accepting an application grants
nothing and somebody has to remember to run `/alpha add` afterwards. If the
service cannot be reached the decision is still recorded and the person who
took it is told, in that reply, that the access has to be given by hand.

Each question carries a `label` of at most 45 characters and a `description` of
at most 100 shown under it — Discord's limits, not ours. A question that gives
only a long `label` is split at a word boundary as a fallback, which reads worse
than writing the two halves yourself.

    npm run verify

builds the modal and puts it through discord.js's own validation. Worth running
after editing the questions: a modal is checked when it opens, in front of the
applicant, and a length one character over means the button does nothing at all
— no error, no log line, just a candidate who concludes the alpha is closed.

## Running it on the panel

The server is a Node.js egg, which is all this needs.

1. **Files → Upload**: `index.js`, `package.json`.
2. **Startup**: main file `index.js`. If the egg has an install command, leave
   it as `npm install`; otherwise run `npm install` once from the console.
3. **Startup → Variables**, or the panel's environment editor:

   | Variable                 | What it is                                                |
   | ------------------------ | --------------------------------------------------------- |
   | `DISCORD_TOKEN`          | the bot token from the Discord app's Bot tab              |
   | `DISCORD_APPLICATION_ID` | the application id from General Information               |
   | `DISCORD_GUILD_ID`       | your server's id (right-click the server, Copy Server ID) |
   | `KIZA_SERVICE`           | `https://kiza-updates.nefer-blcdureste.workers.dev`       |
   | `KIZA_BOT_TOKEN`         | the same value as the Worker's `BOT_TOKEN` secret         |
   | `ROLE_ALPHA`             | role ids that grant the alpha, comma separated            |
   | `ROLE_BETA`              | role ids that grant beta, comma separated                 |

4. **Start.** The console should say it signed in and registered its commands.

The bot needs the **Server Members Intent** switched on in the Discord app's
Bot tab, or Discord will not tell it about role changes.

## Who can run the commands

Administrators, and only them. Discord hides the commands from everybody else,
and the bot refuses them as well — hidden is not refused, and what is behind
these commands is the list that decides who receives unreleased builds.

There is no role setting that widens this on purpose: a second way in is a
second thing to get wrong in a panel at two in the morning.

## Invite it with

`bot` and `applications.commands` scopes. For the ticket system, give it **View
Channels**, **Send Messages**, **Embed Links**, **Read Message History**,
**Manage Channels** and, when decision roles are enabled, **Manage Roles**.
The bot's role must be placed above the accepted and rejected roles. Private
command responses stay ephemeral; only ticket panels, ticket forms and status
cards are posted in channels.

## The one thing worth knowing

Revoking removes somebody from the list; a pass already on their machine keeps
working until it expires, which is up to thirty days. The alternative — a list
of revoked passes checked on every request — is a second source of truth, and
the design avoids it on purpose. If access has to end _now_, rotate the
service's `ACCESS_SECRET`: every pass in the world stops at once.
