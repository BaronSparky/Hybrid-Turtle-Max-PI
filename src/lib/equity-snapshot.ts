/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, /api/nightly/route.ts, /api/trading212/sync/route.ts
 * Consumes: prisma.ts, utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-05-17
 * Notes: Rate-limited to once per 6 hours — do not remove the 360-minute guard.
 *        Every snapshot is tagged with a `source` so the user-facing equity
 *        curve can filter out derived/stale rows. See migration
 *        20260517120000_add_equity_snapshot_source for the rationale.
 */
import prisma from './prisma';
import { getWeekStart } from './utils';

/**
 * Provenance of an equity snapshot. Readers that need authoritative
 * equity (e.g. the user-facing curve) should filter to 'BROKER' only.
 *
 *   BROKER  - fetched from the broker (Trading 212 sync). Authoritative.
 *   NIGHTLY - derived from User.equity at nightly run. May be stale; kept
 *             because openRiskPercent is recorded on these rows for the
 *             weekly risk-efficiency calc in /api/risk.
 */
export type EquitySnapshotSource = 'BROKER' | 'NIGHTLY';

export async function recordEquitySnapshot(
  userId: string,
  equity: number,
  openRiskPercent?: number,
  source: EquitySnapshotSource = 'NIGHTLY'
): Promise<void> {
  const latest = await prisma.equitySnapshot.findFirst({
    where: { userId },
    orderBy: { capturedAt: 'desc' },
  });

  if (latest) {
    const minutesSince = (Date.now() - latest.capturedAt.getTime()) / (1000 * 60);
    if (minutesSince < 360) {
      return;
    }
  }

  await prisma.equitySnapshot.create({
    data: {
      userId,
      equity,
      openRiskPercent: openRiskPercent ?? null,
      source,
    },
  });
}

export async function getWeeklyEquityChangePercent(
  userId: string
): Promise<{
  weeklyChangePercent: number | null;
  maxOpenRiskUsedPercent: number | null;
}> {
  const weekStart = getWeekStart(new Date());

  const startSnapshot = await prisma.equitySnapshot.findFirst({
    where: { userId, capturedAt: { gte: weekStart } },
    orderBy: { capturedAt: 'asc' },
  });

  const latestSnapshot = await prisma.equitySnapshot.findFirst({
    where: { userId },
    orderBy: { capturedAt: 'desc' },
  });

  const snapshotsThisWeek = await prisma.equitySnapshot.findMany({
    where: {
      userId,
      capturedAt: { gte: weekStart },
      openRiskPercent: { not: null },
    },
    select: { openRiskPercent: true },
  });

  const maxOpenRiskUsedPercent = snapshotsThisWeek.length > 0
    ? Math.max(...snapshotsThisWeek.map((s) => s.openRiskPercent || 0))
    : null;

  if (!startSnapshot || !latestSnapshot || startSnapshot.equity <= 0) {
    return { weeklyChangePercent: null, maxOpenRiskUsedPercent };
  }

  const weeklyChangePercent = ((latestSnapshot.equity - startSnapshot.equity) / startSnapshot.equity) * 100;

  return { weeklyChangePercent, maxOpenRiskUsedPercent };
}
