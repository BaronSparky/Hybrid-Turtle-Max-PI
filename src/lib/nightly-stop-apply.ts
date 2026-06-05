/**
 * Pure decision helpers for the nightly stop-apply step.
 *
 * Robustness invariant (real money): the DB stop record must never claim a
 * tighter stop than the broker actually holds. When auto-trading is enabled and
 * a position has a broker ticker, a computed DB stop raise is committed ONLY
 * after the broker confirms it holds at least that stop. This guarantees the DB
 * can only ever UNDERSTATE broker protection, never overstate it.
 */

/** setStopLossBatch actions that confirm the broker now holds at least the requested stop. */
const CONFIRMED_BROKER_ACTIONS = new Set(['PLACED', 'UPDATED', 'SKIPPED_SAME']);

/**
 * True when a setStopLossBatch action means the broker holds at least the
 * requested stop, so it is safe to commit the matching DB stop raise.
 *
 * Non-confirming actions (FAILED, FAILED_PRICE_TOO_FAR, SKIPPED_NOT_OWNED,
 * SKIPPED_PRICE_TOO_FAR, SKIPPED_NO_SHARES) and undefined (never pushed / push
 * threw) all return false → the DB raise must be withheld.
 */
export function isBrokerStopConfirmed(action: string | undefined | null): boolean {
  return typeof action === 'string' && CONFIRMED_BROKER_ACTIONS.has(action);
}

export type StopCommitDecision = 'COMMIT' | 'WITHHOLD';

/**
 * Decide whether a computed DB stop raise may be committed.
 *
 * - Auto-trading OFF → COMMIT (advisory mode: the DB is the system of record and
 *   the user manages the broker manually; divergence is surfaced by the drift
 *   check, not gated here).
 * - No broker ticker → COMMIT (there is no broker order to confirm against).
 * - Auto-trading ON + broker ticker → COMMIT only if the broker confirmed the
 *   stop; otherwise WITHHOLD so the DB never overstates broker protection.
 */
export function decideStopCommit(params: {
  autoTradingEnabled: boolean;
  hasBrokerTicker: boolean;
  brokerAction: string | undefined | null;
}): StopCommitDecision {
  if (!params.autoTradingEnabled) return 'COMMIT';
  if (!params.hasBrokerTicker) return 'COMMIT';
  return isBrokerStopConfirmed(params.brokerAction) ? 'COMMIT' : 'WITHHOLD';
}
