/**
 * DEPENDENCIES
 * Consumed by: /api/performance/scoreboard/route.ts, weekly review
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only analytics
 * Notes: R-based performance metrics + system grade with sample-size warnings.
 *        Serves Job 8 (weekly review checks performance and drift).
 */

import prisma from './prisma';

// ── System Grade ─────────────────────────────────────────────

export type SystemGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ProfitScoreboard {
  // Core R metrics
  totalClosedPositions: number;  // All closed positions (including those without R data)
  totalClosedTrades: number;     // Only positions with realisedPnlR data
  totalRealisedR: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyPerTrade: number;
  profitFactor: number | null;

  // Drawdown
  maxDrawdownPct: number;
  currentDrawdownPct: number;

  // Hold time
  avgHoldDays: number | null;
  medianHoldDays: number | null;

  // System grade
  grade: SystemGrade;
  gradeReason: string;

  // Sample-size warning
  sampleSizeWarning: string | null;

  // Review milestones
  nextMilestone: number | null; // 30, 50, 100
  milestonePassed: number[];
}

export async function computeProfitScoreboard(userId: string = 'default-user'): Promise<ProfitScoreboard> {
  const closedPositions = await prisma.position.findMany({
    where: { userId, status: 'CLOSED' },
    select: {
      realisedPnlR: true,
      entryDate: true,
      exitDate: true,
    },
  });

  const totalClosedPositions = closedPositions.length;
  const tradesWithRData = closedPositions.filter(p => p.realisedPnlR != null);
  const totalClosedTrades = tradesWithRData.length;

  // R metrics (computed only from trades with R data)
  const rValues = tradesWithRData.map(p => p.realisedPnlR!);
  const totalRealisedR = rValues.reduce((s, r) => s + r, 0);
  const wins = rValues.filter(r => r > 0);
  const losses = rValues.filter(r => r <= 0);
  const winCount = wins.length;
  const lossCount = losses.length;
  const winRate = totalClosedTrades > 0 ? winCount / totalClosedTrades : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, r) => s + r, 0) / losses.length : 0;
  const expectancyPerTrade = totalClosedTrades > 0 ? totalRealisedR / totalClosedTrades : 0;
  const grossWins = wins.reduce((s, r) => s + r, 0);
  const grossLosses = Math.abs(losses.reduce((s, r) => s + r, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : null;

  // Hold time
  const holdDays = tradesWithRData
    .filter(p => p.exitDate && p.entryDate)
    .map(p => Math.floor((p.exitDate!.getTime() - p.entryDate.getTime()) / 86400000));
  const avgHoldDays = holdDays.length > 0 ? holdDays.reduce((s, d) => s + d, 0) / holdDays.length : null;
  const sortedDays = [...holdDays].sort((a, b) => a - b);
  const medianHoldDays = sortedDays.length > 0 ? sortedDays[Math.floor(sortedDays.length / 2)] : null;

  // Drawdown from equity snapshots
  const snapshots = await prisma.equitySnapshot.findMany({
    orderBy: { capturedAt: 'asc' },
    select: { equity: true },
  });
  let maxDrawdownPct = 0;
  let currentDrawdownPct = 0;
  if (snapshots.length > 0) {
    let peak = snapshots[0].equity;
    for (const s of snapshots) {
      if (s.equity > peak) peak = s.equity;
      const dd = peak > 0 ? ((peak - s.equity) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
    const current = snapshots[snapshots.length - 1].equity;
    currentDrawdownPct = peak > 0 ? ((peak - current) / peak) * 100 : 0;
  }

  // System grade
  const { grade, gradeReason } = computeGrade(totalClosedTrades, expectancyPerTrade, maxDrawdownPct);

  // Sample-size warning
  let sampleSizeWarning: string | null = null;
  if (totalClosedPositions > totalClosedTrades) {
    sampleSizeWarning = `⚠ ${totalClosedPositions - totalClosedTrades} closed position(s) missing R data — metrics based on ${totalClosedTrades} trades only.`;
  } else if (totalClosedTrades < 30) {
    sampleSizeWarning = `⚠ Only ${totalClosedTrades} closed trades. Need ≥30 for reliable conclusions.`;
  } else if (totalClosedTrades < 50) {
    sampleSizeWarning = `⚠ ${totalClosedTrades} trades — preliminary data. Need ≥50 for moderate confidence.`;
  }

  // Milestones
  const milestones = [30, 50, 100];
  const milestonePassed = milestones.filter(m => totalClosedTrades >= m);
  const nextMilestone = milestones.find(m => totalClosedTrades < m) ?? null;

  return {
    totalClosedPositions,
    totalClosedTrades,
    totalRealisedR,
    winCount,
    lossCount,
    winRate,
    avgWinR,
    avgLossR,
    expectancyPerTrade,
    profitFactor,
    maxDrawdownPct,
    currentDrawdownPct,
    avgHoldDays,
    medianHoldDays,
    grade,
    gradeReason,
    sampleSizeWarning,
    nextMilestone,
    milestonePassed,
  };
}

function computeGrade(
  trades: number,
  expectancy: number,
  maxDrawdown: number,
): { grade: SystemGrade; gradeReason: string } {
  if (trades < 10) {
    return { grade: 'C', gradeReason: `Too few trades (${trades}) to assess. Need ≥10 for any grade.` };
  }

  if (expectancy > 0.3 && maxDrawdown < 10) {
    return { grade: 'A', gradeReason: `Strong: ${expectancy.toFixed(2)}R expectancy, ${maxDrawdown.toFixed(1)}% max drawdown.` };
  }

  if (expectancy > 0 && maxDrawdown < 15) {
    return { grade: 'B', gradeReason: `Positive edge: ${expectancy.toFixed(2)}R expectancy. Need more data to confirm.` };
  }

  if (expectancy > -0.1) {
    return { grade: 'C', gradeReason: `Edge unclear: ${expectancy.toFixed(2)}R expectancy. Review filter effectiveness.` };
  }

  if (expectancy <= -0.1 || maxDrawdown > 20) {
    return { grade: 'D', gradeReason: `Losing: ${expectancy.toFixed(2)}R expectancy, ${maxDrawdown.toFixed(1)}% max drawdown. Review rules.` };
  }

  return { grade: 'C', gradeReason: 'Insufficient data for assessment.' };
}
