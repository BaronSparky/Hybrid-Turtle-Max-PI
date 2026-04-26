import { describe, expect, it } from 'vitest';
import {
  evaluateOpportunityCost,
  evaluateWinnerExpansion,
  reviewDeadMoney,
  rankActions,
  type HeldPosition,
  type ReadyCandidate,
  type AcceleratorContext,
} from './profit-accelerator';

// ── Test Helpers ──────────────────────────────────────────────

function makePosition(overrides: Partial<HeldPosition> = {}): HeldPosition {
  return {
    id: 'pos-1',
    ticker: 'AAPL',
    sleeve: 'CORE',
    sector: 'Tech',
    cluster: 'US_MEGA',
    entryPrice: 100,
    currentPrice: 105,
    currentStop: 94,
    shares: 10,
    initialRisk: 6,
    entryDate: new Date(Date.now() - 20 * 86400000), // 20 days ago
    daysHeld: 20,
    rMultiple: 0.83,
    atr: 3,
    currency: 'USD',
    pyramidAdds: 0,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ReadyCandidate> = {}): ReadyCandidate {
  return {
    ticker: 'MSFT',
    sleeve: 'CORE',
    sector: 'Tech',
    cluster: 'US_MEGA',
    ncs: 82,
    fws: 18,
    actionNote: 'Auto-Yes',
    entryTrigger: 350,
    stopPrice: 340,
    riskDollars: 100,
    totalCost: 3500,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AcceleratorContext> = {}): AcceleratorContext {
  return {
    positions: [makePosition()],
    candidates: [makeCandidate()],
    equity: 10000,
    riskProfile: 'SMALL_ACCOUNT',
    regime: 'BULLISH',
    openRiskPercent: 4.0,
    ...overrides,
  };
}

// ── Opportunity Cost Engine ──────────────────────────────────

describe('evaluateOpportunityCost', () => {
  it('recommends swap when A-grade is blocked by weak position at max capacity', () => {
    const positions = [
      makePosition({ id: 'p1', ticker: 'WEAK1', rMultiple: 0.1, daysHeld: 15, currentNCS: 45 }),
      makePosition({ id: 'p2', ticker: 'OK1', rMultiple: 1.5, daysHeld: 10, currentNCS: 70 }),
      makePosition({ id: 'p3', ticker: 'OK2', rMultiple: 0.8, daysHeld: 8, currentNCS: 65 }),
      makePosition({ id: 'p4', ticker: 'OK3', rMultiple: 1.2, daysHeld: 12, currentNCS: 72 }),
    ];
    const candidates = [makeCandidate({ ticker: 'STRONG', ncs: 85, fws: 15 })];

    const results = evaluateOpportunityCost(positions, candidates, 4);

    expect(results).toHaveLength(1);
    expect(results[0].blockedTicker).toBe('STRONG');
    expect(results[0].holdingTicker).toBe('WEAK1');
    expect(results[0].swapRecommended).toBe(true);
    expect(results[0].ncsGap).toBe(40); // 85 - 45
  });

  it('does not recommend swap when no A-grade candidates', () => {
    const positions = [
      makePosition({ id: 'p1', rMultiple: 0.1, currentNCS: 45 }),
      makePosition({ id: 'p2', rMultiple: 0.5, currentNCS: 50 }),
      makePosition({ id: 'p3', rMultiple: 0.3, currentNCS: 48 }),
      makePosition({ id: 'p4', rMultiple: 0.4, currentNCS: 52 }),
    ];
    const candidates = [makeCandidate({ ncs: 55, fws: 40 })]; // Not A-grade

    const results = evaluateOpportunityCost(positions, candidates, 4);

    expect(results).toHaveLength(0);
  });

  it('does not recommend swap when slots available', () => {
    const positions = [makePosition({ rMultiple: 0.1, currentNCS: 30 })];
    const candidates = [makeCandidate({ ncs: 90, fws: 10 })];

    // maxPositions = 4, only 1 held → slots available
    const results = evaluateOpportunityCost(positions, candidates, 4);

    expect(results).toHaveLength(0);
  });

  it('does not recommend swap when NCS gap is too small', () => {
    const positions = [
      makePosition({ id: 'p1', rMultiple: 0.1, daysHeld: 15, currentNCS: 60 }),
      makePosition({ id: 'p2', rMultiple: 0.5, daysHeld: 10, currentNCS: 70 }),
      makePosition({ id: 'p3', rMultiple: 0.3, daysHeld: 8, currentNCS: 65 }),
      makePosition({ id: 'p4', rMultiple: 0.4, daysHeld: 12, currentNCS: 68 }),
    ];
    const candidates = [makeCandidate({ ncs: 75, fws: 20 })]; // NCS gap = 15 < 25

    const results = evaluateOpportunityCost(positions, candidates, 4);

    expect(results).toHaveLength(0);
  });

  it('skips positions held fewer than 5 days', () => {
    const positions = [
      makePosition({ id: 'p1', rMultiple: 0.1, daysHeld: 3, currentNCS: 30 }),
      makePosition({ id: 'p2', rMultiple: 0.5, daysHeld: 10, currentNCS: 70 }),
      makePosition({ id: 'p3', rMultiple: 0.3, daysHeld: 8, currentNCS: 65 }),
      makePosition({ id: 'p4', rMultiple: 0.4, daysHeld: 12, currentNCS: 68 }),
    ];
    const candidates = [makeCandidate({ ncs: 90, fws: 10 })]; // Big gap but pos too fresh

    const results = evaluateOpportunityCost(positions, candidates, 4);

    expect(results).toHaveLength(0);
  });
});

// ── Winner Expansion Engine ──────────────────────────────────

describe('evaluateWinnerExpansion', () => {
  it('allows pyramid when all conditions met', () => {
    const positions = [makePosition({
      rMultiple: 1.5,
      currentPrice: 109,
      entryPrice: 100,
      initialRisk: 6,
      atr: 3,
      pyramidAdds: 0,
      currentNCS: 80,
      adxToday: 35,
      adxYesterday: 33,
    })];

    const results = evaluateWinnerExpansion(positions, 10000, 'SMALL_ACCOUNT', 4.0);

    expect(results).toHaveLength(1);
    expect(results[0].allowed).toBe(true);
    expect(results[0].riskScalar).toBe(0.5); // First add = 50%
  });

  it('blocks pyramid when ADX declining', () => {
    const positions = [makePosition({
      rMultiple: 1.5,
      currentPrice: 109,
      entryPrice: 100,
      initialRisk: 6,
      atr: 3,
      pyramidAdds: 0,
      currentNCS: 80,
      adxToday: 25,
      adxYesterday: 30, // Declining
    })];

    const results = evaluateWinnerExpansion(positions, 10000, 'SMALL_ACCOUNT', 4.0);

    expect(results).toHaveLength(1);
    expect(results[0].allowed).toBe(false);
    expect(results[0].reason).toContain('ADX declining');
  });

  it('blocks pyramid when NCS below A-grade', () => {
    const positions = [makePosition({
      rMultiple: 1.5,
      currentPrice: 109,
      entryPrice: 100,
      initialRisk: 6,
      atr: 3,
      pyramidAdds: 0,
      currentNCS: 55, // Below 70
      adxToday: 35,
      adxYesterday: 33,
    })];

    const results = evaluateWinnerExpansion(positions, 10000, 'SMALL_ACCOUNT', 4.0);

    expect(results).toHaveLength(1);
    expect(results[0].allowed).toBe(false);
    expect(results[0].reason).toContain('NCS');
  });

  it('skips non-profitable positions', () => {
    const positions = [makePosition({ rMultiple: -0.5 })];

    const results = evaluateWinnerExpansion(positions, 10000, 'SMALL_ACCOUNT', 4.0);

    expect(results).toHaveLength(0);
  });

  it('blocks when risk budget too full', () => {
    const positions = [makePosition({
      rMultiple: 1.5,
      currentPrice: 109,
      entryPrice: 100,
      initialRisk: 6,
      atr: 3,
      pyramidAdds: 0,
      currentNCS: 80,
      adxToday: 35,
      adxYesterday: 33,
    })];

    // 8% of 10% max = 80% → exceeds 70% threshold
    const results = evaluateWinnerExpansion(positions, 10000, 'SMALL_ACCOUNT', 8.0);

    expect(results).toHaveLength(1);
    expect(results[0].allowed).toBe(false);
    expect(results[0].reason).toContain('Risk budget');
  });
});

// ── Dead Money Exit Review ──────────────────────────────────

describe('reviewDeadMoney', () => {
  it('flags dead money position with multiple deterioration signals', () => {
    const positions = [makePosition({
      rMultiple: 0.3,
      daysHeld: 35,
      currentPrice: 97,
      entryPrice: 100,
      relativeStrength: 30,
      priorRelativeStrength: 55, // RS decay > 10
      currentNCS: 40, // Below 50
      adxToday: 20,
      adxYesterday: 25, // Declining
    })];
    const candidates = [makeCandidate({ ncs: 85, fws: 15 })];

    const results = reviewDeadMoney(positions, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].rsDecay).toBe(true);
    expect(results[0].ncsDeterioration).toBe(true);
    expect(results[0].trendDeteriorating).toBe(true);
    expect(results[0].exitUrgency).toBe('HIGH');
    expect(results[0].reason).toContain('relative strength');
    expect(results[0].reason).toContain('NCS');
    expect(results[0].reason).toContain('ADX');
  });

  it('returns nothing for healthy positions', () => {
    const positions = [makePosition({
      rMultiple: 2.0,
      daysHeld: 5,
      currentPrice: 112,
    })];

    const results = reviewDeadMoney(positions, []);

    expect(results).toHaveLength(0);
  });

  it('detects opportunity cost from waiting A-grade candidates', () => {
    const positions = [makePosition({
      rMultiple: 0.2,
      daysHeld: 12,
      currentPrice: 99,
      entryPrice: 100,
    })];
    const candidates = [
      makeCandidate({ ticker: 'A1', ncs: 85, fws: 15 }),
      makeCandidate({ ticker: 'A2', ncs: 78, fws: 22 }),
    ];

    const results = reviewDeadMoney(positions, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].opportunityCostScore).toBeGreaterThan(0);
    expect(results[0].reason).toContain('A-grade');
  });

  it('skips HEDGE positions', () => {
    const positions = [makePosition({ sleeve: 'HEDGE', rMultiple: -1.0, daysHeld: 60 })];

    const results = reviewDeadMoney(positions, []);

    expect(results).toHaveLength(0);
  });
});

// ── Capital Priority Engine (Orchestrator) ──────────────────

describe('rankActions', () => {
  it('recommends BUY_NEW_A_GRADE when slots and risk available', () => {
    const ctx = makeContext({
      positions: [makePosition()], // 1 of 4 slots used
      candidates: [makeCandidate({ ncs: 85, fws: 15 })],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);
    const buyAction = results.find((r) => r.action === 'BUY_NEW_A_GRADE');

    expect(buyAction).toBeDefined();
    expect(buyAction!.urgency).toBe('HIGH');
    expect(buyAction!.requiresApproval).toBe(true);
  });

  it('does not recommend buy in BEARISH regime', () => {
    const ctx = makeContext({
      regime: 'BEARISH',
      positions: [], // All slots available
      candidates: [makeCandidate({ ncs: 90, fws: 10 })],
    });

    const results = rankActions(ctx);
    const buyAction = results.find((r) => r.action === 'BUY_NEW_A_GRADE');

    expect(buyAction).toBeUndefined();
  });

  it('does not recommend buy when at max positions', () => {
    const ctx = makeContext({
      positions: [
        makePosition({ id: 'p1', ticker: 'A' }),
        makePosition({ id: 'p2', ticker: 'B' }),
        makePosition({ id: 'p3', ticker: 'C' }),
        makePosition({ id: 'p4', ticker: 'D' }),
      ], // 4 of 4 (SMALL_ACCOUNT max)
      candidates: [makeCandidate({ ncs: 90, fws: 10 })],
    });

    const results = rankActions(ctx);
    const buyAction = results.find((r) => r.action === 'BUY_NEW_A_GRADE');

    expect(buyAction).toBeUndefined();
  });

  it('returns NO_ACTION when nothing to do', () => {
    const ctx = makeContext({
      positions: [],
      candidates: [],
      regime: 'BEARISH',
    });

    const results = rankActions(ctx);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('NO_ACTION');
  });

  it('sorts recommendations by priority descending', () => {
    const ctx = makeContext({
      positions: [makePosition({ rMultiple: 0.1, daysHeld: 40, currentPrice: 95, entryPrice: 100 })],
      candidates: [makeCandidate({ ncs: 85, fws: 15 })],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].priority).toBeGreaterThanOrEqual(results[i].priority);
    }
  });

  it('all recommendations require human approval except HOLD and NO_ACTION', () => {
    const ctx = makeContext({
      positions: [
        makePosition({ rMultiple: 2.0, daysHeld: 5, currentPrice: 112 }), // HOLD candidate
      ],
      candidates: [makeCandidate({ ncs: 85, fws: 15 })],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);

    for (const r of results) {
      if (r.action !== 'HOLD' && r.action !== 'NO_ACTION') {
        expect(r.requiresApproval).toBe(true);
      }
    }
  });

  it('never recommends non-A-grade candidates for buy', () => {
    const ctx = makeContext({
      candidates: [
        makeCandidate({ ticker: 'WEAK', ncs: 55, fws: 40 }),
        makeCandidate({ ticker: 'MARGINAL', ncs: 65, fws: 25 }),
      ],
      openRiskPercent: 2.0,
    });

    const results = rankActions(ctx);
    const buyActions = results.filter((r) => r.action === 'BUY_NEW_A_GRADE');

    expect(buyActions).toHaveLength(0);
  });

  it('limits new buys to available slots', () => {
    const ctx = makeContext({
      positions: [
        makePosition({ id: 'p1', ticker: 'A' }),
        makePosition({ id: 'p2', ticker: 'B' }),
        makePosition({ id: 'p3', ticker: 'C' }),
      ], // 3 of 4 = 1 slot
      candidates: [
        makeCandidate({ ticker: 'X', ncs: 90, fws: 10 }),
        makeCandidate({ ticker: 'Y', ncs: 85, fws: 15 }),
        makeCandidate({ ticker: 'Z', ncs: 80, fws: 20 }),
      ],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);
    const buyActions = results.filter((r) => r.action === 'BUY_NEW_A_GRADE');

    expect(buyActions).toHaveLength(1); // Only 1 slot available
    expect(buyActions[0].ticker).toBe('X'); // Highest NCS first
  });

  it('recommends SWAP_WEAK_FOR_STRONG when at max positions with weak holders', () => {
    const ctx = makeContext({
      positions: [
        makePosition({ id: 'p1', ticker: 'WEAK', rMultiple: 0.1, daysHeld: 15, currentNCS: 40 }),
        makePosition({ id: 'p2', ticker: 'OK1', rMultiple: 1.5, daysHeld: 10, currentNCS: 70 }),
        makePosition({ id: 'p3', ticker: 'OK2', rMultiple: 0.8, daysHeld: 8, currentNCS: 65 }),
        makePosition({ id: 'p4', ticker: 'OK3', rMultiple: 1.2, daysHeld: 12, currentNCS: 72 }),
      ],
      candidates: [makeCandidate({ ticker: 'STRONG', ncs: 85, fws: 15 })],
      openRiskPercent: 5.0,
    });

    const results = rankActions(ctx);
    const swapAction = results.find((r) => r.action === 'SWAP_WEAK_FOR_STRONG');

    expect(swapAction).toBeDefined();
    expect(swapAction!.ticker).toBe('WEAK');
    expect(swapAction!.replacementTicker).toBe('STRONG');
    expect(swapAction!.requiresApproval).toBe(true);
  });

  it('recommends EXIT_LAGGARD for dead money with deterioration signals', () => {
    const ctx = makeContext({
      positions: [makePosition({
        id: 'p1',
        ticker: 'DEAD',
        rMultiple: 0.2,
        daysHeld: 35,
        currentPrice: 97,
        entryPrice: 100,
        relativeStrength: 30,
        priorRelativeStrength: 55,
        currentNCS: 40,
        adxToday: 20,
        adxYesterday: 25,
      })],
      candidates: [makeCandidate({ ncs: 85, fws: 15 })],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);
    const exitAction = results.find((r) => r.action === 'EXIT_LAGGARD');

    expect(exitAction).toBeDefined();
    expect(exitAction!.ticker).toBe('DEAD');
    expect(exitAction!.urgency).toBe('HIGH');
  });

  it('recommends PYRAMID_WINNER when conditions met', () => {
    const ctx = makeContext({
      positions: [makePosition({
        id: 'p1',
        ticker: 'WINNER',
        rMultiple: 1.5,
        currentPrice: 109,
        entryPrice: 100,
        initialRisk: 6,
        atr: 3,
        pyramidAdds: 0,
        currentNCS: 80,
        adxToday: 35,
        adxYesterday: 33,
      })],
      candidates: [],
      openRiskPercent: 4.0,
    });

    const results = rankActions(ctx);
    const pyramidAction = results.find((r) => r.action === 'PYRAMID_WINNER');

    expect(pyramidAction).toBeDefined();
    expect(pyramidAction!.ticker).toBe('WINNER');
    expect(pyramidAction!.requiresApproval).toBe(true);
  });

  it('never exceeds max positions for new buys', () => {
    // SMALL_ACCOUNT maxPositions = 4
    const ctx = makeContext({
      positions: [
        makePosition({ id: 'p1', ticker: 'A' }),
        makePosition({ id: 'p2', ticker: 'B' }),
        makePosition({ id: 'p3', ticker: 'C' }),
        makePosition({ id: 'p4', ticker: 'D' }),
      ],
      candidates: [
        makeCandidate({ ticker: 'X', ncs: 95, fws: 5 }),
      ],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);
    const buyActions = results.filter((r) => r.action === 'BUY_NEW_A_GRADE');

    // At max positions — no buys allowed even for perfect candidate
    expect(buyActions).toHaveLength(0);
  });

  it('never exceeds max open risk for new buys', () => {
    const ctx = makeContext({
      positions: [makePosition({ id: 'p1', ticker: 'A' })],
      candidates: [makeCandidate({ ticker: 'X', ncs: 90, fws: 10 })],
      openRiskPercent: 10.5, // Over SMALL_ACCOUNT maxOpenRisk of 10%
    });

    const results = rankActions(ctx);
    const buyActions = results.filter((r) => r.action === 'BUY_NEW_A_GRADE');

    expect(buyActions).toHaveLength(0);
  });

  it('includes expected benefit and risk impact on every recommendation', () => {
    const ctx = makeContext({
      positions: [makePosition({ rMultiple: 2.0, daysHeld: 5, currentPrice: 112 })],
      candidates: [makeCandidate({ ncs: 85, fws: 15 })],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);

    for (const r of results) {
      expect(r.expectedBenefit).toBeTruthy();
      expect(r.riskImpact).toBeTruthy();
      expect(r.reason).toBeTruthy();
    }
  });

  it('handles mixed scenario: buy + hold + tighten', () => {
    const ctx = makeContext({
      positions: [
        makePosition({
          id: 'p1',
          ticker: 'HEALTHY',
          rMultiple: 1.5,
          daysHeld: 10,
          currentPrice: 109,
        }),
        makePosition({
          id: 'p2',
          ticker: 'WEAK',
          rMultiple: 0.2,
          daysHeld: 12,
          currentPrice: 99,
          entryPrice: 100,
          currentNCS: 45,
          adxToday: 22,
          adxYesterday: 24,
        }),
      ],
      candidates: [makeCandidate({ ticker: 'STRONG', ncs: 85, fws: 15 })],
      openRiskPercent: 3.0,
    });

    const results = rankActions(ctx);

    // Should have a buy (slots available), a tighten/exit for WEAK, and a hold for HEALTHY
    const actions = new Set(results.map((r) => r.action));
    expect(actions.has('BUY_NEW_A_GRADE')).toBe(true);
    expect(actions.has('HOLD') || actions.has('TIGHTEN_STOP') || actions.has('EXIT_LAGGARD')).toBe(true);
  });
});
