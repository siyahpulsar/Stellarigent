const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { log } = require('../logger');

const { agentState, broadcastTerminal } = require('../state');

// Screenshot Capture Helper (Native PowerShell using System.Drawing)
function captureScreenshot() {
  return new Promise((resolve) => {
    const filename = `screenshot_${Date.now()}.png`;
    const publicScreenshotsDir = path.join(__dirname, '..', '..', 'public', 'screenshots');
    const savePath = path.join(publicScreenshotsDir, filename);

    if (!fs.existsSync(publicScreenshotsDir)) {
      fs.mkdirSync(publicScreenshotsDir, { recursive: true });
    }

    const psCommand = `[Reflection.Assembly]::LoadWithPartialName('System.Drawing'); [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; $graphics = [System.Drawing.Graphics]::FromImage($bmp); $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $bmp.Save('${savePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bmp.Dispose();`;

    broadcastTerminal(`\n> [SCREENSHOT] Capturing screen and saving to ${filename}...\n`);

    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand]);

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        broadcastTerminal(`> Screenshot captured successfully: /screenshots/${filename}\n`);
        resolve({ success: true, filename: `/screenshots/${filename}`, message: `Screenshot captured successfully. Saved as ${filename}` });
      } else {
        broadcastTerminal(`> Screenshot capture failed: ${stderr}\n`);
        resolve({ success: false, message: `Powershell exited with code ${code}. Error: ${stderr}` });
      }
    });

    child.on('error', (err) => {
      broadcastTerminal(`> Screenshot capture failed: ${err.message}\n`);
      resolve({ success: false, message: err.message });
    });
  });
}

// Safe shell command runner with real-time log streaming
// Timeout: 10 minutes (600,000ms) — prevents infinite hangs on long-running commands
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const { isProtectedProjectFile } = require('../security');

// Build a sanitized environment object stripping all API keys, bot tokens, and user secrets
function getSanitizedEnv() {
  const safeEnv = { ...process.env };
  const SENSITIVE_VARS = [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
    'DISCORD_BOT_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID',
    'GITHUB_TOKEN', 'GH_TOKEN', 'NODE_AUTH_TOKEN'
  ];
  for (const key of SENSITIVE_VARS) {
    delete safeEnv[key];
  }
  for (const envKey of Object.keys(safeEnv)) {
    const upper = envKey.toUpperCase();
    if (upper.includes('API_KEY') || upper.includes('SECRET') || upper.includes('AUTH_TOKEN') || upper.includes('PASSWORD')) {
      delete safeEnv[envKey];
    }
  }
  // Confine temp directory to project scratch
  const scratchPath = path.join(agentState.cwd, 'scratch');
  safeEnv.TEMP = scratchPath;
  safeEnv.TMP = scratchPath;
  return safeEnv;
}

const EGRESS_COMMAND_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\binvoke-webrequest\b/i,
  /\biwr\b/i,
  /\binvoke-restmethod\b/i,
  /\birm\b/i,
  /\bstart-bitstransfer\b/i,
  /\bbitsadmin\b/i,
  /\bcertutil(\.exe)?\s+.*-(split|urlcache)\b/i,
  /\b(nc|ncat|netcat)\b/i,
  /\btelnet\b/i
];

function runShellCommand(commandString) {
  return new Promise((resolve) => {
    broadcastTerminal(`\n> [EXECUTE] ${commandString}\n`);
    log('TERMINAL', `Execute: ${commandString}`);

    // Pre-flight check: ensure command does not target protected project files
    const lowerCmd = (commandString || '').toLowerCase();
    const PROTECTED_TOKENS = [
      'server.js', 'src/', 'src\\', 'src ', '.env', 'package.json', 'package-lock.json',
      'public/', 'public\\', 'electron/', 'electron\\', 'config/setup.json',
      'config/security_rules.json', 'config/config.json', 'config/kurucu.json',
      'node_modules', '.git', 'wikilike', 'dockerfile'
    ];
    for (const token of PROTECTED_TOKENS) {
      if (lowerCmd.includes(token)) {
        broadcastTerminal(`\n[SECURITY REJECTED] Komut korumalı proje varlığı içeriyor: "${token}". Yürütme durduruldu.\n`);
        return resolve({
          success: false,
          exitCode: 403,
          stdout: '',
          stderr: `Güvenlik İhlali: "${token}" gibi proje çekirdek dosyalarını veya kaynak dizinlerini hedefleyen komutlar çalıştırılamaz.`,
          message: `Erişim engellendi: Proje çekirdek dosyası (${token}) hedef alındı.`
        });
      }
    }

    // Pre-flight check: block network egress and data exfiltration tools
    for (const pattern of EGRESS_COMMAND_PATTERNS) {
      if (pattern.test(lowerCmd)) {
        broadcastTerminal(`\n[SECURITY REJECTED] Komut yetkisiz dış ağ çıkışı / veri aktarımı aracı içeriyor (${pattern}). Yürütme durduruldu.\n`);
        return resolve({
          success: false,
          exitCode: 403,
          stdout: '',
          stderr: 'Güvenlik İhlali: curl, wget, Invoke-WebRequest gibi dış ağa veri sızdırma araçları engellenmiştir.',
          message: 'Erişim engellendi: Dış ağ erişimi / exfiltration girişimi engellendi.'
        });
      }
    }

    // Normalize common model hallucinations (e.g. C:\scratch when project is on D:)
    let cleanCommand = commandString.replace(/\b[a-zA-Z]:[\\\/]scratch\b/gi, 'scratch');
    
    // Fix PowerShell 5.1 statement separator incompatibility:
    // If model chained commands with '||' (e.g. 'dir scratch || Get-ChildItem scratch'), take the first command
    if (cleanCommand.includes('||')) {
      cleanCommand = cleanCommand.split('||')[0].trim();
    }
    // If model chained commands with '&&', convert to ';' (valid statement separator in PowerShell)
    cleanCommand = cleanCommand.replace(/\s*&&\s*/g, '; ');

    const lowerClean = cleanCommand.toLowerCase();

    // Determine safe working directory:
    // If the command explicitly targets scratch/ or By_Agent/ as a path argument (e.g. 'dir scratch' or 'ls scratch'),
    // run from project root so the relative path resolves correctly.
    // Otherwise, isolate execution inside scratch/ (or By_Agent/) so newly created files land in sandbox.
    let safeCwd = path.join(agentState.cwd, 'scratch');
    if (lowerClean.includes('by_agent')) {
      safeCwd = (lowerClean.includes('by_agent\\') || lowerClean.includes('by_agent/') || lowerClean.includes('by_agent ') || lowerClean.endsWith('by_agent'))
        ? agentState.cwd
        : path.join(agentState.cwd, 'By_Agent');
    } else if (lowerClean.includes('scratch\\') || lowerClean.includes('scratch/') || lowerClean.includes('scratch ') || lowerClean.endsWith('scratch')) {
      safeCwd = agentState.cwd;
    }

    if (!fs.existsSync(safeCwd)) {
      try { fs.mkdirSync(safeCwd, { recursive: true }); } catch (e) {}
    }

    const isWin = process.platform === 'win32';
    const isExplicitCmd = cleanCommand.trim().toLowerCase().startsWith('cmd');
    const shell = isWin ? (isExplicitCmd ? 'cmd.exe' : 'powershell.exe') : '/bin/sh';
    const args = isWin
      ? (isExplicitCmd ? ['/c', cleanCommand] : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cleanCommand])
      : ['-c', cleanCommand];

    const child = spawn(shell, args, {
      cwd: safeCwd,
      env: getSanitizedEnv()
    });

    agentState.activeCommandProcess = child;

    // Auto-kill after COMMAND_TIMEOUT_MS to prevent infinite hangs
    const timeoutHandle = setTimeout(() => {
      broadcastTerminal(`\n> [TIMEOUT] Command exceeded ${COMMAND_TIMEOUT_MS / 60000} minute limit. Force killing...\n`);
      child.kill('SIGKILL');
      agentState.activeCommandProcess = null;
      resolve({
        success: false,
        exitCode: -1,
        message: `Command timed out after ${COMMAND_TIMEOUT_MS / 60000} minutes and was force-killed.`
      });
    }, COMMAND_TIMEOUT_MS);

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutData += text;
      broadcastTerminal(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderrData += text;
      broadcastTerminal(`[ERROR] ${text}`);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      agentState.activeCommandProcess = null;
      broadcastTerminal(`\n> [FINISHED] Command exited with code ${code}\n`);
      
      // Limit output length to prevent LLM context flooding
      let outStr = stdoutData.trim();
      let errStr = stderrData.trim();
      if (outStr.length > 3000) outStr = "...(truncated)...\n" + outStr.substring(outStr.length - 3000);
      if (errStr.length > 3000) errStr = "...(truncated)...\n" + errStr.substring(errStr.length - 3000);

      resolve({
        success: code === 0,
        exitCode: code,
        stdout: outStr,
        output: outStr,
        stderr: errStr,
        message: `Command completed with exit code ${code}`
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      agentState.activeCommandProcess = null;
      broadcastTerminal(`\n> [FAILED] Start failed: ${err.message}\n`);
      resolve({
        success: false,
        exitCode: -1,
        message: `Failed to start process: ${err.message}`
      });
    });
  });
}

// Open application helper
function openApplication(target) {
  return new Promise((resolve) => {
    if (!target || isProtectedProjectFile(target)) {
      broadcastTerminal(`\n[SECURITY REJECTED] Korumalı dosya veya uygulama açılamaz: ${target}\n`);
      return resolve({ success: false, message: `GÜVENLİK İHLALİ: Korumalı proje dosyaları açılamaz veya çalıştırılamaz: ${target}` });
    }

    broadcastTerminal(`\n> [OPEN] Opening target: ${target}\n`);
    try {
      const safeCwd = path.join(agentState.cwd, 'scratch');
      if (!fs.existsSync(safeCwd)) {
        try { fs.mkdirSync(safeCwd, { recursive: true }); } catch (e) {}
      }

      const child = spawn('cmd.exe', ['/c', 'start', '', target], {
        cwd: safeCwd,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      broadcastTerminal(`> Opened successfully in detached mode.\n`);
      resolve({ success: true, message: `Successfully opened ${target} in detached mode` });
    } catch (err) {
      broadcastTerminal(`[ERROR] ${err.message}\n`);
      resolve({ success: false, message: err.message });
    }
  });
}

module.exports = {
  captureScreenshot,
  runShellCommand,
  openApplication
};
