import { describe, it, expect } from 'vitest';
import { evaluateEarningsRisk } from './earnings-calendar';
import type { EarningsInfo } from './earnings-calendar';

function makeInfo(overrides: Partial<EarningsInfo> = {}): EarningsInfo {
  return {
    ticker: 'TEST',
    nextEarningsDate: new Date('2026-05-01'),
    daysUntilEarnings: 10,
    source: 'YAHOO',
    confidence: 'HIGH',
    ...overrides,
  };
}

describe('evaluateEarningsRisk', () => {
  // ── No risk scenarios ──

  it('returns no risk when daysUntilEarnings is null', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: null }));
    expect(result.hasEarningsRisk).toBe(false);
    expect(result.action).toBeNull();
  });

  it('returns no risk when confidence is NONE', () => {
    const result = evaluateEarningsRisk(makeInfo({ confidence: 'NONE', daysUntilEarnings: 1 }));
    expect(result.hasEarningsRisk).toBe(false);
    expect(result.action).toBeNull();
  });

  it('returns no risk when earnings already passed (negative days)', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: -3 }));
    expect(result.hasEarningsRisk).toBe(false);
    expect(result.action).toBeNull();
  });

  it('returns no risk when earnings > 5 days away', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 6 }));
    expect(result.hasEarningsRisk).toBe(false);
    expect(result.action).toBeNull();
  });

  it('returns no risk when earnings 10 days away', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 10 }));
    expect(result.hasEarningsRisk).toBe(false);
  });

  // ── High risk: ≤2 days + HIGH confidence → AUTO_NO ──

  it('blocks with AUTO_NO for 0 days + HIGH confidence', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 0, confidence: 'HIGH' }));
    expect(result.hasEarningsRisk).toBe(true);
    expect(result.action).toBe('AUTO_NO');
    expect(result.reason).toContain('too risky');
  });

  it('blocks with AUTO_NO for 1 day + HIGH confidence', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 1, confidence: 'HIGH' }));
    expect(result.hasEarningsRisk).toBe(true);
    expect(result.action).toBe('AUTO_NO');
    expect(result.reason).toContain('1 day');
  });

  it('blocks with AUTO_NO for 2 days + HIGH confidence', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 2, confidence: 'HIGH' }));
    expect(result.hasEarningsRisk).toBe(true);
    expect(result.action).toBe('AUTO_NO');
    expect(result.reason).toContain('2 days');
  });

  // ── ≤2 days + LOW confidence → DEMOTE_WATCH (warn, don't block) ──

  it('warns with DEMOTE_WATCH for 1 day + LOW confidence', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 1, confidence: 'LOW' }));
    expect(result.hasEarningsRisk).toBe(true);
    expect(result.action).toBe('DEMOTE_WATCH');
    expect(result.reason).toContain('unconfirmed');
  });

  it('warns with DEMOTE_WATCH for 2 days + LOW confidence', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 2, confidence: 'LOW' }));
    expect(result.action).toBe('DEMOTE_WATCH');
  });

  // ── 3-5 days → DEMOTE_WATCH (regardless of confidence) ──

  it('demotes for 3 days + HIGH confidence', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 3, confidence: 'HIGH' }));
    expect(result.hasEarningsRisk).toBe(true);
    expect(result.action).toBe('DEMOTE_WATCH');
    expect(result.reason).toContain('wait for result');
  });

  it('demotes for 5 days + LOW confidence', () => {
    const result = evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 5, confidence: 'LOW' }));
    expect(result.hasEarningsRisk).toBe(true);
    expect(result.action).toBe('DEMOTE_WATCH');
  });

  // ── Boundary: 5 → 6 transition ──

  it('demotes at exactly 5 days but not at 6', () => {
    expect(evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 5 })).hasEarningsRisk).toBe(true);
    expect(evaluateEarningsRisk(makeInfo({ daysUntilEarnings: 6 })).hasEarningsRisk).toBe(false);
  });

  // ── Result always includes info ──

  it('always includes original EarningsInfo in result', () => {
    const info = makeInfo({ ticker: 'AAPL', daysUntilEarnings: 1 });
    const result = evaluateEarningsRisk(info);
    expect(result.info).toBe(info);
    expect(result.info.ticker).toBe('AAPL');
  });
});
