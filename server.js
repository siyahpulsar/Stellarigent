require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const discordBot = require('./src/discord/index.js');
const { initWss, config } = require('./src/state');
const { loadSecurityRules } = require('./src/security');
const { checkVisionCapability } = require('./src/tools');
const {
  startDiscordAgentTask,
  getPendingAction,
  resolvePendingAction,
  handleDiscordAgentAction
} = require('./src/agent');
const setupWebSocketHandler = require('./src/ws/wsHandler');
const { log } = require('./src/logger');

const app = express();

app.use((req, res, next) => {
  log('HTTP_REQ', `${req.method} ${req.url} - IP: ${req.socket.remoteAddress}`);
  next();
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

initWss(wss);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/api/open-ide', (req, res) => {
  const clientIp = req.socket.remoteAddress;
  if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
    const child = spawn(/^win/.test(process.platform) ? 'npm.cmd' : 'npm', ['run', 'start:ide'], {
      detached: true,
      stdio: 'ignore',
      shell: true
    });
    child.unref();
    res.json({ success: true, message: 'IDE opened' });
  } else {
    res.status(403).json({ success: false, message: 'Forbidden: Localhost only' });
  }
});

app.post('/api/security/reset-tripwire', (req, res) => {
  const { resetTripwire } = require('./src/security');
  const result = resetTripwire();
  res.json(result);
});

// ── AMPR (Adaptive Model Performance Router) Endpoints ───────────────────────
app.get('/api/model-performance', (req, res) => {
  const performanceTracker = require('./src/llm/performanceTracker');
  const stats = performanceTracker.getPerformanceStats();
  res.json({ success: true, adaptiveRouting: config.adaptiveRouting !== false, stats });
});

app.post('/api/model-performance/reset', async (req, res) => {
  const performanceTracker = require('./src/llm/performanceTracker');
  await performanceTracker.resetPerformanceData();
  res.json({ success: true, message: 'Performans geçmişi başarıyla sıfırlandı' });
});

// ── System Health Check ──────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  const { getLmStudioEndpoint } = require('./src/state');
  const { exec: execCb } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(execCb);

  const checks = {};

  // 1. LM Studio Bağlantısı
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const lmRes = await fetch(getLmStudioEndpoint('/models'), { signal: ctrl.signal });
    clearTimeout(tid);
    if (lmRes.ok) {
      const lmData = await lmRes.json();
      const models = lmData.data || [];
      checks.lmStudio = { status: 'ok', loadedModels: models.map(m => m.id) };
    } else {
      checks.lmStudio = { status: 'error', detail: `HTTP ${lmRes.status}` };
    }
  } catch (e) {
    checks.lmStudio = { status: 'unreachable', detail: e.message };
  }

  // 2. Puppeteer Chrome Binary
  try {
    const puppeteer = require('puppeteer');
    const execPath = puppeteer.executablePath ? puppeteer.executablePath() : 'unknown';
    const exists = fs.existsSync(execPath);
    checks.puppeteer = { status: exists ? 'ok' : 'missing', executablePath: execPath };
  } catch (e) {
    checks.puppeteer = { status: 'error', detail: e.message };
  }

  // 3. FFmpeg
  try {
    await execAsync('ffmpeg -version');
    checks.ffmpeg = { status: 'ok' };
  } catch (e) {
    checks.ffmpeg = { status: 'missing', detail: 'ffmpeg not found in PATH' };
  }

  // 4. config.json Okunabilirliği
  try {
    const configPath = path.join(__dirname, 'config', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const conf = Array.isArray(parsed) ? parsed[0] : parsed;
    checks.configJson = { status: 'ok', hasFounderKey: !!(conf && conf.founderKey) };
  } catch (e) {
    checks.configJson = { status: 'error', detail: e.message };
  }

  // 5. Library Klasörü
  const libraryPath = path.join(__dirname, 'library');
  checks.libraryDir = { status: fs.existsSync(libraryPath) ? 'ok' : 'missing', path: libraryPath };

  // 6. MemoryLibrary Klasörü
  const memLibPath = path.join(__dirname, 'Libraries', 'MemoryLibrary');
  checks.memoryLibrary = { status: fs.existsSync(memLibPath) ? 'ok' : 'missing', path: memLibPath };

  const allOk = Object.values(checks).every(c => c.status === 'ok');
  return res.status(allOk ? 200 : 207).json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks
  });
});


app.get('/api/system-prompts', (req, res) => {
  try {
    return res.json({
      systemPrompt: config.systemPrompt || '',
      systemPrompts: config.systemPrompts || {}
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


app.post('/api/system-prompts', (req, res) => {
  try {
    const { systemPrompts } = req.body || {};
    if (systemPrompts && typeof systemPrompts === 'object') {
      Object.assign(config.systemPrompts, systemPrompts);
      if (systemPrompts.main_prompt) {
        config.systemPrompt = systemPrompts.main_prompt;
        try {
          fs.writeFileSync(path.join(__dirname, 'config', 'system_prompt.txt'), config.systemPrompt, 'utf-8');
        } catch (err) {}
      }
      try {
        fs.writeFileSync(path.join(__dirname, 'config', 'system_prompts.json'), JSON.stringify(config.systemPrompts, null, 2), 'utf-8');
      } catch (err) {}
      return res.json({ success: true, systemPrompts: config.systemPrompts });
    }
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/model-tags', (req, res) => {
  try {
    return res.json({
      success: true,
      modelTags: config.modelTags || {}
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/model-tags', (req, res) => {
  try {
    const { modelTags } = req.body || {};
    if (modelTags && typeof modelTags === 'object') {
      config.modelTags = { ...modelTags };
      const configPath = path.join(__dirname, 'config', 'config.json');
      let configJsonObj = [{}];
      try {
        if (fs.existsSync(configPath)) {
          const raw = fs.readFileSync(configPath, 'utf-8');
          const parsed = JSON.parse(raw);
          configJsonObj = Array.isArray(parsed) ? parsed : [parsed];
          if (configJsonObj.length === 0) configJsonObj = [{}];
        }
      } catch (e) {}
      configJsonObj[0].modelTags = config.modelTags;
      try {
        fs.writeFileSync(configPath, JSON.stringify(configJsonObj, null, 2), 'utf-8');
      } catch (err) {
        console.error('[API] Failed to write modelTags to config.json:', err);
      }

      if (typeof wss !== 'undefined' && wss && wss.clients) {
        const payload = JSON.stringify({ type: 'settings', settings: config });
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        });
      }

      return res.json({ success: true, modelTags: config.modelTags });
    }
    return res.status(400).json({ success: false, message: 'Invalid modelTags payload' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Tool-Model Routing Config ────────────────────────────────────────────────

app.get('/api/tool-model-config', (req, res) => {
  try {
    return res.json({
      success: true,
      toolModelConfig: config.toolModelConfig || {},
      modelSwitchingEnabled: config.modelSwitchingEnabled || false,
      adaptiveRouting: config.adaptiveRouting !== false,
      modelLadder: config.modelLadder || [],
      modelModeProfiles: config.modelModeProfiles || {}
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/tool-model-config', (req, res) => {
  try {
    const { toolModelConfig, modelSwitchingEnabled, adaptiveRouting, modelLadder, modelModeProfiles } = req.body || {};
    let changed = false;

    if (toolModelConfig && typeof toolModelConfig === 'object') {
      config.toolModelConfig = { ...config.toolModelConfig, ...toolModelConfig };
      changed = true;
    }
    if (modelSwitchingEnabled !== undefined) {
      config.modelSwitchingEnabled = !!modelSwitchingEnabled;
      changed = true;
    }
    if (adaptiveRouting !== undefined) {
      config.adaptiveRouting = !!adaptiveRouting;
      changed = true;
    }
    if (modelLadder && Array.isArray(modelLadder)) {
      config.modelLadder = [...modelLadder];
      changed = true;
    }
    if (modelModeProfiles && typeof modelModeProfiles === 'object') {
      config.modelModeProfiles = { ...config.modelModeProfiles, ...modelModeProfiles };
      changed = true;
    }

    if (changed) {
      // Persist to config.json
      const configPath = path.join(__dirname, 'config', 'config.json');
      try {
        let configData = [{}];
        if (fs.existsSync(configPath)) {
          const raw = fs.readFileSync(configPath, 'utf-8');
          const parsed = JSON.parse(raw);
          configData = Array.isArray(parsed) ? parsed : [parsed];
          if (configData.length === 0) configData = [{}];
        }
        configData[0].toolModelConfig = config.toolModelConfig;
        configData[0].modelSwitchingEnabled = config.modelSwitchingEnabled;
        configData[0].adaptiveRouting = config.adaptiveRouting;
        configData[0].modelLadder = config.modelLadder;
        configData[0].modelModeProfiles = config.modelModeProfiles;
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
      } catch (writeErr) {
        console.error('[API] Failed to write toolModelConfig to config.json:', writeErr);
      }

      // Broadcast updated settings to all WebSocket clients
      if (wss && wss.clients) {
        const payload = JSON.stringify({ type: 'settings', settings: config });
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        });
      }
    }

    return res.json({
      success: true,
      toolModelConfig: config.toolModelConfig,
      modelSwitchingEnabled: config.modelSwitchingEnabled,
      modelLadder: config.modelLadder,
      modelModeProfiles: config.modelModeProfiles
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── LM Studio Model Proxy ────────────────────────────────────────────────────

app.get('/api/lm-studio/models', async (req, res) => {
  try {
    const { getLmStudioEndpoint } = require('./src/state');
    const endpoint = getLmStudioEndpoint('/models');
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    const lmRes = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(tid);
    if (!lmRes.ok) {
      return res.status(502).json({ success: false, message: `LM Studio returned HTTP ${lmRes.status}` });
    }
    const data = await lmRes.json();
    return res.json({ success: true, models: data.data || [] });
  } catch (err) {
    return res.status(503).json({ success: false, message: `LM Studio unreachable: ${err.message}` });
  }
});

app.post('/api/lm-studio/switch', async (req, res) => {
  try {
    const { modelId } = req.body || {};
    if (!modelId || typeof modelId !== 'string') {
      return res.status(400).json({ success: false, message: 'modelId gerekli' });
    }
    const modelManager = require('./src/llm/modelManager');
    const success = await modelManager.switchToModel(modelId.trim());
    return res.json({ success, message: success ? `Model switched to: ${modelId}` : 'Model switch failed or timed out' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/setup/status', (req, res) => {
  const setupPath = path.join(__dirname, 'config', 'setup.json');
  try {
    if (fs.existsSync(setupPath)) {
      const data = JSON.parse(fs.readFileSync(setupPath, 'utf-8'));
      return res.json({ isSetupCompleted: !!data.isSetupCompleted, completedAt: data.completedAt || null });
    }
    return res.json({ isSetupCompleted: false });
  } catch (e) {
    return res.json({ isSetupCompleted: false });
  }
});

app.post('/api/setup/reset', (req, res) => {
  try {
    const setupPath = path.join(__dirname, 'config', 'setup.json');
    fs.writeFileSync(setupPath, JSON.stringify({ isSetupCompleted: false }, null, 2), 'utf-8');
    return res.json({ success: true, message: 'Setup sıfırlandı' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/setup/complete', (req, res) => {
  try {
    const { founderKey: newFounderKey, discordToken, founderDiscordId } = req.body || {};
    if (!newFounderKey || typeof newFounderKey !== 'string' || !newFounderKey.trim()) {
      return res.status(400).json({ success: false, message: 'Founder Password (Yönetici şifresi) zorunludur.' });
    }

    const trimmedKey = newFounderKey.trim();
    const trimmedToken = (discordToken || '').trim();
    const trimmedFounderId = (founderDiscordId || '').trim();

    // 1. Update .env
    const { readEnv, writeEnv } = require('./src/utils/envManager');
    const envObj = readEnv();
    envObj.FOUNDER_KEY = trimmedKey;
    if (trimmedToken) envObj.DISCORD_TOKEN = trimmedToken;
    if (trimmedFounderId) envObj.FOUNDER_DISCORD_ID = trimmedFounderId;
    writeEnv(envObj);

    process.env.FOUNDER_KEY = trimmedKey;
    if (trimmedToken) process.env.DISCORD_TOKEN = trimmedToken;
    if (trimmedFounderId) process.env.FOUNDER_DISCORD_ID = trimmedFounderId;
    founderKey = trimmedKey;

    // 2. Update config.json
    const configPath = path.join(__dirname, 'config', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        let confData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (Array.isArray(confData) && confData.length > 0) {
          confData[0].founderKey = trimmedKey;
          fs.writeFileSync(configPath, JSON.stringify(confData, null, 2), 'utf-8');
        }
      } catch (err) {
        console.error('Error updating config.json in setup:', err);
      }
    }

    // 3. Update kurucu.json if founder ID provided
    if (trimmedFounderId) {
      const kurucuPath = path.join(__dirname, 'config', 'kurucu.json');
      try {
        fs.writeFileSync(kurucuPath, JSON.stringify({ founder: trimmedFounderId }, null, 2), 'utf-8');
      } catch (err) {
        console.error('Error updating kurucu.json in setup:', err);
      }
    }

    // 4. Save config/setup.json
    const setupPath = path.join(__dirname, 'config', 'setup.json');
    fs.writeFileSync(setupPath, JSON.stringify({
      isSetupCompleted: true,
      completedAt: new Date().toISOString()
    }, null, 2), 'utf-8');

    // 5. Initialize discord bot if token provided
    if (trimmedToken) {
      try {
        discordBot.initDiscordBot(broadcastDiscordState, {
          startDiscordAgentTask,
          getPendingAction,
          resolvePendingAction
        });
      } catch (e) {
        console.error('Error initializing discord bot in setup:', e);
      }
    }

    log('SYSTEM', `Setup completed successfully. Founder key set.`);
    return res.json({ success: true, message: 'Setup başarıyla tamamlandı.' });
  } catch (err) {
    console.error('Setup complete error:', err);
    return res.status(500).json({ success: false, message: 'Sunucu hatası: ' + err.message });
  }
});

loadSecurityRules();

let founderKey = process.env.FOUNDER_KEY || "";
function loadFounderKey() {
  try {
    const configPath = path.join(__dirname, 'config', 'config.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const conf = Array.isArray(data) ? data[0] : data;
      if (conf && conf.founderKey) founderKey = conf.founderKey;
    }
  } catch (e) {
    console.error("Failed to load founderKey:", e);
  }
}
loadFounderKey();

function broadcastDiscordState() {
  const stateUpdate = { type: 'discord_state', ...discordBot.getDiscordState() };
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(stateUpdate));
    }
  });
}

function scanSandbox(dir, basePath = '') {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const relPath = path.join(basePath, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(scanSandbox(fullPath, relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

function broadcastSandboxState() {
  const containerPath = path.join(__dirname, '.container');
  const files = scanSandbox(containerPath);
  const stateUpdate = { type: 'sandbox_state', files };
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(stateUpdate));
  });
}

// System Metrics Broadcaster — CPU uses delta between snapshots for accuracy
let prevCpuMeasure = null;

setInterval(() => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsagePercent = ((usedMem / totalMem) * 100).toFixed(1);

  // Delta-based CPU calculation (accurate, not cumulative average since boot)
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  const currMeasure = { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
  let cpuUsagePercent = '0.0';
  if (prevCpuMeasure) {
    const idleDiff  = currMeasure.idle  - prevCpuMeasure.idle;
    const totalDiff = currMeasure.total - prevCpuMeasure.total;
    if (totalDiff > 0) {
      cpuUsagePercent = (100 - (100 * idleDiff / totalDiff)).toFixed(1);
    }
  }
  prevCpuMeasure = currMeasure;

  const metricsUpdate = {
    type: 'system_metrics',
    cpu: cpuUsagePercent,
    ram: memoryUsagePercent,
    ramUsedMB: (usedMem / 1024 / 1024).toFixed(0),
    ramTotalMB: (totalMem / 1024 / 1024).toFixed(0)
  };

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(metricsUpdate));
  });
}, 3000);

// File Watcher for Sandbox State (Replaces polling)
const containerPath = path.join(__dirname, '.container');
if (!fs.existsSync(containerPath)) fs.mkdirSync(containerPath, { recursive: true });

let sandboxWatchTimeout;
fs.watch(containerPath, { recursive: true }, () => {
  clearTimeout(sandboxWatchTimeout);
  sandboxWatchTimeout = setTimeout(broadcastSandboxState, 150);
});

// Initial broadcast
setTimeout(broadcastSandboxState, 1000);


// Setup WebSocket Message Handlers
setupWebSocketHandler(wss, founderKey, discordBot, resolvePendingAction, broadcastDiscordState, broadcastSandboxState);

server.listen(PORT, async () => {
  console.log(`Server started on http://localhost:${PORT}`);
  log('SYSTEM', `Server started on http://localhost:${PORT}`);

  // Initialize Interactive Terminal CLI Controller
  if (process.env.CLI !== 'false') {
    const { initTerminalController } = require('./src/cli/terminalController');
    initTerminalController();
  }

  // Başlangıçta LM Studio'da model hazır olduğundan emin ol
  try {
    const modelManager = require('./src/llm/modelManager');
    await modelManager.ensureModelLoaded();
  } catch (mErr) {
    console.warn('[MODEL MANAGER] Başlangıç model kontrolü uyarısı:', mErr.message);
  }

  checkVisionCapability();
  discordBot.initDiscordBot(broadcastDiscordState, {
    startDiscordAgentTask,
    getPendingAction,
    resolvePendingAction
  });
});

module.exports = {
  getAgentConfig: () => config,
  handleDiscordAgentAction,
  startDiscordAgentTask,
  getPendingAction,
  resolvePendingAction
};
