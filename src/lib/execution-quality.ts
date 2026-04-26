/**
 * DEPENDENCIES
 * Consumed by: /api/execution-quality/route.ts, portfolio page
 * Consumes: execution-audit.ts, execution-drag.ts
 * Risk-sensitive: NO — read-only analysis
 * Notes: Aggregates execution quality metrics and produces per-trade grades.
 *        Serves Job 8 (weekly review) + Job 5 (dashboard actions).
 */

import type { ExecutionAuditRow } from './execution-audit';

// ── Execution Grade ──────────────────────────────────────────

export type ExecutionGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ExecutionGradeResult {
  grade: ExecutionGrade;
  slippagePct: number;
  slippageR: number;
  reason: string;
}

export function gradeExecution(row: ExecutionAuditRow): ExecutionGradeResult {
  const slipPct = Math.abs(row.slippagePct ?? 0);
  const slipR = Math.abs(row.slippageR ?? 0);

  if (row.wouldViolateAntiChase) {
    return { grade: 'F', slippagePct: slipPct, slippageR: slipR, reason: 'Fill above anti-chase ceiling.' };
  }

  if (slipPct <= 0.1 && slipR <= 0.05) {
    return { grade: 'A', slippagePct: slipPct, slippageR: slipR, reason: 'Excellent fill within tight bounds.' };
  }
  if (slipPct <= 0.3 && slipR <= 0.1) {
    return { grade: 'B', slippagePct: slipPct, slippageR: slipR, reason: 'Good fill, minor slippage.' };
  }
  if (slipPct <= 0.5 && slipR <= 0.15) {
    return { grade: 'C', slippagePct: slipPct, slippageR: slipR, reason: 'Acceptable fill, moderate slippage.' };
  }

  return { grade: 'D', slippagePct: slipPct, slippageR: slipR, reason: `High slippage: ${slipPct.toFixed(2)}% / ${slipR.toFixed(2)}R.` };
}

// ── Aggregate Summary ────────────────────────────────────────

export interface ExecutionQualitySummary {
  totalTrades: number;
  gradeDistribution: Record<ExecutionGrade, number>;
  avgSlippagePct: number;
  avgSlippageR: number;
  worstSlippagePct: number;
  materialSlippageRate: number;
  recommendation: string;
}

export function summarizeExecutionQuality(rows: ExecutionAuditRow[]): ExecutionQualitySummary {
  if (rows.length === 0) {
    return {
      totalTrades: 0,
      gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
      avgSlippagePct: 0,
      avgSlippageR: 0,
      worstSlippagePct: 0,
      materialSlippageRate: 0,
      recommendation: 'No trades to analyze.',
    };
  }

  const grades = rows.map(r => gradeExecution(r));
  const dist: Record<ExecutionGrade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const g of grades) dist[g.grade]++;

  const slippages = rows.map(r => Math.abs(r.slippagePct ?? 0));
  const slippagesR = rows.map(r => Math.abs(r.slippageR ?? 0));
  const materialCount = rows.filter(r => r.materialSlippage).length;

  const avgSlipPct = slippages.reduce((a, b) => a + b, 0) / slippages.length;
  const avgSlipR = slippagesR.reduce((a, b) => a + b, 0) / slippagesR.length;

  let recommendation: string;
  if (avgSlipPct < 0.15) {
    recommendation = 'Execution quality is strong. Continue with current approach.';
  } else if (avgSlipPct < 0.3) {
    recommendation = 'Minor slippage detected. Consider using limit orders more consistently.';
  } else {
    recommendation = 'Significant slippage drag. Review execution timing and consider tighter limit prices.';
  }

  return {
    totalTrades: rows.length,
    gradeDistribution: dist,
    avgSlippagePct: avgSlipPct,
    avgSlippageR: avgSlipR,
    worstSlippagePct: Math.max(...slippages),
    materialSlippageRate: materialCount / rows.length,
    recommendation,
  };
}
