# Stellarigent — Genel Proje Bilgisi ve Kapsamlı Mimari Haritası

> **Son Güncelleme:** 2026-09-24  
> **Kapsam:** Tüm sistem mimarisi, modüller, fonksiyonlar, 22 araç, algoritmalar, güvenlik katmanları, UI bileşenleri, API uç noktaları, CLI kontrolcüsü, test/eval paketleri ve varlık haritası.

Bu doküman, **Stellarigent** (%100 yerel, otonom yapay zeka bilgisayar kullanım ajanı) projesinin en güncel mimarisini, tüm özelliklerini, algoritma mantıklarını, dosya ve dizin haritalarını eksiksiz olarak detaylandırır. Token tüketimini minimize etmek ve projeyi tek bir dosyada kavramak için temel başvuru kılavuzudur.

---

## 1. Dizin ve Dosya Mimarisi

### Kök Dizin (Root)
- **`server.js`**: Uygulamanın birincil giriş noktası. Express.js tabanlı HTTP REST sunucusu ile WebSocket (`ws`) sunucusunu barındırır. Sistem CPU/RAM metriklerini periyodik olarak yayınlar, statik frontend dosyalarını servis eder ve WebSocket mesajlarını yönlendirir. Sistem sağlık kontrolü için `GET /api/health`, ilk kurulum için `GET /api/setup/status`, `POST /api/setup/complete`, `POST /api/setup/reset`, model etiketleri için `POST /api/model-tags`, checkpoint özeti için `GET /api/checkpoint/summary` ve güvenlik tripwire kilidini sıfırlamak için `POST /api/security/reset-tripwire` uç noktalarını sunar.
- **`package.json`**: Projenin Node.js bağımlılıklarını (`express`, `ws`, `discord.js`, `puppeteer`, `axios`, `cheerio`, `pdf-parse`, `monaco-editor`, `@discordjs/voice`, `prism-media` vb.) ve çalıştırma betiklerini (`npm start`, `npm run start:ide`, `npm test`, `npm run test:system`, `npm run eval`, `npm run eval:trend`) tanımlar.
- **`README.md`**: Projenin Türkçe ve İngilizce çift dilli kapsamlı tanıtım, deterministik eval benchmark raporu, kurulum, yapılandırma, 22 araç envanteri, CLI komutları ve kullanım kılavuzudur.
- **`LICENSE`**: Açık kaynak MIT Lisans belgesi.
- **`agent_readme.md`**: Ajan tarafından görev tamamlandığında (`task_complete`) otomatik güncellenen çalışma alanı dosya haritası ve başarı geçmişi günlüğü.
- **`agent_user.json`**: Sistem güvenlik tripwire devresi yem/tuzak dosyası.
- **`evals/`**: Deterministik değerlendirme, benchmark ve regresyon alt sistemi:
  - `run_evals.js`: Test koşucu ve markdown/JSON rapor oluşturucu (`npm run eval`).
  - `scenarios.js`: 5 kritik alanda (Parser, Sandboxing, Tripwire, Bütçe/Maliyet, Bellek Kırpma) 13 deterministik test senaryosu.
  - `system_regression_suite.js`: 9 temel alt sistemi (5-Kademeli Ayrıştırıcı, Güvenlik ve Egress Kalkanı, Tripwire Devresi, Metrikler, Bellek Budama, Konteyner Sahneleme, SGM Kütüphane Modu, Yerel Araştırma, Terminal CLI) kapsayan 17 test adımlı Master Sistem Regresyon Paketi (`npm run test:system`).
  - `trend_report.js`: Tarihsel benchmark sonuçlarını karşılaştıran ve pass-rate değişim trendini raporlayan analiz aracı (`npm run eval:trend`, `npm run eval:trend:last5`).
  - `test_library_12_persons.js`: 12 kişilik karmaşık profilleme, şema bütünlüğü, hobi varlık/yokluk mantığı ve çok kriterli alt döngü arama testi.
  - `test_local_research.js`: 3 zorluk kademesinde (Basit, Zor, Zor+Karmaşık) 100% offline yerel belge araştırma doğrulama testi.
  - `latest_eval_report.md` & `eval_results.json`: En son benchmark yürütme sonuçları (13/13 Başarılı, %100).
- **`Dockerfile` & `docker-compose.yml`**: Uygulamanın Chromium ve Node.js bağımlılıklarıyla tamamen izole Docker konteyneri içerisinde çalışmasını sağlayan konteyner yapılandırması.
- **`.env` / `.env.example`**: Hassas ortam değişkenleri (`PORT`, `DISCORD_TOKEN`, `FOUNDER_DISCORD_ID`, `FOUNDER_KEY`).
- **`scratch/` & `By_Agent/`**: Ajanın tam yazma, silme ve komut yürütme yetkisine sahip olduğu yalıtılmış çalışma alanları. `scratch/checkpoints/checkpoint_latest.json` burada tutulur.

---

### Yapılandırma ve Veri Deposu (`config/`)
- **`config/config.json`**: Dinamik sistem yapılandırması:
  - Yönetici ID'leri (`admins`), bağlantı hız limiti (`connectionSpeedLimit`), panel giriş şifresi (`founderKey`), günlük bulut bütçe limiti (`maxDailyCostUSD` = $1.00).
  - Çalışma modları (`lpmMode`, `lpmBatchSize`, `lpmOmMode`, `forceTaskPlan`, `simbaEnabled`, `sgmMode`, `esYabanciMode`).
  - Bulut yedeklilik öncelik zinciri (`apiFallbacks`: OpenAI, Anthropic, Gemini, Groq).
  - Model iş yükü etiketleri (`modelTags`: Hızlı, Orta, Yüklü).
  - Araç bazlı model profilleri (`toolModelConfig`).
  - Model değiştirme (`modelSwitchingEnabled`), yerel model merdiveni (`modelLadder`) ve model bazlı otomatik mod profilleri (`modelModeProfiles`).
- **`config/security_rules.json`**: Güvenlik ve kısıtlamalar:
  - Yasaklı kelimeler (`bannedWords`), yasaklı web siteleri (`bannedWebsites`), izin verilen temel çalışma dizinleri (`allowedBaseFolders`: `scratch`, `By_Agent`), tripwire dosyaları (`agent_user.json`).
- **`config/kurucu.json`**: Kurucu Discord kullanıcı ID'sini barındırır.
- **`config/permissions.json`**: Discord bot komutlarını kullanmaya yetkili kullanıcıların etiket listesi (`authorizedUsers`).
- **`config/memory.json`**: Görev geçmişi, LM Studio vektörel semantik embedding veritabanı ve onay bekleyen güvenlik kuralları deposu (`{ memories: [...], pendingRules: [...] }`).
- **`config/setup.json`**: İlk açılış kurulum sihirbazının tamamlanma durumu (`isSetupCompleted: true/false`).
- **`config/system_prompts.json` & `config/system_prompt.txt`**: 16 farklı sistem ve mikro-promptun metinleri.

---

## 2. Araçlar Kataloğu (22 Araç)

Sistem `src/tools/index.js` üzerinden 22 aracı dinamik olarak yürütür:
1. **`execute_command`** (`system.js`): PowerShell / Bash kabuk komutunu temizlenmiş ortamda (`getSanitizedEnv`) ve egress sızdırma kalkanıyla çalıştırır.
2. **`open_application`** (`system.js`): İşletim sisteminde masaüstü uygulamasını veya dosyasını başlatır.
3. **`web_search`** (`web.js`): DuckDuckGo / Yahoo üzerinden arama yapar.
4. **`view_website`** (`web.js`): Web sayfasını Puppeteer veya Axios ile kazır ve `webSanitizer` ile temizler.
5. **`deep_web_search`** (`web.js`): Çoklu web araması yapar, her sayfayı `llmFetch` ile özetler ve kaynaklı master rapor üretir.
6. **`read_file`** (`filesystem.js`): Yerel dosya içeriğini okur (Korumalı çekirdek dosyalar hariç).
7. **`read_pdf`** (`pdfReader.js`): PDF belgelerinden metin çıkarır (`pdf-parse`).
8. **`write_file`** (`filesystem.js`): `scratch/` veya `By_Agent/` dizinlerinde dosya oluşturur veya yazar.
9. **`list_directory`** (`filesystem.js`): Klasör içeriğini listeler (Kök dizindeki çekirdek dosyalar filtrelenir).
10. **`take_screenshot`** (`system.js`): Masaüstü ekran görüntüsü alır ve `public/` klasörüne kaydeder.
11. **`download_image`** (`image.js`): Web URL'sinden görsel indirir; vision ile doğrular.
12. **`task_plan`** (`tools/index.js`): Görevin alt adımlara bölünmesini sağlayarak planlama fazını tamamlar.
13. **`select_guide`** (`tools/index.js`): Obsidian kılavuzunu aktif sistem promptuna bağlar.
14. **`task_complete`** (`agent.js`): Görevi tamamlar, hafızayı günceller, `agent_readme.md` yazar, checkpoint dosyasını siler ve güvenli `execFile` git commit yürütür.
15. **`generate_workspace_rules`** (`tools/index.js`): `.agent-rules.md` dosyasını otomatik üretir.
16. **`send_discord_message`** (`discord/index.js`): Discord kanalına mesaj veya dosya eki gönderir.
17. **`filter_output`** (`filters.js`): Önceki araç çıktısını regex, URL veya tırnak içine göre süzer.
18. **`url_image_reader`** (`image.js`): Sayfadaki görselleri tarar ve vision modeliyle analiz eder.
19. **`extract_chart_data`** (`image.js`): Finansal grafik ve tablo görsellerini JSON formatında normalize sayılara döker.
20. **`line_checker`** (`filters.js`): Büyük dosyalarda sorguya uyan satırları salt-okunur olarak filtreler.
21. **`library_mode`** (`modes/libraryMode.js`): `Libraries/` dizininde semantik bilgi araması yapar (`runLibraryModeSubLoop`).
22. **`notify_user`** (`notify.js`): İşletim sisteminde (Windows PowerShell balloon, macOS osascript, Linux notify-send) masaüstü toast bildirimi gösterir.

---

## 3. Temel Algoritmalar ve İnovasyonlar

1. **Merkezi Ajan Yürütme Döngüsü & Hata İmzası Takibi:** `runAgentLoop` durum makinesi. Art arda 3 kez aynı parametrelerle başarısız olan araç çağrılarında döngüyü kırarak sonsuz döngüyü engeller (`Infinite failure loop detected`).
2. **5 Katmanlı Araç Çağrı Ayrıştırıcısı (5-Tier Parser):** Markdown JSON, ham JSON nesneleri, XML `<tool_call>`, Qwen `[TOOL_CALLS]` ve Heuristic Regex onarımı (`cleanMalformedJsonString`).
3. **RAG Vektör Hafızası ve TF-IDF Fallback:** Kosinüs benzerliği ($\ge 0.5$) ve Türkçe/İngilizce stop-words temizliği ile anahtar kelime eşleşmesi ($\ge 1.0$).
4. **SiMBA (Searched Memory By AI):** Hafızaları 20'şerli kümeleyip LLM ile en uygun kayıtları seçen anlamsal eşleme.
5. **İki Aşamalı Hafıza Budama (Two-Stage Pruning):** 50 kural tavanı, 24 saatlik Grace Period koruması (%70 / 35 kural kotası) ve puanlama formülü ($\text{Score} = \text{accessCount} \times 2.0 - \text{age}/72$).
6. **Güvenli Asenkron Bellek Yazma & Acil Tahliye (`emergencyFlushSync`):** Promise kuyruğu, atomik `.tmp` yazma, üstel bekleme (100ms $\rightarrow$ 250ms $\rightarrow$ 625ms), RAM tamponu (`pendingFlushBuffer`) ve süreç sonlanırken (`beforeExit`, `SIGINT`, `SIGTERM`) senkron disk dökümü.
7. **Eski Veri Normalizasyonu (`normalizeMemoryItem`):** Eksik alanları varsayılanlarla doldurarak `NaN` skoru ve V8 sort çökmesini engeller.
8. **İnsan Onaylı Güvenlik Kuralları Yaşam Döngüsü (`pendingRules`):** Kullanıcı iptallerinden kural damıtma, 10 elemanlı FIFO havuzu, 7 gün (168 saat) TTL ve Web/Discord/Terminal üzerinden idempotent üç kanallı onay.
9. **Deterministik Kural İstisna Denetimi (`checkRuleExceptionMatch`):** Wildcard (`*.tmp`), tam dosya adı/yolu ve kelime sınırı (`\b`) regex ile 3 kademeli istisna doğrulaması.
10. **Levenshtein Filtresi & $O(1)$ Boyut Kontrolü:** Obfuscated yasaklı kelimeleri yakalar; uzunluk farkı 2'den büyükse hesaplamayı atlayarak CPU'yu korur.
11. **Gerçek Zamanlı Harcama Takibi & Bütçe Devre Kesicisi (`costTracker.js`):** Yerel modellerde $0.00, bulut modellerinde giriş/çıkış tarifesiyle kesin USD takibi; günlük bütçe (`maxDailyCostUSD` = $1.00) aşıldığında bulut çağrılarını durdurur.
12. **Model Merdiveni ve Eşzamanlı Yükleme Kilidi (`_ensuringModelPromise`):** Paralel isteklerde yarış durumunu önleyen Promise tekilleştirme kilidi.
13. **Görev Bazlı Tripwire Döngüsü ve Sıfırlama API'si:** `agent_user.json` okunduğunda göreve özel silahlanma (`tripwireArmedTaskId`), ikincil okumada acil durdurma ve `POST /api/security/reset-tripwire` ile anında kilit açma.
14. **Alt Süreç Ortam Yalıtımı ve Egress Kalkanı:** `getSanitizedEnv()` ile tokenları temizleme, geçici klasörleri `scratch/` dizinine yönlendirme ve `curl`, `wget`, `irm` gibi veri sızdırma komutlarını engelleme.
15. **Argüman Vektörlü Güvenli Git Staging:** `execFile('git', ['add', '-u'])` ile kabuk interpolasyonu olmadan komut enjeksiyonunu önleme.
16. **SGM Varlık Yönlendiricisi ve Single-Shot Upsert:** Çoklu varlıkları ayırma, `temperature: 0.1` ile tek seferlik JSON güncelleme, 15 etiket üretimi ve `keywords_index.json` ters indeksi.
17. **Derin Web Araştırması (Deep Web Search Pipeline):** Çoklu arama, Puppeteer kazıma, `webSanitizer` temizliği, sayfa başı mikro-özet, canlı WebSocket ilerlemesi ve master sentez raporu.
18. **Delta Patch Durum Yönetimi:** 150ms debounced diff hesaplamasıyla sadece değişen durum alanlarını `state_patch` olarak yayınlama.
19. **Görev Checkpoint & Kurtarma Sistemi (`src/checkpoint.js`):** Her adımda durumun atomik `.tmp` ile diske yazılması, 24 saatlik geçerlilik süresi, frontend ve WebSocket üzerinden kaldığı yerden devam (`resume_checkpoint`) veya silme (`delete_checkpoint`).
20. **Platformlar Arası Masaüstü Toast Bildirimi (`notify.js`):** PowerShell NotifyIcon, macOS osascript ve Linux notify-send ile kullanıcıyı görev bitiminde uyarma.
21. **Adaptif Model Performans Yönlendiricisi (AMPR — `performanceTracker.js`):** Araç bazlı çalışma zamanı telemetrisi (başarı oranı, 5-kademeli parser katmanı, yanıt gecikmesi), EWMA ($\alpha = 0.35$) dinamik puanlaması, soğuk başlangıç eşiği (3 çağrı) ve otonom model merdiveni seçimi.

---

## 4. Modül ve Fonksiyon Bazlı Kod Analizi (Function Breakdown)

### A. `src/agent.js`
- `fetchAndParseAction(requestMessages)`: LLM'den yanıt alır, 5-tier parser ile eylemi çözer. Geçersiz JSON durumunda modele kendi çıktısını göstererek 2 kez düzeltme fırsatı tanır (`Self-correcting`).
- `recordActionThoughts(assistantText, action)`: Modelin düşünce metnini ve çalıştırdığı araç geçmişini `agentState.thoughts` ve `agentState.executedTools` dizilerine işler.
- `requestUserApproval(action, steps)`: Eylemin risk analizini yapar (`CRITICAL` ise doğrudan engeller). Otomatik onayda değilse döngüyü askıya alıp Web modal, Terminal onay kutusu ve Discord butonları üzerinden kullanıcıdan onay bekler (`pendingActionResolver`).
- `resolvePendingAction(approved, updatedAction, reason)`: Kullanıcının onay veya red yanıtını alır. Reddedildiyse gerekçeden kural damıtma fonksiyonunu tetikler.
- `handleActionRejection(action, reason)`: Reddedilen eylemden güvenlik kuralı önerisi damıtır ve onay havuzuna ekler (`addPendingRule`).
- `runAgentLoop(taskPrompt, options)`: Çok adımlı Swarm ajanı ana durum makinesi döngüsü. Planner $\rightarrow$ Developer $\rightarrow$ QA Tester geçişlerini yönetir, her adımda `saveCheckpoint` çağırır ve görev bittiğinde `deleteCheckpoint` çalıştırır.
- `runManuelTool(toolName, args)`: Tekil araçları task plan ve checklist muafiyetiyle (`isNoTaskPlanMode`) tek adımda çalıştırır.
- `runResearchTool(type, query)`: Web ve local araştırmalarını doğrudan yürütür.
- `runIdeSwarmLoop(userTask, initialPlanSteps)`: Electron IDE üzerinden başlatılan çok rollü swarm görevlerini yürütür.

### B. `src/state.js`
- `agentState`: Ajanın tüm reaktif durumu: aktif mod (`activeMode`), durum (`status`), mesaj geçmişi (`messages`), görev listesi (`planSteps`), düşünceler (`thoughts`), yüklenen modeller ve metrikler.
- `broadcastStatePatch()`: 150ms debounce ile durum nesnesinin önceki kopyasıyla diff'ini hesaplar ve yalnızca değişen alanları `state_patch` olarak WebSocket istemcilerine gönderir.
- `broadcastTerminal(text)`: Canlı terminal çıktılarını hem WebSocket üzerinden tarayıcıya iletir hem de konsol kancasına (`terminalOutputHook`) aktarır.
- `onStateChange(listener)`: Sistem durum değişikliklerini anlık olarak yerel dinleyicilere (terminal denetleyicisi vb.) iletir.
- `setTerminalOutputHook(fn)`: Konsol standart çıktısına terminal akışını yönlendiren kancayı kaydeder.
- `addMessage(role, content)`: Mesaj geçmişine yeni girdi ekler; token sınırına göre eski mesajları budar.
- `addTransientError(errorText)`: Geçici araç hatalarını normalize edip RAM tamponunda saklar (max 10).

### C. `src/security.js`
- `isProtectedProjectFile(filePath)`: Projenin çekirdek dosyalarına (`src/**`, `server.js`, `package.json`, `.env`, `config/`, `.ai/`) ajan erişimini sert biçimde engeller.
- `checkBannedWords(text)`: Levenshtein mesafesiyle gizlenmiş yasaklı kelimeleri tespit eder ($O(1)$ boyut filtreli).
- `checkRuleExceptionMatch(action, exceptions)`: 3 kademeli (wildcard, tam yol, kelime sınırı `\b`) deterministik kural istisnası doğrulaması yapar.
- `assessActionRisk(action)`: Eylem risk seviyesini (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) hesaplar; istisna varsa riski düşürür; egress komutlarında `CRITICAL` risk üretir.
- `checkTripwire(filePath)`: Görev bazlı tripwire durumunu kontrol eder (`agent_user.json` tetikleyicisi).
- `resetTripwire()`: Tripwire kilidini derhal sıfırlar.

### D. `src/memory.js`
- `normalizeMemoryItem(item)`: Legacy verileri güvenli varsayılanlarla doldurarak `NaN` ve sort çökmesini engeller.
- `loadMemoryStore()`: Diskteki `config/memory.json` dosyasını okur; kilitliyse RAM kopyasını (`pendingFlushBuffer`) servis eder.
- `saveMemoryStore(store)`: Asenkron kuyruk (`writeQueue`) ve üstel bekleme ile atomik `.tmp` dosyasına yazar.
- `updateMemoryStore(mutatorFn)`: Kuyruk içinde atomik read-modify-write döngüsü çalıştırır.
- `emergencyFlushSync()`: Kapanış sinyallerinde (`beforeExit`, `SIGINT`, `SIGTERM`) RAM tamponunu senkron olarak diske yazar.
- `calculateMemoryScore(item)`: $\text{accessCount} \times 2.0 - \text{age}/72$ puanını hesaplar.
- `pruneMemories(memories, max = 50)`: İki aşamalı budama: Grace (%70 / 35 kural) ve non-grace elemesi.
- `cleanStalePendingRules(rules)`: 7 günü (168 saat) aşan kuralları siler.
- `addPendingRule(ruleObj)`: 10 elemanlı FIFO havuzuna yeni kural önerisi ekler.
- `approvePendingRule(id)`: Kuralı onaylayarak taze grace period ile aktif belleğe taşır.
- `rejectPendingRule(id)`: Kuralı pending havuzundan siler.
- `appendToMemory(task, summary, extraData)`: Başarılı görevi vektörel hafızaya kaydeder.
- `getMemoryPrompt()`: Yalnızca seçilen ilk 3 kuralın `accessCount` değerini artırarak sistem promptuna ekler.
- `updateWorkspaceReadme(task, summary)`: `agent_readme.md` dosyasını günceller.
- `runGitCommit(task, summary)`: `child_process.execFile('git', ['add', '-u'])` ile güvenli git commit çalıştırır.

### E. `src/checkpoint.js`
- `ensureCheckpointDir()`: `scratch/checkpoints/` dizinini oluşturur.
- `saveCheckpoint(agentState, stepIndex, config)`: Görev durumunu (adım, task, mod, plan, düşünceler, son 80 mesaj, son araç çıktısı, config snapshot) `.tmp` dosyasına atomik yazar.
- `loadCheckpoint()`: En son checkpoint'i okur; 24 saatten eskiyse veya completed/idle durumundaysa geçersiz sayar.
- `deleteCheckpoint()`: Görev başarıyla bittiğinde checkpoint dosyasını diskten kaldırır.
- `getCheckpointSummary(cp)`: Arayüz ve konsola sunulacak özet bilgileri (görev, adım, geçen süre, tamamlanan adımlar) döner.
- `restoreCheckpointToState(cp, agentState, config)`: Checkpoint verilerini `agentState` nesnesine aktararak görevi kaldığı yerden başlatır.

### F. `src/cli/terminalController.js`
- `initTerminalController()`: Node.js `readline` arayüzünü başlatır (`npm start` ile otomatik açılır).
- `handleCommandLine(line)`: Konsoldan girilen tüm `:mode`, `:submode`, `:settings`, `:set`, `:autoapprove`, `:models`, `:switch-model`, `:tripwire reset`, `:task`, `:interrupt`, `:abort`, `:status`, `:history`, `:health`, `:eval`, `:test`, `:clear`, `:exit` komutlarını ve görev metinlerini işler.
- `displayApprovalCard(action)`: Araç çalıştırma onayı gerektiğinde terminalde risk seviyesi, araç parametreleri ve gerekçeyle renkli onay kutusu gösterir (`y` / `n` / `:edit`).
- `getPromptString()`: Aktif çalışma modunu ve sistem durumunu içeren dinamik komut satırı istemcisini üretir (`Stellarigent [mod/alt-mod | durum]> `).
- `showHelpMenu()`: Tüm CLI komutlarını ve menülerini kategorize edilmiş olarak listeler.
- `showSettings()`: Sistem ayarlarını ve otomatik onay durumlarını formatlı ASCII tablosunda sunar.
- `showStatus()`: Ajanın anlık plan adımlarını, son düşüncesini ve çalıştırılan araçlarını listeler.

### G. `src/llm/costTracker.js`
- `calculateCost(provider, model, inTokens, outTokens)`: Harici bulut sağlayıcılarının (OpenAI, Anthropic, Gemini, Groq, OpenRouter) güncel token tarifeleriyle kesin USD maliyetini hesaplar. Yerel modeller için $0.00 döner.
- `recordUsage(provider, model, inTokens, outTokens)`: Kullanım verilerini `agentState.metrics.cost` içine işler.
- `checkBudgetExceeded(maxDailyUSD)`: Günlük bütçe tavanını ($1.00) denetler; aşılmışsa bulut API çağrılarını kilitler.
- `getCostSummary()`: Anlık toplam ve günlük harcama raporunu döner.

### H. `src/llm/modelManager.js`
- `ensureModelLoaded(targetTool)`: İlgili araç için gerekli modelin yüklü olduğunu denetler; `_ensuringModelPromise` ile yarış durumunu önler.
- `switchToModel(modelId)`: LM Studio REST API (`/api/v1/models/load`) ile modeli dinamik olarak belleğe yükler.
- `getNextLadderModel(currentModel, targetTool)`: Yerel model merdiveninde bir sonraki modeli döner; AMPR aktifse ve veri yeterliyse en yüksek performans skorlu modeli seçer.
- `switchToFallbackModel(toolName)`: Araç başarısız olduğunda AMPR destekli fallback veya merdiven modeline geçiş yapar.
- `applyModelModeProfile(modelId)`: Modele özel LPM / OM mod profillerini sisteme enjekte eder.

### I. `src/llm/performanceTracker.js` (AMPR Çekirdeği)
- `recordExecution({ modelId, toolName, parseTier, success, retriesNeeded, latencyMs })`: Araç çağrısının çalışma zamanı sonucunu kaydeder, EWMA ile hareketli ortalamaları ve bileşik `ModelScore` değerini hesaplar, debounced atomik `.tmp` disk senkronizasyonu yapar.
- `getModelScore(modelId, toolName)`: Belirli model ve araç için skor, örnek sayısı, ortalama gecikme ve ayrıştırma katmanı döner (En az 3 örnek ile `sufficient` doğrulaması).
- `getBestModelForTool(toolName, candidateModels)`: Aday modeller arasından yeterli veriye sahip en yüksek skorlu modeli döner.
- `getPerformanceStats()`: Web arayüzü ve API için sıralı performans matrisini derler.
- `resetPerformanceData()`: RAM ve diskteki tüm performans geçmişini temizler.
- `emergencyFlushSync()`: Süreç kapanış sinyallerinde senkron disk dökümü yapar.

### J. `src/modes/libraryMode.js`
- `processLibraryTaskSGM(prompt, subMode)`: SGM döngüsünü başlatır; Entity Router ile kullanıcı metnindeki bağımsız varlıkları ayırır.
- `runLibraryAddSubLoop(catDir, filename, prompt)`: Single-Shot Upsert (`temperature: 0.1`) ile JSON dosyasını derin birleştirme yaparak günceller ve 15 adet anahtar kelime etiketi üretir.
- `runLibraryModeSubLoop(query, explanation)`: Kütüphane dosyalarını tarayıp hibrit ön puanlama, Türkçe karakter normalizasyonu ve aşama 2 doğrulama süzgeciyle özet döner.
- `sgmHealthCheck(prompt, summaries, stepCount)`: SGM döngüsünün sağlığını denetler.

### J. `src/tools/notify.js`
- `isNotifySupported()`: Platform desteğini (Windows, macOS, Linux) denetler.
- `sendWindowsNotification(title, message, level)`: PowerShell NotifyIcon balonu oluşturup gösterir.
- `sendMacNotification(title, message)`: `osascript` ile bildirim tetikler.
- `sendLinuxNotification(title, message)`: `notify-send` ile bildirim gönderir.
- `sendSystemNotification(title, message, level)`: Platformdan bağımsız ana bildirim tetikleyicisi.

### K. `src/discord/`
- `commands.js`: `!help`, `!play`, `!skip`, `!pause`, `!resume`, `!stop`, `!queue`, `!library`, `!forcetaskplan`, `!lpm`, `!simba`, `!memorylimit` komutlarını yürütür.
- `musicPlayer.js`: `yt-dlp` tabanlı ses indirme ve `@discordjs/voice` ses kanalı çalıcısı.
- `agentBridge.js`: Ajan durum güncellemelerini kanala iletir, interaktif onay butonları (`approve_discord_action`, `reject_discord_action`) ve kural onay kartları (`approve_rule_<id>`, `reject_rule_<id>`) gönderir.

---

## 5. UI Bileşenleri, Butonlar ve Varlık Haritası (Assets & UI Elements)

### A. Web Kontrol Paneli (`public/`)
- **Navigasyon ve Mod Butonları:**
  - `#nav-manual` / `.accordion-header[data-mode="manuel"]`: Manuel araçlar akordeonu.
  - `.sub-nav-btn`: `cmd_tool`, `file_reader`, `file_writer`, `app_launcher`, `web_searcher`, `site_viewer`, `screen_shot`, `img_downloader`, `pdf_reader`, `dir_lister`, `task_lister`, `guide_selector`, `url_image`, `library_mod`, `finance_tool`.
  - `.accordion-header[data-mode="research"]`: Araştırma menüsü (`web`, `local`, `deep_web`).
  - `.accordion-header[data-mode="library"]`: Kütüphane menüsü (`#library-setting-sgm`, `#library-setting-esyabanci`).
  - `.accordion-header[data-mode="agent_runner"]`: Swarm Otonom Ajan moduna geçiş.
  - `#hpm-toggle-checkbox`: High Parameter Mode geçiş anahtarı (30B+ modeller için).
  - `#btn-open-ide`: Electron Desktop IDE uygulamasını başlatan buton.
- **Canlı Metrikler:**
  - `#stat-tokens`: Toplam takas edilen token sayısı.
  - `#stat-actions`: İzin verilen eylem sayısı.
  - `#stat-blocks`: Güvenlik engeline takılan eylem sayısı.
  - `#stat-cost`: Gerçek zamanlı harcanan USD tutarı (`$0.0000`).
- **Onay ve Etkileşim:**
  - `#approval-drawer`: Onay bekleyen eylem çekmecesi.
  - `#btn-approve-action` & `#btn-reject-action`: İnsan onay/red butonları.
  - `#btn-stop-agent`: Ajanı ve alt süreçleri derhal durduran acil durdurma butonu.
  - `#btn-manual-ai-submit`: Manuel AI köprüsü için model çıktısını gönderme butonu.
- **Ayarlar Merkezi Sekmeleri (`public/settings.js`):**
  - `[data-settings-tab="guide"]`: Kılavuz Yöneticisi ve Editörü (`#btn-save-guide`).
  - `[data-settings-tab="models"]`: LM Studio, Cloud API Keys ve Model Routing birleşik merkezi (`#btn-save-lmstudio`, `#btn-save-apikeys`, `#btn-save-model-tags`).
  - `[data-settings-tab="prompts"]`: 16 sistem promptunun düzenleyicisi (`#btn-save-system-prompts`) ve 16 akış zıplama butonu (`.flow-pill-btn`).
  - `[data-settings-tab="auto"]`: Otomatik onay izinleri ve günlük bütçe tavanı ayarları (`#setting-budget`).
  - `[data-settings-tab="discord"]`: Discord Token, Kurucu ID ve müzik kütüphanesi ayarları.
  - `[data-settings-tab="perm"]`: Yasaklı komut kara listesi rozetleri (`.banned-badge`) ve Tripwire sıfırlama butonu (`#btn-reset-tripwire`).
- **İlk Kurulum Sihirbazı (`public/setup.js`, `public/setup.css`):**
  - `#setup-modal`: İlk çalıştırmada açılan kurulum penceresi (`#setup-founder-key`, `#setup-discord-token`, `#setup-founder-id`, `#setup-submit-btn`).

### B. Görsel ve Şema Varlıkları (`public/assets/`)
- `system_prompts_algorithm.svg`: Sistem istemleri ve çoklu ajan mimarisinin 6 aşamalı monokrom akış şeması.
- `system_prompts_algorithm.png` & `.jpg`: Raster şema formatları.

### C. Electron Masaüstü IDE (`electron/`)
- Gömülü Monaco Code Editor (`node_modules/monaco-editor` ile tamamen offline).
- Dosya ağacı gezgini, LM Studio model seçici ve entegre görev çubuğu.
- `.env` üzerindeki `PORT` ile otomatik senkronize olan HTTP ve WebSocket istemcisi.

### D. İnteraktif Konsol / Terminal Denetleyicisi (Terminal CLI)
- `npm start` yapıldığında doğrudan konsoldan çalışan iki yönlü yönetim istemcisi:
  - **Menü & Mod:** `:mode <agent|manuel|research|library>`, `:submode <ad>`, `:menu`, `:help`.
  - **Yapılandırma:** `:settings`, `:set <key> <val>`, `:autoapprove <tool> <true|false>`, `:models`, `:switch-model <id>`, `:tripwire reset`.
  - **Görev & Müdahale:** Doğrudan metin girişi, `:task <text>`, `:interrupt <text>`, `:abort`.
  - **Onay:** `y` / `:approve`, `n [neden]` / `:reject [neden]`, `:edit <json>`.
  - **Teşhis & Test:** `:status`, `:history`, `:health`, `:eval`, `:test` (veya `:regression`).
