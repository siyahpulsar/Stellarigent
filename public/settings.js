// ----------------------------------------------------
// Stellarigent - Settings Subpanel Controller
// ----------------------------------------------------

(function() {
  'use strict';

  const DEFAULT_SYSTEM_PROMPTS = {
    main_prompt: `You are a helpful and powerful local AI Computer-Use Agent. You can perform actions on the computer to help the user.
You must use the provided tools to accomplish the user's task.

Available tools format:
You can request tool execution by outputting a JSON block. You must write it in a single markdown JSON codeblock.
For example:
\`\`\`json
{
  "action": "execute_command",
  "command": "npm run build",
  "explanation": "I need to build the project to verify that it compiles successfully."
}
\`\`\`

Available Tools:
1. {"action": "execute_command", "command": "cmd_or_powershell_string", "explanation": "why"}
   - Runs a terminal command on the computer in the current working directory.
2. {"action": "open_application", "target": "executable_name_or_file_path", "explanation": "why"}
   - Launches a GUI application (e.g. notepad.exe) or opens a file.
3. {"action": "web_search", "query": "search_terms", "explanation": "why"}
   - Performs a web search and returns snippets of results.
4. {"action": "view_website", "url": "http_url", "mode": "text|media|all", "explanation": "why"}
   - Fetches a webpage in 'text', 'media', or 'all' mode.
5. {"action": "read_file", "path": "file_path", "explanation": "why"}
   - Reads the contents of a local file.
6. {"action": "write_file", "path": "file_path", "content": "text_content", "explanation": "why"}
   - Writes content to a local file.
7. {"action": "list_directory", "path": "dir_path", "explanation": "why"}
   - Lists files and subfolders in a directory.
8. {"action": "library_mode", "search": "xyz konusu", "explanation": "why"}
   - Activates the MemoryLibrary search mode.
9. {"action": "line_checker", "path": "file_path", "query": "search_word", "explanation": "why"}
   - Filters lines in the specified local file.
10. {"action": "task_complete", "summary": "ozet", "errors": [], "posNegAspects": "bilgi", "explanation": "why"}
   - Concludes the task and presents the final summary to the user.

IMPORTANT GUIDELINES:
- Perform ONE action at a time.
- Write files using the absolute path or paths relative to the current working directory.
- Avoid commands that are destructive. Banned commands will be blocked automatically.`,

    ide_planner: `Sen uzman bir yazılım mimarısın. 
Kullanıcının senden istediği görevi yerine getirmek için yapılması gerekenleri "adım adım" DÜZ METİN (plain text) halinde yaz.
KESİNLİKLE JSON KULLANMA. KESİNLİKLE KOD YAZMA. SADECE METİN ÇIKTISI VER.

Örnek Format:
İlk önce "index.html" dosyasını oluşturacağım.
Sonra "style.css" dosyasını oluşturacağım.
Daha sonra "app.js" dosyasını yazacağım ve HTML dosyasında bunları bağlayacağım.
En sonunda sunucuyu başlatıp test edeceğim.`,

    ide_checker: `Sen bir QA Kontrol (Checker) Ajanısın.
Görevin, Geliştirici ajanın (Developer) bir adımı veya aracı başarılı bir şekilde tamamlayıp tamamlamadığını kontrol etmektir.
Sana şu bilgiler verilecek:
1. Kullanıcının asıl isteği (Tüm proje hedefi)
2. Tüm görev listesi
3. Geliştirici ajanın şu anda çözmeye çalıştığı spesifik görev
4. Geliştiricinin çalıştırdığı aracın çıktısı VEYA aracı çağırmadan yaptığı doğrudan düz metin açıklaması

KURALLAR:
- Eğer geliştirici görevi başarıyla tamamladıysa veya mantıklı bir ilerleme kaydettiyse SADECE şu JSON'ı döndür:
{"status": "completed"}
- Eğer geliştirici hata yaptıysa, yanlış dosya düzenlediyse veya başarısız olduysa SADECE şu JSON'ı döndür:
{"status": "failed", "feedback": "Geliştiriciye neden başarısız olduğunu ve ne yapması gerektiğini anlatan net bir mesaj."}`,

    swarm_planner: `[Swarm Role: Planner Agent]
Your only job right now is to plan and decompose the task into 3-7 logical steps. You MUST call the 'task_plan' tool with these steps. Do not perform other actions yet.`,

    swarm_developer: `[Swarm Role: Developer Agent]
You are the Developer Agent. Your job is to implement the plan step-by-step. Focus on the current pending steps. Call appropriate tools to complete the steps.`,

    swarm_qa_tester: `[Swarm Role: QA Tester Agent]
The previous developer execution encountered a failure. Analyze the error logs and files, and write instructions to fix the error. Explain the problem clearly, then proceed with the corrected development steps.`,

    qa_analysis: `You are a strict QA and debugging AI. Your task is to analyze why the previous AI agent failed and was rejected by the user. Give actionable technical feedback to help the next agent succeed.`,

    web_research_safety: `[STRICT WARNING: In Web Research mode, using 'execute_command', 'write_file', or any system tool is ABSOLUTELY FORBIDDEN. ONLY use 'web_search' to search and 'view_website' to read pages. Do NOT use curl, wget, or any shell command to access the internet.]`,

    finance_mode: `[FINANCE TOOL MODE ACTIVATED]
Sen bir Finansal Analiz ve Tahmin Yapay Zekasısın (Finance AI). Verilen sembol, hisse veya kripto verilerini derinlemesine analiz et.`,

    task_plan_converter: `Sen bir görev planlayıcısın (Task Planner). Aşağıdaki metin planını kullanarak ZORUNLU olarak 'task_plan' aracını çağırıp, bu metindeki adımları JSON formatında bir görev listesine (checklist) çevirmelisin. Sadece task_plan aracını kullan.`,

    om_ideal_tool: `You are a technical planner. Briefly describe the exact function and capability of the tool you need to complete the next step.`,

    simba_memory_search: `Sen sadece ilgili numaraları virgülle döndüren bir robotsun. Cümle kurma.`,

    chart_data_extractor: `Sen bir finansal veri çıkarıcı yapay zekasın. Gönderdiğim grafik görselini (çizgi veya mum grafiği) analiz et ve grafikteki veri noktalarını sırasıyla sadece düz bir JSON sayı dizisi olarak çıkar (örneğin: [1, 6, 2, 5, 7, 13, 265, ...]). Sayılar 1 ile 1000 arasında orantılanmış olmalıdır. Sadece JSON dizisini yaz, markdown block kullanabilirsin, başka hiçbir açıklama yapma.`,

    library_doc_selector: `You are a precise document selector. Answer exactly according to the requested format.`,

    sgm_health_check: `Sen bir gorev denetcisisin. Bir ajan asagidaki kullanici istegini yerine getirmeye calisiyor ve {{stepCount}} adim atti.

Kullanici Istegi: "{{prompt}}"

Simdiye kadar yapilanlar (ozet gecmis):
{{summaries}}

Analiz Et:
1. Kullanicinin istegi tam olarak karsilandi mi?
2. Ajan takildi veya donguye girdi mi?
3. Bir hata ya da tutarsizlik var mi?

Karar ver. SADECE asagidaki JSON formatinda cevap ver:
{
  "karar": "DEVAM_ET" | "BITIR" | "HATA",
  "neden": "Kararin kisa gerekcesi (1-2 cumle)",
  "tavsiye": "DEVAM_ET ise ajana siradaki adim icin ipucu ver. BITIR ise ne tamamlandigini yaz. HATA ise kullaniciya bildirilecek mesaji yaz."
}`,

    entity_router: `Kullanıcının aşağıdaki isteğini analiz et. İstekte kaç farklı "Kişi", "Kurum" veya "Bağımsız Olay/Konu" geçiyor?
Her bir varlık/olay için işlemleri tamamen ayıracağız. Onları aşağıdaki JSON formatında listele:
{
  "entities": [
    { "name": "Muhittin", "instruction": "Muhittin 17 yaşında" },
    { "name": "Omega", "instruction": "Omega 20 yaşında, bilgisayar mühendisliği okuyor" },
    { "name": "Forum Sitesi", "instruction": "Forum sitesi 500 kişi çekmiş" }
  ]
}
Eğer istekte sadece bir konudan/kişiden bahsediliyorsa listeye sadece 1 eleman koy.
Instruction içine o varlıkla ilgili tüm detayları eksiksiz yaz.
Kullanıcı İsteği: "{{prompt}}"`
  };

  // State
  let settingsState = {
    lmStudioUrl: 'http://127.0.0.1:1234/v1',
    modelName: 'qwen2.5-coder-7b-instruct',
    temperature: 0.2,
    maxSteps: 15,
    systemPrompt: '',
    swarmMode: false,
    lpmMode: false,
    lpmOmMode: false,
    lpmBatchSize: 1,
    autoApprove: {},
    bannedCommands: [],
    modelTags: {
      'qwen2.5-3b-instruct': ['hizli'],
      'qwen2.5-coder-7b-instruct': ['hizli', 'orta'],
      'qwen2.5-14b-instruct': ['orta', 'yuklu'],
      'qwen2.5-coder-32b-instruct': ['yuklu'],
      'gpt-oss-120b': ['yuklu']
    },
    apiFallbacks: {
      openai: '',
      anthropic: '',
      gemini: '',
      groq: '',
      priority: ['openai', 'anthropic', 'gemini', 'groq']
    },
    modelSwitchingEnabled: false,
    toolModelConfig: {},
    modelLadder: [
      'qwen2.5-3b-instruct',
      'qwen2.5-coder-7b-instruct',
      'qwen2.5-14b-instruct',
      'qwen2.5-coder-32b-instruct'
    ],
    modelModeProfiles: {},
    systemPrompts: { ...DEFAULT_SYSTEM_PROMPTS }
  };

  const PROMPT_DESCRIPTIONS = {
    main_prompt: 'Ana ajan sistem yönergesi (config/system_prompt.txt). Ajanın temel kimliği, araç tanımları ve kurallarını belirler.',
    ide_planner: 'IDE mimari planlama aşamasında çalışır. Görevi düz metin adımlara ayıran mimar ajanın promptudur.',
    ide_checker: 'IDE adımları sonrasında çalışır. Developer ajanın eylemini denetleyip adımı onaylayan veya reddeden QA ajanı promptudur.',
    task_plan_converter: 'IDE planlama çıktısı olan düz metni checklist formatında JSON görev listesine dönüştüren mikro-planlayıcı promptudur.',
    om_ideal_tool: 'LPM Odaklanma Modunda (OM) sıradaki adımı tamamlamak için gereken ideal aracın tanımını üreten planlayıcı promptudur.',
    swarm_planner: 'Swarm Modu 1. adımında görevleri alt parçalara dekompoze eden Planner ajanın rol tanımıdır.',
    swarm_developer: 'Swarm Modunda planlanan adımları sırayla araç çağrılarıyla uygulayan Developer ajanın rol tanımıdır.',
    swarm_qa_tester: 'Swarm Modunda hata oluştuğunda logları analiz edip düzeltme yönergeleri yazan QA Tester ajanının rolüdür.',
    qa_analysis: 'Kullanıcı bir eylemi reddettiğinde, hatanın kök nedenini analiz eden ve bir sonraki ajana feedback veren analiz promptudur.',
    sgm_health_check: 'SGM ardışık modunda periyodik aralıklarla ajanın takılıp takılmadığını ve görevin durumunu denetleyen sağlık kontrolü promptudur.',
    web_research_safety: 'Web Araştırma modunda harici web sitelerinden gelebilecek komut çalıştırma ve enjeksiyon risklerini engelleyen güvenlik bariyeridir.',
    finance_mode: 'Finans aracı modunda grafik ve sayı dizilerini finansal olarak derinlemesine yorumlayan Finance AI promptudur.',
    chart_data_extractor: 'Yüklenen borsa veya hisse grafik ekran görüntüsünü OCR ile okuyup JSON sayı dizisine dönüştüren veri çıkarıcı promptudur.',
    simba_memory_search: 'SiMBA bellek kütüphanesinde kullanıcı sorusuyla en ilişkili geçmiş kayıtların indekslerini seçen bellek filtresidir.',
    library_doc_selector: 'MemoryLibrary yerel kütüphanesinde aranacak en uygun dosya ve kategorileri filtreleyen doküman seçim promptudur.',
    entity_router: 'Kullanıcı isteğindeki bağımsız kişi, kurum veya olayları tespit edip ardışık görev parçalarına ayıran varlık yönlendirici promptudur.'
  };

  let activePromptKey = 'main_prompt';

  // Helper to send WS message
  function sendWs(payload) {
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
      window.ws.send(JSON.stringify(payload));
      return true;
    } else {
      if (typeof showToast === 'function') {
        showToast('WebSocket bağlantısı yok! Lütfen sayfayı yenileyin.', 'error');
      } else {
        alert('WebSocket bağlantısı yok!');
      }
      return false;
    }
  }

  // --------------------------------------------------
  // 1. Subnav Switching
  // --------------------------------------------------
  function initSubnav() {
    const buttons = document.querySelectorAll('.settings-subnav-btn');
    buttons.forEach(btn => {
      btn.onclick = () => {
        const targetTab = btn.dataset.settingsTab;
        if (!targetTab) return;

        buttons.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-subpanel').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetPanel = document.getElementById(`settings-subpanel-${targetTab}`);
        if (targetPanel) {
          targetPanel.classList.add('active');
        }
      };
    });

    // Consolidated Models & Routing subtab switching
    const modelBtns = document.querySelectorAll('.models-nav-btn');
    modelBtns.forEach(mBtn => {
      mBtn.onclick = () => {
        const pane = mBtn.dataset.modelsPane;
        if (!pane) return;
        modelBtns.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.models-pane').forEach(p => p.classList.remove('active'));
        mBtn.classList.add('active');
        const targetPane = document.getElementById(`models-pane-${pane}`);
        if (targetPane) targetPane.classList.add('active');
      };
    });

    // Safety Tripwire manual reset button
    const resetTripwireBtn = document.getElementById('btn-reset-tripwire');
    if (resetTripwireBtn) {
      resetTripwireBtn.onclick = () => {
        sendWs({ type: 'reset_tripwire' });
        if (typeof showToast === 'function') {
          showToast('Tripwire güvenlik kilidi sıfırlandı.', 'info');
        }
      };
    }
  }

  // --------------------------------------------------
  // 2. Guide Manager
  // --------------------------------------------------
  function initGuideManager() {
    const guideSelect = document.getElementById('editor-guide-select');
    const nameInput = document.getElementById('editor-guide-name');
    const contentArea = document.getElementById('editor-guide-content');
    const saveBtn = document.getElementById('btn-save-guide');

    if (guideSelect) {
      guideSelect.onchange = () => {
        const selected = guideSelect.value;
        if (!selected) {
          if (nameInput) nameInput.value = '';
          if (contentArea) contentArea.value = '';
        } else {
          sendWs({ type: 'get_guide_content', name: selected });
        }
      };
    }

    if (saveBtn) {
      saveBtn.onclick = () => {
        const nameVal = nameInput ? nameInput.value.trim() : '';
        const contentVal = contentArea ? contentArea.value : '';

        if (!nameVal) {
          if (typeof showToast === 'function') {
            showToast('Lütfen rehber için bir dosya adı belirtin (örn: custom_guide.md)', 'warning');
          } else {
            alert('Lütfen dosya adı girin.');
          }
          return;
        }

        if (sendWs({ type: 'save_guide', name: nameVal, content: contentVal })) {
          if (typeof showToast === 'function') {
            showToast(`Rehber "${nameVal}" başarıyla kaydedildi!`, 'success');
          }
        }
      };
    }
  }

  // --------------------------------------------------
  // 3. LM Studio & Model Tagging
  // --------------------------------------------------
  function renderLmModels() {
    const listContainer = document.getElementById('lmstudio-models-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    const models = Object.keys(settingsState.modelTags || {});

    if (models.length === 0) {
      listContainer.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:10px;">Henüz listelenmiş model yok. Aşağıdan ekleyebilirsiniz.</div>';
      return;
    }

    models.forEach(modelName => {
      const tags = settingsState.modelTags[modelName] || [];
      const row = document.createElement('div');
      row.className = 'lm-model-row';

      const isHizli = tags.includes('hizli');
      const isOrta = tags.includes('orta');
      const isYuklu = tags.includes('yuklu');

      row.innerHTML = `
        <div class="lm-model-info">
          <span class="lm-model-name">${modelName}</span>
        </div>
        <div class="lm-model-tags">
          <label class="tag-checkbox-pill ${isHizli ? 'checked' : ''}">
            <input type="checkbox" data-model="${modelName}" data-tag="hizli" ${isHizli ? 'checked' : ''}>
            <span>⚡ Hızlı</span>
          </label>
          <label class="tag-checkbox-pill ${isOrta ? 'checked' : ''}">
            <input type="checkbox" data-model="${modelName}" data-tag="orta" ${isOrta ? 'checked' : ''}>
            <span>⚖️ Orta İşler</span>
          </label>
          <label class="tag-checkbox-pill ${isYuklu ? 'checked' : ''}">
            <input type="checkbox" data-model="${modelName}" data-tag="yuklu" ${isYuklu ? 'checked' : ''}>
            <span>🏋️ Yüklü İşler</span>
          </label>
        </div>
        <button class="btn-remove-model" data-model="${modelName}" title="Modeli listeden kaldır">&times;</button>
      `;
      listContainer.appendChild(row);
    });

    // Tag toggle listeners
    listContainer.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.onchange = (e) => {
        const m = e.target.dataset.model;
        const t = e.target.dataset.tag;
        if (!settingsState.modelTags[m]) settingsState.modelTags[m] = [];
        if (e.target.checked) {
          if (!settingsState.modelTags[m].includes(t)) settingsState.modelTags[m].push(t);
        } else {
          settingsState.modelTags[m] = settingsState.modelTags[m].filter(x => x !== t);
        }
        renderLmModels();
        saveModelTagsToServer(settingsState.modelTags);
      };
    });

    // Remove model listeners
    listContainer.querySelectorAll('.btn-remove-model').forEach(btn => {
      btn.onclick = (e) => {
        const m = e.target.dataset.model;
        delete settingsState.modelTags[m];
        renderLmModels();
        saveModelTagsToServer(settingsState.modelTags);
        if (typeof showToast === 'function') {
          showToast(`"${m}" modeli listeden kaldırıldı ve diske kaydedildi.`, 'info');
        }
      };
    });

    if (typeof populateLadderSelect === 'function') populateLadderSelect();
    if (typeof renderModelModeProfiles === 'function') renderModelModeProfiles();
  }

  async function saveModelTagsToServer(tags, notify = false) {
    const statusEl = document.getElementById('model-tags-save-status');
    if (statusEl) statusEl.textContent = 'Kaydediliyor...';

    // 1. WebSocket sync
    sendWs({
      type: 'update_settings',
      settings: { modelTags: tags }
    });

    // 2. HTTP POST endpoint for guaranteed disk persistence
    try {
      const res = await fetch('/api/model-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelTags: tags })
      });
      const data = await res.json();
      if (data && data.success) {
        if (statusEl) {
          statusEl.textContent = '✓ Değişiklikler diske kaydedildi.';
          setTimeout(() => {
            if (statusEl) statusEl.textContent = 'Değişiklikler anında diske kaydedilir.';
          }, 3000);
        }
        if (notify && typeof showToast === 'function') {
          showToast('Modeller ve etiketler diske başarıyla kaydedildi!', 'success');
        }
      }
    } catch (err) {
      console.warn('POST /api/model-tags failed:', err);
      if (statusEl) statusEl.textContent = 'WS üzerinden kaydedildi.';
    }
  }

  function initLmStudio() {
    renderLmModels();

    // Fetch persisted model tags from disk on init
    fetch('/api/model-tags')
      .then(r => r.json())
      .then(data => {
        if (data && data.modelTags && Object.keys(data.modelTags).length > 0) {
          settingsState.modelTags = { ...data.modelTags };
          renderLmModels();
        }
      })
      .catch(() => {});

    const addModelBtn = document.getElementById('btn-add-lm-model');
    const modelInput = document.getElementById('new-lm-model-input');
    if (addModelBtn && modelInput) {
      addModelBtn.onclick = () => {
        const val = modelInput.value.trim();
        if (val) {
          if (!settingsState.modelTags[val]) {
            settingsState.modelTags[val] = ['orta'];
            renderLmModels();
            saveModelTagsToServer(settingsState.modelTags);
            if (typeof showToast === 'function') {
              showToast(`"${val}" modeli eklendi ve diske kaydedildi.`, 'success');
            }
          }
          modelInput.value = '';
        }
      };

      modelInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addModelBtn.click();
        }
      };
    }

    const saveTagsBtn = document.getElementById('btn-save-model-tags');
    if (saveTagsBtn) {
      saveTagsBtn.onclick = () => {
        saveModelTagsToServer(settingsState.modelTags, true);
      };
    }

    const saveLmBtn = document.getElementById('btn-save-lmstudio');
    if (saveLmBtn) {
      saveLmBtn.onclick = () => {
        const rawUrl = (document.getElementById('setting-url') || {}).value || 'http://127.0.0.1:1234/v1';
        let cleanUrl = rawUrl.trim().replace(/\/+$/, '');
        if (!cleanUrl.toLowerCase().endsWith('/v1')) cleanUrl += '/v1';
        cleanUrl = cleanUrl.replace(/:\/\/localhost/i, '://127.0.0.1');

        const modelName = (document.getElementById('setting-model') || {}).value || 'qwen2.5-coder-7b-instruct';
        const temp = parseFloat((document.getElementById('setting-temp') || {}).value) || 0.2;
        const steps = parseInt((document.getElementById('setting-steps') || {}).value) || 15;

        settingsState.lmStudioUrl = cleanUrl;
        settingsState.modelName = modelName.trim();
        settingsState.temperature = temp;
        settingsState.maxSteps = steps;

        saveModelTagsToServer(settingsState.modelTags, false);

        sendWs({
          type: 'update_settings',
          settings: {
            lmStudioUrl: cleanUrl,
            modelName: settingsState.modelName,
            temperature: temp,
            maxSteps: steps,
            modelTags: settingsState.modelTags
          }
        });

        if (typeof showToast === 'function') {
          showToast('LM Studio ve Model ayarları kaydedildi!', 'success');
        }
      };
    }
  }

  // --------------------------------------------------
  // 4. API Keys & Priority Reordering
  // --------------------------------------------------
  const PROVIDER_NAMES = {
    gemini: 'Google Gemini (API)',
    openai: 'OpenAI GPT (API)',
    anthropic: 'Anthropic Claude (API)',
    groq: 'Groq Cloud (API)'
  };

  function renderApiPriority() {
    const container = document.getElementById('api-priority-list');
    if (!container) return;

    container.innerHTML = '';
    const priority = settingsState.apiFallbacks?.priority || ['openai', 'anthropic', 'gemini', 'groq'];

    priority.forEach((prov, idx) => {
      const row = document.createElement('div');
      row.className = 'priority-item-row';
      const isFirst = idx === 0;
      const isLast = idx === priority.length - 1;

      row.innerHTML = `
        <div class="priority-rank-badge">#${idx + 1}</div>
        <div class="priority-name">${PROVIDER_NAMES[prov] || prov}</div>
        <div class="priority-actions">
          <button type="button" class="btn-priority-move" data-index="${idx}" data-dir="up" ${isFirst ? 'disabled' : ''} title="Önceliği Artır">▲</button>
          <button type="button" class="btn-priority-move" data-index="${idx}" data-dir="down" ${isLast ? 'disabled' : ''} title="Önceliği Azalt">▼</button>
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('.btn-priority-move').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        const dir = btn.dataset.dir;
        const prio = [...priority];

        if (dir === 'up' && idx > 0) {
          const temp = prio[idx - 1];
          prio[idx - 1] = prio[idx];
          prio[idx] = temp;
        } else if (dir === 'down' && idx < prio.length - 1) {
          const temp = prio[idx + 1];
          prio[idx + 1] = prio[idx];
          prio[idx] = temp;
        }

        if (!settingsState.apiFallbacks) settingsState.apiFallbacks = {};
        settingsState.apiFallbacks.priority = prio;
        renderApiPriority();
      };
    });
  }

  function initApiKeys() {
    renderApiPriority();

    const saveApiBtn = document.getElementById('btn-save-apikeys');
    if (saveApiBtn) {
      saveApiBtn.onclick = () => {
        const openAiKey = (document.getElementById('setting-api-openai') || {}).value || '';
        const anthropicKey = (document.getElementById('setting-api-anthropic') || {}).value || '';
        const geminiKey = (document.getElementById('setting-api-gemini') || {}).value || '';
        const groqKey = (document.getElementById('setting-api-groq') || {}).value || '';

        const prio = settingsState.apiFallbacks?.priority || ['openai', 'anthropic', 'gemini', 'groq'];

        settingsState.apiFallbacks = {
          openai: openAiKey.trim(),
          anthropic: anthropicKey.trim(),
          gemini: geminiKey.trim(),
          groq: groqKey.trim(),
          priority: prio
        };

        sendWs({
          type: 'update_settings',
          settings: {
            apiFallbacks: settingsState.apiFallbacks
          }
        });

        if (typeof showToast === 'function') {
          showToast('API Anahtarları ve Öncelik Sırası kaydedildi!', 'success');
        }
      };
    }
  }

  // --------------------------------------------------
  // 5. System Prompts Management
  // --------------------------------------------------
  function updatePromptEditorView() {
    const promptSelect = document.getElementById('system-prompt-select');
    const descEl = document.getElementById('system-prompt-desc');
    const textarea = document.getElementById('system-prompt-textarea');
    if (!textarea) return;

    if (promptSelect && promptSelect.value !== activePromptKey) {
      promptSelect.value = activePromptKey;
    }

    if (descEl) {
      descEl.textContent = PROMPT_DESCRIPTIONS[activePromptKey] || '';
    }

    const currentVal = (settingsState.systemPrompts && settingsState.systemPrompts[activePromptKey])
      || DEFAULT_SYSTEM_PROMPTS[activePromptKey]
      || '';
    textarea.value = currentVal;
  }

  function initSystemPrompts() {
    const promptSelect = document.getElementById('system-prompt-select');
    const textarea = document.getElementById('system-prompt-textarea');
    const saveBtn = document.getElementById('btn-save-prompts');

    // Fetch saved prompts from HTTP API immediately on load (pre-auth guarantee)
    fetch('/api/system-prompts')
      .then(res => res.json())
      .then(data => {
        if (data && data.systemPrompts && typeof data.systemPrompts === 'object') {
          settingsState.systemPrompts = Object.assign({}, DEFAULT_SYSTEM_PROMPTS, data.systemPrompts);
          if (data.systemPrompt && !settingsState.systemPrompts.main_prompt) {
            settingsState.systemPrompts.main_prompt = data.systemPrompt;
          }
          updatePromptEditorView();
        }
      })
      .catch(err => {
        console.warn('Initial prompt fetch note:', err);
      });

    const handleSelectChange = () => {
      if (!promptSelect) return;
      // If user typed in textarea before switching, keep their edits
      if (textarea && textarea.value && textarea.value.trim().length > 0) {
        if (!settingsState.systemPrompts) settingsState.systemPrompts = {};
        settingsState.systemPrompts[activePromptKey] = textarea.value;
      }
      activePromptKey = promptSelect.value;
      updatePromptEditorView();
    };

    if (promptSelect) {
      promptSelect.addEventListener('change', handleSelectChange);
      promptSelect.addEventListener('input', handleSelectChange);
      if (promptSelect.value) {
        activePromptKey = promptSelect.value;
      }
    }

    if (textarea) {
      textarea.addEventListener('input', () => {
        if (!settingsState.systemPrompts) settingsState.systemPrompts = {};
        settingsState.systemPrompts[activePromptKey] = textarea.value;
        if (activePromptKey === 'main_prompt') {
          settingsState.systemPrompt = textarea.value;
        }
      });
    }

    if (saveBtn) {
      saveBtn.onclick = async () => {
        if (textarea) {
          if (!settingsState.systemPrompts) settingsState.systemPrompts = {};
          settingsState.systemPrompts[activePromptKey] = textarea.value;
          if (activePromptKey === 'main_prompt') {
            settingsState.systemPrompt = textarea.value;
          }
        }

        // 1. WebSocket sync
        sendWs({
          type: 'update_settings',
          settings: {
            systemPrompt: settingsState.systemPrompts.main_prompt || settingsState.systemPrompt,
            systemPrompts: settingsState.systemPrompts
          }
        });

        // 2. HTTP POST guarantee
        try {
          await fetch('/api/system-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompts: settingsState.systemPrompts })
          });
        } catch (e) {}

        if (typeof showToast === 'function') {
          showToast('Tüm Sistem Promptları başarıyla kaydedildi!', 'success');
        }
      };
    }

    // Quick-jump pills from flowchart
    document.querySelectorAll('.flow-pill-btn').forEach(btn => {
      btn.onclick = () => {
        const targetPrompt = btn.dataset.targetPrompt;
        if (targetPrompt) {
          if (textarea && textarea.value && textarea.value.trim().length > 0) {
            if (!settingsState.systemPrompts) settingsState.systemPrompts = {};
            settingsState.systemPrompts[activePromptKey] = textarea.value;
          }
          activePromptKey = targetPrompt;
          if (promptSelect) promptSelect.value = targetPrompt;
          updatePromptEditorView();

          const editorCard = document.getElementById('system-prompt-editor-card');
          if (editorCard) {
            editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      };
    });

    // Diagram lightbox modal
    const diagramModal = document.getElementById('diagram-modal');
    const openTriggers = [document.getElementById('algorithm-img-trigger'), document.getElementById('btn-zoom-diagram')];
    const closeBtn = document.getElementById('btn-close-diagram-modal');

    openTriggers.forEach(t => {
      if (t) {
        t.onclick = () => {
          if (diagramModal) diagramModal.classList.remove('hidden');
        };
      }
    });

    if (closeBtn) {
      closeBtn.onclick = () => {
        if (diagramModal) diagramModal.classList.add('hidden');
      };
    }

    if (diagramModal) {
      diagramModal.onclick = (e) => {
        if (e.target === diagramModal) diagramModal.classList.add('hidden');
      };
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && diagramModal && !diagramModal.classList.contains('hidden')) {
        diagramModal.classList.add('hidden');
      }
    });

    // Initial render for currently selected prompt
    updatePromptEditorView();
  }

  // --------------------------------------------------
  // 6. Auto Approval & Execution Settings
  // --------------------------------------------------
  function initAutoSettings() {
    const saveBtn = document.getElementById('btn-save-auto');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const tools = [
          'read_file', 'write_file', 'list_directory',
          'web_search', 'view_website', 'open_application',
          'send_discord_message', 'line_checker', 'url_image_reader', 'library_mode'
        ];
        const autoApprove = {};
        tools.forEach(t => {
          const el = document.getElementById(`approve-${t}`);
          if (el) autoApprove[t] = el.checked;
        });

        const swarmMode = !!(document.getElementById('setting-swarm') || {}).checked;
        const lpmMode = !!(document.getElementById('setting-lpm') || {}).checked;
        const lpmOmMode = !!(document.getElementById('setting-lpm-om') || {}).checked;
        const lpmBatch = parseInt((document.getElementById('setting-lpm-batch') || {}).value) || 1;
        const hpmMode = !!(document.getElementById('setting-hpm') || {}).checked;
        const maxDailyCostUSD = parseFloat((document.getElementById('setting-max-daily-cost') || {}).value) || 1.00;

        sendWs({
          type: 'update_settings',
          settings: {
            autoApprove,
            swarmMode,
            lpmMode,
            lpmOmMode,
            lpmBatchSize: lpmBatch,
            hpmMode,
            maxDailyCostUSD
          }
        });

        // Sync sidebar HPM toggle
        const sidebarHpmChk = document.getElementById('hpm-toggle-checkbox');
        if (sidebarHpmChk) sidebarHpmChk.checked = hpmMode;
        _applyHpmSidebarState(hpmMode);

        if (typeof showToast === 'function') {
          showToast('Otomatik Onay ve Yürütme ayarları kaydedildi!', 'success');
        }
      };
    }
  }

  // --------------------------------------------------
  // 7. Discord Management
  // --------------------------------------------------
  function initDiscordSettings() {
    const saveBtn = document.getElementById('btn-save-discord-all');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const sToken = document.getElementById('setting-env-token');
        const sFounderId = document.getElementById('setting-env-founderid');
        const sFounderKey = document.getElementById('setting-env-founderkey');
        const speedLimitEl = document.getElementById('discord-speed-limit');

        const updatedEnv = {};
        if (sFounderKey && sFounderKey.value.trim() && !sFounderKey.value.includes('*')) {
          updatedEnv.FOUNDER_KEY = sFounderKey.value.trim();
          localStorage.setItem('founderKey', updatedEnv.FOUNDER_KEY);
        }
        if (sToken && sToken.value.trim() && !sToken.value.includes('*')) {
          updatedEnv.DISCORD_TOKEN = sToken.value.trim();
        }
        if (sFounderId && sFounderId.value.trim()) {
          updatedEnv.FOUNDER_DISCORD_ID = sFounderId.value.trim();
        }

        if (Object.keys(updatedEnv).length > 0) {
          sendWs({
            type: 'save_admin_data',
            env: updatedEnv
          });
        }

        if (speedLimitEl) {
          const limitVal = parseFloat(speedLimitEl.value);
          if (!isNaN(limitVal)) {
            sendWs({
              type: 'update_discord_config',
              connectionSpeedLimit: limitVal
            });
          }
        }

        if (typeof showToast === 'function') {
          showToast('Discord yapılandırması kaydedildi!', 'success');
        }
      };
    }

    // Add Discord Admin
    const addAdminBtn = document.getElementById('btn-add-discord-admin');
    const adminInput = document.getElementById('new-discord-admin-input');
    if (addAdminBtn && adminInput) {
      addAdminBtn.onclick = () => {
        const val = adminInput.value.trim();
        if (val) {
          sendWs({ type: 'add_discord_admin', adminId: val });
          adminInput.value = '';
        }
      };
    }

    // Add Discord User
    const addUserBtn = document.getElementById('btn-add-discord-user');
    const userInput = document.getElementById('new-discord-user-input');
    if (addUserBtn && userInput) {
      addUserBtn.onclick = () => {
        const val = userInput.value.trim();
        if (val) {
          sendWs({ type: 'add_discord_user', userId: val });
          userInput.value = '';
        }
      };
    }
  }

  // --------------------------------------------------
  // 8. Perm (Banned Shell Commands Blacklist)
  // --------------------------------------------------
  function renderBannedBadges() {
    const container = document.getElementById('banned-badges');
    if (!container) return;

    container.innerHTML = '';
    const banned = settingsState.bannedCommands || [];

    banned.forEach((cmd, idx) => {
      const badge = document.createElement('div');
      badge.className = 'banned-badge';
      badge.innerHTML = `
        <span>${cmd}</span>
        <button type="button" data-index="${idx}">&times;</button>
      `;
      container.appendChild(badge);
    });

    container.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        settingsState.bannedCommands.splice(idx, 1);
        sendWs({
          type: 'update_settings',
          settings: { bannedCommands: settingsState.bannedCommands }
        });
        renderBannedBadges();
      };
    });
  }

  function initPermSettings() {
    renderBannedBadges();

    const addBtn = document.getElementById('btn-add-banned');
    const input = document.getElementById('new-banned-input');
    if (addBtn && input) {
      addBtn.onclick = () => {
        const val = input.value.trim();
        if (val && !settingsState.bannedCommands.includes(val)) {
          settingsState.bannedCommands.push(val);
          sendWs({
            type: 'update_settings',
            settings: { bannedCommands: settingsState.bannedCommands }
          });
          input.value = '';
          renderBannedBadges();
        }
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addBtn.click();
        }
      };
    }
  }

  // --------------------------------------------------
  // 9. Tool Model Routing (Model Yönlendirme)
  // --------------------------------------------------

  const TOOL_ROUTING_DEFS = [
    { key: 'library_mode',       label: '\uD83D\uDCDA Library Mode',     icon: '\uD83D\uDCDA' },
    { key: 'web_search',         label: '\uD83C\uDF10 Web Arama',        icon: '\uD83C\uDF10' },
    { key: 'view_website',       label: '\uD83D\uDD0D Web Okuma',        icon: '\uD83D\uDD0D' },
    { key: 'deep_web_search',    label: '\uD83D\uDCC1 Derin Web',        icon: '\uD83D\uDCC1' },
    { key: 'execute_command',    label: '\uD83D\uDCBB Komut (CMD)',       icon: '\uD83D\uDCBB' },
    { key: 'write_file',         label: '\u270D\uFE0F Dosya Yaz',         icon: '\u270D\uFE0F' },
    { key: 'read_file',          label: '\uD83D\uDCD6 Dosya Oku',         icon: '\uD83D\uDCD6' },
    { key: 'list_directory',     label: '\uD83D\uDCC2 Klas\u00f6r Liste',      icon: '\uD83D\uDCC2' },
    { key: 'url_image_reader',   label: '\uD83D\uDDBC\uFE0F G\u00f6rsel/URL',       icon: '\uD83D\uDDBC\uFE0F' },
    { key: 'extract_chart_data', label: '\uD83D\uDCCA Grafik Analiz',    icon: '\uD83D\uDCCA' },
    { key: 'take_screenshot',    label: '\uD83D\uDCF7 Ekran G\u00f6r.', icon: '\uD83D\uDCF7' },
    { key: '__default__',        label: '\uD83E\uDD16 Genel (Agent)',     icon: '\uD83E\uDD16' },
  ];

  const TAG_OPTIONS = [
    { value: 'hizli', label: '\u26A1 H\u0131zl\u0131' },
    { value: 'orta',  label: '\u2696\uFE0F Orta'  },
    { value: 'yuklu', label: '\uD83C\uDFCB\uFE0F Y\u00fcke' },
  ];

  function buildTagSelect(id, currentVal) {
    let opts = TAG_OPTIONS.map(o =>
      `<option value="${o.value}" ${o.value === currentVal ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    return `<select id="${id}" class="tool-route-select">${opts}</select>`;
  }

  function renderToolModelRouting() {
    const container = document.getElementById('tool-model-routing-list');
    if (!container) return;

    const cfg = settingsState.toolModelConfig || {};
    container.innerHTML = '';

    TOOL_ROUTING_DEFS.forEach(def => {
      const entry = cfg[def.key] || { tag: 'orta', fallbackTag: 'hizli' };
      const row = document.createElement('div');
      row.className = 'tool-route-row';
      row.innerHTML = `
        <div class="tool-route-label">${def.label}</div>
        <div class="tool-route-selects">
          <div class="tool-route-select-wrap">
            <span class="tool-route-select-hint">Ana Model</span>
            ${buildTagSelect('tr-tag-' + def.key, entry.tag)}
          </div>
          <span class="tool-route-arrow">&#8594; fail &#8594;</span>
          <div class="tool-route-select-wrap">
            <span class="tool-route-select-hint">Fallback</span>
            ${buildTagSelect('tr-fallback-' + def.key, entry.fallbackTag)}
          </div>
        </div>
      `;
      container.appendChild(row);
    });
  }

  function collectToolModelConfig() {
    const cfg = {};
    TOOL_ROUTING_DEFS.forEach(def => {
      const tagEl      = document.getElementById('tr-tag-'      + def.key);
      const fallbackEl = document.getElementById('tr-fallback-' + def.key);
      cfg[def.key] = {
        tag:         tagEl      ? tagEl.value      : 'orta',
        fallbackTag: fallbackEl ? fallbackEl.value : 'hizli'
      };
    });
    return cfg;
  }

  const AVAILABLE_AUTO_MODES = [
    { key: 'lpmMode', label: 'LPM' },
    { key: 'lpmOmMode', label: 'LPM OM' },
    { key: 'hpmMode', label: 'HPM' },
    { key: 'advancedReasoningMode', label: 'Derin Düşünme' },
    { key: 'forceTaskPlan', label: 'Görev Planı' },
    { key: 'simbaEnabled', label: 'SiMBA' }
  ];

  function renderModelLadder() {
    const container = document.getElementById('model-ladder-list');
    if (!container) return;

    container.innerHTML = '';
    const ladder = settingsState.modelLadder || [];

    if (ladder.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem; padding:8px;">Merdivende henüz model yok. Aşağıdan model ekleyebilirsiniz.</div>';
      return;
    }

    ladder.forEach((model, idx) => {
      const row = document.createElement('div');
      row.className = 'priority-item-row';
      const isFirst = idx === 0;
      const isLast = idx === ladder.length - 1;

      row.innerHTML = `
        <div class="priority-rank-badge">#${idx + 1}</div>
        <div class="priority-name" style="font-family:monospace; font-size:0.84rem;">${model}</div>
        <div class="priority-actions">
          <button type="button" class="btn-priority-move" data-index="${idx}" data-dir="up" ${isFirst ? 'disabled' : ''} title="Basamağı Yükselt">▲</button>
          <button type="button" class="btn-priority-move" data-index="${idx}" data-dir="down" ${isLast ? 'disabled' : ''} title="Basamağı İndir">▼</button>
          <button type="button" class="btn-ladder-del" data-index="${idx}" title="Merdivenden Kaldır">✕</button>
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('.btn-priority-move').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        const dir = btn.dataset.dir;
        const current = [...(settingsState.modelLadder || [])];
        if (dir === 'up' && idx > 0) {
          const temp = current[idx - 1];
          current[idx - 1] = current[idx];
          current[idx] = temp;
        } else if (dir === 'down' && idx < current.length - 1) {
          const temp = current[idx + 1];
          current[idx + 1] = current[idx];
          current[idx] = temp;
        }
        settingsState.modelLadder = current;
        renderModelLadder();
        populateLadderSelect();
      };
    });

    container.querySelectorAll('.btn-ladder-del').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        settingsState.modelLadder.splice(idx, 1);
        renderModelLadder();
        populateLadderSelect();
      };
    });
  }

  function populateLadderSelect() {
    const select = document.getElementById('select-add-ladder-model');
    if (!select) return;

    const allModels = Object.keys(settingsState.modelTags || {});
    select.innerHTML = '';
    const unused = allModels.filter(m => !(settingsState.modelLadder || []).includes(m));
    if (unused.length === 0) {
      select.innerHTML = '<option value="">(Tüm modeller merdivende)</option>';
      return;
    }
    unused.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });
  }

  function renderModelModeProfiles() {
    const container = document.getElementById('model-mode-profiles-list');
    if (!container) return;

    container.innerHTML = '';
    const allModels = Object.keys(settingsState.modelTags || {});
    const profiles = settingsState.modelModeProfiles || {};

    if (allModels.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem; padding:8px;">Kayıtlı model bulunamadı. Önce yukarıdan model ekleyin.</div>';
      return;
    }

    allModels.forEach(model => {
      const prof = profiles[model] || {};
      const row = document.createElement('div');
      row.className = 'model-mode-profile-row';

      let chipsHtml = '';
      AVAILABLE_AUTO_MODES.forEach(m => {
        const isChecked = !!prof[m.key];
        chipsHtml += `
          <label class="mode-chip-label">
            <input type="checkbox" data-model="${model}" data-mode="${m.key}" ${isChecked ? 'checked' : ''}>
            <span>${m.label}</span>
          </label>
        `;
      });

      const batchVal = prof.lpmBatchSize || 1;
      const batchSelectHtml = `
        <label class="mode-chip-label" style="gap:4px;">
          <span>LPM Batch:</span>
          <select class="model-lpm-batch-select" data-model="${model}" style="padding:1px 4px; background:var(--bg-secondary, #1e1e2e); color:var(--text-primary, #fff); border:1px solid var(--border-color, #555); border-radius:3px; font-size:0.76rem; cursor:pointer;">
            <option value="1" ${batchVal === 1 ? 'selected' : ''}>1</option>
            <option value="2" ${batchVal === 2 ? 'selected' : ''}>2</option>
            <option value="3" ${batchVal === 3 ? 'selected' : ''}>3</option>
            <option value="4" ${batchVal === 4 ? 'selected' : ''}>4</option>
            <option value="5" ${batchVal === 5 ? 'selected' : ''}>5</option>
          </select>
        </label>
      `;

      row.innerHTML = `
        <div class="model-profile-header">
          <span class="model-profile-name">${model}</span>
        </div>
        <div class="model-profile-chips">
          ${chipsHtml}
          ${batchSelectHtml}
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.onchange = () => {
        const model = cb.dataset.model;
        const mode = cb.dataset.mode;
        if (!settingsState.modelModeProfiles) settingsState.modelModeProfiles = {};
        if (!settingsState.modelModeProfiles[model]) settingsState.modelModeProfiles[model] = {};
        settingsState.modelModeProfiles[model][mode] = cb.checked;
      };
    });

    container.querySelectorAll('.model-lpm-batch-select').forEach(sel => {
      sel.onchange = () => {
        const model = sel.dataset.model;
        const val = parseInt(sel.value) || 1;
        if (!settingsState.modelModeProfiles) settingsState.modelModeProfiles = {};
        if (!settingsState.modelModeProfiles[model]) settingsState.modelModeProfiles[model] = {};
        settingsState.modelModeProfiles[model].lpmBatchSize = val;
      };
    });
  }

  async function saveToolModelConfig() {
    const toolModelConfig = collectToolModelConfig();
    const toggleEl = document.getElementById('tool-model-switching-toggle');
    const modelSwitchingEnabled = toggleEl ? toggleEl.checked : false;
    const amprToggleEl = document.getElementById('ampr-adaptive-toggle');
    const adaptiveRouting = amprToggleEl ? amprToggleEl.checked : true;
    const modelLadder = settingsState.modelLadder || [];
    const modelModeProfiles = settingsState.modelModeProfiles || {};

    settingsState.toolModelConfig = toolModelConfig;
    settingsState.modelSwitchingEnabled = modelSwitchingEnabled;
    settingsState.adaptiveRouting = adaptiveRouting;

    try {
      const res = await fetch('/api/tool-model-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolModelConfig,
          modelSwitchingEnabled,
          adaptiveRouting,
          modelLadder,
          modelModeProfiles
        })
      });
      const data = await res.json();
      if (data && data.success) {
        sendWs({
          type: 'update_settings',
          settings: {
            toolModelConfig,
            modelSwitchingEnabled,
            adaptiveRouting,
            modelLadder,
            modelModeProfiles
          }
        });

        if (typeof showToast === 'function') {
          showToast('Model Yönlendirme, Merdiven, AMPR ve Mod Profilleri kaydedildi!', 'success');
        }
      }
    } catch (err) {
      console.warn('POST /api/tool-model-config failed:', err);
    }
  }

  async function testLmStudioSwitch() {
    const toggleEl = document.getElementById('tool-model-switching-toggle');
    if (toggleEl && !toggleEl.checked) {
      if (typeof showToast === 'function') showToast('Önce Model Switching aktif et!', 'error');
      return;
    }
    const lmModelsContainer = document.getElementById('lm-live-models-list');
    if (lmModelsContainer) lmModelsContainer.innerHTML = '<span style="color:var(--text-muted); font-size:0.82rem;">LM Studio sorgulanıyor...</span>';
    try {
      const res = await fetch('/api/lm-studio/models');
      const data = await res.json();
      if (data && data.success && Array.isArray(data.models)) {
        if (lmModelsContainer) {
          lmModelsContainer.innerHTML = data.models.length === 0
            ? `<span style="color:var(--text-muted); font-size:0.82rem;">LM Studio'da yüklü model yok.</span>`
            : data.models.map(m => `<span class="lm-live-model-badge">${m.id || m}</span>`).join('');
        }
      } else {
        if (lmModelsContainer) lmModelsContainer.innerHTML = '<span style="color:#f87171; font-size:0.82rem;">❌ LM Studio bağlantısı başarısız.</span>';
      }
    } catch (err) {
      if (lmModelsContainer) lmModelsContainer.innerHTML = `<span style="color:#f87171; font-size:0.82rem;">Hata: ${err.message}</span>`;
    }
  }

  async function loadAmprPerformance() {
    const tbody = document.getElementById('ampr-performance-tbody');
    const toggle = document.getElementById('ampr-adaptive-toggle');
    if (!tbody) return;

    try {
      const res = await fetch('/api/model-performance');
      const data = await res.json();
      if (!data || !data.success) return;

      if (toggle && data.adaptiveRouting !== undefined) {
        toggle.checked = !!data.adaptiveRouting;
      }

      if (!Array.isArray(data.stats) || data.stats.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:12px; text-align:center; color:var(--text-muted);">Henüz performans kaydı birikmedi (En az 3 çağrı gereklidir).</td></tr>`;
        return;
      }

      tbody.innerHTML = data.stats.map(row => {
        const scoreColor = row.score >= 70 ? '#34d399' : (row.score >= 40 ? '#f59e0b' : '#f87171');
        const successColor = row.successRate >= 90 ? '#34d399' : (row.successRate >= 60 ? '#f59e0b' : '#f87171');
        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:6px; font-weight:600;">${row.modelId}</td>
            <td style="padding:6px;"><code style="background:var(--bg-input, #222); padding:2px 6px; border-radius:3px;">${row.toolName}</code></td>
            <td style="padding:6px; text-align:center;">${row.samples}</td>
            <td style="padding:6px; text-align:center; color:${successColor}; font-weight:600;">%${row.successRate}</td>
            <td style="padding:6px; text-align:center;">Katman ${row.avgParseTier}</td>
            <td style="padding:6px; text-align:center;">${Math.round(row.avgLatencyMs)} ms</td>
            <td style="padding:6px; text-align:right; font-weight:bold; color:${scoreColor};">${row.score}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.warn('Failed to load AMPR performance:', e);
    }
  }

  async function resetAmprPerformance() {
    if (!confirm('Tüm model performans geçmişini sıfırlamak istediğinize emin misiniz?')) return;
    try {
      const res = await fetch('/api/model-performance/reset', { method: 'POST' });
      const data = await res.json();
      if (data && data.success) {
        if (typeof showToast === 'function') showToast('AMPR performans verileri sıfırlandı.', 'success');
        loadAmprPerformance();
      }
    } catch (e) {
      console.warn('Failed to reset AMPR performance:', e);
    }
  }

  function initToolModelRouting() {
    fetch('/api/tool-model-config')
      .then(r => r.json())
      .then(data => {
        if (data && data.success) {
          if (data.toolModelConfig) settingsState.toolModelConfig = { ...data.toolModelConfig };
          if (data.modelSwitchingEnabled !== undefined) settingsState.modelSwitchingEnabled = data.modelSwitchingEnabled;
          if (data.modelLadder && Array.isArray(data.modelLadder)) settingsState.modelLadder = [...data.modelLadder];
          if (data.modelModeProfiles) settingsState.modelModeProfiles = { ...data.modelModeProfiles };
        }
        renderToolModelRouting();
        renderModelLadder();
        populateLadderSelect();
        renderModelModeProfiles();

        const toggleEl = document.getElementById('tool-model-switching-toggle');
        if (toggleEl) toggleEl.checked = !!settingsState.modelSwitchingEnabled;
      })
      .catch(() => {
        renderToolModelRouting();
        renderModelLadder();
        populateLadderSelect();
        renderModelModeProfiles();
      });

    loadAmprPerformance();

    const refreshAmprBtn = document.getElementById('btn-refresh-ampr');
    if (refreshAmprBtn) refreshAmprBtn.onclick = loadAmprPerformance;

    const resetAmprBtn = document.getElementById('btn-reset-ampr');
    if (resetAmprBtn) resetAmprBtn.onclick = resetAmprPerformance;

    const amprToggle = document.getElementById('ampr-adaptive-toggle');
    if (amprToggle) {
      amprToggle.onchange = () => {
        sendWs({
          type: 'update_settings',
          settings: { adaptiveRouting: amprToggle.checked }
        });
        if (typeof showToast === 'function') {
          showToast(`Adaptif model yönlendirme ${amprToggle.checked ? 'AÇILDI' : 'KAPATILDI'}.`, 'info');
        }
      };
    }

    const addLadderBtn = document.getElementById('btn-add-ladder-model');
    if (addLadderBtn) {
      addLadderBtn.onclick = () => {
        const sel = document.getElementById('select-add-ladder-model');
        const chosen = sel ? sel.value : null;
        if (chosen && chosen.trim() && !(settingsState.modelLadder || []).includes(chosen)) {
          if (!settingsState.modelLadder) settingsState.modelLadder = [];
          settingsState.modelLadder.push(chosen);
          renderModelLadder();
          populateLadderSelect();
        }
      };
    }

    const saveBtn = document.getElementById('btn-save-tool-model-routing');
    if (saveBtn) saveBtn.onclick = saveToolModelConfig;

    const testBtn = document.getElementById('btn-test-lm-models');
    if (testBtn) testBtn.onclick = testLmStudioSwitch;

    // Mode guide box toggle
    const toggleGuideBtn = document.getElementById('btn-toggle-mode-guide');
    const closeGuideBtn = document.getElementById('btn-close-mode-guide');
    const guideBox = document.getElementById('mode-guide-box');

    if (toggleGuideBtn && guideBox) {
      toggleGuideBtn.onclick = () => {
        const isHidden = guideBox.style.display === 'none';
        guideBox.style.display = isHidden ? 'block' : 'none';
        toggleGuideBtn.textContent = isHidden ? 'Rehberi Gizle' : 'Mod Açıklamaları & Rehber';
      };
    }
    if (closeGuideBtn && guideBox) {
      closeGuideBtn.onclick = () => {
        guideBox.style.display = 'none';
        if (toggleGuideBtn) toggleGuideBtn.textContent = 'Mod Açıklamaları & Rehber';
      };
    }
  }

  window.updateSettingsSubpanels = function(settings) {
    if (!settings) return;
    Object.assign(settingsState, settings);

    if (settings.systemPrompts) {
      settingsState.systemPrompts = Object.assign({}, DEFAULT_SYSTEM_PROMPTS, settings.systemPrompts);
      if (settings.systemPrompt && !settingsState.systemPrompts.main_prompt) {
        settingsState.systemPrompts.main_prompt = settings.systemPrompt;
      }
    }
    if (settings.modelTags) {
      settingsState.modelTags = { ...settings.modelTags };
    }
    if (settings.bannedCommands) {
      settingsState.bannedCommands = [...settings.bannedCommands];
    }
    if (settings.apiFallbacks) {
      settingsState.apiFallbacks = { ...settings.apiFallbacks };
    }
    if (settings.toolModelConfig) {
      settingsState.toolModelConfig = { ...settings.toolModelConfig };
    }
    if (settings.modelLadder) {
      settingsState.modelLadder = [...settings.modelLadder];
    }
    if (settings.modelModeProfiles) {
      settingsState.modelModeProfiles = { ...settings.modelModeProfiles };
    }
    if (settings.modelSwitchingEnabled !== undefined) {
      settingsState.modelSwitchingEnabled = settings.modelSwitchingEnabled;
      const toggleEl = document.getElementById('tool-model-switching-toggle');
      if (toggleEl) toggleEl.checked = !!settings.modelSwitchingEnabled;
    }

    renderLmModels();
    renderApiPriority();
    renderModelLadder();
    populateLadderSelect();
    renderModelModeProfiles();
    renderToolModelRouting();
    updatePromptEditorView();
    renderBannedBadges();

    // Sync input fields
    const urlInput = document.getElementById('setting-url');
    const modelInput = document.getElementById('setting-model');
    const tempInput = document.getElementById('setting-temp');
    const stepsInput = document.getElementById('setting-steps');

    if (urlInput && settings.lmStudioUrl) urlInput.value = settings.lmStudioUrl;
    if (modelInput && settings.modelName) modelInput.value = settings.modelName;
    if (tempInput && settings.temperature !== undefined) tempInput.value = settings.temperature;
    if (stepsInput && settings.maxSteps !== undefined) stepsInput.value = settings.maxSteps;

    if (settings.apiFallbacks) {
      const g = document.getElementById('setting-api-gemini');
      const o = document.getElementById('setting-api-openai');
      const a = document.getElementById('setting-api-anthropic');
      const gr = document.getElementById('setting-api-groq');
      if (g && settings.apiFallbacks.gemini !== undefined) g.value = settings.apiFallbacks.gemini;
      if (o && settings.apiFallbacks.openai !== undefined) o.value = settings.apiFallbacks.openai;
      if (a && settings.apiFallbacks.anthropic !== undefined) a.value = settings.apiFallbacks.anthropic;
      if (gr && settings.apiFallbacks.groq !== undefined) gr.value = settings.apiFallbacks.groq;
    }

    // Auto approvals
    if (settings.autoApprove) {
      Object.keys(settings.autoApprove).forEach(k => {
        const el = document.getElementById(`approve-${k}`);
        if (el) el.checked = !!settings.autoApprove[k];
      });
    }

    // Swarm & LPM
    const swarmEl = document.getElementById('setting-swarm');
    if (swarmEl && settings.swarmMode !== undefined) swarmEl.checked = !!settings.swarmMode;

    const lpmEl = document.getElementById('setting-lpm');
    if (lpmEl && settings.lpmMode !== undefined) lpmEl.checked = !!settings.lpmMode;

    const lpmOmEl = document.getElementById('setting-lpm-om');
    if (lpmOmEl && settings.lpmOmMode !== undefined) lpmOmEl.checked = !!settings.lpmOmMode;

    const lpmBatchEl = document.getElementById('setting-lpm-batch');
    const lpmBatchVal = document.getElementById('lpm-batch-val');
    if (lpmBatchEl && settings.lpmBatchSize !== undefined) {
      lpmBatchEl.value = settings.lpmBatchSize;
      if (lpmBatchVal) lpmBatchVal.innerText = settings.lpmBatchSize;
    }

    // HPM — sync both Settings checkbox and sidebar toggle
    if (settings.hpmMode !== undefined) {
      const hpmSettingEl = document.getElementById('setting-hpm');
      if (hpmSettingEl) hpmSettingEl.checked = !!settings.hpmMode;
      const sidebarChk = document.getElementById('hpm-toggle-checkbox');
      if (sidebarChk) sidebarChk.checked = !!settings.hpmMode;
      _applyHpmSidebarState(!!settings.hpmMode);
    }

    if (settings.maxDailyCostUSD !== undefined) {
      const maxDailyCostEl = document.getElementById('setting-max-daily-cost');
      if (maxDailyCostEl) maxDailyCostEl.value = Number(settings.maxDailyCostUSD).toFixed(2);
    }
  };

  // DOMContentLoaded initialization
  document.addEventListener('DOMContentLoaded', () => {
    initSubnav();
    initGuideManager();
    initLmStudio();
    initApiKeys();
    initSystemPrompts();
    initAutoSettings();
    initDiscordSettings();
    initPermSettings();
    initToolModelRouting();
  });

})();
