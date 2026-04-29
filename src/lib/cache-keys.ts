/**
 * DEPENDENCIES
 * Consumed by: scan-cache.ts, modules-cache.ts, market-data.ts, cache-warmup.ts
 * Consumes: (pure data — no imports)
 * Risk-sensitive: NO
 * Last modified: 2026-03-04
 * Notes: Increment the version string whenever the cached data shape changes
 *        to auto-invalidate old persisted files.
 */

import type { CachePersistenceOptions } from './cache-persistence';

export const CACHE_KEYS: Record<string, CachePersistenceOptions> = {
  /** 7-stage scan results — 1 hour TTL matches SCAN_CACHE_TTL_MS */
  SCAN_RESULTS: {
    cacheKey: 'scan-results',
    ttlMs: 60 * 60 * 1000,           // 1 hour
    version: '1.0',                   // bump when CachedScanResult shape changes
  },
  /** Module check results (all 21 modules) — 5 min TTL */
  MODULE_RESULTS: {
    cacheKey: 'module-results',
    ttlMs: 5 * 60 * 1000,            // 5 minutes
    version: '1.0',                   // bump when AllModulesResult shape changes
  },
  /** Yahoo Finance quote cache (all tickers) — 30 min TTL */
  YAHOO_QUOTES: {
    cacheKey: 'yahoo-quotes',
    ttlMs: 30 * 60 * 1000,           // 30 minutes
    version: '1.0',                   // bump when StockQuote shape changes
  },
  /** T212 broker price cache (held positions) — 10 min TTL on disk */
  T212_PRICES: {
    cacheKey: 't212-prices',
    ttlMs: 10 * 60 * 1000,           // 10 minutes (disk cache is longer than 30s memory TTL)
    version: '1.0',
  },
} as const;
