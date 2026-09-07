const axios = require('axios');
const path = require('path');
const fs = require('fs');

const { agentState, broadcastTerminal, getLmStudioEndpoint } = require('../state');
const { getSandboxPath } = require('./filesystem');
const { extractUrlsFromText } = require('./filters');
const { llmFetch } = require('../llm/llmClient');

// Downloads an image from a URL and saves it to the local workspace sandbox
async function downloadImage(url, destPath) {
  const targetPath = path.resolve(agentState.cwd, destPath);
  const sandboxPath = getSandboxPath(targetPath);
  broadcastTerminal(`\n> [DOWNLOAD IMAGE] URL: ${url} -> Sandbox Path: ${sandboxPath}\n`);
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    const buffer = Buffer.from(response.data);

    const dir = path.dirname(sandboxPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    await fs.promises.writeFile(sandboxPath, buffer);
    broadcastTerminal(`> Image downloaded successfully to sandbox ${destPath}\n`);
    return { success: true, savedPath: sandboxPath, message: `Image downloaded successfully and saved to sandbox ${destPath}` };
  } catch (error) {
    broadcastTerminal(`[ERROR] Image download failed: ${error.message}\n`);
    return { success: false, message: error.message };
  }
}

async function checkImageWithAI(imagePath, question) {
  if (!fs.existsSync(imagePath)) {
    return { matched: false, reason: "Görsel indirilemedi veya bulunamadı." };
  }
  
  let mimeType = 'image/jpeg';
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  if (ext === 'png') {
    mimeType = 'image/png';
  } else if (ext === 'webp') {
    mimeType = 'image/webp';
  } else if (ext === 'gif') {
    mimeType = 'image/gif';
  }
  
  try {
    const base64Data = await fs.promises.readFile(imagePath, 'base64');
    const endpoint = getLmStudioEndpoint('/chat/completions');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `Görseli incele ve şu soruyu cevapla: "${question}". Cevap olarak sadece "evet" veya "hayır" yazmalısın. Başka hiçbir açıklama yapma.` },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`
                }
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 10
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const reply = (data.choices[0].message.content || '').trim().toLowerCase();
      console.log(`[IMAGE CHECK] AI reply: "${reply}"`);
      const isYes = reply.includes('evet') || reply.includes('yes');
      return { matched: isYes, reply: reply };
    } else {
      return { matched: false, reason: `HTTP error ${response.status}` };
    }
  } catch (err) {
    console.error("AI image check failed:", err);
    return { matched: false, reason: err.message };
  }
}

async function urlImageReader(selection, count, question) {
  broadcastTerminal(`\n> [URL IMAGE READER] Selection: ${selection} | Count: ${count} | Question: ${question}\n`);
  
  const content = agentState.lastFilteredOutput || agentState.lastToolOutput || '';
  if (!content) {
    return { success: false, message: "Taranacak URL listesi bulunamadı. Lütfen önce filter_output veya view_website aracını kullanın." };
  }
  
  const urls = extractUrlsFromText(content, agentState.lastVisitedUrl);
  if (urls.length === 0) {
    return { success: false, message: "Hiçbir geçerli URL/görsel bağlantısı bulunamadı." };
  }
  
  broadcastTerminal(`> Found ${urls.length} candidate URLs. Selecting matching subset...\n`);
  
  let selectedUrls = [...urls];
  if (selection === 'last') {
    selectedUrls.reverse();
  } else if (selection === 'random') {
    selectedUrls.sort(() => Math.random() - 0.5);
  }
  selectedUrls = selectedUrls.slice(0, count);
  
  const results = [];
  let foundMatch = null;
  
  const downloadDir = path.join(agentState.cwd, 'Libraries', 'library');
  if (!fs.existsSync(downloadDir)) {
    await fs.promises.mkdir(downloadDir, { recursive: true });
  }
  
  for (let i = 0; i < selectedUrls.length; i++) {
    const url = selectedUrls[i];
    broadcastTerminal(`> [${i+1}/${selectedUrls.length}] Processing URL: ${url}\n`);
    
    const tempFilename = path.join(downloadDir, `temp_url_image_${Date.now()}_${i}.jpg`);
    const downloadRes = await downloadImage(url, tempFilename);
    
    if (downloadRes.success) {
      const checkRes = await checkImageWithAI(tempFilename, question);
      
      try {
        if (fs.existsSync(tempFilename)) {
          await fs.promises.unlink(tempFilename);
        }
      } catch (e) {
        console.error("Failed to delete temp image:", e);
      }
      
      results.push({
        url: url,
        matched: checkRes.matched,
        reply: checkRes.reply || checkRes.reason
      });
      
      if (checkRes.matched) {
        foundMatch = url;
        broadcastTerminal(`> MATCH FOUND! "${url}" meets user criteria.\n`);
        break;
      }
    } else {
      results.push({
        url: url,
        matched: false,
        reply: `Download failed: ${downloadRes.message}`
      });
    }
  }
  
  if (foundMatch) {
    return {
      success: true,
      matched: true,
      matched_url: foundMatch,
      message: `Aranan görsel başarıyla bulundu: ${foundMatch}`,
      scanned_count: results.length,
      details: results
    };
  } else {
    return {
      success: true,
      matched: false,
      message: "Taranan görseller arasında aranan kriterlere uyan bir görsel bulunamadı.",
      scanned_count: results.length,
      details: results
    };
  }
}

async function extractChartData(imagePath) {
  broadcastTerminal(`\n> [CHART EXTRACTION] Analyzing image: ${imagePath}\n`);
  
  const absolutePath = path.resolve(agentState.cwd, imagePath);
  if (!fs.existsSync(absolutePath)) {
    return { success: false, message: `Görsel bulunamadı: ${absolutePath}` };
  }
  
  let mimeType = 'image/jpeg';
  const ext = path.extname(absolutePath).toLowerCase().replace('.', '');
  if (ext === 'png') mimeType = 'image/png';
  else if (ext === 'webp') mimeType = 'image/webp';
  else if (ext === 'gif') mimeType = 'image/gif';
  
  try {
    const base64Data = await fs.promises.readFile(absolutePath, 'base64');
    
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Sen bir finansal veri çıkarıcı yapay zekasın. Gönderdiğim grafik görselini (çizgi veya mum grafiği) analiz et ve grafikteki veri noktalarını sırasıyla sadece düz bir JSON sayı dizisi olarak çıkar (örneğin: [1, 6, 2, 5, 7, 13, 265, ...]). Sayılar 1 ile 1000 arasında orantılanmış olmalıdır. Sadece JSON dizisini yaz, markdown block kullanabilirsin, başka hiçbir açıklama yapma.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
        ]
      }
    ];

    const result = await llmFetch(messages, 0.1, "Chart Extraction", 2);
    
    // Try to parse array from the response
    let extractedArray = [];
    const arrayRegex = /\[[\s\S]*?\]/;
    const match = arrayRegex.exec(result);
    if (match) {
      try {
        extractedArray = JSON.parse(match[0]);
      } catch (e) {
         return { success: false, message: `Çıktı JSON array olarak parse edilemedi: ${e.message}`, raw_output: result };
      }
    } else {
      return { success: false, message: "LLM cevabında dizi formatı bulunamadı.", raw_output: result };
    }

    const savePath = path.join(agentState.cwd, `extracted_chart_${Date.now()}.json`);
    await fs.promises.writeFile(savePath, JSON.stringify(extractedArray, null, 2));
    
    broadcastTerminal(`> [CHART EXTRACTION] Data extracted and saved to: ${savePath}\n`);
    
    return { success: true, message: `Grafik başarıyla çıkarıldı ve dizi JSON formatında kaydedildi: ${savePath}`, array: extractedArray };
  } catch (err) {
    console.error("AI chart extraction failed:", err);
    return { success: false, message: `Çıkarma işlemi başarısız oldu: ${err.message}` };
  }
}

module.exports = {
  downloadImage,
  checkImageWithAI,
  urlImageReader,
  extractChartData
};
