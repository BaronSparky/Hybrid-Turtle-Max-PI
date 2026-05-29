import { afterEach, describe, expect, it } from 'vitest';
import { calculateAdaptiveBuffer } from './adaptive-atr-buffer';
import { detectVolRegime } from '../regime-detector';

const originalFlag = process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER;
  } else {
    process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER = originalFlag;
  }
});

describe('adaptive-atr-buffer feature flag: USE_PRIOR_20D_HIGH_FOR_TRIGGER', () => {
  it('uses prior-window high and produces a lower/stable trigger when enabled', () => {
    process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER = 'false';
    const currentWindowTrigger = calculateAdaptiveBuffer('TEST', 110, 8, 4, 100).adjustedEntryTrigger;

    process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER = 'true';
    const priorWindowTrigger = calculateAdaptiveBuffer('TEST', 110, 8, 4, 100).adjustedEntryTrigger;

    expect(currentWindowTrigger).toBeCloseTo(111, 8);
    expect(priorWindowTrigger).toBeCloseTo(101, 8);
    expect(priorWindowTrigger).toBeLessThan(currentWindowTrigger);
  });

  it('defaults to the prior-window high when the flag is unset (correct Donchian breakout)', () => {
    delete process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER;
    const defaultTrigger = calculateAdaptiveBuffer('TEST', 110, 8, 4, 100).adjustedEntryTrigger;
    // Must match the prior-window result (101), NOT the legacy current-window result (111).
    expect(defaultTrigger).toBeCloseTo(101, 8);
  });
});

describe('detectVolRegime', () => {
  it('returns LOW_VOL when SPY ATR% < 1%', () => {
    const result = detectVolRegime(0.8);
    expect(result.volRegime).toBe('LOW_VOL');
    expect(result.spyAtrPercent).toBe(0.8);
  });

  it('returns NORMAL_VOL when SPY ATR% is between 1% and 2%', () => {
    expect(detectVolRegime(1.0).volRegime).toBe('NORMAL_VOL');
    expect(detectVolRegime(1.5).volRegime).toBe('NORMAL_VOL');
    expect(detectVolRegime(2.0).volRegime).toBe('NORMAL_VOL');
  });

  it('returns HIGH_VOL when SPY ATR% > 2%', () => {
    const result = detectVolRegime(2.5);
    expect(result.volRegime).toBe('HIGH_VOL');
  });

  it('boundary: exactly 1% is NORMAL_VOL, exactly 2% is NORMAL_VOL', () => {
    expect(detectVolRegime(1.0).volRegime).toBe('NORMAL_VOL');
    expect(detectVolRegime(2.0).volRegime).toBe('NORMAL_VOL');
  });
});

describe('adaptive-atr-buffer vol regime multiplier', () => {
  it('LOW_VOL applies 0.8x multiplier — tighter buffer', () => {
    const normal = calculateAdaptiveBuffer('TEST', 100, 5, 4);
    const lowVol = calculateAdaptiveBuffer('TEST', 100, 5, 4, undefined, 'LOW_VOL');
    expect(lowVol.volRegimeMultiplier).toBe(0.8);
    expect(lowVol.bufferPercent).toBeCloseTo(normal.bufferPercent * 0.8, 6);
    expect(lowVol.adjustedEntryTrigger).toBeLessThan(normal.adjustedEntryTrigger);
  });

  it('NORMAL_VOL applies 1.0x multiplier — no change', () => {
    const result = calculateAdaptiveBuffer('TEST', 100, 5, 4, undefined, 'NORMAL_VOL');
    expect(result.volRegimeMultiplier).toBe(1.0);
  });

  it('HIGH_VOL applies 1.3x multiplier — wider buffer', () => {
    const normal = calculateAdaptiveBuffer('TEST', 100, 5, 4);
    const highVol = calculateAdaptiveBuffer('TEST', 100, 5, 4, undefined, 'HIGH_VOL');
    expect(highVol.volRegimeMultiplier).toBe(1.3);
    expect(highVol.bufferPercent).toBeCloseTo(normal.bufferPercent * 1.3, 6);
    expect(highVol.adjustedEntryTrigger).toBeGreaterThan(normal.adjustedEntryTrigger);
  });

  it('defaults to NORMAL_VOL when volRegime not passed', () => {
    const result = calculateAdaptiveBuffer('TEST', 100, 5, 4);
    expect(result.volRegimeMultiplier).toBe(1.0);
  });
});
