import { env } from '../../config/src/env';
import { average, highest } from './math';
import { round } from '../../data/src/prisma';
import type { BreakoutAnalysis, SignalBar } from './types';

export function analyzeBreakout(bars: SignalBar[]): BreakoutAnalysis {
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const volumes = bars.map((bar) => bar.volume);
  const currentPrice = closes[closes.length - 1] ?? 0;
  const breakoutHigh20 = highest(highs.slice(-(env.EVENING_SCAN_BREAKOUT_LOOKBACK + 1), -1));
  const breakoutHigh55 = highest(highs.slice(-(env.EVENING_SCAN_TREND_LOOKBACK + 1), -1));
  const triggerPrice = Math.max(breakoutHigh20, currentPrice);
  const volumeRatio20 = currentPrice > 0 ? (volumes[volumes.length - 1] ?? 0) / Math.max(average(volumes.slice(-20)), 1) : 1;
  const breakoutDistancePct = breakoutHigh20 > 0 ? ((currentPrice - breakoutHigh20) / breakoutHigh20) * 100 : 0;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let setupStatus: BreakoutAnalysis['setupStatus'] = 'WATCH';

  if (currentPrice > breakoutHigh55 && volumeRatio20 >= 1) {
    setupStatus = 'READY_NEXT_SESSION';
    reasons.push('Closed through the 55-day breakout level on acceptable volume.');
  } else if (currentPrice >= breakoutHigh20 * 0.99) {
    setupStatus = 'READY_ON_TRIGGER';
    reasons.push('Closed within 1% of the 20-day breakout trigger.');
  } else if (currentPrice >= breakoutHigh20 * 0.96) {
    setupStatus = 'EARLY_BIRD';
    reasons.push('Trading just below the breakout trigger with proximity support.');
  } else if (breakoutDistancePct < -6) {
    setupStatus = 'WAIT_PULLBACK';
    warnings.push('Breakout trigger is still materially above current price.');
  } else if (currentPrice < breakoutHigh20 * 0.9) {
    setupStatus = 'AVOID';
    warnings.push('Too far below breakout condition for next-session preparation.');
  } else {
    setupStatus = 'WATCH';
    reasons.push('Within watch range but not yet actionable.');
  }

  if (volumeRatio20 < 0.8) {
    warnings.push('Volume confirmation is weak.');
  }

  return {
    currentPrice: round(currentPrice),
    triggerPrice: round(triggerPrice),
    breakoutHigh20: round(breakoutHigh20),
    breakoutHigh55: round(breakoutHigh55),
    volumeRatio20: round(volumeRatio20),
    breakoutDistancePct: round(breakoutDistancePct),
    setupStatus,
    reasons,
    warnings,
  };
}