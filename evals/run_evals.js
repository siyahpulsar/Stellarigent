/**
 * Stellarigent Benchmark & Evaluation Runner
 * Executes all scenarios defined in evals/scenarios.js,
 * calculates pass rates, logs detailed timings, and writes
 * a reproducible markdown evaluation report in evals/latest_eval_report.md.
 */

const fs = require('fs');
const path = require('path');
const { scenarios } = require('./scenarios');

async function runBenchmarkSuite() {
  console.log('\n===============================================================');
  console.log('🌟 STELLARIGENT REPRODUCIBLE EVALUATION & BENCHMARK SUITE');
  console.log('===============================================================');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Total Scenarios: ${scenarios.length}\n`);

  const results = [];
  let passedCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  for (const sc of scenarios) {
    const scStart = Date.now();
    let pass = false;
    let detail = '';
    let errorMsg = null;

    try {
      const res = await sc.run();
      pass = res.pass;
      detail = res.detail || '';
    } catch (err) {
      pass = false;
      errorMsg = err.message;
    }

    const durationMs = Date.now() - scStart;
    if (pass) passedCount++;
    else failedCount++;

    results.push({
      id: sc.id,
      category: sc.category,
      name: sc.name,
      pass,
      durationMs,
      detail: pass ? detail : (errorMsg || 'Assertion failed')
    });

    const statusBadge = pass ? '✔ PASS' : '❌ FAIL';
    console.log(`[${statusBadge}] ${sc.id} | ${sc.category} - ${sc.name} (${durationMs}ms)`);
    if (!pass) {
      console.log(`        Error: ${errorMsg}`);
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const passRate = ((passedCount / scenarios.length) * 100).toFixed(1);

  console.log('\n---------------------------------------------------------------');
  console.log(`BENCHMARK SUMMARY: ${passedCount}/${scenarios.length} Passed (${passRate}%) in ${totalDurationMs}ms`);
  console.log('---------------------------------------------------------------\n');

  // Generate reproducible Markdown report
  const reportPath = path.join(__dirname, 'latest_eval_report.md');
  const jsonPath = path.join(__dirname, 'eval_results.json');

  let reportMd = `# Stellarigent Benchmark & Evaluation Report\n\n`;
  reportMd += `> **Execution Timestamp:** ${new Date().toISOString()}  \n`;
  reportMd += `> **Total Scenarios:** ${scenarios.length} | **Passed:** ${passedCount} | **Failed:** ${failedCount} | **Pass Rate:** ${passRate}%  \n`;
  reportMd += `> **Total Execution Time:** ${totalDurationMs} ms\n\n`;
  reportMd += `## Scenario Results Breakdown\n\n`;
  reportMd += `| ID | Category | Scenario Name | Status | Duration | Detail |\n`;
  reportMd += `| :--- | :--- | :--- | :---: | :---: | :--- |\n`;

  for (const r of results) {
    const statusIcon = r.pass ? '✅ PASS' : '❌ FAIL';
    reportMd += `| **${r.id}** | ${r.category} | ${r.name} | ${statusIcon} | ${r.durationMs}ms | ${r.detail} |\n`;
  }

  reportMd += `\n## Evaluation Criteria & Verification Notes\n`;
  reportMd += `- **Parser Resilience:** Verifies multi-tier regex and syntax parsing across varying model qualities without crashing.\n`;
  reportMd += `- **Security & Confinement:** Asserts that exfiltration attempts (curl, Invoke-WebRequest) and project file tampering are strictly caught before execution.\n`;
  reportMd += `- **Tripwire Lifecycle:** Validates task-scoped isolation and deterministic manual reset capabilities.\n`;
  reportMd += `- **Cost & Quota:** Tests token tracking calculations and automated budget circuit breakers.\n`;
  reportMd += `- **Memory & RAG:** Guarantees two-stage pruning adherence and NaN-free sorting stability.\n`;

  fs.writeFileSync(reportPath, reportMd, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), passRate, results }, null, 2), 'utf-8');

  // ─── History archive: tarihli kopya kaydet ─────────────────────────────
  try {
    const historyDir = path.join(__dirname, 'history');
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/:/g, '-').replace('T', '_').substring(0, 19);
    const archivePath = path.join(historyDir, `eval_${stamp}.json`);
    fs.writeFileSync(archivePath, JSON.stringify({ timestamp: new Date().toISOString(), passRate, results }, null, 2), 'utf-8');
    console.log(`\u2713 History archive: ${archivePath}`);
  } catch (archErr) {
    console.warn('History archive error (non-fatal):', archErr.message);
  }
  // ────────────────────────────────────────────────────────────────────────

  console.log(`✓ Report written to: ${reportPath}`);
  console.log(`✓ JSON results written to: ${jsonPath}\n`);

  if (failedCount > 0) {
    process.exitCode = 1;
  }
  return { passedCount, failedCount, passRate, results };
}

if (require.main === module) {
  runBenchmarkSuite()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal benchmark runner error:', err);
      process.exit(1);
    });
}

module.exports = { runBenchmarkSuite };
