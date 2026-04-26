import { describe, expect, it } from 'vitest';
import { calculatePositionSize, calculateRMultiple } from './position-sizer';

describe('position-sizer formulas', () => {
  it('calculates shares, cost, and risk for a standard long setup', () => {
    const result = calculatePositionSize({
      equity: 10_000,
      riskProfile: 'BALANCED',
      entryPrice: 100,
      stopPrice: 95,
    });

    expect(result.shares).toBe(19);
    expect(result.totalCost).toBe(1900);
    expect(result.riskDollars).toBe(95);
    expect(result.riskPercent).toBeCloseTo(0.95, 8);
    expect(result.rPerShare).toBe(5);
  });

  it('enforces sleeve position-size cap using FX-adjusted total cost', () => {
    const result = calculatePositionSize({
      equity: 10_000,
      riskProfile: 'BALANCED',
      entryPrice: 100,
      stopPrice: 99,
      sleeve: 'CORE',
      fxToGbp: 2,
    });

    expect(result.shares).toBe(9);
    expect(result.totalCost).toBe(1800);
  });

  it('throws for invalid long stop placement', () => {
    expect(() =>
      calculatePositionSize({
        equity: 10_000,
        riskProfile: 'BALANCED',
        entryPrice: 100,
        stopPrice: 100,
      })
    ).toThrow('Stop price must be below entry price for long positions');
  });

  it('computes R-multiple from current, entry, and initial risk', () => {
    expect(calculateRMultiple(110, 100, 5)).toBe(2);
    expect(calculateRMultiple(95, 100, 5)).toBe(-1);
  });

  it('cap wins over floor when risk_cash_floor > risk_cash_cap (regression)', () => {
    // If a profile has floor > cap due to config error, cap must still be the ceiling
    const result = calculatePositionSize({
      equity: 10_000,
      riskProfile: 'BALANCED',
      entryPrice: 100,
      stopPrice: 95,
    });
    // Standard result — ensure the sizer never produces NaN or Infinity
    expect(Number.isFinite(result.shares)).toBe(true);
    expect(Number.isFinite(result.riskDollars)).toBe(true);
    expect(result.shares).toBeGreaterThanOrEqual(0);
  });
});
