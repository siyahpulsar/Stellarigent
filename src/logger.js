const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Generate a session timestamp: YYYYMMDD-HHMMSS
const now = new Date();
const timestamp = now.toISOString().replace(/T/, '-').replace(/:/g, '').split('.')[0];
const logFilePath = path.join(logsDir, `session-${timestamp}.log`);

function log(tag, message) {
  const time = new Date().toISOString();
  let text = '';
  if (typeof message === 'object') {
    try {
      text = JSON.stringify(message);
    } catch(e) {
      text = String(message);
    }
  } else {
    text = String(message);
  }
  const logLine = `[${time}] [${tag}] ${text}\n`;
  try {
    fs.appendFileSync(logFilePath, logLine, 'utf8');
  } catch (err) {
    console.error("Logger error:", err);
  }
}

module.exports = {
  log
};
