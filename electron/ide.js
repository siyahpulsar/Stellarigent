let currentFilePath = null;
let currentFolderPath = null;
let folderHistory = []; // Back-navigation history stack
let ws = null;
let authFailed = false;

// --- Toast Notification System (replaces alert()) ---
function showToast(message, type = 'info') {
  const existing = document.querySelector('.ide-toast');
  if (existing) existing.remove();
  const colors = { info: '#007acc', success: '#28a745', warning: '#ffc107', error: '#dc3545' };
  const toast = document.createElement('div');
  toast.className = 'ide-toast';
  toast.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:9999;
    background:#2d2d30;border-left:3px solid ${colors[type] || colors.info};
    color:#ccc;padding:10px 16px;border-radius:4px;font-size:12px;
    max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,0.5);opacity:1;
    transition:opacity 0.3s ease;font-family:monospace;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Initialize WebSocket to local server
function initWebSocket() {
  if (authFailed) return; // Only block on explicit auth rejection (not normal close)

  ws = new WebSocket('ws://127.0.0.1:3000');

  ws.onopen = () => {
    authFailed = false;
    document.getElementById('agent-status').textContent = 'Connecting...';
    document.getElementById('agent-status').style.color = '#ffc107';

    const savedKey = localStorage.getItem('founderKey') || '';
    const authKeyEl = document.getElementById('setting-auth-key');
    if (authKeyEl) authKeyEl.value = savedKey;
    ws.send(JSON.stringify({ type: 'auth', key: savedKey }));
  };

  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; } // Safe JSON parse

    if (data.type === 'auth_success') {
      document.getElementById('agent-status').textContent = 'Online';
      document.getElementById('agent-status').style.color = '#28a745';
      appendMessage('System', '✅ Authentication successful.', 'sys');
    } else if (data.type === 'state_patch' || data.type === 'state') {
      const state = data.patch || data;
      if (state.newMessages) {
        state.newMessages.forEach(msg => {
          if (msg.role === 'assistant') appendMessage('Agent', msg.content, 'agent');
        });
      }
      if (state.pendingAction && !state.pendingActionResolved) {
        showApproval(state.pendingAction);
      } else {
        hideApproval();
      }
    } else if (data.type === 'settings') {
      const s = data.settings || {};
      if (s.bannedCommands) document.getElementById('setting-blacklist').value = s.bannedCommands.join(', ');
      if (s.systemPrompt)   document.getElementById('setting-prompt-extra').value = s.systemPrompt;
      if (s.modelName)      document.getElementById('setting-model').value = s.modelName;
    }
  };

  ws.onclose = (event) => {
    document.getElementById('agent-status').textContent = 'Offline';
    document.getElementById('agent-status').style.color = '#dc3545';

    // FIX: Only code 1008 (Policy Violation) = auth rejected. Code 1000 = normal close (server restart) — should reconnect!
    if (event.code === 1008) {
      authFailed = true;
      appendMessage('System', '❌ Auth rejected. Open Settings ▲ (bottom bar), enter your FOUNDER_KEY, then click Save Settings to reconnect.', 'sys');
    } else {
      // Normal close or network drop — always try to reconnect
      setTimeout(initWebSocket, 3000);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    const statusEl = document.getElementById('agent-status');
    if (statusEl) {
      statusEl.textContent = 'Error';
      statusEl.style.color = '#dc3545';
    }
  };
}

initWebSocket();

// --- appendMessage: type = 'sys' | 'agent' | 'user' ---
function appendMessage(sender, text, type) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.style.marginBottom = '8px';
  div.style.padding = '6px 8px';
  div.style.borderRadius = '3px';

  const colorMap  = { sys: '#ffc107', agent: '#9cdcfe', user: '#888888' };
  const borderMap = { sys: '#ffc107', agent: '#007acc', user: '#555555' };
  const senderColor = colorMap[type]  || '#888';
  const borderColor = borderMap[type] || '#555';

  div.style.borderLeft = `3px solid ${borderColor}`;
  const safe = String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  div.innerHTML = `<strong style="color:${senderColor}">${sender}:</strong> <span>${safe}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Chat Form
document.getElementById('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    appendMessage('You', text, 'user');
    ws.send(JSON.stringify({ type: 'user_message', content: text }));
    input.value = '';
  } else {
    appendMessage('System', '⚠️ Not connected. Check FOUNDER_KEY in Settings.', 'sys');
  }
};

// Approval logic
let currentAction = null;
function showApproval(action) {
  currentAction = action;
  document.getElementById('pending-action-details').textContent =
    `Action: ${action.action}\nTarget: ${action.command || action.path || action.url || ''}`;
  document.getElementById('approval-box').classList.remove('hidden');
}
function hideApproval() {
  document.getElementById('approval-box').classList.add('hidden');
  currentAction = null;
}

document.getElementById('btn-approve-action').onclick = () => {
  if (ws && currentAction) {
    ws.send(JSON.stringify({ type: 'approve_action', action: currentAction }));
    hideApproval();
  }
};
document.getElementById('btn-reject-action').onclick = () => {
  if (ws) {
    ws.send(JSON.stringify({ type: 'reject_action', feedback: 'Rejected by IDE user.' }));
    hideApproval();
  }
};

// --- Back Navigation Helpers ---
function updateBackBtn() {
  const backBtn = document.getElementById('btn-back-folder');
  if (backBtn) {
    backBtn.disabled = folderHistory.length === 0;
    backBtn.style.opacity = folderHistory.length === 0 ? '0.4' : '1';
  }
}

// Open Folder button — now uses IPC dialog directly
document.getElementById('btn-open-folder').onclick = () => {
  if (window.electronAPI && window.electronAPI.openFolderDialog) {
    window.electronAPI.openFolderDialog();
  } else {
    showToast('Üst menüden File > Open Folder kullanın', 'warning');
  }
};

// Back button handler
const backBtn = document.getElementById('btn-back-folder');
if (backBtn) {
  backBtn.onclick = async () => {
    if (folderHistory.length > 0) {
      const prev = folderHistory.pop();
      currentFolderPath = prev;
      updateBackBtn();
      await renderFileTree(prev, false); // false = don't push to history again
    }
  };
}

// Receive folder from main process (menu or IPC)
if (window.electronAPI) {
  window.electronAPI.onOpenedFolder(async (folderPath) => {
    folderHistory = []; // Reset history for new root folder
    currentFolderPath = folderPath;
    updateBackBtn();
    await renderFileTree(folderPath, false);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'update_cwd', cwd: folderPath }));
      appendMessage('System', `📂 Workspace set to: ${folderPath}`, 'sys');
    } else {
      appendMessage('System', `⚠️ Folder loaded locally but agent is offline — reconnect to sync workspace.`, 'sys');
    }
  });
}

// Render file tree with optional history tracking
async function renderFileTree(folderPath, addToHistory = true) {
  if (!window.electronAPI) return;

  // Push current folder to history before navigating deeper
  if (addToHistory && currentFolderPath && currentFolderPath !== folderPath) {
    folderHistory.push(currentFolderPath);
    updateBackBtn();
  }

  currentFolderPath = folderPath;
  const treeContainer = document.getElementById('file-tree');
  treeContainer.innerHTML = '';

  // Update workspace label (breadcrumb)
  const wsLabel = document.getElementById('workspace-label');
  if (wsLabel) {
    const parts = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
    wsLabel.textContent = parts.length > 3
      ? '.../' + parts.slice(-3).join('/')
      : folderPath;
    wsLabel.title = folderPath; // Full path on hover
    wsLabel.style.display = 'block';
  }

  const files = await window.electronAPI.readDir(folderPath);
  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#666;padding:8px;font-size:12px;';
    empty.textContent = '(empty folder)';
    treeContainer.appendChild(empty);
    return;
  }

  files.forEach(f => {
    const div = document.createElement('div');
    div.className = 'file-item ' + (f.isDirectory ? 'dir' : 'file');
    div.textContent = (f.isDirectory ? '📁 ' : '📄 ') + f.name;
    div.onclick = () => {
      if (!f.isDirectory) {
        document.querySelectorAll('.file-item').forEach(i => i.style.background = '');
        div.style.background = '#094771';
        openFile(f.path);
      } else {
        renderFileTree(f.path); // addToHistory = true by default
      }
    };
    // Right-click context menu
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, f);
    });
    treeContainer.appendChild(div);
  });
}

async function openFile(filePath) {
  if (!window.electronAPI) return;
  const content = await window.electronAPI.readFile(filePath);
  if (content !== null) {
    currentFilePath = filePath;
    document.getElementById('editor-title').textContent = filePath.split(/[\\\/]/).pop();
    
    if (window.monacoEditor) {
      window.monacoEditor.setValue(content);
      const ext = filePath.split('.').pop().toLowerCase();
      const langMap = { js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown', html: 'html', css: 'css', py: 'python' };
      monaco.editor.setModelLanguage(window.monacoEditor.getModel(), langMap[ext] || 'plaintext');
    } else {
      const editor = document.getElementById('file-editor');
      editor.value = content;
      editor.disabled = false;
    }
  }
}

// Save file — uses toast instead of alert
document.getElementById('btn-save-file').onclick = async () => {
  if (!currentFilePath || !window.electronAPI) return;
  const content = window.monacoEditor ? window.monacoEditor.getValue() : document.getElementById('file-editor').value;
  const success = await window.electronAPI.writeFile(currentFilePath, content);
  if (success) {
    const title = document.getElementById('editor-title');
    const orig = title.textContent;
    title.textContent = orig + ' ✓';
    showToast('✅ File saved successfully!', 'success');
    setTimeout(() => title.textContent = orig, 1500);
  } else {
    showToast('❌ Failed to save file.', 'error');
  }
};

// Toggle Settings Panel
document.getElementById('btn-toggle-settings').onclick = () => {
  const content = document.getElementById('settings-content');
  const btn = document.getElementById('btn-toggle-settings');
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    btn.textContent = '▼';
  } else {
    content.classList.add('hidden');
    btn.textContent = '▲';
  }
};

// Save Settings & reconnect — uses toast instead of alert
document.getElementById('btn-save-settings').onclick = () => {
  const blacklistRaw = document.getElementById('setting-blacklist').value;
  const promptExtra  = document.getElementById('setting-prompt-extra').value;
  const modelName    = document.getElementById('setting-model').value;
  const authKey      = document.getElementById('setting-auth-key').value.trim();

  localStorage.setItem('founderKey', authKey);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'update_settings',
      settings: {
        bannedCommands: blacklistRaw.split(',').map(s => s.trim()).filter(Boolean),
        systemPrompt: promptExtra,
        modelName
      }
    }));
    showToast('✅ Settings saved.', 'success');
  } else {
    // Reset flag and reconnect with the new key
    authFailed = false;
    if (ws) { try { ws.close(); } catch(e) {} }
    initWebSocket();
    showToast('🔄 Reconnecting with new key...', 'info');
  }
};

// =============================================================================
// AUTO-SAVE (2s debounce after typing) + Unsaved dot indicator
// =============================================================================
let autoSaveTimer = null;

function handleEditorInput() {
  const title = document.getElementById('editor-title');
  if (title && !title.textContent.endsWith(' ●')) {
    title.textContent += ' ●'; // Unsaved change indicator
  }
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (currentFilePath && window.electronAPI) {
      const val = window.monacoEditor ? window.monacoEditor.getValue() : document.getElementById('file-editor').value;
      const ok = await window.electronAPI.writeFile(currentFilePath, val);
      if (ok && title) {
        title.textContent = title.textContent.replace(' ●', '');
        showToast('Auto-saved', 'info');
      }
    }
  }, 2000);
}

function bindMonacoEvents() {
  if (window.monacoEditor) {
    window.monacoEditor.onDidChangeModelContent(handleEditorInput);
    window.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const saveBtn = document.getElementById('btn-save-file');
      if (saveBtn) saveBtn.click();
    });
    
    // Transfer from textarea if opened before Monaco loaded
    const ed = document.getElementById('file-editor');
    if (ed && ed.value && currentFilePath) {
      window.monacoEditor.setValue(ed.value);
      const ext = currentFilePath.split('.').pop().toLowerCase();
      const langMap = { js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown', html: 'html', css: 'css', py: 'python' };
      monaco.editor.setModelLanguage(window.monacoEditor.getModel(), langMap[ext] || 'plaintext');
    }
  }
}

if (window.monacoEditor) {
  bindMonacoEvents();
} else {
  window.addEventListener('monacoReady', bindMonacoEvents);
}

const _editorEl = document.getElementById('file-editor');
if (_editorEl) {
  _editorEl.addEventListener('input', handleEditorInput);
}

// =============================================================================
// CTRL+P FILE SEARCH
// =============================================================================
let _allProjectFiles = [];

async function _buildFileIndex() {
  if (!currentFolderPath || !window.electronAPI) return;
  try {
    _allProjectFiles = await window.electronAPI.readDirRecursive(currentFolderPath);
  } catch(e) { _allProjectFiles = []; }
}

function _openFileSearch() {
  const overlay = document.getElementById('file-search-overlay');
  if (!overlay) return;
  _buildFileIndex();
  overlay.classList.remove('hidden');
  const inp = document.getElementById('file-search-input');
  if (inp) { inp.value = ''; inp.focus(); }
  _renderSearchResults('');
}

function _closeFileSearch() {
  const overlay = document.getElementById('file-search-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function _renderSearchResults(query) {
  const el = document.getElementById('file-search-results');
  if (!el) return;
  const q = query.toLowerCase().trim();
  const hits = q
    ? _allProjectFiles.filter(f =>
        f.name.toLowerCase().includes(q) ||
        f.path.replace(/\\/g, '/').toLowerCase().includes(q)
      ).slice(0, 20)
    : _allProjectFiles.slice(0, 20);

  el.innerHTML = '';
  if (hits.length === 0) {
    el.innerHTML = '<div style="color:#555;padding:14px;text-align:center;font-size:12px;">No files found</div>';
    return;
  }
  hits.forEach(f => {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    const rel = f.path.replace(currentFolderPath, '').replace(/\\/g, '/');
    div.innerHTML = `<span class="search-result-name">📄 ${f.name}</span><span class="search-result-path">${rel}</span>`;
    div.onclick = () => { openFile(f.path); _closeFileSearch(); };
    el.appendChild(div);
  });
}

// Tab key → 2 spaces (IDE standard), Ctrl+S → manual save
if (_editorEl) {
  _editorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = _editorEl.selectionStart;
      const end   = _editorEl.selectionEnd;
      _editorEl.value = _editorEl.value.substring(0, start) + '  ' + _editorEl.value.substring(end);
      _editorEl.setSelectionRange(start + 2, start + 2);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-file');
      if (saveBtn) saveBtn.click();
    }
  });
}

// =============================================================================
// DYNAMIC MODEL LIST (fetched from LM Studio API)
// =============================================================================
async function fetchLmStudioModels() {
  const select = document.getElementById('setting-model');
  if (!select) return;
  try {
    const res = await fetch('http://localhost:1234/api/v0/models', {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return;
    const json = await res.json();
    const models = (json.data || json);
    if (!Array.isArray(models) || models.length === 0) return;

    const currentVal = select.value;
    select.innerHTML = '';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      if (m.id === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
    showToast(`✅ ${models.length} model LM Studio'dan yüklendi`, 'info');
  } catch(e) {
    // LM Studio not running or different port — keep static options silently
  }
}

// Try fetching models after settings panel is visible
const _modelSelect = document.getElementById('setting-model');
if (_modelSelect) {
  _modelSelect.addEventListener('focus', fetchLmStudioModels, { once: true });
}

const _searchInput = document.getElementById('file-search-input');
if (_searchInput) {
  _searchInput.addEventListener('input', (e) => _renderSearchResults(e.target.value));
  _searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') _closeFileSearch(); });
}

const _searchOverlay = document.getElementById('file-search-overlay');
if (_searchOverlay) {
  _searchOverlay.addEventListener('click', (e) => {
    if (e.target === _searchOverlay) _closeFileSearch();
  });
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    _openFileSearch();
  }
});

// =============================================================================
// RIGHT-CLICK CONTEXT MENU
// =============================================================================
function showContextMenu(x, y, fileItem) {
  _closeContextMenu();
  const menu = document.createElement('div');
  menu.id = 'context-menu';
  // Keep menu within viewport
  menu.style.left = `${Math.min(x, window.innerWidth  - 200)}px`;
  menu.style.top  = `${Math.min(y, window.innerHeight - 220)}px`;

  const items = fileItem.isDirectory
    ? [
        { icon: '📄', label: 'New File',   action: 'new-file'   },
        { icon: '📁', label: 'New Folder', action: 'new-folder' },
        { divider: true },
        { icon: '✏️', label: 'Rename',     action: 'rename'     },
        { icon: '🗑️', label: 'Delete',     action: 'delete', danger: true }
      ]
    : [
        { icon: '✏️', label: 'Rename',     action: 'rename'     },
        { icon: '🗑️', label: 'Delete',     action: 'delete', danger: true }
      ];

  items.forEach(item => {
    if (item.divider) {
      const sep = document.createElement('div');
      sep.className = 'ctx-divider';
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = `ctx-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = `${item.icon} ${item.label}`;
    el.onclick = () => _handleContextAction(item.action, fileItem);
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  // Close on next click anywhere
  setTimeout(() => document.addEventListener('click', _closeContextMenu, { once: true }), 0);
}

function _closeContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu) menu.remove();
}

async function _handleContextAction(action, fileItem) {
  _closeContextMenu();
  // Determine separator style from path
  const sep = fileItem.path.includes('\\') ? '\\' : '/';
  const parentDir = fileItem.isDirectory
    ? fileItem.path
    : fileItem.path.substring(0, fileItem.path.lastIndexOf(sep));

  switch (action) {
    case 'new-file': {
      const name = prompt('New file name:');
      if (!name || !name.trim()) return;
      const newPath = parentDir + sep + name.trim();
      const ok = await window.electronAPI.writeFile(newPath, '');
      if (ok) {
        await renderFileTree(currentFolderPath, false);
        openFile(newPath);
        showToast(`✅ Created: ${name.trim()}`, 'success');
      } else showToast('❌ Failed to create file', 'error');
      break;
    }
    case 'new-folder': {
      const name = prompt('New folder name:');
      if (!name || !name.trim()) return;
      const ok = await window.electronAPI.createDir(parentDir + sep + name.trim());
      if (ok) {
        await renderFileTree(currentFolderPath, false);
        showToast(`✅ Folder created: ${name.trim()}`, 'success');
      } else showToast('❌ Failed to create folder', 'error');
      break;
    }
    case 'rename': {
      const newName = prompt('New name:', fileItem.name);
      if (!newName || newName.trim() === fileItem.name || !newName.trim()) return;
      const newPath = parentDir + sep + newName.trim();
      const ok = await window.electronAPI.renameFile(fileItem.path, newPath);
      if (ok) {
        if (currentFilePath === fileItem.path) {
          currentFilePath = newPath;
          document.getElementById('editor-title').textContent = newName.trim();
        }
        await renderFileTree(currentFolderPath, false);
        showToast(`✅ Renamed to: ${newName.trim()}`, 'success');
      } else showToast('❌ Rename failed', 'error');
      break;
    }
    case 'delete': {
      if (!confirm(`Delete "${fileItem.name}"?\nThis cannot be undone.`)) return;
      const ok = await window.electronAPI.deleteFile(fileItem.path);
      if (ok) {
        // Clear editor if the deleted file was open
        if (currentFilePath === fileItem.path) {
          currentFilePath = null;
          const ed = document.getElementById('file-editor');
          if (ed) { ed.value = ''; ed.disabled = true; }
          document.getElementById('editor-title').textContent = 'Editor';
        }
        await renderFileTree(currentFolderPath, false);
        showToast(`🗑️ Deleted: ${fileItem.name}`, 'success');
      } else showToast('❌ Delete failed', 'error');
      break;
    }
  }
}
