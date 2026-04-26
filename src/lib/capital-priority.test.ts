import { describe, expect, it } from 'vitest';
import { rankCapitalActions, type CapitalPriorityInput, type OpenPositionSummary, type CandidateSummary } from './capital-priority';

const basePosition: OpenPositionSummary = {
  ticker: 'AAPL', rMultiple: 1.0, holdDays: 10, trendHealthy: true,
  stopPending: false, isLaggard: false, protectionLevel: 'BREAKEVEN', sleeve: 'CORE',
};

const baseCandidate: CandidateSummary = {
  ticker: 'MSFT', grade: 'A_GRADE_BUY', ncs: 75, triggerMet: true,
};

const baseInput: CapitalPriorityInput = {
  positions: [], candidates: [], operatingMode: 'NORMAL',
  riskBudgetUsedPct: 50, canEnter: true,
};

describe('capital-priority', () => {
  it('returns NO_ACTION when no positions and no candidates', () => {
    const result = rankCapitalActions(baseInput);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('NO_ACTION');
  });

  it('prioritises stop updates above everything', () => {
    const result = rankCapitalActions({
      ...baseInput,
      positions: [
        { ...basePosition, ticker: 'AAPL', stopPending: true },
        { ...basePosition, ticker: 'GOOG', isLaggard: true },
      ],
      candidates: [baseCandidate],
    });
    expect(result[0].action).toBe('TIGHTEN_STOP');
    expect(result[0].ticker).toBe('AAPL');
  });

  it('ranks exit review above new buys', () => {
    const result = rankCapitalActions({
      ...baseInput,
      positions: [{ ...basePosition, isLaggard: true, rMultiple: -0.3 }],
      candidates: [baseCandidate],
    });
    const exitIdx = result.findIndex(a => a.action === 'EXIT_REVIEW');
    const buyIdx = result.findIndex(a => a.action === 'BUY_A_GRADE');
    expect(exitIdx).toBeLessThan(buyIdx);
  });

  it('does not suggest buys in CAPITAL_PRESERVATION mode', () => {
    const result = rankCapitalActions({
      ...baseInput,
      operatingMode: 'CAPITAL_PRESERVATION',
      candidates: [baseCandidate],
      positions: [basePosition],
    });
    expect(result.find(a => a.action === 'BUY_A_GRADE')).toBeUndefined();
  });

  it('does not suggest pyramids in CAPITAL_PRESERVATION mode', () => {
    const result = rankCapitalActions({
      ...baseInput,
      operatingMode: 'CAPITAL_PRESERVATION',
      positions: [{ ...basePosition, rMultiple: 3.0 }],
    });
    expect(result.find(a => a.action === 'PYRAMID_WINNER')).toBeUndefined();
  });

  it('suggests pyramid for 2R+ winner with healthy trend', () => {
    const result = rankCapitalActions({
      ...baseInput,
      riskBudgetUsedPct: 40,
      positions: [{ ...basePosition, rMultiple: 2.5, trendHealthy: true }],
    });
    expect(result.find(a => a.action === 'PYRAMID_WINNER')).toBeDefined();
  });

  it('does not suggest pyramid when risk budget > 70%', () => {
    const result = rankCapitalActions({
      ...baseInput,
      riskBudgetUsedPct: 75,
      positions: [{ ...basePosition, rMultiple: 2.5 }],
    });
    expect(result.find(a => a.action === 'PYRAMID_WINNER')).toBeUndefined();
  });

  it('suggests swap when laggard + A-grade available', () => {
    const result = rankCapitalActions({
      ...baseInput,
      positions: [{ ...basePosition, isLaggard: true, rMultiple: -0.5 }],
      candidates: [baseCandidate],
    });
    expect(result.find(a => a.action === 'SWAP_WEAK_FOR_STRONG')).toBeDefined();
  });

  it('all real-money actions require approval', () => {
    const result = rankCapitalActions({
      ...baseInput,
      positions: [{ ...basePosition, isLaggard: true, rMultiple: -0.5, stopPending: true }],
      candidates: [baseCandidate],
    });
    const realMoneyActions = result.filter(a =>
      ['BUY_A_GRADE', 'PYRAMID_WINNER', 'SWAP_WEAK_FOR_STRONG', 'EXIT_REVIEW'].includes(a.action)
    );
    for (const a of realMoneyActions) {
      expect(a.requiresApproval).toBe(true);
    }
  });

  it('HOLD actions do not require approval', () => {
    const result = rankCapitalActions({
      ...baseInput,
      positions: [basePosition],
    });
    const holds = result.filter(a => a.action === 'HOLD');
    for (const h of holds) {
      expect(h.requiresApproval).toBe(false);
    }
  });
});
