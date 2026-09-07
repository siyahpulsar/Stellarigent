# Test Automation and Verification Guide

Guidelines for implementing and executing automated and manual tests inside the workspace.

## Automated Verification Rules
- **Run Existing Suites First**: Before writing any new code, check `package.json` for script tags like `npm run test` or `npm test` and run them to establish a baseline.
- **Unit Testing Frameworks**:
  - Node.js: Prefer standard assertions or lightweight testing libraries (e.g., `node --test` or `jest` if already configured).
  - Python: Use `unittest` or `pytest`.
- **Run Non-Interactively**: Always run test suites in non-interactive/CI mode (e.g., set `CI=true` or use flags that prevent prompt hangs).

## Manual UI/Application Verification
- **Screenshot Verification**: For any visual/web dashboard changes, capture a screenshot using the `take_screenshot` tool to verify layout correctness.
- **Log Inspection**: Verify standard error output and server logs to catch unhandled promise rejections or database locks.