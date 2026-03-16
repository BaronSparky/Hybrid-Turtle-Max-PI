/**
 * DEPENDENCIES
 * Consumed by: packages/stops/src/dashboard.ts, packages/stops/src/service.ts
 * Consumes: packages/data/src/prisma.ts
 * Risk-sensitive: YES
 * Last modified: 2026-03-08
 * Notes: Centralized persistence helpers for Phase 8 stop management.
 */
import { PlannedTradeStatus, Prisma, ProtectiveStopSource, ProtectiveStopStatus, StopAlertState } from '@prisma/client';
import { prisma } from '../../data/src/prisma';
import { ACTIVE_STOP_STATUSES } from './types';

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export async function getOpenPositionsForStopManagement() {
  return prisma.brokerPosition.findMany({
    where: { isOpen: true },
    include: {
      protectiveStops: {
        orderBy: { updatedAt: 'desc' },
      },
      instrument: true,
    },
    orderBy: { symbol: 'asc' },
  });
}

export async function getLatestPlannedStopForSymbol(symbol: string) {
  const linkedFilledOrder = await prisma.brokerOrder.findFirst({
    where: {
      symbol,
      status: 'FILLED',
      plannedTradeId: { not: null },
    },
    include: {
      plannedTrade: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { submittedAt: 'desc' }],
  });

  if (linkedFilledOrder?.plannedTrade) {
    return {
      plannedTradeId: linkedFilledOrder.plannedTrade.id,
      stopPrice: linkedFilledOrder.plannedTrade.plannedStopPrice.toNumber(),
    };
  }

  const plannedTrade = await prisma.plannedTrade.findFirst({
    where: {
      symbol,
      status: {
        in: [
          PlannedTradeStatus.DRAFT,
          PlannedTradeStatus.APPROVED,
          PlannedTradeStatus.READY,
          PlannedTradeStatus.SUBMITTED,
          PlannedTradeStatus.FILLED,
        ],
      },
    },
    orderBy: [{ executionSessionDate: 'desc' }, { updatedAt: 'desc' }],
  });

  if (!plannedTrade) {
    return null;
  }

  return {
    plannedTradeId: plannedTrade.id,
    stopPrice: plannedTrade.plannedStopPrice.toNumber(),
  };
}

export async function upsertProtectiveStopRecord(args: {
  linkedPositionId: string;
  symbol: string;
  stopPrice: number;
  status: ProtectiveStopStatus;
  source: ProtectiveStopSource;
  alertState: StopAlertState;
  brokerReference?: string | null;
  lastVerifiedAt: Date;
}) {
  const existing = await prisma.protectiveStop.findFirst({
    where: {
      linkedPositionId: args.linkedPositionId,
      status: {
        in: [...ACTIVE_STOP_STATUSES],
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (existing) {
    const updated = await prisma.protectiveStop.update({
      where: { id: existing.id },
      data: {
        symbol: args.symbol,
        stopPrice: toDecimal(args.stopPrice),
        status: args.status,
        source: args.source,
        alertState: args.alertState,
        brokerReference: args.brokerReference ?? existing.brokerReference,
        lastVerifiedAt: args.lastVerifiedAt,
      },
    });

    return { record: updated, created: false };
  }

  const created = await prisma.protectiveStop.create({
    data: {
      linkedPositionId: args.linkedPositionId,
      symbol: args.symbol,
      stopPrice: toDecimal(args.stopPrice),
      status: args.status,
      source: args.source,
      alertState: args.alertState,
      brokerReference: args.brokerReference ?? null,
      lastVerifiedAt: args.lastVerifiedAt,
    },
  });

  return { record: created, created: true };
}

export async function closeInactiveProtectiveStops() {
  const stoppable = await prisma.protectiveStop.findMany({
    where: {
      status: {
        in: [...ACTIVE_STOP_STATUSES],
      },
      linkedPosition: {
        isOpen: false,
      },
    },
    select: { id: true },
  });

  if (stoppable.length === 0) {
    return 0;
  }

  await prisma.protectiveStop.updateMany({
    where: {
      id: {
        in: stoppable.map((stop) => stop.id),
      },
    },
    data: {
      status: ProtectiveStopStatus.CANCELLED,
      alertState: StopAlertState.CLEAR,
      lastVerifiedAt: new Date(),
    },
  });

  return stoppable.length;
}

export async function createStopAuditEvent(
  eventType: string,
  entityType: string,
  entityId: string,
  payloadJson: Prisma.InputJsonValue,
) {
  return prisma.auditEvent.create({
    data: {
      eventType,
      entityType,
      entityId,
      payloadJson,
    },
  });
}