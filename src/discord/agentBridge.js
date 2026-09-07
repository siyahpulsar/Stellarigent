const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { state } = require('./state');
const fs = require('fs');
const path = require('path');

function trackMessage(messageObj, metadata = {}) {
  if (!messageObj) return;
  state.trackedMessages.push({
    messageObj,
    isDiscordMessageTool: !!metadata.isDiscordMessageTool,
    filePath: metadata.filePath || null,
    hasToolCall: metadata.hasToolCall !== undefined ? !!metadata.hasToolCall : false,
    isStatusMessage: !!metadata.isStatusMessage,
    isUserTrigger: !!metadata.isUserTrigger
  });
}

function hasVisual(msgObj) {
  if (!msgObj) return false;
  if (msgObj.attachments && msgObj.attachments.size > 0) {
    const hasImgAttachment = msgObj.attachments.some(att => att.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(att.name || ''));
    if (hasImgAttachment) return true;
  }
  if (msgObj.embeds && msgObj.embeds.length > 0) {
    const hasImgEmbed = msgObj.embeds.some(emb => emb.image || emb.thumbnail || (emb.data && (emb.data.image || emb.data.thumbnail)));
    if (hasImgEmbed) return true;
  }
  return false;
}

async function cleanupTaskMessages() {
  for (const m of state.trackedMessages) {
    try {
      const isMsgTool = m.isDiscordMessageTool;
      const hasImg = hasVisual(m.messageObj) || (m.filePath && /\.(png|jpg|jpeg|gif|webp)$/i.test(m.filePath));
      const noToolCall = !m.hasToolCall;
      const shouldDeleteStatus = m.isStatusMessage && !hasImg;
      if (shouldDeleteStatus || (!isMsgTool && !hasImg && !noToolCall)) {
        await m.messageObj.delete().catch(() => {});
      }
    } catch (err) {}
  }
  state.trackedMessages = [];
}

async function updateDiscordStatus(status, stepInfo, explanation, st = null) {
  if (!state.activeStatusMessage) return;
  try {
    const embed = new EmbedBuilder()
      .setTitle("🤖 Stellarch Ajan Durumu")
      .setColor(status === 'pending_approval' ? 0xf59e0b : (status === 'executing' ? 0x3b82f6 : 0x10b981))
      .setDescription(`**Durum:** ${status.toUpperCase().replace('_', ' ')}`)
      .addFields({ name: 'Aktif Adım', value: stepInfo || 'Düşünülüyor...' });
    if (explanation) embed.addFields({ name: 'Açıklama', value: explanation });
    if (st) {
      if (st.selectedGuides && st.selectedGuides.length > 0) embed.addFields({ name: '📘 Seçilen Rehberler (Guides)', value: st.selectedGuides.map(g => `- \`${g}\``).join('\n') });
      else embed.addFields({ name: '📘 Seçilen Rehberler (Guides)', value: 'Henüz bir rehber seçilmedi.' });

      if (st.planSteps && st.planSteps.length > 0) {
        const todoList = st.planSteps.map(step => `${step.status === 'completed' ? '✅' : (step.status === 'current' ? '⏳' : '⬜')} ${step.text}`).join('\n');
        embed.addFields({ name: '📝 Görev Planı (To-Do)', value: todoList });
      }
      if (st.executedTools && st.executedTools.length > 0) embed.addFields({ name: '🛠️ Çağrılan Araçlar (Tools)', value: st.executedTools.map(t => `- ${t}`).join('\n') });
      if (st.thoughts && st.thoughts.length > 0) {
        const thoughtsJoined = st.thoughts.map(t => `> *${t}*`).join('\n');
        embed.addFields({ name: '💭 Ajan Düşünceleri', value: thoughtsJoined.length > 1024 ? thoughtsJoined.substring(0, 1021) + '...' : thoughtsJoined });
      }
    }
    await state.activeStatusMessage.edit({ content: ' ', embeds: [embed] });
  } catch (err) {}
}

async function sendDiscordFinalResult(messageText) {
  if (!state.activeStatusMessage || !state.activeChannel) return;
  try {
    const embed = new EmbedBuilder()
      .setTitle("✅ Stellarch Ajan Görevi Bitti")
      .setColor(messageText.includes('Başarıyla') || messageText.includes('successfully') ? 0x10b981 : 0xef4444)
      .setDescription(messageText);
    const finalMsg = await state.activeStatusMessage.reply({ embeds: [embed] });
    trackMessage(finalMsg, { hasToolCall: false });
    setTimeout(cleanupTaskMessages, 5000);
    state.activeStatusMessage = null;
    state.activeChannel = null;
  } catch (err) {}
}

async function sendChannelMessage(content, filePath, meta = {}) {
  if (!state.activeChannel) return { success: false, message: "No active channel context." };
  try {
    const textContent = typeof content === 'string' ? content : (content ? String(content) : '');
    const options = {};
    if (textContent) options.content = textContent;
    if (filePath) {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      if (fs.existsSync(resolvedPath)) options.files = [resolvedPath];
    }
    
    if (options.content && options.content.length > 2000) {
      const chunks = [];
      let remaining = options.content;
      while (remaining.length > 0) {
        if (remaining.length <= 1900) { chunks.push(remaining); break; }
        let splitIdx = remaining.lastIndexOf('\n', 1900);
        if (splitIdx === -1 || splitIdx < 500) splitIdx = remaining.lastIndexOf(' ', 1900);
        if (splitIdx === -1 || splitIdx < 500) splitIdx = 1900;
        chunks.push(remaining.substring(0, splitIdx));
        remaining = remaining.substring(splitIdx);
      }
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.trim().length > 0) {
          const sentMsg = await state.activeChannel.send(i === 0 && options.files ? { content: chunk, files: options.files } : chunk);
          trackMessage(sentMsg, { isDiscordMessageTool: !!meta.isDiscordMessageTool, filePath, hasToolCall: !!meta.hasToolCall });
        }
      }
    } else if (options.content || options.files) {
      const sentMsg = await state.activeChannel.send(options);
      trackMessage(sentMsg, { isDiscordMessageTool: !!meta.isDiscordMessageTool, filePath, hasToolCall: !!meta.hasToolCall });
    }
    return { success: true, message: "Message sent successfully to Discord." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function sendApprovalRequest(action) {
  let targetChannel = state.activeChannel;
  if (!targetChannel && state.client && state.client.guilds.cache.size > 0) {
    for (const guild of state.client.guilds.cache.values()) {
      const channel = guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me).has('SendMessages'));
      if (channel) { targetChannel = channel; break; }
    }
  }
  if (!targetChannel) return;
  try {
    const embed = new EmbedBuilder()
      .setTitle("⚠️ Onay Bekleyen İşlem")
      .setColor(0xf59e0b)
      .setDescription(`Ajan bilgisayarınızda kritik bir işlem yürütmek istiyor.`)
      .addFields(
        { name: "Aksiyon", value: `\`${action.action}\`` },
        { name: "Açıklama", value: action.explanation || "Açıklama belirtilmedi." }
      );
    if (action.action === 'execute_command') embed.addFields({ name: "Komut", value: `\`\`\`bash\n${action.command}\n\`\`\`` });
    else if (action.action === 'write_file') embed.addFields({ name: "Dosya Yolu", value: `\`${action.path}\`` }, { name: "İçerik", value: `\`\`\`\n${action.content ? (action.content.length > 500 ? action.content.slice(0, 500) + '...' : action.content) : ''}\n\`\`\`` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('approve_discord_action').setLabel('Onayla (Approve)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('reject_discord_action').setLabel('Reddet (Reject)').setStyle(ButtonStyle.Danger)
    );
    const sentMsg = await targetChannel.send({ embeds: [embed], components: [row] });
    trackMessage(sentMsg, { hasToolCall: true });
  } catch (err) {}
}

async function handleAgentMention(message, cleanContent) {
  state.trackedMessages = [];
  trackMessage(message, { isUserTrigger: true, hasToolCall: false });
  const replyMessage = await message.reply("İstek alındı, Ajan başlatılıyor... 🤖");
  state.activeChannel = message.channel;
  state.activeStatusMessage = replyMessage;
  trackMessage(replyMessage, { isStatusMessage: true, hasToolCall: false });
  if (state.serverCb && state.serverCb.startDiscordAgentTask) state.serverCb.startDiscordAgentTask(cleanContent, message, replyMessage);
}

module.exports = { updateDiscordStatus, sendDiscordFinalResult, sendChannelMessage, sendApprovalRequest, handleAgentMention, trackMessage };
