const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const SANITIZATION_LOG_FILE = path.join(LOGS_DIR, 'sanitization.log');

// Known prompt injection patterns (Regex - First line of defense)
const INJECTION_PATTERNS = [
  { name: 'IGNORE_PREVIOUS_INSTRUCTIONS', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi },
  { name: 'DISREGARD_PREVIOUS_INSTRUCTIONS', regex: /disregard\s+(all\s+)?(previous|prior|above)\s+instructions/gi },
  { name: 'DEVELOPER_MODE', regex: /you\s+are\s+now\s+in\s+developer\s+mode/gi },
  { name: 'UNRESTRICTED_MODE', regex: /you\s+are\s+now\s+(an\s+)?unrestricted/gi },
  { name: 'DAN_JAILBREAK', regex: /do\s+anything\s+now/gi },
  { name: 'SYSTEM_PROMPT_OVERRIDE', regex: /(?:system\s*prompt|system\s*directive|system\s*override|system:)/gi },
  { name: 'SPECIAL_TOKENS', regex: /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/gi },
  { name: 'TOOL_CALL_HIJACK', regex: /\[TOOL_CALLS\]|\[AVAILABLE_TOOLS\]/gi },
  { name: 'ROLE_TAG_HIJACK', regex: /\[SYSTEM\]|\[DEVELOPER\]|\[QA_TESTER\]/gi },
  { name: 'TR_TALIMAT_YOKSAY', regex: /önceki\s+(tüm\s+)?talimatları\s+(unut|yoksay|iptal\s+et|sil)/gi },
  { name: 'TR_GELISTIRICI_MOD', regex: /artık\s+geliştirici\s+modundasın/gi }
];

// Zero-width and hidden Unicode characters
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u00A0\u202A-\u202E]/g;

// Hidden HTML inline styles and attributes
const HIDDEN_DOM_REGEX = /<[^>]+(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size\s*:\s*0px?|aria-hidden\s*=\s*["']?true["']?)[^>]*>[\s\S]*?<\/[^>]+>/gi;

/**
 * Appends an audit event to logs/sanitization.log safely
 */
function logSanitizationAudit(url, reason, matchedSnippet) {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const cleanSnippet = (matchedSnippet || '').replace(/\r?\n/g, ' ').slice(0, 150);
    const logLine = `[${timestamp}] [SUSPICIOUS_PATTERN] URL: ${url || 'unknown'} | Reason: ${reason} | Match: "${cleanSnippet}"\n`;
    fs.appendFileSync(SANITIZATION_LOG_FILE, logLine, 'utf-8');
  } catch (err) {
    console.error('[SANITIZATION AUDIT LOG ERROR]', err.message);
  }
}

/**
 * Strips zero-width characters and hidden DOM elements
 */
function cleanHiddenArtifacts(rawText, url) {
  if (!rawText || typeof rawText !== 'string') return '';

  let cleaned = rawText;

  // Check and strip zero-width characters
  if (ZERO_WIDTH_REGEX.test(cleaned)) {
    logSanitizationAudit(url, 'ZERO_WIDTH_CHARACTERS', 'Zero-width Unicode characters stripped');
    cleaned = cleaned.replace(ZERO_WIDTH_REGEX, '');
  }

  // Check and strip hidden DOM structures if HTML is present
  if (cleaned.includes('<') && cleaned.includes('>')) {
    cleaned = cleaned.replace(HIDDEN_DOM_REGEX, (match) => {
      logSanitizationAudit(url, 'HIDDEN_DOM_ELEMENT', match);
      return ' [STRIPPED_HIDDEN_ELEMENT] ';
    });
  }

  return cleaned;
}

/**
 * Scans content against prompt injection patterns and strips them (first line of defense)
 */
function stripInjectionPatterns(text, url) {
  if (!text || typeof text !== 'string') return '';

  let sanitized = text;

  for (const { name, regex } of INJECTION_PATTERNS) {
    // Reset regex index for global matches
    regex.lastIndex = 0;
    if (regex.test(sanitized)) {
      regex.lastIndex = 0;
      sanitized = sanitized.replace(regex, (match) => {
        logSanitizationAudit(url, name, match);
        return ' [STRIPPED_UNTRUSTED_CONTENT] ';
      });
    }
  }

  return sanitized;
}

/**
 * Wraps external content with strict sandbox delimiters
 */
function wrapUntrustedWebData(content, url) {
  const safeUrl = url || 'external_web_source';
  return `<<<UNTRUSTED_EXTERNAL_WEB_DATA: ${safeUrl}>>>\n${content}\n<<<END_UNTRUSTED_EXTERNAL_WEB_DATA>>>`;
}

/**
 * Main sanitization pipeline for web content
 */
function sanitizeWebContent(rawContent, url = 'unknown') {
  if (!rawContent || typeof rawContent !== 'string') {
    return wrapUntrustedWebData('No readable content found.', url);
  }

  // 1. Clean hidden DOM and zero-width chars
  let processed = cleanHiddenArtifacts(rawContent, url);

  // 2. Strip known prompt injection patterns
  processed = stripInjectionPatterns(processed, url);

  // 3. Normalize multiple whitespaces
  processed = processed.replace(/[ \t]{3,}/g, '  ').trim();

  // 4. Wrap with untrusted delimiters
  return wrapUntrustedWebData(processed, url);
}

module.exports = {
  sanitizeWebContent,
  wrapUntrustedWebData,
  cleanHiddenArtifacts,
  stripInjectionPatterns,
  logSanitizationAudit,
  SANITIZATION_LOG_FILE
};
