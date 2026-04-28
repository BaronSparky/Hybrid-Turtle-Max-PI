/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, /api/stops/route.ts, /api/stops/sync/route.ts, /api/stops/t212/route.ts, /api/nightly/route.ts, /api/modules/route.ts, /api/positions/hedge/route.ts
 * Consumes: prisma.ts, market-data.ts, @/types
 * Risk-sensitive: YES
 * Last modified: 2026-02-19
 * Notes: Stops NEVER decrease. Monotonic enforcement is the most important rule in the system.
 */
// ============================================================
// Stop-Loss Manager — Monotonic Enforcement + Trailing ATR
// ============================================================
// CRITICAL SAFETY RULE: Stops NEVER go down.
// if (newStop < currentStop) throw Error

import type { ProtectionLevel } from '@/types';
import { ATR_TRAILING_MULTIPLIER } from '@/types';
import { PROTECTION_LEVELS } from '@/types';
import prisma from './prisma';
import { getDailyPrices, calculateATR } from './market-data';

export class StopLossError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StopLossError';
  }
}

/**
 * Determines the appropriate protection level based on R-multiple
 */
export function getProtectionLevel(rMultiple: number): ProtectionLevel {
  if (rMultiple >= 3.0) return 'LOCK_1R_TRAIL';
  if (rMultiple >= 2.5) return 'LOCK_08R';
  if (rMultiple >= 1.5) return 'BREAKEVEN';
  return 'INITIAL';
}

/**
 * Infer protection level from where the stop IS positioned relative to entry.
 * Used when a caller doesn't supply an explicit level (e.g. trailing ATR updates).
 * Thresholds are midpoints between the actual stop formulas:
 *   INITIAL  → stop < entry + 0.25 × initialRisk  (below entry or at original stop)
 *   BREAKEVEN→ stop in [0.25R, 0.75R) above entry
 *   LOCK_08R → stop in [0.25R, 0.75R) above entry  — note: LOCK_08R actual stop = entry + 0.5R
 *   LOCK_1R_TRAIL → stop ≥ entry + 0.75 × initialRisk
 */
export function inferLevelFromStop(newStop: number, entryPrice: number, initialRisk: number): ProtectionLevel {
  if (initialRisk <= 0) return 'INITIAL';
  const stopR = (newStop - entryPrice) / initialRisk;
  if (stopR >= 0.75) return 'LOCK_1R_TRAIL';
  if (stopR >= 0.25) return 'LOCK_08R';
  if (stopR >= -0.1) return 'BREAKEVEN'; // at or very near entry
  return 'INITIAL';
}

/**
 * Check whether a broker-reported stop should be synced into the DB.
 * Rejects stale T212 stops that are above entry price on INITIAL-level positions,
 * which indicates the stop predates an entry price correction.
 */
export function shouldSyncBrokerStop(
  t212Stop: number,
  dbStop: number,
  entryPrice: number,
  protectionLevel: string
): boolean {
  if (t212Stop <= dbStop) return false; // not an upgrade — skip
  const isStaleAboveEntry = t212Stop >= entryPrice && protectionLevel === 'INITIAL';
  return !isStaleAboveEntry;
}

/**
 * Calculate the recommended stop price for a given protection level
 * For LOCK_1R_TRAIL: max(Entry + 1R, Close − 2×ATR)
 */
export function calculateProtectionStop(
  entryPrice: number,
  initialRisk: number,
  level: ProtectionLevel,
  currentPrice?: number,
  currentATR?: number
): number {
  switch (level) {
    case 'INITIAL':
      return entryPrice - initialRisk;
    case 'BREAKEVEN':
      return entryPrice; // Break even
    case 'LOCK_08R':
      return entryPrice + 0.5 * initialRisk; // Lock +0.5R above entry
    case 'LOCK_1R_TRAIL': {
      const lockFloor = entryPrice + 1.0 * initialRisk; // Lock +1R above entry
      if (currentPrice != null && currentATR != null && currentATR > 0) {
        const trailingStop = currentPrice - ATR_TRAILING_MULTIPLIER * currentATR;
        return Math.max(lockFloor, trailingStop);
      }
      return lockFloor;
    }
    default:
      return entryPrice - initialRisk;
  }
}

/**
 * Calculate recommended stop adjustment for a position
 * Returns null if no adjustment needed
 * For LOCK_1R_TRAIL: uses max(Entry + 1R, Close − 2×ATR)
 */
export function calculateStopRecommendation(
  currentPrice: number,
  entryPrice: number,
  initialRisk: number,
  currentStop: number,
  currentLevel: ProtectionLevel,
  currentATR?: number
): {
  newStop: number;
  newLevel: ProtectionLevel;
  reason: string;
} | null {
  if (initialRisk <= 0) return null;

  const rMultiple = (currentPrice - entryPrice) / initialRisk;
  const recommendedLevel = getProtectionLevel(rMultiple);

  // Only upgrade protection, never downgrade
  // TRAILING_ATR sits between BREAKEVEN and LOCK_08R in the hierarchy
  const levelOrder: ProtectionLevel[] = ['INITIAL', 'BREAKEVEN', 'TRAILING_ATR', 'LOCK_08R', 'LOCK_1R_TRAIL'];
  const currentIdx = levelOrder.indexOf(currentLevel);
  const recommendedIdx = levelOrder.indexOf(recommendedLevel);

  if (recommendedIdx <= currentIdx) return null;

  const newStopRaw = calculateProtectionStop(entryPrice, initialRisk, recommendedLevel, currentPrice, currentATR);

  // Round to 2dp to eliminate floating-point noise before comparison.
  // Without this, values like 40.820000001 pass the > check against 40.82
  // and produce no-op recommendations that display "Move To: $40.82".
  const newStop = Math.round(newStopRaw * 100) / 100;

  // MONOTONIC ENFORCEMENT: Never lower a stop. Use rounded currentStop too.
  const roundedCurrentStop = Math.round(currentStop * 100) / 100;
  if (newStop <= roundedCurrentStop) return null;

  const levelConfig = PROTECTION_LEVELS[recommendedLevel];
  const reason = `R-multiple reached ${rMultiple.toFixed(1)}R → ${levelConfig.label} (${levelConfig.stopFormula})`;

  return {
    newStop,
    newLevel: recommendedLevel,
    reason,
  };
}

/**
 * Update stop-loss for a position — ENFORCES MONOTONIC RULE
 * @throws StopLossError if newStop < currentStop
 */
export async function updateStopLoss(
  positionId: string,
  newStop: number,
  reason: string,
  level?: ProtectionLevel
): Promise<void> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
  });

  if (!position) {
    throw new StopLossError(`Position ${positionId} not found`);
  }

  if (position.status === 'CLOSED') {
    throw new StopLossError('Cannot update stop on a closed position');
  }

  // ❌ CRITICAL: MONOTONIC ENFORCEMENT
  if (newStop < position.currentStop) {
    throw new StopLossError(
      `Stop-loss can only be moved UP. Current: $${position.currentStop.toFixed(2)}, Attempted: $${newStop.toFixed(2)}`
    );
  }

  // No-op if same
  if (newStop === position.currentStop) return;

  // Infer level from stop position (not price R-multiple) if caller doesn't pass one.
  // getProtectionLevel() takes the current price R-multiple, which we don't have here —
  // using the stop value directly gives a correct label (e.g. trailing ATR stops).
  const newLevel = level ?? inferLevelFromStop(newStop, position.entryPrice, position.initialRisk);

  // Atomic: both writes must succeed or neither does
  await prisma.$transaction([
    prisma.stopHistory.create({
      data: {
        positionId,
        oldStop: position.currentStop,
        newStop,
        level: newLevel,
        reason,
      },
    }),
    prisma.position.update({
      where: { id: positionId },
      data: {
        currentStop: newStop,
        stopLoss: newStop,
        protectionLevel: newLevel,
      },
    }),
  ]);
}

/**
 * Batch update all positions' stops based on current prices
 * Returns array of recommended changes (does NOT auto-apply)
 */
export async function generateStopRecommendations(
  userId: string,
  currentPrices: Map<string, number>,
  currentATRs?: Map<string, number>
): Promise<
  {
    positionId: string;
    ticker: string;
    currentStop: number;
    newStop: number;
    newLevel: ProtectionLevel;
    reason: string;
  }[]
> {
  const positions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: { select: { ticker: true } } },
  });

  const recommendations: {
    positionId: string;
    ticker: string;
    currentStop: number;
    newStop: number;
    newLevel: ProtectionLevel;
    reason: string;
  }[] = [];

  for (const position of positions) {
    const currentPrice = currentPrices.get(position.stock.ticker);
    if (!currentPrice) continue;

    const rec = calculateStopRecommendation(
      currentPrice,
      position.entryPrice,
      position.initialRisk,
      position.currentStop,
      (position.protectionLevel as ProtectionLevel) ?? 'INITIAL',
      currentATRs?.get(position.stock.ticker)
    );

    if (rec) {
      recommendations.push({
        positionId: position.id,
        ticker: position.stock.ticker,
        currentStop: position.currentStop,
        ...rec,
      });
    }
  }

  return recommendations;
}

// ============================================================
// Trailing ATR Stop — Dynamic stop that ratchets up with price
// ============================================================
// Uses 2× ATR(14) below the highest close since entry.
// The stop only ever moves UP (monotonic enforcement).
// This matches the external Python system's trailing stop logic.
// ============================================================

/**
 * Calculate trailing ATR stop for a given ticker.
 * Returns the highest trailing stop value seen across the price history since entry.
 */
export async function calculateTrailingATRStop(
  ticker: string,
  entryPrice: number,
  entryDate: Date,
  currentStop: number,
  atrMultiplier: number = ATR_TRAILING_MULTIPLIER
): Promise<{
  trailingStop: number;
  highestClose: number;
  currentATR: number;
  shouldUpdate: boolean;
} | null> {
  // Validate atrMultiplier — must be a positive finite number
  if (!Number.isFinite(atrMultiplier) || atrMultiplier <= 0) {
    throw new StopLossError(`atrMultiplier must be a positive number, got ${atrMultiplier}`);
  }

  try {
    const bars = await getDailyPrices(ticker, 'full');
    if (bars.length < 20) return null;

    // bars are sorted newest-first; reverse for chronological processing
    const chronological = [...bars].reverse();

    // Sanity check: if the DB entry price is wildly different from recent Yahoo prices,
    // the position data is likely corrupted (e.g. currency mismatch on import).
    // Skip trailing ATR calculation to avoid producing nonsensical stop values.
    const recentClose = bars[0]?.close;
    if (recentClose && recentClose > 0) {
      const priceDivergence = Math.abs(entryPrice - recentClose) / recentClose;
      if (priceDivergence > 5) {
        // Entry price is >500% different from current market — data integrity issue
        console.warn(`[TrailingATR] ${ticker}: entry price ${entryPrice.toFixed(2)} diverges ${(priceDivergence * 100).toFixed(0)}% from Yahoo close ${recentClose.toFixed(2)} — skipping (likely data corruption)`);
        return null;
      }
    }

    // Find bars since entry date
    const entryDateStr = entryDate.toISOString().split('T')[0];
    const entryIdx = chronological.findIndex(b => b.date >= entryDateStr);
    if (entryIdx < 0) return null;

    // Need at least 14 bars before entry for ATR calc
    const startIdx = Math.max(0, entryIdx - 14);
    const relevantBars = chronological.slice(startIdx);

    let highestClose = entryPrice;
    let trailingStop = currentStop;

    // Walk forward from entry, calculating ATR and trailing stop at each bar
    for (let i = 14; i < relevantBars.length; i++) {
      const bar = relevantBars[i];
      if (bar.date < entryDateStr) continue;

      // Calculate rolling 14-period ATR
      const atrSlice = relevantBars.slice(i - 14, i + 1);
      const trs: number[] = [];
      for (let j = 1; j < atrSlice.length; j++) {
        const tr = Math.max(
          atrSlice[j].high - atrSlice[j].low,
          Math.abs(atrSlice[j].high - atrSlice[j - 1].close),
          Math.abs(atrSlice[j].low - atrSlice[j - 1].close)
        );
        trs.push(tr);
      }
      if (trs.length === 0) continue; // Not enough bars for ATR — skip this bar
      const atr = trs.reduce((s, v) => s + v, 0) / trs.length;

      // Track highest close since entry
      if (bar.close > highestClose) {
        highestClose = bar.close;
      }

      // Trailing stop = highestClose - (multiplier × ATR)
      const candidateStop = highestClose - atrMultiplier * atr;

      // Monotonic: only ratchet up
      if (candidateStop > trailingStop) {
        trailingStop = candidateStop;
      }
    }

    // Current ATR (most recent 14 bars)
    const currentATR = calculateATR(bars, 14);

    // Round BEFORE comparing to avoid recommending same-value moves.
    // Require at least 1 cent improvement to suppress floating-point noise.
    const roundedStop = Math.round(trailingStop * 100) / 100;
    const roundedCurrent = Math.round(currentStop * 100) / 100;

    // SAFEGUARD: Trailing ATR stops must not be tighter than 1×ATR from
    // the highest close. When ATR is small relative to price (high-priced stocks),
    // the formula can produce stops that are too close, triggering false stop-hit alerts.
    // If the trailing stop would be within 1×currentATR of the highest close,
    // it's too tight — skip the update.
    if (currentATR > 0 && highestClose - roundedStop < currentATR) {
      return {
        trailingStop: roundedCurrent, // keep current
        highestClose,
        currentATR,
        shouldUpdate: false,
      };
    }

    const shouldUpdate = roundedStop > roundedCurrent + 0.004;

    return {
      trailingStop: roundedStop,
      highestClose,
      currentATR,
      shouldUpdate,
    };
  } catch (error) {
    console.error(`[TrailingATR] Failed for ${ticker}:`, (error as Error).message);
    return null;
  }
}

/**
 * Generate trailing ATR stop recommendations for all open positions.
 * Compares the dynamically calculated trailing stop with the current DB stop.
 * Returns recommendations where the trailing stop is higher (tighter).
 */
export async function generateTrailingStopRecommendations(
  userId: string
): Promise<{
  positionId: string;
  ticker: string;
  currentStop: number;
  trailingStop: number;
  highestClose: number;
  currentATR: number;
  reason: string;
  priceCurrency: string;
}[]> {
  const positions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: { select: { ticker: true, currency: true } } },
  });

  const recommendations: {
    positionId: string;
    ticker: string;
    currentStop: number;
    trailingStop: number;
    highestClose: number;
    currentATR: number;
    reason: string;
    priceCurrency: string;
  }[] = [];

  for (const position of positions) {
    const result = await calculateTrailingATRStop(
      position.stock.ticker,
      position.entryPrice,
      position.entryDate,
      position.currentStop
    );

    const isUK = position.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(position.stock.ticker);
    const priceCurrency = isUK ? 'GBX' : (position.stock.currency || 'USD').toUpperCase();

    if (result && result.shouldUpdate) {
      recommendations.push({
        positionId: position.id,
        ticker: position.stock.ticker,
        currentStop: position.currentStop,
        trailingStop: result.trailingStop,
        highestClose: result.highestClose,
        currentATR: result.currentATR,
        reason: `Trailing ATR stop: High ${result.highestClose.toFixed(2)} − ${ATR_TRAILING_MULTIPLIER}×ATR(${result.currentATR.toFixed(2)}) = ${result.trailingStop.toFixed(2)}`,
        priceCurrency,
      });
    }
  }

  return recommendations;
}
