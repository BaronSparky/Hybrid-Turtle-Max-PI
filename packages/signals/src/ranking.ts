import { computeAtr, round } from './math';
import type { BreakoutAnalysis, RankedCandidate, RiskFilterAnalysis, SignalBar, TrendAnalysis } from './types';

export function analyzeRiskFilter(bars: SignalBar[], breakout: BreakoutAnalysis): RiskFilterAnalysis {
  const atr14 = computeAtr(bars, 14);
  const lastLow = bars[bars.length - 1]?.low ?? breakout.currentPrice;
  const initialStop = Math.max(breakout.currentPrice - atr14 * 2, Math.min(lastLow, breakout.currentPrice));
  const riskPerShare = Math.max(breakout.currentPrice - initialStop, 0.01);
  const stopDistancePercent = breakout.currentPrice > 0 ? (riskPerShare / breakout.currentPrice) * 100 : 0;
  const warnings: string[] = [];
  let passes = true;

  if (stopDistancePercent > 10) {
    warnings.push('Initial stop distance is wide.');
    passes = false;
  }

  if (initialStop >= breakout.currentPrice) {
    warnings.push('Initial stop is not below current price.');
    passes = false;
  }

  return {
    atr14: round(atr14),
    initialStop: round(initialStop),
    riskPerShare: round(riskPerShare),
    stopDistancePercent: round(stopDistancePercent),
    passes,
    warnings,
  };
}

export function rankCandidate(symbol: string, trend: TrendAnalysis, breakout: BreakoutAnalysis, risk: RiskFilterAnalysis): RankedCandidate {
  let rankScore = trend.trendScore;

  if (breakout.setupStatus === 'READY_NEXT_SESSION') {
    rankScore += 35;
  } else if (breakout.setupStatus === 'READY_ON_TRIGGER') {
    rankScore += 28;
  } else if (breakout.setupStatus === 'EARLY_BIRD') {
    rankScore += 18;
  } else if (breakout.setupStatus === 'WATCH') {
    rankScore += 10;
  } else if (breakout.setupStatus === 'WAIT_PULLBACK') {
    rankScore -= 8;
  } else {
    // Covers AVOID and any future unrecognised status
    rankScore -= 20;
  }

  rankScore += Math.min(breakout.volumeRatio20 * 4, 8);
  rankScore -= Math.max(risk.stopDistancePercent - 5, 0) * 1.5;
  rankScore -= breakout.warnings.length * 3;
  rankScore -= trend.warnings.length * 2;
  rankScore -= risk.warnings.length * 3;

  return {
    symbol,
    currentPrice: breakout.currentPrice,
    triggerPrice: breakout.triggerPrice,
    initialStop: risk.initialStop,
    stopDistancePercent: risk.stopDistancePercent,
    riskPerShare: risk.riskPerShare,
    setupStatus: breakout.setupStatus,
    rankScore: round(rankScore),
    reasons: [...trend.reasons, ...breakout.reasons],
    warnings: [...trend.warnings, ...breakout.warnings, ...risk.warnings],
  };
}