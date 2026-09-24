# Stellarigent Project Workspace

## Directory Structure
```
.
├── server.js               # Express HTTP & WebSocket server, health checks, CPU/RAM metrics, setup & tripwire reset API
├── Dockerfile              # Isolated container specifications with Chromium & Node.js
├── docker-compose.yml      # Docker container orchestration
├── package.json            # Dependencies, eval and test npm scripts
├── README.md               # Bilingual comprehensive project guide (22 tools, CLI, Docker)
├── genel_proje_bilgisi.md  # Core architectural reference map & function-by-function breakdown
├── agent_readme.md         # Auto-updated workspace map & accomplishment log
├── agent_user.json         # Honeypot security tripwire bait file
├── evals/                  # Deterministic evaluation, benchmark, regression & trend suite
│   ├── run_evals.js        # Benchmark runner and markdown report generator (npm run eval)
│   ├── scenarios.js        # 13 deterministic test scenarios across 5 system areas
│   ├── system_regression_suite.js # 17-step master regression suite across 9 subsystems (npm run test:system)
│   ├── trend_report.js     # Historical benchmark tracking & delta pass-rate reporting (npm run eval:trend)
│   ├── test_library_12_persons.js # 12-person complex library profiling and multi-criteria subloop test
│   ├── test_local_research.js     # 3-tier offline local document research validation test
│   └── latest_eval_report.md      # Latest benchmark execution report (100% pass rate)
├── WikiLike/               # Comprehensive Obsidian-compatible Project Wiki
│   ├── Algorithms.md       # Core algorithms, state machine, 5-tier parser, formulas, tripwire & checkpoint
│   ├── Architecture.md     # High-level architecture, transport layer, REST & WebSocket API, CLI & containers
│   ├── CLI_and_Testing.md  # Terminal controller manual, REPL commands, benchmark & regression suites
│   ├── Checkpoint_and_Recovery.md # Task checkpointing, atomic serialization, 24h TTL, resume protocol
│   ├── Deep_Research.md    # Multi-source web research pipeline, sanitizer, micro-summaries & citations
│   ├── Memory_and_SGM.md   # 3-tier memory hierarchy, 2-stage pruning, SGM entity router, single-shot upsert
│   ├── Security_and_Tripwire.md # 9-layer defense-in-depth, core shield, sanitized env, tripwire circuit breaker
│   ├── Settings_and_Permissions.md # 6-panel settings center, segmented models hub, prompts SVG flow, budget cap
│   ├── Tools.md            # Complete 22 tools catalog with schemas, risks, and JSON examples
│   └── Workflows.md        # Operational end-to-end workflows (task init, swarm, manual, approval, closing)
├── config/                 # Dynamic system configuration schemas
│   ├── config.example.json # Template for admins, fallbacks, model tags, ladder, budget cap, and mode profiles
│   ├── kurucu.example.json # Template for founder discord ID
│   ├── permissions.example.json # Template for authorized user IDs
│   ├── setup.example.json  # Setup wizard initial state template
│   ├── security_rules.json # Banned words, forbidden commands, allowed folders, tripwire files
│   ├── system_prompt.txt   # Primary autonomous agent system prompt
│   └── system_prompts.json # 16 dynamic system and micro-prompts
├── public/                 # Web dashboard frontend
│   ├── index.html          # Two-pane interface, chat, metrics, approval drawer, settings subpanels
│   ├── app.js              # WebSocket connection, state synchronization, message rendering
│   ├── settings.js         # Settings controller, guide editor, model router, prompt editor
│   ├── setup.js            # First-run setup wizard logic
│   ├── setup.css           # Setup modal styles
│   ├── style.css           # Modern dark-mode UI stylesheet
│   └── assets/             # System prompts algorithm diagram (SVG, PNG, JPG)
├── electron/               # Desktop IDE application
│   ├── main.js             # Electron main process, auto server spawner, port synchronizer
│   ├── ide.js              # Local Monaco editor, file explorer, task runner
│   ├── ide.css             # IDE desktop stylesheet
│   ├── index.html          # Desktop IDE layout
│   └── preload.js          # IPC bridge
├── src/                    # Core system logic
│   ├── agent.js            # Main loop runner (runAgentLoop), Swarm switcher, manual tool runner, rule distillation
│   ├── state.js            # Central reactive state, delta diff patcher, cost metrics, transient error buffer
│   ├── security.js         # Core shield, task-scoped tripwire, resetTripwire, egress command blocking
│   ├── memory.js           # Production memory queue, Two-Stage Pruning, EPERM backoff, safe git staging
│   ├── checkpoint.js       # Atomic task checkpointing & resume engine (scratch/checkpoints/)
│   ├── logger.js           # Process and error logger
│   ├── cli/
│   │   └── terminalController.js # Full-featured interactive terminal REPL with colored approval boxes
│   ├── discord/
│   │   ├── agentBridge.js  # Discord status sync, interactive approval buttons, rule cards
│   │   ├── client.js       # Discord.js bot gateway connection
│   │   ├── commands.js     # Command parser (!help, !play, !queue, !lpm, !forcetaskplan, etc.)
│   │   ├── musicPlayer.js  # yt-dlp voice channel music player
│   │   ├── state.js        # Discord bot state
│   │   └── utils.js        # Admin & auth utilities
│   ├── lib/
│   │   └── keywordIndex.js # Keyword search index helper
│   ├── llm/
│   │   ├── costTracker.js  # Real-time token accounting & daily budget circuit breaker ($1.00 USD)
│   │   ├── llmClient.js    # Multi-provider client, 5-tier parser, dynamic env prompt
│   │   ├── modelManager.js # LM Studio /api/v1/models/load manager, in-flight promise lock, ladder
│   │   └── performanceTracker.js # Adaptive Model Performance Router (AMPR) EWMA engine
│   ├── modes/
│   │   └── libraryMode.js  # SGM Entity Router, Single-Shot Upsert, inverted index & library search subloop
│   ├── rag/
│   │   └── vectorSearch.js # Cosine similarity embedding search
│   ├── security/
│   │   └── webSanitizer.js # Web scraping decontaminator (anti-prompt injection, hidden DOM removal)
│   ├── tools/
│   │   ├── filesystem.js   # File reading, writing, and directory listing within sandboxes
│   │   ├── filters.js      # Output filtering and targeted line checking
│   │   ├── image.js        # Image downloading, vision analysis, and chart extraction
│   │   ├── notify.js       # Cross-platform desktop toast notifications (Windows, macOS, Linux)
│   │   ├── pdfReader.js    # PDF text extraction
│   │   ├── system.js       # Subprocess command runner with sanitized env, app launcher, screenshots
│   │   ├── urlParser.js    # URL parsing utilities
│   │   ├── web.js          # Web search, website browsing, and deep web research engine
│   │   └── index.js        # Central 22-tool execution dispatcher
│   ├── utils/
│   │   └── envManager.js   # .env file reader and writer
│   └── ws/
│       ├── settingsHandler.js # Settings WebSocket messages processor
│       └── wsHandler.js       # Main WebSocket connection handler and checkpoint listener
├── Libraries/              # Persistent structured knowledge repository
│   ├── MemoryLibrary/      # SGM Persons and EveryData JSON entities with keywords_index.json
│   └── ObsiLibrary/        # Obsidian guides, markdown workflows, and research assets
├── scratch/                # Safe sandbox working directory for temporary files & checkpoints
└── By_Agent/               # Safe sandbox output directory for deliverables
```

## What I Accomplished & Learned
- Initialized clean open-source repository structure.
