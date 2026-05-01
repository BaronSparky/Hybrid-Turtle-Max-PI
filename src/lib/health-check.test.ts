import { describe, it, expect } from 'vitest';
import { checkStopIntegrity, checkConfigCoherence, checkSleeveLimits, checkOpenPositionUniqueness } from './health-check';
import type { RiskProfileType } from '@/types';

// ── Helper: make a minimal position for health checks ──
function makePos(overrides: Partial<{
  ticker: string;
  entryPrice: number;
  currentStop: number;
  stopLoss: number;
  initialRisk: number;
  protectionLevel: string;
  shares: number;
  sleeve: string;
  cluster: string;
  sector: string;
}> = {}) {
  return {
    entryPrice: overrides.entryPrice ?? 100,
    shares: overrides.shares ?? 10,
    currentStop: overrides.currentStop ?? 90,
    stopLoss: overrides.stopLoss ?? 90,
    initialRisk: overrides.initialRisk ?? 10,
    protectionLevel: overrides.protectionLevel ?? 'INITIAL',
    status: 'OPEN',
    stock: {
      ticker: overrides.ticker ?? 'TEST',
      sleeve: overrides.sleeve ?? 'CORE',
      currency: 'USD',
      cluster: overrides.cluster ?? 'TECH',
      sector: overrides.sector ?? 'Technology',
    },
    stopHistory: [],
  };
}

// ── checkStopIntegrity ──

describe('checkStopIntegrity', () => {
  it('returns GREEN for healthy positions', () => {
    const result = checkStopIntegrity([
      makePos({ ticker: 'AAPL', entryPrice: 150, currentStop: 140, protectionLevel: 'INITIAL', initialRisk: 10 }),
    ]);
    expect(result.status).toBe('GREEN');
    expect(result.id).toBe('D2');
  });

  it('returns GREEN for empty positions', () => {
    expect(checkStopIntegrity([]).status).toBe('GREEN');
  });

  it('flags INITIAL stop >= entry as RED', () => {
    const result = checkStopIntegrity([
      makePos({ ticker: 'BAD', entryPrice: 100, currentStop: 105, protectionLevel: 'INITIAL' }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('BAD');
    expect(result.message).toContain('INITIAL');
  });

  it('allows stop above entry for non-INITIAL levels', () => {
    const result = checkStopIntegrity([
      makePos({ ticker: 'OK', entryPrice: 100, currentStop: 105, protectionLevel: 'BREAKEVEN' }),
    ]);
    expect(result.status).toBe('GREEN');
  });

  it('flags zero stop as RED', () => {
    const result = checkStopIntegrity([
      makePos({ ticker: 'ZERO', currentStop: 0 }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('ZERO');
  });

  it('flags negative stop as RED', () => {
    const result = checkStopIntegrity([
      makePos({ ticker: 'NEG', currentStop: -5 }),
    ]);
    expect(result.status).toBe('RED');
  });

  it('flags zero initialRisk as RED', () => {
    const result = checkStopIntegrity([
      makePos({ ticker: 'NORISK', initialRisk: 0 }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('initialRisk');
  });

  it('reports multiple issues', () => {
    const result = checkStopIntegrity([
      makePos({ ticker: 'A', currentStop: 0 }),
      makePos({ ticker: 'B', initialRisk: 0 }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('A');
    expect(result.message).toContain('B');
  });
});

// ── checkConfigCoherence ──

describe('checkConfigCoherence', () => {
  it('returns GREEN for CONSERVATIVE profile', () => {
    const result = checkConfigCoherence('CONSERVATIVE' as RiskProfileType);
    expect(result.status).toBe('GREEN');
    expect(result.id).toBe('F');
  });

  it('returns GREEN for BALANCED profile', () => {
    expect(checkConfigCoherence('BALANCED' as RiskProfileType).status).toBe('GREEN');
  });

  it('returns GREEN for SMALL_ACCOUNT profile', () => {
    expect(checkConfigCoherence('SMALL_ACCOUNT' as RiskProfileType).status).toBe('GREEN');
  });

  it('returns GREEN for AGGRESSIVE profile', () => {
    expect(checkConfigCoherence('AGGRESSIVE' as RiskProfileType).status).toBe('GREEN');
  });
});

// ── checkSleeveLimits ──

describe('checkSleeveLimits', () => {
  it('returns GREEN for empty positions', () => {
    const result = checkSleeveLimits([], 10000);
    expect(result.status).toBe('GREEN');
    expect(result.id).toBe('G1');
  });

  it('returns GREEN for single-sleeve portfolio', () => {
    const result = checkSleeveLimits([
      makePos({ ticker: 'A', sleeve: 'CORE', entryPrice: 100, shares: 10 }),
      makePos({ ticker: 'B', sleeve: 'CORE', entryPrice: 200, shares: 5 }),
    ], 10000);
    expect(result.status).toBe('GREEN');
    expect(result.message).toContain('Too few sleeves');
  });

  it('returns GREEN when sleeves are within limits', () => {
    // CORE cap=80%, HIGH_RISK cap=40% — put 70% CORE, 30% HIGH_RISK
    const result = checkSleeveLimits([
      makePos({ ticker: 'A', sleeve: 'CORE', entryPrice: 100, shares: 7 }),        // 700 = 70%
      makePos({ ticker: 'B', sleeve: 'HIGH_RISK', entryPrice: 100, shares: 3 }),   // 300 = 30%
    ], 10000);
    expect(result.status).toBe('GREEN');
  });

  it('flags when a sleeve exceeds its cap', () => {
    // HIGH_RISK has cap of ~0.35, put 90% there
    const result = checkSleeveLimits([
      makePos({ ticker: 'A', sleeve: 'CORE', entryPrice: 10, shares: 1 }),          // 10
      makePos({ ticker: 'B', sleeve: 'HIGH_RISK', entryPrice: 100, shares: 10 }),   // 1000 = 99%
    ], 10000);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('HIGH_RISK');
  });
});

// ── checkOpenPositionUniqueness (regression: 2026-05-01 "9 vs 6" bug) ──

describe('checkOpenPositionUniqueness', () => {
  it('returns GREEN when every (stockId, accountType) is unique', () => {
    const result = checkOpenPositionUniqueness([
      { ...makePos({ ticker: 'AAPL' }), stockId: 's1', accountType: 'isa' },
      { ...makePos({ ticker: 'GOOGL' }), stockId: 's2', accountType: 'isa' },
      { ...makePos({ ticker: 'UNFI' }), stockId: 's3', accountType: 'invest' },
    ]);
    expect(result.id).toBe('A4');
    expect(result.status).toBe('GREEN');
    expect(result.message).toContain('3 unique');
  });

  it('returns RED when two OPEN rows share the same stockId + accountType', () => {
    // This is the production bug: auto-trade row + broker-sync row for the
    // same holding, both OPEN under the ISA account.
    const result = checkOpenPositionUniqueness([
      { ...makePos({ ticker: 'UNFI' }), stockId: 's1', accountType: 'isa' },
      { ...makePos({ ticker: 'UNFI' }), stockId: 's1', accountType: 'isa' },
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('UNFI');
    expect(result.message).toContain('isa');
    expect(result.message).toContain('2 rows');
  });

  it('does NOT flag the same stockId held under different account types as duplicate', () => {
    const result = checkOpenPositionUniqueness([
      { ...makePos({ ticker: 'AAPL' }), stockId: 's1', accountType: 'isa' },
      { ...makePos({ ticker: 'AAPL' }), stockId: 's1', accountType: 'invest' },
    ]);
    expect(result.status).toBe('GREEN');
  });

  it('treats a null accountType as invest (default) for grouping', () => {
    const result = checkOpenPositionUniqueness([
      { ...makePos({ ticker: 'PWR' }), stockId: 's1', accountType: null },
      { ...makePos({ ticker: 'PWR' }), stockId: 's1', accountType: 'invest' },
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('PWR');
  });

  it('lists every duplicated ticker, not just the first', () => {
    const result = checkOpenPositionUniqueness([
      { ...makePos({ ticker: 'UNFI' }), stockId: 's1', accountType: 'isa' },
      { ...makePos({ ticker: 'UNFI' }), stockId: 's1', accountType: 'isa' },
      { ...makePos({ ticker: 'GOOGL' }), stockId: 's2', accountType: 'isa' },
      { ...makePos({ ticker: 'GOOGL' }), stockId: 's2', accountType: 'isa' },
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('UNFI');
    expect(result.message).toContain('GOOGL');
  });

  it('returns GREEN with zero positions', () => {
    const result = checkOpenPositionUniqueness([]);
    expect(result.status).toBe('GREEN');
    expect(result.message).toContain('0 unique');
  });
});
