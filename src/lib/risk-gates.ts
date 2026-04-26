/**
 * DEPENDENCIES
 * Consumed by: scan-engine.ts, nightly.ts, /api/positions/route.ts, /api/risk/route.ts, /api/nightly/route.ts, /api/modules/route.ts
 * Consumes: @/types, position-sizer.ts
 * Risk-sensitive: YES
 * Last modified: 2026-03-01
 * Notes: All 6 gates must pass. Never short-circuit, bypass, or add a soft override.
 */
// ============================================================
// Risk Gates — Concentration & Cap Checks
// ============================================================

import type { RiskProfileType, Sleeve } from '@/types';
import { RISK_PROFILES, SLEEVE_CAPS, POSITION_SIZE_CAPS, getProfileCaps } from '@/types';
import { calculatePositionSize } from '@/lib/position-sizer';

interface PositionData {
  id: string;
  ticker: string;
  sleeve: Sleeve;
  sector: string;
  cluster: string;
  value: number;
  riskDollars: number;
  shares: number;
  entryPrice: number;
  currentStop: number;
  currentPrice: number;
}

export interface RiskGateResult {
  passed: boolean;
  gate: string;
  message: string;
  current: number;
  limit: number;
}

/**
 * Run all risk cap gate checks before allowing a new position
 */
export function validateRiskGates(
  newPosition: {
    sleeve: Sleeve;
    sector: string;
    cluster: string;
    value: number;
    riskDollars: number;
  },
  existingPositions: PositionData[],
  equity: number,
  riskProfile: RiskProfileType
): RiskGateResult[] {
  const profile = RISK_PROFILES[riskProfile];
  const caps = getProfileCaps(riskProfile);
  const results: RiskGateResult[] = [];

  // Gate 1: Total Open Risk ≤ Max for profile (exclude HEDGE from calculation)
  const nonHedgePositions = existingPositions.filter((p) => p.sleeve !== 'HEDGE');
  const currentOpenRisk = nonHedgePositions.reduce((sum, p) => {
    const posRisk = p.riskDollars != null
      ? p.riskDollars
      : (p.currentPrice - p.currentStop) * p.shares;
    return sum + Math.max(0, posRisk);
  }, 0);
  const hasValidEquity = Number.isFinite(equity) && equity > 0;
  const totalOpenRiskPercent = hasValidEquity
    ? ((currentOpenRisk + newPosition.riskDollars) / equity) * 100
    : Number.POSITIVE_INFINITY;
  results.push({
    passed: totalOpenRiskPercent <= profile.maxOpenRisk,
    gate: 'Total Open Risk',
    message: hasValidEquity
      ? `Total open risk: ${totalOpenRiskPercent.toFixed(1)}% (max ${profile.maxOpenRisk}%) — ex-hedge`
      : 'Account equity is unknown or zero — new entries blocked',
    current: totalOpenRiskPercent,
    limit: profile.maxOpenRisk,
  });

  // Gate 2: Max positions not reached (exclude HEDGE from count)
  const openPositions = nonHedgePositions.length;
  results.push({
    passed: openPositions < profile.maxPositions,
    gate: 'Max Positions',
    message: `Open positions: ${openPositions + 1}/${profile.maxPositions} (ex-hedge)`,
    current: openPositions + 1,
    limit: profile.maxPositions,
  });

  // Gate 3: Sleeve limits (exclude HEDGE from denominator for consistency with Gates 1-2)
  const nonHedgeInvested = existingPositions
    .filter((p) => p.sleeve !== 'HEDGE')
    .reduce((sum, p) => sum + p.value, 0) + newPosition.value;
  const denom = Math.max(equity, nonHedgeInvested);
  const sleeveValue = existingPositions
    .filter((p) => p.sleeve === newPosition.sleeve)
    .reduce((sum, p) => sum + p.value, 0) + newPosition.value;
  const sleevePercent = denom > 0 ? sleeveValue / denom : 0;
  const sleeveCap = SLEEVE_CAPS[newPosition.sleeve];
  results.push({
    passed: sleevePercent <= sleeveCap,
    gate: 'Sleeve Limit',
    message: `${newPosition.sleeve} sleeve: ${(sleevePercent * 100).toFixed(1)}% (max ${(sleeveCap * 100).toFixed(0)}%)`,
    current: sleevePercent * 100,
    limit: sleeveCap * 100,
  });

  // Gate 4: Cluster concentration (profile-aware cap)
  // Missing cluster assigned 'UNKNOWN' — gate still enforced to prevent untracked concentration
  const effectiveCluster = newPosition.cluster || 'UNKNOWN';
  {
    const clusterValue = existingPositions
      .filter((p) => (p.cluster || 'UNKNOWN') === effectiveCluster)
      .reduce((sum, p) => sum + p.value, 0) + newPosition.value;
    const clusterPercent = denom > 0 ? clusterValue / denom : 0;
    results.push({
      passed: clusterPercent <= caps.clusterCap,
      gate: 'Cluster Concentration',
      message: `${effectiveCluster} cluster: ${(clusterPercent * 100).toFixed(1)}% (max ${(caps.clusterCap * 100).toFixed(0)}%)`,
      current: clusterPercent * 100,
      limit: caps.clusterCap * 100,
    });
  }

  // Gate 5: Sector concentration (profile-aware cap)
  // Missing sector assigned 'UNKNOWN' — gate still enforced to prevent untracked concentration
  const effectiveSector = newPosition.sector || 'UNKNOWN';
  {
    const sectorValue = existingPositions
      .filter((p) => (p.sector || 'UNKNOWN') === effectiveSector)
      .reduce((sum, p) => sum + p.value, 0) + newPosition.value;
    const sectorPercent = denom > 0 ? sectorValue / denom : 0;
    results.push({
      passed: sectorPercent <= caps.sectorCap,
      gate: 'Sector Concentration',
      message: `${effectiveSector} sector: ${(sectorPercent * 100).toFixed(1)}% (max ${(caps.sectorCap * 100).toFixed(0)}%)`,
      current: sectorPercent * 100,
      limit: caps.sectorCap * 100,
    });
  }

  // Gate 6: Position size cap (profile-aware)
  const positionSizeCap = caps.positionSizeCaps[newPosition.sleeve] ?? POSITION_SIZE_CAPS.CORE;
  const positionSizePercent = denom > 0 ? newPosition.value / denom : 0;
  results.push({
    passed: positionSizePercent <= positionSizeCap,
    gate: 'Position Size',
    message: `Position size: ${(positionSizePercent * 100).toFixed(1)}% (max ${(positionSizeCap * 100).toFixed(0)}%)`,
    current: positionSizePercent * 100,
    limit: positionSizeCap * 100,
  });

  return results;
}

/**
 * Pyramiding configuration
 */
export const PYRAMID_CONFIG = {
  enabled: true,
  maxAdds: 2,
  // ATR-based triggers relative to entry
  addTriggers: [0.5, 1.0], // Add #1: Entry + 0.5 × ATR, Add #2: Entry + 1.0 × ATR
  // Progressive risk scaling — later adds use less risk to prevent late-trend overexposure
  riskScalars: [0.5, 0.25] as readonly number[], // Add #1: 50% of base risk, Add #2: 25% of base risk
  // Open risk budget threshold — block pyramiding when open risk is ≥ 70% of max allowed
  openRiskThreshold: 0.70,
} as const;

export const BACKTEST_PYRAMID_CONFIG = {
  maxUnits: 4,
  addIntervalAtr: 0.5,
} as const;

/**
 * Check if pyramiding is allowed for a position
 * Uses ATR-based triggers: Add #1 at Entry + 0.5×ATR, Add #2 at Entry + 1.0×ATR
 * Max 2 adds. Progressive risk scaling: Add #1 = 50%, Add #2 = 25% of base risk.
 * Blocked when open risk budget ≥ 70% of max allowed.
 */
export function canPyramid(
  currentPrice: number,
  entryPrice: number,
  initialRisk: number,
  atr?: number,
  currentAdds?: number,
  openRiskRatio?: number // 0–1 ratio: usedRisk / maxRisk. If ≥ 0.70, pyramiding blocked.
): {
  allowed: boolean;
  rMultiple: number;
  addNumber: number; // 0 = not allowed, 1 = first add, 2 = second add
  triggerPrice: number | null;
  message: string;
  riskScalar: number; // 0.5 for add #1, 0.25 for add #2, 0 if not allowed
} {
  if (initialRisk <= 0) {
    return { allowed: false, rMultiple: 0, addNumber: 0, triggerPrice: null, message: 'Invalid initial risk', riskScalar: 0 };
  }

  const rMultiple = (currentPrice - entryPrice) / initialRisk;
  const addsUsed = currentAdds ?? 0;

  // Open risk budget gate — block pyramiding when risk budget is ≥ 70% full
  if (openRiskRatio != null && openRiskRatio >= PYRAMID_CONFIG.openRiskThreshold) {
    return {
      allowed: false,
      rMultiple,
      addNumber: 0,
      triggerPrice: null,
      message: `Risk budget ${(openRiskRatio * 100).toFixed(0)}% used (≥ ${(PYRAMID_CONFIG.openRiskThreshold * 100).toFixed(0)}% threshold) — pyramiding blocked`,
      riskScalar: 0,
    };
  }

  // Max adds reached
  if (addsUsed >= PYRAMID_CONFIG.maxAdds) {
    return {
      allowed: false,
      rMultiple,
      addNumber: 0,
      triggerPrice: null,
      message: `Max pyramid adds reached (${PYRAMID_CONFIG.maxAdds}/${PYRAMID_CONFIG.maxAdds})`,
      riskScalar: 0,
    };
  }

  // Determine risk scalar for the next add
  const nextAddIndex = addsUsed; // 0-based: 0 = first add, 1 = second add
  const riskScalar = nextAddIndex < PYRAMID_CONFIG.riskScalars.length
    ? PYRAMID_CONFIG.riskScalars[nextAddIndex]
    : PYRAMID_CONFIG.riskScalars[PYRAMID_CONFIG.riskScalars.length - 1];

  // ATR-based trigger check
  if (atr != null && atr > 0) {
    if (nextAddIndex < PYRAMID_CONFIG.addTriggers.length) {
      const triggerMultiplier = PYRAMID_CONFIG.addTriggers[nextAddIndex];
      const triggerPrice = entryPrice + triggerMultiplier * atr;

      if (currentPrice >= triggerPrice) {
        return {
          allowed: true,
          rMultiple,
          addNumber: nextAddIndex + 1,
          triggerPrice,
          message: `Pyramid add #${nextAddIndex + 1} allowed: price ${currentPrice.toFixed(2)} ≥ trigger ${triggerPrice.toFixed(2)} (Entry + ${triggerMultiplier}×ATR) — ${(riskScalar * 100).toFixed(0)}% risk`,
          riskScalar,
        };
      } else {
        return {
          allowed: false,
          rMultiple,
          addNumber: 0,
          triggerPrice,
          message: `Price ${currentPrice.toFixed(2)} below add #${nextAddIndex + 1} trigger ${triggerPrice.toFixed(2)} (Entry + ${triggerMultiplier}×ATR)`,
          riskScalar: 0,
        };
      }
    }
  }

  // Fallback: R-multiple based (for when ATR not available)
  if (rMultiple < 1.0) {
    return {
      allowed: false,
      rMultiple,
      addNumber: 0,
      triggerPrice: null,
      message: `Cannot add to position at ${rMultiple.toFixed(1)}R. Pyramiding only allowed at +1R or more.`,
      riskScalar: 0,
    };
  }

  return {
    allowed: true,
    rMultiple,
    addNumber: addsUsed + 1,
    triggerPrice: null,
    message: `Pyramiding allowed at ${rMultiple.toFixed(1)}R (add #${addsUsed + 1}) — ${(riskScalar * 100).toFixed(0)}% risk`,
    riskScalar,
  };
}

/**
 * Calculate scaled position size for a pyramid add.
 * Delegates to calculatePositionSize with scaled risk percentage.
 * Add #1 uses 50% of base risk, Add #2 uses 25%.
 */
export function calculatePyramidAddSize(params: {
  equity: number;
  riskProfile: RiskProfileType;
  addNumber: number; // 1 or 2
  currentPrice: number; // add entry price = current market price
  currentStop: number; // position's current stop level
  sleeve?: Sleeve;
  fxToGbp?: number;
  allowFractional?: boolean;
}): {
  shares: number;
  riskDollars: number;
  scaledRiskPercent: number;
  riskScalar: number;
  totalCost: number;
} {
  const scalarIndex = Math.min(params.addNumber - 1, PYRAMID_CONFIG.riskScalars.length - 1);
  const riskScalar = PYRAMID_CONFIG.riskScalars[Math.max(0, scalarIndex)];
  const profile = RISK_PROFILES[params.riskProfile];
  const scaledRiskPercent = profile.riskPerTrade * riskScalar;

  // Guard: stop must be below current price for long positions
  if (params.currentStop >= params.currentPrice) {
    return { shares: 0, riskDollars: 0, scaledRiskPercent, riskScalar, totalCost: 0 };
  }

  const result = calculatePositionSize({
    equity: params.equity,
    riskProfile: params.riskProfile,
    entryPrice: params.currentPrice,
    stopPrice: params.currentStop,
    customRiskPercent: scaledRiskPercent,
    sleeve: params.sleeve,
    fxToGbp: params.fxToGbp,
    allowFractional: params.allowFractional,
  });

  return {
    shares: result.shares,
    riskDollars: result.riskDollars,
    scaledRiskPercent,
    riskScalar,
    totalCost: result.totalCost,
  };
}

/**
 * Calculate portfolio risk budget utilization
 */
export function getRiskBudget(
  positions: PositionData[],
  equity: number,
  riskProfile: RiskProfileType
): {
  usedRiskPercent: number;
  availableRiskPercent: number;
  maxRiskPercent: number;
  usedPositions: number;
  maxPositions: number;
  sleeveUtilization: Record<Sleeve, { used: number; max: number }>;
} {
  const profile = RISK_PROFILES[riskProfile];

  const totalRisk = positions.reduce((sum, p) => {
    // Exclude HEDGE positions from open risk calculation
    if (p.sleeve === 'HEDGE') return sum;
    const risk = p.riskDollars != null
      ? p.riskDollars
      : (p.currentPrice - p.currentStop) * p.shares;
    return sum + Math.max(0, risk);
  }, 0);

  const usedRiskPercent = equity > 0 ? (totalRisk / equity) * 100 : 0;
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);

  const sleeveUtilization: Record<Sleeve, { used: number; max: number }> = {
    CORE: { used: 0, max: SLEEVE_CAPS.CORE * 100 },
    HIGH_RISK: { used: 0, max: SLEEVE_CAPS.HIGH_RISK * 100 },
    ETF: { used: 0, max: SLEEVE_CAPS.ETF * 100 },
    HEDGE: { used: 0, max: SLEEVE_CAPS.HEDGE * 100 },
  };

  for (const p of positions) {
    const pct = totalValue > 0 ? (p.value / totalValue) * 100 : 0;
    sleeveUtilization[p.sleeve].used += pct;
  }

  return {
    usedRiskPercent,
    availableRiskPercent: Math.max(0, profile.maxOpenRisk - usedRiskPercent),
    maxRiskPercent: profile.maxOpenRisk,
    usedPositions: positions.filter((p) => p.sleeve !== 'HEDGE').length,
    maxPositions: profile.maxPositions,
    sleeveUtilization,
  };
}
