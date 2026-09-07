/**
 * Extracts and resolves valid HTTP/HTTPS URLs from raw text lines,
 * handling Src, Href tags, absolute URLs, and relative URLs with baseUrl.
 *
 * @param {string} text - Raw input text containing potential URLs
 * @param {string} [baseUrl] - Base URL used to resolve relative paths
 * @returns {string[]} Array of unique, valid URLs
 */
function extractUrlsFromText(text, baseUrl) {
  if (!text || typeof text !== 'string') return [];

  const urls = [];
  const lines = text.split('\n');

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    let match = line.match(/Src:\s*"([^"]+)"/i) || line.match(/Href:\s*"([^"]+)"/i);
    let rawUrl = '';
    if (match) {
      rawUrl = match[1];
    } else {
      const urlMatch = line.match(/https?:\/\/[^\s"']+/i);
      if (urlMatch) {
        rawUrl = urlMatch[0];
      } else {
        rawUrl = line;
      }
    }

    if (rawUrl) {
      if (baseUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        try {
          const resolved = new URL(rawUrl, baseUrl).href;
          urls.push(resolved);
        } catch (e) {
          urls.push(rawUrl);
        }
      } else {
        urls.push(rawUrl);
      }
    }
  }

  return [...new Set(urls)].filter(u => u.startsWith('http://') || u.startsWith('https://'));
}

module.exports = {
  extractUrlsFromText
};
