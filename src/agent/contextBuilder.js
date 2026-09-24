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
  // Research and Library modes run their own direct workflows and bypass IDE Planner completely.
  return '';
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
