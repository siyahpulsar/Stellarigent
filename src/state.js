const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

let wss = null;

const agentState = {
  status: 'idle', // idle, thinking, pending_approval, executing, completed, failed, manual_bridge
  cwd: process.cwd(),
  task: null,
  messages: [], // Chat history: { role, content, id, agentRole }
  pendingAction: null,
  activeCommandProcess: null,
  planSteps: [], // Decomposed checklist steps: { text, status }
  activeGuideName: null,
  activeGuideContent: null,
  selectedGuides: [],
  executedTools: [],
  thoughts: [],
  lastToolOutput: '',
  manualBridgePrompt: null, // When status = 'manual_bridge', holds the full prompt payload for external AI
  activeMode: 'manuel',
  activeSubMode: 'none',
  ideInterrupted: null
};

let canAnalyzeImages = null; // null: unchecked, true: vision enabled, false: vision disabled

const createdFoldersPath = path.join(__dirname, '..', 'config', 'created_folders.json');
const createdFolders = new Set(); // Stores absolute lowercase paths of folders created by the bot
try {
  if (fs.existsSync(createdFoldersPath)) {
    const data = JSON.parse(fs.readFileSync(createdFoldersPath, 'utf-8'));
    if (Array.isArray(data)) {
      data.forEach(p => createdFolders.add(p));
    }
  }
} catch (e) {
  console.error('Failed to load created_folders.json:', e);
}

function saveCreatedFolders() {
  try {
    fs.writeFileSync(createdFoldersPath, JSON.stringify(Array.from(createdFolders), null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save created_folders.json:', e);
  }
}

let config = {
  lmStudioUrl: 'http://127.0.0.1:1234/v1',
  modelName: 'qwen2.5-coder-7b-instruct', // fallback/default
  temperature: 0.2,
  maxSteps: 60,
  maxContextMessages: 40,
  advancedReasoningMode: false,
  forceTaskPlan: false,
  sgmMode: true,
  esYabanciMode: true,
  autoApprove: {
    read_file: true,
    write_file: true,
    list_directory: true,
    web_search: false,
    view_website: false,
    open_application: false,
    send_discord_message: true,
    line_checker: true,
    url_image_reader: false,
    library_mode: true
  },
  systemPrompt: '', // Will be loaded from config/system_prompt.txt
  bannedCommands: [
    'rmdir /s', 'rmdir\\s', 'del /s', 'del\\s', 'rd /s', 'rd\\s',
    'format', 'shutdown', 'restart-computer', 'stop-process',
    'stop-service', 'rm -rf', 'rm -r', 'mkfs', 'dd ',
    'net user', 'net localgroup', 'reg delete', 'set-executionpolicy',
    'attrib -r', 'attrib -h', 'cipher'
  ],
  simbaEnabled: false,
  memoryLimit: 1000,
  apiFallbacks: {
    openai: '',
    anthropic: '',
    gemini: '',
    groq: '',
    priority: ['openai', 'anthropic', 'gemini', 'groq']
  }
};

try {
  const configPath = path.join(__dirname, '..', 'config', 'config.json');
  if (fs.existsSync(configPath)) {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const conf = Array.isArray(data) ? data[0] : data;
      if (conf) {
        if (conf.forceTaskPlan !== undefined) config.forceTaskPlan = conf.forceTaskPlan;
        if (conf.simbaEnabled !== undefined) config.simbaEnabled = conf.simbaEnabled;
        if (conf.memoryLimit !== undefined) config.memoryLimit = conf.memoryLimit;
        if (conf.sgmMode !== undefined) config.sgmMode = conf.sgmMode;
        if (conf.esYabanciMode !== undefined) config.esYabanciMode = conf.esYabanciMode;
        if (conf.apiFallbacks !== undefined) Object.assign(config.apiFallbacks, conf.apiFallbacks);
        // Copy other existing values if needed, but since wsHandler merges via Object.assign, this is enough for startup
      }
  }
} catch (e) {
  console.error('Failed to load config.json:', e);
}

try {
  const promptPath = path.join(__dirname, '..', 'config', 'system_prompt.txt');
  if (fs.existsSync(promptPath)) {
    config.systemPrompt = fs.readFileSync(promptPath, 'utf-8');
  } else {
    config.systemPrompt = 'System prompt load failed. Check config/system_prompt.txt';
  }
} catch (e) {
  console.error('Failed to load system prompt:', e);
}

function initWss(wssInstance) {
  wss = wssInstance;
}

// Cache for guides list — avoids sync fs.readdirSync on every broadcastState call
let guidesCache = [];
let guidesCacheTime = 0;
const GUIDES_CACHE_TTL_MS = 5000; // Refresh at most every 5 seconds

// Async refresh — called in background without blocking
async function refreshGuidesCache() {
  const pathsToSearch = [
    path.join(agentState.cwd, 'Libraries', 'ObsiLibrary', 'ObsiLibrary'),
    path.join(agentState.cwd, 'Libraries', 'ObsiLibrary')
  ];
  const guides = [];
  for (const p of pathsToSearch) {
    try {
      const items = await fs.promises.readdir(p);
      items.forEach(item => {
        if (item.endsWith('.md')) {
          guides.push({ name: item, path: path.join(p, item) });
        }
      });
      if (guides.length > 0) break;
    } catch {
      // Directory not found or unreadable — try next
    }
  }
  guidesCache = guides;
  guidesCacheTime = Date.now();
}

// Trigger initial cache refresh (fire-and-forget at startup)
setImmediate(() => refreshGuidesCache().catch(() => {}));

// Returns cached guides synchronously; triggers background refresh if stale
function getAvailableGuides() {
  if (Date.now() - guidesCacheTime > GUIDES_CACHE_TTL_MS) {
    refreshGuidesCache().catch(() => {}); // background refresh, don't await
  }
  return guidesCache;
}

let broadcastTimeout = null;
let lastSentState = null;

function broadcastState() {
  if (!wss) return;
  if (broadcastTimeout) clearTimeout(broadcastTimeout);
  broadcastTimeout = setTimeout(() => {
    const currentState = {
      status: agentState.status,
      cwd: agentState.cwd,
      task: agentState.task,
      messages: agentState.messages,
      pendingAction: agentState.pendingAction,
      planSteps: agentState.planSteps,
      activeGuideName: agentState.activeGuideName,
      availableGuides: getAvailableGuides().map(g => g.name)
    };

    if (!lastSentState) {
      lastSentState = { ...currentState, messages: [...currentState.messages] };
      const stateUpdate = { type: 'state', ...currentState };
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(stateUpdate)); });
      return;
    }

    const patch = {};
    let hasChanges = false;
    for (const key of Object.keys(currentState)) {
      if (key === 'messages') {
        if (currentState.messages.length > lastSentState.messages.length) {
          patch.newMessages = currentState.messages.slice(lastSentState.messages.length);
          hasChanges = true;
        } else if (currentState.messages.length < lastSentState.messages.length) {
          patch.messages = currentState.messages;
          hasChanges = true;
        } else if (currentState.messages.length > 0) {
          const lastCurrent = currentState.messages[currentState.messages.length - 1];
          const lastOld = lastSentState.messages[lastSentState.messages.length - 1];
          if (JSON.stringify(lastCurrent) !== JSON.stringify(lastOld)) {
            patch.messages = currentState.messages;
            hasChanges = true;
          }
        }
      } else if (JSON.stringify(currentState[key]) !== JSON.stringify(lastSentState[key])) {
        patch[key] = currentState[key];
        hasChanges = true;
      }
    }

    if (hasChanges) {
      lastSentState = { ...currentState, messages: [...currentState.messages] };
      const patchUpdate = { type: 'state_patch', patch };
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(patchUpdate)); });
    }
  }, 150);
}

function broadcastTerminal(data) {
  if (!wss) return;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'terminal', data }));
    }
  });
}

function broadcastDeepResearchProgress(step, total, url, summarySnippet) {
  if (!wss) return;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'deep_research_progress',
        step,
        total,
        url,
        summarySnippet
      }));
    }
  });
}

function addMessage(role, content, agentRole = null, imagePath = null) {
  const msg = {
    id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    role,
    content,
    agentRole,
    imagePath
  };
  agentState.messages.push(msg);
  broadcastState();
  return msg;
}

function getLmStudioEndpoint(subpath = '/chat/completions') {
  let baseUrl = (config.lmStudioUrl || 'http://127.0.0.1:1234/v1').trim().replace(/\/+$/, '');
  if (!baseUrl.toLowerCase().endsWith('/v1')) {
    baseUrl += '/v1';
  }
  // Convert localhost -> 127.0.0.1 to avoid Windows Node 18+ IPv6 ECONNREFUSED ::1:1234
  baseUrl = baseUrl.replace(/:\/\/localhost/i, '://127.0.0.1');

  const cleanSubpath = subpath.startsWith('/') ? subpath : '/' + subpath;
  return `${baseUrl}${cleanSubpath}`;
}

module.exports = {
  agentState,
  config,
  getLmStudioEndpoint,
  getCanAnalyzeImages: () => canAnalyzeImages,
  setCanAnalyzeImages: (val) => { canAnalyzeImages = val; },
  createdFolders,
  saveCreatedFolders,
  initWss,
  broadcastState,
  broadcastTerminal,
  broadcastDeepResearchProgress,
  addMessage,
  getAvailableGuides,
  refreshGuidesCache
};
