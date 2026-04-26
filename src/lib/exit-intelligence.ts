/**
 * DEPENDENCIES
 * Consumed by: /api/exit-intelligence/route.ts, nightly.ts, UI components
 * Consumes: @/types, stop-manager.ts (getProtectionLevel, inferLevelFromStop)
 * Risk-sensitive: YES — advisory-only, never auto-executes
 * Notes: All functions are pure (no DB access). Callers supply position +
 *        technical data. Every recommendation requires human approval.
 *        Does NOT lower stops. Does NOT auto-exit.
 */

import type {
  ExitAction,
  ExitScoreBreakdown,
  ExitIntelligenceResult,
  ProtectionLevel,
} from '@/types';
import { getProtectionLevel, inferLevelFromStop } from './stop-manager';

// ── Input Types ───────────────────────────────────────────────

export interface ExitPosition {
  id: string;
  ticker: string;
  sleeve: string;
  entryPrice: number;
  currentPrice: number;
  currentStop: number;
  initialRisk: number;
  shares: number;
  daysHeld: number;
  rMultiple: number;
  atr: number;
  currency: string;
  protectionLevel?: string;
  /** ADX today */
  adxToday?: number;
  /** ADX yesterday (for trend decay) */
  adxYesterday?: number;
  /** Current MA20 */
  ma20?: number;
  /** Current NCS (from latest scan) */
  currentNCS?: number;
  /** Prior session NCS */
  priorNCS?: number;
  /** Current relative strength (0-100) */
  relativeStrength?: number;
  /** Prior session relative strength */
  priorRelativeStrength?: number;
  /** +DI value */
  plusDI?: number;
  /** -DI value */
  minusDI?: number;
  /** Today's volume */
  volume?: number;
  /** 20-day average volume */
  avgVolume20?: number;
  /** Price above MA20 in percent */
  priceAboveMa20Pct?: number;
  /** Number of A-grade candidates waiting */
  aGradeCandidatesWaiting?: number;
  /** Capital tied up in this position (GBP) */
  capitalDeployed?: number;
  /** Overnight gap as % of previous close */
  overnightGapPct?: number;
  /** ATR as % of price */
  atrPct?: number;
}

// ── Constants ─────────────────────────────────────────────────

/** ADX above this = strong trend */
const STRONG_TREND_ADX = 25;
/** ADX decline this many points = weakening */
const ADX_DECLINE_THRESHOLD = 3;
/** RS decay threshold (prior - current) */
const RS_DECAY_THRESHOLD = 10;
/** NCS drop threshold */
const NCS_DROP_THRESHOLD = 15;
/** Climax: price above MA20 % */
const CLIMAX_PRICE_THRESHOLD = 15;
/** Climax: volume multiple */
const CLIMAX_VOLUME_THRESHOLD = 2.5;
/** Gap risk: multiple of ATR% */
const GAP_RISK_ATR_MULT = 2;
/** Winner: R-multiple for "strong winner" */
const STRONG_WINNER_R = 2.0;
/** Mature winner: days held */
const MATURE_WINNER_DAYS = 20;
/** Dead money: R below this after many days */
const DEAD_MONEY_R = 0.5;
/** Dead money: days threshold */
const DEAD_MONEY_DAYS = 15;

// ── Score Calculators ─────────────────────────────────────────

/**
 * 1. Trend Health Score (0-100)
 * High = trend is intact and strong. Low = trend is dying.
 *
 * Components:
 * - ADX strength (0-40): ADX > 25 = 40, scales down
 * - DI spread (0-20): +DI > -DI spread
 * - Price vs MA20 (0-20): above MA20 = 20
 * - NCS quality (0-20): from latest scan
 */
export function scoreTrendHealth(pos: ExitPosition): number {
  let score = 0;

  // ADX strength (0-40)
  if (pos.adxToday != null) {
    if (pos.adxToday >= 35) score += 40;
    else if (pos.adxToday >= STRONG_TREND_ADX) score += 30;
    else if (pos.adxToday >= 20) score += 20;
    else score += Math.max(0, pos.adxToday);
  } else {
    score += 20; // Neutral when missing
  }

  // DI spread (0-20)
  if (pos.plusDI != null && pos.minusDI != null) {
    const spread = pos.plusDI - pos.minusDI;
    if (spread >= 15) score += 20;
    else if (spread >= 8) score += 15;
    else if (spread >= 0) score += 10;
    else score += 0; // Bearish spread
  } else {
    score += 10;
  }

  // Price vs MA20 (0-20)
  if (pos.ma20 != null && pos.currentPrice > 0) {
    if (pos.currentPrice > pos.ma20) score += 20;
    else if (pos.currentPrice > pos.ma20 * 0.98) score += 10;
    else score += 0;
  } else {
    score += 10;
  }

  // NCS quality (0-20)
  if (pos.currentNCS != null) {
    score += Math.min(20, Math.round(pos.currentNCS / 5));
  } else {
    score += 10;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * 2. Winner Hold Score (0-100)
 * High = this is a winning position worth holding. Low = weak hold.
 *
 * Components:
 * - R-multiple strength (0-35): higher R = stronger hold
 * - Protection level (0-25): better protection = safer hold
 * - Trend alignment (0-20): ADX rising + price > MA20
 * - Momentum (0-20): RS strong
 */
export function scoreWinnerHold(pos: ExitPosition): number {
  let score = 0;

  // R-multiple strength (0-35)
  if (pos.rMultiple >= 5.0) score += 35;
  else if (pos.rMultiple >= 3.0) score += 30;
  else if (pos.rMultiple >= STRONG_WINNER_R) score += 25;
  else if (pos.rMultiple >= 1.0) score += 15;
  else if (pos.rMultiple >= 0) score += 5;
  else score += 0;

  // Protection level (0-25)
  const level = pos.protectionLevel || inferLevelFromStop(pos.currentStop, pos.entryPrice, pos.initialRisk);
  if (level === 'LOCK_1R_TRAIL') score += 25;
  else if (level === 'LOCK_08R') score += 20;
  else if (level === 'BREAKEVEN') score += 15;
  else score += 5;

  // Trend alignment (0-20)
  if (pos.adxToday != null && pos.adxYesterday != null) {
    if (pos.adxToday >= STRONG_TREND_ADX && pos.adxToday >= pos.adxYesterday) score += 20;
    else if (pos.adxToday >= 20) score += 10;
    else score += 5;
  } else {
    score += 10;
  }

  // Momentum / RS (0-20)
  if (pos.relativeStrength != null) {
    if (pos.relativeStrength >= 70) score += 20;
    else if (pos.relativeStrength >= 55) score += 15;
    else if (pos.relativeStrength >= 40) score += 10;
    else score += 5;
  } else {
    score += 10;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * 3. Weakening Trend Warning (0-100)
 * High = trend is weakening, exit pressure building.
 *
 * Components:
 * - ADX decline (0-30): ADX falling from yesterday
 * - RS decay (0-25): RS declining vs prior session
 * - NCS deterioration (0-25): NCS dropping
 * - Price below MA20 (0-20): lost trend support
 */
export function scoreWeakeningTrend(pos: ExitPosition): number {
  let score = 0;

  // ADX decline (0-30)
  if (pos.adxToday != null && pos.adxYesterday != null) {
    const adxDrop = pos.adxYesterday - pos.adxToday;
    if (adxDrop >= 8) score += 30;
    else if (adxDrop >= ADX_DECLINE_THRESHOLD) score += 20;
    else if (adxDrop > 0) score += 10;
  }

  // RS decay (0-25)
  if (pos.relativeStrength != null && pos.priorRelativeStrength != null) {
    const decay = pos.priorRelativeStrength - pos.relativeStrength;
    if (decay >= 20) score += 25;
    else if (decay >= RS_DECAY_THRESHOLD) score += 18;
    else if (decay > 5) score += 10;
  }

  // NCS deterioration (0-25)
  if (pos.currentNCS != null && pos.priorNCS != null) {
    const ncsDrop = pos.priorNCS - pos.currentNCS;
    if (ncsDrop >= 25) score += 25;
    else if (ncsDrop >= NCS_DROP_THRESHOLD) score += 18;
    else if (ncsDrop > 5) score += 10;
  }

  // Price below MA20 (0-20)
  if (pos.ma20 != null && pos.currentPrice > 0) {
    if (pos.currentPrice < pos.ma20 * 0.97) score += 20;
    else if (pos.currentPrice < pos.ma20) score += 12;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * 4. Exit Review Score (0-100)
 * Composite score that synthesises all exit pressure.
 * Computed from the other scores, not independently.
 */
export function scoreExitReview(
  trendHealth: number,
  winnerHold: number,
  weakeningTrend: number,
  opportunityCost: number,
  climaxRisk: number,
  rMultiple: number,
  daysHeld: number
): number {
  // Exit pressure increases when:
  // - Trend health is LOW
  // - Winner hold is LOW
  // - Weakening signals are HIGH
  // - Opportunity cost is HIGH
  // - Climax risk is HIGH
  let score = 0;

  // Inverse of trend health (low health → high exit pressure)
  score += Math.round((100 - trendHealth) * 0.25);
  // Inverse of winner hold
  score += Math.round((100 - winnerHold) * 0.20);
  // Weakening trend signal
  score += Math.round(weakeningTrend * 0.25);
  // Opportunity cost
  score += Math.round(opportunityCost * 0.15);
  // Climax risk
  score += Math.round(climaxRisk * 0.15);

  // Dead money penalty: low R after many days
  if (rMultiple < DEAD_MONEY_R && daysHeld > DEAD_MONEY_DAYS) {
    score += 15;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * 5. Opportunity Cost Score (0-100)
 * How much is this position costing by blocking better opportunities?
 */
export function scoreOpportunityCost(pos: ExitPosition): number {
  const waiting = pos.aGradeCandidatesWaiting ?? 0;
  if (waiting === 0) return 0;

  let score = 0;

  // Each A-grade candidate blocked adds pressure
  score += Math.min(50, waiting * 20);

  // Weak position blocking stronger candidates = higher cost
  if (pos.rMultiple < 0.5) score += 25;
  else if (pos.rMultiple < 1.0) score += 15;

  // More capital tied up = higher cost
  if (pos.capitalDeployed != null && pos.capitalDeployed > 0) {
    // This is relative — more shares at low R = worse
    if (pos.rMultiple < 0.3 && pos.daysHeld > 10) score += 25;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * 6. Climax / Blow-Off Risk Score (0-100)
 * Detects parabolic moves that typically precede sharp reversals.
 */
export function scoreClimaxRisk(pos: ExitPosition): number {
  let score = 0;

  // Price extension above MA20
  const ext = pos.priceAboveMa20Pct ?? (
    pos.ma20 != null && pos.ma20 > 0 && pos.currentPrice > 0
      ? ((pos.currentPrice - pos.ma20) / pos.ma20) * 100
      : 0
  );

  if (ext >= 25) score += 50;
  else if (ext >= 18) score += 40;
  else if (ext >= CLIMAX_PRICE_THRESHOLD) score += 30;
  else if (ext >= 10) score += 15;

  // Volume spike
  if (pos.volume != null && pos.avgVolume20 != null && pos.avgVolume20 > 0) {
    const volRatio = pos.volume / pos.avgVolume20;
    if (volRatio >= 4) score += 50;
    else if (volRatio >= 3) score += 35;
    else if (volRatio >= CLIMAX_VOLUME_THRESHOLD) score += 25;
    else if (volRatio >= 2) score += 10;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * 7. Gap Risk Score (0-100)
 * Risk from overnight gaps exceeding ATR-based thresholds.
 */
export function scoreGapRisk(pos: ExitPosition): number {
  if (pos.overnightGapPct == null) return 0;

  const absGap = Math.abs(pos.overnightGapPct);
  const atrPct = pos.atrPct ?? (pos.atr > 0 && pos.currentPrice > 0
    ? (pos.atr / pos.currentPrice) * 100
    : 0);

  if (atrPct <= 0) return 0;

  const threshold = atrPct * GAP_RISK_ATR_MULT;
  if (absGap <= threshold) return 0;

  // Scale score by how far gap exceeds threshold
  const excess = absGap / threshold;
  if (excess >= 3) return 100;
  if (excess >= 2) return 75;
  if (excess >= 1.5) return 50;
  return 30;
}

/**
 * 8. Relative Strength Decay Score (0-100)
 * How fast is this position losing relative strength?
 */
export function scoreRSDecay(pos: ExitPosition): number {
  if (pos.relativeStrength == null || pos.priorRelativeStrength == null) return 0;

  const decay = pos.priorRelativeStrength - pos.relativeStrength;
  if (decay <= 0) return 0; // RS is rising or flat

  // Absolute RS level matters too — low absolute RS amplifies concern
  const absolutePenalty = pos.relativeStrength < 30 ? 20 : pos.relativeStrength < 50 ? 10 : 0;

  let score = 0;
  if (decay >= 25) score = 80;
  else if (decay >= 20) score = 60;
  else if (decay >= RS_DECAY_THRESHOLD) score = 45;
  else if (decay >= 5) score = 25;
  else score = 10;

  return Math.min(100, Math.max(0, score + absolutePenalty));
}

// ── Action Determination ──────────────────────────────────────

/**
 * Determine the recommended exit action from the score breakdown.
 * Rules are conservative: never auto-exit, never lower stops.
 */
export function determineAction(
  scores: ExitScoreBreakdown,
  pos: ExitPosition
): ExitAction {
  // HEDGE positions: never touch
  if (pos.sleeve === 'HEDGE') return 'DO_NOT_TOUCH';

  // Climax blow-off: immediate trim review
  if (scores.climaxRisk >= 60) return 'TRIM_REVIEW';

  // Strong winner with intact trend: hold and let the trailing stop do its work
  if (scores.winnerHold >= 70 && scores.weakeningTrend < 30 && pos.rMultiple >= STRONG_WINNER_R) {
    return 'HOLD_AND_TRAIL';
  }

  // Exit review: composite exit pressure is very high
  if (scores.exitReview >= 70) return 'EXIT_REVIEW';

  // Trend dying + opportunity cost: review exit
  if (scores.weakeningTrend >= 50 && scores.opportunityCost >= 40) return 'EXIT_REVIEW';

  // Trend weakening but position still above water: tighten
  if (scores.weakeningTrend >= 40 && pos.rMultiple > 0) return 'TIGHTEN_STOP';

  // Dead money: low R after many days
  if (pos.rMultiple < DEAD_MONEY_R && pos.daysHeld > DEAD_MONEY_DAYS) {
    if (scores.opportunityCost >= 30) return 'EXIT_REVIEW';
    return 'REVIEW_EXIT';
  }

  // Moderate exit pressure: review
  if (scores.exitReview >= 50) return 'REVIEW_EXIT';

  // Gap risk: tighten
  if (scores.gapRisk >= 50) return 'TIGHTEN_STOP';

  // Trend healthy, winner worth holding
  if (scores.trendHealth >= 60 && scores.winnerHold >= 50) return 'HOLD';

  // Default: hold
  return 'HOLD';
}

// ── Signal Explainer ──────────────────────────────────────────

function buildSignals(scores: ExitScoreBreakdown, pos: ExitPosition): string[] {
  const signals: string[] = [];

  // Trend
  if (scores.trendHealth >= 70) signals.push(`Strong trend (score ${scores.trendHealth})`);
  else if (scores.trendHealth < 40) signals.push(`Weak trend (score ${scores.trendHealth})`);

  // Winner
  if (scores.winnerHold >= 70) signals.push(`Strong winner — let it run (score ${scores.winnerHold})`);
  else if (scores.winnerHold < 30) signals.push(`Weak hold — capital could be better deployed (score ${scores.winnerHold})`);

  // Weakening
  if (scores.weakeningTrend >= 50) signals.push(`Trend weakening — ADX declining, RS fading (score ${scores.weakeningTrend})`);
  else if (scores.weakeningTrend >= 30) signals.push(`Early trend decay signals (score ${scores.weakeningTrend})`);

  // Opportunity cost
  if (scores.opportunityCost >= 40) {
    const waiting = pos.aGradeCandidatesWaiting ?? 0;
    signals.push(`${waiting} A-grade candidate${waiting !== 1 ? 's' : ''} blocked (score ${scores.opportunityCost})`);
  }

  // Climax
  if (scores.climaxRisk >= 60) signals.push(`Climax/blow-off risk detected (score ${scores.climaxRisk})`);
  else if (scores.climaxRisk >= 30) signals.push(`Elevated extension above MA20 (score ${scores.climaxRisk})`);

  // Gap risk
  if (scores.gapRisk >= 50) signals.push(`Overnight gap exceeds 2× ATR — tighten stop (score ${scores.gapRisk})`);

  // RS decay
  if (scores.rsDecay >= 40) signals.push(`Relative strength decaying — losing momentum vs market (score ${scores.rsDecay})`);

  // Dead money
  if (pos.rMultiple < DEAD_MONEY_R && pos.daysHeld > DEAD_MONEY_DAYS) {
    signals.push(`Dead money: ${pos.rMultiple.toFixed(1)}R after ${pos.daysHeld} days`);
  }

  return signals;
}

function buildExplanation(action: ExitAction, scores: ExitScoreBreakdown, pos: ExitPosition): string {
  const rLabel = pos.rMultiple >= 0 ? `+${pos.rMultiple.toFixed(1)}R` : `${pos.rMultiple.toFixed(1)}R`;
  const stopDist = pos.currentPrice > 0
    ? (((pos.currentPrice - pos.currentStop) / pos.currentPrice) * 100).toFixed(1)
    : '?';

  switch (action) {
    case 'DO_NOT_TOUCH':
      return `${pos.ticker} is a HEDGE position — do not modify.`;
    case 'HOLD_AND_TRAIL':
      return `${pos.ticker} at ${rLabel} is a strong winner with intact trend. Let the trailing stop (${stopDist}% below) protect profits. Do not exit early.`;
    case 'HOLD':
      return `${pos.ticker} at ${rLabel} is performing within expectations. Trend health ${scores.trendHealth}/100. No action needed.`;
    case 'TIGHTEN_STOP':
      return `${pos.ticker} at ${rLabel} shows early weakening signals (trend ${scores.weakeningTrend}/100). Consider tightening stop to lock more profit. Current stop is ${stopDist}% below price.`;
    case 'REVIEW_EXIT':
      return `${pos.ticker} at ${rLabel} after ${pos.daysHeld}d needs review. Exit pressure score ${scores.exitReview}/100. Check whether trend supports continued holding.`;
    case 'TRIM_REVIEW':
      return `${pos.ticker} at ${rLabel} shows climax/blow-off characteristics (${scores.climaxRisk}/100). Consider trimming position or tightening stop aggressively. Parabolic moves often reverse sharply.`;
    case 'EXIT_REVIEW':
      return `${pos.ticker} at ${rLabel} after ${pos.daysHeld}d has high exit pressure (${scores.exitReview}/100). Trend health ${scores.trendHealth}/100, weakening ${scores.weakeningTrend}/100. Seriously consider exiting.`;
  }
}

// ── Main Evaluator ────────────────────────────────────────────

/**
 * Evaluate a single position and produce an exit intelligence report.
 * Pure function — no side effects, no DB access.
 */
export function evaluatePosition(pos: ExitPosition): ExitIntelligenceResult {
  const trendHealth = scoreTrendHealth(pos);
  const winnerHold = scoreWinnerHold(pos);
  const weakeningTrend = scoreWeakeningTrend(pos);
  const opportunityCost = scoreOpportunityCost(pos);
  const climaxRisk = scoreClimaxRisk(pos);
  const gapRisk = scoreGapRisk(pos);
  const rsDecay = scoreRSDecay(pos);

  const exitReview = scoreExitReview(
    trendHealth,
    winnerHold,
    weakeningTrend,
    opportunityCost,
    climaxRisk,
    pos.rMultiple,
    pos.daysHeld
  );

  const scores: ExitScoreBreakdown = {
    trendHealth,
    winnerHold,
    weakeningTrend,
    exitReview,
    opportunityCost,
    climaxRisk,
    gapRisk,
    rsDecay,
  };

  const action = determineAction(scores, pos);
  const signals = buildSignals(scores, pos);
  const explanation = buildExplanation(action, scores, pos);

  const stopDistancePct = pos.currentPrice > 0
    ? ((pos.currentPrice - pos.currentStop) / pos.currentPrice) * 100
    : 0;

  const givebackRiskR = pos.initialRisk > 0
    ? (pos.currentPrice - pos.currentStop) / pos.initialRisk
    : 0;

  const protectionLevel = pos.protectionLevel ||
    inferLevelFromStop(pos.currentStop, pos.entryPrice, pos.initialRisk);

  return {
    ticker: pos.ticker,
    positionId: pos.id,
    action,
    scores,
    rMultiple: pos.rMultiple,
    stopDistancePct: Math.round(stopDistancePct * 10) / 10,
    givebackRiskR: Math.round(givebackRiskR * 10) / 10,
    protectionLevel,
    explanation,
    signals,
    requiresApproval: true,
  };
}

/**
 * Evaluate all positions and return sorted results.
 * Positions needing attention come first.
 */
export function evaluateAllPositions(positions: ExitPosition[]): ExitIntelligenceResult[] {
  const results = positions.map(evaluatePosition);

  // Sort: highest exit pressure first, then by action severity
  const actionPriority: Record<ExitAction, number> = {
    EXIT_REVIEW: 0,
    TRIM_REVIEW: 1,
    REVIEW_EXIT: 2,
    TIGHTEN_STOP: 3,
    HOLD_AND_TRAIL: 4,
    HOLD: 5,
    DO_NOT_TOUCH: 6,
  };

  results.sort((a, b) =>
    actionPriority[a.action] - actionPriority[b.action] ||
    b.scores.exitReview - a.scores.exitReview
  );

  return results;
}
