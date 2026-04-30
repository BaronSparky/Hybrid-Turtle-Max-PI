/**
 * DEPENDENCIES
 * Consumed by: root server init (called once on startup)
 * Consumes: scan-cache.ts, modules-cache.ts, market-data.ts
 * Risk-sensitive: NO (optimisation only)
 * Last modified: 2026-03-04
 * Notes: Warms all caches from disk on server startup. Non-blocking —
 *        failures are logged and swallowed. Server starts normally
 *        regardless of warmup outcome.
 */

import { rehydrateScanCacheFromDisk } from './scan-cache';
import { rehydrateModulesCacheFromDisk } from './modules-cache';
import { rehydrateQuoteCacheFromDisk } from './market-data';
import { rehydrateT212PriceCache, fetchT212LivePrices } from './position-sync';

// Track whether warmup has been called to avoid double-runs
const globalForWarmup = globalThis as unknown as {
  __cacheWarmupDone: boolean;
};

/**
 * Warm all persisted caches from disk. Idempotent — safe to call multiple times.
 * Returns immediately if already called once this process.
 */
export async function warmCachesOnStartup(): Promise<void> {
  if (globalForWarmup.__cacheWarmupDone) return;
  globalForWarmup.__cacheWarmupDone = true;

  console.log('[cache-warmup] Warming caches from disk...');
  const t0 = Date.now();

  const results = await Promise.allSettled([
    rehydrateScanCacheFromDisk(),
    rehydrateModulesCacheFromDisk(),
    rehydrateQuoteCacheFromDisk(),
    rehydrateT212PriceCache(),
  ]);

  const labels = ['Scan', 'Modules', 'Quotes', 'T212 Prices'];
  const summary: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      summary.push(`${labels[i]}: ✓`);
    } else if (r.status === 'rejected') {
      summary.push(`${labels[i]}: ✗ (${(r.reason as Error)?.message ?? 'unknown'})`);
    } else {
      summary.push(`${labels[i]}: — (empty/expired)`);
    }
  });

  console.log(`[cache-warmup] Complete in ${Date.now() - t0}ms — ${summary.join(', ')}`);

  if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.log('[cache-warmup] T212 live pre-warm skipped during production build');
    return;
  }

  // Pre-warm T212 live prices in background (non-blocking)
  // Fires off a fresh T212 API call so the first page load gets real-time prices
  // instead of stale disk data. Failure is swallowed — disk cache still serves.
  fetchT212LivePrices().then((prices) => {
    const count = Object.keys(prices).length;
    if (count > 0) {
      console.log(`[cache-warmup] T212 live pre-warm: ${count} tickers refreshed`);
    }
  }).catch(() => {
    console.log('[cache-warmup] T212 live pre-warm skipped (credentials missing or API error)');
  });
}
