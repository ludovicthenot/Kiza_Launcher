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
- **Issues Maker keys.** `/makerkey` prints one, once, privately. The service
  keeps only its hash, so it genuinely cannot be shown again.

It never reads messages. The only intents it asks for are Guilds and Guild
Members, because watching roles is the whole job.

## Running it on the panel

The server is a Node.js egg, which is all this needs.

1. **Files → Upload**: `index.js`, `package.json`.
2. **Startup**: main file `index.js`. If the egg has an install command, leave
   it as `npm install`; otherwise run `npm install` once from the console.
3. **Startup → Variables**, or the panel's environment editor:

   | Variable | What it is |
   | --- | --- |
   | `DISCORD_TOKEN` | the bot token from the Discord app's Bot tab |
   | `DISCORD_APPLICATION_ID` | the application id from General Information |
   | `DISCORD_GUILD_ID` | your server's id (right-click the server, Copy Server ID) |
   | `KIZA_SERVICE` | `https://kiza-updates.nefer-blcdureste.workers.dev` |
   | `KIZA_BOT_TOKEN` | the same value as the Worker's `BOT_TOKEN` secret |
   | `ROLE_EXPERIMENTAL` | role ids that grant the alpha, comma separated |
   | `ROLE_BETA` | role ids that grant beta, comma separated |
   | `ROLE_STAFF` | optional: who may run the commands, besides Manage Server |

4. **Start.** The console should say it signed in and registered its commands.

The bot needs the **Server Members Intent** switched on in the Discord app's
Bot tab, or Discord will not tell it about role changes.

## Invite it with

`bot` and `applications.commands` scopes, and no permissions beyond reading the
member list. It sends nothing to channels: every reply is ephemeral, to the
person who ran the command.

## The one thing worth knowing

Revoking removes somebody from the list; a pass already on their machine keeps
working until it expires, which is up to thirty days. The alternative — a list
of revoked passes checked on every request — is a second source of truth, and
the design avoids it on purpose. If access has to end *now*, rotate the
service's `ACCESS_SECRET`: every pass in the world stops at once.
