// =======================
// XAVER v2 — The Samurai Demon 😈🗡️
// Lightweight, no DB, Discord.js v14
// =======================

// 1) ENV
require('dotenv').config();

// 2) Imports
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField
} = require('discord.js');

// 3) ENV Variablen
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || 'x!';
const PORT = Number(process.env.PORT || 3000);
const OWNER_ID = process.env.OWNER_ID || null;       // optional
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null; // optional
const HEALTH_KEY = process.env.HEALTH_KEY || null;   // optional

if (!TOKEN) throw new Error('Missing DISCORD_TOKEN');

// 4) Keepalive / Health (für Replit/Railway)
const app = express();
app.get('/', (_req, res) => res.send('🟣 Xaver is awake.'));
app.get('/health', (req, res) => {
  if (HEALTH_KEY && req.query.key !== HEALTH_KEY) return res.status(403).end();
  res.status(200).send('OK');
});
app.listen(PORT, () => console.log(`HTTP up on :${PORT}`));

// 5) Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// 6) Helpers & In-Memory Stores
function speak(line) {
  // Zero-width pad + samurai voice
  return `\u200B${line}`;
}
function keyUser(gid, uid) { return `${gid}:${uid}`; }
function hasPerm(member, perm) {
  return member.permissions.has(perm) || member.id === OWNER_ID;
}
function addHelp(line) { helpLines.push(line); }
function xpForLevel(level) { return 5 * level * level + 20 * level + 10; }

const stats = new Map();     // `${guildId}:${userId}` -> {count,lastSeen,bio,xp,level,username}
const warns = new Map();     // `${guildId}:${userId}` -> number
const cooldowns = new Map(); // simple cooldown store
const helpLines = [];

// 7) Ready
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: `🗡️ awaiting orders | ${PREFIX}help` }],
    status: 'online'
  });
});

// 8) Shadow Logs (optional via LOG_CHANNEL_ID)
async function sendLog(guild, text) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (ch) await ch.send(text);
  } catch {}
}

client.on('messageDelete', (msg) => {
  if (!msg.guild || msg.author?.bot) return;
  sendLog(
    msg.guild,
    `🗑️ **Delete** in <#${msg.channel.id}> by **${msg.author?.tag || 'unknown'}**:\n${msg.content || '(no text)'}`
  );
});

client.on('messageUpdate', (oldMsg, newMsg) => {
  if (!newMsg.guild || newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  sendLog(
    newMsg.guild,
    `✏️ **Edit** in <#${newMsg.channel.id}> by **${newMsg.author.tag}**:\n**Old:** ${oldMsg.content || '(no text)'}\n**New:** ${newMsg.content || '(no text)'}`
  );
});

client.on('guildMemberAdd', (member) => {
  const ch = member.guild.systemChannel;
  if (ch) ch.send(speak(`👁️ A presence has entered: **${member.user.username}**`));
  sendLog(member.guild, `➕ **Join**: ${member.user.tag} (${member.id})`);
});

client.on('guildMemberRemove', (member) => {
  sendLog(member.guild, `➖ **Leave**: ${member.user?.tag || member.id}`);
});

// 9) Anti-Spam Light
function antiSpamKey(msg) { return `spam:${msg.guild.id}:${msg.author.id}`; }
function bumpSpam(msg) {
  const k = antiSpamKey(msg);
  const now = Date.now();
  const data = cooldowns.get(k) || { t: now, n: 0 };
  if (now - data.t > 4000) { data.t = now; data.n = 0; }
  data.n++;
  cooldowns.set(k, data);
  return data.n;
}

// 10) Commands (help registry)
addHelp(`\`${PREFIX}help\` — 📜 see my capabilities`);
addHelp(`\`${PREFIX}ping\` — 🧭 test my awareness`);
addHelp(`\`${PREFIX}avatar [@user]\` — 🖼️ show an avatar`);
addHelp(`\`${PREFIX}userinfo [@user]\` — 🧾 a brief dossier`);
addHelp(`\`${PREFIX}serverinfo\` — 🏰 server dossier`);
addHelp(`\`${PREFIX}8ball <question>\` — 🎱 I will answer`);
addHelp(`\`${PREFIX}bio set <text>\` — 🖊️ set your short bio (temp)`);
addHelp(`\`${PREFIX}profile\` — 🧑‍💼 show your temp stats`);
addHelp(`\`${PREFIX}rank\` — 📈 your level & XP`);
addHelp(`\`${PREFIX}purge <1-100>\` — 🧹 delete messages (mod)`);
addHelp(`\`${PREFIX}kick @user [reason]\` — 👢 remove a user (mod)`);
addHelp(`\`${PREFIX}ban @user [reason]\` — 🔨 ban a user (mod)`);
addHelp(`\`${PREFIX}timeout @user <minutes> [reason]\` — ⛔ timeout a user (mod)`);
if (OWNER_ID) addHelp(`\`${PREFIX}say <text>\` — 🗣️ speak through me (owner)`);

// 11) Message Handler
client.on('messageCreate', async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  // Anti-spam
  const countInWindow = bumpSpam(msg);
  if (countInWindow > 7) {
    try { await msg.delete().catch(() => {}); } catch {}
    return;
  }

  // Auto-Stats & XP
  const k = keyUser(msg.guild.id, msg.author.id);
  const s = stats.get(k) || { count: 0, lastSeen: null, bio: null, xp: 0, level: 0, username: msg.author.username };
  s.count += 1;
  s.lastSeen = new Date();
  s.username = msg.author.username;

  // XP (10s cooldown)
  const cdKey = `xp:${k}`;
  const now = Date.now();
  const last = cooldowns.get(cdKey) || 0;
  if (now - last > 10000) {
    const gain = 10 + Math.floor(Math.random() * 6); // 10–15
    s.xp += gain;
    cooldowns.set(cdKey, now);
    // Level up
    while (s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level);
      s.level++;
      msg.channel.send(speak(`🟣 **${msg.author.username}** advanced. Level **${s.level}**.`)).catch(() => {});
    }
  }
  stats.set(k, s);

  // Samurai hello
  if (msg.content.trim().toLowerCase() === 'hi')
    return msg.reply(speak('I acknowledge your presence. 🗡️'));

  if (!msg.content.startsWith(PREFIX)) return;
  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();

  // ---- Core
  if (cmd === 'ping') return msg.reply(speak('Still ready. 🧭'));
  if (cmd === 'help') {
    return msg.reply(['**🗡️ Xaver — Commands**', ...helpLines].join('\n'));
  }

  // ---- Identity
  if (cmd === 'avatar') {
    const target = msg.mentions.users.first() || msg.author;
    const url = target.displayAvatarURL({ extension: 'png', size: 1024 });
    return msg.reply({ content: speak('A clear look. 🖼️'), files: [url] });
  }

  if (cmd === 'userinfo') {
    const member = msg.mentions.members.first() || msg.member;
    const roles = member.roles.cache
      .filter(r => r.id !== msg.guild.id)
      .map(r => r.name).slice(0, 15).join(', ') || 'none';
    const created = `<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`;
    const joined = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp/1000)}:R>` : '—';
    return msg.reply([
      `**🧾 User:** ${member.user.tag}`,
      `**🆔 ID:** ${member.id}`,
      `**📅 Created:** ${created}`,
      `**🚪 Joined:** ${joined}`,
      `**🏷️ Roles:** ${roles}`
    ].join('\n'));
  }

  if (cmd === 'serverinfo') {
    const g = msg.guild;
    const created = `<t:${Math.floor(g.createdTimestamp/1000)}:R>`;
    return msg.reply([
      `**🏰 Server:** ${g.name} (${g.id})`,
      `**👥 Members:** ${g.memberCount}`,
      `**📅 Created:** ${created}`,
      `**👑 Owner:** <@${g.ownerId}>`
    ].join('\n'));
  }

  // ---- Fun
  if (cmd === '8ball') {
    const q = args.join(' ').trim();
    if (!q) return msg.reply(speak(`Ask clearly: \`${PREFIX}8ball <question>\` 🎱`));
    const answers = [
      'Yes. ✅',
      'No. ❌',
      'Unclear. 🌫️',
      'In time. ⏳',
      'Not today. 💤',
      'If you are ready. 🗡️',
      'You already know. 👁️',
      'Focus first. 🎯'
    ];
    const pick = answers[Math.floor(Math.random() * answers.length)];
    return msg.reply(speak(pick));
  }

  // ---- Bio / Profile / Rank
  if (cmd === 'bio') {
    const sub = (args.shift() || '').toLowerCase();
    if (sub !== 'set') return msg.reply(speak(`Use: \`${PREFIX}bio set <text>\` ✍️`));
    const text = args.join(' ').trim();
    if (!text) return msg.reply(speak(`Provide text: \`${PREFIX}bio set I like purple.\` 💜`));
    const o = stats.get(k) || {};
    o.bio = text;
    o.lastSeen = new Date();
    stats.set(k, o);
    return msg.reply(speak('Bio saved. 🖊️'));
  }

  if (cmd === 'profile') {
    const d = stats.get(k) || {};
    const bio = d.bio ? `“${d.bio}”` : '—';
    const count = d.count || 0;
    const seen = d.lastSeen ? `<t:${Math.floor(d.lastSeen.getTime()/1000)}:R>` : '—';
    return msg.reply([
      `**🧑‍💼 Profile of ${msg.author.username}**`,
      `Bio: ${bio}`,
      `Messages: ${count} ✉️`,
      `Last seen: ${seen}`
    ].join('\n'));
  }

  if (cmd === 'rank') {
    const d = stats.get(k) || { level: 0, xp: 0 };
    const need = xpForLevel(d.level);
    return msg.reply(speak(`📈 Level **${d.level}** — ${d.xp}/${need} XP`));
  }

  // ---- Moderation
  if (cmd === 'purge') {
    if (!hasPerm(msg.member, PermissionsBitField.Flags.ManageMessages))
      return msg.reply(speak('You lack permission. 🚫'));
    const n = parseInt(args[0], 10);
    if (isNaN(n) || n < 1 || n > 100) return msg.reply(speak(`Use: \`${PREFIX}purge <1-100>\` 🧹`));
    await msg.channel.bulkDelete(n, true).catch(() => {});
    return msg.channel.send(speak(`Cleared ${n}. 🧼`)).then(m => setTimeout(() => m.delete().catch(()=>{}), 3000));
  }

  if (cmd === 'kick') {
    if (!hasPerm(msg.member, PermissionsBitField.Flags.KickMembers))
      return msg.reply(speak('You lack permission. 🚫'));
    const target = msg.mentions.members.first();
    const reason = args.slice(1).join(' ') || 'none';
    if (!target) return msg.reply(speak(`Use: \`${PREFIX}kick @user [reason]\` 👢`));
    if (!target.kickable) return msg.reply(speak('I cannot kick them. ⚠️'));
    await target.kick(reason).catch(()=>{});
    const wk = warns.get(keyUser(msg.guild.id, target.id)) || 0;
    warns.set(keyUser(msg.guild.id, target.id), wk + 1);
    sendLog(msg.guild, `👢 **Kick:** ${target.user.tag} by ${msg.author.tag} — ${reason}`);
    return msg.reply(speak(`Kicked ${target.user.tag}. 👢`));
  }

  if (cmd === 'ban') {
    if (!hasPerm(msg.member, PermissionsBitField.Flags.BanMembers))
      return msg.reply(speak('You lack permission. 🚫'));
    const target = msg.mentions.members.first();
    const reason = args.slice(1).join(' ') || 'none';
    if (!target) return msg.reply(speak(`Use: \`${PREFIX}ban @user [reason]\` 🔨`));
    if (!target.bannable) return msg.reply(speak('I cannot ban them. ⚠️'));
    await target.ban({ reason }).catch(()=>{});
    sendLog(msg.guild, `🔨 **Ban:** ${target.user.tag} by ${msg.author.tag} — ${reason}`);
    return msg.reply(speak(`Banned ${target.user.tag}. 🔨`));
  }

  if (cmd === 'timeout') {
    if (!hasPerm(msg.member, PermissionsBitField.Flags.ModerateMembers))
      return msg.reply(speak('You lack permission. 🚫'));
    const target = msg.mentions.members.first();
    const minutes = parseInt(args[1], 10);
    const reason = args.slice(2).join(' ') || 'none';
    if (!target || isNaN(minutes) || minutes < 1 || minutes > 10080)
      return msg.reply(speak(`Use: \`${PREFIX}timeout @user <minutes 1-10080> [reason]\` ⏱️`));
    const ms = minutes * 60 * 1000;
    try {
      await target.timeout(ms, reason);
      sendLog(msg.guild, `⛔ **Timeout:** ${target.user.tag} ${minutes}m by ${msg.author.tag} — ${reason}`);
      return msg.reply(speak(`Timed out ${target.user.tag} for ${minutes} minute(s). ⛔`));
    } catch {
      return msg.reply(speak('I cannot timeout them. ⚠️'));
    }
  }

  // ---- Owner
  if (cmd === 'say') {
    if (!OWNER_ID || msg.author.id !== OWNER_ID)
      return msg.reply(speak('Only my handler may do that. 🕶️'));
    const text = args.join(' ').trim();
    if (!text) return msg.reply(speak(`Use: \`${PREFIX}say <text>\` 🗣️`));
    try { await msg.delete().catch(()=>{}); } catch {}
    return msg.channel.send(text);
  }

}); // end messageCreate

// Safety logs
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
process.on('uncaughtException', (e) => console.error('[uncaught]', e));

// Start bot
client.login(TOKEN);
