import { getLatestPortfolioSnapshot, getOpenPositionsWithStops, getRecentAuditEvents } from '../../broker/src/repository';
import { prisma } from '../../data/src/prisma';

export function decimalToNumber(value: { toNumber(): number } | null | undefined): number | null {
  return value ? value.toNumber() : null;
}

export async function getPortfolioPageData() {
  const [latestSnapshot, positions, auditEvents, user] = await Promise.all([
    getLatestPortfolioSnapshot(),
    getOpenPositionsWithStops(),
    getRecentAuditEvents(),
    // Fallback: read user settings equity when broker adapter is mock/demo
    prisma.user.findFirst({ select: { equity: true, t212Currency: true } }),
  ]);

  const viewPositions = positions.map((position) => {
    const currentStop = position.protectiveStops[0] ?? null;
    const averagePrice = position.averagePrice.toNumber();
    const marketPrice = position.marketPrice.toNumber();
    const quantity = position.quantity.toNumber();
    const stopPrice = currentStop ? currentStop.stopPrice.toNumber() : null;
    const initialRiskPerShare = stopPrice != null ? Math.max(averagePrice - stopPrice, 0) : null;
    const currentRMultiple = initialRiskPerShare && initialRiskPerShare > 0 ? (marketPrice - averagePrice) / initialRiskPerShare : null;
    const openRisk = stopPrice != null ? Math.max(marketPrice - stopPrice, 0) * quantity : null;

    return {
      brokerPositionId: position.brokerPositionId,
      symbol: position.symbol,
      name: position.instrument?.name ?? position.symbol,
      entryPrice: averagePrice,
      latestPrice: marketPrice,
      quantity,
      unrealizedPnl: position.unrealizedPnl.toNumber(),
      marketValue: position.marketValue.toNumber(),
      currentStop: stopPrice,
      initialRiskPerShare,
      currentRMultiple,
      openRisk,
      accountType: position.accountType,
      stopSource: currentStop?.source ?? 'UNKNOWN',
      stopVerificationStatus: currentStop?.status ?? 'MISSING',
      lastStopVerifiedAt: currentStop?.lastVerifiedAt?.toISOString() ?? null,
    };
  });

  const totalOpenRisk = viewPositions.reduce((sum, position) => sum + (position.openRisk ?? 0), 0);

  // Use user settings equity when broker snapshot is from mock/demo/disabled adapter
  const isDemo = !latestSnapshot || latestSnapshot.accountType === 'DEMO' || latestSnapshot.accountType === 'DISABLED';
  const settingsEquity = user?.equity ?? null;
  const settingsCurrency = user?.t212Currency ?? 'GBP';

  return {
    summary: {
      accountId: latestSnapshot?.accountId ?? null,
      accountType: latestSnapshot?.accountType ?? null,
      currency: isDemo ? settingsCurrency : (latestSnapshot?.currency ?? 'USD'),
      cashBalance: isDemo ? settingsEquity : decimalToNumber(latestSnapshot?.cashBalance),
      equity: isDemo ? settingsEquity : decimalToNumber(latestSnapshot?.equity),
      totalMarketValue: isDemo ? null : decimalToNumber(latestSnapshot?.totalMarketValue),
      buyingPower: isDemo ? settingsEquity : decimalToNumber(latestSnapshot?.buyingPower),
      dailyPnl: isDemo ? null : decimalToNumber(latestSnapshot?.dailyPnl),
      totalOpenRisk,
      positionsCount: viewPositions.length,
      snapshotAt: latestSnapshot?.snapshotAt.toISOString() ?? null,
    },
    positions: viewPositions,
    auditTrail: auditEvents.map((event) => ({
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      createdAt: event.createdAt.toISOString(),
      payloadJson: event.payloadJson,
    })),
  };
}