const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { agentState, broadcastTerminal } = require('./state');
const { getEmbedding, cosineSimilarity } = require('./rag/vectorSearch');

const MEMORY_FILE_PATH = path.join(__dirname, '..', 'config', 'memory.json');

async function loadMemory() {
  try {
    try { await fs.promises.access(MEMORY_FILE_PATH); } catch { return []; }
    const data = JSON.parse(await fs.promises.readFile(MEMORY_FILE_PATH, 'utf-8'));
    if (Array.isArray(data)) return data;
  } catch (e) {
    console.error("Failed to load memory:", e);
  }
  return [];
}

async function saveMemory(memories) {
  try {
    await fs.promises.writeFile(MEMORY_FILE_PATH, JSON.stringify(memories, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save memory:", e);
  }
}

async function appendToMemory(task, summary, extraData = {}) {
  try {
    const memories = await loadMemory();
    const { config } = require('./state');
    
    // Attempt to vectorize memory
    let vector = null;
    if (config.lmStudioUrl) {
      vector = await getEmbedding(task + " " + summary, config.lmStudioUrl);
    }
    
    memories.push({
      task,
      summary,
      toolsUsed: extraData.toolsUsed || [],
      thoughts: extraData.thoughts || [],
      errors: extraData.errors || [],
      posNegAspects: extraData.posNegAspects || "",
      vector, // Store embedding
      accessCount: 0,
      date: new Date().toISOString()
    });
    const memLimit = config.memoryLimit || 1000;
    if (memories.length > memLimit) {
      memories.sort((a, b) => (a.accessCount || 0) - (b.accessCount || 0));
      // Sınırı aşan kadarını baştan (en az erişilen) çıkar
      while(memories.length > memLimit) {
        memories.shift();
      }
    }
    await saveMemory(memories);
  } catch (e) {
    console.error("Failed to append to memory:", e);
  }
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

        const messages = [
          { role: 'system', content: 'Sen sadece ilgili numaraları virgülle döndüren bir robotsun. Cümle kurma.' },
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

  let prompt = "\n\n=== RECALLED MEMORY OF PAST TASKS ===\n";
  selectedMemories.forEach((m, idx) => {
    m.accessCount = (m.accessCount || 0) + 1;
    prompt += `\n--- Memory ${idx + 1} ---\n`;
    prompt += `Task: "${m.task}"\n`;
    prompt += `Summary: ${m.summary}\n`;
    if (m.toolsUsed && m.toolsUsed.length > 0) prompt += `Tools Used: ${m.toolsUsed.join(', ')}\n`;
    if (m.thoughts && m.thoughts.length > 0) prompt += `Thoughts: ${m.thoughts.join(' | ')}\n`;
    if (m.errors && m.errors.length > 0) prompt += `Errors: ${m.errors.join(' | ')}\n`;
    if (m.posNegAspects && m.posNegAspects.what_went_well) prompt += `What Went Well: ${m.posNegAspects.what_went_well}\n`;
    if (m.posNegAspects && m.posNegAspects.what_went_wrong) prompt += `What Went Wrong: ${m.posNegAspects.what_went_wrong}\n`;
  });
  await saveMemory(memories).catch(() => {});
  prompt += "=====================================\n";
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

    let updatedContent = `# Local AI Agent Project Workspace\n\n## Directory Structure\n\`\`\`\n${filesList}\n\`\`\`\n\n## What I Accomplished & Learned\n`;

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

// Git auto commit helper
async function runGitCommit(task, summary) {
  const gitDir = path.join(agentState.cwd, '.git');
  const gitExists = await fs.promises.access(gitDir).then(() => true).catch(() => false);
  if (!gitExists) {
    broadcastTerminal(`\n> [GIT AUTO-COMMIT] Skipped. No .git repository found in workspace.\n`);
    return { success: false, message: "No .git repository found." };
  }

  return new Promise((resolve) => {
    broadcastTerminal(`\n> [GIT AUTO-COMMIT] Staging changes and committing...\n`);
    const safeTask = task.substring(0, 50).replace(/["'`$\\&|<>\r\n]/g, '');
    const safeSummary = summary.replace(/["'`$\\&|<>\r\n]/g, '');
    const commitMsg = `feat(agent): accomplished task - ${safeTask}...\n\nSummary: ${safeSummary}`;
    const gitCmd = `git add . && git commit -m "${commitMsg}"`;

    exec(gitCmd, { cwd: agentState.cwd }, (error, stdout, stderr) => {
      if (error) {
        broadcastTerminal(`> [GIT AUTO-COMMIT ERROR] ${stderr || error.message}\n`);
        resolve({ success: false, message: error.message });
      } else {
        broadcastTerminal(`> [GIT AUTO-COMMIT SUCCESS] Committed changes successfully.\n${stdout}\n`);
        resolve({ success: true, stdout });
      }
    });
  });
}

module.exports = {
  loadMemory,
  appendToMemory,
  getMemoryPrompt,
  getWorkspaceRulesPrompt,
  getFolderStructureSummary,
  updateWorkspaceReadme,
  filterReadmeByKeywords,
  runGitCommit
};
