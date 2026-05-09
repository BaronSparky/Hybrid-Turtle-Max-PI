import { describe, expect, it } from 'vitest';
import { calcSyncedPositionRisk } from './synced-position-risk';

describe('calcSyncedPositionRisk', () => {
  it('returns 5%-of-entry default when no known stop is supplied (legacy parity)', () => {
    const r = calcSyncedPositionRisk(20.39625);
    expect(r.source).toBe('DEFAULT_5PCT');
    expect(r.initialRisk).toBeCloseTo(1.0198125, 7);
    expect(r.stopLoss).toBeCloseTo(19.3764375, 7);
  });

  it('treats explicit null and undefined the same as no argument', () => {
    expect(calcSyncedPositionRisk(100, null).source).toBe('DEFAULT_5PCT');
    expect(calcSyncedPositionRisk(100, undefined).source).toBe('DEFAULT_5PCT');
    expect(calcSyncedPositionRisk(100, null).stopLoss).toBe(95);
  });

  it('honours a sane known stop strictly between 0 and entry', () => {
    const r = calcSyncedPositionRisk(20.39625, 19.81);
    expect(r.source).toBe('KNOWN_STOP');
    expect(r.stopLoss).toBe(19.81);
    expect(r.initialRisk).toBeCloseTo(0.58625, 5);
  });

  it('falls back to default when known stop is >= entry', () => {
    expect(calcSyncedPositionRisk(20, 20).source).toBe('DEFAULT_5PCT');
    expect(calcSyncedPositionRisk(20, 25).source).toBe('DEFAULT_5PCT');
  });

  it('falls back to default when known stop is <= 0', () => {
    expect(calcSyncedPositionRisk(20, 0).source).toBe('DEFAULT_5PCT');
    expect(calcSyncedPositionRisk(20, -5).source).toBe('DEFAULT_5PCT');
  });

  it('falls back to default when known stop is non-finite', () => {
    expect(calcSyncedPositionRisk(20, NaN).source).toBe('DEFAULT_5PCT');
    expect(calcSyncedPositionRisk(20, Infinity).source).toBe('DEFAULT_5PCT');
  });

  it('throws on non-positive entry price', () => {
    expect(() => calcSyncedPositionRisk(0)).toThrow();
    expect(() => calcSyncedPositionRisk(-1)).toThrow();
    expect(() => calcSyncedPositionRisk(NaN)).toThrow();
  });
});
