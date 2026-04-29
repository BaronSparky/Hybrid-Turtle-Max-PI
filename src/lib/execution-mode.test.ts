import { describe, it, expect } from 'vitest';
import { getExecutionMode } from './execution-mode';

describe('getExecutionMode', () => {
  // ── Sunday ──
  it('Sunday: PLANNING, no entry', () => {
    const result = getExecutionMode(0, 'BULLISH');
    expect(result.mode).toBe('PLANNING');
    expect(result.canEnter).toBe(false);
    expect(result.isPlanned).toBe(false);
  });

  // ── Monday ──
  it('Monday: PLANNED, can enter in BULLISH', () => {
    const result = getExecutionMode(1, 'BULLISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
    expect(result.isPlanned).toBe(true);
  });

  it('Monday: PLANNED, can enter in SIDEWAYS', () => {
    const result = getExecutionMode(1, 'SIDEWAYS');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
  });

  it('Monday: PLANNED, blocked in BEARISH', () => {
    const result = getExecutionMode(1, 'BEARISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(false);
  });

  // ── Tuesday ──
  it('Tuesday: PLANNED, can enter in BULLISH', () => {
    const result = getExecutionMode(2, 'BULLISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
    expect(result.isPlanned).toBe(true);
  });

  it('Tuesday: PLANNED, blocked in BEARISH', () => {
    const result = getExecutionMode(2, 'BEARISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(false);
  });

  // ── Wednesday ──
  it('Wednesday: PLANNED, can enter in BULLISH', () => {
    const result = getExecutionMode(3, 'BULLISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
    expect(result.isPlanned).toBe(true);
  });

  it('Wednesday: PLANNED, can enter in SIDEWAYS', () => {
    const result = getExecutionMode(3, 'SIDEWAYS');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
  });

  it('Wednesday: PLANNED, blocked in BEARISH', () => {
    const result = getExecutionMode(3, 'BEARISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(false);
  });

  // ── Thursday ──
  it('Thursday: PLANNED, can enter in BULLISH', () => {
    const result = getExecutionMode(4, 'BULLISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
  });

  // ── Friday ──
  it('Friday: PLANNED, can enter in BULLISH', () => {
    const result = getExecutionMode(5, 'BULLISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(true);
  });

  it('Friday: PLANNED, blocked in BEARISH', () => {
    const result = getExecutionMode(5, 'BEARISH');
    expect(result.mode).toBe('PLANNED');
    expect(result.canEnter).toBe(false);
  });

  // ── Saturday ──
  it('Saturday: PLANNING, no entry', () => {
    const result = getExecutionMode(6, 'BULLISH');
    expect(result.mode).toBe('PLANNING');
    expect(result.canEnter).toBe(false);
  });

  // ── Invariants ──
  it('BEARISH blocks all weekdays', () => {
    for (let day = 1; day <= 5; day++) {
      const result = getExecutionMode(day, 'BEARISH');
      expect(result.canEnter).toBe(false);
      expect(result.mode).toBe('PLANNED');
    }
  });

  it('BULLISH allows all weekdays', () => {
    for (let day = 1; day <= 5; day++) {
      const result = getExecutionMode(day, 'BULLISH');
      expect(result.canEnter).toBe(true);
      expect(result.isPlanned).toBe(true);
    }
  });

  it('weekends always block entry regardless of regime', () => {
    for (const regime of ['BULLISH', 'SIDEWAYS', 'BEARISH']) {
      expect(getExecutionMode(0, regime).canEnter).toBe(false);
      expect(getExecutionMode(6, regime).canEnter).toBe(false);
    }
  });
});
