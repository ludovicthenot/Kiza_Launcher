import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(here, "tickets.config.json");
const stateFile = path.join(here, "tickets.data.json");
const QUESTIONS_PER_MODAL = 5;

const defaultConfig = {
  panel: {
    title: "🧪 Kiza Launcher — Alpha Access",
    description:
      "Thank you for your interest in **Kiza Launcher**! 💜\n\nThe Alpha is an important stage in Kiza's development. We are looking for motivated players to **test the launcher, try its features and send us honest, detailed feedback**.\n\nIf you would like to take part, fill in the application form below. One active application per person.",
    color: "#8B5CF6",
    buttonLabel: "Apply for the Alpha",
    buttonEmoji: "🧪",
    // The rest of the panel used to be written into panelPayload, which meant
    // the only way to change a word of it was to edit the bot. Everything a
    // reader sees now lives here, where an admin can reach it.
    //
    // {count} is the number of questions and {button} the button's own label,
    // so neither can fall out of step with what is actually on screen.
    noticeTitle: "⚠️ Kiza is currently in Alpha",
    noticeBody:
      "Expect bugs, crashes and unfinished features. Your help goes straight into making Kiza better.",
    howToTitle: "How do I apply?",
    howToBody:
      "1. Click **{button}**.\n2. Answer the {count} questions in a single form.\n3. Your private ticket is created automatically for the Kiza team.",
    footer: "{count} topics • One form • Private answers",
  },
  modal: {
    title: "Kiza Alpha application",
  },
  channels: {
    category: "Tickets",
    panel: "creer-un-ticket",
    pending: "en-attente",
    accepted: "accepter",
    rejected: "refuser",
  },
  grantOnAccept: null,
  questions: [
    {
      "id": "motivation-objectives",
      "label": "Why would you like to participate?",
      "description": "And what would you especially like to test in Kiza?",
      "placeholder": "Motivation, mods, instances, installation, performance, design, stability…",
      "style": "paragraph",
      "required": true,
      "minLength": 20,
      "maxLength": 1000
    },
    {
      "id": "minecraft-environment",
      "label": "Which Minecraft version do you use?",
      "description": "And which tools: Forge, Fabric, NeoForge, OptiFine, other launchers.",
      "placeholder": "e.g. 1.21.1, Fabric, CurseForge and Modrinth — describe your habits.",
      "style": "paragraph",
      "required": true,
      "minLength": 10,
      "maxLength": 700
    },
    {
      "id": "configuration-diagnostic",
      "label": "What are your PC specs?",
      "description": "And what would you do if Kiza crashed when launching an instance?",
      "placeholder": "Windows, RAM, CPU, GPU, then the checks and information you would provide.",
      "style": "paragraph",
      "required": true,
      "minLength": 20,
      "maxLength": 1000
    },
    {
      "id": "testing-method",
      "label": "Will you be able to test regularly?",
      "description": "Report bugs with details and logs, and give honest feedback.",
      "placeholder": "Availability, testing frequency, and how you would provide feedback.",
      "style": "paragraph",
      "required": true,
      "minLength": 20,
      "maxLength": 1000
    },
    {
      "id": "alpha-commitment",
      "label": "Do you agree to test an Alpha version?",
      "description": "It may contain bugs, crashes and incomplete features.",
      "placeholder": "Clearly confirm that you understand and agree.",
      "style": "short",
      "required": true,
      "minLength": 3,
      "maxLength": 200
    }
  ],
};

export const ticketCommand = new SlashCommandBuilder()
  .setName("kiza-ticket")
  .setDescription("Installer et configurer le système de tickets")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((command) =>
    command
      .setName("setup")
      .setDescription("Créer toute la structure des tickets")
      .addChannelOption((option) =>
        option
          .setName("salon")
          .setDescription(
            "Salon existant où publier le panneau (sinon il sera créé)",
          )
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("categorie")
          .setDescription(
            "Catégorie existante pour les tickets (sinon elle sera créée)",
          )
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addChannelOption((option) =>
        option
          .setName("en_attente")
          .setDescription("Salon où afficher les candidatures en attente")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("accepter")
          .setDescription("Salon où archiver les candidatures acceptées")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("refuser")
          .setDescription("Salon où archiver les candidatures refusées")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addRoleOption((option) =>
        option
          .setName("staff")
          .setDescription("Rôle autorisé à voir et traiter les tickets"),
      )
      .addRoleOption((option) =>
        option
          .setName("role_accepte")
          .setDescription(
            "Rôle ajouté au membre lorsque son ticket est accepté",
          ),
      )
      .addRoleOption((option) =>
        option
          .setName("role_refuse")
          .setDescription(
            "Rôle ajouté au membre lorsque son ticket est refusé",
          ),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("panel")
      .setDescription("Publier ou déplacer le panneau de création")
      .addChannelOption((option) =>
        option
          .setName("salon")
          .setDescription("Salon où publier le panneau")
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("configuration")
      .setDescription("Afficher la configuration actuelle"),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("role")
      .setDescription("Configurer les rôles attribués après une décision")
      .addSubcommand((command) =>
        command
          .setName("definir")
          .setDescription("Définir le rôle d'un statut")
          .addStringOption((option) =>
            option
              .setName("statut")
              .setDescription("Décision concernée")
              .addChoices(
                { name: "Ticket accepté", value: "accepted" },
                { name: "Ticket refusé", value: "rejected" },
              )
              .setRequired(true),
          )
          .addRoleOption((option) =>
            option
              .setName("role")
              .setDescription("Rôle à attribuer")
              .setRequired(true),
          ),
      )
      .addSubcommand((command) =>
        command
          .setName("supprimer")
          .setDescription("Désactiver l'attribution de rôle pour un statut")
          .addStringOption((option) =>
            option
              .setName("statut")
              .setDescription("Décision concernée")
              .addChoices(
                { name: "Ticket accepté", value: "accepted" },
                { name: "Ticket refusé", value: "rejected" },
              )
              .setRequired(true),
          ),
      ),
  );

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

function cleanQuestion(question, index) {
  const fallback =
    defaultConfig.questions[
      Math.min(index, defaultConfig.questions.length - 1)
    ];
  const id = String(question?.id ?? `question-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 80);
  const style = question?.style === "short" ? "short" : "paragraph";
  const maxLength = clamp(question?.maxLength, 1, 4000, fallback.maxLength);
  const minLength = clamp(
    question?.minLength,
    0,
    maxLength,
    fallback.minLength,
  );

  // Discord gives a modal field a 45-character title and an optional
  // 100-character line under it. A question written as one long sentence has
  // to be cut somewhere to fit, and cutting it by counting characters lands
  // mid-word. So a question may state both halves itself; the splitter below
  // is only the fallback for the ones that do not.
  const description = String(question?.description ?? "")
    .trim()
    .slice(0, 100);

  return {
    id: id || `question-${index + 1}`,
    label: String(question?.label ?? fallback.label)
      .trim()
      .slice(0, description ? 45 : 145),
    description,
    placeholder: String(question?.placeholder ?? "")
      .trim()
      .slice(0, 100),
    style,
    required: question?.required !== false,
    minLength,
    maxLength,
  };
}

function normaliseConfig(value) {
  const config = clone(defaultConfig);
  if (value?.panel && typeof value.panel === "object") {
    config.panel = { ...config.panel, ...value.panel };
  }
  if (value?.modal && typeof value.modal === "object") {
    config.modal = { ...config.modal, ...value.modal };
  }
  if (value?.channels && typeof value.channels === "object") {
    config.channels = { ...config.channels, ...value.channels };
  }
  if ([null, "alpha", "beta"].includes(value?.grantOnAccept)) {
    config.grantOnAccept = value.grantOnAccept;
  }

  const questions = Array.isArray(value?.questions)
    ? value.questions.slice(0, QUESTIONS_PER_MODAL)
    : [];
  config.questions = (
    questions.length > 0 ? questions : defaultConfig.questions
  ).map(cleanQuestion);
  const questionIds = new Set();
  config.questions.forEach((question, index) => {
    if (questionIds.has(question.id)) question.id = `question-${index + 1}`;
    questionIds.add(question.id);
  });
  config.panel.title = String(config.panel.title).trim().slice(0, 256);
  config.panel.description = String(config.panel.description)
    .trim()
    .slice(0, 4000);
  config.panel.buttonLabel = String(config.panel.buttonLabel)
    .trim()
    .slice(0, 80);
  config.panel.buttonEmoji = String(config.panel.buttonEmoji ?? "").trim();
  // Embed limits, which are not the same as the modal's: a field name may run
  // to 256 characters, its body to 1024, and the footer to 2048.
  for (const [field, limit] of [
    ["noticeTitle", 256],
    ["noticeBody", 1024],
    ["howToTitle", 256],
    ["howToBody", 1024],
    ["footer", 2048],
  ]) {
    config.panel[field] = String(
      config.panel[field] ?? defaultConfig.panel[field],
    )
      .trim()
      .slice(0, limit);
  }
  config.modal.title = String(config.modal.title).trim().slice(0, 45);
  config.channels.category =
    String(config.channels.category).trim().slice(0, 100) || "Tickets";
  for (const key of ["panel", "pending", "accepted", "rejected"]) {
    config.channels[key] =
      channelName(config.channels[key]) || defaultConfig.channels[key];
  }
  return config;
}

function readConfig() {
  try {
    return normaliseConfig(JSON.parse(fs.readFileSync(configFile, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Could not read ${configFile}: ${error.message}`);
    }
    return clone(defaultConfig);
  }
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      version: 1,
      guilds:
        state.guilds && typeof state.guilds === "object" ? state.guilds : {},
      tickets:
        state.tickets && typeof state.tickets === "object" ? state.tickets : {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Could not read ${stateFile}: ${error.message}`);
    }
    return { version: 1, guilds: {}, tickets: {} };
  }
}

function writeState(state) {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parseColor(color) {
  const value = String(color ?? "").replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value, 16) : 0x8b5cf6;
}

function channelName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function shorten(value, length = 900) {
  const text = String(value ?? "").trim();
  if (!text) return "*Aucune réponse*";
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function mentionChannel(id) {
  return id ? `<#${id}>` : "Non configuré";
}

function ticketUrl(ticket) {
  return `https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`;
}

function statusDetails(ticket) {
  switch (ticket.status) {
    case "accepted":
      return { label: "Accepté", color: 0x22c55e, emoji: "✅" };
    case "rejected":
      return { label: "Refusé", color: 0xef4444, emoji: "❌" };
    case "closed":
      return { label: "Fermé", color: 0x64748b, emoji: "🔒" };
    case "deleted":
      return { label: "Supprimé", color: 0x334155, emoji: "🗑️" };
    default:
      return { label: "En attente", color: 0xf59e0b, emoji: "⏳" };
  }
}

function decisionRoleKeys(status) {
  if (status === "accepted") {
    return { selected: "acceptedRoleId", opposite: "rejectedRoleId" };
  }
  return { selected: "rejectedRoleId", opposite: "acceptedRoleId" };
}

function panelPayload(config, disabled = false) {
  const label = config.panel.buttonLabel || "Apply for the Alpha";
  /** {count} and {button}, so the panel cannot describe a form it is not. */
  const fill = (text) =>
    String(text)
      .replaceAll("{count}", String(config.questions.length))
      .replaceAll("{button}", label);

  const button = new ButtonBuilder()
    .setCustomId("ticket:open")
    .setLabel(label)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);
  if (config.panel.buttonEmoji) button.setEmoji(config.panel.buttonEmoji);

  const embed = new EmbedBuilder()
    .setColor(parseColor(config.panel.color))
    .setTitle(config.panel.title)
    .setDescription(config.panel.description)
    .addFields(
      { name: config.panel.noticeTitle, value: config.panel.noticeBody },
      { name: config.panel.howToTitle, value: fill(config.panel.howToBody) },
    )
    .setFooter({ text: fill(config.panel.footer) });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

const answerLabels = {
  motivation: "💜 Motivation",
  "testing-focus": "🎯 Éléments à tester",
  "test-availability": "🗓️ Disponibilités",
  "motivation-objectives": "💜 Motivation et objectifs",
  "minecraft-version": "⛏️ Version Minecraft",
  "mod-loaders": "🧩 Outils et mod loaders",
  "other-launchers": "🚀 Launchers utilisés",
  "pc-configuration": "🖥️ Configuration PC",
  "minecraft-environment": "🎮 Environnement Minecraft",
  "configuration-diagnostic": "🖥️ Configuration et diagnostic",
  "bug-reports": "🐞 Signalement des bugs",
  "honest-feedback": "💬 Qualité des retours",
  "alpha-acceptance": "⚠️ Acceptation des risques",
  "crash-example": "🧯 Réaction face à un crash",
  "testing-method": "🛠️ Méthode et disponibilité",
  "alpha-commitment": "✅ Engagement pour l’Alpha",
};

function relativeTimestamp(value) {
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(timestamp) ? `<t:${timestamp}:R>` : "Non renseignée";
}

export function ticketEmbeds(ticket) {
  const status = statusDetails(ticket);
  const reference = String(ticket.number).padStart(4, "0");
  const header = new EmbedBuilder()
    .setColor(status.color)
    .setAuthor({ name: "Kiza Launcher • Programme Alpha" })
    .setTitle(`${status.emoji} Candidature Alpha #${reference}`)
    .setDescription(
      "Dossier de candidature pour tester **Kiza Launcher** avant sa sortie publique.",
    )
    .addFields(
      {
        name: "👤 Candidat",
        value: `<@${ticket.ownerId}>\n\`${shorten(ticket.ownerTag, 80)}\``,
        inline: true,
      },
      {
        name: "📍 Statut",
        value: `${status.emoji} **${status.label}**`,
        inline: true,
      },
      {
        name: "🕒 Reçue",
        value: relativeTimestamp(ticket.createdAt),
        inline: true,
      },
    )
    .setTimestamp(new Date(ticket.createdAt))
    .setFooter({ text: `Kiza Launcher • Dossier ${ticket.id}` });

  if (ticket.decisionReason) {
    header.addFields({
      name: `📝 ${
        ticket.decision === "accepted"
          ? "Motif de l'acceptation"
          : "Motif du refus"
      }`,
      value: shorten(ticket.decisionReason),
    });
  }
  if (ticket.decidedBy) {
    header.addFields({
      name: "👮 Décision prise par",
      value: `<@${ticket.decidedBy}>`,
      inline: true,
    });
  }
  if (ticket.closedBy) {
    header.addFields({
      name: "🔒 Fermé par",
      value: `<@${ticket.closedBy}>`,
      inline: true,
    });
  }
  header.addFields(
    ticket.answers.map((answer) => ({
      name: answerLabels[answer.id] ?? shorten(answer.label, 256),
      value: shorten(answer.value, 1000),
      inline: false,
    })),
  );
  return [header];
}

export function ticketTrackingEmbeds(ticket) {
  const status = statusDetails(ticket);
  const reference = String(ticket.number).padStart(4, "0");
  const embed = new EmbedBuilder()
    .setColor(status.color)
    .setAuthor({ name: "Kiza Launcher • Suivi des candidatures" })
    .setTitle(`${status.emoji} Candidature Alpha #${reference}`)
    .setDescription(
      `Candidature de <@${ticket.ownerId}> actuellement **${status.label.toLowerCase()}**.\nConsulte le ticket privé pour lire toutes les réponses.`,
    )
    .addFields(
      {
        name: "👤 Candidat",
        value: `\`${shorten(ticket.ownerTag, 80)}\``,
        inline: true,
      },
      {
        name: "🕒 Reçue",
        value: relativeTimestamp(ticket.createdAt),
        inline: true,
      },
    )
    .setTimestamp(new Date(ticket.createdAt))
    .setFooter({ text: `Dossier ${ticket.id}` });

  if (ticket.decisionReason) {
    embed.addFields({
      name: "📝 Motif de la décision",
      value: shorten(ticket.decisionReason),
    });
  }
  if (ticket.decidedBy) {
    embed.addFields({
      name: "👮 Décision prise par",
      value: `<@${ticket.decidedBy}>`,
      inline: true,
    });
  }
  if (ticket.closedBy) {
    embed.addFields({
      name: "🔒 Fermé par",
      value: `<@${ticket.closedBy}>`,
      inline: true,
    });
  }
  return [embed];
}

function activeTicketButtons(ticket) {
  if (ticket.status === "closed") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:delete:${ticket.id}`)
          .setLabel("Supprimer le salon")
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  }
  if (ticket.status !== "pending") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:close:${ticket.id}`)
          .setLabel("Fermer")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:accept:${ticket.id}`)
        .setLabel("Accepter")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ticket:reject:${ticket.id}`)
        .setLabel("Refuser")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ticket:close:${ticket.id}`)
        .setLabel("Fermer")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function disabledTicketButtons(ticket) {
  return activeTicketButtons({ ...ticket, status: "pending" }).map((row) => {
    for (const button of row.components) button.setDisabled(true);
    return row;
  });
}

function linkButton(ticket) {
  if (!ticket.channelId) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Voir le ticket")
        .setStyle(ButtonStyle.Link)
        .setURL(ticketUrl(ticket)),
    ),
  ];
}

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.fetch(id).catch(() => null);
}

function memberHasRole(member, roleId) {
  if (!roleId || !member?.roles) return false;
  if (member.roles.cache) return member.roles.cache.has(roleId);
  return Array.isArray(member.roles) && member.roles.includes(roleId);
}

export function createTicketSystem({ client, guildId, grantAccess }) {
  const state = readState();
  const creatingTickets = new Set();
  const pendingForms = new Map();

  function guildState(id) {
    return state.guilds[id] ?? null;
  }

  function isStaff(interaction, setup = guildState(interaction.guildId)) {
    return (
      (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
        false) ||
      memberHasRole(interaction.member, setup?.staffRoleId)
    );
  }

  async function editStoredMessage(channelId, messageId, payload) {
    const channel = await fetchChannel(
      client.guilds.cache.get(guildId),
      channelId,
    );
    if (!channel?.isTextBased() || !messageId) return false;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return false;
    await message.edit(payload).catch((error) => {
      console.error(
        `Could not edit ticket message ${messageId}: ${error.message}`,
      );
    });
    return true;
  }

  async function ensureCategory(
    guild,
    setup,
    config,
    staffRoleId,
    requestedCategory,
  ) {
    let category =
      requestedCategory ?? (await fetchChannel(guild, setup.categoryId));
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ];
    if (staffRoleId) {
      overwrites.push({
        id: staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    if (!category || category.type !== ChannelType.GuildCategory) {
      category = await guild.channels.create({
        name: config.channels.category,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: "Installation du système de tickets Kiza",
      });
    } else {
      await category.permissionOverwrites.set(
        overwrites,
        "Mise à jour du système de tickets Kiza",
      );
    }
    return category;
  }

  async function ensureStatusChannel(
    guild,
    setup,
    key,
    name,
    parentId,
    requestedChannel,
  ) {
    let channel = requestedChannel ?? (await fetchChannel(guild, setup[key]));
    if (!channel || channel.type !== ChannelType.GuildText) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `kiza-tickets:${key}`,
        reason: "Installation du système de tickets Kiza",
      });
    } else if (channel.parentId !== parentId) {
      await channel.setParent(parentId, {
        lockPermissions: true,
        reason: "Configuration du système de tickets Kiza",
      });
    } else {
      await channel.lockPermissions();
    }
    return channel;
  }

  async function createPanelChannel(guild, categoryId, config) {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    return guild.channels.create({
      name: config.channels.panel,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: "kiza-tickets:panel",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
          deny: [PermissionFlagsBits.SendMessages],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ],
      reason: "Installation du panneau de tickets Kiza",
    });
  }

  async function publishPanel(guild, setup, requestedChannel = null) {
    const config = readConfig();
    const previousChannelId = setup.panelChannelId;
    const previousMessageId = setup.panelMessageId;
    let channel =
      requestedChannel ?? (await fetchChannel(guild, setup.panelChannelId));
    let managed = setup.panelManaged ?? false;

    if (!channel || channel.type !== ChannelType.GuildText) {
      channel = await createPanelChannel(guild, setup.categoryId, config);
      managed = true;
    } else if (requestedChannel) {
      managed = false;
    }

    if (previousChannelId === channel.id && previousMessageId) {
      const previous = await channel.messages
        .fetch(previousMessageId)
        .catch(() => null);
      if (previous) {
        await previous.edit(panelPayload(config));
        setup.panelChannelId = channel.id;
        setup.panelManaged = managed;
        writeState(state);
        return previous;
      }
    }

    if (
      previousChannelId &&
      previousMessageId &&
      previousChannelId !== channel.id
    ) {
      await editStoredMessage(
        previousChannelId,
        previousMessageId,
        panelPayload(config, true),
      );
    }

    const message = await channel.send(panelPayload(config));
    setup.panelChannelId = channel.id;
    setup.panelMessageId = message.id;
    setup.panelManaged = managed;
    writeState(state);
    return message;
  }

  async function setupTickets(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      throw new Error(
        "Il me faut la permission « Gérer les salons » pour installer les tickets.",
      );
    }

    const config = readConfig();
    const setup = state.guilds[guild.id] ?? { nextNumber: 1 };
    const requestedPanel = interaction.options.getChannel("salon");
    const requestedCategory = interaction.options.getChannel("categorie");
    const requestedPending = interaction.options.getChannel("en_attente");
    const requestedAccepted = interaction.options.getChannel("accepter");
    const requestedRejected = interaction.options.getChannel("refuser");
    const targetTextChannelIds = [
      requestedPanel?.id ?? setup.panelChannelId,
      requestedPending?.id ?? setup.pendingChannelId,
      requestedAccepted?.id ?? setup.acceptedChannelId,
      requestedRejected?.id ?? setup.rejectedChannelId,
    ].filter(Boolean);
    if (new Set(targetTextChannelIds).size !== targetTextChannelIds.length) {
      throw new Error(
        "Le panneau et les trois salons de suivi doivent être des salons différents.",
      );
    }
    const requestedRole = interaction.options.getRole("staff");
    const staffRoleId = requestedRole?.id ?? setup.staffRoleId ?? null;
    const acceptedRole = interaction.options.getRole("role_accepte");
    const rejectedRole = interaction.options.getRole("role_refuse");
    const acceptedRoleId = acceptedRole?.id ?? setup.acceptedRoleId ?? null;
    const rejectedRoleId = rejectedRole?.id ?? setup.rejectedRoleId ?? null;
    if (acceptedRoleId && acceptedRoleId === rejectedRoleId) {
      throw new Error(
        "Les rôles « accepté » et « refusé » doivent être différents.",
      );
    }
    for (const role of [acceptedRole, rejectedRole].filter(Boolean)) {
      if (!role.editable) {
        throw new Error(
          `Je ne peux pas attribuer ${role.name}. Place mon rôle au-dessus et donne-moi la permission « Gérer les rôles ».`,
        );
      }
    }
    const category = await ensureCategory(
      guild,
      setup,
      config,
      staffRoleId,
      requestedCategory,
    );
    setup.categoryId = category.id;
    setup.staffRoleId = staffRoleId;
    setup.acceptedRoleId = acceptedRoleId;
    setup.rejectedRoleId = rejectedRoleId;

    const pending = await ensureStatusChannel(
      guild,
      setup,
      "pendingChannelId",
      config.channels.pending,
      category.id,
      requestedPending,
    );
    const accepted = await ensureStatusChannel(
      guild,
      setup,
      "acceptedChannelId",
      config.channels.accepted,
      category.id,
      requestedAccepted,
    );
    const rejected = await ensureStatusChannel(
      guild,
      setup,
      "rejectedChannelId",
      config.channels.rejected,
      category.id,
      requestedRejected,
    );
    setup.pendingChannelId = pending.id;
    setup.acceptedChannelId = accepted.id;
    setup.rejectedChannelId = rejected.id;
    setup.nextNumber = Math.max(1, Number(setup.nextNumber) || 1);
    state.guilds[guild.id] = setup;
    writeState(state);

    const panel = await publishPanel(guild, setup, requestedPanel);
    await interaction.editReply({
      content:
        `Système installé dans **${category.name}**.\n` +
        `Panneau : ${panel.url}\n` +
        `Suivi : ${pending}, ${accepted}, ${rejected}` +
        (staffRoleId
          ? `\nÉquipe : <@&${staffRoleId}>`
          : "\nÉquipe : administrateurs du serveur") +
        `\nRôle si accepté : ${acceptedRoleId ? `<@&${acceptedRoleId}>` : "aucun"}` +
        `\nRôle si refusé : ${rejectedRoleId ? `<@&${rejectedRoleId}>` : "aucun"}`,
      allowedMentions: { parse: [] },
    });
  }

  async function movePanel(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const setup = guildState(interaction.guildId);
    if (!setup) {
      await interaction.editReply("Lance d'abord `/kiza-ticket setup`.");
      return;
    }
    const requested = interaction.options.getChannel("salon");
    const message = await publishPanel(interaction.guild, setup, requested);
    await interaction.editReply(`Le panneau est prêt : ${message.url}`);
  }

  async function showConfiguration(interaction) {
    const setup = guildState(interaction.guildId);
    const config = readConfig();
    const description = setup
      ? [
          `**Catégorie :** ${mentionChannel(setup.categoryId)}`,
          `**Panneau :** ${mentionChannel(setup.panelChannelId)}`,
          `**En attente :** ${mentionChannel(setup.pendingChannelId)}`,
          `**Accepter :** ${mentionChannel(setup.acceptedChannelId)}`,
          `**Refuser :** ${mentionChannel(setup.rejectedChannelId)}`,
          `**Équipe :** ${setup.staffRoleId ? `<@&${setup.staffRoleId}>` : "Administrateurs"}`,
          `**Rôle si accepté :** ${setup.acceptedRoleId ? `<@&${setup.acceptedRoleId}>` : "Aucun"}`,
          `**Rôle si refusé :** ${setup.rejectedRoleId ? `<@&${setup.rejectedRoleId}>` : "Aucun"}`,
          `**Accès automatique :** ${config.grantOnAccept ?? "désactivé"}`,
        ].join("\n")
      : "Le système n'est pas encore installé. Utilise `/kiza-ticket setup`.";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(parseColor(config.panel.color))
          .setTitle("Configuration des tickets")
          .setDescription(description)
          .addFields({
            name: "Formulaire",
            value: `${config.questions.length} question(s)`,
          }),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  async function configureDecisionRole(interaction, remove = false) {
    const setup = guildState(interaction.guildId);
    if (!setup) {
      await interaction.reply({
        content: "Lance d'abord `/kiza-ticket setup`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const status = interaction.options.getString("statut", true);
    const { selected: key, opposite: oppositeKey } = decisionRoleKeys(status);
    if (remove) {
      setup[key] = null;
      writeState(state);
      await interaction.reply({
        content: `L'attribution de rôle pour les tickets ${status === "accepted" ? "acceptés" : "refusés"} est désactivée.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = interaction.options.getRole("role", true);
    if (role.id === setup[oppositeKey]) {
      await interaction.reply({
        content:
          "Le même rôle ne peut pas représenter les tickets acceptés et refusés.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!role.editable) {
      await interaction.reply({
        content: `Je ne peux pas attribuer ${role}. Place mon rôle au-dessus et donne-moi la permission « Gérer les rôles ».`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    setup[key] = role.id;
    writeState(state);
    await interaction.reply({
      content: `${role} sera maintenant attribué aux tickets ${status === "accepted" ? "acceptés" : "refusés"}.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  async function handleTicketCommand(interaction) {
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: "Seul un administrateur peut configurer les tickets.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const group = interaction.options.getSubcommandGroup(false);
    const action = interaction.options.getSubcommand(false);
    if (!action) {
      await interaction.reply({
        content:
          "Choisis une sous-commande. Pour commencer, utilise `/kiza-ticket setup`. " +
          "Tu peux ensuite consulter `/kiza-ticket configuration` et `/kiza-ticket role definir`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (group === "role") {
      await configureDecisionRole(interaction, action === "supprimer");
      return;
    }
    if (action === "setup") await setupTickets(interaction);
    else if (action === "panel") await movePanel(interaction);
    else await showConfiguration(interaction);
  }

  async function findActiveTicket(guild, ownerId) {
    const ticket = Object.values(state.tickets).find(
      (candidate) =>
        candidate.guildId === guild.id &&
        candidate.ownerId === ownerId &&
        !["closed", "deleted"].includes(candidate.status),
    );
    if (!ticket) return null;
    const channel = await fetchChannel(guild, ticket.channelId);
    if (channel) return ticket;
    ticket.status = "deleted";
    ticket.channelId = null;
    writeState(state);
    return null;
  }

  function formKey(interaction) {
    return `${interaction.guildId}:${interaction.user.id}`;
  }

  /** Last resort for a question that did not say where its own line breaks. */
  function questionLabelParts(label) {
    if (label.length <= 45) return { title: label, description: null };
    const minimumSplit = Math.max(1, label.length - 100);
    const wordBoundary = label.lastIndexOf(" ", 45);
    const splitAt = wordBoundary >= minimumSplit ? wordBoundary : 45;
    return {
      title: label.slice(0, splitAt).trimEnd(),
      description: label.slice(splitAt).trimStart(),
    };
  }

  function buildCreateModal(form) {
    const modal = new ModalBuilder()
      .setCustomId("ticket:create")
      .setTitle(form.title);

    for (const question of form.questions) {
      const input = new TextInputBuilder()
        .setCustomId(question.id)
        .setStyle(
          question.style === "short"
            ? TextInputStyle.Short
            : TextInputStyle.Paragraph,
        )
        .setRequired(question.required)
        .setMaxLength(question.maxLength);
      if (question.minLength > 0) input.setMinLength(question.minLength);
      if (question.placeholder) input.setPlaceholder(question.placeholder);

      const label = question.description
        ? { title: question.label, description: question.description }
        : questionLabelParts(question.label);
      const field = new LabelBuilder()
        .setLabel(label.title)
        .setTextInputComponent(input);
      if (label.description) field.setDescription(label.description);
      modal.addLabelComponents(field);
    }
    return modal;
  }

  async function showCreateModal(interaction) {
    const setup = guildState(interaction.guildId);
    if (!setup) {
      await interaction.reply({
        content: "Le système de tickets n'est pas encore configuré.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const active = await findActiveTicket(
      interaction.guild,
      interaction.user.id,
    );
    if (active) {
      await interaction.reply({
        content: `Tu as déjà un ticket actif : ${ticketUrl(active)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = readConfig();
    const form = {
      title: config.modal.title,
      questions: clone(config.questions),
      answers: {},
    };
    pendingForms.set(formKey(interaction), form);
    await interaction.showModal(buildCreateModal(form));
  }

  function nextTicket(guild, setup, interaction, questions, answers) {
    const number = Math.max(1, Number(setup.nextNumber) || 1);
    setup.nextNumber = number + 1;
    const id = `${number}-${Date.now().toString(36)}`;
    return {
      id,
      number,
      guildId: guild.id,
      ownerId: interaction.user.id,
      ownerTag: interaction.user.tag,
      status: "pending",
      createdAt: new Date().toISOString(),
      answers: questions.map((question) => ({
        id: question.id,
        label: question.label,
        value: answers[question.id] ?? "",
      })),
    };
  }

  async function createTicket(interaction, form) {
    const key = formKey(interaction);
    if (creatingTickets.has(key)) {
      await interaction.reply({
        content: "Ton ticket est déjà en cours de création.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    creatingTickets.add(key);
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const setup = guildState(interaction.guildId);
      if (!setup) {
        await interaction.editReply(
          "Le système de tickets n'est plus configuré.",
        );
        return;
      }
      const active = await findActiveTicket(
        interaction.guild,
        interaction.user.id,
      );
      if (active) {
        await interaction.editReply(
          `Tu as déjà un ticket actif : ${ticketUrl(active)}`,
        );
        return;
      }

      const ticket = nextTicket(
        interaction.guild,
        setup,
        interaction,
        form.questions,
        form.answers,
      );
      const me =
        interaction.guild.members.me ??
        (await interaction.guild.members.fetchMe());
      const overwrites = [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ];
      if (setup.staffRoleId) {
        overwrites.push({
          id: setup.staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        });
      }

      const userName = channelName(interaction.user.username) || "membre";
      const channel = await interaction.guild.channels.create({
        name: `ticket-${String(ticket.number).padStart(4, "0")}-${userName}`.slice(
          0,
          100,
        ),
        type: ChannelType.GuildText,
        parent: setup.categoryId,
        topic: `Ticket Kiza ${ticket.id} • ${interaction.user.id}`,
        permissionOverwrites: overwrites,
        reason: `Ticket créé par ${interaction.user.tag}`,
      });
      ticket.channelId = channel.id;
      state.tickets[ticket.id] = ticket;
      writeState(state);

      const ticketMessage = await channel.send({
        content: setup.staffRoleId
          ? `<@${ticket.ownerId}> • <@&${setup.staffRoleId}>`
          : `<@${ticket.ownerId}>`,
        embeds: ticketEmbeds(ticket),
        components: activeTicketButtons(ticket),
        allowedMentions: {
          users: [ticket.ownerId],
          roles: setup.staffRoleId ? [setup.staffRoleId] : [],
        },
      });
      ticket.ticketMessageId = ticketMessage.id;

      const pending = await fetchChannel(
        interaction.guild,
        setup.pendingChannelId,
      );
      if (pending?.isTextBased()) {
        const pendingMessage = await pending.send({
          embeds: ticketTrackingEmbeds(ticket),
          components: [...activeTicketButtons(ticket), ...linkButton(ticket)],
        });
        ticket.pendingMessageId = pendingMessage.id;
      }
      writeState(state);
      await interaction.editReply(
        `Ton ticket a été créé : ${ticketUrl(ticket)}`,
      );
    } finally {
      creatingTickets.delete(key);
      pendingForms.delete(key);
    }
  }

  async function handleCreateModal(interaction) {
    const key = formKey(interaction);
    const form = pendingForms.get(key);
    if (!form) {
      await interaction.reply({
        content:
          "Ce formulaire a expiré. Recommence depuis le bouton « Candidater à l’Alpha ».",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    for (const question of form.questions) {
      form.answers[question.id] = interaction.fields.getTextInputValue(
        question.id,
      );
    }
    await createTicket(interaction, form);
  }

  async function showDecisionModal(interaction, action, ticket) {
    if (!isStaff(interaction)) {
      await interaction.reply({
        content: "Seule l'équipe peut prendre cette décision.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ticket.status !== "pending") {
      await interaction.reply({
        content: `Ce ticket est déjà ${statusDetails(ticket).label.toLowerCase()}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const accepted = action === "accept";
    const input = new TextInputBuilder()
      .setCustomId("reason")
      .setPlaceholder("Facultatif, mais utile pour garder un historique clair.")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000);
    const modal = new ModalBuilder()
      .setCustomId(`ticket:decision:${action}:${ticket.id}`)
      .setTitle(accepted ? "Accepter le ticket" : "Refuser le ticket")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(accepted ? "Motif de l'acceptation" : "Motif du refus")
          .setTextInputComponent(input),
      );
    await interaction.showModal(modal);
  }

  async function updateTicketMessages(ticket, setup) {
    await editStoredMessage(ticket.channelId, ticket.ticketMessageId, {
      embeds: ticketEmbeds(ticket),
      components: activeTicketButtons(ticket),
    });
    await editStoredMessage(setup.pendingChannelId, ticket.pendingMessageId, {
      embeds: ticketTrackingEmbeds(ticket),
      components: [...disabledTicketButtons(ticket), ...linkButton(ticket)],
    });
  }

  async function decideTicket(interaction, action, ticket) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!isStaff(interaction)) {
      await interaction.editReply(
        "Seule l'équipe peut prendre cette décision.",
      );
      return;
    }
    if (ticket.status !== "pending") {
      await interaction.editReply(
        `Ce ticket est déjà ${statusDetails(ticket).label.toLowerCase()}.`,
      );
      return;
    }

    const setup = guildState(ticket.guildId);
    if (!setup) {
      await interaction.editReply(
        "La configuration de ce serveur n'existe plus. Relance `/kiza-ticket setup`.",
      );
      return;
    }
    const config = readConfig();
    const accepted = action === "accept";
    const reason = interaction.fields.getTextInputValue("reason").trim();

    // Guarded the way the role change below is guarded, and for the same
    // reason. This call leaves the building: if the service is down or the
    // token is stale it throws, and unguarded it threw before the decision was
    // ever written -- so a moment of bad network turned an accepted
    // application back into a pending one, with nobody told which of the two
    // had actually happened.
    let accessWarning = null;
    if (accepted && config.grantOnAccept && grantAccess) {
      try {
        await grantAccess(
          ticket.ownerId,
          [config.grantOnAccept],
          `ticket:${ticket.id}:accepted-by:${interaction.user.id}`,
        );
        ticket.grantedChannel = config.grantOnAccept;
      } catch (error) {
        accessWarning =
          `Le ticket est accepté, mais l'accès **${config.grantOnAccept}** n'a pas pu être donné : ${error.message} ` +
          "Donne-le à la main avec `/alpha add` — la personne n'a rien pour l'instant.";
      }
    }

    ticket.status = accepted ? "accepted" : "rejected";
    ticket.decision = ticket.status;
    ticket.decisionReason = reason || null;
    ticket.decidedBy = interaction.user.id;
    ticket.decidedAt = new Date().toISOString();
    writeState(state);

    let roleWarning = null;
    const roleToAdd = accepted ? setup.acceptedRoleId : setup.rejectedRoleId;
    const roleToRemove = accepted ? setup.rejectedRoleId : setup.acceptedRoleId;
    if (roleToAdd || roleToRemove) {
      const member = await interaction.guild.members
        .fetch(ticket.ownerId)
        .catch(() => null);
      if (!member) {
        roleWarning =
          "Le membre n'est plus présent sur le serveur : aucun rôle n'a été modifié.";
      } else {
        try {
          if (roleToAdd)
            await member.roles.add(
              roleToAdd,
              `Ticket ${ticket.id} ${ticket.status}`,
            );
          if (roleToRemove && member.roles.cache.has(roleToRemove)) {
            await member.roles.remove(
              roleToRemove,
              `Ticket ${ticket.id} ${ticket.status}`,
            );
          }
        } catch (error) {
          roleWarning =
            `Le statut a bien été enregistré, mais le rôle Discord n'a pas pu être modifié : ${error.message}. ` +
            "Vérifie la permission « Gérer les rôles » et place le rôle du bot au-dessus des rôles concernés.";
        }
      }
    }
    if (roleWarning || accessWarning) {
      if (roleWarning) ticket.roleWarning = roleWarning;
      if (accessWarning) ticket.accessWarning = accessWarning;
      writeState(state);
    }
    const channel = await fetchChannel(interaction.guild, ticket.channelId);
    if (channel?.type === ChannelType.GuildText) {
      const name = `${accepted ? "accepte" : "refuse"}-${String(ticket.number).padStart(4, "0")}-${channelName(ticket.ownerTag.split("#")[0])}`;
      await channel
        .setName(name.slice(0, 100), "Décision prise sur le ticket")
        .catch(() => null);
    }
    await updateTicketMessages(ticket, setup);

    const destinationId = accepted
      ? setup.acceptedChannelId
      : setup.rejectedChannelId;
    const destination = await fetchChannel(interaction.guild, destinationId);
    if (destination?.isTextBased()) {
      const log = await destination.send({
        embeds: ticketTrackingEmbeds(ticket),
        components: linkButton(ticket),
      });
      ticket.decisionLogMessageId = log.id;
      writeState(state);
    }
    const result = accepted
      ? `Le ticket #${String(ticket.number).padStart(4, "0")} est accepté.`
      : `Le ticket #${String(ticket.number).padStart(4, "0")} est refusé.`;
    // The access warning first: a missing role is cosmetic, a missing grant
    // means the person cannot download the build they were just accepted for.
    const warnings = [accessWarning, roleWarning].filter(Boolean);
    await interaction.editReply(
      warnings.length
        ? [result, ...warnings.map((warning) => `⚠️ ${warning}`)].join("\n")
        : result,
    );
  }

  async function closeTicket(interaction, ticket) {
    const allowed =
      interaction.user.id === ticket.ownerId || isStaff(interaction);
    if (!allowed) {
      await interaction.reply({
        content: "Tu ne peux pas fermer ce ticket.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (["closed", "deleted"].includes(ticket.status)) {
      await interaction.reply({
        content: "Ce ticket est déjà fermé.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    ticket.previousStatus = ticket.status;
    ticket.status = "closed";
    ticket.closedBy = interaction.user.id;
    ticket.closedAt = new Date().toISOString();
    writeState(state);

    const channel = await fetchChannel(interaction.guild, ticket.channelId);
    if (channel?.type === ChannelType.GuildText) {
      await channel.permissionOverwrites
        .edit(
          ticket.ownerId,
          { SendMessages: false },
          { reason: "Ticket fermé" },
        )
        .catch(() => null);
      await channel
        .setName(
          `ferme-${String(ticket.number).padStart(4, "0")}-${channelName(ticket.ownerTag.split("#")[0])}`.slice(
            0,
            100,
          ),
        )
        .catch(() => null);
    }
    await updateTicketMessages(ticket, guildState(ticket.guildId));
    await interaction.editReply(
      "Le ticket est fermé et verrouillé. L'équipe peut encore consulter son contenu ou supprimer le salon.",
    );
  }

  async function deleteTicket(interaction, ticket) {
    if (!isStaff(interaction)) {
      await interaction.reply({
        content: "Seule l'équipe peut supprimer un salon de ticket.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ticket.status !== "closed") {
      await interaction.reply({
        content: "Ferme d'abord le ticket avant de supprimer son salon.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: "Le salon sera supprimé dans deux secondes.",
      flags: MessageFlags.Ephemeral,
    });
    const channel = await fetchChannel(interaction.guild, ticket.channelId);
    ticket.status = "deleted";
    ticket.deletedBy = interaction.user.id;
    ticket.deletedAt = new Date().toISOString();
    ticket.channelId = null;
    writeState(state);
    if (channel) {
      setTimeout(() => {
        channel.delete("Ticket supprimé par le staff").catch((error) => {
          console.error(
            `Could not delete ticket channel ${channel.id}: ${error.message}`,
          );
        });
      }, 2000);
    }
  }

  async function handleTicketButton(interaction) {
    if (interaction.customId === "ticket:open") {
      await showCreateModal(interaction);
      return;
    }
    const [, action, id] = interaction.customId.split(":");
    const ticket = state.tickets[id];
    if (!ticket || ticket.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "Ce ticket n'existe plus dans les données du bot.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === "accept" || action === "reject") {
      await showDecisionModal(interaction, action, ticket);
    } else if (action === "close") {
      await closeTicket(interaction, ticket);
    } else if (action === "delete") {
      await deleteTicket(interaction, ticket);
    }
  }

  async function handleModal(interaction) {
    if (interaction.customId === "ticket:create") {
      await handleCreateModal(interaction);
      return;
    }
    const [, kind, action, id] = interaction.customId.split(":");
    if (kind !== "decision") return;
    const ticket = state.tickets[id];
    if (!ticket || ticket.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "Ce ticket n'existe plus dans les données du bot.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await decideTicket(interaction, action, ticket);
  }

  return {
    async onReady() {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      const setup = guildState(guildId);
      if (guild && setup) {
        console.log(
          `Tickets configured: panel ${setup.panelChannelId}, ${Object.values(state.tickets).filter((ticket) => ticket.guildId === guildId && !["closed", "deleted"].includes(ticket.status)).length} active.`,
        );
      }
    },

    async handleInteraction(interaction) {
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === ticketCommand.name
      ) {
        await handleTicketCommand(interaction);
        return true;
      }
      if (
        interaction.isButton() &&
        interaction.customId.startsWith("ticket:")
      ) {
        await handleTicketButton(interaction);
        return true;
      }
      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith("ticket:")
      ) {
        await handleModal(interaction);
        return true;
      }
      return false;
    },
  };
}
