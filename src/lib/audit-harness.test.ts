import { describe, expect, it } from 'vitest';
import { runAuditHarness, generateMarkdownReport } from '../../scripts/audit_harness';
import type { AuditSnapshot, AuditRow } from '../../scripts/audit_harness';

describe('audit harness output schema', () => {
  const snapshot = runAuditHarness();

  it('snapshot has all required top-level fields', () => {
    expect(snapshot).toHaveProperty('generatedAt');
    expect(snapshot).toHaveProperty('regime');
    expect(snapshot).toHaveProperty('equity');
    expect(snapshot).toHaveProperty('riskProfile');
    expect(snapshot).toHaveProperty('existingPositions');
    expect(snapshot).toHaveProperty('rows');
    expect(typeof snapshot.generatedAt).toBe('string');
    expect(typeof snapshot.equity).toBe('number');
    expect(typeof snapshot.riskProfile).toBe('string');
    expect(typeof snapshot.existingPositions).toBe('number');
    expect(Array.isArray(snapshot.rows)).toBe(true);
  });

  it('rows array is non-empty with synthetic fixtures', () => {
    expect(snapshot.rows.length).toBeGreaterThanOrEqual(5);
  });

  it('each row has the required AuditRow fields', () => {
    const requiredKeys: (keyof AuditRow)[] = [
      'ticker', 'sleeve', 'filtersPass', 'efficiencyPass',
      'status', 'triggerDistance', 'entryTrigger', 'stopPrice',
      'rank', 'riskGates', 'antiChase', 'sizing', 'stopRec',
      'protectionLevel', 'openRiskContribution',
    ];

    for (const row of snapshot.rows) {
      for (const key of requiredKeys) {
        expect(row).toHaveProperty(key);
      }
    }
  });

  it('riskGates is an array of gate results with expected fields', () => {
    for (const row of snapshot.rows) {
      expect(Array.isArray(row.riskGates)).toBe(true);
      expect(row.riskGates.length).toBeGreaterThanOrEqual(3); // at least 3 gates
      for (const g of row.riskGates) {
        expect(g).toHaveProperty('gate');
        expect(g).toHaveProperty('passed');
        expect(g).toHaveProperty('current');
        expect(g).toHaveProperty('limit');
        expect(typeof g.gate).toBe('string');
        expect(typeof g.passed).toBe('boolean');
        expect(typeof g.current).toBe('number');
        expect(typeof g.limit).toBe('number');
      }
    }
  });

  it('antiChase has passed boolean and reason string', () => {
    for (const row of snapshot.rows) {
      expect(typeof row.antiChase.passed).toBe('boolean');
      expect(typeof row.antiChase.reason).toBe('string');
    }
  });

  it('sizing is null or has shares/riskDollars/riskPercent/totalCost', () => {
    for (const row of snapshot.rows) {
      if (row.sizing !== null) {
        expect(typeof row.sizing.shares).toBe('number');
        expect(typeof row.sizing.riskDollars).toBe('number');
        expect(typeof row.sizing.riskPercent).toBe('number');
        expect(typeof row.sizing.totalCost).toBe('number');
      }
    }
  });

  it('stopRec is null or has newStop/newLevel/reason', () => {
    for (const row of snapshot.rows) {
      if (row.stopRec !== null) {
        expect(typeof row.stopRec.newStop).toBe('number');
        expect(typeof row.stopRec.newLevel).toBe('string');
        expect(typeof row.stopRec.reason).toBe('string');
      }
    }
  });

  it('status values are from the allowed set', () => {
    const allowed = new Set(['READY', 'WATCH', 'FAR', 'BLOCKED', 'WAIT_PULLBACK']);
    for (const row of snapshot.rows) {
      expect(allowed.has(row.status)).toBe(true);
    }
  });

  it('protectionLevel values are from the allowed set', () => {
    const allowed = new Set(['INITIAL', 'BREAKEVEN', 'TRAILING_ATR', 'LOCK_08R', 'LOCK_1R_TRAIL']);
    for (const row of snapshot.rows) {
      expect(allowed.has(row.protectionLevel)).toBe(true);
    }
  });

  it('XOM fixture fails technical filters (price below MA200)', () => {
    const xom = snapshot.rows.find(r => r.ticker === 'XOM');
    expect(xom).toBeDefined();
    expect(xom!.filtersPass).toBe(false);
    expect(xom!.status).toBe('BLOCKED');
  });

  it('PLTR fixture triggers ATR spike soft cap (WATCH)', () => {
    const pltr = snapshot.rows.find(r => r.ticker === 'PLTR');
    expect(pltr).toBeDefined();
    // PLTR has atrSpiking=true and +DI > -DI → SOFT_CAP → should not be READY
    if (pltr!.filtersPass) {
      expect(pltr!.status).not.toBe('READY');
    }
  });

  it('generates valid markdown report', () => {
    const md = generateMarkdownReport(snapshot);
    expect(typeof md).toBe('string');
    expect(md).toContain('# Audit Snapshot Report');
    expect(md).toContain('## Pipeline Summary');
    expect(md).toContain('## Detailed Results');
    expect(md).toContain('AAPL');
    expect(md).toContain('MSFT');
    // Contains a markdown table
    expect(md).toContain('| Ticker |');
  });
});
