import { describe, expect, it } from 'vitest';
import { runTechnicalFilters, classifyCandidate, rankCandidate } from './scan-engine';
import type { TechnicalData, Sleeve } from '@/types';

// ── Helper: build a valid TechnicalData with overrides ──
function makeTechnicals(overrides: Partial<TechnicalData> = {}): TechnicalData {
  return {
    currentPrice: 150,
    ma200: 140,
    adx: 30,
    plusDI: 25,
    minusDI: 15,
    atr: 3,
    atr20DayAgo: 2.5,
    atrSpiking: false,
    medianAtr14: 2.8,
    atrPercent: 2.0,
    twentyDayHigh: 155,
    efficiency: 60,
    relativeStrength: 50,
    volumeRatio: 1.5,
    failedBreakoutAt: null,
    ...overrides,
  };
}

// ── Stage 2: runTechnicalFilters ──

describe('scan-engine pure functions', () => {
  describe('runTechnicalFilters', () => {
    it('passes all filters for a strong uptrend stock', () => {
      const result = runTechnicalFilters(150, makeTechnicals(), 'CORE');
      expect(result.passesAll).toBe(true);
      expect(result.priceAboveMa200).toBe(true);
      expect(result.adxAbove20).toBe(true);
      expect(result.plusDIAboveMinusDI).toBe(true);
      expect(result.atrPercentBelow8).toBe(true);
      expect(result.dataQuality).toBe(true);
    });

    it('fails when price is below MA200', () => {
      const result = runTechnicalFilters(130, makeTechnicals({ ma200: 140 }), 'CORE');
      expect(result.priceAboveMa200).toBe(false);
      expect(result.passesAll).toBe(false);
    });

    it('fails when ADX is below 20', () => {
      const result = runTechnicalFilters(150, makeTechnicals({ adx: 15 }), 'CORE');
      expect(result.adxAbove20).toBe(false);
      expect(result.passesAll).toBe(false);
    });

    it('fails when -DI leads +DI', () => {
      const result = runTechnicalFilters(150, makeTechnicals({ plusDI: 10, minusDI: 20 }), 'CORE');
      expect(result.plusDIAboveMinusDI).toBe(false);
      expect(result.passesAll).toBe(false);
    });

    it('fails when ATR% exceeds 8% for CORE', () => {
      const result = runTechnicalFilters(150, makeTechnicals({ atrPercent: 9 }), 'CORE');
      expect(result.atrPercentBelow8).toBe(false);
      expect(result.passesAll).toBe(false);
    });

    it('uses stricter 7% ATR cap for HIGH_RISK', () => {
      const fail = runTechnicalFilters(150, makeTechnicals({ atrPercent: 7.5 }), 'HIGH_RISK');
      expect(fail.atrPercentBelow8).toBe(false);

      const pass = runTechnicalFilters(150, makeTechnicals({ atrPercent: 6.5 }), 'HIGH_RISK');
      expect(pass.atrPercentBelow8).toBe(true);
    });

    it('fails data quality when MA200 is 0', () => {
      const result = runTechnicalFilters(150, makeTechnicals({ ma200: 0 }), 'CORE');
      expect(result.dataQuality).toBe(false);
      expect(result.passesAll).toBe(false);
    });

    it('fails data quality when ADX is 0', () => {
      const result = runTechnicalFilters(150, makeTechnicals({ adx: 0 }), 'CORE');
      expect(result.dataQuality).toBe(false);
      expect(result.passesAll).toBe(false);
    });

    it('ADX boundary: exactly 20 passes', () => {
      const result = runTechnicalFilters(150, makeTechnicals({ adx: 20 }), 'CORE');
      expect(result.adxAbove20).toBe(true);
    });

    it('efficiency is reported but does not affect passesAll', () => {
      const result = runTechnicalFilters(150, makeTechnicals({ efficiency: 10 }), 'CORE');
      expect(result.efficiencyAbove30).toBe(false);
      expect(result.passesAll).toBe(true);
    });
  });

  // ── Stage 3: classifyCandidate ──

  describe('classifyCandidate', () => {
    it('returns READY when price is within 2% of trigger', () => {
      expect(classifyCandidate(99, 100)).toBe('READY');
    });

    it('returns READY when price equals trigger', () => {
      expect(classifyCandidate(100, 100)).toBe('READY');
    });

    it('returns READY when price exceeds trigger', () => {
      expect(classifyCandidate(105, 100)).toBe('READY');
    });

    it('returns WATCH when distance is 2-3%', () => {
      // trigger=100, price=97.5 → distance=2.56%
      expect(classifyCandidate(97.5, 100)).toBe('WATCH');
    });

    it('returns FAR when distance exceeds 3%', () => {
      expect(classifyCandidate(95, 100)).toBe('FAR');
    });

    it('returns FAR for zero price (corrupt data guard)', () => {
      expect(classifyCandidate(0, 100)).toBe('FAR');
    });

    it('returns FAR for negative price (corrupt data guard)', () => {
      expect(classifyCandidate(-5, 100)).toBe('FAR');
    });
  });

  // ── Stage 4: rankCandidate ──

  describe('rankCandidate', () => {
    it('gives CORE sleeve higher priority than HIGH_RISK', () => {
      const tech = makeTechnicals();
      const coreScore = rankCandidate('CORE', tech, 'READY');
      const hrScore = rankCandidate('HIGH_RISK', tech, 'READY');
      expect(coreScore).toBeGreaterThan(hrScore);
    });

    it('gives READY status higher score than WATCH', () => {
      const tech = makeTechnicals();
      const ready = rankCandidate('CORE', tech, 'READY');
      const watch = rankCandidate('CORE', tech, 'WATCH');
      expect(ready).toBeGreaterThan(watch);
    });

    it('gives WATCH higher score than FAR', () => {
      const tech = makeTechnicals();
      const watch = rankCandidate('CORE', tech, 'WATCH');
      const far = rankCandidate('CORE', tech, 'FAR');
      expect(watch).toBeGreaterThan(far);
    });

    it('higher ADX increases score', () => {
      const lowAdx = rankCandidate('CORE', makeTechnicals({ adx: 20 }), 'READY');
      const highAdx = rankCandidate('CORE', makeTechnicals({ adx: 40 }), 'READY');
      expect(highAdx).toBeGreaterThan(lowAdx);
    });

    it('ADX is capped at 50 for scoring', () => {
      const adx50 = rankCandidate('CORE', makeTechnicals({ adx: 50 }), 'READY');
      const adx100 = rankCandidate('CORE', makeTechnicals({ adx: 100 }), 'READY');
      expect(adx50).toBe(adx100);
    });

    it('higher volume ratio increases score', () => {
      const lowVol = rankCandidate('CORE', makeTechnicals({ volumeRatio: 0.5 }), 'READY');
      const highVol = rankCandidate('CORE', makeTechnicals({ volumeRatio: 2.5 }), 'READY');
      expect(highVol).toBeGreaterThan(lowVol);
    });

    it('volume ratio capped at 3 for scoring', () => {
      const vol3 = rankCandidate('CORE', makeTechnicals({ volumeRatio: 3 }), 'READY');
      const vol10 = rankCandidate('CORE', makeTechnicals({ volumeRatio: 10 }), 'READY');
      expect(vol3).toBe(vol10);
    });

    it('returns a finite number', () => {
      const score = rankCandidate('ETF', makeTechnicals(), 'FAR');
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThan(0);
    });

    it('HEDGE sleeve gets lowest priority', () => {
      const tech = makeTechnicals();
      const hedge = rankCandidate('HEDGE', tech, 'READY');
      const etf = rankCandidate('ETF', tech, 'READY');
      expect(etf).toBeGreaterThan(hedge);
    });
  });
});
