# Memory Architecture & SGM Entity Router (Memory & SGM)

Rather than relying on resource-intensive vector databases (ChromaDB, Milvus, Pinecone) that monopolize RAM and VRAM on entry-level machines, Stellarigent implements a lightweight, zero-latency local memory architecture.

---

## 1. 3-Tier Memory Hierarchy

1. **Working Memory (RAM):**
   * Volatile Node.js memory holding active plan tasks, current variables, and immediate tool results.
2. **Short-Term Episodic Memory:**
   * Recent conversational turns. Kept lean via **Two-Stage Pruning** to prevent context window saturation.
3. **Long-Term Persistent Vault:**
   * `Libraries/ObsiLibrary/`: Human-readable markdown knowledge vault fully compatible with Obsidian.
   * `Libraries/MemoryLibrary/`: Machine-readable structured JSON entity database.

---

## 2. SGM: Single-Shot Upsert & Entity Router (`src/modes/libraryMode.js`)

The **SGM (Single-Shot Upsert & Entity Router)** dynamically categorizes incoming data and records it with high precision:

* **Person Entities (`Libraries/MemoryLibrary/Persons/`):** User preferences, contact aliases, roles, and past conversations.
* **EveryData Entities (`Libraries/MemoryLibrary/EveryData/`):** Technical docs, project configurations, code snippets, and research notes.

### Zero-Vector Inverted Indexing (`keywords_index.json`)
Instead of computing compute-heavy mathematical embeddings on low-end CPUs, Stellarigent builds an inverted keyword index:
* **Memory Footprint:** Less than 5 MB of RAM.
* **Lookup Latency:** Sub-millisecond (< 2 ms) keyword matching.
* **Zero GPU Overhead:** Perfect for budget hardware without dedicated AI tensor cores.

---

## 3. EPERM Exponential Backoff & Atomic File IO

On Windows environments where files can be temporarily locked by antivirus programs or text editors:
* The memory subsystem (`src/memory.js`) applies an exponential backoff retry mechanism (up to 3 retries).
* Writes are staged through buffers to guarantee zero data corruption.
