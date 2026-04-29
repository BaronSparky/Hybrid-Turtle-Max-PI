import { describe, it, expect } from 'vitest';
import { simulateStopLadder } from './runner';

describe('simulateStopLadder', () => {
  const makeSnap = (date: string, close: number, atr14 = 2) => ({ date, close, atr14 });

  it('returns no hit when price stays above stop', () => {
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 105),
      makeSnap('2026-04-02', 110),
      makeSnap('2026-04-03', 108),
    ]);
    expect(result.hit).toBe(false);
    expect(result.hitDate).toBeNull();
    expect(result.maxFavR).toBeGreaterThan(0);
  });

  it('detects stop hit when price drops to stop level', () => {
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 105),
      makeSnap('2026-04-02', 90), // hits stop
      makeSnap('2026-04-03', 95),
    ]);
    expect(result.hit).toBe(true);
    expect(result.hitDate).toBe('2026-04-02');
    expect(result.hitR).toBeCloseTo(-1.0); // Lost 1R
  });

  it('returns early when riskPerShare <= 0', () => {
    const result = simulateStopLadder(100, 100, [makeSnap('2026-04-01', 105)]);
    expect(result.hit).toBe(false);
    expect(result.maxFavR).toBe(0);
  });

  it('raises stop to breakeven at 1.5R', () => {
    // Entry 100, stop 90, risk = 10. 1.5R = 115.
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 115), // 1.5R → stop moves to breakeven (100)
      makeSnap('2026-04-02', 95),  // Below original stop 90 but above breakeven 100? No — 95 < 100 → hits new stop
    ]);
    expect(result.hit).toBe(true);
    expect(result.hitDate).toBe('2026-04-02');
    // Stop was raised to 100 (breakeven), so R at hit = (100-100)/10 = 0
    expect(result.hitR).toBeCloseTo(0);
  });

  it('raises stop further at 2.5R (lock 0.5R)', () => {
    // Entry 100, stop 90, risk = 10. 2.5R = 125.
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 125), // 2.5R → stop moves to entry + 0.5R = 105
      makeSnap('2026-04-02', 104), // Below 105 → hits
    ]);
    expect(result.hit).toBe(true);
    expect(result.hitR).toBeCloseTo(0.5); // Locked 0.5R
  });

  it('raises stop to trailing at 3.0R', () => {
    // Entry 100, stop 90, risk = 10. 3.0R = 130.
    // Trailing: max(entry + 1R, close - 2*ATR) = max(110, 130 - 4) = 126
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 130, 2), // 3.0R → trailing stop = max(110, 130-4) = 126
      makeSnap('2026-04-02', 125),     // Below 126 → hits
    ]);
    expect(result.hit).toBe(true);
    expect(result.hitR).toBeCloseTo(2.6); // Locked at 126 → (126-100)/10 = 2.6R
  });

  it('tracks maxFavR and maxAdvR correctly', () => {
    // Entry 100, stop 90, risk 10. Dips below entry first, then rises.
    // maxAdvR tracks the lowest R-multiple seen.
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 97),  // -0.3R
      makeSnap('2026-04-02', 105), // +0.5R
      makeSnap('2026-04-03', 110), // +1R
    ]);
    expect(result.hit).toBe(false);
    expect(result.maxFavR).toBeCloseTo(1.0);
    expect(result.maxAdvR).toBeCloseTo(-0.3);
  });

  it('stop is monotonic — never decreases', () => {
    // After hitting 1.5R, stop at breakeven. Even if price dips, stop stays.
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 116), // 1.6R → stop → 100
      makeSnap('2026-04-02', 105), // Dips but above breakeven stop
      makeSnap('2026-04-03', 99),  // Below breakeven → hit at 100
    ]);
    expect(result.hit).toBe(true);
    expect(result.hitR).toBeCloseTo(0); // Breakeven
  });

  it('returns maxFavR for trades that never hit stop', () => {
    const result = simulateStopLadder(100, 90, [
      makeSnap('2026-04-01', 105),
      makeSnap('2026-04-02', 110),
      makeSnap('2026-04-03', 115),
    ]);
    expect(result.hit).toBe(false);
    expect(result.maxFavR).toBeCloseTo(1.5);
  });
});
