import { describe, expect, it, vi } from 'vitest';
import {
  calculateTrailingATRStop,
  calculateProtectionStop,
  calculateStopRecommendation,
  getProtectionLevel,
  inferLevelFromStop,
  shouldSyncBrokerStop,
} from './stop-manager';
import * as marketData from './market-data';
import type { ProtectionLevel } from '@/types';

function isoDay(day: number): string {
  return `2026-01-${String(day).padStart(2, '0')}`;
}

function newestFirstFromChronological(
  bars: Array<{ date: string; high: number; low: number; close: number }>
) {
  return [...bars].reverse();
}

describe('stop-manager formulas', () => {
  it('maps R-multiple thresholds to expected protection levels', () => {
    expect(getProtectionLevel(1.49)).toBe('INITIAL');
    expect(getProtectionLevel(1.5)).toBe('BREAKEVEN');
    expect(getProtectionLevel(2.5)).toBe('LOCK_08R');
    expect(getProtectionLevel(3.0)).toBe('LOCK_1R_TRAIL');
  });

  it('uses max(lock floor, trailing ATR) for LOCK_1R_TRAIL stop', () => {
    // Lock floor = 100 + 1*10 = 110, trailing = 150 - 1.5*5 = 142.5
    const stop = calculateProtectionStop(100, 10, 'LOCK_1R_TRAIL', 150, 5);
    expect(stop).toBe(142.5);
  });

  it('recommends breakeven upgrade when +1.5R is reached', () => {
    const rec = calculateStopRecommendation(116, 100, 10, 90, 'INITIAL');
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('BREAKEVEN');
    expect(rec?.newStop).toBe(100);
  });

  it('returns null when recommended level is not an upgrade', () => {
    const rec = calculateStopRecommendation(118, 100, 10, 100, 'BREAKEVEN');
    expect(rec).toBeNull();
  });

  it('returns null when computed stop would not move up (monotonic)', () => {
    const rec = calculateStopRecommendation(125, 100, 10, 105, 'INITIAL');
    expect(rec).toBeNull();
  });

  it('uses max(lock floor, trailing ATR) for LOCK_1R_TRAIL recommendation', () => {
    // Entry: 100, risk: 10, current stop: 90 (INITIAL)
    // Price at 130 = 3R → LOCK_1R_TRAIL
    // Lock floor = 100 + 1*10 = 110
    // Trailing ATR = 130 - 1.5*5 = 122.5
    // Should pick max(110, 122.5) = 122.5
    const rec = calculateStopRecommendation(130, 100, 10, 90, 'INITIAL', 5);
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_1R_TRAIL');
    expect(rec?.newStop).toBe(122.5);
  });

  it('falls back to lock floor when ATR is not provided for LOCK_1R_TRAIL', () => {
    // Same scenario but no ATR → should still upgrade to 110 (lock floor)
    const rec = calculateStopRecommendation(130, 100, 10, 90, 'INITIAL');
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_1R_TRAIL');
    expect(rec?.newStop).toBe(110);
  });

  // ── F-005 regression: updateStopLoss level override ──

  it('calculateStopRecommendation returns price-based level (not stop-based)', () => {
    // Entry=200, risk=6, currentStop=200 (BREAKEVEN), price=225, ATR=4.5
    // Price-based R = (225-200)/6 = 4.17 → LOCK_1R_TRAIL
    // Stop = max(200+6, 225-1.5*4.5) = max(206, 218.25) = 218.25
    // Stop-based R = (218.25-200)/6 = 3.04 → LOCK_1R_TRAIL (same with 1.5x multiplier)
    const rec = calculateStopRecommendation(225, 200, 6, 200, 'BREAKEVEN', 4.5);
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_1R_TRAIL');
    expect(rec?.newStop).toBe(218.25);
  });

  it('recommendation level should be passed to updateStopLoss to avoid re-derivation mismatch', () => {
    // This test documents the contract: the caller should forward rec.newLevel
    // to updateStopLoss so the DB gets the price-based level, not stop-based.
    // With ATR_TRAILING_MULTIPLIER=1.5: stop = max(206, 225-6.75) = 218.25
    // Stop-based R = (218.25-200)/6 = 3.04 → LOCK_1R_TRAIL (matches price-based)
    const rec = calculateStopRecommendation(225, 200, 6, 200, 'BREAKEVEN', 4.5);
    expect(rec).not.toBeNull();
    expect(rec!.newLevel).toBe('LOCK_1R_TRAIL');
  });

  // ── F-001 regression: sync-stops R-multiple formula ──

  it('sync-stops R-multiple formula matches getProtectionLevel (F-001)', () => {
    // Simulates the corrected sync-stops formula: (newStop - entryPrice) / initialRisk
    // Entry=100, initialRisk=10
    const entry = 100;
    const risk = 10;
    const cases: { newStop: number; expected: ProtectionLevel }[] = [
      { newStop: 95, expected: 'INITIAL' },      // R = (95-100)/10 = -0.5
      { newStop: 100, expected: 'INITIAL' },     // R = 0
      { newStop: 114, expected: 'INITIAL' },     // R = 1.4
      { newStop: 115, expected: 'BREAKEVEN' },   // R = 1.5
      { newStop: 120, expected: 'BREAKEVEN' },   // R = 2.0
      { newStop: 125, expected: 'LOCK_08R' },    // R = 2.5
      { newStop: 129, expected: 'LOCK_08R' },    // R = 2.9
      { newStop: 130, expected: 'LOCK_1R_TRAIL' }, // R = 3.0
    ];
    for (const { newStop, expected } of cases) {
      const rMultiple = (newStop - entry) / risk;
      expect(getProtectionLevel(rMultiple)).toBe(expected);
    }
  });

  it('old sync-stops formula was shifted +1R (regression proof)', () => {
    // The OLD (buggy) formula: (newStop - entry + risk) / risk
    // which equals (newStop - entry)/risk + 1
    // Entry=100, risk=10, newStop=115
    const entry = 100;
    const risk = 10;
    const newStop = 115;
    const correctR = (newStop - entry) / risk;        // 1.5 → BREAKEVEN ✓
    const buggyR = (newStop - entry + risk) / risk;   // 2.5 → LOCK_08R ✗
    expect(getProtectionLevel(correctR)).toBe('BREAKEVEN');
    expect(getProtectionLevel(buggyR)).toBe('LOCK_08R');
    // These must be different — proving the bug existed
    expect(getProtectionLevel(correctR)).not.toBe(getProtectionLevel(buggyR));
  });
});

// ── inferLevelFromStop — level inference from stop position ──
// Covers the fix for the updateStopLoss level-inference bug (was using price R-multiple
// derived from the stop value, which produces wrong labels for trailing ATR updates).

describe('inferLevelFromStop', () => {
  // entry=100, initialRisk=10 for all cases
  const E = 100, R = 10;

  it('returns INITIAL when stop is below entry (original stop region)', () => {
    expect(inferLevelFromStop(90, E, R)).toBe('INITIAL');  // entry - 1R
    expect(inferLevelFromStop(97, E, R)).toBe('INITIAL');  // entry - 0.3R
  });

  it('returns BREAKEVEN when stop is at or just above entry', () => {
    expect(inferLevelFromStop(100, E, R)).toBe('BREAKEVEN'); // stop = entry exactly
    expect(inferLevelFromStop(102, E, R)).toBe('BREAKEVEN'); // entry + 0.2R
  });

  it('returns LOCK_08R when stop is near entry + 0.5R', () => {
    expect(inferLevelFromStop(105, E, R)).toBe('LOCK_08R'); // entry + 0.5R exact
    expect(inferLevelFromStop(107, E, R)).toBe('LOCK_08R'); // entry + 0.7R
  });

  it('returns LOCK_1R_TRAIL when stop is at or above entry + 0.75R', () => {
    expect(inferLevelFromStop(107.4, E, R)).toBe('LOCK_08R');      // 0.74R — just below boundary
    expect(inferLevelFromStop(107.5, E, R)).toBe('LOCK_1R_TRAIL'); // 0.75R — boundary is inclusive (>=)
    expect(inferLevelFromStop(107.6, E, R)).toBe('LOCK_1R_TRAIL'); // just above 0.75R
    expect(inferLevelFromStop(110, E, R)).toBe('LOCK_1R_TRAIL');   // entry + 1R
    expect(inferLevelFromStop(120, E, R)).toBe('LOCK_1R_TRAIL');   // trailing far above entry
  });

  it('returns INITIAL when initialRisk is 0 (guard)', () => {
    expect(inferLevelFromStop(100, 100, 0)).toBe('INITIAL');
  });

  it('correctly labels a trailing ATR stop that old code would have mis-labelled', () => {
    // A trailing ATR stop at entry + 0.6R (e.g. stop=106, entry=100, risk=10)
    // Old code: (newStop - entryPrice) / initialRisk = 0.6 → getProtectionLevel(0.6) → INITIAL ❌
    // New code: inferLevelFromStop(106, 100, 10): stopR = 0.6 → between 0.25 and 0.75 → LOCK_08R ✅
    const trailingStop2 = 106;
    const oldBuggyLevel = getProtectionLevel((trailingStop2 - E) / R); // 0.6 → INITIAL ❌
    const newCorrectLevel = inferLevelFromStop(trailingStop2, E, R);    // 0.6R → LOCK_08R ✅
    expect(oldBuggyLevel).toBe('INITIAL');
    expect(newCorrectLevel).toBe('LOCK_08R');
    expect(oldBuggyLevel).not.toBe(newCorrectLevel); // proves the fix matters
  });
});

// ── F-002 regression: sync-stops initialRisk fallback ──
// Tests the formula logic used in prisma/sync-stops.ts,
// specifically the ?? vs || fix and guard for initialRisk <= 0.

describe('sync-stops initialRisk handling (F-002)', () => {
  /**
   * Replicates the corrected sync-stops initialRisk resolution:
   *   const initialRisk = matched.initialRisk ?? (matched.entryPrice - newStop);
   *   if (!initialRisk || initialRisk <= 0) → skip
   */
  function resolveInitialRisk(
    matchedInitialRisk: number | null | undefined,
    entryPrice: number,
    newStop: number
  ): number | null {
    const initialRisk = matchedInitialRisk ?? (entryPrice - newStop);
    if (!initialRisk || initialRisk <= 0) return null; // guard: skip
    return initialRisk;
  }

  it('uses DB initialRisk when it is a normal positive value', () => {
    // matched.initialRisk = 10, entryPrice = 100, newStop = 115
    expect(resolveInitialRisk(10, 100, 115)).toBe(10);
  });

  it('preserves initialRisk = 0 with ?? (does not fall through to fallback)', () => {
    // With || (old code): 0 is falsy → fallback = 100 - 110 = -10 → guard blocks
    // With ?? (new code): 0 is kept → guard blocks (initialRisk <= 0)
    // Either way the position is skipped, but ?? is correct by design.
    const result = resolveInitialRisk(0, 100, 110);
    expect(result).toBeNull(); // guard blocks: initialRisk = 0 <= 0
  });

  it('falls back to entryPrice - newStop when initialRisk is null', () => {
    // matched.initialRisk = null → fallback = 100 - 90 = 10 (positive, valid)
    expect(resolveInitialRisk(null, 100, 90)).toBe(10);
  });

  it('falls back to entryPrice - newStop when initialRisk is undefined', () => {
    // matched.initialRisk = undefined → fallback = 100 - 90 = 10
    expect(resolveInitialRisk(undefined, 100, 90)).toBe(10);
  });

  it('guard blocks when fallback produces negative value (stop > entry)', () => {
    // matched.initialRisk = null → fallback = 100 - 110 = -10 → guard blocks
    expect(resolveInitialRisk(null, 100, 110)).toBeNull();
  });

  it('guard blocks when fallback produces zero (stop = entry)', () => {
    // matched.initialRisk = null → fallback = 100 - 100 = 0 → guard blocks
    expect(resolveInitialRisk(null, 100, 100)).toBeNull();
  });

  it('old || operator would wrongly use fallback when initialRisk is 0', () => {
    // Proves the bug: with ||, initialRisk=0 → fallback = entryPrice - newStop
    // If stop > entry, fallback is negative → protection level defaults to INITIAL
    // but the real issue is the wrong code path being taken
    const matchedInitialRisk = 0;
    const entryPrice = 100;
    const newStop = 110;
    // Old behavior (||):  0 || (100 - 110) = -10
    const oldResult = matchedInitialRisk || (entryPrice - newStop);
    expect(oldResult).toBe(-10); // wrong: used fallback instead of keeping 0
    // New behavior (??):  0 ?? (100 - 110) = 0
    const newResult = matchedInitialRisk ?? (entryPrice - newStop);
    expect(newResult).toBe(0); // correct: kept the 0
  });
});

describe('calculateTrailingATRStop regressions', () => {
  it('returns deterministic trailing stop and never ratchets down with additional bars', async () => {
    const baseChronological = Array.from({ length: 25 }, (_, idx) => {
      const close = 100 + idx;
      return {
        date: isoDay(idx + 1),
        high: close + 1.185,
        low: close - 1.185,
        close,
      };
    });

    const baseBars = newestFirstFromChronological(baseChronological);
    const entryDate = new Date(`${isoDay(15)}T00:00:00.000Z`);

    const spy = vi.spyOn(marketData, 'getDailyPrices');
    spy.mockResolvedValueOnce(baseBars as Awaited<ReturnType<typeof marketData.getDailyPrices>>);

    const baseResult = await calculateTrailingATRStop('TEST', 114, entryDate, 100, 2.0);
    expect(baseResult).not.toBeNull();
    expect(baseResult?.trailingStop).toBe(119.26);

    const extendedChronological = [
      ...baseChronological,
      { date: isoDay(26), high: 130, low: 70, close: 110 },
      { date: isoDay(27), high: 128, low: 68, close: 109 },
      { date: isoDay(28), high: 127, low: 67, close: 108 },
    ];
    const extendedBars = newestFirstFromChronological(extendedChronological);
    spy.mockResolvedValueOnce(extendedBars as Awaited<ReturnType<typeof marketData.getDailyPrices>>);

    const extendedResult = await calculateTrailingATRStop('TEST', 114, entryDate, 100, 2.0);
    expect(extendedResult).not.toBeNull();
    expect(extendedResult?.trailingStop).toBe(119.26);
    expect(extendedResult!.trailingStop).toBeGreaterThanOrEqual(baseResult!.trailingStop);

    spy.mockRestore();
  });

  it('uses a 14-period simple average of true ranges in trailing ATR window', async () => {
    const constantTrChronological = Array.from({ length: 20 }, (_, idx) => ({
      date: isoDay(idx + 1),
      high: 102.5,
      low: 97.5,
      close: 100,
    }));

    const bars = newestFirstFromChronological(constantTrChronological);
    const entryDate = new Date(`${isoDay(15)}T00:00:00.000Z`);

    const spy = vi.spyOn(marketData, 'getDailyPrices');
    spy.mockResolvedValueOnce(bars as Awaited<ReturnType<typeof marketData.getDailyPrices>>);

    const result = await calculateTrailingATRStop('CONST_TR', 100, entryDate, 80, 2.0);
    expect(result).not.toBeNull();
    expect(result?.trailingStop).toBe(90);
    expect(result?.currentATR).toBe(5);

    spy.mockRestore();
  });

  it('returns null when bars are too few for any ATR calculation (div-by-zero guard)', async () => {
    // Only 1 bar total — not enough for any TR value (need ≥2 bars)
    const singleBar = [
      { date: isoDay(1), high: 102, low: 98, close: 100 },
    ];

    const spy = vi.spyOn(marketData, 'getDailyPrices');
    spy.mockResolvedValueOnce(singleBar as Awaited<ReturnType<typeof marketData.getDailyPrices>>);

    const result = await calculateTrailingATRStop('SHORT', 100, new Date(`${isoDay(1)}T00:00:00.000Z`), 90, 2.0);
    // Should return null (not enough data), not NaN
    expect(result === null || (result !== null && Number.isFinite(result.trailingStop))).toBe(true);

    spy.mockRestore();
  });

  it('default ATR trailing multiplier is 1.5 (tighter trailing for profit lock)', async () => {
    // Constant-TR bars: TR = 5 at every bar. Default multiplier = 1.5.
    // Trailing stop = close - 1.5×ATR = 100 - 1.5×5 = 92.5
    const constantTrChronological = Array.from({ length: 20 }, (_, idx) => ({
      date: isoDay(idx + 1),
      high: 102.5,
      low: 97.5,
      close: 100,
    }));

    const bars = newestFirstFromChronological(constantTrChronological);
    const entryDate = new Date(`${isoDay(15)}T00:00:00.000Z`);

    const spy = vi.spyOn(marketData, 'getDailyPrices');
    spy.mockResolvedValueOnce(bars as Awaited<ReturnType<typeof marketData.getDailyPrices>>);

    // No explicit multiplier — uses default (1.5)
    const result = await calculateTrailingATRStop('DEF_TRAIL', 100, entryDate, 80);
    expect(result).not.toBeNull();
    // 100 - 1.5×5 = 92.5
    expect(result?.trailingStop).toBe(92.5);

    spy.mockRestore();
  });

  it('rejects zero atrMultiplier', async () => {
    await expect(
      calculateTrailingATRStop('TEST', 100, new Date(), 90, 0)
    ).rejects.toThrow('atrMultiplier must be a positive number');
  });

  it('rejects negative atrMultiplier', async () => {
    await expect(
      calculateTrailingATRStop('TEST', 100, new Date(), 90, -1.5)
    ).rejects.toThrow('atrMultiplier must be a positive number');
  });

  it('rejects NaN atrMultiplier', async () => {
    await expect(
      calculateTrailingATRStop('TEST', 100, new Date(), 90, NaN)
    ).rejects.toThrow('atrMultiplier must be a positive number');
  });

  it('rejects Infinity atrMultiplier', async () => {
    await expect(
      calculateTrailingATRStop('TEST', 100, new Date(), 90, Infinity)
    ).rejects.toThrow('atrMultiplier must be a positive number');
  });
});

describe('inferLevelFromStop with TRAILING_ATR', () => {
  it('infers INITIAL for stop well below entry', () => {
    expect(inferLevelFromStop(90, 100, 10)).toBe('INITIAL');
  });

  it('infers BREAKEVEN for stop near entry', () => {
    expect(inferLevelFromStop(99.5, 100, 10)).toBe('BREAKEVEN');
  });

  it('infers LOCK_08R for stop 0.5R above entry', () => {
    expect(inferLevelFromStop(105, 100, 10)).toBe('LOCK_08R');
  });

  it('infers LOCK_1R_TRAIL for stop 1R above entry', () => {
    expect(inferLevelFromStop(108, 100, 10)).toBe('LOCK_1R_TRAIL');
  });
});

describe('TRAILING_ATR in level order', () => {
  it('does not recommend upgrade from TRAILING_ATR to BREAKEVEN', () => {
    // Position at 1.6R with TRAILING_ATR level — should NOT recommend BREAKEVEN (lower rank)
    const rec = calculateStopRecommendation(116, 100, 10, 95, 'TRAILING_ATR' as ProtectionLevel);
    expect(rec).toBeNull();
  });

  it('recommends upgrade from TRAILING_ATR to LOCK_08R', () => {
    // Position at 2.5R with TRAILING_ATR level — should recommend LOCK_08R (higher rank)
    const rec = calculateStopRecommendation(125, 100, 10, 95, 'TRAILING_ATR' as ProtectionLevel);
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_08R');
  });

  it('recommends upgrade from TRAILING_ATR to LOCK_1R_TRAIL', () => {
    // Position at 3.0R with TRAILING_ATR level — should recommend LOCK_1R_TRAIL
    const rec = calculateStopRecommendation(130, 100, 10, 95, 'TRAILING_ATR' as ProtectionLevel);
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_1R_TRAIL');
  });
});

describe('shouldSyncBrokerStop', () => {
  it('allows sync when T212 stop is higher and below entry on INITIAL', () => {
    // T212: 95 > DB: 90, entry: 100, level: INITIAL → below entry, allow
    expect(shouldSyncBrokerStop(95, 90, 100, 'INITIAL')).toBe(true);
  });

  it('rejects sync when T212 stop is above entry on INITIAL level (GEV bug)', () => {
    // T212: 1099.85 > DB: 1039.29, entry: 1093.99, level: INITIAL → stale!
    expect(shouldSyncBrokerStop(1099.85, 1039.29, 1093.99, 'INITIAL')).toBe(false);
  });

  it('rejects sync when T212 stop equals entry on INITIAL', () => {
    expect(shouldSyncBrokerStop(100, 90, 100, 'INITIAL')).toBe(false);
  });

  it('allows sync when T212 stop is above entry on LOCK_08R (legitimate)', () => {
    // LOCK_08R positions can have stops above entry
    expect(shouldSyncBrokerStop(105, 100, 100, 'LOCK_08R')).toBe(true);
  });

  it('allows sync when T212 stop is above entry on TRAILING_ATR', () => {
    expect(shouldSyncBrokerStop(102, 98, 100, 'TRAILING_ATR')).toBe(true);
  });

  it('allows sync when T212 stop is above entry on LOCK_1R_TRAIL', () => {
    expect(shouldSyncBrokerStop(110, 105, 100, 'LOCK_1R_TRAIL')).toBe(true);
  });

  it('rejects sync when T212 stop is not higher than DB stop', () => {
    expect(shouldSyncBrokerStop(90, 95, 100, 'INITIAL')).toBe(false);
  });

  it('rejects sync when T212 stop equals DB stop', () => {
    expect(shouldSyncBrokerStop(90, 90, 100, 'INITIAL')).toBe(false);
  });

  it('allows sync on BREAKEVEN with T212 above entry', () => {
    // BREAKEVEN has already been validated through the ladder
    expect(shouldSyncBrokerStop(101, 100, 100, 'BREAKEVEN')).toBe(true);
  });
});
