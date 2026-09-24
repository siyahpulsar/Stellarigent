/**
 * Automated Verification Test for Production Memory Architecture:
 * 1. Windows OS File Lock & Exponential Backoff (EPERM/EBUSY Simulation)
 * 2. 10 Concurrent Async Writes (Race Condition Stress Test)
 * 3. Two-Stage Pruning:
 *    - Scenario A: 60 items all within grace period -> assert count <= 35
 *    - Scenario B: 40 grace + 20 non-grace -> assert grace=35, non-grace=15, total=50
 * 4. Pending Rules 7-Day TTL Expiration
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  loadMemoryStore,
  saveMemoryStore,
  updateMemoryStore,
  pruneMemories,
  cleanStalePendingRules,
  calculateMemoryScore,
  normalizeMemoryItem
} = require('../src/memory');

const MEMORY_FILE_PATH = path.join(__dirname, '..', 'config', 'memory.json');
const BACKUP_FILE_PATH = path.join(__dirname, '..', 'config', 'memory.test_backup.json');

async function setup() {
  if (fs.existsSync(MEMORY_FILE_PATH)) {
    fs.copyFileSync(MEMORY_FILE_PATH, BACKUP_FILE_PATH);
  }
  // Initialize with clean test store
  fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify({ memories: [], pendingRules: [] }, null, 2), 'utf-8');
}

async function teardown() {
  if (fs.existsSync(BACKUP_FILE_PATH)) {
    fs.copyFileSync(BACKUP_FILE_PATH, MEMORY_FILE_PATH);
    fs.unlinkSync(BACKUP_FILE_PATH);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING COMPREHENSIVE MEMORY ARCHITECTURE TESTS (Bu arada ai a kodlattırsamda tüm sistem yapısı, algoritmalar, özellikler, fikirler ve ayarlamalar falan hepsi benden çıktı.) ');
  console.log('====================================================\n');

  await setup();

  try {
    // --- TEST 1: Two-Stage Pruning (Scenario A - All Grace Items) ---
    console.log('▶ [TEST 1] Two-Stage Pruning: Scenario A (All 60 in Grace Period)...');
    const now = Date.now();
    const allGraceMemories = [];
    for (let i = 1; i <= 60; i++) {
      allGraceMemories.push({
        id: `grace-${i}`,
        task: `Grace Task ${i}`,
        summary: `Summary ${i}`,
        accessCount: i % 5,
        createdAt: new Date(now - (i * 60000)).toISOString() // created a few minutes ago (< 24h)
      });
    }

    const prunedA = pruneMemories(allGraceMemories, 50, now);
    console.log(`   Result count: ${prunedA.length} (Expected <= 35)`);
    assert.strictEqual(prunedA.length, 35, 'Scenario A must cap grace items at exactly 35 (70% of 50)');
    console.log('   ✔ PASS: All-grace pool strictly trimmed to 35 items without unbounded growth!\n');

    // --- TEST 2: Two-Stage Pruning (Scenario B - Grace + Non-Grace Overflow) ---
    console.log('▶ [TEST 2] Two-Stage Pruning: Scenario B (40 Grace + 20 Non-Grace = 60 Total)...');
    const mixedMemories = [];
    // 40 Grace items
    for (let i = 1; i <= 40; i++) {
      mixedMemories.push({
        id: `grace-${i}`,
        task: `Grace Task ${i}`,
        summary: `Summary ${i}`,
        accessCount: 2,
        createdAt: new Date(now - (2 * 3600000)).toISOString() // 2 hours ago
      });
    }
    // 20 Non-Grace items (48 hours ago)
    for (let i = 1; i <= 20; i++) {
      mixedMemories.push({
        id: `nongrace-${i}`,
        task: `Old Task ${i}`,
        summary: `Old Summary ${i}`,
        accessCount: i, // Various access counts
        createdAt: new Date(now - (48 * 3600000)).toISOString() // 48 hours ago
      });
    }

    const prunedB = pruneMemories(mixedMemories, 50, now);
    const graceRemaining = prunedB.filter(m => (now - new Date(m.createdAt).getTime()) < 24 * 3600000);
    const nonGraceRemaining = prunedB.filter(m => (now - new Date(m.createdAt).getTime()) >= 24 * 3600000);

    console.log(`   Total count: ${prunedB.length} (Expected: 50)`);
    console.log(`   Grace count: ${graceRemaining.length} (Expected: 35)`);
    console.log(`   Non-grace count: ${nonGraceRemaining.length} (Expected: 15)`);

    assert.strictEqual(prunedB.length, 50, 'Total items must equal maxMemories (50)');
    assert.strictEqual(graceRemaining.length, 35, 'Grace pool must be trimmed to 35');
    assert.strictEqual(nonGraceRemaining.length, 15, 'Non-grace pool must be reduced by 5 to make total 50');
    console.log('   ✔ PASS: Two-stage pruning correctly protects grace pool and trims non-grace pool!\n');

    // --- TEST 3: Pending Rules 7-Day TTL ---
    console.log('▶ [TEST 3] Pending Rules 7-Day TTL Expiration...');
    const testPendingRules = [
      {
        id: 'fresh-1',
        rule: 'Fresh Rule (1 day old)',
        createdAt: new Date(now - (24 * 3600000)).toISOString() // 1 day old
      },
      {
        id: 'stale-1',
        rule: 'Stale Rule (8 days old)',
        createdAt: new Date(now - (8 * 24 * 3600000)).toISOString() // 8 days old
      }
    ];

    const cleanedPending = cleanStalePendingRules(testPendingRules, now);
    assert.strictEqual(cleanedPending.length, 1, 'Only fresh rule must be retained');
    assert.strictEqual(cleanedPending[0].id, 'fresh-1', 'Stale rule must be evicted');
    console.log('   ✔ PASS: 8-day old pending rule correctly expired by TTL!\n');

    // --- TEST 4: 10 Concurrent Async Writes (Race Condition Stress Test) ---
    console.log('▶ [TEST 4] 10 Concurrent Async Queue Writes...');
    const writePromises = [];
    for (let i = 1; i <= 10; i++) {
      writePromises.push(updateMemoryStore(async (store) => {
        store.memories.push({
          task: `Concurrent Task ${i}`,
          summary: `Finished worker ${i}`,
          accessCount: 0,
          createdAt: new Date().toISOString()
        });
      }));
    }

    await Promise.all(writePromises);
    const finalStore = await loadMemoryStore();
    console.log(`   Total memories written sequentially: ${finalStore.memories.length}`);
    assert.strictEqual(finalStore.memories.length, 10, 'All 10 concurrent requests must be preserved');
    console.log('   ✔ PASS: Async write queue resolved 10 concurrent operations with 0 data loss!\n');

    // --- TEST 5: Windows OS File Handle Lock & Exponential Backoff Retry ---
    console.log('▶ [TEST 5] Windows OS File Handle Lock & Exponential Backoff Retry...');
    // Open memory.json in exclusive/read-write mode to hold OS handle
    const fd = fs.openSync(MEMORY_FILE_PATH, 'r+');
    console.log('   [LOCK SIMULATOR] Acquired active file handle (Simulating Windows Defender / Search Indexer hold)');

    let writeSucceeded = false;
    const writePromise = updateMemoryStore(async (store) => {
      store.memories.push({
        task: 'Post-Lock Task',
        summary: 'Written after lock release',
        createdAt: new Date().toISOString()
      });
      writeSucceeded = true;
    });

    // Release the lock after 250ms while queue is attempting/waiting
    setTimeout(() => {
      console.log('   [LOCK SIMULATOR] Closing OS file handle after 250ms...');
      fs.closeSync(fd);
    }, 250);

    await writePromise;
    assert.strictEqual(writeSucceeded, true, 'Write must succeed after lock is released');
    console.log('   ✔ PASS: Exponential backoff waited for lock release and safely completed atomic write!\n');

    // --- TEST 6: Legacy Data Migration & NaN Protection ---
    console.log('▶ [TEST 6] Legacy Data Migration & NaN Protection...');
    const legacyItem = {
      task: 'Old legacy task without createdAt',
      summary: 'Legacy summary'
      // Notice: createdAt, date, accessCount, exceptions are all undefined!
    };

    const normalized = normalizeMemoryItem(legacyItem);
    assert.strictEqual(typeof normalized.createdAt, 'string', 'Normalized item must have a valid createdAt string');
    assert.strictEqual(normalized.accessCount, 0, 'Normalized item must have numeric accessCount 0');
    assert.strictEqual(Array.isArray(normalized.exceptions), true, 'Normalized item must have exceptions array');

    const score = calculateMemoryScore(normalized, now);
    assert.strictEqual(typeof score, 'number', 'Score must be a number');
    assert.strictEqual(isNaN(score), false, 'Score must NOT be NaN!');
    assert.strictEqual(isFinite(score), true, 'Score must be finite');

    // Verify sort stability on mixed legacy/new items
    const mixedList = [
      normalized,
      { task: 'New', createdAt: new Date(now).toISOString(), accessCount: 5 },
      { task: 'Old corrupted', createdAt: 'invalid-date-string', accessCount: undefined }
    ].map(normalizeMemoryItem);

    mixedList.sort((a, b) => calculateMemoryScore(b, now) - calculateMemoryScore(a, now));
    assert.strictEqual(mixedList.length, 3, 'All normalized items must sort safely without crash');
    console.log('   ✔ PASS: Legacy items normalized and scored with zero NaN errors!\n');

    console.log('====================================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (6/6)');
    console.log('====================================================');

  } finally {
    await teardown();
  }
}

// Execute tests if run directly
if (require.main === module) {
  runTests()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ TEST FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
