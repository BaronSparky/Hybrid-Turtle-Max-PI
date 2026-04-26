import { describe, it, expect } from 'vitest';
import { getExecutionMode } from './execution-mode';

describe('getExecutionMode', () => {
  // ── Sunday ──
  it('Sunday: PLANNING, no entry', () => {
    const result = getExecutionMode(0, 'BULLISH');
    expect(result.mode).toBe('PLANNING');
    expect(result.canEnter).toBe(false);
    expect(result.isOpportunistic).toBe(false);
    expect(result.isPlanned).toBe(false);
  });

  // ── Monday ──
  it('Monday: BLOCKED, hard block regardless of regime', () => {
    const result = getExecutionMode(1, 'BULLISH');
    expect(result.mode).toBe('BLOCKED');
    expect(result.canEnter).toBe(false);
    expect(result.isOpportunistic).toBe(false);
  });

  it('Monday: BLOCKED even in SIDEWAYS regime', () => {
    const result = getExecutionMode(1, 'SIDEWAYS');
    expect(result.mode).toBe('BLOCKED');
    expect(result.canEnter).toBe(false);
  });

  // ── Tuesday ──
  it('Tuesday: PLANNED, can enter in BULLISH', () => {
    const result = getExecutionMode(2, 'BULLISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
    expect(result.isPlanned).toBe(true);
    expect(result.isOpportunistic).toBe(false);
    expect(result.gates).toBeNull();
  });

  it('Tuesday: PLANNED, can enter in SIDEWAYS', () => {
    const result = getExecutionMode(2, 'SIDEWAYS');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
  });

  it('Tuesday: PLANNED, blocked in BEARISH', () => {
    const result = getExecutionMode(2, 'BEARISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(false);
  });

  // ── Wednesday ──
  it('Wednesday: OPPORTUNISTIC, can enter in BULLISH', () => {
    const result = getExecutionMode(3, 'BULLISH');
    expect(result.mode).toBe('OPPORTUNISTIC');
    expect(result.canEnter).toBe(true);
    expect(result.isOpportunistic).toBe(true);
    expect(result.isPlanned).toBe(false);
    expect(result.gates).not.toBeNull();
    expect(result.gates?.minNCS).toBe(70);
    expect(result.gates?.maxFWS).toBe(30);
    expect(result.gates?.maxNewPositions).toBe(2);
  });

  it('Wednesday: OPPORTUNISTIC, blocked in SIDEWAYS', () => {
    const result = getExecutionMode(3, 'SIDEWAYS');
    expect(result.mode).toBe('OPPORTUNISTIC');
    expect(result.canEnter).toBe(false);
    expect(result.gates).toBeNull();
  });

  it('Wednesday: OPPORTUNISTIC, blocked in BEARISH', () => {
    const result = getExecutionMode(3, 'BEARISH');
    expect(result.mode).toBe('OPPORTUNISTIC');
    expect(result.canEnter).toBe(false);
  });

  // ── Thursday ──
  it('Thursday: OPPORTUNISTIC, can enter in BULLISH', () => {
    const result = getExecutionMode(4, 'BULLISH');
    expect(result.mode).toBe('OPPORTUNISTIC');
    expect(result.canEnter).toBe(true);
    expect(result.isOpportunistic).toBe(true);
    expect(result.gates?.minNCS).toBe(70);
    expect(result.gates?.maxFWS).toBe(30);
  });

  // ── Friday ──
  it('Friday: OPPORTUNISTIC, can enter in BULLISH', () => {
    const result = getExecutionMode(5, 'BULLISH');
    expect(result.mode).toBe('OPPORTUNISTIC');
    expect(result.canEnter).toBe(true);
    expect(result.isOpportunistic).toBe(true);
  });

  it('Friday: OPPORTUNISTIC, blocked in BEARISH', () => {
    const result = getExecutionMode(5, 'BEARISH');
    expect(result.mode).toBe('OPPORTUNISTIC');
    expect(result.canEnter).toBe(false);
  });

  // ── Saturday ──
  it('Saturday: PLANNING, no entry', () => {
    const result = getExecutionMode(6, 'BULLISH');
    expect(result.mode).toBe('PLANNING');
    expect(result.canEnter).toBe(false);
  });

  // ── Invariants ──
  it('Monday block is unconditional across all regimes', () => {
    for (const regime of ['BULLISH', 'SIDEWAYS', 'BEARISH']) {
      const result = getExecutionMode(1, regime);
      expect(result.canEnter).toBe(false);
      expect(result.mode).toBe('BLOCKED');
    }
  });

  it('opportunistic gates only provided when canEnter is true on Wed-Fri', () => {
    // BULLISH → gates present
    expect(getExecutionMode(3, 'BULLISH').gates).not.toBeNull();
    expect(getExecutionMode(4, 'BULLISH').gates).not.toBeNull();
    expect(getExecutionMode(5, 'BULLISH').gates).not.toBeNull();

    // Not BULLISH → gates null
    expect(getExecutionMode(3, 'SIDEWAYS').gates).toBeNull();
    expect(getExecutionMode(4, 'BEARISH').gates).toBeNull();
    expect(getExecutionMode(5, 'SIDEWAYS').gates).toBeNull();
  });

  it('Tuesday never has opportunistic gates', () => {
    const result = getExecutionMode(2, 'BULLISH');
    expect(result.gates).toBeNull();
    expect(result.isOpportunistic).toBe(false);
  });
});
