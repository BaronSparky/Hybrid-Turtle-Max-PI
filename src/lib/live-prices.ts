/**
 * DEPENDENCIES
 * Consumed by: All API routes that display live prices for open positions
 * Consumes: position-sync.ts (T212 prices), market-data.ts (Yahoo fallback)
 * Risk-sensitive: YES — prices feed position sizing, stop logic, and P&L display
 * Last modified: 2026-04-29
 * Notes: Single entry point for the T212-primary, Yahoo-fallback price pipeline.
 *        Replaces duplicated merge logic across 8+ routes.
 */

import { fetchT212LivePrices, getT212Prices } from './position-sync';
import { getBatchPrices, getQuoteFreshness, type DataSource } from './market-data';

// ── Types ──

export interface LivePriceResult {
  /** Merged prices: T212 takes priority, Yahoo fills gaps */
  prices: Record<string, number>;
  /** Which source provided each ticker's price */
  sources: Record<string, 'T212' | 'YAHOO'>;
  /** How many tickers came from each source */
  stats: {
    t212Count: number;
    yahooCount: number;
    totalRequested: number;
  };
}

export interface TickerFreshnessResult {
  source: DataSource;
  ageSeconds: number;
}

// ── Main entry point ──

/**
 * Fetch live prices for a set of tickers.
 * T212 is the primary source (real-time). Yahoo Finance fills gaps (delayed).
 *
 * @param tickers - Array of stock tickers to fetch prices for
 * @param userId - User ID for T212 credential lookup
 * @param forceRefresh - When true, bypasses Yahoo cache (T212 30s cache still applies)
 */
export async function getLivePrices(
  tickers: string[],
  userId: string = 'default-user',
  forceRefresh = false
): Promise<LivePriceResult> {
  if (tickers.length === 0) {
    return { prices: {}, sources: {}, stats: { t212Count: 0, yahooCount: 0, totalRequested: 0 } };
  }

  // 1. T212 real-time prices (30s cache, market-hours aware)
  const t212Prices = await fetchT212LivePrices(userId);

  // 2. Find tickers T212 didn't return
  const missingTickers = tickers.filter((t) => !t212Prices[t]);

  // 3. Yahoo fallback for missing tickers only
  const yahooFallback = missingTickers.length > 0
    ? await getBatchPrices(missingTickers, forceRefresh)
    : {};

  // 4. Merge: T212 wins, Yahoo fills gaps
  const prices: Record<string, number> = { ...yahooFallback, ...t212Prices };

  // 5. Build per-ticker source map
  const sources: Record<string, 'T212' | 'YAHOO'> = {};
  let t212Count = 0;
  let yahooCount = 0;
  for (const ticker of tickers) {
    if (t212Prices[ticker]) {
      sources[ticker] = 'T212';
      t212Count++;
    } else {
      sources[ticker] = 'YAHOO';
      yahooCount++;
    }
  }

  return {
    prices,
    sources,
    stats: { t212Count, yahooCount, totalRequested: tickers.length },
  };
}

/**
 * Get per-ticker freshness metadata for display.
 * Uses T212 cache age when T212 is the source, Yahoo cache age otherwise.
 */
export function getTickerFreshness(
  tickers: string[],
  sources: Record<string, 'T212' | 'YAHOO'>
): Record<string, TickerFreshnessResult> {
  const t212Entries = getT212Prices(tickers);
  const yahooFreshness = getQuoteFreshness(
    tickers.filter((t) => sources[t] === 'YAHOO')
  );

  const result: Record<string, TickerFreshnessResult> = {};
  const now = Date.now();

  for (const ticker of tickers) {
    if (sources[ticker] === 'T212') {
      const entry = t212Entries[ticker];
      if (entry) {
        const ageSeconds = Math.round((now - entry.updatedAt) / 1000);
        result[ticker] = {
          source: ageSeconds < 10 ? 'LIVE' : 'CACHE',
          ageSeconds,
        };
      }
    } else {
      const yf = yahooFreshness[ticker];
      if (yf) {
        result[ticker] = yf;
      }
    }
  }

  return result;
}
