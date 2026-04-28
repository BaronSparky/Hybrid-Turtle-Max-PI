// ============================================================
// Market Data Service — EODHD (eodhd.com)
// ============================================================
//
// Alternative market data provider using EODHD Financial APIs.
// Requires an API key from https://eodhd.com/
// Implements the same function signatures as the Yahoo provider
// so the routing layer in market-data.ts can switch seamlessly.
//
// DEPENDENCIES
// Consumed by: market-data.ts (provider routing)
// Consumes: types/index.ts
// Risk-sensitive: YES — prices feed position sizing + stop logic
// Last modified: 2026-02-20
// Notes: UK stocks on EODHD use GBX (pence) just like Yahoo.
//        Verify after first live run.
// ============================================================

import 'server-only';
import { z } from 'zod';
import type { StockQuote, MarketIndex, FearGreedData } from '@/types';
import { EODHD_TICKER_MAP, toEodhdTicker } from './ticker-maps';

// ── EODHD API config ──
const EODHD_BASE = 'https://eodhd.com/api';

function getApiKey(): string {
  const key = process.env.EODHD_API_KEY;
  if (!key) throw new Error('[EODHD] No API key configured. Set EODHD_API_KEY in your .env file.');
  return key;
}

// ── In-memory cache (mirrors Yahoo provider TTLs) ──
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const quoteCache = new Map<string, CacheEntry<StockQuote>>();
const historicalCache = new Map<string, CacheEntry<DailyBar[]>>();
const fxCache = new Map<string, CacheEntry<number>>();
const QUOTE_TTL = 30 * 60_000;       // 30 minutes
const HISTORICAL_TTL = 86_400_000;   // 24 hours
const FX_TTL = 30 * 60_000;          // 30 minutes

// ── Rate limiting ──
const REQUEST_DELAY_MS = 200; // ms between consecutive requests
let requestQueueTail: Promise<void> = Promise.resolve();

function enqueueRequest<T>(fn: () => Promise<T>): Promise<T> {
  const result = requestQueueTail.then(() => fn());
  requestQueueTail = result.then(
    () => new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS)),
    () => new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS))
  );
  return result;
}

// ── DailyBar type (matches Yahoo provider) ──
interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Zod schemas for EODHD response validation ──
const EodhdRealTimeSchema = z.object({
  code: z.string(),
  timestamp: z.number().optional(),
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  close: z.number(),
  volume: z.number().nullable().optional(),
  previousClose: z.number().nullable().optional(),
  change: z.number().nullable().optional(),
  change_p: z.number().nullable().optional(),
  name: z.string().optional(),
});

const EodhdEodBarSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  adjusted_close: z.number().optional(),
  volume: z.number(),
});

const EodhdEodResponseSchema = z.array(EodhdEodBarSchema);

// ── Ticker mapping: uses shared ticker-maps.ts ──
// EODHD_TICKER_MAP and toEodhdTicker imported from './ticker-maps'

// EODHD index tickers (different from Yahoo's ^PREFIX format)
const EODHD_INDEX_MAP: { name: string; eodhTicker: string }[] = [
  { name: 'S&P 500', eodhTicker: 'GSPC.INDX' },
  { name: 'NASDAQ 100', eodhTicker: 'NDX.INDX' },
  { name: 'DOW 30', eodhTicker: 'DJI.INDX' },
  { name: 'Russell 2000', eodhTicker: 'RUT.INDX' },
  { name: 'FTSE 100', eodhTicker: 'FTSE.INDX' },
  { name: 'VIX', eodhTicker: 'VIX.INDX' },
];

// toEodhdTicker imported from './ticker-maps'

// ── HTTP helper with error handling ──
async function eodhFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${EODHD_BASE}${path}`);
  url.searchParams.set('api_token', getApiKey());
  url.searchParams.set('fmt', 'json');
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }

  const response = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
    // Next.js app router: don't cache at the edge
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`EODHD API ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// ────────────────────────────────────────────────────
// Stock Quote — real-time/delayed price via EODHD
// ────────────────────────────────────────────────────
export async function getStockQuote(ticker: string): Promise<StockQuote | null> {
  const cached = quoteCache.get(ticker);
  if (cached && cached.expiry > Date.now()) return cached.data;

  const eodhTicker = toEodhdTicker(ticker);

  try {
    const raw = await enqueueRequest(() =>
      eodhFetch<unknown>(`/real-time/${eodhTicker}`)
    );

    const parsed = EodhdRealTimeSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[EODHD] Invalid quote response for ${ticker}:`, parsed.error.message);
      return null;
    }
    const r = parsed.data;
    if (!r.close) return null;

    const quote: StockQuote = {
      ticker: ticker,
      name: r.name || ticker,
      price: r.close,
      change: r.change ?? 0,
      changePercent: r.change_p ?? 0,
      volume: r.volume ?? 0,
      previousClose: r.previousClose ?? 0,
      high: r.high ?? r.close,
      low: r.low ?? r.close,
      open: r.open ?? r.close,
    };

    quoteCache.set(ticker, { data: quote, expiry: Date.now() + QUOTE_TTL });
    return quote;
  } catch (error) {
    console.error(`[EODHD] Quote failed for ${ticker}:`, (error as Error).message);
    return null;
  }
}

// ────────────────────────────────────────────────────
// Historical OHLCV — EOD endpoint
// ────────────────────────────────────────────────────
export async function getDailyPrices(
  ticker: string,
  outputSize: 'compact' | 'full' = 'compact'
): Promise<DailyBar[]> {
  const cacheKey = `${ticker}:${outputSize}`;
  const cached = historicalCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.data;

  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - (outputSize === 'full' ? 400 : 120));

    const eodhTicker = toEodhdTicker(ticker);

    const raw = await enqueueRequest(() =>
      eodhFetch<unknown>(`/eod/${eodhTicker}`, {
        period: 'd',
        from: fromDate.toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0],
        order: 'd', // descending — newest first (matches Yahoo provider)
      })
    );

    const parsed = EodhdEodResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[EODHD] Invalid historical response for ${ticker}:`, parsed.error.message);
      return [];
    }

    if (parsed.data.length === 0) return [];

    // Data should already be newest-first (order=d), but ensure consistency
    const bars: DailyBar[] = parsed.data
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((bar) => ({
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        // Use adjusted_close when available (dividend-adjusted, matches Yahoo behaviour)
        close: bar.adjusted_close ?? bar.close,
        volume: bar.volume,
      }));

    historicalCache.set(cacheKey, { data: bars, expiry: Date.now() + HISTORICAL_TTL });
    return bars;
  } catch (error) {
    console.error(`[EODHD] Historical failed for ${ticker}:`, (error as Error).message);
    return [];
  }
}

// ── Market Indices — via EODHD real-time ──
export async function getMarketIndices(): Promise<MarketIndex[]> {
  const results: MarketIndex[] = [];

  // Fetch indices individually (EODHD real-time batch uses different format for indices)
  for (const idx of EODHD_INDEX_MAP) {
    try {
      const raw = await enqueueRequest(() =>
        eodhFetch<unknown>(`/real-time/${idx.eodhTicker}`)
      );
      const parsed = EodhdRealTimeSchema.safeParse(raw);
      if (parsed.success && parsed.data.close) {
        results.push({
          name: idx.name,
          ticker: idx.eodhTicker,
          value: parsed.data.close,
          change: parsed.data.change ?? 0,
          changePercent: parsed.data.change_p ?? 0,
        });
      } else {
        results.push({ name: idx.name, ticker: idx.eodhTicker, value: 0, change: 0, changePercent: 0 });
      }
    } catch {
      results.push({ name: idx.name, ticker: idx.eodhTicker, value: 0, change: 0, changePercent: 0 });
    }
  }

  return results;
}

// ── Fear & Greed — VIX-based approximation (same logic as Yahoo provider) ──
export async function getFearGreedIndex(): Promise<FearGreedData> {
  try {
    const raw = await enqueueRequest(() =>
      eodhFetch<unknown>(`/real-time/VIX.INDX`)
    );
    const parsed = EodhdRealTimeSchema.safeParse(raw);
    const vixPrice = parsed.success ? parsed.data.close : 20;

    let value: number;
    if (vixPrice < 12) value = 90;
    else if (vixPrice < 16) value = 75;
    else if (vixPrice < 20) value = 60;
    else if (vixPrice < 25) value = 40;
    else if (vixPrice < 30) value = 25;
    else value = 10;

    const label =
      value >= 75 ? 'Extreme Greed' :
      value >= 55 ? 'Greed' :
      value >= 45 ? 'Neutral' :
      value >= 25 ? 'Fear' :
      'Extreme Fear';

    return { value, label, previousClose: value, oneWeekAgo: value, oneMonthAgo: value };
  } catch {
    return { value: 50, label: 'Neutral', previousClose: 50, oneWeekAgo: 50, oneMonthAgo: 50 };
  }
}

// ── FX Rate via EODHD ──
export async function getFXRate(fromCurrency: string, toCurrency: string): Promise<number> {
  if (fromCurrency === toCurrency) return 1;
  const pair = `${fromCurrency}${toCurrency}`;
  const cached = fxCache.get(pair);
  if (cached && cached.expiry > Date.now()) return cached.data;

  try {
    // EODHD FX format: USDGBP.FOREX
    const raw = await enqueueRequest(() =>
      eodhFetch<unknown>(`/real-time/${pair}.FOREX`)
    );
    const parsed = EodhdRealTimeSchema.safeParse(raw);
    if (parsed.success && parsed.data.close > 0) {
      fxCache.set(pair, { data: parsed.data.close, expiry: Date.now() + FX_TTL });
      return parsed.data.close;
    }
  } catch (error) {
    console.warn(`[EODHD] FX rate failed for ${pair}:`, (error as Error).message);
  }

  // Hardcoded fallbacks (same as Yahoo provider)
  const fallbacks: Record<string, number> = {
    USDGBP: 0.79,
    GBPUSD: 1.27,
    EURGBP: 0.86,
    GBPEUR: 1.16,
    CHFGBP: 0.89,
    DKKGBP: 0.115,
  };
  return fallbacks[pair] ?? 1;
}

// ── Batch Quotes — fetch multiple tickers ──
export async function getBatchQuotes(tickers: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();
  if (tickers.length === 0) return results;

  // Serve from cache first
  const uncached: string[] = [];
  for (const ticker of tickers) {
    const cached = quoteCache.get(ticker);
    if (cached && cached.expiry > Date.now()) {
      results.set(ticker, cached.data);
    } else {
      uncached.push(ticker);
    }
  }

  if (uncached.length === 0) return results;

  // EODHD real-time batch: /real-time/{first}?s={rest,comma,separated}
  // Process in chunks of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const eodhTickers = batch.map(t => toEodhdTicker(t));

    try {
      // EODHD batch: primary ticker in URL, additional tickers in ?s= param
      const primary = eodhTickers[0];
      const rest = eodhTickers.slice(1);

      const params: Record<string, string> = {};
      if (rest.length > 0) {
        params.s = rest.join(',');
      }

      const raw = await enqueueRequest(() =>
        eodhFetch<unknown>(`/real-time/${primary}`, params)
      );

      // EODHD batch returns an array when multiple tickers, single object for one
      const rawArray = Array.isArray(raw) ? raw : [raw];

      for (const item of rawArray) {
        const parsed = EodhdRealTimeSchema.safeParse(item);
        if (!parsed.success || !parsed.data.close) continue;

        const r = parsed.data;
        // Reverse-map EODHD ticker back to DB ticker
        const eodhCode = r.code;
        const originalIdx = eodhTickers.indexOf(eodhCode);
        const originalTicker = originalIdx >= 0 ? batch[originalIdx] : eodhCode;

        const quote: StockQuote = {
          ticker: originalTicker,
          name: r.name || originalTicker,
          price: r.close,
          change: r.change ?? 0,
          changePercent: r.change_p ?? 0,
          volume: r.volume ?? 0,
          previousClose: r.previousClose ?? 0,
          high: r.high ?? r.close,
          low: r.low ?? r.close,
          open: r.open ?? r.close,
        };

        quoteCache.set(originalTicker, { data: quote, expiry: Date.now() + QUOTE_TTL });
        results.set(originalTicker, quote);
      }
    } catch (error) {
      console.error(`[EODHD] Batch quote failed for chunk ${i}-${i + batch.length}:`, (error as Error).message);
      // Fallback: fetch individually
      for (const ticker of batch) {
        try {
          const quote = await getStockQuote(ticker);
          if (quote) results.set(ticker, quote);
        } catch { /* skip */ }
      }
    }

    if (i + BATCH_SIZE < uncached.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

// ── Clear caches (useful when switching providers) ──
export function clearCaches(): void {
  quoteCache.clear();
  historicalCache.clear();
  fxCache.clear();
}
