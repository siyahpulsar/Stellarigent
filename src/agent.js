const fs = require('fs');
const path = require('path');
const discordBot = require('./discord/index.js');

const {
  agentState,
  config,
  getLmStudioEndpoint,
  getCanAnalyzeImages,
  broadcastState,
  broadcastTerminal,
  getAvailableGuides,
  addMessage,
  addTransientError,
  broadcastTaskStep,
  clearTaskSteps
} = require('./state');

const { checkBannedWords, assessActionRisk } = require('./security');
const { getMemoryPrompt, getWorkspaceRulesPrompt, filterReadmeByKeywords, addPendingRule } = require('./memory');
const { checkVisionCapability, executeTool } = require('./tools');

let pendingActionResolver = null;
let activeDiscordContext = null;

// -----------------------------------------------------------------------
// Central LLM fetch helper — handles LM Studio connection retry AND bridge mode
// Usage: const text = await llmFetch(messages, temperature)
// Retries LM Studio up to maxRetries before falling back to manual bridge mode.
// -----------------------------------------------------------------------
const { llmFetch, cleanMalformedJsonString, parseAssistantAction, parseAssistantActionWithMeta, resolveManualBridgeResponse, getDynamicSystemPrompt, IDE_PLANNER_PROMPT, IDE_CHECKER_PROMPT, getIdePlannerPrompt, getIdeCheckerPrompt } = require('./llm/llmClient');
const { runLibraryModeSubLoop } = require('./modes/libraryMode');
const { prepareRequestMessages, getPlannerModeRules } = require('./agent/contextBuilder');
const modelManager = require('./llm/modelManager');
const performanceTracker = require('./llm/performanceTracker');
const { saveCheckpoint, deleteCheckpoint } = require('./checkpoint');
const { sendSystemNotification } = require('./tools/notify');

async function fetchAndParseAction(requestMessages) {
  let assistantText = '';
  let action = null;
  let parseTier = 1;
  let retries = 0;
  const maxRetries = 2;
  const startTime = Date.now();

  while (retries <= maxRetries) {
    assistantText = await llmFetch(requestMessages, config.temperature, 'Agent Reasoning');
    const parsed = parseAssistantActionWithMeta(assistantText);
    action = parsed.action;
    parseTier = parsed.parseTier || 1;

    if (!action && (assistantText.includes('{') || assistantText.includes('```json'))) {
      retries++;
      if (retries <= maxRetries) {
        broadcastTerminal(`> [JSON PARSE ERROR] Model produced malformed JSON. Self-correcting (Attempt ${retries}/${maxRetries})...\n`);
        requestMessages.push({ role: 'assistant', content: assistantText });
        requestMessages.push({ role: 'user', content: 'Ürettiğin JSON hatalı veya parse edilemedi. Lütfen sadece düzgün formatta geçerli bir JSON çıktısı ver. Ek açıklamalar ekleme, markdown veya süslü parantez hatalarını düzelt.' });
        continue;
      }
    }
    break;
  }
  const latencyMs = Math.max(1, Date.now() - startTime);
  return { assistantText, action, parseTier, latencyMs, retries };
}

function recordActionThoughts(assistantText, action) {
  let thoughtText = '';
  if (action && action.explanation) {
    thoughtText = action.explanation;
  } else {
    thoughtText = assistantText.replace(/\`\`\`json[\s\S]*?\`\`\`/gi, '').trim().replace(/<tool[\s\S]*?<\/tool>/gi, '').trim();
  }
  if (thoughtText) {
    if (!agentState.thoughts) agentState.thoughts = [];
    if (!agentState.thoughts.includes(thoughtText)) {
      agentState.thoughts.push(thoughtText);
    }
  }

  if (action) {
    if (!agentState.executedTools) agentState.executedTools = [];
    const toolName = action.action;
    let toolDetail = toolName;
    if (toolName === 'execute_command') toolDetail += ` (\`${action.command}\`)`;
    else if (toolName === 'write_file' || toolName === 'read_file') toolDetail += ` (\`${action.path}\`)`;
    else if (toolName === 'select_guide') toolDetail += ` (\`${action.guide_name}\`)`;
    else if (toolName === 'web_search') toolDetail += ` (\`${action.query}\`)`;
    else if (toolName === 'view_website') toolDetail += ` (\`${action.url}\`)`;
    
    if (!agentState.executedTools.includes(toolDetail)) {
      agentState.executedTools.push(toolDetail);
    }
  }
}

async function requestUserApproval(action, steps) {
  let autoApproved = false;

  // CRITICAL risk check: Hard block or force manual review
  if (action.risk && action.risk.level === 'CRITICAL') {
    broadcastTerminal(`\n> [CRITICAL RISK DETECTED] Action risk is CRITICAL: ${action.risk.message}\n`);
    // Hard block if targeting protected project core files or banned system commands
    if (action.risk.message && (action.risk.message.includes('protected project') || action.risk.message.includes('blacklisted/banned'))) {
      broadcastTerminal(`\n*** [SECURITY HARD BLOCK] Proje çekirdek dosyalarına yetkisiz erişim veya yasaklı işlem algılandı. Eylem engellendi! ***\n`);
      return { approved: false, feedback: `Güvenlik Engeli: ${action.risk.message}` };
    }
  } else if (config.autoApprove && config.autoApprove[action.action]) {
    autoApproved = true;
    broadcastTerminal(`> [AUTO-APPROVED] Action approved automatically by safety settings.\n`);
  }

  if (autoApproved) {
    return { approved: true, action: action };
  } else {
    agentState.status = 'pending_approval';
    agentState.pendingAction = action;
    broadcastState();

    if (activeDiscordContext) {
      discordBot.updateDiscordStatus('pending_approval', `Step ${steps}/${config.maxSteps}`, `Awaiting dashboard approval for: **${action.action}**\nReason: *${action.explanation || 'None'}*`, agentState);
    }

    discordBot.sendApprovalRequest(action);

    const decision = await new Promise((resolve) => {
      pendingActionResolver = resolve;
    });
    agentState.pendingAction = null;
    return decision;
  }
}

function detectLoop(targetAction, toolResult, recentFailedCalls) {
  if (toolResult && toolResult.success === false) {
    const callSig = `${targetAction.action}:${targetAction.command || targetAction.path || targetAction.query || targetAction.url || ''}`;
    recentFailedCalls.push(callSig);
    if (recentFailedCalls.length > 3) recentFailedCalls.shift();
    if (recentFailedCalls.length === 3 && recentFailedCalls[0] === recentFailedCalls[1] && recentFailedCalls[1] === recentFailedCalls[2]) {
      broadcastTerminal(`\n*** [LOOP DETECTED] Same tool failed 3 times in a row. Auto-terminating to save tokens. ***\n`);
      return true;
    }
  } else {
    recentFailedCalls.length = 0; // Reset
  }
  return false;
}

// The main loop that communicates with LM Studio and iterates
async function runAgentLoop() {
  let steps = 0;
  const recentFailedCalls = []; // Track recent failed tool calls to detect infinite retry loops

  // Clear live task step panel for the new task
  clearTaskSteps();

  while (agentState.status === 'thinking' && steps < config.maxSteps) {
    steps++;
    broadcastTerminal(`\n*** [AGENT LOOP STEP ${steps}/${config.maxSteps}] Connecting to LLM... ***\n`);

    if (activeDiscordContext) {
      discordBot.updateDiscordStatus('thinking', `Step ${steps}/${config.maxSteps}`, 'Connecting to LLM and planning next action...', agentState);
    }

    let { dynamicSystemPrompt, activeRole } = await getDynamicSystemPrompt(steps);
    let selectedToolsForLpm = null;

    // -----------------------------------------------------------------------
    // HIGH PARAMETER MODE (HPM) — bypasses LPM/OM batch calls entirely.
    // For 30B+ models that can reason and select tools in a single pass.
    // -----------------------------------------------------------------------
    if (config.hpmMode) {
      broadcastTerminal(`> [HPM] High Parameter Mode active — LPM/OM bypassed. Single consolidated call.\n`);
      // Disable Swarm sub-roles in HPM — the large model handles planning itself
      activeRole = 'Agent';
      // Inject HPM directive into the system prompt
      dynamicSystemPrompt += `\n\n[HIGH PARAMETER MODE — SEN YÜK SEK KAPASİTELİ BİR MODELSİN]
Araç seçimini, planlamayı ve kararı TEK seferde kendin ver. Sana ayrı bir araç seçici veya planlayıcı çağrısı yapılmayacak.
Mevcut task ve konuşma geçmişini inceleyerek en uygun aracı direkt seç ve JSON formatında döndür.
Uzun açıklamalar yapma — doğrudan JSON aksiyonunu ver.`;
    }

    if (!config.hpmMode && config.lpmMode) {
      const { parseSystemPromptTools, getGuidelinesForTool, llmFetch, reconstructSystemPromptForLPM } = require('./llm/llmClient');
      const parsedPrompt = parseSystemPromptTools(config.systemPrompt);
      if (parsedPrompt && parsedPrompt.tools && parsedPrompt.tools.length > 0) {
        broadcastTerminal(`\n*** [LPM MODE] Initializing Low Parameter Mode for Tool Selection... ***\n`);
        addMessage('system', '[LPM] Low Parameter Mode (Düşük Parametre Modu) araç seçimi için başlatılıyor...');
        
        let idealToolIdea = null;
        if (config.lpmOmMode) {
          broadcastTerminal(`> [LPM OM] Querying LLM for ideal tool requirement...\n`);
          const omSystemPrompt = (config && config.systemPrompts && config.systemPrompts.om_ideal_tool) || 'You are a technical planner. Briefly describe the exact function and capability of the tool you need to complete the next step.';
          const omMessages = [
            { role: 'system', content: omSystemPrompt },
            { role: 'user', content: `Kullanıcıdan sana iletilen nihai isteğe göre ve sana iletilen task'e göre aklında nasıl bir tool kullanmak geçiyor? İsteğe göre nasıl bir tool kullanmak avantajlıdır? Seçmen gereken tool nasıl bir işlevi gerçekleştiriyor olmalı?\n\nTask: ${agentState.task}` }
          ];
          idealToolIdea = await llmFetch(omMessages, config.temperature, 'OM Ideal Tool');
          broadcastTerminal(`> [LPM OM] Ideal Tool Idea: ${idealToolIdea.substring(0, 100)}...\n`);
          addMessage('system', `[LPM OM] Ajanın ihtiyaç tespiti: "${idealToolIdea}"`);
        }

        const batchSize = config.lpmBatchSize || 1;
        let selectedBatch = null;

        for (let i = 0; i < parsedPrompt.tools.length; i += batchSize) {
          const batchTools = parsedPrompt.tools.slice(i, i + batchSize);
          let lpmUserPrompt = '';
          if (idealToolIdea) {
            lpmUserPrompt += `Aklımda şöyle bir toolu kullanmak var: ${idealToolIdea}\n\n`;
            lpmUserPrompt += `Sırada ki task: ${agentState.task}\n\n`;
          } else {
            lpmUserPrompt += `Task: ${agentState.task}\n\n`;
          }

          if (batchTools.length === 1) {
            lpmUserPrompt += `Görev listesinde yapıcağın sırada ki görevde aşağıda ki tool işe yarayıp yaramayacağını cevap vermelisin. Eğer bu tool, yapıcağın işlem için saçma ise "hayır", işlevli ve yerinde bir tool ise "evet" yanıtını ver.\n\n`;
          } else {
            lpmUserPrompt += `Görev listesinde yapıcağın sırada ki görevde aşağıda ki toolların işe yarayıp yaramayacağını cevap vermelisin. Eğer bu toollar yapıcağın işlem için saçma ise "hayır", içlerinden biri işlevli ve yerinde bir tool ise "evet" yanıtını ver.\n\n`;
          }

          batchTools.forEach((tool, idx) => {
            const guidelines = getGuidelinesForTool(tool, parsedPrompt.guidelines);
            lpmUserPrompt += `[Tool ${idx + 1}]\n${tool}\n`;
            if (guidelines.length > 0) {
              lpmUserPrompt += `Guidelines: ${guidelines.join(' ')}\n`;
            }
            lpmUserPrompt += `\n`;
          });

          lpmUserPrompt += `Bu tool${batchTools.length > 1 ? 'lar' : ''}, task üzerinde yapıcağın işleme göre gerekiyor ise "evet", gerekmiyor ise "hayır" yaz. (Sadece 'evet' veya 'hayır' yanıtı ver)`;

          const lpmMessages = [{ role: 'user', content: lpmUserPrompt }];
          const lpmResponse = await llmFetch(lpmMessages, 0.1, 'LPM Tool Check');
          addMessage('system', `[LPM Batch ${Math.floor(i/batchSize) + 1}] LLM Yanıtı: "${lpmResponse.replace(/\n/g, ' ')}"`);
          
          if (lpmResponse && lpmResponse.toLowerCase().includes('evet')) {
            selectedBatch = batchTools;
            broadcastTerminal(`> [LPM] Selected tool batch at index ${i}.\n`);
            addMessage('system', `[LPM] Gerekli araçlar ${Math.floor(i/batchSize) + 1}. Batch içerisinde bulundu.`);
            break;
          } else {
            broadcastTerminal(`> [LPM] Tool batch rejected (Reply: ${lpmResponse.substring(0, 30)}).\n`);
          }
        }

        if (selectedBatch) {
          selectedToolsForLpm = selectedBatch;
        } else {
          broadcastTerminal(`> [LPM] LPModu işe yaramadı. Fallback to full toolset.\n`);
          addMessage('system', 'LPModu işe yaramadı.', activeRole);
          if (activeDiscordContext) {
            discordBot.sendChannelMessage("⚠️ LPModu işe yaramadı, tüm araçlar yükleniyor...", null, { hasToolCall: false });
          }
        }
      }
    }

    if (!config.hpmMode && config.lpmMode && selectedToolsForLpm) {
      const { parseSystemPromptTools, reconstructSystemPromptForLPM } = require('./llm/llmClient');
      const parsedPrompt = parseSystemPromptTools(config.systemPrompt);
      const rebuiltPromptBase = reconstructSystemPromptForLPM(parsedPrompt, selectedToolsForLpm);
      if (rebuiltPromptBase) {
         const originalPrompt = config.systemPrompt;
         config.systemPrompt = rebuiltPromptBase;
         const res = await getDynamicSystemPrompt(steps);
         dynamicSystemPrompt = res.dynamicSystemPrompt;
         activeRole = res.activeRole;
         config.systemPrompt = originalPrompt;
      }
    }

    const requestMessages = await prepareRequestMessages(dynamicSystemPrompt);
    
    const { assistantText, action, parseTier, latencyMs, retries } = await fetchAndParseAction(requestMessages);

    addMessage('assistant', assistantText, config.advancedReasoningMode ? activeRole : null);

    if (activeDiscordContext) {
      let cleanText = assistantText.replace(/```json[\s\S]*?```/gi, '').trim();
      cleanText = cleanText.replace(/<tool[\s\S]*?<\/tool>/gi, '').trim();
      if (cleanText) {
        discordBot.sendChannelMessage(cleanText, null, { hasToolCall: !!action });
      }
    }

    recordActionThoughts(assistantText, action);

    if (!action) {
      broadcastTerminal(`\n*** Agent did not request any tools. Task complete! ***\n`);
      agentState.status = 'completed';
      broadcastState();
      break;
    }

    const risk = assessActionRisk(action);
    action.risk = risk;
    action.id = 'act-' + Date.now();

    broadcastTerminal(`\n[TOOL PROPOSED] Action: ${action.action}\nExplanation: ${action.explanation || 'None'}\nRisk Level: ${risk.level} (${risk.message})\n`);

    const userDecision = await requestUserApproval(action, steps);

    if (userDecision.approved) {
      const targetAction = (userDecision && userDecision.action) ? userDecision.action : action;
      agentState.status = 'executing';
      broadcastState();

      if (activeDiscordContext) {
        discordBot.updateDiscordStatus('executing', `Step ${steps}/${config.maxSteps}`, `Executing tool: **${targetAction.action}**`, agentState);
      }

      // --- Live Task Step: emit START ---
      const stepId = 'step-' + steps + '-' + Date.now();
      function getStepLabel(act) {
        if (act.action === 'execute_command') return act.command ? String(act.command).substring(0, 60) : 'execute_command';
        if (act.action === 'write_file' || act.action === 'read_file') return act.path ? act.path.split(/[\\/]/).pop() : act.action;
        if (act.action === 'web_search') return act.query ? '"' + String(act.query).substring(0, 50) + '"' : 'web_search';
        if (act.action === 'view_website') return act.url ? String(act.url).substring(0, 60) : 'view_website';
        if (act.action === 'library_mode') return act.search ? '"' + String(act.search).substring(0, 50) + '"' : 'library_mode';
        return act.action;
      }
      const stepEntry = {
        id: stepId,
        index: steps,
        tool: targetAction.action,
        label: getStepLabel(targetAction),
        thought: targetAction.explanation ? String(targetAction.explanation).substring(0, 120) : '',
        status: 'running',
        startedAt: Date.now(),
        durationMs: null
      };
      agentState.taskSteps.push(stepEntry);
      broadcastTaskStep(stepEntry);
      // --- End step START ---

      const toolResult = await executeTool(targetAction);

      // --- Live Task Step: emit DONE/ERROR ---
      stepEntry.durationMs = Date.now() - stepEntry.startedAt;
      stepEntry.status = (toolResult && toolResult.success !== false) ? 'done' : 'error';
      broadcastTaskStep(stepEntry);
      // --- End step DONE/ERROR ---

      // Save terminal result print before lastToolOutput overrides
      broadcastTerminal(`[RESULT] ${JSON.stringify(toolResult, null, 2)}\n`);

      // AMPR (Adaptive Model Performance Router) Runtime Telemetry Hook
      try {
        const currentModel = await modelManager.getCurrentLoadedModel() || config.modelName || 'local-model';
        const isToolSuccess = Boolean(toolResult && toolResult.success !== false && !toolResult.tripwireTriggered);
        performanceTracker.recordExecution({
          modelId: currentModel,
          toolName: targetAction.action,
          parseTier: parseTier || 1,
          success: isToolSuccess,
          retriesNeeded: retries || 0,
          latencyMs: latencyMs || 0
        });
      } catch (amprErr) {
        // AMPR telemetry failure must never disrupt agent loop
      }

      // Emergency Tripwire Circuit Breaker
      if (toolResult && toolResult.tripwireTriggered) {
        broadcastTerminal(`\n*** [ACİL DURUM FRENİ] Tripwire tetiklendi! Ajan sistem tarafından zorla durduruldu! ***\n`);
        agentState.status = 'failed';
        addMessage('system', `[ACİL DURUM GÜVENLİK FRENİ] ${toolResult.message}`, config.advancedReasoningMode ? activeRole : null);
        broadcastState();
        break;
      }

      if (detectLoop(targetAction, toolResult, recentFailedCalls)) {
        addMessage('system', 'System: Ajan aynı aracı üst üste 3 kez aynı parametrelerle çağırıp başarısız oldu. Sonsuz döngüyü önlemek için görev durduruldu.', config.advancedReasoningMode ? activeRole : null);
        agentState.status = 'failed';
        broadcastState();
        break;
      }

      // --- Otomatik Fallback Model Geçişi (success: false → fallbackTag modeli yükle) ---
      if (toolResult && toolResult.success === false && config.modelSwitchingEnabled) {
        try {
          const { switched, modelId } = await modelManager.switchToFallbackModel(targetAction.action);
          if (switched && modelId) {
            broadcastTerminal(`> [MODEL MANAGER] Fallback model aktif: ${modelId}. Ajan bir sonraki adımda bu modeli kullanacak.\n`);
            addMessage('system', `[MODEL FALLBACK] "${targetAction.action}" tool başarısız oldu. Fallback modele geçildi: ${modelId}`);
          }
        } catch (fallbackErr) {
          broadcastTerminal(`> [MODEL MANAGER] Fallback switch error (non-fatal): ${fallbackErr.message}\n`);
        }
      }
      // --------------------------------------------------------------------------

      let imagePath = null;
      if (toolResult && toolResult.success) {
        if (targetAction.action === 'take_screenshot' && toolResult.filename) {
          imagePath = path.join(__dirname, '..', 'public', toolResult.filename);
        } else if (targetAction.action === 'download_image' && toolResult.savedPath) {
          imagePath = toolResult.savedPath;
        }
      }

      // We need to require this here locally to avoid circular dependency for runLibraryModeSubLoop 
      // or handle library mode in the tools logic directly. Actually, executeTool handles library mode partially, 
      // but in original code, it called runLibraryModeSubLoop here.
      if (targetAction.action === 'library_mode') {
        const { runLibraryModeSubLoop } = require('./modes/libraryMode');
        const libraryResults = await runLibraryModeSubLoop(targetAction.search, targetAction.explanation);
        if (libraryResults) {
          toolResult.message = libraryResults;
        }
      }

      if (targetAction.action !== 'filter_output') {
        let textToSave = '';
        if (toolResult) {
          if (toolResult.content) textToSave = toolResult.content;
          else if (toolResult.message) textToSave = toolResult.message;
          else textToSave = JSON.stringify(toolResult);
        }
        agentState.lastToolOutput = textToSave;
      }

      addMessage('system', `Tool Output:\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\``, config.advancedReasoningMode ? activeRole : null, imagePath);

      if (toolResult && toolResult.success === false) {
        addTransientError(`[${targetAction.action}] ${toolResult.message || toolResult.error || 'Tool execution failed'}`);
      }

      // --- Checkpoint: Başarılı her adım sonrası durumu kaydet ---
      if (toolResult && toolResult.success !== false && targetAction.action !== 'task_complete') {
        saveCheckpoint(agentState, steps, config);
      }

      if (config.advancedReasoningMode && agentState.planSteps.length > 0 && toolResult.success !== false) {
        const nonAdvancingActions = ['select_guide', 'task_complete'];
        if (!nonAdvancingActions.includes(targetAction.action)) {
          const currentIdx = agentState.planSteps.findIndex(s => s.status === 'current');
          if (currentIdx !== -1) {
            agentState.planSteps[currentIdx].status = 'completed';
            if (currentIdx + 1 < agentState.planSteps.length) {
              agentState.planSteps[currentIdx + 1].status = 'current';
            }
          }
        }
      }

      if (targetAction.action === 'task_complete') {
        agentState.status = 'completed';
        broadcastState();
        // Görev bitti: checkpoint'i temizle ve kullanıcıya bildirim gönder
        deleteCheckpoint();
        sendSystemNotification(
          'Görev Tamamlandı ✅',
          `Stellarigent: "${String(agentState.task || '').substring(0, 80)}" görevi başarıyla tamamlandı.`,
          'info'
        ).catch(() => {});
        break;
      }

      if (agentState.status !== 'completed') {
        agentState.status = 'thinking';
      }
      broadcastState();

    } else {
      broadcastTerminal(`[REJECTED] Action rejected by user. Feedback: "${userDecision.feedback || 'No comments'}"\n`);
      addTransientError(`[USER_REJECTION] ${targetAction.action}: ${userDecision.feedback || 'No comments'}`);
      
      // --- Rejection Analysis Sub-loop ---
      broadcastTerminal(`> [ANALYSIS] Starting self-analysis based on rejection feedback...\n`);
      
      const initialPrompt = agentState.messages.find(m => m.role === 'user')?.content || agentState.task || 'Unknown Task';
      const pastActions = (agentState.executedTools && agentState.executedTools.length > 0) 
                            ? agentState.executedTools.join(', ') 
                            : 'No tools executed yet';
      const feedback = userDecision.feedback || 'No specific reason provided';
      
      const analysisSystemPrompt = (config.systemPrompts && config.systemPrompts.qa_analysis) || `You are a strict QA and debugging AI. Your task is to analyze why the previous AI agent failed and was rejected by the user.
You will be provided with:
1. The user's initial request.
2. The tools/actions the agent has executed so far.
3. The user's specific rejection reason.

Your output must be a short, clear, and direct analysis of the mistake, followed by a concrete plan on how the agent should correct its behavior in the next steps. Do NOT apologize. Do NOT use markdown code blocks. Just write plain text advising the agent.`;

      const analysisUserPrompt = `[Initial Request]: ${initialPrompt}
[Executed Actions]: ${pastActions}
[Rejection Reason]: ${feedback}

Analyze the failure and provide instructions for correction.`;

      try {
        const analysisResult = await llmFetch([
          { role: 'system', content: analysisSystemPrompt },
          { role: 'user', content: analysisUserPrompt }
        ], 0.3, 'Rejection Analysis');
        
        broadcastTerminal(`> [ANALYSIS RESULT]\n${analysisResult}\n`);
        
        // Append analysis to agent's memory
        addMessage('system', `[REJECTION ANALYSIS & CORRECTION PLAN]\nThe user rejected your last action. Reason: "${feedback}".\n\nSelf-Correction Plan:\n${analysisResult}\n\nFollow this plan immediately.`, config.advancedReasoningMode ? activeRole : null);

        // --- Distill Security/Persistent Rule (Pending User Review) ---
        try {
          const rulePrompt = `Kullanıcı şu eylemi reddetti:
Eylem: ${JSON.stringify(targetAction)}
Gerekçe: "${feedback}"

Soru: Kullanıcının bu eylemi reddetmesi kalıcı ve genel bir GÜVENLİK KURALI veya ASLA YAPILMAMASI GEREKEN BİR KURAL (Örn: "Projedeki .env dosyasını silme", "Kullanıcı onayı olmadan açık portları kapatma") gerektirir mi?
Yoksa sadece o ana özgü geçici bir fikir değişikliği/tercih midir?

Eğer genel ve kritik bir kural gerektiriyorsa JSON formatında:
{"isSecurityRule": true, "rule": "Net, emir kipinde kısa kural cümlesi", "category": "SECURITY_VIOLATION"}
Eğer geçici bir tercihse veya genel kural gerekmiyorsa:
{"isSecurityRule": false}
SADECE GEÇERLİ JSON DÖNDÜR.`;

          const ruleRes = await llmFetch([
            { role: 'system', content: 'Sen sadece JSON döndüren güvenlik kuralı analizcisisin.' },
            { role: 'user', content: rulePrompt }
          ], 0.1, 'Rule Distillation');

          let parsedRule = null;
          try {
            const cleanJson = ruleRes.replace(/```json|```/gi, '').trim();
            parsedRule = JSON.parse(cleanJson);
          } catch {}

          if (parsedRule && parsedRule.isSecurityRule && parsedRule.rule) {
            const newPending = await addPendingRule({
              rule: parsedRule.rule,
              category: parsedRule.category || 'SECURITY_VIOLATION',
              context: feedback,
              exceptions: Array.isArray(parsedRule.exceptions) ? parsedRule.exceptions : []
            });
            broadcastTerminal(`\n> [SAFETY RULE PROPOSED] Yeni güvenlik kuralı önerildi (Onay bekliyor): "${parsedRule.rule}"\n`);
            addMessage('system', `[YENİ GÜVENLİK KURALI ÖNERİSİ]\n"${parsedRule.rule}"\n(Bu kural ayarlar ekranında veya Discord üzerinden onayınızı beklemektedir).`);
            if (discordBot && discordBot.sendPendingRuleProposal && newPending) {
              discordBot.sendPendingRuleProposal(newPending);
            }
          }
        } catch (ruleDistillErr) {
          console.error('[RULE DISTILL ERROR]', ruleDistillErr);
        }
      } catch (err) {
        broadcastTerminal(`> [ANALYSIS ERROR] Failed to run rejection analysis: ${err.message}\n`);
        addMessage('system', `Action rejected by user. Feedback: ${feedback}`, config.advancedReasoningMode ? activeRole : null);
      }

      if (activeDiscordContext) {
        discordBot.updateDiscordStatus('thinking', `Step ${steps}/${config.maxSteps}`, `Action rejected on dashboard. Feedback: ${userDecision.feedback || 'None'}`, agentState);
      }

      agentState.status = 'thinking';
      broadcastState();
    }
  }

  if (steps >= config.maxSteps && agentState.status === 'thinking') {
    broadcastTerminal(`\n*** [MAX STEPS REACHED] Terminating to prevent infinite loops. ***\n`);
    addMessage('system', 'System Limit: Task stopped because it exceeded the maximum allowed iterations.', config.advancedReasoningMode ? 'Tester' : null);
    agentState.status = 'failed';
    broadcastState();
    // Başarısız / limit aşıldı: checkpoint'i temizle ve kullanıcıya hata bildirimi gönder
    deleteCheckpoint();
    sendSystemNotification(
      'Görev Başarısız ❌',
      `Stellarigent: "${String(agentState.task || '').substring(0, 80)}" görevi maksimum adım sayısına ulaşıp durduruldu.`,
      'warning'
    ).catch(() => {});
  }

  if (activeDiscordContext) {
    discordBot.sendDiscordFinalResult(agentState.status === 'completed' ? 'Görev başarıyla tamamlandı! ✅' : 'Görev başarısız oldu veya durduruldu. ❌');
    activeDiscordContext = null;
  }
}

// Core Filter Context & Pre-select guide Mode Sequence
async function initializeTaskContextAndSelectMode(userTask) {
  const readmePath = path.join(agentState.cwd, 'agent_readme.md');
  if (!fs.existsSync(readmePath)) {
    const { getFolderStructureSummary } = require('./memory');
    const folderStructure = await getFolderStructureSummary(agentState.cwd);
    await fs.promises.writeFile(readmePath, `# Stellarigent Project Workspace\n\n## Directory Structure\n\`\`\`\n${folderStructure}\n\`\`\`\n\n## What I Accomplished & Learned\n- Initialized repository.\n`, 'utf-8');
  }
  const readmeContent = await fs.promises.readFile(readmePath, 'utf-8');

  broadcastTerminal(`\n*** [INITIALIZATION] Reading and filtering agent_readme.md context... ***\n`);
  // Will addMessage after messages array reset so it actually shows up
  let relevantInfoStr = '';

  const relevantInfo = filterReadmeByKeywords(readmeContent, userTask);
  relevantInfoStr = relevantInfo;
  broadcastTerminal(`> [AGENT README FILTERED] Extracted relevant info using local keyword scorer:\n${relevantInfo}\n`);

  if (agentState.activeMode === 'manuel') {
    agentState.messages = [];
  }
  // Reset other execution context variables
  agentState.planSteps = [];

  // Agent Runner JSON Parsing
  if (agentState.activeMode === 'agent_runner') {
    try {
      const parsed = JSON.parse(userTask.trim());
      if (Array.isArray(parsed)) {
        agentState.planSteps = parsed.map((item, idx) => {
          let text = typeof item === 'string' ? item : (item.text || item.step || JSON.stringify(item));
          return { text, status: idx === 0 ? 'current' : 'pending' };
        });
        config.advancedReasoningMode = true;
        broadcastTerminal(`\n*** [AGENT RUNNER] Parsed ${agentState.planSteps.length} steps from JSON. ***\n`);
      }
    } catch (e) {
      // Not JSON, assume autonomous mode
      config.forceTaskPlan = true;
      broadcastTerminal(`\n*** [AGENT RUNNER] Plain text detected, autonomous planning enabled. ***\n`);
    }
  }

  agentState.selectedGuides = [];
  agentState.executedTools = [];
  agentState.thoughts = [];
  agentState.hasReadAgentUserJson = false; // Reset tripwire for new task
  broadcastState();

  addMessage('system', `[INITIALIZATION] Geçmiş çalışma belleği (agent_readme.md) okundu ve filtrelendi.`);

  const renewedPrompt = `Task: "${userTask}"\n\nPast Workspace History (For context only, not current rules or system constraints): [${relevantInfo}]`;
  addMessage('user', renewedPrompt);

  const guides = getAvailableGuides();
  let selectedGuide = null;

  if (guides.length > 0) {
    broadcastTerminal(`\n*** [MODE SELECT] Determining guide mode selection... ***\n`);
    addMessage('system', `[MODE SELECT] Ajan rehber (guide) kütüphanesini tarıyor...`);

    let choosingGuideInstructions = '';
    const metaGuidePath = path.join(agentState.cwd, 'Libraries', 'ObsiLibrary', 'ObsiLibrary', 'choosing_guide_guide.md');
    try {
      choosingGuideInstructions = await fs.promises.readFile(metaGuidePath, 'utf-8');
    } catch {
      // File may not exist — fallback to empty string is fine
    }

    const guideOptions = guides.map((g, i) => `${i + 1}: ${g.name}`).join('\n');
    const selectorPrompt = `Given the user task: "${userTask}"
We have the following guide files available in our library:
${guideOptions}

Which of these guides would be most useful to load as a system prompt/instructions for this task?
Reply with the number or exact file name of the guide. If none are relevant or needed, reply with 'None'.
Output ONLY the option (e.g. "1" or "None"), no other text.`;

    const selectorSystemPrompt = `You are a precise classifier. Use the following guide selection instructions to decide which guide matches the task:\n\n${choosingGuideInstructions || 'Select the most relevant guide from the list.'}`;

    try {
      const choice = await llmFetch([
        { role: 'system', content: selectorSystemPrompt },
        { role: 'user', content: selectorPrompt }
      ], 0.1, 'Guide Selection');
      const choiceTrimmed = choice.trim();
      broadcastTerminal(`> [LLM MODE CHOICE] Raw selection output: "${choiceTrimmed}"\n`);

      let matchedGuide = null;
      if (choiceTrimmed.toLowerCase() !== 'none') {
        const numMatch = choiceTrimmed.match(/^\d+/);
        if (numMatch) {
          const idx = parseInt(numMatch[0]) - 1;
          if (idx >= 0 && idx < guides.length) {
            matchedGuide = guides[idx];
          }
        } else {
          matchedGuide = guides.find(g =>
            g.name.toLowerCase().includes(choiceTrimmed.toLowerCase()) ||
            choiceTrimmed.toLowerCase().includes(g.name.toLowerCase())
          );
        }
      }

      if (matchedGuide) {
        selectedGuide = matchedGuide;
        broadcastTerminal(`> [MODE ACTIVATED] Guide selected: ${selectedGuide.name}\n`);
      } else {
        broadcastTerminal(`> [MODE ACTIVATED] No guide selected (None).\n`);
      }
    } catch (err) {
      console.error("Guide selection call failed:", err);
    }
  }

  if (selectedGuide) {
    try {
      agentState.activeGuideName = selectedGuide.name;
      agentState.activeGuideContent = await fs.promises.readFile(selectedGuide.path, 'utf-8');
      agentState.selectedGuides = [selectedGuide.name];
      addMessage('system', `Loaded system guide: ${selectedGuide.name}\n\nGuide Content:\n${agentState.activeGuideContent}`);
    } catch (e) {
      console.error("Failed to load guide:", e);
    }
  } else {
    agentState.activeGuideName = null;
    agentState.activeGuideContent = null;
  }

  broadcastState();
}

async function startDiscordAgentTask(taskContent, messageContext, replyMsg) {
  if (agentState.status !== 'idle' && agentState.status !== 'completed' && agentState.status !== 'failed') {
    await replyMsg.edit("❌ Ajan şu anda başka bir görevle meşgul!");
    return;
  }
  const bannedWord = checkBannedWords(taskContent);
  if (bannedWord) {
    broadcastTerminal(`\n[BANNED WORD DETECTED] Task contains banned phrase: "${bannedWord}"\n`);
    await replyMsg.edit(`❌ İstek güvenlik kuralları gereği yasaklı bir kelime ("${bannedWord}") içeriyor! İşlem durduruldu.`);
    agentState.status = 'failed';
    broadcastState();
    return;
  }
  activeDiscordContext = {
    message: messageContext,
    replyMessage: replyMsg,
    channel: messageContext.channel
  };

  agentState.task = `[Discord: @${messageContext.author.username}] ${taskContent}`;
  agentState.status = 'thinking';
  broadcastState();

  const getCanAnalyze = getCanAnalyzeImages();
  if (getCanAnalyze === null) {
    await checkVisionCapability();
  }

  await initializeTaskContextAndSelectMode(taskContent);
  runAgentLoop();
}


async function handleDiscordAgentAction(action, updateCallback) {
  return new Promise(async (resolve) => {
    const risk = assessActionRisk(action);
    action.risk = risk;
    action.id = 'act-discord-' + Date.now();

    if (risk.level === 'CRITICAL' && risk.message && (risk.message.includes('protected project') || risk.message.includes('blacklisted/banned'))) {
      broadcastTerminal(`\n*** [SECURITY HARD BLOCK] Discord üzerinden proje çekirdek dosyalarına müdahale veya yasaklı işlem algılandı. Eylem engellendi! ***\n`);
      return resolve({ success: false, message: `Güvenlik Engeli: ${risk.message}` });
    }

    updateCallback({ status: 'pending_approval', log: 'Awaiting Web UI approval...' });

    agentState.status = 'pending_approval';
    agentState.pendingAction = action;
    broadcastState();

    discordBot.sendApprovalRequest(action);

    const userDecision = await new Promise((resolveDecision) => {
      pendingActionResolver = resolveDecision;
    });

    agentState.pendingAction = null;

    if (userDecision.approved) {
      updateCallback({ status: 'executing', log: 'Executing approved action...' });
      agentState.status = 'executing';
      broadcastState();

      const targetAction = userDecision.action;
      const toolResult = await executeTool(targetAction);

      agentState.status = 'idle';
      broadcastState();

      resolve({ success: toolResult.success, message: JSON.stringify(toolResult) });
    } else {
      agentState.status = 'idle';
      broadcastState();
      resolve({ success: false, message: `Action rejected: ${userDecision.feedback || 'declined'}` });
    }
  });
}

function getPendingAction() {
  return agentState.pendingAction;
}

// Removed resolveManualBridgeResponse because it is now in llmClient.js

function resolvePendingAction(decision) {
  if (pendingActionResolver && agentState.status === 'pending_approval') {
    const resolver = pendingActionResolver;
    pendingActionResolver = null;
    resolver(decision);
    return true;
  }
  return false;
}

// --- NEW STRICT IDE MULTI-AGENT FLOW ---

async function initializeIdeTaskContext(userTask) {
  agentState.task = userTask;
  agentState.messages = [];
  agentState.planSteps = [];
  agentState.executedTools = [];
  agentState.thoughts = [];
  agentState.ideInterrupted = null;
  agentState.status = 'thinking';
  broadcastState();

  broadcastTerminal(`\n*** [IDE SWARM] Başlatılıyor: Görev Planlama Aşaması ***\n`);
  addMessage('system', `[IDE SWARM] Yeni istek alındı, planlama aşamasına geçiliyor.`);

  // Step 1: Planner Summary
  const modeRules = getPlannerModeRules(agentState);
  const plannerMessages = [
    { role: 'system', content: getIdePlannerPrompt() + modeRules },
    { role: 'user', content: `Kullanıcı İsteği:\n${userTask}` }
  ];
  const plannerSummary = await llmFetch(plannerMessages, 0.2, 'IDE Planner');
  broadcastTerminal(`> [IDE PLANNER] Özet Plan:\n${plannerSummary}\n`);
  addMessage('system', `[IDE PLANNER] Özet Plan:\n${plannerSummary}`);

  // Step 2: Task List Generation
  const originalForce = config.forceTaskPlan;
  config.forceTaskPlan = true;
  const { dynamicSystemPrompt } = await getDynamicSystemPrompt(1);
  config.forceTaskPlan = originalForce;

  const defaultConverter = 'Sen bir görev planlayıcısın (Task Planner). Aşağıdaki metin planını kullanarak ZORUNLU olarak \'task_plan\' aracını çağırıp, bu metindeki adımları JSON formatında bir görev listesine (checklist) çevirmelisin. Sadece task_plan aracını kullan.';
  const taskConverterPrompt = (config && config.systemPrompts && config.systemPrompts.task_plan_converter) || defaultConverter;
  const taskListMessages = [
    { role: 'system', content: `${taskConverterPrompt}\n\n${dynamicSystemPrompt}` },
    { role: 'user', content: `İşte plan:\n${plannerSummary}` }
  ];

  let action = null;
  let retries = 0;
  let assistantText = '';
  while (retries < 3) {
    assistantText = await llmFetch(taskListMessages, 0.2, 'IDE Task List');
    action = parseAssistantAction(assistantText);
    if (action && action.action === 'task_plan') break;
    retries++;
    taskListMessages.push({ role: 'assistant', content: assistantText });
    taskListMessages.push({ role: 'user', content: 'Lütfen sadece task_plan aracını kullanarak geçerli bir JSON çıktısı ver.' });
  }

  if (action && action.action === 'task_plan') {
     if (action.plan && Array.isArray(action.plan)) {
       agentState.planSteps = action.plan.map((item, idx) => {
         let text = typeof item === 'string' ? item : (item.text || item.step || JSON.stringify(item));
         return { text, status: idx === 0 ? 'current' : 'pending' };
       });
     }
     broadcastTerminal(`> [IDE TASK LIST] Görev listesi oluşturuldu (${agentState.planSteps.length} görev).\n`);
  } else {
     broadcastTerminal(`> [IDE TASK LIST] Görev listesi oluşturulamadı, varsayılan tek görev eklendi.\n`);
     agentState.planSteps = [{ text: userTask, status: 'current' }];
  }
  broadcastState();
}

async function runIdeSwarmLoop() {
  let recentFailures = 0;

  while (agentState.status === 'thinking' && agentState.planSteps.length > 0) {
    // Check Interrupt
    if (agentState.ideInterrupted) {
      broadcastTerminal(`\n*** [IDE SWARM] Yeni Prompt Girildi. Task Listesi Yeniden Düzenleniyor... ***\n`);
      const interruptTask = agentState.ideInterrupted;
      agentState.ideInterrupted = null;
      agentState.task = interruptTask; 
      
      const completedSteps = agentState.planSteps.filter(s => s.status === 'completed').map(s => s.text);
      
      const plannerMsgs = [
        { role: 'system', content: getIdePlannerPrompt() + getPlannerModeRules(agentState) },
        { role: 'user', content: 'Lütfen güncel adımları yaz.' }
      ];
      const plannerSummary = await llmFetch(plannerMsgs, 0.2, 'IDE Planner Interrupted');
      broadcastTerminal(`> [IDE PLANNER] Güncellenmiş Özet Plan:\n${plannerSummary}\n`);
      
      const originalForce = config.forceTaskPlan;
      config.forceTaskPlan = true;
      const { dynamicSystemPrompt } = await getDynamicSystemPrompt(1);
      config.forceTaskPlan = originalForce;

      const taskListMessages = [
        { role: 'system', content: `${taskConverterPrompt}\n\n${dynamicSystemPrompt}` },
        { role: 'user', content: `İşte plan:\n${plannerSummary}` }
      ];
      
      let action = null;
      let retries = 0;
      let assistantText = '';
      while (retries < 3) {
        assistantText = await llmFetch(taskListMessages, 0.2, 'IDE Task List');
        action = parseAssistantAction(assistantText);
        if (action && action.action === 'task_plan') break;
        retries++;
        taskListMessages.push({ role: 'assistant', content: assistantText });
        taskListMessages.push({ role: 'user', content: 'Lütfen sadece task_plan aracını kullan.' });
      }

      if (action && action.action === 'task_plan' && action.plan && Array.isArray(action.plan)) {
         const newSteps = action.plan.map((item, idx) => {
           let text = typeof item === 'string' ? item : (item.text || item.step || JSON.stringify(item));
           return { text, status: idx === 0 ? 'current' : 'pending' };
         });
         agentState.planSteps = [
           ...completedSteps.map(text => ({ text, status: 'completed' })),
           ...newSteps
         ];
         broadcastTerminal(`> [IDE TASK LIST] Görev listesi güncellendi.\n`);
      }
      broadcastState();
      continue; 
    }

    const currentStepIndex = agentState.planSteps.findIndex(s => s.status === 'current');
    if (currentStepIndex === -1) {
      if (agentState.planSteps.every(s => s.status === 'completed')) {
        broadcastTerminal(`\n*** [IDE SWARM] Tüm görevler tamamlandı! ***\n`);
        agentState.status = 'completed';
        broadcastState();
        break;
      } else {
        // Recover: promote first pending step to current instead of breaking
        const pendingIdx = agentState.planSteps.findIndex(s => s.status === 'pending');
        if (pendingIdx !== -1) {
          agentState.planSteps[pendingIdx].status = 'current';
          broadcastState();
          continue; // Re-enter loop with newly promoted step
        } else {
          // No current, no pending — should not happen, but break safely
          agentState.status = 'completed';
          broadcastState();
          break;
        }
      }
    }

    const currentTask = agentState.planSteps[currentStepIndex].text;
    broadcastTerminal(`\n*** [IDE SWARM] Geliştirici Ajan çalışıyor (Görev: ${currentTask}) ***\n`);
    
    // Call Developer
    const { dynamicSystemPrompt } = await getDynamicSystemPrompt(2);
    const devSystemPrompt = `${dynamicSystemPrompt}\n\n[IDE SWARM] Sen Developer Ajansın.
Şu anki tek görevin: "${currentTask}"
Bu görevi tamamlamak için uygun bir araç (tool) çağır. Sadece tek bir araç çağırabilirsin.`;
    
    let anchorWarning = `[SİSTEM UYARISI] Developer Ajan, şu anki tek görevin: "${currentTask}"\n\n`;
    
    const lastMsg = agentState.messages.length > 0 ? agentState.messages[agentState.messages.length - 1] : null;
    if (lastMsg && lastMsg.role === 'system' && lastMsg.content.includes('Checker Kontrolü Başarısız')) {
       anchorWarning += `[ÖNEMLİ DİKKAT] BİR ÖNCEKİ DENEMEN BAŞARISIZ OLDU! Checker Geri Bildirimi:\n${lastMsg.content}\n\nLÜTFEN AYNI PARAMETRELERLE AYNI ARACI ÇAĞIRMA. FARKLI BİR ARAMA SORGUSU, FARKLI BİR URL VEYA FARKLI BİR STRATEJİ DENE!\n\n`;
    }

    anchorWarning += `LÜTFEN DİKKAT: Görevi yapmak için MUTLAKA geçerli bir JSON formatında ARAÇ (TOOL) ÇAĞRISI ÜRET. Eğer görev "raporlama yapmak" veya "sonuçları sunmak" gibi son bir adımsa, SAKIN araç çağırma! Bunun yerine geçmiş mesajlarda topladığın tüm bilgileri (Tool Output'ları) kullanarak ÇOK DETAYLI, UZUN ve ZENGİN bir DÜZ METİN RAPORU yazıp cevap ver. ASLA JSON formatını bozma.`;

    const devMessages = [
      { role: 'system', content: devSystemPrompt },
      ...agentState.messages,
      { role: 'user', content: anchorWarning }
    ];
    
    const { assistantText, action } = await fetchAndParseAction(devMessages);
    addMessage('assistant', assistantText, 'Developer');
    
    if (!action) {
      broadcastTerminal(`> [IDE SWARM] Developer araç seçemedi. Checker'a gidiliyor...\n`);
      addMessage('system', `[IDE SWARM] Developer bu adım için araç seçemedi. Checker durumu değerlendirecek.`, 'Developer');
      agentState.lastToolOutput = "Hiçbir araç (tool) çağrılmadı ve çıktı üretilmedi. Geliştirici ajanın doğrudan düz metin açıklaması: " + assistantText;
    } else {
      const risk = assessActionRisk(action);
      action.risk = risk;
      action.id = 'act-' + Date.now();
      
      const userDecision = await requestUserApproval(action, currentStepIndex + 1);
      
      if (userDecision.approved) {
        agentState.status = 'executing';
        broadcastState();
        
        const toolResult = await executeTool(userDecision.action);
        const targetAction = userDecision.action;

        // Save terminal result print before overrides
        broadcastTerminal(`[RESULT] ${JSON.stringify(toolResult, null, 2)}\n`);

        if (toolResult && toolResult.tripwireTriggered) {
          broadcastTerminal(`\n*** [ACİL DURUM FRENİ] Tripwire tetiklendi! Swarm Developer döngüsü durduruldu! ***\n`);
          agentState.status = 'failed';
          addMessage('system', `[ACİL DURUM GÜVENLİK FRENİ] ${toolResult.message}`, 'Developer');
          broadcastState();
          break;
        }

        if (targetAction.action === 'library_mode') {
          const { runLibraryModeSubLoop } = require('./modes/libraryMode');
          const libraryResults = await runLibraryModeSubLoop(targetAction.search, targetAction.explanation);
          if (libraryResults) {
            toolResult.message = libraryResults;
          }
        }

        let textToSave = '';
        if (toolResult) {
          if (toolResult.content) textToSave = toolResult.content;
          else if (toolResult.message) textToSave = toolResult.message;
          else textToSave = JSON.stringify(toolResult);
        }
        agentState.lastToolOutput = textToSave;

        addMessage('system', `Tool Output:\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\``, 'Developer');
        agentState.status = 'thinking';
        broadcastState();
      } else {
        broadcastTerminal(`> [IDE SWARM] Kullanıcı aracı reddetti.\n`);
        addMessage('system', `Tool rejected by user: ${userDecision.feedback}`, 'Developer');
        agentState.status = 'thinking';
        broadcastState();
      }
    }

    // Call Checker
    broadcastTerminal(`\n*** [IDE SWARM] Checker Ajan kontrol ediyor... ***\n`);
    const checkerMessages = [
      { role: 'system', content: getIdeCheckerPrompt() },
      { role: 'user', content: `Tüm Proje Hedefi: ${agentState.task}\n\nTüm Görev Listesi: ${JSON.stringify(agentState.planSteps)}\n\nŞu anki Görev: ${currentTask}\n\nÇalıştırılan Aracın Çıktısı (veya son durum): ${agentState.lastToolOutput}` }
    ];
    
    const checkerResponseStr = await llmFetch(checkerMessages, 0.1, 'IDE Checker');
    broadcastTerminal(`> [IDE CHECKER] Karar:\n${checkerResponseStr}\n`);
    
    let checkerResult = null;
    try {
      // Match first JSON object in the response (correct regex — no double escaping)
      const jsonMatch = checkerResponseStr.match(/\{[\s\S]*?\}/);
      if (jsonMatch) checkerResult = JSON.parse(jsonMatch[0]);
    } catch(e) {
      broadcastTerminal(`> [IDE CHECKER] JSON parse failed, using raw text as feedback.\n`);
    }

    if (checkerResult && checkerResult.status === 'completed') {
      agentState.planSteps[currentStepIndex].status = 'completed';
      if (currentStepIndex + 1 < agentState.planSteps.length) {
        agentState.planSteps[currentStepIndex + 1].status = 'current';
      }
      recentFailures = 0; 
      broadcastTerminal(`> [IDE SWARM] Görev başarıyla tamamlandı, sıradakine geçiliyor.\n`);
      addMessage('system', `[IDE SWARM] Checker onayladı: "${currentTask}" başarıyla tamamlandı. Sıradaki göreve geçiliyor.`);
    } else {
      recentFailures++;
      const feedback = checkerResult ? checkerResult.feedback : checkerResponseStr;
      broadcastTerminal(`> [IDE SWARM] Görev başarısız. (Hata: ${recentFailures}/3) - Geri Bildirim: ${feedback}\n`);
      addMessage('system', `[IDE SWARM] Checker Kontrolü Başarısız: Görev henüz tamamlanmadı.\nNeden: ${feedback}\nLütfen bu geri bildirimi dikkate alarak tekrar dene.`, 'Checker');
      
      if (recentFailures >= 3) {
        broadcastTerminal(`\n*** [IDE SWARM] Checker 3 kez üst üste başarısızlık tespit etti. Kullanıcı müdahalesi bekleniyor. ***\n`);
        addMessage('system', 'System Limit: Görev 3 kez başarısız oldu. İşlem durduruldu ve kullanıcı onayı/yönlendirmesi bekleniyor.');
        agentState.status = 'failed';
        broadcastState();
        break;
      }
    }
  }
}

/**
 * Executes a single direct manual tool call without entering IDE Planner / Task List loops.
 * Specifically for sidebar "Manuel Tools" (CMD/PS, File Reader, File Writer, etc.)
 */
async function runManuelTool(userTask) {
  try {
    agentState.task = userTask;
    agentState.status = 'thinking';
    agentState.messages = [];
    agentState.planSteps = [];
    agentState.executedTools = [];
    agentState.thoughts = [];
    agentState.ideInterrupted = null;
    config.forceTaskPlan = false;
    broadcastState();

    const sub = agentState.activeSubMode || 'none';
    let targetAction = sub;
    if (sub === 'cmd_tool') targetAction = 'execute_command';
    else if (sub === 'app_tool') targetAction = 'open_application';
    else if (sub === 'web_search') targetAction = 'web_search';
    else if (sub === 'file_reader') targetAction = 'read_file';
    else if (sub === 'file_writer') targetAction = 'write_file';
    else if (sub === 'dir_lister') targetAction = 'list_directory';
    else if (sub === 'task_lister') targetAction = 'task_plan';
    else if (sub === 'guide_selector') targetAction = 'select_guide';
    else if (sub === 'url_image') targetAction = 'url_image_reader';
    else if (sub === 'finance_tool') targetAction = 'extract_chart_data';

    broadcastTerminal(`\n*** [MANUEL TOOL] '${sub}' (${targetAction}) doğrudan çalıştırılıyor... ***\n`);
    addMessage('user', userTask);

    let { dynamicSystemPrompt } = await getDynamicSystemPrompt(1);

    if (config.hpmMode) {
      dynamicSystemPrompt += `\n\n[HIGH PARAMETER MODE — SEN YÜKSEK KAPASİTELİ BİR MODELSİN]
Mevcut isteği tek seferde yerine getirecek aracı seç ve doğrudan JSON formatında döndür. Uzun açıklamalar yapma, doğrudan JSON aksiyonunu ver.`;
    }

    dynamicSystemPrompt += `\n\n[MANUEL TOOL - DOĞRUDAN ÇALIŞTIRMA TALİMATI]
Sen şu anda tek bir işlem için doğrudan araç (tool) çağırma modundasın.
ASLA plan yapma, görev listesi oluşturma veya 'task_plan' kullanma.
Kullanıcının isteğini yerine getirmek için doğrudan '${targetAction}' JSON araç çağrısı üret.
Gereksiz konuşma yapma, sadece geçerli bir JSON blok içinde aracı çağır.`;

    if (targetAction === 'execute_command') {
      dynamicSystemPrompt += `\n\n[KOMUT VE ÇALIŞMA ALANI REHBERİ]:
- Bu sistem WINDOWS işletim sistemindedir ve PowerShell kullanır.
- 'scratch' klasöründeki dosyaları listelemek için doğrudan 'Get-ChildItem scratch' komutunu çalıştır.
- KESİNLİKLE '||' veya '&&' zincirleme sembolleri kullanma. Tek bir net komut çalıştır.
- Asla 'C:\\scratch' gibi varsayımsal sabit sürücü harfleri uydurma. Proje kök dizinindeki 'scratch' klasörünü hedefle.`;
    } else if (targetAction === 'read_file' || targetAction === 'write_file' || targetAction === 'list_directory') {
      dynamicSystemPrompt += `\n\n[DOSYA VE DİZİN YOLU REHBERİ]:
- Dosya ve dizin araçlarında her zaman göreceli yol kullan (Örnek: "scratch/test.txt", "By_Agent/rapor.md" veya "scratch").
- Asla 'C:\\scratch' gibi varsayımsal sabit sürücü harfleri kullanma.`;
    }

    const requestMessages = await prepareRequestMessages(dynamicSystemPrompt);
    const { assistantText, action } = await fetchAndParseAction(requestMessages);
    addMessage('assistant', assistantText, 'Manuel Tool');

    if (!action) {
      broadcastTerminal(`> [MANUEL TOOL] Model herhangi bir araç çağırmadı, doğrudan metin yanıtı verdi.\n`);
      agentState.status = 'completed';
      broadcastState();
      return;
    }

    recordActionThoughts(assistantText, action);

    const risk = assessActionRisk(action);
    action.risk = risk;
    action.id = 'act-' + Date.now();

    broadcastTerminal(`\n[MANUEL TOOL] Önerilen Araç: ${action.action}\nAçıklama: ${action.explanation || 'Yok'}\nRisk Seviyesi: ${risk.level}\n`);

    const userDecision = await requestUserApproval(action, 1);

    if (userDecision.approved) {
      agentState.status = 'executing';
      broadcastState();

      if (activeDiscordContext) {
        discordBot.updateDiscordStatus('executing', '1/1', `Executing tool: **${userDecision.action.action}**`, agentState);
      }

      const toolResult = await executeTool(userDecision.action);
      broadcastTerminal(`[RESULT] ${JSON.stringify(toolResult, null, 2)}\n`);

      addMessage('system', `[Araç Çıktısı (${userDecision.action.action})]:\n${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}`);

      // Kısa bir sonuç özeti üret
      broadcastTerminal(`> [MANUEL TOOL] İşlem sonucu kullanıcıya özetleniyor...\n`);
      const reportMessages = [
        { role: 'system', content: 'Sen yardımsever bir yapay zeka asistanısın. Kullanıcı bir araç çalıştırdı ve çıktısı sistem mesajında yer alıyor. Sonucu kullanıcıya kısa, net ve anlaşılır şekilde açıkla. Kesinlikle başka bir araç çağırma.' },
        ...agentState.messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content
        })),
        { role: 'user', content: 'Lütfen yukarıdaki araç çıktısını kullanıcıya açıkla/bildir.' }
      ];

      const summaryText = await llmFetch(reportMessages, 0.3, 'Manuel Tool Report');
      addMessage('assistant', summaryText, 'Manuel Tool');

      agentState.status = 'completed';
      broadcastState();
      broadcastTerminal(`\n*** [MANUEL TOOL] İşlem başarıyla tamamlandı! ***\n`);
    } else {
      broadcastTerminal(`> [MANUEL TOOL] İşlem kullanıcı tarafından reddedildi.\n`);
      addMessage('system', `İşlem kullanıcı tarafından reddedildi: ${userDecision.feedback || 'Kullanıcı onay vermedi.'}`);
      agentState.status = 'completed';
      broadcastState();
    }
  } catch (err) {
    console.error("Manuel tool error:", err);
    broadcastTerminal(`> [ERROR] Manuel tool işlemi başarısız: ${err.message}\n`);
    addMessage('system', `[HATA] ${err.message}`);
    agentState.status = 'idle';
    broadcastState();
  }
}

/**
 * Research modu (Web, Local, Deep Web) için doğrudan araştırma çalıştırıcısı.
 * Kesinlikle IDE Task Plan veya Swarm Planlama yapmaz.
 * Doğrudan ilgili araştırma aracını çağırıp çıktısını kullanıcıya açıklar.
 */
async function runResearchTool(userTask) {
  try {
    agentState.status = 'thinking';
    agentState.messages = [];
    agentState.planSteps = [];
    agentState.executedTools = [];
    agentState.thoughts = [];
    agentState.ideInterrupted = null;
    config.forceTaskPlan = false;
    broadcastState();

    const sub = agentState.activeSubMode || 'web';
    let targetTool = 'web_search';
    if (sub === 'local') targetTool = 'read_file';
    else if (sub === 'web') targetTool = 'web_search';
    else if (sub === 'deep_web') targetTool = 'deep_web_search';

    broadcastTerminal(`\n*** [RESEARCH] '${sub}' araştırması doğrudan başlatılıyor (Planlama devre dışı)... ***\n`);
    addMessage('user', userTask);

    let { dynamicSystemPrompt } = await getDynamicSystemPrompt(1);

    if (config.hpmMode) {
      dynamicSystemPrompt += `\n\n[HIGH PARAMETER MODE — SEN YÜKSEK KAPASİTELİ BİR MODELSİN]
Mevcut araştırma isteğini tek seferde yerine getirecek aracı seç ve doğrudan JSON formatında döndür. Uzun açıklamalar yapma, doğrudan JSON aksiyonunu ver.`;
    }

    dynamicSystemPrompt += `\n\n[RESEARCH MODE - DOĞRUDAN ARAŞTIRMA TALİMATI]
Sen şu anda doğrudan Araştırma (Research) modundasın.
ASLA kod yazma, index.html/style.css gibi yazılım projeleri kurma.
ASLA görev planı (task plan), checklist veya 'task_plan' aracı kullanma.
Kullanıcının araştırma isteğini yerine getirmek için doğrudan '${targetTool}' veya ilgili araştırma araçlarını çağır.
Eğer aradığın bilgi elindeyse doğrudan detaylı ve açıklayıcı Türkçe metin yanıtı ver.`;

    const requestMessages = await prepareRequestMessages(dynamicSystemPrompt);
    const { assistantText, action } = await fetchAndParseAction(requestMessages);
    addMessage('assistant', assistantText, 'Research Agent');

    if (!action) {
      broadcastTerminal(`> [RESEARCH] Model doğrudan metin yanıtı verdi, ek araç çağırmadı.\n`);
      agentState.status = 'completed';
      broadcastState();
      return;
    }

    recordActionThoughts(assistantText, action);

    const risk = assessActionRisk(action);
    action.risk = risk;
    action.id = 'act-' + Date.now();

    broadcastTerminal(`\n[RESEARCH TOOL] Önerilen Araç: ${action.action}\nAçıklama: ${action.explanation || 'Yok'}\nRisk Seviyesi: ${risk.level}\n`);

    const userDecision = await requestUserApproval(action, 1);

    if (userDecision.approved) {
      agentState.status = 'executing';
      broadcastState();

      if (activeDiscordContext) {
        discordBot.updateDiscordStatus('executing', '1/1', `Executing research: **${userDecision.action.action}**`, agentState);
      }

      const toolResult = await executeTool(userDecision.action);
      broadcastTerminal(`[RESULT] ${JSON.stringify(toolResult, null, 2)}\n`);

      addMessage('system', `[Araştırma Çıktısı (${userDecision.action.action})]:\n${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}`);

      broadcastTerminal(`> [RESEARCH] Araştırma sonucu kullanıcıya raporlanıyor...\n`);
      const reportMessages = [
        { role: 'system', content: 'Sen araştırmacı bir yapay zekasın. Yukarıda çalıştırılan araştırma aracının çıktısını inceleyerek kullanıcının sorusuna kapsamlı, net ve açıklayıcı bir Türkçe cevap hazırla. Kesinlikle başka bir araç çağırma.' },
        ...agentState.messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content
        })),
        { role: 'user', content: 'Lütfen yukarıdaki araştırma çıktısına dayanarak kapsamlı bir yanıt sun.' }
      ];

      const summaryText = await llmFetch(reportMessages, 0.3, 'Research Report');
      addMessage('assistant', summaryText, 'Research Agent');

      agentState.status = 'completed';
      broadcastState();
      broadcastTerminal(`\n*** [RESEARCH] Araştırma başarıyla tamamlandı! ***\n`);
    } else {
      broadcastTerminal(`> [RESEARCH] Araştırma kullanıcı tarafından reddedildi.\n`);
      addMessage('system', `İşlem kullanıcı tarafından reddedildi: ${userDecision.feedback || 'Kullanıcı onay vermedi.'}`);
      agentState.status = 'completed';
      broadcastState();
    }
  } catch (err) {
    console.error("Research tool error:", err);
    broadcastTerminal(`> [ERROR] Araştırma işlemi başarısız: ${err.message}\n`);
    addMessage('system', `[HATA] ${err.message}`);
    agentState.status = 'idle';
    broadcastState();
  }
}

module.exports = {
  runAgentLoop,
  initializeTaskContextAndSelectMode,
  startDiscordAgentTask,
  handleDiscordAgentAction,
  getPendingAction,
  resolvePendingAction,
  initializeIdeTaskContext,
  runIdeSwarmLoop,
  runManuelTool,
  runResearchTool
};


