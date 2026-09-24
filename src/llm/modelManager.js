/**
 * modelManager.js
 * LM Studio Model Yönetim Modülü
 *
 * Görevler:
 * - LM Studio'dan aktif yüklü modeli tespit etmek
 * - Gerekirse modeli eject edip yeni model yüklemek
 * - Tool bazlı model profili çözümlemek (tag → model adı)
 * - success:false durumunda fallback modele geçiş
 */

const { getLmStudioEndpoint, config, broadcastTerminal } = require('../state');

const { execSync } = require('child_process');
const performanceTracker = require('./performanceTracker');

// Son bilinen yüklü model (RAM cache — LM Studio'ya tekrar tekrar sorgu yapıp CPU tüketmemek için)
let _cachedCurrentModel = null;
let _cacheTimestamp = 0;
const MODEL_CACHE_TTL_MS = 4000; // 4 saniye
let _ensuringModelPromise = null; // Race-condition guard for concurrent ensureModelLoaded calls

/**
 * LM Studio ana HTTP base URL'ini (/api/v1 ve /v1 öncesi kök adresi) döndürür.
 * Örnek: http://127.0.0.1:1234
 */
function getLmStudioNativeBaseUrl() {
  let baseUrl = (config.lmStudioUrl || 'http://127.0.0.1:1234/v1').trim().replace(/\/+$/, '');
  baseUrl = baseUrl.replace(/\/v1$/i, ''); // Strip /v1 if present to get root base URL
  baseUrl = baseUrl.replace(/:\/\/localhost/i, '://127.0.0.1');
  return baseUrl;
}

/**
 * LM Studio native API'sinden (GET /api/v1/models) indirilen ve yüklü tüm modelleri listeler.
 * @returns {Promise<Array<Object>|null>}
 */
async function fetchAvailableLmStudioModels() {
  const baseUrl = getLmStudioNativeBaseUrl();
  const endpoint = `${baseUrl}/api/v1/models`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    return (data && Array.isArray(data.models)) ? data.models : null;
  } catch (err) {
    clearTimeout(tid);
    return null;
  }
}

/**
 * LM Studio'da o anda RAM/VRAM'e yüklü olan modellerin listesini döndürür.
 * 1. Öncelikli: GET /api/v1/models içerisindeki `loaded_instances` dizileri
 * 2. Fallback: `lms ps` CLI komutu
 * @returns {Promise<Array<{modelKey: string, instanceId: string, type: string}>>}
 */
async function getLoadedModels() {
  // 1. LM Studio Native API Kontrolü
  const models = await fetchAvailableLmStudioModels();
  if (models) {
    const loaded = [];
    for (const m of models) {
      if (Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0) {
        for (const inst of m.loaded_instances) {
          loaded.push({
            modelKey: m.key,
            instanceId: inst.id || m.key,
            type: m.type || 'llm',
            displayName: m.display_name
          });
        }
      }
    }
    return loaded;
  }

  // 2. CLI Fallback Kontrolü (lms ps)
  try {
    const out = execSync('lms ps', { encoding: 'utf-8', timeout: 5000 });
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
    const loaded = [];
    for (const line of lines) {
      if (line.startsWith('IDENTIFIER') || line.includes('No models are currently loaded')) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        loaded.push({
          modelKey: parts[1] || parts[0],
          instanceId: parts[0],
          type: 'llm'
        });
      }
    }
    return loaded;
  } catch (cliErr) {
    return [];
  }
}

/**
 * Model adını LM Studio'da kayıtlı tam anahtarla (key) eşleştirir.
 * Örneğin 'qwen2.5-3b' -> 'qwen2.5-3b-instruct'
 * @param {string} targetModelId
 * @returns {Promise<string>}
 */
async function resolveExactModelKey(targetModelId) {
  if (!targetModelId) return targetModelId;
  const models = await fetchAvailableLmStudioModels();
  if (!models || models.length === 0) return targetModelId;

  const targetLower = targetModelId.toLowerCase().trim();

  // 1. Tam anahtar eşleşmesi
  const exact = models.find(m => m.key && m.key.toLowerCase() === targetLower);
  if (exact) return exact.key;

  // 2. Kısmi anahtar eşleşmesi
  const partial = models.find(m => m.key && (m.key.toLowerCase().includes(targetLower) || targetLower.includes(m.key.toLowerCase())));
  if (partial) return partial.key;

  // 3. Display name üzerinden eşleşme
  const byDisplay = models.find(m => m.display_name && (m.display_name.toLowerCase().includes(targetLower) || targetLower.includes(m.display_name.toLowerCase())));
  if (byDisplay) return byDisplay.key;

  return targetModelId;
}

/**
 * LM Studio'da şu an yüklü olan LLM modelini döndürür.
 * Model yüklü değilse null döner.
 * @returns {Promise<string|null>} model id veya null
 */
async function getCurrentLoadedModel() {
  if (_cachedCurrentModel && Date.now() - _cacheTimestamp < MODEL_CACHE_TTL_MS) {
    return _cachedCurrentModel;
  }

  try {
    const loaded = await getLoadedModels();
    if (!loaded || loaded.length === 0) {
      _cachedCurrentModel = null;
      _cacheTimestamp = Date.now();
      return null;
    }

    // Embedding modellerini ele, LLM modelini seç
    const llm = loaded.find(m => m.type === 'llm') || loaded.find(m => m.type !== 'embedding') || loaded[0];
    const modelId = llm ? (llm.modelKey || llm.instanceId) : null;

    _cachedCurrentModel = modelId;
    _cacheTimestamp = Date.now();
    return modelId;
  } catch (err) {
    broadcastTerminal(`> [MODEL MANAGER] getCurrentLoadedModel error: ${err.message}\n`);
    return null;
  }
}

/**
 * Yüklü modeli LM Studio'dan kaldırır (unload / eject).
 * POST /api/v1/models/unload { instance_id: "..." }
 * @param {string} [modelId] Belirli bir model veya boş ise tüm yüklü LLM'ler
 * @returns {Promise<boolean>}
 */
async function ejectModel(modelId) {
  try {
    const baseUrl = getLmStudioNativeBaseUrl();
    const loaded = await getLoadedModels();

    let toUnload = [];
    if (modelId) {
      const targetLower = modelId.toLowerCase().trim();
      toUnload = loaded.filter(m =>
        m.modelKey.toLowerCase().includes(targetLower) ||
        m.instanceId.toLowerCase().includes(targetLower) ||
        targetLower.includes(m.modelKey.toLowerCase())
      );
    } else {
      toUnload = loaded.filter(m => m.type === 'llm');
    }

    if (toUnload.length === 0 && loaded.length > 0 && !modelId) {
      toUnload = loaded;
    }

    broadcastTerminal(`> [MODEL MANAGER] Ejecting model(s): ${toUnload.map(u => u.instanceId).join(', ') || modelId || 'all'}...\n`);

    let anySuccess = false;
    for (const inst of toUnload) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${baseUrl}/api/v1/models/unload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instance_id: inst.instanceId }),
          signal: controller.signal
        });
        clearTimeout(tid);

        if (res.ok) {
          broadcastTerminal(`> [MODEL MANAGER] ✓ Model ejected/unloaded: ${inst.instanceId}\n`);
          anySuccess = true;
        } else {
          broadcastTerminal(`> [MODEL MANAGER] Unload HTTP ${res.status} for ${inst.instanceId}\n`);
        }
      } catch (err) {
        broadcastTerminal(`> [MODEL MANAGER] Unload request error: ${err.message}\n`);
      }
    }

    // CLI Fallback
    if (!anySuccess) {
      try {
        if (modelId) {
          execSync(`lms unload "${modelId}"`, { timeout: 10000, encoding: 'utf-8' });
        } else {
          execSync(`lms unload --all`, { timeout: 10000, encoding: 'utf-8' });
        }
        broadcastTerminal(`> [MODEL MANAGER] ✓ Model ejected via lms CLI\n`);
        anySuccess = true;
      } catch (cliErr) {
        // CLI fallback failed or not available
      }
    }

    _cachedCurrentModel = null;
    _cacheTimestamp = 0;
    return anySuccess;
  } catch (err) {
    broadcastTerminal(`> [MODEL MANAGER] ejectModel error: ${err.message}\n`);
    _cachedCurrentModel = null;
    return false;
  }
}

/**
 * Yeni modeli LM Studio'ya yükler.
 * POST /api/v1/models/load { model: modelKey }
 * @param {string} modelId
 * @returns {Promise<boolean>}
 */
async function loadModel(modelId) {
  if (!modelId) return false;
  try {
    const exactKey = await resolveExactModelKey(modelId);
    broadcastTerminal(`> [MODEL MANAGER] Loading model: "${exactKey}"...\n`);

    const baseUrl = getLmStudioNativeBaseUrl();
    const endpoint = `${baseUrl}/api/v1/models/load`;

    // 1. LM Studio Native API ile yükleme (POST /api/v1/models/load)
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 180000); // Büyük modeller için 3 dakika timeout

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: exactKey }),
        signal: controller.signal
      });
      clearTimeout(tid);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const loadSec = data.load_time_seconds ? ` (${data.load_time_seconds}s)` : '';
        broadcastTerminal(`> [MODEL MANAGER] ✓ Model loaded successfully: ${exactKey}${loadSec}\n`);
        _cachedCurrentModel = exactKey;
        _cacheTimestamp = Date.now();
        return true;
      }

      const errBody = await res.text().catch(() => '');
      broadcastTerminal(`> [MODEL MANAGER] Native load failed (HTTP ${res.status}: ${errBody}). Trying CLI fallback...\n`);
    } catch (httpErr) {
      broadcastTerminal(`> [MODEL MANAGER] Native load request error (${httpErr.message}). Trying CLI fallback...\n`);
    }

    // 2. CLI Fallback: lms load <exactKey> -y
    try {
      broadcastTerminal(`> [MODEL MANAGER] Executing CLI fallback: lms load "${exactKey}" -y...\n`);
      execSync(`lms load "${exactKey}" -y`, { timeout: 180000, encoding: 'utf-8' });
      broadcastTerminal(`> [MODEL MANAGER] ✓ Model loaded via lms CLI: ${exactKey}\n`);
      _cachedCurrentModel = exactKey;
      _cacheTimestamp = Date.now();
      return true;
    } catch (cliErr) {
      broadcastTerminal(`> [MODEL MANAGER] ✗ CLI load failed: ${cliErr.message}\n`);
      return false;
    }
  } catch (err) {
    broadcastTerminal(`> [MODEL MANAGER] loadModel error: ${err.message}\n`);
    return false;
  }
}

/**
 * LM Studio'nun modeli hazır etmesini teyit eder.
 * @param {string} modelId
 * @param {number} timeoutMs Max bekleme süresi (default: 60s)
 * @returns {Promise<boolean>}
 */
async function waitForModelReady(modelId, timeoutMs = 60000) {
  const startTime = Date.now();
  const pollInterval = 2000;

  broadcastTerminal(`> [MODEL MANAGER] Verifying model ready status: ${modelId} (max ${timeoutMs / 1000}s)...\n`);

  while (Date.now() - startTime < timeoutMs) {
    _cachedCurrentModel = null; // Cache'i temizle, taze sorgu yap
    const current = await getCurrentLoadedModel();
    if (current && (current.toLowerCase().includes(modelId.toLowerCase()) || modelId.toLowerCase().includes(current.toLowerCase()))) {
      broadcastTerminal(`> [MODEL MANAGER] ✓ Model is ready and verified: ${current}\n`);
      return true;
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    broadcastTerminal(`> [MODEL MANAGER] Still verifying model... (${elapsed}s elapsed)\n`);
    await new Promise(r => setTimeout(r, pollInterval));
  }

  broadcastTerminal(`> [MODEL MANAGER] ✗ Timeout waiting for model: ${modelId}\n`);
  return false;
}

/**
 * Tag'e göre uygun model adını döndürür.
 * modelTags config'inden tag'e sahip ilk modeli bulur.
 * @param {string} tag 'hizli' | 'orta' | 'yuklu'
 * @returns {string|null} model adı veya null
 */
function resolveModelByTag(tag) {
  if (!tag || !config.modelTags) return null;
  const entries = Object.entries(config.modelTags);
  // Önce tam eşleşme — tag dizisinde aranan tag varsa
  const match = entries.find(([, tags]) => Array.isArray(tags) && tags.includes(tag));
  return match ? match[0] : null;
}

/**
 * Tool adına göre hangi modelin kullanılması gerektiğini çözümler.
 * toolModelConfig'den tag bulur → resolveModelByTag ile model adı getirir.
 * @param {string} toolName
 * @returns {{ modelId: string|null, tag: string|null }}
 */
function resolveModelForTool(toolName) {
  const toolCfg = config.toolModelConfig || {};
  const entry = toolCfg[toolName] || toolCfg['__default__'] || null;
  if (!entry) return { modelId: null, tag: null };
  const tag = entry.tag || null;
  const modelId = resolveModelByTag(tag);
  return { modelId, tag };
}

/**
 * Tool adına göre fallback modeli çözümler.
 * @param {string} toolName
 * @returns {{ modelId: string|null, tag: string|null }}
 */
function resolveFallbackModelForTool(toolName) {
  const toolCfg = config.toolModelConfig || {};
  const entry = toolCfg[toolName] || toolCfg['__default__'] || null;
  if (!entry) return { modelId: null, tag: null };
  const tag = entry.fallbackTag || null;
  const modelId = resolveModelByTag(tag);
  return { modelId, tag };
}

/**
 * Model merdiveninde bir sonraki (üst) modeli bulur.
 * AMPR aktifse ve targetTool belirtilmişse, en yüksek performans skorlu modeli seçer.
 * @param {string|null} currentModelId
 * @param {string|null} [targetTool] İlgili araç adı (AMPR için)
 * @returns {string|null} model adı veya null
 */
function getNextLadderModel(currentModelId, targetTool = null) {
  const ladder = config.modelLadder;
  if (!ladder || !Array.isArray(ladder) || ladder.length === 0) return null;

  // AMPR Adaptif Sıralama: Eğer adaptiveRouting aktifse ve targetTool belirtilmişse
  if (config.adaptiveRouting !== false && targetTool) {
    try {
      // Merdivendeki adaylardan mevcut model hariç olanları değerlendir
      const candidates = currentModelId
        ? ladder.filter(m => !m.toLowerCase().includes(currentModelId.toLowerCase()) && !currentModelId.toLowerCase().includes(m.toLowerCase()))
        : [...ladder];

      const { bestModel, score } = performanceTracker.getBestModelForTool(targetTool, candidates);
      if (bestModel) {
        broadcastTerminal(`> [AMPR] Adaptif merdiven yönlendirmesi devrede: "${targetTool}" aracı için en yüksek skorlu model seçildi: "${bestModel}" (Skor: ${score})\n`);
        return bestModel;
      }
    } catch (amprErr) {
      // Hata veya eksik veri durumunda statik merdivene güvenli geri dönüş
    }
  }

  if (!currentModelId) {
    return ladder[0];
  }

  const curLower = currentModelId.toLowerCase();
  let foundIdx = ladder.findIndex(m => m.toLowerCase() === curLower);
  if (foundIdx === -1) {
    foundIdx = ladder.findIndex(m => curLower.includes(m.toLowerCase()) || m.toLowerCase().includes(curLower));
  }

  if (foundIdx === -1) {
    return ladder[0];
  }

  if (foundIdx + 1 < ladder.length) {
    return ladder[foundIdx + 1];
  }

  return null; // Merdivenin sonu
}

/**
 * Model yüklendiğinde model bazlı otomatik modları uygular.
 * @param {string} modelId
 */
function applyModelModeProfile(modelId) {
  if (!modelId || !config.modelModeProfiles) return;
  const profiles = config.modelModeProfiles;

  const modLower = modelId.toLowerCase();
  let matchedKey = Object.keys(profiles).find(k => k.toLowerCase() === modLower);
  if (!matchedKey) {
    matchedKey = Object.keys(profiles).find(k => modLower.includes(k.toLowerCase()) || k.toLowerCase().includes(modLower));
  }

  if (!matchedKey) return;

  const profile = profiles[matchedKey];
  if (!profile || typeof profile !== 'object') return;

  const appliedChanges = [];
  const validModes = ['lpmMode', 'lpmOmMode', 'hpmMode', 'advancedReasoningMode', 'forceTaskPlan', 'simbaEnabled'];

  for (const modeKey of validModes) {
    if (profile[modeKey] !== undefined && typeof profile[modeKey] === 'boolean') {
      config[modeKey] = profile[modeKey];
      appliedChanges.push(`${modeKey}=${profile[modeKey] ? 'ON' : 'OFF'}`);
    }
  }

  if (profile.lpmBatchSize !== undefined && typeof profile.lpmBatchSize === 'number') {
    config.lpmBatchSize = profile.lpmBatchSize;
    appliedChanges.push(`lpmBatchSize=${profile.lpmBatchSize}`);
  }

  if (appliedChanges.length > 0) {
    broadcastTerminal(`> [AUTO-MODES] "${modelId}" için otomatik modlar uygulandı: ${appliedChanges.join(', ')}\n`);
    try {
      const { broadcastState, broadcastCustomMessage } = require('../state');
      broadcastState();
      if (typeof broadcastCustomMessage === 'function') {
        broadcastCustomMessage({
          type: 'model_modes_applied',
          modelId,
          modes: {
            lpmMode: config.lpmMode,
            lpmOmMode: config.lpmOmMode,
            lpmBatchSize: config.lpmBatchSize,
            hpmMode: config.hpmMode,
            advancedReasoningMode: config.advancedReasoningMode,
            forceTaskPlan: config.forceTaskPlan,
            simbaEnabled: config.simbaEnabled
          }
        });
      }
    } catch (e) {
      // ignore
    }
  }
}

/**
 * Ayarlara ve duruma göre en uygun modeli tespit eder:
 * 1. targetTool verilmişse: toolModelConfig[targetTool] -> tag -> modelId
 * 2. toolModelConfig['__default__'] -> tag -> modelId
 * 3. config.modelLadder[0] (Yedeklilik merdivenindeki en öncelikli model)
 * 4. config.modelTags içerisindeki ilk model
 * 5. config.modelName
 * 6. LM Studio'da indirilmiş ilk LLM modeli
 * @param {string|null} targetTool
 * @returns {Promise<string|null>}
 */
async function resolveSuitableModel(targetTool = null) {
  // 0. AMPR Adaptif Seçim: Hedef araç için kanıtlanmış yüksek skorlu model varsa öne al
  if (targetTool && config.adaptiveRouting !== false) {
    try {
      const candidates = (config.modelLadder && config.modelLadder.length > 0)
        ? config.modelLadder
        : (config.modelTags ? Object.keys(config.modelTags) : []);
      const { bestModel, score } = performanceTracker.getBestModelForTool(targetTool, candidates);
      if (bestModel) {
        broadcastTerminal(`> [AMPR] Hedef "${targetTool}" için en yüksek skorlu model seçildi: "${bestModel}" (Skor: ${score})\n`);
        return bestModel;
      }
    } catch (e) {
      // ignore
    }
  }

  // 1. Tool'a özel model
  if (targetTool) {
    const { modelId } = resolveModelForTool(targetTool);
    if (modelId) return modelId;
  }

  // 2. Varsayılan tool modeli (__default__)
  const defaultEntry = resolveModelForTool('__default__');
  if (defaultEntry && defaultEntry.modelId) {
    return defaultEntry.modelId;
  }

  // 3. Model yedeklilik merdiveninin (ladder) ilk sırasındaki model
  if (config.modelLadder && Array.isArray(config.modelLadder) && config.modelLadder.length > 0) {
    return config.modelLadder[0];
  }

  // 4. Model etiketlerinde tanımlı ilk model
  if (config.modelTags && typeof config.modelTags === 'object') {
    const tagged = Object.keys(config.modelTags);
    if (tagged.length > 0) {
      return tagged[0];
    }
  }

  // 5. config.modelName
  if (config.modelName && typeof config.modelName === 'string' && config.modelName.trim()) {
    return config.modelName.trim();
  }

  // 6. LM Studio'da indirilmiş modeller arasından ilk LLM
  try {
    const available = await fetchAvailableLmStudioModels();
    if (available && Array.isArray(available)) {
      const firstLlm = available.find(m => m.type === 'llm') || available.find(m => m.type !== 'embedding');
      if (firstLlm) return firstLlm.key;
    }
  } catch (e) {
    // ignore
  }

  return null;
}

/**
 * LM Studio'da çalışmaya hazır bir modelin yüklü olduğundan emin olur.
 * - Bellekte hiç model yoksa: Ayarlardaki en uygun modeli (tool'a göre veya default/ladder) otomatik yükler.
 * - Bellekte zaten bir model varsa: targetTool verilmişse ve model switching aktifse o tool'un modeline geçer; verilmemişse mevcut modeli korur.
 * @param {string|null} [targetTool]
 * @returns {Promise<boolean>}
 */
async function ensureModelLoaded(targetTool = null) {
  if (_ensuringModelPromise) {
    return await _ensuringModelPromise;
  }

  _ensuringModelPromise = (async () => {
    try {
      const current = await getCurrentLoadedModel();

      // Durum 1: Bellekte HİÇ model yüklü değil
      if (!current) {
        const targetModel = await resolveSuitableModel(targetTool);
        if (!targetModel) {
          broadcastTerminal(`> [MODEL MANAGER] Uyarı: Otomatik yüklenebilecek model bulunamadı (LM Studio'da model indirilmiş mi kontrol edin).\n`);
          return false;
        }

        broadcastTerminal(`> [MODEL MANAGER] Bellekte yüklü model bulunamadı. Ayarlardaki en uygun model otomatik yükleniyor: "${targetModel}"...\n`);
        const success = await switchToModel(targetModel);
        if (!success) {
          // Merdivendeki bir sonraki modeli dene
          const nextLadder = getNextLadderModel(targetModel);
          if (nextLadder && nextLadder !== targetModel) {
            broadcastTerminal(`> [MODEL MANAGER] "${targetModel}" yüklenemedi. Merdivendeki alternatif model deneniyor: "${nextLadder}"...\n`);
            return await switchToModel(nextLadder);
          }
          return false;
        }
        return true;
      }

      // Durum 2: Bellekte zaten model yüklü
      // Eğer belirli bir tool çalıştırılacaksa ve switching aktifse, tool'un modeline geç
      if (targetTool && config.modelSwitchingEnabled) {
        return await switchModelForTool(targetTool);
      }

      // Mevcut model geçerli, işlem yapmaya gerek yok
      return true;
    } catch (err) {
      broadcastTerminal(`> [MODEL MANAGER] ensureModelLoaded hatası: ${err.message}\n`);
      return false;
    } finally {
      _ensuringModelPromise = null;
    }
  })();

  return await _ensuringModelPromise;
}

/**
 * Gerekirse modeli değiştirir. Eject + Load + Wait döngüsü.
 * modelSwitchingEnabled false ise hiçbir şey yapmaz.
 * @param {string} targetModelId Yüklenmesi istenen model adı
 * @returns {Promise<boolean>} Başarılı mı?
 */
async function switchToModel(targetModelId) {
  if (!config.modelSwitchingEnabled) return true; // switching kapalı → geç
  if (!targetModelId) return true;

  const exactTargetKey = await resolveExactModelKey(targetModelId);
  const current = await getCurrentLoadedModel();

  // Zaten doğru model yüklü mü? (case-insensitive, partial match)
  if (current && (current.toLowerCase().includes(exactTargetKey.toLowerCase()) || exactTargetKey.toLowerCase().includes(current.toLowerCase()))) {
    broadcastTerminal(`> [MODEL MANAGER] Model already loaded: ${current} ✓\n`);
    applyModelModeProfile(current);
    return true;
  }

  broadcastTerminal(`> [MODEL MANAGER] === MODEL SWITCH START ===\n`);
  broadcastTerminal(`> [MODEL MANAGER] Current: ${current || 'none (no model loaded)'} → Target: ${exactTargetKey}\n`);

  // Eject current if a model is loaded
  if (current) {
    await ejectModel(current);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Load target
  const loadSuccess = await loadModel(exactTargetKey);
  if (!loadSuccess) {
    broadcastTerminal(`> [MODEL MANAGER] ✗ Load request failed for: ${exactTargetKey}.\n`);
    return false;
  }

  // Wait for ready
  const ready = await waitForModelReady(exactTargetKey);
  if (!ready) {
    broadcastTerminal(`> [MODEL MANAGER] ✗ Model never became ready: ${exactTargetKey}\n`);
    return false;
  }

  // Model hazır olduğunda otomatik mod profilini uygula
  applyModelModeProfile(exactTargetKey);

  broadcastTerminal(`> [MODEL MANAGER] === MODEL SWITCH COMPLETE: ${exactTargetKey} ===\n`);
  return true;
}

/**
 * Tool adına göre modeli otomatik seçer ve gerekirse switch yapar.
 * @param {string} toolName
 * @returns {Promise<boolean>}
 */
async function switchModelForTool(toolName) {
  if (!config.modelSwitchingEnabled) return true;

  const { modelId, tag } = resolveModelForTool(toolName);
  if (!modelId) {
    broadcastTerminal(`> [MODEL MANAGER] No model configured for tool: ${toolName} (tag: ${tag || 'none'}). Skipping switch.\n`);
    return true;
  }

  broadcastTerminal(`> [MODEL MANAGER] Tool "${toolName}" → Tag: "${tag}" → Model: "${modelId}"\n`);
  return await switchToModel(modelId);
}

/**
 * Tool başarısız olduğunda fallback veya merdivendeki bir üst modele geçiş yapar.
 * @param {string} toolName
 * @returns {Promise<{switched: boolean, modelId: string|null}>}
 */
async function switchToFallbackModel(toolName) {
  if (!config.modelSwitchingEnabled) return { switched: false, modelId: null };

  const current = await getCurrentLoadedModel();

  // 1. Önce tool'a özel fallback tag varsa onu dene
  const { modelId, tag } = resolveFallbackModelForTool(toolName);
  let targetModel = modelId;

  // 2. Eğer tool'a özel fallback bulunamadıysa veya zaten yüklüyse, Merdivendeki bir üst modeli dene
  if (!targetModel || (current && current.toLowerCase().includes(targetModel.toLowerCase()))) {
    const nextLadder = getNextLadderModel(current, toolName);
    if (nextLadder) {
      targetModel = nextLadder;
      broadcastTerminal(`> [MODEL MANAGER] Tool "${toolName}" için fallback merdiveni devreye girdi → Hedef: "${targetModel}"\n`);
    }
  }

  if (!targetModel) {
    broadcastTerminal(`> [MODEL MANAGER] No fallback or ladder model available for tool: ${toolName}. Keeping current.\n`);
    return { switched: false, modelId: null };
  }

  broadcastTerminal(`> [MODEL MANAGER] *** FALLBACK TRIGGERED *** Tool "${toolName}" failed → switching to: "${targetModel}"\n`);
  const success = await switchToModel(targetModel);
  return { switched: success, modelId: success ? targetModel : null };
}

/**
 * Cache'i temizler (test veya zorla yenileme için).
 */
function clearModelCache() {
  _cachedCurrentModel = null;
  _cacheTimestamp = 0;
}

module.exports = {
  getCurrentLoadedModel,
  ejectModel,
  loadModel,
  waitForModelReady,
  resolveModelByTag,
  resolveModelForTool,
  resolveFallbackModelForTool,
  resolveSuitableModel,
  ensureModelLoaded,
  getNextLadderModel,
  applyModelModeProfile,
  switchToModel,
  switchModelForTool,
  switchToFallbackModel,
  clearModelCache
};
