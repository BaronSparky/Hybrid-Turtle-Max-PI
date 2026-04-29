/**
 * DEPENDENCIES
 * Consumed by: position-sync.ts (on T212 price fetch)
 * Consumes: prisma.ts, market-data.ts
 * Risk-sensitive: NO — advisory logging only
 * Notes: Records T212 vs Yahoo price snapshots for accuracy analysis.
 *        Auto-prunes entries older than 30 days. Never throws — all
 *        errors are swallowed. Fire-and-forget by design.
 */

import prisma from './prisma';
import { getBatchPrices } from './market-data';

// Rate limit: max one snapshot batch per 5 minutes
let lastSnapshotAt = 0;
const SNAPSHOT_INTERVAL = 5 * 60_000;

// Prune: delete entries older than 30 days, max once per hour
let lastPruneAt = 0;
const PRUNE_INTERVAL = 60 * 60_000;
const PRUNE_AGE_DAYS = 30;

/**
 * Record T212 vs Yahoo price snapshots for all held tickers.
 * Call this after a successful T212 price fetch.
 * Rate-limited to once per 5 minutes. Never throws.
 */
export async function recordPriceSnapshots(
  t212Prices: Record<string, number>,
  source: string = 'T212_FETCH'
): Promise<void> {
  const now = Date.now();
  if (now - lastSnapshotAt < SNAPSHOT_INTERVAL) return;
  lastSnapshotAt = now;

  try {
    const tickers = Object.keys(t212Prices);
    if (tickers.length === 0) return;

    // Fetch Yahoo prices for comparison (uses cache, never force-refresh)
    const yahooPrices = await getBatchPrices(tickers, false);

    const snapshots = tickers.map((ticker) => {
      const t212 = t212Prices[ticker];
      const yahoo = yahooPrices[ticker] ?? null;
      const diff = yahoo && yahoo > 0
        ? Math.round(Math.abs(t212 - yahoo) / yahoo * 10000) / 100
        : null;
      return {
        ticker,
        t212Price: t212,
        yahooPrice: yahoo,
        diffPercent: diff,
        source,
      };
    });

    await prisma.priceSnapshot.createMany({ data: snapshots });

    // Auto-prune old entries (once per hour)
    if (now - lastPruneAt > PRUNE_INTERVAL) {
      lastPruneAt = now;
      const cutoff = new Date(now - PRUNE_AGE_DAYS * 86400_000);
      const deleted = await prisma.priceSnapshot.deleteMany({
        where: { capturedAt: { lt: cutoff } },
      });
      if (deleted.count > 0) {
        console.log(`[price-snapshot] Pruned ${deleted.count} entries older than ${PRUNE_AGE_DAYS} days`);
      }
    }
  } catch (error) {
    // Fire-and-forget — never block price display
    console.warn('[price-snapshot] Failed to record:', (error as Error).message);
  }
}
