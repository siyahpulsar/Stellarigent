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

function runShellCommand(commandString) {
  return new Promise((resolve) => {
    broadcastTerminal(`\n> [EXECUTE] ${commandString}\n`);
    log('TERMINAL', `Execute: ${commandString}`);

    const isPowershell = commandString.toLowerCase().startsWith('powershell') || commandString.includes('$');
    const shell = isPowershell ? 'powershell.exe' : 'cmd.exe';
    const args = isPowershell ? ['-NoProfile', '-Command', commandString] : ['/c', commandString];

    const child = spawn(shell, args, {
      cwd: agentState.cwd,
      env: process.env,
      shell: true
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
    broadcastTerminal(`\n> [OPEN] Opening target: ${target}\n`);
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', target], {
        cwd: agentState.cwd,
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
