import { describe, expect, it } from 'vitest';
import { canPyramid, validateRiskGates } from './risk-gates';

describe('risk-gates formulas', () => {
  it('does not auto-fail concentration gates at 100% on empty book', () => {
    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'TECH',
        cluster: 'SOFTWARE',
        value: 1000,
        riskDollars: 95,
      },
      [],
      10_000,
      'BALANCED'
    );

    const sleeveGate = results.find((r) => r.gate === 'Sleeve Limit');
    const clusterGate = results.find((r) => r.gate === 'Cluster Concentration');
    const sectorGate = results.find((r) => r.gate === 'Sector Concentration');
    const positionSizeGate = results.find((r) => r.gate === 'Position Size');

    expect(sleeveGate?.current).toBeCloseTo(10, 8);
    expect(clusterGate?.current).toBeCloseTo(10, 8);
    expect(sectorGate?.current).toBeCloseTo(10, 8);
    expect(positionSizeGate?.current).toBeCloseTo(10, 8);

    expect(sleeveGate?.passed).toBe(true);
    expect(clusterGate?.passed).toBe(true);
    expect(sectorGate?.passed).toBe(true);
    expect(positionSizeGate?.passed).toBe(true);
  });

  it('fails oversized first trade against sleeve and position-size caps', () => {
    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'TECH',
        cluster: 'SOFTWARE',
        value: 9000,
        riskDollars: 300,
      },
      [],
      10_000,
      'BALANCED'
    );

    const sleeveGate = results.find((r) => r.gate === 'Sleeve Limit');
    const positionSizeGate = results.find((r) => r.gate === 'Position Size');

    expect(sleeveGate?.current).toBeCloseTo(90, 8);
    expect(sleeveGate?.passed).toBe(false);

    expect(positionSizeGate?.current).toBeCloseTo(90, 8);
    expect(positionSizeGate?.passed).toBe(false);
  });

  it('uses invested value as denominator when invested value exceeds equity', () => {
    const existingPositions = [
      {
        id: 'c1',
        ticker: 'AAA',
        sleeve: 'CORE' as const,
        sector: 'TECH',
        cluster: 'SOFTWARE',
        value: 8000,
        riskDollars: 200,
        shares: 10,
        entryPrice: 100,
        currentStop: 90,
        currentPrice: 120,
      },
      {
        id: 'e1',
        ticker: 'BBB',
        sleeve: 'ETF' as const,
        sector: 'ETF',
        cluster: 'INDEX',
        value: 5000,
        riskDollars: 100,
        shares: 20,
        entryPrice: 50,
        currentStop: 45,
        currentPrice: 55,
      },
    ];

    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'TECH',
        cluster: 'SOFTWARE',
        value: 2000,
        riskDollars: 100,
      },
      existingPositions,
      10_000,
      'BALANCED'
    );

    const sleeveGate = results.find((r) => r.gate === 'Sleeve Limit');
    const clusterGate = results.find((r) => r.gate === 'Cluster Concentration');
    const sectorGate = results.find((r) => r.gate === 'Sector Concentration');
    const positionSizeGate = results.find((r) => r.gate === 'Position Size');

    // totalInvestedValue = 8000 + 5000 + 2000 = 15000 > equity 10000
    // denom should be 15000
    expect(sleeveGate?.current).toBeCloseTo((10000 / 15000) * 100, 8);
    expect(clusterGate?.current).toBeCloseTo((10000 / 15000) * 100, 8);
    expect(sectorGate?.current).toBeCloseTo((10000 / 15000) * 100, 8);
    expect(positionSizeGate?.current).toBeCloseTo((2000 / 15000) * 100, 8);
  });

  it('fails total open risk gate when risk exceeds profile cap', () => {
    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'TECH',
        cluster: 'SOFTWARE',
        value: 1000,
        riskDollars: 300,
      },
      [
        {
          id: '1',
          ticker: 'AAA',
          sleeve: 'CORE',
          sector: 'TECH',
          cluster: 'SOFTWARE',
          value: 1000,
          riskDollars: 300,
          shares: 10,
          entryPrice: 100,
          currentStop: 90,
          currentPrice: 120,
        },
      ],
      10_000,
      'BALANCED'
    );

    const openRiskGate = results.find((r) => r.gate === 'Total Open Risk');
    expect(openRiskGate?.passed).toBe(false);
    expect(openRiskGate?.current).toBeCloseTo(6, 8);
  });

  it('fails total open risk gate when equity is missing or zero', () => {
    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'TECH',
        cluster: 'SOFTWARE',
        value: 1000,
        riskDollars: 10,
      },
      [],
      0,
      'BALANCED'
    );

    const openRiskGate = results.find((r) => r.gate === 'Total Open Risk');
    expect(openRiskGate?.passed).toBe(false);
    expect(openRiskGate?.current).toBe(Number.POSITIVE_INFINITY);
    expect(openRiskGate?.message).toContain('new entries blocked');
  });

  it('excludes HEDGE positions from open-risk and max-position counting', () => {
    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'INDUSTRIALS',
        cluster: 'AEROSPACE',
        value: 1000,
        riskDollars: 100,
      },
      [
        {
          id: 'h1',
          ticker: 'HEDGE1',
          sleeve: 'HEDGE',
          sector: 'N/A',
          cluster: 'N/A',
          value: 5000,
          riskDollars: 5000,
          shares: 50,
          entryPrice: 100,
          currentStop: 1,
          currentPrice: 120,
        },
        {
          id: 'c1',
          ticker: 'CORE1',
          sleeve: 'CORE',
          sector: 'INDUSTRIALS',
          cluster: 'AEROSPACE',
          value: 1000,
          riskDollars: 100,
          shares: 10,
          entryPrice: 100,
          currentStop: 90,
          currentPrice: 110,
        },
      ],
      10_000,
      'BALANCED'
    );

    const openRiskGate = results.find((r) => r.gate === 'Total Open Risk');
    const maxPositionsGate = results.find((r) => r.gate === 'Max Positions');
    expect(openRiskGate?.passed).toBe(true);
    expect(openRiskGate?.current).toBeCloseTo(2, 8);
    expect(maxPositionsGate?.passed).toBe(true);
    expect(maxPositionsGate?.current).toBe(2);
  });

  it('allows ATR-triggered pyramid add when trigger is reached', () => {
    const result = canPyramid(106, 100, 5, 10, 0);
    expect(result.allowed).toBe(true);
    expect(result.addNumber).toBe(1);
    expect(result.triggerPrice).toBe(105);
    expect(result.riskScalar).toBe(0.5); // Add #1 = 50% of base risk
  });

  it('blocks pyramid adds once max adds is reached', () => {
    const result = canPyramid(130, 100, 5, 10, 2);
    expect(result.allowed).toBe(false);
    expect(result.addNumber).toBe(0);
    expect(result.riskScalar).toBe(0); // Not allowed = 0 scalar
  });

  it('returns 25% risk scalar for add #2', () => {
    // Add #2 trigger: entry(100) + 1.0 × ATR(10) = 110
    const result = canPyramid(112, 100, 5, 10, 1);
    expect(result.allowed).toBe(true);
    expect(result.addNumber).toBe(2);
    expect(result.riskScalar).toBe(0.25); // Add #2 = 25% of base risk
  });

  it('blocks pyramiding when open risk ratio >= 70%', () => {
    // Price at trigger, but risk budget 75% full
    const result = canPyramid(106, 100, 5, 10, 0, 0.75);
    expect(result.allowed).toBe(false);
    expect(result.riskScalar).toBe(0);
    expect(result.message).toContain('Risk budget');
    expect(result.message).toContain('pyramiding blocked');
  });

  it('allows pyramiding when open risk ratio < 70%', () => {
    // Price at trigger, risk budget 50% full — should be allowed
    const result = canPyramid(106, 100, 5, 10, 0, 0.50);
    expect(result.allowed).toBe(true);
    expect(result.addNumber).toBe(1);
    expect(result.riskScalar).toBe(0.5);
  });

  it('blocks pyramiding at exactly 70% open risk threshold', () => {
    const result = canPyramid(106, 100, 5, 10, 0, 0.70);
    expect(result.allowed).toBe(false);
    expect(result.riskScalar).toBe(0);
  });
});
