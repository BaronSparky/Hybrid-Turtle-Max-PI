/**
 * DEPENDENCIES
 * Consumed by: packages/broker/src/sync.ts, packages/stops/src/index.ts, packages/workflow/src/reconcile.ts, scripts/verify-phase8.ts
 * Consumes: packages/stops/src/repository.ts, packages/stops/src/types.ts
 * Risk-sensitive: YES
 * Last modified: 2026-03-08
 * Notes: Applies the Phase 8 stop workflow without lowering an existing stop.
 */
import { Prisma, ProtectiveStopSource, ProtectiveStopStatus, StopAlertState } from '@prisma/client';
import {
  closeInactiveProtectiveStops,
  createStopAuditEvent,
  getLatestPlannedStopForSymbol,
  getOpenPositionsForStopManagement,
  upsertProtectiveStopRecord,
} from './repository';
import type { ProtectiveStopWorkflowResult, ResolvedStopPlan } from './types';
import { ACTIVE_STOP_STATUSES } from './types';
import { toInputJson } from '../../data/src/prisma';

const STOP_TOLERANCE = 0.0001;

function isNear(left: number, right: number) {
  const divisor = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / divisor <= STOP_TOLERANCE;
}

function resolveRelevantStop(position: Awaited<ReturnType<typeof getOpenPositionsForStopManagement>>[number]) {
  return (
    position.protectiveStops.find((stop) => ACTIVE_STOP_STATUSES.includes(stop.status)) ??
    position.protectiveStops[0] ??
    null
  );
}

async function resolveStopPlan(symbol: string, currentStopPrice: number | null): Promise<ResolvedStopPlan | null> {
  const plannedStop = await getLatestPlannedStopForSymbol(symbol);

  if (plannedStop && plannedStop.stopPrice > 0) {
    return {
      stopPrice: plannedStop.stopPrice,
      reference: `planned-trade:${plannedStop.plannedTradeId}`,
      source: 'PLAN',
    };
  }

  if (currentStopPrice != null && currentStopPrice > 0) {
    return {
      stopPrice: currentStopPrice,
      reference: null,
      source: 'EXISTING_STOP',
    };
  }

  return null;
}

async function logStopEvent(entityType: string | undefined, entityId: string | undefined, eventType: string, payload: Record<string, unknown>) {
  if (!entityType || !entityId) {
    return;
  }

  await createStopAuditEvent(eventType, entityType, entityId, toInputJson(payload));
}

export async function runProtectiveStopWorkflow(args: {
  entityType?: string;
  entityId?: string;
} = {}): Promise<ProtectiveStopWorkflowResult> {
  const positions = await getOpenPositionsForStopManagement();
  const closedStops = await closeInactiveProtectiveStops();

  let verifiedStops = 0;
  let activeStops = 0;
  let missingStops = 0;
  let mismatchedStops = 0;
  let failedStops = 0;
  let createdStops = 0;
  let updatedStops = 0;
  let missingStopsCreated = 0;

  for (const position of positions) {
    const now = new Date();
    const currentStop = resolveRelevantStop(position);
    const currentStopPrice = currentStop?.stopPrice?.toNumber() ?? null;
    const stopPlan = await resolveStopPlan(position.symbol, currentStopPrice);

    if (!stopPlan) {
      const result = await upsertProtectiveStopRecord({
        linkedPositionId: position.id,
        symbol: position.symbol,
        stopPrice: currentStopPrice ?? 0,
        status: ProtectiveStopStatus.MISSING,
        source: currentStop?.source ?? ProtectiveStopSource.UNKNOWN,
        alertState: StopAlertState.CRITICAL,
        brokerReference: currentStop?.brokerReference ?? null,
        lastVerifiedAt: now,
      });

      missingStops += 1;
      if (result.created) {
        createdStops += 1;
        missingStopsCreated += 1;
      } else {
        updatedStops += 1;
      }

      await logStopEvent(args.entityType, args.entityId, 'PROTECTIVE_STOP_MISSING', {
        symbol: position.symbol,
        brokerPositionId: position.brokerPositionId,
        protectiveStopId: result.record.id,
      });
      continue;
    }

    if (
      currentStop &&
      ['BROKER', 'BROKER_NATIVE'].includes(currentStop.source) &&
      currentStopPrice != null &&
      !isNear(currentStopPrice, stopPlan.stopPrice)
    ) {
      const result = await upsertProtectiveStopRecord({
        linkedPositionId: position.id,
        symbol: position.symbol,
        stopPrice: currentStopPrice,
        status: ProtectiveStopStatus.MISMATCH,
        source: currentStop.source,
        alertState: StopAlertState.ALERT,
        brokerReference: currentStop.brokerReference,
        lastVerifiedAt: now,
      });

      mismatchedStops += 1;
      verifiedStops += 1;
      if (result.created) {
        createdStops += 1;
      } else {
        updatedStops += 1;
      }

      await logStopEvent(args.entityType, args.entityId, 'PROTECTIVE_STOP_MISMATCH', {
        symbol: position.symbol,
        brokerPositionId: position.brokerPositionId,
        protectiveStopId: result.record.id,
        expectedStop: stopPlan.stopPrice,
        brokerStop: currentStopPrice,
      });
      continue;
    }

    const finalStopPrice = currentStopPrice == null || currentStopPrice <= 0 ? stopPlan.stopPrice : Math.max(currentStopPrice, stopPlan.stopPrice);
    const source =
      currentStop?.source && currentStop.source !== ProtectiveStopSource.UNKNOWN
        ? currentStop.source
        : stopPlan.source === 'PLAN'
          ? ProtectiveStopSource.SOFTWARE_ONLY
          : ProtectiveStopSource.LOCAL;
    const alertState = source === ProtectiveStopSource.SOFTWARE_ONLY ? StopAlertState.WARNING : StopAlertState.CLEAR;

    const result = await upsertProtectiveStopRecord({
      linkedPositionId: position.id,
      symbol: position.symbol,
      stopPrice: finalStopPrice,
      status: ProtectiveStopStatus.ACTIVE,
      source,
      alertState,
      brokerReference: stopPlan.reference ?? currentStop?.brokerReference ?? null,
      lastVerifiedAt: now,
    });

    verifiedStops += 1;
    activeStops += 1;
    if (result.created) {
      createdStops += 1;
    } else {
      updatedStops += 1;
    }

    await logStopEvent(args.entityType, args.entityId, 'PROTECTIVE_STOP_VERIFIED', {
      symbol: position.symbol,
      brokerPositionId: position.brokerPositionId,
      protectiveStopId: result.record.id,
      stopPrice: finalStopPrice,
      source,
    });
  }

  return {
    positionsChecked: positions.length,
    verifiedStops,
    activeStops,
    missingStops,
    mismatchedStops,
    failedStops,
    closedStops,
    createdStops,
    updatedStops,
    missingStopsCreated,
  };
}