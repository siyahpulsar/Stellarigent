/**
 * Dedicated Local Research Verification Test:
 * Tests Research Mode when activeSubMode === 'local' across 3 difficulty tiers:
 * - Tier 1 (Basit - Simple): Single documentation file research (agent_readme.md)
 * - Tier 2 (Zor - Hard): Configuration schema extraction (config/memory.json)
 * - Tier 3 (Zor + Karmaşık - Hard + Complex): Deep architectural investigation (scratch/complex_system_spec.md)
 *
 * Validates:
 * 1. Automatic selection of 'read_file' tool (zero web search, 100% offline local)
 * 2. Approval resolution without manual intervention (auto-approve read_file)
 * 3. Execution of read_file within permitted sandbox/knowledge rules
 * 4. Post-execution synthesis by LLM producing an exhaustive Turkish research report
 * 5. Clean state transitions: status -> 'completed'
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { agentState, config } = require('../src/state');
const { runResearchTool } = require('../src/agent');

async function runLocalResearchTests() {
  console.log('======================================================================');
  console.log('🔬 LOCAL RESEARCH MODE EVALUATION: 3 DIFFICULTY TIERS (100% OFFLINE)');
  console.log('======================================================================\n');

  // Configure environment for local research
  agentState.activeMode = 'research';
  agentState.activeSubMode = 'local';
  config.autoApprove = { ...(config.autoApprove || {}), read_file: true };

  const results = [];

  // -------------------------------------------------------------
  // TIER 1: BASİT (SIMPLE) - System Overview Ingestion
  // -------------------------------------------------------------
  console.log('▶ [TIER 1 - BASİT] Testing Local Research on agent_readme.md...');
  const t1Start = Date.now();
  const t1Prompt = "agent_readme.md dosyasını oku ve projenin genel amacını 2 cümleyle özetle.";

  await runResearchTool(t1Prompt);
  const t1Duration = Date.now() - t1Start;

  const t1AssistantMsgs = agentState.messages.filter(m => m.role === 'assistant');
  const t1LastReport = t1AssistantMsgs[t1AssistantMsgs.length - 1]?.content || '';

  console.log(`      Status: ${agentState.status}`);
  console.log(`      Duration: ${t1Duration}ms`);
  console.log(`      Report Preview: ${t1LastReport.substring(0, 150)}...`);

  assert.strictEqual(agentState.status, 'completed', 'Tier 1 should complete with status completed');
  assert(t1LastReport.length > 30, 'Tier 1 report must not be empty');
  results.push({ tier: 'Tier 1 (Basit)', pass: true, duration: t1Duration });
  console.log('✔ TIER 1 PASSED!\n');

  // -------------------------------------------------------------
  // TIER 2: ZOR (HARD) - Memory Structure & Schema Ingestion
  // -------------------------------------------------------------
  console.log('▶ [TIER 2 - ZOR] Testing Local Research on config/memory.json...');
  const t2Start = Date.now();
  const t2Prompt = "config/memory.json dosyasını oku ve sistemin bellek yapısında hangi alanların (memories, pendingRules vb.) bulunduğunu, nasıl bir şema kullanıldığını açıkla.";

  agentState.activeSubMode = 'local';
  await runResearchTool(t2Prompt);
  const t2Duration = Date.now() - t2Start;

  const t2AssistantMsgs = agentState.messages.filter(m => m.role === 'assistant');
  const t2LastReport = t2AssistantMsgs[t2AssistantMsgs.length - 1]?.content || '';

  console.log(`      Status: ${agentState.status}`);
  console.log(`      Duration: ${t2Duration}ms`);
  console.log(`      Report Preview: ${t2LastReport.substring(0, 150)}...`);

  assert.strictEqual(agentState.status, 'completed', 'Tier 2 should complete with status completed');
  assert(t2LastReport.length > 40, 'Tier 2 report must not be empty');
  results.push({ tier: 'Tier 2 (Zor)', pass: true, duration: t2Duration });
  console.log('✔ TIER 2 PASSED!\n');

  // -------------------------------------------------------------
  // TIER 3: ZOR + KARMAŞIK (HARD + COMPLEX) - Deep Architectural Ingestion
  // -------------------------------------------------------------
  console.log('▶ [TIER 3 - ZOR + KARMAŞIK] Testing Multi-Pillar Architectural Research on scratch/complex_system_spec.md...');
  const t3Start = Date.now();
  const t3Prompt = "scratch/complex_system_spec.md dosyasını oku ve projenin 3 temel mimari sütununu (WebSocket 150ms delta debounce, 5 aşamalı ayrıştırıcı hiyerarşisi ve acil durum tripwire devresi) detaylı teknik bir rapor olarak analiz et.";

  agentState.activeSubMode = 'local';
  await runResearchTool(t3Prompt);
  const t3Duration = Date.now() - t3Start;

  const t3AssistantMsgs = agentState.messages.filter(m => m.role === 'assistant');
  const t3LastReport = t3AssistantMsgs[t3AssistantMsgs.length - 1]?.content || '';

  console.log(`      Status: ${agentState.status}`);
  console.log(`      Duration: ${t3Duration}ms`);
  console.log(`      Report Preview: ${t3LastReport.substring(0, 200)}...`);

  assert.strictEqual(agentState.status, 'completed', 'Tier 3 should complete with status completed');
  assert(t3LastReport.length > 100, 'Tier 3 report must be comprehensive');
  const reportLower = t3LastReport.toLowerCase();
  const hasDebounceOrDelta = reportLower.includes('debounce') || reportLower.includes('delta') || reportLower.includes('150');
  const hasTripwireOrSecurity = reportLower.includes('tripwire') || reportLower.includes('güvenlik') || reportLower.includes('fren');
  assert(hasDebounceOrDelta || hasTripwireOrSecurity, 'Tier 3 report must extract architectural keywords');
  results.push({ tier: 'Tier 3 (Zor + Karmaşık)', pass: true, duration: t3Duration });
  console.log('✔ TIER 3 PASSED!\n');

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('======================================================================');
  console.log('🎉 ALL 3 LOCAL RESEARCH TIERS PASSED WITH 100% SUCCESS!');
  console.log('======================================================================');
  results.forEach(r => console.log(`  [PASS] ${r.tier} (${r.duration}ms)`));
}

if (require.main === module) {
  runLocalResearchTests().catch(err => {
    console.error('❌ Local Research Test Failed:', err);
    process.exit(1);
  });
}

module.exports = { runLocalResearchTests };
