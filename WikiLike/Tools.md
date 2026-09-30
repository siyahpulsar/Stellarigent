# Complete 22-Tool Catalog & Risk Ratings (Tools)

Stellarigent equips the local model with a production-grade suite of 22 tools (`src/tools/`) designed for safe, deterministic operating system manipulation. Every tool is assigned an explicit **Risk Level**.

---

## Risk Levels & Safety Classifications

* **Level 0 (Green / Safe):** Autonomous execution. Zero risk of system damage or data alteration (e.g. reading files, performing web searches, issuing notifications).
* **Level 1 (Yellow / Moderate):** Controlled sandbox writes or external connections (e.g. writing scratch files, scraping web pages).
* **Level 2 (Red / High):** **Requires Human-in-the-Loop Approval.** The agent suspends execution until the user explicitly approves the action via the Web Dashboard, Electron IDE, CLI, or Discord (e.g. running terminal commands, deleting files, writing production source code).

---

## 1. Filesystem Tools (`src/tools/filesystem.js`)

| Tool Name | Risk | Description |
| :--- | :---: | :--- |
| `filesystem_read` | 0 | Reads the complete or slice content of a file within permitted workspace paths. |
| `filesystem_write` | 2 | Writes new code or updates an existing file. Protected core files cannot be overwritten. |
| `filesystem_list` | 0 | Lists directory contents, file sizes, and subdirectories. |
| `filesystem_delete`| 2 | Deletes a specified file or directory (Strict human confirmation required). |
| `filesystem_move`  | 2 | Moves or renames files/folders across the workspace. |
| `filesystem_copy`  | 1 | Copies files to designated destination paths. |

---

## 2. Web Search & Browser Automation (`src/tools/web.js`)

| Tool Name | Risk | Description |
| :--- | :---: | :--- |
| `web_search` | 0 | Queries DuckDuckGo or configured search engines and returns top relevant links. |
| `web_browse` | 1 | Fetches text content from a target URL; strips unnecessary HTML markup and ads. |
| `web_deep_research` | 1 | Multi-source research: Crawls multiple sources, cross-verifies facts, and compiles a cited report. |
| `puppeteer_click` | 1 | Interacts with web pages by clicking CSS selectors or buttons in headless Chromium. |
| `puppeteer_type`  | 1 | Types text into web input fields. |
| `puppeteer_screenshot` | 0 | Captures an image snapshot of the active headless browser session. |

---

## 3. System & Terminal Execution (`src/tools/system.js`)

| Tool Name | Risk | Description |
| :--- | :---: | :--- |
| `system_execute_command` | 2 | Spawns a PowerShell or Bash subprocess. Strips secrets from env variables and blocks destructive commands. |
| `system_screenshot` | 0 | Takes a screenshot of the user's primary desktop display (`desktop-screenshot`). |
| `system_launch_app` | 1 | Launches desktop software (e.g., Notepad, VS Code, Calculator). |
| `system_list_processes` | 0 | Enumerates running system processes and CPU/RAM resource usage. |

---

## 4. Filtering & Document Parsing Tools

| Tool Name | Risk | Description |
| :--- | :---: | :--- |
| `filters_grep` | 0 | High-speed regex and string matcher; returns only relevant matching lines (`src/tools/filters.js`). |
| `pdf_extract_text` | 0 | Extracts text layers and structured page content from local PDF files (`src/tools/pdfReader.js`). |
| `url_parse` | 0 | Parses query parameters, hostnames, and protocols from URLs (`src/tools/urlParser.js`). |

---

## 5. Vision & Notification Tools

| Tool Name | Risk | Description |
| :--- | :---: | :--- |
| `image_download` | 1 | Downloads an image from a URL into the local asset cache (`src/tools/image.js`). |
| `image_analyze` | 0 | Dispatches images to a local multimodal/vision model for visual question answering. |
| `notify_desktop` | 0 | Displays a native OS toast notification on Windows, macOS, or Linux upon task completion (`src/tools/notify.js`). |
