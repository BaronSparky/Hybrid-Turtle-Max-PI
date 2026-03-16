/**
 * DEPENDENCIES
 * Consumed by: packages/workflow/src/service.ts, packages/workflow/src/dashboard.ts, packages/workflow/src/scan.ts
 * Consumes: packages/data/src/prisma.ts, packages/workflow/src/types.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Provides persistence helpers for Phase 4 workflow orchestration, snapshots, and signal candidate storage.
 */
import { JobRunStatus, Prisma, ProtectiveStopSource as StopSource, ProtectiveStopStatus } from '@prisma/client';
import { prisma, toInputJson } from '../../data/src/prisma';
import type { EveningScanCandidate, TonightWorkflowActionKey } from './types';

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function getCurrentSessionDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function getNextExecutionSessionDate(fromDate = new Date()) {
  const date = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 1);

  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

export async function createEveningWorkflowRun() {
  const startedAt = new Date();
  return prisma.eveningWorkflowRun.create({
    data: {
      sessionDate: getCurrentSessionDate(),
      startedAt,
      status: JobRunStatus.RUNNING,
    },
  });
}

export async function startWorkflowStep(eveningWorkflowRunId: string, stepKey: TonightWorkflowActionKey, label: string) {
  return prisma.eveningWorkflowStepRun.create({
    data: {
      eveningWorkflowRunId,
      stepKey,
      label,
      startedAt: new Date(),
      status: JobRunStatus.RUNNING,
    },
  });
}

export async function completeWorkflowStep(stepId: string, status: JobRunStatus, detailsJson: Prisma.InputJsonValue) {
  return prisma.eveningWorkflowStepRun.update({
    where: { id: stepId },
    data: {
      status,
      finishedAt: new Date(),
      detailsJson,
    },
  });
}

export async function failWorkflowStep(stepId: string, errorMessage: string) {
  return prisma.eveningWorkflowStepRun.update({
    where: { id: stepId },
    data: {
      status: JobRunStatus.FAILED,
      finishedAt: new Date(),
      errorMessage,
    },
  });
}

export async function finalizeWorkflowRun(eveningWorkflowRunId: string, status: JobRunStatus, summaryJson: Prisma.InputJsonValue, errorSummary?: string) {
  return prisma.eveningWorkflowRun.update({
    where: { id: eveningWorkflowRunId },
    data: {
      status,
      finishedAt: new Date(),
      summaryJson,
      errorSummary,
    },
  });
}

export async function createWorkflowAuditEvent(eventType: string, entityId: string, payloadJson: Prisma.InputJsonValue) {
  return prisma.auditEvent.create({
    data: {
      eventType,
      entityType: 'EveningWorkflowRun',
      entityId,
      payloadJson,
    },
  });
}

export async function createSignalRun(scannedSymbols: number, staleSymbols: number) {
  return prisma.signalRun.create({
    data: {
      runType: 'EVENING_SCAN',
      status: 'RUNNING',
      startedAt: new Date(),
      universeSize: scannedSymbols,
      staleSymbolCount: staleSymbols,
    },
  });
}

export async function finalizeSignalRun(signalRunId: string, status: JobRunStatus, notes: string) {
  return prisma.signalRun.update({
    where: { id: signalRunId },
    data: {
      status: status === JobRunStatus.FAILED ? 'FAILED' : status === JobRunStatus.PARTIAL ? 'PARTIAL' : 'SUCCEEDED',
      completedAt: new Date(),
      notes,
    },
  });
}

export async function replaceSignalCandidates(signalRunId: string, candidates: EveningScanCandidate[]) {
  await prisma.signalCandidate.deleteMany({
    where: { signalRunId },
  });

  if (candidates.length === 0) {
    return;
  }

  const instruments = await prisma.instrument.findMany({
    where: { symbol: { in: candidates.map((candidate) => candidate.symbol) } },
    select: { id: true, symbol: true },
  });
  const instrumentBySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument.id]));

  const candidatesWithInstruments = candidates.filter((candidate) => instrumentBySymbol.has(candidate.symbol));
  if (candidatesWithInstruments.length === 0) {
    return;
  }

  await prisma.signalCandidate.createMany({
    data: candidatesWithInstruments.map((candidate) => ({
      signalRunId,
      instrumentId: instrumentBySymbol.get(candidate.symbol)!,
      symbol: candidate.symbol,
      currentPrice: candidate.currentPrice,
      triggerPrice: candidate.triggerPrice,
      initialStop: candidate.initialStop,
      stopDistancePercent: candidate.stopDistancePercent,
      riskPerShare: candidate.riskPerShare,
      setupStatus: candidate.setupStatus,
      rankScore: candidate.rankScore,
      reasonsJson: toInputJson(candidate.reasons),
      warningsJson: toInputJson(candidate.warnings),
    })),
  });
}

export async function getActiveInstrumentsWithBars() {
  const instruments = await prisma.instrument.findMany({
    where: { isActive: true },
    select: {
      id: true,
      symbol: true,
      isPriceDataStale: true,
      dailyBars: {
        orderBy: { date: 'asc' },
      },
    },
  });

  return instruments;
}

export async function getLatestSignalRunWithCandidates() {
  return prisma.signalRun.findFirst({
    where: {
      runType: 'EVENING_SCAN',
      status: 'SUCCEEDED',
    },
    include: {
      candidates: {
        orderBy: { rankScore: 'desc' },
      },
    },
    orderBy: { startedAt: 'desc' },
  });
}

export async function createRiskSnapshot(data: {
  openRisk: number;
  accountEquity?: number | null;
  cashBalance?: number | null;
  concentrationJson: Prisma.InputJsonValue;
  ruleViolationsJson: Prisma.InputJsonValue;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}) {
  return prisma.riskSnapshot.create({
    data: {
      snapshotAt: new Date(),
      openRisk: toDecimal(data.openRisk),
      accountEquity: data.accountEquity == null ? null : toDecimal(data.accountEquity),
      cashBalance: data.cashBalance == null ? null : toDecimal(data.cashBalance),
      concentrationJson: data.concentrationJson,
      ruleViolationsJson: data.ruleViolationsJson,
      riskLevel: data.riskLevel,
    },
  });
}

export async function getLatestPortfolioState() {
  const snapshot = await prisma.portfolioSnapshot.findFirst({
    orderBy: { snapshotAt: 'desc' },
  });

  const positions = await prisma.brokerPosition.findMany({
    where: { isOpen: true },
    include: {
      protectiveStops: {
        orderBy: { updatedAt: 'desc' },
      },
    },
    orderBy: { symbol: 'asc' },
  });

  return {
    snapshot,
    positions,
  };
}

export async function findExistingPlannedTrade(symbol: string, executionSessionDate: Date) {
  return prisma.plannedTrade.findFirst({
    where: {
      symbol,
      executionSessionDate,
      status: {
        in: ['DRAFT', 'APPROVED', 'READY', 'SUBMITTED'],
      },
    },
    select: { id: true },
  });
}

export async function createPlannedTradeFromCandidate(
  candidate: EveningScanCandidate,
  executionSessionDate: Date,
  quantity: number,
  riskInfo?: { riskPerTrade: number; riskApproved: boolean; riskRationale: string; riskViolationsJson: unknown[] },
) {
  return prisma.plannedTrade.create({
    data: {
      symbol: candidate.symbol,
      side: 'BUY',
      plannedQuantity: new Prisma.Decimal(quantity),
      plannedEntryType: 'LIMIT',
      plannedEntryPrice: toDecimal(candidate.triggerPrice),
      plannedStopPrice: toDecimal(candidate.initialStop),
      rationale: `Evening workflow plan: ${candidate.setupStatus}. Reasons: ${candidate.reasons.join('; ')}`,
      status: 'DRAFT',
      executionSessionDate,
      notes: candidate.warnings.length > 0 ? `Warnings: ${candidate.warnings.join('; ')}` : null,
      riskPerTrade: riskInfo?.riskPerTrade ?? null,
      riskApproved: riskInfo?.riskApproved ?? null,
      riskRationale: riskInfo?.riskRationale ?? null,
      riskViolationsJson: riskInfo?.riskViolationsJson == null ? undefined : toInputJson(riskInfo.riskViolationsJson),
    },
  });
}

export async function ensureMissingStopRecord(positionId: string, symbol: string) {
  const existing = await prisma.protectiveStop.findFirst({
    where: {
      linkedPositionId: positionId,
      status: {
        in: ['PLANNED', 'SUBMITTED', 'ACTIVE', 'MISMATCH', 'MISSING'],
      },
    },
  });

  if (existing) {
    if (existing.status === ProtectiveStopStatus.MISSING) {
      await prisma.protectiveStop.update({
        where: { id: existing.id },
        data: {
          alertState: 'CRITICAL',
          source: StopSource.UNKNOWN,
          lastVerifiedAt: new Date(),
        },
      });
    }

    return { stopId: existing.id, created: false, status: existing.status };
  }

  const created = await prisma.protectiveStop.create({
    data: {
      symbol,
      linkedPositionId: positionId,
      stopPrice: new Prisma.Decimal(0),
      status: ProtectiveStopStatus.MISSING,
      source: StopSource.UNKNOWN,
      alertState: 'CRITICAL',
      lastVerifiedAt: new Date(),
    },
  });

  return { stopId: created.id, created: true, status: created.status };
}

export async function getLatestWorkflowRun() {
  return prisma.eveningWorkflowRun.findFirst({
    include: {
      steps: {
        orderBy: { startedAt: 'asc' },
      },
    },
    orderBy: { startedAt: 'desc' },
  });
}

export async function countDraftPlannedTradesForNextSession() {
  return prisma.plannedTrade.count({
    where: {
      executionSessionDate: getNextExecutionSessionDate(),
      status: 'DRAFT',
    },
  });
}