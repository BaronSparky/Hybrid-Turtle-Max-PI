/**
 * DEPENDENCIES
 * Consumed by: packages/stops/src/index.ts, scripts/show-stop-dashboard.ts, scripts/verify-phase8.ts
 * Consumes: packages/stops/src/repository.ts, packages/stops/src/types.ts
 * Risk-sensitive: YES
 * Last modified: 2026-03-08
 * Notes: Projects stop protection state into a dashboard-friendly table.
 */
import type { StopDashboardData, StopDashboardRow, StopDashboardStatus } from './types';
import { ACTIVE_STOP_STATUSES } from './types';
import { getOpenPositionsForStopManagement } from './repository';

function resolveRelevantStop(position: Awaited<ReturnType<typeof getOpenPositionsForStopManagement>>[number]) {
  return (
    position.protectiveStops.find((stop) => ACTIVE_STOP_STATUSES.includes(stop.status)) ??
    position.protectiveStops[0] ??
    null
  );
}

function mapDashboardStatus(status: string | null): StopDashboardStatus {
  switch (status) {
    case null:
      return 'MISSING';
    case 'PLANNED':
    case 'SUBMITTED':
    case 'PENDING':
      return 'PENDING';
    case 'ACTIVE':
      return 'ACTIVE';
    case 'MISSING':
      return 'MISSING';
    case 'MISMATCH':
      return 'MISMATCHED';
    case 'CANCELLED':
    case 'TRIGGERED':
      return 'CLOSED';
    default:
      return 'FAILED';
  }
}

export async function getStopDashboardData(): Promise<StopDashboardData> {
  const positions = await getOpenPositionsForStopManagement();

  const rows: StopDashboardRow[] = positions.map((position) => {
    const currentStop = resolveRelevantStop(position);
    const status = mapDashboardStatus(currentStop?.status ?? null);

    return {
      symbol: position.symbol,
      brokerPositionId: position.brokerPositionId,
      positionSize: position.quantity.toNumber(),
      intendedStop: currentStop?.stopPrice?.toNumber() ?? null,
      brokerStopReference: currentStop?.brokerReference ?? null,
      verificationTime: currentStop?.lastVerifiedAt?.toISOString() ?? null,
      alertState: currentStop?.alertState ?? 'WARNING',
      stopSource: currentStop?.source ?? 'UNKNOWN',
      status,
      isProtected: status === 'ACTIVE',
    };
  });

  const protectedCount = rows.filter((row) => row.isProtected).length;
  const mismatchedCount = rows.filter((row) => row.status === 'MISMATCHED').length;
  const failedCount = rows.filter((row) => row.status === 'FAILED').length;

  return {
    summary: {
      positionsCount: rows.length,
      protectedCount,
      unprotectedCount: rows.length - protectedCount,
      mismatchedCount,
      failedCount,
    },
    rows,
  };
}