const fs = require('fs');
const pdfParse = require('pdf-parse');

async function readPdf(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, message: `PDF file not found at path: ${filePath}` };
    }
    
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    
    // Check if the pdf is extremely large to avoid token explosion
    let content = data.text;
    if (content.length > 50000) {
      content = content.substring(0, 50000) + '\n\n...[Content truncated due to size limit]...';
    }

    return {
      success: true,
      content: content,
      metadata: {
        pages: data.numpages,
        info: data.info
      }
    };
  } catch (err) {
    return { success: false, message: `Error reading PDF: ${err.message}` };
  }
}

module.exports = { readPdf };
