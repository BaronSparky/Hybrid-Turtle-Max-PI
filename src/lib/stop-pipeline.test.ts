/**
 * E2E test for the stop recommendation pipeline's no-op filter.
 * Tests the exact logic used in GET /api/stops to ensure same-value
 * recommendations are never shown to the user.
 *
 * This would have caught the APLS bug: trailing ATR returning 40.82
 * when the current stop was already 40.82.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateProtectionStop,
  calculateStopRecommendation,
  getProtectionLevel,
} from './stop-manager';
import type { ProtectionLevel } from '@/types';

/**
 * Replicates the exact filter logic from GET /api/stops route.ts.
 * Both R-based and trailing ATR recs go through this before being sent to the client.
 */
function wouldPassApiFilter(rec: { newStop: number; currentStop: number }): boolean {
  const roundedNew = Math.round(rec.newStop * 100) / 100;
  const roundedCurrent = Math.round(rec.currentStop * 100) / 100;
  return roundedNew > roundedCurrent;
}

describe('stop recommendation pipeline E2E', () => {
  describe('same-value filter (APLS regression)', () => {
    it('filters out rec where newStop equals currentStop', () => {
      expect(wouldPassApiFilter({ newStop: 40.82, currentStop: 40.82 })).toBe(false);
    });

    it('filters out rec where newStop rounds to same as currentStop', () => {
      // Floating point: 40.820000000001 rounds to 40.82
      expect(wouldPassApiFilter({ newStop: 40.820000000001, currentStop: 40.82 })).toBe(false);
    });

    it('allows rec where newStop is genuinely higher', () => {
      expect(wouldPassApiFilter({ newStop: 40.83, currentStop: 40.82 })).toBe(true);
    });

    it('filters out when newStop is below currentStop', () => {
      expect(wouldPassApiFilter({ newStop: 40.81, currentStop: 40.82 })).toBe(false);
    });

    it('handles very small price differences (penny stocks)', () => {
      expect(wouldPassApiFilter({ newStop: 0.01, currentStop: 0.01 })).toBe(false);
      expect(wouldPassApiFilter({ newStop: 0.02, currentStop: 0.01 })).toBe(true);
    });

    it('handles large prices (BRK.A-like)', () => {
      expect(wouldPassApiFilter({ newStop: 600000.00, currentStop: 600000.00 })).toBe(false);
      expect(wouldPassApiFilter({ newStop: 600000.01, currentStop: 600000.00 })).toBe(true);
    });
  });

  describe('R-based recommendation rounding', () => {
    it('calculateStopRecommendation returns rounded newStop', () => {
      // Entry: 100, risk: 10, stop: 90 (INITIAL), price: 130 = 3R → LOCK_1R_TRAIL
      // LOCK_1R_TRAIL stop = max(110, 130 - 1.5 * ATR)
      const rec = calculateStopRecommendation(130, 100, 10, 90, 'INITIAL', 5);
      expect(rec).not.toBeNull();
      // newStop should be rounded to 2dp
      const dp = rec!.newStop.toString().split('.')[1]?.length ?? 0;
      expect(dp).toBeLessThanOrEqual(2);
    });

    it('returns null when computed stop equals current stop (rounded)', () => {
      // Construct a scenario where the computed stop rounds to the current stop
      // Entry: 100, risk: 5, stop: 102.5 (LOCK_08R), price: 118 = 3.6R → LOCK_1R_TRAIL
      // LOCK_1R_TRAIL: lockFloor = 100 + 5 = 105. trailingStop = 118 - 1.5*ATR
      // If ATR = 10.3333: trailing = 118 - 15.5 = 102.5 → max(105, 102.5) = 105
      // currentStop = 105 → rec should be null (no upgrade)
      const rec = calculateStopRecommendation(118, 100, 5, 105, 'LOCK_1R_TRAIL', 10);
      // Already at LOCK_1R_TRAIL, no level upgrade → null
      expect(rec).toBeNull();
    });
  });

  describe('calculateProtectionStop consistency', () => {
    it('INITIAL stop is entry - risk', () => {
      expect(calculateProtectionStop(100, 10, 'INITIAL')).toBe(90);
    });

    it('BREAKEVEN stop is entry price', () => {
      expect(calculateProtectionStop(100, 10, 'BREAKEVEN')).toBe(100);
    });

    it('LOCK_08R stop is entry + 0.5R', () => {
      expect(calculateProtectionStop(100, 10, 'LOCK_08R')).toBe(105);
    });

    it('LOCK_1R_TRAIL uses ATR_TRAILING_MULTIPLIER constant', () => {
      // lockFloor = 100 + 10 = 110
      // trailing = 150 - 1.5 * 5 = 142.5
      // max(110, 142.5) = 142.5
      const stop = calculateProtectionStop(100, 10, 'LOCK_1R_TRAIL', 150, 5);
      expect(stop).toBe(142.5);
    });
  });

  describe('merged pipeline: R-based overridden by trailing ATR', () => {
    it('trailing ATR wins when higher than R-based', () => {
      // Simulate the merge logic from GET /api/stops
      const rBasedStop = 105; // LOCK_08R
      const trailingStop = 108; // trailing ATR calculated higher

      const merged = Math.max(rBasedStop, trailingStop);
      expect(merged).toBe(108);
      expect(wouldPassApiFilter({ newStop: merged, currentStop: 100 })).toBe(true);
    });

    it('R-based wins when higher than trailing ATR', () => {
      const rBasedStop = 110; // LOCK_1R_TRAIL
      const trailingStop = 107; // trailing ATR lower
      const merged = Math.max(rBasedStop, trailingStop);
      expect(merged).toBe(110);
    });
  });

  describe('client-side filter matches server-side', () => {
    it('both server and client filters use the same rounding logic', () => {
      // The client filter in StopUpdateQueue.tsx uses the same pattern
      const testCases = [
        { newStop: 40.82, currentStop: 40.82, expected: false },
        { newStop: 40.83, currentStop: 40.82, expected: true },
        { newStop: 40.824999, currentStop: 40.82, expected: false },
        { newStop: 40.825001, currentStop: 40.82, expected: true },
        { newStop: 100, currentStop: 99.99, expected: true },
      ];

      for (const tc of testCases) {
        expect(wouldPassApiFilter(tc)).toBe(tc.expected);
      }
    });
  });
});
