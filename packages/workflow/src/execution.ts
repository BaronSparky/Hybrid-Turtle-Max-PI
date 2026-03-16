/**
 * DEPENDENCIES
 * Consumed by: scripts/verify-phase7.ts, scripts/submit-planned-trade.ts
 * Consumes: packages/data/src/prisma.ts, packages/broker/src/factory.ts, packages/broker/src/repository.ts
 * Risk-sensitive: YES — submits orders through the broker adapter
 * Last modified: 2026-03-08
 * Notes: Phase 7 execution service. Manages PlannedTrade state transitions (DRAFT→APPROVED→SUBMITTED→FILLED/REJECTED)
 *        and submits orders through the broker adapter. Every order action creates an AuditEvent.
 */
import { PlannedTradeStatus, Prisma } from '@prisma/client';
import { prisma } from '../../data/src/prisma';
import { getBrokerAdapter } from '../../broker/src/factory';
import { createAuditEvent, upsertBrokerOrder } from '../../broker/src/repository';
import type { PlaceOrderInput } from '../../broker/src/types';
import { assertSubmissionAllowed } from './safety-controls';

/** Valid state transitions for planned trades. */
const VALID_TRANSITIONS: Record<string, PlannedTradeStatus[]> = {
  [PlannedTradeStatus.DRAFT]: [PlannedTradeStatus.APPROVED, PlannedTradeStatus.CANCELLED],
  [PlannedTradeStatus.APPROVED]: [PlannedTradeStatus.READY, PlannedTradeStatus.CANCELLED],
  [PlannedTradeStatus.READY]: [PlannedTradeStatus.SUBMITTED, PlannedTradeStatus.CANCELLED],
  [PlannedTradeStatus.SUBMITTED]: [PlannedTradeStatus.FILLED, PlannedTradeStatus.CANCELLED, PlannedTradeStatus.REJECTED],
  // Terminal states — no further transitions
  [PlannedTradeStatus.FILLED]: [],
  [PlannedTradeStatus.CANCELLED]: [],
  [PlannedTradeStatus.REJECTED]: [],
};

export interface TradeTransitionResult {
  plannedTradeId: string;
  symbol: string;
  previousStatus: string;
  newStatus: string;
  success: boolean;
  error?: string;
}

export interface OrderSubmissionResult {
  plannedTradeId: string;
  symbol: string;
  brokerOrderId: string;
  orderStatus: string;
  success: boolean;
  error?: string;
}

/**
 * Transitions a planned trade to a new status with validation.
 * Returns an error result (not an exception) if the transition is invalid.
 */
export async function transitionPlannedTrade(
  plannedTradeId: string,
  newStatus: PlannedTradeStatus,
): Promise<TradeTransitionResult> {
  const trade = await prisma.plannedTrade.findUnique({
    where: { id: plannedTradeId },
  });

  if (!trade) {
    return { plannedTradeId, symbol: '', previousStatus: '', newStatus, success: false, error: 'Trade not found.' };
  }

  const allowed = VALID_TRANSITIONS[trade.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return {
      plannedTradeId,
      symbol: trade.symbol,
      previousStatus: trade.status,
      newStatus,
      success: false,
      error: `Invalid transition: ${trade.status} → ${newStatus}.`,
    };
  }

  await prisma.plannedTrade.update({
    where: { id: plannedTradeId },
    data: { status: newStatus },
  });

  await createAuditEvent(
    `PLANNED_TRADE_${newStatus}`,
    'PlannedTrade',
    plannedTradeId,
    { symbol: trade.symbol, previousStatus: trade.status, newStatus },
  );

  return {
    plannedTradeId,
    symbol: trade.symbol,
    previousStatus: trade.status,
    newStatus,
    success: true,
  };
}

/**
 * Approves a DRAFT planned trade, moving it to APPROVED status.
 */
export async function approvePlannedTrade(plannedTradeId: string): Promise<TradeTransitionResult> {
  return transitionPlannedTrade(plannedTradeId, PlannedTradeStatus.APPROVED);
}

/**
 * Marks an APPROVED planned trade as READY for execution.
 */
export async function markTradeReady(plannedTradeId: string): Promise<TradeTransitionResult> {
  return transitionPlannedTrade(plannedTradeId, PlannedTradeStatus.READY);
}

/**
 * Submits a READY planned trade to the broker.
 *
 * 1. Validates the trade is in READY status
 * 2. Builds the order payload from the planned trade fields
 * 3. Calls adapter.placeOrder()
 * 4. Creates a BrokerOrder record linked to the PlannedTrade
 * 5. Transitions the PlannedTrade to SUBMITTED
 * 6. Logs the entire operation as an AuditEvent
 */
export async function submitPlannedTrade(plannedTradeId: string): Promise<OrderSubmissionResult> {
  const trade = await prisma.plannedTrade.findUnique({
    where: { id: plannedTradeId },
  });

  if (!trade) {
    return { plannedTradeId, symbol: '', brokerOrderId: '', orderStatus: '', success: false, error: 'Trade not found.' };
  }

  if (trade.status !== PlannedTradeStatus.READY) {
    return {
      plannedTradeId,
      symbol: trade.symbol,
      brokerOrderId: '',
      orderStatus: '',
      success: false,
      error: `Trade must be READY to submit, current status: ${trade.status}.`,
    };
  }

  await assertSubmissionAllowed({ automated: true });

  // Build order input from planned trade
  const orderInput: PlaceOrderInput = {
    symbol: trade.symbol,
    side: trade.side,
    orderType: trade.plannedEntryType === 'MARKET' ? 'MARKET' : 'LIMIT',
    quantity: trade.plannedQuantity.toNumber(),
    limitPrice: trade.plannedEntryType === 'LIMIT' ? trade.plannedEntryPrice.toNumber() : undefined,
    stopPrice: trade.plannedEntryType === 'STOP' ? trade.plannedEntryPrice.toNumber() : undefined,
  };

  try {
    const adapter = getBrokerAdapter();
    const result = await adapter.placeOrder(orderInput);

    // Create BrokerOrder record linked to the PlannedTrade
    await upsertBrokerOrder(
      {
        brokerOrderId: result.brokerOrderId,
        accountId: (result.rawPayload?.accountId as string) ?? adapter.adapterName,
        accountType: (result.rawPayload?.accountType as string) ?? adapter.adapterName,
        symbol: trade.symbol,
        side: trade.side,
        orderType: orderInput.orderType,
        status: result.status,
        quantity: orderInput.quantity,
        filledQuantity: null,
        limitPrice: orderInput.limitPrice ?? null,
        stopPrice: orderInput.stopPrice ?? null,
        averageFillPrice: null,
        submittedAt: result.acceptedAt,
        updatedAt: result.acceptedAt,
      },
      undefined,
      trade.id,
    );

    // Transition planned trade to SUBMITTED
    await prisma.plannedTrade.update({
      where: { id: trade.id },
      data: { status: PlannedTradeStatus.SUBMITTED },
    });

    // Audit trail
    await createAuditEvent(
      'ORDER_SUBMITTED',
      'PlannedTrade',
      trade.id,
      {
        symbol: trade.symbol,
        brokerOrderId: result.brokerOrderId,
        orderStatus: result.status,
        orderInput: orderInput as unknown as Prisma.InputJsonValue,
        rawPayload: result.rawPayload as Prisma.InputJsonValue,
      },
    );

    return {
      plannedTradeId: trade.id,
      symbol: trade.symbol,
      brokerOrderId: result.brokerOrderId,
      orderStatus: result.status,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown order submission error';

    // Mark trade as REJECTED on submission failure
    await prisma.plannedTrade.update({
      where: { id: trade.id },
      data: { status: PlannedTradeStatus.REJECTED },
    });

    await createAuditEvent(
      'ORDER_SUBMISSION_FAILED',
      'PlannedTrade',
      trade.id,
      { symbol: trade.symbol, error: message, orderInput: orderInput as unknown as Prisma.InputJsonValue },
    );

    return {
      plannedTradeId: trade.id,
      symbol: trade.symbol,
      brokerOrderId: '',
      orderStatus: 'REJECTED',
      success: false,
      error: message,
    };
  }
}

/**
 * Cancels a planned trade. Valid from DRAFT, APPROVED, or READY states.
 */
export async function cancelPlannedTrade(plannedTradeId: string): Promise<TradeTransitionResult> {
  return transitionPlannedTrade(plannedTradeId, PlannedTradeStatus.CANCELLED);
}

/**
 * Gets all planned trades for a given execution session date, with their linked broker orders.
 */
export async function getPlannedTradesForSession(executionSessionDate: Date) {
  return prisma.plannedTrade.findMany({
    where: { executionSessionDate },
    include: {
      brokerOrders: {
        orderBy: { submittedAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Gets the full execution audit trail for a planned trade.
 */
export async function getTradeAuditTrail(plannedTradeId: string) {
  return prisma.auditEvent.findMany({
    where: {
      entityType: 'PlannedTrade',
      entityId: plannedTradeId,
    },
    orderBy: { createdAt: 'asc' },
  });
}
