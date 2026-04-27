import cron from 'node-cron';
import { BrokerOrderStatus, Prisma } from '@prisma/client';
import { env } from '../../config/src/env';
import { runProtectiveStopWorkflow } from '../../stops/src';
import { getBrokerAdapter } from './factory';
import {
  closeLocalBrokerPositions,
  createAuditEvent,
  createBrokerSyncRun,
  ensureInstrumentFallback,
  ensureInstrumentFromBroker,
  failBrokerSyncRun,
  finalizeBrokerSyncRun,
  findMatchingPlannedTrade,
  findOpenBrokerPositions,
  findOrphanStops,
  savePortfolioSnapshot,
  upsertBrokerOrder,
  upsertBrokerPosition,
} from './repository';
import type { BrokerInstrumentMeta, BrokerOrderSnapshot, BrokerSyncResult } from './types';
import { toInputJson } from '../../data/src/prisma';

type DiscrepancyRecord = {
  type: string;
  symbol?: string;
  brokerPositionId?: string;
  brokerOrderId?: string;
  protectiveStopId?: string;
  payload: Record<string, unknown>;
};

async function resolveInstrumentId(symbol: string, instrumentMetaCache: Map<string, BrokerInstrumentMeta | null>) {
  let meta = instrumentMetaCache.get(symbol);
  const adapter = getBrokerAdapter();
  if (meta === undefined) {
    meta = await adapter.getInstrumentMeta(symbol);
    instrumentMetaCache.set(symbol, meta);
  }

  if (meta) {
    const instrument = await ensureInstrumentFromBroker(meta);
    return instrument.id;
  }

  const fallback = await ensureInstrumentFallback(symbol);
  return fallback.id;
}

async function logDiscrepancy(brokerSyncRunId: string, discrepancy: DiscrepancyRecord) {
  await createAuditEvent(discrepancy.type, 'BrokerSyncRun', brokerSyncRunId, toInputJson(discrepancy.payload));
}

async function reconcileFilledOrder(order: BrokerOrderSnapshot) {
  const matchedPlan = await findMatchingPlannedTrade(order);
  return matchedPlan?.id;
}

export async function runBrokerSync(): Promise<BrokerSyncResult> {
  const adapter = getBrokerAdapter();
  const syncRun = await createBrokerSyncRun(adapter.adapterName);
  const instrumentMetaCache = new Map<string, BrokerInstrumentMeta | null>();

  try {
    const [portfolio, brokerPositions, brokerOrders, openLocalPositions] = await Promise.all([
      adapter.getPortfolio(),
      adapter.getPositions(),
      adapter.getOrders(),
      findOpenBrokerPositions(),
    ]);

    await savePortfolioSnapshot(syncRun.brokerSyncRunId, portfolio);

    const discrepancies: DiscrepancyRecord[] = [];
    const newLocalPositions: string[] = [];
    const currentBrokerPositionIds = new Set<string>();
    const currentBrokerSymbols = new Set<string>();

    for (const position of brokerPositions) {
      currentBrokerPositionIds.add(position.brokerPositionId);
      currentBrokerSymbols.add(position.symbol);
      const instrumentId = await resolveInstrumentId(position.symbol, instrumentMetaCache);
      const upserted = await upsertBrokerPosition(position, instrumentId);

      if (upserted.wasMissingLocally) {
        newLocalPositions.push(position.symbol);
        const discrepancy = {
          type: 'BROKER_POSITION_MISSING_LOCALLY',
          symbol: position.symbol,
          brokerPositionId: position.brokerPositionId,
          payload: {
            brokerSyncRunId: syncRun.brokerSyncRunId,
            symbol: position.symbol,
            brokerPositionId: position.brokerPositionId,
            quantity: position.quantity,
          },
        } satisfies DiscrepancyRecord;
        discrepancies.push(discrepancy);
        await logDiscrepancy(syncRun.brokerSyncRunId, discrepancy);
      }
    }

    const localMissingFromBroker = openLocalPositions.filter(
      (position) => !currentBrokerPositionIds.has(position.brokerPositionId),
    );

    const closedLocalPositions = await closeLocalBrokerPositions(
      localMissingFromBroker.map((position) => position.brokerPositionId),
    );

    for (const position of closedLocalPositions) {
      const discrepancy = {
        type: 'LOCAL_POSITION_ABSENT_FROM_BROKER',
        symbol: position.symbol,
        brokerPositionId: position.brokerPositionId,
        payload: {
          brokerSyncRunId: syncRun.brokerSyncRunId,
          symbol: position.symbol,
          brokerPositionId: position.brokerPositionId,
        },
      } satisfies DiscrepancyRecord;
      discrepancies.push(discrepancy);
      await logDiscrepancy(syncRun.brokerSyncRunId, discrepancy);
    }

    for (const order of brokerOrders) {
      const instrumentId = await resolveInstrumentId(order.symbol, instrumentMetaCache);
      const plannedTradeId = order.status === BrokerOrderStatus.FILLED ? await reconcileFilledOrder(order) : undefined;

      if (order.status === BrokerOrderStatus.FILLED && !plannedTradeId) {
        const discrepancy = {
          type: 'FILLED_ORDER_WITHOUT_PLAN',
          symbol: order.symbol,
          brokerOrderId: order.brokerOrderId,
          payload: {
            brokerSyncRunId: syncRun.brokerSyncRunId,
            symbol: order.symbol,
            brokerOrderId: order.brokerOrderId,
            quantity: order.quantity,
            submittedAt: order.submittedAt.toISOString(),
          },
        } satisfies DiscrepancyRecord;
        discrepancies.push(discrepancy);
        await logDiscrepancy(syncRun.brokerSyncRunId, discrepancy);
      }

      await upsertBrokerOrder(order, instrumentId, plannedTradeId);
    }

    const orphanStops = await findOrphanStops(Array.from(currentBrokerSymbols));

    for (const stop of orphanStops) {
      const discrepancy = {
        type: 'ORPHAN_LOCAL_STOP',
        symbol: stop.symbol,
        protectiveStopId: stop.id,
        payload: {
          brokerSyncRunId: syncRun.brokerSyncRunId,
          symbol: stop.symbol,
          protectiveStopId: stop.id,
          linkedPositionId: stop.linkedPositionId,
        },
      } satisfies DiscrepancyRecord;
      discrepancies.push(discrepancy);
      await logDiscrepancy(syncRun.brokerSyncRunId, discrepancy);
    }

    const stopWorkflow = await runProtectiveStopWorkflow({
      entityType: 'BrokerSyncRun',
      entityId: syncRun.brokerSyncRunId,
    });

    const summary = {
      brokerSyncRunId: syncRun.brokerSyncRunId,
      adapter: adapter.adapterName,
      accountId: portfolio.accountId,
      positionsCount: brokerPositions.length,
      ordersCount: brokerOrders.length,
      discrepancyCount: discrepancies.length,
      stopWorkflow,
    };

    const diff = {
      newLocalPositions,
      closedLocalPositions: closedLocalPositions.map((position) => position.symbol),
      discrepancies,
      stopWorkflow,
    };

    await finalizeBrokerSyncRun({
      brokerSyncRunId: syncRun.brokerSyncRunId,
      jobRunId: syncRun.jobRunId,
      startedAt: syncRun.startedAt,
      positionsCount: brokerPositions.length,
      ordersCount: brokerOrders.length,
      discrepancyCount: discrepancies.length,
      summaryJson: toInputJson(summary),
      diffJson: toInputJson(diff),
    });

    return {
      runId: syncRun.brokerSyncRunId,
      positionsCount: brokerPositions.length,
      ordersCount: brokerOrders.length,
      discrepancyCount: discrepancies.length,
      newLocalPositions,
      closedLocalPositions: closedLocalPositions.map((position) => position.symbol),
      discrepancies,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown broker sync error';
    await failBrokerSyncRun({
      brokerSyncRunId: syncRun.brokerSyncRunId,
      jobRunId: syncRun.jobRunId,
      startedAt: syncRun.startedAt,
      errorMessage: message,
    });
    throw error;
  }
}

export function registerBrokerSyncJob() {
  return cron.schedule(env.BROKER_SYNC_CRON, async () => {
    try {
      await runBrokerSync();
    } catch (error) {
      console.error('Broker sync failed.', error);
    }
  });
}