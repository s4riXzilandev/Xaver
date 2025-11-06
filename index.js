// =========================
// Xaver v4.0 — Professional Edition 🗡️✨
// Enhanced logging, cleaner structure, better error handling
// =========================

import 'dotenv/config';
import express from 'express';
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  AuditLogEvent
} from 'discord.js';

// ==================== CONFIG ====================
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  port: Number(process.env.PORT || 3000),
  ownerId: process.env.OWNER_ID || null,
  prefix: process.env.PREFIX || 'x!',
  logChannelId: process.env.LOG_CHANNEL_ID || '1435639902233559111',
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
  supportRoleId: process.env.SUPPORT_ROLE_ID || null,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || null,
  healthKey: process.env.HEALTH_KEY || null,
  colors: {
    brand: 0x7C3AED,
    success: 0x10B981,
    error: 0xEF4444,
    warning: 0xF59E0B,
    info: 0x3B82F6
  }
};

if (!CONFIG.token) throw new Error('❌ DISCORD_TOKEN is missing in .env file!');

// ==================== EXPRESS KEEPALIVE ====================
const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    bot: 'Xaver v4.0',
    uptime: process.uptime(),
    message: '🟣 Xaver is elegantly operational.'
  });
});

app.get('/health', (req, res) => {
  if (CONFIG.healthKey && req.query.key !== CONFIG.healthKey) {
    return res.status(403).json({ error: 'Invalid health key' });
  }
  res.status(200).json({ 
    status: 'healthy',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

app.listen(CONFIG.port, () => {
  console.log(`🌐 HTTP server running on port ${CONFIG.port}`);
});

// ==================== DISCORD CLIENT ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.User
  ]
});

// ==================== IN-MEMORY STORES ====================
const userStats = new Map(); // `${guildId}:${userId}` -> {xp, level, lastSeen, username, messageCount}
const cooldowns = new Map();  // cooldown tracking
const activeTickets = new Map(); // track open tickets

// ==================== UTILITY FUNCTIONS ====================
const Utils = {
  // Clean padding for embeds
  pad: (str) => `\u200B${str}`,

  // XP calculation
  xpForLevel: (level) => 5 * level * level + 20 * level + 10,

  // User key generator
  userKey: (guildId, userId) => `${guildId}:${userId}`,

  // Unix timestamp
  timestamp: (date = new Date()) => Math.floor(date.getTime() / 1000),

  // Text clipper
  clip: (text, maxLength = 1000) => {
    if (!text) return '*(no content)*';
    return text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text;
  },

  // Create embed
  embed: ({ 
    title, 
    description, 
    fields, 
    color = CONFIG.colors.brand, 
    footer = true,
    author,
    thumbnail,
    image
  }) => {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTimestamp();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(Utils.pad(description));
    if (fields?.length) embed.addFields(fields);
    if (author) embed.setAuthor(author);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (image) embed.setImage(image);

    if (footer && client.user) {
      embed.setFooter({ 
        text: 'Xaver v4.0', 
        iconURL: client.user.displayAvatarURL() 
      });
    }

    return embed;
  },

  // Send to log channel
  sendLog: async (guild, embed) => {
    if (!CONFIG.logChannelId) return;
    try {
      const channel = guild.channels.cache.get(CONFIG.logChannelId);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('❌ Failed to send log:', error.message);
    }
  },

  // Check if user has permission
  hasPermission: (member, permission) => {
    return member.permissions.has(permission) || 
           (CONFIG.ownerId && member.id === CONFIG.ownerId);
  }
};

// ==================== SLASH COMMANDS ====================
const slashCommands = [
  {
    name: 'help',
    description: 'Display all available commands and features'
  },
  {
    name: 'level',
    description: 'View level and XP statistics',
    options: [{
      name: 'user',
      description: 'Target user (leave empty for yourself)',
      type: 6,
      required: false
    }]
  },
  {
    name: 'leaderboard',
    description: 'View the top-ranked members on this server'
  },
  {
    name: 'say',
    description: 'Send a message through the bot (Admin only)',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        name: 'text',
        description: 'The message content',
        type: 3,
        required: true
      },
      {
        name: 'channel',
        description: 'Target channel (defaults to current)',
        type: 7,
        required: false
      }
    ]
  },
  {
    name: 'announce',
    description: 'Create a professional announcement with interactive buttons',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        name: 'title',
        description: 'Announcement title',
        type: 3,
        required: true
      },
      {
        name: 'message',
        description: 'Announcement content',
        type: 3,
        required: true
      },
      {
        name: 'channel',
        description: 'Target channel',
        type: 7,
        required: false
      },
      {
        name: 'ping',
        description: 'Who to mention',
        type: 3,
        required: false,
        choices: [
          { name: 'None', value: 'none' },
          { name: '@everyone', value: 'everyone' },
          { name: '@here', value: 'here' },
          { name: 'Specific Role', value: 'role' }
        ]
      },
      {
        name: 'role',
        description: 'Role to ping (if ping=role)',
        type: 8,
        required: false
      }
    ]
  },
  {
    name: 'ticket',
    description: 'Manage support tickets',
    options: [
      {
        type: 1,
        name: 'create',
        description: 'Open a new support ticket'
      },
      {
        type: 1,
        name: 'close',
        description: 'Close the current ticket channel'
      }
    ]
  },
  {
    name: 'stats',
    description: 'View bot statistics and information'
  }
];

// ==================== XP SYSTEM ====================
const XPSystem = {
  giveXP: (guildId, userId, username) => {
    const key = Utils.userKey(guildId, userId);
    const cooldownKey = `xp:${key}`;
    const now = Date.now();
    const lastXP = cooldowns.get(cooldownKey) || 0;

    // 10 second cooldown
    if (now - lastXP < 10000) return null;

    const stats = userStats.get(key) || {
      xp: 0,
      level: 0,
      lastSeen: null,
      username: username,
      messageCount: 0
    };

    stats.username = username;
    stats.lastSeen = new Date();
    stats.messageCount++;

    // Give 10-15 XP per message
    const xpGained = 10 + Math.floor(Math.random() * 6);
    stats.xp += xpGained;

    cooldowns.set(cooldownKey, now);

    // Check for level up
    let leveledUp = false;
    while (stats.xp >= Utils.xpForLevel(stats.level)) {
      stats.xp -= Utils.xpForLevel(stats.level);
      stats.level++;
      leveledUp = true;
    }

    userStats.set(key, stats);

    return { stats, leveledUp, xpGained };
  }
};

// ==================== EVENT: READY ====================
client.once('ready', async () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Xaver v4.0 successfully logged in!`);
  console.log(`👤 Username: ${client.user.tag}`);
  console.log(`🆔 User ID: ${client.user.id}`);
  console.log(`🏰 Servers: ${client.guilds.cache.size}`);
  console.log(`${'='.repeat(50)}\n`);

  // Set presence
  client.user.setPresence({
    activities: [{ name: `over ${client.guilds.cache.size} servers | /help` }],
    status: 'online'
  });

  // Register slash commands
  const guilds = await client.guilds.fetch();
  let successCount = 0;

  for (const [guildId] of guilds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(slashCommands);
      successCount++;
    } catch (error) {
      console.warn(`⚠️ Failed to register commands in guild ${guildId}:`, error.message);
    }
  }

  console.log(`🗡️ Slash commands deployed to ${successCount}/${guilds.size} servers\n`);
});

// ==================== EVENT: MESSAGE CREATE (XP) ====================
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const result = XPSystem.giveXP(
    message.guild.id,
    message.author.id,
    message.author.username
  );

  if (result?.leveledUp) {
    const levelUpEmbed = Utils.embed({
      title: '🎉 Level Up!',
      description: `**${message.author.username}** has reached **Level ${result.stats.level}**!`,
      color: CONFIG.colors.success,
      thumbnail: message.author.displayAvatarURL()
    });

    message.channel.send({ embeds: [levelUpEmbed] }).catch(() => {});
  }
});

// ==================== EVENT: MESSAGE DELETE ====================
client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;

  const embed = Utils.embed({
    title: '🗑️ Message Deleted',
    color: CONFIG.colors.warning,
    fields: [
      { name: '👤 Author', value: `${message.author?.tag || 'Unknown'} (${message.author?.id || 'N/A'})`, inline: true },
      { name: '📍 Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: '🕒 Time', value: `<t:${Utils.timestamp()}:R>`, inline: true },
      { name: '📝 Content', value: Utils.clip(message.content || '*No text content*'), inline: false }
    ]
  });

  if (message.attachments.size > 0) {
    embed.addFields({
      name: '📎 Attachments',
      value: message.attachments.map(a => a.url).join('\n')
    });
  }

  Utils.sendLog(message.guild, embed);
});

// ==================== EVENT: MESSAGE UPDATE ====================
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  const embed = Utils.embed({
    title: '✏️ Message Edited',
    color: CONFIG.colors.info,
    fields: [
      { name: '👤 Author', value: `${newMessage.author.tag} (${newMessage.author.id})`, inline: true },
      { name: '📍 Channel', value: `<#${newMessage.channel.id}>`, inline: true },
      { name: '🔗 Jump', value: `[Go to message](${newMessage.url})`, inline: true },
      { name: '📝 Before', value: Utils.clip(oldMessage.content || '*No content*'), inline: false },
      { name: '📝 After', value: Utils.clip(newMessage.content || '*No content*'), inline: false }
    ]
  });

  Utils.sendLog(newMessage.guild, embed);
});

// ==================== EVENT: MEMBER JOIN ====================
client.on('guildMemberAdd', async (member) => {
  // Welcome message
  const welcomeChannel = member.guild.channels.cache.get(CONFIG.welcomeChannelId) || 
                         member.guild.systemChannel;

  if (welcomeChannel?.isTextBased()) {
    const welcomeEmbed = Utils.embed({
      title: '👋 Welcome!',
      description: `Welcome to the server, **${member.user.username}**!\nYou are member #${member.guild.memberCount}`,
      color: CONFIG.colors.success,
      thumbnail: member.user.displayAvatarURL(),
      fields: [
        { name: '📅 Account Created', value: `<t:${Utils.timestamp(member.user.createdAt)}:R>`, inline: true }
      ]
    });

    welcomeChannel.send({ embeds: [welcomeEmbed] }).catch(() => {});
  }

  // Log
  const logEmbed = Utils.embed({
    title: '➕ Member Joined',
    color: CONFIG.colors.success,
    thumbnail: member.user.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: `${member.user.tag}`, inline: true },
      { name: '🆔 ID', value: member.id, inline: true },
      { name: '📅 Account Age', value: `<t:${Utils.timestamp(member.user.createdAt)}:R>`, inline: true },
      { name: '👥 Member Count', value: `${member.guild.memberCount}`, inline: true }
    ]
  });

  Utils.sendLog(member.guild, logEmbed);
});

// ==================== EVENT: MEMBER LEAVE ====================
client.on('guildMemberRemove', async (member) => {
  const embed = Utils.embed({
    title: '➖ Member Left',
    color: CONFIG.colors.error,
    thumbnail: member.user?.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: `${member.user?.tag || 'Unknown'}`, inline: true },
      { name: '🆔 ID', value: member.id, inline: true },
      { name: '📅 Joined Server', value: member.joinedAt ? `<t:${Utils.timestamp(member.joinedAt)}:R>` : 'Unknown', inline: true },
      { name: '👥 Member Count', value: `${member.guild.memberCount}`, inline: true }
    ]
  });

  Utils.sendLog(member.guild, embed);
});

// ==================== EVENT: VOICE STATE UPDATE ====================
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  let embed = null;

  // Joined VC
  if (!oldState.channelId && newState.channelId) {
    embed = Utils.embed({
      title: '🎧 Voice Channel Joined',
      color: CONFIG.colors.success,
      fields: [
        { name: '👤 User', value: `${member.user.tag}`, inline: true },
        { name: '📍 Channel', value: `<#${newState.channelId}>`, inline: true },
        { name: '🕒 Time', value: `<t:${Utils.timestamp()}:R>`, inline: true }
      ]
    });
  }
  // Left VC
  else if (oldState.channelId && !newState.channelId) {
    embed = Utils.embed({
      title: '🎧 Voice Channel Left',
      color: CONFIG.colors.error,
      fields: [
        { name: '👤 User', value: `${member.user.tag}`, inline: true },
        { name: '📍 Channel', value: `<#${oldState.channelId}>`, inline: true },
        { name: '🕒 Time', value: `<t:${Utils.timestamp()}:R>`, inline: true }
      ]
    });
  }
  // Switched VC
  else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    embed = Utils.embed({
      title: '🎧 Voice Channel Switched',
      color: CONFIG.colors.info,
      fields: [
        { name: '👤 User', value: `${member.user.tag}`, inline: true },
        { name: '📍 From', value: `<#${oldState.channelId}>`, inline: true },
        { name: '📍 To', value: `<#${newState.channelId}>`, inline: true }
      ]
    });
  }

  if (embed) Utils.sendLog(guild, embed);
});

// ==================== EVENT: INTERACTION CREATE ====================
client.on('interactionCreate', async (interaction) => {
  // Handle buttons
  if (interaction.isButton()) {
    return handleButton(interaction);
  }

  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    return handleSlashCommand(interaction);
  }
});

// ==================== BUTTON HANDLER ====================
async function handleButton(interaction) {
  const [scope, action, extra] = interaction.customId.split(':');

  // Announcement buttons
  if (scope === 'announce') {
    if (action === 'ack') {
      return interaction.reply({
        ephemeral: true,
        content: Utils.pad('✅ Acknowledged. Stay informed.')
      });
    }

    if (action === 'clear') {
      if (!Utils.hasPermission(interaction.member, PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          ephemeral: true,
          content: Utils.pad('❌ You lack the authority to do this.')
        });
      }

      await interaction.message.edit({ components: [] });
      return interaction.reply({
        ephemeral: true,
        content: Utils.pad('🧹 Buttons removed.')
      });
    }
  }

  // Ticket buttons
  if (scope === 'ticket' && action === 'close') {
    const canClose = 
      Utils.hasPermission(interaction.member, PermissionFlagsBits.ManageChannels) ||
      (CONFIG.supportRoleId && interaction.member.roles.cache.has(CONFIG.supportRoleId)) ||
      interaction.customId.endsWith(interaction.user.id);

    if (!canClose) {
      return interaction.reply({
        ephemeral: true,
        content: Utils.pad('❌ You cannot close this ticket.')
      });
    }

    await interaction.reply({
      ephemeral: true,
      content: Utils.pad('🗑️ Closing ticket...')
    });

    const logEmbed = Utils.embed({
      title: '🎟️ Ticket Closed',
      color: CONFIG.colors.error,
      fields: [
        { name: '👤 Closed By', value: `${interaction.user.tag}`, inline: true },
        { name: '📍 Channel', value: `${interaction.channel.name}`, inline: true }
      ]
    });

    Utils.sendLog(interaction.guild, logEmbed);

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 3000);
  }
}

// ==================== SLASH COMMAND HANDLER ====================
async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'help':
        await handleHelpCommand(interaction);
        break;
      case 'level':
        await handleLevelCommand(interaction);
        break;
      case 'leaderboard':
        await handleLeaderboardCommand(interaction);
        break;
      case 'say':
        await handleSayCommand(interaction);
        break;
      case 'announce':
        await handleAnnounceCommand(interaction);
        break;
      case 'ticket':
        await handleTicketCommand(interaction);
        break;
      case 'stats':
        await handleStatsCommand(interaction);
        break;
      default:
        await interaction.reply({
          ephemeral: true,
          content: Utils.pad('❌ Unknown command.')
        });
    }
  } catch (error) {
    console.error(`Error handling /${commandName}:`, error);

    const errorMessage = {
      ephemeral: true,
      content: Utils.pad('❌ An error occurred while processing your command.')
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
}

// ==================== COMMAND: /help ====================
async function handleHelpCommand(interaction) {
  const embed = Utils.embed({
    title: '🗡️ Xaver — Command Guide',
    description: 'Here are the commands at your disposal:',
    fields: [
      {
        name: '📊 Leveling System',
        value: '`/level [user]` — View level and XP\n`/leaderboard` — Top members',
        inline: false
      },
      {
        name: '🎟️ Support System',
        value: '`/ticket create` — Open a support ticket\n`/ticket close` — Close current ticket',
        inline: false
      },
      {
        name: '📣 Announcements',
        value: '`/announce` — Create professional announcements\n`/say` — Send messages as the bot',
        inline: false
      },
      {
        name: '📈 Bot Information',
        value: '`/stats` — View bot statistics',
        inline: false
      }
    ],
    footer: true
  });

  await interaction.reply({ ephemeral: true, embeds: [embed] });
}

// ==================== COMMAND: /level ====================
async function handleLevelCommand(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const key = Utils.userKey(interaction.guild.id, targetUser.id);
  const stats = userStats.get(key) || { xp: 0, level: 0, messageCount: 0 };

  const nextLevelXP = Utils.xpForLevel(stats.level);
  const progress = Math.round((stats.xp / nextLevelXP) * 100);

  const embed = Utils.embed({
    title: '📊 Level Statistics',
    thumbnail: targetUser.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: targetUser.username, inline: true },
      { name: '⭐ Level', value: `${stats.level}`, inline: true },
      { name: '💬 Messages', value: `${stats.messageCount}`, inline: true },
      { name: '✨ Current XP', value: `${stats.xp}`, inline: true },
      { name: '🎯 Next Level', value: `${nextLevelXP} XP`, inline: true },
      { name: '📈 Progress', value: `${progress}%`, inline: true }
    ]
  });

  await interaction.reply({ embeds: [embed] });
}

// ==================== COMMAND: /leaderboard ====================
async function handleLeaderboardCommand(interaction) {
  const guildStats = [];

  for (const [key, data] of userStats) {
    const [guildId, userId] = key.split(':');
    if (guildId !== interaction.guild.id) continue;
    guildStats.push({ userId, ...data });
  }

  guildStats.sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return b.xp - a.xp;
  });

  const top10 = guildStats.slice(0, 10);

  if (top10.length === 0) {
    return interaction.reply({
      embeds: [Utils.embed({
        title: '🏆 Leaderboard',
        description: 'No activity recorded yet. Start chatting to earn XP!',
        color: CONFIG.colors.warning
      })]
    });
  }

  const description = top10.map((entry, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
    return `${medal} <@${entry.userId}> — Level ${entry.level} (${entry.xp} XP)`;
  }).join('\n');

  const embed = Utils.embed({
    title: '🏆 Server Leaderboard',
    description,
    footer: true
  });

  await interaction.reply({ embeds: [embed] });
}

// ==================== COMMAND: /say ====================
async function handleSayCommand(interaction) {
  if (!Utils.hasPermission(interaction.member, PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      ephemeral: true,
      content: Utils.pad('❌ Insufficient permissions.')
    });
  }

  const text = interaction.options.getString('text', true);
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

  if (!targetChannel.isTextBased()) {
    return interaction.reply({
      ephemeral: true,
      content: Utils.pad('❌ Invalid channel type.')
    });
  }

  const embed = Utils.embed({
    title: '📣 Announcement',
    description: text,
    author: {
      name: interaction.user.tag,
      iconURL: interaction.user.displayAvatarURL()
    }
  });

  await targetChannel.send({ embeds: [embed] });
  await interaction.reply({
    ephemeral: true,
    content: Utils.pad(`✅ Message sent to ${targetChannel}`)
  });

  Utils.sendLog(interaction.guild, Utils.embed({
    title: '📣 /say Command Used',
    color: CONFIG.colors.info,
    fields: [
      { name: '👤 User', value: interaction.user.tag, inline: true },
      { name: '📍 Channel', value: `${targetChannel}`, inline: true }
    ]
  }));
}

// ==================== COMMAND: /announce ====================
async function handleAnnounceCommand(interaction) {
  if (!Utils.hasPermission(interaction.member, PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      ephemeral: true,
      content: Utils.pad('❌ Insufficient permissions.')
    });
  }

  const title = interaction.options.getString('title', true);
  const message = interaction.options.getString('message', true);
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  const pingType = interaction.options.getString('ping') || 'none';
  const role = interaction.options.getRole('role');

  let pingContent = '';
  if (pingType === 'everyone') pingContent = '@everyone';
  else if (pingType === 'here') pingContent = '@here';
  else if (pingType === 'role' && role) pingContent = `<@&${role.id}>`;

  const embed = Utils.embed({
    title: `📣 ${title}`,
    description: message,
    author: {
      name: interaction.user.tag,
      iconURL: interaction.user.displayAvatarURL()
    }
  });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('announce:ack')
      .setLabel('Acknowledge')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('announce:clear')
      .setLabel('Remove Buttons')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🧹')
  );

  await targetChannel.send({
    content: pingContent || undefined,
    embeds: [embed],
    components: [buttons]
  });

  await interaction.reply({
    ephemeral: true,
    content: Utils.pad(`✅ Announcement sent to ${targetChannel}`)
  });

  Utils.sendLog(interaction.guild, Utils.embed({
    title: '📣 Announcement Created',
    color: CONFIG.colors.info,
    fields: [
      { name: '👤 Created By', value: interaction.user.tag, inline: true },
      { name: '📍 Channel', value: `${targetChannel}`, inline: true },
      { name: '📢 Ping', value: pingContent || 'None', inline: true }
    ]
  }));
}

// ==================== COMMAND: /ticket ====================
async function handleTicketCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'create') {
    // Check if user already has a ticket
    const existingTicket = activeTickets.get(interaction.user.id);
    if (existingTicket) {
      return interaction.reply({
        ephemeral: true,
        content: Utils.pad(`❌ You already have an open ticket: <#${existingTicket}>`)
      });
    }

    // Find or create ticket category
    let categoryId = CONFIG.ticketCategoryId;
    if (!categoryId) {
      const existingCategory = interaction.guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && 
             c.name.toLowerCase().includes('ticket')
      );

      if (existingCategory) {
        categoryId = existingCategory.id;
      } else {
        const newCategory = await interaction.guild.channels.create({
          name: '🎟️ Tickets',
          type: ChannelType.GuildCategory
        });
        categoryId = newCategory.id;
      }
    }

    // Create ticket channel
    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 100),
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles
          ]
        },
        ...(CONFIG.supportRoleId ? [{
          id: CONFIG.supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }] : [])
      ]
    });

    // Track active ticket
    activeTickets.set(interaction.user.id, ticketChannel.id);

    // Create close button
    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close:${interaction.user.id}`)
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );

    // Send ticket message
    const ticketEmbed = Utils.embed({
      title: '🎟️ Support Ticket',
      description: `Welcome, <@${interaction.user.id}>!\n\nPlease describe your issue in detail. ${CONFIG.supportRoleId ? `<@&${CONFIG.supportRoleId}>` : 'A staff member'} will assist you shortly.`,
      color: CONFIG.colors.success,
      fields: [
        { name: '📋 Ticket Info', value: `Opened: <t:${Utils.timestamp()}:R>\nOpener: ${interaction.user.tag}`, inline: false }
      ]
    });

    await ticketChannel.send({
      content: `<@${interaction.user.id}>${CONFIG.supportRoleId ? ` <@&${CONFIG.supportRoleId}>` : ''}`,
      embeds: [ticketEmbed],
      components: [closeButton]
    });

    // Reply to user
    await interaction.reply({
      ephemeral: true,
      content: Utils.pad(`✅ Ticket created: ${ticketChannel}`)
    });

    // Log
    Utils.sendLog(interaction.guild, Utils.embed({
      title: '🎟️ Ticket Opened',
      color: CONFIG.colors.success,
      fields: [
        { name: '👤 User', value: interaction.user.tag, inline: true },
        { name: '📍 Channel', value: `${ticketChannel}`, inline: true },
        { name: '🆔 Ticket ID', value: ticketChannel.id, inline: true }
      ]
    }));
  }

  if (subcommand === 'close') {
    // Check if in a ticket channel
    const isTicket = 
      interaction.channel.parentId === CONFIG.ticketCategoryId ||
      interaction.channel.parent?.name.toLowerCase().includes('ticket') ||
      interaction.channel.name.startsWith('ticket-');

    if (!isTicket) {
      return interaction.reply({
        ephemeral: true,
        content: Utils.pad('❌ This command only works in ticket channels.')
      });
    }

    // Check permissions
    const canClose = 
      Utils.hasPermission(interaction.member, PermissionFlagsBits.ManageChannels) ||
      (CONFIG.supportRoleId && interaction.member.roles.cache.has(CONFIG.supportRoleId));

    if (!canClose) {
      return interaction.reply({
        ephemeral: true,
        content: Utils.pad('❌ You do not have permission to close this ticket.')
      });
    }

    await interaction.reply({
      embeds: [Utils.embed({
        title: '🗑️ Closing Ticket',
        description: 'This ticket will be deleted in 5 seconds...',
        color: CONFIG.colors.warning
      })]
    });

    // Remove from active tickets
    for (const [userId, channelId] of activeTickets) {
      if (channelId === interaction.channel.id) {
        activeTickets.delete(userId);
        break;
      }
    }

    // Log
    Utils.sendLog(interaction.guild, Utils.embed({
      title: '🎟️ Ticket Closed',
      color: CONFIG.colors.error,
      fields: [
        { name: '👤 Closed By', value: interaction.user.tag, inline: true },
        { name: '📍 Channel', value: interaction.channel.name, inline: true },
        { name: '🕒 Time', value: `<t:${Utils.timestamp()}:R>`, inline: true }
      ]
    }));

    // Delete channel after 5 seconds
    setTimeout(() => {
      interaction.channel.delete().catch(console.error);
    }, 5000);
  }
}

// ==================== COMMAND: /stats ====================
async function handleStatsCommand(interaction) {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  const memUsage = process.memoryUsage();
  const memoryMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

  const totalMembers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  const totalChannels = client.channels.cache.size;

  const embed = Utils.embed({
    title: '📊 Xaver Statistics',
    thumbnail: client.user.displayAvatarURL(),
    fields: [
      { name: '🏰 Servers', value: `${client.guilds.cache.size}`, inline: true },
      { name: '👥 Total Members', value: `${totalMembers.toLocaleString()}`, inline: true },
      { name: '📺 Channels', value: `${totalChannels}`, inline: true },
      { name: '⏱️ Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
      { name: '💾 Memory', value: `${memoryMB} MB`, inline: true },
      { name: '🔢 Commands', value: `${slashCommands.length}`, inline: true },
      { name: '📈 Tracked Users', value: `${userStats.size}`, inline: true },
      { name: '🎟️ Active Tickets', value: `${activeTickets.size}`, inline: true },
      { name: '🤖 Bot Version', value: 'v4.0', inline: true }
    ],
    footer: true
  });

  await interaction.reply({ embeds: [embed] });
}

// ==================== ADDITIONAL EVENT LOGS ====================

// Role changes
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
  const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

  if (addedRoles.size > 0 || removedRoles.size > 0) {
    const fields = [];

    if (addedRoles.size > 0) {
      fields.push({
        name: '➕ Added Roles',
        value: addedRoles.map(r => r.name).join(', '),
        inline: false
      });
    }

    if (removedRoles.size > 0) {
      fields.push({
        name: '➖ Removed Roles',
        value: removedRoles.map(r => r.name).join(', '),
        inline: false
      });
    }

    const embed = Utils.embed({
      title: '🎭 Member Roles Updated',
      color: CONFIG.colors.info,
      thumbnail: newMember.user.displayAvatarURL(),
      fields: [
        { name: '👤 User', value: `${newMember.user.tag} (${newMember.id})`, inline: false },
        ...fields
      ]
    });

    Utils.sendLog(newMember.guild, embed);
  }

  // Nickname changes
  if (oldMember.nickname !== newMember.nickname) {
    const embed = Utils.embed({
      title: '✏️ Nickname Changed',
      color: CONFIG.colors.info,
      thumbnail: newMember.user.displayAvatarURL(),
      fields: [
        { name: '👤 User', value: newMember.user.tag, inline: true },
        { name: '📝 Old Nickname', value: oldMember.nickname || '*None*', inline: true },
        { name: '📝 New Nickname', value: newMember.nickname || '*None*', inline: true }
      ]
    });

    Utils.sendLog(newMember.guild, embed);
  }
});

// Channel create/delete
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;

  const typeMap = {
    [ChannelType.GuildText]: 'Text Channel',
    [ChannelType.GuildVoice]: 'Voice Channel',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement Channel',
    [ChannelType.GuildStageVoice]: 'Stage Channel',
    [ChannelType.GuildForum]: 'Forum Channel'
  };

  const embed = Utils.embed({
    title: '➕ Channel Created',
    color: CONFIG.colors.success,
    fields: [
      { name: '📺 Channel', value: `${channel}`, inline: true },
      { name: '🏷️ Name', value: channel.name, inline: true },
      { name: '📋 Type', value: typeMap[channel.type] || 'Unknown', inline: true }
    ]
  });

  Utils.sendLog(channel.guild, embed);
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;

  const typeMap = {
    [ChannelType.GuildText]: 'Text Channel',
    [ChannelType.GuildVoice]: 'Voice Channel',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement Channel',
    [ChannelType.GuildStageVoice]: 'Stage Channel',
    [ChannelType.GuildForum]: 'Forum Channel'
  };

  const embed = Utils.embed({
    title: '🗑️ Channel Deleted',
    color: CONFIG.colors.error,
    fields: [
      { name: '🏷️ Name', value: channel.name, inline: true },
      { name: '📋 Type', value: typeMap[channel.type] || 'Unknown', inline: true },
      { name: '🆔 ID', value: channel.id, inline: true }
    ]
  });

  Utils.sendLog(channel.guild, embed);
});

// Bans
client.on('guildBanAdd', async (ban) => {
  const embed = Utils.embed({
    title: '🔨 Member Banned',
    color: CONFIG.colors.error,
    thumbnail: ban.user.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: `${ban.user.tag}`, inline: true },
      { name: '🆔 ID', value: ban.user.id, inline: true },
      { name: '📋 Reason', value: ban.reason || 'No reason provided', inline: false }
    ]
  });

  Utils.sendLog(ban.guild, embed);
});

client.on('guildBanRemove', async (ban) => {
  const embed = Utils.embed({
    title: '🔓 Member Unbanned',
    color: CONFIG.colors.success,
    thumbnail: ban.user.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: `${ban.user.tag}`, inline: true },
      { name: '🆔 ID', value: ban.user.id, inline: true }
    ]
  });

  Utils.sendLog(ban.guild, embed);
});

// ==================== ERROR HANDLING ====================
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

client.on('error', (error) => {
  console.error('❌ Discord Client Error:', error);
});

client.on('warn', (warning) => {
  console.warn('⚠️ Discord Client Warning:', warning);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await client.destroy();
  process.exit(0);
});

// ==================== LOGIN ====================
client.login(CONFIG.token).catch((error) => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});