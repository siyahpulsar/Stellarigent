/**
 * Stellarigent - Eval Trend Report
 * Reads archived eval results from evals/history/ and prints a
 * comparison table of the last N benchmark runs.
 * Usage: node evals/trend_report.js [--last N]
 *        npm run eval:trend
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const HISTORY_DIR  = path.join(__dirname, 'history');
const DEFAULT_LAST = 10;

const ESC  = '\x1b';
const BOLD  = ESC + '[1m';
const RESET = ESC + '[0m';
const GREEN = ESC + '[32m';
const RED   = ESC + '[31m';
const YELL  = ESC + '[33m';
const CYAN  = ESC + '[36m';
const GRAY  = ESC + '[90m';
const bold  = s => BOLD  + s + RESET;
const green = s => GREEN + s + RESET;
const red   = s => RED   + s + RESET;
const yell  = s => YELL  + s + RESET;
const cyan  = s => CYAN  + s + RESET;
const gray  = s => GRAY  + s + RESET;

function parseLast() {
  const idx = process.argv.indexOf('--last');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return DEFAULT_LAST;
}

function readHistoryFiles(n) {
  if (!fs.existsSync(HISTORY_DIR)) {
    console.error(red('HATA: History klasoru bulunamadi: ' + HISTORY_DIR));
    console.error(gray('Once npm run eval komutunu calistirin.'));
    process.exit(1);
  }
  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith('eval_') && f.endsWith('.json'))
    .sort().slice(-n);
  if (files.length === 0) {
    console.error(red('HATA: Hicbir gecmis eval dosyasi bulunamadi.'));
    console.error(gray('Once npm run eval komutunu calistirin.'));
    process.exit(1);
  }
  return files.map(f => {
    try {
      return { file: f, ...JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8')) };
    } catch { return null; }
  }).filter(Boolean);
}

function formatDate(ts) {
  if (!ts) return 'bilinmiyor';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('tr-TR') + ' ' +
           d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  } catch { return String(ts); }
}

function sparkline(values) {
  const chars = ['\u2581','\u2582','\u2583','\u2584','\u2585','\u2586','\u2587','\u2588'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => {
    const idx = Math.round(((v - min) / range) * (chars.length - 1));
    const ch = chars[idx];
    if (v === 100) return GREEN + ch + RESET;
    if (v >= 70)   return YELL  + ch + RESET;
    return RED + ch + RESET;
  }).join('');
}

function trendArrow(values) {
  if (values.length < 2) return gray('->');
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  if (last > prev) return green('^');
  if (last < prev) return red('v');
  return gray('-');
}

function printReport(runs) {
  console.log('\n' + bold(cyan('='.repeat(65))));
  console.log(bold(cyan('   STELLARIGENT  EVAL TREND REPORT  (' + runs.length + ' calisma)')));
  console.log(bold(cyan('='.repeat(65))) + '\n');

  const passRates = runs.map(r => parseFloat(r.passRate) || 0);

  console.log(bold('#  ') + bold('Tarih              ') + bold('Pass%     ') + bold('Gecen/Top  ') + bold('Sure'));
  console.log(gray('-'.repeat(65)));

  runs.forEach((r, i) => {
    const passedCount = (r.results || []).filter(x => x.pass).length;
    const totalCount  = (r.results || []).length;
    const pr  = parseFloat(r.passRate) || 0;
    const prC = pr === 100 ? green : pr >= 70 ? yell : red;
    const prStr = prC(pr.toFixed(1) + '%');
    const durMs = (r.results || []).reduce((s, x) => s + (x.durationMs || 0), 0);
    const durStr = durMs < 1000 ? durMs + 'ms' : (durMs / 1000).toFixed(2) + 's';
    const status = pr === 100 ? green('OK') : red('FAIL');
    console.log(
      String(i + 1).padEnd(3) +
      formatDate(r.timestamp).padEnd(20) +
      (prStr).padEnd(18) +
      (passedCount + '/' + totalCount).padEnd(12) +
      durStr.padEnd(10) +
      status
    );
  });

  console.log('\n' + bold('Pass Rate Trendi: ') + sparkline(passRates) + '  ' + trendArrow(passRates));

  const allCats = [...new Set(runs.flatMap(r => (r.results || []).map(x => x.category)))];
  if (allCats.length > 0) {
    console.log('\n' + bold('Kategori Bazli Basari (Son Calisma):'));
    console.log(gray('-'.repeat(55)));
    const lastRun = runs[runs.length - 1];
    allCats.forEach(cat => {
      const catTests = (lastRun.results || []).filter(x => x.category === cat);
      const catPass  = catTests.filter(x => x.pass).length;
      const catTotal = catTests.length;
      const catPct   = catTotal > 0 ? Math.round((catPass / catTotal) * 100) : 0;
      const barCh    = catPct === 100 ? GREEN : catPct >= 70 ? YELL : RED;
      const bar      = barCh + '|'.repeat(Math.round(catPct / 10)) + RESET;
      console.log('  ' + String(catPass + '/' + catTotal).padEnd(6) + bar.padEnd(15) + '  ' + gray(catPct + '%') + '  ' + cat);
    });
  }

  if (runs.length >= 2) {
    const prev = runs[runs.length - 2];
    const last = runs[runs.length - 1];
    const prevMap = Object.fromEntries((prev.results || []).map(x => [x.id, x]));
    const regressions  = (last.results || []).filter(x => { const p = prevMap[x.id]; return p && p.pass && !x.pass; });
    const improvements = (last.results || []).filter(x => { const p = prevMap[x.id]; return p && !p.pass && x.pass; });
    if (regressions.length > 0) {
      console.log('\n' + bold(red('REGRESYONLAR (onceki geciyordu, simdi basarisiz):')));
      regressions.forEach(x => console.log(red('  x ') + x.id + ' - ' + x.name));
    }
    if (improvements.length > 0) {
      console.log('\n' + bold(green('IYILESMELER (onceki basarisizdi, simdi geciyor):')));
      improvements.forEach(x => console.log(green('  v ') + x.id + ' - ' + x.name));
    }
    if (!regressions.length && !improvements.length) {
      console.log('\n' + green('OK: Son iki calisma arasinda regresyon veya iyilesme yok.'));
    }
  }
  console.log('\n' + gray('History klasoru: ' + HISTORY_DIR));
  console.log(gray('Yeni eval eklemek icin: npm run eval') + '\n');
}

const lastN = parseLast();
const runs  = readHistoryFiles(lastN);
printReport(runs);
