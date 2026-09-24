const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require('discord.js');
const { state } = require('./state');
const { handleAgentMention } = require('./agentBridge');
const { handleCommand } = require('./commands');
const { createAudioPlayer, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { playNext } = require('./musicPlayer');

function loadFounderId() {
  try {
    const kurucuPath = path.join(__dirname, '../../config', 'kurucu.json');
    if (fs.existsSync(kurucuPath)) {
      const data = JSON.parse(fs.readFileSync(kurucuPath, 'utf-8'));
      if (data && data.founder) state.founderDiscordId = data.founder;
    }
  } catch (e) {}
}
loadFounderId();

const CONFIG_FILE = path.join(__dirname, '../../config', 'config.json');
const PERMISSIONS_FILE = path.join(__dirname, '../../config', 'permissions.json');
function loadDiscordConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const conf = Array.isArray(data) ? data[0] : data;
      if (conf) {
        if (conf.admins) state.discordState.admins = conf.admins;
        if (conf.connectionSpeedLimit !== undefined) state.discordState.connectionSpeedLimit = conf.connectionSpeedLimit;
        if (conf.maxLibraryGB !== undefined) state.discordState.maxLibraryGB = conf.maxLibraryGB;
        if (conf.autocleanDays !== undefined) state.discordState.autocleanDays = conf.autocleanDays;
      }
    }
  } catch (e) {}
  try {
    if (fs.existsSync(PERMISSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf-8'));
      const perm = Array.isArray(data) ? data[0] : data;
      if (perm && perm.authorizedUsers) state.discordState.authorizedUsers = perm.authorizedUsers;
    }
  } catch (e) {}
}

function initDiscordBot(wsBroadcast, serverCallbacks = null) {
  state.broadcastCallback = wsBroadcast;
  state.serverCb = serverCallbacks;
  loadDiscordConfig();
  const token = process.env.DISCORD_TOKEN;
  if (!token) return;
  
  state.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates] });
  state.client.once('clientReady', () => {
    state.discordState.online = true;
    if (state.broadcastCallback) state.broadcastCallback();
    state.client.user.setActivity('Stellarigent music', { type: ActivityType.Listening });
  });

  state.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'approve_discord_action' || interaction.customId === 'reject_discord_action') {
      if (interaction.user.id !== state.founderDiscordId) {
        await interaction.reply({ content: "❌ Bu işlemi sadece Kurucu onaylayabilir!", ephemeral: true });
        return;
      }
      const isApprove = interaction.customId === 'approve_discord_action';
      const pendingAction = state.serverCb ? state.serverCb.getPendingAction() : null;
      if (pendingAction) {
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(isApprove ? 0x10b981 : 0xef4444)
          .setTitle(isApprove ? "✅ İşlem Onaylandı" : "❌ İşlem Reddedildi")
          .setDescription(`Bu işlem kurucu tarafından Discord üzerinden ${isApprove ? "ONAYLANDI" : "REDDEDİLDİ"}.`);
        await interaction.update({ embeds: [embed], components: [] });
        let decision = isApprove ? { approved: true, action: pendingAction } : { approved: false, feedback: "Rejected via Discord Buttons" };
        if (state.serverCb && state.serverCb.resolvePendingAction) state.serverCb.resolvePendingAction(decision);
      } else {
        await interaction.reply({ content: "❌ Bekleyen aktif bir işlem bulunamadı.", ephemeral: true });
      }
    } else if (interaction.customId.startsWith('approve_rule_') || interaction.customId.startsWith('reject_rule_')) {
      if (interaction.user.id !== state.founderDiscordId) {
        await interaction.reply({ content: "❌ Bu kuralı sadece Kurucu onaylayabilir!", ephemeral: true });
        return;
      }
      const isApprove = interaction.customId.startsWith('approve_rule_');
      const ruleId = interaction.customId.replace(/^(approve_rule_|reject_rule_)/, '');
      const { approvePendingRule, rejectPendingRule } = require('../memory');
      const res = isApprove ? await approvePendingRule(ruleId) : await rejectPendingRule(ruleId);

      if (!res) {
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0x64748b)
          .setTitle("ℹ️ Kural Zaten İşlendi")
          .setDescription("Bu güvenlik kuralı daha önce Web Paneli veya Discord üzerinden zaten onaylanmış veya silinmiş.");
        await interaction.update({ embeds: [embed], components: [] });
        return;
      }

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(isApprove ? 0x10b981 : 0xef4444)
        .setTitle(isApprove ? "✅ Güvenlik Kuralı Onaylandı" : "❌ Güvenlik Kuralı Silindi")
        .setDescription(`Bu kural Discord üzerinden kurucu tarafından ${isApprove ? "ONAYLANDI (Aktif belleğe eklendi)" : "REDDEDİLDİ (Silindi)"}.`);
      await interaction.update({ embeds: [embed], components: [] });
    }
  });

  state.audioPlayer = createAudioPlayer();
  state.audioPlayer.on(AudioPlayerStatus.Idle, () => playNext(null));
  state.audioPlayer.on('error', () => playNext(null));

  state.client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const cleanContent = message.content.replace(`<@${state.client.user.id}>`, '').trim();
    if (message.mentions.has(state.client.user) && !message.content.startsWith('!')) {
      await handleAgentMention(message, cleanContent);
      return;
    }
    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    await handleCommand(message, command, args);
  });

  state.client.login(token).catch(() => {});
}

module.exports = { initDiscordBot };
