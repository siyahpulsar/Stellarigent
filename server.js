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

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  log('SYSTEM', `Server started on http://localhost:${PORT}`);
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
