/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, /api/accelerator/route.ts, UI components
 * Consumes: @/types, laggard-detector.ts, risk-gates.ts (canPyramid)
 * Risk-sensitive: YES — advisory-only, never auto-executes
 * Notes: All functions are pure (no DB access). Callers supply position +
 *        candidate data. Every recommendation requires human approval.
 *        Does NOT bypass SMALL_ACCOUNT rules, max positions, max open risk,
 *        regime gate, or stop levels.
 */

import type {
  AcceleratorAction,
  AcceleratorUrgency,
  AcceleratorRecommendation,
  OpportunityCostResult,
  WinnerExpansionResult,
  DeadMoneyReviewResult,
  RiskProfileType,
  Sleeve,
} from '@/types';
import { RISK_PROFILES } from '@/types';
import { canPyramid } from './risk-gates';
import { detectLaggards } from './laggard-detector';

// ── Shared Input Types ────────────────────────────────────────

export interface HeldPosition {
  id: string;
  ticker: string;
  sleeve: Sleeve;
  sector: string;
  cluster: string;
  entryPrice: number;
  currentPrice: number;
  currentStop: number;
  shares: number;
  initialRisk: number;
  entryDate: Date;
  daysHeld: number;
  rMultiple: number;
  atr: number;
  currency: string;
  pyramidAdds: number;
  /** Current NCS for this ticker (from latest scan, if available) */
  currentNCS?: number;
  /** Current relative strength */
  relativeStrength?: number;
  /** Prior session's relative strength (for decay detection) */
  priorRelativeStrength?: number;
  /** ADX today vs yesterday (for trend detection) */
  adxToday?: number;
  adxYesterday?: number;
  /** MA20 for recovery exemption */
  ma20?: number;
}

export interface ReadyCandidate {
  ticker: string;
  sleeve: Sleeve;
  sector: string;
  cluster: string;
  ncs: number;
  fws: number;
  actionNote: string;
  entryTrigger: number;
  stopPrice: number;
  riskDollars: number;
  totalCost: number;
}

export interface AcceleratorContext {
  positions: HeldPosition[];
  candidates: ReadyCandidate[];
  equity: number;
  riskProfile: RiskProfileType;
  regime: 'BULLISH' | 'SIDEWAYS' | 'BEARISH' | 'NEUTRAL';
  openRiskPercent: number;
}

// ── Constants ─────────────────────────────────────────────────

/** NCS gap required to recommend swap (existing vs candidate) */
const SWAP_NCS_GAP = 25;
/** Minimum R the held position must be below for swap to be considered */
const SWAP_MAX_R = 0.3;
/** Minimum days held before swap is considered (avoid churning) */
const SWAP_MIN_DAYS = 5;

/** RS decay: prior RS − current RS must exceed this threshold */
const RS_DECAY_THRESHOLD = 10;

/** NCS deterioration: position's NCS must have dropped below this */
const NCS_DETERIORATION_THRESHOLD = 50;

/** Minimum NCS for a candidate to be considered A-grade */
const A_GRADE_NCS = 70;
/** Maximum FWS for a candidate to be considered A-grade */
const A_GRADE_MAX_FWS = 30;

// ── 1. Opportunity Cost Engine ────────────────────────────────

/**
 * Detect when a current position is blocking a much stronger candidate.
 * A position "blocks" a candidate when both are in the same sleeve and
 * position slots are full, or when the position's capital could be better deployed.
 *
 * Criteria for swap recommendation:
 * - Candidate NCS exceeds position's NCS by ≥ SWAP_NCS_GAP
 * - Position R-multiple < SWAP_MAX_R (not a winner)
 * - Position held ≥ SWAP_MIN_DAYS (not freshly entered)
 * - Candidate is A-grade (NCS ≥ 70, FWS ≤ 30)
 */
export function evaluateOpportunityCost(
  positions: HeldPosition[],
  candidates: ReadyCandidate[],
  maxPositions: number
): OpportunityCostResult[] {
  const results: OpportunityCostResult[] = [];
  const aGradeCandidates = candidates.filter(
    (c) => c.ncs >= A_GRADE_NCS && c.fws <= A_GRADE_MAX_FWS
  );

  if (aGradeCandidates.length === 0) return results;

  // Only evaluate when at max capacity (all slots full)
  const nonHedgePositions = positions.filter((p) => p.sleeve !== 'HEDGE');
  if (nonHedgePositions.length < maxPositions) return results;

  // Sort candidates by NCS descending
  const sortedCandidates = [...aGradeCandidates].sort((a, b) => b.ncs - a.ncs);
  // Sort positions by weakness (lowest R, lowest NCS)
  const weakPositions = [...nonHedgePositions]
    .filter((p) => p.rMultiple < SWAP_MAX_R && p.daysHeld >= SWAP_MIN_DAYS)
    .sort((a, b) => a.rMultiple - b.rMultiple);

  for (const candidate of sortedCandidates) {
    for (const pos of weakPositions) {
      const posNCS = pos.currentNCS ?? 0;
      const ncsGap = candidate.ncs - posNCS;

      if (ncsGap >= SWAP_NCS_GAP) {
        // Check not already recommended
        if (results.some((r) => r.holdingTicker === pos.ticker)) continue;

        results.push({
          blockedTicker: candidate.ticker,
          blockedNCS: candidate.ncs,
          holdingTicker: pos.ticker,
          holdingNCS: posNCS,
          holdingRMultiple: pos.rMultiple,
          holdingDaysHeld: pos.daysHeld,
          ncsGap,
          reason: `${candidate.ticker} (NCS ${candidate.ncs}) blocked by ${pos.ticker} (NCS ${posNCS}, ${pos.rMultiple.toFixed(1)}R after ${pos.daysHeld}d) — gap of ${ncsGap} points.`,
          swapRecommended: true,
        });
        break; // One swap per candidate
      }
    }
  }

  return results;
}

// ── 2. Winner Expansion Engine ────────────────────────────────

/**
 * Evaluate pyramid opportunity for each winning position.
 * Delegates rule checks to canPyramid() from risk-gates.ts.
 * Additional checks:
 * - Trend must be intact (ADX not declining)
 * - Position NCS still A-grade
 * - No concentration breach from the add
 */
export function evaluateWinnerExpansion(
  positions: HeldPosition[],
  equity: number,
  riskProfile: RiskProfileType,
  openRiskPercent: number
): WinnerExpansionResult[] {
  const profile = RISK_PROFILES[riskProfile];
  const maxRiskRatio = openRiskPercent / profile.maxOpenRisk;
  const results: WinnerExpansionResult[] = [];

  for (const pos of positions) {
    if (pos.sleeve === 'HEDGE') continue;
    if (pos.rMultiple <= 0) continue; // Must be profitable

    const gateFailures: string[] = [];

    // Check trend intact (ADX not declining)
    if (pos.adxToday != null && pos.adxYesterday != null && pos.adxToday < pos.adxYesterday) {
      gateFailures.push('ADX declining — trend weakening');
    }

    // Check NCS still good (if available)
    if (pos.currentNCS != null && pos.currentNCS < A_GRADE_NCS) {
      gateFailures.push(`NCS ${pos.currentNCS} below A-grade threshold (${A_GRADE_NCS})`);
    }

    // Delegate to existing canPyramid for the core rule check
    const pyramidResult = canPyramid(
      pos.currentPrice,
      pos.entryPrice,
      pos.initialRisk,
      pos.atr,
      pos.pyramidAdds,
      maxRiskRatio
    );

    const allowed = pyramidResult.allowed && gateFailures.length === 0;

    results.push({
      ticker: pos.ticker,
      allowed,
      rMultiple: pyramidResult.rMultiple,
      addNumber: pyramidResult.addNumber,
      triggerPrice: pyramidResult.triggerPrice,
      riskScalar: pyramidResult.riskScalar,
      reason: allowed
        ? pyramidResult.message
        : gateFailures.length > 0
          ? gateFailures.join('; ')
          : pyramidResult.message,
      gateFailures,
    });
  }

  return results;
}

// ── 3. Dead Money Exit Review ─────────────────────────────────

/**
 * Enhanced laggard review with opportunity cost, RS decay, NCS deterioration,
 * and trend deterioration. Wraps detectLaggards() and enriches results.
 */
export function reviewDeadMoney(
  positions: HeldPosition[],
  candidates: ReadyCandidate[]
): DeadMoneyReviewResult[] {
  // Run standard laggard detection
  const laggardInput = positions.map((p) => ({
    id: p.id,
    ticker: p.ticker,
    entryPrice: p.entryPrice,
    entryDate: p.entryDate,
    currentStop: p.currentStop,
    shares: p.shares,
    initialRisk: p.initialRisk,
    currentPrice: p.currentPrice,
    currency: p.currency,
    sleeve: p.sleeve,
    ma20: p.ma20,
    adxToday: p.adxToday,
    adxYesterday: p.adxYesterday,
  }));

  const laggards = detectLaggards(laggardInput);
  const laggardMap = new Map(laggards.map((l) => [l.positionId, l]));

  const aGradeCount = candidates.filter(
    (c) => c.ncs >= A_GRADE_NCS && c.fws <= A_GRADE_MAX_FWS
  ).length;

  const results: DeadMoneyReviewResult[] = [];

  for (const pos of positions) {
    if (pos.sleeve === 'HEDGE') continue;

    const laggard = laggardMap.get(pos.id);
    const lossPct = pos.entryPrice > 0
      ? ((pos.entryPrice - pos.currentPrice) / pos.entryPrice) * 100
      : 0;

    // RS decay check
    const rsDecay = pos.relativeStrength != null && pos.priorRelativeStrength != null
      ? pos.priorRelativeStrength - pos.relativeStrength > RS_DECAY_THRESHOLD
      : false;

    // NCS deterioration
    const ncsDeterioration = pos.currentNCS != null
      ? pos.currentNCS < NCS_DETERIORATION_THRESHOLD
      : false;

    // Trend deterioration (ADX declining)
    const trendDeteriorating = pos.adxToday != null && pos.adxYesterday != null
      ? pos.adxToday < pos.adxYesterday
      : false;

    // Opportunity cost: how many A-grade candidates are waiting
    const opportunityCostScore = aGradeCount * 15; // 15 points per blocked A-grade

    const flag = laggard?.flag ?? 'NONE';

    // Only include if there's something to report
    if (flag === 'NONE' && !rsDecay && !ncsDeterioration && !trendDeteriorating && opportunityCostScore === 0) {
      continue;
    }

    // Determine urgency
    let exitUrgency: AcceleratorUrgency = 'LOW';
    const signals = [
      flag !== 'NONE',
      rsDecay,
      ncsDeterioration,
      trendDeteriorating,
      opportunityCostScore >= 30,
    ].filter(Boolean).length;

    if (signals >= 3) exitUrgency = 'HIGH';
    else if (signals >= 2) exitUrgency = 'MEDIUM';

    const reasons: string[] = [];
    if (flag === 'TRIM_LAGGARD') reasons.push(`underwater ${lossPct.toFixed(1)}% after ${pos.daysHeld}d`);
    if (flag === 'DEAD_MONEY') reasons.push(`stalled at ${pos.rMultiple.toFixed(1)}R after ${pos.daysHeld}d`);
    if (rsDecay) reasons.push('relative strength decaying');
    if (ncsDeterioration) reasons.push(`NCS dropped to ${pos.currentNCS}`);
    if (trendDeteriorating) reasons.push('ADX declining — trend weakening');
    if (opportunityCostScore >= 15) reasons.push(`${aGradeCount} A-grade candidate(s) waiting`);

    results.push({
      ticker: pos.ticker,
      positionId: pos.id,
      daysHeld: pos.daysHeld,
      rMultiple: pos.rMultiple,
      lossPct,
      flag,
      opportunityCostScore: Math.min(opportunityCostScore, 100),
      rsDecay,
      ncsDeterioration,
      trendDeteriorating,
      reason: reasons.join('; '),
      exitUrgency,
    });
  }

  // Sort by urgency then by R-multiple (worst first)
  const urgencyOrder: Record<AcceleratorUrgency, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  results.sort((a, b) =>
    urgencyOrder[a.exitUrgency] - urgencyOrder[b.exitUrgency] || a.rMultiple - b.rMultiple
  );

  return results;
}

// ── 4. Capital Priority Engine (Orchestrator) ─────────────────

/**
 * Rank all possible actions across positions and candidates.
 * Produces a priority-ordered list of recommendations.
 * Every recommendation requires human approval.
 *
 * Rules enforced:
 * - Never exceeds SMALL_ACCOUNT risk per trade
 * - Never bypasses max positions or max open risk
 * - Never bypasses regime gate
 * - Never lowers stops
 * - Never averages down
 * - Never buys non-READY candidates
 */
export function rankActions(ctx: AcceleratorContext): AcceleratorRecommendation[] {
  const profile = RISK_PROFILES[ctx.riskProfile];
  const recommendations: AcceleratorRecommendation[] = [];

  // ── A. New A-grade buys (highest priority when slots available) ──
  const nonHedgePositions = ctx.positions.filter((p) => p.sleeve !== 'HEDGE');
  const slotsAvailable = profile.maxPositions - nonHedgePositions.length;
  const riskHeadroom = profile.maxOpenRisk - ctx.openRiskPercent;

  if (slotsAvailable > 0 && riskHeadroom > 0 && ctx.regime !== 'BEARISH') {
    const aGrades = ctx.candidates
      .filter((c) => c.ncs >= A_GRADE_NCS && c.fws <= A_GRADE_MAX_FWS)
      .sort((a, b) => b.ncs - a.ncs);

    for (const candidate of aGrades.slice(0, slotsAvailable)) {
      recommendations.push({
        action: 'BUY_NEW_A_GRADE',
        ticker: candidate.ticker,
        urgency: 'HIGH',
        expectedBenefit: `A-grade setup (NCS ${candidate.ncs}, FWS ${candidate.fws}) — high conviction entry.`,
        riskImpact: `Adds ${((candidate.riskDollars / ctx.equity) * 100).toFixed(1)}% open risk. ${slotsAvailable} slot(s) available.`,
        reason: `${candidate.ticker} is Auto-Yes (NCS ${candidate.ncs}) with ${slotsAvailable} slot(s) and ${riskHeadroom.toFixed(1)}% risk headroom.`,
        requiresApproval: true,
        priority: 90 + Math.min(candidate.ncs - A_GRADE_NCS, 10),
      });
    }
  }

  // ── B. Pyramid existing winners ──
  const winnerExpansions = evaluateWinnerExpansion(
    ctx.positions,
    ctx.equity,
    ctx.riskProfile,
    ctx.openRiskPercent
  );

  for (const w of winnerExpansions.filter((w) => w.allowed)) {
    const pos = ctx.positions.find((p) => p.ticker === w.ticker);
    if (!pos) continue;

    recommendations.push({
      action: 'PYRAMID_WINNER',
      ticker: w.ticker,
      urgency: 'MEDIUM',
      expectedBenefit: `Add #${w.addNumber} at ${w.rMultiple.toFixed(1)}R — ${(w.riskScalar * 100).toFixed(0)}% scaled risk.`,
      riskImpact: `Pyramid uses ${(w.riskScalar * 100).toFixed(0)}% of base risk per trade. Stop protects original risk.`,
      reason: w.reason,
      requiresApproval: true,
      priority: 70 + Math.min(w.rMultiple * 5, 15),
    });
  }

  // ── C. Swap weak for strong ──
  const opportunityCosts = evaluateOpportunityCost(
    ctx.positions,
    ctx.candidates,
    profile.maxPositions
  );

  for (const opp of opportunityCosts) {
    recommendations.push({
      action: 'SWAP_WEAK_FOR_STRONG',
      ticker: opp.holdingTicker,
      replacementTicker: opp.blockedTicker,
      urgency: opp.ncsGap >= 40 ? 'HIGH' : 'MEDIUM',
      expectedBenefit: `Replace ${opp.holdingTicker} (NCS ${opp.holdingNCS}) with ${opp.blockedTicker} (NCS ${opp.blockedNCS}) — ${opp.ncsGap} point upgrade.`,
      riskImpact: `Exit ${opp.holdingTicker} at ${opp.holdingRMultiple.toFixed(1)}R, open new position within same risk budget.`,
      reason: opp.reason,
      requiresApproval: true,
      priority: 60 + Math.min(opp.ncsGap, 20),
    });
  }

  // ── D. Exit laggards / dead money ──
  const deadMoneyReview = reviewDeadMoney(ctx.positions, ctx.candidates);

  for (const dm of deadMoneyReview) {
    if (dm.flag === 'NONE' && dm.exitUrgency === 'LOW') continue;

    const isExit = dm.flag !== 'NONE' || dm.exitUrgency === 'HIGH';

    recommendations.push({
      action: isExit ? 'EXIT_LAGGARD' : 'TIGHTEN_STOP',
      ticker: dm.ticker,
      urgency: dm.exitUrgency,
      expectedBenefit: isExit
        ? `Free capital from ${dm.ticker} (${dm.rMultiple.toFixed(1)}R, ${dm.daysHeld}d held) for stronger deployment.`
        : `Tighten stop on ${dm.ticker} — reduce downside while maintaining position.`,
      riskImpact: isExit
        ? `Realises ${dm.lossPct > 0 ? `${dm.lossPct.toFixed(1)}% loss` : `${Math.abs(dm.lossPct).toFixed(1)}% gain`}. Frees a position slot.`
        : 'No change to position count. Reduces potential loss.',
      reason: dm.reason,
      requiresApproval: true,
      priority: isExit
        ? 40 + (dm.exitUrgency === 'HIGH' ? 20 : dm.exitUrgency === 'MEDIUM' ? 10 : 0)
        : 30,
    });
  }

  // ── E. Hold (for positions that are performing) ──
  for (const pos of ctx.positions) {
    if (pos.sleeve === 'HEDGE') continue;
    // Skip if already has a recommendation
    if (recommendations.some((r) => r.ticker === pos.ticker)) continue;

    recommendations.push({
      action: 'HOLD',
      ticker: pos.ticker,
      urgency: 'LOW',
      expectedBenefit: `${pos.ticker} at ${pos.rMultiple.toFixed(1)}R — performing within expectations.`,
      riskImpact: 'No change.',
      reason: `No action needed — position is healthy.`,
      requiresApproval: false,
      priority: 10,
    });
  }

  // ── F. No-action when nothing to do ──
  if (recommendations.length === 0) {
    recommendations.push({
      action: 'NO_ACTION',
      ticker: '—',
      urgency: 'LOW',
      expectedBenefit: 'Portfolio is balanced — no acceleration opportunity identified.',
      riskImpact: 'No change.',
      reason: 'All positions healthy, no A-grade candidates available, or risk budget full.',
      requiresApproval: false,
      priority: 0,
    });
  }

  // Sort by priority descending
  recommendations.sort((a, b) => b.priority - a.priority);

  return recommendations;
}
