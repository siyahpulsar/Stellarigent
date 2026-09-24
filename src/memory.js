const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const { agentState, broadcastTerminal } = require('./state');
const { getEmbedding, cosineSimilarity } = require('./rag/vectorSearch');

const MEMORY_FILE_PATH = path.join(__dirname, '..', 'config', 'memory.json');

// --- ASYNC MEMORY WRITE QUEUE & EXPONENTIAL BACKOFF (Windows EPERM Protection) ---
let writeQueue = Promise.resolve();
let pendingFlushBuffer = null; // In-memory fallback buffer when OS lock exhausts all retries

function enqueueMemoryTask(taskFn) {
  const promise = writeQueue.then(taskFn, taskFn);
  writeQueue = promise.catch(() => {});
  return promise;
}

async function safeAtomicWrite(filePath, data, maxRetries = 3) {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substr(2, 6)}.tmp`;
  let delay = 100;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fs.promises.writeFile(tmpPath, data, 'utf-8');
      await fs.promises.rename(tmpPath, filePath);
      pendingFlushBuffer = null; // Flushed successfully to disk
      return true;
    } catch (err) {
      try { await fs.promises.unlink(tmpPath); } catch {}
      if (attempt === maxRetries) {
        // Last-resort direct write fallback
        try {
          await fs.promises.writeFile(filePath, data, 'utf-8');
          pendingFlushBuffer = null;
          return true;
        } catch (directErr) {
          // Antivirus/Windows Defender held handle: store in RAM buffer for deferred flush
          pendingFlushBuffer = data;
          console.warn(`[MEMORY QUEUE WARNING] OS file lock prevented writing to ${filePath}. Data preserved in RAM pendingFlushBuffer for deferred flush:`, directErr.message);
          return false;
        }
      }
      await new Promise(res => setTimeout(res, delay));
      delay = Math.floor(delay * 2.5); // 100ms -> 250ms -> 625ms
    }
  }
}

// --- EMERGENCY EXIT FLUSH (Zero Data Loss on Process Crash) ---
function emergencyFlushSync() {
  if (pendingFlushBuffer) {
    try {
      console.warn('[MEMORY EMERGENCY] Process terminating: synchronously flushing pendingFlushBuffer to disk...');
      fs.writeFileSync(MEMORY_FILE_PATH, pendingFlushBuffer, 'utf-8');
      pendingFlushBuffer = null;
    } catch (err) {
      try {
        const emergencyPath = path.join(__dirname, '..', 'config', 'memory.emergency_backup.json');
        fs.writeFileSync(emergencyPath, pendingFlushBuffer, 'utf-8');
        console.warn(`[MEMORY EMERGENCY] Saved emergency fallback to ${emergencyPath}`);
      } catch {}
    }
  }
}

if (typeof process !== 'undefined') {
  process.on('beforeExit', emergencyFlushSync);
  process.on('SIGINT', () => { emergencyFlushSync(); process.exit(0); });
  process.on('SIGTERM', () => { emergencyFlushSync(); process.exit(0); });
}

// --- LEGACY DATA NORMALIZER & MIGRATION HELPER ---
function normalizeMemoryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const rawDate = item.createdAt || item.date;
  const parsedTime = rawDate ? new Date(rawDate).getTime() : NaN;
  const validCreatedAt = !isNaN(parsedTime) ? new Date(parsedTime).toISOString() : new Date(0).toISOString();

  return {
    ...item,
    task: item.task || item.rule || item.summary || 'Legacy Task',
    summary: item.summary || item.rule || item.task || '',
    rule: item.rule || (item.isRule ? item.summary : undefined),
    isRule: Boolean(item.isRule || item.category === 'SECURITY_VIOLATION'),
    category: item.category || (item.isRule ? 'SECURITY_VIOLATION' : 'GENERAL'),
    createdAt: validCreatedAt,
    date: item.date || validCreatedAt,
    accessCount: (typeof item.accessCount === 'number' && !isNaN(item.accessCount)) ? Math.max(0, item.accessCount) : 0,
    exceptions: Array.isArray(item.exceptions) ? item.exceptions : []
  };
}

// --- DATA STORE LOADER & SAVER (Store = { memories: [], pendingRules: [] }) ---

async function loadMemoryStore() {
  if (pendingFlushBuffer) {
    try {
      const data = JSON.parse(pendingFlushBuffer);
      const rawMemories = Array.isArray(data) ? data : (Array.isArray(data.memories) ? data.memories : []);
      const rawPending = Array.isArray(data.pendingRules) ? data.pendingRules : [];
      return {
        memories: rawMemories.map(normalizeMemoryItem).filter(Boolean),
        pendingRules: rawPending
      };
    } catch {}
  }
  try {
    try { await fs.promises.access(MEMORY_FILE_PATH); } catch { return { memories: [], pendingRules: [] }; }
    const raw = await fs.promises.readFile(MEMORY_FILE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    const rawMemories = Array.isArray(data) ? data : (Array.isArray(data.memories) ? data.memories : []);
    const rawPending = Array.isArray(data.pendingRules) ? data.pendingRules : [];
    return {
      memories: rawMemories.map(normalizeMemoryItem).filter(Boolean),
      pendingRules: rawPending
    };
  } catch (e) {
    console.error("Failed to load memory store:", e);
    return { memories: [], pendingRules: [] };
  }
}

async function saveMemoryStore(store) {
  return enqueueMemoryTask(async () => {
    const jsonStr = JSON.stringify(store, null, 2);
    await safeAtomicWrite(MEMORY_FILE_PATH, jsonStr);
  });
}

// Backward compatible loadMemory (returns array)
async function loadMemory() {
  const store = await loadMemoryStore();
  return store.memories;
}

// Atomic Read-Modify-Write inside the queue
async function updateMemoryStore(mutatorFn) {
  return enqueueMemoryTask(async () => {
    const store = await loadMemoryStore();
    await mutatorFn(store);
    await safeAtomicWrite(MEMORY_FILE_PATH, JSON.stringify(store, null, 2));
    return store;
  });
}

// Backward compatible saveMemory (saves array)
async function saveMemory(memories) {
  return enqueueMemoryTask(async () => {
    const store = await loadMemoryStore();
    store.memories = memories;
    await safeAtomicWrite(MEMORY_FILE_PATH, JSON.stringify(store, null, 2));
  });
}

// --- DETERMINISTIC SCORING & TWO-STAGE PRUNING ---
const W_ACCESS = 2.0;
const DECAY_CONSTANT = 72; // Every 72 hours (3 days) of age without access decays 1 score point
const GRACE_HOURS = 24;

function calculateMemoryScore(item, now = Date.now()) {
  const itemDate = item.createdAt || item.date;
  const parsedTime = itemDate ? new Date(itemDate).getTime() : NaN;
  const validTime = !isNaN(parsedTime) ? parsedTime : 0;
  const ageInHours = Math.max(0, (now - validTime) / (1000 * 60 * 60));
  const accessCount = (typeof item.accessCount === 'number' && !isNaN(item.accessCount)) ? item.accessCount : 0;
  return (accessCount * W_ACCESS) - (ageInHours / DECAY_CONSTANT);
}

function pruneMemories(memories, maxMemories = 50, now = Date.now()) {
  if (!Array.isArray(memories)) return [];
  if (memories.length <= maxMemories) return memories;

  const GRACE_CAP = Math.floor(maxMemories * 0.70); // Max 70% capacity reserved for grace period (35 for 50)
  const graceThresholdMs = GRACE_HOURS * 3600000;

  let gracePool = [];
  let nonGracePool = [];

  for (const m of memories) {
    const itemDate = m.createdAt || m.date || now;
    const ageMs = now - new Date(itemDate).getTime();
    if (ageMs < graceThresholdMs) {
      gracePool.push(m);
    } else {
      nonGracePool.push(m);
    }
  }

  // Stage 1: Grace Pool Trimming
  // If grace pool alone exceeds 70% capacity, trim it internally by score descending
  if (gracePool.length > GRACE_CAP) {
    gracePool.sort((a, b) => calculateMemoryScore(b, now) - calculateMemoryScore(a, now));
    gracePool = gracePool.slice(0, GRACE_CAP);
  }

  // Stage 2: Non-Grace Pool Trimming
  // If remaining grace pool + non-grace pool exceeds maxMemories, evict from non-grace pool ONLY
  const currentTotal = gracePool.length + nonGracePool.length;
  if (currentTotal > maxMemories) {
    const neededRemoval = currentTotal - maxMemories;
    nonGracePool.sort((a, b) => calculateMemoryScore(b, now) - calculateMemoryScore(a, now));
    nonGracePool = nonGracePool.slice(0, Math.max(0, nonGracePool.length - neededRemoval));
  }

  return [...gracePool, ...nonGracePool];
}

// --- PENDING RULES LIFECYCLE (Max 10 FIFO, 7-Day TTL) ---
const MAX_PENDING_RULES = 10;
const PENDING_TTL_HOURS = 168; // 7 days

function cleanStalePendingRules(pendingRules, now = Date.now()) {
  if (!Array.isArray(pendingRules)) return [];
  const maxAgeMs = PENDING_TTL_HOURS * 3600000;
  return pendingRules.filter(r => {
    const itemDate = r.createdAt || now;
    const ageMs = now - new Date(itemDate).getTime();
    return ageMs < maxAgeMs;
  });
}

async function addPendingRule(ruleObj) {
  return enqueueMemoryTask(async () => {
    const store = await loadMemoryStore();
    let pending = cleanStalePendingRules(store.pendingRules);

    // FIFO overflow handling: if already at limit, drop oldest
    if (pending.length >= MAX_PENDING_RULES) {
      pending.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      while (pending.length >= MAX_PENDING_RULES) {
        pending.shift();
      }
    }

    const newPending = {
      id: 'rule-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      rule: ruleObj.rule || ruleObj.text || String(ruleObj),
      category: ruleObj.category || 'SECURITY_VIOLATION',
      context: ruleObj.context || '',
      exceptions: Array.isArray(ruleObj.exceptions) ? ruleObj.exceptions : [],
      createdAt: new Date().toISOString(),
      status: 'pending_review'
    };
    pending.push(newPending);
    store.pendingRules = pending;
    await safeAtomicWrite(MEMORY_FILE_PATH, JSON.stringify(store, null, 2));
    return newPending;
  });
}

async function approvePendingRule(ruleId) {
  return enqueueMemoryTask(async () => {
    const store = await loadMemoryStore();
    const idx = (store.pendingRules || []).findIndex(r => r.id === ruleId);
    if (idx === -1) return null;

    const [approved] = store.pendingRules.splice(idx, 1);
    const nowIso = new Date().toISOString();
    const newMemory = {
      task: `[GÜVENLİK KURALI]: ${approved.rule}`,
      summary: approved.rule,
      rule: approved.rule,
      isRule: true,
      category: approved.category,
      exceptions: Array.isArray(approved.exceptions) ? approved.exceptions : [],
      accessCount: 1, // Explicit user approval grants 1 initial access boost
      createdAt: nowIso,
      date: nowIso
    };
    store.memories.push(newMemory);

    const { config } = require('./state');
    const memLimit = (config && config.memoryLimit) || 50;
    store.memories = pruneMemories(store.memories, memLimit);

    await safeAtomicWrite(MEMORY_FILE_PATH, JSON.stringify(store, null, 2));
    return newMemory;
  });
}

async function rejectPendingRule(ruleId) {
  return enqueueMemoryTask(async () => {
    const store = await loadMemoryStore();
    const idx = (store.pendingRules || []).findIndex(r => r.id === ruleId);
    if (idx === -1) return false;
    store.pendingRules.splice(idx, 1);
    await safeAtomicWrite(MEMORY_FILE_PATH, JSON.stringify(store, null, 2));
    return true;
  });
}

async function appendToMemory(task, summary, extraData = {}) {
  return enqueueMemoryTask(async () => {
    try {
      const store = await loadMemoryStore();
      const { config } = require('./state');

      let vector = null;
      if (config.lmStudioUrl) {
        vector = await getEmbedding(task + " " + summary, config.lmStudioUrl);
      }

      const nowIso = new Date().toISOString();
      store.memories.push({
        task,
        summary,
        toolsUsed: extraData.toolsUsed || [],
        thoughts: extraData.thoughts || [],
        errors: extraData.errors || [],
        posNegAspects: extraData.posNegAspects || "",
        vector,
        accessCount: 0,
        createdAt: nowIso,
        date: nowIso
      });

      const memLimit = (config && config.memoryLimit) || 50;
      store.memories = pruneMemories(store.memories, memLimit);

      // Also clean up any stale pending rules during periodic memory appends
      store.pendingRules = cleanStalePendingRules(store.pendingRules);

      await safeAtomicWrite(MEMORY_FILE_PATH, JSON.stringify(store, null, 2));
    } catch (e) {
      console.error("Failed to append to memory:", e);
    }
  });
}

async function getMemoryPrompt(currentTaskQuery) {
  const memories = await loadMemory();
  if (memories.length === 0) return '';

  let selectedMemories = memories;

  if (currentTaskQuery) {
    const { config, broadcastTerminal } = require('./state');
    
    if (config.simbaEnabled) {
      // === SiMBA (Searched Memory By AI) ===
      broadcastTerminal(`\n> [SiMBA] Hafızalar LLM ile taranıyor...\n`);
      const { llmFetch } = require('./llm/llmClient');
      let selectedIndices = [];
      const chunkSize = 20;

      for (let i = 0; i < memories.length; i += chunkSize) {
        const chunk = memories.slice(i, i + chunkSize);
        let memoryListText = "";
        chunk.forEach((m, idx) => {
          memoryListText += `${i + idx + 1}: ${m.summary}\n`;
        });

        const promptText = `Gelen İstek: ${currentTaskQuery}\n\nBu gelen isteğe göre aşağıda listelenmiş özetlere bakarak hangi numaralı hafızalar sana gelen istek ile uyumludur? Sadece ve sadece virgülle ayrılmış numaraları döndür (Örnek: 1,3,15). Başka hiçbir kelime veya açıklama yazma. Eğer hiçbiri uyumlu değilse boş bırak.\n\nHafızalar:\n${memoryListText}`;

        const { config } = require('./state');
        const defaultMemPrompt = 'Sen sadece ilgili numaraları virgülle döndüren bir robotsun. Cümle kurma.';
        const memPrompt = (config && config.systemPrompts && config.systemPrompts.simba_memory_search) || defaultMemPrompt;
        const messages = [
          { role: 'system', content: memPrompt },
          { role: 'user', content: promptText }
        ];

        try {
          const llmResponse = await llmFetch(messages, 0.1, 'SiMBA Memory Search');
          if (llmResponse) {
            const numbers = llmResponse.match(/\d+/g);
            if (numbers) {
              numbers.forEach(numStr => {
                const num = parseInt(numStr, 10);
                if (num >= i + 1 && num <= i + chunk.length) {
                  selectedIndices.push(num - 1); // 0-indexed yap
                }
              });
            }
          }
        } catch (err) {
          console.error("SiMBA error fetching:", err);
        }
      }

      // Benzersiz indeksleri al
      selectedIndices = [...new Set(selectedIndices)];
      selectedMemories = selectedIndices
        .filter(idx => idx >= 0 && idx < memories.length)
        .map(idx => memories[idx]);

      if (selectedMemories.length === 0) {
        broadcastTerminal(`> [SiMBA] Uyumlu hafıza bulunamadı, son 3 hafıza alınıyor...\n`);
        selectedMemories = memories.slice(-3);
      } else {
        broadcastTerminal(`> [SiMBA] ${selectedMemories.length} adet uyumlu hafıza bulundu.\n`);
      }

    } else {
      // === Kalsik TF-IDF / Vector Search ===
      let queryVector = null;
      
      // Try to get query embedding
    if (config.lmStudioUrl) {
      queryVector = await getEmbedding(currentTaskQuery, config.lmStudioUrl);
    }

    // Common stop words to eliminate context noise
    const STOP_WORDS = new Set([
      'bir', 'ile', 'için', 'olan', 'veya', 'gibi', 'kadar', 'sonra', 'önce', 'daha', 'çok', 'ama', 'fakat',
      'ancak', 'bunu', 'buna', 'şunu', 'bana', 'sana', 'bize', 'size', 'onlar', 'böyle', 'şöyle', 'nasıl',
      'neden', 'niçin', 'evet', 'hayır', 'diye', 'olarak', 'tüm', 'her', 'şey', 'ise', 'da', 'de', 'ki',
      'mi', 'mu', 'mü', 'mı', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was',
      'were', 'will', 'what', 'when', 'where', 'which', 'who', 'how', 'about', 'some', 'any', 'all'
    ]);

    if (queryVector) {
      // Vector Search
      const scored = memories.map(m => {
        let score = 0;
        if (m.vector) {
          score = cosineSimilarity(queryVector, m.vector);
        } else {
          // Fallback keyword score if this memory has no vector
          const queryTokens = currentTaskQuery.toLowerCase().split(/[^a-zA-Z0-9çığöşüöäüæßàáâäæãåā]+/g).filter(w => w.length > 2 && !STOP_WORDS.has(w));
          const textToMatch = `${m.task} ${m.summary}`.toLowerCase();
          queryTokens.forEach(token => {
            if (textToMatch.includes(token)) score += 0.2; 
          });
        }
        return { memory: m, score };
      });
      
      const matched = scored.filter(s => s.score >= 0.5).sort((a, b) => b.score - a.score);
      if (matched.length > 0) {
        selectedMemories = matched.slice(0, 3).map(s => s.memory);
      } else {
        selectedMemories = []; // Do not pollute context if relevance threshold is not met
      }
    } else {
      // Fallback Keyword Search
      const queryTokens = currentTaskQuery.toLowerCase().split(/[^a-zA-Z0-9çığöşüöäüæßàáâäæãåā]+/g).filter(w => w.length > 2 && !STOP_WORDS.has(w));
      if (queryTokens.length > 0) {
        const scored = memories.map(m => {
          const textToMatch = `${m.task} ${m.summary}`.toLowerCase();
          let score = 0;
          queryTokens.forEach(token => {
            if (textToMatch.includes(token)) {
              score += 1;
            }
          });
          return { memory: m, score };
        });

        const matched = scored.filter(s => s.score >= 1).sort((a, b) => b.score - a.score);
        if (matched.length > 0) {
          selectedMemories = matched.slice(0, 3).map(s => s.memory);
        } else {
          selectedMemories = []; // Do not pollute context
        }
      } else {
        selectedMemories = [];
      }
    }
    } // end else (classic TF-IDF / Vector Search)
  } else {
    selectedMemories = [];
  }

  if (selectedMemories.length === 0) return '';
  selectedMemories = selectedMemories.slice(0, 3); // STRICT LIMIT: Prevent prompt saturation (Max top-3 recalled items)

  let prompt = "\n\n=== RECALLED MEMORY OF PAST TASKS & VERIFIED RULES ===\n";
  const rules = selectedMemories.filter(m => m.isRule);
  const tasks = selectedMemories.filter(m => !m.isRule);

  if (rules.length > 0) {
    prompt += "\n[KANITLANMIŞ GÜVENLİK KURALLARI VE DERSLER]:\n";
    rules.forEach((r, idx) => {
      const excStr = (r.exceptions && r.exceptions.length > 0) ? ` (İstisnalar: ${r.exceptions.join(', ')})` : '';
      prompt += `* Kural ${idx + 1}: ${r.rule || r.summary}${excStr}\n`;
    });
  }

  if (tasks.length > 0) {
    prompt += "\n[GEÇMİŞ GÖREV DENEYİMLERİ]:\n";
    tasks.forEach((m, idx) => {
      prompt += `\n--- Geçmiş Görev ${idx + 1} ---\n`;
      prompt += `Görev: "${m.task}"\n`;
      prompt += `Özet: ${m.summary}\n`;
      if (m.toolsUsed && m.toolsUsed.length > 0) prompt += `Kullanılan Araçlar: ${m.toolsUsed.join(', ')}\n`;
      if (m.thoughts && m.thoughts.length > 0) prompt += `Düşünceler: ${m.thoughts.join(' | ')}\n`;
      if (m.errors && m.errors.length > 0) prompt += `Karşılaşılan Hatalar: ${m.errors.join(' | ')}\n`;
      if (m.posNegAspects && m.posNegAspects.what_went_well) prompt += `İyi Gidenler: ${m.posNegAspects.what_went_well}\n`;
      if (m.posNegAspects && m.posNegAspects.what_went_wrong) prompt += `Düzeltilmesi Gerekenler: ${m.posNegAspects.what_went_wrong}\n`;
    });
  }

  // Increment accessCount only for items actually selected and included in prompt
  selectedMemories.forEach(m => {
    m.accessCount = (m.accessCount || 0) + 1;
  });

  await saveMemory(memories).catch(() => {});
  prompt += "======================================================\n";
  return prompt;
}

async function getWorkspaceRulesPrompt() {
  try {
    const p1 = path.join(agentState.cwd, '.agent-rules.md');
    const p2 = path.join(agentState.cwd, '.agent-context.md');
    let content = '';
    // Try first path, then fallback
    for (const p of [p1, p2]) {
      try {
        content = await fs.promises.readFile(p, 'utf-8');
        break; // found it
      } catch {
        // not found, try next
      }
    }
    if (content) {
      return `\n\n=== WORKSPACE CONTEXT RULES (.agent-rules.md) ===\n${content}\n================================================\n`;
    }
  } catch (e) {
    console.error("Failed to read workspace rules:", e);
  }
  return '';
}

// Helper to extract directory structure recursively
async function getFolderStructureSummary(dir, depth = 0) {
  if (depth > 2) return ''; // Limit depth to prevent massive listings
  let summary = '';
  try {
    const items = await fs.promises.readdir(dir);
    for (const item of items) {
      if (item === 'node_modules' || item === '.git' || item === '.gemini' || item === 'screenshots') continue;
      const fullPath = path.join(dir, item);
      const stats = await fs.promises.stat(fullPath);
      const prefix = '  '.repeat(depth);
      if (stats.isDirectory()) {
        summary += `${prefix}📁 ${item}/\n`;
        summary += await getFolderStructureSummary(fullPath, depth + 1);
      } else {
        summary += `${prefix}📄 ${item}\n`;
      }
    }
  } catch (e) {
    // Ignore error
  }
  return summary;
}

// Automatically updates agent_readme.md with project file listings and latest accomplishments
async function updateWorkspaceReadme(task, summary) {
  try {
    const readmePath = path.join(agentState.cwd, 'agent_readme.md');
    let currentContent = '';
    if (fs.existsSync(readmePath)) {
      currentContent = await fs.promises.readFile(readmePath, 'utf-8');
    }

    const filesList = await getFolderStructureSummary(agentState.cwd);

    let updatedContent = `# Stellarigent Project Workspace\n\n## Directory Structure\n\`\`\`\n${filesList}\n\`\`\`\n\n## What I Accomplished & Learned\n`;

    let historySection = '';
    if (currentContent.includes('## What I Accomplished & Learned')) {
      historySection = currentContent.split('## What I Accomplished & Learned')[1].trim();
    }

    if (historySection) {
      updatedContent += historySection + `\n- [${new Date().toLocaleDateString()}] Task: "${task}" -> Accomplished: ${summary}`;
    } else {
      updatedContent += `- [${new Date().toLocaleDateString()}] Task: "${task}" -> Accomplished: ${summary}`;
    }

    await fs.promises.writeFile(readmePath, updatedContent, 'utf-8');
    broadcastTerminal(`> [AGENT README] Automatically updated agent_readme.md with directory structure and new accomplishments.\n`);
  } catch (e) {
    console.error("Failed to update workspace agent_readme:", e);
  }
}

// Local keyword frequency matching script (TF-IDF light) for agent_readme.md context selection
function filterReadmeByKeywords(readmeText, queryText) {
  if (!readmeText) return "No relevant background found.";
  if (!queryText) return readmeText.substring(0, 1500);

  const stopwords = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can\'t', 'cannot', 'could',
    'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for',
    'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s',
    'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m',
    'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t',
    'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
    'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t',
    'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
    'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t',
    'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s',
    'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself',
    'yourselves',
    // Turkish stop words
    'bir', 'ile', 'için', 'olan', 'veya', 'gibi', 'kadar', 'sonra', 'önce', 'daha', 'çok', 'ama', 'fakat',
    'ancak', 'bunu', 'buna', 'şunu', 'bana', 'sana', 'bize', 'size', 'onlar', 'böyle', 'şöyle', 'nasıl',
    'neden', 'niçin', 'evet', 'hayır', 'diye', 'olarak', 'tüm', 'her', 'şey', 'ise', 'da', 'de', 'ki',
    'mi', 'mu', 'mü', 'mı'
  ]);

  const queryTokens = queryText.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1 && !stopwords.has(token));

  if (queryTokens.length === 0) {
    const rawTokens = queryText.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0);
    queryTokens.push(...rawTokens);
  }

  const sections = [];
  const lines = readmeText.split('\n');
  let currentSection = { header: 'Introduction', content: [] };

  for (const line of lines) {
    if (line.startsWith('#')) {
      if (currentSection.content.length > 0 || currentSection.header !== 'Introduction') {
        sections.push(currentSection);
      }
      currentSection = { header: line, content: [line] };
    } else {
      currentSection.content.push(line);
    }
  }
  if (currentSection.content.length > 0) {
    sections.push(currentSection);
  }

  const scoredSections = sections.map(sec => {
    const textContent = sec.content.join('\n');
    const textLower = textContent.toLowerCase();
    let score = 0;

    for (const token of queryTokens) {
      const regex = new RegExp(token.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
      const matches = textLower.match(regex);
      if (matches) {
        score += matches.length * 1.0;
      }
      const headerLower = sec.header.toLowerCase();
      const headerMatches = headerLower.match(regex);
      if (headerMatches) {
        score += headerMatches.length * 5.0;
      }
    }

    return {
      header: sec.header,
      content: textContent,
      score: score
    };
  });

  const relevantSections = scoredSections
    .filter(sec => sec.score > 0)
    .sort((a, b) => b.score - a.score);

  if (relevantSections.length === 0) {
    return readmeText.substring(0, 1500) + "\n\n(Note: No highly specific section matches found for the task query.)";
  }

  let result = '';
  let currentLength = 0;
  const maxOutputLength = 3000;

  for (const sec of relevantSections) {
    if (currentLength + sec.content.length > maxOutputLength && result !== '') {
      break;
    }
    result += sec.content + '\n\n';
    currentLength += sec.content.length;
  }

  return result.trim();
}

// Git auto commit helper (Using execFile to prevent shell injection)
async function runGitCommit(task, summary) {
  const gitDir = path.join(agentState.cwd, '.git');
  const gitExists = await fs.promises.access(gitDir).then(() => true).catch(() => false);
  if (!gitExists) {
    broadcastTerminal(`\n> [GIT AUTO-COMMIT] Skipped. No .git repository found in workspace.\n`);
    return { success: false, message: "No .git repository found." };
  }

  return new Promise((resolve) => {
    broadcastTerminal(`\n> [GIT AUTO-COMMIT] Staging tracked changes (git add -u) and committing...\n> [GIT AUTO-COMMIT] Not: Takip edilmeyen (untracked) yeni dosyalar otomatik eklenmez.\n`);
    const safeTask = (task || '').substring(0, 60).replace(/[\r\n]/g, ' ').trim();
    const safeSummary = (summary || '').substring(0, 80).replace(/[\r\n]/g, ' ').trim();
    const commitMsg = `feat(agent): ${safeTask} | ${safeSummary}`;

    // 1. Stage only tracked files safely via execFile
    execFile('git', ['add', '-u'], { cwd: agentState.cwd }, (addErr, addStdout, addStderr) => {
      if (addErr) {
        broadcastTerminal(`> [GIT AUTO-COMMIT ERROR] git add -u failed: ${addStderr || addErr.message}\n`);
        return resolve({ success: false, message: addErr.message });
      }

      // 2. Commit safely via execFile without shell interpolation
      execFile('git', ['commit', '-m', commitMsg], { cwd: agentState.cwd }, (commitErr, stdout, stderr) => {
        if (commitErr) {
          // If nothing to commit, it's not a catastrophic failure
          if (stdout && stdout.includes('nothing to commit')) {
            broadcastTerminal(`> [GIT AUTO-COMMIT] Nothing to commit, working tree clean.\n`);
            return resolve({ success: true, stdout });
          }
          broadcastTerminal(`> [GIT AUTO-COMMIT ERROR] ${stderr || commitErr.message}\n`);
          resolve({ success: false, message: commitErr.message });
        } else {
          broadcastTerminal(`> [GIT AUTO-COMMIT SUCCESS] Committed changes successfully.\n${stdout}\n`);
          resolve({ success: true, stdout });
        }
      });
    });
  });
}

module.exports = {
  loadMemory,
  loadMemoryStore,
  saveMemoryStore,
  updateMemoryStore,
  saveMemory,
  appendToMemory,
  getMemoryPrompt,
  calculateMemoryScore,
  pruneMemories,
  cleanStalePendingRules,
  normalizeMemoryItem,
  addPendingRule,
  approvePendingRule,
  rejectPendingRule,
  getWorkspaceRulesPrompt,
  getFolderStructureSummary,
  updateWorkspaceReadme,
  filterReadmeByKeywords,
  runGitCommit
};
