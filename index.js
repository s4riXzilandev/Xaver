// =========================
// Xaver Alpha 5.0.1 — MEGA Edition 🔥
// Phase 1: Config, Warns, AFK, Starboard, Polls, Reaction Roles
// Phase 2 LITE: AutoMod (Spam, Links, Bad Words)
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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';

// ==================== CONFIG ====================
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  port: Number(process.env.PORT || 3000),
  ownerId: '1410618634732048548',
  prefix: process.env.PREFIX || 'x!',
  healthKey: process.env.HEALTH_KEY || null,
  version: 'Alpha 5.0.1',
  colors: {
    brand: 0x7C3AED,
    success: 0x10B981,
    error: 0xEF4444,
    warning: 0xF59E0B,
    info: 0x3B82F6
  }
};

if (!CONFIG.token) throw new Error('❌ DISCORD_TOKEN is missing!');

// ==================== EXPRESS ====================
const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    bot: `Xaver ${CONFIG.version}`,
    uptime: process.uptime(),
    message: `🔥 Xaver ${CONFIG.version} is running!`
  });
});

app.get('/health', (req, res) => {
  if (CONFIG.healthKey && req.query.key !== CONFIG.healthKey) {
    return res.status(403).json({ error: 'Invalid key' });
  }
  res.status(200).json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    version: CONFIG.version
  });
});

app.listen(CONFIG.port, () => console.log(`🌐 HTTP on :${CONFIG.port}`));

// ==================== CLIENT ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.User,
    Partials.Reaction
  ]
});

// ==================== IN-MEMORY STORAGE ====================
const guildConfigs = new Map();
const userStats = new Map();
const cooldowns = new Map();
const activeTickets = new Map();
const warns = new Map();
const afkUsers = new Map();
const starboardCache = new Map();
const activePolls = new Map();
const reactionRolePanels = new Map();
const userMessageTimestamps = new Map();

// ==================== UTILS ====================
const Utils = {
  pad: (s) => `\u200B${s}`,
  xpForLevel: (l) => 5 * l * l + 20 * l + 10,
  userKey: (g, u) => `${g}:${u}`,
  timestamp: (d = new Date()) => Math.floor(d.getTime() / 1000),

  clip: (text, max = 1000) => {
    if (!text) return '*(no content)*';
    return text.length > max ? text.slice(0, max - 3) + '...' : text;
  },

  embed: ({ title, description, fields, color = CONFIG.colors.brand, footer = true, author, thumbnail, image }) => {
    const e = new EmbedBuilder().setColor(color).setTimestamp();
    if (title) e.setTitle(title);
    if (description) e.setDescription(Utils.pad(description));
    if (fields?.length) e.addFields(fields);
    if (author) e.setAuthor(author);
    if (thumbnail) e.setThumbnail(thumbnail);
    if (image) e.setImage(image);
    if (footer && client.user) {
      e.setFooter({ text: `Xaver ${CONFIG.version}`, iconURL: client.user.displayAvatarURL() });
    }
    return e;
  },

  getConfig: (guildId) => {
    if (!guildConfigs.has(guildId)) {
      guildConfigs.set(guildId, {
        logChannel: null,
        welcomeChannel: null,
        verifyRole: null,
        supportRole: null,
        ticketCategory: null,
        starboardChannel: null,
        starboardEmoji: '⭐',
        starboardThreshold: 3,
        autoStrikeKick: 3,
        autoStrikeBan: 5,
        // AutoMod
        autoModEnabled: false,
        antiSpam: false,
        antiLinks: false,
        badWords: [],
        whitelistedLinks: ['youtube.com', 'discord.gg', 'discord.com', 'tenor.com', 'giphy.com']
      });
    }
    return guildConfigs.get(guildId);
  },

  sendLog: async (guild, embed) => {
    const cfg = Utils.getConfig(guild.id);
    if (!cfg.logChannel) return;
    try {
      const ch = guild.channels.cache.get(cfg.logChannel);
      if (ch?.isTextBased()) await ch.send({ embeds: [embed] });
    } catch (e) {
      console.error('Log error:', e.message);
    }
  },

  hasPermission: (member, perm) => {
    return member.id === CONFIG.ownerId || member.permissions.has(perm);
  },

  isMod: (member) => {
    return member.id === CONFIG.ownerId || 
           member.permissions.has(PermissionFlagsBits.ModerateMembers);
  },

  containsBadWord: (text, badWords) => {
    if (!badWords || badWords.length === 0) return false;
    const lower = text.toLowerCase();
    return badWords.some(word => lower.includes(word.toLowerCase()));
  },

  containsLink: (text, whitelisted) => {
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|net|org|de|ch|at|co\.uk|io|gg|xyz)[^\s]*)/gi;
    const matches = text.match(urlRegex);
    if (!matches) return false;

    return matches.some(url => {
      return !whitelisted.some(domain => url.toLowerCase().includes(domain.toLowerCase()));
    });
  }
};

// ==================== XP SYSTEM ====================
const XPSystem = {
  give: (guildId, userId, username) => {
    const key = Utils.userKey(guildId, userId);
    const cdKey = `xp:${key}`;
    const now = Date.now();
    const last = cooldowns.get(cdKey) || 0;
    if (now - last < 10000) return null;

    const s = userStats.get(key) || { xp: 0, level: 0, messages: 0, username };
    s.username = username;
    s.messages++;
    s.xp += 10 + Math.floor(Math.random() * 6);
    cooldowns.set(cdKey, now);

    let leveled = false;
    while (s.xp >= Utils.xpForLevel(s.level)) {
      s.xp -= Utils.xpForLevel(s.level);
      s.level++;
      leveled = true;
    }
    userStats.set(key, s);
    return { stats: s, leveled };
  }
};

// ==================== WARN SYSTEM ====================
const WarnSystem = {
  add: (guildId, userId, reason, modId, modTag) => {
    const key = Utils.userKey(guildId, userId);
    const list = warns.get(key) || [];
    const warn = {
      id: Date.now().toString(),
      reason,
      moderator: modTag,
      moderatorId: modId,
      date: new Date()
    };
    list.push(warn);
    warns.set(key, list);
    return { warn, total: list.length };
  },

  get: (guildId, userId) => {
    return warns.get(Utils.userKey(guildId, userId)) || [];
  },

  remove: (guildId, userId, warnId) => {
    const key = Utils.userKey(guildId, userId);
    const list = warns.get(key) || [];
    const filtered = list.filter(w => w.id !== warnId);
    warns.set(key, filtered);
    return list.length - filtered.length > 0;
  },

  clear: (guildId, userId) => {
    const key = Utils.userKey(guildId, userId);
    const count = (warns.get(key) || []).length;
    warns.delete(key);
    return count;
  }
};

// ==================== AUTOMOD SYSTEM ====================
const AutoMod = {
  checkSpam: (guildId, userId) => {
    const key = Utils.userKey(guildId, userId);
    const now = Date.now();
    const timestamps = userMessageTimestamps.get(key) || [];

    const recent = timestamps.filter(t => now - t < 5000);
    recent.push(now);
    userMessageTimestamps.set(key, recent);

    return recent.length >= 5;
  },

  resetSpam: (guildId, userId) => {
    userMessageTimestamps.delete(Utils.userKey(guildId, userId));
  }
};

// ==================== SLASH COMMANDS ====================
const commands = [
  { name: 'help', description: 'Show all commands' },
  { name: 'level', description: 'View level stats', options: [{ name: 'user', description: 'User to check', type: 6, required: false }] },
  { name: 'leaderboard', description: 'Top members' },

  {
    name: 'config',
    description: 'Configure server settings',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { type: 1, name: 'show', description: 'Show current configuration' },
      {
        type: 1, 
        name: 'set', 
        description: 'Change a configuration setting',
        options: [
          {
            name: 'key',
            description: 'Setting to change',
            type: 3,
            required: true,
            choices: [
              { name: 'log_channel', value: 'logChannel' },
              { name: 'welcome_channel', value: 'welcomeChannel' },
              { name: 'starboard_channel', value: 'starboardChannel' },
              { name: 'verify_role', value: 'verifyRole' },
              { name: 'support_role', value: 'supportRole' },
              { name: 'ticket_category', value: 'ticketCategory' },
              { name: 'starboard_emoji', value: 'starboardEmoji' },
              { name: 'starboard_threshold', value: 'starboardThreshold' }
            ]
          },
          { name: 'value', description: 'New value', type: 3, required: true }
        ]
      }
    ]
  },

  {
    name: 'automod',
    description: 'Configure AutoMod system',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        type: 1,
        name: 'toggle',
        description: 'Enable/disable AutoMod features',
        options: [
          {
            name: 'feature',
            description: 'Feature to toggle',
            type: 3,
            required: true,
            choices: [
              { name: 'AutoMod System', value: 'autoModEnabled' },
              { name: 'Anti-Spam', value: 'antiSpam' },
              { name: 'Anti-Links', value: 'antiLinks' }
            ]
          },
          { name: 'enabled', description: 'Enable or disable', type: 5, required: true }
        ]
      },
      {
        type: 1,
        name: 'badwords',
        description: 'Manage bad words filter',
        options: [
          {
            name: 'action',
            description: 'Action',
            type: 3,
            required: true,
            choices: [
              { name: 'Add', value: 'add' },
              { name: 'Remove', value: 'remove' },
              { name: 'List', value: 'list' }
            ]
          },
          { name: 'word', description: 'Word to add/remove', type: 3, required: false }
        ]
      },
      {
        type: 1,
        name: 'whitelist',
        description: 'Manage whitelisted links',
        options: [
          {
            name: 'action',
            description: 'Action',
            type: 3,
            required: true,
            choices: [
              { name: 'Add', value: 'add' },
              { name: 'Remove', value: 'remove' },
              { name: 'List', value: 'list' }
            ]
          },
          { name: 'domain', description: 'Domain (e.g., youtube.com)', type: 3, required: false }
        ]
      }
    ]
  },

  {
    name: 'warn',
    description: 'Warn a user',
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [
      { name: 'user', description: 'User to warn', type: 6, required: true },
      { name: 'reason', description: 'Reason', type: 3, required: true }
    ]
  },
  {
    name: 'strikes',
    description: 'View user warnings',
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [{ name: 'user', description: 'User to check', type: 6, required: true }]
  },
  {
    name: 'pardon',
    description: 'Remove user warnings',
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [
      { name: 'user', description: 'User to pardon', type: 6, required: true },
      { name: 'warn_id', description: 'Specific warning ID', type: 3, required: false }
    ]
  },

  { name: 'afk', description: 'Set your AFK status', options: [{ name: 'reason', description: 'Reason', type: 3, required: false }] },

  {
    name: 'poll',
    description: 'Create a poll',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { name: 'question', description: 'Poll question', type: 3, required: true },
      { name: 'options', description: 'Options (Yes;No;Maybe)', type: 3, required: true },
      { name: 'duration', description: 'Duration in minutes', type: 4, required: false }
    ]
  },

  {
    name: 'roles',
    description: 'Manage reaction roles',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        type: 1, 
        name: 'panel', 
        description: 'Create a reaction role panel',
        options: [
          { name: 'title', description: 'Panel title', type: 3, required: true },
          { name: 'description', description: 'Panel description', type: 3, required: false }
        ]
      },
      {
        type: 1,
        name: 'add',
        description: 'Add a role to the last panel',
        options: [
          { name: 'role', description: 'Role to add', type: 8, required: true },
          { name: 'emoji', description: 'Emoji (optional)', type: 3, required: false },
          { name: 'label', description: 'Button label', type: 3, required: false }
        ]
      }
    ]
  },

  {
    name: 'say',
    description: 'Send a message as the bot',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { name: 'text', description: 'Message', type: 3, required: true },
      { name: 'channel', description: 'Channel', type: 7, required: false }
    ]
  },

  {
    name: 'announce',
    description: 'Create an announcement',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { name: 'title', description: 'Title', type: 3, required: true },
      { name: 'message', description: 'Message', type: 3, required: true },
      { name: 'channel', description: 'Channel', type: 7, required: false },
      { name: 'ping', description: 'Who to ping', type: 3, required: false, choices: [
        { name: 'None', value: 'none' },
        { name: '@everyone', value: 'everyone' },
        { name: '@here', value: 'here' }
      ]}
    ]
  },

  {
    name: 'ticket',
    description: 'Ticket system',
    options: [
      { type: 1, name: 'create', description: 'Create a support ticket' },
      { type: 1, name: 'close', description: 'Close the current ticket' }
    ]
  },

  {
    name: 'verify',
    description: 'Setup verification system',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { name: 'role', description: 'Role to give', type: 8, required: true },
      { name: 'channel', description: 'Channel', type: 7, required: false }
    ]
  },

  { name: 'stats', description: 'View bot statistics' }
];

// ==================== READY ====================
client.once('ready', async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔥 Xaver ${CONFIG.version} | ${client.user.tag}`);
  console.log(`🏰 Servers: ${client.guilds.cache.size}`);
  console.log(`${'='.repeat(60)}\n`);

  client.user.setPresence({
    activities: [{ name: `${CONFIG.version} | /help` }],
    status: 'online'
  });

  const guilds = await client.guilds.fetch();
  let ok = 0;
  for (const [gid] of guilds) {
    try {
      const g = await client.guilds.fetch(gid);
      await g.commands.set(commands);
      ok++;
    } catch (e) {
      console.warn(`Failed ${gid}:`, e.message);
    }
  }
  console.log(`✅ Commands in ${ok}/${guilds.size} guilds\n`);
});

// ==================== MESSAGE CREATE ====================
client.on('messageCreate', async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  const cfg = Utils.getConfig(msg.guild.id);

  // AFK Check
  if (afkUsers.has(msg.author.id)) {
    afkUsers.delete(msg.author.id);
    msg.reply({ content: '👋 Welcome back! AFK removed.' }).catch(() => {});
  }

  msg.mentions.users.forEach(user => {
    if (afkUsers.has(user.id)) {
      const afk = afkUsers.get(user.id);
      msg.reply({ content: `💤 **${user.username}** is AFK: ${afk.reason}\n*Since <t:${Utils.timestamp(afk.since)}:R>*` }).catch(() => {});
    }
  });

  // AutoMod
  if (cfg.autoModEnabled && !Utils.isMod(msg.member)) {
    let shouldDelete = false;
    let reason = '';

    // Bad Words
    if (cfg.badWords.length > 0 && Utils.containsBadWord(msg.content, cfg.badWords)) {
      shouldDelete = true;
      reason = 'Bad word detected';
    }

    // Anti-Links
    if (cfg.antiLinks && Utils.containsLink(msg.content, cfg.whitelistedLinks)) {
      shouldDelete = true;
      reason = 'Unauthorized link';
    }

    // Anti-Spam
    if (cfg.antiSpam && AutoMod.checkSpam(msg.guild.id, msg.author.id)) {
      shouldDelete = true;
      reason = 'Spamming';

      try {
        await msg.member.timeout(2 * 60 * 1000, 'AutoMod: Spam');
        msg.channel.send(`⏱️ ${msg.author} timed out for 2 minutes (Spam)`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000)).catch(() => {});
      } catch (e) {
        console.error('Timeout failed:', e.message);
      }
    }

    if (shouldDelete) {
      try {
        await msg.delete();
        const warning = await msg.channel.send(`⚠️ ${msg.author}, message deleted: **${reason}**`);
        setTimeout(() => warning.delete().catch(() => {}), 5000);

        Utils.sendLog(msg.guild, Utils.embed({
          title: '🛡️ AutoMod Action',
          color: CONFIG.colors.warning,
          fields: [
            { name: '👤 User', value: msg.author.tag, inline: true },
            { name: '📍 Channel', value: `<#${msg.channel.id}>`, inline: true },
            { name: '📋 Reason', value: reason, inline: true },
            { name: '📝 Content', value: Utils.clip(msg.content, 500), inline: false }
          ]
        }));
      } catch (e) {
        console.error('AutoMod failed:', e.message);
      }
      return;
    }
  }

  // XP
  const result = XPSystem.give(msg.guild.id, msg.author.id, msg.author.username);
  if (result?.leveled) {
    msg.channel.send({
      embeds: [Utils.embed({
        title: '🎉 Level Up!',
        description: `**${msg.author.username}** reached **Level ${result.stats.level}**!`,
        color: CONFIG.colors.success,
        thumbnail: msg.author.displayAvatarURL()
      })]
    }).catch(() => {});
  }
});

// ==================== MESSAGE DELETE ====================
client.on('messageDelete', async (msg) => {
  if (!msg.guild || msg.author?.bot) return;
  Utils.sendLog(msg.guild, Utils.embed({
    title: '🗑️ Message Deleted',
    color: CONFIG.colors.warning,
    fields: [
      { name: '👤 Author', value: `${msg.author?.tag || 'Unknown'}`, inline: true },
      { name: '📍 Channel', value: `<#${msg.channel.id}>`, inline: true },
      { name: '📝 Content', value: Utils.clip(msg.content || '*No text*'), inline: false }
    ]
  }));
});

// ==================== MESSAGE UPDATE ====================
client.on('messageUpdate', async (old, newMsg) => {
  if (!newMsg.guild || newMsg.author?.bot || old.content === newMsg.content) return;
  Utils.sendLog(newMsg.guild, Utils.embed({
    title: '✏️ Message Edited',
    color: CONFIG.colors.info,
    fields: [
      { name: '👤 Author', value: newMsg.author.tag, inline: true },
      { name: '📍 Channel', value: `<#${newMsg.channel.id}>`, inline: true },
      { name: '🔗 Jump', value: `[Link](${newMsg.url})`, inline: true },
      { name: '📝 Before', value: Utils.clip(old.content || '*No content*'), inline: false },
      { name: '📝 After', value: Utils.clip(newMsg.content), inline: false }
    ]
  }));
});

// ==================== REACTION ADD (Starboard) ====================
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }

  const msg = reaction.message;
  if (!msg.guild) return;

  const cfg = Utils.getConfig(msg.guild.id);
  if (!cfg.starboardChannel) return;
  if (reaction.emoji.name !== cfg.starboardEmoji) return;
  if (reaction.count < cfg.starboardThreshold) return;
  if (msg.author.id === user.id) return;
  if (starboardCache.has(msg.id)) return;

  const starCh = msg.guild.channels.cache.get(cfg.starboardChannel);
  if (!starCh?.isTextBased()) return;

  const embed = Utils.embed({
    color: CONFIG.colors.warning,
    author: { name: msg.author.tag, iconURL: msg.author.displayAvatarURL() },
    description: Utils.clip(msg.content || '*No text*', 500),
    fields: [
      { name: '📍 Channel', value: `<#${msg.channel.id}>`, inline: true },
      { name: '🔗 Jump', value: `[Message](${msg.url})`, inline: true },
      { name: '⭐ Stars', value: `${reaction.count}`, inline: true }
    ],
    footer: false
  });

  if (msg.attachments.size > 0) {
    const first = msg.attachments.first();
    if (first.contentType?.startsWith('image')) {
      embed.setImage(first.url);
    }
  }

  try {
    const starMsg = await starCh.send({ embeds: [embed] });
    starboardCache.set(msg.id, starMsg.id);
  } catch (e) {
    console.error('Starboard error:', e.message);
  }
});

// ==================== MEMBER JOIN ====================
client.on('guildMemberAdd', async (member) => {
  const cfg = Utils.getConfig(member.guild.id);

  if (cfg.welcomeChannel) {
    const ch = member.guild.channels.cache.get(cfg.welcomeChannel);
    if (ch?.isTextBased()) {
      const accountAge = Math.floor((Date.now() - member.user.createdAt.getTime()) / 86400000);
      ch.send({
        content: `👋 Welcome ${member}!`,
        embeds: [Utils.embed({
          title: '🎉 Welcome!',
          description: `Welcome to **${member.guild.name}**, ${member.user.username}!\nYou are member **#${member.guild.memberCount}**`,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
          fields: [{ name: '📅 Account Age', value: `${accountAge} days`, inline: true }],
          color: CONFIG.colors.success
        })]
      }).catch(() => {});
    }
  }

  Utils.sendLog(member.guild, Utils.embed({
    title: '➕ Member Joined',
    color: CONFIG.colors.success,
    thumbnail: member.user.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: member.user.tag, inline: true },
      { name: '🆔 ID', value: member.id, inline: true },
      { name: '👥 Count', value: `${member.guild.memberCount}`, inline: true }
    ]
  }));
});

// ==================== MEMBER LEAVE ====================
client.on('guildMemberRemove', async (member) => {
  Utils.sendLog(member.guild, Utils.embed({
    title: '➖ Member Left',
    color: CONFIG.colors.error,
    thumbnail: member.user?.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: member.user?.tag || 'Unknown', inline: true },
      { name: '🆔 ID', value: member.id, inline: true },
      { name: '👥 Count', value: `${member.guild.memberCount}`, inline: true }
    ]
  }));
});

// ==================== VOICE STATE ====================
client.on('voiceStateUpdate', async (oldS, newS) => {
  const guild = newS.guild || oldS.guild;
  const member = newS.member || oldS.member;
  if (!guild || !member || member.user.bot) return;

  let embed = null;
  if (!oldS.channelId && newS.channelId) {
    embed = Utils.embed({
      title: '🎧 VC Joined',
      color: CONFIG.colors.success,
      fields: [
        { name: '👤 User', value: member.user.tag, inline: true },
        { name: '📍 Channel', value: `<#${newS.channelId}>`, inline: true }
      ]
    });
  } else if (oldS.channelId && !newS.channelId) {
    embed = Utils.embed({
      title: '🎧 VC Left',
      color: CONFIG.colors.error,
      fields: [
        { name: '👤 User', value: member.user.tag, inline: true },
        { name: '📍 Channel', value: `<#${oldS.channelId}>`, inline: true }
      ]
    });
  } else if (oldS.channelId && newS.channelId && oldS.channelId !== newS.channelId) {
    embed = Utils.embed({
      title: '🎧 VC Switched',
      color: CONFIG.colors.info,
      fields: [
        { name: '👤 User', value: member.user.tag, inline: true },
        { name: '📍 From → To', value: `<#${oldS.channelId}> → <#${newS.channelId}>`, inline: true }
      ]
    });
  }
  if (embed) Utils.sendLog(guild, embed);
});

// ==================== ROLE EVENTS ====================
client.on('roleCreate', async (role) => {
  Utils.sendLog(role.guild, Utils.embed({
    title: '🎭 Role Created',
    color: CONFIG.colors.success,
    fields: [
      { name: '🏷️ Name', value: role.name, inline: true },
      { name: '🎨 Color', value: role.hexColor, inline: true },
      { name: '🆔 ID', value: role.id, inline: true }
    ]
  }));
});

client.on('roleDelete', async (role) => {
  Utils.sendLog(role.guild, Utils.embed({
    title: '🗑️ Role Deleted',
    color: CONFIG.colors.error,
    fields: [
      { name: '🏷️ Name', value: role.name, inline: true },
      { name: '🎨 Color', value: role.hexColor, inline: true }
    ]
  }));
});

client.on('roleUpdate', async (oldR, newR) => {
  const changes = [];
  if (oldR.name !== newR.name) changes.push({ name: '🏷️ Name', value: `${oldR.name} → ${newR.name}`, inline: false });
  if (oldR.hexColor !== newR.hexColor) changes.push({ name: '🎨 Color', value: `${oldR.hexColor} → ${newR.hexColor}`, inline: true });
  if (changes.length === 0) return;

  Utils.sendLog(newR.guild, Utils.embed({
    title: '🎭 Role Updated',
    color: CONFIG.colors.info,
    description: `Role: ${newR}`,
    fields: changes
  }));
});

client.on('guildMemberUpdate', async (oldM, newM) => {
  const oldRoles = oldM.roles.cache;
  const newRoles = newM.roles.cache;
  const added = newRoles.filter(r => !oldRoles.has(r.id));
  const removed = oldRoles.filter(r => !newRoles.has(r.id));

  if (added.size > 0 || removed.size > 0) {
    const fields = [{ name: '👤 User', value: newM.user.tag, inline: false }];
    if (added.size > 0) fields.push({ name: '➕ Added', value: added.map(r => r.name).join(', '), inline: false });
    if (removed.size > 0) fields.push({ name: '➖ Removed', value: removed.map(r => r.name).join(', '), inline: false });

    Utils.sendLog(newM.guild, Utils.embed({
      title: '🎭 Member Roles Updated',
      color: CONFIG.colors.info,
      thumbnail: newM.user.displayAvatarURL(),
      fields
    }));
  }

  if (oldM.nickname !== newM.nickname) {
    Utils.sendLog(newM.guild, Utils.embed({
      title: '✏️ Nickname Changed',
      color: CONFIG.colors.info,
      fields: [
        { name: '👤 User', value: newM.user.tag, inline: true },
        { name: '📝 Old', value: oldM.nickname || '*None*', inline: true },
        { name: '📝 New', value: newM.nickname || '*None*', inline: true }
      ]
    }));
  }
});

// ==================== BAN EVENTS ====================
client.on('guildBanAdd', async (ban) => {
  Utils.sendLog(ban.guild, Utils.embed({
    title: '🔨 Member Banned',
    color: CONFIG.colors.error,
    thumbnail: ban.user.displayAvatarURL(),
    fields: [
      { name: '👤 User', value: ban.user.tag, inline: true },
      { name: '📋 Reason', value: ban.reason || 'No reason', inline: false }
    ]
  }));
});

client.on('guildBanRemove', async (ban) => {
  Utils.sendLog(ban.guild, Utils.embed({
    title: '🔓 Member Unbanned',
    color: CONFIG.colors.success,
    fields: [{ name: '👤 User', value: ban.user.tag, inline: true }]
  }));
});

// ==================== INTERACTION ====================
client.on('interactionCreate', async (itx) => {
  if (itx.isButton()) return handleButton(itx);
  if (itx.isStringSelectMenu()) return handleSelectMenu(itx);
  if (itx.isChatInputCommand()) return handleCommand(itx);
});

// ==================== BUTTON HANDLER ====================
async function handleButton(itx) {
  const [scope, action, ...args] = itx.customId.split(':');

  if (scope === 'verify' && action === 'click') {
    const roleId = args[0];
    const role = itx.guild.roles.cache.get(roleId);
    if (!role) return itx.reply({ ephemeral: true, content: '❌ Role not found!' });
    if (itx.member.roles.cache.has(roleId)) {
      return itx.reply({ ephemeral: true, content: '✅ Already verified!' });
    }
    await itx.member.roles.add(role);
    itx.reply({
      ephemeral: true,
      embeds: [Utils.embed({
        title: '✅ Verified!',
        description: `You received ${role}!\nWelcome to **${itx.guild.name}**!`,
        color: CONFIG.colors.success
      })]
    });
    Utils.sendLog(itx.guild, Utils.embed({
      title: '✅ Member Verified',
      color: CONFIG.colors.success,
      fields: [
        { name: '👤 User', value: itx.user.tag, inline: true },
        { name: '🎭 Role', value: `${role}`, inline: true }
      ]
    }));
    return;
  }

  if (scope === 'poll' && action === 'vote') {
    const msgId = args[0];
    const optionIndex = parseInt(args[1]);
    const poll = activePolls.get(msgId);
    if (!poll) return itx.reply({ ephemeral: true, content: '❌ Poll not found!' });

    const hasVoted = poll.votes.some(v => v.userId === itx.user.id);
    if (hasVoted) {
      poll.votes = poll.votes.filter(v => v.userId !== itx.user.id);
    }

    poll.votes.push({ userId: itx.user.id, option: optionIndex });
    activePolls.set(msgId, poll);

    const results = {};
    poll.options.forEach((_, i) => results[i] = 0);
    poll.votes.forEach(v => results[v.option]++);

    const fields = poll.options.map((opt, i) => {
      const count = results[i] || 0;
      const percent = poll.votes.length > 0 ? Math.round((count / poll.votes.length) * 100) : 0;
      const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
      return {
        name: `${i + 1}. ${opt}`,
        value: `${bar} ${count} votes (${percent}%)`,
        inline: false
      };
    });

    const embed = Utils.embed({
      title: `📊 ${poll.question}`,
      description: `Total votes: **${poll.votes.length}**${poll.endsAt ? `\nEnds: <t:${Utils.timestamp(poll.endsAt)}:R>` : ''}`,
      fields,
      color: CONFIG.colors.brand
    });

    await itx.update({ embeds: [embed] });
    return;
  }

  if (scope === 'rr' && action === 'toggle') {
    const roleId = args[0];
    const role = itx.guild.roles.cache.get(roleId);
    if (!role) return itx.reply({ ephemeral: true, content: '❌ Role not found!' });

    const has = itx.member.roles.cache.has(roleId);
    if (has) {
      await itx.member.roles.remove(role);
      return itx.reply({ ephemeral: true, content: `✅ Removed ${role}!` });
    } else {
      await itx.member.roles.add(role);
      return itx.reply({ ephemeral: true, content: `✅ Added ${role}!` });
    }
  }

  if (scope === 'announce') {
    if (action === 'ack') {
      return itx.reply({ ephemeral: true, content: '✅ Acknowledged!' });
    }
    if (action === 'clear') {
      if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
        return itx.reply({ ephemeral: true, content: '❌ No permission!' });
      }
      await itx.message.edit({ components: [] });
      return itx.reply({ ephemeral: true, content: '🧹 Buttons removed.' });
    }
  }

  if (scope === 'ticket' && action === 'close') {
    const cfg = Utils.getConfig(itx.guild.id);
    const canClose = 
      Utils.isMod(itx.member) ||
      (cfg.supportRole && itx.member.roles.cache.has(cfg.supportRole)) ||
      args[0] === itx.user.id;

    if (!canClose) return itx.reply({ ephemeral: true, content: '❌ Cannot close!' });

    await itx.reply({ content: '🗑️ Closing in 3 seconds...' });
    Utils.sendLog(itx.guild, Utils.embed({
      title: '🎟️ Ticket Closed',
      color: CONFIG.colors.error,
      fields: [
        { name: '👤 By', value: itx.user.tag, inline: true },
        { name: '📍 Channel', value: itx.channel.name, inline: true }
      ]
    }));

    for (const [uid, cid] of activeTickets) {
      if (cid === itx.channel.id) activeTickets.delete(uid);
    }

    setTimeout(() => itx.channel.delete().catch(() => {}), 3000);
  }
}

// ==================== SELECT MENU HANDLER ====================
async function handleSelectMenu(itx) {
  const [scope] = itx.customId.split(':');

  if (scope === 'rr') {
    const roleIds = itx.values;
    const added = [];
    const removed = [];

    const panel = reactionRolePanels.get(itx.message.id);
    if (!panel) return itx.reply({ ephemeral: true, content: '❌ Panel not found!' });

    for (const rid of panel.roles) {
      if (itx.member.roles.cache.has(rid) && !roleIds.includes(rid)) {
        await itx.member.roles.remove(rid);
        const role = itx.guild.roles.cache.get(rid);
        if (role) removed.push(role.name);
      }
    }

    for (const rid of roleIds) {
      if (!itx.member.roles.cache.has(rid)) {
        await itx.member.roles.add(rid);
        const role = itx.guild.roles.cache.get(rid);
        if (role) added.push(role.name);
      }
    }

    let response = '';
    if (added.length > 0) response += `✅ Added: ${added.join(', ')}\n`;
    if (removed.length > 0) response += `➖ Removed: ${removed.join(', ')}`;
    if (!response) response = '✅ Roles updated!';

    return itx.reply({ ephemeral: true, content: response });
  }
}

// ==================== COMMAND HANDLER ====================
async function handleCommand(itx) {
  try {
    const { commandName } = itx;

    switch (commandName) {
      case 'help': return await cmdHelp(itx);
      case 'level': return await cmdLevel(itx);
      case 'leaderboard': return await cmdLeaderboard(itx);
      case 'config': return await cmdConfig(itx);
      case 'automod': return await cmdAutoMod(itx);
      case 'warn': return await cmdWarn(itx);
      case 'strikes': return await cmdStrikes(itx);
      case 'pardon': return await cmdPardon(itx);
      case 'afk': return await cmdAFK(itx);
      case 'poll': return await cmdPoll(itx);
      case 'roles': return await cmdRoles(itx);
      case 'say': return await cmdSay(itx);
      case 'announce': return await cmdAnnounce(itx);
      case 'ticket': return await cmdTicket(itx);
      case 'verify': return await cmdVerify(itx);
      case 'stats': return await cmdStats(itx);
      default: return await itx.reply({ ephemeral: true, content: '❌ Unknown command!' });
    }
  } catch (e) {
    console.error('Command error:', e);
    const msg = { ephemeral: true, content: '❌ An error occurred!' };
    if (itx.deferred || itx.replied) await itx.followUp(msg);
    else await itx.reply(msg);
  }
}

// ==================== COMMANDS ====================

async function cmdHelp(itx) {
  const embed = Utils.embed({
    title: `🔥 Xaver ${CONFIG.version}`,
    description: 'Phase 1 + Phase 2 LITE Features!',
    fields: [
      { name: '📊 Leveling', value: '`/level` `/leaderboard`', inline: true },
      { name: '⚙️ Config', value: '`/config show` `/config set`', inline: true },
      { name: '🛡️ AutoMod (NEW!)', value: '`/automod toggle` `/automod badwords` `/automod whitelist`', inline: true },
      { name: '🛡️ Moderation', value: '`/warn` `/strikes` `/pardon`', inline: true },
      { name: '💤 AFK', value: '`/afk [reason]`', inline: true },
      { name: '📊 Polls', value: '`/poll`', inline: true },
      { name: '🎭 Reaction Roles', value: '`/roles panel` `/roles add`', inline: true },
      { name: '⭐ Starboard', value: 'React with ⭐', inline: true },
      { name: '📣 Announcements', value: '`/say` `/announce`', inline: true },
      { name: '🎟️ Tickets', value: '`/ticket create` `/ticket close`', inline: true },
      { name: '✅ Verification', value: '`/verify`', inline: true },
      { name: '📈 Stats', value: '`/stats`', inline: true }
    ]
  });
  await itx.reply({ ephemeral: true, embeds: [embed] });
}

async function cmdLevel(itx) {
  const user = itx.options.getUser('user') || itx.user;
  const key = Utils.userKey(itx.guild.id, user.id);
  const s = userStats.get(key) || { xp: 0, level: 0, messages: 0 };
  const next = Utils.xpForLevel(s.level);
  const progress = Math.round((s.xp / next) * 100);

  await itx.reply({
    embeds: [Utils.embed({
      title: '📊 Level Stats',
      thumbnail: user.displayAvatarURL(),
      fields: [
        { name: '👤 User', value: user.username, inline: true },
        { name: '⭐ Level', value: `${s.level}`, inline: true },
        { name: '💬 Messages', value: `${s.messages}`, inline: true },
        { name: '✨ XP', value: `${s.xp}/${next}`, inline: true },
        { name: '📈 Progress', value: `${progress}%`, inline: true }
      ]
    })]
  });
}

async function cmdLeaderboard(itx) {
  const guild = itx.guild.id;
  const allStats = Array.from(userStats.entries())
    .filter(([key]) => key.startsWith(`${guild}:`))
    .map(([key, stats]) => ({ ...stats, key }))
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, 10);

  if (allStats.length === 0) {
    return itx.reply({ ephemeral: true, content: '❌ No data yet!' });
  }

  const fields = allStats.map((s, i) => ({
    name: `${i + 1}. ${s.username || 'Unknown'}`,
    value: `Level ${s.level} • ${s.xp} XP • ${s.messages} msgs`,
    inline: false
  }));

  await itx.reply({
    embeds: [Utils.embed({
      title: '🏆 Server Leaderboard',
      description: 'Top 10 members by level and XP',
      fields
    })]
  });
}

async function cmdConfig(itx) {
  const sub = itx.options.getSubcommand();
  const cfg = Utils.getConfig(itx.guild.id);

  if (sub === 'show') {
    const fields = [
      { name: '📝 Log Channel', value: cfg.logChannel ? `<#${cfg.logChannel}>` : 'Not set', inline: true },
      { name: '👋 Welcome Channel', value: cfg.welcomeChannel ? `<#${cfg.welcomeChannel}>` : 'Not set', inline: true },
      { name: '⭐ Starboard Channel', value: cfg.starboardChannel ? `<#${cfg.starboardChannel}>` : 'Not set', inline: true },
      { name: '✅ Verify Role', value: cfg.verifyRole ? `<@&${cfg.verifyRole}>` : 'Not set', inline: true },
      { name: '🎟️ Support Role', value: cfg.supportRole ? `<@&${cfg.supportRole}>` : 'Not set', inline: true },
      { name: '📁 Ticket Category', value: cfg.ticketCategory ? `<#${cfg.ticketCategory}>` : 'Not set', inline: true },
      { name: '⭐ Starboard Emoji', value: cfg.starboardEmoji || '⭐', inline: true },
      { name: '🔢 Starboard Threshold', value: `${cfg.starboardThreshold}`, inline: true }
    ];

    return itx.reply({
      ephemeral: true,
      embeds: [Utils.embed({
        title: '⚙️ Server Configuration',
        fields
      })]
    });
  }

  if (sub === 'set') {
    const key = itx.options.getString('key', true);
    const value = itx.options.getString('value', true);

    if (key === 'starboardEmoji') {
      cfg[key] = value;
    } else if (key === 'starboardThreshold') {
      const num = parseInt(value);
      if (isNaN(num) || num < 1) {
        return itx.reply({ ephemeral: true, content: '❌ Invalid number!' });
      }
      cfg[key] = num;
    } else {
      const match = value.match(/\d+/);
      if (!match) {
        return itx.reply({ ephemeral: true, content: '❌ Invalid value! Please mention/ID the channel or role.' });
      }
      cfg[key] = match[0];
    }

    guildConfigs.set(itx.guild.id, cfg);
    await itx.reply({ ephemeral: true, content: `✅ Updated \`${key}\` to \`${value}\`` });

    Utils.sendLog(itx.guild, Utils.embed({
      title: '⚙️ Config Updated',
      color: CONFIG.colors.info,
      fields: [
        { name: '👤 By', value: itx.user.tag, inline: true },
        { name: '🔑 Key', value: key, inline: true },
        { name: '📝 Value', value: value, inline: true }
      ]
    }));
  }
}

async function cmdAutoMod(itx) {
  const sub = itx.options.getSubcommand();
  const cfg = Utils.getConfig(itx.guild.id);

  if (sub === 'toggle') {
    const feature = itx.options.getString('feature', true);
    const enabled = itx.options.getBoolean('enabled', true);
    
    cfg[feature] = enabled;
    guildConfigs.set(itx.guild.id, cfg);

    const featureNames = {
      autoModEnabled: 'AutoMod System',
      antiSpam: 'Anti-Spam',
      antiLinks: 'Anti-Links'
    };

    await itx.reply({ 
      ephemeral: true, 
      content: `✅ ${featureNames[feature]} ${enabled ? 'enabled' : 'disabled'}!` 
    });

    Utils.sendLog(itx.guild, Utils.embed({
      title: '🛡️ AutoMod Toggle',
      color: enabled ? CONFIG.colors.success : CONFIG.colors.warning,
      fields: [
        { name: '👤 By', value: itx.user.tag, inline: true },
        { name: '🔧 Feature', value: featureNames[feature], inline: true },
        { name: '📊 Status', value: enabled ? 'Enabled' : 'Disabled', inline: true }
      ]
    }));
  }

  if (sub === 'badwords') {
    const action = itx.options.getString('action', true);
    
    if (action === 'list') {
      const words = cfg.badWords || [];
      if (words.length === 0) {
        return itx.reply({ ephemeral: true, content: '📝 No bad words configured.' });
      }
      return itx.reply({ 
        ephemeral: true, 
        content: `📝 **Bad Words** (${words.length}):\n${words.map(w => `• \`${w}\``).join('\n')}` 
      });
    }

    const word = itx.options.getString('word');
    if (!word) {
      return itx.reply({ ephemeral: true, content: '❌ Please provide a word!' });
    }

    const normalized = word.toLowerCase().trim();
    cfg.badWords = cfg.badWords || [];

    if (action === 'add') {
      if (cfg.badWords.includes(normalized)) {
        return itx.reply({ ephemeral: true, content: '❌ Word already in list!' });
      }
      cfg.badWords.push(normalized);
      guildConfigs.set(itx.guild.id, cfg);
      await itx.reply({ ephemeral: true, content: `✅ Added \`${normalized}\` to bad words filter!` });
    }

    if (action === 'remove') {
      const before = cfg.badWords.length;
      cfg.badWords = cfg.badWords.filter(w => w !== normalized);
      if (cfg.badWords.length === before) {
        return itx.reply({ ephemeral: true, content: '❌ Word not found in list!' });
      }
      guildConfigs.set(itx.guild.id, cfg);
      await itx.reply({ ephemeral: true, content: `✅ Removed \`${normalized}\` from bad words filter!` });
    }
  }

  if (sub === 'whitelist') {
    const action = itx.options.getString('action', true);
    
    if (action === 'list') {
      const domains = cfg.whitelistedLinks || [];
      if (domains.length === 0) {
        return itx.reply({ ephemeral: true, content: '📝 No whitelisted domains configured.' });
      }
      return itx.reply({ 
        ephemeral: true, 
        content: `📝 **Whitelisted Domains** (${domains.length}):\n${domains.map(d => `• \`${d}\``).join('\n')}` 
      });
    }

    const domain = itx.options.getString('domain');
    if (!domain) {
      return itx.reply({ ephemeral: true, content: '❌ Please provide a domain!' });
    }

    const normalized = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
    cfg.whitelistedLinks = cfg.whitelistedLinks || [];

    if (action === 'add') {
      if (cfg.whitelistedLinks.includes(normalized)) {
        return itx.reply({ ephemeral: true, content: '❌ Domain already whitelisted!' });
      }
      cfg.whitelistedLinks.push(normalized);
      guildConfigs.set(itx.guild.id, cfg);
      await itx.reply({ ephemeral: true, content: `✅ Added \`${normalized}\` to whitelist!` });
    }

    if (action === 'remove') {
      const before = cfg.whitelistedLinks.length;
      cfg.whitelistedLinks = cfg.whitelistedLinks.filter(d => d !== normalized);
      if (cfg.whitelistedLinks.length === before) {
        return itx.reply({ ephemeral: true, content: '❌ Domain not found in whitelist!' });
      }
      guildConfigs.set(itx.guild.id, cfg);
      await itx.reply({ ephemeral: true, content: `✅ Removed \`${normalized}\` from whitelist!` });
    }
  }
}

async function cmdWarn(itx) {
  if (!Utils.isMod(itx.member)) {
    return itx.reply({ ephemeral: true, content: '❌ Moderator only!' });
  }

  const user = itx.options.getUser('user', true);
  const reason = itx.options.getString('reason', true);
  const member = await itx.guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    return itx.reply({ ephemeral: true, content: '❌ User not in server!' });
  }

  const { warn, total } = WarnSystem.add(itx.guild.id, user.id, reason, itx.user.id, itx.user.tag);

  await itx.reply({
    embeds: [Utils.embed({
      title: '⚠️ User Warned',
      color: CONFIG.colors.warning,
      fields: [
        { name: '👤 User', value: `${user.tag}`, inline: true },
        { name: '🔨 By', value: itx.user.tag, inline: true },
        { name: '📊 Total Strikes', value: `${total}`, inline: true },
        { name: '📝 Reason', value: reason, inline: false }
      ]
    })]
  });

  Utils.sendLog(itx.guild, Utils.embed({
    title: '⚠️ Warning Issued',
    color: CONFIG.colors.warning,
    fields: [
      { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
      { name: '🔨 Moderator', value: itx.user.tag, inline: true },
      { name: '📊 Strikes', value: `${total}`, inline: true },
      { name: '📝 Reason', value: reason, inline: false }
    ]
  }));

  try {
    await member.send({
      embeds: [Utils.embed({
        title: '⚠️ Warning',
        description: `You have been warned in **${itx.guild.name}**`,
        color: CONFIG.colors.warning,
        fields: [
          { name: '📝 Reason', value: reason, inline: false },
          { name: '📊 Total Strikes', value: `${total}`, inline: false }
        ]
      })]
    });
  } catch (e) {
    // User has DMs disabled
  }
}

async function cmdStrikes(itx) {
  const user = itx.options.getUser('user') || itx.user;
  const strikes = WarnSystem.get(itx.guild.id, user.id);

  if (strikes.length === 0) {
    return itx.reply({ 
      ephemeral: true, 
      content: `✅ ${user.tag} has no strikes!` 
    });
  }

  const fields = strikes.map((w, i) => ({
    name: `Strike #${i + 1} - ${new Date(w.date).toLocaleDateString()}`,
    value: `📝 ${w.reason}\n🔨 By: ${w.moderator}`,
    inline: false
  }));

  await itx.reply({
    ephemeral: true,
    embeds: [Utils.embed({
      title: `⚠️ Strikes for ${user.tag}`,
      description: `Total: ${strikes.length}`,
      color: CONFIG.colors.warning,
      fields
    })]
  });
}

async function cmdPardon(itx) {
  if (!Utils.isMod(itx.member)) {
    return itx.reply({ ephemeral: true, content: '❌ Moderator only!' });
  }

  const user = itx.options.getUser('user', true);
  const count = WarnSystem.clear(itx.guild.id, user.id);

  if (count === 0) {
    return itx.reply({ ephemeral: true, content: `${user.tag} has no strikes!` });
  }

  await itx.reply({
    embeds: [Utils.embed({
      title: '✅ Strikes Cleared',
      color: CONFIG.colors.success,
      fields: [
        { name: '👤 User', value: user.tag, inline: true },
        { name: '🔨 By', value: itx.user.tag, inline: true },
        { name: '📊 Cleared', value: `${count}`, inline: true }
      ]
    })]
  });

  Utils.sendLog(itx.guild, Utils.embed({
    title: '✅ Strikes Pardoned',
    color: CONFIG.colors.success,
    fields: [
      { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
      { name: '🔨 By', value: itx.user.tag, inline: true },
      { name: '📊 Strikes Cleared', value: `${count}`, inline: true }
    ]
  }));
}

async function cmdAFK(itx) {
  const reason = itx.options.getString('reason') || 'AFK';
  const key = Utils.userKey(itx.guild.id, itx.user.id);
  
  afkUsers.set(key, { reason, since: Date.now() });
  
  await itx.reply({ 
    ephemeral: true, 
    content: `💤 You are now AFK: ${reason}` 
  });
}

async function cmdPoll(itx) {
  const question = itx.options.getString('question', true);
  const options = [
    itx.options.getString('option1', true),
    itx.options.getString('option2', true),
    itx.options.getString('option3'),
    itx.options.getString('option4')
  ].filter(Boolean);

  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
  const fields = options.map((opt, i) => ({
    name: `${emojis[i]} Option ${i + 1}`,
    value: opt,
    inline: false
  }));

  const msg = await itx.channel.send({
    embeds: [Utils.embed({
      title: '📊 Poll',
      description: question,
      fields,
      footer: { text: `Asked by ${itx.user.tag}` }
    })]
  });

  for (let i = 0; i < options.length; i++) {
    await msg.react(emojis[i]);
  }

  activePolls.set(msg.id, {
    question,
    options,
    author: itx.user.id,
    channel: itx.channel.id
  });

  await itx.reply({ ephemeral: true, content: '✅ Poll created!' });
}

async function cmdRoles(itx) {
  const sub = itx.options.getSubcommand();

  if (sub === 'panel') {
    if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
      return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
    }

    const title = itx.options.getString('title', true);
    const description = itx.options.getString('description') || 'Select your roles below!';

    const panelId = `panel-${Date.now()}`;
    const panel = {
      id: panelId,
      title,
      description,
      roles: [],
      messageId: null,
      channelId: itx.channel.id,
      guildId: itx.guild.id
    };

    reactionRolePanels.set(panelId, panel);

    await itx.reply({ 
      ephemeral: true, 
      content: `✅ Panel created! Use \`/roles add\` to add roles to this panel.\nPanel ID: \`${panelId}\`` 
    });
  }

  if (sub === 'add') {
    if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
      return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
    }

    const role = itx.options.getRole('role', true);
    const emoji = itx.options.getString('emoji') || '✅';
    const label = itx.options.getString('label') || role.name;

    const lastPanel = Array.from(reactionRolePanels.values())
      .filter(p => p.guildId === itx.guild.id)
      .sort((a, b) => {
        const aNum = parseInt(a.id.split('-')[1]);
        const bNum = parseInt(b.id.split('-')[1]);
        return bNum - aNum;
      })[0];

    if (!lastPanel) {
      return itx.reply({ ephemeral: true, content: '❌ No panel found! Create one first with `/roles panel`' });
    }

    if (!lastPanel.roles) lastPanel.roles = [];
    if (!lastPanel.emojis) lastPanel.emojis = {};
    if (!lastPanel.labels) lastPanel.labels = {};

    if (lastPanel.roles.includes(role.id)) {
      return itx.reply({ ephemeral: true, content: '❌ Role already in panel!' });
    }

    lastPanel.roles.push(role.id);
    lastPanel.emojis[role.id] = emoji;
    lastPanel.labels[role.id] = label;

    reactionRolePanels.set(lastPanel.id, lastPanel);

    await itx.reply({ 
      ephemeral: true, 
      content: `✅ Added ${role} to panel with ${emoji} ${label}` 
    });
  }
}

async function cmdSay(itx) {
  if (!Utils.isMod(itx.member)) {
    return itx.reply({ ephemeral: true, content: '❌ Moderator only!' });
  }

  const message = itx.options.getString('message', true);
  const ch = itx.options.getChannel('channel') || itx.channel;

  if (!ch.isTextBased()) {
    return itx.reply({ ephemeral: true, content: '❌ Invalid channel!' });
  }

  await ch.send(message);
  await itx.reply({ ephemeral: true, content: `✅ Message sent to ${ch}!` });
}

async function cmdAnnounce(itx) {
  if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
    return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
  }

  const title = itx.options.getString('title', true);
  const message = itx.options.getString('message', true);
  const ch = itx.options.getChannel('channel') || itx.channel;

  if (!ch.isTextBased()) {
    return itx.reply({ ephemeral: true, content: '❌ Invalid channel!' });
  }

  await ch.send({
    embeds: [Utils.embed({
      title: `📣 ${title}`,
      description: message,
      color: CONFIG.colors.info,
      footer: { text: `Announced by ${itx.user.tag}` }
    })]
  });

  await itx.reply({ ephemeral: true, content: `✅ Announcement sent to ${ch}!` });
}

async function cmdTicket(itx) {
  const sub = itx.options.getSubcommand();
  const cfg = Utils.getConfig(itx.guild.id);

  if (sub === 'create') {
    if (activeTickets.has(itx.user.id)) {
      return itx.reply({ ephemeral: true, content: '❌ You already have an open ticket!' });
    }

    const cat = itx.guild.channels.cache.get(cfg.ticketCategory);
    if (!cat) {
      return itx.reply({ ephemeral: true, content: '❌ Ticket category not configured!' });
    }

    const ch = await cat.children.create({
      name: `ticket-${itx.user.username}`,
      permissionOverwrites: [
        { id: itx.guild.id, deny: ['ViewChannel'] },
        { id: itx.user.id, allow: ['ViewChannel', 'SendMessages'] }
      ]
    });

    activeTickets.set(itx.user.id, ch.id);
    await itx.reply({ ephemeral: true, content: `✅ Ticket created: ${ch}` });

    Utils.sendLog(itx.guild, Utils.embed({
      title: '🎟️ Ticket Opened',
      color: CONFIG.colors.success,
      fields: [
        { name: '👤 User', value: itx.user.tag, inline: true },
        { name: '📍 Channel', value: `${ch}`, inline: true }
      ]
    }));
  }

  if (sub === 'close') {
      const isTicket = 
        itx.channel.parentId === cfg.ticketCategory ||
        itx.channel.parent?.name.toLowerCase().includes('ticket') ||
        itx.channel.name.startsWith('ticket-');

      if (!isTicket) {
        return itx.reply({ ephemeral: true, content: '❌ Not a ticket channel!' });
      }

      const canClose = 
        Utils.isMod(itx.member) ||
        (cfg.supportRole && itx.member.roles.cache.has(cfg.supportRole));

      if (!canClose) {
        return itx.reply({ ephemeral: true, content: '❌ No permission!' });
      }

      await itx.reply({
        embeds: [Utils.embed({
          title: '🗑️ Closing Ticket',
          description: 'Channel will be deleted in 5 seconds...',
          color: CONFIG.colors.warning
        })]
      });

      for (const [uid, cid] of activeTickets) {
        if (cid === itx.channel.id) activeTickets.delete(uid);
      }

      Utils.sendLog(itx.guild, Utils.embed({
        title: '🎟️ Ticket Closed',
        color: CONFIG.colors.error,
        fields: [
          { name: '👤 By', value: itx.user.tag, inline: true },
          { name: '📍 Channel', value: itx.channel.name, inline: true }
        ]
      }));

      setTimeout(() => itx.channel.delete().catch(() => {}), 5000);
      }
      }

      async function cmdVerify(itx) {
      if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
      return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
      }

      const role = itx.options.getRole('role', true);
      const ch = itx.options.getChannel('channel') || itx.channel;

      if (!ch.isTextBased()) {
      return itx.reply({ ephemeral: true, content: '❌ Invalid channel!' });
      }

      const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verify:click:${role.id}`)
        .setLabel('Verify')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
      );

      await ch.send({
      embeds: [Utils.embed({
        title: '✅ Server Verification',
        description: `Welcome to **${itx.guild.name}**!\n\nClick the button below to verify.\n\nYou will receive: ${role}`,
        thumbnail: itx.guild.iconURL({ size: 256 }),
        fields: [
          { name: '📋 Instructions', value: '1. Read the rules\n2. Click Verify\n3. Enjoy!', inline: false }
        ]
      })],
      components: [btn]
      });

      await itx.reply({ ephemeral: true, content: `✅ Verification setup in ${ch}!` });

      Utils.sendLog(itx.guild, Utils.embed({
      title: '✅ Verification System Setup',
      color: CONFIG.colors.success,
      fields: [
        { name: '👤 By', value: itx.user.tag, inline: true },
        { name: '📍 Channel', value: `${ch}`, inline: true },
        { name: '🎭 Role', value: `${role}`, inline: true }
      ]
      }));
      }

      async function cmdStats(itx) {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = Math.floor(uptime % 60);

      const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
      const totalMembers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);

      await itx.reply({
      embeds: [Utils.embed({
        title: `📊 Xaver ${CONFIG.version} Stats`,
        thumbnail: client.user.displayAvatarURL(),
        fields: [
          { name: '🏰 Servers', value: `${client.guilds.cache.size}`, inline: true },
          { name: '👥 Members', value: `${totalMembers.toLocaleString()}`, inline: true },
          { name: '📺 Channels', value: `${client.channels.cache.size}`, inline: true },
          { name: '⏱️ Uptime', value: `${h}h ${m}m ${s}s`, inline: true },
          { name: '💾 Memory', value: `${mem} MB`, inline: true },
          { name: '🔢 Commands', value: `${commands.length}`, inline: true },
          { name: '📈 Users Tracked', value: `${userStats.size}`, inline: true },
          { name: '🎟️ Active Tickets', value: `${activeTickets.size}`, inline: true },
          { name: '⭐ Starboard Msgs', value: `${starboardCache.size}`, inline: true },
          { name: '📊 Active Polls', value: `${activePolls.size}`, inline: true },
          { name: '💤 AFK Users', value: `${afkUsers.size}`, inline: true },
          { name: '🎭 Reaction Panels', value: `${reactionRolePanels.size}`, inline: true }
        ]
      })]
      });
      }

      // ==================== ERROR HANDLING ====================
      process.on('unhandledRejection', (e) => console.error('❌ Unhandled:', e));
      process.on('uncaughtException', (e) => console.error('❌ Uncaught:', e));
      client.on('error', (e) => console.error('❌ Client:', e));
      client.on('warn', (w) => console.warn('⚠️ Warning:', w));

      // ==================== GRACEFUL SHUTDOWN ====================
      process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      await client.destroy();
      process.exit(0);
      });

      process.on('SIGTERM', async () => {
      console.log('\n🛑 Shutting down...');
      await client.destroy();
      process.exit(0);
      });

      // ==================== LOGIN ====================
      client.login(CONFIG.token).catch((e) => {
      console.error('❌ Login failed:', e);
      process.exit(1);
      });