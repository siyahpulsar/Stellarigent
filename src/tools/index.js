const fs = require('fs');
const path = require('path');
const discordBot = require('../discord/index.js');

const {
  agentState,
  broadcastTerminal,
  getLmStudioEndpoint,
  setCanAnalyzeImages
} = require('../state');

const { appendToMemory, updateWorkspaceReadme, runGitCommit, getFolderStructureSummary } = require('../memory');

const { captureScreenshot, runShellCommand, openApplication } = require('./system');
const { searchDDGLite, searchWeb, viewWebsite, runDeepWebSearch } = require('./web');
const { readLocalFile, writeLocalFile, listLocalDirectory } = require('./filesystem');
const { downloadImage, checkImageWithAI, urlImageReader, extractChartData } = require('./image');
const { filterOutput, lineChecker, extractUrlsFromText } = require('./filters');
const { getAvailableGuides } = require('../state');
const { readPdf } = require('./pdfReader');
const { sendSystemNotification } = require('./notify');

// Checks the vision capability of the AI in LM Studio and stores it in RAM
async function checkVisionCapability() {
  broadcastTerminal(`\n*** [VISION CHECK] Checking local AI vision capability... ***\n`);
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const endpoint = getLmStudioEndpoint('/chat/completions');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'görselleri analiz edebiliyor musun? sadece "evet" veya "hayır" diye cevap ver.' }
          ],
          temperature: 0.1,
          max_tokens: 10
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const reply = (data.choices[0].message.content || '').trim().toLowerCase();
        broadcastTerminal(`> [VISION CHECK] AI answered: "${reply}"\n`);

        if (reply.includes('evet') || reply.includes('yes')) {
          setCanAnalyzeImages(true);
          broadcastTerminal(`> [VISION SYSTEM] Vision Analysis is ENABLED in RAM.\n`);
        } else {
          setCanAnalyzeImages(false);
          broadcastTerminal(`> [VISION SYSTEM] Vision Analysis is DISABLED in RAM (Text-only mode).\n`);
        }

        return true;
      }
    } catch (err) {
      if (attempt < maxRetries) {
        broadcastTerminal(`> [VISION CHECK] Attempt ${attempt} failed (${err.message}). Retrying vision check...\n`);
        await new Promise(res => setTimeout(res, 1000));
      }
    }
  }

  broadcastTerminal(`> [VISION CHECK] Vision check unavailable or failed. Defaulting to text-only mode.\n`);
  setCanAnalyzeImages(false);
  return false;
}

// Auto generates .agent-rules.md template
async function generateWorkspaceRules() {
  const rulesPath = path.join(agentState.cwd, '.agent-rules.md');
  broadcastTerminal(`\n> [WORKSPACE RULES] Auto-generating rules in ${rulesPath}...\n`);

  let packageJsonScripts = '';
  try {
    const pkgPath = path.join(agentState.cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
      if (pkg.scripts) {
        packageJsonScripts = '\n### Available Scripts (from package.json):\n' +
          Object.entries(pkg.scripts).map(([name, cmd]) => `- \`npm run ${name}\`: \`${cmd}\``).join('\n') + '\n';
      }
    }
  } catch (e) {
    console.error("Failed to read package.json scripts for rules:", e);
  }

  const structure = await getFolderStructureSummary(agentState.cwd);

  const content = `# Workspace Rules and Project Context

## Project Directory Structure
\`\`\`
${structure}
\`\`\`
${packageJsonScripts}
## General Rules and Guidelines
1. Keep dependencies low. Avoid installing unneeded packages.
2. Maintain clean, structured logs under byAI/ directory named \`aiDevLog-YYYYMMDD-HHMMSS.md\`.
3. Overwrite \`byAI/research_notes.md\` and rewrite \`byAI/ideas_and_suggestions.md\` as updates are deployed.
4. Ensure files are saved and synced immediately.
`;

  try {
    await fs.promises.writeFile(rulesPath, content, 'utf-8');
    broadcastTerminal(`> [WORKSPACE RULES SUCCESS] Created .agent-rules.md rules.\n`);
    return { success: true, message: `Successfully created workspace rules file: .agent-rules.md` };
  } catch (e) {
    broadcastTerminal(`> [WORKSPACE RULES FAILED] ${e.message}\n`);
    return { success: false, message: e.message };
  }
}

// Unified tool executor
async function executeTool(targetAction) {
  let toolResult;
  try {
    const { config, agentState } = require('../state');
    const isNoTaskPlanMode = agentState.activeMode === 'manuel' || agentState.activeMode === 'research' || agentState.activeMode === 'library';
    if (!isNoTaskPlanMode && config.forceTaskPlan && (!agentState.planSteps || agentState.planSteps.length === 0) && targetAction.action !== 'task_plan' && targetAction.action !== 'select_guide') {
      return { success: false, message: "ERROR: You are in the initial planning phase. You MUST use 'task_plan' first before any other tool." };
    }

    switch (targetAction.action) {
      case 'execute_command':
        toolResult = await runShellCommand(targetAction.command);
        break;
      case 'open_application':
        toolResult = await openApplication(targetAction.target);
        break;
      case 'web_search':
        toolResult = await searchWeb(targetAction.query);
        break;
      case 'view_website':
        toolResult = await viewWebsite(targetAction.url, targetAction.mode);
        break;
      case 'deep_web_search':
        toolResult = await runDeepWebSearch(targetAction.query, agentState.deepResearchPageCount || 20);
        break;
      case 'read_file':
        toolResult = await readLocalFile(targetAction.path);
        break;
      case 'read_pdf':
        toolResult = await readPdf(targetAction.path);
        break;
      case 'write_file':
        if (agentState.activeMode === 'library' && agentState.activeSubMode && agentState.activeSubMode.startsWith('new_')) {
           const cat = agentState.activeSubMode.replace('new_', '');
           const filename = targetAction.filename || targetAction.path || `new_${Date.now()}.md`;
           const path = require('path');
           targetAction.path = path.join(agentState.cwd, 'Libraries', 'MemoryLibrary', cat, path.basename(filename));
        }
        toolResult = await writeLocalFile(targetAction.path, targetAction.content);
        break;
      case 'list_directory':
        toolResult = await listLocalDirectory(targetAction.path);
        break;
      case 'take_screenshot':
        toolResult = await captureScreenshot();
        break;
      case 'download_image':
        toolResult = await downloadImage(targetAction.url, targetAction.path);
        break;
      case 'task_plan':
        if (targetAction.steps && Array.isArray(targetAction.steps)) {
          agentState.planSteps = targetAction.steps.map(step => ({ text: step, status: 'pending' }));
          if (agentState.planSteps.length > 0) {
            agentState.planSteps[0].status = 'current';
          }
          toolResult = { success: true, message: `Decomposition plan saved with ${agentState.planSteps.length} steps. Transitioning to Developer Agent.` };
        } else {
          toolResult = { success: false, message: "Invalid steps array provided for task_plan." };
        }
        break;
      case 'select_guide':
        const gName = targetAction.guide_name;
        if (gName && gName.toLowerCase() !== 'none') {
          const guidesList = getAvailableGuides();
          const matchedG = guidesList.find(g => g.name.toLowerCase().includes(gName.toLowerCase()) || gName.toLowerCase().includes(g.name.toLowerCase()));
          if (matchedG) {
            try {
              agentState.activeGuideName = matchedG.name;
              agentState.activeGuideContent = await fs.promises.readFile(matchedG.path, 'utf-8');
              if (!agentState.selectedGuides) agentState.selectedGuides = [];
              if (!agentState.selectedGuides.includes(matchedG.name)) {
                agentState.selectedGuides.push(matchedG.name);
              }
              toolResult = { success: true, message: `System prompt guide switched to: ${matchedG.name}` };
            } catch (err) {
              toolResult = { success: false, message: `Failed to read guide file: ${err.message}` };
            }
          } else {
            toolResult = { success: false, message: `Guide matching name "${gName}" not found in library.` };
          }
        } else {
          agentState.activeGuideName = null;
          agentState.activeGuideContent = null;
          toolResult = { success: true, message: "System prompt guide deactivated." };
        }
        break;
      case 'task_complete':
        toolResult = { success: true, message: "Task completed successfully." };
        agentState.status = 'completed';
        const finalSummary = targetAction.summary || targetAction.explanation || "Task completed successfully.";
        const extraData = {
          toolsUsed: agentState.executedTools || [],
          thoughts: agentState.thoughts || [],
          errors: targetAction.errors || [],
          posNegAspects: targetAction.posNegAspects || ""
        };
        await appendToMemory(agentState.task, finalSummary, extraData);
        await updateWorkspaceReadme(agentState.task, finalSummary);
        await runGitCommit(agentState.task, finalSummary);
        break;
      case 'generate_workspace_rules':
        toolResult = await generateWorkspaceRules();
        break;
      case 'send_discord_message':
        toolResult = await discordBot.sendChannelMessage(targetAction.content, targetAction.filePath, { isDiscordMessageTool: true });
        break;
      case 'notify_user': {
        // Kullanıcıya sistem bildirim i gönder (Windows/macOS/Linux toast)
        const notifyTitle = targetAction.title || 'Stellarigent Ajan Bildirimi';
        const notifyMessage = targetAction.message || targetAction.explanation || 'Ajandan bildirim.';
        const notifyLevel = targetAction.level || 'info'; // 'info' | 'warning' | 'error'
        toolResult = await sendSystemNotification(notifyTitle, notifyMessage, notifyLevel);
        break;
      }
      case 'filter_output':
        toolResult = filterOutput(targetAction.query, targetAction.filter_type);
        if (toolResult && toolResult.success) {
          agentState.lastFilteredOutput = toolResult.results;
        }
        break;
      case 'url_image_reader':
        toolResult = await urlImageReader(targetAction.selection, targetAction.count, targetAction.question);
        break;
      case 'extract_chart_data':
        toolResult = await extractChartData(targetAction.path);
        break;
      case 'line_checker':
        toolResult = await lineChecker(targetAction.path, targetAction.query);
        break;
      case 'library_mode': {
        // Stub kaldırıldı — runLibraryModeSubLoop doğrudan çağrılıyor.
        // Bu sayede Discord, manuel araç veya sub-agent üzerinden gelen çağrılar
        // da gerçek kütüphane araması yapıyor (agent.js monkey-patch bağımlılığı ortadan kalktı).
        try {
          const { runLibraryModeSubLoop } = require('../modes/libraryMode');
          const libraryResults = await runLibraryModeSubLoop(
            targetAction.search || '',
            targetAction.explanation || ''
          );
          toolResult = {
            success: true,
            message: libraryResults || 'Kütüphane araması tamamlandı ancak sonuç döndürülmedi.'
          };
        } catch (libErr) {
          toolResult = { success: false, message: `LibraryMode hatası: ${libErr.message}` };
        }
        break;
      }
      default:
        toolResult = { success: false, message: `Unknown action: ${targetAction.action}` };
    }
  } catch (err) {
    toolResult = { success: false, message: `Error executing tool: ${err.message}` };
  }
  return toolResult;
}

module.exports = {
  checkVisionCapability,
  executeTool
};
