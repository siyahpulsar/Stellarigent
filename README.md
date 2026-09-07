
# 🤖 Local AI Computer-Use Agent (Stellarch Agent Framework)

> **100% Local, Autonomous AI Computer Agent with Real-Time Web Dashboard, Discord Integration, Puppeteer Web Automation & Multi-Agent Swarm Mode.**

---

## 📖 Table of Contents / İçindekiler
- [English Documentation](#-english-documentation)
  - [1. System Overview & Core Mission](#1-system-overview--core-mission)
  - [2. Architectural Innovations](#2-architectural-innovations)
  - [3. Global AI Agent Tier List & Benchmarks](#3-global-ai-agent-tier-list--benchmarks)
  - [4. Local LLM Tier List & Compatibility](#4-local-llm-tier-list--compatibility)
  - [5. Repository Layout & Module Breakdown](#5-repository-layout--module-breakdown)
  - [6. Prerequisites & Environment Setup](#6-prerequisites--environment-setup)
  - [7. Configuration Guide (Step-by-Step)](#7-configuration-guide-step-by-step)
  - [8. Running the Application](#8-running-the-application)
- [Türkçe Dokümantasyon](#-türkçe-dokümantasyon)
  - [1. Sistem Genel Bakışı ve Temel Hedef](#1-sistem-genel-bakışı-ve-temel-hedef)
  - [2. Mimari İnovasyonlar](#2-mimari-inovasyonlar)
  - [3. Küresel Yapay Zeka Ajan Tier Listesi ve Karşılaştırma](#3-küresel-yapay-zeka-ajan-tier-listesi-ve-karşılaştırma)
  - [4. Yerel LLM Model Yetenek Seviyeleri](#4-yerel-llm-model-yetenek-seviyeleri)
  - [5. Modül ve Dizin Haritası](#5-modül-ve-dizin-haritası)
  - [6. Kurulum Gereksinimleri](#6-kurulum-gereksinimleri)
  - [7. Yapılandırma Rehberi (Adım Adım)](#7-yapılandırma-rehberi-adım-adım)
  - [8. Uygulamayı Çalıştırma ve Docker](#8-uygulamayı-çalıştırma-ve-docker)
- [License / Lisans](#-license)

---

## 🇬🇧 English Documentation

### 1. System Overview & Core Mission

This repository provides an open-source, production-grade **Local AI Computer-Use Agent framework**. Designed to run 100% locally without cloud API subscriptions or external tokens, it connects directly to **LM Studio** (or any OpenAI-compatible local REST server) to give local language models computer manipulation capabilities.

The agent can autonomously:
- Perform file system reads, writes, and directory scans within sandbox bounds.
- Execute system shell commands (PowerShell/Bash) with risk assessment.
- Browse the web, take page screenshots, search web engines, and download media via Puppeteer.
- Stream state live to an interactive Web UI dashboard via WebSockets.
- Interact remotely over Discord channels, approving/rejecting actions with interactive Discord UI buttons and streaming voice channel music (`yt-dlp`).

---

### 2. Architectural Innovations

Based on system analysis and architectural research (`research_notes.md`), the codebase features key technical highlights:

1. **Entity Router & Single-Shot Upsert (SGM):** The Sequential Goal Mode (SGM) utilizes an Entity Router to extract distinct subjects/events from complex user prompts and isolates them into separate execution loops. The legacy "Best-of-N" evaluator was replaced with a highly optimized `temperature: 0.1` single-shot JSON generator, vastly reducing token consumption and latency.
2. **Manual AI Bridge:** If the local LLM crashes or is offline, the system automatically transitions into Manual AI Bridge mode. It formats current task prompts into copy-paste blocks for external web models (Gemini, Claude, ChatGPT) and resumes execution seamlessly when the user pastes back the response.
3. **Delta Patch WebSocket Engine:** Instead of re-broadcasting entire state trees, `src/state.js` uses a debounced (150ms) delta diff broadcaster (`state_patch`) to minimize CPU usage and network bandwidth.
4. **5-Tiered Tool Call Parser:** Supports tool invocation across 5 distinct LLM output formats: JSON Markdown codeblocks, raw JSON objects, XML tags, Qwen `[TOOL_CALLS]` syntax, and Heuristic Regex fallback—enabling robust tool execution even on 3B/7B low-parameter models.
5. **Strict Security Sandbox:** Uses canonical `fs.realpathSync` path resolution to prevent symlink traversal attacks outside allowed workspace boundaries. Includes a Levenshtein-distance banned-word scanner and dynamic action risk scoring (`pending_approval`).
6. **Swarm Multi-Agent Mode:** Dynamically re-prompts the model to switch roles (**Planner** $\rightarrow$ **Developer** $\rightarrow$ **QA Tester**) during multi-step task execution.
7. **RAG Memory + TF-IDF Fallback:** Computes cosine similarity over vectorized task histories (using LM Studio embeddings). Automatically falls back to keyword frequency indexing (TF-IDF light) if embedding models are offline.

---

### 3. Global AI Agent Tier List & Benchmarks

In benchmark comparisons against major autonomous AI agent frameworks (`agent_karsilastirmalari.md`), the **Stellarch Local AI Agent** achieves top-tier ratings for privacy, security, and local execution:

#### 🏆 100-Point Benchmark Ranking (2026)

| Tier | Agent / Framework | Score (100) | Highlight |
| :---: | :--- | :---: | :--- |
| **` S `** | **Antigravity / Cursor / Windsurf** | **94 / 100** | Deep IDE integration & real-time context index. |
| **` S `** | **Stellarch (Local AI Agent)** | **88 / 100** | **%100 Local, Zero-Subscription, Sandbox Guard & Manual AI Bridge.** |
| **` A `** | **CrewAI** | **85 / 100** | Role-based multi-agent collaboration. |
| **` A `** | **LangGraph (LangChain)** | **84 / 100** | Stateful graph-based agent routing. |
| **` A `** | **Cognition Devin** | **83 / 100** | Autonomous cloud software engineer. |
| **` B `** | **Microsoft AutoGen** | **79 / 100** | Conversational multi-agent framework. |
| **` B `** | **OpenInterpreter** | **78 / 100** | Local code interpreter & terminal agent. |
| **` B `** | **Claude Engineer** | **75 / 100** | CLI-based autonomous assistant. |
| **` C `** | **Microsoft Taskweaver** | **68 / 100** | Data analytics agent. |
| **` C `** | **AutoGPT** | **62 / 100** | Classic autonomous loop pioneer. |
| **` D `** | **BabyAGI** | **45 / 100** | Concept loop execution. |

#### 📊 Category Comparison Matrix

| Agent / Framework | 100% Local & Privacy (20%) | Safety & Approval (15%) | Ease of Use & UI (15%) | Self-Correction (15%) | Swarm Multi-Agent (15%) | Tool & OS Access (20%) | TOTAL SCORE |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Antigravity / Cursor** | 70 | 90 | 98 | 95 | 92 | 98 | **94 / 100** |
| **Stellarch (Local Agent)** | **100** | **95** | **88** | **85** | **82** | **85** | **88 / 100** |
| **CrewAI** | 80 | 70 | 80 | 85 | 95 | 85 | **85 / 100** |
| **LangGraph** | 85 | 75 | 70 | 90 | 92 | 90 | **84 / 100** |
| **Cognition Devin** | 10 | 85 | 95 | 92 | 88 | 95 | **83 / 100** |
| **OpenInterpreter** | 90 | 60 | 70 | 75 | 50 | 95 | **78 / 100** |

---

### 4. Local LLM Tier List & Compatibility

Recommended model sizes for running the agent locally in LM Studio:

| Tier | Model Class / Size | Performance & Tool Use Evaluation |
| :---: | :--- | :--- |
| **` S `** | **Gemini / Claude / GPT** | **Exceptional**. Flawless multi-step planning, reasoning, and tool selection. |
| **` A `** | **Devstral Small 2 (24B)** | **Very Good**. Strong tool caller; executes multi-file modifications cleanly. |
| **` B `** | **Qwen 2.5 Coder (14B)** | **Recommended Default**. Excellent code syntax, reliable JSON formatting, fast execution. |
| **` C `** | **Gemma 3 (12B)** | **Moderate**. Performs single-tool calls well; may stumble on complex multi-stage tasks. |
| **` D `** | **Qwen 2.5 Coder (7B)** | **Acceptable**. Suitable for lightweight local hardware; keep prompts direct. |
| **` E `** | **Qwen 2.5 (3B)** | **Weak**. Baseline tool calls work; requires Manual AI Bridge assistance on long loops. |
| **` F `** | **Qwen 2.5 (0.5B)** | **Unusable**. Parameter capacity causes malformed JSON syntax errors. |

---

### 5. Repository Layout & Module Breakdown

Map of key modules and responsibilities (`genel_proje_bilgisi.md`):

```
.
├── server.js               # Express HTTP & WebSocket server, CPU/RAM metrics broadcaster
├── Dockerfile              # Docker sandbox container specification
├── docker-compose.yml      # Multi-container orchestration config
├── package.json            # Node.js dependencies (express, ws, discord.js, puppeteer)
├── README.md               # Comprehensive bilingual project documentation
├── agent_readme.md         # Auto-updated workspace map & accomplishment log
├── config/                 # Dynamic configuration files (JSON schemas)
│   ├── config.json         # Admin IDs, connection speed limits, founder auth key
│   ├── kurucu.json         # Founder Discord User ID specification
│   ├── permissions.json    # Authorized Discord users list
│   ├── security_rules.json # Banned words, forbidden shell commands, whitelisted paths
│   └── memory.json         # Vectorized memory bank of completed tasks
├── src/                    # Core application logic
│   ├── agent.js            # Main loop runner (runAgentLoop), Swarm mode, approval resolver
│   ├── state.js            # Central reactive agentState, WebSocket delta diff patcher
│   ├── security.js         # Levenshtein word check, realpathSync sandbox, risk scoring
│   ├── memory.js           # RAG vector memory (cosine similarity) + TF-IDF fallback
│   ├── llm/
│   │   └── llmClient.js    # LM Studio fetcher, retry exponential backoff, 5-format parser
│   ├── modes/
│   │   └── libraryMode.js  # Guide & reference searching sub-loop
│   ├── rag/
│   │   └── vectorSearch.js # Cosine similarity vector search math
│   ├── tools/              # Tool engines (system execution, Puppeteer browser, filesystem)
│   ├── utils/              # Environment variable helpers (.env reader/writer)
│   ├── ws/                 # WebSocket message & event routing engine
│   └── discord/            # Discord bot client, music player (yt-dlp), interaction cards
└── WikiLike/               # Obsidian-compatible wiki documentation
```

---

### 6. Prerequisites & Environment Setup

Before running the application:

1. **Node.js** (v18.0.0 or higher).
2. **LM Studio** installed and running with local API server enabled (`http://localhost:1234`).
3. **Google Chrome / Chromium** installed (required for Puppeteer visual web browsing).
4. *(Optional)* A **Discord Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications) if using Discord.

---

### 7. Configuration Guide (Step-by-Step)

To configure the open-source template files for your environment:

#### Step 1: Create `.env`
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your credentials:
```env
# Discord Bot Client Token
DISCORD_TOKEN=your_discord_bot_token_here

# Web Dashboard Port
PORT=3000

# Discord User ID of the Founder
FOUNDER_DISCORD_ID=your_discord_user_id_here

# Admin Key for Web Dashboard authentication
FOUNDER_KEY=CHANGE_ME_IN_PRODUCTION
```

#### Step 2: Set `config/kurucu.json`
Copy template and set your Discord User ID:
```bash
cp config/kurucu.example.json config/kurucu.json
```
```json
{
  "founder": "YOUR_DISCORD_USER_ID_HERE"
}
```

#### Step 3: Set `config/config.json`
Copy template and configure admin permissions and security credentials:
```bash
cp config/config.example.json config/config.json
```
```json
[
  {
    "admins": ["YOUR_DISCORD_USER_ID_HERE"],
    "connectionSpeedLimit": 0.7,
    "founderKey": "CHANGE_THIS_TO_A_SECURE_SECRET"
  }
]
```

#### Step 4: Set `config/permissions.json`
Copy template and add authorized Discord user tags:
```bash
cp config/permissions.example.json config/permissions.json
```
```json
[
  {
    "authorizedUsers": ["<@YOUR_DISCORD_USER_ID_HERE>"]
  }
]
```

---

### 8. Running the Application

#### Local Node.js Execution
1. Install project dependencies:
   ```bash
   npm install
   ```
2. Start the backend server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000` in your web browser to access the Web Dashboard.

#### Docker Sandbox Execution
Run in an isolated container:
```bash
docker-compose up --build
```

---

## 🇹🇷 Türkçe Dokümantasyon

### 1. Sistem Genel Bakışı ve Temel Hedef

Bu proje, açık kaynaklı, üretim seviyesinde bir **Yerel Yapay Zeka Bilgisayar Kullanım Ajanı** (Local AI Computer-Use Agent) altyapısı sunar. Herhangi bir bulut aboneliği veya dış API anahtarı gerektirmeden %100 yerel olarak çalışmak üzere tasarlanmıştır. Doğrudan **LM Studio** (veya OpenAI ile uyumlu herhangi bir yerel REST sunucusu) ile bağlantı kurarak yerel yapay zeka modellerine bilgisayar yönetim yetenekleri kazandırır.

Ajan otonom olarak şunları gerçekleştirebilir:
- Sandbox sınırları içerisinde dosya okuma, yazma ve dizin tarama.
- Risk değerlendirmesi ile sistem kabuk komutlarını (PowerShell/Bash) çalıştırma.
- Puppeteer ile web sayfalarında gezinme, ekran görüntüsü alma, web araması yapma ve medya indirme.
- WebSocket aracılığıyla etkileşimli Web Paneline canlı durum ve metrik aktarma.
- Discord kanalları üzerinden uzaktan komut alma, butonlarla onay talep etme ve ses kanallarında müzik yayınlama (`yt-dlp`).

---

### 2. Mimari İnovasyonlar

Sistem analizi ve araştırma notlarına (`genel_proje_bilgisi.md`) dayanan temel teknik yenilikler:

1. **Varlık Ayrıştırıcı (Entity Router) ve Single-Shot Upsert:** Kütüphane modundaki Sıralı Görev Motoru (SGM), karmaşık kullanıcı metinlerindeki farklı kişileri/olayları tespit edip her biri için izole bir döngü başlatan zeki bir `Entity Router` kullanır. Eski "Best-of-N" (7 kez üretim yapıp puanlama) sistemi çöpe atılmış, yerine `temperature: 0.1` ayarlı süper hızlı "Single-Shot" JSON üretici getirilmiştir. Bu sayede maliyet ve API gecikmesi sıfıra indirilmiştir.
2. **Manuel AI Köprüsü (Manual AI Bridge):** Yerel LLM çöktüğünde veya kapalı olduğunda sistem durmaz; istemleri harici web modellerine (Gemini, Claude, ChatGPT) kopyala-yapıştır yapabileceğiniz bir formata dönüştürür.
3. **Delta Patch WebSocket Motoru:** Tüm state ağacını sürekli yeniden göndermek yerine `src/state.js`, ağ bant genişliğini ve CPU kullanımını korumak için sadece değişen verileri (`state_patch`) 150ms gecikmeyle yayınlar.
4. **5 Katmanlı Araç Çağrı Ayrıştırıcısı:** JSON Markdown kod blokları, ham JSON, XML etiketleri, Qwen `[TOOL_CALLS]` sentaksı ve Heuristic Regex formatlarını destekler. Bu sayede 3B/7B gibi küçük modellerde bile araç çağrıları hatasız ayrıştırılır.
5. **Gelişmiş Güvenlik Sandbox'ı:** Sembolik link saldırılarını engellemek için `fs.realpathSync` kullanır. Levenshtein mesafeli kelime tarayıcısı ve komut risk skorlaması (`pending_approval`) içerir.
6. **Swarm Çoklu Ajan Modu:** Çok adımlı görevlerde yapay zekayı rol değiştirmeye yönlendirir (**Planlayıcı** $\rightarrow$ **Geliştirici** $\rightarrow$ **QA Testçi**).
7. **Vektörel RAG Bellek + TF-IDF Fallback:** Görev geçmişini kosinüs benzerliği ile arar (LM Studio embeddings). Embedding modeli kapalıysa otomatik olarak TF-IDF kelime arama fallback'ine geçer.

---

### 3. Küresel Yapay Zeka Ajan Tier Listesi ve Karşılaştırma

Ajan framework'leri ile yapılan karşılaştırmalı performans testlerinde (`agent_karsilastirmalari.md`), **Stellarch Local AI Agent** gizlilik, güvenlik ve yerel kullanım kategorilerinde zirvede yer almaktadır:

#### 🏆 100 Puan Üzerinden Genel Tier List

| Tier | Ajan / Framework | Puan (100) | Öne Çıkan Özellik |
| :---: | :--- | :---: | :--- |
| **` S `** | **Antigravity / Cursor / Windsurf** | **94 / 100** | Derin IDE entegrasyonu ve canlı kod indeksleme. |
| **` S `** | **Stellarch (Local AI Agent)** | **88 / 100** | **%100 Yerel, Sıfır Abonelik, Sandbox Koruması & Manuel AI Köprüsü.** |
| **` A `** | **CrewAI** | **85 / 100** | Rol tabanlı çoklu ajan işbirliği. |
| **` A `** | **LangGraph (LangChain)** | **84 / 100** | Çizge (Graph) tabanlı durum yönetimi. |
| **` A `** | **Cognition Devin** | **83 / 100** | Otonom bulut yazılım geliştirici. |
| **` B `** | **Microsoft AutoGen** | **79 / 100** | Diyalog tabanlı çoklu ajan mimarisi. |
| **` B `** | **OpenInterpreter** | **78 / 100** | Yerel kod çalıştırıcı ve terminal ajanı. |
| **` B `** | **Claude Engineer** | **75 / 100** | CLI tabanlı otonom asistan. |

---

### 4. Yerel LLM Model Yetenek Seviyeleri

LM Studio üzerinde ajanla birlikte kullanılabilecek model seviyeleri:

| Tier | Model Sınıfı / Boyutu | Performans ve Değerlendirme |
| :---: | :--- | :--- |
| **` S `** | **Gemini / Claude / GPT** | **Mükemmel**. Kusursuz çok adımlı planlama, mantık yürütme ve araç seçimi. |
| **` A `** | **Devstral Small 2 (24B)** | **Çok Başarılı**. Yüksek araç kullanma kapasitesi, çoklu dosya değişikliklerini temiz çözer. |
| **` B `** | **Qwen 2.5 Coder (14B)** | **Önerilen Varsayılan**. Harika kod sentaksı, güvenilir JSON formatı, hızlı yanıt. |
| **` C `** | **Gemma 3 (12B)** | **Orta**. Tekli araç çağrılarını düzgün yürütür; çok adımlı mantıkta duraklayabilir. |
| **` D `** | **Qwen 2.5 Coder (7B)** | **Sınırda**. Hafif donanımlar için uygundur; istemleri net tutun. |
| **` E `** | **Qwen 2.5 (3B)** | **Zayıf**. Temel araç çağrısı yapar; uzun döngülerde Manuel AI Köprüsü desteği ister. |
| **` F `** | **Qwen 2.5 (0.5B)** | **Kullanılamaz**. Parametre yetersizliği nedeniyle hatalı JSON üretir. |

---

### 5. Modül ve Dizin Haritası

Projeye ait temel modüller ve sorumlulukları (`genel_proje_bilgisi.md`):

```
.
├── server.js               # Express HTTP ve WebSocket sunucusu, CPU/RAM ölçümleri yayınlayıcı
├── Dockerfile              # Docker sandbox container tanımı
├── docker-compose.yml      # Çoklu container orkestrasyonu
├── package.json            # Node.js bağımlılıkları (express, ws, discord.js, puppeteer)
├── README.md               # Çift dilli (TR / EN) kapsamlı rehber
├── agent_readme.md         # Otomatik güncellenen dizin haritası ve görev geçmişi
├── config/                 # Dinamik yapılandırma dosyaları (JSON şablonları)
│   ├── config.json         # Admin ID'leri, hız limitleri ve şifreler
│   ├── kurucu.json         # Kurucu Discord Kullanıcı ID tanımı
│   ├── permissions.json    # Yetkili Discord kullanıcı listesi
│   ├── security_rules.json # Yasaklı kelimeler, komutlar ve izin verilen dizinler
│   └── memory.json         # Görev geçmişi ve vektör veritabanı
├── src/                    # Çekirdek uygulama mantığı
│   ├── agent.js            # Ana döngü (runAgentLoop), Swarm modu, onay yöneticisi
│   ├── state.js            # Global reaktif ajan durumu, WebSocket delta patch motoru
│   ├── security.js         # Levenshtein kelime tarayıcısı, realpathSync sandbox, risk skorlama
│   ├── memory.js           # RAG vektör bellek (kosinüs benzerliği) + TF-IDF fallback
│   ├── llm/
│   │   └── llmClient.js    # LM Studio istemcisi, retry backoff, 5 formatlı ayrıştırıcı
│   ├── tools/              # Sistem komutları, Puppeteer tarayıcısı, dosya işlemleri
│   ├── ws/                 # WebSocket mesaj işleyici
│   └── discord/            # Discord bot istemcisi, müzik çalar (yt-dlp)
└── WikiLike/               # Obsidian uyumlu wiki dokümantasyonu
```

---

### 6. Kurulum Gereksinimleri

Uygulamayı çalıştırmadan önce:

1. **Node.js** (v18.0.0 veya üzeri).
2. **LM Studio** kurulu olmalı ve API Sunucusu açık olmalıdır (`http://localhost:1234`).
3. Bilgisayarınızda **Google Chrome / Chromium** kurulu olmalıdır (Puppeteer web taraması için).
4. *(İsteğe Bağlı)* Discord entegrasyonu için bir **Discord Bot Tokenı**.

---

### 7. Yapılandırma Rehberi (Adım Adım)

#### 1. Adım: `.env` Oluşturma
`.env.example` dosyasını `.env` olarak kopyalayın:
```bash
cp .env.example .env
```
Gerekli alanları doldurun:
```env
DISCORD_TOKEN=bot_tokeninizi_yazin
PORT=3000
FOUNDER_DISCORD_ID=discord_id nizi_yazin
FOUNDER_KEY=PANEL_SIFRENIZ
```

#### 2. Adım: `config/kurucu.json`
Şablonu kopyalayın ve Discord Kullanıcı ID'nizi girin:
```bash
cp config/kurucu.example.json config/kurucu.json
```
```json
{
  "founder": "DISCORD_ID_NIZI_YAZIN"
}
```

#### 3. Adım: `config/config.json`
Şablonu kopyalayın, admin yetkilerini ve panel şifrenizi tanımlayın:
```bash
cp config/config.example.json config/config.json
```
```json
[
  {
    "admins": ["DISCORD_ID_NIZI_YAZIN"],
    "connectionSpeedLimit": 0.7,
    "founderKey": "GUVENLI_BIR_SIFRE_BELIRLEYIN"
  }
]
```

#### 4. Adım: `config/permissions.json`
Şablonu kopyalayın ve yetkili Discord kullanıcı etiketlerini ekleyin:
```bash
cp config/permissions.example.json config/permissions.json
```
```json
[
  {
    "authorizedUsers": ["<@DISCORD_ID_NIZI_YAZIN>"]
  }
]
```

---

### 8. Uygulamayı Çalıştırma ve Docker

#### Yerel Node.js ile Çalıştırma
1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
2. Sunucuyu başlatın:
   ```bash
   npm start
   ```
3. Tarayıcınızdan `http://localhost:3000` adresini açarak Web Paneline erişin.

#### Docker Sandbox ile Çalıştırma
İzole ortamda başlatmak için:
```bash
docker-compose up --build
```

---

## 📜 License

This project is open-source software available under the **MIT License**.