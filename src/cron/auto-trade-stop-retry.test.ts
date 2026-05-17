/**
 * Tests for the H4 stop-loss retry-widen helpers introduced in
 * src/cron/auto-trade.ts per audit 2026-05-16 (H4).
 *
 * These are pure helper functions; the retry loop itself stays inline
 * in executeTrade (sacred minimal-diff). The constants and widenStop()
 * are exported so the contract can be locked down here.
 */
import { describe, it, expect } from 'vitest';
import {
  widenStop,
  effectiveStopForFill,
  realisedGateFootprint,
  STOP_RETRY_WIDEN_FACTORS,
  STOP_TERMINAL_STATUS_CODES,
  STOP_RETRY_DELAY_MS,
} from './auto-trade';

describe('auto-trade: stop-loss retry-widen helpers', () => {
  it('first factor is identity (1.0) — first attempt uses the original stop', () => {
    expect(STOP_RETRY_WIDEN_FACTORS[0]).toBe(1.0);
  });

  it('factors are monotonically increasing', () => {
    for (let i = 1; i < STOP_RETRY_WIDEN_FACTORS.length; i++) {
      expect(STOP_RETRY_WIDEN_FACTORS[i]).toBeGreaterThan(STOP_RETRY_WIDEN_FACTORS[i - 1]);
    }
  });

  it('exactly three attempts (original + two retries)', () => {
    expect(STOP_RETRY_WIDEN_FACTORS.length).toBe(3);
  });

  it('retry delay is non-zero (avoids tight retry storm)', () => {
    expect(STOP_RETRY_DELAY_MS).toBeGreaterThan(0);
  });

  it('terminal status codes include 401 and 403 only', () => {
    expect(STOP_TERMINAL_STATUS_CODES).toEqual([401, 403]);
  });

  describe('widenStop()', () => {
    it('factor 1.0 returns the original stop', () => {
      expect(widenStop(100, 95, 1.0)).toBeCloseTo(95, 6);
    });

    it('factor > 1 widens the stop AWAY from entry (further below for long)', () => {
      const original = widenStop(100, 95, 1.0);
      const wider = widenStop(100, 95, 1.5);
      expect(wider).toBeLessThan(original);
    });

    it('1.33× of a 5-point gap widens to 6.65 below entry', () => {
      expect(widenStop(100, 95, 1.33)).toBeCloseTo(93.35, 6);
    });

    it('1.67× of a 5-point gap widens to 8.35 below entry', () => {
      expect(widenStop(100, 95, 1.67)).toBeCloseTo(91.65, 6);
    });

    it('floors at 0.01 to avoid negative or zero stops on extreme inputs', () => {
      // Gap larger than the price itself with a wide factor would go negative
      expect(widenStop(10, 1, 100)).toBe(0.01);
    });

    it('handles fractional prices without precision loss in the contract', () => {
      // 5.5 - (5.5 - 5.0) * 1.33 = 5.5 - 0.665 = 4.835
      expect(widenStop(5.5, 5.0, 1.33)).toBeCloseTo(4.835, 6);
    });

    it('does not move when there is no gap (entry == stop)', () => {
      expect(widenStop(50, 50, 1.5)).toBeCloseTo(50, 6);
    });
  });

  // ── H-3 regression (2026-05-17) ────────────────────────────
  // effectiveStopForFill keeps realised per-share risk equal to planned risk
  // when the order fills above planned entry. Prior to this fix, a gap-up
  // fill of e.g. 8% above plan inflated realised risk by the gap amount.
  describe('effectiveStopForFill() (H-3)', () => {
    it('returns the planned stop unchanged when fill == planned entry', () => {
      expect(effectiveStopForFill(100, 100, 95)).toBe(95);
    });

    it('returns the planned stop unchanged when fill is BELOW planned entry', () => {
      // Gap-down fill — realised risk is smaller than planned, leave stop alone
      expect(effectiveStopForFill(100, 98, 95)).toBe(95);
    });

    it('raises the stop by the gap when fill is ABOVE planned entry', () => {
      // Entry $100, stop $95 (planned risk $5). Fill at $108. Stop must rise
      // to $103 so realised risk = $108 - $103 = $5 = planned risk per share.
      expect(effectiveStopForFill(100, 108, 95)).toBe(103);
    });

    it('preserves planned per-share risk exactly for any gap-up amount', () => {
      const entry = 100, stop = 95, gap = 12.34;
      const fill = entry + gap;
      const eff = effectiveStopForFill(entry, fill, stop);
      const realisedRisk = fill - eff;
      const plannedRisk = entry - stop;
      expect(realisedRisk).toBeCloseTo(plannedRisk, 6);
    });

    it('returns plannedStop unchanged when plannedRiskPerShare ≤ 0 (degenerate)', () => {
      // Stop above entry (data error or short) — leave unchanged, let caller decide
      expect(effectiveStopForFill(100, 108, 105)).toBe(105);
      expect(effectiveStopForFill(100, 108, 100)).toBe(100);
    });

    it('worst-case realised risk after 3 widen retries is ≤ 1.67× planned (H-3 + H4)', () => {
      // Without H-3, widen factor 1.67 on a gap-up fill produced ~2.6× risk.
      // With H-3, the widen base is effectiveStop, so worst-case is bounded
      // by the factor itself relative to planned risk.
      const entry = 100, stop = 95, fill = 108;
      const plannedRisk = entry - stop; // $5
      const eff = effectiveStopForFill(entry, fill, stop); // $103
      const finalStop = widenStop(fill, eff, 1.67); // = 108 - (108-103)*1.67 = 108 - 8.35 = 99.65
      const realisedRisk = fill - finalStop;
      expect(realisedRisk).toBeCloseTo(plannedRisk * 1.67, 4);
      expect(realisedRisk).toBeLessThan(plannedRisk * 2); // strictly under 2× planned
    });
  });

  // ── M-3: realisedGateFootprint() — concentration uses realised fill, not plan ──
  describe('realisedGateFootprint() (M-3)', () => {
    const planned = { entryTrigger: 100, stopPrice: 95, shares: 100 };

    it('uses filledPrice (not entryTrigger) for value — gap-up fill consumes MORE headroom', () => {
      const result = { filledPrice: 110, shares: 100, stopPrice: 95 };
      const realised = realisedGateFootprint(result, planned, 1); // fxToGbp=1 for USD test
      // Realised value = 110 × 100 = 11_000 (vs planned 100 × 100 = 10_000)
      expect(realised.valueGbp).toBe(11_000);
      expect(realised.valueGbp).toBeGreaterThan(planned.entryTrigger * planned.shares);
    });

    it('uses realised filled shares (not planned shares) when partial-fill', () => {
      const result = { filledPrice: 100, shares: 80, stopPrice: 95 }; // partial fill
      const realised = realisedGateFootprint(result, planned, 1);
      expect(realised.shares).toBe(80);
      expect(realised.valueGbp).toBe(100 * 80); // 8_000, not 10_000
    });

    it('uses realised stop for risk calc (preserves H-3 stop-tightening)', () => {
      // After H-3, a gap-up fill produces a tightened stop. M-3 must reflect that.
      const result = { filledPrice: 108, shares: 100, stopPrice: 103 }; // H-3-tightened stop
      const realised = realisedGateFootprint(result, planned, 1);
      // Realised per-share risk = 108 - 103 = 5 (== planned), × 100 shares = 500
      expect(realised.riskGbp).toBeCloseTo(500, 4);
    });

    it('FX conversion is applied to value, risk, entry and stop', () => {
      // USD trade at $100, GBP/USD = 0.80
      const result = { filledPrice: 100, shares: 100, stopPrice: 95 };
      const realised = realisedGateFootprint(result, planned, 0.80);
      expect(realised.entryGbp).toBeCloseTo(80, 6);   // 100 × 0.80
      expect(realised.stopGbp).toBeCloseTo(76, 6);    // 95 × 0.80
      expect(realised.valueGbp).toBeCloseTo(8000, 4); // 80 × 100
      expect(realised.riskGbp).toBeCloseTo(400, 4);   // (80 - 76) × 100
    });

    it('falls back to planned values when result fields are missing', () => {
      // E.g. order poll returned no filledPrice — defensive fallback path
      const result = {};
      const realised = realisedGateFootprint(result, planned, 1);
      expect(realised.shares).toBe(planned.shares);
      expect(realised.entryGbp).toBe(planned.entryTrigger);
      expect(realised.stopGbp).toBe(planned.stopPrice);
      expect(realised.valueGbp).toBe(planned.entryTrigger * planned.shares);
    });

    it('risk is floored at 0 when stop ≥ filled (degenerate / inverted)', () => {
      const result = { filledPrice: 100, shares: 100, stopPrice: 105 }; // stop above fill
      const realised = realisedGateFootprint(result, planned, 1);
      expect(realised.riskGbp).toBe(0);
    });

    it('regression: gap-up consumed footprint differs from planned by exactly (filled-planned)×shares×fx', () => {
      // The core invariant this test locks down: if planner sized for $100 entry
      // but T212 filled at $112 (12% gap-up on a momentum break), the next
      // candidate in the same session must see the REAL $112×shares against caps.
      const result = { filledPrice: 112, shares: 100, stopPrice: 95 };
      const fxToGbp = 0.80;
      const realised = realisedGateFootprint(result, planned, fxToGbp);
      const plannedFootprintGbp = planned.entryTrigger * planned.shares * fxToGbp; // 8_000
      const realisedFootprintGbp = realised.valueGbp; // 112 × 100 × 0.80 = 8_960
      expect(realisedFootprintGbp - plannedFootprintGbp).toBeCloseTo(
        (112 - 100) * 100 * fxToGbp, // 960
        4,
      );
      expect(realisedFootprintGbp).toBeGreaterThan(plannedFootprintGbp);
    });
  });
});
