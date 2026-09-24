// Client WebSocket State Management
let ws = null;
let activeTab = 'chat';
let currentConfig = {};
let currentCwd = '';
let currentPendingAction = null;
const sessionScreenshots = new Set();
let localAgentState = {};

// --- Global Toast Notification (replaces alert() calls) ---
function showToast(message, type = 'success') {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();
  const colMap = { success: '#28a745', error: '#dc3545', warning: '#ffc107', info: '#007acc' };
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
    `background:var(--bg-secondary, #1e1e2e)`,
    `border-left:4px solid ${colMap[type] || colMap.success}`,
    'color:#e0e0e0', 'padding:12px 18px', 'border-radius:6px',
    'font-size:13px', 'max-width:400px', 'line-height:1.4',
    'box-shadow:0 4px 20px rgba(0,0,0,0.5)', 'opacity:1',
    'transition:opacity 0.4s ease', 'pointer-events:none'
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}
function addScreenshotToGrid(path) {
  if (sessionScreenshots.has(path)) return;
  sessionScreenshots.add(path);
  
  const grid = document.getElementById('screenshots-grid');
  if (!grid) return;
  
  const noScreenshots = grid.querySelector('.no-screenshots');
  if (noScreenshots) noScreenshots.remove();
  
  const card = document.createElement('div');
  card.className = 'screenshot-card';
  card.onclick = () => window.open(path, '_blank');
  
  const img = document.createElement('img');
  img.src = path;
  img.alt = 'Captured Screen';
  
  const time = document.createElement('div');
  time.className = 'screenshot-time';
  time.textContent = new Date().toLocaleTimeString();
  
  card.appendChild(img);
  card.appendChild(time);
  grid.appendChild(card);
}

// DOM Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const cwdDisplay = document.getElementById('cwd-display');
const cwdInput = document.getElementById('cwd-input');
const cwdBtn = document.getElementById('cwd-btn');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const terminalBody = document.getElementById('terminal-body');
const clearTerminalBtn = document.getElementById('btn-clear-terminal');
const clearChatBtn = document.getElementById('btn-clear-chat');
const thinkingRow = document.getElementById('thinking-row');
const abortBtn = document.getElementById('btn-abort');

// Staged Approval Drawer Elements
const approvalDrawer = document.getElementById('approval-drawer');
const riskLevelBadge = document.getElementById('risk-level');
const riskExplanation = document.getElementById('risk-explanation');
const actionName = document.getElementById('action-name');
const actionRationale = document.getElementById('action-rationale');
const actionArguments = document.getElementById('action-arguments');
const rejectionFeedback = document.getElementById('rejection-feedback');
const approveBtn = document.getElementById('btn-approve');
const rejectBtn = document.getElementById('btn-reject');

// Config Form Elements
const settingUrl = document.getElementById('setting-url');
const settingModel = document.getElementById('setting-model');
const settingTemp = document.getElementById('setting-temp');
const settingSteps = document.getElementById('setting-steps');
const settingPrompt = document.getElementById('setting-prompt');
const bannedBadgesContainer = document.getElementById('banned-badges');
const newBannedInput = document.getElementById('new-banned-input');
const addBannedBtn = document.getElementById('btn-add-banned');
const saveSettingsBtn = document.getElementById('btn-save-settings');

// Metric Elements
const statTokens = document.getElementById('stat-tokens');
const statActions = document.getElementById('stat-actions');
const statBlocks = document.getElementById('stat-blocks');

let allowedActionsCount = 0;
let blockedActionsCount = 0;

// Authentication Modal Helpers
function showAuthModal(errorMsg = '') {
  const modal = document.getElementById('auth-modal');
  const msgEl = document.getElementById('auth-status-msg');
  const input = document.getElementById('auth-founder-key');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (msgEl) {
    if (errorMsg) {
      msgEl.textContent = errorMsg;
      msgEl.classList.remove('hidden');
    } else {
      msgEl.textContent = '';
      msgEl.classList.add('hidden');
    }
  }
  if (input) {
    setTimeout(() => input.focus(), 100);
  }
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
}

// Bind auth form submit once
if (!window._authFormBound) {
  window._authFormBound = true;
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('auth-form');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('auth-founder-key');
        const val = input ? input.value.trim() : '';
        if (!val) return;
        localStorage.setItem('founderKey', val);
        hideAuthModal();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'auth', key: val }));
        } else {
          initWebSocket();
        }
      };
    }
  });
}

// Initialize Websocket Connection
function initWebSocket() {
  window.initWebSocket = initWebSocket;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);
  window.ws = ws;

  ws.onopen = () => {
    console.log('Connected to agent server.');
    appendTerminal('\n*** SYSTEM: Connected to agent backend server. Authenticating... ***\n');
    
    // Auth flow
    let savedKey = localStorage.getItem('founderKey');
    if (!savedKey) {
      showAuthModal('Devam etmek için lütfen Founder Password (Yönetici Şifresi) girin.');
      return;
    }
    
    ws.send(JSON.stringify({ type: 'auth', key: savedKey }));
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error('WS: Failed to parse JSON message:', e);
      return; // Safely ignore malformed packets
    }
    
    switch (data.type) {
      case 'auth_success':
        console.log('Authentication successful.');
        appendTerminal('\n*** SYSTEM: Authentication successful. ***\n');
        hideAuthModal();
        break;
      case 'state':
        localAgentState = { ...data };
        updateUIState(localAgentState);
        break;
      case 'state_patch':
        if (data.patch) {
          Object.assign(localAgentState, data.patch);
          if (data.patch.newMessages) {
             if (!localAgentState.messages) localAgentState.messages = [];
             localAgentState.messages = localAgentState.messages.concat(data.patch.newMessages);
             // Trigger TTS for new assistant messages
             if (window.ttsEnabled && window.speechSynthesis) {
                data.patch.newMessages.forEach(msg => {
                   if (msg.role === 'assistant' && msg.content) {
                      const u = new SpeechSynthesisUtterance(msg.content);
                      u.lang = 'tr-TR';
                      window.speechSynthesis.speak(u);
                   }
                });
             }
          }
          if (data.patch.messages) {
             localAgentState.messages = data.patch.messages;
          }
          updateUIState(localAgentState);
        }
        break;
      case 'settings':
        updateSettingsUI(data.settings);
        break;
      case 'model_modes_applied':
        if (data.modes) {
          if (typeof updateSettingsUI === 'function') {
            updateSettingsUI(Object.assign({}, currentConfig, data.modes));
          }
          if (typeof showToast === 'function') {
            showToast(`"${data.modelId}" için otomatik modlar uygulandı!`, 'info');
          }
        }
        break;
      case 'terminal':
        appendTerminal(data.data);
        break;
      case 'guide_content':
        const nameInput = document.getElementById('editor-guide-name');
        const contentArea = document.getElementById('editor-guide-content');
        if (nameInput) nameInput.value = data.name;
        if (contentArea) contentArea.value = data.content;
        break;
      case 'discord_state':
        updateDiscordUI(data);
        break;
      case 'admin_data':
        updateAdminUI(data);
        break;
      case 'system_metrics':
        const cpuEl = document.getElementById('admin-sys-cpu');
        const ramEl = document.getElementById('admin-sys-ram');
        const ramMbEl = document.getElementById('admin-sys-ram-mb');
        if (cpuEl) cpuEl.textContent = `${data.cpu}%`;
        if (ramEl) ramEl.textContent = `${data.ram}%`;
        if (ramMbEl) ramMbEl.textContent = `${data.ramUsedMB} MB / ${data.ramTotalMB} MB`;
        break;
      case 'error':
        if (data.message && data.message.toLowerCase().includes('admin key')) {
          localStorage.removeItem('founderKey');
          showAuthModal('❌ Hatalı Founder Password! Lütfen doğru şifreyi girin.');
        }
        showToast(`Error: ${data.message}`, 'error');
        appendTerminal(`\n[BACKEND ERROR] ${data.message}\n`);
        break;
      case 'sandbox_state':
        updateSandboxUI(data);
        break;
      case 'library_data':
        if (window.updateLibraryData) {
          window.updateLibraryData(data.categories, data.files);
        }
        break;
      case 'deep_research_progress':
        const stepEl = document.getElementById('dr-step-display');
        const urlEl = document.getElementById('dr-url-display');
        const summaryEl = document.getElementById('dr-summary-display');
        if (stepEl) stepEl.textContent = `${data.step} / ${data.total}`;
        if (urlEl) {
          urlEl.textContent = data.url;
          urlEl.title = data.url;
        }
        if (summaryEl) summaryEl.textContent = data.summarySnippet || 'Henüz özet yok.';
        break;
      case 'task_step':
        if (data.step) handleTaskStep(data.step);
        break;
      case 'task_steps_clear':
        clearTaskLivePanel();
        break;
      case 'toast':
        showToast(data.message, data.level || 'info');
        break;
      case 'checkpoint_available':
        showCheckpointBanner(data.checkpoint);
        break;
    }
  };

  ws.onclose = (event) => {
    console.log('Connection closed. Code:', event.code);
    if (event.code === 1008) {
      appendTerminal('\n*** SYSTEM: Kimlik doğrulama reddedildi (1008). Şifre girişi bekleniyor... ***\n');
      showAuthModal('❌ Kimlik doğrulama başarısız. Lütfen geçerli Founder Password girin.');
      return; // Do NOT continuously loop
    }
    appendTerminal('\n*** SYSTEM: Connection lost. Reconnecting in 3s... ***\n');
    setTimeout(initWebSocket, 3000);
  };
}

// ----------------------------------------------------
// Checkpoint Resume Banner
// ----------------------------------------------------

function showCheckpointBanner(cp) {
  // Eski banner varsa kaldır
  const existing = document.getElementById('checkpoint-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'checkpoint-banner';
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99998',
    'background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)',
    'border-bottom:2px solid #4a9eff', 'padding:14px 20px',
    'display:flex', 'align-items:center', 'gap:16px',
    'font-size:13px', 'color:#c8d6e5',
    'box-shadow:0 4px 20px rgba(0,0,0,0.6)'
  ].join(';');

  const progressText = cp.progressLabel || `${cp.stepIndex} adım işlendi`;
  const taskPreview = cp.task ? cp.task.substring(0, 100) + (cp.task.length > 100 ? '...' : '') : 'Bilinmeyen görev';

  banner.innerHTML = `
    <span style="font-size:20px">⏸️</span>
    <div style="flex:1">
      <div style="font-weight:600;color:#4a9eff;margin-bottom:3px">Yarıda Kalan Görev Bulundu</div>
      <div style="color:#8899aa;font-size:12px">
        <strong style="color:#c8d6e5">${taskPreview}</strong>
        &nbsp;·&nbsp; ${progressText} &nbsp;·&nbsp; <span style="color:#6b7c93">${cp.ageLabel || ''}</span>
      </div>
    </div>
    <button id="cp-resume-btn" style="
      background:#4a9eff;color:#fff;border:none;padding:8px 18px;
      border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;
      transition:background 0.2s
    ">▶ Devam Et</button>
    <button id="cp-dismiss-btn" style="
      background:transparent;color:#6b7c93;border:1px solid #2d3f55;
      padding:8px 14px;border-radius:6px;cursor:pointer;font-size:12px;
      transition:all 0.2s
    ">✕ Yoksay</button>
  `;

  document.body.prepend(banner);

  // Buton event'leri
  banner.querySelector('#cp-resume-btn').addEventListener('click', () => {
    banner.remove();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resume_checkpoint' }));
      showToast('Görev devam ettiriliyor...', 'info');
    }
  });

  banner.querySelector('#cp-dismiss-btn').addEventListener('click', () => {
    banner.remove();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'delete_checkpoint' }));
    }
  });
}

// ----------------------------------------------------
// UI Update Handlers
// ----------------------------------------------------

let adminDataState = {};

function updateAdminUI(data) {
  adminDataState = data;
  
  if (data.env) {
    if (document.getElementById('admin-env-port')) document.getElementById('admin-env-port').value = data.env.PORT || '';
    if (document.getElementById('admin-env-founderkey')) document.getElementById('admin-env-founderkey').value = data.env.FOUNDER_KEY || '';
    if (document.getElementById('admin-env-token')) document.getElementById('admin-env-token').value = data.env.DISCORD_TOKEN || '';
    if (document.getElementById('admin-env-founderid')) document.getElementById('admin-env-founderid').value = data.env.FOUNDER_DISCORD_ID || '';

    const sFounderKey = document.getElementById('setting-env-founderkey');
    const sToken = document.getElementById('setting-env-token');
    const sFounderId = document.getElementById('setting-env-founderid');
    if (sFounderKey && !sFounderKey.value) sFounderKey.value = data.env.FOUNDER_KEY || '';
    if (sToken && !sToken.value) sToken.value = data.env.DISCORD_TOKEN || '';
    if (sFounderId && !sFounderId.value) sFounderId.value = data.env.FOUNDER_DISCORD_ID || '';
  }
  
  if (data.securityRules) {
    document.getElementById('admin-security-folders').value = (data.securityRules.allowedBaseFolders || []).join(', ');
    document.getElementById('admin-security-words').value = (data.securityRules.bannedWords || []).join(', ');
    document.getElementById('admin-security-websites').value = (data.securityRules.bannedWebsites || []).join(', ');
  }
  
  if (data.kurucu) {
    document.getElementById('admin-discord-founder').value = data.kurucu.founder || '';
  }
  
  if (data.configJson) {
    const configData = Array.isArray(data.configJson) ? data.configJson[0] : data.configJson;
    if (configData) {
      document.getElementById('admin-discord-admins').value = (configData.admins || []).join(', ');
      document.getElementById('admin-discord-speed').value = configData.connectionSpeedLimit !== undefined ? configData.connectionSpeedLimit : 0.7;
    }
  }
  
  if (data.permissions) {
    const permData = Array.isArray(data.permissions) ? data.permissions[0] : data.permissions;
    if (permData) {
      document.getElementById('admin-discord-users').value = (permData.authorizedUsers || []).join(', ');
    }
  }
  
  const memoryListDiv = document.getElementById('admin-memory-list');
  if (memoryListDiv) {
    memoryListDiv.innerHTML = '';
    if (!data.memory || data.memory.length === 0) {
      memoryListDiv.innerHTML = '<span style="color: var(--text-muted);">Henüz kayıtlı bellek geçmişi bulunmuyor.</span>';
    } else {
      data.memory.forEach((mem, idx) => {
        const item = document.createElement('div');
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.style.padding = '8px 0';
        const isRule = mem.isRule ? '<span style="color: var(--color-warning, #f59e0b); font-weight: bold;">[KURAL]</span> ' : '';
        item.innerHTML = `
          <strong style="color: var(--color-primary);">[${idx + 1}] Görev:</strong> ${isRule}${mem.task}<br>
          <strong style="color: var(--color-success);">Özet:</strong> ${mem.summary}<br>
          <span style="color: var(--text-muted); font-size: 0.75rem;">Tarih: ${new Date(mem.createdAt || mem.date).toLocaleString()} | Erişim: ${mem.accessCount || 0}</span>
        `;
        memoryListDiv.appendChild(item);
      });
    }
  }

  const pendingRulesDiv = document.getElementById('admin-pending-rules-list');
  if (pendingRulesDiv) {
    pendingRulesDiv.innerHTML = '';
    if (!data.pendingRules || data.pendingRules.length === 0) {
      pendingRulesDiv.innerHTML = '<span style="color: var(--text-muted);">Onay bekleyen güvenlik kuralı bulunmuyor.</span>';
    } else {
      data.pendingRules.forEach((rule, idx) => {
        const item = document.createElement('div');
        item.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
        item.style.padding = '8px 0';
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
            <div style="flex: 1;">
              <strong style="color: var(--color-warning, #f59e0b);">[Kural ${idx + 1}]</strong> ${rule.rule}<br>
              <span style="color: var(--text-muted); font-size: 0.75rem;">Kategori: ${rule.category} | Tarih: ${new Date(rule.createdAt).toLocaleString()}</span>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-save" style="padding: 4px 10px; font-size: 0.75rem; cursor: pointer;" onclick="approveRule('${rule.id}')">Onayla</button>
              <button class="btn btn-reject" style="padding: 4px 10px; font-size: 0.75rem; cursor: pointer;" onclick="rejectRule('${rule.id}')">Sil</button>
            </div>
          </div>
        `;
        pendingRulesDiv.appendChild(item);
      });
    }
  }
}

window.approveRule = function(ruleId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'approve_pending_rule', ruleId }));
    if (typeof showToast === 'function') showToast('Güvenlik kuralı onaylandı ve hafızaya eklendi.', 'success');
  }
};

window.rejectRule = function(ruleId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'reject_pending_rule', ruleId }));
    if (typeof showToast === 'function') showToast('Kural reddedildi ve silindi.', 'info');
  }
};

function updateSandboxUI(data) {
  const sandboxCard = document.getElementById('sandbox-card');
  const sandboxFilesDiv = document.getElementById('sandbox-files');
  if (!sandboxCard || !sandboxFilesDiv) return;

  const files = data.files || [];
  if (files.length === 0) {
    sandboxCard.classList.add('hidden');
    sandboxFilesDiv.innerHTML = '';
    return;
  }

  sandboxCard.classList.remove('hidden');
  sandboxFilesDiv.innerHTML = '';

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = 'sandbox-file-item';
    
    const pathSpan = document.createElement('span');
    pathSpan.className = 'sandbox-file-path';
    pathSpan.textContent = file;
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'sandbox-file-actions';
    
    const commitBtn = document.createElement('button');
    commitBtn.className = 'sandbox-btn btn-sandbox-commit';
    commitBtn.textContent = 'Aç (Commit)';
    commitBtn.onclick = () => {
      ws.send(JSON.stringify({ type: 'commit_sandbox_file', path: file }));
    };
    
    discardBtn = document.createElement('button');
    discardBtn.className = 'sandbox-btn btn-sandbox-discard';
    discardBtn.textContent = 'Sil (Discard)';
    discardBtn.onclick = () => {
      ws.send(JSON.stringify({ type: 'discard_sandbox_file', path: file }));
    };
    
    actionsDiv.appendChild(commitBtn);
    actionsDiv.appendChild(discardBtn);
    
    item.appendChild(pathSpan);
    item.appendChild(actionsDiv);
    
    sandboxFilesDiv.appendChild(item);
  });
}

function updateUIState(state) {
  currentPendingAction = state.pendingAction;
  // 1. Status Indicator
  statusDot.className = `status-dot ${state.status}`;
  statusText.textContent = state.status.charAt(0).toUpperCase() + state.status.slice(1).replace('_', ' ');

  // 1b. Active Mode Indicator
  const modeTag = document.getElementById('active-mode-tag');
  if (modeTag) {
    if (state.activeGuideName) {
      modeTag.textContent = `Mode: ${state.activeGuideName.replace('.md', '')}`;
      let glowClass = 'mode-general';
      const nameLower = state.activeGuideName.toLowerCase();
      if (nameLower.includes('powershell') || nameLower.includes('cmd') || nameLower.includes('dlp')) {
        glowClass = 'mode-tech';
      } else if (nameLower.includes('obsidian') || nameLower.includes('collab') || nameLower.includes('team')) {
        glowClass = 'mode-collab';
      }
      modeTag.className = `logo-tag active-mode ${glowClass}`;
    } else {
      modeTag.textContent = 'Mode: None';
      modeTag.className = 'logo-tag';
    }
  }

  // 1c. Available Guides Dropdowns
  if (state.availableGuides) {
    const modeSelect = document.getElementById('ui-mode-select');
    const editorSelect = document.getElementById('editor-guide-select');
    
    if (modeSelect) {
      const currentVal = modeSelect.value;
      modeSelect.innerHTML = '<option value="none">Manual Mode: None</option>';
      state.availableGuides.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.replace('.md', '');
        modeSelect.appendChild(opt);
      });
      if (state.activeGuideName) {
        modeSelect.value = state.activeGuideName;
      } else {
        modeSelect.value = 'none';
      }
    }
    
    if (editorSelect) {
      const currentVal = editorSelect.value;
      editorSelect.innerHTML = '<option value="">-- Create New Guide --</option>';
      state.availableGuides.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        editorSelect.appendChild(opt);
      });
      editorSelect.value = currentVal;
    }
  }

  // 2. Working Directory
  currentCwd = state.cwd;
  if (cwdDisplay) cwdDisplay.textContent = state.cwd;

  // 3. Render Thinking Row
  if (state.status === 'thinking' || state.status === 'executing') {
    thinkingRow.classList.remove('hidden');
  } else {
    thinkingRow.classList.add('hidden');
  }

  // 3b. Manual Bridge Panel
  const bridgePanel = document.getElementById('manual-bridge-panel');
  const bridgePromptBox = document.getElementById('bridge-prompt-box');
  if (bridgePanel) {
    if (state.status === 'manual_bridge') {
      bridgePanel.classList.remove('hidden');
      if (bridgePromptBox && state.manualBridgePrompt) {
        bridgePromptBox.value = state.manualBridgePrompt;
      }
      // Scroll bridge panel into view
      if (activeTab === 'chat') {
        bridgePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      // Clear previous response textarea
      const responseBox = document.getElementById('bridge-response-box');
      if (responseBox && responseBox.value === '[sent]') {
        responseBox.value = '';
      }
    } else {
      bridgePanel.classList.add('hidden');
    }
  }

  // 4. Render Messages
  renderMessages(state.messages);

  // 4b. Render Execution Plan steps if any
  const planCard = document.getElementById('plan-card');
  const planStepsContainer = document.getElementById('plan-steps');
  if (state.planSteps && state.planSteps.length > 0) {
    planCard.classList.remove('hidden');
    planStepsContainer.innerHTML = '';
    state.planSteps.forEach((step) => {
      const stepEl = document.createElement('div');
      stepEl.className = `plan-step ${step.status}`;
      
      const icon = step.status === 'completed' ? '✅' : (step.status === 'current' ? '⚡' : '⚪');
      stepEl.innerHTML = `
        <span class="plan-step-icon">${icon}</span>
        <span class="plan-step-text">${step.text}</span>
      `;
      planStepsContainer.appendChild(stepEl);
    });
  } else {
    planCard.classList.add('hidden');
  }

  // 5. Action Approval Drawer
  if (state.status === 'pending_approval' && state.pendingAction) {
    const action = state.pendingAction;
    
    // Reset feedback text
    rejectionFeedback.value = '';

    approvalDrawer.classList.remove('hidden');
    actionName.textContent = action.action;
    actionRationale.textContent = action.explanation || 'No reasoning provided by AI.';
    
    // Determine input payload format based on tool action
    let valueToEdit = '';
    if (action.action === 'execute_command') {
      valueToEdit = action.command;
    } else if (action.action === 'open_application') {
      valueToEdit = action.target;
    } else if (action.action === 'web_search') {
      valueToEdit = action.query;
    } else if (action.action === 'view_website') {
      valueToEdit = action.url;
    } else if (action.action === 'read_file' || action.action === 'list_directory') {
      valueToEdit = action.path;
    } else if (action.action === 'write_file') {
      valueToEdit = JSON.stringify({ path: action.path, content: action.content }, null, 2);
    } else {
      valueToEdit = JSON.stringify(action, null, 2);
    }
    
    actionArguments.value = valueToEdit;

    // Risk indicator
    riskLevelBadge.className = `badge-risk-level ${(action.risk?.level || 'low').toLowerCase()}`;
    riskLevelBadge.textContent = `${action.risk?.level || 'Low'} Risk`;
    riskExplanation.textContent = action.risk?.message || '';

    // Apply critical risk style to approval drawer if applicable
    if (action.risk && action.risk.level === 'CRITICAL') {
      approvalDrawer.classList.add('critical-risk');
    } else {
      approvalDrawer.classList.remove('critical-risk');
    }

    // Scroll approval view into focus if active tab is chat
    if (activeTab === 'chat') {
      approvalDrawer.scrollIntoView({ behavior: 'smooth' });
    }
  } else {
    approvalDrawer.classList.add('hidden');
    approvalDrawer.classList.remove('critical-risk');
    rejectionFeedback.value = ''; // Reset input
  }

  // 6. Metrics & Real-Time Cost Update
  if (state.metrics && state.metrics.cost) {
    if (statTokens) statTokens.textContent = (state.metrics.cost.totalTokens || 0).toLocaleString();
    const costEl = document.getElementById('stat-cost');
    if (costEl) costEl.textContent = `$${(state.metrics.cost.totalCostUSD || 0).toFixed(4)}`;
  }
}

// -----------------------------------------------------------------------
// Message Rendering — Incremental (O(new) instead of O(total) per update)
// -----------------------------------------------------------------------
let _lastRenderedMsgCount = 0;
let _welcomeActive = true;

const _WELCOME_HTML = `
  <div class="system-welcome">
    <h2>Welcome to Stellarigent!</h2>
    <p>Ensure your LM Studio Local Server is turned <strong>ON</strong> and a model is loaded. Type a task below to let the agent perform local operations.</p>
    <div class="examples-grid">
      <button class="example-btn">"Open notepad and write a python script"</button>
      <button class="example-btn">"Search Google/DuckDuckGo for latest Node.js news"</button>
      <button class="example-btn">"List files in the current folder and check size"</button>
    </div>
  </div>
`;

function _attachExampleBtns() {
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.onclick = () => {
      chatInput.value = btn.innerText.replace(/"/g, '');
      chatInput.focus();
    };
  });
}

function createMessageElement(msg) {
  const isSystem = msg.role === 'system';
  const bubble = document.createElement('div');
  bubble.className = `chat-message ${msg.role}`;

  const header = document.createElement('div');
  header.className = 'chat-message-header';
  header.textContent = msg.role === 'assistant' ? 'Local Agent' : msg.role.toUpperCase();

  if (msg.agentRole) {
    const badge = document.createElement('span');
    badge.className = `chat-message-badge ${msg.agentRole.toLowerCase()}`;
    badge.textContent = msg.agentRole;
    header.appendChild(badge);
  }
  bubble.appendChild(header);

  const body = document.createElement('div');
  body.className = 'chat-message-body';
  body.innerHTML = formatMarkdown(msg.content);

  if (isSystem && msg.content.includes('/screenshots/')) {
    const match = msg.content.match(/"filename":\s*"([^"]+)"/);
    if (match && match[1]) {
      const screenshotPath = match[1];
      const img = document.createElement('img');
      img.src = screenshotPath;
      img.className = 'chat-screenshot-preview';
      img.alt = 'Desktop Capture';
      img.onclick = () => window.open(screenshotPath, '_blank');
      body.appendChild(img);
      addScreenshotToGrid(screenshotPath);
    }
  }
  bubble.appendChild(body);
  return bubble;
}

function renderMessages(messages) {
  if (messages.length === 0) {
    if (!_welcomeActive) {
      chatMessages.innerHTML = _WELCOME_HTML;
      _attachExampleBtns();
      _welcomeActive = true;
      _lastRenderedMsgCount = 0;
    }
    return;
  }

  if (_welcomeActive) {
    chatMessages.innerHTML = '';
    _welcomeActive = false;
    _lastRenderedMsgCount = 0;
  }

  if (messages.length > _lastRenderedMsgCount) {
    const newMsgs = messages.slice(_lastRenderedMsgCount);
    newMsgs.forEach(msg => chatMessages.appendChild(createMessageElement(msg)));
    _lastRenderedMsgCount = messages.length;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (messages.length < _lastRenderedMsgCount) {
    chatMessages.innerHTML = '';
    _lastRenderedMsgCount = 0;
    messages.forEach(msg => chatMessages.appendChild(createMessageElement(msg)));
    _lastRenderedMsgCount = messages.length;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// -----------------------------------------------------------------------
// Markdown Parser — bold, italic, h1-h4, lists, blockquote, code blocks
// -----------------------------------------------------------------------
function formatMarkdown(text) {
  if (!text) return '';

  // Step 1: Extract and protect code blocks before any other processing
  const codeBlocks = [];
  let s = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cls = lang ? ` class="lang-${lang}"` : '';
    codeBlocks.push(`<pre><code${cls}>${esc}</code></pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Step 2: HTML-escape remaining text
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Step 3: Inline code
  s = s.replace(/`([^`\n]+)`/g,
    '<code style="background:#1e1e1e;padding:1px 5px;border-radius:3px;font-family:monospace;font-size:0.88em">$1</code>');

  // Step 4: Headings (process h4→h1 in order to avoid double-match)
  s = s.replace(/^#{4}\s+(.+)$/gm, '<h5 style="margin:4px 0;color:#9cdcfe;font-size:0.9em;font-weight:600">$1</h5>');
  s = s.replace(/^#{3}\s+(.+)$/gm, '<h4 style="margin:6px 0 2px;color:#9cdcfe;font-weight:600">$1</h4>');
  s = s.replace(/^#{2}\s+(.+)$/gm, '<h3 style="margin:8px 0 3px;color:#9cdcfe;font-size:1.1em">$1</h3>');
  s = s.replace(/^#{1}\s+(.+)$/gm, '<h2 style="margin:10px 0 4px;color:#dda0dd;font-size:1.2em">$1</h2>');

  // Step 5: Bold + Italic (*** before ** before *)
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g,    '<em>$1</em>');
  s = s.replace(/_([^_\n]+?)_/g,      '<em>$1</em>');

  // Step 6: Strikethrough
  s = s.replace(/~~(.+?)~~/g, '<s style="opacity:0.6">$1</s>');

  // Step 7: Blockquote (note: > was escaped to &gt;)
  s = s.replace(/^&gt;\s*(.+)$/gm,
    '<blockquote style="border-left:3px solid #555;padding:2px 0 2px 10px;color:#888;margin:4px 0;display:block">$1</blockquote>');

  // Step 8: Unordered list items
  s = s.replace(/^[-*]\s+(.+)$/gm,
    '<div style="display:flex;align-items:baseline;gap:6px;margin:1px 0"><span style="color:#888;flex-shrink:0">&#8226;</span><span>$1</span></div>');

  // Step 9: Restore protected code blocks
  s = s.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  // Step 10: Newlines → <br> (don't add <br> after block-level elements)
  s = s.replace(/\n/g, '<br>');

  return s;
}


// Terminal appends
function appendTerminal(data) {
  terminalBody.textContent += data;
  
  // Cap terminal size to keep browser performant
  if (terminalBody.textContent.length > 100000) {
    terminalBody.textContent = terminalBody.textContent.substring(terminalBody.textContent.length - 80000);
  }
  
  // Auto-scroll
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

// Settings UI populating
function updateSettingsUI(settings) {
  currentConfig = settings;
  if (window.updateSettingsSubpanels) {
    try {
      window.updateSettingsSubpanels(settings);
    } catch (e) {
      console.error('Error in updateSettingsSubpanels:', e);
    }
  }

  if (settingUrl && settings.lmStudioUrl) settingUrl.value = settings.lmStudioUrl;
  if (settingModel && settings.modelName) settingModel.value = settings.modelName;
  if (settingTemp && settings.temperature !== undefined) settingTemp.value = settings.temperature;
  if (settingSteps && settings.maxSteps !== undefined) settingSteps.value = settings.maxSteps;
  if (settingPrompt && settings.systemPrompt !== undefined) settingPrompt.value = settings.systemPrompt;

  if (settings.apiFallbacks) {
    const apiOpenAi = document.getElementById('setting-api-openai');
    const apiAnthropic = document.getElementById('setting-api-anthropic');
    const apiGemini = document.getElementById('setting-api-gemini');
    const apiGroq = document.getElementById('setting-api-groq');
    if (apiOpenAi) apiOpenAi.value = settings.apiFallbacks.openai || '';
    if (apiAnthropic) apiAnthropic.value = settings.apiFallbacks.anthropic || '';
    if (apiGemini) apiGemini.value = settings.apiFallbacks.gemini || '';
    if (apiGroq) apiGroq.value = settings.apiFallbacks.groq || '';
  }

  // Populate Swarm Mode toggle
  const swarmCheckbox = document.getElementById('setting-swarm');
  if (swarmCheckbox) {
    swarmCheckbox.checked = !!settings.swarmMode;
  }

  // Populate LPM Mode toggles
  const settingLpm = document.getElementById('setting-lpm');
  const rLpm = document.getElementById('runner-setting-lpm');
  if (settingLpm) {
    settingLpm.checked = !!settings.lpmMode;
    if (rLpm) rLpm.checked = !!settings.lpmMode;
    document.getElementById('lpm-om-container').style.display = settings.lpmMode ? 'block' : 'none';
    document.getElementById('lpm-batch-container').style.display = settings.lpmMode ? 'block' : 'none';
  }
  const settingLpmOm = document.getElementById('setting-lpm-om');
  const rLpmOm = document.getElementById('runner-setting-lpm-om');
  if (settingLpmOm) {
    settingLpmOm.checked = !!settings.lpmOmMode;
    if (rLpmOm) rLpmOm.checked = !!settings.lpmOmMode;
  }
  const settingLpmBatch = document.getElementById('setting-lpm-batch');
  const lpmBatchVal = document.getElementById('lpm-batch-val');
  const rLpmBatch = document.getElementById('runner-setting-lpm-batch');
  const rLpmBatchVal = document.getElementById('runner-lpm-batch-val');
  if (settingLpmBatch) {
    settingLpmBatch.value = settings.lpmBatchSize || 1;
    if (lpmBatchVal) lpmBatchVal.innerText = settingLpmBatch.value;
    if (rLpmBatch) {
      rLpmBatch.value = settings.lpmBatchSize || 1;
      if (rLpmBatchVal) rLpmBatchVal.innerText = rLpmBatch.value;
    }
  }

  const rForcePlan = document.getElementById('runner-setting-forceplan');
  if (rForcePlan) rForcePlan.checked = !!settings.forceTaskPlan;
  
  const rSimba = document.getElementById('runner-setting-simba');
  if (rSimba) rSimba.checked = !!settings.simbaEnabled;

  // Populate Auto-Approval Whitelist checkboxes
  const tools = ['read_file', 'write_file', 'list_directory', 'web_search', 'view_website', 'open_application'];
  tools.forEach(t => {
    const el = document.getElementById(`approve-${t}`);
    if (el) el.checked = !!(settings.autoApprove && settings.autoApprove[t]);
  });

  // Render banned command badges
  bannedBadgesContainer.innerHTML = '';
  settings.bannedCommands.forEach((banned, idx) => {
    const badge = document.createElement('div');
    badge.className = 'banned-badge';
    badge.innerHTML = `
      <span>${banned}</span>
      <button data-index="${idx}">&times;</button>
    `;
    bannedBadgesContainer.appendChild(badge);
  });

  // Attach delete badges events
  bannedBadgesContainer.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index);
      currentConfig.bannedCommands.splice(idx, 1);
      ws.send(JSON.stringify({
        type: 'update_settings',
        settings: { bannedCommands: currentConfig.bannedCommands }
      }));
    };
  });
}

// ----------------------------------------------------
// Event Listeners Setup
// ----------------------------------------------------

// Tab navigation handler
document.querySelectorAll('.nav-btn').forEach(btn => {
  if (btn.id === 'btn-open-ide') return; // skip for open ide button
  btn.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(b => {
      if (b.id !== 'btn-open-ide') b.classList.remove('active');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    document.getElementById(`panel-${activeTab}`).classList.add('active');
  };
});

const settingLpmEl = document.getElementById('setting-lpm');
if (settingLpmEl) {
  settingLpmEl.addEventListener('change', (e) => {
    document.getElementById('lpm-om-container').style.display = e.target.checked ? 'block' : 'none';
    document.getElementById('lpm-batch-container').style.display = e.target.checked ? 'block' : 'none';
  });
}

const openIdeBtn = document.getElementById('btn-open-ide');
if (openIdeBtn) {
  openIdeBtn.onclick = async () => {
    try {
      const res = await fetch('/api/open-ide', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        alert(data.message || 'Failed to open IDE.');
      }
    } catch (e) {
      console.error(e);
      alert('Error communicating with backend.');
    }
  };
}


// Chat prompt submission
chatForm.onsubmit = (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    const drSlider = document.getElementById('dr-page-slider');
    let pageCount = 20;
    if (drSlider) {
      pageCount = parseInt(drSlider.value) || 20;
    }
    ws.send(JSON.stringify({
      type: 'user_message',
      content: text,
      activeMode: window.agentActiveMode || 'manuel',
      activeSubMode: window.agentActiveSubMode || 'none',
      deepResearchPageCount: pageCount
    }));
    chatInput.value = '';
  } else {
    alert('Websocket is not connected! Please refresh.');
  }
};

// Approval Drawer Events
approveBtn.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!currentPendingAction) return;

  // Gather parameters from approval editor textarea
  const actionObj = { ...currentPendingAction };
  const editedValue = actionArguments.value.trim();

  // Re-map inputs depending on type
  if (actionObj.action === 'execute_command') {
    actionObj.command = editedValue;
  } else if (actionObj.action === 'open_application') {
    actionObj.target = editedValue;
  } else if (actionObj.action === 'web_search') {
    actionObj.query = editedValue;
  } else if (actionObj.action === 'view_website') {
    actionObj.url = editedValue;
  } else if (actionObj.action === 'read_file' || actionObj.action === 'list_directory') {
    actionObj.path = editedValue;
  } else if (actionObj.action === 'write_file') {
    try {
      const parsed = JSON.parse(editedValue);
      actionObj.path = parsed.path;
      actionObj.content = parsed.content;
    } catch (e) {
      alert('Error parsing JSON for write_file parameters! Keep JSON formatting intact.');
      return;
    }
  } else {
    try {
      Object.assign(actionObj, JSON.parse(editedValue));
    } catch (e) {
      alert('Error parsing modified action arguments! Please verify syntax.');
      return;
    }
  }

  // Send approval
  ws.send(JSON.stringify({
    type: 'approve_action',
    action: actionObj
  }));

  allowedActionsCount++;
  statActions.textContent = allowedActionsCount;
};

rejectBtn.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const feedback = rejectionFeedback.value.trim();
  ws.send(JSON.stringify({
    type: 'reject_action',
    feedback: feedback || 'User declined to run this action.'
  }));
};

// Abort currently running loop
abortBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'abort_task' }));
  }
};

// Manual AI Bridge: Copy Prompt
const bridgeCopyBtn = document.getElementById('btn-bridge-copy');
if (bridgeCopyBtn) {
  bridgeCopyBtn.onclick = () => {
    const promptBox = document.getElementById('bridge-prompt-box');
    if (!promptBox || !promptBox.value) return;
    navigator.clipboard.writeText(promptBox.value).then(() => {
      bridgeCopyBtn.textContent = '✅ Kopyalandı!';
      bridgeCopyBtn.classList.add('copied');
      setTimeout(() => {
        bridgeCopyBtn.textContent = '📋 Promptu Kopyala';
        bridgeCopyBtn.classList.remove('copied');
      }, 2500);
    }).catch(() => {
      // Fallback: select all text in textarea
      promptBox.select();
      document.execCommand('copy');
      bridgeCopyBtn.textContent = '✅ Kopyalandı!';
      bridgeCopyBtn.classList.add('copied');
      setTimeout(() => {
        bridgeCopyBtn.textContent = '📋 Promptu Kopyala';
        bridgeCopyBtn.classList.remove('copied');
      }, 2500);
    });
  };
}

// Manual AI Bridge: Send Response
const bridgeSendBtn = document.getElementById('btn-bridge-send');
if (bridgeSendBtn) {
  bridgeSendBtn.onclick = () => {
    const responseBox = document.getElementById('bridge-response-box');
    if (!responseBox) return;
    const responseText = responseBox.value.trim();
    if (!responseText) {
      alert('Lütfen AI\'nin cevabını yapıştırın!');
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('WebSocket bağlantısı yok! Lütfen sayfayı yenileyin.');
      return;
    }
    ws.send(JSON.stringify({
      type: 'manual_ai_response',
      content: responseText
    }));
    responseBox.value = '[sent]';
    bridgeSendBtn.textContent = '⏳ Gönderildi, agent devam ediyor...';
    bridgeSendBtn.disabled = true;
    setTimeout(() => {
      bridgeSendBtn.textContent = '✅ Cevabı Agent\'a Gönder';
      bridgeSendBtn.disabled = false;
    }, 4000);
  };
}

// Reset Chat History
clearChatBtn.onclick = () => {
  if (confirm('Are you sure you want to clear chat history and reset the agent? This stops active tasks.')) {
    ws.send(JSON.stringify({ type: 'clear_chat' }));
    chatMessages.innerHTML = '';
  }
};

// Clear Logs
clearTerminalBtn.onclick = () => {
  terminalBody.textContent = '> Console logs cleared.\n';
};

// Interrupt Task
const btnInterrupt = document.getElementById('btn-interrupt');
if (btnInterrupt) {
  btnInterrupt.onclick = () => {
    const prompt = window.prompt("Lütfen araya girmek ve agent'a eklemek istediğiniz promptu yazın:");
    if (prompt && prompt.trim() !== '') {
      ws.send(JSON.stringify({ type: 'interrupt_task', content: prompt.trim() }));
      alert("Interrupt prompt gönderildi. Agent bir sonraki adımda bunu görecek.");
    }
  };
}

// Update Directory
if (cwdBtn && cwdInput) {
  cwdBtn.onclick = () => {
    const pathVal = cwdInput.value.trim();
    if (pathVal) {
      ws.send(JSON.stringify({
        type: 'update_cwd',
        cwd: pathVal
      }));
      cwdInput.value = '';
    }
  };
}

// Save Settings Event
if (saveSettingsBtn) {
  saveSettingsBtn.onclick = () => {
    const swarmCheckbox = document.getElementById('setting-swarm');
    const swarmMode = swarmCheckbox ? swarmCheckbox.checked : false;
    const autoApprove = {
      read_file: (document.getElementById('approve-read_file') || {}).checked,
      write_file: (document.getElementById('approve-write_file') || {}).checked,
      list_directory: (document.getElementById('approve-list_directory') || {}).checked,
      web_search: (document.getElementById('approve-web_search') || {}).checked,
      view_website: (document.getElementById('approve-view_website') || {}).checked,
      open_application: (document.getElementById('approve-open_application') || {}).checked
    };

    let rawUrl = (settingUrl ? settingUrl.value : '').trim().replace(/\/+$/, '');
    if (!rawUrl.toLowerCase().endsWith('/v1')) {
      rawUrl += '/v1';
    }
    rawUrl = rawUrl.replace(/:\/\/localhost/i, '://127.0.0.1');

    const newConfig = {
      lmStudioUrl: rawUrl,
      modelName: settingModel ? settingModel.value.trim() : '',
      temperature: parseFloat(settingTemp ? settingTemp.value : '0.2'),
      maxSteps: parseInt(settingSteps ? settingSteps.value : '15'),
      systemPrompt: settingPrompt ? settingPrompt.value.trim() : '',
      swarmMode: swarmMode,
      autoApprove: autoApprove,
      lpmMode: (document.getElementById('setting-lpm') || {}).checked,
      lpmOmMode: (document.getElementById('setting-lpm-om') || {}).checked,
      lpmBatchSize: parseInt((document.getElementById('setting-lpm-batch') || {}).value) || 1,
      apiFallbacks: {
        openai: (document.getElementById('setting-api-openai') || {}).value || '',
        anthropic: (document.getElementById('setting-api-anthropic') || {}).value || '',
        gemini: (document.getElementById('setting-api-gemini') || {}).value || '',
        groq: (document.getElementById('setting-api-groq') || {}).value || '',
        priority: ['openai', 'anthropic', 'gemini', 'groq']
      }
    };

    ws.send(JSON.stringify({
      type: 'update_settings',
      settings: newConfig
    }));
  };
}

// Manual mode switcher dropdown listener
const modeSelect = document.getElementById('ui-mode-select');
if (modeSelect) {
  modeSelect.onchange = () => {
    const selected = modeSelect.value;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'manually_change_mode',
        guide_name: selected
      }));
    }
  };
}

// Guide editor select change listener
const editorGuideSelect = document.getElementById('editor-guide-select');
if (editorGuideSelect) {
  editorGuideSelect.onchange = () => {
    const selected = editorGuideSelect.value;
    const nameInput = document.getElementById('editor-guide-name');
    const contentArea = document.getElementById('editor-guide-content');
    
    if (!selected) {
      if (nameInput) nameInput.value = '';
      if (contentArea) contentArea.value = '';
    } else {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'get_guide_content',
          name: selected
        }));
      }
    }
  };
}

// Save guide file listener
const saveGuideBtn = document.getElementById('btn-save-guide');
if (saveGuideBtn) {
  saveGuideBtn.onclick = () => {
    const nameInput = document.getElementById('editor-guide-name');
    const contentArea = document.getElementById('editor-guide-content');
    
    if (!nameInput || !contentArea) return;
    
    const nameVal = nameInput.value.trim();
    const contentVal = contentArea.value;
    
    if (!nameVal) {
      alert('Please specify a filename for the guide (e.g. build_guide.md)');
      return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'save_guide',
        name: nameVal,
        content: contentVal
      }));
      showToast('Guide saved successfully!', 'success');
    } else {
      showToast('WebSocket is not connected.', 'error');
    }
  };
}

// ----------------------------------------------------
// Discord Bot Management UI handlers
// ----------------------------------------------------
function updateDiscordUI(data) {
  const statusDot = document.getElementById('discord-bot-status-dot');
  const statusText = document.getElementById('discord-bot-status-text');
  const speedLimitInput = document.getElementById('discord-speed-limit');
  const adminsList = document.getElementById('discord-admins-list');
  const usersList = document.getElementById('discord-users-list');

  // Update online status
  if (data.online) {
    statusDot.className = 'status-dot online';
    statusDot.style.background = '#22c55e';
    statusDot.style.boxShadow = '0 0 8px #22c55e';
    statusText.textContent = 'Online';
    statusText.style.color = '#22c55e';
  } else {
    statusDot.className = 'status-dot offline';
    statusDot.style.background = '#ef4444';
    statusDot.style.boxShadow = '0 0 8px #ef4444';
    statusText.textContent = 'Offline';
    statusText.style.color = '#ef4444';
  }

  // Update speed limit
  if (data.connectionSpeedLimit !== undefined && speedLimitInput) {
    speedLimitInput.value = data.connectionSpeedLimit;
  }

  // Update Admins list
  if (data.admins && adminsList) {
    adminsList.innerHTML = '';
    if (data.admins.length === 0) {
      adminsList.innerHTML = '<span style="color: #94a3b8; font-size: 0.9em; padding: 10px 0; display: block;">No admins configured.</span>';
    } else {
      data.admins.forEach((adminId, index) => {
        const badge = document.createElement('div');
        badge.className = 'banned-badge';
        badge.innerHTML = `
          <span>${adminId}</span>
          <button class="btn-delete-discord-admin" data-index="${index}">&times;</button>
        `;
        adminsList.appendChild(badge);
      });
      // Attach delete handlers
      adminsList.querySelectorAll('.btn-delete-discord-admin').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.index);
          if (confirm(`Remove admin ID: ${data.admins[idx]}?`)) {
            ws.send(JSON.stringify({ type: 'delete_discord_admin', index: idx }));
          }
        };
      });
    }
  }

  // Update Authorized Users list
  if (data.authorizedUsers && usersList) {
    usersList.innerHTML = '';
    if (data.authorizedUsers.length === 0) {
      usersList.innerHTML = '<span style="color: #94a3b8; font-size: 0.9em; padding: 10px 0; display: block;">No authorized users.</span>';
    } else {
      data.authorizedUsers.forEach((userId, index) => {
        const badge = document.createElement('div');
        badge.className = 'banned-badge';
        badge.innerHTML = `
          <span>${userId}</span>
          <button class="btn-delete-discord-user" data-index="${index}">&times;</button>
        `;
        usersList.appendChild(badge);
      });
      // Attach delete handlers
      usersList.querySelectorAll('.btn-delete-discord-user').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.index);
          if (confirm(`Remove user ID: ${data.authorizedUsers[idx]}?`)) {
            ws.send(JSON.stringify({ type: 'delete_discord_user', index: idx }));
          }
        };
      });
    }
  }
}

// Event Listeners for Discord UI
const saveDiscordConfigBtn = document.getElementById('btn-save-discord-config');
if (saveDiscordConfigBtn) {
  saveDiscordConfigBtn.onclick = () => {
    const limit = parseFloat(document.getElementById('discord-speed-limit').value);
    if (isNaN(limit) || limit <= 0) {
      alert('Please enter a valid connection speed limit (positive number).');
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'update_discord_config',
        connectionSpeedLimit: limit
      }));
      showToast('Discord config saved!', 'success');
    }
  };
}

const addDiscordAdminBtn = document.getElementById('btn-add-discord-admin');
const newDiscordAdminInput = document.getElementById('new-discord-admin-input');
if (addDiscordAdminBtn && newDiscordAdminInput) {
  addDiscordAdminBtn.onclick = () => {
    const adminId = newDiscordAdminInput.value.trim();
    if (!adminId) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'add_discord_admin',
        adminId: adminId
      }));
      newDiscordAdminInput.value = '';
    }
  };
}

const addDiscordUserBtn = document.getElementById('btn-add-discord-user');
const newDiscordUserInput = document.getElementById('new-discord-user-input');
if (addDiscordUserBtn && newDiscordUserInput) {
  addDiscordUserBtn.onclick = () => {
    const userId = newDiscordUserInput.value.trim();
    if (!userId) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'add_discord_user',
        userId: userId
      }));
      newDiscordUserInput.value = '';
    }
  };
}

// Admin Panel Event Listeners
const btnSaveEnv = document.getElementById('btn-save-env');
if (btnSaveEnv) {
  btnSaveEnv.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const newEnv = {
      PORT: document.getElementById('admin-env-port').value.trim(),
      FOUNDER_KEY: document.getElementById('admin-env-founderkey').value.trim(),
      DISCORD_TOKEN: document.getElementById('admin-env-token').value.trim(),
      FOUNDER_DISCORD_ID: document.getElementById('admin-env-founderid').value.trim()
    };
    ws.send(JSON.stringify({
      type: 'save_admin_data',
      env: newEnv
    }));
    showToast('Çevre değişkenleri (.env) başarıyla kaydedildi!', 'success');
  };
}

const btnSaveSecurity = document.getElementById('btn-save-security');
if (btnSaveSecurity) {
  btnSaveSecurity.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const allowedFolders = document.getElementById('admin-security-folders').value.split(',').map(s => s.trim()).filter(Boolean);
    const bannedWords = document.getElementById('admin-security-words').value.split(',').map(s => s.trim()).filter(Boolean);
    const bannedWebsites = document.getElementById('admin-security-websites').value.split(',').map(s => s.trim()).filter(Boolean);
    
    ws.send(JSON.stringify({
      type: 'save_admin_data',
      securityRules: {
        bannedWords,
        bannedWebsites,
        allowedBaseFolders: allowedFolders
      }
    }));
    showToast('Güvenlik filtreleri başarıyla kaydedildi!', 'success');
  };
}

const btnSaveDiscordPerms = document.getElementById('btn-save-discord-perms');
if (btnSaveDiscordPerms) {
  btnSaveDiscordPerms.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const founderId = document.getElementById('admin-discord-founder').value.trim();
    const admins = document.getElementById('admin-discord-admins').value.split(',').map(s => s.trim()).filter(Boolean);
    const users = document.getElementById('admin-discord-users').value.split(',').map(s => s.trim()).filter(Boolean);
    const speedLimit = parseFloat(document.getElementById('admin-discord-speed').value) || 0.7;

    const newKurucu = { founder: founderId };
    const newConfigJson = [{
      admins,
      connectionSpeedLimit: speedLimit,
      maxLibraryGB: 10,
      autocleanDays: 30
    }];
    const newPermissions = [{
      authorizedUsers: users
    }];

    ws.send(JSON.stringify({
      type: 'save_admin_data',
      kurucu: newKurucu,
      configJson: newConfigJson,
      permissions: newPermissions
    }));
    showToast('Discord yetkileri başarıyla kaydedildi!', 'success');
  };
}

const btnClearAllMemories = document.getElementById('btn-clear-all-memories');
if (btnClearAllMemories) {
  btnClearAllMemories.onclick = () => {
    if (confirm('Tüm bellek geçmişini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) {
      ws.send(JSON.stringify({
        type: 'clear_memories'
      }));
    }
  };
}

// Start app (waits for initial setup if needed)
if (window.setupPromise) {
  window.setupPromise.then((status) => {
    if (status && status.isSetupCompleted) {
      initWebSocket();
    }
  });
} else {
  initWebSocket();
}


// --- MODE MENU & MENTION SYSTEM ---
window.agentActiveMode = 'manuel'; // default
window.agentActiveSubMode = 'cmd_tool'; // default

// 1. Accordion Menu Logic
const accordionHeaders = document.querySelectorAll('.accordion-header');
const subNavBtns = document.querySelectorAll('.sub-nav-btn');
const activeModeTag = document.getElementById('active-mode-tag');

function updateModeTag() {
  let modeText = window.agentActiveMode;
  if (window.agentActiveSubMode && window.agentActiveSubMode !== 'none') {
    modeText += ' > ' + window.agentActiveSubMode;
  }
  if (activeModeTag) {
    activeModeTag.textContent = 'Mode: ' + modeText;
  }
}

accordionHeaders.forEach(header => {
  header.addEventListener('click', (e) => {
    const item = header.parentElement;
    
    document.querySelectorAll('.accordion-item').forEach(i => {
      if (i !== item) i.classList.remove('open');
    });
    
    item.classList.toggle('open');
    
    const mode = header.getAttribute('data-mode');
    window.agentActiveMode = mode;
    window.agentActiveSubMode = 'none';
    
    const drPanel = document.getElementById('deep-research-panel');
    if (drPanel) drPanel.classList.add('hidden');
    
    const arPanel = document.getElementById('agent-runner-panel');
    if (arPanel) {
      if (mode === 'agent_runner') arPanel.classList.remove('hidden');
      else arPanel.classList.add('hidden');
    }
    
    accordionHeaders.forEach(h => h.classList.remove('active'));
    header.classList.add('active');
    subNavBtns.forEach(b => b.classList.remove('active'));
    
    updateModeTag();
  });
});

function handleSubNavClick(btn, e) {
  const mode = btn.getAttribute('data-mode');
  const subMode = btn.getAttribute('data-submode');
  
  window.agentActiveMode = mode;
  window.agentActiveSubMode = subMode;
  
  const drPanel = document.getElementById('deep-research-panel');
  if (drPanel) {
    if (subMode === 'deep_web') drPanel.classList.remove('hidden');
    else drPanel.classList.add('hidden');
  }

  const arPanel = document.getElementById('agent-runner-panel');
  if (arPanel) arPanel.classList.add('hidden');
  
  document.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  document.querySelectorAll('.accordion-header').forEach(h => h.classList.remove('active'));
  const parentHeader = btn.closest('.accordion-item').querySelector('.accordion-header');
  if (parentHeader) parentHeader.classList.add('active');
  
  updateModeTag();
  if (e) e.stopPropagation();
}

subNavBtns.forEach(btn => {
  btn.addEventListener('click', (e) => handleSubNavClick(btn, e));
});

setTimeout(() => {
  const firstToolBtn = document.querySelector('.sub-nav-btn[data-mode="manuel"][data-submode="cmd_tool"]');
  if (firstToolBtn) firstToolBtn.click();
}, 100);

// 2. Mention (@) System Logic
window.libraryFiles = []; 
const mentionPopup = document.getElementById('mention-popup');
let mentionSelectedIndex = 0;
let mentionActive = false;
let mentionQuery = '';
let mentionStartIndex = -1;

if (chatInput && mentionPopup) {
  chatInput.addEventListener('input', (e) => {
    // Lifted restriction: Mention system is now globally available in chat.
    const val = chatInput.value;
    const cursor = chatInput.selectionStart;
    const textBeforeCursor = val.substring(0, cursor);
    
    const lastAt = textBeforeCursor.lastIndexOf('@');
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
      mentionActive = true;
      mentionStartIndex = lastAt;
      mentionQuery = textBeforeCursor.substring(lastAt + 1).toLowerCase();
      
      const matches = window.libraryFiles.filter(f => f.toLowerCase().startsWith(mentionQuery)).slice(0, 5);
      
      if (matches.length > 0) {
        renderMentionPopup(matches);
        mentionPopup.classList.remove('hidden');
      } else {
        mentionPopup.classList.add('hidden');
      }
    } else {
      mentionActive = false;
      mentionPopup.classList.add('hidden');
    }
  });

  chatInput.addEventListener('keydown', (e) => {
    if (!mentionActive || mentionPopup.classList.contains('hidden')) return;
    
    const items = mentionPopup.querySelectorAll('.mention-item');
    if (items.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length;
      updateMentionSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length;
      updateMentionSelection(items);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      const selectedFile = items[mentionSelectedIndex].getAttribute('data-filename');
      insertMention(selectedFile);
    } else if (e.key === 'Escape') {
      mentionActive = false;
      mentionPopup.classList.add('hidden');
    }
  });
}

function renderMentionPopup(matches) {
  mentionPopup.innerHTML = '';
  mentionSelectedIndex = 0;
  
  matches.forEach((file, index) => {
    const div = document.createElement('div');
    div.className = `mention-item ${index === 0 ? 'selected' : ''}`;
    div.setAttribute('data-filename', file);
    div.innerHTML = `📄 ${file}`;
    
    div.onclick = () => insertMention(file);
    div.onmouseenter = () => {
      mentionSelectedIndex = index;
      updateMentionSelection(mentionPopup.querySelectorAll('.mention-item'));
    };
    
    mentionPopup.appendChild(div);
  });
}

function updateMentionSelection(items) {
  items.forEach((item, index) => {
    if (index === mentionSelectedIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

function insertMention(filename) {
  const val = chatInput.value;
  const before = val.substring(0, mentionStartIndex);
  const after = val.substring(chatInput.selectionStart);
  
  chatInput.value = before + '@' + filename + ' ' + after;
  chatInput.focus();
  const newCursorPos = mentionStartIndex + filename.length + 2;
  setTimeout(() => chatInput.setSelectionRange(newCursorPos, newCursorPos), 10);
  
  mentionPopup.classList.add('hidden');
  mentionActive = false;
}

window.updateLibraryData = function(categories, allFiles) {
  const libraryContent = document.getElementById('library-accordion-content');
  if (libraryContent && categories) {
    libraryContent.innerHTML = ''; 
    categories.forEach(cat => {
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '5px';
      
      const header = document.createElement('div');
      header.style.fontWeight = 'bold';
      header.style.padding = '0.2rem 0.5rem';
      header.style.color = '#ccc';
      header.style.fontSize = '0.8rem';
      header.innerText = cat;
      wrapper.appendChild(header);
      
      const btnNew = document.createElement('button');
      btnNew.className = 'sub-nav-btn';
      btnNew.setAttribute('data-mode', 'library');
      btnNew.setAttribute('data-submode', `new_${cat}`);
      btnNew.innerText = `New ${cat}`;
      btnNew.onclick = (e) => handleSubNavClick(btnNew, e);
      wrapper.appendChild(btnNew);
      
      const btnEdit = document.createElement('button');
      btnEdit.className = 'sub-nav-btn';
      btnEdit.setAttribute('data-mode', 'library');
      btnEdit.setAttribute('data-submode', `edit_${cat}`);
      btnEdit.innerText = `Edit any ${cat}`;
      btnEdit.onclick = (e) => handleSubNavClick(btnEdit, e);
      wrapper.appendChild(btnEdit);
      
      libraryContent.appendChild(wrapper);
    });
  }
  
  if (allFiles) {
    window.libraryFiles = allFiles;
  }
};

// Deep Research UI events
const drSliderElement = document.getElementById("dr-page-slider");
const drCountDisplayElement = document.getElementById("dr-page-count-display");
const btnCloseDrElement = document.getElementById("btn-close-dr");

if (drSliderElement && drCountDisplayElement) {
  drSliderElement.addEventListener("input", (e) => {
    drCountDisplayElement.textContent = e.target.value;
  });
}

if (btnCloseDrElement) {
  btnCloseDrElement.addEventListener("click", () => {
    const drPanel = document.getElementById("deep-research-panel");
    if (drPanel) drPanel.classList.add("hidden");
  });
}

// ----------------------------------------------------
// Voice Command (STT) and TTS Handlers
// ----------------------------------------------------
window.ttsEnabled = false;
const btnToggleTts = document.getElementById('btn-toggle-tts');
if (btnToggleTts) {
  btnToggleTts.onclick = () => {
    window.ttsEnabled = !window.ttsEnabled;
    btnToggleTts.style.opacity = window.ttsEnabled ? '1' : '0.5';
    if (!window.ttsEnabled && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };
  // Default to visually dim if disabled
  btnToggleTts.style.opacity = '0.5';
}

const btnVoiceCommand = document.getElementById('btn-voice-command');
if (btnVoiceCommand) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = false;
    
    let isRecording = false;

    const startRecording = () => {
      isRecording = true;
      try { recognition.start(); } catch(e){}
      btnVoiceCommand.style.color = 'red';
    };

    const stopRecording = () => {
      if(isRecording) {
        isRecording = false;
        recognition.stop();
        btnVoiceCommand.style.color = '';
      }
    };

    btnVoiceCommand.onmousedown = startRecording;
    btnVoiceCommand.onmouseup = stopRecording;
    btnVoiceCommand.ontouchstart = (e) => { e.preventDefault(); startRecording(); };
    btnVoiceCommand.ontouchend = (e) => { e.preventDefault(); stopRecording(); };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const chatInput = document.getElementById('chat-input');
      if (chatInput) {
        chatInput.value += (chatInput.value ? ' ' : '') + transcript;
      }
    };
  } else {
    btnVoiceCommand.style.display = 'none'; // Hide if not supported
    console.warn("Speech Recognition API is not supported in this browser.");
  }
}

// Bind Agent Runner Toggles to update_settings instantly
function bindAgentRunnerToggles() {
  const runnerIds = [
    'runner-setting-lpm', 
    'runner-setting-lpm-om', 
    'runner-setting-lpm-batch', 
    'runner-setting-forceplan', 
    'runner-setting-simba'
  ];
  runnerIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const newSettings = {};
        const rLpm = document.getElementById('runner-setting-lpm');
        if (rLpm) newSettings.lpmMode = rLpm.checked;
        const rLpmOm = document.getElementById('runner-setting-lpm-om');
        if (rLpmOm) newSettings.lpmOmMode = rLpmOm.checked;
        const rLpmBatch = document.getElementById('runner-setting-lpm-batch');
        if (rLpmBatch) newSettings.lpmBatchSize = parseInt(rLpmBatch.value) || 1;
        const rForcePlan = document.getElementById('runner-setting-forceplan');
        if (rForcePlan) newSettings.forceTaskPlan = rForcePlan.checked;
        const rSimba = document.getElementById('runner-setting-simba');
        if (rSimba) newSettings.simbaEnabled = rSimba.checked;
        
        ws.send(JSON.stringify({
          type: 'update_settings',
          settings: newSettings
        }));
      });
    }
  });

  const libIds = ['library-setting-sgm', 'library-setting-esyabanci'];
  libIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const newSettings = {};
        const sgmMode = document.getElementById('library-setting-sgm');
        if (sgmMode) newSettings.sgmMode = sgmMode.checked;
        const esYabanci = document.getElementById('library-setting-esyabanci');
        if (esYabanci) newSettings.esYabanciMode = esYabanci.checked;
        
        ws.send(JSON.stringify({
          type: 'update_settings',
          settings: newSettings
        }));
      });
    }
  });
}
bindAgentRunnerToggles();

// -----------------------------------------------------------------------
// HPM (High Parameter Mode) Sidebar Toggle
// -----------------------------------------------------------------------
function _applyHpmSidebarState(active) {
  const card = document.getElementById('hpm-toggle-card');
  const sublabel = document.getElementById('hpm-sublabel');
  if (card) {
    if (active) {
      card.classList.add('hpm-active');
    } else {
      card.classList.remove('hpm-active');
    }
  }
  if (sublabel) {
    sublabel.textContent = active ? '\u26a1 AKTİF \u2014 LPM/OM bypass' : '30B+ modeller için';
  }
}
// Expose globally so settings.js can call it
window._applyHpmSidebarState = _applyHpmSidebarState;

document.addEventListener('DOMContentLoaded', () => {
  const hpmChk = document.getElementById('hpm-toggle-checkbox');
  if (hpmChk) {
    hpmChk.addEventListener('change', () => {
      const isActive = hpmChk.checked;
      _applyHpmSidebarState(isActive);

      // Sync Settings panel HPM checkbox
      const settingHpmEl = document.getElementById('setting-hpm');
      if (settingHpmEl) settingHpmEl.checked = isActive;

      // Send to backend
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'update_settings',
          settings: { hpmMode: isActive }
        }));
        if (typeof showToast === 'function') {
          showToast(
            isActive
              ? '\u26a1 High Parameter Mode AKTİF \u2014 LPM/OM bypass etkin'
              : 'High Parameter Mode kapatıldı \u2014 standart algoritma aktif',
            isActive ? 'warning' : 'info'
          );
        }
      }
    });
  }
});

// --- Frontend Telemetry & Logging ---
function sendClientLog(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'client_log', logData: data }));
  }
}

document.addEventListener('click', (e) => {
  let target = e.target;
  let targetInfo = target.tagName;
  if (target.id) targetInfo += '#' + target.id;
  if (target.className && typeof target.className === 'string') targetInfo += '.' + target.className.split(' ').join('.');
  sendClientLog(`User clicked element: ${targetInfo}`);
});

window.addEventListener('error', (e) => {
  sendClientLog(`Frontend Error: ${e.message} at ${e.filename}:${e.lineno}`);
});


window.addEventListener('unhandledrejection', (e) => {
  sendClientLog(`Frontend Unhandled Rejection: ${e.reason}`);
});

// ═══════════════════════════════════════════════════════════════════
//  TASK LIVE PANEL (TLP) — Real-time agent step tracker
// ═══════════════════════════════════════════════════════════════════

const TOOL_EMOJI = {
  execute_command:    '⚡',
  web_search:        '🔍',
  view_website:      '🌐',
  deep_web_search:   '🌐',
  read_file:         '📄',
  write_file:        '✍️',
  list_directory:    '📁',
  take_screenshot:   '📸',
  download_image:    '🖼️',
  library_mode:      '📚',
  task_plan:         '📋',
  task_complete:     '✅',
  send_discord_message: '💬',
  open_application:  '🚀',
  read_pdf:          '📕',
  filter_output:     '🔎',
  line_checker:      '🔎',
  url_image_reader:  '🖼️',
  extract_chart_data:'📊',
  select_guide:      '📖',
  generate_workspace_rules: '⚙️'
};

function clearTaskLivePanel() {
  const panel = document.getElementById('task-live-panel');
  const steps = document.getElementById('tlp-steps');
  const counter = document.getElementById('tlp-counter');
  if (steps) steps.innerHTML = '';
  if (counter) counter.textContent = '0 adım';
  if (panel) panel.classList.add('hidden');
  window._tlpStepCount = 0;
}

function handleTaskStep(step) {
  const panel = document.getElementById('task-live-panel');
  const stepsContainer = document.getElementById('tlp-steps');
  const counter = document.getElementById('tlp-counter');
  if (!panel || !stepsContainer) return;

  // Show panel
  panel.classList.remove('hidden');

  // Find existing row or create new one
  let row = document.getElementById('tlp-step-' + step.id);
  if (!row) {
    row = document.createElement('div');
    row.id = 'tlp-step-' + step.id;
    row.className = 'tlp-step running';

    const icon   = document.createElement('div'); icon.className = 'tlp-step-icon';
    const num    = document.createElement('span'); num.className = 'tlp-step-num'; num.textContent = step.index;
    const tool   = document.createElement('span'); tool.className = 'tlp-step-tool';
    const label  = document.createElement('span'); label.className = 'tlp-step-label';
    const dur    = document.createElement('span'); dur.className = 'tlp-step-dur'; dur.textContent = '…';

    const emoji = TOOL_EMOJI[step.tool] || '🔧';
    tool.textContent = emoji + ' ' + (step.tool || '');
    label.textContent = step.label || step.tool || '';
    if (step.thought) row.setAttribute('data-thought', step.thought);

    row.appendChild(icon);
    row.appendChild(num);
    row.appendChild(tool);
    row.appendChild(label);
    row.appendChild(dur);
    stepsContainer.appendChild(row);

    // Update counter
    window._tlpStepCount = (window._tlpStepCount || 0) + 1;
    if (counter) counter.textContent = window._tlpStepCount + ' adım';

    // Auto-scroll to bottom
    const body = document.getElementById('tlp-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  // Update status class
  row.className = 'tlp-step ' + (step.status || 'running');

  // Update duration
  const dur = row.querySelector('.tlp-step-dur');
  if (dur) {
    if (step.durationMs != null) {
      dur.textContent = step.durationMs < 1000
        ? step.durationMs + 'ms'
        : (step.durationMs / 1000).toFixed(1) + 's';
    } else {
      dur.textContent = '…';
    }
  }
}

// Collapse/expand toggle
document.addEventListener('DOMContentLoaded', () => {
  const colBtn = document.getElementById('tlp-collapse-btn');
  const body   = document.getElementById('tlp-body');
  if (colBtn && body) {
    colBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      body.classList.toggle('collapsed');
      colBtn.classList.toggle('collapsed');
    });
  }
});

// Hook into updateUIState to show/hide panel based on agent status
const _origUpdateUIState = window.updateUIState;
if (typeof _origUpdateUIState === 'function') {
  // patched after definition — see below
}

// Patch updateUIState to also control panel visibility
// We do this by wrapping it after the original definition runs.
window._tlpPatchApplied = false;
function _patchTLPOnUIState() {
  if (window._tlpPatchApplied) return;
  if (typeof window.updateUIState !== 'function') return;
  window._tlpPatchApplied = true;
  const orig = window.updateUIState;
  window.updateUIState = function(state) {
    orig.call(this, state);
    // If agent is idle/completed/failed and panel has steps, keep it visible (show history)
    // If agent just became active, panel will show via handleTaskStep
  };
}
// Try to patch once DOM is ready
document.addEventListener('DOMContentLoaded', _patchTLPOnUIState);
setTimeout(_patchTLPOnUIState, 500);
// ═══════════════════════════════════════════════════════════════════
