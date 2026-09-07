const axios = require('axios');

async function getEmbedding(text, lmStudioUrl) {
  try {
    let baseUrl = (lmStudioUrl || 'http://127.0.0.1:1234/v1').trim().replace(/\/+$/, '');
    if (!baseUrl.toLowerCase().endsWith('/v1')) {
      baseUrl += '/v1';
    }
    baseUrl = baseUrl.replace(/:\/\/localhost/i, '://127.0.0.1');

    const response = await axios.post(`${baseUrl}/embeddings`, {
      input: text
    }, { timeout: 5000 });
    return response.data.data[0].embedding;
  } catch (error) {
    console.warn("[VECTOR SEARCH] Embedding unavailable (falling back to TF-IDF):", error.message);
    return null;
  }
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;
  if (vecA.length !== vecB.length) {
    console.warn(`[VECTOR SEARCH] Dimension mismatch: vecA=${vecA.length}, vecB=${vecB.length}. Skipping similarity — did the embedding model change?`);
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  getEmbedding,
  cosineSimilarity
};
