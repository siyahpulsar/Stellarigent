# Low-Parameter Model (3-7B) Optimization

Stellarigent's core engineering mission is to abandon the heavy architectures built for 1-trillion parameter cloud LLMs and deliver a nimble, deterministic agent framework tailored specifically for **3B to 7B parameter local models running on consumer hardware**.

---

## Why Traditional Agents Fail on 3-7B Models

Mainstream autonomous agent frameworks suffer critical failures when paired with 3-7B models:
1. **Context Window Saturation:** Verbose system prompts and bloated tool outputs rapidly consume the 4K-8K token window, degrading model attention.
2. **JSON Syntax Violations:** Smaller models struggle with large, nested JSON outputs, frequently forgetting quotes or closing brackets.
3. **Conversational Drift & Over-Explanation:** The model generates long preambles (*"Certainly! I will now proceed to open the file for you..."*) instead of immediately executing actions, wasting tokens and computation.
4. **Hallucination Loops:** When an error occurs, small models tend to blindly retry the exact same failing action ad infinitum.

---

## Stellarigent's Architectural Remedies

### 1. Low-Parameter Mode (LPM)
When LPM is active:
* **Micro-Prompts:** Replaces bulky 2,000-word system instructions with compact 150-200 word operational directives (`config/system_prompts.json`).
* **Focused Tool Filtering:** Instead of overwhelming the model with all 22 tool schemas at once, the agent dynamically presents only the 3-4 schemas strictly relevant to the current plan step, eliminating choice paralysis.

### 2. Output Minimizer (OM)
* Strictly forbids the model from emitting conversational filler or polite explanations.
* Forces the model to generate the tool payload immediately.
* Boosts net execution throughput by up to 65% on CPU-only or low-VRAM machines.

### 3. Two-Stage Output Pruning
When reading large source files or scraping web pages:
* **Stage 1 (Snippet Grep):** Filters content down to targeted lines and surrounding context lines (`src/tools/filters.js`).
* **Stage 2 (Historical Condensation):** Previous steps' bulky tool outputs are compressed in conversation memory into concise one-line indicators (e.g. `[SUCCESS: 12 lines read]` or `[ERROR: File not found]`), keeping the active context pristine.

### 4. Hallucination Circuit Breaker
* If a model invokes the same tool with identical arguments and receives consecutive failures 3 times:
  1. The loop automatically breaks.
  2. A targeted corrective prompt is injected: *"This approach failed repeatedly. You must alter your strategy."*
  3. If failure persists, the system switches to the next model in the configured Fallback Ladder.

---

## Recommended Hardware & Local Model Matrix

| Hardware Profile | Recommended Local Model | Quantization | LM Studio Context Size |
| :--- | :--- | :--- | :--- |
| **8 GB RAM (CPU Only)** | Llama 3.2 3B Instruct | `Q4_K_M` | 4,096 tokens |
| **16 GB RAM / Integrated GPU** | Qwen 2.5 Coder 7B | `Q4_K_M` | 8,192 tokens |
| **RTX 3060 / 4060 (6-8GB VRAM)** | Qwen 2.5 Coder 7B / Mistral 7B | `Q5_K_M` / `Q8_0` | 8,192 - 16,384 tokens |

> [!TIP]
> **LM Studio Recommendation:** Keeping the `Temperature` between `0.2` and `0.3` in LM Studio ensures significantly higher determinism, syntax adherence, and tool accuracy with 3-7B parameter models.
