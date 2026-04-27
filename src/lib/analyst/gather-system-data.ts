/**
 * DEPENDENCIES
 * Consumed by: /api/analyst/summary/route.ts, telegram-commands.ts
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only DB queries
 * Notes: Gathers system state data from DB for the analyst prompt builder.
 *        Shared between the API route and Telegram commands to avoid duplication.
 */

import prisma from '@/lib/prisma';
import { RISK_PROFILES, OPERATING_MODES, type RiskProfileType, type OperatingMode } from '@/types';
import type { SystemSummaryData } from './prompt-builder';

const DEFAULT_USER_ID = 'default-user';

/**
 * Gather system state directly from the database.
 * Returns a SystemSummaryData object ready for the prompt builder.
 */
export async function gatherSystemData(userId: string = DEFAULT_USER_ID): Promise<SystemSummaryData> {
  const [user, latestHealth, latestHeartbeat, openPositions, latestScan, pendingStops] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        equity: true,
        riskProfile: true,
        operatingMode: true,
        t212Connected: true,
        t212IsaConnected: true,
      },
    }),
    prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { overall: true, runDate: true },
    }),
    prisma.heartbeat.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { status: true, timestamp: true },
    }),
    prisma.position.count({
      where: { userId, status: 'OPEN' },
    }),
    prisma.scan.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: {
        runDate: true,
        regime: true,
        results: {
          select: { status: true, passesAllFilters: true },
        },
      },
    }),
    prisma.stopHistory.count({
      where: {
        position: { userId, status: 'OPEN' },
        createdAt: { gte: new Date(Date.now() - 48 * 3600000) },
      },
    }),
  ]);

  const now = Date.now();
  const riskProfile = (user?.riskProfile || 'BALANCED') as RiskProfileType;
  const profileConfig = RISK_PROFILES[riskProfile];
  const operatingMode = (user?.operatingMode || 'NORMAL') as OperatingMode;

  const heartbeatAgeHours = latestHeartbeat
    ? (now - latestHeartbeat.timestamp.getTime()) / 3600000
    : 999;
  const scanAgeHours = latestScan
    ? (now - latestScan.runDate.getTime()) / 3600000
    : 999;

  const readyCandidates = latestScan?.results?.filter(r => r.status === 'READY') || [];
  const triggerMet = latestScan?.results?.filter(r => r.passesAllFilters) || [];

  const day = new Date().getDay();
  const phase = day === 0 ? 'PLANNING' : day === 1 ? 'OBSERVATION' : day <= 5 ? 'EXECUTION' : 'MAINTENANCE';

  const atMaxPositions = openPositions >= (profileConfig?.maxPositions ?? 5);
  const blockers: Array<{ code: string; label: string; severity: string }> = [];
  if (atMaxPositions) {
    blockers.push({ code: 'MAX_POSITIONS', label: `${openPositions}/${profileConfig?.maxPositions ?? 5} positions open`, severity: 'hard' });
  }
  if (heartbeatAgeHours > 18) {
    blockers.push({ code: 'DATA_STALE', label: `Nightly ran ${Math.round(heartbeatAgeHours)}h ago`, severity: 'hard' });
  }
  const hasHardBlocker = blockers.some(b => b.severity === 'hard');
  let decision = 'NO_ACTION';
  if (pendingStops > 0) decision = 'UPDATE_STOPS';
  else if (readyCandidates.length > 0 && !hasHardBlocker) decision = 'BUY_ALLOWED';
  else if (readyCandidates.length > 0 && hasHardBlocker) decision = 'BUY_BLOCKED';
  else if (openPositions > 0) decision = 'MANAGE_EXISTING';

  return {
    decision,
    headline: '',
    explanation: '',
    phase,
    regime: latestScan?.regime || 'UNKNOWN',
    operatingMode,
    healthOverall: latestHealth?.overall || 'UNKNOWN',
    heartbeatAgeHours,
    scanAgeHours,
    openPositionCount: openPositions,
    maxPositions: profileConfig?.maxPositions ?? 5,
    openRiskPct: 0,
    maxOpenRisk: profileConfig?.maxOpenRisk ?? 10,
    readyCandidateCount: readyCandidates.length,
    triggerMetCount: triggerMet.length,
    stopsPending: pendingStops,
    laggardCount: 0,
    pyramidCount: 0,
    killSwitchActive: false,
    autoTradingEnabled: process.env.ENABLE_AUTO_TRADING === 'true',
    t212Connected: !!(user?.t212Connected || user?.t212IsaConnected),
    dataStale: heartbeatAgeHours > 18,
    blockers,
    equity: user?.equity ?? undefined,
    riskProfile,
  };
}
