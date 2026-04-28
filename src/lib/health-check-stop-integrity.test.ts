import { describe, expect, it } from 'vitest';
import { checkStopIntegrity, checkEquityPositive, checkConfigCoherence, checkSleeveLimits } from './health-check';

function makePosition(overrides: Partial<{
  entryPrice: number;
  currentStop: number;
  stopLoss: number;
  initialRisk: number;
  protectionLevel: string;
  ticker: string;
}> = {}) {
  const ticker = overrides.ticker ?? 'TEST';
  return {
    entryPrice: overrides.entryPrice ?? 100,
    shares: 10,
    currentStop: overrides.currentStop ?? 90,
    stopLoss: overrides.stopLoss ?? 90,
    initialRisk: overrides.initialRisk ?? 10,
    protectionLevel: overrides.protectionLevel ?? 'INITIAL',
    status: 'OPEN',
    stock: { ticker, sleeve: 'CORE', currency: 'USD' },
    stopHistory: [],
  };
}

describe('checkStopIntegrity', () => {
  it('returns GREEN for valid positions', () => {
    const result = checkStopIntegrity([
      makePosition({ entryPrice: 100, currentStop: 90, initialRisk: 10, protectionLevel: 'INITIAL' }),
    ]);
    expect(result.status).toBe('GREEN');
  });

  it('flags INITIAL stop above entry', () => {
    const result = checkStopIntegrity([
      makePosition({ entryPrice: 100, currentStop: 105, initialRisk: 10, protectionLevel: 'INITIAL', ticker: 'BAD' }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('BAD');
    expect(result.message).toContain('INITIAL');
  });

  it('allows stop above entry for LOCK levels', () => {
    const result = checkStopIntegrity([
      makePosition({ entryPrice: 100, currentStop: 105, initialRisk: 10, protectionLevel: 'LOCK_08R' }),
    ]);
    expect(result.status).toBe('GREEN');
  });

  it('allows stop above entry for TRAILING_ATR', () => {
    const result = checkStopIntegrity([
      makePosition({ entryPrice: 100, currentStop: 102, initialRisk: 10, protectionLevel: 'TRAILING_ATR' }),
    ]);
    expect(result.status).toBe('GREEN');
  });

  it('flags zero stop', () => {
    const result = checkStopIntegrity([
      makePosition({ currentStop: 0, ticker: 'ZERO' }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('ZERO');
  });

  it('flags negative initial risk', () => {
    const result = checkStopIntegrity([
      makePosition({ initialRisk: -5, ticker: 'NEGRISK' }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('NEGRISK');
  });

  it('flags multiple issues', () => {
    const result = checkStopIntegrity([
      makePosition({ currentStop: 0, ticker: 'A' }),
      makePosition({ initialRisk: 0, ticker: 'B' }),
    ]);
    expect(result.status).toBe('RED');
    expect(result.message).toContain('A');
    expect(result.message).toContain('B');
  });

  it('returns GREEN for empty positions', () => {
    const result = checkStopIntegrity([]);
    expect(result.status).toBe('GREEN');
  });
});

describe('checkEquityPositive', () => {
  it('returns GREEN for positive equity', () => {
    expect(checkEquityPositive(10000).status).toBe('GREEN');
  });

  it('returns RED for zero equity', () => {
    expect(checkEquityPositive(0).status).toBe('RED');
  });

  it('returns RED for negative equity', () => {
    expect(checkEquityPositive(-500).status).toBe('RED');
  });
});

describe('checkConfigCoherence', () => {
  it('returns GREEN for BALANCED profile', () => {
    expect(checkConfigCoherence('BALANCED').status).toBe('GREEN');
  });

  it('returns GREEN for CONSERVATIVE profile', () => {
    expect(checkConfigCoherence('CONSERVATIVE').status).toBe('GREEN');
  });

  it('returns GREEN or YELLOW for AGGRESSIVE profile', () => {
    const result = checkConfigCoherence('AGGRESSIVE');
    expect(['GREEN', 'YELLOW']).toContain(result.status);
  });
});

describe('checkSleeveLimits', () => {
  it('returns GREEN for empty positions', () => {
    expect(checkSleeveLimits([], 10000).status).toBe('GREEN');
  });

  it('returns GREEN for single sleeve', () => {
    const result = checkSleeveLimits([
      makePosition({ ticker: 'A' }),
      makePosition({ ticker: 'B' }),
    ], 10000);
    expect(result.status).toBe('GREEN');
  });

  it('returns GREEN for balanced sleeve allocation', () => {
    // 80/20 split stays within both CORE (80%) and HIGH_RISK (40%) caps
    const cores = Array.from({ length: 4 }, (_, i) => ({
      ...makePosition({ ticker: `C${i}` }),
      stock: { ticker: `C${i}`, sleeve: 'CORE', currency: 'USD' },
    }));
    const hr = { ...makePosition({ ticker: 'HR1' }), stock: { ticker: 'HR1', sleeve: 'HIGH_RISK', currency: 'USD' } };
    const result = checkSleeveLimits([...cores, hr], 10000);
    expect(result.status).toBe('GREEN');
  });
});
