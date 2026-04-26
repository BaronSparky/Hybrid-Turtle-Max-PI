import { describe, expect, it } from 'vitest';
import {
  scoreTrendHealth,
  scoreWinnerHold,
  scoreWeakeningTrend,
  scoreExitReview,
  scoreOpportunityCost,
  scoreClimaxRisk,
  scoreGapRisk,
  scoreRSDecay,
  determineAction,
  evaluatePosition,
  evaluateAllPositions,
  type ExitPosition,
} from './exit-intelligence';

// ── Test Helpers ──────────────────────────────────────────────

function makePosition(overrides: Partial<ExitPosition> = {}): ExitPosition {
  return {
    id: 'pos-1',
    ticker: 'AAPL',
    sleeve: 'CORE',
    entryPrice: 100,
    currentPrice: 105,
    currentStop: 94,
    initialRisk: 6,
    shares: 10,
    daysHeld: 10,
    rMultiple: 0.83,
    atr: 3,
    currency: 'USD',
    ...overrides,
  };
}

// ── 1. Trend Health Score ─────────────────────────────────────

describe('scoreTrendHealth', () => {
  it('returns high score for strong uptrend', () => {
    const score = scoreTrendHealth(makePosition({
      adxToday: 35,
      plusDI: 30,
      minusDI: 10,
      ma20: 100,
      currentPrice: 110,
      currentNCS: 80,
    }));
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('returns low score for weak/dying trend', () => {
    const score = scoreTrendHealth(makePosition({
      adxToday: 15,
      plusDI: 12,
      minusDI: 18, // Bearish DI
      ma20: 110,
      currentPrice: 105, // Below MA20
      currentNCS: 30,
    }));
    expect(score).toBeLessThan(40);
  });

  it('returns neutral scores when data is missing', () => {
    const score = scoreTrendHealth(makePosition({}));
    // With all defaults (no technicals), should be middle-ish
    expect(score).toBeGreaterThanOrEqual(30);
    expect(score).toBeLessThanOrEqual(70);
  });
});

// ── 2. Winner Hold Score ──────────────────────────────────────

describe('scoreWinnerHold', () => {
  it('returns high score for strong winner at LOCK_1R_TRAIL', () => {
    const score = scoreWinnerHold(makePosition({
      rMultiple: 3.5,
      protectionLevel: 'LOCK_1R_TRAIL',
      adxToday: 30,
      adxYesterday: 28, // Rising
      relativeStrength: 75,
    }));
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('returns low score for weak position at INITIAL stop', () => {
    const score = scoreWinnerHold(makePosition({
      rMultiple: -0.5,
      protectionLevel: 'INITIAL',
      adxToday: 18,
      adxYesterday: 22,
      relativeStrength: 30,
    }));
    expect(score).toBeLessThan(30);
  });
});

// ── 3. Weakening Trend Warning ────────────────────────────────

describe('scoreWeakeningTrend', () => {
  it('returns high score when all decay signals fire', () => {
    const score = scoreWeakeningTrend(makePosition({
      adxToday: 20,
      adxYesterday: 30, // Big decline
      relativeStrength: 30,
      priorRelativeStrength: 55, // RS decay > 10
      currentNCS: 35,
      priorNCS: 70, // NCS drop > 15
      ma20: 108,
      currentPrice: 102, // Below MA20
    }));
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it('returns zero when trend is strengthening', () => {
    const score = scoreWeakeningTrend(makePosition({
      adxToday: 35,
      adxYesterday: 30, // Rising
      relativeStrength: 70,
      priorRelativeStrength: 65, // Improving
      currentNCS: 80,
      priorNCS: 75, // Improving
      ma20: 100,
      currentPrice: 112, // Well above MA20
    }));
    expect(score).toBe(0);
  });
});

// ── 4. Exit Review Score ──────────────────────────────────────

describe('scoreExitReview', () => {
  it('returns high score for dead money with exit pressure', () => {
    const score = scoreExitReview(
      20,  // Low trend health
      15,  // Low winner hold
      70,  // High weakening
      50,  // High opportunity cost
      0,   // No climax
      0.2, // Low R
      25   // Many days
    );
    expect(score).toBeGreaterThanOrEqual(65);
  });

  it('returns low score for healthy winner', () => {
    const score = scoreExitReview(
      85,  // High trend health
      90,  // High winner hold
      10,  // Low weakening
      0,   // No opportunity cost
      0,   // No climax
      3.0, // Strong R
      15   // Normal days
    );
    expect(score).toBeLessThan(25);
  });
});

// ── 5. Opportunity Cost Score ─────────────────────────────────

describe('scoreOpportunityCost', () => {
  it('returns high score when A-grades are blocked by weak position', () => {
    const score = scoreOpportunityCost(makePosition({
      aGradeCandidatesWaiting: 3,
      rMultiple: 0.1,
      daysHeld: 15,
      capitalDeployed: 2000,
    }));
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it('returns zero when no candidates waiting', () => {
    const score = scoreOpportunityCost(makePosition({
      aGradeCandidatesWaiting: 0,
    }));
    expect(score).toBe(0);
  });
});

// ── 6. Climax / Blow-Off Risk Score ───────────────────────────

describe('scoreClimaxRisk', () => {
  it('returns high score for parabolic move with volume', () => {
    const score = scoreClimaxRisk(makePosition({
      priceAboveMa20Pct: 25,
      volume: 5000000,
      avgVolume20: 1000000, // 5× volume
    }));
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('returns zero for normal price action', () => {
    const score = scoreClimaxRisk(makePosition({
      priceAboveMa20Pct: 3,
      volume: 1200000,
      avgVolume20: 1000000,
    }));
    expect(score).toBe(0);
  });

  it('computes extension from MA20 when priceAboveMa20Pct not provided', () => {
    const score = scoreClimaxRisk(makePosition({
      currentPrice: 125,
      ma20: 100, // 25% above
      volume: 4000000,
      avgVolume20: 1000000,
    }));
    expect(score).toBeGreaterThanOrEqual(70);
  });
});

// ── 7. Gap Risk Score ─────────────────────────────────────────

describe('scoreGapRisk', () => {
  it('returns high score for gap exceeding 3× ATR threshold', () => {
    const score = scoreGapRisk(makePosition({
      overnightGapPct: 8,
      atrPct: 2, // threshold = 4%, gap = 8% = 2× threshold
    }));
    expect(score).toBeGreaterThanOrEqual(50);
  });

  it('returns zero when no gap data', () => {
    const score = scoreGapRisk(makePosition({}));
    expect(score).toBe(0);
  });

  it('returns zero when gap within ATR threshold', () => {
    const score = scoreGapRisk(makePosition({
      overnightGapPct: 2,
      atrPct: 3, // threshold = 6%, gap = 2% = under
    }));
    expect(score).toBe(0);
  });
});

// ── 8. RS Decay Score ─────────────────────────────────────────

describe('scoreRSDecay', () => {
  it('returns high score for large RS decline with low absolute RS', () => {
    const score = scoreRSDecay(makePosition({
      relativeStrength: 25,
      priorRelativeStrength: 55, // 30-point decay
    }));
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it('returns zero when RS is rising', () => {
    const score = scoreRSDecay(makePosition({
      relativeStrength: 70,
      priorRelativeStrength: 65,
    }));
    expect(score).toBe(0);
  });

  it('returns zero when RS data missing', () => {
    const score = scoreRSDecay(makePosition({}));
    expect(score).toBe(0);
  });
});

// ── Action Determination ──────────────────────────────────────

describe('determineAction', () => {
  it('returns DO_NOT_TOUCH for HEDGE positions', () => {
    const pos = makePosition({ sleeve: 'HEDGE' });
    const scores = {
      trendHealth: 20, winnerHold: 10, weakeningTrend: 80,
      exitReview: 90, opportunityCost: 50, climaxRisk: 0, gapRisk: 0, rsDecay: 0,
    };
    expect(determineAction(scores, pos)).toBe('DO_NOT_TOUCH');
  });

  it('returns TRIM_REVIEW for climax blow-off', () => {
    const pos = makePosition({ rMultiple: 4.0 });
    const scores = {
      trendHealth: 60, winnerHold: 70, weakeningTrend: 10,
      exitReview: 30, opportunityCost: 0, climaxRisk: 70, gapRisk: 0, rsDecay: 0,
    };
    expect(determineAction(scores, pos)).toBe('TRIM_REVIEW');
  });

  it('returns HOLD_AND_TRAIL for strong winner with intact trend', () => {
    const pos = makePosition({ rMultiple: 3.0, sleeve: 'CORE' });
    const scores = {
      trendHealth: 80, winnerHold: 85, weakeningTrend: 10,
      exitReview: 15, opportunityCost: 0, climaxRisk: 0, gapRisk: 0, rsDecay: 0,
    };
    expect(determineAction(scores, pos)).toBe('HOLD_AND_TRAIL');
  });

  it('returns EXIT_REVIEW for high composite exit pressure', () => {
    const pos = makePosition({ rMultiple: 0.2 });
    const scores = {
      trendHealth: 20, winnerHold: 15, weakeningTrend: 60,
      exitReview: 75, opportunityCost: 40, climaxRisk: 0, gapRisk: 0, rsDecay: 50,
    };
    expect(determineAction(scores, pos)).toBe('EXIT_REVIEW');
  });
});

// ── Scenario Tests ────────────────────────────────────────────

describe('evaluatePosition — scenarios', () => {
  it('early winner: holds a fresh profitable position', () => {
    const result = evaluatePosition(makePosition({
      rMultiple: 1.0,
      daysHeld: 5,
      currentPrice: 106,
      entryPrice: 100,
      currentStop: 94,
      adxToday: 30,
      adxYesterday: 28,
      ma20: 100,
      relativeStrength: 65,
      currentNCS: 75,
    }));

    expect(result.action).toBe('HOLD');
    expect(result.rMultiple).toBe(1.0);
    expect(result.requiresApproval).toBe(true);
    expect(result.explanation).toContain('performing');
  });

  it('mature winner: recommends hold and trail for big winner', () => {
    const result = evaluatePosition(makePosition({
      rMultiple: 3.5,
      daysHeld: 30,
      currentPrice: 121,
      entryPrice: 100,
      initialRisk: 6,
      currentStop: 106, // LOCK_1R_TRAIL
      protectionLevel: 'LOCK_1R_TRAIL',
      adxToday: 32,
      adxYesterday: 30,
      ma20: 112,
      relativeStrength: 72,
      currentNCS: 80,
    }));

    expect(result.action).toBe('HOLD_AND_TRAIL');
    expect(result.scores.winnerHold).toBeGreaterThanOrEqual(70);
    expect(result.explanation).toContain('strong winner');
  });

  it('dead money: flags stalled position', () => {
    const result = evaluatePosition(makePosition({
      rMultiple: 0.2,
      daysHeld: 25,
      currentPrice: 101.2,
      entryPrice: 100,
      currentStop: 94,
      adxToday: 18,
      adxYesterday: 22,
      relativeStrength: 35,
      priorRelativeStrength: 50,
      currentNCS: 40,
      ma20: 103,
      aGradeCandidatesWaiting: 2,
    }));

    // Should recommend exit review or review exit
    expect(['REVIEW_EXIT', 'EXIT_REVIEW', 'TIGHTEN_STOP']).toContain(result.action);
    expect(result.explanation).toBeTruthy();
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('trend decay: catches weakening trend early', () => {
    const result = evaluatePosition(makePosition({
      rMultiple: 1.5,
      daysHeld: 15,
      currentPrice: 109,
      entryPrice: 100,
      currentStop: 100, // Breakeven
      adxToday: 22,
      adxYesterday: 30, // Big decline
      relativeStrength: 40,
      priorRelativeStrength: 60, // RS decay
      currentNCS: 45,
      priorNCS: 70, // NCS drop
      ma20: 107,
    }));

    expect(['TIGHTEN_STOP', 'REVIEW_EXIT', 'EXIT_REVIEW']).toContain(result.action);
    expect(result.scores.weakeningTrend).toBeGreaterThanOrEqual(40);
  });

  it('climax: detects blow-off top conditions', () => {
    const result = evaluatePosition(makePosition({
      rMultiple: 5.0,
      daysHeld: 20,
      currentPrice: 130,
      entryPrice: 100,
      currentStop: 106,
      ma20: 105,
      priceAboveMa20Pct: 23.8,
      volume: 5000000,
      avgVolume20: 1500000,
    }));

    expect(result.action).toBe('TRIM_REVIEW');
    expect(result.scores.climaxRisk).toBeGreaterThanOrEqual(50);
    expect(result.explanation).toContain('climax');
  });

  it('stop already optimal: no changes recommended', () => {
    const result = evaluatePosition(makePosition({
      rMultiple: 2.0,
      daysHeld: 12,
      currentPrice: 112,
      entryPrice: 100,
      currentStop: 106, // Already at a good level
      protectionLevel: 'LOCK_1R_TRAIL',
      adxToday: 28,
      adxYesterday: 27,
      ma20: 105,
      relativeStrength: 62,
      currentNCS: 72,
    }));

    expect(['HOLD', 'HOLD_AND_TRAIL']).toContain(result.action);
    expect(result.scores.exitReview).toBeLessThan(40);
  });

  it('missing data: produces safe result without crashing', () => {
    const result = evaluatePosition(makePosition({
      rMultiple: 1.0,
      daysHeld: 10,
      currentPrice: 106,
      entryPrice: 100,
      currentStop: 94,
      // No technicals at all
    }));

    expect(result.action).toBeTruthy();
    expect(result.ticker).toBe('AAPL');
    expect(result.requiresApproval).toBe(true);
    expect(result.explanation).toBeTruthy();
    expect(result.stopDistancePct).toBeGreaterThan(0);
    expect(result.givebackRiskR).toBeGreaterThan(0);
  });
});

// ── Batch Evaluation ──────────────────────────────────────────

describe('evaluateAllPositions', () => {
  it('sorts by action severity — EXIT_REVIEW before HOLD', () => {
    const positions = [
      makePosition({
        id: 'healthy', ticker: 'GOOD', rMultiple: 2.5, daysHeld: 10,
        adxToday: 30, adxYesterday: 28, ma20: 100, currentPrice: 115,
        relativeStrength: 70, currentNCS: 80,
        protectionLevel: 'LOCK_1R_TRAIL',
      }),
      makePosition({
        id: 'dying', ticker: 'BAD', rMultiple: 0.1, daysHeld: 25,
        adxToday: 15, adxYesterday: 25, ma20: 110, currentPrice: 101,
        relativeStrength: 25, priorRelativeStrength: 55,
        currentNCS: 30, priorNCS: 70,
        aGradeCandidatesWaiting: 3,
      }),
    ];

    const results = evaluateAllPositions(positions);

    // BAD should come first (needs attention)
    expect(results[0].ticker).toBe('BAD');
    expect(results[1].ticker).toBe('GOOD');
  });

  it('never lowers stops — stop distance always positive', () => {
    const positions = [
      makePosition({ id: 'p1', currentPrice: 110, currentStop: 100, rMultiple: 1.5 }),
      makePosition({ id: 'p2', currentPrice: 95, currentStop: 94, rMultiple: -0.8 }),
    ];

    const results = evaluateAllPositions(positions);
    for (const r of results) {
      expect(r.stopDistancePct).toBeGreaterThanOrEqual(0);
    }
  });

  it('always shows R-multiple and stop distance', () => {
    const positions = [
      makePosition({ id: 'p1', rMultiple: 2.5 }),
      makePosition({ id: 'p2', rMultiple: -0.3 }),
    ];

    const results = evaluateAllPositions(positions);
    for (const r of results) {
      expect(typeof r.rMultiple).toBe('number');
      expect(typeof r.stopDistancePct).toBe('number');
      expect(typeof r.givebackRiskR).toBe('number');
      expect(r.protectionLevel).toBeTruthy();
    }
  });

  it('HEDGE positions always get DO_NOT_TOUCH', () => {
    const positions = [
      makePosition({ id: 'h1', ticker: 'SQQQ', sleeve: 'HEDGE', rMultiple: -2.0, daysHeld: 60 }),
    ];

    const results = evaluateAllPositions(positions);
    expect(results[0].action).toBe('DO_NOT_TOUCH');
    expect(results[0].explanation).toContain('HEDGE');
  });

  it('never auto-exits — all results require approval', () => {
    const positions = [
      makePosition({ id: 'p1', rMultiple: -1.0, daysHeld: 40 }),
      makePosition({ id: 'p2', rMultiple: 5.0, daysHeld: 5 }),
    ];

    const results = evaluateAllPositions(positions);
    for (const r of results) {
      expect(r.requiresApproval).toBe(true);
    }
  });
});
