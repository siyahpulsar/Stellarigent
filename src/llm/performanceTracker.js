/**
 * performanceTracker.js
 * Adaptif Model Performans Yönlendiricisi (AMPR) - Performans Defteri ve EWMA Skorlama Motoru
 *
 * Görevler:
 * - Model ve araç (tool) bazında çalışma zamanı metriklerini toplamak
 * - 5-kademeli ayrıştırıcı katmanını (parseTier), gecikmeyi ve başarı oranını izlemek
 * - EWMA (Üstel Ağırlıklı Hareketli Ortalama) ile dinamik ModelScore hesaplamak
 * - config/model_performance.json dosyasını atomik (.tmp) ve RAM önbellekli olarak güvenle yönetmek
 * - getBestModelForTool ile en yüksek skorlu modeli önermek
 */

const fs = require('fs');
const path = require('path');

const PERFORMANCE_FILE = path.join(__dirname, '..', '..', 'config', 'model_performance.json');
const COLD_START_THRESHOLD = 3; // En az bu kadar çağrı olmadan model skoruna göre karar verilmez
const EWMA_ALPHA = 0.35;        // Son çağrılara %35 ağırlık veren üstel katsayı

// RAM Önbelleği
let _performanceStore = null;
let _writeQueue = Promise.resolve();
let _saveTimeout = null;

/**
 * Performans veritabanını diskten okur veya RAM önbelleğini döner.
 * @returns {Record<string, Record<string, Object>>}
 */
function loadPerformanceStore() {
  if (_performanceStore !== null) {
    return _performanceStore;
  }

  try {
    if (fs.existsSync(PERFORMANCE_FILE)) {
      const raw = fs.readFileSync(PERFORMANCE_FILE, 'utf-8');
      _performanceStore = JSON.parse(raw);
    } else {
      _performanceStore = {};
    }
  } catch (err) {
    console.error('[AMPR] Error reading model_performance.json, initializing empty store:', err.message);
    _performanceStore = {};
  }

  return _performanceStore;
}

/**
 * RAM önbelleğindeki veriyi atomik (.tmp) olarak diske asenkron yazar.
 * @returns {Promise<boolean>}
 */
function savePerformanceStore() {
  const storeToSave = _performanceStore || {};

  _writeQueue = _writeQueue.then(async () => {
    const tmpFile = `${PERFORMANCE_FILE}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
    try {
      const serialized = JSON.stringify(storeToSave, null, 2);
      await fs.promises.writeFile(tmpFile, serialized, 'utf-8');
      await fs.promises.rename(tmpFile, PERFORMANCE_FILE);
      return true;
    } catch (err) {
      console.error('[AMPR] Failed to save model_performance.json:', err.message);
      try {
        if (fs.existsSync(tmpFile)) await fs.promises.unlink(tmpFile);
      } catch (cleanErr) {
        // ignore
      }
      return false;
    }
  });

  return _writeQueue;
}

/**
 * Sık çağrılarda disk I/O yığılmasını önleyen debounced kayıt fonksiyonu.
 */
function scheduleSave() {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    savePerformanceStore();
    _saveTimeout = null;
  }, 500);
}

/**
 * Süreç sonlanırken RAM tamponunu senkron olarak diske döker.
 */
function emergencyFlushSync() {
  try {
    if (!_performanceStore) return;
    const tmpFile = `${PERFORMANCE_FILE}.exit.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(_performanceStore, null, 2), 'utf-8');
    fs.renameSync(tmpFile, PERFORMANCE_FILE);
  } catch (e) {
    // ignore on exit
  }
}

// Süreç çıkış kancaları
process.on('beforeExit', emergencyFlushSync);
process.on('SIGINT', () => { emergencyFlushSync(); });
process.on('SIGTERM', () => { emergencyFlushSync(); });

/**
 * EWMA formülü ile hareketli ortalama hesaplar.
 * @param {number} currentAvg Mevcut ortalama
 * @param {number} newValue Yeni değer
 * @param {number} alpha Ağırlık faktörü (0 < alpha <= 1)
 * @returns {number}
 */
function calculateEwma(currentAvg, newValue, alpha = EWMA_ALPHA) {
  if (currentAvg === null || currentAvg === undefined || isNaN(currentAvg)) {
    return newValue;
  }
  return Number((alpha * newValue + (1 - alpha) * currentAvg).toFixed(2));
}

/**
 * ModelScore formülü:
 * ModelScore = (successRate * 100 / avgParseTier) - (avgLatencyMs / 1000)
 *
 * @param {number} successRate 0 ile 1 arası
 * @param {number} avgParseTier 1 ile 5 arası
 * @param {number} avgLatencyMs milisaniye cinsinden gecikme
 * @returns {number} Skor (2 ondalık basamaklı)
 */
function calculateModelScore(successRate, avgParseTier, avgLatencyMs) {
  const safeTier = Math.max(1, avgParseTier || 1);
  const latencyPenalty = (avgLatencyMs || 0) / 1000;
  const rawScore = (successRate * 100) / safeTier - latencyPenalty;
  return Number(rawScore.toFixed(2));
}

/**
 * Bir araç çağrısının çalışma zamanı sonucunu kaydeder ve skoru günceller.
 *
 * @param {Object} params
 * @param {string} params.modelId Model tanımlayıcısı
 * @param {string} params.toolName Çalıştırılan araç adı
 * @param {number} [params.parseTier=1] 1-5 arası ayrıştırıcı katmanı
 * @param {boolean} [params.success=true] Aracın başarı durumu
 * @param {number} [params.retriesNeeded=0] Parse için yapılan ek deneme sayısı
 * @param {number} [params.latencyMs=0] Yanıt süresi
 * @returns {Object} Güncellenmiş performans kaydı
 */
function recordExecution({ modelId, toolName, parseTier = 1, success = true, retriesNeeded = 0, latencyMs = 0 }) {
  if (!modelId || !toolName) return null;

  const store = loadPerformanceStore();

  const mKey = String(modelId).trim().toLowerCase();
  const tKey = String(toolName).trim();

  if (!store[mKey]) store[mKey] = {};
  if (!store[mKey][tKey]) {
    store[mKey][tKey] = {
      samples: 0,
      successCount: 0,
      failureCount: 0,
      avgLatencyMs: latencyMs,
      avgParseTier: parseTier,
      score: 0,
      lastUpdated: Date.now(),
      history: []
    };
  }

  const entry = store[mKey][tKey];
  entry.samples += 1;
  if (success) {
    entry.successCount += 1;
  } else {
    entry.failureCount += 1;
  }

  // EWMA ile gecikme ve ayrıştırma katmanını güncelle
  entry.avgLatencyMs = calculateEwma(entry.avgLatencyMs, latencyMs);
  entry.avgParseTier = calculateEwma(entry.avgParseTier, parseTier);

  // Başarı oranı (Toplam başarılı / Toplam örnek)
  const successRate = entry.successCount / entry.samples;
  entry.score = calculateModelScore(successRate, entry.avgParseTier, entry.avgLatencyMs);
  entry.lastUpdated = Date.now();

  // Son 20 çağrıyı sakla
  if (!Array.isArray(entry.history)) entry.history = [];
  entry.history.push({
    success: !!success,
    parseTier,
    retriesNeeded,
    latencyMs,
    timestamp: Date.now()
  });
  if (entry.history.length > 20) {
    entry.history.shift();
  }

  scheduleSave();
  return entry;
}

/**
 * Belirli bir model ve araç için mevcut performans skorunu döndürür.
 * @param {string} modelId
 * @param {string} toolName
 * @returns {{ score: number|null, samples: number, sufficient: boolean, avgParseTier: number, avgLatencyMs: number, successRate: number }}
 */
function getModelScore(modelId, toolName) {
  if (!modelId || !toolName) return { score: null, samples: 0, sufficient: false, avgParseTier: 1, avgLatencyMs: 0, successRate: 0 };
  const store = loadPerformanceStore();

  const mKey = String(modelId).trim().toLowerCase();
  const tKey = String(toolName).trim();

  const entry = (store[mKey] && store[mKey][tKey]) ? store[mKey][tKey] : null;
  if (!entry) {
    return { score: null, samples: 0, sufficient: false, avgParseTier: 1, avgLatencyMs: 0, successRate: 0 };
  }

  const sufficient = entry.samples >= COLD_START_THRESHOLD;
  const successRate = entry.samples > 0 ? Number(((entry.successCount / entry.samples) * 100).toFixed(1)) : 0;

  return {
    score: entry.score,
    samples: entry.samples,
    sufficient,
    avgParseTier: entry.avgParseTier,
    avgLatencyMs: entry.avgLatencyMs,
    successRate
  };
}

/**
 * Aday modeller arasından verilen araç için en yüksek skora sahip modeli seçer.
 * Yeterli veriye sahip aday yoksa null döner (böylece statik merdiven kullanılır).
 *
 * @param {string} toolName Araç adı
 * @param {Array<string>} candidateModels Değerlendirilecek model kimlikleri
 * @returns {{ bestModel: string|null, score: number|null, candidatesWithScores: Array<Object> }}
 */
function getBestModelForTool(toolName, candidateModels = []) {
  if (!toolName || !Array.isArray(candidateModels) || candidateModels.length === 0) {
    return { bestModel: null, score: null, candidatesWithScores: [] };
  }

  const evaluated = candidateModels.map(modelId => {
    const meta = getModelScore(modelId, toolName);
    return {
      modelId,
      ...meta
    };
  });

  // Yeterli veriye (>= COLD_START_THRESHOLD) sahip adayları filtrele
  const eligible = evaluated.filter(e => e.sufficient && e.score !== null);

  if (eligible.length === 0) {
    return { bestModel: null, score: null, candidatesWithScores: evaluated };
  }

  // Skora göre büyükten küçüğe sırala
  eligible.sort((a, b) => b.score - a.score);

  return {
    bestModel: eligible[0].modelId,
    score: eligible[0].score,
    candidatesWithScores: evaluated
  };
}

/**
 * Web UI ve REST API için düzleştirilmiş performans istatistikleri listesi döndürür.
 * @returns {Array<Object>}
 */
function getPerformanceStats() {
  const store = loadPerformanceStore();
  const list = [];

  for (const [modelId, tools] of Object.entries(store)) {
    if (!tools || typeof tools !== 'object') continue;
    for (const [toolName, entry] of Object.entries(tools)) {
      if (!entry || typeof entry !== 'object') continue;
      const successRate = entry.samples > 0 ? Number(((entry.successCount / entry.samples) * 100).toFixed(1)) : 0;
      list.push({
        modelId,
        toolName,
        samples: entry.samples || 0,
        successCount: entry.successCount || 0,
        failureCount: entry.failureCount || 0,
        successRate,
        avgParseTier: entry.avgParseTier || 1,
        avgLatencyMs: entry.avgLatencyMs || 0,
        score: entry.score !== undefined ? entry.score : 0,
        lastUpdated: entry.lastUpdated || null
      });
    }
  }

  // Skora göre sıralı
  list.sort((a, b) => b.score - a.score);
  return list;
}

/**
 * Tüm performans verilerini sıfırlar (RAM + Disk).
 * @returns {Promise<boolean>}
 */
async function resetPerformanceData() {
  _performanceStore = {};
  if (_saveTimeout) {
    clearTimeout(_saveTimeout);
    _saveTimeout = null;
  }
  return await savePerformanceStore();
}

module.exports = {
  COLD_START_THRESHOLD,
  EWMA_ALPHA,
  calculateEwma,
  calculateModelScore,
  recordExecution,
  getModelScore,
  getBestModelForTool,
  getPerformanceStats,
  resetPerformanceData,
  loadPerformanceStore,
  savePerformanceStore,
  emergencyFlushSync
};
