/**
 * DEPENDENCIES
 * Consumed by: /api/analyst/news-batch, CandidateExplainButton, watchlist-news page
 * Consumes: ollama-client.ts (Ollama), news-fetcher.ts types
 * Risk-sensitive: NO — read-only sentiment classification, advisory only
 * Notes: Lightweight headline sentiment classifier. Sends a batch of headlines
 *        to the local Ollama model with a short classification prompt.
 *        Returns POSITIVE/NEUTRAL/NEGATIVE per ticker. Uses the smallest
 *        available model for speed. Best-effort — returns NEUTRAL on failure.
 */

import { checkOllamaHealth, ollamaGenerate, pickModelForContext } from './ollama-client';

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';

export interface TickerSentiment {
  ticker: string;
  sentiment: Sentiment;
  confidence: 'HIGH' | 'LOW';
}

const SENTIMENT_SYSTEM = `You are a headline sentiment classifier for a trend-following trading system.
Classify the overall news sentiment for each ticker as exactly one of: POSITIVE, NEUTRAL, NEGATIVE.
POSITIVE = news supports price appreciation (earnings beat, upgrade, growth, M&A target).
NEGATIVE = news suggests downside risk (miss, downgrade, lawsuit, regulatory, leadership departure).
NEUTRAL = routine/irrelevant news (index inclusion, conference, analyst note with no clear direction).
Respond ONLY with one line per ticker in format: TICKER:SENTIMENT
No explanations. No extra text.`;

/**
 * Classify sentiment for a batch of tickers based on their headlines.
 * Best-effort — returns NEUTRAL for any ticker that can't be classified.
 */
export async function classifyBatchSentiment(
  items: Array<{ ticker: string; headlines: Array<{ title: string }> }>
): Promise<TickerSentiment[]> {
  // Filter to tickers with actual headlines
  const withHeadlines = items.filter(i => i.headlines.length > 0);
  if (withHeadlines.length === 0) {
    return items.map(i => ({ ticker: i.ticker, sentiment: 'NEUTRAL', confidence: 'LOW' }));
  }

  try {
    const health = await checkOllamaHealth();
    if (!health.available || !health.models.length) {
      return items.map(i => ({ ticker: i.ticker, sentiment: 'NEUTRAL', confidence: 'LOW' }));
    }

    const model = pickModelForContext(health.models, 'short');
    if (!model) {
      return items.map(i => ({ ticker: i.ticker, sentiment: 'NEUTRAL', confidence: 'LOW' }));
    }

    // Build prompt with all tickers and their top headlines
    const prompt = withHeadlines.map(item => {
      const headlineText = item.headlines.slice(0, 3).map(h => `- ${h.title}`).join('\n');
      return `${item.ticker}:\n${headlineText}`;
    }).join('\n\n');

    const result = await ollamaGenerate({
      model,
      system: SENTIMENT_SYSTEM,
      prompt: `Classify sentiment for these tickers:\n\n${prompt}`,
      options: { temperature: 0.1, num_predict: 100, num_ctx: 2048 },
    });

    if (!result?.response) {
      return items.map(i => ({ ticker: i.ticker, sentiment: 'NEUTRAL', confidence: 'LOW' }));
    }

    // Parse response: expect lines like "AAPL:POSITIVE"
    const parsed = new Map<string, Sentiment>();
    for (const line of result.response.split('\n')) {
      const match = line.trim().match(/^([A-Z0-9.\-]+)\s*[:=]\s*(POSITIVE|NEUTRAL|NEGATIVE)/i);
      if (match) {
        parsed.set(match[1].toUpperCase(), match[2].toUpperCase() as Sentiment);
      }
    }

    return items.map(i => ({
      ticker: i.ticker,
      sentiment: parsed.get(i.ticker) ?? 'NEUTRAL',
      confidence: parsed.has(i.ticker) ? 'HIGH' : 'LOW',
    }));
  } catch {
    return items.map(i => ({ ticker: i.ticker, sentiment: 'NEUTRAL', confidence: 'LOW' }));
  }
}
