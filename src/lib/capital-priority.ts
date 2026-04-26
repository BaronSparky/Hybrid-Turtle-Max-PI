/**
 * DEPENDENCIES
 * Consumed by: /api/capital-priority/route.ts, TodayDirectiveCard (future)
 * Consumes: @/types, candidate-grade.ts
 * Risk-sensitive: NO — advisory ranking only, does not execute trades
 * Notes: Ranks all possible capital actions from best to worst.
 *        Serves Job 5: dashboard produces plain-English actions.
 *        Pure logic — no DB access. Caller provides data.
 */

import type { OperatingMode } from '@/types';
import { OPERATING_MODES } from '@/types';
import type { CandidateGrade } from './candidate-grade';

// ── Action types ─────────────────────────────────────────────

export type CapitalAction =
  | 'BUY_A_GRADE'
  | 'PYRAMID_WINNER'
  | 'HOLD'
  | 'TIGHTEN_STOP'
  | 'EXIT_REVIEW'
  | 'SWAP_WEAK_FOR_STRONG'
  | 'NO_ACTION';

export interface RankedAction {
  action: CapitalAction;
  ticker: string;
  priority: number;       // 1 = highest
  reason: string;
  requiresApproval: boolean;
}

// ── Input data ───────────────────────────────────────────────

export interface OpenPositionSummary {
  ticker: string;
  rMultiple: number;
  holdDays: number;
  trendHealthy: boolean;
  stopPending: boolean;
  isLaggard: boolean;
  protectionLevel: string;
  sleeve: string;
}

export interface CandidateSummary {
  ticker: string;
  grade: CandidateGrade;
  ncs: number;
  triggerMet: boolean;
}

export interface CapitalPriorityInput {
  positions: OpenPositionSummary[];
  candidates: CandidateSummary[];
  operatingMode: OperatingMode;
  riskBudgetUsedPct: number;
  canEnter: boolean;
}

// ── Priority engine ──────────────────────────────────────────

export function rankCapitalActions(input: CapitalPriorityInput): RankedAction[] {
  const actions: RankedAction[] = [];
  const mode = OPERATING_MODES[input.operatingMode];
  let priority = 1;

  // 1. Stop updates always come first (safety)
  for (const pos of input.positions) {
    if (pos.stopPending) {
      actions.push({
        action: 'TIGHTEN_STOP',
        ticker: pos.ticker,
        priority: priority++,
        reason: `Stop update pending for ${pos.ticker} (${pos.protectionLevel}).`,
        requiresApproval: false,
      });
    }
  }

  // 2. Exit reviews for laggards
  for (const pos of input.positions) {
    if (pos.isLaggard) {
      actions.push({
        action: 'EXIT_REVIEW',
        ticker: pos.ticker,
        priority: priority++,
        reason: `${pos.ticker} flagged as laggard (${pos.rMultiple.toFixed(1)}R, ${pos.holdDays}d held).`,
        requiresApproval: true,
      });
    }
  }

  // 3. A-grade buys (if mode and budget allow)
  // Budget check removed — the pre-execution dry run enforces actual risk gates.
  // This engine is advisory; it should surface opportunities, not duplicate gate logic.
  if (mode.canBuy && input.canEnter) {
    const aGrades = input.candidates
      .filter(c => c.grade === 'A_GRADE_BUY' && c.triggerMet)
      .sort((a, b) => b.ncs - a.ncs);

    for (const cand of aGrades) {
      actions.push({
        action: 'BUY_A_GRADE',
        ticker: cand.ticker,
        priority: priority++,
        reason: `A-grade candidate ${cand.ticker} (NCS ${cand.ncs.toFixed(0)}) — trigger met.`,
        requiresApproval: true,
      });
    }
  }

  // 4. Pyramid opportunities (profitable positions with room)
  if (mode.canPyramid && input.riskBudgetUsedPct < 70) {
    for (const pos of input.positions) {
      if (pos.rMultiple >= 2.0 && pos.trendHealthy && pos.protectionLevel !== 'INITIAL') {
        actions.push({
          action: 'PYRAMID_WINNER',
          ticker: pos.ticker,
          priority: priority++,
          reason: `${pos.ticker} at ${pos.rMultiple.toFixed(1)}R, stop at ${pos.protectionLevel}. Pyramid add opportunity.`,
          requiresApproval: true,
        });
      }
    }
  }

  // 5. Swap weak for strong (only if a laggard exists AND an A-grade is waiting)
  if (mode.canBuy && input.canEnter) {
    const laggards = input.positions.filter(p => p.isLaggard);
    const waitingAGrades = input.candidates.filter(c => c.grade === 'A_GRADE_BUY' && c.triggerMet);

    if (laggards.length > 0 && waitingAGrades.length > 0) {
      const weakest = laggards.sort((a, b) => a.rMultiple - b.rMultiple)[0];
      const strongest = waitingAGrades[0];
      actions.push({
        action: 'SWAP_WEAK_FOR_STRONG',
        ticker: `${weakest.ticker}→${strongest.ticker}`,
        priority: priority++,
        reason: `Consider swapping ${weakest.ticker} (${weakest.rMultiple.toFixed(1)}R laggard) for ${strongest.ticker} (NCS ${strongest.ncs.toFixed(0)} A-grade).`,
        requiresApproval: true,
      });
    }
  }

  // 6. Holds (healthy positions — no action needed)
  for (const pos of input.positions) {
    if (!pos.stopPending && !pos.isLaggard) {
      actions.push({
        action: 'HOLD',
        ticker: pos.ticker,
        priority: priority++,
        reason: `${pos.ticker} at ${pos.rMultiple.toFixed(1)}R — hold. ${pos.trendHealthy ? 'Trend healthy.' : 'Watch for weakening.'}`,
        requiresApproval: false,
      });
    }
  }

  // 7. No action if empty
  if (actions.length === 0) {
    actions.push({
      action: 'NO_ACTION',
      ticker: '',
      priority: 1,
      reason: 'No positions and no candidates. Wait for next scan.',
      requiresApproval: false,
    });
  }

  return actions;
}
