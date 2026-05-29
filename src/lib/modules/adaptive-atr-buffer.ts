// ============================================================
// Module 11b: Adaptive ATR Entry Buffer
// ============================================================
// Scales entry buffer 5%–20% based on ATR%
// (volatile stocks get tighter buffer).
// Dashboard previously used fixed 10%.
// volRegime (SPY-level vol) applies a market-wide multiplier to the buffer.
// ============================================================

import type { AdaptiveBufferResult, VolRegime } from '@/types';

// ── Vol regime multipliers for entry buffer ──
const VOL_REGIME_MULTIPLIER: Record<VolRegime, number> = {
  LOW_VOL: 0.8,   // Calm market → tighter buffer (less room needed)
  NORMAL_VOL: 1.0, // Baseline — no adjustment
  HIGH_VOL: 1.3,   // Volatile market → wider buffer (more room to avoid noise)
} as const;

/**
 * Calculate adaptive entry buffer based on ATR%.
 * Low ATR% (< 2%) → looser buffer (20% of ATR as trigger offset)
 * High ATR% (> 6%) → tighter buffer (5% of ATR as trigger offset)
 * Linear interpolation between.
 * volRegime applies a market-wide multiplier from SPY ATR%.
 */
export function calculateAdaptiveBuffer(
  ticker: string,
  twentyDayHigh: number,
  atr: number,
  atrPercent: number,
  priorTwentyDayHigh?: number,
  volRegime: VolRegime = 'NORMAL_VOL'
): AdaptiveBufferResult {
  // Scale: ATR% 2 → 20% buffer, ATR% 6 → 5% buffer
  // Clamp to [5%, 20%]
  const minBuffer = 0.05;
  const maxBuffer = 0.20;
  const minATR = 2;
  const maxATR = 6;

  let bufferPercent: number;
  if (atrPercent <= minATR) {
    bufferPercent = maxBuffer;
  } else if (atrPercent >= maxATR) {
    bufferPercent = minBuffer;
  } else {
    // Linear interpolation (inverse relationship)
    bufferPercent = maxBuffer - ((atrPercent - minATR) / (maxATR - minATR)) * (maxBuffer - minBuffer);
  }

  // Apply vol regime multiplier: scales the buffer by market-wide volatility
  const volMultiplier = VOL_REGIME_MULTIPLIER[volRegime];
  const scaledBufferPercent = bufferPercent * volMultiplier;

  // Default ON: base the breakout trigger on the PRIOR 20-day high (excludes today's bar).
  // Including today's bar (legacy default) made the trigger unreachable: today's high is always
  // >= today's close, so close >= max(high_today, ...) + buffer can never be satisfied. That bug
  // produced ~0 buys across thousands of scans. Set USE_PRIOR_20D_HIGH_FOR_TRIGGER=false to restore
  // the legacy (broken) behaviour for A/B comparison only.
  // When priorTwentyDayHigh is unavailable, we safely fall back to twentyDayHigh.
  const usePrior20DayHighForTrigger = process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER !== 'false';
  const triggerBaseHigh = usePrior20DayHighForTrigger && typeof priorTwentyDayHigh === 'number'
    ? priorTwentyDayHigh
    : twentyDayHigh;
  const adjustedEntryTrigger = triggerBaseHigh + scaledBufferPercent * atr;

  return {
    ticker,
    atrPercent,
    bufferPercent: scaledBufferPercent * 100,
    adjustedEntryTrigger,
    volRegimeMultiplier: volMultiplier,
  };
}
