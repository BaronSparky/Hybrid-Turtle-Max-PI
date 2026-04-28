/**
 * DEPENDENCIES
 * Consumed by: packages/risk/src/validation.ts, packages/risk/src/sizing.ts, scripts/verify-phase6.ts
 * Consumes: packages/data/src/prisma.ts, packages/risk/src/types.ts
 * Risk-sensitive: NO — read-only query, does not modify positions or stops
 * Last modified: 2026-03-08
 */
import { prisma, round } from '../../data/src/prisma';
import type { AccountRiskState, PositionConcentration } from './types';

/**
 * Loads the unified account risk state from the latest portfolio snapshot and open broker positions.
 * This is the single source of truth for all risk gate checks during plan generation.
 */
export async function getAccountRiskState(): Promise<AccountRiskState> {
  const [snapshot, user] = await Promise.all([
    prisma.portfolioSnapshot.findFirst({
      orderBy: { snapshotAt: 'desc' },
    }),
    // Fallback: user settings equity when broker snapshot is mock/demo
    prisma.user.findFirst({ select: { equity: true } }),
  ]);

  const positions = await prisma.brokerPosition.findMany({
    where: { isOpen: true },
    include: {
      protectiveStops: {
        where: { status: { in: ['ACTIVE', 'SUBMITTED', 'PLANNED', 'PENDING'] } },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { symbol: 'asc' },
  });

  // Use user settings equity when broker snapshot is from mock/demo/disabled adapter
  const isDemo = !snapshot || snapshot.accountType === 'DEMO' || snapshot.accountType === 'DISABLED';
  const accountEquity = isDemo ? (user?.equity ?? 0) : (snapshot?.equity.toNumber() ?? 0);

  let totalMarketValue = 0;
  let totalOpenRisk = 0;
  let missingStopCount = 0;
  const concentrations: PositionConcentration[] = [];

  for (const position of positions) {
    const marketValue = position.marketValue.toNumber();
    totalMarketValue += marketValue;

    const activeStop = position.protectiveStops[0];
    if (!activeStop) {
      missingStopCount++;
      // If no stop, treat entire position value as at risk
      totalOpenRisk += marketValue;
    } else {
      const stopPrice = activeStop.stopPrice.toNumber();
      const positionRisk = Math.max(position.marketPrice.toNumber() - stopPrice, 0) * position.quantity.toNumber();
      totalOpenRisk += positionRisk;
    }
  }

  for (const position of positions) {
    const marketValue = position.marketValue.toNumber();
    concentrations.push({
      symbol: position.symbol,
      marketValue,
      weightPct: totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : 0,
    });
  }

  const openRiskPct = accountEquity > 0 ? (totalOpenRisk / accountEquity) * 100 : 0;

  // In demo mode, estimate cash as equity minus invested value
  const cashBalance = isDemo
    ? Math.max((user?.equity ?? 0) - totalMarketValue, 0)
    : (snapshot?.cashBalance.toNumber() ?? 0);

  return {
    accountEquity,
    cashBalance,
    totalMarketValue,
    openPositionCount: positions.length,
    totalOpenRisk: round(totalOpenRisk),
    openRiskPct: round(openRiskPct),
    concentrations,
    missingStopCount,
  };
}
