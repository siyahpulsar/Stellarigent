const fs = require('fs');
const path = require('path');


function getIndexPath(cwd) {
  return path.join(cwd, 'Libraries', 'MemoryLibrary', 'keywords_index.json');
}

function readIndex(cwd) {
  const indexPath = getIndexPath(cwd);
  if (!fs.existsSync(indexPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function writeIndex(cwd, indexData) {
  const indexPath = getIndexPath(cwd);
  const dir = path.dirname(indexPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
}

async function generateKeywords(jsonContent) {
  try {
    const data = JSON.parse(jsonContent);
    const keywords = [];

    const traverse = (obj, prefix = '') => {
      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined || value === '') continue;

        if (Array.isArray(value)) {
          if (value.length > 0) {
            value.forEach(item => {
              if (item && typeof item === 'string') {
                keywords.push(`${key}: ${item.trim().toLowerCase()}`);
              }
            });
          }
        } else if (typeof value === 'object') {
          traverse(value, key + '.');
        } else if (typeof value === 'string' || typeof value === 'number') {
          keywords.push(`${key}: ${value.toString().trim().toLowerCase()}`);
        }
      }
    };

    traverse(data);

    // Filter duplicates and return up to 100 keywords max just in case
    return [...new Set(keywords)].slice(0, 100);
  } catch (e) {
    console.error('Programmatic keyword generation failed:', e.message);
    return [];
  }
}

async function updateFileKeywords(cwd, relPath, jsonContent) {
  // Use forward slashes for cross-platform consistency in index keys
  const normalizedRelPath = relPath.replace(/\\/g, '/');
  
  const keywords = await generateKeywords(jsonContent);
  if (keywords.length > 0) {
    const index = readIndex(cwd);
    index[normalizedRelPath] = keywords;
    writeIndex(cwd, index);
  }
}

// Common Turkish and English stop words to eliminate context noise
const STOP_WORDS = new Set([
  'bir', 'ile', 'için', 'olan', 'veya', 'gibi', 'kadar', 'sonra', 'önce', 'daha', 'çok', 'ama', 'fakat',
  'ancak', 'bunu', 'buna', 'şunu', 'bana', 'sana', 'bize', 'size', 'onlar', 'böyle', 'şöyle', 'nasıl',
  'neden', 'niçin', 'evet', 'hayır', 'diye', 'olarak', 'tüm', 'her', 'şey', 'ise', 'da', 'de', 'ki',
  'mi', 'mu', 'mü', 'mı', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was',
  'were', 'will', 'what', 'when', 'where', 'which', 'who', 'how', 'about', 'some', 'any', 'all'
]);

function searchIndex(cwd, promptText) {
  const index = readIndex(cwd);
  if (!index || Object.keys(index).length === 0) return [];

  // Normalize, tokenize and remove stop-words
  const queryTokens = promptText
    .toLowerCase()
    .split(/[^a-zA-Z0-9çığöşüöäüæßàáâäæãåā]+/g)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  
  if (queryTokens.length === 0) return [];

  const scoredFiles = [];

  for (const [relPath, keywords] of Object.entries(index)) {
    let score = 0;
    const lowerKeywords = keywords.map(k => k.toLowerCase());

    for (const token of queryTokens) {
      for (const kw of lowerKeywords) {
        // Exact keyword value match or direct inclusion with high precision
        if (kw === token) {
          score += 3;
        } else if (kw.startsWith(`${token}:`) || kw.endsWith(`: ${token}`)) {
          score += 2;
        } else if (kw.includes(token)) {
          score += 1;
        }
      }
    }

    if (score >= 1) {
      scoredFiles.push({ relPath, score });
    }
  }

  // Sort by highest score first (relevance ranking)
  scoredFiles.sort((a, b) => b.score - a.score);

  return scoredFiles.map(f => f.relPath);
}

module.exports = {
  getIndexPath,
  readIndex,
  writeIndex,
  generateKeywords,
  updateFileKeywords,
  searchIndex
};
