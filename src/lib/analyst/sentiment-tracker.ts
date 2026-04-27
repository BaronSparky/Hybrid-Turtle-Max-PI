/**
 * DEPENDENCIES
 * Consumed by: /api/analyst/sentiment-trend, watchlist-news page, news-batch route
 * Consumes: fs (local JSON file storage)
 * Risk-sensitive: NO — advisory sentiment tracking, no trade execution
 * Notes: Tracks sentiment scores over time per ticker. Stores historical entries
 *        with timestamps for trend direction analysis. Uses a JSON file in the
 *        data directory. Max 30 entries per ticker (one per day).
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Sentiment } from './sentiment';

const TREND_FILE = path.join(process.cwd(), 'data', 'sentiment-trends.json');
const MAX_ENTRIES_PER_TICKER = 30;

export interface SentimentEntry {
  sentiment: Sentiment;
  confidence: 'HIGH' | 'LOW';
  timestamp: number;
  date: string; // YYYY-MM-DD
}

export type SentimentDirection = 'IMPROVING' | 'STABLE' | 'DETERIORATING';

export interface SentimentTrend {
  ticker: string;
  current: Sentiment;
  direction: SentimentDirection;
  entries: SentimentEntry[];
  daysCovered: number;
}

interface TrendStore {
  tickers: Record<string, SentimentEntry[]>;
}

async function ensureDataDir(): Promise<void> {
  const dir = path.dirname(TREND_FILE);
  await fs.mkdir(dir, { recursive: true });
}

async function readStore(): Promise<TrendStore> {
  try {
    const raw = await fs.readFile(TREND_FILE, 'utf-8');
    return JSON.parse(raw) as TrendStore;
  } catch {
    return { tickers: {} };
  }
}

async function writeStore(store: TrendStore): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(TREND_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function sentimentToScore(s: Sentiment): number {
  if (s === 'POSITIVE') return 1;
  if (s === 'NEGATIVE') return -1;
  return 0;
}

function computeDirection(entries: SentimentEntry[]): SentimentDirection {
  if (entries.length < 2) return 'STABLE';

  // Compare average of last 3 entries vs previous 3
  const recent = entries.slice(-3);
  const prior = entries.slice(-6, -3);

  if (prior.length === 0) return 'STABLE';

  const recentAvg = recent.reduce((sum, e) => sum + sentimentToScore(e.sentiment), 0) / recent.length;
  const priorAvg = prior.reduce((sum, e) => sum + sentimentToScore(e.sentiment), 0) / prior.length;

  const diff = recentAvg - priorAvg;
  if (diff > 0.3) return 'IMPROVING';
  if (diff < -0.3) return 'DETERIORATING';
  return 'STABLE';
}

/**
 * Record a sentiment observation for a ticker.
 * Only one entry per ticker per day — updates if same day.
 */
export async function recordSentiment(
  ticker: string,
  sentiment: Sentiment,
  confidence: 'HIGH' | 'LOW'
): Promise<void> {
  const store = await readStore();
  const today = new Date().toISOString().slice(0, 10);

  if (!store.tickers[ticker]) {
    store.tickers[ticker] = [];
  }

  const entries = store.tickers[ticker];

  // Update existing entry for today, or append new
  const todayIdx = entries.findIndex(e => e.date === today);
  const entry: SentimentEntry = { sentiment, confidence, timestamp: Date.now(), date: today };

  if (todayIdx >= 0) {
    entries[todayIdx] = entry;
  } else {
    entries.push(entry);
  }

  // Cap entries
  if (entries.length > MAX_ENTRIES_PER_TICKER) {
    store.tickers[ticker] = entries.slice(-MAX_ENTRIES_PER_TICKER);
  }

  await writeStore(store);
}

/**
 * Record sentiment for multiple tickers at once.
 */
export async function recordBatchSentiment(
  items: Array<{ ticker: string; sentiment: Sentiment; confidence: 'HIGH' | 'LOW' }>
): Promise<void> {
  const store = await readStore();
  const today = new Date().toISOString().slice(0, 10);

  for (const item of items) {
    if (!store.tickers[item.ticker]) {
      store.tickers[item.ticker] = [];
    }

    const entries = store.tickers[item.ticker];
    const todayIdx = entries.findIndex(e => e.date === today);
    const entry: SentimentEntry = {
      sentiment: item.sentiment,
      confidence: item.confidence,
      timestamp: Date.now(),
      date: today,
    };

    if (todayIdx >= 0) {
      entries[todayIdx] = entry;
    } else {
      entries.push(entry);
    }

    if (entries.length > MAX_ENTRIES_PER_TICKER) {
      store.tickers[item.ticker] = entries.slice(-MAX_ENTRIES_PER_TICKER);
    }
  }

  await writeStore(store);
}

/**
 * Get sentiment trend for a ticker.
 */
export async function getSentimentTrend(ticker: string): Promise<SentimentTrend | null> {
  const store = await readStore();
  const entries = store.tickers[ticker];

  if (!entries || entries.length === 0) return null;

  const current = entries[entries.length - 1].sentiment;
  const direction = computeDirection(entries);
  const daysCovered = entries.length;

  return { ticker, current, direction, entries, daysCovered };
}

/**
 * Get sentiment trends for multiple tickers.
 */
export async function getBatchSentimentTrends(
  tickers: string[]
): Promise<Map<string, SentimentTrend>> {
  const store = await readStore();
  const result = new Map<string, SentimentTrend>();

  for (const ticker of tickers) {
    const entries = store.tickers[ticker];
    if (!entries || entries.length === 0) continue;

    const current = entries[entries.length - 1].sentiment;
    const direction = computeDirection(entries);

    result.set(ticker, {
      ticker,
      current,
      direction,
      entries,
      daysCovered: entries.length,
    });
  }

  return result;
}
