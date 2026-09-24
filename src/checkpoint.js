/**
 * checkpoint.js — Task Checkpoint & Resume Sistemi
 *
 * Ajan çalışırken her başarılı adım sonrası görevin tam durumunu diske yazar.
 * Sunucu yeniden başlatıldığında veya görev yarıda kaldığında bu checkpoint
 * kullanıcıya sunulur ve kullanıcının onayıyla ajan kaldığı yerden devam eder.
 *
 * Checkpoint dosyaları: scratch/checkpoints/checkpoint_latest.json
 */

const fs = require('fs');
const path = require('path');

const CHECKPOINT_DIR = path.join(process.cwd(), 'scratch', 'checkpoints');
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, 'checkpoint_latest.json');
const CHECKPOINT_MAX_MESSAGES = 80; // Checkpoint içine kaydedilecek maksimum mesaj sayısı

/**
 * Checkpoint klasörünü oluşturur (yoksa)
 */
function ensureCheckpointDir() {
  if (!fs.existsSync(CHECKPOINT_DIR)) {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }
}

/**
 * Mevcut ajan durumunu checkpoint olarak kaydeder.
 * @param {object} agentState — Güncel agentState nesnesi
 * @param {number} stepIndex — O anki adım numarası
 * @param {object} config — Aktif config
 */
function saveCheckpoint(agentState, stepIndex, config) {
  try {
    ensureCheckpointDir();

    // Sadece gerekli ve serileştirilebilir alanları kaydet
    const checkpoint = {
      version: 2,
      savedAt: new Date().toISOString(),
      stepIndex,
      task: agentState.task,
      activeMode: agentState.activeMode,
      activeSubMode: agentState.activeSubMode,
      status: agentState.status,
      planSteps: agentState.planSteps || [],
      executedTools: agentState.executedTools || [],
      thoughts: agentState.thoughts || [],
      selectedGuides: agentState.selectedGuides || [],
      activeGuideName: agentState.activeGuideName || null,
      // Mesajları keserek kaydet (çok büyük olabilir)
      messages: (agentState.messages || [])
        .slice(-CHECKPOINT_MAX_MESSAGES)
        .map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content.substring(0, 8000) : m.content,
          agentRole: m.agentRole || null,
          // imagePath'i checkpoint'e dahil etmiyoruz (büyük binary data olabilir)
        })),
      lastToolOutput: agentState.lastToolOutput
        ? String(agentState.lastToolOutput).substring(0, 4000)
        : '',
      // Config'den sadece görevle ilgili olanları kaydet
      configSnapshot: {
        maxSteps: config.maxSteps,
        temperature: config.temperature,
        advancedReasoningMode: config.advancedReasoningMode,
        forceTaskPlan: config.forceTaskPlan,
        hpmMode: config.hpmMode,
        lpmMode: config.lpmMode,
      }
    };

    // Atomic write: önce temp'e yaz, sonra rename
    const tmpPath = `${CHECKPOINT_FILE}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    fs.renameSync(tmpPath, CHECKPOINT_FILE);

    return true;
  } catch (err) {
    console.warn('[CHECKPOINT] Save failed (non-fatal):', err.message);
    return false;
  }
}

/**
 * En son checkpoint'i diskten okur.
 * @returns {object|null} — Checkpoint nesnesi ya da null (yoksa/hatalıysa)
 */
function loadCheckpoint() {
  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return null;
    const raw = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
    const cp = JSON.parse(raw);

    // Geçerlilik kontrolü
    if (!cp || !cp.task || !cp.savedAt || cp.version < 2) {
      return null;
    }

    // Çok eski checkpoint'leri yoksay (24 saatten eski)
    const savedAge = Date.now() - new Date(cp.savedAt).getTime();
    if (savedAge > 24 * 60 * 60 * 1000) {
      console.log('[CHECKPOINT] Found checkpoint is older than 24h, ignoring.');
      deleteCheckpoint();
      return null;
    }

    // Sadece yarıda kalmış görevlerin checkpoint'ini sun
    // (completed/failed olanlar geçersiz)
    if (cp.status === 'completed' || cp.status === 'idle') {
      return null;
    }

    return cp;
  } catch (err) {
    console.warn('[CHECKPOINT] Load failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * Checkpoint'i diskten siler (görev tamamlandığında çağrılır)
 */
function deleteCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE);
    }
  } catch (err) {
    console.warn('[CHECKPOINT] Delete failed (non-fatal):', err.message);
  }
}

/**
 * Checkpoint'in özet bilgisini döndürür (frontend'e göndermek için)
 * @param {object} cp — loadCheckpoint() çıktısı
 * @returns {object}
 */
function getCheckpointSummary(cp) {
  if (!cp) return null;

  const savedDate = new Date(cp.savedAt);
  const ageMinutes = Math.round((Date.now() - savedDate.getTime()) / 60000);

  const completedSteps = (cp.planSteps || []).filter(s => s.status === 'completed').length;
  const totalSteps = (cp.planSteps || []).length;

  return {
    task: String(cp.task || '').substring(0, 150),
    savedAt: cp.savedAt,
    ageMinutes,
    ageLabel: ageMinutes < 60
      ? `${ageMinutes} dakika önce`
      : `${Math.round(ageMinutes / 60)} saat önce`,
    stepIndex: cp.stepIndex || 0,
    completedSteps,
    totalSteps,
    activeMode: cp.activeMode || 'agent',
    progressLabel: totalSteps > 0
      ? `${completedSteps}/${totalSteps} adım tamamlandı`
      : `${cp.stepIndex || 0} adım işlendi`
  };
}

/**
 * Checkpoint verilerini agentState'e geri yükler (resume senaryosu için)
 * @param {object} cp — loadCheckpoint() çıktısı
 * @param {object} agentState — Yüklenecek hedef state
 * @param {object} config — Aktif config
 */
function restoreCheckpointToState(cp, agentState, config) {
  if (!cp) return false;

  try {
    agentState.task = cp.task;
    agentState.activeMode = cp.activeMode || agentState.activeMode;
    agentState.activeSubMode = cp.activeSubMode || agentState.activeSubMode;
    agentState.planSteps = cp.planSteps || [];
    agentState.executedTools = cp.executedTools || [];
    agentState.thoughts = cp.thoughts || [];
    agentState.selectedGuides = cp.selectedGuides || [];
    agentState.activeGuideName = cp.activeGuideName || null;
    agentState.messages = cp.messages || [];
    agentState.lastToolOutput = cp.lastToolOutput || '';

    // Config snapshot'ı uygula
    if (cp.configSnapshot) {
      if (typeof cp.configSnapshot.advancedReasoningMode === 'boolean') {
        config.advancedReasoningMode = cp.configSnapshot.advancedReasoningMode;
      }
      if (typeof cp.configSnapshot.forceTaskPlan === 'boolean') {
        config.forceTaskPlan = cp.configSnapshot.forceTaskPlan;
      }
    }

    return true;
  } catch (err) {
    console.error('[CHECKPOINT] Restore failed:', err.message);
    return false;
  }
}

module.exports = {
  saveCheckpoint,
  loadCheckpoint,
  deleteCheckpoint,
  getCheckpointSummary,
  restoreCheckpointToState,
  CHECKPOINT_FILE
};
