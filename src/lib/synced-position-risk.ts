/**
 * DEPENDENCIES
 * Consumed by: src/app/api/trading212/sync/route.ts (broker-sync create branch)
 * Consumes: nothing (pure functions over plain numbers)
 * Risk-sensitive: NO — but called by a sacred-adjacent path. Keep behaviour
 *                 identical to the inline math it replaces (5%-of-entry stop
 *                 when no known stop is supplied).
 *
 * Added 2026-05-09 to make the broker-sync create-position path testable and
 * to make it possible to honour a user-set stop in the future without
 * touching the sync flow itself. Until the sync route fetches T212 pending
 * stop orders and passes them through, every call passes knownStopPrice =
 * undefined and the function returns the same 5%-of-entry default the inline
 * code has always returned.
 */

export type SyncedPositionRiskSource = 'KNOWN_STOP' | 'DEFAULT_5PCT';

export interface SyncedPositionRisk {
  /** Per-share risk (dollars). entryPrice - stopLoss. */
  initialRisk: number;
  /** Stop-loss price the new Position row should record. */
  stopLoss: number;
  /** Where stopLoss came from. KNOWN_STOP when a sane T212 stop was passed in. */
  source: SyncedPositionRiskSource;
}

const DEFAULT_STOP_FRACTION = 0.05;

/**
 * Compute the audit-trail risk fields for a freshly synced T212 position.
 *
 * Rules:
 *   1. If knownStopPrice is provided AND it's strictly between 0 and
 *      entryPrice, use it. This is the path manual buys with a user-placed
 *      T212 stop should hit once the sync route fetches pending orders.
 *   2. Otherwise default to a 5%-below-entry stop. This matches the legacy
 *      inline math in src/app/api/trading212/sync/route.ts so the change is
 *      behaviour-preserving until knownStopPrice is wired in.
 */
export function calcSyncedPositionRisk(
  entryPrice: number,
  knownStopPrice: number | null | undefined = undefined
): SyncedPositionRisk {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`calcSyncedPositionRisk: entryPrice must be positive, got ${entryPrice}`);
  }

  if (
    knownStopPrice !== null &&
    knownStopPrice !== undefined &&
    Number.isFinite(knownStopPrice) &&
    knownStopPrice > 0 &&
    knownStopPrice < entryPrice
  ) {
    return {
      initialRisk: entryPrice - knownStopPrice,
      stopLoss: knownStopPrice,
      source: 'KNOWN_STOP',
    };
  }

  const initialRisk = entryPrice * DEFAULT_STOP_FRACTION;
  return {
    initialRisk,
    stopLoss: entryPrice - initialRisk,
    source: 'DEFAULT_5PCT',
  };
}
