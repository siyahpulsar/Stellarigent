const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const {
  agentState,
  config,
  broadcastState,
  broadcastTerminal,
  addMessage,
  getLmStudioEndpoint,
  setTerminalOutputHook,
  onStateChange
} = require('../state');

const {
  resolvePendingAction,
  getPendingAction,
  runAgentLoop,
  runManuelTool,
  runResearchTool,
  initializeIdeTaskContext,
  runIdeSwarmLoop
} = require('../agent');

const { resetTripwire, checkBannedWords } = require('../security');
const modelManager = require('../llm/modelManager');

// ANSI Colors for clean terminal UI
const C = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m'
};

let rl = null;
let isApprovalDisplayed = false;
let isInitialized = false;

/**
 * Returns the dynamic prompt string based on current agent state
 */
function getPromptString() {
  const mode = agentState.activeMode || 'agent';
  const sub = agentState.activeSubMode && agentState.activeSubMode !== 'none' ? `/${agentState.activeSubMode}` : '';
  const status = agentState.status || 'idle';

  let statusColor = C.gray;
  if (status === 'thinking' || status === 'executing') statusColor = C.cyan;
  else if (status === 'pending_approval') statusColor = C.yellow;
  else if (status === 'completed') statusColor = C.green;
  else if (status === 'failed') statusColor = C.red;

  if (status === 'pending_approval') {
    return `${C.bright}${C.yellow}Stellarigent [APPROVAL REQUIRED] (y/n)> ${C.reset}`;
  }

  return `${C.bright}${C.cyan}Stellarigent${C.reset} [${C.white}${mode}${sub}${C.reset} | ${statusColor}${status}${C.reset}]> `;
}

/**
 * Renders an alert box when tool approval is requested
 */
function displayApprovalCard(action) {
  if (!action) return;
  isApprovalDisplayed = true;

  const toolName = action.action || 'unknown_tool';
  const riskLevel = (action.risk && action.risk.level) || 'MEDIUM';
  const explanation = action.explanation || 'No explanation provided.';

  let riskColor = C.green;
  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') riskColor = C.red;
  else if (riskLevel === 'MEDIUM') riskColor = C.yellow;

  const target = action.command || action.path || action.query || action.url || action.appName || '';

  console.log(`\n${C.yellow}╔══════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.yellow}║  ${C.bright}${C.yellow}⚠️  TOOL EXECUTION APPROVAL REQUIRED${C.reset}${C.yellow}${' '.repeat(38)}║${C.reset}`);
  console.log(`${C.yellow}╠══════════════════════════════════════════════════════════════════════════════╣${C.reset}`);
  console.log(`${C.yellow}║${C.reset}  ${C.bright}Tool:${C.reset}        ${C.cyan}${toolName}${C.reset}`);
  if (target) {
    console.log(`${C.yellow}║${C.reset}  ${C.bright}Target/Cmd:${C.reset}  ${C.white}${target}${C.reset}`);
  }
  console.log(`${C.yellow}║${C.reset}  ${C.bright}Risk Level:${C.reset}  ${riskColor}${riskLevel}${C.reset}`);
  console.log(`${C.yellow}║${C.reset}  ${C.bright}Reason:${C.reset}      ${C.dim}${explanation}${C.reset}`);
  console.log(`${C.yellow}╠══════════════════════════════════════════════════════════════════════════════╣${C.reset}`);
  console.log(`${C.yellow}║${C.reset}  ${C.green}:y${C.reset} / ${C.green}y${C.reset} / ${C.green}:approve${C.reset}       -> Approve action`);
  console.log(`${C.yellow}║${C.reset}  ${C.red}:n [reason]${C.reset} / ${C.red}:reject [reason]${C.reset} -> Reject action with feedback`);
  console.log(`${C.yellow}║${C.reset}  ${C.blue}:edit <json>${C.reset}           -> Modify action payload and approve`);
  console.log(`${C.yellow}╚══════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  if (rl) {
    rl.setPrompt(getPromptString());
    rl.prompt(true);
  }
}

/**
 * Displays the main help and navigation menu
 */
function showHelpMenu() {
  console.log(`\n${C.bright}${C.cyan}╔══════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bright}${C.cyan}║                   STELLARIGENT TERMINAL CONTROLLER                           ║${C.reset}`);
  console.log(`${C.bright}${C.cyan}╠══════════════════════════════════════════════════════════════════════════════╣${C.reset}`);
  console.log(`${C.cyan}║${C.reset} ${C.bright}1. NAVIGATION & MODES (:mode <name>):${C.reset}`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:mode agent${C.reset}             Autonomous IDE Swarm (Planner + Developer + Checker)`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:mode manuel${C.reset}            Direct single-tool execution (no task list)`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:mode research${C.reset}          Web / Local / Deep Web research pipeline`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:mode library${C.reset}           MemoryLibrary knowledge manager & SGM upsert`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:submode <name>${C.reset}         Set submode (e.g. cmd_tool, file_reader, deep_web)`);
  console.log(`${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}║${C.reset} ${C.bright}2. CONFIGURATION & SETTINGS:${C.reset}`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:settings${C.reset} or ${C.green}:config${C.reset}    View current settings and runtime flags`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:set <key> <val>${C.reset}        Update setting (temperature, maxSteps, hpmMode, ...)`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:autoapprove <tool> <t|f>${C.reset} Toggle auto-approval for a tool`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:models${C.reset}                 List models available in LM Studio`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:switch-model <id>${C.reset}      Switch active LLM model in LM Studio`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:tripwire reset${C.reset}         Reset tripwire safety circuit breaker`);
  console.log(`${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}║${C.reset} ${C.bright}3. TASK EXECUTION & PROMPT ENTRY:${C.reset}`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}<prompt text>${C.reset}           Type any prompt directly to run in active mode`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:task <text>${C.reset}            Explicitly submit a task`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:interrupt <text>${C.reset}       Inject mid-task instruction into reasoning`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:abort${C.reset}                  Instantly terminate running task & processes`);
  console.log(`${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}║${C.reset} ${C.bright}4. APPROVALS & SECURITY:${C.reset}`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:y${C.reset} or ${C.green}:approve${C.reset}          Approve pending tool action`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:n [reason]${C.reset} / ${C.green}:reject${C.reset}    Reject pending tool action with feedback`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:rules${C.reset}                  List pending security rules`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:approve-rule <id>${C.reset}      Approve proposed security rule`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:reject-rule <id>${C.reset}       Reject proposed security rule`);
  console.log(`${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}║${C.reset} ${C.bright}5. DIAGNOSTICS & SYSTEM:${C.reset}`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:status${C.reset}                 Display agent status, thoughts, executed tools`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:history [n]${C.reset}            Display last n messages`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:health${C.reset}                 Run system health check (/api/health)`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:eval${C.reset}                   Run deterministic benchmark evaluation suite`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:test${C.reset} or ${C.green}:regression${C.reset}     Run automated master system regression suite`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:clear${C.reset}                  Clear chat messages and reset agent state`);
  console.log(`${C.cyan}║${C.reset}   ${C.green}:exit${C.reset} or ${C.green}:quit${C.reset}          Shut down server and exit`);
  console.log(`${C.bright}${C.cyan}╚══════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);
}

/**
 * Displays current settings and config in a table
 */
function showSettings() {
  console.log(`\n${C.bright}${C.yellow}── STELLARIGENT CONFIGURATION ─────────────────────────────────────────${C.reset}`);
  console.log(`  ${C.bright}LM Studio URL:${C.reset}         ${config.lmStudioUrl || 'http://127.0.0.1:1234/v1'}`);
  console.log(`  ${C.bright}Active Model:${C.reset}          ${config.modelName || 'qwen2.5-coder-7b-instruct'}`);
  console.log(`  ${C.bright}Temperature:${C.reset}           ${config.temperature}`);
  console.log(`  ${C.bright}Max Steps:${C.reset}             ${config.maxSteps}`);
  console.log(`  ${C.bright}Max Context Messages:${C.reset}  ${config.maxContextMessages}`);
  console.log(`  ${C.bright}High Param Mode (HPM):${C.reset} ${config.hpmMode ? C.green + 'ENABLED' : C.gray + 'DISABLED'}${C.reset}`);
  console.log(`  ${C.bright}Low Param Mode (LPM):${C.reset}  ${config.lpmMode ? C.green + 'ENABLED' : C.gray + 'DISABLED'}${C.reset}`);
  console.log(`  ${C.bright}Sequential Goal (SGM):${C.reset} ${config.sgmMode ? C.green + 'ENABLED' : C.gray + 'DISABLED'}${C.reset}`);
  console.log(`  ${C.bright}SiMBA Embeddings:${C.reset}      ${config.simbaEnabled ? C.green + 'ENABLED' : C.gray + 'DISABLED'}${C.reset}`);
  console.log(`  ${C.bright}Model Switching:${C.reset}       ${config.modelSwitchingEnabled ? C.green + 'ENABLED' : C.gray + 'DISABLED'}${C.reset}`);
  console.log(`  ${C.bright}Tripwire Armed:${C.reset}        ${agentState.hasReadAgentUserJson ? C.red + 'TRIGGERED' : C.green + 'CLEAN'}${C.reset}`);
  console.log(`  ${C.bright}Active Mode / Sub:${C.reset}     ${agentState.activeMode} / ${agentState.activeSubMode}`);

  console.log(`\n  ${C.bright}Auto-Approvals:${C.reset}`);
  if (config.autoApprove) {
    Object.entries(config.autoApprove).forEach(([tool, val]) => {
      const mark = val ? `${C.green}✓ ON ` : `${C.red}✗ OFF`;
      console.log(`    - ${tool.padEnd(22)} : ${mark}${C.reset}`);
    });
  }

  console.log(`\n  ${C.bright}Cost Metrics:${C.reset}`);
  const cost = (agentState.metrics && agentState.metrics.cost) || {};
  console.log(`    Total USD: $${(cost.totalCostUSD || 0).toFixed(4)} | Daily USD: $${(cost.dailyCostUSD || 0).toFixed(4)} / $${(cost.dailyLimitUSD || 1.0).toFixed(2)}`);
  console.log(`    Tokens: Total: ${cost.totalTokens || 0} (Prompt: ${cost.promptTokens || 0}, Comp: ${cost.completionTokens || 0})`);
  console.log(`${C.yellow}───────────────────────────────────────────────────────────────────────${C.reset}\n`);
}

/**
 * Displays agent status, active task, thoughts, and plan steps
 */
function showStatus() {
  console.log(`\n${C.bright}${C.cyan}── AGENT RUNTIME STATUS ────────────────────────────────────────────────${C.reset}`);
  console.log(`  ${C.bright}Status:${C.reset}       ${agentState.status}`);
  console.log(`  ${C.bright}Active Mode:${C.reset}  ${agentState.activeMode} (${agentState.activeSubMode || 'none'})`);
  console.log(`  ${C.bright}CWD Workspace:${C.reset}${agentState.cwd}`);
  console.log(`  ${C.bright}Current Task:${C.reset} ${agentState.task || 'None'}`);

  if (agentState.planSteps && agentState.planSteps.length > 0) {
    console.log(`\n  ${C.bright}Checklist Steps (${agentState.planSteps.length}):${C.reset}`);
    agentState.planSteps.forEach((step, idx) => {
      let icon = C.gray + '○';
      if (step.status === 'completed') icon = C.green + '✓';
      else if (step.status === 'current') icon = C.yellow + '▶';
      console.log(`    ${icon} ${C.reset}[${idx + 1}] ${step.text} ${C.dim}(${step.status})${C.reset}`);
    });
  }

  if (agentState.executedTools && agentState.executedTools.length > 0) {
    console.log(`\n  ${C.bright}Executed Tools (${agentState.executedTools.length}):${C.reset}`);
    agentState.executedTools.slice(-10).forEach(t => console.log(`    • ${C.cyan}${t}${C.reset}`));
  }

  if (agentState.thoughts && agentState.thoughts.length > 0) {
    console.log(`\n  ${C.bright}Latest Thought:${C.reset}`);
    const lastThought = agentState.thoughts[agentState.thoughts.length - 1];
    console.log(`    ${C.dim}${lastThought}${C.reset}`);
  }

  if (agentState.pendingAction) {
    console.log(`\n  ${C.bright}${C.yellow}Pending Action:${C.reset} ${agentState.pendingAction.action}`);
  }
  console.log(`${C.cyan}───────────────────────────────────────────────────────────────────────${C.reset}\n`);
}

/**
 * Displays recent chat messages
 */
function showHistory(countStr) {
  const count = parseInt(countStr, 10) || 10;
  const messages = agentState.messages || [];
  if (messages.length === 0) {
    console.log(`\n${C.dim}[No messages in chat history]${C.reset}\n`);
    return;
  }

  const slice = messages.slice(-count);
  console.log(`\n${C.bright}${C.blue}── RECENT CHAT MESSAGES (${slice.length}/${messages.length}) ────────────────────────────${C.reset}`);
  slice.forEach(msg => {
    let roleColor = C.cyan;
    if (msg.role === 'user') roleColor = C.green;
    else if (msg.role === 'system') roleColor = C.yellow;

    const sender = msg.agentRole ? `${msg.role} (${msg.agentRole})` : msg.role;
    console.log(`  ${roleColor}${C.bright}[${sender.toUpperCase()}]:${C.reset}`);
    const lines = (msg.content || '').split('\n').slice(0, 8);
    lines.forEach(l => console.log(`    ${l}`));
    if ((msg.content || '').split('\n').length > 8) {
      console.log(`    ${C.dim}... [truncated] ...${C.reset}`);
    }
  });
  console.log(`${C.blue}───────────────────────────────────────────────────────────────────────${C.reset}\n`);
}

/**
 * Executes a task in the active mode
 */
async function dispatchTask(taskContent) {
  const trimmed = taskContent.trim();
  if (!trimmed) return;

  if (agentState.status !== 'idle' && agentState.status !== 'completed' && agentState.status !== 'failed') {
    console.log(`${C.red}❌ Agent is currently busy (${agentState.status}). Use :abort to stop first.${C.reset}`);
    return;
  }

  const banned = checkBannedWords(trimmed);
  if (banned) {
    console.log(`${C.red}❌ Security Block: Task contains banned keyword "${banned}"!${C.reset}`);
    return;
  }

  console.log(`\n${C.bright}${C.green}▶ Starting task in [${agentState.activeMode}] mode:${C.reset} "${trimmed}"\n`);
  agentState.task = trimmed;

  const mode = agentState.activeMode || 'agent';

  try {
    if (mode === 'manuel') {
      agentState.messages = [];
      await runManuelTool(trimmed);
    } else if (mode === 'research') {
      const sub = agentState.activeSubMode || 'web';
      if (sub === 'deep_web') {
        const { runDeepWebSearch } = require('../tools/web');
        agentState.status = 'thinking';
        agentState.messages = [];
        agentState.planSteps = [];
        broadcastState();
        addMessage('user', trimmed);
        const res = await runDeepWebSearch(trimmed, 20);
        const reply = (res && res.message) ? res.message : JSON.stringify(res, null, 2);
        addMessage('assistant', reply, 'Deep Research');
        agentState.status = 'completed';
        broadcastState();
      } else {
        await runResearchTool(trimmed);
      }
    } else if (mode === 'library') {
      const { processLibraryTask } = require('../modes/libraryMode');
      agentState.status = 'thinking';
      broadcastState();
      await processLibraryTask(trimmed, agentState.activeSubMode || 'search');
      agentState.status = 'idle';
      broadcastState();
    } else {
      // Default: Autonomous IDE Swarm Loop
      await initializeIdeTaskContext(trimmed);
      runIdeSwarmLoop();
    }
  } catch (err) {
    console.error(`${C.red}Task execution error: ${err.message}${C.reset}`);
    agentState.status = 'failed';
    broadcastState();
  }
}

/**
 * Handles terminal command lines
 */
async function handleCommandLine(line) {
  const input = line.trim();
  if (!input) {
    if (rl) rl.prompt();
    return;
  }

  // Check if we are currently awaiting approval
  if (agentState.status === 'pending_approval') {
    const lower = input.toLowerCase();
    if (lower === ':y' || lower === 'y' || lower === 'yes' || lower === ':approve') {
      console.log(`${C.green}✓ Action approved by terminal user.${C.reset}`);
      isApprovalDisplayed = false;
      resolvePendingAction({ approved: true, action: agentState.pendingAction });
      if (rl) rl.prompt();
      return;
    } else if (lower === ':n' || lower === 'n' || lower === 'no' || lower.startsWith(':reject') || lower.startsWith('reject')) {
      let reason = 'Rejected by terminal user.';
      if (input.startsWith(':reject ')) reason = input.substring(8).trim();
      else if (input.startsWith('reject ')) reason = input.substring(7).trim();
      else if (input.startsWith(':n ')) reason = input.substring(3).trim();
      else if (input.startsWith('n ')) reason = input.substring(2).trim();

      console.log(`${C.red}✗ Action rejected by terminal user with reason: "${reason}"${C.reset}`);
      isApprovalDisplayed = false;
      resolvePendingAction({ approved: false, feedback: reason });
      if (rl) rl.prompt();
      return;
    } else if (input.startsWith(':edit ')) {
      try {
        const jsonStr = input.substring(6).trim();
        const edited = JSON.parse(jsonStr);
        console.log(`${C.blue}✎ Action payload modified and approved.${C.reset}`);
        isApprovalDisplayed = false;
        resolvePendingAction({ approved: true, action: edited });
      } catch (e) {
        console.log(`${C.red}Invalid JSON payload for edit: ${e.message}${C.reset}`);
      }
      if (rl) rl.prompt();
      return;
    }
  }

  // Not pending approval, or user entered a system command with ':'
  if (input.startsWith(':')) {
    const parts = input.substring(1).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const rest = input.substring(input.indexOf(parts[0]) + parts[0].length).trim();

    switch (cmd) {
      case 'help':
      case 'menu':
        showHelpMenu();
        break;

      case 'mode': {
        const targetMode = args[0] ? args[0].toLowerCase() : '';
        const validModes = ['agent', 'manuel', 'research', 'library'];
        if (validModes.includes(targetMode)) {
          agentState.activeMode = targetMode;
          // Set sensible default submode
          if (targetMode === 'manuel') agentState.activeSubMode = 'cmd_tool';
          else if (targetMode === 'research') agentState.activeSubMode = 'web';
          else if (targetMode === 'library') agentState.activeSubMode = 'search';
          else agentState.activeSubMode = 'none';

          broadcastState();
          console.log(`${C.green}✓ Active mode set to: ${targetMode} (submode: ${agentState.activeSubMode})${C.reset}`);
        } else {
          console.log(`${C.yellow}Unknown mode "${targetMode}". Valid modes: ${validModes.join(', ')}${C.reset}`);
        }
        break;
      }

      case 'submode': {
        const sub = args[0] ? args[0].toLowerCase() : 'none';
        agentState.activeSubMode = sub;
        broadcastState();
        console.log(`${C.green}✓ Active submode set to: ${sub}${C.reset}`);
        break;
      }

      case 'settings':
      case 'config':
        showSettings();
        break;

      case 'set': {
        if (args.length < 2) {
          console.log(`${C.yellow}Usage: :set <key> <value> (e.g. :set temperature 0.3, :set hpmMode true)${C.reset}`);
          break;
        }
        const key = args[0];
        let val = args.slice(1).join(' ');
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(Number(val))) val = Number(val);

        config[key] = val;

        // Persist to config.json if top-level
        const configPath = path.join(process.cwd(), 'config', 'config.json');
        try {
          if (fs.existsSync(configPath)) {
            let parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsed[0][key] = val;
              fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
            }
          }
        } catch (e) {}

        broadcastState();
        console.log(`${C.green}✓ Config updated: ${key} = ${JSON.stringify(val)}${C.reset}`);
        break;
      }

      case 'autoapprove': {
        if (args.length < 2) {
          console.log(`${C.yellow}Usage: :autoapprove <toolName> <true|false>${C.reset}`);
          break;
        }
        const tool = args[0];
        const enable = args[1].toLowerCase() === 'true' || args[1] === '1' || args[1] === 'on';
        if (!config.autoApprove) config.autoApprove = {};
        config.autoApprove[tool] = enable;

        const configPath = path.join(process.cwd(), 'config', 'config.json');
        try {
          if (fs.existsSync(configPath)) {
            let parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsed[0].autoApprove = config.autoApprove;
              fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
            }
          }
        } catch (e) {}

        broadcastState();
        console.log(`${C.green}✓ Auto-approve for "${tool}" set to: ${enable}${C.reset}`);
        break;
      }

      case 'models': {
        console.log(`\n${C.cyan}Querying LM Studio models...${C.reset}`);
        try {
          const endpoint = getLmStudioEndpoint('/models');
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch(endpoint, { signal: ctrl.signal });
          clearTimeout(tid);
          if (!res.ok) {
            console.log(`${C.red}LM Studio responded with HTTP ${res.status}${C.reset}`);
            break;
          }
          const data = await res.json();
          const list = data.data || [];
          console.log(`${C.green}Loaded / Available Models in LM Studio (${list.length}):${C.reset}`);
          list.forEach((m, idx) => {
            const activeMark = m.id === config.modelName ? ` ${C.yellow}★ [ACTIVE]${C.reset}` : '';
            console.log(`  [${idx + 1}] ${m.id}${activeMark}`);
          });
        } catch (err) {
          console.log(`${C.red}Failed to fetch models from LM Studio: ${err.message}${C.reset}`);
        }
        break;
      }

      case 'switch-model': {
        if (!args[0]) {
          console.log(`${C.yellow}Usage: :switch-model <modelId>${C.reset}`);
          break;
        }
        const targetModel = args.join(' ').trim();
        console.log(`\n${C.cyan}Switching LM Studio model to: "${targetModel}"...${C.reset}`);
        try {
          const ok = await modelManager.switchToModel(targetModel);
          if (ok) {
            config.modelName = targetModel;
            broadcastState();
            console.log(`${C.green}✓ Model successfully switched to: ${targetModel}${C.reset}`);
          } else {
            console.log(`${C.red}Model switch failed or timed out.${C.reset}`);
          }
        } catch (err) {
          console.log(`${C.red}Error switching model: ${err.message}${C.reset}`);
        }
        break;
      }

      case 'tripwire': {
        if (args[0] === 'reset') {
          const res = resetTripwire();
          console.log(`${C.green}✓ ${res.message}${C.reset}`);
          broadcastState();
        } else {
          console.log(`${C.yellow}Usage: :tripwire reset${C.reset}`);
        }
        break;
      }

      case 'task': {
        if (!rest) {
          console.log(`${C.yellow}Usage: :task <task prompt text>${C.reset}`);
          break;
        }
        await dispatchTask(rest);
        break;
      }

      case 'interrupt': {
        if (!rest) {
          console.log(`${C.yellow}Usage: :interrupt <instruction>${C.reset}`);
          break;
        }
        if (agentState.status === 'thinking' || agentState.status === 'executing' || agentState.status === 'pending_approval') {
          agentState.ideInterrupted = rest;
          addMessage('user', `[INTERRUPT] User provided new instruction mid-task:\n"${rest}"`);
          console.log(`${C.yellow}⚠ Mid-task instruction injected!${C.reset}`);
          if (agentState.status === 'pending_approval') {
            resolvePendingAction({ approved: false, feedback: `Task was interrupted with new instruction: "${rest}"` });
          }
        } else {
          console.log(`${C.dim}Agent is not actively running a task.${C.reset}`);
        }
        break;
      }

      case 'abort': {
        console.log(`\n${C.yellow}⚠ Aborting active task...${C.reset}`);
        if (agentState.activeCommandProcess) {
          try {
            agentState.activeCommandProcess.kill();
            console.log(`  ${C.dim}Active subprocess killed.${C.reset}`);
          } catch (e) {}
        }
        agentState.status = 'idle';
        agentState.pendingAction = null;
        resolvePendingAction({ approved: false, feedback: 'Aborted by terminal user' });
        addMessage('system', 'Task execution was aborted by the user via terminal.');
        broadcastState();
        console.log(`${C.green}✓ Agent reset to idle.${C.reset}\n`);
        break;
      }

      case 'status':
        showStatus();
        break;

      case 'history':
        showHistory(args[0]);
        break;

      case 'health': {
        console.log(`\n${C.cyan}Running System Health Check (/api/health)...${C.reset}`);
        try {
          const http = require('http');
          http.get('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                console.log(`${C.green}Health Status: ${parsed.status.toUpperCase()}${C.reset}`);
                if (parsed.checks) {
                  Object.entries(parsed.checks).forEach(([k, v]) => {
                    const statusColor = v.status === 'ok' ? C.green : C.yellow;
                    console.log(`  - ${k.padEnd(16)}: ${statusColor}${v.status}${C.reset} ${v.detail ? '(' + v.detail + ')' : ''}`);
                  });
                }
              } catch (e) {
                console.log(data);
              }
              if (rl) rl.prompt();
            });
          }).on('error', err => {
            console.log(`${C.red}Health check error: ${err.message}${C.reset}`);
            if (rl) rl.prompt();
          });
          return;
        } catch (e) {
          console.log(`${C.red}Health check error: ${e.message}${C.reset}`);
        }
        break;
      }

      case 'eval': {
        console.log(`\n${C.bright}${C.magenta}▶ Spawning Deterministic Evaluation Suite (node evals/run_evals.js)...${C.reset}\n`);
        if (rl) rl.pause();
        const evalChild = spawn('node', ['evals/run_evals.js'], {
          stdio: 'inherit',
          shell: true
        });
        evalChild.on('close', (code) => {
          console.log(`\n${C.cyan}[EVAL FINISHED with exit code ${code}]${C.reset}\n`);
          if (rl) {
            rl.resume();
            rl.setPrompt(getPromptString());
            rl.prompt();
          }
        });
        return;
      }

      case 'rules': {
        const { getPendingRules } = require('../memory');
        const pending = getPendingRules();
        if (pending.length === 0) {
          console.log(`\n${C.dim}[No pending security rules awaiting approval]${C.reset}\n`);
        } else {
          console.log(`\n${C.bright}${C.yellow}Pending Security Rules (${pending.length}):${C.reset}`);
          pending.forEach(r => {
            console.log(`  [ID: ${r.id}] Category: ${r.category}`);
            console.log(`    Rule: "${r.rule}"`);
            console.log(`    Context: ${r.context}`);
          });
          console.log(`  Use :approve-rule <id> or :reject-rule <id>\n`);
        }
        break;
      }

      case 'approve-rule': {
        if (!args[0]) {
          console.log(`${C.yellow}Usage: :approve-rule <ruleId>${C.reset}`);
          break;
        }
        const { handleApprovePendingRule } = require('../ws/settingsHandler');
        await handleApprovePendingRule({ ruleId: args[0] }, { send: () => {} });
        console.log(`${C.green}✓ Rule ${args[0]} approved and committed to memory.${C.reset}`);
        break;
      }

      case 'reject-rule': {
        if (!args[0]) {
          console.log(`${C.yellow}Usage: :reject-rule <ruleId>${C.reset}`);
          break;
        }
        const { handleRejectPendingRule } = require('../ws/settingsHandler');
        await handleRejectPendingRule({ ruleId: args[0] }, { send: () => {} });
        console.log(`${C.red}✗ Rule ${args[0]} rejected and discarded.${C.reset}`);
        break;
      }

      case 'test':
      case 'regression': {
        console.log(`\n${C.cyan}▶ Executing Master System Regression Suite...${C.reset}\n`);
        const { runMasterRegressionSuite } = require('../../evals/system_regression_suite');
        try {
          await runMasterRegressionSuite();
        } catch (err) {
          console.error(`${C.red}Test error: ${err.message}${C.reset}`);
        }
        break;
      }

      case 'eval': {
        console.log(`\n${C.cyan}▶ Executing Deterministic Benchmark Evaluation Suite...${C.reset}\n`);
        const { scenarios } = require('../../evals/scenarios');
        console.log(`Running ${scenarios.length} benchmark scenarios...\n`);
        let passCount = 0;
        for (const sc of scenarios) {
          try {
            const res = await sc.run();
            if (res.pass) {
              passCount++;
              console.log(`  ${C.green}✔ PASS${C.reset} [${sc.category}] ${sc.name}`);
            } else {
              console.log(`  ${C.red}✗ FAIL${C.reset} [${sc.category}] ${sc.name} (${res.detail})`);
            }
          } catch (e) {
            console.log(`  ${C.red}✗ ERROR${C.reset} [${sc.category}] ${sc.name} (${e.message})`);
          }
        }
        console.log(`\n${C.bright}${C.green}Benchmark Complete: ${passCount}/${scenarios.length} passed.${C.reset}\n`);
        break;
      }

      case 'clear':
        agentState.messages = [];
        agentState.status = 'idle';
        agentState.task = null;
        agentState.pendingAction = null;
        broadcastState();
        console.log(`${C.green}✓ Chat messages cleared and agent state reset.${C.reset}`);
        break;

      case 'exit':
      case 'quit':
        console.log(`\n${C.cyan}Shutting down Stellarigent... Goodbye!${C.reset}\n`);
        process.exit(0);
        break;

      default:
        console.log(`${C.yellow}Unknown command ":${cmd}". Type :help or :menu for available commands.${C.reset}`);
        break;
    }
  } else {
    // Treat plain text as a prompt/task in active mode!
    await dispatchTask(input);
  }

  if (rl) {
    rl.setPrompt(getPromptString());
    rl.prompt();
  }
}

/**
 * Initializes the Terminal CLI Controller
 */
function initTerminalController() {
  if (isInitialized) return;
  isInitialized = true;

  // Stream broadcastTerminal logs directly to stdout cleanly
  setTerminalOutputHook((data) => {
    // Write out the message
    process.stdout.write(data);
  });

  // Listen for agent status changes to update prompt and approvals
  onStateChange((state) => {
    if (state.status === 'pending_approval' && state.pendingAction && !isApprovalDisplayed) {
      displayApprovalCard(state.pendingAction);
    } else if (state.status !== 'pending_approval') {
      isApprovalDisplayed = false;
    }
    if (rl) {
      rl.setPrompt(getPromptString());
    }
  });

  // Setup readline interface on process.stdin / process.stdout
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPromptString(),
    terminal: process.stdin.isTTY
  });

  rl.on('line', async (line) => {
    try {
      await handleCommandLine(line);
    } catch (err) {
      console.error(`${C.red}CLI Error: ${err.message}${C.reset}`);
      if (rl) rl.prompt();
    }
  });

  rl.on('close', () => {
    console.log(`\n${C.dim}[Terminal input closed]${C.reset}`);
  });

  // Welcome Banner
  console.log(`\n${C.bright}${C.green}======================================================================${C.reset}`);
  console.log(`${C.bright}${C.cyan}  ★ STELLARIGENT INTERACTIVE TERMINAL CONTROLLER INITIALIZED ★${C.reset}`);
  console.log(`${C.green}======================================================================${C.reset}`);
  console.log(`  ${C.white}• Type ${C.green}:help${C.white} or ${C.green}:menu${C.white} to list all interactive commands & modes.${C.reset}`);
  console.log(`  ${C.white}• Type ${C.green}:settings${C.white} to inspect runtime models, prompts & auto-approvals.${C.reset}`);
  console.log(`  ${C.white}• Type any task directly (or ${C.green}:task <text>${C.white}) to execute in active mode.${C.reset}`);
  console.log(`  ${C.white}• Approvals: respond with ${C.green}:y${C.white} or ${C.red}:n [reason]${C.white} whenever required.${C.reset}`);
  console.log(`${C.green}======================================================================${C.reset}\n`);

  rl.prompt();
}

module.exports = {
  initTerminalController,
  displayApprovalCard,
  getPromptString,
  handleCommandLine
};
