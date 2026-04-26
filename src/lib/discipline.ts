/**
 * DEPENDENCIES
 * Consumed by: /api/discipline/route.ts, dashboard, profit scoreboard
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only analytics + write-only logging
 * Notes: Tracks rule overrides and computes a discipline score.
 *        Score starts at 100, drops for overrides, recovers with compliant trades.
 *        Serves the prime directive: fewer decisions, better compliance.
 */

import prisma from './prisma';

// ── Override Logging ─────────────────────────────────────────

export interface OverrideLogEntry {
  userId: string;
  action: string;
  ticker?: string;
  blockedRule: string;
  blockType: 'HARD' | 'SOFT';
  reason: string;
  riskProfile: string;
  operatingMode: string;
  systemRecommendation: string;
  actionCompleted: boolean;
}

export async function logOverride(entry: OverrideLogEntry): Promise<void> {
  await prisma.overrideLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      ticker: entry.ticker ?? null,
      blockedRule: entry.blockedRule,
      blockType: entry.blockType,
      reason: entry.reason,
      riskProfile: entry.riskProfile,
      operatingMode: entry.operatingMode,
      systemRecommendation: entry.systemRecommendation,
      actionCompleted: entry.actionCompleted,
    },
  });
}

// ── Discipline Score ─────────────────────────────────────────

export interface DisciplineReport {
  score: number;           // 0–100
  level: 'GREEN' | 'AMBER' | 'RED';
  label: string;
  recentOverrides: number; // last 30 days
  totalOverrides: number;
  compliantTrades: number; // trades with no overrides
  softOverrides: number;
  hardAttempts: number;    // hard blocks that were attempted (always prevented)
}

export async function computeDisciplineScore(userId: string = 'default-user'): Promise<DisciplineReport> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const [allOverrides, recentOverrides, closedPositions] = await Promise.all([
    prisma.overrideLog.count({ where: { userId } }),
    prisma.overrideLog.findMany({
      where: { userId, timestamp: { gte: thirtyDaysAgo } },
      select: { blockType: true, actionCompleted: true },
    }),
    prisma.position.count({ where: { userId, status: 'CLOSED' } }),
  ]);

  const recentSoft = recentOverrides.filter(o => o.blockType === 'SOFT' && o.actionCompleted).length;
  const recentHard = recentOverrides.filter(o => o.blockType === 'HARD').length;

  // Score formula: start at 100, -5 per soft override, -15 per hard attempt
  // Recovery: +1 per compliant trade (no override in last 30 days beyond what's penalized)
  const penalty = (recentSoft * 5) + (recentHard * 15);
  const recovery = Math.min(closedPositions, 20); // Cap recovery contribution
  const score = Math.max(0, Math.min(100, 100 - penalty + recovery));

  let level: 'GREEN' | 'AMBER' | 'RED';
  let label: string;
  if (score >= 90) { level = 'GREEN'; label = 'Disciplined'; }
  else if (score >= 70) { level = 'AMBER'; label = 'Some overrides'; }
  else { level = 'RED'; label = 'Frequent overrides — review trading behaviour'; }

  return {
    score,
    level,
    label,
    recentOverrides: recentOverrides.length,
    totalOverrides: allOverrides,
    compliantTrades: closedPositions,
    softOverrides: recentSoft,
    hardAttempts: recentHard,
  };
}
