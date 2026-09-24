# 🤖 Stellarigent (Autonomous Local AI Agent Framework)

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![LLM](https://img.shields.io/badge/LLM-LM%20Studio%20Local-orange.svg)](https://lmstudio.ai/)
[![Discord](https://img.shields.io/badge/Discord-v14-5865F2.svg)](https://discord.js.org/)

> **100% Local, Autonomous AI Computer Agent with Real-Time Web Dashboard, Electron Desktop IDE, Discord Bot, Puppeteer Web Automation, Multi-Agent Swarm Mode, Model Routing & Failover Ladder.**

> [!WARNING]
> ### ⚠️ ÖNEMLİ BİLGİLENDİRME VE RİSK UYARISI
> Bu projenin kodu büyük oranda **Gemini (Yapay Zeka)** tarafından yazılmış olup; algoritma, çalışma mantığı, mimari kararlar ve uygulamanın tüm fikir hakları proje geliştiricisi **siyahpulsar**'a aittir. Gemini sadece bu düşünceleri koda dökerek gerçek hayata geçirmiştir. **Gemini sadece kod yazma ve kod doğrulama/düzeltme/analiz etme toolu olarak rol oynamıştır.** Proje geliştiricisi tüm özellikleri bizzat deneyememiş olup, tam güvenlik ve %100 sorunsuz çalışabilirlik garantisi sunulmamaktadır. Kodların bilgisayarınızda çalıştırılmasından doğabilecek tahmin edilebilir veya edilemez, olası tüm donanımsal, yazılımsal ve güvenlik riskleri tamamen projeyi indirip kullanan **kullanıcının kendi sorumluluğundadır**.
> 
> *Olası bir açık, hata, ekstra token harcamaları, tasarrufsuzluk, eksik optimizasyon ve performans sorunları veya yeni fikir ve öneriler için Discord üzerinden **siyahpulsar**'a bildirmeyi unutmayın.*
> 
> ---
> 
> ### ⚠️ IMPORTANT DISCLAIMER & RISK WARNING
> *This project's code was largely written by **Gemini (AI)**, but all algorithms, operational logic, architectural decisions, and project ideas belong exclusively to the developer, **siyahpulsar**. Gemini only served to translate these thoughts into code and bring them to life. **Gemini played a role strictly as a tool for code writing, verification, correction, and analysis.** The developer has not tested all features extensively; therefore, full security and flawless functionality are not guaranteed. Any predictable or unpredictable risks—including hardware, software, or security vulnerabilities—arising from executing this project are entirely the **responsibility of the user**.*
> 
> *If you encounter vulnerabilities, bugs, unnecessary token consumption, missing optimizations, performance issues, or have new ideas and suggestions, please report them to **siyahpulsar** on Discord.*

---

## 📖 Table of Contents / İçindekiler
- [English Documentation](#-english-documentation)
  - [1. System Overview & Core Mission](#1-system-overview--core-mission)
  - [2. Comprehensive Feature Matrix](#2-comprehensive-feature-matrix)
  - [3. Architectural Innovations](#3-architectural-innovations)
  - [4. Deterministic Evals & Benchmark Suite](#4-deterministic-evals--benchmark-suite)
  - [5. Local LLM Tier List & Compatibility](#5-local-llm-tier-list--compatibility)
  - [6. Repository Layout & Module Breakdown](#6-repository-layout--module-breakdown)
  - [7. Available Tools (Full 22 Tool Inventory)](#7-available-tools-full-22-tool-inventory)
  - [8. User Interfaces: Web Dashboard & Electron IDE](#8-user-interfaces-web-dashboard--electron-ide)
  - [9. Prerequisites & Environment Setup](#9-prerequisites--environment-setup)
  - [10. Configuration Guide (Step-by-Step)](#10-configuration-guide-step-by-step)
  - [11. Running the Application](#11-running-the-application)
- [Türkçe Dokümantasyon](#-türkçe-dokümantasyon)
  - [1. Sistem Genel Bakışı ve Temel Hedef](#1-sistem-genel-bakışı-ve-temel-hedef)
  - [2. Kapsamlı Özellik Matrisi](#2-kapsamlı-özellik-matrisi)
  - [3. Mimari İnovasyonlar](#3-mimari-inovasyonlar)
  - [4. Deterministik Eval ve Test Paketi (Benchmark Suite)](#4-deterministik-eval-ve-test-paketi-benchmark-suite)
  - [5. Yerel LLM Model Yetenek Seviyeleri](#5-yerel-llm-model-yetenek-seviyeleri)
  - [6. Modül ve Dizin Haritası](#6-modül-ve-dizin-haritası)
  - [7. Kullanılabilir Araçlar (Tam 22 Araç Envanteri)](#7-kullanılabilir-araçlar-tam-22-araç-envanteri)
  - [8. Kullanıcı Arayüzleri: Web Paneli ve Electron IDE](#8-kullanıcı-arayüzleri-web-paneli-ve-electron-ide)
  - [9. Kurulum Gereksinimleri](#9-kurulum-gereksinimleri)
  - [10. Yapılandırma Rehberi (Adım Adım)](#10-yapılandırma-rehberi-adım-adım)
  - [11. Uygulamayı Çalıştırma ve Docker](#11-uygulamayı-çalıştırma-ve-docker)
- [License / Lisans](#-license)

---

## 🇬🇧 English Documentation

### 1. System Overview & Core Mission

**Stellarigent** is an open-source, production-grade **Autonomous Local AI Computer-Use Agent framework**. It is designed to run 100% locally on your machine without mandatory cloud subscriptions or API keys. It interfaces directly with **LM Studio** (or any OpenAI-compatible local REST server) to grant language models real-world computer manipulation, research, and coding capabilities.

---

### 2. Comprehensive Feature Matrix

- **100% Local & Private:** No prompts, files, or tokens leave your local machine unless you explicitly configure cloud fallbacks.
- **Dual Execution Environments:**
  - **Modern Web Dashboard:** Real-time monitoring, live WebSocket streaming, manual tool execution, and a consolidated 6-panel configuration center.
  - **Electron Desktop IDE:** Standalone desktop app featuring a local Monaco code editor, file explorer, agent task bar, and dynamic port synchronizer.
- **Dynamic Model Routing & Fallback Ladder:**
  - **Tool-Based Model Switching:** Automatically instructs LM Studio to load the ideal model for specific tasks (e.g. lightweight models for searches, heavy coder models for code generation).
  - **Fallback Ladder:** If the active local model fails or encounters errors, the agent seamlessly climbs a configured local model ladder (`#1 -> #2 -> #3`) before falling back to cloud APIs.
  - **Auto-Modes Profile Injection:** Automatically synchronizes system settings (LPM, OM, Deep Reasoning, Task Plan) depending on the currently loaded model.
- **Flexible Execution Modes:**
  - **Manuel Tools:** Single-call tool execution without task plan overhead.
  - **Research Mode (Web, Local, Deep Web):** Autonomous research pipelines that search, scrape, summarize, and cite web sources without generating IDE checklists.
  - **Library Mode (SGM):** Entity-routed, single-shot upsert engine for managing knowledge bases and user profiles in `Libraries/`.
  - **Agent Runner (Swarm Mode):** Multi-agent persona switching (`Planner` $\rightarrow$ `Developer` $\rightarrow$ `QA Tester`) for complex multi-step software engineering tasks.
- **Multi-Platform Discord Bot:**
  - Remote task delegation (`!ask <prompt>`) and live status broadcasts.
  - Interactive approval cards with Discord UI buttons for tool actions (`Approve` / `Reject`) and proposed security rules (`approve_rule_<id>` / `reject_rule_<id>`).
  - Cross-platform voice channel music player powered by `yt-dlp` (Windows, Linux, Docker).
- **Production-Grade Resilient Memory (`config/memory.json`):**
  - **Two-Stage Pruning:** Mathematical scoring ($\text{Score} = \text{accessCount} \times 2.0 - \text{age}/72$) with 24-hour Grace Period protection (capped at 35 items) and 50-item hard quota.
  - **Legacy Data Migration:** Automatic normalization (`normalizeMemoryItem`) guarding against `NaN` sort corruption on legacy records.
  - **Zero-Data-Loss RAM Buffer & Emergency Flush:** In-memory queue during OS file locks (EPERM/EBUSY) with synchronous exit hooks (`emergencyFlushSync` on `beforeExit`, `SIGINT`, `SIGTERM`).
  - **Human-Reviewed Rule Distillation:** User rejections distill into an isolated `pendingRules` pool (max 10, 7-day TTL) requiring explicit confirmation before activation.
- **Manual AI Bridge:** Graceful offline fallback that converts prompts into copy-paste blocks for external web models (Gemini, Claude, ChatGPT) and resumes the loop upon response paste.
- **Strict Security & Sandboxing:**
  - **Project Core Shield:** Prevents agents from accessing, modifying, or deleting source code files (`src/**`, `server.js`, `package.json`, `.env`, `config/`).
  - **Programmatic Rule Exception Enforcement:** `checkRuleExceptionMatch` validates `exceptions: []` arrays programmatically to avoid false positives and instruction drift.
  - **Tripwire Circuit Breaker:** Immediate emergency halt if an agent reads `agent_user.json` and subsequently attempts to read any secondary file, with scoped task release and manual reset button.
  - **Web Sanitizer:** Strips prompt injection, hidden DOM tags, and zero-width artifacts from scraped websites.
  - **Safe Git Staging:** Executes `git add -u` via argument vectors (`execFile`) to stage only tracked files, preventing accidental commits of untracked scratch data or memory backups.

---

### 3. Architectural Innovations

1. **Entity Router & Single-Shot Upsert (SGM):** Replaces legacy Best-of-N blind evaluations with an Entity Router that splits multi-subject prompts into isolated execution loops. Modifies JSON profiles using single-shot `temperature: 0.1` generation.
2. **Delta Patch State Management:** Broadcasts debounced (150ms) delta diffs (`state_patch`) over WebSockets instead of full state trees, minimizing CPU and bandwidth consumption.
3. **5-Tiered Tool Call Parser:** Parses LLM outputs across JSON Markdown codeblocks, raw JSON objects, XML tags, Qwen `[TOOL_CALLS]` syntax, and Heuristic Regex fallback—ensuring reliable tool calls even on 3B/7B models.
4. **Task Plan Exemption (`isNoTaskPlanMode`):** Completely disables software checklist requirements for Manuel Tools, Research, and Library modes.
5. **Real-Time Cost Accounting & Daily Budget Circuit Breaker (`costTracker.js`):** Tracks exact prompt and completion token costs across providers, with automated cut-off when daily spend exceeds `$1.00`.
6. **System Metrics & Health Monitoring:** Real-time CPU and RAM broadcast loop, along with a dedicated `GET /api/health` diagnostic endpoint.

---

### 4. Deterministic Evals & Benchmark Suite

Rather than relying on unverified subjective tier scores, Stellarigent features an integrated, reproducible **Deterministic Benchmark & Evaluation Suite** (`npm run eval` or `node evals/run_evals.js`). This test suite validates agent behavior across core subsystems without relying on external network calls or non-deterministic model outputs.

| Suite | Scenarios | Target Subsystem | Status |
| :--- | :---: | :--- | :---: |
| **Parser Resilience** | 5 | Markdown codeblocks, raw JSON, XML tags, Qwen `[TOOL_CALLS]`, Heuristic Regex fallback | ✅ **PASS** (5/5) |
| **Security & Confinement** | 3 | Core shield isolation (`src/**`), Path traversal rejection (`..`), Network egress blocking (`curl`, `irm`) | ✅ **PASS** (3/3) |
| **Tripwire Lifecycle** | 2 | Exfiltration tripwire arming & halt, Tripwire task reset & recovery | ✅ **PASS** (2/2) |
| **Cost & Quota Tracking** | 2 | Local 0-cost usage recording, Cloud provider pricing calculation & daily budget tripwire | ✅ **PASS** (2/2) |
| **Memory Pruning** | 1 | Two-stage mathematical pruning score, 24h grace period protection, 50-item hard quota | ✅ **PASS** (1/1) |
| **Overall Score** | **13 Scenarios** | **Full System Integrity Check** | **100.0% Pass Rate** |

To run the evaluation suite locally:
```bash
npm run eval
```

---

### 5. Local LLM Tier List & Compatibility

| Tier | Model Class / Size | Performance & Tool Use Evaluation |
| :---: | :--- | :--- |
| **` S `** | **Gemini / Claude / GPT** | **Exceptional**. Flawless multi-step planning, reasoning, and tool selection. |
| **` A `** | **Devstral Small 2 (24B)** | **Very Good**. Strong tool caller; executes multi-file modifications cleanly. |
| **` B `** | **Qwen 2.5 Coder (14B)** | **Recommended Default**. Excellent code syntax, reliable JSON formatting, fast execution. |
| **` C `** | **Gemma 3 (12B)** | **Moderate**. Performs single-tool calls well; may stumble on complex multi-stage tasks. |
| **` D `** | **Qwen 2.5 Coder (7B)** | **Acceptable**. Suitable for lightweight local hardware; keep prompts direct. |
| **` E `** | **Qwen 2.5 (3B)** | **Weak**. Baseline tool calls work; requires Manual AI Bridge assistance on long loops. |

---

### 6. Repository Layout & Module Breakdown

```
.
├── server.js               # Express HTTP & WebSocket server, health checks, CPU/RAM metrics, tripwire reset API
├── Dockerfile              # Isolated container specifications with Chromium & Node.js
├── docker-compose.yml      # Docker container orchestration
├── package.json            # Dependencies, eval and test npm scripts
├── README.md               # Bilingual comprehensive project guide
├── genel_proje_bilgisi.md  # Core architectural reference map
├── agent_readme.md         # Auto-updated workspace map & accomplishment log
├── bundle_docs.py          # Python documentation bundler script
├── bundled_documentation.md# Consolidated documentation file
├── evals/                  # Deterministic evaluation & benchmark suite
│   ├── run_evals.js        # Benchmark runner and markdown report generator
│   ├── scenarios.js        # 13 deterministic test scenarios across 5 system areas
│   └── latest_eval_report.md# Latest benchmark execution report
├── config/                 # Dynamic system configuration schemas
│   ├── config.json         # Admins, fallbacks, model tags, ladder, budget cap, and mode profiles
│   ├── security_rules.json # Banned words, forbidden commands, allowed folders
│   ├── setup.json          # Setup wizard state indicator
│   ├── memory.json         # Vector memory bank & pending rules queue (50 limit, Two-Stage Pruning)
│   └── system_prompts.json # 16 dynamic system and micro-prompts
├── src/                    # Core system logic
│   ├── agent.js            # Main loop runner (runAgentLoop), Swarm switcher, manual tool runner, rule distillation
│   ├── state.js            # Central reactive state, delta diff patcher, cost metrics, transient error buffer
│   ├── security.js         # Core shield, task-scoped tripwire, resetTripwire, egress command blocking
│   ├── memory.js           # Production memory queue, Two-Stage Pruning, EPERM backoff, safe git staging (git add -u)
│   ├── llm/
│   │   ├── llmClient.js    # 5-tier parser, failover logic, dynamic environment prompt, budget circuit breaker
│   │   ├── costTracker.js  # Real-time token accounting, multi-provider rate cards, daily budget cap tracking
│   │   └── modelManager.js # Native LM Studio REST API, lms CLI fallback, model routing & ladder
│   ├── modes/
│   │   └── libraryMode.js  # Entity router, single-shot upsert, library search sub-loop
│   ├── security/
│   │   └── webSanitizer.js # Web scraping sanitizer, prompt injection defense, audit logger
│   ├── tools/              # 21 concrete tool implementations with environment sanitization
│   └── discord/            # Discord bot client, cross-platform yt-dlp music player, approval bridge
├── electron/               # Standalone Electron Desktop IDE
│   ├── main.js             # Electron main process, dynamic port reader (.env)
│   ├── index.html          # IDE layout with offline Monaco Editor
│   └── ide.js              # Monaco integration, file tree explorer, agent task runner
└── WikiLike/               # In-depth Obsidian-compatible technical documentation
```

---

### 7. Available Tools (Full 22 Tool Inventory)

1. **`execute_command`**: Runs PowerShell or Bash shell commands in isolated workspaces with scrubbed environment and egress shield.
2. **`open_application`**: Launches a desktop application or file safely.
3. **`web_search`**: Performs DuckDuckGo / Yahoo searches.
4. **`view_website`**: Navigates to a URL, renders dynamic JavaScript via Puppeteer, and sanitizes dangerous injection artifacts.
5. **`deep_web_search`**: Multi-URL web research engine with per-source summaries and master synthesis via `llmFetch`.
6. **`read_file`**: Reads text files within allowed workspace bounds (core engine protected).
7. **`read_pdf`**: Ingests and extracts clean text content from PDF documents.
8. **`write_file`**: Writes files to `scratch/` or `By_Agent/` sandboxes.
9. **`list_directory`**: Lists contents of a directory (masks protected root source files).
10. **`take_screenshot`**: Captures the desktop display and saves it to `public/` (attached to vision context).
11. **`download_image`**: Downloads remote images to disk with vision validation.
12. **`task_plan`**: Decomposes multi-step tasks into actionable checklists.
13. **`select_guide`**: Dynamically binds a specialized Obsidian guide to the system prompt.
14. **`task_complete`**: Finalizes the task, records accomplishments, and triggers safe `git add -u && git commit`.
15. **`generate_workspace_rules`**: Auto-generates `.agent-rules.md` template based on workspace files.
16. **`send_discord_message`**: Sends text and file attachments directly to Discord channels.
17. **`filter_output`**: Filters large tool outputs via line matching, URL extraction, or quoted substrings.
18. **`url_image_reader`**: Extracts and analyzes images from a web page using vision models.
19. **`extract_chart_data`**: Digitizes financial tables and trend charts into JSON coordinate arrays.
20. **`line_checker`**: Performs token-efficient targeted line scans on large files.
21. **`library_mode`**: Semantic knowledge search across files in `Libraries/` via `runLibraryModeSubLoop`.
22. **`notify_user`**: Sends desktop system toast notifications (Windows PowerShell balloon, macOS osascript, Linux notify-send) on task completion, warnings, or errors.

---

### 8. User Interfaces: Web Dashboard & Electron IDE

#### Web Dashboard (`http://localhost:3000`)
- **Left Sidebar Accordion:** Fast switching between **Manuel Tools**, **Research**, **Library**, and **Agent Runner**, plus live Token & Estimated Cost metrics.
- **Consolidated 6-Panel Settings Center:**
  1. `Guide Manager`: Markdown guide editor for custom domain workflows.
  2. `Models & Routing`: Unified hub containing segmented subtabs for **LM Studio** local endpoint/tagging, **Cloud API Keys** (OpenAI, Anthropic, Gemini, Groq), and **Model Routing & Fallback Ladder**.
  3. `Prompts`: Live editor for 16 system/micro-prompts, zero-backup overwrites, and the architectural flowchart (`system_prompts_algorithm.svg`).
  4. `Auto & Budget`: Granular auto-approval permissions for low-risk tools, LPM settings, and daily cloud expenditure limit (`maxDailyCostUSD`).
  5. `Discord`: Token, Founder ID, speed limits, bot status, and authorized users.
  6. `Security & Perm`: Banned shell command blacklist manager with interactive badge tags and Safety Tripwire manual reset control.

#### Electron Desktop IDE (`npm run start:ide`)
- Offline Monaco Editor powered by local `node_modules/monaco-editor`.
- Dynamic port synchronization from `.env`.
- Integrated file tree explorer and agent task console.

---

### 9. Prerequisites & Environment Setup

1. **Node.js** (v18.0.0 or higher).
2. **LM Studio** installed with local API server enabled (`http://localhost:1234`).
3. **Google Chrome / Chromium** installed for Puppeteer web automation.
4. *(Optional)* **Discord Bot Token** and Founder Discord User ID.

---

### 10. Configuration Guide (Step-by-Step)

#### Step 1: Copy `.env.example`
```bash
cp .env.example .env
```
Configure your environment:
```env
PORT=3000
FOUNDER_KEY=YOUR_ADMIN_PASSWORD
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
FOUNDER_DISCORD_ID=YOUR_DISCORD_USER_ID
```

#### Step 2: Install Dependencies
```bash
npm install
```

---

### 11. Running the Application

#### Start Web Dashboard, Backend & Interactive Terminal CLI:
```bash
npm start
```
Access the web dashboard at `http://localhost:3000` or control the entire agent system directly through the **Interactive Terminal CLI**!

#### 💻 Interactive Terminal CLI Controller
When `npm start` is executed, an interactive command console (`Stellarigent [mode/submode | status]> `) launches simultaneously on standard terminal I/O. Both users and testing scripts can fully control and test the project:

- **Menu & Mode Navigation:**
  - `:menu` or `:help`: Display all commands and interactive modes.
  - `:mode <agent|manuel|research|library>`: Switch between Swarm Agent, Direct Manuel Tools, Web/Local Research, and MemoryLibrary.
  - `:submode <name>`: Switch sub-mode (e.g. `cmd_tool`, `file_reader`, `file_writer`, `deep_web`, `web`).
- **Configuration & Runtime Settings:**
  - `:settings` or `:config`: Display formatted ASCII table of LM Studio URL, active model, temperature, max steps, HPM/LPM flags, auto-approvals, and daily budget.
  - `:set <key> <val>`: Update runtime configuration (e.g. `:set temperature 0.3`, `:set maxSteps 50`, `:set hpmMode true`).
  - `:autoapprove <tool> <true|false>`: Toggle auto-approval for specific tools.
  - `:models` & `:switch-model <modelId>`: Inspect and switch loaded LLM models in LM Studio.
  - `:tripwire reset`: Reset the security tripwire circuit breaker.
- **Task Execution & Approvals:**
  - Type any prompt directly (or `:task <prompt>`): Dispatches to active mode loop.
  - `:interrupt <instructions>`: Inject mid-task directions.
  - `:abort`: Instantly kill active subprocesses and reset agent state to idle.
  - **Interactive Approval Interceptor:** When an action requires approval, the terminal renders a formatted card (`displayApprovalCard`). Type `:y` / `y` / `:approve` to approve, `:n [reason]` / `n [reason]` / `:reject [reason]` to reject, or `:edit <json>` to modify parameters.
- **Diagnostics & Testing:**
  - `:status`: Show current task, steps checklist, thoughts, and executed tools.
  - `:history [n]`: Display last $n$ chat messages.
  - `:health`: Run system health check (`/api/health`).
  - `:eval`: Execute deterministic benchmark evaluation suite (`evals/run_evals.js`).
  - `:clear`: Clear chat history and reset agent.
  - `:exit`: Gracefully shut down server.

#### Start Electron Desktop IDE:
```bash
npm run start:ide
```

#### Run Deterministic Evals:
```bash
npm run eval
```

#### Run in Docker Container:
```bash
docker-compose up --build
```

---

## 🇹🇷 Türkçe Dokümantasyon

### 1. Sistem Genel Bakışı ve Temel Hedef

**Stellarigent**, açık kaynaklı ve üretim seviyesinde bir **Yerel Yapay Zeka Bilgisayar Kullanım Ajanı (Local AI Computer-Use Agent)** platformudur. Herhangi bir bulut aboneliği veya dış API anahtarı zorunluluğu olmadan %100 yerel olarak çalışır. Doğrudan **LM Studio** (veya OpenAI uyumlu herhangi bir yerel REST sunucusu) ile haberleşerek yerel modellere dosya yönetimi, web araştırması, terminal komutları ve yazılım geliştirme kabiliyeti kazandırır.

---

### 2. Kapsamlı Özellik Matrisi

- **%100 Yerel ve Gizli:** Siz bulut yedekliliğini açıkça yapılandırmadıkça hiçbir istem, dosya veya veri bilgisayarınızın dışına çıkmaz.
- **Çift Kullanıcı Arayüzü:**
  - **Modern Web Kontrol Paneli:** Gerçek zamanlı WebSocket durumu, CPU/RAM metrikleri, tekil araç çalıştırma ve konsolide 6 sekmeli ayarlar merkezi.
  - **Electron Masaüstü IDE:** Yerel Monaco kod editörü, dosya ağacı gezgini, ajan görev çubuğu ve dinamik port eşitlemesi sunan bağımsız masaüstü uygulaması.
- **Model Yönlendirme ve Merdiven (Routing & Fallback Ladder):**
  - **Araca Göre Model Değiştirme:** Görevin türüne göre LM Studio'ya uygun modeli otomatik yükletir (Örn: Arama için hızlı model, kodlama için yüklü model).
  - **Model Merdiveni:** Aktif yerel model hata verirse, sistem tanımlanan yerel modeller basamağına (`#1 -> #2 -> #3`) tırmanır.
  - **Model Bazlı Otomatik Mod Eşleme (Auto-Modes):** Model yüklendiğinde LPM, OM, Derin Düşünme ve Görev Planı ayarlarını modele göre otomatik açıp kapatır.
- **Esnek Çalışma Modları:**
  - **Manuel Araçlar:** Task plan gerekmeksizin tek seferlik doğrudan araç çalıştırma.
  - **Research (Web, Local, Deep Web):** Kaynakları tarayan, özetleyen ve atıf ekleyen doğrudan araştırma motorları.
  - **Library Modu (SGM):** Varlık ayrıştırıcı (Entity Router) ve tek atışlık (Single-Shot) upsert mantığıyla `Libraries/` bilgi tabanı yönetimi.
  - **Agent Runner (Swarm Modu):** Çok adımlı projeler için rol değiştirme (**Planlayıcı** $\rightarrow$ **Geliştirici** $\rightarrow$ **QA Testçi**).
- **Gelişmiş Discord Botu:**
  - Uzaktan komut alma (`!ask <istek>`) ve canlı durum bildirimleri.
  - Onay bekleyen işlemlerde (`approve_action` / `reject_action`) ve kural önerilerinde (`approve_rule_<id>` / `reject_rule_<id>`) interaktif butonlarla uzaktan yönetim.
  - Çapraz platform uyumlu ses kanalı müzik çaları (`yt-dlp`).
- **Üretim Kalitesinde Dayanıklı Bellek (`config/memory.json`):**
  - **İki Aşamalı Kırpma (Two-Stage Pruning):** Matematiksel skorlama ($\text{Score} = \text{accessCount} \times 2.0 - \text{age}/72$), 24 saatlik Grace Period koruması (%70 / 35 kural tavanı) ve 50 kural kesin kotası.
  - **Eski Veri Migrasyonu (NaN Koruması):** `normalizeMemoryItem` ile eksik alanları doldurur; `NaN` skor kaynaklı V8 sort çökmelerini engeller.
  - **Sıfır Veri Kaybı RAM Buffer & Acil Tahliye:** Windows EPERM/EBUSY dosya kilitlerinde veriyi RAM'de tutar; süreç kapanırken (`emergencyFlushSync` ile `beforeExit`, `SIGINT`, `SIGTERM`) senkron diske döker.
  - **İnsan Onaylı Kural Damıtma:** Kullanıcı retlerinden damıtılan kurallar izole `pendingRules` havuzuna (max 10, 7 gün TTL) alınır; onaylanmadan yürürlüğe girmez.
- **Manuel AI Köprüsü (Manual AI Bridge):** Yerel model kapalı olduğunda istemleri harici web yapay zekalarına (Gemini, Claude, ChatGPT) kopyala-yapıştır yapabileceğiniz bir formata dönüştürür.
- **Sıkı Güvenlik ve Sandbox Koruması:**
  - **Proje Çekirdek Kalkanı:** Ajanın kaynak kodlarına (`src/**`, `server.js`, `package.json`, `.env`, `config/`) erişmesini sert biçimde engeller.
  - **Programatik Kural İstisna Denetimi:** `checkRuleExceptionMatch` ile `exceptions: []` listesini deterministik olarak doğrular; yanlış pozitif engellemeleri ve model sapmalarını (instruction drift) önler.
  - **Tripwire Devresi:** `agent_user.json` okunduktan sonra ikinci bir dosya okunmaya kalkışılırsa ajanı acil durdurur (`Emergency Halt`), görev bazlı kilit ve manuel sıfırlama butonu içerir.
  - **Web Sanitizer:** Web sayfalarındaki gizli DOM ögelerini ve prompt injection tuzaklarını temizler.
  - **Güvenli Git Staging:** `git add -u` ile yalnızca takip edilen dosyaları commit eder; bellek dosyalarını ve geçici verileri repoya sızdırmaz.

---

### 3. Mimari İnovasyonlar

1. **Entity Router & Single-Shot Upsert (SGM):** Karmaşık cümlelerdeki farklı varlıkları (kişiler, olaylar) bağımsız döngülere böler. `temperature: 0.1` single-shot üretimi ile eski Best-of-N kör döngülerini kaldırarak gecikmeyi sıfırlar.
2. **Delta Patch WebSocket Motoru:** Tüm state ağacı yerine yalnızca değişen kısımları (`state_patch`) 150ms debounce ile ileterek CPU ve ağ tasarrufu sağlar.
3. **5 Katmanlı Araç Çağrı Ayrıştırıcısı:** Markdown kod blokları, ham JSON, XML tag'leri, Qwen sözdizimi ve Heuristic Regex ile küçük modellerde bile araç çağrılarını hatasız ayrıştırır.
4. **Task Plan Muafiyeti (`isNoTaskPlanMode`):** Manuel Araçlar, Research ve Library modlarında yazılım geliştirme checklist zorunluluğunu kaldırır.
5. **Gerçek Zamanlı Harcama Muhasebesi ve Bütçe Devre Kesicisi (`costTracker.js`):** Token tüketimini kesin hesaplar; günlük bulut bütçesi `$1.00` aşıldığında aramaları durdurur.
6. **Sistem Sağlık ve Metrik Takibi:** Her 3 saniyede bir CPU/RAM metrikleri yayını ve `GET /api/health` uç noktası.

---

### 4. Deterministik Eval ve Test Paketi (Benchmark Suite)

Öznel ve doğrulanamayan puanlama tabloları yerine, Stellarigent doğrudan tekrarlanabilir bir **Deterministik Benchmark & Eval Paketi** (`npm run eval` veya `node evals/run_evals.js`) içerir. Bu test paketi, rastgele model çıktılarına veya dış ağ isteklerine bağımlı olmadan ajanın çekirdek davranışlarını doğrular.

| Test Paketi | Senaryo Sayısı | Kapsanan Alt Sistem | Durum |
| :--- | :---: | :--- | :---: |
| **Ayrıştırıcı Dayanıklılığı** | 5 | Markdown kod blokları, ham JSON, XML tag'leri, Qwen sözdizimi, Regex geri çekilmesi | ✅ **BAŞARILI** (5/5) |
| **Güvenlik ve Yalıtım** | 3 | Çekirdek kalkanı (`src/**`), Dizin atlama engeli (`..`), Ağ dışa sızdırma komut yasağı (`curl`, `irm`) | ✅ **BAŞARILI** (3/3) |
| **Tripwire Yaşam Döngüsü** | 2 | Sızdırma girişiminde acil durdurma ve görev bazlı kilit, Manuel tripwire sıfırlama ve kurtarma | ✅ **BAŞARILI** (2/2) |
| **Maliyet ve Kota Takibi** | 2 | Yerel modellerde 0$ kullanım kaydı, Bulut sağlayıcı fiyatlandırma hesabı ve günlük bütçe devresi | ✅ **BAŞARILI** (2/2) |
| **Bellek Kırpma** | 1 | İki aşamalı matematiksel skor, 24 saatlik koruma dönemi, 50 kural kesin kotası | ✅ **BAŞARILI** (1/1) |
| **Genel Skor** | **13 Senaryo** | **Bütüncül Sistem Doğrulaması** | **%100.0 Başarı Oranı** |

Test paketini yerel olarak çalıştırmak için:
```bash
npm run eval
```

---

### 5. Yerel LLM Model Yetenek Seviyeleri

| Tier | Model Sınıfı / Boyutu | Performans ve Değerlendirme |
| :---: | :--- | :--- |
| **` S `** | **Gemini / Claude / GPT** | **Mükemmel**. Kusursuz çok adımlı planlama, mantık yürütme ve araç seçimi. |
| **` A `** | **Devstral Small 2 (24B)** | **Çok Başarılı**. Yüksek araç kullanma kapasitesi, temiz kod üretimi. |
| **` B `** | **Qwen 2.5 Coder (14B)** | **Önerilen Varsayılan**. Harika kod sentaksı, güvenilir JSON, hızlı yanıt. |
| **` C `** | **Gemma 3 (12B)** | **Orta**. Tekli araç çağrılarını düzgün yürütür. |
| **` D `** | **Qwen 2.5 Coder (7B)** | **Kullanılabilir**. Hafif donanımlar için uygundur. |
| **` E `** | **Qwen 2.5 (3B)** | **Zayıf**. Temel araç çağrısı yapar; Manuel AI Köprüsü desteği gerekebilir. |

---

### 6. Modül ve Dizin Haritası

```
.
├── server.js               # Express HTTP ve WebSocket sunucusu, /api/health kontrolü, tripwire sıfırlama API
├── Dockerfile              # Chromium ve Node.js içeren Docker ortamı
├── docker-compose.yml      # Docker konteyner başlatma ayarları
├── package.json            # Bağımlılıklar, eval ve test npm scriptleri
├── README.md               # Çift dilli kapsamlı proje rehberi
├── genel_proje_bilgisi.md  # Detaylı mimari harita ve referans dokümanı
├── agent_readme.md         # Otomatik güncellenen dosya haritası ve görev günlüğü
├── bundle_docs.py          # Tüm dokümantasyonu tek dosyada birleştiren Python betiği
├── bundled_documentation.md# Birleştirilmiş tüm dokümantasyon
├── evals/                  # Deterministik eval ve benchmark test paketi
│   ├── run_evals.js        # Test çalıştırıcı ve markdown rapor üretici
│   ├── scenarios.js        # 5 alt sistemde 13 deterministik test senaryosu
│   └── latest_eval_report.md# En son benchmark yürütme raporu
├── config/                 # Dinamik JSON yapılandırma dosyaları
│   ├── config.json         # Modeller, API merdiveni, model etiketleri, bütçe limiti, mod profilleri
│   ├── security_rules.json # Yasaklı kelimeler, komutlar ve izinli dizinler
│   ├── setup.json          # İlk kurulum sihirbazı durumu
│   ├── memory.json         # Vektörel görev hafızası ve onay bekleyen güvenlik kuralları (50 limit, İki Aşamalı Kırpma)
│   └── system_prompts.json # 16 sistem ve mikro-prompt
├── src/                    # Çekirdek sistem kodları
│   ├── agent.js            # Ana döngü, Swarm geçişleri, tekil araç çalıştırıcı, kural damıtma
│   ├── state.js            # Global state, delta diff patch motoru, harcama metrikleri, geçici hata buffer'ı
│   ├── security.js         # Çekirdek kalkanı, görev bazlı tripwire devresi, resetTripwire, veri sızdırma engeli
│   ├── memory.js           # Asenkron kuyruklu bellek, İki Aşamalı Kırpma, EPERM koruması, güvenli git staging (git add -u)
│   ├── llm/
│   │   ├── llmClient.js    # 5 katmanlı ayrıştırıcı, failover, dinamik sistem promptu, bütçe devre kesicisi
│   │   ├── costTracker.js  # Gerçek zamanlı token ve maliyet takibi, çoklu sağlayıcı tarife kartları, günlük kota
│   │   └── modelManager.js # LM Studio REST API, lms CLI, model routing ve ladder
│   ├── modes/
│   │   └── libraryMode.js  # Entity router, single-shot upsert, kütüphane alt döngüsü
│   ├── security/
│   │   └── webSanitizer.js # Web içeriği temizleme ve prompt injection kalkanı
│   ├── tools/              # 21 temel araç modülü (ortam değişkeni temizleme ve sandbox korumalı)
│   └── discord/            # Discord botu, yt-dlp müzik çalar, onay köprüsü
├── electron/               # Electron Masaüstü IDE
│   ├── main.js             # Electron ana süreci, dinamik PORT okuyucu
│   ├── index.html          # Yerel Monaco Editor arayüzü
│   └── ide.js              # Dosya gezgini ve ajan konsolu
└── WikiLike/               # Obsidian uyumlu derin teknik wiki dokümanları
```

---

### 7. Kullanılabilir Araçlar (Tam 22 Araç Envanteri)

1. **`execute_command`**: Yalıtılmış çalışma alanında ve temizlenmiş ortam değişkenleriyle PowerShell veya Bash çalıştırır.
2. **`open_application`**: Masaüstü uygulamasını veya dosyasını başlatır.
3. **`web_search`**: DuckDuckGo / Yahoo ile web araması yapar.
4. **`view_website`**: Web sayfasını Puppeteer veya Axios ile ziyaret eder ve injection'lardan temizler.
5. **`deep_web_search`**: Çoklu URL araştırması yapar, `llmFetch` ile özetler ve atıflı master rapor çıkarır.
6. **`read_file`**: İzinli sınırlar içindeki dosya içeriğini okur.
7. **`read_pdf`**: PDF belgelerinden metin içeriğini ayrıştırır.
8. **`write_file`**: `scratch/` veya `By_Agent/` içinde dosya oluşturur veya yazar.
9. **`list_directory`**: Klasör içeriğini listeler (Korumalı çekirdek dosyalar maskelenir).
10. **`take_screenshot`**: Masaüstü ekran görüntüsü alır ve `public/` altına kaydeder.
11. **`download_image`**: Web URL'sinden görsel indirir; vision ile doğrular.
12. **`task_plan`**: Görevin adımlarını planlayarak checklist oluşturur.
13. **`select_guide`**: Obsidian kılavuzunu aktif sistem promptuna bağlar.
14. **`task_complete`**: Görevi tamamlar, hafızayı günceller ve güvenli `git add -u && git commit` yürütür.
15. **`generate_workspace_rules`**: `.agent-rules.md` kurallarını otomatik üretir.
16. **`send_discord_message`**: Discord kanalına mesaj veya dosya eki gönderir.
17. **`filter_output`**: Büyük araç çıktılarını satır, URL veya tırnak içeriğine göre filtreler.
18. **`url_image_reader`**: Sayfadaki görselleri vision modeli ile analiz eder.
19. **`extract_chart_data`**: Finansal grafik ve tablo görsellerini JSON koordinat dizisine çevirir.
20. **`line_checker`**: Büyük dosyalarda sorguya uyan satırları token tasarrufuyla listeler.
21. **`library_mode`**: `Libraries/` dizinindeki bilgi tabanında semantik arama yapar.
22. **`notify_user`**: Görev tamamlanması, hata veya uyarı durumlarında işletim sistemi masaüstü toast bildirimi (Windows PowerShell balloon, macOS osascript, Linux notify-send) gönderir.

---

### 8. Kullanıcı Arayüzleri: Web Paneli ve Electron IDE

#### Web Paneli (`http://localhost:3000`)
- **Sol Akordeon Menü:** **Manuel Tools**, **Research**, **Library** ve **Agent Runner** modları arasında hızlı geçiş, anlık Token ve Tahmini Maliyet göstergeleri.
- **Konsolide 6 Sekmeli Ayarlar Merkezi:**
  1. `Guide Manager`: Özel çalışma kılavuzları için Markdown editörü.
  2. `Models & Routing`: **LM Studio** yerel uç nokta ve etiketleme, **Bulut API Anahtarları** (OpenAI, Anthropic, Gemini, Groq) ve **Model Yönlendirme / Merdiveni** için alt sekmeli birleşik merkez.
  3. `Prompts`: 16 sistem promptu için canlı düzenleyici, sıfır yedekli doğrudan kayıt ve akış şeması (`system_prompts_algorithm.svg`).
  4. `Auto & Budget`: Araç bazlı otomatik onay izinleri, LPM ayarları ve günlük bulut harcama limiti (`maxDailyCostUSD`).
  5. `Discord`: Token, Kurucu ID, hız limitleri ve yetkili kullanıcı listesi.
  6. `Security & Perm`: Yasaklı kabuk komutları kara listesi yönetimi ve Güvenlik Tripwire kilidini sıfırlama butonu.

#### Electron Masaüstü IDE (`npm run start:ide`)
- Yerel `node_modules/monaco-editor` ile tamamen offline çalışan Monaco Editor.
- `.env` dosyasındaki `PORT` ile otomatik senkronizasyon.
- Entegre dosya ağacı ve ajan görev çubuğu.

---

### 9. Kurulum Gereksinimleri

1. **Node.js** (v18.0.0 veya üzeri).
2. **LM Studio** kurulu ve API Sunucusu açık (`http://localhost:1234`).
3. Web taramaları için bilgisayarda **Google Chrome / Chromium**.
4. *(İsteğe Bağlı)* Discord Bot Tokenı ve Kurucu Discord Kullanıcı ID'si.

---

### 10. Yapılandırma Rehberi (Adım Adım)

#### 1. Adım: `.env` Dosyası Oluşturma
```bash
cp .env.example .env
```
Gerekli alanları doldurun:
```env
PORT=3000
FOUNDER_KEY=PANEL_SIFRENIZ
DISCORD_TOKEN=BOT_TOKENINIZ
FOUNDER_DISCORD_ID=DISCORD_KULLANICI_IDNIZ
```

#### 2. Adım: Bağımlılıkları Yükleme
```bash
npm install
```

---

### 11. Uygulamayı Çalıştırma ve Docker

#### Web Panelini, Arka Planı ve İnteraktif Terminal CLI'yı Başlatma:
```bash
npm start
```
Tarayıcınızdan `http://localhost:3000` adresine gidebilir veya sistemi doğrudan konsol üzerinden **İnteraktif Terminal Kontrolcüsü** ile yönetebilirsiniz!

#### 💻 İnteraktif Konsol / Terminal Kontrolcüsü (Terminal CLI)
`npm start` çalıştırıldığında arkaplanda Express ve WebSocket çalışırken standart girdi/çıktı üzerinde dinamik bir komut istemcisi (`Stellarigent [mod/alt-mod | durum]> `) devreye girer. Hem geliştirici hem de test otomasyonu sistemi konsoldan bütünüyle kontrol edebilir:

- **Menüler ve Modlar Arası Geçiş:**
  - `:menu` veya `:help`: Kullanılabilir tüm komut ve modları listeler.
  - `:mode <agent|manuel|research|library>`: Otonom Swarm Geliştirici, Doğrudan Araç Yürütme, Web/Yerel Araştırma ve Hafıza Yönetimi modları arasında geçiş yapar.
  - `:submode <ad>`: Alt modu belirler (örn: `cmd_tool`, `file_reader`, `file_writer`, `deep_web`, `web`).
- **Ayar Yapılandırma ve Çalışma Zamanı Değişiklikleri:**
  - `:settings` veya `:config`: LM Studio adresi, aktif model, sıcaklık, maksimum adım, HPM/LPM durumları ve bütçe metriklerini formatlı ASCII tablosunda gösterir.
  - `:set <anahtar> <değer>`: Ayarları anında günceller (örn: `:set temperature 0.3`, `:set maxSteps 50`, `:set hpmMode true`).
  - `:autoapprove <araç> <true|false>`: Belirli araçlar için otomatik onay iznini açar veya kapatır.
  - `:models` & `:switch-model <modelId>`: LM Studio'da yüklü modelleri listeler ve aktif modeli anında değiştirir.
  - `:tripwire reset`: Güvenlik Tripwire devre kesicisini anında sıfırlar.
- **Görev Yürütme, Müdahale ve Onay:**
  - Komut satırına doğrudan herhangi bir görev yazmak (veya `:task <metin>`): Aktif modda görevi hemen başlatır.
  - `:interrupt <talimat>`: Görev yürütülürken araya yeni talimat enjekte eder.
  - `:abort`: Çalışan görevi ve işletim sistemi alt süreçlerini derhal sonlandırır.
  - **İnteraktif Araç Onay Kartı:** Bir araç onay beklediğinde (`pending_approval`) terminalde renkli onay kutusu çıkar (`displayApprovalCard`). Onaylamak için `y` / `:approve`, reddetmek için `n [gerekçe]` / `:reject [gerekçe]`, parametre değiştirmek için `:edit <json>` yazılır.
- **Teşhis ve Sistem Doğrulama:**
  - `:status`: Anlık durum, görev adımları kontrol listesi, son düşünceler ve çalıştırılan araçları gösterir.
  - `:history [n]`: Son $n$ sohbet mesajını döker.
  - `:health`: Sistem sağlık kontrolünü (`/api/health`) çalıştırır.
  - `:eval`: 13 senaryolu deterministik benchmark test paketini (`npm run eval`) doğrudan konsolda koşturur.
  - `:clear`: Sohbet geçmişini temizler ve ajanı sıfırlar.
  - `:exit` veya `:quit`: Sunucuyu kapatıp çıkar.

#### Electron Masaüstü IDE'yi Başlatma:
```bash
npm run start:ide
```

#### Deterministik Benchmark Testlerini Çalıştırma:
```bash
npm run eval
```

#### Docker İle Çalıştırma:
```bash
docker-compose up --build
```

---

## 📜 License

This project is open-source software available under the **MIT License**.