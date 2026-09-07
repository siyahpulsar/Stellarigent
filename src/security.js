const fs = require('fs');
const path = require('path');
const { agentState, config, createdFolders, saveCreatedFolders, broadcastTerminal } = require('./state');

let securityRules = {
  bannedWords: [],
  bannedWebsites: [],
  allowedBaseFolders: []
};

// When set to a path, agent has full read/write access to that directory (IDE workspace mode)
let ideWorkspacePath = null;

function setIdeWorkspace(absPath) {
  ideWorkspacePath = absPath ? path.resolve(absPath) : null;
}

function getIdeWorkspace() {
  return ideWorkspacePath;
}

function loadSecurityRules() {
  try {
    const rulesPath = path.join(__dirname, '..', 'config', 'security_rules.json');
    if (fs.existsSync(rulesPath)) {
      securityRules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
      // Auto-dedup bannedWords to prevent redundant Levenshtein comparisons
      if (securityRules.bannedWords) {
        securityRules.bannedWords = [...new Set(securityRules.bannedWords.map(w => w.trim()))];
      }
      console.log(`[SECURITY RULES LOADED] ${securityRules.bannedWords?.length || 0} banned words, ${securityRules.bannedWebsites?.length || 0} banned sites`);
    }
  } catch (e) {
    console.error("[ERROR] Failed to load security rules:", e);
  }
}
// Note: loadSecurityRules() is called once from server.js on startup.
// Do NOT call it here automatically to prevent double-loading.

// Watch security_rules.json for dynamic updates
try {
  const rulesPath = path.join(__dirname, '..', 'config', 'security_rules.json');
  fs.watch(rulesPath, (eventType) => {
    if (eventType === 'change') {
      console.log("[SECURITY] security_rules.json changed, reloading...");
      loadSecurityRules();
    }
  });
} catch (e) {
  console.error("Failed to watch security_rules.json:", e);
}

// Calculates Levenshtein distance between two strings
function getLevenshteinDistance(a, b) {
  const tmp = [];
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

// Calculates similarity ratio (0.0 to 1.0)
function getStringSimilarity(a, b) {
  const distance = getLevenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - (distance / maxLen);
}

// Helper to check if task prompt contains banned words using Levenshtein distance on words
function checkBannedWords(prompt) {
  if (!prompt || !securityRules.bannedWords || securityRules.bannedWords.length === 0) return null;
  const lowerPrompt = prompt.toLowerCase();

  // Fast path: check simple substring matching first (covers exact matches & multi-word banned terms)
  for (const bannedWord of securityRules.bannedWords) {
    const lowerBanned = bannedWord.toLowerCase();
    if (lowerPrompt.includes(lowerBanned)) {
      return bannedWord;
    }
  }

  // Split prompt by spaces and symbols to check individual word tokens
  const words = lowerPrompt.split(/[^a-zA-Z0-9çığöşüöäüæßàáâäæãåā]+/g).filter(w => w.length > 0);

  for (const promptWord of words) {
    for (const bannedWord of securityRules.bannedWords) {
      const lowerBanned = bannedWord.toLowerCase();

      // Skip multi-word phrases as they are checked by the fast path above
      if (lowerBanned.includes(' ')) continue;

      // Optimization: Only compute similarity if lengths differ by at most 2.
      // (If length difference is > 2, similarity can never be >= 0.90 for typical words)
      if (Math.abs(promptWord.length - lowerBanned.length) > 2) continue;

      // Word-by-word similarity check for single words
      const similarity = getStringSimilarity(promptWord, lowerBanned);
      if (similarity >= 0.95) {
        console.log(`[BANNED WORD MATCH] "${promptWord}" matched banned word "${bannedWord}" with similarity ${Math.round(similarity * 100)}%`);
        return bannedWord;
      }
    }
  }
  return null;
}

// Helper to check if query or URL contains banned websites
function checkBannedWebsites(target) {
  if (!target || !securityRules.bannedWebsites) return false;
  const lowerTarget = target.toLowerCase();
  for (const site of securityRules.bannedWebsites) {
    if (lowerTarget.includes(site.toLowerCase())) {
      return true;
    }
  }
  return false;
}

// Helper to check if file path access is allowed and register newly created folders
function checkAndRegisterPath(filePath, isWrite = false) {
  if (!filePath) return false;

  const cwdResolved = path.resolve(agentState.cwd);
  let targetPath;
  try {
    targetPath = fs.realpathSync(path.resolve(cwdResolved, filePath));
  } catch (err) {
    targetPath = path.resolve(cwdResolved, filePath);
  }

  // === IDE WORKSPACE MODE ===
  // If an IDE workspace is set and target is inside it → full access
  if (ideWorkspacePath) {
    const relToWorkspace = path.relative(ideWorkspacePath, targetPath);
    if (!relToWorkspace.startsWith('..') && !path.isAbsolute(relToWorkspace)) {
      return true; // Full access inside IDE workspace
    }
    // Block access outside the IDE workspace
    return false;
  }

  // === DEFAULT SANDBOX MODE (original behavior) ===
  const rootDir = cwdResolved.toLowerCase();
  const targetLower = targetPath.toLowerCase();

  // If path is outside the root directory, block it
  const relative = path.relative(rootDir, targetLower);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }

  // Split relative path into parts
  const parts = relative.split(path.sep).filter(p => p.length > 0);
  if (parts.length === 0) {
    return !isWrite; // Root directory: read-only
  }

  const topLevel = parts[0];

  // Whitelisted base folders from security rules
  const allowedBases = (securityRules.allowedBaseFolders || []).map(f => f.toLowerCase());
  if (allowedBases.includes(topLevel)) return true;

  const topLevelPath = path.join(rootDir, topLevel);

  // If it's a folder/file created by the bot in this session
  if (createdFolders.has(topLevelPath)) return true;

  // If it doesn't exist on disk yet and we are writing, allow creation and track it
  if (isWrite && !fs.existsSync(topLevelPath)) {
    createdFolders.add(topLevelPath);
    saveCreatedFolders();
    console.log(`[SECURITY] Bot created new top-level folder/file and registered access: ${topLevelPath}`);
    return true;
  }

  return false;
}

// Risk scoring for proposed action
function assessActionRisk(action) {
  if (action.action === 'execute_command') {
    const cmd = (action.command || '').toLowerCase();

    // Hard block check
    const isBanned = config.bannedCommands.some(banned => {
      // Check word boundaries or general includes
      const regex = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(cmd) || cmd.includes(banned);
    });

    if (isBanned) {
      return { score: 10, level: 'CRITICAL', message: 'Contains a blacklisted/banned system command!' };
    }

    // Medium risks: installing modules, compiling, running scripts
    if (cmd.includes('npm install') || cmd.includes('pip install') || cmd.includes('git clone')) {
      return { score: 5, level: 'MEDIUM', message: 'Downloads and installs external code dependencies' };
    }

    if (cmd.includes('rm ') || cmd.includes('del ') || cmd.includes('remove-')) {
      return { score: 7, level: 'HIGH', message: 'Deletes local files or folders' };
    }

    // Default low risk execution
    return { score: 3, level: 'LOW', message: 'Standard command execution' };
  }

  if (action.action === 'open_application') {
    const target = (action.target || '').toLowerCase();
    if (target.endsWith('.exe') || target.endsWith('.bat') || target.endsWith('.cmd') || target.endsWith('.ps1')) {
      return { score: 6, level: 'MEDIUM', message: 'Launches local executable binary or script' };
    }
    return { score: 2, level: 'LOW', message: 'Opens application or resource' };
  }

  if (action.action === 'write_file') {
    const pathLower = (action.path || '').toLowerCase();
    if (pathLower.includes('.env') || pathLower.includes('config') || pathLower.includes('system32') || pathLower.includes('hosts')) {
      return { score: 8, level: 'HIGH', message: 'Modifies critical project configuration or system path' };
    }
    if (pathLower.endsWith('.js') || pathLower.endsWith('.py') || pathLower.endsWith('.ps1') || pathLower.endsWith('.bat') || pathLower.endsWith('.cmd')) {
      return { score: 6, level: 'MEDIUM', message: 'Writes executable code or script' };
    }
    return { score: 3, level: 'LOW', message: 'Writes data to file' };
  }

  return { score: 1, level: 'SAFE', message: 'Read-only or status operation' };
}

const { sanitizeWebContent, wrapUntrustedWebData } = require('./security/webSanitizer');

module.exports = {
  getSecurityRules: () => securityRules,
  loadSecurityRules,
  checkBannedWords,
  checkBannedWebsites,
  checkAndRegisterPath,
  assessActionRisk,
  setIdeWorkspace,
  getIdeWorkspace,
  sanitizeWebContent,
  wrapUntrustedWebData
};

