import { describe, expect, it } from 'vitest';
import { detectLaggards, LAGGARD_CONFIG } from './laggard-detector';

// ── Helper: build position data ─────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

function makePosition(overrides: Partial<Parameters<typeof detectLaggards>[0][0]> = {}) {
  return {
    id: 'pos-1',
    ticker: 'TEST',
    entryPrice: 100,
    entryDate: daysAgo(15), // 15 days held by default
    currentStop: 90,
    shares: 10,
    initialRisk: 5,
    currentPrice: 95, // 5% underwater by default
    currency: 'USD',
    sleeve: 'CORE',
    ...overrides,
  };
}

// ── Basic detection tests ───────────────────────────────────

describe('detectLaggards', () => {
  it('returns empty array for no positions', () => {
    expect(detectLaggards([])).toEqual([]);
  });

  it('flags classic laggard: held 15d, 5% underwater, above stop', () => {
    const results = detectLaggards([makePosition()]);
    expect(results).toHaveLength(1);
    expect(results[0].flag).toBe('TRIM_LAGGARD');
    expect(results[0].ticker).toBe('TEST');
    expect(results[0].daysHeld).toBe(15);
    expect(results[0].lossPct).toBeCloseTo(5.0, 0);
  });

  it('does not flag positions held less than holdingDays', () => {
    const results = detectLaggards([
      makePosition({ entryDate: daysAgo(5) }), // Only 5 days
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag positions that are profitable', () => {
    const results = detectLaggards([
      makePosition({ currentPrice: 110 }), // In profit
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag positions with small loss < minLossPct', () => {
    const results = detectLaggards([
      makePosition({ entryDate: daysAgo(12), currentPrice: 99 }), // Only 1% loss, below 2% threshold; 12d avoids dead money
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag positions at stop level', () => {
    const results = detectLaggards([
      makePosition({ currentPrice: 89, currentStop: 90 }), // Below stop
    ]);
    expect(results).toHaveLength(0);
  });

  it('skips HEDGE positions', () => {
    const results = detectLaggards([
      makePosition({ sleeve: 'HEDGE' }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('skips positions with zero initialRisk', () => {
    const results = detectLaggards([
      makePosition({ initialRisk: 0 }),
    ]);
    expect(results).toHaveLength(0);
  });
});

// ── Dead money detection ─────────────────────────────────────

describe('dead money detection', () => {
  it('flags dead money: held 20d, barely moving (0.1R), stalled', () => {
    // R-multiple = (currentPrice - entryPrice) / initialRisk = (100.5 - 100) / 5 = 0.1
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(20),
        currentPrice: 100.5,
      }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].flag).toBe('DEAD_MONEY');
    expect(results[0].rMultiple).toBeCloseTo(0.1, 1);
  });

  it('does not flag dead money before deadMoneyDays threshold', () => {
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(12), // < 15 days
        currentPrice: 100.5,
      }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag dead money if R >= deadMoneyMaxR', () => {
    // R = (103 - 100) / 5 = 0.6 → above 0.2R threshold
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(20),
        currentPrice: 103,
      }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag dead money if in freefall (R < -1.0)', () => {
    // R = (92 - 100) / 5 = -1.6 → freefall, should be a stop issue
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(20),
        currentPrice: 92,
        currentStop: 85, // Above stop so not stop-hit
      }),
    ]);
    // This position is deeply underwater but above stop. It should be flagged as TRIM_LAGGARD
    // since it meets laggard criteria (held 35d, 8% loss, above stop), not dead money.
    const deadMoney = results.filter(r => r.flag === 'DEAD_MONEY');
    expect(deadMoney).toHaveLength(0);
  });

  it('suppresses dead money flag when showing trend recovery (price > MA20 AND ADX rising)', () => {
    // Meets dead money criteria (20d, 0.1R) but price > MA20 and ADX is rising
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(20),
        currentPrice: 100.5, // R = 0.1, stalled — but recovering
        ma20: 100,           // price 100.5 > MA20 100
        adxToday: 25,        // ADX rising
        adxYesterday: 22,
      }),
    ]);
    const deadMoney = results.filter(r => r.flag === 'DEAD_MONEY');
    expect(deadMoney).toHaveLength(0);
  });

  it('still flags dead money when price > MA20 but ADX is falling', () => {
    // Price above MA20 but ADX declining — trend not strengthening
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(20),
        currentPrice: 100.5,
        ma20: 100,
        adxToday: 20,        // ADX falling
        adxYesterday: 25,
      }),
    ]);
    const deadMoney = results.filter(r => r.flag === 'DEAD_MONEY');
    expect(deadMoney).toHaveLength(1);
  });

  it('still flags dead money when ADX is rising but price below MA20', () => {
    // ADX rising but price still below MA20 — not a real recovery
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(20),
        currentPrice: 100.5,
        ma20: 105,           // price 100.5 < MA20 105
        adxToday: 25,
        adxYesterday: 22,
      }),
    ]);
    const deadMoney = results.filter(r => r.flag === 'DEAD_MONEY');
    expect(deadMoney).toHaveLength(1);
  });

  it('still flags dead money when indicator fields are missing (backwards-compatible)', () => {
    // No ma20/adxToday/adxYesterday — exemption does not activate
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(20),
        currentPrice: 100.5,
      }),
    ]);
    const deadMoney = results.filter(r => r.flag === 'DEAD_MONEY');
    expect(deadMoney).toHaveLength(1);
  });
});

// ── Multiple positions ──────────────────────────────────────

describe('multiple positions', () => {
  it('flags multiple laggards independently', () => {
    const results = detectLaggards([
      makePosition({ id: 'pos-1', ticker: 'AAPL', currentPrice: 95 }),
      makePosition({ id: 'pos-2', ticker: 'MSFT', currentPrice: 96 }),
      makePosition({ id: 'pos-3', ticker: 'GOOD', currentPrice: 110 }), // profitable → not flagged
    ]);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.ticker).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('does not double-flag laggard as dead money', () => {
    // Position meets BOTH laggard and dead money criteria
    // Held 20d, 5% underwater, above stop — should be TRIM_LAGGARD only
    const results = detectLaggards([
      makePosition({ entryDate: daysAgo(20) }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].flag).toBe('TRIM_LAGGARD');
  });
});

// ── Result shape ────────────────────────────────────────────

describe('result shape', () => {
  it('includes all required fields', () => {
    const results = detectLaggards([makePosition()]);
    const r = results[0];
    expect(r.positionId).toBe('pos-1');
    expect(r.ticker).toBe('TEST');
    expect(typeof r.daysHeld).toBe('number');
    expect(typeof r.rMultiple).toBe('number');
    expect(typeof r.lossPct).toBe('number');
    expect(r.flag).toBeDefined();
    expect(r.reason).toBeDefined();
    expect(r.currency).toBe('USD');
  });
});
