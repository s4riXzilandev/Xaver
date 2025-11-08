// =========================
// Xaver v5.0 — MEGA Edition 🔥
// Phase 1: Config, Warns, AFK, Starboard, Polls, Reaction Roles
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
    bot: 'Xaver v5.0',
    uptime: process.uptime(),
    message: '🔥 Xaver MEGA Edition is running!'
  });
});

app.get('/health', (req, res) => {
  if (CONFIG.healthKey && req.query.key !== CONFIG.healthKey) {
    return res.status(403).json({ error: 'Invalid key' });
  }
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
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
const guildConfigs = new Map(); // guildId -> config object
const userStats = new Map();     // `${guildId}:${userId}` -> {xp, level, messages}
const cooldowns = new Map();     // cooldowns
const activeTickets = new Map(); // userId -> channelId
const warns = new Map();         // `${guildId}:${userId}` -> [{id, reason, moderator, date}]
const afkUsers = new Map();      // userId -> {reason, since}
const starboardCache = new Map();// messageId -> starboardMessageId
const activePolls = new Map();   // messageId -> poll data
const reactionRolePanels = new Map(); // messageId -> panel data

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
      e.setFooter({ text: 'Xaver v5.0 MEGA', iconURL: client.user.displayAvatarURL() });
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
        autoStrikeBan: 5
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

// ==================== SLASH COMMANDS ====================
const commands = [
  { 
    name: 'help', 
    description: 'Show all commands' 
  },
  { 
    name: 'level', 
    description: 'View level stats', 
    options: [{ 
      name: 'user', 
      description: 'User to check',
      type: 6, 
      required: false 
    }] 
  },
  { 
    name: 'leaderboard', 
    description: 'Top members' 
  },

  // Config
  {
    name: 'config',
    description: 'Configure server settings',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        type: 1, 
        name: 'show', 
        description: 'Show current configuration'
      },
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
              { name: 'starboard_threshold', value: 'starboardThreshold' },
              { name: 'auto_strike_kick', value: 'autoStrikeKick' },
              { name: 'auto_strike_ban', value: 'autoStrikeBan' }
            ]
          },
          { 
            name: 'value', 
            description: 'New value for the setting', 
            type: 3, 
            required: true 
          }
        ]
      }
    ]
  },

  // Moderation
  {
    name: 'warn',
    description: 'Warn a user',
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [
      { 
        name: 'user', 
        description: 'User to warn', 
        type: 6, 
        required: true 
      },
      { 
        name: 'reason', 
        description: 'Reason for the warning', 
        type: 3, 
        required: true 
      }
    ]
  },
  {
    name: 'strikes',
    description: 'View user warnings',
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [{ 
      name: 'user', 
      description: 'User to check warnings for', 
      type: 6, 
      required: true 
    }]
  },
  {
    name: 'pardon',
    description: 'Remove user warnings',
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [
      { 
        name: 'user', 
        description: 'User to pardon', 
        type: 6, 
        required: true 
      },
      { 
        name: 'warn_id', 
        description: 'Specific warning ID to remove', 
        type: 3, 
        required: false 
      }
    ]
  },

  // AFK
  {
    name: 'afk',
    description: 'Set your AFK status',
    options: [{ 
      name: 'reason', 
      description: 'Reason for being AFK', 
      type: 3, 
      required: false 
    }]
  },

  // Polls
  {
    name: 'poll',
    description: 'Create a poll',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { 
        name: 'question', 
        description: 'Poll question', 
        type: 3, 
        required: true 
      },
      { 
        name: 'options', 
        description: 'Options separated by semicolons (Yes;No;Maybe)', 
        type: 3, 
        required: true 
      },
      { 
        name: 'duration', 
        description: 'Duration in minutes', 
        type: 4, 
        required: false 
      }
    ]
  },

  // Reaction Roles
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
          { 
            name: 'title', 
            description: 'Panel title', 
            type: 3, 
            required: true 
          },
          { 
            name: 'description', 
            description: 'Panel description', 
            type: 3, 
            required: false 
          },
          { 
            name: 'type', 
            description: 'Panel type', 
            type: 3,
            choices: [
              { name: 'Buttons', value: 'buttons' },
              { name: 'Dropdown', value: 'dropdown' }
            ]
          }
        ]
      }
    ]
  },

  // Say
  {
    name: 'say',
    description: 'Send a message as the bot',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { 
        name: 'text', 
        description: 'Message to send', 
        type: 3, 
        required: true 
      },
      { 
        name: 'channel', 
        description: 'Channel to send message in', 
        type: 7, 
        required: false 
      }
    ]
  },

  // Announce
  {
    name: 'announce',
    description: 'Create an announcement',
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
        description: 'Announcement message', 
        type: 3, 
        required: true 
      },
      { 
        name: 'channel', 
        description: 'Channel to send announcement', 
        type: 7, 
        required: false 
      },
      { 
        name: 'ping', 
        description: 'Who to ping', 
        type: 3, 
        required: false, 
        choices: [
          { name: 'None', value: 'none' },
          { name: '@everyone', value: 'everyone' },
          { name: '@here', value: 'here' },
          { name: 'Role', value: 'role' }
        ]
      },
      { 
        name: 'role', 
        description: 'Role to ping if ping type is role', 
        type: 8, 
        required: false 
      }
    ]
  },

  // Ticket
  {
    name: 'ticket',
    description: 'Ticket system',
    options: [
      { 
        type: 1, 
        name: 'create', 
        description: 'Create a new support ticket' 
      },
      { 
        type: 1, 
        name: 'close', 
        description: 'Close the current ticket' 
      }
    ]
  },

  // Verify
  {
    name: 'verify',
    description: 'Setup verification system',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      { 
        name: 'role', 
        description: 'Role to give after verification', 
        type: 8, 
        required: true 
      },
      { 
        name: 'channel', 
        description: 'Channel to send verification message', 
        type: 7, 
        required: false 
      }
    ]
  },

  // Stats
  { 
    name: 'stats', 
    description: 'View bot statistics' 
  }
];

// ==================== READY ====================
client.once('ready', async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔥 Xaver v5.0 MEGA Edition | ${client.user.tag}`);
  console.log(`🏰 Servers: ${client.guilds.cache.size}`);
  console.log(`${'='.repeat(60)}\n`);

  client.user.setPresence({
    activities: [{ name: 'Phase 1 MEGA Update! | /help' }],
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

  // AFK Check
  if (afkUsers.has(msg.author.id)) {
    afkUsers.delete(msg.author.id);
    msg.reply({ content: '👋 Welcome back! Your AFK status has been removed.' }).catch(() => {});
  }

  // Check mentions for AFK
  msg.mentions.users.forEach(user => {
    if (afkUsers.has(user.id)) {
      const afk = afkUsers.get(user.id);
      msg.reply({ 
        content: `💤 **${user.username}** is AFK: ${afk.reason}\n*Since <t:${Utils.timestamp(afk.since)}:R>*` 
      }).catch(() => {});
    }
  });

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

  // Fetch partial
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

  // Check emoji
  if (reaction.emoji.name !== cfg.starboardEmoji) return;

  // Check threshold
  if (reaction.count < cfg.starboardThreshold) return;

  // Don't star own message
  if (msg.author.id === user.id) return;

  // Already on starboard?
  if (starboardCache.has(msg.id)) return;

  const starCh = msg.guild.channels.cache.get(cfg.starboardChannel);
  if (!starCh?.isTextBased()) return;

  const embed = Utils.embed({
    color: CONFIG.colors.warning,
    author: { name: msg.author.tag, iconURL: msg.author.displayAvatarURL() },
    description: Utils.clip(msg.content || '*No text content*', 500),
    fields: [
      { name: '📍 Channel', value: `<#${msg.channel.id}>`, inline: true },
      { name: '🔗 Jump', value: `[Go to message](${msg.url})`, inline: true },
      { name: '⭐ Stars', value: `${reaction.count}`, inline: true }
    ],
    timestamp: msg.createdAt,
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
          fields: [
            { name: '📅 Account Age', value: `${accountAge} days old`, inline: true }
          ],
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

  // Verify button
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

  // Poll vote
  if (scope === 'poll' && action === 'vote') {
    const msgId = args[0];
    const optionIndex = parseInt(args[1]);
    const poll = activePolls.get(msgId);
    if (!poll) return itx.reply({ ephemeral: true, content: '❌ Poll not found!' });

    // Check if already voted
    const hasVoted = poll.votes.some(v => v.userId === itx.user.id);
    if (hasVoted) {
      // Remove old vote
      poll.votes = poll.votes.filter(v => v.userId !== itx.user.id);
    }

    // Add new vote
    poll.votes.push({ userId: itx.user.id, option: optionIndex });
    activePolls.set(msgId, poll);

    // Update embed
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

  // Reaction role button
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

  // Announce buttons
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

  // Ticket close
  if (scope === 'ticket' && action === 'close') {
    const cfg = Utils.getConfig(itx.guild.id);
    const canClose = 
      Utils.isMod(itx.member) ||
      (cfg.supportRole && itx.member.roles.cache.has(cfg.supportRole)) ||
      args[0] === itx.user.id;

    if (!canClose) return itx.reply({ ephemeral: true, content: '❌ Cannot close this ticket!' });

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

    // Get all roles from this panel
    const panel = reactionRolePanels.get(itx.message.id);
    if (!panel) return itx.reply({ ephemeral: true, content: '❌ Panel not found!' });

    // Remove all panel roles first
    for (const rid of panel.roles) {
      if (itx.member.roles.cache.has(rid) && !roleIds.includes(rid)) {
        await itx.member.roles.remove(rid);
        const role = itx.guild.roles.cache.get(rid);
        if (role) removed.push(role.name);
      }
    }

    // Add selected roles
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
    title: '🔥 Xaver v5.0 MEGA Edition',
    description: 'Phase 1 Features are here!',
    fields: [
      {
        name: '📊 Leveling',
        value: '`/level` `/leaderboard`',
        inline: true
      },
      {
        name: '⚙️ Config (Admin)',
        value: '`/config show` `/config set`',
        inline: true
      },
      {
        name: '🛡️ Moderation (Mod)',
        value: '`/warn` `/strikes` `/pardon`',
        inline: true
      },
      {
        name: '💤 AFK',
        value: '`/afk [reason]`',
        inline: true
      },
      {
        name: '📊 Polls (Admin)',
        value: '`/poll`',
        inline: true
      },
      {
        name: '🎭 Reaction Roles (Admin)',
        value: '`/roles panel`',
        inline: true
      },
      {
        name: '⭐ Starboard',
        value: 'React with ⭐ (auto)',
        inline: true
      },
      {
        name: '📣 Announcements (Admin)',
        value: '`/say` `/announce`',
        inline: true
      },
      {
        name: '🎟️ Tickets',
        value: '`/ticket create` `/ticket close`',
        inline: true
      },
      {
        name: '✅ Verification (Admin)',
        value: '`/verify`',
        inline: true
      },
      {
        name: '📈 Bot Stats',
        value: '`/stats`',
        inline: true
      }
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
  const list = [];
  for (const [key, data] of userStats) {
    const [gid, uid] = key.split(':');
    if (gid !== itx.guild.id) continue;
    list.push({ uid, ...data });
  }
  list.sort((a, b) => (b.level - a.level) || (b.xp - a.xp));
  const top = list.slice(0, 10);

  if (top.length === 0) {
    return itx.reply({
      embeds: [Utils.embed({
        title: '🏆 Leaderboard',
        description: 'No activity yet!',
        color: CONFIG.colors.warning
      })]
    });
  }

  const desc = top.map((e, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**#${i + 1}**`;
    return `${medal} <@${e.uid}> — Lvl ${e.level} (${e.xp} XP)`;
  }).join('\n');

  await itx.reply({
    embeds: [Utils.embed({ title: '🏆 Leaderboard', description: desc })]
  });
}

async function cmdConfig(itx) {
  if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
    return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
  }

  const sub = itx.options.getSubcommand();
  const cfg = Utils.getConfig(itx.guild.id);

  if (sub === 'show') {
    const fields = [
      { name: '📝 Log Channel', value: cfg.logChannel ? `<#${cfg.logChannel}>` : '*Not set*', inline: true },
      { name: '👋 Welcome Channel', value: cfg.welcomeChannel ? `<#${cfg.welcomeChannel}>` : '*Not set*', inline: true },
      { name: '⭐ Starboard Channel', value: cfg.starboardChannel ? `<#${cfg.starboardChannel}>` : '*Not set*', inline: true },
      { name: '✅ Verify Role', value: cfg.verifyRole ? `<@&${cfg.verifyRole}>` : '*Not set*', inline: true },
      { name: '🛡️ Support Role', value: cfg.supportRole ? `<@&${cfg.supportRole}>` : '*Not set*', inline: true },
      { name: '🎟️ Ticket Category', value: cfg.ticketCategory ? `<#${cfg.ticketCategory}>` : '*Not set*', inline: true },
      { name: '⭐ Starboard Emoji', value: cfg.starboardEmoji, inline: true },
      { name: '⭐ Threshold', value: `${cfg.starboardThreshold}`, inline: true },
      { name: '🔨 Auto Kick', value: `${cfg.autoStrikeKick} strikes`, inline: true },
      { name: '🔨 Auto Ban', value: `${cfg.autoStrikeBan} strikes`, inline: true }
    ];
    return itx.reply({
      ephemeral: true,
      embeds: [Utils.embed({ title: '⚙️ Server Config', fields })]
    });
  }

  if (sub === 'set') {
    const key = itx.options.getString('key', true);
    const val = itx.options.getString('value', true);

    // Parse value
    let parsed = val;
    if (val.match(/^<#(\d+)>$/)) parsed = val.match(/^<#(\d+)>$/)[1];
    else if (val.match(/^<@&(\d+)>$/)) parsed = val.match(/^<@&(\d+)>$/)[1];
    else if (val.match(/^\d+$/)) parsed = parseInt(val);

    cfg[key] = parsed;
    guildConfigs.set(itx.guild.id, cfg);

    return itx.reply({
      ephemeral: true,
      content: `✅ Set **${key}** to **${val}**`
    });
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

  if (member.id === itx.user.id) {
    return itx.reply({ ephemeral: true, content: '❌ Cannot warn yourself!' });
  }

  if (member.id === client.user.id) {
    return itx.reply({ ephemeral: true, content: '❌ Cannot warn me!' });
  }

  const result = WarnSystem.add(itx.guild.id, user.id, reason, itx.user.id, itx.user.tag);
  const cfg = Utils.getConfig(itx.guild.id);

  // DM user
  try {
    await user.send({
      embeds: [Utils.embed({
        title: '⚠️ You have been warned',
        color: CONFIG.colors.warning,
        fields: [
          { name: '🏰 Server', value: itx.guild.name, inline: true },
          { name: '👮 Moderator', value: itx.user.tag, inline: true },
          { name: '📋 Reason', value: reason, inline: false },
          { name: '📊 Total Warns', value: `${result.total}`, inline: true }
        ]
      })]
    });
  } catch {}

  await itx.reply({
    embeds: [Utils.embed({
      title: '⚠️ User Warned',
      color: CONFIG.colors.warning,
      fields: [
        { name: '👤 User', value: `${user.tag}`, inline: true },
        { name: '📊 Total Warns', value: `${result.total}`, inline: true },
        { name: '📋 Reason', value: reason, inline: false }
      ]
    })]
  });

  Utils.sendLog(itx.guild, Utils.embed({
    title: '⚠️ Warn Issued',
    color: CONFIG.colors.warning,
    fields: [
      { name: '👤 User', value: user.tag, inline: true },
      { name: '👮 Moderator', value: itx.user.tag, inline: true },
      { name: '📊 Total', value: `${result.total}`, inline: true },
      { name: '📋 Reason', value: reason, inline: false }
    ]
  }));

  // Auto punish
  if (cfg.autoStrikeKick && result.total >= cfg.autoStrikeKick && result.total < cfg.autoStrikeBan) {
    try {
      await member.kick(`Auto-kick: ${result.total} warnings`);
      itx.followUp({ content: `🔨 **${user.tag}** auto-kicked (${result.total} warns)` });
    } catch {}
  } else if (cfg.autoStrikeBan && result.total >= cfg.autoStrikeBan) {
    try {
      await member.ban({ reason: `Auto-ban: ${result.total} warnings` });
      itx.followUp({ content: `🔨 **${user.tag}** auto-banned (${result.total} warns)` });
    } catch {}
  }
}

async function cmdStrikes(itx) {
  if (!Utils.isMod(itx.member)) {
    return itx.reply({ ephemeral: true, content: '❌ Moderator only!' });
  }

  const user = itx.options.getUser('user', true);
  const list = WarnSystem.get(itx.guild.id, user.id);

  if (list.length === 0) {
    return itx.reply({
      ephemeral: true,
      content: `✅ **${user.tag}** has no warnings!`
    });
  }

  const fields = list.map((w, i) => ({
    name: `Warning #${i + 1} (ID: ${w.id})`,
    value: `**Reason:** ${w.reason}\n**By:** ${w.moderator}\n**Date:** <t:${Utils.timestamp(w.date)}:R>`,
    inline: false
  }));

  await itx.reply({
    ephemeral: true,
    embeds: [Utils.embed({
      title: `⚠️ Warnings for ${user.tag}`,
      description: `Total: **${list.length}**`,
      fields,
      color: CONFIG.colors.warning
    })]
  });
}

async function cmdPardon(itx) {
  if (!Utils.isMod(itx.member)) {
    return itx.reply({ ephemeral: true, content: '❌ Moderator only!' });
  }

  const user = itx.options.getUser('user', true);
  const warnId = itx.options.getString('warn_id');

  if (warnId) {
    const removed = WarnSystem.remove(itx.guild.id, user.id, warnId);
    if (!removed) {
      return itx.reply({ ephemeral: true, content: '❌ Warn ID not found!' });
    }
    await itx.reply({
      content: `✅ Removed warning **${warnId}** from **${user.tag}**`
    });
  } else {
    const count = WarnSystem.clear(itx.guild.id, user.id);
    if (count === 0) {
      return itx.reply({ ephemeral: true, content: '❌ User has no warnings!' });
    }
    await itx.reply({
      content: `✅ Cleared **${count}** warning(s) from **${user.tag}**`
    });
  }

  Utils.sendLog(itx.guild, Utils.embed({
    title: '✅ Warnings Pardoned',
    color: CONFIG.colors.success,
    fields: [
      { name: '👤 User', value: user.tag, inline: true },
      { name: '👮 By', value: itx.user.tag, inline: true },
      { name: '📋 Action', value: warnId ? `Removed ID: ${warnId}` : 'Cleared all', inline: true }
    ]
  }));
}

async function cmdAFK(itx) {
  const reason = itx.options.getString('reason') || 'AFK';
  afkUsers.set(itx.user.id, { reason, since: new Date() });
  await itx.reply({
    content: `💤 You are now AFK: **${reason}**`
  });
}

async function cmdPoll(itx) {
  if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
    return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
  }

  const question = itx.options.getString('question', true);
  const optionsStr = itx.options.getString('options', true);
  const duration = itx.options.getInteger('duration');

  const options = optionsStr.split(';').map(o => o.trim()).filter(o => o);
  if (options.length < 2) {
    return itx.reply({ ephemeral: true, content: '❌ Need at least 2 options!' });
  }
  if (options.length > 10) {
    return itx.reply({ ephemeral: true, content: '❌ Max 10 options!' });
  }

  const endsAt = duration ? new Date(Date.now() + duration * 60000) : null;

  const buttons = options.slice(0, 5).map((opt, i) => 
    new ButtonBuilder()
      .setCustomId(`poll:vote:${itx.id}:${i}`)
      .setLabel(`${i + 1}`)
      .setStyle(ButtonStyle.Primary)
  );

  const row = new ActionRowBuilder().addComponents(buttons);

  const fields = options.map((opt, i) => ({
    name: `${i + 1}. ${opt}`,
    value: `${'░'.repeat(20)} 0 votes (0%)`,
    inline: false
  }));

  const embed = Utils.embed({
    title: `📊 ${question}`,
    description: `Total votes: **0**${endsAt ? `\nEnds: <t:${Utils.timestamp(endsAt)}:R>` : ''}`,
    fields,
    color: CONFIG.colors.brand
  });

  const msg = await itx.reply({ embeds: [embed], components: [row], fetchReply: true });

  activePolls.set(msg.id, {
    question,
    options,
    votes: [],
    endsAt,
    createdBy: itx.user.id
  });

  if (endsAt) {
    setTimeout(() => {
      msg.edit({ components: [] }).catch(() => {});
      activePolls.delete(msg.id);
    }, duration * 60000);
  }
}

async function cmdRoles(itx) {
  if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
    return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
  }

  const sub = itx.options.getSubcommand();

  if (sub === 'panel') {
    const title = itx.options.getString('title', true);
    const description = itx.options.getString('description') || 'Select your roles below:';
    const type = itx.options.getString('type', true);

    await itx.reply({
      ephemeral: true,
      content: '✅ Panel created! Now use `/roles add` to add roles. (Just kidding, for now manually mention roles separated by space in next message)'
    });

    // For now, simple demo with manual role IDs
    // In real: you'd have a follow-up system
    const embed = Utils.embed({
      title: `🎭 ${title}`,
      description,
      color: CONFIG.colors.brand
    });

    const msg = await itx.channel.send({
      embeds: [embed],
      content: '⚠️ Use reaction or setup roles via buttons/dropdown (demo mode)'
    });

    reactionRolePanels.set(msg.id, {
      title,
      type,
      roles: [] // add roles here
    });
  }
}

async function cmdSay(itx) {
  if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
    return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
  }

  const text = itx.options.getString('text', true);
  const ch = itx.options.getChannel('channel') || itx.channel;

  if (!ch.isTextBased()) {
    return itx.reply({ ephemeral: true, content: '❌ Invalid channel!' });
  }

  await ch.send({
    embeds: [Utils.embed({
      title: '📣 Announcement',
      description: text,
      author: { name: itx.user.tag, iconURL: itx.user.displayAvatarURL() }
    })]
  });

  await itx.reply({ ephemeral: true, content: `✅ Sent to ${ch}` });
  Utils.sendLog(itx.guild, Utils.embed({
    title: '📣 /say used',
    fields: [
      { name: '👤 By', value: itx.user.tag, inline: true },
      { name: '📍 Channel', value: `${ch}`, inline: true }
    ]
  }));
}

async function cmdAnnounce(itx) {
  if (!Utils.hasPermission(itx.member, PermissionFlagsBits.ManageGuild)) {
    return itx.reply({ ephemeral: true, content: '❌ Admin only!' });
  }

  const title = itx.options.getString('title', true);
  const message = itx.options.getString('message', true);
  const ch = itx.options.getChannel('channel') || itx.channel;
  const ping = itx.options.getString('ping') || 'none';
  const role = itx.options.getRole('role');

  let pingContent = '';
  if (ping === 'everyone') pingContent = '@everyone';
  else if (ping === 'here') pingContent = '@here';
  else if (ping === 'role' && role) pingContent = `<@&${role.id}>`;

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

  await ch.send({
    content: pingContent || undefined,
    embeds: [Utils.embed({
      title: `📣 ${title}`,
      description: message,
      author: { name: itx.user.tag, iconURL: itx.user.displayAvatarURL() }
    })],
    components: [buttons]
  });

  await itx.reply({ ephemeral: true, content: `✅ Announcement sent to ${ch}` });
  Utils.sendLog(itx.guild, Utils.embed({
    title: '📣 Announcement Created',
    color: CONFIG.colors.info,
    fields: [
      { name: '👤 By', value: itx.user.tag, inline: true },
      { name: '📍 Channel', value: `${ch}`, inline: true },
      { name: '📢 Ping', value: pingContent || 'None', inline: true }
    ]
  }));
}

async function cmdTicket(itx) {
  const sub = itx.options.getSubcommand();
  const cfg = Utils.getConfig(itx.guild.id);

  if (sub === 'create') {
    if (activeTickets.has(itx.user.id)) {
      const existingId = activeTickets.get(itx.user.id);
      return itx.reply({
        ephemeral: true,
        content: `❌ You already have a ticket: <#${existingId}>`
      });
    }

    let catId = cfg.ticketCategory;
    if (!catId) {
      const cat = itx.guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('ticket')
      );
      if (cat) catId = cat.id;
      else {
        const newCat = await itx.guild.channels.create({
          name: '🎟️ Tickets',
          type: ChannelType.GuildCategory
        });
        catId = newCat.id;
      }
    }

    const ch = await itx.guild.channels.create({
      name: `ticket-${itx.user.username}`.toLowerCase().slice(0, 100),
      type: ChannelType.GuildText,
      parent: catId,
      permissionOverwrites: [
        { id: itx.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: itx.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles
          ]
        },
        ...(cfg.supportRole ? [{
          id: cfg.supportRole,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }] : [])
      ]
    });

    activeTickets.set(itx.user.id, ch.id);

    const closeBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close:${itx.user.id}`)
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );

    await ch.send({
      content: `<@${itx.user.id}>${cfg.supportRole ? ` <@&${cfg.supportRole}>` : ''}`,
      embeds: [Utils.embed({
        title: '🎟️ Support Ticket',
        description: `Welcome, <@${itx.user.id}>!\n\nDescribe your issue. ${cfg.supportRole ? `<@&${cfg.supportRole}>` : 'Staff'} will help soon.`,
        color: CONFIG.colors.success,
        fields: [
          { name: '📋 Info', value: `Opened: <t:${Utils.timestamp()}:R>\nOpener: ${itx.user.tag}`, inline: false }
        ]
      })],
      components: [closeBtn]
    });

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
      description: `Welcome to **${itx.guild.name}**!\n\nClick the button below to verify and get access.\n\nYou will receive: ${role}`,
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
      title: '📊 Xaver v5.0 Stats',
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
        { name: '🤖 Version', value: 'v5.0 MEGA', inline: true }
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