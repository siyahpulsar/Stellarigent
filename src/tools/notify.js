/**
 * notify.js — Windows Toast Notification Tool
 *
 * Ajana görev bitti, hata, veya önemli bildirim durumlarında
 * Windows sistem bildirimi (Toast Notification) gönderme yeteneği kazandırır.
 *
 * Desteklenen platformlar: Windows (PowerShell), macOS (osascript), Linux (notify-send)
 */

const { spawn } = require('child_process');
const { broadcastTerminal } = require('../state');

/**
 * Sistemin toast notification gönderebilip göndermediğini kontrol eder
 * @returns {boolean}
 */
function isNotifySupported() {
  return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux';
}

/**
 * Windows üzerinde BurntToast veya fallback PowerShell Balloon ile bildirim gönderir.
 * @param {string} title
 * @param {string} message
 * @param {string} [level] — 'info' | 'warning' | 'error'
 * @returns {Promise<{success: boolean, message: string}>}
 */
function sendWindowsNotification(title, message, level = 'info') {
  return new Promise((resolve) => {
    // Emoji prefix'i seviyeye göre belirle
    const levelEmoji = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : '✅';
    const safeTitle = String(title).replace(/'/g, '`').substring(0, 80);
    const safeMsg = String(message).replace(/'/g, '`').substring(0, 200);

    // PowerShell 5+ Windows toast (BurntToast yoksa Windows.UI.Notifications fallback)
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::${level === 'error' ? 'Error' : level === 'warning' ? 'Warning' : 'Info'}
$notify.BalloonTipTitle = '${levelEmoji} ${safeTitle}'
$notify.BalloonTipText = '${safeMsg}'
$notify.Visible = $true
$notify.ShowBalloonTip(6000)
Start-Sleep -Milliseconds 7000
$notify.Dispose()
`;

    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Fire-and-forget: bildirim spawn edildi, cevabı beklemiyoruz
    setTimeout(() => {
      resolve({ success: true, message: `Windows notification sent: "${title}"` });
    }, 200);
  });
}

/**
 * macOS üzerinde osascript ile bildirim gönderir.
 */
function sendMacNotification(title, message) {
  return new Promise((resolve) => {
    const safeTitle = String(title).replace(/"/g, '\\"').substring(0, 80);
    const safeMsg = String(message).replace(/"/g, '\\"').substring(0, 200);
    const child = spawn('osascript', ['-e', `display notification "${safeMsg}" with title "Stellarigent" subtitle "${safeTitle}"`], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    setTimeout(() => resolve({ success: true, message: `macOS notification sent: "${title}"` }), 200);
  });
}

/**
 * Linux üzerinde notify-send ile bildirim gönderir (libnotify gerektirir).
 */
function sendLinuxNotification(title, message) {
  return new Promise((resolve) => {
    const safeTitle = String(title).replace(/"/g, '\\"').substring(0, 80);
    const safeMsg = String(message).replace(/"/g, '\\"').substring(0, 200);
    const child = spawn('notify-send', ['-a', 'Stellarigent', `"${safeTitle}"`, safeMsg], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    setTimeout(() => resolve({ success: true, message: `Linux notification sent: "${title}"` }), 200);
  });
}

/**
 * Platform-agnostic ana fonksiyon.
 * @param {string} title — Bildirim başlığı
 * @param {string} message — Bildirim metni
 * @param {string} [level] — 'info' | 'warning' | 'error'
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendSystemNotification(title, message, level = 'info') {
  broadcastTerminal(`\n> [NOTIFY] Sending system notification: "${title}"\n`);

  if (!isNotifySupported()) {
    return { success: false, message: 'System notifications not supported on this platform.' };
  }

  try {
    if (process.platform === 'win32') {
      return await sendWindowsNotification(title, message, level);
    } else if (process.platform === 'darwin') {
      return await sendMacNotification(title, message);
    } else {
      return await sendLinuxNotification(title, message);
    }
  } catch (err) {
    broadcastTerminal(`> [NOTIFY ERROR] Failed to send notification: ${err.message}\n`);
    return { success: false, message: `Notification failed: ${err.message}` };
  }
}

module.exports = {
  sendSystemNotification,
  isNotifySupported
};
