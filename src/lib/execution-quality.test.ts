import { describe, expect, it } from 'vitest';
import { gradeExecution, summarizeExecutionQuality, type ExecutionGradeResult } from './execution-quality';
import type { ExecutionAuditRow } from './execution-audit';

function makeRow(overrides: Partial<ExecutionAuditRow> = {}): ExecutionAuditRow {
  return {
    tradeLogId: 't1', ticker: 'AAPL', sleeve: 'CORE', tradeDate: '2026-01-01',
    regime: 'BULLISH', plannedEntry: 150, scanRefPrice: 150, actualFill: 150.1,
    fillTimestamp: null, fillDelayMinutes: null, expectedStop: 140, actualInitialStop: 140,
    stopDiffPct: 0, expectedShares: 10, actualShares: 10, sizeDiffPct: 0,
    expectedRiskGbp: 100, actualRiskGbp: 100, riskDiffPct: 0,
    slippagePct: 0.07, slippageR: 0.01, antiChaseTriggered: false,
    wouldViolateAntiChase: false, riskRulesMetPostFill: true, dataFreshness: 'LIVE',
    materialSlippage: false, materialStopDiff: false, materialSizeDiff: false,
    ...overrides,
  };
}

describe('execution-quality', () => {
  it('grades excellent fills as A', () => {
    const result = gradeExecution(makeRow({ slippagePct: 0.05, slippageR: 0.02 }));
    expect(result.grade).toBe('A');
  });

  it('grades moderate slippage as C', () => {
    const result = gradeExecution(makeRow({ slippagePct: 0.4, slippageR: 0.12 }));
    expect(result.grade).toBe('C');
  });

  it('grades high slippage as D', () => {
    const result = gradeExecution(makeRow({ slippagePct: 0.8, slippageR: 0.3 }));
    expect(result.grade).toBe('D');
  });

  it('grades anti-chase violation as F', () => {
    const result = gradeExecution(makeRow({ wouldViolateAntiChase: true }));
    expect(result.grade).toBe('F');
  });

  it('summarizes empty set without errors', () => {
    const summary = summarizeExecutionQuality([]);
    expect(summary.totalTrades).toBe(0);
    expect(summary.recommendation).toContain('No trades');
  });

  it('summarizes multiple trades', () => {
    const rows = [
      makeRow({ slippagePct: 0.05, slippageR: 0.01 }),
      makeRow({ slippagePct: 0.4, slippageR: 0.12, materialSlippage: true }),
    ];
    const summary = summarizeExecutionQuality(rows);
    expect(summary.totalTrades).toBe(2);
    expect(summary.gradeDistribution.A).toBe(1);
    expect(summary.materialSlippageRate).toBe(0.5);
  });
});
