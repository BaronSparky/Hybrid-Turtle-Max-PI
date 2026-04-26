/**
 * DEPENDENCIES
 * Consumed by: scan-engine.ts, nightly.ts, /api/positions/route.ts, /api/risk/route.ts, /api/nightly/route.ts, /api/modules/route.ts, /api/portfolio/summary/route.ts, useRiskProfile.ts
 * Consumes: @/types
 * Risk-sensitive: YES
 * Last modified: 2026-02-19
 * Notes: Uses floorShares() only — never Math.round/ceil. FX conversion applied before sizing.
 */
// ============================================================
// Position Sizing Calculator
// ============================================================
// Formula: Shares = (Equity × Risk%) / (Entry Price - Stop Price)
//
// Rounding modes:
//   Default (allowFractional: false) — floors to whole shares.
//     Use for integer-share brokers. Never overshoots risk.
//   Fractional (allowFractional: true) — floors to 0.01 shares.
//     Use for Trading 212 (ISA/Invest). Recovers ~99% of risk
//     budget vs ~80% on a small account with whole-share rounding.
//     Still floors (not rounds), so risk budget is never exceeded.

import type { PositionSizingResult, RiskProfileType } from '@/types';
import { RISK_PROFILES, POSITION_SIZE_CAPS, getProfileCaps, type Sleeve } from '@/types';

export interface PositionSizeInput {
  equity: number;
  riskProfile: RiskProfileType;
  entryPrice: number;
  stopPrice: number;
  sleeve?: Sleeve; // For position size cap enforcement
  customRiskPercent?: number; // Override for manual adjustment
  fxToGbp?: number; // FX conversion rate to GBP (default 1.0)
  allowFractional?: boolean; // true = Trading 212 fractional shares (floor to 0.01)
}

/**
 * Floor share count to permitted precision.
 * Integer brokers: floor to whole number (default, safe for all brokers).
 * Fractional brokers (T212): floor to 0.01 shares — recovers budget wasted
 * by whole-share rounding, which is significant on small accounts.
 */
function floorShares(shares: number, fractional: boolean): number {
  if (!fractional) return Math.floor(shares);
  return Math.floor(shares * 100) / 100;
}

export function calculatePositionSize(input: PositionSizeInput): PositionSizingResult {
  const { equity, riskProfile, entryPrice, stopPrice, sleeve, customRiskPercent, fxToGbp = 1.0, allowFractional = false } = input;

  // Validate inputs
  if (equity <= 0) {
    throw new Error('Equity must be positive');
  }
  if (entryPrice <= 0) {
    throw new Error('Entry price must be positive');
  }
  if (stopPrice <= 0) {
    throw new Error('Stop price must be positive');
  }
  if (stopPrice >= entryPrice) {
    throw new Error('Stop price must be below entry price for long positions');
  }
  if (fxToGbp <= 0) {
    throw new Error('FX rate must be positive');
  }

  const profile = RISK_PROFILES[riskProfile];
  const riskPercent = customRiskPercent ?? profile.riskPerTrade;
  const riskPerShare = (entryPrice - stopPrice) * fxToGbp; // Convert to GBP
  const riskCashRaw = equity * (riskPercent / 100);
  let riskCash = riskCashRaw;

  if (profile.risk_cash_cap !== undefined) {
    riskCash = Math.min(riskCash, profile.risk_cash_cap);
  }

  if (profile.risk_cash_floor !== undefined) {
    riskCash = Math.max(riskCash, profile.risk_cash_floor);
  }

  // Re-apply cap after floor to ensure cap is never exceeded (floor > cap = config error, cap wins)
  if (profile.risk_cash_cap !== undefined) {
    riskCash = Math.min(riskCash, profile.risk_cash_cap);
  }

  // Calculate shares — floor to permitted precision (whole or 0.01 for fractional brokers)
  let shares = floorShares(riskCash / riskPerShare, allowFractional);

  // Enforce position size cap: totalCost ≤ cap% × equity (profile-aware)
  if (shares > 0 && sleeve) {
    const caps = getProfileCaps(riskProfile);
    const cap = caps.positionSizeCaps[sleeve] ?? POSITION_SIZE_CAPS.CORE;
    const maxCost = equity * cap;
    const totalCostInGbp = shares * entryPrice * fxToGbp;
    if (totalCostInGbp > maxCost) {
      shares = floorShares(maxCost / (entryPrice * fxToGbp), allowFractional);
    }
  }

  // Safety guard: cap per-position max loss
  const perPositionMaxLossPct = profile.per_position_max_loss_pct ?? riskPercent;
  const perPositionMaxLossAmount = equity * (perPositionMaxLossPct / 100);
  if (shares > 0 && (riskPerShare * shares) > perPositionMaxLossAmount) {
    shares = floorShares(perPositionMaxLossAmount / riskPerShare, allowFractional);
  }

  if (shares <= 0) {
    return {
      shares: 0,
      totalCost: 0,
      riskDollars: 0,
      riskPercent: 0,
      entryPrice,
      stopPrice,
      rPerShare: riskPerShare,
    };
  }

  const totalCost = shares * entryPrice * fxToGbp;
  const actualRiskDollars = shares * riskPerShare;
  const actualRiskPercent = (actualRiskDollars / equity) * 100;

  return {
    shares,
    totalCost,
    riskDollars: actualRiskDollars,
    riskPercent: actualRiskPercent,
    entryPrice,
    stopPrice,
    rPerShare: riskPerShare,
  };
}

/**
 * Calculate entry trigger price from 20-day high + ATR buffer
 */
export function calculateEntryTrigger(twentyDayHigh: number, atr: number): number {
  return twentyDayHigh + 0.1 * atr;
}

/**
 * Calculate R-multiple for a position
 */
export function calculateRMultiple(
  currentPrice: number,
  entryPrice: number,
  initialRisk: number
): number {
  if (initialRisk === 0) return 0;
  return (currentPrice - entryPrice) / initialRisk;
}

/**
 * Calculate gain/loss percentage
 */
export function calculateGainPercent(currentPrice: number, entryPrice: number): number {
  if (entryPrice === 0) return 0;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Calculate gain/loss in dollars
 */
export function calculateGainDollars(
  currentPrice: number,
  entryPrice: number,
  shares: number
): number {
  return (currentPrice - entryPrice) * shares;
}
