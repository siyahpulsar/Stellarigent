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
  ideInterrupted: null,
  hasReadAgentUserJson: false, // Tripwire safety circuit breaker flag
  tripwireArmedTaskId: null,  // Scoped task ID for tripwire circuit breaker
  transientErrors: [], // In-memory deduplicated runtime error buffer for current task
  taskSteps: [],        // Live step-by-step tool execution trace for the current task
  metrics: {
    cost: {
      totalCostUSD: 0.0,
      dailyCostUSD: 0.0,
      dailyLimitUSD: 1.00,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      cloudRequestCount: 0,
      localRequestCount: 0
    }
  }
};

// --- FUZZY ERROR SIGNATURE & TRANSIENT ERROR BUFFER ---
function generateErrorSignature(errorInput) {
  if (!errorInput) return 'UNKNOWN_ERROR';
  let str = typeof errorInput === 'object' ? (errorInput.message || errorInput.error || JSON.stringify(errorInput)) : String(errorInput);

  return str
    .replace(/\d{4}[-/.]\d{2}[-/.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/gi, '<TIMESTAMP>')
    .replace(/:\d{4,5}\b/g, ':<PORT>')
    .replace(/0x[0-9a-fA-F]+/g, '<HEX>')
    .replace(/\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/gi, '<UUID>')
    .replace(/\b[0-9a-fA-F]{16,64}\b/gi, '<HASH>')
    .replace(/[A-Za-z]:\\[^:\s"'`]+/g, '<FILE_PATH>') // Windows paths
    .replace(/\/[^:\s"'`]+/g, '<FILE_PATH>') // Unix paths
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

const MAX_TRANSIENT_ERRORS = 10;

function addTransientError(errorInput) {
  if (!agentState.transientErrors) agentState.transientErrors = [];
  const signature = generateErrorSignature(errorInput);
  const rawError = typeof errorInput === 'object' ? (errorInput.message || JSON.stringify(errorInput)) : String(errorInput);

  const existing = agentState.transientErrors.find(e => e.signature === signature);
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.lastSeen = Date.now();
    return existing;
  }

  const newEntry = {
    signature,
    rawError: rawError.substring(0, 300),
    occurrences: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now()
  };

  agentState.transientErrors.push(newEntry);

  // Evict if exceeds limit: drop lowest occurrences, tie-break oldest firstSeen
  if (agentState.transientErrors.length > MAX_TRANSIENT_ERRORS) {
    agentState.transientErrors.sort((a, b) => {
      if (a.occurrences !== b.occurrences) return a.occurrences - b.occurrences;
      return a.firstSeen - b.firstSeen;
    });
    agentState.transientErrors.shift();
  }

  return newEntry;
}

function clearTransientErrors() {
  agentState.transientErrors = [];
}

// Automatically creates scratch, By_Agent folders and agent_user.json if not present
function ensureWorkspaceFoldersAndFiles() {
  try {
    const scratchPath = path.join(agentState.cwd, 'scratch');
    if (!fs.existsSync(scratchPath)) {
      fs.mkdirSync(scratchPath, { recursive: true });
    }
    const byAgentPath = path.join(agentState.cwd, 'By_Agent');
    if (!fs.existsSync(byAgentPath)) {
      fs.mkdirSync(byAgentPath, { recursive: true });
    }
    const agentUserJsonPath = path.join(agentState.cwd, 'agent_user.json');
    if (!fs.existsSync(agentUserJsonPath)) {
      const initialAgentUserData = {
        ai_modelleri: ["a123", "cf2", "edg3"],
        agent_nihai_amaci: "Kullanıcının talimatlarını güvenli, etik ve belirlenen yetki sınırları içerisinde kalarak yerine getirmek.",
        user_hakkinda: "Projenin yöneticisi ve kurucusu."
      };
      fs.writeFileSync(agentUserJsonPath, JSON.stringify(initialAgentUserData, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to ensure workspace folders and files:', err);
  }
}
ensureWorkspaceFoldersAndFiles();

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
  hpmMode: false,          // High Parameter Mode — consolidates all LLM calls into one for 30B+ models
  forceTaskPlan: false,
  lpmMode: false,
  lpmOmMode: false,
  lpmBatchSize: 1,
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
  memoryLimit: 50,
  maxDailyCostUSD: 1.00,
  apiFallbacks: {
    openai: '',
    anthropic: '',
    gemini: '',
    groq: '',
    priority: ['openai', 'anthropic', 'gemini', 'groq']
  },
  modelTags: {
    'qwen2.5-3b-instruct': ['hizli'],
    'qwen2.5-coder-7b-instruct': ['hizli', 'orta'],
    'qwen2.5-14b-instruct': ['orta', 'yuklu'],
    'qwen2.5-coder-32b-instruct': ['yuklu'],
    'gpt-oss-120b': ['yuklu']
  },
  // ── Model Yönlendirme ──────────────────────────────────────────────────
  modelSwitchingEnabled: false, // LM Studio otomatik model değiştirme
  toolModelConfig: {
    // Her tool için { tag: '...', fallbackTag: '...' }
    // tag: 'hizli' | 'orta' | 'yuklu'
    library_mode:        { tag: 'hizli',  fallbackTag: 'orta'  },
    web_search:          { tag: 'orta',   fallbackTag: 'hizli' },
    view_website:        { tag: 'orta',   fallbackTag: 'hizli' },
    deep_web_search:     { tag: 'orta',   fallbackTag: 'yuklu' },
    execute_command:     { tag: 'orta',   fallbackTag: 'yuklu' },
    write_file:          { tag: 'orta',   fallbackTag: 'yuklu' },
    read_file:           { tag: 'hizli',  fallbackTag: 'orta'  },
    list_directory:      { tag: 'hizli',  fallbackTag: 'orta'  },
    url_image_reader:    { tag: 'yuklu',  fallbackTag: 'orta'  },
    extract_chart_data:  { tag: 'yuklu',  fallbackTag: 'orta'  },
    take_screenshot:     { tag: 'hizli',  fallbackTag: 'orta'  },
    __default__:         { tag: 'orta',   fallbackTag: 'hizli' }
  },
  // ── Model Yedeklilik Merdiveni (Fallback Priority Ladder) ───────────────
  modelLadder: [
    'qwen2.5-3b-instruct',
    'qwen2.5-coder-7b-instruct',
    'qwen2.5-14b-instruct',
    'qwen2.5-coder-32b-instruct'
  ],
  // ── Model Bazlı Otomatik Mod Eşleme (Auto-Modes) ────────────────────────
  modelModeProfiles: {
    'qwen2.5-3b-instruct': {
      lpmMode: true,
      lpmOmMode: true,
      hpmMode: false,
      advancedReasoningMode: false,
      forceTaskPlan: false,
      simbaEnabled: false
    }
  },
  // ──────────────────────────────────────────────────────────────────────
  systemPrompts: {
    main_prompt: '',
    ide_planner: `Sen uzman bir yazılım mimarısın. 
Kullanıcının senden istediği görevi yerine getirmek için yapılması gerekenleri "adım adım" DÜZ METİN (plain text) halinde yaz.
KESİNLİKLE JSON KULLANMA. KESİNLİKLE KOD YAZMA. SADECE METİN ÇIKTISI VER.

Örnek Format:
İlk önce "index.html" dosyasını oluşturacağım.
Sonra "style.css" dosyasını oluşturacağım.
Daha sonra "app.js" dosyasını yazacağım ve HTML dosyasında bunları bağlayacağım.
En sonunda sunucuyu başlatıp test edeceğim.`,
    ide_checker: `Sen bir QA Kontrol (Checker) Ajanısın.
Görevin, Geliştirici ajanın (Developer) bir adımı veya aracı başarılı bir şekilde tamamlayıp tamamlamadığını kontrol etmektir.
Sana şu bilgiler verilecek:
1. Kullanıcının asıl isteği (Tüm proje hedefi)
2. Tüm görev listesi
3. Geliştirici ajanın şu anda çözmeye çalıştığı spesifik görev
4. Geliştiricinin çalıştırdığı aracın çıktısı VEYA aracı çağırmadan yaptığı doğrudan düz metin açıklaması

Görevi başarıyla tamamlayıp tamamlamadığını analiz et.
SADECE GEÇERLİ BİR JSON FORMATINDA ÇIKTI VER.
Eğer araç çıktısı VEYA Geliştiricinin metin açıklaması görevin başarıyla tamamlandığını gösteriyorsa:
{"status": "completed"}

ÖNEMLİ: Geliştirici eğer görevi zaten elindeki verilerle (düz metin bir cevap vererek) tamamlayabiliyorsa, onu sırf "araç (tool) çalıştırmadı" diye REDDETME. Eğer açıklama mantıklı ve yeterliyse görevi BAŞARILI say (completed).

Eğer araç çıktısı veya açıklama yetersiz, hatalı veya eksikse:
{"status": "failed", "feedback": "Geliştiriciye neden başarısız olduğunu ve ne yapması gerektiğini anlatan net bir mesaj."}`,
    swarm_planner: `[Swarm Role: Planner Agent]\nYour only job right now is to plan and decompose the task into 3-7 logical steps. You MUST call the 'task_plan' tool with these steps. Do not perform other actions yet.`,
    swarm_developer: `[Swarm Role: Developer Agent]\nYou are the Developer Agent. Your job is to implement the plan step-by-step. Focus on the current pending steps. Call appropriate tools to complete the steps.`,
    swarm_qa_tester: `[Swarm Role: QA Tester Agent]\nThe previous developer execution encountered a failure. Analyze the error logs and files, and write instructions to fix the error. Explain the problem clearly, then proceed with the corrected development steps.`,
    qa_analysis: `You are a strict QA and debugging AI. Your task is to analyze why the previous AI agent failed and was rejected by the user. Give actionable technical feedback to help the next agent succeed.`,
    web_research_safety: `[STRICT WARNING: In Web Research mode, using 'execute_command', 'write_file', or any system tool is ABSOLUTELY FORBIDDEN. ONLY use 'web_search' to search and 'view_website' to read pages. Do NOT use curl, wget, or any shell command to access the internet.]`,
    finance_mode: `[FINANCE TOOL MODE ACTIVATED]\nSen bir Finansal Analiz ve Tahmin Yapay Zekasısın (Finance AI). Verilen sembol, hisse veya kripto verilerini derinlemesine analiz et.`,
    task_plan_converter: `Sen bir görev planlayıcısın (Task Planner). Aşağıdaki metin planını kullanarak ZORUNLU olarak 'task_plan' aracını çağırıp, bu metindeki adımları JSON formatında bir görev listesine (checklist) çevirmelisin. Sadece task_plan aracını kullan.`,
    om_ideal_tool: `You are a technical planner. Briefly describe the exact function and capability of the tool you need to complete the next step.`,
    simba_memory_search: `Sen sadece ilgili numaraları virgülle döndüren bir robotsun. Cümle kurma.`,
    chart_data_extractor: `Sen bir finansal veri çıkarıcı yapay zekasın. Gönderdiğim grafik görselini (çizgi veya mum grafiği) analiz et ve grafikteki veri noktalarını sırasıyla sadece düz bir JSON sayı dizisi olarak çıkar (örneğin: [1, 6, 2, 5, 7, 13, 265, ...]). Sayılar 1 ile 1000 arasında orantılanmış olmalıdır. Sadece JSON dizisini yaz, markdown block kullanabilirsin, başka hiçbir açıklama yapma.`,
    library_doc_selector: `You are a precise document selector. Answer exactly according to the requested format.`,
    sgm_health_check: `Sen bir gorev denetcisisin. Bir ajan kullanici istegini yerine getirmeye calisiyor. Analiz et: 1. Kullanici istegi karsilandi mi? 2. Ajan takildi mi/donguye girdi mi? 3. Hata var mi? Karar ver. SADECE JSON formatinda cevap ver: {"karar": "DEVAM_ET"|"BITIR"|"HATA", "neden": "kisa gerekce", "tavsiye": "ajandan istenen adim"}`,
    entity_router: `Kullanıcının isteğini analiz et. İstekte kaç farklı "Kişi", "Kurum" veya "Bağımsız Olay/Konu" geçiyor? Her bir varlık/olay için işlemleri ayıracağız. JSON formatında listele: {"entities": [{"name": "...", "instruction": "..."}]}`
  }
};

try {
  const promptPath = path.join(__dirname, '..', 'config', 'system_prompt.txt');
  if (fs.existsSync(promptPath)) {
    config.systemPrompt = fs.readFileSync(promptPath, 'utf-8');
    config.systemPrompts.main_prompt = config.systemPrompt;
  } else {
    config.systemPrompt = 'System prompt load failed. Check config/system_prompt.txt';
    config.systemPrompts.main_prompt = config.systemPrompt;
  }
} catch (e) {
  console.error('Failed to load system prompt:', e);
}

try {
  const systemPromptsJsonPath = path.join(__dirname, '..', 'config', 'system_prompts.json');
  if (fs.existsSync(systemPromptsJsonPath)) {
    const spData = JSON.parse(fs.readFileSync(systemPromptsJsonPath, 'utf-8'));
    Object.assign(config.systemPrompts, spData);
    if (config.systemPrompts.main_prompt) {
      config.systemPrompt = config.systemPrompts.main_prompt;
    }
  }
} catch (e) {
  console.error('Failed to load system_prompts.json:', e);
}

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
        if (conf.bannedCommands !== undefined && Array.isArray(conf.bannedCommands)) config.bannedCommands = conf.bannedCommands;
        if (conf.modelTags !== undefined && typeof conf.modelTags === 'object') config.modelTags = { ...conf.modelTags };
        if (conf.lpmMode !== undefined) config.lpmMode = conf.lpmMode;
        if (conf.lpmOmMode !== undefined) config.lpmOmMode = conf.lpmOmMode;
        if (conf.lpmBatchSize !== undefined) config.lpmBatchSize = conf.lpmBatchSize;
        if (conf.hpmMode !== undefined) config.hpmMode = conf.hpmMode;
        if (conf.modelSwitchingEnabled !== undefined) config.modelSwitchingEnabled = conf.modelSwitchingEnabled;
        if (conf.toolModelConfig !== undefined && typeof conf.toolModelConfig === 'object') {
          config.toolModelConfig = { ...config.toolModelConfig, ...conf.toolModelConfig };
        }
        if (conf.modelLadder !== undefined && Array.isArray(conf.modelLadder)) {
          config.modelLadder = [...conf.modelLadder];
        }
        if (conf.modelModeProfiles !== undefined && typeof conf.modelModeProfiles === 'object') {
          config.modelModeProfiles = { ...config.modelModeProfiles, ...conf.modelModeProfiles };
        }
      }
  }
} catch (e) {
  console.error('Failed to load config.json:', e);
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
const stateChangeListeners = [];

function onStateChange(listener) {
  if (typeof listener === 'function') {
    stateChangeListeners.push(listener);
  }
}

let terminalOutputHook = null;
function setTerminalOutputHook(fn) {
  terminalOutputHook = fn;
}

function broadcastState() {
  stateChangeListeners.forEach(fn => {
    try { fn(agentState); } catch (e) {}
  });

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
  if (terminalOutputHook) {
    try { terminalOutputHook(data); } catch (e) {}
  }
  if (!wss) return;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'terminal', data }));
    }
  });
}

// ─── TASK STEP TRACKING ─────────────────────────────────────────────────────
// Broadcasts a single tool step event to all connected WebSocket clients.
// status: 'running' | 'done' | 'error'
// Does NOT modify agentState itself — caller manages taskSteps[].
function broadcastTaskStep(stepData) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'task_step', step: stepData });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Resets taskSteps array and broadcasts a clear event so the UI starts fresh.
function clearTaskSteps() {
  agentState.taskSteps = [];
  if (!wss) return;
  const payload = JSON.stringify({ type: 'task_steps_clear' });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}
// ─────────────────────────────────────────────────────────────────────────────

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

function broadcastCustomMessage(payload) {
  if (!wss || !wss.clients) return;
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
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
  broadcastTaskStep,
  clearTaskSteps,
  broadcastCustomMessage,
  addMessage,
  getAvailableGuides,
  refreshGuidesCache,
  ensureWorkspaceFoldersAndFiles,
  addTransientError,
  generateErrorSignature,
  clearTransientErrors,
  onStateChange,
  setTerminalOutputHook
};
