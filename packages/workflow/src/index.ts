/**
 * DEPENDENCIES
 * Consumed by: scripts and app/API layers that use workflow package exports
 * Consumes: packages/workflow/src/*
 * Risk-sensitive: MIXED
 * Last modified: 2026-03-09
 * Notes: Public export surface for workflow services, including Phase 10 safety controls.
 */
export { getTonightWorkflowCardData } from './dashboard';
export { buildNextSessionPlan } from './plan';
export { reconcileStopsAndPositions, verifyProtectiveStops } from './reconcile';
export { reviewEveningRisk } from './risk';
export { reviewEveningCandidates, runEveningScan } from './scan';
export {
  assertScanAllowed,
  assertSubmissionAllowed,
  getKillSwitchSettings,
  getMarketDataSafetyStatus,
  isAutoTradingEnabled,
  SafetyControlError,
  updateKillSwitchSettings,
} from './safety-controls';
export { runEveningRefresh, runTonightWorkflow, syncAndVerifyStops } from './service';
export type {
  CandidateReviewResult,
  EveningRefreshResult,
  EveningScanCandidate,
  EveningScanResult,
  NextSessionPlanResult,
  ReconciliationResult,
  RiskReviewResult,
  StopVerificationResult,
  TonightWorkflowActionKey,
  TonightWorkflowCardData,
  TonightWorkflowRunResult,
} from './types';
export type { KillSwitchSettings, MarketDataSafetyStatus } from './safety-controls';