import { describe, expect, it } from 'vitest';
import { assessEntryQuality, type EntryQualityInput } from './entry-quality-engine';

// ── Test Helpers ──────────────────────────────────────────────

function makeInput(overrides: Partial<EntryQualityInput> = {}): EntryQualityInput {
  return {
    price: 100,
    entryTrigger: 102,
    stopPrice: 96,
    atr: 4,
    atrPercent: 3,
    status: 'READY',
    slippageBuffer: 0,
    pullbackTriggered: false,
    antiChaseFailed: false,
    ...overrides,
  };
}

// ── Clean Trigger ────────────────────────────────────────────

describe('assessEntryQuality — clean trigger', () => {
  it('returns BUY_NOW / GREEN when price is at entry trigger', () => {
    const result = assessEntryQuality(makeInput({ price: 102, entryTrigger: 102 }));

    expect(result.decision).toBe('BUY_NOW');
    expect(result.quality).toBe('GREEN');
    expect(result.entryWindowStatus).toBe('BUY_ALLOWED');
    expect(result.extensionATR).toBeCloseTo(0, 2);
    expect(result.suggestedOrderType).toBe('LIMIT');
  });

  it('returns WAIT / GREEN when price is below trigger (READY distance)', () => {
    const result = assessEntryQuality(makeInput({ price: 100, entryTrigger: 102 }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('GREEN');
    expect(result.entryWindowStatus).toBe('READY');
    expect(result.suggestedOrderType).toBe('STOP');
    expect(result.reason).toContain('below trigger');
  });

  it('returns WAIT / GREEN when price is far below trigger (WATCH distance)', () => {
    const result = assessEntryQuality(makeInput({ price: 95, entryTrigger: 102 }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('GREEN');
    expect(result.entryWindowStatus).toBe('WATCH');
    expect(result.reason).toContain('below trigger');
  });
});

// ── Slight Gap ───────────────────────────────────────────────

describe('assessEntryQuality — slight gap above trigger', () => {
  it('returns BUY_NOW / GREEN when price slightly above trigger (within anti-chase)', () => {
    // extATR = (103 - 102) / 4 = 0.25 < 0.8
    const result = assessEntryQuality(makeInput({ price: 103, entryTrigger: 102 }));

    expect(result.decision).toBe('BUY_NOW');
    expect(result.quality).toBe('GREEN');
    expect(result.entryWindowStatus).toBe('BUY_ALLOWED');
    expect(result.extensionATR).toBeCloseTo(0.25, 2);
  });

  it('returns BUY_NOW / YELLOW when high extension but still within bounds', () => {
    // extATR = (104.5 - 102) / 4 = 0.625 > 0.5 → YELLOW
    const result = assessEntryQuality(makeInput({ price: 104.5, entryTrigger: 102 }));

    expect(result.decision).toBe('BUY_NOW');
    expect(result.quality).toBe('YELLOW');
    expect(result.entryWindowStatus).toBe('BUY_ALLOWED');
    expect(result.reason).toContain('tighter fill');
  });
});

// ── Huge Gap ─────────────────────────────────────────────────

describe('assessEntryQuality — huge gap (MISSED)', () => {
  it('returns MISSED / RED when price far above no-chase ceiling', () => {
    // noChasePrice = 102 + 1.2 * 4 = 106.8
    // price = 110 → MISSED
    const result = assessEntryQuality(makeInput({ price: 110, entryTrigger: 102 }));

    expect(result.decision).toBe('MISSED');
    expect(result.quality).toBe('RED');
    expect(result.entryWindowStatus).toBe('MISSED_DO_NOT_CHASE');
    expect(result.reason).toContain('do not chase');
  });

  it('calculates correct noChasePrice', () => {
    // noChasePrice = 102 + 1.2 * 4 = 106.8
    const result = assessEntryQuality(makeInput({ price: 110, entryTrigger: 102 }));

    expect(result.noChasePrice).toBeCloseTo(106.8, 1);
    expect(result.reason).toContain('106.8');
  });
});

// ── High ATR Extension (WAIT_PULLBACK) ──────────────────────

describe('assessEntryQuality — high ATR extension', () => {
  it('returns WAIT / YELLOW when price above max allowed but below no-chase', () => {
    // maxAllowedEntry = 102 + 0.8 * 4 = 105.2
    // noChasePrice = 102 + 1.2 * 4 = 106.8
    // price = 106 → WAIT_PULLBACK
    const result = assessEntryQuality(makeInput({ price: 106, entryTrigger: 102 }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('YELLOW');
    expect(result.entryWindowStatus).toBe('WAIT_PULLBACK');
    expect(result.reason).toContain('pullback');
  });

  it('returns WAIT_PULLBACK when anti-chase already failed', () => {
    // Price is barely above trigger, but anti-chase was already flagged
    const result = assessEntryQuality(makeInput({
      price: 103,
      entryTrigger: 102,
      antiChaseFailed: true,
    }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('YELLOW');
    expect(result.entryWindowStatus).toBe('WAIT_PULLBACK');
  });
});

// ── Pullback Continuation ───────────────────────────────────

describe('assessEntryQuality — pullback continuation', () => {
  it('returns BUY_NOW / GREEN when pullback triggered', () => {
    const result = assessEntryQuality(makeInput({
      price: 106,
      entryTrigger: 102,
      pullbackTriggered: true,
      pullbackEntryPrice: 103,
    }));

    expect(result.decision).toBe('BUY_NOW');
    expect(result.quality).toBe('GREEN');
    expect(result.entryWindowStatus).toBe('BUY_ALLOWED');
    expect(result.reason).toContain('Pullback continuation');
    expect(result.reason).toContain('103.00');
  });

  it('overrides high extension when pullback signals valid', () => {
    // Without pullback this would be WAIT_PULLBACK
    const result = assessEntryQuality(makeInput({
      price: 106,
      entryTrigger: 102,
      pullbackTriggered: true,
      pullbackEntryPrice: 103,
      antiChaseFailed: true,
    }));

    expect(result.decision).toBe('BUY_NOW');
    expect(result.quality).toBe('GREEN');
  });
});

// ── Slippage Tightening ─────────────────────────────────────

describe('assessEntryQuality — slippage tightening', () => {
  it('tightens slippageAdjustedLimit based on historical slippage', () => {
    const result = assessEntryQuality(makeInput({
      price: 102,
      slippageBuffer: 0.05,
    }));

    // maxAllowedEntry = 102 + 0.8 * 4 = 105.2
    // slippageAdjustedLimit = 105.2 - 0.05 * 4 = 105.0
    expect(result.slippageAdjustedLimit).toBeCloseTo(105.0, 1);
    expect(result.maxAllowedEntry).toBeCloseTo(105.2, 1);
  });

  it('returns WAIT_SPREAD / YELLOW when slippage consumes most headroom', () => {
    // Headroom = 0.8 * 4 = 3.2
    // Slippage cost = 0.7 * 4 = 2.8
    // Fraction = 2.8 / 3.2 = 0.875 > 0.8 → WAIT_SPREAD
    const result = assessEntryQuality(makeInput({
      price: 102,
      entryTrigger: 102,
      slippageBuffer: 0.7,
    }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('YELLOW');
    expect(result.entryWindowStatus).toBe('WAIT_SPREAD');
    expect(result.reason).toContain('slippage');
  });

  it('still allows BUY_NOW when slippage is moderate', () => {
    const result = assessEntryQuality(makeInput({
      price: 102,
      entryTrigger: 102,
      slippageBuffer: 0.1,
    }));

    expect(result.decision).toBe('BUY_NOW');
    expect(result.quality).toBe('GREEN');
  });
});

// ── No Data ─────────────────────────────────────────────────

describe('assessEntryQuality — no data / edge cases', () => {
  it('returns WAIT / RED when ATR is zero', () => {
    const result = assessEntryQuality(makeInput({ atr: 0 }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('RED');
    expect(result.reason).toContain('Insufficient data');
  });

  it('returns WAIT / RED when entry trigger is zero', () => {
    const result = assessEntryQuality(makeInput({ entryTrigger: 0 }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('RED');
    expect(result.reason).toContain('Insufficient data');
  });

  it('returns WAIT / RED when price is zero', () => {
    const result = assessEntryQuality(makeInput({ price: 0 }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('RED');
  });

  it('returns WAIT / RED when ATR is negative', () => {
    const result = assessEntryQuality(makeInput({ atr: -1 }));

    expect(result.decision).toBe('WAIT');
    expect(result.quality).toBe('RED');
  });
});

// ── Price Calculations ──────────────────────────────────────

describe('assessEntryQuality — price calculations', () => {
  it('computes idealEntry as the entry trigger', () => {
    const result = assessEntryQuality(makeInput());

    expect(result.idealEntry).toBe(102);
  });

  it('computes maxAllowedEntry = trigger + 0.8 * ATR', () => {
    const result = assessEntryQuality(makeInput());

    // 102 + 0.8 * 4 = 105.2
    expect(result.maxAllowedEntry).toBeCloseTo(105.2, 1);
  });

  it('computes noChasePrice = trigger + 1.2 * ATR', () => {
    const result = assessEntryQuality(makeInput());

    // 102 + 1.2 * 4 = 106.8
    expect(result.noChasePrice).toBeCloseTo(106.8, 1);
  });

  it('computes triggerDistancePct correctly for price below trigger', () => {
    const result = assessEntryQuality(makeInput({ price: 100, entryTrigger: 102 }));

    // (100 - 102) / 102 * 100 ≈ -1.96%
    expect(result.triggerDistancePct).toBeCloseTo(-1.96, 1);
  });

  it('computes extensionATR correctly for price above trigger', () => {
    const result = assessEntryQuality(makeInput({ price: 104, entryTrigger: 102 }));

    // (104 - 102) / 4 = 0.5
    expect(result.extensionATR).toBeCloseTo(0.5, 2);
  });
});
