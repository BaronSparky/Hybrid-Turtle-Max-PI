// ============================================================
// Laggard Detector — Dead Money / Stalled Position Flagging
// ============================================================
// Ported from Python master_snapshot MODULE 3: "Laggard Purge"
//
// Criteria (ALL must be met):
//   1. Position held >= LAGGARD_HOLDING_DAYS (10 days)
//   2. Currently in loss (close < entry) by >= LAGGARD_MIN_LOSS_PCT (2%)
//   3. Not hitting stop (still OPEN, not an auto-exit)
//
// Additional "stalled" check (no movement):
//   4. R-multiple < 0.5R after 30+ days  →  dead money flag
//
// Dead Money recovery exemption:
//   If price > 20-day MA AND today's ADX > yesterday's ADX, the position
//   is showing trend recovery — suppress the DEAD_MONEY flag.
//   (MA20 + dual ADX fields are optional; when absent, exemption is skipped.)
//
// This is a SUGGESTION, not auto-sell. User decides to keep, trim, or close.
// ============================================================

/**
 * DEPENDENCIES
 * Consumed by: /api/scan/route.ts, nightly.ts, modules/laggard-purge.ts
 * Consumes: (standalone — no imports)
 * Risk-sensitive: NO — flags only, no auto-action
 * Last modified: 2026-02-24
 * Notes: MA20 + ADX fields are optional; callers must supply them for recovery exemption to activate
 */

export const LAGGARD_CONFIG = {
  enabled: true,
  holdingDays: 10,          // Min days to qualify as laggard
  minLossPct: 2.0,          // Min loss % to flag (must be 2%+ underwater)
  deadMoneyDays: 15,        // Days before dead-money flag (Part P Decision #9)
  deadMoneyMaxR: 0.2,       // R-multiple threshold (stalled if < 0.2R)
} as const;

export interface LaggardResult {
  positionId: string;
  ticker: string;
  daysHeld: number;
  rMultiple: number;
  lossPct: number;
  flag: 'TRIM_LAGGARD' | 'DEAD_MONEY';
  reason: string;
  currency: string;
}

/**
 * Detect laggard (underwater) and dead-money (stalled) positions.
 * Returns an array of flagged positions with suggested actions.
 */
export function detectLaggards(
  positions: {
    id: string;
    ticker: string;
    entryPrice: number;
    entryDate: Date;
    currentStop: number;
    shares: number;
    initialRisk: number;
    currentPrice: number;
    currency: string;
    sleeve: string;
    // Optional technical indicators for dead-money recovery exemption.
    // When all three are supplied and price > MA20 + ADX rising, the
    // DEAD_MONEY flag is suppressed (position is showing trend recovery).
    ma20?: number;
    adxToday?: number;
    adxYesterday?: number;
  }[]
): LaggardResult[] {
  if (!LAGGARD_CONFIG.enabled) return [];

  const now = new Date();
  const results: LaggardResult[] = [];

  for (const pos of positions) {
    const daysHeld = Math.floor(
      (now.getTime() - new Date(pos.entryDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    const rMultiple = pos.initialRisk > 0
      ? (pos.currentPrice - pos.entryPrice) / pos.initialRisk
      : 0;

    const lossPct = pos.entryPrice > 0
      ? ((pos.entryPrice - pos.currentPrice) / pos.entryPrice) * 100
      : 0;

    // Skip HEDGE positions — they're intentionally counter-trend
    if (pos.sleeve === 'HEDGE') continue;

    // Skip positions with no valid initial risk — R-multiple is meaningless
    if (pos.initialRisk <= 0) continue;

    // ── Check 1: Classic Laggard (underwater after holding period) ──
    if (
      daysHeld >= LAGGARD_CONFIG.holdingDays &&
      pos.currentPrice < pos.entryPrice &&
      lossPct >= LAGGARD_CONFIG.minLossPct &&
      pos.currentPrice > pos.currentStop // Not hitting stop
    ) {
      results.push({
        positionId: pos.id,
        ticker: pos.ticker,
        daysHeld,
        rMultiple,
        lossPct,
        flag: 'TRIM_LAGGARD',
        reason: `Held ${daysHeld}d, down ${lossPct.toFixed(1)}% (${rMultiple.toFixed(1)}R) — consider trimming to recycle capital`,
        currency: pos.currency,
      });
      continue; // Don't double-flag
    }

    // ── Check 2: Dead Money (stalled, going nowhere) ──
    if (
      daysHeld >= LAGGARD_CONFIG.deadMoneyDays &&
      rMultiple < LAGGARD_CONFIG.deadMoneyMaxR &&
      rMultiple > -1.0 // Not in freefall (that's a stop issue)
    ) {
      // Dead Money recovery exemption: if price is above the 20-day MA
      // AND ADX is rising (today > yesterday), the position is regaining
      // trend momentum — don't flag it as dead money. This prevents
      // prematurely flagging positions that are starting to move again.
      // All three indicator fields must be present to activate this check.
      const hasIndicators =
        pos.ma20 != null && pos.adxToday != null && pos.adxYesterday != null;
      const isRecovering =
        hasIndicators &&
        pos.currentPrice > pos.ma20! &&
        pos.adxToday! > pos.adxYesterday!;

      if (isRecovering) continue; // Trend recovery — suppress DEAD_MONEY flag

      results.push({
        positionId: pos.id,
        ticker: pos.ticker,
        daysHeld,
        rMultiple,
        lossPct: Math.max(0, lossPct),
        flag: 'DEAD_MONEY',
        reason: `Held ${daysHeld}d at ${rMultiple.toFixed(1)}R — stalled, capital may be better deployed elsewhere`,
        currency: pos.currency,
      });
    }
  }

  return results;
}
