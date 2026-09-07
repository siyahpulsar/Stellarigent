const fs = require('fs');
const path = require('path');
const {
  agentState,
  config,
  getCanAnalyzeImages,
  broadcastTerminal
} = require('../state');

/**
 * Generates custom mode rules for the IDE Planner Agent based on active mode & sub-mode
 */
function getPlannerModeRules(state) {
  let modeRules = '';
  if (state.activeMode === 'research') {
    if (state.activeSubMode === 'web') {
      modeRules = `\n\n[DİKKAT: Ajan şu an 'Web Research' modundadır. Planını buna göre yap. Adımların web araması yapmak ve siteleri okumak olmalı. SON ADIMIN (örneğin 4. veya 5. adım) SADECE "Topladığın bilgileri kullanıcıya raporla" cümlesinden ibaret olmalıdır. SAKIN BURADA RAPORU VEYA SONUCU YAZMA! Sen sadece bir yapılacaklar listesi (plan) hazırlıyorsun, araştırmayı sen yapmayacaksın.]`;
    } else if (state.activeSubMode === 'local') {
      modeRules = `\n\n[DİKKAT: Ajan şu an 'Local Research' modundadır. SADECE yerel dosyaları okuyabilir. İnternete bağlanamaz. SON ADIMIN SADECE "Bulduğun yerel sonuçları kullanıcıya raporla" cümlesi olmalıdır. SAKIN BURADA SONUÇLARI YAZMA! Sadece plan oluşturuyorsun.]`;
    } else if (state.activeSubMode === 'deep_web') {
      modeRules = `\n\n[DİKKAT: Ajan şu an 'Deep Web Research' modundadır. Planını çok kısa tut ve SON ADIM olarak SADECE "Detaylı raporlama yap" maddesini ekle. SAKIN RAPORU BURADA YAZMA.]`;
    }
  } else if (state.activeMode === 'manuel') {
    modeRules = `\n\n[DİKKAT: Ajan şu an 'Manuel Tool' modundadır. Planını en fazla 2-3 adımda bitir ve SON ADIM olarak SADECE "Sonucu kullanıcıya raporla" de. SAKIN BURADA RAPOR VEYA ÇÖZÜM ÜRETMEYE ÇALIŞMA, sadece adımları yaz.]`;
  }
  return modeRules;
}

/**
 * Prepares the conversation messages array for LLM request, applying sliding window context pruning
 * and converting local image references into multimodal base64 payloads when vision is enabled.
 */
async function prepareRequestMessages(dynamicSystemPrompt) {
  // Window the messages: always include system messages, but cap total count
  let messagesToSend = agentState.messages;
  const maxMsgs = config.maxContextMessages || 40;
  if (agentState.messages.length > maxMsgs) {
    // Keep the first message (initial task) + the most recent messages
    const firstMsg = agentState.messages[0];
    const recentMsgs = agentState.messages.slice(-(maxMsgs - 1));
    messagesToSend = [firstMsg, ...recentMsgs];
    broadcastTerminal(`> [CONTEXT WINDOW] History trimmed: ${agentState.messages.length} msgs → ${maxMsgs} sent to LLM (oldest dropped, first task msg kept).\n`);
  }

  return [
    { role: 'system', content: dynamicSystemPrompt },
    ...(await Promise.all(messagesToSend.map(async m => {
      let contentVal = m.content;
      const canAnalyze = getCanAnalyzeImages();
      if (canAnalyze && m.imagePath && fs.existsSync(m.imagePath)) {
        try {
          const ext = path.extname(m.imagePath).toLowerCase().replace('.', '');
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
          const base64Data = await fs.promises.readFile(m.imagePath, 'base64');
          contentVal = [
            { type: 'text', text: m.role === 'system' ? `[System Context: Info]\n${m.content}` : m.content },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`
              }
            }
          ];
        } catch (e) {
          console.error('[CONTEXT BUILDER] Failed to construct vision message:', e);
        }
      } else if (m.role === 'system') {
        contentVal = `[System Context: Info]\n${m.content}`;
      }
      return { role: m.role === 'system' ? 'user' : m.role, content: contentVal };
    })))
  ];
}

module.exports = {
  prepareRequestMessages,
  getPlannerModeRules
};
