# Stellarigent Benchmark & Evaluation Report

> **Execution Timestamp:** 2026-09-22T21:12:00.477Z  
> **Total Scenarios:** 17 | **Passed:** 17 | **Failed:** 0 | **Pass Rate:** 100.0%  
> **Total Execution Time:** 24 ms

## Scenario Results Breakdown

| ID | Category | Scenario Name | Status | Duration | Detail |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **EVAL-PARSER-01** | Parser Resilience | Standard JSON Markdown Codeblock Parsing | ✅ PASS | 1ms | Correctly extracted tool call from markdown JSON codeblock. |
| **EVAL-PARSER-02** | Parser Resilience | XML <tool_call> Syntax Recovery | ✅ PASS | 0ms | Successfully parsed XML <tool_call> syntax. |
| **EVAL-PARSER-03** | Parser Resilience | Qwen [TOOL_CALLS] Syntax Recovery | ✅ PASS | 0ms | Successfully parsed Qwen [TOOL_CALLS] format. |
| **EVAL-SEC-01** | Security & Confinement | Network Egress Blocking: Curl Exfiltration Attempt | ✅ PASS | 1ms | Blocked unauthorized curl exfiltration attempt. |
| **EVAL-SEC-02** | Security & Confinement | Network Egress Blocking: PowerShell Invoke-WebRequest Attempt | ✅ PASS | 1ms | Blocked PowerShell Invoke-WebRequest exfiltration attempt. |
| **EVAL-SEC-03** | Security & Confinement | Protected Core Shield: Core Source Code Tampering Attempt | ✅ PASS | 1ms | Protected core engine files blocked from agent modifications. |
| **EVAL-TRIPWIRE-01** | Tripwire Lifecycle | Tripwire Arming & Secondary Read Emergency Break | ✅ PASS | 0ms | Tripwire correctly armed and tripped on secondary file read. |
| **EVAL-TRIPWIRE-02** | Tripwire Lifecycle | Tripwire Task Scoping Isolation | ✅ PASS | 0ms | Tripwire properly scoped to taskId, preventing inter-task deadlock. |
| **EVAL-TRIPWIRE-03** | Tripwire Lifecycle | Manual Tripwire Reset (No Server Restart Required) | ✅ PASS | 0ms | Tripwire lock successfully cleared via reset API/function. |
| **EVAL-COST-01** | Cost & Quota Tracking | Token Usage Recording & USD Pricing Accuracy | ✅ PASS | 1ms | Accurately calculated $0.0027 for 12,000 gpt-4o-mini tokens. |
| **EVAL-COST-02** | Cost & Quota Tracking | Daily Budget Cap Enforcement (Circuit Breaker) | ✅ PASS | 0ms | Daily budget cap triggered safety circuit breaker against cloud spend. |
| **EVAL-MEM-01** | Memory & RAG | Two-Stage Grace Pruning Cap Assertion | ✅ PASS | 0ms | Pruned 60 grace items cleanly to 35 without memory leak. |
| **EVAL-MEM-02** | Memory & RAG | Legacy Memory Data Normalization & NaN Immunity | ✅ PASS | 0ms | Legacy memory records sanitized and scored with zero NaN errors. |
| **EVAL-CHECKPOINT-01** | Checkpoint System | Save and Load Checkpoint Round-Trip | ✅ PASS | 8ms | Checkpoint save→load→delete round-trip completed successfully. |
| **EVAL-CHECKPOINT-02** | Checkpoint System | Checkpoint Summary Metadata Accuracy | ✅ PASS | 5ms | Summary metadata correct: completedSteps=2/3, stepIndex=7, ageMinutes=0 |
| **EVAL-CHECKPOINT-03** | Checkpoint System | Completed Task Checkpoint Ignored on Load | ✅ PASS | 5ms | Completed-status checkpoints are correctly filtered out on load. |
| **EVAL-NOTIFY-01** | Notify Tool | Platform Detection for Notify | ✅ PASS | 1ms | Platform: win32, isNotifySupported: true |

## Evaluation Criteria & Verification Notes
- **Parser Resilience:** Verifies multi-tier regex and syntax parsing across varying model qualities without crashing.
- **Security & Confinement:** Asserts that exfiltration attempts (curl, Invoke-WebRequest) and project file tampering are strictly caught before execution.
- **Tripwire Lifecycle:** Validates task-scoped isolation and deterministic manual reset capabilities.
- **Cost & Quota:** Tests token tracking calculations and automated budget circuit breakers.
- **Memory & RAG:** Guarantees two-stage pruning adherence and NaN-free sorting stability.
