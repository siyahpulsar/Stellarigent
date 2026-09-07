const fs = require('fs');
const path = require('path');
const { readEnv, writeEnv } = require('../utils/envManager');
const {
  agentState,
  config,
  getCanAnalyzeImages,
  broadcastState,
  broadcastTerminal,
  addMessage,
  getAvailableGuides,
  refreshGuidesCache
} = require('../state');
const { checkBannedWords, setIdeWorkspace } = require('../security');
const { resolveManualBridgeResponse } = require('../llm/llmClient');
const { log } = require('../logger');
const {
  sendAdminData,
  handleUpdateSettings,
  handleSaveAdminData,
  handleClearMemories
} = require('./settingsHandler');

module.exports = function setupWebSocketHandler(wss, founderKey, discordBot, resolvePendingAction, broadcastDiscordState, broadcastSandboxState) {
  wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket. Waiting for authentication...');
  let isAuthenticated = false;

  const authTimeout = setTimeout(() => {
    if (!isAuthenticated) {
      console.log('Client failed to authenticate within 5 seconds. Closing connection.');
      ws.close(1008, "Authentication timeout");
    }
  }, 5000);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type !== 'client_log') {
        let logMsg = `Message type: ${data.type}`;
        if (data.type === 'user_message' && data.content) logMsg += ` | Content: ${data.content}`;
        log('WS_IN', logMsg);
      }

      if (!isAuthenticated) {
        if (data.type === 'auth') {
          // Verify auth key
          const crypto = require('crypto');
          let isValid = false;
          try {
            if (founderKey && typeof data.key === 'string' && typeof founderKey === 'string' && data.key.length === founderKey.length) {
              isValid = crypto.timingSafeEqual(Buffer.from(data.key), Buffer.from(founderKey));
            }
          } catch (e) {}
          
          if (isValid) {
            isAuthenticated = true;
            clearTimeout(authTimeout);
            console.log('Client authenticated successfully.');
            
            // Send initial state upon successful authentication
            ws.send(JSON.stringify({ type: 'auth_success' }));
            ws.send(JSON.stringify({ type: 'state', ...agentState }));
            ws.send(JSON.stringify({ type: 'settings', settings: config }));
            ws.send(JSON.stringify({ type: 'discord_state', ...discordBot.getDiscordState() }));
            sendAdminData(ws);
              
            try {
              const fs = require('fs');
              const libPath = path.join(process.cwd(), 'Libraries', 'MemoryLibrary');
              if (fs.existsSync(libPath)) {
                const items = fs.readdirSync(libPath, { withFileTypes: true });
                const categories = items.filter(d => d.isDirectory()).map(d => d.name);
                const files = [];
                for (const cat of categories) {
                  const catPath = path.join(libPath, cat);
                  if (fs.existsSync(catPath)) {
                    const catItems = fs.readdirSync(catPath);
                    catItems.forEach(f => {
                      const ext = f.toLowerCase();
                      if (ext.endsWith('.md') || ext.endsWith('.json')) files.push(f);
                    });
                  }
                }
                
                // Add workspace root files for global @ mentions
                try {
                  const wsItems = fs.readdirSync(agentState.cwd);
                  wsItems.forEach(f => {
                    const stat = fs.statSync(path.join(agentState.cwd, f));
                    if (stat.isFile() && !f.startsWith('.')) {
                      files.push(f);
                    }
                  });
                } catch(e) {}

                ws.send(JSON.stringify({ type: 'library_data', categories, files }));
              }
            } catch(e) { console.error('Error sending library_data:', e); }
          } else {
            console.log('Client provided invalid auth key. Closing connection.');
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid admin key.' }));
            ws.close(1008, "Invalid admin key");
          }
        }
        return;
      }

      switch (data.type) {
        case 'client_log':
          log('FRONTEND', data.logData);
          break;

        case 'user_message':
          if (agentState.status === 'library_ask_user') {
            const { resolveLibraryAsk } = require('../modes/libraryMode');
            addMessage('user', data.content);
            resolveLibraryAsk(data.content);
            break;
          }

          if (agentState.status !== 'idle' && agentState.status !== 'completed' && agentState.status !== 'failed') {
            ws.send(JSON.stringify({ type: 'error', message: 'Agent is already busy running a task!' }));
            break;
          }

          let finalTaskContent = data.content;
          if (data.activeMode) agentState.activeMode = data.activeMode;
          if (data.activeSubMode) agentState.activeSubMode = data.activeSubMode;
          if (data.deepResearchPageCount) agentState.deepResearchPageCount = data.deepResearchPageCount;
          
          // YENİ: Keyword bazlı hafıza enjeksiyonu
          if (agentState.activeMode !== 'library' && !(agentState.activeMode === 'manuel' && agentState.activeSubMode === 'library_mod')) {
            const { searchIndex } = require('../lib/keywordIndex');
            const matchedFiles = searchIndex(agentState.cwd, finalTaskContent);
            if (matchedFiles.length > 0) {
              const fs = require('fs');
              const path = require('path');
              broadcastTerminal(`> [MEMORY] ${matchedFiles.length} ilgili hafıza dosyası bulundu.\n`);
              let memoryContext = `[OTOMATİK HAFIZA - İstekle eşleşen MemoryLibrary kayıtları]:\n`;
              for (const relPath of matchedFiles.slice(0, 5)) { // Max 5 dosya
                const fullPath = path.join(agentState.cwd, 'Libraries', 'MemoryLibrary', relPath);
                if (fs.existsSync(fullPath)) {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  memoryContext += `\n--- ${relPath} ---\n${content}\n`;
                }
              }
              addMessage('system', memoryContext);
            }
          }
          
          if (agentState.activeMode === 'manuel') {
            agentState.messages = [];
          }
          
          if (agentState.activeMode === 'library') {
            agentState.task = finalTaskContent;
            agentState.status = 'thinking';
            broadcastState();
            
            const { processLibraryTask } = require('../modes/libraryMode');
            processLibraryTask(finalTaskContent, agentState.activeSubMode).then(() => {
              agentState.status = 'idle';
              broadcastState();
            }).catch(err => {
              console.error(err);
              broadcastTerminal(`> [ERROR] Library task failed: ${err.message}\n`);
              agentState.status = 'idle';
              broadcastState();
            });
            break;
          }

          // library_mod as a manuel sub-mode: skip planning, run library search directly
          if (agentState.activeMode === 'manuel' && agentState.activeSubMode === 'library_mod') {
            agentState.task = finalTaskContent;
            agentState.status = 'thinking';
            agentState.messages = [];
            broadcastState();
            broadcastTerminal(`\n*** [LIBRARY MOD] Manuel library search başlatılıyor (planlama atlandı)... ***\n`);
            
            addMessage('user', finalTaskContent);

            const { runLibraryModeSubLoop } = require('../modes/libraryMode');
            runLibraryModeSubLoop(finalTaskContent, finalTaskContent).then(async () => {
              const { llmFetch, getDynamicSystemPrompt } = require('../llm/llmClient');
              const { dynamicSystemPrompt } = await getDynamicSystemPrompt(2);

              broadcastTerminal(`\n> [LIBRARY MOD] Bulunan dosyalar okundu. Özet rapor hazırlanıyor...\n`);
              const summaryMessages = [
                { role: 'system', content: dynamicSystemPrompt },
                ...agentState.messages.map(m => ({
                  role: m.role === 'system' ? 'user' : m.role,
                  content: m.role === 'system' ? `[System Context: Info]\n${m.content}` : m.content
                })),
                { role: 'user', content: `Yukarıdaki kütüphane aramasında bulunan dosyaların içeriklerini inceleyerek kullanıcıya çok detaylı ve kapsamlı bir rapor sun. Hiç araç çağırma, sadece düz metin ile bilgileri anlat.` }
              ];

              const summaryText = await llmFetch(summaryMessages, 0.4, 'Library Summary');
              addMessage('assistant', summaryText);
              agentState.status = 'completed';
              broadcastState();
            }).catch(err => {
              console.error(err);
              broadcastTerminal(`> [ERROR] Library mod search failed: ${err.message}\n`);
              agentState.status = 'idle';
              broadcastState();
            });
            break;
          }

          const bannedWord = checkBannedWords(finalTaskContent);
          if (bannedWord) {
            broadcastTerminal(`\n  [BANNED WORD DETECTED] Task contains banned phrase: "${bannedWord}"\n  `);
            ws.send(JSON.stringify({ type: 'error', message: `İstek güvenlik kuralları gereği yasaklı bir kelime ("${bannedWord}") içeriyor! İşlem durduruldu.` }));
            addMessage('system', `[GÜVENLİK] Yasaklı kelime ("${bannedWord}") tespit edildi. İstek reddedildi.`);
            agentState.status = 'failed';
            broadcastState();
            break;
          }
          agentState.task = finalTaskContent;
          agentState.status = 'thinking';
          broadcastState();

          if (getCanAnalyzeImages() === null) {
            await checkVisionCapability();
          }

          const { initializeIdeTaskContext, runIdeSwarmLoop } = require('../agent');
          await initializeIdeTaskContext(finalTaskContent);
          // Trigger the new IDE Swarm loop
          runIdeSwarmLoop();
          break;

        case 'approve_action':
          resolvePendingAction({
            approved: true,
            action: data.action // contains potentially modified parameters
          });
          break;

        case 'reject_action':
          resolvePendingAction({
            approved: false,
            feedback: data.feedback
          });
          break;

        case 'interrupt_task':
          if (agentState.status === 'thinking' || agentState.status === 'executing' || agentState.status === 'pending_approval') {
            agentState.ideInterrupted = data.content;
            const interruptMsg = `[INTERRUPT] User provided new instruction mid-task:\n"${data.content}"\n\nEnsure you consider this instruction immediately in your next action.`;
            addMessage('user', interruptMsg);
            broadcastTerminal(`\n[TASK INTERRUPTED] New user instruction injected into memory.\n`);
            
            // If it's pending approval, we can auto-reject the current action so it immediately loops
            if (agentState.status === 'pending_approval') {
              resolvePendingAction({
                approved: false,
                feedback: `Task was interrupted by user with new instruction: "${data.content}"`
              });
            }
          }
          break;

        case 'abort_task':
          // Terminate active process if any
          if (agentState.activeCommandProcess) {
            try {
              agentState.activeCommandProcess.kill();
              broadcastTerminal(`\n  > [ABORTED] Active command process killed by user.\n  `);
            } catch (err) {
              console.error('Failed to kill active process:', err);
            }
          }
          agentState.status = 'idle';
          agentState.pendingAction = null;
          resolvePendingAction({ approved: false, feedback: 'Aborted by user' });
          addMessage('system', 'Task execution was aborted by the user.');
          broadcastState();
          break;

        case 'update_settings':
          handleUpdateSettings(data, ws);
          break;

        case 'clear_chat':
          agentState.messages = [];
          agentState.status = 'idle';
          agentState.task = null;
          agentState.pendingAction = null;
          if (agentState.activeCommandProcess) {
            agentState.activeCommandProcess.kill();
          }
          resolvePendingAction({ approved: false, feedback: 'Chat cleared' });
          broadcastState();
          broadcastTerminal(`> Chat cleared and agent reset.\n  `);
          break;

        case 'update_cwd':
          if (fs.existsSync(data.cwd)) {
            const resolvedCwd = path.resolve(data.cwd);
            agentState.cwd = resolvedCwd;
            // IDE Workspace Mode: grant full access to this folder
            setIdeWorkspace(resolvedCwd);
            broadcastTerminal(`> Workspace set to: ${resolvedCwd}\n  `);
            ws.send(JSON.stringify({ type: 'cwd_updated', cwd: resolvedCwd }));
            broadcastState();
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Specified folder directory does not exist!' }));
          }
          break;

        case 'manually_change_mode':
          const mName = data.guide_name;
          if (mName && mName.toLowerCase() !== 'none') {
            const guidesList = getAvailableGuides();
            const matchedG = guidesList.find(g => g.name.toLowerCase() === mName.toLowerCase());
            if (matchedG) {
              try {
                agentState.activeGuideName = matchedG.name;
                agentState.activeGuideContent = await fs.promises.readFile(matchedG.path, 'utf-8');
                broadcastTerminal(`> [MANUAL MODE] Loaded guide: ${matchedG.name}\n  `);
              } catch (err) {
                console.error("Failed to manually load guide:", err);
              }
            }
          } else {
            agentState.activeGuideName = null;
            agentState.activeGuideContent = null;
            broadcastTerminal(`> [MANUAL MODE] Deactivated guide mode.\n  `);
          }
          broadcastState();
          break;

        case 'save_guide':
          const saveName = data.name;
          const saveContent = data.content;
          if (saveName && saveContent !== undefined) {
            try {
              const filename = saveName.endsWith('.md') ? saveName : `${saveName}.md`;
              let guidesDir = path.join(agentState.cwd, 'Libraries', 'ObsiLibrary', 'ObsiLibrary');
              // Check which path exists (async)
              const altDir = path.join(agentState.cwd, 'Libraries', 'ObsiLibrary');
              const [primary, alt] = await Promise.all([
                fs.promises.access(guidesDir).then(() => true).catch(() => false),
                fs.promises.access(altDir).then(() => true).catch(() => false)
              ]);
              if (!primary) guidesDir = alt ? altDir : guidesDir;
              await fs.promises.mkdir(guidesDir, { recursive: true });
              const savePath = path.join(guidesDir, filename);
              await fs.promises.writeFile(savePath, saveContent, 'utf-8');
              broadcastTerminal(`> [GUIDE SAVED] Wrote guide ${filename} successfully.\n  `);
              refreshGuidesCache().catch(() => {}); // invalidate cache after write
              broadcastState();
            } catch (err) {
              console.error("Failed to save guide via WS:", err);
            }
          }
          break;

        case 'get_guide_content':
          const targetName = data.name;
          if (targetName) {
            const guidesList = getAvailableGuides();
            const foundG = guidesList.find(g => g.name.toLowerCase() === targetName.toLowerCase());
            if (foundG) {
              try {
                const content = await fs.promises.readFile(foundG.path, 'utf-8');
                ws.send(JSON.stringify({
                  type: 'guide_content',
                  name: foundG.name,
                  content
                }));
              } catch (err) {
                console.error("Failed to read guide content for WS:", err);
              }
            }
          }
          break;

        case 'update_discord_config':
          discordBot.updateDiscordConfig(data.connectionSpeedLimit);
          break;

        case 'add_discord_admin':
          discordBot.addDiscordAdmin(data.adminId);
          break;

        case 'delete_discord_admin':
          discordBot.deleteDiscordAdmin(data.index);
          break;

        case 'add_discord_user':
          discordBot.addDiscordUser(data.userId);
          break;

        case 'delete_discord_user':
          discordBot.deleteDiscordUser(data.index);
          break;

        case 'get_admin_data':
          sendAdminData(ws);
          break;

        case 'save_admin_data':
          await handleSaveAdminData(data, ws, (newKey) => { founderKey = newKey; }, broadcastDiscordState);
          break;

        case 'clear_memories':
          await handleClearMemories(ws);
          break;

        case 'manual_ai_response':
          // User pasted an AI response into the Manual Bridge panel
          if (agentState.status === 'manual_bridge') {
            const resolved = resolveManualBridgeResponse(data.content);
            if (!resolved) {
              ws.send(JSON.stringify({ type: 'error', message: 'No active manual bridge session. Please start a task first.' }));
            }
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Agent is not in manual bridge mode.' }));
          }
          break;

        case 'get_sandbox_files':
          broadcastSandboxState();
          break;

        case 'commit_sandbox_file':
          try {
            const relPath = data.path;
            const containerRoot = path.resolve(path.join(__dirname, '..', '..'), '.container');
            const projectRoot = path.resolve(path.join(__dirname, '..', '..'));
            const sourcePath = path.resolve(containerRoot, relPath);
            const destPath = path.resolve(projectRoot, relPath);
            // Path traversal guard: source must stay inside .container, dest inside project root
            if (!sourcePath.startsWith(containerRoot + path.sep) && sourcePath !== containerRoot) {
              ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz dosya yolu: sandbox dışına erişim engellendi.' }));
              break;
            }
            if (!destPath.startsWith(projectRoot + path.sep) && destPath !== projectRoot) {
              ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz hedef yolu: proje kök dizini dışına erişim engellendi.' }));
              break;
            }
            if (fs.existsSync(sourcePath)) {
              const destDir = path.dirname(destPath);
              if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
              fs.copyFileSync(sourcePath, destPath);
              fs.unlinkSync(sourcePath);
              
              // Temizleme: boş klasörleri sil
              let curDir = path.dirname(sourcePath);
              while (curDir !== containerRoot) {
                if (fs.readdirSync(curDir).length === 0) {
                  fs.rmdirSync(curDir);
                  curDir = path.dirname(curDir);
                } else {
                  break;
                }
              }
              
              broadcastTerminal(`> [SANDBOX] Dosya başarıyla çalışma alanına aktarıldı: ${relPath}\n  `);
              addMessage('system', `[SANDBOX] Dosya onaylandı ve aktarıldı: ${relPath}`);
              broadcastSandboxState();
            }
          } catch (err) {
            console.error("Failed to commit sandbox file:", err);
            ws.send(JSON.stringify({ type: 'error', message: 'Dosya aktarılırken hata: ' + err.message }));
          }
          break;

        case 'discard_sandbox_file':
          try {
            const relPath = data.path;
            const containerRoot2 = path.resolve(path.join(__dirname, '..', '..'), '.container');
            const sourcePath2 = path.resolve(containerRoot2, relPath);
            // Path traversal guard: must stay inside .container
            if (!sourcePath2.startsWith(containerRoot2 + path.sep) && sourcePath2 !== containerRoot2) {
              ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz dosya yolu: sandbox dışına erişim engellendi.' }));
              break;
            }
            if (fs.existsSync(sourcePath2)) {
              fs.unlinkSync(sourcePath2);
              
              let curDir = path.dirname(sourcePath2);
              while (curDir !== containerRoot2) {
                if (fs.readdirSync(curDir).length === 0) {
                  fs.rmdirSync(curDir);
                  curDir = path.dirname(curDir);
                } else {
                  break;
                }
              }
              
              broadcastTerminal(`> [SANDBOX] Konteyner değişikliği reddedildi ve silindi: ${relPath}\n  `);
              addMessage('system', `[SANDBOX] Değişiklik reddedildi ve silindi: ${relPath}`);
              broadcastSandboxState();
            }
          } catch (err) {
            console.error("Failed to discard sandbox file:", err);
            ws.send(JSON.stringify({ type: 'error', message: 'Dosya silinirken hata: ' + err.message }));

          }
          break;

        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (e) {
      console.error('Error handling WS message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
  });
});
};
