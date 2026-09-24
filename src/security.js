const fs = require('fs');
const path = require('path');
const { agentState, config, createdFolders, saveCreatedFolders, broadcastTerminal } = require('./state');

let securityRules = {
  bannedWords: [],
  bannedWebsites: [],
  allowedBaseFolders: ['scratch', 'By_Agent', 'Libraries']
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
      if (!securityRules.allowedBaseFolders || securityRules.allowedBaseFolders.length === 0) {
        securityRules.allowedBaseFolders = ['scratch', 'By_Agent', 'Libraries'];
      }
      console.log(`[SECURITY RULES LOADED] ${securityRules.bannedWords?.length || 0} banned words, ${securityRules.bannedWebsites?.length || 0} banned sites`);
    }
  } catch (e) {
    console.error("[ERROR] Failed to load security rules:", e);
  }
}
loadSecurityRules();

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

// Project root directory determination
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Core project relative paths and prefixes that the agent must NEVER access or modify
const PROTECTED_RELATIVE_PREFIXES = [
  'src',
  'server.js',
  'package.json',
  'package-lock.json',
  '.env',
  '.env.example',
  'public',
  'electron',
  'node_modules',
  '.git',
  '.container',
  'dockerfile',
  'docker-compose.yml',
  'wikilike',
  'genel_proje_bilgisi.md',
  'bundled_documentation.md',
  'bundle_docs.py',
  // Sensitive configuration files inside config/:
  'config/setup.json',
  'config/security_rules.json',
  'config/config.json',
  'config/kurucu.json',
  'config/permissions.json'
];

// System knowledge files that the agent or system is legitimately allowed to access
const ALLOWED_SYSTEM_EXCEPTIONS = [
  'config/system_prompt.txt',
  'config/memory.json',
  'agent_readme.md',
  '.agent-rules.md',
  'agent_user.json'
];

// Tripwire Safety Circuit Breaker Check (Task-Scoped with manual reset capability)
function checkTripwire(filePath) {
  if (!filePath) return { tripwireTriggered: false };

  const norm = filePath.replace(/\\/g, '/').toLowerCase().trim();
  const isAgentUserJson = norm === 'agent_user.json' || norm.endsWith('/agent_user.json');

  const currentTaskId = agentState.currentTaskId || 'current_session';

  // Case 1: If agent is reading agent_user.json
  if (isAgentUserJson) {
    agentState.hasReadAgentUserJson = true;
    agentState.tripwireArmedTaskId = currentTaskId;
    broadcastTerminal(`\n*** [SAFETY TRIPWIRE ARMED] 'agent_user.json' okundu. Acil durum devresi kuruldu (Task: ${currentTaskId}): Ajan bu oturumda bundan sonra başka herhangi bir dosya okursa sistem tarafından derhal durdurulacaktır. ***\n`);
    return { tripwireTriggered: false, isTripwireFile: true };
  }

  // Case 2: If agent already read agent_user.json within current task and now attempts to read another file
  if (agentState.hasReadAgentUserJson && agentState.tripwireArmedTaskId === currentTaskId) {
    agentState.status = 'failed';
    broadcastTerminal(`\n🚨🚨🚨 [EMERGENCY TRIPWIRE TRIGGERED] Ajan 'agent_user.json' okuduktan sonra başka bir dosya (${filePath}) okumaya kalkıştı! Potansiyel yapay zeka manipülasyonu / prompt injection tespiti nedeniyle ajan acil durum freniyle DERHAL DURDURULDU! 🚨🚨🚨\n`);
    return {
      tripwireTriggered: true,
      message: "ACİL DURUM GÜVENLİK FRENİ (TRIPWIRE): 'agent_user.json' okunduktan sonra sistem güvenliği gereği ikinci bir dosya okunamaz. Ajan döngüsü derhal durduruldu."
    };
  }

  return { tripwireTriggered: false };
}

// Manually reset Tripwire circuit breaker without server restart
function resetTripwire() {
  agentState.hasReadAgentUserJson = false;
  agentState.tripwireArmedTaskId = null;
  if (agentState.status === 'failed') {
    agentState.status = 'idle';
  }
  broadcastTerminal(`\n✓ [TRIPWIRE RESET] Tripwire güvenlik kilidi sıfırlandı. Sistem hazır durumuna döndürüldü.\n`);
  return { success: true, message: 'Tripwire güvenlik kilidi sıfırlandı.' };
}

// Strictly checks if a given file path resolves to any protected project code or sensitive asset
function isProtectedProjectFile(filePath) {
  if (!filePath) return false;

  const cwdResolved = path.resolve(agentState.cwd);
  let targetPath;
  try {
    targetPath = path.resolve(cwdResolved, filePath);
    if (fs.existsSync(targetPath)) {
      targetPath = fs.realpathSync(targetPath);
    }
  } catch (err) {
    targetPath = path.resolve(cwdResolved, filePath);
  }

  const targetLower = targetPath.toLowerCase();
  const rootLower = PROJECT_ROOT.toLowerCase();

  // 1. Check if target is explicitly an allowed system knowledge exception
  for (const allowed of ALLOWED_SYSTEM_EXCEPTIONS) {
    const allowedPath = path.join(rootLower, allowed.toLowerCase());
    if (targetLower === allowedPath) {
      return false; // Allowed knowledge file
    }
  }

  // 2. Check if inside PROJECT_ROOT
  const relToProject = path.relative(rootLower, targetLower);
  if (!relToProject.startsWith('..') && !path.isAbsolute(relToProject)) {
    const parts = relToProject.split(path.sep).filter(Boolean);
    if (parts.length === 0) {
      return true; // Root directory itself
    }
    const topLevel = parts[0].toLowerCase();
    const fullRel = relToProject.replace(/\\/g, '/').toLowerCase();

    for (const prot of PROTECTED_RELATIVE_PREFIXES) {
      const protLower = prot.toLowerCase();
      if (fullRel === protLower || fullRel.startsWith(protLower + '/')) {
        return true;
      }
      if (topLevel === protLower) {
        return true;
      }
    }
  }

  // 3. Block sensitive OS system paths
  const blockedOsPrefixes = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    '/etc', '/usr', '/bin', '/sbin', '/boot', '/system'
  ];
  if (blockedOsPrefixes.some(pref => targetLower.startsWith(pref))) {
    return true;
  }

  return false;
}

// Helper to check if file path access is allowed and register newly created folders
function checkAndRegisterPath(filePath, isWrite = false) {
  if (!filePath) return false;

  // STRICT GUARD: If path is a protected project file or folder, unconditionally block it!
  if (isProtectedProjectFile(filePath)) {
    console.log(`[SECURITY BLOCKED] Access to protected project core file rejected: ${filePath}`);
    return false;
  }

  const cwdResolved = path.resolve(agentState.cwd);
  let targetPath;
  try {
    targetPath = fs.realpathSync(path.resolve(cwdResolved, filePath));
  } catch (err) {
    targetPath = path.resolve(cwdResolved, filePath);
  }

  // === IDE WORKSPACE MODE ===
  // If an IDE workspace is set and target is inside it (and NOT a protected project file) → full access
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

  const topLevel = parts[0].toLowerCase();

  // Strict Write Restriction: Yazma yetkisi YALNIZCA 'scratch' ve 'By_Agent' klasörlerine verilir!
  // MemoryLibrary veya Libraries altındaki klasörler kesinlikle salt-okunurdur.
  if (isWrite && topLevel !== 'scratch' && topLevel !== 'by_agent') {
    console.log(`[SECURITY BLOCKED] Write access strictly forbidden outside scratch/By_Agent: ${filePath}`);
    return false;
  }

  // Whitelisted base folders from security rules
  const allowedBases = (securityRules.allowedBaseFolders || []).map(f => f.toLowerCase());
  if (allowedBases.includes(topLevel)) return true;

  // Allowed system knowledge files at root or config
  const fullRel = relative.replace(/\\/g, '/');
  if (ALLOWED_SYSTEM_EXCEPTIONS.some(ex => ex.toLowerCase() === fullRel.toLowerCase())) {
    return !isWrite; // Read-only for system knowledge files
  }

  const topLevelPath = path.join(rootDir, topLevel);

  // If it's a folder/file created by the bot in this session (inside allowed write spaces)
  if (createdFolders.has(topLevelPath)) return true;

  // If it doesn't exist on disk yet and we are writing, allow creation ONLY within scratch or by_agent
  if (isWrite && (topLevel === 'scratch' || topLevel === 'by_agent') && !fs.existsSync(topLevelPath)) {
    createdFolders.add(topLevelPath);
    saveCreatedFolders();
    console.log(`[SECURITY] Bot created new top-level folder/file and registered access: ${topLevelPath}`);
    return true;
  }

  return false;
}

// Helper to programmatically match rule exceptions (wildcards, filenames, or whole-word command options)
function checkRuleExceptionMatch(action, exceptions = []) {
  if (!exceptions || exceptions.length === 0) return false;
  const targetStr = [action.path, action.command, action.target, action.filename].filter(Boolean).join(' ').toLowerCase();
  const targetPath = (action.path || action.filename || '').toLowerCase().replace(/\\/g, '/');

  for (const exc of exceptions) {
    const cleanExc = String(exc).trim().toLowerCase().replace(/\\/g, '/');
    if (!cleanExc) continue;

    // 1. Wildcard pattern matching (e.g. *.tmp, test_*, build/*)
    if (cleanExc.includes('*')) {
      const reg = new RegExp('(^|[\\s/])' + cleanExc.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '($|[\\s/])', 'i');
      if (reg.test(targetStr) || reg.test(targetPath)) return true;
    }
    // 2. Exact filename / path component match
    else if (targetPath && (
      targetPath === cleanExc ||
      targetPath.endsWith('/' + cleanExc) ||
      path.basename(targetPath) === cleanExc
    )) {
      return true;
    }
    // 3. Whole-word / token match for commands or options (e.g. "git status", "--dry-run", "test")
    else {
      const wordReg = new RegExp(`(^|[\\s"'/\\\\])${cleanExc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s"'/\\\\])`, 'i');
      if (wordReg.test(targetStr)) return true;
    }
  }
  return false;
}

// Risk scoring for proposed action
function assessActionRisk(action) {
  if (!action) return { score: 1, level: 'SAFE', message: 'No action' };

  // 1. Direct file tool targets check
  if (['write_file', 'read_file', 'read_pdf', 'line_checker'].includes(action.action)) {
    const targetFile = action.path || action.filename;
    if (targetFile && isProtectedProjectFile(targetFile)) {
      return { score: 10, level: 'CRITICAL', message: `Unauthorized access to protected project core file: ${targetFile}` };
    }
  }

  // 2. Shell execution check
  if (action.action === 'execute_command') {
    const cmd = (action.command || '').toLowerCase();

    // Check if command references any protected project files
    for (const prot of PROTECTED_RELATIVE_PREFIXES) {
      const p = prot.toLowerCase();
      const regex = new RegExp(`(^|[\\s"'/\\\\])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s"'/\\\\])`, 'i');
      if (regex.test(cmd) || cmd.includes(p)) {
        return { score: 10, level: 'CRITICAL', message: `Command references protected project file: ${prot}` };
      }
    }

    // Hard block check for banned system commands
    const isBanned = config.bannedCommands.some(banned => {
      const regex = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(cmd) || cmd.includes(banned);
    });

    if (isBanned) {
      return { score: 10, level: 'CRITICAL', message: 'Contains a blacklisted/banned system command!' };
    }

    // Hard block check for network egress / data exfiltration commands
    const EGRESS_COMMAND_PATTERNS = [
      /\bcurl\b/i,
      /\bwget\b/i,
      /\binvoke-webrequest\b/i,
      /\biwr\b/i,
      /\binvoke-restmethod\b/i,
      /\birm\b/i,
      /\bstart-bitstransfer\b/i,
      /\bbitsadmin\b/i,
      /\bcertutil(\.exe)?\s+.*-(split|urlcache)\b/i,
      /\b(nc|ncat|netcat)\b/i,
      /\btelnet\b/i
    ];
    const isEgress = EGRESS_COMMAND_PATTERNS.some(pattern => pattern.test(cmd));
    if (isEgress) {
      return { score: 10, level: 'CRITICAL', message: 'Command attempts unauthorized external network connection or data transfer (exfiltration prevention)!' };
    }

    // Programmatic check: Verified rule exceptions in memory.json
    try {
      const memoryFilePath = path.join(__dirname, '..', 'config', 'memory.json');
      if (fs.existsSync(memoryFilePath)) {
        const rawMem = JSON.parse(fs.readFileSync(memoryFilePath, 'utf-8'));
        const activeRules = Array.isArray(rawMem) ? rawMem.filter(m => m.isRule) : (rawMem.memories || []).filter(m => m.isRule);
        for (const r of activeRules) {
          if (r.exceptions && checkRuleExceptionMatch(action, r.exceptions)) {
            console.log(`[SECURITY EXCEPTION] Action matched verified rule exception: "${r.rule}"`);
            return { score: 3, level: 'LOW', message: `Permitted under verified rule exception: ${r.rule}` };
          }
        }
      }
    } catch {}

    // Dangerous destructive shell commands check
    const destructiveVerbs = [
      'rm ', 'del ', 'erase ', 'rd ', 'rmdir ', 'remove-item', 'unlink',
      'clear-content', 'set-content', 'out-file', 'kill ', 'stop-process',
      'taskkill', 'format ', 'diskpart'
    ];
    for (const verb of destructiveVerbs) {
      if (cmd.includes(verb)) {
        return { score: 10, level: 'CRITICAL', message: `Command contains potentially destructive operation: ${verb.trim()}` };
      }
    }

    // Medium risks: installing modules, compiling, running scripts
    if (cmd.includes('npm install') || cmd.includes('pip install') || cmd.includes('git clone')) {
      return { score: 5, level: 'MEDIUM', message: 'Downloads and installs external code dependencies' };
    }

    // Default low risk execution
    return { score: 3, level: 'LOW', message: 'Standard command execution' };
  }

  if (action.action === 'open_application') {
    const target = (action.target || '').toLowerCase();
    if (isProtectedProjectFile(target)) {
      return { score: 10, level: 'CRITICAL', message: `Cannot launch or open protected project file: ${action.target}` };
    }
    if (target.endsWith('.exe') || target.endsWith('.bat') || target.endsWith('.cmd') || target.endsWith('.ps1')) {
      return { score: 6, level: 'MEDIUM', message: 'Launches local executable binary or script' };
    }
    return { score: 2, level: 'LOW', message: 'Opens application or resource' };
  }

  if (action.action === 'write_file') {
    const pathLower = (action.path || '').toLowerCase();
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
  isProtectedProjectFile,
  checkTripwire,
  resetTripwire,
  assessActionRisk,
  setIdeWorkspace,
  getIdeWorkspace,
  sanitizeWebContent,
  wrapUntrustedWebData
};

