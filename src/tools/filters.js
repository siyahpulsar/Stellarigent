const fs = require('fs');
const path = require('path');
const { agentState, broadcastTerminal } = require('../state');
const { getSandboxPath } = require('./filesystem');
const { checkAndRegisterPath, isProtectedProjectFile, checkTripwire } = require('../security');

function filterOutput(query, filterType) {
  const content = agentState.lastToolOutput || '';
  broadcastTerminal(`\n> [FILTER OUTPUT] Type: ${filterType || 'None'} | Query: ${query || 'None'}\n`);

  if (!content) {
    return { success: false, message: "Arama yapılabilecek bir önceki araç çıktısı bulunamadı." };
  }

  let results = [];
  if (filterType === 'line_match') {
    const lines = content.split('\n');
    const lowerQuery = (query || '').toLowerCase();
    results = lines.filter(line => line.toLowerCase().includes(lowerQuery));
  } else if (filterType === 'url_extract') {
    const urlRegex = /https?:\/\/[^\s"']+/g;
    const matches = content.match(urlRegex) || [];
    results = [...new Set(matches.map(url => url.replace(/[\\"]+$/, '')))];
  } else if (filterType === 'quote_extract') {
    const quoteRegex = /"([^"]+)"/g;
    let match;
    const matches = [];
    while ((match = quoteRegex.exec(content)) !== null) {
      matches.push(match[1]);
    }
    results = [...new Set(matches)];
  } else {
    return { success: false, message: `Geçersiz filtre tipi: ${filterType}. Sadece 'line_match', 'url_extract' veya 'quote_extract' kullanabilirsiniz.` };
  }

  return {
    success: true,
    filter_type: filterType,
    count: results.length,
    results: results.join('\n')
  };
}

async function lineChecker(filePath, query) {
  const tripwireStatus = checkTripwire(filePath);
  if (tripwireStatus.tripwireTriggered) {
    return { success: false, tripwireTriggered: true, message: tripwireStatus.message };
  }

  if (!filePath || isProtectedProjectFile(filePath) || !checkAndRegisterPath(filePath, false)) {
    broadcastTerminal(`> [BLOCKED] Access to path is restricted: ${filePath}\n`);
    return { success: false, message: "Dosya erişimi güvenlik politikası nedeniyle engellendi." };
  }

  const targetPath = path.resolve(agentState.cwd, filePath);
  const sandboxPath = getSandboxPath(targetPath);
  broadcastTerminal(`> [LINE CHECKER] Sandbox: ${sandboxPath} (Real: ${targetPath}) | Query: "${query}"\n`);
  
  try {
    let finalPathToRead = targetPath;
    if (fs.existsSync(sandboxPath)) {
      finalPathToRead = sandboxPath;
    } else if (!fs.existsSync(targetPath)) {
      return { success: false, message: `File does not exist: ${filePath}` };
    }
    
    // Changed to async fs
    const content = await fs.promises.readFile(finalPathToRead, 'utf-8');
    const lines = content.split(/\r?\n/);
    const lowerQuery = query.toLowerCase();
    
    const filteredLines = lines.filter(line => line.toLowerCase().includes(lowerQuery));
    
    const dir = path.dirname(sandboxPath);
    if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(sandboxPath, filteredLines.join('\n'), 'utf-8');
    
    broadcastTerminal(`> [LINE CHECKER] Filtered ${lines.length} lines down to ${filteredLines.length} lines in sandbox.\n`);
    return {
      success: true,
      message: `Dosya başarıyla filtrelendi. ${lines.length} satırdan ${filteredLines.length} satır eşleşti ve konteynıra kaydedildi.`,
      original_count: lines.length,
      filtered_count: filteredLines.length
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

const { extractUrlsFromText } = require('./urlParser');

module.exports = {
  filterOutput,
  lineChecker,
  extractUrlsFromText
};
