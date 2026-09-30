# Stellarigent Wiki - Home

Welcome to the **Stellarigent Wiki**! 

**Stellarigent** is a 100% local, autonomous, production-grade **Computer-Use AI Agent Framework** designed from the ground up to run smoothly, deterministically, and fast on **low-end consumer hardware using 3B to 7B parameter local language models**.

> **"A local ai agent: An optimized project designed to run smoothly on low-end hardware using a 3-7B parameter AI model."**

---

## Table of Contents & Navigation Map

This wiki is formatted to be fully compatible with both **GitHub Wiki** and **Obsidian** knowledge bases. Use the links below to navigate across the core architectural systems:

1. [[Architecture|1. System Architecture & Transport Layers]]
   * Express HTTP & WebSocket Server Gateway
   * Web Dashboard, Electron Desktop IDE, CLI Terminal REPL & Discord Bot
   * Docker Containerization & Execution Sandbox
2. [[Algorithms|2. Core Algorithms & Parsing Engines]]
   * Autonomous Agent Loop (`runAgentLoop`) & Deterministic State Machine
   * 5-Tier Resilient Response & Tool Parser
   * AMPR (Adaptive Model Performance Router) & EWMA Latency Tracking
3. [[Low_Parameter_Optimization|3. Low-Parameter Model (3-7B) Optimization]]
   * Core Philosophy: Why traditional agents fail on 3-7B models
   * Low-Parameter Mode (LPM) & Output Minimizer (OM)
   * Token Budgeting, Dynamic Pruning & LM Studio Recommended Settings
4. [[Tools|4. Complete 22-Tool Catalog & Risk Ratings]]
   * Sandboxed Filesystem, Shell Command Execution & Egress Filter
   * Web Search, Headless Chromium (Puppeteer) & Deep Multi-Source Research
   * Computer Vision, OCR, PDF Extraction & Cross-Platform Desktop Toast Notifications
5. [[Security_and_Tripwire|5. Security, Isolation & Honeypot Tripwire Circuit Breaker]]
   * 9-Layer Defense-in-Depth Architecture
   * Core Shield & Read-Only Source Protection
   * Honeypot Bait (`agent_user.json`) & Emergency Quarantine Lock
6. [[Memory_and_SGM|6. Memory Architecture & SGM Entity Router]]
   * 3-Tier Memory Hierarchy (Working, Episodic, Persistent Vault)
   * Two-Stage Output Pruning (Regex Snippets & Turn Condensation)
   * Zero-Vector Inverted Indexing (`keywords_index.json`) for Instant Low-RAM Retrieval
7. [[Workflows|7. End-to-End Operational Workflows]]
   * Task Planning & Multi-Agent Swarm Mode (`Planner -> Developer -> QA Tester`)
   * Human-in-the-Loop Approval Drawer & Colorized CLI Prompting
   * Atomic Checkpoint Recovery & Resumption Protocol

---

## Core Project Philosophy

Most contemporary autonomous agent frameworks (AutoGPT, Devin-style clones, etc.) assume access to massive frontier cloud APIs (GPT-4o, Claude 3.5 Sonnet) with multi-hundred-billion parameter footprints and large context windows.

**Stellarigent fundamentally shifts this paradigm:**
* **Zero Cloud Dependency:** Runs entirely on-device with zero mandatory subscriptions, zero API keys, and zero telemetry.
* **Low-End Hardware First:** Engineered to execute fluidly on typical consumer laptops (8GB - 16GB RAM) running lightweight quantizations (e.g. Qwen 2.5 Coder 7B, Llama 3.2 3B, Mistral 7B) through LM Studio or any local OpenAI-compatible REST server.
* **Strict Token Economy:** Suppresses conversational chatter and dynamically injects minimal micro-prompts so the attention span of 3-7B models is never diluted.
* **Proactive Security:** Guards your host system against runaway hallucinations or harmful command executions via automated sandbox rules and honeypot circuit breakers.
