const fs = require('fs');
const path = require('path');
const { readEnv, writeEnv } = require('../utils/envManager');
const { config, broadcastTerminal } = require('../state');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

/**
 * Safely reads a JSON file or returns a fallback value
 */
async function readJsonSafe(filePath, fallback = {}) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

const { approvePendingRule, rejectPendingRule } = require('../memory');

/**
 * Reads all administrative configurations and sends them to the client with masked secrets
 */
async function sendAdminData(ws) {
  try {
    const envObj = readEnv();
    const rulesPath = path.join(CONFIG_DIR, 'security_rules.json');
    const kurucuPath = path.join(CONFIG_DIR, 'kurucu.json');
    const permPath = path.join(CONFIG_DIR, 'permissions.json');
    const memoryPath = path.join(CONFIG_DIR, 'memory.json');
    const configPath = path.join(CONFIG_DIR, 'config.json');

    const [securityRules, kurucuObj, permissionsObj, memoryObj, configJsonObj] = await Promise.all([
      readJsonSafe(rulesPath, {}),
      readJsonSafe(kurucuPath, {}),
      readJsonSafe(permPath, []).then(r => Array.isArray(r) ? r : []),
      readJsonSafe(memoryPath, { memories: [], pendingRules: [] }),
      readJsonSafe(configPath, []).then(r => Array.isArray(r) ? r : [])
    ]);

    const memoriesList = Array.isArray(memoryObj) ? memoryObj : (memoryObj.memories || []);
    const pendingRulesList = Array.isArray(memoryObj) ? [] : (memoryObj.pendingRules || []);

    // Mask secrets before sending to client
    const safeEnv = { ...envObj };
    if (safeEnv.DISCORD_TOKEN) safeEnv.DISCORD_TOKEN = safeEnv.DISCORD_TOKEN.replace(/.(?=.{4})/g, '*');
    if (safeEnv.FOUNDER_KEY) safeEnv.FOUNDER_KEY = safeEnv.FOUNDER_KEY.replace(/.(?=.{2})/g, '*');

    ws.send(JSON.stringify({
      type: 'admin_data',
      env: safeEnv,
      securityRules,
      kurucu: kurucuObj,
      permissions: permissionsObj,
      memory: memoriesList,
      pendingRules: pendingRulesList,
      configJson: configJsonObj
    }));
  } catch (e) {
    console.error('[SETTINGS HANDLER] Failed to send admin data:', e);
  }
}

/**
 * Updates in-memory runtime config and persists changed keys to config.json and system_prompts.json
 */
function handleUpdateSettings(data, ws) {
  if (data.settings) {
    if (data.settings.bannedCommands !== undefined && Array.isArray(data.settings.bannedCommands)) {
      config.bannedCommands = data.settings.bannedCommands;
    }
    if (data.settings.modelTags !== undefined && typeof data.settings.modelTags === 'object') {
      config.modelTags = { ...data.settings.modelTags };
    }
    if (data.settings.systemPrompts !== undefined) {
      config.systemPrompts = Object.assign(config.systemPrompts || {}, data.settings.systemPrompts);
      if (data.settings.systemPrompts.main_prompt) {
        config.systemPrompt = data.settings.systemPrompts.main_prompt;
        try {
          fs.writeFileSync(path.join(CONFIG_DIR, 'system_prompt.txt'), config.systemPrompt, 'utf-8');
        } catch (err) {
          console.error('[SETTINGS HANDLER] Failed to write system_prompt.txt:', err);
        }
      }
      try {
        fs.writeFileSync(path.join(CONFIG_DIR, 'system_prompts.json'), JSON.stringify(config.systemPrompts, null, 2), 'utf-8');
      } catch (err) {
        console.error('[SETTINGS HANDLER] Failed to write system_prompts.json:', err);
      }
    }
    Object.assign(config, data.settings);
  }

  try {
    const configPath = path.join(CONFIG_DIR, 'config.json');
    let configJsonObj = [{}];
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      configJsonObj = Array.isArray(parsed) ? parsed : [parsed];
      if (configJsonObj.length === 0) configJsonObj = [{}];
    }
    const target = configJsonObj[0];

    if (data.settings.apiFallbacks !== undefined) target.apiFallbacks = data.settings.apiFallbacks;
    if (data.settings.bannedCommands !== undefined) target.bannedCommands = data.settings.bannedCommands;
    if (data.settings.modelTags !== undefined) target.modelTags = data.settings.modelTags;
    if (data.settings.lpmMode !== undefined) target.lpmMode = data.settings.lpmMode;
    if (data.settings.lpmOmMode !== undefined) target.lpmOmMode = data.settings.lpmOmMode;
    if (data.settings.lpmBatchSize !== undefined) target.lpmBatchSize = data.settings.lpmBatchSize;
    if (data.settings.forceTaskPlan !== undefined) target.forceTaskPlan = data.settings.forceTaskPlan;
    if (data.settings.simbaEnabled !== undefined) target.simbaEnabled = data.settings.simbaEnabled;
    if (data.settings.sgmMode !== undefined) target.sgmMode = data.settings.sgmMode;
    if (data.settings.esYabanciMode !== undefined) target.esYabanciMode = data.settings.esYabanciMode;
    if (data.settings.hpmMode !== undefined) target.hpmMode = data.settings.hpmMode;
    if (data.settings.modelSwitchingEnabled !== undefined) target.modelSwitchingEnabled = data.settings.modelSwitchingEnabled;
    if (data.settings.toolModelConfig !== undefined) target.toolModelConfig = data.settings.toolModelConfig;
    if (data.settings.modelLadder !== undefined) target.modelLadder = data.settings.modelLadder;
    if (data.settings.modelModeProfiles !== undefined) target.modelModeProfiles = data.settings.modelModeProfiles;
    fs.writeFileSync(configPath, JSON.stringify(configJsonObj, null, 2), 'utf-8');
  } catch (e) {
    console.error('[SETTINGS HANDLER] Failed to persist settings to config.json:', e);
  }

  ws.send(JSON.stringify({ type: 'settings', settings: config }));
  broadcastTerminal(`> [SETTINGS] Config settings updated and persisted.\n  `);
}

/**
 * Handles saving administrative data (env, security rules, kurucu, permissions, configJson)
 */
async function handleSaveAdminData(data, ws, onFounderKeyUpdated, broadcastDiscordState) {
  try {
    if (data.env) {
      writeEnv(data.env);
      if (data.env.DISCORD_TOKEN) process.env.DISCORD_TOKEN = data.env.DISCORD_TOKEN;
      if (data.env.PORT) process.env.PORT = data.env.PORT;
      if (data.env.FOUNDER_DISCORD_ID) process.env.FOUNDER_DISCORD_ID = data.env.FOUNDER_DISCORD_ID;
      if (data.env.FOUNDER_KEY) {
        process.env.FOUNDER_KEY = data.env.FOUNDER_KEY;
        if (typeof onFounderKeyUpdated === 'function') {
          onFounderKeyUpdated(data.env.FOUNDER_KEY);
        }
      }
    }
    const writes = [];
    if (data.securityRules) writes.push(fs.promises.writeFile(path.join(CONFIG_DIR, 'security_rules.json'), JSON.stringify(data.securityRules, null, 2), 'utf-8'));
    if (data.kurucu)       writes.push(fs.promises.writeFile(path.join(CONFIG_DIR, 'kurucu.json'), JSON.stringify(data.kurucu, null, 2), 'utf-8'));
    if (data.permissions)  writes.push(fs.promises.writeFile(path.join(CONFIG_DIR, 'permissions.json'), JSON.stringify(data.permissions, null, 2), 'utf-8'));
    if (data.configJson) {
      const configPath = path.join(CONFIG_DIR, 'config.json');
      let existingConf = [{}];
      try {
        if (fs.existsSync(configPath)) {
          const raw = fs.readFileSync(configPath, 'utf-8');
          const parsed = JSON.parse(raw);
          existingConf = Array.isArray(parsed) ? parsed : [parsed];
          if (existingConf.length === 0) existingConf = [{}];
        }
      } catch (e) {}
      const incomingObj = Array.isArray(data.configJson) ? (data.configJson[0] || {}) : data.configJson;
      const mergedObj = [{ ...existingConf[0], ...incomingObj }];
      writes.push(fs.promises.writeFile(configPath, JSON.stringify(mergedObj, null, 2), 'utf-8'));
    }
    
    await Promise.all(writes);
    broadcastTerminal(`> [ADMIN] Ayarlar başarıyla güncellendi.\n  `);
    await sendAdminData(ws);
    if (typeof broadcastDiscordState === 'function') {
      broadcastDiscordState();
    }
  } catch (err) {
    console.error('[SETTINGS HANDLER] Failed to save admin data:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Ayarlar kaydedilirken hata oluştu: ' + err.message }));
  }
}

/**
 * Clears memory.json history and refreshes admin data
 */
async function handleClearMemories(ws) {
  try {
    const memoryPath = path.join(CONFIG_DIR, 'memory.json');
    await fs.promises.writeFile(memoryPath, JSON.stringify({ memories: [], pendingRules: [] }, null, 2), 'utf-8');
    broadcastTerminal(`> [ADMIN] Hafıza geçmişi temizlendi.\n  `);
    await sendAdminData(ws);
  } catch (err) {
    console.error('[SETTINGS HANDLER] Failed to clear memories:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Hafıza temizlenirken hata oluştu: ' + err.message }));
  }
}

/**
 * Approves a pending rule and promotes it to active memory
 */
async function handleApprovePendingRule(data, ws) {
  try {
    if (!data.ruleId) return;
    const res = await approvePendingRule(data.ruleId);
    if (!res) {
      broadcastTerminal(`> [ADMIN] Kural işlemi atlandı: Bu güvenlik kuralı daha önce zaten onaylanmış veya silinmiş.\n`);
    } else {
      broadcastTerminal(`> [ADMIN] Güvenlik kuralı onaylandı ve aktif hafızaya eklendi.\n`);
    }
    await sendAdminData(ws);
  } catch (err) {
    console.error('[SETTINGS HANDLER] Failed to approve pending rule:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Kural onaylanırken hata oluştu: ' + err.message }));
  }
}

/**
 * Rejects a pending rule and removes it
 */
async function handleRejectPendingRule(data, ws) {
  try {
    if (!data.ruleId) return;
    const res = await rejectPendingRule(data.ruleId);
    if (!res) {
      broadcastTerminal(`> [ADMIN] Kural işlemi atlandı: Bu güvenlik kuralı daha önce zaten silinmiş veya onaylanmış.\n`);
    } else {
      broadcastTerminal(`> [ADMIN] Güvenlik kuralı reddedildi ve silindi.\n`);
    }
    await sendAdminData(ws);
  } catch (err) {
    console.error('[SETTINGS HANDLER] Failed to reject pending rule:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Kural silinirken hata oluştu: ' + err.message }));
  }
}

module.exports = {
  sendAdminData,
  handleUpdateSettings,
  handleSaveAdminData,
  handleClearMemories,
  handleApprovePendingRule,
  handleRejectPendingRule,
  readJsonSafe
};
