const fs = require('fs');
const path = require('path');

function readEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env'); // Correct path relative to src/utils
  const result = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          let val = parts.slice(1).join('=').trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          result[key] = val;
        }
      }
    });
  }
  return result;
}

function writeEnv(envObj) {
  const envPath = path.join(__dirname, '..', '..', '.env');
  let content = '';
  content += `# Discord Bot Token\nDISCORD_TOKEN=${envObj.DISCORD_TOKEN || ''}\n\n`;
  content += `# Local Web Dashboard Port\nPORT=${envObj.PORT || '3000'}\n\n`;
  content += `# Discord Founder ID\nFOUNDER_DISCORD_ID=${envObj.FOUNDER_DISCORD_ID || ''}\n\n`;
  content += `# Web Dashboard Founder key\nFOUNDER_KEY=${envObj.FOUNDER_KEY || ''}\n`;
  fs.writeFileSync(envPath, content, 'utf-8');
}

module.exports = {
  readEnv,
  writeEnv
};
