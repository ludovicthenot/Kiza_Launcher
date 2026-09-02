/**
 * The bot that decides who may test Kiza.
 *
 * It holds the only opinion in the system about *people*: who is a patron, who
 * boosted the server, who was added by hand. The update service holds no
 * opinion at all — it reads a list and checks a signature. So this is where a
 * decision is made, and everything downstream is arithmetic.
 *
 * Two ways somebody lands on the list:
 *
 * - **By having a role.** Discord tells us when a member's roles change, and a
 *   member who gains the patron or alpha role is granted, one who loses it is
 *   revoked. Boosting counts, because Discord models a booster as somebody
 *   with the premium role.
 * - **By being added.** `/alpha add @someone`, for the people who do not fit
 *   any rule — a friend, a translator, somebody who found a bug worth
 *   thanking.
 *
 * What it never does is hand out the Maker. That edition is opened by a key
 * issued with its installer, and `/makerkey` prints one — once, to the person
 * who ran it, because the service stores only its hash and cannot show it
 * again.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

/* ------------------------------------------------------------- configuration */

/**
 * Reads a `.env` file sitting beside this one, if there is one.
 *
 * Game panels give you a Files tab and a Startup tab, and the Startup tab only
 * offers the variables its template declared — which never include a Discord
 * token or the address of somebody's update service. A file the bot reads
 * itself is the one place on those panels where arbitrary settings can go.
 *
 * Real environment variables win. Where the panel *can* set them, they are the
 * better answer: they are not sitting in a file that a backup, a support
 * screenshot or a shared archive would carry with it.
 *
 * No dependency and no cleverness: names, an equals sign, values that may
 * contain equals signs of their own, `#` comments, and surrounding quotes
 * stripped because half the world writes them and half does not.
 */
function readEnvFile() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [path.join(here, ".env"), path.resolve(".env")]) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const at = trimmed.indexOf("=");
      if (at === -1) continue;
      const name = trimmed.slice(0, at).trim();
      if (!name || process.env[name] !== undefined) continue;
      let value = trimmed.slice(at + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[name] = value;
    }
    console.log(`Read settings from ${file}.`);
    return;
  }
}

readEnvFile();

/**
 * Everything this bot needs, and nothing it can work without.
 *
 * Checked at the top rather than discovered at three in the morning when
 * somebody's grant silently does nothing: a bot that starts without knowing
 * where the service is would answer "done" and change nothing.
 */
const config = {
  token: required("DISCORD_TOKEN"),
  applicationId: required("DISCORD_APPLICATION_ID"),
  guildId: required("DISCORD_GUILD_ID"),
  service: required("KIZA_SERVICE").replace(/\/+$/, ""),
  serviceToken: required("KIZA_BOT_TOKEN"),
  /** Roles that grant a channel on their own. Empty means "nobody, yet". */
  roles: {
    alpha: list("ROLE_ALPHA"),
    beta: list("ROLE_BETA"),
  },
};

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `Missing ${name}. Put it in a .env file beside index.js — see .env.example — ` +
        "or set it as a real environment variable if your panel allows one.",
    );
    process.exit(1);
  }
  return value;
}

function list(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------- the service */

/**
 * Talks to the update service.
 *
 * The shared token goes in a header and never in a log line: a bot that prints
 * its own requests is a bot that puts the key to every test channel into a
 * console anybody with panel access can read.
 */
async function service(path, body) {
  const response = await fetch(`${config.service}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bot ${config.serviceToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const said = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(said);
  } catch {
    // Left null; the caller reports the status instead of a parse error.
  }
  if (!response.ok) {
    throw new Error(parsed?.error ?? `The service answered ${response.status}.`);
  }
  return parsed;
}

const grant = (discordId, channels, note) =>
  service("/v1/access/grant", { discordId, channels, note });
const revoke = (discordId) => service("/v1/access/revoke", { discordId });
const lookup = (discordId) => service(`/v1/access/member/${discordId}`);
const makerKey = (note) => service("/v1/access/setup-key", { note });
const resetMachines = (discordId) => service("/v1/access/reset", { discordId });

/* ------------------------------------------------------- roles into channels */

/** What a member's roles entitle them to, by themselves. */
function channelsFromRoles(member) {
  const held = new Set(member.roles.cache.map((role) => role.id));
  const channels = [];
  for (const [channel, roles] of Object.entries(config.roles)) {
    if (roles.some((role) => held.has(role))) channels.push(channel);
  }
  return channels;
}

/**
 * Brings the list back in line with somebody's roles.
 *
 * Only for grants this bot made from roles: a person added by hand keeps what
 * they were given, because "added by hand" is a decision and losing a role is
 * not a reason to undo it. The note is what tells the two apart, which is why
 * it is written rather than left blank.
 */
async function followRoles(member) {
  const wanted = channelsFromRoles(member);
  let current = null;
  try {
    current = await lookup(member.id);
  } catch (error) {
    console.error(`Could not read ${member.id}: ${error.message}`);
    return;
  }

  const byHand = current?.note && !String(current.note).startsWith("role:");
  if (byHand) return;

  const has = (current?.channels ?? []).slice().sort().join(",");
  const should = wanted.slice().sort().join(",");
  if (has === should) return;

  try {
    if (wanted.length === 0) {
      await revoke(member.id);
      console.log(`${member.user.tag} lost their test access.`);
    } else {
      await grant(member.id, wanted, `role:${wanted.join("+")}`);
      console.log(`${member.user.tag} now has ${wanted.join(", ")}.`);
    }
  } catch (error) {
    console.error(`Could not update ${member.id}: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ commands */

const commands = [
  new SlashCommandBuilder()
    .setName("alpha")
    .setDescription("Who may have Kiza's test builds")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((command) =>
      command
        .setName("add")
        .setDescription("Put somebody on a test channel")
        .addUserOption((option) =>
          option.setName("member").setDescription("Who").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("channel")
            .setDescription("Which build they get")
            .addChoices(
              { name: "alpha", value: "alpha" },
              { name: "beta", value: "beta" },
            ),
        )
        .addStringOption((option) =>
          option.setName("note").setDescription("Why, for whoever reads this later"),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("remove")
        .setDescription("Take it away")
        .addUserOption((option) =>
          option.setName("member").setDescription("Who").setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("check")
        .setDescription("What somebody has, and on how many machines")
        .addUserOption((option) =>
          option.setName("member").setDescription("Who").setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("reset")
        .setDescription("Forget their machines, for somebody who changed computer")
        .addUserOption((option) =>
          option.setName("member").setDescription("Who").setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("makerkey")
    .setDescription("Issue a key that opens the Maker channel, shown once")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("note").setDescription("Who it is for"),
    ),
];

/**
 * Whether this member may run these commands at all.
 *
 * Administrators, and nobody else. Discord's own permission setting already
 * hides the commands from everyone else, but hidden is not the same as
 * refused: a command can still be invoked by anybody who knows its name, and
 * the thing behind these is the list that decides who gets unreleased builds.
 *
 * There is deliberately no role that can be configured to widen this. A second
 * way in is a second thing to get wrong in a panel at two in the morning.
 */
function isStaff(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

async function handle(interaction) {
  if (!isStaff(interaction)) {
    await interaction.reply({
      content: "Only an administrator can run this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "makerkey") {
    const note = interaction.options.getString("note") ?? "issued from Discord";
    const issued = await makerKey(note);
    // Ephemeral, always. The service keeps only a hash of this and cannot show
    // it again — a key posted in a channel is a key everybody in the channel
    // has, and there would be no way to tell which of them used it.
    await interaction.reply({
      content:
        `Maker key — copy it now, it is not stored anywhere it can be read again:\n` +
        `\`\`\`\n${issued.key}\n\`\`\`\n` +
        "Put it in the install's `config/setup.key`, or let Kiza Setup write it.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.options.getUser("member", true);
  const action = interaction.options.getSubcommand();

  if (action === "add") {
    const channel = interaction.options.getString("channel") ?? "alpha";
    const note = interaction.options.getString("note") ?? `added by ${interaction.user.tag}`;
    await grant(member.id, [channel], note);
    await interaction.reply({
      content: `${member} can now receive **${channel}** builds. They sign in from Kiza's settings.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "remove") {
    await revoke(member.id);
    await interaction.reply({
      content:
        `${member} is off the list. A pass already on their machine keeps working ` +
        "until it runs out — up to thirty days.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "reset") {
    const reset = await resetMachines(member.id);
    await interaction.reply({
      content:
        `${member} can sign in from a new computer now. ` +
        "Their old machines are forgotten; a pass already on one of them keeps working where it is.",
      flags: MessageFlags.Ephemeral,
    });
    console.log(`${interaction.user.tag} reset the machines of ${member.id} (${reset.machines}).`);
    return;
  }

  const found = await lookup(member.id);
  const machines =
    found.machines > 0
      ? `\n${found.machines}/${found.limit} machine(s), last seen ${found.lastSeen.map((when) => when.slice(0, 10)).join(", ")}`
      : "\nNo machine has signed in yet.";
  await interaction.reply({
    content:
      found.channels.length > 0
        ? `${member}: **${found.channels.join(", ")}**${found.note ? ` — ${found.note}` : ""}${machines}`
        : `${member} is not on any test list.`,
    flags: MessageFlags.Ephemeral,
  });
}

/* --------------------------------------------------------------------- run */

const client = new Client({
  // Members, because the whole job is watching who has which role. Nothing
  // else is asked for: the bot reads no messages and needs no message content.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, async (ready) => {
  console.log(`Signed in as ${ready.user.tag}.`);

  const rest = new REST().setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(config.applicationId, config.guildId),
    { body: commands.map((command) => command.toJSON()) },
  );
  console.log("Commands registered for this server.");

  const watching = Object.entries(config.roles)
    .filter(([, roles]) => roles.length > 0)
    .map(([channel, roles]) => `${channel} (${roles.length} role(s))`);
  console.log(
    watching.length > 0
      ? `Watching roles for: ${watching.join(", ")}.`
      : "No roles configured — everything is by hand for now.",
  );
});

client.on(Events.GuildMemberUpdate, async (before, after) => {
  if (before.roles.cache.equals(after.roles.cache)) return;
  await followRoles(after);
});

// Somebody who leaves keeps nothing. This is the one case where taking access
// away immediately matters more than being gentle about it.
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await revoke(member.id);
    console.log(`${member.user?.tag ?? member.id} left; access revoked.`);
  } catch (error) {
    console.error(`Could not revoke ${member.id}: ${error.message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handle(interaction);
  } catch (error) {
    console.error(error);
    const said = { content: `That did not work: ${error.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(said);
    else await interaction.reply(said);
  }
});

client.login(config.token);
