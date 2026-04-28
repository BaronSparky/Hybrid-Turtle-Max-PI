/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, snapshot-sync.ts, /api/nightly/route.ts
 * Consumes: market-data.ts, prisma.ts
 * Risk-sensitive: YES — data source affects stop management + scan accuracy
 * Last modified: 2026-03-01
 * Notes: Three-tier fallback chain. Yahoo → optional providers → DB cache.
 *        Works with ZERO API keys (cache always available).
 */
// ============================================================
// Data Provider — Resilient Fallback Chain
// ============================================================
//
// Tier 1: Yahoo Finance (always tried first)
// Tier 2: Alpha Vantage (optional — requires ALPHA_VANTAGE_API_KEY)
// Tier 3: EODHD (optional — requires EODHD_API_KEY)
// Tier 4: DB Cache (always available — SnapshotTicker table)
//
// Current user has Yahoo only — Tiers 2/3 are stubs that activate
// automatically when API keys are added to .env.
// ============================================================

import 'server-only';
import { getBatchQuotes, getStockQuote } from './market-data';
import { getBatchQuotes as getEodhdBatchQuotes } from './market-data-eodhd';
import type { StockQuote } from '@/types';

// ── Types ─────────────────────────────────────────────────────

export type DataSource =
  | 'YAHOO'
  | 'ALPHA_VANTAGE'
  | 'EODHD'
  | 'CACHE_RECENT'
  | 'CACHE_STALE';

export type DataSourceHealth = 'LIVE' | 'PARTIAL' | 'DEGRADED';

export interface PriceData {
  ticker: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: Date;
  source: DataSource;
  isStale: boolean;
}

export interface FetchResult {
  prices: Map<string, PriceData>;
  /** Overall health: LIVE = all Yahoo, PARTIAL = mixed, DEGRADED = all cache */
  health: DataSourceHealth;
  /** Tickers that used cache instead of live data */
  staleTickers: string[];
  /** Hours since the oldest cache entry used */
  maxStalenessHours: number;
  /** Summary message for alerts/logging */
  summary: string;
}

// ── Staleness thresholds (hours) ──────────────────────────────

const CACHE_RECENT_THRESHOLD_HOURS = 24;
const CACHE_STALE_THRESHOLD_HOURS = 48;

// ── Alpha Vantage ─────────────────────────────────────────────

/** AV GLOBAL_QUOTE response shape */
interface AVGlobalQuote {
  'Global Quote': {
    '01. symbol': string;
    '02. open': string;
    '03. high': string;
    '04. low': string;
    '05. price': string;
    '06. volume': string;
    '07. latest trading day': string;
    '08. previous close': string;
    '09. change': string;
    '10. change percent': string;
  };
}

/** Rate limit: max 5 requests/minute for free tier */
const AV_RATE_LIMIT_MS = 12_500; // 12.5s between calls = ~5/min

/**
 * Fetch price data from Alpha Vantage GLOBAL_QUOTE endpoint.
 * Only attempts if ALPHA_VANTAGE_API_KEY env var is set and non-empty.
 * Each ticker requires a separate API call — used as fallback for small batches.
 *
 * Free tier: 25 requests/day, 5/minute.
 * Only fetches up to 20 tickers per invocation to stay within daily limits.
 *
 * @returns Map of ticker → PriceData, or null if provider unavailable
 */
async function fetchFromAlphaVantage(
  tickers: string[]
): Promise<Map<string, PriceData> | null> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key || key.trim() === '') return null;

  const results = new Map<string, PriceData>();

  // Cap at 20 to stay within 25/day free tier (leaves headroom for retries)
  const toFetch = tickers.slice(0, 20);
  if (toFetch.length < tickers.length) {
    console.warn(`[DataProvider] Alpha Vantage: capping at ${toFetch.length}/${tickers.length} tickers (daily limit)`);
  }

  console.log(`[DataProvider] Alpha Vantage: fetching ${toFetch.length} tickers...`);

  for (let i = 0; i < toFetch.length; i++) {
    const ticker = toFetch[i];
    try {
      const url = new URL('https://www.alphavantage.co/query');
      url.searchParams.set('function', 'GLOBAL_QUOTE');
      url.searchParams.set('symbol', ticker);
      url.searchParams.set('apikey', key);

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn(`[DataProvider] AV HTTP ${res.status} for ${ticker}`);
        continue;
      }

      const json = (await res.json()) as AVGlobalQuote | { Note?: string; Information?: string };

      // Check for rate-limit or error messages
      if ('Note' in json || 'Information' in json) {
        const msg = ('Note' in json ? json.Note : json.Information) ?? '';
        console.warn(`[DataProvider] AV rate-limited or error: ${msg.slice(0, 100)}`);
        break; // Stop trying — we've hit the limit
      }

      const gq = (json as AVGlobalQuote)['Global Quote'];
      if (!gq || !gq['05. price']) {
        continue; // No data for this ticker
      }

      const close = parseFloat(gq['05. price']);
      if (close <= 0 || isNaN(close)) continue;

      results.set(ticker, {
        ticker,
        close,
        open: parseFloat(gq['02. open']) || close,
        high: parseFloat(gq['03. high']) || close,
        low: parseFloat(gq['04. low']) || close,
        volume: parseInt(gq['06. volume'], 10) || 0,
        timestamp: new Date(),
        source: 'ALPHA_VANTAGE',
        isStale: false,
      });
    } catch (error) {
      console.warn(`[DataProvider] AV failed for ${ticker}: ${(error as Error).message}`);
    }

    // Rate limit between calls (skip delay after last ticker)
    if (i < toFetch.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, AV_RATE_LIMIT_MS));
    }
  }

  if (results.size > 0) {
    console.log(`[DataProvider] Alpha Vantage: got ${results.size}/${toFetch.length} tickers`);
  }

  return results.size > 0 ? results : null;
}

// ── EODHD ─────────────────────────────────────────────────────

/**
 * Fetch price data from EODHD Financial APIs via the existing
 * market-data-eodhd.ts module (getBatchQuotes).
 * Only attempts if EODHD_API_KEY env var is set and non-empty.
 * Returns null if key is missing (skip silently) or on failure.
 *
 * Uses EODHD real-time endpoint with batch support (up to 50 tickers).
 * API docs: https://eodhd.com/financial-apis/live-realtime-stocks-api
 *
 * @returns Map of ticker → PriceData, or null if provider unavailable
 */
async function fetchFromEODHD(
  tickers: string[]
): Promise<Map<string, PriceData> | null> {
  const key = process.env.EODHD_API_KEY;
  if (!key || key.trim() === '') return null;

  const results = new Map<string, PriceData>();

  try {
    console.log(`[DataProvider] EODHD: fetching ${tickers.length} tickers...`);
    const quotes = await getEodhdBatchQuotes(tickers);
    const now = new Date();

    quotes.forEach((quote: StockQuote, ticker: string) => {
      if (quote.price > 0) {
        results.set(ticker, {
          ticker,
          close: quote.price,
          open: quote.open,
          high: quote.high,
          low: quote.low,
          volume: quote.volume,
          timestamp: now,
          source: 'EODHD',
          isStale: false,
        });
      }
    });

    if (results.size > 0) {
      console.log(`[DataProvider] EODHD: got ${results.size}/${tickers.length} tickers`);
    }
  } catch (error) {
    console.error('[DataProvider] EODHD batch fetch failed:', (error as Error).message);
  }

  return results.size > 0 ? results : null;
}

// ── DB Cache Fallback ─────────────────────────────────────────

/**
 * Load cached price data from the most recent SnapshotTicker rows in the DB.
 * Always available — no external API needed.
 *
 * Staleness classification:
 *   < 24h old  → CACHE_RECENT, isStale = false
 *   24-48h old → CACHE_RECENT, isStale = true
 *   > 48h old  → CACHE_STALE,  isStale = true
 */
async function fetchFromCache(
  tickers: string[]
): Promise<Map<string, PriceData>> {
  // Dynamic import to avoid circular dependency — prisma only needed here
  const { default: prisma } = await import('./prisma');

  const results = new Map<string, PriceData>();
  if (tickers.length === 0) return results;

  // Find the most recent snapshot
  const latestSnapshot = await prisma.snapshot.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });

  if (!latestSnapshot) {
    console.warn('[DataProvider] No snapshot found in DB — cache unavailable');
    return results;
  }

  // Query SnapshotTicker rows for the requested tickers from the latest snapshot
  const rows = await prisma.snapshotTicker.findMany({
    where: {
      snapshotId: latestSnapshot.id,
      ticker: { in: tickers },
    },
    select: {
      ticker: true,
      close: true,
      atr14: true,
      adx14: true,
      volRatio: true,
      high20: true,
      createdAt: true,
    },
  });

  const now = Date.now();

  for (const row of rows) {
    const ageMs = now - row.createdAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    let source: DataSource;
    let isStale: boolean;

    if (ageHours < CACHE_RECENT_THRESHOLD_HOURS) {
      source = 'CACHE_RECENT';
      isStale = false;
    } else if (ageHours < CACHE_STALE_THRESHOLD_HOURS) {
      source = 'CACHE_RECENT';
      isStale = true;
    } else {
      source = 'CACHE_STALE';
      isStale = true;
    }

    results.set(row.ticker, {
      ticker: row.ticker,
      close: row.close,
      // Cache doesn't have intraday OHLC — use close for all
      // This is safe for nightly stop management (uses close, not intraday)
      open: row.close,
      high: row.close,
      low: row.close,
      volume: 0,
      timestamp: row.createdAt,
      source,
      isStale,
    });
  }

  return results;
}

// ── Yahoo Finance Fetch (wraps existing market-data.ts) ───────

/**
 * Fetch live quotes from Yahoo Finance via the existing getBatchQuotes().
 * Returns only the tickers that succeeded.
 */
async function fetchFromYahoo(
  tickers: string[]
): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  if (tickers.length === 0) return results;

  try {
    const quotes = await getBatchQuotes(tickers);
    const now = new Date();

    quotes.forEach((quote: StockQuote, ticker: string) => {
      if (quote.price > 0) {
        results.set(ticker, {
          ticker,
          close: quote.price,
          open: quote.open,
          high: quote.high,
          low: quote.low,
          volume: quote.volume,
          timestamp: now,
          source: 'YAHOO' as DataSource,
          isStale: false,
        });
      }
    });
  } catch (error) {
    console.error('[DataProvider] Yahoo Finance batch fetch failed:', (error as Error).message);
    // Return whatever we got (possibly empty)
  }

  return results;
}

// ── Main Fallback Chain ───────────────────────────────────────

/**
 * Fetch price data for multiple tickers using a resilient fallback chain.
 *
 * Flow:
 *   1. Try Yahoo Finance for all tickers
 *   2. For failed tickers: try Alpha Vantage (if API key set)
 *   3. For still-failed tickers: try EODHD (if API key set)
 *   4. For remaining failures: fall back to DB cache
 *
 * @param tickers - Array of ticker symbols (DB format, not Yahoo format)
 * @param context - Calling context for logging: 'nightly' | 'scan' | 'live'
 * @returns FetchResult with prices map, health status, and staleness info
 */
export async function fetchWithFallback(
  tickers: string[],
  context: 'nightly' | 'scan' | 'live'
): Promise<FetchResult> {
  const allPrices = new Map<string, PriceData>();
  const staleTickers: string[] = [];
  let maxStalenessHours = 0;

  if (tickers.length === 0) {
    return {
      prices: allPrices,
      health: 'LIVE',
      staleTickers: [],
      maxStalenessHours: 0,
      summary: 'No tickers requested',
    };
  }

  // ── Tier 1: Yahoo Finance ──
  console.log(`[DataProvider] [${context}] Fetching ${tickers.length} tickers from Yahoo...`);
  const yahooResults = await fetchFromYahoo(tickers);
  yahooResults.forEach((data, ticker) => {
    allPrices.set(ticker, data);
  });

  let remaining = tickers.filter((t) => !allPrices.has(t));
  if (remaining.length > 0) {
    console.warn(`[DataProvider] [${context}] Yahoo failed for ${remaining.length}/${tickers.length} tickers`);
  }

  // ── Tier 2: Alpha Vantage (optional) ──
  if (remaining.length > 0) {
    const avResults = await fetchFromAlphaVantage(remaining);
    if (avResults) {
      avResults.forEach((data, ticker) => {
        allPrices.set(ticker, data);
      });
      remaining = tickers.filter((t) => !allPrices.has(t));
    }
  }

  // ── Tier 3: EODHD (optional) ──
  if (remaining.length > 0) {
    const eodResults = await fetchFromEODHD(remaining);
    if (eodResults) {
      eodResults.forEach((data, ticker) => {
        allPrices.set(ticker, data);
      });
      remaining = tickers.filter((t) => !allPrices.has(t));
    }
  }

  // ── Tier 4: DB Cache (always available) ──
  if (remaining.length > 0) {
    console.log(`[DataProvider] [${context}] Falling back to DB cache for ${remaining.length} tickers...`);
    const cacheResults = await fetchFromCache(remaining);
    cacheResults.forEach((data, ticker) => {
      allPrices.set(ticker, data);
      staleTickers.push(ticker);
      const ageHours = (Date.now() - data.timestamp.getTime()) / (1000 * 60 * 60);
      maxStalenessHours = Math.max(maxStalenessHours, ageHours);
    });

    const stillMissing = remaining.filter((t) => !allPrices.has(t));
    if (stillMissing.length > 0) {
      console.error(`[DataProvider] [${context}] ${stillMissing.length} tickers have NO data (not in Yahoo or cache): ${stillMissing.join(', ')}`);
    }
  }

  // ── Determine health status ──
  const yahooCount = Array.from(allPrices.values()).filter((d) => d.source === 'YAHOO').length;
  const cacheCount = staleTickers.length;
  const avCount = Array.from(allPrices.values()).filter((d) => d.source === 'ALPHA_VANTAGE').length;
  const eodCount = Array.from(allPrices.values()).filter((d) => d.source === 'EODHD').length;

  let health: DataSourceHealth;
  if (cacheCount === 0) {
    health = 'LIVE';
  } else if (yahooCount > 0 || avCount > 0 || eodCount > 0) {
    health = 'PARTIAL';
  } else {
    health = 'DEGRADED';
  }

  // ── Build summary message ──
  const parts: string[] = [];
  if (yahooCount > 0) parts.push(`${yahooCount} Yahoo`);
  if (avCount > 0) parts.push(`${avCount} AlphaVantage`);
  if (eodCount > 0) parts.push(`${eodCount} EODHD`);
  if (cacheCount > 0) parts.push(`${cacheCount} cached (${maxStalenessHours.toFixed(1)}h old)`);
  const missing = tickers.length - allPrices.size;
  if (missing > 0) parts.push(`${missing} unavailable`);

  const summary = `Data sources: ${parts.join(', ')}`;
  console.log(`[DataProvider] [${context}] ${summary} — health: ${health}`);

  return {
    prices: allPrices,
    health,
    staleTickers,
    maxStalenessHours,
    summary,
  };
}

// ── Single-ticker convenience wrapper ─────────────────────────

/**
 * Fetch a single ticker's price with fallback chain.
 * Convenience wrapper around fetchWithFallback for callers that need one ticker.
 */
export async function fetchSingleWithFallback(
  ticker: string,
  context: 'nightly' | 'scan' | 'live'
): Promise<PriceData | null> {
  const result = await fetchWithFallback([ticker], context);
  return result.prices.get(ticker) ?? null;
}

// ── Extract simple price map (for backward compatibility) ─────

/**
 * Convert a FetchResult to a simple ticker → price Record.
 * Drop-in replacement for getBatchPrices() return shape.
 */
export function toPriceRecord(result: FetchResult): Record<string, number> {
  const prices: Record<string, number> = {};
  result.prices.forEach((data, ticker) => {
    prices[ticker] = data.close;
  });
  return prices;
}
