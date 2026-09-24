/**
 * Stellarigent Cost & Quota Tracking Subsystem
 * Monitors LLM token usage across local (LM Studio) and external cloud providers
 * (OpenAI, Anthropic, Gemini, Groq), calculates estimated USD expenses,
 * and enforces daily budget limits to prevent accidental runaway cloud costs.
 */

const { agentState, config, broadcastState } = require('../state');

// Estimated USD pricing per 1,000,000 tokens (Standard API Rates)
const MODEL_PRICING_PER_MILLION = {
  // OpenAI
  'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
  'gpt-4o': { prompt: 2.50, completion: 10.00 },
  // Anthropic
  'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25 },
  'claude-3-5-haiku-20241022': { prompt: 0.80, completion: 4.00 },
  'claude-3-5-sonnet-20241022': { prompt: 3.00, completion: 15.00 },
  // Google Gemini
  'gemini-1.5-flash': { prompt: 0.075, completion: 0.30 },
  'gemini-1.5-pro': { prompt: 1.25, completion: 5.00 },
  'gemini-2.0-flash': { prompt: 0.10, completion: 0.40 },
  // Groq
  'llama3-70b-8192': { prompt: 0.59, completion: 0.79 },
  'llama-3.3-70b-versatile': { prompt: 0.59, completion: 0.79 },
  'mixtral-8x7b-32768': { prompt: 0.24, completion: 0.24 },
  // Local Inference (100% Free)
  'local': { prompt: 0.0, completion: 0.0 }
};

const DEFAULT_DAILY_BUDGET_USD = 1.00; // $1.00 daily safety cap by default

class CostTracker {
  constructor() {
    this.sessionMetrics = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalCostUSD: 0.0,
      requestCount: 0,
      cloudRequestCount: 0,
      localRequestCount: 0
    };
    this.dailyUsage = {}; // 'YYYY-MM-DD' -> { costUSD, promptTokens, completionTokens }
    this.requestLog = [];
  }

  getTodayKey() {
    return new Date().toISOString().split('T')[0];
  }

  getPricing(modelName, provider) {
    if (provider === 'local' || provider === 'lmstudio') {
      return { prompt: 0.0, completion: 0.0 };
    }
    const clean = (modelName || '').toLowerCase().trim();
    for (const [key, rates] of Object.entries(MODEL_PRICING_PER_MILLION)) {
      if (clean.includes(key.toLowerCase())) {
        return rates;
      }
    }
    // Default fallback pricing for unknown cloud models
    return { prompt: 0.50, completion: 1.50 };
  }

  calculateCostUSD(modelName, provider, promptTokens = 0, completionTokens = 0) {
    const pricing = this.getPricing(modelName, provider);
    const promptCost = (promptTokens / 1000000) * pricing.prompt;
    const completionCost = (completionTokens / 1000000) * pricing.completion;
    return Number((promptCost + completionCost).toFixed(6));
  }

  recordUsage({ provider = 'local', model = 'unknown', promptTokens = 0, completionTokens = 0, taskId = null }) {
    const pTokens = Math.max(0, parseInt(promptTokens, 10) || 0);
    const cTokens = Math.max(0, parseInt(completionTokens, 10) || 0);
    const totTokens = pTokens + cTokens;
    const costUSD = this.calculateCostUSD(model, provider, pTokens, cTokens);

    this.sessionMetrics.promptTokens += pTokens;
    this.sessionMetrics.completionTokens += cTokens;
    this.sessionMetrics.totalTokens += totTokens;
    this.sessionMetrics.totalCostUSD = Number((this.sessionMetrics.totalCostUSD + costUSD).toFixed(6));
    this.sessionMetrics.requestCount += 1;

    if (provider === 'local' || provider === 'lmstudio') {
      this.sessionMetrics.localRequestCount += 1;
    } else {
      this.sessionMetrics.cloudRequestCount += 1;
    }

    const today = this.getTodayKey();
    if (!this.dailyUsage[today]) {
      this.dailyUsage[today] = { costUSD: 0.0, promptTokens: 0, completionTokens: 0 };
    }
    this.dailyUsage[today].costUSD = Number((this.dailyUsage[today].costUSD + costUSD).toFixed(6));
    this.dailyUsage[today].promptTokens += pTokens;
    this.dailyUsage[today].completionTokens += cTokens;

    this.requestLog.push({
      timestamp: new Date().toISOString(),
      provider,
      model,
      promptTokens: pTokens,
      completionTokens: cTokens,
      totalTokens: totTokens,
      costUSD,
      taskId
    });

    if (this.requestLog.length > 500) {
      this.requestLog.shift();
    }

    // Sync with global agentState metrics
    this.syncStateMetrics();

    return {
      costUSD,
      totalTokens: totTokens,
      sessionCostUSD: this.sessionMetrics.totalCostUSD,
      todayCostUSD: this.dailyUsage[today].costUSD
    };
  }

  checkBudgetExceeded() {
    const limit = (config && typeof config.maxDailyCostUSD === 'number') 
      ? config.maxDailyCostUSD 
      : DEFAULT_DAILY_BUDGET_USD;

    const today = this.getTodayKey();
    const currentDaily = (this.dailyUsage[today] && this.dailyUsage[today].costUSD) || 0.0;

    if (currentDaily >= limit) {
      return {
        exceeded: true,
        currentDailyUSD: currentDaily,
        budgetLimitUSD: limit,
        message: `Günlük bulut LLM bütçe sınırı ($${limit.toFixed(2)}) aşıldı! Mevcut harcama: $${currentDaily.toFixed(4)}. İstemci güvenliği için dış bulut API çağrıları durduruldu.`
      };
    }

    return {
      exceeded: false,
      currentDailyUSD: currentDaily,
      budgetLimitUSD: limit
    };
  }

  getCostSummary() {
    const today = this.getTodayKey();
    const dailyCost = (this.dailyUsage[today] && this.dailyUsage[today].costUSD) || 0.0;
    const limit = (config && typeof config.maxDailyCostUSD === 'number') ? config.maxDailyCostUSD : DEFAULT_DAILY_BUDGET_USD;

    return {
      totalCostUSD: this.sessionMetrics.totalCostUSD,
      dailyCostUSD: dailyCost,
      dailyLimitUSD: limit,
      promptTokens: this.sessionMetrics.promptTokens,
      completionTokens: this.sessionMetrics.completionTokens,
      totalTokens: this.sessionMetrics.totalTokens,
      requestCount: this.sessionMetrics.requestCount,
      cloudRequestCount: this.sessionMetrics.cloudRequestCount,
      localRequestCount: this.sessionMetrics.localRequestCount
    };
  }

  syncStateMetrics() {
    if (!agentState.metrics) agentState.metrics = {};
    agentState.metrics.cost = this.getCostSummary();
  }

  reset() {
    this.sessionMetrics = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalCostUSD: 0.0,
      requestCount: 0,
      cloudRequestCount: 0,
      localRequestCount: 0
    };
    this.dailyUsage = {};
    this.requestLog = [];
    this.syncStateMetrics();
  }
}

const costTracker = new CostTracker();

module.exports = {
  costTracker,
  MODEL_PRICING_PER_MILLION,
  DEFAULT_DAILY_BUDGET_USD
};
