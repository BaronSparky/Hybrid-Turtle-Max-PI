import { describe, expect, it } from 'vitest';
import {
  mean,
  median,
  rate,
  computeStats,
  buildRuleContribution,
  buildClassificationPerformance,
  buildEntryQuality,
  buildExitPerformance,
  buildSimulations,
  runSimulation,
  type CandidateRow,
  type TradeRow,
} from './evidence-framework';

// ── Test Factories ──────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    status: 'READY',
    stageReached: 'SIZED',
    passedTechFilter: true,
    passedRiskGates: true,
    passedAntiChase: true,
    blockedByRegime: false,
    regime: 'BULLISH',
    sleeve: 'CORE',
    ncs: 72,
    fws: 18,
    bqs: 65,
    entryMode: 'BREAKOUT',
    antiChaseReason: null,
    distancePct: 0.5,
    adx: 28,
    atrPct: 3.5,
    efficiency: 45,
    dualScoreAction: 'Auto-Yes',
    fwdReturn5d: 1.5,
    fwdReturn10d: 3.2,
    fwdReturn20d: 5.1,
    mfeR: 1.8,
    maeR: -0.4,
    reached1R: true,
    reached2R: false,
    reached3R: false,
    stopHit: false,
    enrichedAt: new Date(),
    ...overrides,
  };
}

function makeTrade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    tradeType: 'ENTRY',
    exitReason: null,
    finalRMultiple: 1.5,
    daysHeld: 12,
    decision: 'TAKEN',
    ncsScore: 72,
    scanStatus: 'READY',
    slippagePct: 0.1,
    regime: 'BULLISH',
    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────

describe('mean', () => {
  it('computes average', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it('returns null for empty array', () => {
    expect(mean([])).toBeNull();
  });

  it('rounds to 2 decimal places', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([1.111, 2.222])).toBe(1.67); // (3.333 / 2) rounded
  });
});

describe('median', () => {
  it('returns middle value for odd count', () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it('returns average of two middle values for even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns null for empty array', () => {
    expect(median([])).toBeNull();
  });

  it('handles unsorted input', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe('rate', () => {
  it('computes percentage with 1 decimal', () => {
    expect(rate(3, 10)).toBe(30);
    expect(rate(1, 3)).toBe(33.3);
  });

  it('returns null for zero total', () => {
    expect(rate(0, 0)).toBeNull();
  });
});

// ── computeStats ────────────────────────────────────────────

describe('computeStats', () => {
  it('computes stats from enriched candidates', () => {
    const rows = [
      makeCandidate({ fwdReturn5d: 2, fwdReturn20d: 5, mfeR: 1.5, maeR: -0.5, reached1R: true, reached2R: false, stopHit: false }),
      makeCandidate({ fwdReturn5d: -1, fwdReturn20d: -2, mfeR: 0.3, maeR: -1.2, reached1R: false, reached2R: false, stopHit: true }),
    ];
    const stats = computeStats(rows);
    expect(stats.count).toBe(2);
    expect(stats.withOutcomes).toBe(2);
    expect(stats.avgFwd5d).toBe(0.5); // (2 + -1) / 2
    expect(stats.avgFwd20d).toBe(1.5); // (5 + -2) / 2
    expect(stats.hit1RRate).toBe(50); // 1 of 2
    expect(stats.stopHitRate).toBe(50); // 1 of 2
  });

  it('excludes non-enriched rows from outcome stats', () => {
    const rows = [
      makeCandidate({ enrichedAt: new Date(), fwdReturn5d: 5 }),
      makeCandidate({ enrichedAt: null, fwdReturn5d: 100 }), // Not enriched
    ];
    const stats = computeStats(rows);
    expect(stats.count).toBe(2);
    expect(stats.withOutcomes).toBe(1);
    expect(stats.avgFwd5d).toBe(5); // Only enriched row counted
  });

  it('returns null stats for empty array', () => {
    const stats = computeStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgFwd5d).toBeNull();
    expect(stats.hit1RRate).toBeNull();
  });
});

// ── Rule Contribution ───────────────────────────────────────

describe('buildRuleContribution', () => {
  it('produces rows for each major filter', () => {
    const rows = [
      makeCandidate({ passedTechFilter: true, adx: 30, atrPct: 3, efficiency: 50 }),
      makeCandidate({ passedTechFilter: false, adx: 15, atrPct: 10, efficiency: 20 }),
    ];
    const result = buildRuleContribution(rows);

    expect(result.length).toBeGreaterThanOrEqual(8);

    const techFilter = result.find((r) => r.rule === 'Price > MA200');
    expect(techFilter).toBeDefined();
    expect(techFilter!.passed.count).toBe(1);
    expect(techFilter!.blocked.count).toBe(1);
  });

  it('computes edge correctly when passed outperforms blocked', () => {
    const rows = [
      makeCandidate({ passedTechFilter: true, fwdReturn20d: 8 }),
      makeCandidate({ passedTechFilter: true, fwdReturn20d: 6 }),
      makeCandidate({ passedTechFilter: false, fwdReturn20d: -3 }),
    ];
    const result = buildRuleContribution(rows);
    const techFilter = result.find((r) => r.rule === 'Price > MA200');
    expect(techFilter!.edgeFwd20d).toBeGreaterThan(0);
  });

  it('includes NCS rules when NCS data present', () => {
    const rows = [
      makeCandidate({ ncs: 80 }),
      makeCandidate({ ncs: 50 }),
    ];
    const result = buildRuleContribution(rows);
    const aGrade = result.find((r) => r.rule.includes('A-Grade'));
    expect(aGrade).toBeDefined();
  });
});

// ── Classification Performance ──────────────────────────────

describe('buildClassificationPerformance', () => {
  it('creates bands for each dimension', () => {
    const rows = [
      makeCandidate({ status: 'READY', ncs: 75, bqs: 65, fws: 15 }),
      makeCandidate({ status: 'WATCH', ncs: 55, bqs: 45, fws: 25 }),
      makeCandidate({ status: 'FAR', ncs: 30, bqs: 30, fws: 60 }),
    ];
    const result = buildClassificationPerformance(rows);

    const dimensions = new Set(result.map((r) => r.dimension));
    expect(dimensions.has('Status')).toBe(true);
    expect(dimensions.has('NCS Band')).toBe(true);
    expect(dimensions.has('BQS Band')).toBe(true);
    expect(dimensions.has('FWS Band')).toBe(true);
  });

  it('correctly assigns to NCS bands', () => {
    const rows = [
      makeCandidate({ ncs: 82 }),
      makeCandidate({ ncs: 82 }),
      makeCandidate({ ncs: 55 }),
    ];
    const result = buildClassificationPerformance(rows);
    const ncs80 = result.find((r) => r.dimension === 'NCS Band' && r.band === 'NCS 80+');
    expect(ncs80).toBeDefined();
    expect(ncs80!.stats.count).toBe(2);
  });
});

// ── Entry Quality ───────────────────────────────────────────

describe('buildEntryQuality', () => {
  it('classifies clean trigger correctly', () => {
    const rows = [
      makeCandidate({ status: 'READY', distancePct: 0.3, passedAntiChase: true, entryMode: 'BREAKOUT' }),
      makeCandidate({ status: 'READY', distancePct: 1.5, passedAntiChase: true, entryMode: 'BREAKOUT' }),
      makeCandidate({ status: 'WATCH', distancePct: 2.5, entryMode: 'PULLBACK_CONTINUATION' }),
    ];
    const result = buildEntryQuality(rows);

    const clean = result.find((r) => r.entryType.includes('Clean Trigger'));
    expect(clean).toBeDefined();
    expect(clean!.stats.count).toBe(1);

    const pullback = result.find((r) => r.entryType.includes('Pullback'));
    expect(pullback).toBeDefined();
    expect(pullback!.stats.count).toBe(1);
  });

  it('classifies anti-chase blocked', () => {
    const rows = [
      makeCandidate({ passedAntiChase: false, antiChaseReason: 'ext_atr > 0.8' }),
    ];
    const result = buildEntryQuality(rows);
    const blocked = result.find((r) => r.entryType.includes('Anti-Chase'));
    expect(blocked).toBeDefined();
    expect(blocked!.stats.count).toBe(1);
  });
});

// ── Exit Performance ────────────────────────────────────────

describe('buildExitPerformance', () => {
  it('groups by exit reason', () => {
    const trades = [
      makeTrade({ tradeType: 'EXIT', exitReason: 'STOP_HIT', finalRMultiple: -1.0, daysHeld: 5 }),
      makeTrade({ tradeType: 'EXIT', exitReason: 'STOP_HIT', finalRMultiple: -0.8, daysHeld: 3 }),
      makeTrade({ tradeType: 'EXIT', exitReason: 'MANUAL', finalRMultiple: 2.5, daysHeld: 15 }),
      makeTrade({ tradeType: 'EXIT', exitReason: 'DEAD_MONEY', finalRMultiple: 0.1, daysHeld: 30 }),
    ];
    const result = buildExitPerformance(trades);

    const stopHit = result.find((r) => r.exitCategory.includes('Stop Hit'));
    expect(stopHit).toBeDefined();
    expect(stopHit!.count).toBe(2);
    expect(stopHit!.avgR).toBe(-0.9); // (-1 + -0.8) / 2
    expect(stopHit!.winRate).toBe(0); // 0 wins

    const manual = result.find((r) => r.exitCategory.includes('Manual'));
    expect(manual).toBeDefined();
    expect(manual!.winRate).toBe(100); // 1 win
  });

  it('groups by hold duration', () => {
    const trades = [
      makeTrade({ tradeType: 'EXIT', exitReason: 'STOP_HIT', finalRMultiple: -1, daysHeld: 3 }),
      makeTrade({ tradeType: 'EXIT', exitReason: 'MANUAL', finalRMultiple: 2, daysHeld: 25 }),
    ];
    const result = buildExitPerformance(trades);

    const early = result.find((r) => r.exitCategory.includes('Early'));
    expect(early).toBeDefined();
    expect(early!.count).toBe(1);

    const longHold = result.find((r) => r.exitCategory.includes('Long'));
    expect(longHold).toBeDefined();
    expect(longHold!.count).toBe(1);
  });

  it('returns empty for no trades', () => {
    expect(buildExitPerformance([])).toEqual([]);
  });
});

// ── Simulation ──────────────────────────────────────────────

describe('runSimulation', () => {
  it('simulates with wins and losses', () => {
    const trades = [
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 2.0 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: -1.0 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.5 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: -1.0 }),
    ];

    const result = runSimulation(trades, {
      name: 'Test',
      description: 'Test scenario',
      riskPct: 2,
      maxPositions: 4,
      allowPyramid: false,
      slippagePct: 0,
    });

    expect(result.trades).toBe(4);
    expect(result.wins).toBe(2);
    expect(result.losses).toBe(2);
    expect(result.winRate).toBe(50);
    expect(result.totalR).toBe(1.5); // 2 - 1 + 1.5 - 1
    expect(result.finalCapital).toBeGreaterThan(1000);
  });

  it('respects max positions limit', () => {
    const trades = [
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.0 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.0 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.0 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.0 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.0 }),
    ];

    const limited = runSimulation(trades, {
      name: 'Limited',
      description: 'Only 2 positions',
      riskPct: 2,
      maxPositions: 2,
      allowPyramid: false,
      slippagePct: 0,
    });

    // Can only take first 2 entries (maxPositions = 2)
    expect(limited.trades).toBe(2);
  });

  it('applies slippage correctly', () => {
    const trades = [
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.0 }),
    ];

    const noSlip = runSimulation(trades, {
      name: 'No slip', description: '', riskPct: 2, maxPositions: 4, allowPyramid: false, slippagePct: 0,
    });

    const withSlip = runSimulation(trades, {
      name: 'With slip', description: '', riskPct: 2, maxPositions: 4, allowPyramid: false, slippagePct: 0.5,
    });

    // With slippage, return should be lower
    expect(withSlip.finalCapital).toBeLessThan(noSlip.finalCapital);
  });

  it('skips SKIPPED trades', () => {
    const trades = [
      makeTrade({ tradeType: 'ENTRY', decision: 'SKIPPED', finalRMultiple: 5.0 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.0 }),
    ];

    const result = runSimulation(trades, {
      name: 'Test', description: '', riskPct: 2, maxPositions: 4, allowPyramid: false, slippagePct: 0,
    });

    expect(result.trades).toBe(1); // Only TAKEN
  });

  it('returns baseline for zero trades', () => {
    const result = runSimulation([], {
      name: 'Empty', description: '', riskPct: 2, maxPositions: 4, allowPyramid: false, slippagePct: 0,
    });

    expect(result.trades).toBe(0);
    expect(result.finalCapital).toBe(1000);
    expect(result.returnPct).toBe(0);
  });
});

describe('buildSimulations', () => {
  it('produces 5 standard scenarios', () => {
    const trades = [
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: 1.5 }),
      makeTrade({ tradeType: 'ENTRY', decision: 'TAKEN', finalRMultiple: -1.0 }),
    ];
    const result = buildSimulations(trades);
    expect(result).toHaveLength(5);
    expect(result.map((s) => s.name)).toContain('2% risk, 4 pos, no pyramid');
    expect(result.map((s) => s.name)).toContain('2% risk, 4 pos, with pyramid');
  });
});
