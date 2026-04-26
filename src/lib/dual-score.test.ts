import { describe, expect, it } from 'vitest';
import {
  clamp,
  safeNum,
  safeBool,
  computeBQS,
  computeFWS,
  computePenalties,
  computeNCS,
  actionNote,
  scoreRow,
  normaliseRow,
  calcDualRegimeScore,
  type SnapshotRow,
} from './dual-score';

// ── Helper: minimal valid SnapshotRow ────────────────────────

function makeRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    ticker: 'TEST',
    name: 'Test Stock',
    sleeve: 'CORE',
    status: 'READY',
    close: 100,
    atr_14: 2,
    atr_pct: 2.0,
    adx_14: 30,
    plus_di: 25,
    minus_di: 15,
    vol_ratio: 1.0,
    market_regime: 'BULLISH',
    market_regime_stable: true,
    distance_to_20d_high_pct: 1.0,
    entry_trigger: 102,
    stop_level: 96,
    chasing_20_last5: false,
    chasing_55_last5: false,
    atr_spiking: false,
    atr_collapsing: false,
    rs_vs_benchmark_pct: 5,
    ...overrides,
  };
}

// ── Utility tests ────────────────────────────────────────────

describe('clamp', () => {
  it('clamps within range', () => {
    expect(clamp(50)).toBe(50);
    expect(clamp(-5)).toBe(0);
    expect(clamp(150)).toBe(100);
  });

  it('returns lo for NaN/Infinity', () => {
    expect(clamp(NaN)).toBe(0);
    expect(clamp(Infinity)).toBe(0);
  });

  it('supports custom range', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
  });
});

describe('safeNum', () => {
  it('returns number for valid inputs', () => {
    expect(safeNum(42)).toBe(42);
    expect(safeNum('3.14')).toBe(3.14);
  });

  it('returns fallback for null/undefined/NaN', () => {
    expect(safeNum(null)).toBe(0);
    expect(safeNum(undefined)).toBe(0);
    expect(safeNum('abc', 99)).toBe(99);
  });
});

describe('safeBool', () => {
  it('handles boolean values', () => {
    expect(safeBool(true)).toBe(true);
    expect(safeBool(false)).toBe(false);
  });

  it('handles string values', () => {
    expect(safeBool('true')).toBe(true);
    expect(safeBool('yes')).toBe(true);
    expect(safeBool('1')).toBe(true);
    expect(safeBool('false')).toBe(false);
    expect(safeBool('no')).toBe(false);
  });

  it('returns fallback for null/undefined', () => {
    expect(safeBool(null)).toBe(false);
    expect(safeBool(undefined, true)).toBe(true);
  });
});

// ── BQS tests ────────────────────────────────────────────────

describe('computeBQS', () => {
  it('returns BQS 0-100 for typical READY stock', () => {
    const row = makeRow();
    const bqs = computeBQS(row);
    expect(bqs.BQS).toBeGreaterThan(0);
    expect(bqs.BQS).toBeLessThanOrEqual(100);
  });

  it('trend strength increases with ADX', () => {
    const low = computeBQS(makeRow({ adx_14: 15 }));
    const high = computeBQS(makeRow({ adx_14: 40 }));
    expect(high.bqs_trend).toBeGreaterThan(low.bqs_trend);
  });

  it('direction dominance increases with DI spread', () => {
    const narrow = computeBQS(makeRow({ plus_di: 18, minus_di: 15 }));
    const wide = computeBQS(makeRow({ plus_di: 35, minus_di: 10 }));
    expect(wide.bqs_direction).toBeGreaterThan(narrow.bqs_direction);
  });

  it('proximity score higher when closer to 20d high', () => {
    const far = computeBQS(makeRow({ distance_to_20d_high_pct: 5.0 }));
    const close = computeBQS(makeRow({ distance_to_20d_high_pct: 0.5 }));
    expect(close.bqs_proximity).toBeGreaterThan(far.bqs_proximity);
  });

  it('proximity returns 0 when both distance fields are null (regression)', () => {
    const row = makeRow({ distance_to_20d_high_pct: null as unknown as number, distance_to_55d_high_pct: undefined });
    const bqs = computeBQS(row);
    expect(bqs.bqs_proximity).toBe(0);
  });

  it('tailwind highest in BULLISH + LOW_VOL + aligned regime', () => {
    const best = computeBQS(makeRow({
      market_regime: 'BULLISH', vol_regime: 'LOW_VOL', dual_regime_aligned: true,
    }));
    const bearish = computeBQS(makeRow({ market_regime: 'BEARISH' }));
    expect(best.bqs_tailwind).toBe(20);
    expect(best.bqs_tailwind).toBeGreaterThan(bearish.bqs_tailwind);
  });

  it('volume bonus triggers above 1.2x ratio', () => {
    const noBonus = computeBQS(makeRow({ vol_ratio: 1.0 }));
    const bonus = computeBQS(makeRow({ vol_ratio: 1.8 }));
    expect(noBonus.bqs_vol_bonus).toBe(0);
    expect(bonus.bqs_vol_bonus).toBeGreaterThan(0);
  });

  it('volatility health peaks in 1-4% ATR range', () => {
    const optimal = computeBQS(makeRow({ atr_pct: 2.5 }));
    const tooHigh = computeBQS(makeRow({ atr_pct: 7.0 }));
    const tooLow = computeBQS(makeRow({ atr_pct: 0.3 }));
    expect(optimal.bqs_volatility).toBeGreaterThan(tooHigh.bqs_volatility);
    expect(optimal.bqs_volatility).toBeGreaterThan(tooLow.bqs_volatility);
  });

  it('weekly ADX bonus: +10 when >= 30, +5 when >= 25, -5 when < 20', () => {
    const strong = computeBQS(makeRow({ weekly_adx: 35 }));
    const moderate = computeBQS(makeRow({ weekly_adx: 27 }));
    const weak = computeBQS(makeRow({ weekly_adx: 15 }));
    const noData = computeBQS(makeRow({ weekly_adx: 0 }));
    expect(strong.bqs_weekly_adx).toBe(10);
    expect(moderate.bqs_weekly_adx).toBe(5);
    expect(weak.bqs_weekly_adx).toBe(-5);
    expect(noData.bqs_weekly_adx).toBe(0);
  });
});

// ── FWS tests ────────────────────────────────────────────────

describe('computeFWS', () => {
  it('returns FWS 0-100', () => {
    const fws = computeFWS(makeRow());
    expect(fws.FWS).toBeGreaterThanOrEqual(0);
    expect(fws.FWS).toBeLessThanOrEqual(100);
  });

  it('low volume ratio increases volume risk', () => {
    const healthy = computeFWS(makeRow({ vol_ratio: 1.5 }));
    const weak = computeFWS(makeRow({ vol_ratio: 0.4 }));
    expect(weak.fws_volume).toBeGreaterThan(healthy.fws_volume);
  });

  it('chasing flags increase extension risk', () => {
    const clean = computeFWS(makeRow({ chasing_20_last5: false, chasing_55_last5: false }));
    const oneChase = computeFWS(makeRow({ chasing_20_last5: true, chasing_55_last5: false }));
    const bothChase = computeFWS(makeRow({ chasing_20_last5: true, chasing_55_last5: true }));
    expect(oneChase.fws_extension).toBeGreaterThan(clean.fws_extension);
    expect(bothChase.fws_extension).toBeGreaterThan(oneChase.fws_extension);
  });

  it('ATR spiking triggers vol shock risk (reduced per OVERLAP-02)', () => {
    const calm = computeFWS(makeRow({ atr_spiking: false }));
    const spiking = computeFWS(makeRow({ atr_spiking: true }));
    // Reduced from 20 → 10 (scan-engine SCAN-08 already demotes spiking stocks)
    expect(spiking.fws_vol_shock).toBe(10);
    expect(calm.fws_vol_shock).toBe(0);
  });

  it('unstable regime adds regime instability risk', () => {
    const stable = computeFWS(makeRow({ market_regime_stable: true }));
    const unstable = computeFWS(makeRow({ market_regime_stable: false }));
    expect(unstable.fws_regime_instability).toBe(10);
    expect(stable.fws_regime_instability).toBe(0);
  });

  it('marginal trend penalises low ADX', () => {
    const strong = computeFWS(makeRow({ adx_14: 35 }));
    const marginal = computeFWS(makeRow({ adx_14: 18 }));
    expect(marginal.fws_marginal_trend).toBeGreaterThan(strong.fws_marginal_trend);
  });
});

// ── Penalties tests ──────────────────────────────────────────

describe('computePenalties', () => {
  it('earnings within 1 day gets maximum penalty', () => {
    const p = computePenalties(makeRow({ days_to_earnings: 1 }));
    expect(p.EarningsPenalty).toBe(20);
  });

  it('earnings within 5 days gets moderate penalty', () => {
    const p = computePenalties(makeRow({ days_to_earnings: 4 }));
    expect(p.EarningsPenalty).toBe(10);
  });

  it('no earnings data = no penalty', () => {
    const p = computePenalties(makeRow({ days_to_earnings: null }));
    expect(p.EarningsPenalty).toBe(0);
  });

  it('cluster exposure near cap triggers penalty', () => {
    const p = computePenalties(makeRow({
      cluster_exposure_pct: 22,
      max_cluster_pct: 25,
    }));
    expect(p.ClusterPenalty).toBeGreaterThan(0);
  });

  it('cluster exposure well below cap = no penalty', () => {
    const p = computePenalties(makeRow({
      cluster_exposure_pct: 10,
      max_cluster_pct: 25,
    }));
    expect(p.ClusterPenalty).toBe(0);
  });
});

// ── NCS tests ────────────────────────────────────────────────

describe('computeNCS', () => {
  it('formula: NCS = clamp(BQS - 0.8*FWS + 10 - penalties)', () => {
    const ncs = computeNCS(70, 20, { EarningsPenalty: 0, ClusterPenalty: 0, SuperClusterPenalty: 0 });
    // BaseNCS = clamp(70 - 16 + 10) = 64
    expect(ncs.BaseNCS).toBe(64);
    expect(ncs.NCS).toBe(64);
  });

  it('penalties reduce NCS below BaseNCS', () => {
    const ncs = computeNCS(80, 10, { EarningsPenalty: 15, ClusterPenalty: 5, SuperClusterPenalty: 0 });
    // BaseNCS = clamp(80 - 8 + 10) = 82
    // NCS = clamp(82 - 15 - 5 - 0) = 62
    expect(ncs.BaseNCS).toBe(82);
    expect(ncs.NCS).toBe(62);
  });

  it('NCS never goes below 0', () => {
    const ncs = computeNCS(10, 90, { EarningsPenalty: 20, ClusterPenalty: 20, SuperClusterPenalty: 20 });
    expect(ncs.NCS).toBe(0);
  });
});

// ── actionNote tests ─────────────────────────────────────────

describe('actionNote', () => {
  it('Auto-Yes when NCS>=70 and FWS<=30', () => {
    expect(actionNote(25, 75, 0)).toContain('Auto-Yes');
  });

  it('Auto-No when FWS>65', () => {
    expect(actionNote(70, 50, 0)).toContain('Auto-No');
  });

  it('Conditional otherwise', () => {
    expect(actionNote(40, 55, 0)).toContain('Conditional');
  });

  it('includes earnings warning when penalty > 0', () => {
    const note = actionNote(25, 75, 12);
    expect(note).toContain('Earnings headwind');
  });
});

// ── scoreRow integration ─────────────────────────────────────

describe('scoreRow', () => {
  it('produces all required fields', () => {
    const scored = scoreRow(makeRow());
    expect(scored.BQS).toBeGreaterThan(0);
    expect(scored.FWS).toBeGreaterThanOrEqual(0);
    expect(scored.NCS).toBeGreaterThanOrEqual(0);
    expect(scored.ActionNote).toBeDefined();
    expect(scored.di_spread).toBe(10); // 25 - 15
  });

  it('high-quality stock gets high NCS', () => {
    const scored = scoreRow(makeRow({
      adx_14: 35,
      plus_di: 30,
      minus_di: 10,
      atr_pct: 2.5,
      vol_ratio: 1.5,
      distance_to_20d_high_pct: 0.5,
      market_regime: 'BULLISH',
      market_regime_stable: true,
      rs_vs_benchmark_pct: 10,
    }));
    expect(scored.NCS).toBeGreaterThan(50);
  });

  it('fragile stock gets high FWS and conditional classification', () => {
    const scored = scoreRow(makeRow({
      adx_14: 18,
      vol_ratio: 0.3,
      chasing_20_last5: true,
      chasing_55_last5: true,
      atr_spiking: true,
      market_regime_stable: false,
    }));
    // FWS ~49 with rebalanced weights (reduced extension/volume penalties)
    // Still flags as fragile, but not Auto-No (threshold is FWS > 65)
    expect(scored.FWS).toBeGreaterThan(40);
    expect(scored.ActionNote).toContain('Conditional');
  });
});

// ── normaliseRow tests ───────────────────────────────────────

describe('normaliseRow', () => {
  it('maps column aliases', () => {
    const row = normaliseRow({
      ticker: 'AAPL',
      instrument_name: 'Apple Inc',
      adx: 30,
      rs_vs_benchmark: 5,
    });
    expect(row.name).toBe('Apple Inc');
    expect(row.adx_14).toBe(30);
    expect(row.rs_vs_benchmark_pct).toBe(5);
  });

  it('fills defaults for missing fields', () => {
    const row = normaliseRow({ ticker: 'TEST' });
    expect(row.close).toBe(0);
    expect(row.market_regime).toBe('NEUTRAL');
    expect(row.market_regime_stable).toBe(true);
    expect(row.chasing_20_last5).toBe(false);
  });

  it('coerces booleans from strings', () => {
    const row = normaliseRow({
      ticker: 'TEST',
      atr_spiking: 'true',
      chasing_20_last5: '1',
    });
    expect(row.atr_spiking).toBe(true);
    expect(row.chasing_20_last5).toBe(true);
  });

  it('auto-converts small decimal rs_vs_benchmark_pct to percent', () => {
    const row = normaliseRow({
      ticker: 'TEST',
      rs_vs_benchmark_pct: 0.03,
    });
    expect(row.rs_vs_benchmark_pct).toBe(3);
  });

  it('uses ticker as name fallback', () => {
    const row = normaliseRow({ ticker: 'AAPL', name: '' });
    expect(row.name).toBe('AAPL');
  });
});

// ── Tuning regression tests (Batch 1 optimizations) ─────────

describe('scoring tuning regressions', () => {
  it('trendStrength caps at 15 (not 25) to avoid ADX double-counting', () => {
    const lowAdx = computeBQS(makeRow({ adx_14: 20 }));
    const highAdx = computeBQS(makeRow({ adx_14: 50 }));
    // Max trend at ADX 50 should be 15 (capped), not 25
    expect(highAdx.bqs_trend).toBeLessThanOrEqual(15);
    expect(highAdx.bqs_trend).toBeGreaterThan(lowAdx.bqs_trend);
  });

  it('volumeRisk penalises contraction (vol < 0.8), not expansion', () => {
    const highVol = computeFWS(makeRow({ vol_ratio: 2.0 }));
    const lowVol = computeFWS(makeRow({ vol_ratio: 0.5 }));
    // High volume should have ZERO volume risk (breakout confirmation)
    expect(highVol.fws_volume).toBe(0);
    // Low volume should be penalised
    expect(lowVol.fws_volume).toBeGreaterThan(0);
  });

  it('extensionRisk is reduced for breakout targets near highs', () => {
    const both = computeFWS(makeRow({ chasing_20_last5: true, chasing_55_last5: true }));
    const one = computeFWS(makeRow({ chasing_20_last5: true, chasing_55_last5: false }));
    // Both chasing = 10 (was 25), one = 5 (was 15)
    expect(both.fws_extension).toBe(10);
    expect(one.fws_extension).toBe(5);
  });

  it('earningsPenalty uses max(byDays, byFlag) not just one source', () => {
    // When only boolean flag is set (days field null), penalty should still apply
    const result = computePenalties(makeRow({
      days_to_earnings: null as unknown as number,
      earnings_in_next_5d: true,
    }));
    expect(result.EarningsPenalty).toBe(12);
  });

  it('earningsPenalty takes stronger of two sources when both present', () => {
    // days=2 → 15, flag=true → 12. Should use max(15, 12) = 15
    const result = computePenalties(makeRow({
      days_to_earnings: 2,
      earnings_in_next_5d: true,
    }));
    expect(result.EarningsPenalty).toBe(15);
  });

  it('breakout candidates with good volume rank higher than low-volume alternatives', () => {
    const breakout = scoreRow(makeRow({
      vol_ratio: 1.5,
      chasing_20_last5: true,
      distance_to_20d_high_pct: 0.5,
    }));
    const quiet = scoreRow(makeRow({
      vol_ratio: 0.5,
      chasing_20_last5: false,
      distance_to_20d_high_pct: 3.0,
    }));
    // Good breakout candidate should score higher NCS than quiet alternative
    expect(breakout.NCS).toBeGreaterThan(quiet.NCS);
  });
});

// ── calcDualRegimeScore tests ────────────────────────────────

describe('calcDualRegimeScore', () => {
  it('BULLISH + LOW_VOL + aligned = 20 (best environment)', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BULLISH', vol_regime: 'LOW_VOL', dual_regime_aligned: true,
    }))).toBe(20);
  });

  it('BULLISH + NORMAL_VOL + aligned = 15', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BULLISH', vol_regime: 'NORMAL_VOL', dual_regime_aligned: true,
    }))).toBe(15);
  });

  it('BULLISH + HIGH_VOL = 10 regardless of alignment', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BULLISH', vol_regime: 'HIGH_VOL', dual_regime_aligned: true,
    }))).toBe(10);
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BULLISH', vol_regime: 'HIGH_VOL', dual_regime_aligned: false,
    }))).toBe(10);
  });

  it('BULLISH + LOW_VOL + NOT aligned = 10', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BULLISH', vol_regime: 'LOW_VOL', dual_regime_aligned: false,
    }))).toBe(10);
  });

  it('BULLISH + NORMAL_VOL + NOT aligned = 10', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BULLISH', vol_regime: 'NORMAL_VOL', dual_regime_aligned: false,
    }))).toBe(10);
  });

  it('SIDEWAYS = 0 regardless of other factors', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'SIDEWAYS', vol_regime: 'LOW_VOL', dual_regime_aligned: true,
    }))).toBe(0);
  });

  it('NEUTRAL = 0 (treated same as SIDEWAYS)', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'NEUTRAL',
    }))).toBe(0);
  });

  it('BEARISH = -10 regardless of other factors', () => {
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BEARISH', vol_regime: 'LOW_VOL', dual_regime_aligned: true,
    }))).toBe(-10);
  });

  it('defaults gracefully when vol_regime/dual_regime_aligned missing', () => {
    // No vol_regime → defaults NORMAL_VOL, no dual_regime_aligned → defaults true
    // BULLISH + NORMAL_VOL + aligned = 15
    expect(calcDualRegimeScore(makeRow({
      market_regime: 'BULLISH',
    }))).toBe(15);
  });
});
