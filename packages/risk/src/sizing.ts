/**
 * DEPENDENCIES
 * Consumed by: packages/risk/src/validation.ts, scripts/verify-phase6.ts
 * Consumes: packages/risk/src/types.ts, packages/config/src/env.ts
 * Risk-sensitive: YES (advisory) — computes share quantities for planned trades
 * Last modified: 2026-03-08
 * Notes: Uses floorShares logic (floor to whole shares). Does NOT import from src/lib/position-sizer.ts
 *        to avoid coupling the modular package layer to the main app's sacred files. The floor-down rule
 *        is replicated here intentionally — never round up, never use Math.ceil.
 */
import { env } from '../../config/src/env';
import type { AccountRiskState, TradeSizingResult } from './types';

/**
 * Calculates the recommended position size for a candidate trade.
 *
 * Floor-down rule: shares are always floored to whole numbers. Never rounded up.
 * This matches the sacred position-sizer contract in the main app.
 */
export function calculateTradeSize(
  symbol: string,
  entryPrice: number,
  stopPrice: number,
  accountState: AccountRiskState,
): TradeSizingResult {
  const riskPerShare = Math.max(entryPrice - stopPrice, 0.01);
  const stopDistancePct = entryPrice > 0 ? (riskPerShare / entryPrice) * 100 : 0;
  const riskBudget = Math.max(accountState.accountEquity * env.EVENING_PLAN_RISK_PER_TRADE_PCT, 0);
  const riskPerTrade = Math.min(riskBudget, accountState.cashBalance);

  // Floor shares down — never round up
  const maxRiskShares = riskPerShare > 0 ? Math.floor(riskPerTrade / riskPerShare) : 0;
  const maxCashShares = entryPrice > 0 ? Math.floor(accountState.cashBalance / entryPrice) : 0;
  const recommendedShares = Math.min(maxRiskShares, maxCashShares);

  const positionValue = recommendedShares * entryPrice;
  const actualRiskPerTrade = recommendedShares * riskPerShare;
  const openRiskAfterTrade = accountState.totalOpenRisk + actualRiskPerTrade;
  const openRiskPctAfterTrade = accountState.accountEquity > 0
    ? (openRiskAfterTrade / accountState.accountEquity) * 100
    : 0;

  return {
    symbol,
    recommendedShares,
    riskPerTrade: round(actualRiskPerTrade),
    riskPerShare: round(riskPerShare),
    entryPrice: round(entryPrice),
    stopPrice: round(stopPrice),
    stopDistancePct: round(stopDistancePct),
    positionValue: round(positionValue),
    openRiskAfterTrade: round(openRiskAfterTrade),
    openRiskPctAfterTrade: round(openRiskPctAfterTrade),
  };
}

export function round(value: number, precision = 4) {
  return Number(value.toFixed(precision));
}
