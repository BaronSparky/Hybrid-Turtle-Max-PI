import { env } from '../../config/src/env';
import { average, ema, slope } from './math';
import { round } from '../../data/src/prisma';
import type { SignalBar, TrendAnalysis } from './types';

export function analyzeTrend(bars: SignalBar[]): TrendAnalysis {
  const closes = bars.map((bar) => bar.close);
  const sma20 = average(closes.slice(-20));
  const sma55 = average(closes.slice(-env.EVENING_SCAN_TREND_LOOKBACK));
  const ema21 = ema(closes.slice(-21), 21);
  const slope20 = slope(closes.slice(-20));
  const latestClose = closes[closes.length - 1] ?? 0;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let trendScore = 0;

  if (latestClose > sma20) {
    trendScore += 20;
    reasons.push('Price closed above the 20-day average.');
  } else {
    warnings.push('Price is below the 20-day average.');
  }

  if (latestClose > sma55) {
    trendScore += 25;
    reasons.push('Price closed above the 55-day average.');
  } else {
    warnings.push('Price is below the 55-day average.');
  }

  if (ema21 > sma20) {
    trendScore += 10;
    reasons.push('Short-term EMA is supporting trend continuation.');
  }

  if (slope20 > 2) {
    trendScore += 15;
    reasons.push('20-day slope is positive.');
  } else if (slope20 < 0) {
    warnings.push('20-day slope has turned negative.');
    trendScore -= 10;
  }

  return {
    sma20: round(sma20),
    sma55: round(sma55),
    ema21: round(ema21),
    slope20: round(slope20),
    trendScore: round(trendScore),
    isUptrend: latestClose > sma20 && latestClose > sma55 && slope20 > 0,
    reasons,
    warnings,
  };
}