import { createRiskSnapshot, getLatestPortfolioState } from './repository';
import { round } from '../../data/src/prisma';
import type { RiskReviewResult } from './types';

/** Open risk thresholds as percentage of account equity. */
const OPEN_RISK_HIGH_PCT = 8;
const OPEN_RISK_MEDIUM_PCT = 5;

export async function reviewEveningRisk(): Promise<RiskReviewResult> {
  const { snapshot, positions } = await getLatestPortfolioState();
  const warnings: string[] = [];
  let totalOpenRisk = 0;
  let totalMarketValue = 0;
  let missingStopsCount = 0;

  for (const position of positions) {
    const marketValue = position.marketValue.toNumber();
    totalMarketValue += marketValue;
    const activeStop = position.protectiveStops.find((stop) => ['ACTIVE', 'SUBMITTED', 'PLANNED', 'MISMATCH'].includes(stop.status));

    if (!activeStop) {
      missingStopsCount += 1;
      warnings.push(`${position.symbol} has no verified protective stop.`);
      continue;
    }

    const stopPrice = activeStop.stopPrice.toNumber();
    const positionRisk = Math.max(position.marketPrice.toNumber() - stopPrice, 0) * position.quantity.toNumber();
    totalOpenRisk += positionRisk;
  }

  const accountEquity = snapshot?.equity.toNumber() ?? null;
  const openRiskPctOfEquity = accountEquity && accountEquity > 0 ? (totalOpenRisk / accountEquity) * 100 : null;

  if (openRiskPctOfEquity != null && openRiskPctOfEquity > OPEN_RISK_HIGH_PCT) {
    warnings.push(`Open risk exceeds ${OPEN_RISK_HIGH_PCT}% of account equity.`);
  }

  if (accountEquity == null && totalOpenRisk > 0) {
    warnings.push('Equity data unavailable — cannot calculate open risk percentage.');
  }

  const riskLevel = missingStopsCount > 0 || accountEquity == null || (openRiskPctOfEquity != null && openRiskPctOfEquity > OPEN_RISK_HIGH_PCT)
    ? 'HIGH'
    : (openRiskPctOfEquity != null && openRiskPctOfEquity > OPEN_RISK_MEDIUM_PCT)
      ? 'MEDIUM'
      : 'LOW';

  const snapshotRecord = await createRiskSnapshot({
    openRisk: totalOpenRisk,
    accountEquity,
    cashBalance: snapshot?.cashBalance.toNumber() ?? null,
    concentrationJson: positions.map((position) => ({
      symbol: position.symbol,
      marketValue: position.marketValue.toNumber(),
      weightPct: totalMarketValue > 0 ? (position.marketValue.toNumber() / totalMarketValue) * 100 : 0,
    })),
    ruleViolationsJson: warnings,
    riskLevel,
  });

  return {
    riskSnapshotId: snapshotRecord.id,
    positionsCount: positions.length,
    missingStopsCount,
    totalOpenRisk: round(totalOpenRisk),
    totalMarketValue: round(totalMarketValue),
    openRiskPctOfEquity: openRiskPctOfEquity == null ? null : round(openRiskPctOfEquity),
    warnings,
  };
}