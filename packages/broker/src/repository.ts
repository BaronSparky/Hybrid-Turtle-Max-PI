import {
  AssetType,
  BrokerOrderStatus,
  JobRunStatus,
  PlannedTradeStatus,
  Prisma,
} from '@prisma/client';
import { prisma, toInputJson } from '../../data/src/prisma';
import type {
  BrokerInstrumentMeta,
  BrokerOrderSnapshot,
  BrokerPortfolioSnapshot,
  BrokerPositionSnapshot,
} from './types';

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export async function createBrokerSyncRun(adapter: string) {
  const startedAt = new Date();
  const syncRun = await prisma.brokerSyncRun.create({
    data: {
      adapter,
      source: 'BROKER_SYNC',
      startedAt,
      status: JobRunStatus.RUNNING,
    },
  });

  const jobRun = await prisma.jobRun.create({
    data: {
      jobName: 'broker.sync',
      status: JobRunStatus.RUNNING,
      startedAt,
      detailsJson: toInputJson({
        brokerSyncRunId: syncRun.id,
        adapter,
      }),
    },
  });

  return {
    brokerSyncRunId: syncRun.id,
    jobRunId: jobRun.id,
    startedAt,
  };
}

export async function savePortfolioSnapshot(brokerSyncRunId: string, portfolio: BrokerPortfolioSnapshot) {
  return prisma.portfolioSnapshot.create({
    data: {
      brokerSyncRunId,
      snapshotAt: new Date(),
      accountId: portfolio.accountId,
      accountType: portfolio.accountType,
      source: 'BROKER_SYNC',
      currency: portfolio.currency,
      cashBalance: toDecimal(portfolio.cashBalance),
      equity: toDecimal(portfolio.equity),
      buyingPower: portfolio.buyingPower == null ? null : toDecimal(portfolio.buyingPower),
      totalMarketValue: portfolio.totalMarketValue == null ? null : toDecimal(portfolio.totalMarketValue),
      dailyPnl: portfolio.dailyPnl == null ? null : toDecimal(portfolio.dailyPnl),
      rawPayloadJson: toInputJson(portfolio),
    },
  });
}

export async function ensureInstrumentFromBroker(meta: BrokerInstrumentMeta) {
  return prisma.instrument.upsert({
    where: { symbol: meta.symbol },
    update: {
      name: meta.name,
      exchange: meta.exchange,
      currency: meta.currency,
      assetType: meta.assetType,
      dataSource: 'BROKER',
    },
    create: {
      symbol: meta.symbol,
      name: meta.name,
      exchange: meta.exchange,
      currency: meta.currency,
      assetType: meta.assetType,
      dataSource: 'BROKER',
      isActive: true,
      isPriceDataStale: false,
    },
  });
}

export async function ensureInstrumentFallback(symbol: string) {
  return prisma.instrument.upsert({
    where: { symbol },
    update: {},
    create: {
      symbol,
      name: symbol,
      exchange: 'UNKNOWN',
      currency: 'USD',
      assetType: AssetType.STOCK,
      dataSource: 'BROKER',
      isActive: true,
      isPriceDataStale: false,
    },
  });
}

export async function findOpenBrokerPositions() {
  return prisma.brokerPosition.findMany({
    where: { isOpen: true },
    select: {
      id: true,
      brokerPositionId: true,
      symbol: true,
    },
  });
}

export async function upsertBrokerPosition(position: BrokerPositionSnapshot, instrumentId?: string) {
  const existing = await prisma.brokerPosition.findUnique({
    where: { brokerPositionId: position.brokerPositionId },
    select: { id: true },
  });

  const record = await prisma.brokerPosition.upsert({
    where: { brokerPositionId: position.brokerPositionId },
    update: {
      instrumentId,
      accountId: position.accountId,
      accountType: position.accountType,
      symbol: position.symbol,
      quantity: toDecimal(position.quantity),
      averagePrice: toDecimal(position.averagePrice),
      marketPrice: toDecimal(position.marketPrice),
      marketValue: toDecimal(position.marketValue),
      unrealizedPnl: toDecimal(position.unrealizedPnl),
      currency: position.currency ?? null,
      isOpen: true,
      closedAt: null,
      lastSyncedAt: new Date(),
      updatedAt: position.updatedAt,
    },
    create: {
      brokerPositionId: position.brokerPositionId,
      instrumentId,
      accountId: position.accountId,
      accountType: position.accountType,
      symbol: position.symbol,
      quantity: toDecimal(position.quantity),
      averagePrice: toDecimal(position.averagePrice),
      marketPrice: toDecimal(position.marketPrice),
      marketValue: toDecimal(position.marketValue),
      unrealizedPnl: toDecimal(position.unrealizedPnl),
      currency: position.currency ?? null,
      isOpen: true,
      lastSyncedAt: new Date(),
      updatedAt: position.updatedAt,
    },
  });

  return {
    record,
    wasMissingLocally: !existing,
  };
}

export async function closeLocalBrokerPositions(missingBrokerPositionIds: string[]) {
  if (missingBrokerPositionIds.length === 0) {
    return [];
  }

  const positions = await prisma.brokerPosition.findMany({
    where: {
      brokerPositionId: { in: missingBrokerPositionIds },
      isOpen: true,
    },
    select: {
      id: true,
      brokerPositionId: true,
      symbol: true,
    },
  });

  await prisma.brokerPosition.updateMany({
    where: {
      brokerPositionId: { in: missingBrokerPositionIds },
      isOpen: true,
    },
    data: {
      isOpen: false,
      closedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });

  return positions;
}

export async function findMatchingPlannedTrade(order: BrokerOrderSnapshot) {
  return prisma.plannedTrade.findFirst({
    where: {
      symbol: order.symbol,
      side: order.side,
      status: {
        in: [PlannedTradeStatus.DRAFT, PlannedTradeStatus.APPROVED, PlannedTradeStatus.READY, PlannedTradeStatus.SUBMITTED, PlannedTradeStatus.FILLED],
      },
      executionSessionDate: {
        gte: new Date(order.submittedAt.getTime() - 7 * 24 * 60 * 60 * 1000),
        lte: new Date(order.submittedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { executionSessionDate: 'desc' },
    select: { id: true },
  });
}

export async function upsertBrokerOrder(order: BrokerOrderSnapshot, instrumentId?: string, plannedTradeId?: string) {
  return prisma.brokerOrder.upsert({
    where: { brokerOrderId: order.brokerOrderId },
    update: {
      instrumentId,
      plannedTradeId,
      accountId: order.accountId,
      accountType: order.accountType,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      status: order.status,
      quantity: toDecimal(order.quantity),
      filledQuantity: order.filledQuantity == null ? null : toDecimal(order.filledQuantity),
      limitPrice: order.limitPrice == null ? null : toDecimal(order.limitPrice),
      stopPrice: order.stopPrice == null ? null : toDecimal(order.stopPrice),
      averageFillPrice: order.averageFillPrice == null ? null : toDecimal(order.averageFillPrice),
      submittedAt: order.submittedAt,
      lastSyncedAt: new Date(),
      updatedAt: order.updatedAt,
      rawPayloadJson: toInputJson(order),
    },
    create: {
      brokerOrderId: order.brokerOrderId,
      instrumentId,
      plannedTradeId,
      accountId: order.accountId,
      accountType: order.accountType,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      status: order.status,
      quantity: toDecimal(order.quantity),
      filledQuantity: order.filledQuantity == null ? null : toDecimal(order.filledQuantity),
      limitPrice: order.limitPrice == null ? null : toDecimal(order.limitPrice),
      stopPrice: order.stopPrice == null ? null : toDecimal(order.stopPrice),
      averageFillPrice: order.averageFillPrice == null ? null : toDecimal(order.averageFillPrice),
      submittedAt: order.submittedAt,
      lastSyncedAt: new Date(),
      updatedAt: order.updatedAt,
      rawPayloadJson: toInputJson(order),
    },
  });
}

export async function findOrphanStops(liveSymbols: string[]) {
  return prisma.protectiveStop.findMany({
    where: {
      status: {
        in: ['PLANNED', 'SUBMITTED', 'ACTIVE', 'MISMATCH'],
      },
      OR: [
        {
          linkedPositionId: null,
          symbol: { notIn: liveSymbols },
        },
        {
          linkedPosition: {
            isOpen: false,
          },
        },
      ],
    },
    select: {
      id: true,
      symbol: true,
      linkedPositionId: true,
    },
  });
}

export async function createAuditEvent(eventType: string, entityType: string, entityId: string, payloadJson: Prisma.InputJsonValue) {
  return prisma.auditEvent.create({
    data: {
      eventType,
      entityType,
      entityId,
      payloadJson,
    },
  });
}

export async function finalizeBrokerSyncRun(args: {
  brokerSyncRunId: string;
  jobRunId: string;
  startedAt: Date;
  positionsCount: number;
  ordersCount: number;
  discrepancyCount: number;
  summaryJson: Prisma.InputJsonValue;
  diffJson: Prisma.InputJsonValue;
}) {
  const finishedAt = new Date();
  const status = args.discrepancyCount > 0 ? JobRunStatus.PARTIAL : JobRunStatus.SUCCEEDED;

  await prisma.brokerSyncRun.update({
    where: { id: args.brokerSyncRunId },
    data: {
      finishedAt,
      positionsCount: args.positionsCount,
      ordersCount: args.ordersCount,
      discrepancyCount: args.discrepancyCount,
      status,
      summaryJson: args.summaryJson,
      diffJson: args.diffJson,
      errorSummary: args.discrepancyCount > 0 ? `${args.discrepancyCount} discrepancies detected.` : null,
    },
  });

  await prisma.jobRun.update({
    where: { id: args.jobRunId },
    data: {
      finishedAt,
      durationMs: finishedAt.getTime() - args.startedAt.getTime(),
      status,
      detailsJson: toInputJson({
        brokerSyncRunId: args.brokerSyncRunId,
        positionsCount: args.positionsCount,
        ordersCount: args.ordersCount,
        discrepancyCount: args.discrepancyCount,
      }),
      errorMessage: args.discrepancyCount > 0 ? `${args.discrepancyCount} discrepancies detected.` : null,
    },
  });

  await createAuditEvent('BROKER_SYNC_COMPLETED', 'BrokerSyncRun', args.brokerSyncRunId, args.summaryJson);
}

export async function failBrokerSyncRun(args: {
  brokerSyncRunId: string;
  jobRunId: string;
  startedAt: Date;
  errorMessage: string;
}) {
  const finishedAt = new Date();

  await prisma.brokerSyncRun.update({
    where: { id: args.brokerSyncRunId },
    data: {
      finishedAt,
      status: JobRunStatus.FAILED,
      errorSummary: args.errorMessage,
    },
  });

  await prisma.jobRun.update({
    where: { id: args.jobRunId },
    data: {
      finishedAt,
      durationMs: finishedAt.getTime() - args.startedAt.getTime(),
      status: JobRunStatus.FAILED,
      errorMessage: args.errorMessage,
    },
  });

  await createAuditEvent('BROKER_SYNC_FAILED', 'BrokerSyncRun', args.brokerSyncRunId, {
    errorMessage: args.errorMessage,
  });
}

export async function getLatestPortfolioSnapshot() {
  return prisma.portfolioSnapshot.findFirst({
    orderBy: { snapshotAt: 'desc' },
  });
}

export async function getOpenPositionsWithStops() {
  return prisma.brokerPosition.findMany({
    where: { isOpen: true },
    include: {
      instrument: true,
      protectiveStops: {
        orderBy: { updatedAt: 'desc' },
      },
    },
    orderBy: { symbol: 'asc' },
  });
}

export async function getRecentAuditEvents(limit = 25) {
  return prisma.auditEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}