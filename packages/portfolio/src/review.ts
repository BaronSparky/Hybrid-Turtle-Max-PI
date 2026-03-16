/**
 * DEPENDENCIES
 * Consumed by: packages/portfolio/src/index.ts, src/app/api/review/summary/route.ts, src/app/planned-trades/page.tsx, src/app/stops/page.tsx, src/app/orders/page.tsx, src/app/jobs/page.tsx, scripts/verify-phase9.ts
 * Consumes: packages/data/src/prisma.ts, packages/portfolio/src/view.ts, packages/portfolio/src/review-types.ts, packages/stops/src/index.ts, packages/workflow/src/repository.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 evening-review projection over existing portfolio, stop, order, plan, and job state.
 */
import { prisma } from '../../data/src/prisma';
import { getStopDashboardData } from '../../stops/src';
import { getNextExecutionSessionDate } from '../../workflow/src/repository';
import { getPortfolioPageData, decimalToNumber } from './view';
import type {
  AuditEventReviewRow,
  DataFreshnessStatus,
  EveningReviewData,
  EveningReviewSummary,
  JobReviewRow,
  OrderReviewRow,
  PlannedTradeReviewRow,
} from './review-types';

function deriveDataFreshnessStatus(jobStatus: string | null, staleSymbolCount: number): DataFreshnessStatus {
  if (!jobStatus) {
    return staleSymbolCount > 0 ? 'STALE' : 'UNKNOWN';
  }

  if (jobStatus === 'FAILED' || staleSymbolCount > 0) {
    return 'STALE';
  }

  if (jobStatus === 'PARTIAL') {
    return 'PARTIAL';
  }

  if (jobStatus === 'SUCCEEDED') {
    return 'FRESH';
  }

  return 'UNKNOWN';
}

function mapPlannedTradeRow(trade: Awaited<ReturnType<typeof prisma.plannedTrade.findMany>>[number] & {
  brokerOrders: Array<{ status: string }>;
}): PlannedTradeReviewRow {
  return {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    status: trade.status,
    plannedQuantity: trade.plannedQuantity.toNumber(),
    plannedEntryType: trade.plannedEntryType,
    plannedEntryPrice: trade.plannedEntryPrice.toNumber(),
    plannedStopPrice: trade.plannedStopPrice.toNumber(),
    rationale: trade.rationale,
    riskApproved: trade.riskApproved,
    riskRationale: trade.riskRationale,
    notes: trade.notes,
    executionSessionDate: trade.executionSessionDate.toISOString(),
    createdAt: trade.createdAt.toISOString(),
    brokerOrderStatus: trade.brokerOrders[0]?.status ?? null,
  };
}

function mapOrderRow(order: Awaited<ReturnType<typeof prisma.brokerOrder.findMany>>[number]): OrderReviewRow {
  return {
    id: order.id,
    brokerOrderId: order.brokerOrderId,
    symbol: order.symbol,
    side: order.side,
    status: order.status,
    orderType: order.orderType,
    quantity: order.quantity.toNumber(),
    filledQuantity: decimalToNumber(order.filledQuantity),
    limitPrice: decimalToNumber(order.limitPrice),
    stopPrice: decimalToNumber(order.stopPrice),
    averageFillPrice: decimalToNumber(order.averageFillPrice),
    accountType: order.accountType ?? null,
    submittedAt: order.submittedAt?.toISOString() ?? null,
    updatedAt: order.updatedAt.toISOString(),
    plannedTradeId: order.plannedTradeId ?? null,
  };
}

function mapJobRow(job: Awaited<ReturnType<typeof prisma.jobRun.findMany>>[number]): JobReviewRow {
  return {
    id: job.id,
    jobName: job.jobName,
    status: job.status,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    durationMs: job.durationMs ?? null,
    errorMessage: job.errorMessage ?? null,
    summary: job.summary ?? null,
  };
}

function mapAuditRow(event: Awaited<ReturnType<typeof prisma.auditEvent.findMany>>[number]): AuditEventReviewRow {
  return {
    id: event.id,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function getEveningReviewData(): Promise<EveningReviewData> {
  const nextExecutionSessionDate = getNextExecutionSessionDate();

  const [
    portfolioView,
    stops,
    latestSignalRun,
    plannedTrades,
    latestBrokerSync,
    latestDataRefreshJob,
    staleSymbolCount,
    orders,
    jobs,
    auditEvents,
  ] = await Promise.all([
    getPortfolioPageData(),
    getStopDashboardData(),
    prisma.signalRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: {
        _count: {
          select: {
            candidates: true,
          },
        },
      },
    }),
    prisma.plannedTrade.findMany({
      where: {
        executionSessionDate: nextExecutionSessionDate,
      },
      include: {
        brokerOrders: {
          select: { status: true },
          orderBy: [{ updatedAt: 'desc' }, { submittedAt: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
    prisma.brokerSyncRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: {
        status: true,
        finishedAt: true,
      },
    }),
    prisma.jobRun.findFirst({
      where: { jobName: 'market-data.refresh-universe-daily-bars' },
      orderBy: { startedAt: 'desc' },
      select: {
        status: true,
        finishedAt: true,
      },
    }),
    prisma.instrument.count({
      where: {
        isActive: true,
        isPriceDataStale: true,
      },
    }),
    prisma.brokerOrder.findMany({
      take: 50,
      orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
    }),
    prisma.jobRun.findMany({
      take: 25,
      orderBy: { startedAt: 'desc' },
    }),
    prisma.auditEvent.findMany({
      take: 25,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const tonightApprovedPlanCount = plannedTrades.filter((trade) =>
    ['APPROVED', 'READY', 'SUBMITTED', 'FILLED'].includes(trade.status)
  ).length;

  const summary: EveningReviewSummary = {
    currency: portfolioView.summary.currency,
    accountEquity: portfolioView.summary.equity,
    cash: portfolioView.summary.cashBalance,
    openPositions: portfolioView.summary.positionsCount,
    openRisk: portfolioView.summary.totalOpenRisk,
    protectedPositions: stops.summary.protectedCount,
    unprotectedPositions: stops.summary.unprotectedCount,
    tonightCandidateCount: latestSignalRun?._count.candidates ?? 0,
    tonightApprovedPlanCount,
    latestBrokerSyncStatus: latestBrokerSync?.status ?? null,
    latestBrokerSyncAt: latestBrokerSync?.finishedAt?.toISOString() ?? null,
    latestDataFreshnessStatus: deriveDataFreshnessStatus(latestDataRefreshJob?.status ?? null, staleSymbolCount),
    latestDataRefreshAt: latestDataRefreshJob?.finishedAt?.toISOString() ?? null,
    staleSymbolCount,
  };

  return {
    summary,
    plannedTrades: plannedTrades.map(mapPlannedTradeRow),
    stops,
    orders: orders.map(mapOrderRow),
    jobs: jobs.map(mapJobRow),
    auditEvents: auditEvents.map(mapAuditRow),
  };
}

export async function getEveningReviewSummary(): Promise<EveningReviewSummary> {
  const data = await getEveningReviewData();
  return data.summary;
}