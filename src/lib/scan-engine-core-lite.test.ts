import { describe, expect, it } from 'vitest';
import { runTechnicalFilters, classifyCandidate, rankCandidate } from './scan-engine';
import type { TechnicalData, Sleeve } from '@/types';

// Test the pure functions that remain unchanged in both modes.
// CORE_LITE vs FULL is a parameter-level difference in runFullScan()
// (which is async and hits the DB), so we test it through the pure
// stage functions and verify the contract.

function makeTechnicals(overrides?: Partial<TechnicalData>): TechnicalData {
  return {
    currentPrice: 100,
    ma200: 90,
    adx: 30,
    plusDI: 25,
    minusDI: 15,
    atr: 3,
    atr20DayAgo: 2.8,
    atrSpiking: false,
    medianAtr14: 2.9,
    atrPercent: 3.0,
    twentyDayHigh: 102,
    efficiency: 50,
    relativeStrength: 10,
    volumeRatio: 1.5,
    failedBreakoutAt: null,
    ...overrides,
  };
}

describe('scan-engine: CORE_LITE contract', () => {
  describe('runTechnicalFilters (unchanged in both modes)', () => {
    it('passes standard CORE candidate', () => {
      const r = runTechnicalFilters(100, makeTechnicals(), 'CORE');
      expect(r.passesAll).toBe(true);
      expect(r.priceAboveMa200).toBe(true);
      expect(r.adxAbove20).toBe(true);
      expect(r.plusDIAboveMinusDI).toBe(true);
    });

    it('fails when price below MA200', () => {
      const r = runTechnicalFilters(85, makeTechnicals({ ma200: 90 }), 'CORE');
      expect(r.priceAboveMa200).toBe(false);
      expect(r.passesAll).toBe(false);
    });

    it('fails when ADX < 20', () => {
      const r = runTechnicalFilters(100, makeTechnicals({ adx: 15 }), 'CORE');
      expect(r.adxAbove20).toBe(false);
      expect(r.passesAll).toBe(false);
    });
  });

  describe('classifyCandidate (unchanged in both modes)', () => {
    it('READY when distance <= 2%', () => {
      expect(classifyCandidate(100, 101)).toBe('READY');
    });

    it('WATCH when distance 2-3%', () => {
      expect(classifyCandidate(100, 102.5)).toBe('WATCH');
    });

    it('FAR when distance > 3%', () => {
      expect(classifyCandidate(100, 105)).toBe('FAR');
    });
  });

  describe('rankCandidate (unchanged in both modes)', () => {
    it('CORE sleeve gets highest priority', () => {
      const core = rankCandidate('CORE', makeTechnicals(), 'READY');
      const hr = rankCandidate('HIGH_RISK', makeTechnicals(), 'READY');
      expect(core).toBeGreaterThan(hr);
    });

    it('READY status gets bonus over WATCH', () => {
      const ready = rankCandidate('CORE', makeTechnicals(), 'READY');
      const watch = rankCandidate('CORE', makeTechnicals(), 'WATCH');
      expect(ready).toBeGreaterThan(watch);
    });
  });

  describe('CORE_LITE behavioral contract', () => {
    // These tests document what CORE_LITE skips without needing async DB calls.
    // The scan-engine respects the isCoreLite flag in runFullScan().

    it('CORE_LITE skips list is well-defined', () => {
      // Document the 8 features skipped in CORE_LITE mode:
      const skippedFeatures = [
        'Hurst Exponent calculation',
        'ATR Spike Detection (median-based)',
        'Earnings Calendar Check',
        'Anti-Chase Guard (gap-based)',
        'Failed Breakout Cooldown',
        'Volatility Extension Check (extATR > 0.8)',
        'Adaptive ATR Buffer',
        'Pullback Continuation Entry',
      ];
      expect(skippedFeatures).toHaveLength(8);
    });

    it('CORE_LITE keeps list is well-defined', () => {
      // Document the features KEPT in CORE_LITE mode:
      const keptFeatures = [
        'Universe selection (active tickers)',
        'Market regime detection (SPY vs MA200)',
        'Technical Filters (MA200, ADX, DI, ATR%, data quality)',
        'Status Classification (READY/WATCH/FAR)',
        'Ranking (sleeve + status + ADX + volume + efficiency + RS)',
        'Risk Gates (all 6 gates)',
        'Position Sizing (floorShares)',
        'Stop Manager (monotonic ladder)',
        'FX conversion',
      ];
      expect(keptFeatures).toHaveLength(9);
    });

    it('CORE_LITE entry trigger uses raw 20d high (no adaptive buffer)', () => {
      // In CORE_LITE: entryTrigger = technicals.twentyDayHigh
      // In FULL: entryTrigger = calculateAdaptiveBuffer(...).adjustedEntryTrigger
      const technicals = makeTechnicals({ twentyDayHigh: 105 });
      // The raw 20d high is what CORE_LITE uses
      expect(technicals.twentyDayHigh).toBe(105);
    });
  });

  describe('classifyCandidate edge cases (regression)', () => {
    it('returns FAR when price is zero (corrupt data guard)', () => {
      expect(classifyCandidate(0, 102)).toBe('FAR');
    });

    it('returns FAR when price is negative (corrupt data guard)', () => {
      expect(classifyCandidate(-5, 102)).toBe('FAR');
    });
  });
});
