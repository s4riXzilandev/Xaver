// 1) ENV
require('dotenv').config();

// 2) Imports
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// 3) ENV Variablen
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || 'x!';
const PORT = process.env.PORT || 3000;

if (!TOKEN) throw new Error('Missing DISCORD_TOKEN');

// 4) Keepalive (Replit)
const app = express();
app.get('/', (_req, res) => res.send('Xaver is awake. 💜'));
app.listen(PORT, () => console.log(`HTTP up on :${PORT}`));

// 5) Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// 6) In-Memory Stats (statt Mongo)
const stats = new Map(); // key: `${guildId}:${userId}` -> {count, lastSeen, bio?}

// 7) Ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({ activities: [{ name: `${PREFIX}help` }], status: 'online' });
});

// 8) Message Handler
client.on('messageCreate', async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  // Auto-Stats
  const key = `${msg.guild.id}:${msg.author.id}`;
  const prev = stats.get(key) || { count: 0, lastSeen: null, bio: null, username: msg.author.username };
  prev.count += 1;
  prev.lastSeen = new Date();
  prev.username = msg.author.username;
  stats.set(key, prev);

  // Easter egg
  if (msg.content.trim().toLowerCase() === 'hi') return msg.reply('I see.');

  if (!msg.content.startsWith(PREFIX)) return;
  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();

  if (cmd === 'ping') return msg.reply('Pong!');
  if (cmd === 'help') {
    return msg.reply([
      '**Xaver — Commands**',
      `\`${PREFIX}ping\` — Pong`,
      `\`${PREFIX}bio set <text>\` — set your short bio (temp)`,
      `\`${PREFIX}profile\` — show your temp stats`
    ].join('\n'));
  }

  if (cmd === 'bio') {
    const sub = (args.shift() || '').toLowerCase();
    if (sub !== 'set') return msg.reply(`Use: \`${PREFIX}bio set <text>\``);
    const text = args.join(' ').trim();
    if (!text) return msg.reply(`Bro, gib Text an: \`${PREFIX}bio set Ich mag Lila.\``);
    const obj = stats.get(key) || {};
    obj.bio = text;
    obj.lastSeen = new Date();
    stats.set(key, obj);
    return msg.reply('Bio gespeichert. The X notices. (temp)');
  }

  if (cmd === 'profile') {
    const d = stats.get(key) || {};
    const bio = d.bio ? `“${d.bio}”` : '—';
    const count = d.count || 0;
    const seen = d.lastSeen ? `<t:${Math.floor(d.lastSeen.getTime()/1000)}:R>` : '—';
    return msg.reply([
      `**Profile of ${msg.author.username}**`,
      `Bio: ${bio}`,
      `Messages: ${count}`,
      `Last seen: ${seen}`,
      `*Note: resets on restart*`
    ].join('\n'));
  }
});

// 9) Optional: simple welcome
client.on('guildMemberAdd', (member) => {
  const ch = member.guild.systemChannel;
  if (ch) ch.send(`A new presence has entered: **${member.user.username}**`);
});

// 10) Start
client.login(TOKEN);
