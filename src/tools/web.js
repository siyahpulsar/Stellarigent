const axios = require('axios');
const cheerio = require('cheerio');
const { agentState, broadcastTerminal } = require('../state');
const { checkBannedWebsites } = require('../security');
const { sanitizeWebContent, cleanHiddenArtifacts, stripInjectionPatterns } = require('../security/webSanitizer');

let sharedBrowser = null;
let puppeteerUseCount = 0;
const PUPPETEER_RECYCLE_LIMIT = 20;

async function getSharedBrowser() {
  const puppeteer = require('puppeteer');
  // Recycle browser every N uses to prevent RAM leaks
  if (puppeteerUseCount >= PUPPETEER_RECYCLE_LIMIT && sharedBrowser) {
    broadcastTerminal(`\n> [PUPPETEER] Recycling browser after ${puppeteerUseCount} uses to free memory...\n`);
    try { await sharedBrowser.close(); } catch (e) {}
    sharedBrowser = null;
    puppeteerUseCount = 0;
  }
  if (sharedBrowser && sharedBrowser.connected) {
    puppeteerUseCount++;
    return sharedBrowser;
  }
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch (e) {}
  }
  broadcastTerminal(`\n> [PUPPETEER] Launching new shared Puppeteer browser instance...\n`);
  sharedBrowser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  puppeteerUseCount = 1;
  return sharedBrowser;
}

process.on('exit', () => {
  if (sharedBrowser) {
    try {
      sharedBrowser.close();
    } catch (e) {}
  }
});

// Scrape DuckDuckGo Lite search results dynamically
async function searchDDGLite(query, usePuppeteer = false) {
  if (usePuppeteer) {
    let page = null;
    try {
      const browser = await getSharedBrowser();
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: 20000 });
      
      const results = await page.evaluate(() => {
        const links = [];
        const resultNodes = document.querySelectorAll('.result');
        for (let i = 0; i < Math.min(resultNodes.length, 5); i++) {
           const node = resultNodes[i];
           const titleNode = node.querySelector('.result__title a');
           const snippetNode = node.querySelector('.result__snippet');
           if (titleNode && snippetNode) {
             let url = titleNode.getAttribute('href');
             if (url && url.startsWith('//duckduckgo.com/l/?uddg=')) {
                url = decodeURIComponent(url.replace('//duckduckgo.com/l/?uddg=', '').split('&')[0]);
             }
             links.push({
                title: stripInjectionPatterns(cleanHiddenArtifacts(titleNode.innerText.trim(), url), url),
                url: url,
                snippet: stripInjectionPatterns(cleanHiddenArtifacts(snippetNode.innerText.trim(), url), url)
              });
           }
        }
        return links;
      });
      return results;
    } catch (err) {
      console.error("DDG Lite (Puppeteer) search failed:", err.message);
      return null;
    } finally {
      if (page) await page.close();
    }
  }

  try {
    const response = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    const html = response.data;
    const links = [];
    const linkRegex = /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
    const hrefRegex = /href=['"]([^'"]+)['"]/i;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const fullTag = linkMatch[0];
      const title = linkMatch[1].replace(/<[^>]*>/g, '').trim();
      const hrefMatch = hrefRegex.exec(fullTag);
      if (hrefMatch) {
        links.push({ url: hrefMatch[1], title });
      }
    }

    const snippets = [];
    const snippetRegex = /<td\s+[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
    let snippetMatch;
    while ((snippetMatch = snippetRegex.exec(html)) !== null) {
      snippets.push(snippetMatch[1].replace(/<[^>]*>/g, '').trim());
    }

    const results = [];
    for (let i = 0; i < Math.min(links.length, 5); i++) {
      const safeUrl = links[i].url;
      results.push({
        title: stripInjectionPatterns(cleanHiddenArtifacts(links[i].title, safeUrl), safeUrl),
        url: safeUrl,
        snippet: stripInjectionPatterns(cleanHiddenArtifacts(snippets[i] || 'No snippet available.', safeUrl), safeUrl)
      });
    }
    return results;
  } catch (err) {
    console.error("DDG Lite search failed:", err.message);
    broadcastTerminal(`> DDG Lite Axios request failed. Falling back to Puppeteer DDG search...\n`);
    return await searchDDGLite(query, true);
  }
}

// Scrape Yahoo / DuckDuckGo Lite search results dynamically
async function searchWeb(query) {
  broadcastTerminal(`\n> [WEB SEARCH] Query: "${query}"\n`);
  if (checkBannedWebsites(query)) {
    broadcastTerminal(`> [BLOCKED] Search query contains blacklisted website term.\n`);
    return { success: false, message: "Arama veya web sitesi erişimi güvenlik politikası nedeniyle engellendi." };
  }

  let yahooResults = [];
  let yahooFailed = false;
  try {
    const response = await axios.get(`https://search.yahoo.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 10000
    });

    const html = response.data;
    const blocks = html.split(/<li[^>]*>/gi);
    const results = [];

    blocks.forEach(block => {
      const urlMatch = block.match(/<a[^>]+href="([^"]+)"/i);
      if (!urlMatch) return;

      let url = urlMatch[1];
      if (!url.includes('RU=')) return;

      const ruMatch = url.match(/\/RU=([^/]+)/);
      if (!ruMatch) return;

      const decodedUrl = decodeURIComponent(ruMatch[1]);
      if (decodedUrl.includes('yahoo.com')) return;

      const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (!titleMatch) return;

      let title = titleMatch[1].replace(/<[^>]*>/g, '').trim();

      const snippetMatch = block.match(/<div[^>]*class="[^"]*compText[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      let snippet = 'No snippet available.';
      if (snippetMatch) {
        snippet = snippetMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      }

      title = stripInjectionPatterns(cleanHiddenArtifacts(title, decodedUrl), decodedUrl);
      snippet = stripInjectionPatterns(cleanHiddenArtifacts(snippet, decodedUrl), decodedUrl);

      results.push({ title, url: decodedUrl, snippet });
    });

    const uniqueResults = [];
    const seenUrls = new Set();
    for (const r of results) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        uniqueResults.push(r);
      }
    }

    yahooResults = uniqueResults.slice(0, 5);
  } catch (error) {
    console.error("Yahoo Search failed, falling back to DDG Lite:", error.message);
    yahooFailed = true;
  }

  if (yahooFailed || yahooResults.length === 0) {
    broadcastTerminal(`> Yahoo search failed or returned no results. Falling back to DuckDuckGo Lite...\n`);
    const ddgResults = await searchDDGLite(query);
    if (ddgResults && ddgResults.length > 0) {
      broadcastTerminal(`> Found ${ddgResults.length} organic results from DuckDuckGo Lite.\n`);
      return { success: true, results: ddgResults };
    } else {
      broadcastTerminal(`> Both Yahoo and DuckDuckGo Lite searches failed or returned no results.\n`);
      return { success: false, message: "Arama işlemi başarısız oldu veya sonuç bulunamadı." };
    }
  }

  broadcastTerminal(`> Found ${yahooResults.length} organic results from Yahoo Search.\n`);
  return { success: true, results: yahooResults };
}

// Scrape website contents and extract text/media based on mode
async function viewWebsite(url, mode) {
  broadcastTerminal(`\n> [WEBSITE FETCH] URL: ${url} | Mode: ${mode || 'None'}\n`);
  agentState.lastVisitedUrl = url;
  if (checkBannedWebsites(url)) {
    broadcastTerminal(`> [BLOCKED] Website access is blacklisted.\n`);
    return { success: false, message: "Arama veya web sitesi erişimi güvenlik politikası nedeniyle engellendi." };
  }

  if (!mode) {
    broadcastTerminal(`> [WEBSITE FETCH (PAUSE)] Prompting AI for mode selection...\n`);
    return {
      success: true,
      message: "Sitede bulunan yazıları mı istersin? Yoksa URL'leri (linkler), görselleri veya dosyaları mı? Lütfen 'text', 'media' veya 'all' modlarından birini seçerek view_website aracını tekrar çağır."
    };
  }

  let usePuppeteer = false;
  let scrapeResult = { text: '', media: '' };

  try {
    broadcastTerminal(`> [WEBSITE FETCH (LIGHT)] Attempting to load via Axios+Cheerio...\n`);
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0' },
      timeout: 10000
    });
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    $('script, style, nav, header, footer, noscript, [style*="display:none"], [style*="visibility:hidden"], [style*="opacity:0"], [style*="font-size:0"], [hidden], [aria-hidden="true"]').remove();
    
    if (mode === 'text' || mode === 'all') {
      scrapeResult.text = $('body').text().replace(/\s+/g, ' ').trim();
    }
    
    if (mode === 'media' || mode === 'all') {
      const images = [];
      $('img').each((i, el) => {
        if (i >= 50) return false;
        const src = $(el).attr('src');
        const alt = $(el).attr('alt') || '';
        if (src) images.push(`[IMAGE] Alt: "${alt}" | Src: "${src}"`);
      });
      
      const links = [];
      $('a').each((i, el) => {
        if (i >= 100) return false;
        const href = $(el).attr('href');
        const linkText = $(el).text().replace(/\s+/g, ' ').trim();
        if (href) links.push(`[LINK] Text: "${linkText}" | Href: "${href}"`);
      });
      
      scrapeResult.media = [...images, ...links].join('\n');
    }

    if (scrapeResult.text.length < 200 && html.toLowerCase().includes('<noscript>')) {
      broadcastTerminal(`> [WEBSITE FETCH] Page seems to require JavaScript (SPA). Falling back to Puppeteer...\n`);
      usePuppeteer = true;
    }

  } catch (err) {
    broadcastTerminal(`> [WEBSITE FETCH (LIGHT)] Axios failed (${err.message}). Falling back to Puppeteer...\n`);
    usePuppeteer = true;
  }

  let page = null;
  if (usePuppeteer) {
    try {
      const browser = await getSharedBrowser();
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      scrapeResult = await page.evaluate((evalMode) => {
        const elements = document.querySelectorAll('script, style, nav, header, footer, noscript, [style*="display:none"], [style*="visibility:hidden"], [style*="opacity:0"], [style*="font-size:0"], [hidden], [aria-hidden="true"]');
        elements.forEach(el => el.remove());

        let bodyText = '';
        if (evalMode === 'text' || evalMode === 'all') {
          bodyText = document.body.innerText.replace(/\s+/g, ' ').trim();
        }

        let mediaContent = '';
        if (evalMode === 'media' || evalMode === 'all') {
          const images = Array.from(document.querySelectorAll('img'))
            .map(img => img.getAttribute('src') ? `[IMAGE] Alt: "${img.getAttribute('alt') || ''}" | Src: "${img.getAttribute('src')}"` : '')
            .filter(Boolean).slice(0, 50);

          const links = Array.from(document.querySelectorAll('a'))
            .map(a => a.getAttribute('href') ? `[LINK] Text: "${a.innerText.replace(/\s+/g, ' ').trim()}" | Href: "${a.getAttribute('href')}"` : '')
            .filter(Boolean).slice(0, 100);

          mediaContent = [...images, ...links].join('\n');
        }

        return { text: bodyText, media: mediaContent };
      }, mode);

    } catch (err) {
      broadcastTerminal(`> [WEBSITE FETCH ERROR] Both methods failed: ${err.message}\n`);
      if (page) await page.close();
      return { success: false, message: `Hata oluştu: ${err.message}` };
    } finally {
      if (page) await page.close();
    }
  }

  let resultText = '';
  if (mode === 'text' || mode === 'all') {
    resultText += scrapeResult.text;
  }

  if (mode === 'media' || mode === 'all') {
    if (resultText.length > 0) resultText += '\n\n';
    resultText += `=== MEDIA & LINKS ===\n${scrapeResult.media || 'None'}\n======================\n`;
  }

  if (resultText.length === 0) {
    resultText = "No readable content found.";
  }

  const maxLength = 8000;
  if (resultText.length > maxLength) {
    resultText = resultText.substring(0, maxLength) + '\n\n[Content truncated for length...]';
  }

  resultText = sanitizeWebContent(resultText, url);

  broadcastTerminal(`> Downloaded and extracted ${resultText.length} characters (Mode: ${mode}) [Sanitized & Delimited].\n`);
  return { success: true, url, content: resultText };
}

async function runDeepWebSearch(query, pageCount = 20) {
  const { broadcastTerminal, broadcastDeepResearchProgress, getLmStudioEndpoint, config } = require('../state');
  broadcastTerminal(`\n> [DEEP WEB SEARCH] Starting Deep Research for "${query}" (Target: ${pageCount} pages)\n`);
  
  let urls = [];
  try {
    const response = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 10000
    });
    const html = response.data;
    const hrefRegex = /<a\s+[^>]*class=['"]result-link['"][^>]*href=['"]([^'"]+)['"]/gi;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
      if (urls.length < pageCount && !urls.includes(match[1])) urls.push(match[1]);
    }
  } catch(e) {}
  
  if (urls.length < pageCount) {
    try {
      const response = await axios.get(`https://search.yahoo.com/search?q=${encodeURIComponent(query)}&n=${pageCount}`, { timeout: 10000 });
      const html = response.data;
      const blocks = html.split(/<li[^>]*>/gi);
      blocks.forEach(block => {
        const urlMatch = block.match(/<a[^>]+href="([^"]+)"/i);
        if (urlMatch && urlMatch[1].includes('RU=')) {
          const ruMatch = urlMatch[1].match(/\/RU=([^/]+)/);
          if (ruMatch) {
            const decodedUrl = decodeURIComponent(ruMatch[1]);
            if (!decodedUrl.includes('yahoo.com') && !urls.includes(decodedUrl) && urls.length < pageCount) {
              urls.push(decodedUrl);
            }
          }
        }
      });
    } catch(e) {}
  }
  
  if (urls.length === 0) {
    return { success: false, message: "Arama motorlarından sonuç alınamadı." };
  }

  const summaries = [];
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (broadcastDeepResearchProgress) broadcastDeepResearchProgress(i + 1, urls.length, url, "Sayfa indiriliyor...");
    
    let pageText = "";
    try {
      const res = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      const $ = cheerio.load(res.data);
      $('script, style, noscript, nav, footer, header, [style*="display:none"], [style*="visibility:hidden"], [style*="opacity:0"], [style*="font-size:0"], [hidden], [aria-hidden="true"]').remove();
      pageText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 6000);
      pageText = sanitizeWebContent(pageText, url);
    } catch(e) {
      pageText = "";
    }
    
    if (pageText.length < 100) {
      if (broadcastDeepResearchProgress) broadcastDeepResearchProgress(i + 1, urls.length, url, "Sayfada yeterli metin bulunamadı, atlanıyor.");
      continue;
    }
    
    if (broadcastDeepResearchProgress) broadcastDeepResearchProgress(i + 1, urls.length, url, "Yapay Zeka ile özetleniyor...");
    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 60000);
      const llmRes = await fetch(getLmStudioEndpoint('/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName || 'default',
          messages: [
            { role: "system", content: "Sen profesyonel bir araştırmacısın. Sana verilen web sayfası metnini okuyup kullanıcının arama sorgusu ile ilgili en önemli bilgileri 2-3 cümleyle özetle. Yanıtta markdown kullanabilirsin." },
            { role: "user", content: `Sorgu: ${query}\n\nSayfa Metni:\n${pageText}` }
          ],
          temperature: 0.1,
          max_tokens: 300
        }),
        signal: abortController.signal
      });
      clearTimeout(timeoutId);
      const data = await llmRes.json();
      const summary = data.choices[0].message.content.trim();
      summaries.push({ url, summary });
      
      const snippet = summary.split(' ').slice(0, 15).join(' ') + '...';
      if (broadcastDeepResearchProgress) broadcastDeepResearchProgress(i + 1, urls.length, url, snippet);
      broadcastTerminal(`> [DEEP WEB SEARCH] Page ${i+1} summarized.\n`);
    } catch(e) {
      if (broadcastDeepResearchProgress) broadcastDeepResearchProgress(i + 1, urls.length, url, "Özetleme başarısız oldu.");
    }
  }
  
  if (summaries.length === 0) return { success: false, message: "Sayfaların hiçbiri analiz edilemedi." };
  
  if (broadcastDeepResearchProgress) broadcastDeepResearchProgress(urls.length, urls.length, "Tüm sayfalar tamamlandı", "Ana özet oluşturuluyor...");
  broadcastTerminal(`> [DEEP WEB SEARCH] Combining ${summaries.length} summaries into master report...\n`);
  
  let combinedText = summaries.map((s, idx) => `[Kaynak ${idx+1}] (${s.url}):\n${s.summary}`).join('\n\n');
  let finalSummary = "";
  try {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 120000);
    const finalRes = await fetch(getLmStudioEndpoint('/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelName || 'default',
        messages: [
          { role: "system", content: "Sen uzman bir araştırmacısın. Birden fazla kaynaktan toplanan özetleri inceleyerek kullanıcının sorusuna kapsamlı, akıcı, zengin ve detaylı bir ana özet hazırla. Her bilginin sonuna kaynak atıflarını (örneğin [Kaynak 1]) mutlaka ekle. Çıktıda markdown kullan." },
          { role: "user", content: `Sorgu: ${query}\n\nToplanan Özetler:\n${combinedText}` }
        ],
        temperature: 0.3
      }),
      signal: abortController.signal
    });
    clearTimeout(timeoutId);
    const finalData = await finalRes.json();
    finalSummary = finalData.choices[0].message.content.trim();
  } catch(e) {
    return { success: false, message: "Ana özet oluşturulurken LLM hatası: " + e.message };
  }
  
  if (broadcastDeepResearchProgress) broadcastDeepResearchProgress(urls.length, urls.length, "TAMAMLANDI", "Sonuç agent'a iletiliyor.");
  return { success: true, message: "Deep Web Search completed successfully.", master_summary: finalSummary, sources_analyzed: summaries.length, sources: summaries.map(s => s.url) };
}

module.exports = {
  searchDDGLite,
  searchWeb,
  viewWebsite,
  runDeepWebSearch
};
