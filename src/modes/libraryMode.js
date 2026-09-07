const fs = require('fs');
const path = require('path');
const { agentState, broadcastState, broadcastTerminal, addMessage } = require('../state');
const { llmFetch, cleanMalformedJsonString } = require('../llm/llmClient');
const { log } = require('../logger');

let libraryAskResolver = null;

function resolveLibraryAsk(answer) {
  if (libraryAskResolver) {
    libraryAskResolver(answer);
    libraryAskResolver = null;
  }
}

async function runLibraryModeSubLoop(searchQuery, explanation) {
  broadcastTerminal(`\n*** [LIBRARY MODE SUB-LOOP] Entering Library Search Mode... ***\n`);
  
  // 1. Save original messages history
  const originalMessages = [...agentState.messages];
  
  // 2. Clear current messages history
  agentState.messages = [];
  
  // 3. Set library mode initial query
  addMessage('user', `library_mode: true, search: ${searchQuery}, explanation: ${explanation}`);
  broadcastState();

  // 4. Find all .md and .json files from both Libraries/library and Libraries/MemoryLibrary (recursive)
  const libraryDirs = [
    path.join(agentState.cwd, 'Libraries', 'library'),
    path.join(agentState.cwd, 'Libraries', 'MemoryLibrary')
  ];
  let files = [];

  async function scanDir(dir) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.name.toLowerCase().endsWith('.md') || entry.name.toLowerCase().endsWith('.json') || entry.name.toLowerCase().endsWith('.txt')) {
          // Store relative path from cwd so it matches what read_file expects
          files.push(path.relative(agentState.cwd, fullPath));
        }
      }
    } catch {
      // Silently skip unreadable dirs
    }
  }

  for (const dir of libraryDirs) {
    await scanDir(dir);
  }

  // Deduplicate
  files = [...new Set(files)];

  // Pre-filter files using light local keyword matcher to find top candidates
  let candidateFiles = [...files];
  const queryTokens = searchQuery.toLowerCase().split(/[^a-zA-Z0-9çığöşüöäüæßàáâäæãåā]+/g).filter(w => w.length > 1);
  const librariesRoot = path.join(agentState.cwd, 'Libraries');
  // Check if user wants to see ALL files (broad queries)
  const showAllKeywords = ['herşey', 'hepsi', 'all', 'everything', 'tümü', 'tüm', 'hepsini', 'hepini', 'liste', 'listele', 'listesi'];
  const isShowAll = showAllKeywords.some(k => searchQuery.toLowerCase().includes(k));

  if (isShowAll) {
    candidateFiles = files;
    broadcastTerminal(`> [LIBRARY PRE-FILTER] 'Tüm dosyaları göster' modu algılandı. ${files.length} dosyanın hepsi LLM'e sunuluyor.\n`);
    addMessage('system', `[LIBRARY PRE-FILTER] Genel/tümünü göster sorgusu tespit edildi. Tüm ${files.length} dosya taranıyor.`);
  } else if (queryTokens.length > 0 && files.length > 0) {
    const scored = await Promise.all(files.map(async relPath => {
      let score = 0;
      const fileLower = relPath.toLowerCase();
      queryTokens.forEach(t => {
        if (fileLower.includes(t)) score += 5;
      });
      try {
        const fullPath = path.join(agentState.cwd, relPath);
        const content = (await fs.promises.readFile(fullPath, 'utf-8')).toLowerCase();
        queryTokens.forEach(t => {
          if (content.includes(t)) {
            const count = (content.split(t).length - 1);
            score += Math.min(count, 5);
          }
        });
      } catch (e) { /* ignore */ }
      return { fileName: relPath, score };
    }));

    const matched = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    if (matched.length > 0) {
      candidateFiles = matched.slice(0, 30).map(s => s.fileName);
      broadcastTerminal(`> [LIBRARY PRE-FILTER] Keyword match: ${files.length} → ${candidateFiles.length} aday dosya bulundu.\n`);
      addMessage('system', `[LIBRARY PRE-FILTER] ${files.length} dosya arasından ${candidateFiles.length} aday filtrelendi.`);
    } else {
      // No keyword match — send ALL files to LLM, not just first 10
      candidateFiles = files;
      broadcastTerminal(`> [LIBRARY PRE-FILTER] Anahtar kelime eşleşmesi yok. Tüm ${candidateFiles.length} dosya LLM'e sunuluyor.\n`);
      addMessage('system', `[LIBRARY PRE-FILTER] Anahtar kelime eşleşmesi bulunamadı. Tüm ${candidateFiles.length} dosya LLM'e gönderiliyor.`);
    }
  } else {
    candidateFiles = files;
  }

  const selectedFiles = [];
  let index = 0;

  // Process candidate files in batches of 30 (usually fits in 1 batch now)
  while (index < candidateFiles.length) {
    const chunk = candidateFiles.slice(index, index + 30);
    index += 30;

    const promptContent = `Kütüphane modundasın. Şu an MemoryLibrary klasöründeki dosyalardan bazılarını incelemelisin.
Görevin ve aradığın bilgi: "${searchQuery}" (Açıklama: "${explanation}").

Aşağıdaki ${chunk.length} adet dosyadan hangilerinin aradığın bilgiyle ilişkili olduğunu dosya isimlerini yazarak seç.
Dosya listesi:
${chunk.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Seçim Formatı:
Sadece seçtiğin dosya isimlerini aralarında virgül olacak şekilde tek bir satırda yaz. (Örn: "abc.md, xyz.md, gfd.md")
Eğer bu listede aradığın bilgiyle ilişkili hiçbir dosya yoksa, sadece "no" veya "hayır" yaz.`;

    let repliedText = '';
    try {
      repliedText = await llmFetch([
        { role: 'system', content: 'You are a precise document selector. Answer exactly according to the requested format.' },
        { role: 'user', content: promptContent }
      ], 0.1, 'Library File Selection');
      repliedText = repliedText.trim();
    } catch (err) {
      console.error("Sub-loop batch fetch failed:", err);
    }

    broadcastTerminal(`> [LIBRARY SELECTION BATCH] Response: "${repliedText}"\n`);
    addMessage('system', `[LIBRARY SELECTION BATCH] Seçilen dosyalar: "${repliedText.replace(/\n/g, ' ')}"`);

    if (repliedText && repliedText.toLowerCase() !== 'no' && repliedText.toLowerCase() !== 'hayır') {
      const chosen = repliedText.split(',').map(s => s.trim()).filter(s => chunk.includes(s));
      selectedFiles.push(...chosen);
      broadcastTerminal(`> Selected files in this batch: ${chosen.join(', ')}\n`);
    }
  }

  const acceptedFiles = [];
  // Present each selected file content to agent
  for (const fileName of selectedFiles) {
    const filePath = path.join(agentState.cwd, fileName);
    let fileContent = '';
    try {
      fileContent = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      continue; // Skip if file disappeared
    }
    const promptCheck = `Seçilen Dosya: "${fileName}"
İçerik:
"""
${fileContent}
"""

Aranan Bilgi: "${searchQuery}"

Bu dosyanın içeriği aradığın bilgi ile eşleşiyor mu ve asıl hafızaya eklenmesini istiyor musun?
Eğer eklenmesini istiyorsan sadece "evet" veya "yes" veya "true" yaz.
İstemiyorsan sadece "hayır" veya "no" veya "false" yaz. Başka hiçbir şey yazma.`;

    let checkReply = '';
    try {
      const raw = await llmFetch([
        { role: 'system', content: 'Answer only yes or no.' },
        { role: 'user', content: promptCheck }
      ], 0.1, 'Library File Verification');
      checkReply = raw.trim().toLowerCase();
    } catch (err) {
      console.error("Content verification fetch failed:", err);
    }

    const isYes = checkReply.includes('evet') || checkReply.includes('yes') || checkReply.includes('true');
    broadcastTerminal(`> Verification for "${fileName}": "${checkReply}" -> ${isYes ? 'ACCEPTED' : 'REJECTED'}\n`);
    addMessage('system', `[LIBRARY VERIFICATION] "${fileName}" incelendi. Sonuç: ${isYes ? 'KABUL EDİLDİ' : 'REDDEDİLDİ'} ("${checkReply}")`);

    if (isYes) {
      acceptedFiles.push({ name: fileName, content: fileContent });
    }
  }

  // Restore original history
  agentState.messages = originalMessages;

  // Append results summary to history
  let returnMsg = '';
  if (acceptedFiles.length > 0) {
    let contextMsg = `[System Context: Info]\nEn son library moduna girdin ve bu dosyaları elde ettin:\n`;
    acceptedFiles.forEach(file => {
      contextMsg += `- Dosya: "${file.name}" | İçerik:\n"""\n${file.content}\n"""\n\n`;
    });
    addMessage('system', contextMsg);
    returnMsg = contextMsg;
  } else {
    let contextMsg = `[System Context: Info]\nEn son library moduna girdin ancak aradığın kritere uyan hiçbir bilgi elde edemedin.`;
    addMessage('system', contextMsg);
    returnMsg = contextMsg;
  }

  broadcastTerminal(`\n*** [LIBRARY MODE SUB-LOOP] Finished. Restoring original context... ***\n`);
  broadcastState();
  return returnMsg;
}

const SGM_MAX_STEPS = 15;

async function sgmHealthCheck(prompt, summaries, stepCount) {
  const { broadcastTerminal } = require('../state');
  broadcastTerminal(`> [SGM HEALTH CHECK] ${stepCount} adim tamamlandi. Gorev durumu kontrol ediliyor...\n`);
  const checkPrompt = `Sen bir gorev denetcisisin. Bir ajan asagidaki kullanici istegini yerine getirmeye calisiyor ve ${stepCount} adim atti.\n\nKullanici Istegi: "${prompt}"\n\nSimdiye kadar yapilanlar (ozet gecmis):\n${summaries.join('\n')}\n\nAnaliz Et:\n1. Kullanicinin istegi tam olarak karsilandi mi?\n2. Ajan takildi veya donguye girdi mi?\n3. Bir hata ya da tutarsizlik var mi?\n\nKarar ver. SADECE asagidaki JSON formatinda cevap ver:\n{\n  "karar": "DEVAM_ET" | "BITIR" | "HATA",\n  "neden": "Kararin kisa gerekcesi (1-2 cumle)",\n  "tavsiye": "DEVAM_ET ise ajana siradaki adim icin ipucu ver. BITIR ise ne tamamlandigini yaz. HATA ise kullaniciya bildirilecek mesaji yaz."\n}`;
  try {
    const res = await llmFetch([{ role: 'system', content: 'You respond with valid JSON.' }, { role: 'user', content: checkPrompt }], 0.2, 'SGM Health Check');
    return JSON.parse(cleanMalformedJsonString(res));
  } catch(e) {
    return { karar: 'DEVAM_ET', neden: 'Saglik kontrolu basarisiz, devam ediliyor.', tavsiye: '' };
  }
}

async function processLibraryTaskSGM(prompt, subMode) {
  const { config, agentState, broadcastTerminal, addMessage, broadcastState } = require('../state');
  addMessage('user', prompt);
  broadcastTerminal(`\n> [SGM MANAGER] Starting Sequential Task Mode...\n`);

  const libraryDir = path.join(agentState.cwd, 'Libraries', 'MemoryLibrary');
  if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });

  let existingCategories = [];
  try {
    existingCategories = fs.readdirSync(libraryDir).filter(f => fs.statSync(path.join(libraryDir, f)).isDirectory());
  } catch(e) {}

  let allFiles = [];
  if (config.esYabanciMode) {
    try {
      for (const cat of existingCategories) {
        const catPath = path.join(libraryDir, cat);
        const files = fs.readdirSync(catPath).filter(f => f.endsWith('.json'));
        files.forEach(f => allFiles.push(`${cat}/${f}`));
      }
    } catch(e) {}
  }

  broadcastTerminal(`> [ENTITY ROUTER] Kullanıcı metni analiz ediliyor...\n`);
  let entities = [];
  try {
    const routerPrompt = `Kullanıcının aşağıdaki isteğini analiz et. İstekte kaç farklı "Kişi", "Kurum" veya "Bağımsız Olay/Konu" geçiyor?
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
Kullanıcı İsteği: "${prompt}"`;
    const routerRes = await llmFetch([{ role: 'system', content: 'You respond with valid JSON.' }, { role: 'user', content: routerPrompt }], 0.1, 'Entity Router');
    const parsed = JSON.parse(cleanMalformedJsonString(routerRes));
    if (parsed.entities && Array.isArray(parsed.entities)) {
      entities = parsed.entities;
    }
  } catch(e) {
    entities = [{ name: 'Genel', instruction: prompt }];
  }

  if (entities.length === 0) entities = [{ name: 'Genel', instruction: prompt }];
  broadcastTerminal(`> [ENTITY ROUTER] Toplam ${entities.length} farklı varlık/görev tespit edildi.\n`);
  
  let globalSummaries = [];

  for (let eIdx = 0; eIdx < entities.length; eIdx++) {
    const entity = entities[eIdx];
    broadcastTerminal(`\n> [SGM LOOP] Görev ${eIdx + 1}/${entities.length}: Varlık -> ${entity.name}\n`);
    
    let summaries = [];
    let fileContents = {};
    let isFinished = false;
    let stepCount = 0;
    const currentPrompt = entity.instruction;

    while (!isFinished) {
      if (stepCount > 0 && stepCount % SGM_MAX_STEPS === 0) {
        broadcastTerminal(`> [SGM] Max adım sınırı (${SGM_MAX_STEPS}) aşıldı. Sağlık kontrolü yapılıyor...\n`);
        const health = await sgmHealthCheck(currentPrompt, summaries, stepCount);
        log('SGM_HEALTH_CHECK', JSON.stringify(health));

        if (health.karar === 'DEVAM_ET') {
          if (health.tavsiye) summaries.push(`[DENETÇİ TAVSİYESİ]: ${health.tavsiye}`);
        } else {
          isFinished = true;
          break;
        }
      }

      let filesContext = config.esYabanciMode ? `\nMevcut Dosyalar: ${allFiles.join(', ')}` : '';
      let summariesContext = summaries.length > 0 ? `\n\nGeçmiş İşlemlerin:\n${summaries.join('\n')}` : '\n\nHenüz işlem yapmadın.';
      let fileContentsContext = Object.keys(fileContents).length > 0
        ? `\n\nOkunan Dosya İçerikleri:\n${Object.entries(fileContents).map(([k, v]) => `[${k}]:\n${v}`).join('\n---\n')}`
        : '';

      let sysPrompt = `Sen SGM (Sıralı Görev Modu) ajanı olarak Kütüphane Yöneticisisin.
Görevin, kullanıcının isteklerini yerine getirmektir. Kişiler için 'Persons', genel bilgiler/olaylar için 'EveryData' kategorisini kullan.${filesContext}

Kullanıcı İstek (Odak: ${entity.name}): "${currentPrompt}"${summariesContext}${fileContentsContext}

Ne yapmak istiyorsun? SADECE JSON formatında cevap ver:
{
  "tool": "ADD_DATA" | "EDIT_DATA" | "READ_FILE" | "ASK_USER",
  "category": "Persons veya EveryData",
  "filename": "Dosya adı uzantısız (Örn: ${entity.name.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/g, '_')})",
  "data_to_add": "BU DOSYA/KİŞİ için eklenecek KAPSAMLI BİLGİ",
  "edit_instruction": "BU DOSYA/KİŞİ için düzenleme talimatı",
  "question": "Kullanıcıya soru"
}`;

      let llmRes = await llmFetch([
        { role: 'system', content: 'You respond with valid JSON.' },
        { role: 'user', content: sysPrompt }
      ], 0.1, 'SGM Library Loop');

      try {
        let parsed = JSON.parse(cleanMalformedJsonString(llmRes));
        const safeFilename = parsed.filename || entity.name.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/g, '_');
        let actionStr = `komut:(${parsed.tool})`;
        summaries.push(actionStr);
        broadcastTerminal(`> [SGM] Tool: ${parsed.tool}\n`);
        log('SGM_ACTION', actionStr);
        stepCount++;

        const validTools = ['ADD_DATA', 'EDIT_DATA', 'READ_FILE', 'ASK_USER'];
        if (!validTools.includes(parsed.tool)) {
          summaries.push(`[UYARI]: Bilinmeyen araç "${parsed.tool}" denendi, atlandı.`);
          continue;
        }

        if (parsed.tool === 'ADD_DATA' || parsed.tool === 'EDIT_DATA') {
          const catDir = path.join(libraryDir, parsed.category || 'Genel');
          if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
          
          let safePromptForUpsert = `[KULLANICININ ORİJİNAL İSTEĞİ (Tamamı)]:\n${prompt}\n\n[BU DOSYA/VARLIK (${entity.name}) İÇİN ODAK BİLGİ]:\n${parsed.data_to_add || parsed.edit_instruction || currentPrompt}`;
          
          const addResult = await runLibraryAddSubLoop(catDir, safeFilename, safePromptForUpsert);
          summaries.push(`Sonuç: ${addResult}`);
          isFinished = true; // FORCE BREAK!
          break;
        } else if (parsed.tool === 'READ_FILE') {
          const fn = safeFilename.endsWith('.json') ? safeFilename : `${safeFilename}.json`;
          const filePath = path.join(libraryDir, parsed.category || 'Genel', fn);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            fileContents[safeFilename] = content.substring(0, 1200);
            summaries.push(`READ_FILE Başarılı: ${safeFilename}`);
          } else {
            summaries.push(`[HATA]: Dosya bulunamadı (${safeFilename})`);
          }
        } else if (parsed.tool === 'ASK_USER') {
          addMessage('assistant', parsed.question || 'Bana yardımcı olabilir misiniz?');
          agentState.status = 'library_ask_user';
          broadcastState();
          const answer = await new Promise(resolve => { global.libraryAskResolver = resolve; });
          agentState.status = 'running';
          broadcastState();
          summaries.push(`Kullanıcı Cevabı: ${answer}`);
        }
      } catch(e) {
        summaries.push(`[SİSTEM UYARISI]: JSON hatası (${e.message}).`);
      }
    }
    globalSummaries.push(`- ${entity.name}: Tamamlandı.`);
  }

  agentState.status = 'completed';
  broadcastState();
  addMessage('assistant', `Tüm SGM Görevleri başarıyla tamamlandı.\n${globalSummaries.join('\n')}`);
  return 'SGM Tasks completed.';
}

async function processLibraryTask(prompt, subMode) {
  const { config, agentState, broadcastTerminal, addMessage } = require('../state');
  
  if (config.sgmMode) {
    return await processLibraryTaskSGM(prompt, subMode);
  }

  addMessage('user', prompt);
  broadcastTerminal(`\n> [LIBRARY MANAGER] Processing task...\n`);

  let intent = 'ADD';
  let category = '';
  let filename = '';

  const libraryDir = path.join(agentState.cwd, 'Libraries', 'MemoryLibrary');
  if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });

  let existingCategories = [];
  try {
    existingCategories = fs.readdirSync(libraryDir).filter(f => fs.statSync(path.join(libraryDir, f)).isDirectory());
  } catch(e) {}

  if (subMode && subMode.startsWith('new_')) {
    intent = 'ADD';
    category = subMode.replace('new_', '');
  } else if (subMode && subMode.startsWith('edit_')) {
    intent = 'EDIT';
    category = subMode.replace('edit_', '');
    const match = prompt.match(/@([\w.-]+)/);
    if (match) filename = match[1];
  } else {
    broadcastTerminal(`> [LIBRARY MANAGER] Auto-classifying intent...\n`);
    const sysPrompt = `Sen bir kütüphane asistanısın. Kullanıcının isteğini analiz et ve JSON formatında şu bilgileri dön:
- "intent": "ADD" veya "EDIT"
- "category": Hangi kategoriye ait? (Mevcutlar: ${existingCategories.join(', ')}. Uygun yoksa yeni bir isim uydur)
- "filename": Eğer EDIT ise veya ADD için bir isim verilmişse, dosya adını (uzantısız) yaz. @ ile belirtilmişse onu kullan. Yoksa boş bırak.
Sadece geçerli JSON dön.`;
    
    try {
      const llmRes = await llmFetch([
        { role: 'system', content: 'You respond with valid JSON.' },
        { role: 'user', content: sysPrompt + "\n\nİstek: " + prompt }
      ], 0.1, 'Library Intent Routing');
      
      const parsed = JSON.parse(cleanMalformedJsonString(llmRes));
      if (parsed.intent) intent = parsed.intent;
      if (parsed.category) category = parsed.category;
      if (parsed.filename) filename = parsed.filename;
    } catch(e) {
      console.error("Auto-classification failed", e);
    }
  }

  if (!category) category = 'Genel';
  if (filename.endsWith('.json')) filename = filename.replace('.json', '');
  if (filename.endsWith('.md')) filename = filename.replace('.md', '');

  const catDir = path.join(libraryDir, category);
  if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });

  if (intent === 'ADD') {
    await runLibraryAddSubLoop(catDir, filename, prompt);
  } else {
    if (!filename) {
      broadcastTerminal(`> [LIBRARY MANAGER] Dosya adı (@dosya_adi) bulunamadı. İşlem iptal edildi.\n`);
      addMessage('system', 'Hata: Düzenlenecek dosya adı belirtilmedi.');
      return;
    }
    const fn = filename.endsWith('.json') ? filename : `${filename}.json`;
    const filePath = path.join(catDir, fn);
    if (fs.existsSync(filePath) && filePath.endsWith('.json')) {
      await runLibraryAddSubLoop(catDir, filename, prompt);
    } else {
      await runLibraryEditSubLoop(filePath, prompt);
    }
  }
}

async function runLibraryAddSubLoop(catDir, providedFilename, prompt) {
  const { broadcastTerminal, addMessage, agentState } = require('../state');
  broadcastTerminal(`> [LIBRARY MANAGER] Running ADD/UPSERT sequence\n`);
  
  let sysPrompt = "";
  const isEveryData = catDir.includes('EveryData');

  let existingData = null;
  let existingDataStr = "";
  if (providedFilename) {
    const checkPath = path.join(catDir, `${providedFilename}.json`);
    if (fs.existsSync(checkPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(checkPath, 'utf-8'));
        existingDataStr = JSON.stringify(existingData, null, 2);
        broadcastTerminal(`> [LIBRARY MANAGER] Mevcut dosya bulundu (${providedFilename}.json). UPSERT (Birleştirme) moduna geçiliyor.\n`);
      } catch(e) {}
    }
  }

  if (isEveryData) {
    // --- Öneri B: İki aşamalı EveryData şema üretimi ---
    broadcastTerminal(`> [LIBRARY MANAGER] EveryData: Step 1 - Temel bilgiler çekiliyor...\n`);
    const step1Prompt = existingData 
      ? `Sen bir veri güncelleyicisisin. Aşağıdaki mevcut JSON verisini, kullanıcının yeni isteği ile BİRLEŞTİR (Upsert). ESKİ BİLGİLERİ KESİNLİKLE SİLME. Yalnızca yeni bilgileri ekle veya güncelle. SADECE aşağıdaki JSON formatında çıktı ver:
{
  "kimlerle_neylerle_iliskilendigi": ["user", "ilgili kişi veya nesne"],
  "yetkilileri": ["user"],
  "konu_basligi": "konunun kısa başlığı",
  "alt_konular": ["konu1", "konu2"],
  "konu_ozeti": "olayın tek cümlelik özeti",
  "cikartilabilicek_bilgiler": ["çıkarım 1", "çıkarım 2"]
}`
      : `Sen bir veri dönüştürücüsün. Kullanıcının verdiği genel bilgi metnini analiz et ve SADECE aşağıdaki JSON şemasında çıktı ver:
{
  "kimlerle_neylerle_iliskilendigi": ["user", "ilgili kişi veya nesne"],
  "yetkilileri": ["user"],
  "konu_basligi": "konunun kısa başlığı",
  "alt_konular": ["konu1", "konu2"],
  "konu_ozeti": "olayın tek cümlelik özeti",
  "cikartilabilicek_bilgiler": ["çıkarım 1", "çıkarım 2"]
}
Eğer bir bilgi yoksa boş string veya boş array bırak.`;

    let safeContent = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);
    if (existingDataStr) safeContent = `[MEVCUT VERİ]:\n${existingDataStr}\n\n[YENİ İSTEK]:\n${safeContent}`;

    let step1Result = {};
    try {
      const step1Res = await llmFetch([
        { role: 'system', content: 'You respond with valid JSON.' },
        { role: 'user', content: step1Prompt + '\n\nİstek/Metin: ' + safeContent }
      ], 0.1, 'EveryData Step1');
      step1Result = JSON.parse(cleanMalformedJsonString(step1Res));
    } catch(e) {
      console.error('EveryData Step1 failed:', e.message);
      addMessage('system', 'Hata: EveryData temel bilgiler çekilemedi.');
      return 'Hata: EveryData temel bilgiler çekilemedi.';
    }

    // Step 2: her alt_konu için ayrı özet üret
    broadcastTerminal(`> [LIBRARY MANAGER] EveryData: Step 2 - Alt konular işleniyor...\n`);
    const altKonular = Array.isArray(step1Result.alt_konular) ? step1Result.alt_konular : [];
    const altKonuOzetleri = {};
    for (const konu of altKonular) {
      if (!konu) continue;
      try {
        const konuRes = await llmFetch([
          { role: 'user', content: `Aşağıdaki metin bağlamında "${konu}" hakkında 1-2 cümlelik kısa bir özet yaz. Sadece özeti yaz, başka hiçbir şey yazma.\n\nMetin: ${safeContent}` }
        ], 0.1, `EveryData SubTopic: ${konu}`);
        altKonuOzetleri[konu] = konuRes.trim();
      } catch(e) {
        altKonuOzetleri[konu] = '';
      }
    }

    // Sonuçları birleştir
    let jsonResult = {
      ...step1Result,
      ...altKonuOzetleri
    };
    
    // Prompt History Injection
    jsonResult._prompt_history = existingData && Array.isArray(existingData._prompt_history) ? existingData._prompt_history : [];
    jsonResult._prompt_history.push({ date: new Date().toISOString(), prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) });

    // Dosya adı
    let finalFilename = providedFilename;
    if (!finalFilename && jsonResult.konu_basligi) {
      finalFilename = jsonResult.konu_basligi.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/g, '_').substring(0, 50);
    }
    if (!finalFilename) finalFilename = `everydata_${Date.now()}`;

    const filepath = path.join(catDir, `${finalFilename}.json`);
    await fs.promises.writeFile(filepath, JSON.stringify(jsonResult, null, 2));
    broadcastTerminal(`> [LIBRARY MANAGER] Saved EveryData JSON to ${filepath}\n`);
    
    broadcastTerminal(`> [KEYWORD] Keyword üretiliyor...\n`);
    const relPath = path.relative(path.join(agentState.cwd, 'Libraries', 'MemoryLibrary'), filepath);
    const { updateFileKeywords } = require('../lib/keywordIndex');
    await updateFileKeywords(agentState.cwd, relPath, JSON.stringify(jsonResult, null, 2));
    broadcastTerminal(`> [KEYWORD] Index güncellendi.\n`);

    addMessage('system', `Başarılı: EveryData verisi eklendi/güncellendi (${path.basename(filepath)}).`);
    return `Başarılı: ${path.basename(filepath)} eklendi/güncellendi.`;
  } else {
    
    const schema = `{
  "ad_soyad": "",
  "kullanici_adlari": [],
  "yasi": "",
  "kilosu": "",
  "boyu": "",
  "ozellikleri": [],
  "yetenekleri": [],
  "hobileri": [],
  "fobileri": [],
  "sevdikleri": [],
  "sevmedikleri": [],
  "arkadaslari_dostlari": [],
  "ailesi": [],
  "iletisim_bilgileri": [],
  "diger_bilgiler": [],
  "birlikte_gecirilen_vakit": "",
  "etkinlik_gecmisi": []
}`;

    if (existingData) {
      sysPrompt = `Sen bir veri GÜNCELLEYİCİSİSİN. Aşağıdaki [MEVCUT VERİ] içeriğiyle, [YENİ İSTEK] içeriğini BİRLEŞTİR.
MEVCUT BİLGİLERİ ASLA SİLME, KAYBETME VEYA ÜZERİNE YAZIP YOK ETME! Yalnızca yeni isteği mantıklı şekilde mevcut verilere ekle. Sadece istekte bahsedilen verileri ekle, geri kalan boş alanlara uydurma veri DOLDURMA!
Aşağıdaki JSON formatında çıktı ver:
${schema}`;
    } else {
      sysPrompt = `Sen bir veri dönüştürücüsün. Kullanıcının verdiği metni aşağıdaki JSON şemasına uygun olarak ayrıştır ve SADECE JSON formatında çıktı ver.
Eğer bir bilgi istekte geçmiyorsa KESİNLİKLE boş string "" veya boş array [] bırak. Asla sahte veri, örnek metin veya rastgele bir tarih uydurma!
${schema}`;
    }
  }

  let safePromptContent = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);
  if (existingDataStr && !isEveryData) {
    safePromptContent = `[MEVCUT VERİ]:\n${existingDataStr}\n\n[YENİ İSTEK]:\n${safePromptContent}`;
  }

  broadcastTerminal(`> [UPSERT] JSON verisi üretiliyor (Single-Shot)...\n`);
  
  let jsonResult = null;
  try {
    const llmRes = await llmFetch([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: safePromptContent }
    ], 0.1, 'Library Upsert (Single Generation)'); 
    jsonResult = JSON.parse(cleanMalformedJsonString(llmRes));
    broadcastTerminal(`> [UPSERT] Üretim başarılı!\n`);
  } catch (e) {
    console.error(`Upsert parse failed:`, e.message);
    broadcastTerminal(`> [UPSERT] Üretim hatası: ${e.message}\n`);
    addMessage('system', 'Hata: JSON üretimi formatlanamadı (Syntax Error).');
    return 'Hata: JSON formatlanamadı.';
  }

  // Prompt History Injection for non-EveryData branch
  if (!isEveryData) {
    jsonResult._prompt_history = existingData && Array.isArray(existingData._prompt_history) ? existingData._prompt_history : [];
    jsonResult._prompt_history.push({ date: new Date().toISOString(), prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) });
    
    // Automatically summarize history if it gets too long
    if (jsonResult._prompt_history.length > 5) {
      broadcastTerminal(`> [LIBRARY MANAGER] Prompt geçmişi uzun, özetleniyor...\n`);
      const historyStr = jsonResult._prompt_history.map((h, i) => `${i+1}. ${h.date}: ${h.prompt}`).join('\\n');
      try {
        const sumRes = await llmFetch([
          { role: 'user', content: `Aşağıdaki kişi/veri hakkında daha önce verilmiş komutların (prompt) geçmişini okuyun ve tek, geniş kapsamlı bir özet paragrafı yazın. SADECE ÖZETİ YAZIN.\n\nGeçmiş:\n${historyStr}` }
        ], 0.2, 'History Summarizer');
        jsonResult._prompt_summary = (jsonResult._prompt_summary ? jsonResult._prompt_summary + "\\n" : "") + sumRes.trim();
        jsonResult._prompt_history = [{ date: new Date().toISOString(), prompt: "Önceki geçmiş başarıyla özetlendi." }];
      } catch (e) {
        broadcastTerminal(`> [LIBRARY MANAGER] Özetleme başarısız oldu, geçmiş korunuyor.\n`);
      }
    }
  }

  let finalFilename = '';
  let nameParts = [];
  
  if (isEveryData && jsonResult.konu_basligi) {
    nameParts.push(jsonResult.konu_basligi.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/g, '_'));
  } else {
    if (jsonResult.ad_soyad) nameParts.push(jsonResult.ad_soyad.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/g, '_'));
    else if (jsonResult.kullanici_adlari && Array.isArray(jsonResult.kullanici_adlari) && jsonResult.kullanici_adlari.length > 0) {
      if (jsonResult.kullanici_adlari[0]) {
        nameParts.push(jsonResult.kullanici_adlari[0].replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/g, '_'));
      }
    }
  }

  if (nameParts.length > 0) {
    finalFilename = nameParts.join('_').substring(0, 50); // limit length
  } else {
    finalFilename = providedFilename || `kayit_${Date.now()}`;
  }

  const filepath = path.join(catDir, `${finalFilename}.json`);
  await fs.promises.writeFile(filepath, JSON.stringify(jsonResult, null, 2));
  broadcastTerminal(`> [LIBRARY MANAGER] Saved JSON to ${filepath}\n`);
  
  broadcastTerminal(`> [KEYWORD] Keyword üretiliyor...\n`);
  const relPath = path.relative(path.join(agentState.cwd, 'Libraries', 'MemoryLibrary'), filepath);
  const { updateFileKeywords } = require('../lib/keywordIndex');
  await updateFileKeywords(agentState.cwd, relPath, JSON.stringify(jsonResult, null, 2));
  broadcastTerminal(`> [KEYWORD] Index güncellendi.\n`);

  addMessage('system', `Başarılı: Yeni veri eklendi (${path.basename(filepath)}).`);
  return `Başarılı: ${path.basename(filepath)} eklendi.`;
}

async function runLibraryEditSubLoop(filepath, prompt) {
  const { broadcastTerminal, addMessage } = require('../state');
  broadcastTerminal(`> [LIBRARY MANAGER] Running EDIT sequence for ${filepath}\n`);
  let safePrompt = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);

  if (!fs.existsSync(filepath)) {
    addMessage('system', `Hata: ${path.basename(filepath)} bulunamadı.`);
    return `Hata: Dosya bulunamadı.`;
  }

  const isMd = filepath.endsWith('.md');
  let data = isMd ? '' : {};

  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    if (isMd) {
      data = raw;
    } else {
      data = JSON.parse(raw);
    }
  } catch(e) {
    addMessage('system', `Hata: Dosya okunamadı — ${path.basename(filepath)} (desteklenen: .json, .md)`);
    return;
  }

  // --- Markdown edit path ---
  if (isMd) {
    broadcastTerminal(`> [LIBRARY MANAGER] Editing markdown: ${path.basename(filepath)}\n`);
    const mdSys = `Kullanıcının isteğine göre aşağıdaki Markdown belgesini düzenle.
İstek: "${prompt}"

Mevcut içerik:
---
${data}
---

Güncellenmiş Markdown belgesinin TAM içeriğini döndür. Hiçbir açıklama ekleme.`;
    try {
      const edited = await llmFetch([{ role: 'user', content: mdSys }], 0.3, 'Library Markdown Edit');
      await fs.promises.writeFile(filepath, edited.trim(), 'utf-8');
      broadcastTerminal(`> [LIBRARY MANAGER] Saved updated markdown to ${filepath}\n`);
      addMessage('system', `Başarılı: Markdown dosyası güncellendi (${path.basename(filepath)}).`);
    } catch(e) {
      addMessage('system', `Hata: Markdown düzenlenirken sorun oluştu — ${e.message}`);
    }
    return;
  }

  // --- JSON edit path (original behavior) ---
  for (const key of Object.keys(data)) {
    const val = data[key];
    
    if (Array.isArray(val)) {
      const newArray = [];
      for (const item of val) {
        broadcastTerminal(`> [LIBRARY CHUNK] Checking array item: "${item}" in "${key}"\n`);
        const sys = `Kullanıcının isteğine göre mevcut verinin silinip silinmemesine veya değiştirilmesine karar ver. 
İstek: "${safePrompt}"
Mevcut Veri: "${item}"

Eğer bu verinin silinmesi gerekiyorsa sadece "DELETE" yaz.
Eğer hiç değişmemesi gerekiyorsa sadece "KEEP" yaz.
Eğer verinin güncellenmesi/düzeltilmesi gerekiyorsa sadece YENI METNI yaz.`;
        try {
          const llmRes = await llmFetch([{role: 'user', content: sys}], 0.1, 'Library Chunk Edit');
          const trimmed = llmRes.trim();
          if (trimmed === 'DELETE') {
            // Drop it
          } else if (trimmed === 'KEEP') {
            newArray.push(item);
          } else {
            newArray.push(trimmed);
          }
        } catch(e) {
          newArray.push(item);
        }
      }
      
      broadcastTerminal(`> [LIBRARY CHUNK] Checking for additions in "${key}"\n`);
      const sysAdd = `Kullanıcının isteği: "${safePrompt}"
Bu isteğe göre "${key}" kategorisine YENİ bir veya daha fazla madde eklenmesi gerekiyor mu?
Eğer gerekmiyorsa sadece "NONE" yaz.
Eğer eklenmesi gerekiyorsa, yeni maddeleri aralarına "|" işareti koyarak yaz. (Örnek: Madde 1|Madde 2)`;
      try {
        const llmRes2 = await llmFetch([{role: 'user', content: sysAdd}], 0.1, 'Library Chunk Add');
        const trimmed2 = llmRes2.trim();
        if (trimmed2 !== 'NONE' && !trimmed2.includes('NONE')) {
          const parts = trimmed2.split('|').map(s => s.trim()).filter(s => s);
          newArray.push(...parts);
        }
      } catch(e) {}
      
      data[key] = newArray;

    } else {
      broadcastTerminal(`> [LIBRARY CHUNK] Checking string field: "${key}"\n`);
      const sys = `Kullanıcının isteğine göre mevcut alanın güncellenmesi gerekip gerekmediğine karar ver.
İstek: "${safePrompt}"
Mevcut Alan: "${key}" = "${val}"

Eğer bu verinin silinmesi gerekiyorsa sadece "DELETE" yaz.
Eğer hiç değişmemesi gerekiyorsa sadece "KEEP" yaz.
Eğer güncellenmesi gerekiyorsa sadece YENI METNI yaz.`;
      try {
        const llmRes = await llmFetch([{role: 'user', content: sys}], 0.1, 'Library Chunk Edit String');
        const trimmed = llmRes.trim();
        if (trimmed === 'DELETE') {
          data[key] = "";
        } else if (trimmed === 'KEEP') {
          // do nothing
        } else {
          data[key] = trimmed;
        }
      } catch(e) {}
    }
  }

  const { agentState } = require('../state');
  await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2));
  broadcastTerminal(`> [LIBRARY MANAGER] Saved updated JSON to ${filepath}\n`);

  broadcastTerminal(`> [KEYWORD] Keyword üretiliyor...\n`);
  const relPath = path.relative(path.join(agentState.cwd, 'Libraries', 'MemoryLibrary'), filepath);
  const { updateFileKeywords } = require('../lib/keywordIndex');
  await updateFileKeywords(agentState.cwd, relPath, JSON.stringify(data, null, 2));
  broadcastTerminal(`> [KEYWORD] Index güncellendi.\n`);

  addMessage('system', `Başarılı: Veri güncellendi (${path.basename(filepath)}).`);
  return `Başarılı: ${path.basename(filepath)} güncellendi.`;
}


module.exports = { runLibraryModeSubLoop, processLibraryTask, resolveLibraryAsk };
