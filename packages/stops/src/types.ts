/**
 * DEPENDENCIES
 * Consumed by: packages/stops/src/dashboard.ts, packages/stops/src/service.ts, scripts/show-stop-dashboard.ts, scripts/verify-phase8.ts
 * Consumes: none
 * Risk-sensitive: YES
 * Last modified: 2026-03-08
 * Notes: Phase 8 stop-management view and workflow contracts.
 */
export type StopDashboardStatus = 'PENDING' | 'ACTIVE' | 'MISSING' | 'MISMATCHED' | 'FAILED' | 'CLOSED';

/** Protective stop statuses considered "active" for resolution and filtering. */
export const ACTIVE_STOP_STATUSES = ['PLANNED', 'SUBMITTED', 'PENDING', 'ACTIVE', 'MISMATCH', 'MISSING'] as const;

export interface ResolvedStopPlan {
  stopPrice: number;
  reference: string | null;
  source: 'PLAN' | 'EXISTING_STOP';
}

export interface ProtectiveStopWorkflowResult {
  positionsChecked: number;
  verifiedStops: number;
  activeStops: number;
  missingStops: number;
  mismatchedStops: number;
  failedStops: number;
  closedStops: number;
  createdStops: number;
  updatedStops: number;
  missingStopsCreated: number;
}

export interface StopDashboardRow {
  symbol: string;
  brokerPositionId: string;
  positionSize: number;
  intendedStop: number | null;
  brokerStopReference: string | null;
  verificationTime: string | null;
  alertState: string;
  stopSource: string;
  status: StopDashboardStatus;
  isProtected: boolean;
}

export interface StopDashboardData {
  summary: {
    positionsCount: number;
    protectedCount: number;
    unprotectedCount: number;
    mismatchedCount: number;
    failedCount: number;
  };
  rows: StopDashboardRow[];
}