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
      readJsonSafe(memoryPath, []).then(r => Array.isArray(r) ? r : []),
      readJsonSafe(configPath, []).then(r => Array.isArray(r) ? r : [])
    ]);

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
      memory: memoryObj,
      configJson: configJsonObj
    }));
  } catch (e) {
    console.error('[SETTINGS HANDLER] Failed to send admin data:', e);
  }
}

/**
 * Updates in-memory runtime config and persists changed keys to config.json
 */
function handleUpdateSettings(data, ws) {
  if (data.settings && data.settings.bannedCommands !== undefined) {
    delete data.settings.bannedCommands;
  }
  Object.assign(config, data.settings);

  try {
    const configPath = path.join(CONFIG_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      let configJsonObj = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (Array.isArray(configJsonObj) && configJsonObj.length > 0) {
        if (data.settings.apiFallbacks !== undefined) configJsonObj[0].apiFallbacks = data.settings.apiFallbacks;
        if (data.settings.lpmMode !== undefined) configJsonObj[0].lpmMode = data.settings.lpmMode;
        if (data.settings.lpmOmMode !== undefined) configJsonObj[0].lpmOmMode = data.settings.lpmOmMode;
        if (data.settings.lpmBatchSize !== undefined) configJsonObj[0].lpmBatchSize = data.settings.lpmBatchSize;
        if (data.settings.forceTaskPlan !== undefined) configJsonObj[0].forceTaskPlan = data.settings.forceTaskPlan;
        if (data.settings.simbaEnabled !== undefined) configJsonObj[0].simbaEnabled = data.settings.simbaEnabled;
        if (data.settings.sgmMode !== undefined) configJsonObj[0].sgmMode = data.settings.sgmMode;
        if (data.settings.esYabanciMode !== undefined) configJsonObj[0].esYabanciMode = data.settings.esYabanciMode;
        fs.writeFileSync(configPath, JSON.stringify(configJsonObj, null, 2), 'utf-8');
      }
    }
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
    if (data.configJson)   writes.push(fs.promises.writeFile(path.join(CONFIG_DIR, 'config.json'), JSON.stringify(data.configJson, null, 2), 'utf-8'));
    
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
    await fs.promises.writeFile(memoryPath, '[]', 'utf-8');
    broadcastTerminal(`> [ADMIN] Hafıza geçmişi temizlendi.\n  `);
    await sendAdminData(ws);
  } catch (err) {
    console.error('[SETTINGS HANDLER] Failed to clear memories:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Hafıza temizlenirken hata oluştu: ' + err.message }));
  }
}

module.exports = {
  sendAdminData,
  handleUpdateSettings,
  handleSaveAdminData,
  handleClearMemories,
  readJsonSafe
};
