# End-to-End Operational Workflows (Workflows)

Stellarigent dynamically coordinates diverse execution workflows, scaling from single-command utility queries up to multi-step autonomous software engineering operations.

---

## 1. Multi-Agent Swarm Mode

For intricate development tasks, the engine dynamically decomposes the prompt into specialized virtual personas:

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Planner as  Planner Persona
    participant Dev as  Developer Persona
    participant QA as  QA Tester Persona

    User->>Planner: "Build a new REST API endpoint and verify it"
    Planner->>Planner: Generates 3-5 deterministic checklist steps
    Planner->>Dev: Delegates Steps 1 & 2 (File creation, route implementation)
    loop Implementation Loop
        Dev->>Dev: filesystem_write, system_execute_command
    end
    Dev->>QA: Passes implemented files for regression verification
    loop Quality Assurance Loop
        QA->>QA: Runs test suites, checks linting and file output
    end
    alt Verification Succeeded
        QA-->>User: "All tasks completed successfully!"
    else Bug Detected
        QA->>Dev: Delivers actionable bug report and prompts fix
    end
```

---

## 2. Human-in-the-Loop Approval Workflow

Whenever a tool with Risk Level 2 is called, execution halts and awaits explicit confirmation:
1. **Web Dashboard:** The right-hand **Approval Drawer** slides open automatically, displaying exact diffs, command strings, and potential risk warnings.
2. **Terminal (CLI):** Highlights an interactive ANSI prompt (`[Y] Approve / [N] Deny / [E] Edit arguments`).
3. **Discord:** Delivers an interactive embed card with colorized green/red action buttons.

---

## 3. Direct Manual Tool Mode (Manuel Tools)

When you simply need to perform a one-off utility action (e.g. scrape a specific URL or extract text from a PDF):
* Bypasses the multi-step planning loop entirely.
* Executes the requested tool in a single, fast invocation and returns the result immediately.
