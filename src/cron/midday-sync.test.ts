/**
 * Tests for the pure drift evaluator extracted from midday-sync.ts.
 * Guards against silent regression of the same-day duplication-detection
 * heuristic introduced after the 2026-05-01 "9 vs 6" incident.
 */
import { describe, it, expect } from 'vitest';
import { evaluatePositionDrift, POSITION_DRIFT_THRESHOLD } from './midday-sync';

describe('evaluatePositionDrift', () => {
  it('returns no-alert when there is no prior measurement', () => {
    const r = evaluatePositionDrift(null, 6);
    expect(r.shouldAlert).toBe(false);
    expect(r.delta).toBe(0);
    expect(r.direction).toBe('unchanged');
  });

  it('returns no-alert when count is unchanged', () => {
    const r = evaluatePositionDrift(6, 6);
    expect(r.shouldAlert).toBe(false);
    expect(r.delta).toBe(0);
    expect(r.direction).toBe('unchanged');
  });

  it('does not alert at the threshold (exclusive)', () => {
    // Threshold=2 → delta=2 must NOT alert. Allows a normal day with one buy
    // and one exit to pass quietly.
    const r = evaluatePositionDrift(6, 8);
    expect(r.delta).toBe(POSITION_DRIFT_THRESHOLD);
    expect(r.shouldAlert).toBe(false);
  });

  it('alerts when increase exceeds the threshold (3 → 9 from the original incident)', () => {
    const r = evaluatePositionDrift(3, 9);
    expect(r.shouldAlert).toBe(true);
    expect(r.delta).toBe(6);
    expect(r.direction).toBe('increased');
  });

  it('alerts when decrease exceeds the threshold (collapsed-holdings case)', () => {
    const r = evaluatePositionDrift(9, 3);
    expect(r.shouldAlert).toBe(true);
    expect(r.delta).toBe(6);
    expect(r.direction).toBe('decreased');
  });

  it('respects a custom threshold override', () => {
    // With threshold=5, the same 3→6 swing that would fail under the default
    // threshold (delta=3 > 2) must now pass.
    const r = evaluatePositionDrift(3, 6, 5);
    expect(r.delta).toBe(3);
    expect(r.shouldAlert).toBe(false);
  });

  it('always reports a non-negative delta regardless of direction', () => {
    expect(evaluatePositionDrift(10, 4).delta).toBe(6);
    expect(evaluatePositionDrift(4, 10).delta).toBe(6);
  });
});
