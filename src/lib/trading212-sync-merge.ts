/**
 * Pure decision helpers for /api/trading212/sync.
 *
 * Extracted so the merge logic — which is the part that produced the
 * "9 vs 6" duplicate bug — can be unit-tested without mocking the whole
 * route, the dual T212 client, and Prisma.
 *
 * The route remains the only place that talks to Prisma; these helpers
 * just classify what should happen.
 */

export interface ExistingSyncPosition {
  id: string;
  t212Ticker: string | null;
  stock: { ticker: string };
}

export interface MappedSyncPosition {
  ticker: string;       // bare stock ticker, e.g. UNFI
  fullTicker: string;   // T212 ticker, e.g. UNFI_US_EQ
}

export interface SyncIndex<T extends ExistingSyncPosition> {
  byFullTicker: Map<string, T>;
  byBareTicker: Map<string, T>;
}

/**
 * Build the dual-key index used by the sync route.
 *
 * - byFullTicker — only populated for rows that already carry a t212Ticker
 * - byBareTicker — populated for every row (covers legacy auto-trade and
 *   manual rows where t212Ticker is null)
 */
export function buildSyncIndex<T extends ExistingSyncPosition>(rows: T[]): SyncIndex<T> {
  const byFullTicker = new Map<string, T>();
  const byBareTicker = new Map<string, T>();
  for (const p of rows) {
    if (p.t212Ticker) byFullTicker.set(p.t212Ticker, p);
    byBareTicker.set(p.stock.ticker, p);
  }
  return { byFullTicker, byBareTicker };
}

/**
 * Resolve the existing OPEN position (if any) that this T212 holding
 * should merge into. Full T212 ticker is the strong key; bare stock
 * ticker is the fallback for null-t212Ticker legacy rows.
 */
export function findExistingForSync<T extends ExistingSyncPosition>(
  index: SyncIndex<T>,
  pos: MappedSyncPosition,
): T | null {
  return index.byFullTicker.get(pos.fullTicker) ?? index.byBareTicker.get(pos.ticker) ?? null;
}

/**
 * Cross-account guard: should we skip creating this T212 position because
 * the same holding is already tracked under the OTHER account type?
 *
 * Returns true only when there is no matching row in the current account
 * (otherwise we'd block a legitimate update of the existing same-account row).
 */
export function shouldSkipForCrossAccountDuplicate<T extends ExistingSyncPosition>(
  index: SyncIndex<T>,
  crossAccountFullTickers: Set<string>,
  pos: MappedSyncPosition,
): boolean {
  if (!crossAccountFullTickers.has(pos.fullTicker)) return false;
  return !index.byFullTicker.has(pos.fullTicker) && !index.byBareTicker.has(pos.ticker);
}

/**
 * Whether an existing OPEN position should be considered "still held"
 * given the live set of T212 tickers returned this run.
 *
 * Matches on both full and bare ticker so legacy rows with t212Ticker=null
 * are not falsely closed when T212 still reports the holding.
 */
export function isExistingStillActive<T extends ExistingSyncPosition>(
  existing: T,
  activeFullTickers: Set<string>,
  activeBareTickers: Set<string>,
): boolean {
  if (existing.t212Ticker && activeFullTickers.has(existing.t212Ticker)) return true;
  return activeBareTickers.has(existing.stock.ticker);
}
