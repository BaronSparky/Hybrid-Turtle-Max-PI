/**
 * DEPENDENCIES
 * Consumed by: packages/workflow/src/plan.ts, scripts/verify-phase6.ts
 * Consumes: packages/risk/src/account-state.ts, packages/risk/src/sizing.ts, packages/risk/src/types.ts, packages/config/src/env.ts
 * Risk-sensitive: YES (advisory) — determines whether a candidate trade is approved or blocked
 * Last modified: 2026-03-08
 * Notes: This is the Phase 6 advisory risk gate layer. It does NOT replace the sacred risk-gates.ts
 *        in the main app — it provides a modular, pre-trade validation for the evening workflow.
 */
import { env } from '../../config/src/env';
import { getAccountRiskState } from './account-state';
import { calculateTradeSize } from './sizing';
import type { AccountRiskState, RiskViolation, TradeRiskAssessment } from './types';

/** Maximum open risk as percentage of equity before new trades are blocked. */
const MAX_OPEN_RISK_PCT = 10.0;

/** Maximum number of open positions (matches SMALL_ACCOUNT profile). */
const MAX_POSITIONS = 4;

/** Maximum single-position concentration as percentage of portfolio. */
const MAX_POSITION_WEIGHT_PCT = 30.0;

/** Maximum acceptable stop distance as percentage of entry price. */
const MAX_STOP_DISTANCE_PCT = 10.0;

/**
 * Validates a candidate trade against the account risk state and returns a full assessment.
 *
 * Hard violations block the trade (approved = false).
 * Soft violations are warnings that don't block.
 */
export function assessTradeRisk(
  symbol: string,
  entryPrice: number,
  stopPrice: number,
  accountState: AccountRiskState,
): TradeRiskAssessment {
  const sizing = calculateTradeSize(symbol, entryPrice, stopPrice, accountState);
  const violations: RiskViolation[] = [];

  // Gate 1: Share count must be at least 1
  if (sizing.recommendedShares < 1) {
    violations.push({
      rule: 'MIN_SHARES',
      message: `Insufficient capital for even 1 share of ${symbol} at ${entryPrice}.`,
      severity: 'HARD',
    });
  }

  // Gate 2: Open risk after trade must not exceed max
  if (sizing.openRiskPctAfterTrade > MAX_OPEN_RISK_PCT) {
    violations.push({
      rule: 'MAX_OPEN_RISK',
      message: `Open risk would reach ${sizing.openRiskPctAfterTrade.toFixed(1)}% (max ${MAX_OPEN_RISK_PCT}%).`,
      severity: 'HARD',
    });
  }

  // Gate 3: Position count must not exceed max
  if (accountState.openPositionCount >= MAX_POSITIONS) {
    violations.push({
      rule: 'MAX_POSITIONS',
      message: `Already at ${accountState.openPositionCount} open positions (max ${MAX_POSITIONS}).`,
      severity: 'HARD',
    });
  }

  // Gate 4: Stop distance must be reasonable
  if (sizing.stopDistancePct > MAX_STOP_DISTANCE_PCT) {
    violations.push({
      rule: 'STOP_DISTANCE',
      message: `Stop distance ${sizing.stopDistancePct.toFixed(1)}% exceeds max ${MAX_STOP_DISTANCE_PCT}%.`,
      severity: 'HARD',
    });
  }

  // Gate 5: Stop must be below entry
  if (stopPrice >= entryPrice) {
    violations.push({
      rule: 'STOP_BELOW_ENTRY',
      message: `Stop price (${stopPrice}) must be below entry price (${entryPrice}).`,
      severity: 'HARD',
    });
  }

  // Gate 6: Single-position concentration check
  const totalValueAfter = accountState.totalMarketValue + sizing.positionValue;
  const newPositionWeight = totalValueAfter > 0 ? (sizing.positionValue / totalValueAfter) * 100 : 0;
  if (newPositionWeight > MAX_POSITION_WEIGHT_PCT) {
    violations.push({
      rule: 'CONCENTRATION',
      message: `Position would be ${newPositionWeight.toFixed(1)}% of portfolio (max ${MAX_POSITION_WEIGHT_PCT}%).`,
      severity: 'HARD',
    });
  }

  // Soft warning: missing stops on existing positions
  if (accountState.missingStopCount > 0) {
    violations.push({
      rule: 'MISSING_STOPS',
      message: `${accountState.missingStopCount} existing position(s) lack protective stops.`,
      severity: 'SOFT',
    });
  }

  // Soft warning: cash balance is low relative to position value
  if (sizing.positionValue > 0 && sizing.positionValue > accountState.cashBalance * 0.9) {
    violations.push({
      rule: 'LOW_CASH',
      message: 'Trade would consume most available cash.',
      severity: 'SOFT',
    });
  }

  const hardViolations = violations.filter((v) => v.severity === 'HARD');
  const approved = hardViolations.length === 0 && sizing.recommendedShares >= 1;

  const rationaleLines: string[] = [];
  if (approved) {
    rationaleLines.push(`Approved: ${sizing.recommendedShares} shares at ${entryPrice}, risk £${sizing.riskPerTrade.toFixed(2)}/trade.`);
    rationaleLines.push(`Open risk after: ${sizing.openRiskPctAfterTrade.toFixed(1)}% of equity.`);
  } else {
    rationaleLines.push(`Blocked: ${hardViolations.map((v) => v.rule).join(', ')}.`);
  }
  if (violations.filter((v) => v.severity === 'SOFT').length > 0) {
    rationaleLines.push(`Warnings: ${violations.filter((v) => v.severity === 'SOFT').map((v) => v.message).join(' ')}`);
  }

  return {
    symbol,
    sizing,
    violations,
    approved,
    rationale: rationaleLines.join(' '),
  };
}

/**
 * Validates a batch of candidates against the current account risk state.
 * Progressively updates the working account state as candidates are approved,
 * so that each subsequent candidate sees the cumulative risk impact.
 */
export async function validateCandidateBatch(
  candidates: Array<{ symbol: string; entryPrice: number; stopPrice: number }>,
): Promise<{ accountState: AccountRiskState; assessments: TradeRiskAssessment[] }> {
  const accountState = await getAccountRiskState();
  const assessments: TradeRiskAssessment[] = [];
  let workingState = { ...accountState };

  for (const candidate of candidates) {
    const assessment = assessTradeRisk(candidate.symbol, candidate.entryPrice, candidate.stopPrice, workingState);
    assessments.push(assessment);

    // If approved, update working state so subsequent candidates see cumulative risk
    if (assessment.approved) {
      workingState = {
        ...workingState,
        totalOpenRisk: assessment.sizing.openRiskAfterTrade,
        openRiskPct: assessment.sizing.openRiskPctAfterTrade,
        openPositionCount: workingState.openPositionCount + 1,
        totalMarketValue: workingState.totalMarketValue + assessment.sizing.positionValue,
        cashBalance: workingState.cashBalance - assessment.sizing.positionValue,
      };
    }
  }

  return { accountState, assessments };
}
