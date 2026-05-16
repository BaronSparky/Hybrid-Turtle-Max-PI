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
});
