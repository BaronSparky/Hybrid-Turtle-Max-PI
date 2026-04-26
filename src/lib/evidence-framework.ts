/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/evidence/route.ts, /evidence page
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only analytics, never modifies trading logic
 * Notes: Comprehensive evidence framework proving which rules improve expectancy.
 *        All computations are deterministic: counts, means, medians, rates.
 *        Only counts rows with enrichedAt != null for outcome metrics.
 */
import prisma from './prisma';

// ── Shared Stat Types ───────────────────────────────────────────────

export interface OutcomeStats {
  count: number;
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  hit3RRate: number | null;
  stopHitRate: number | null;
  avgR: number | null;
  medianR: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
}

// ── Section 1: Rule Contribution ────────────────────────────────────

export interface RuleContributionRow {
  rule: string;
  description: string;
  passed: OutcomeStats;
  blocked: OutcomeStats;
  /** Difference in avg 20d return: passed - blocked */
  edgeFwd20d: number | null;
  /** Difference in 1R hit rate */
  edge1RRate: number | null;
}

// ── Section 2: Classification Performance ───────────────────────────

export interface ClassificationBandRow {
  dimension: string;
  band: string;
  stats: OutcomeStats;
}

// ── Section 3: Entry Quality ────────────────────────────────────────

export interface EntryQualityRow {
  entryType: string;
  stats: OutcomeStats;
}

// ── Section 4: Exit Performance ─────────────────────────────────────

export interface ExitPerformanceRow {
  exitCategory: string;
  count: number;
  avgR: number | null;
  medianR: number | null;
  avgDaysHeld: number | null;
  winRate: number | null;
}

// ── Section 5: Small Account Simulation ─────────────────────────────

export interface SimulationScenario {
  name: string;
  description: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  totalR: number;
  maxDrawdownR: number;
  finalCapital: number;
  returnPct: number;
}

// ── Full Response ───────────────────────────────────────────────────

export interface EvidenceResponse {
  ok: boolean;
  generatedAt: string;
  sampleSize: {
    totalCandidates: number;
    enrichedCandidates: number;
    totalTrades: number;
    closedTrades: number;
  };
  warnings: string[];
  ruleContribution: RuleContributionRow[];
  classificationPerformance: ClassificationBandRow[];
  entryQuality: EntryQualityRow[];
  exitPerformance: ExitPerformanceRow[];
  simulations: SimulationScenario[];
}

// ── Helpers ─────────────────────────────────────────────────────────

type CandidateRow = {
  status: string;
  stageReached: string;
  passedTechFilter: boolean;
  passedRiskGates: boolean;
  passedAntiChase: boolean;
  blockedByRegime: boolean;
  regime: string;
  sleeve: string;
  ncs: number | null;
  fws: number | null;
  bqs: number | null;
  entryMode: string | null;
  antiChaseReason: string | null;
  distancePct: number;
  adx: number;
  atrPct: number;
  efficiency: number;
  dualScoreAction: string | null;
  fwdReturn5d: number | null;
  fwdReturn10d: number | null;
  fwdReturn20d: number | null;
  mfeR: number | null;
  maeR: number | null;
  reached1R: boolean | null;
  reached2R: boolean | null;
  reached3R: boolean | null;
  stopHit: boolean | null;
  enrichedAt: Date | null;
};

type TradeRow = {
  tradeType: string;
  exitReason: string | null;
  finalRMultiple: number | null;
  daysHeld: number | null;
  decision: string;
  ncsScore: number | null;
  scanStatus: string | null;
  slippagePct: number | null;
  regime: string | null;
};

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const result = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(result * 100) / 100;
}

export function rate(trueCount: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((trueCount / total) * 1000) / 10;
}

function computeStats(rows: CandidateRow[]): OutcomeStats {
  const enriched = rows.filter((r) => r.enrichedAt != null);
  const fwd5 = enriched.map((r) => r.fwdReturn5d).filter((v): v is number => v != null);
  const fwd10 = enriched.map((r) => r.fwdReturn10d).filter((v): v is number => v != null);
  const fwd20 = enriched.map((r) => r.fwdReturn20d).filter((v): v is number => v != null);
  const mfe = enriched.map((r) => r.mfeR).filter((v): v is number => v != null);
  const mae = enriched.map((r) => r.maeR).filter((v): v is number => v != null);
  const r1 = enriched.filter((r) => r.reached1R != null);
  const r2 = enriched.filter((r) => r.reached2R != null);
  const r3 = enriched.filter((r) => r.reached3R != null);
  const sH = enriched.filter((r) => r.stopHit != null);

  // Estimate R from forward returns: use 20d return / estimated risk
  // This is approximate — MFE/MAE are the better R-based metrics
  const rValues = mfe; // Use MFE as proxy for realised R potential

  return {
    count: rows.length,
    withOutcomes: enriched.length,
    avgFwd5d: mean(fwd5),
    avgFwd10d: mean(fwd10),
    avgFwd20d: mean(fwd20),
    hit1RRate: rate(r1.filter((r) => r.reached1R === true).length, r1.length),
    hit2RRate: rate(r2.filter((r) => r.reached2R === true).length, r2.length),
    hit3RRate: rate(r3.filter((r) => r.reached3R === true).length, r3.length),
    stopHitRate: rate(sH.filter((r) => r.stopHit === true).length, sH.length),
    avgR: mean(mfe),
    medianR: median(mfe),
    avgMfeR: mean(mfe),
    avgMaeR: mean(mae),
  };
}

// ── Section 1: Rule Contribution ────────────────────────────────────

function buildRuleContribution(rows: CandidateRow[]): RuleContributionRow[] {
  function ruleRow(
    rule: string,
    description: string,
    pred: (r: CandidateRow) => boolean
  ): RuleContributionRow {
    const passed = rows.filter(pred);
    const blocked = rows.filter((r) => !pred(r));
    const pStats = computeStats(passed);
    const bStats = computeStats(blocked);
    return {
      rule,
      description,
      passed: pStats,
      blocked: bStats,
      edgeFwd20d:
        pStats.avgFwd20d != null && bStats.avgFwd20d != null
          ? Math.round((pStats.avgFwd20d - bStats.avgFwd20d) * 100) / 100
          : null,
      edge1RRate:
        pStats.hit1RRate != null && bStats.hit1RRate != null
          ? Math.round((pStats.hit1RRate - bStats.hit1RRate) * 10) / 10
          : null,
    };
  }

  const withNcs = rows.filter((r) => r.ncs != null);
  const withFws = rows.filter((r) => r.fws != null);

  return [
    ruleRow('Price > MA200', 'Trend filter — only buy above 200-day MA', (r) => r.passedTechFilter),
    ruleRow('ADX ≥ 20', 'Directional strength above threshold', (r) => r.adx >= 20),
    ruleRow('ATR% < 8', 'Volatility cap — no overly volatile stocks', (r) => r.atrPct < 8),
    ruleRow('Efficiency ≥ 30', 'Price efficiency above minimum', (r) => r.efficiency >= 30),
    ruleRow('Risk Gates', 'All 6 gates pass (risk budget, position limits, concentration)', (r) => r.passedRiskGates),
    ruleRow('Anti-Chase Guard', 'Gap/extension check prevents chasing', (r) => r.passedAntiChase),
    ruleRow('Regime = BULLISH', 'Only trade in bullish regime', (r) => r.regime === 'BULLISH'),
    ruleRow('Status = READY', 'Candidate within 2% of trigger', (r) => r.status === 'READY'),
    ...(withNcs.length > 0
      ? [
          ruleRow('NCS ≥ 70 (A-Grade)', 'Net Composite Score above Auto-Yes', (r) => (r.ncs ?? 0) >= 70),
          ruleRow('NCS ≥ 60', 'Net Composite Score above 60', (r) => (r.ncs ?? 0) >= 60),
        ]
      : []),
    ...(withFws.length > 0
      ? [
          ruleRow('FWS ≤ 30', 'Fatal Weakness below safe threshold', (r) => (r.fws ?? 100) <= 30),
        ]
      : []),
  ];
}

// ── Section 2: Classification Performance ───────────────────────────

function buildClassificationPerformance(rows: CandidateRow[]): ClassificationBandRow[] {
  const result: ClassificationBandRow[] = [];

  // Status bands
  const statuses = ['READY', 'WATCH', 'WAIT_PULLBACK', 'FAR', 'COOLDOWN'];
  for (const s of statuses) {
    const bucket = rows.filter((r) => r.status === s);
    if (bucket.length > 0) {
      result.push({ dimension: 'Status', band: s, stats: computeStats(bucket) });
    }
  }

  // Dual-score action
  const actions = ['Auto-Yes', 'Conditional', 'Auto-No (fragile)'];
  for (const a of actions) {
    const bucket = rows.filter((r) => r.dualScoreAction === a);
    if (bucket.length > 0) {
      result.push({ dimension: 'DualScore Action', band: a, stats: computeStats(bucket) });
    }
  }

  // NCS bands
  const ncsBands = [
    { band: 'NCS < 50', pred: (r: CandidateRow) => r.ncs != null && r.ncs < 50 },
    { band: 'NCS 50–59', pred: (r: CandidateRow) => r.ncs != null && r.ncs >= 50 && r.ncs < 60 },
    { band: 'NCS 60–69', pred: (r: CandidateRow) => r.ncs != null && r.ncs >= 60 && r.ncs < 70 },
    { band: 'NCS 70–79', pred: (r: CandidateRow) => r.ncs != null && r.ncs >= 70 && r.ncs < 80 },
    { band: 'NCS 80+', pred: (r: CandidateRow) => r.ncs != null && r.ncs >= 80 },
  ];
  for (const { band, pred } of ncsBands) {
    const bucket = rows.filter(pred);
    if (bucket.length > 0) {
      result.push({ dimension: 'NCS Band', band, stats: computeStats(bucket) });
    }
  }

  // BQS bands
  const bqsBands = [
    { band: 'BQS < 40', pred: (r: CandidateRow) => r.bqs != null && r.bqs < 40 },
    { band: 'BQS 40–59', pred: (r: CandidateRow) => r.bqs != null && r.bqs >= 40 && r.bqs < 60 },
    { band: 'BQS 60–79', pred: (r: CandidateRow) => r.bqs != null && r.bqs >= 60 && r.bqs < 80 },
    { band: 'BQS 80+', pred: (r: CandidateRow) => r.bqs != null && r.bqs >= 80 },
  ];
  for (const { band, pred } of bqsBands) {
    const bucket = rows.filter(pred);
    if (bucket.length > 0) {
      result.push({ dimension: 'BQS Band', band, stats: computeStats(bucket) });
    }
  }

  // FWS bands
  const fwsBands = [
    { band: 'FWS 0–10', pred: (r: CandidateRow) => r.fws != null && r.fws >= 0 && r.fws < 10 },
    { band: 'FWS 10–20', pred: (r: CandidateRow) => r.fws != null && r.fws >= 10 && r.fws < 20 },
    { band: 'FWS 20–30', pred: (r: CandidateRow) => r.fws != null && r.fws >= 20 && r.fws < 30 },
    { band: 'FWS 30–50', pred: (r: CandidateRow) => r.fws != null && r.fws >= 30 && r.fws < 50 },
    { band: 'FWS 50+', pred: (r: CandidateRow) => r.fws != null && r.fws >= 50 },
  ];
  for (const { band, pred } of fwsBands) {
    const bucket = rows.filter(pred);
    if (bucket.length > 0) {
      result.push({ dimension: 'FWS Band', band, stats: computeStats(bucket) });
    }
  }

  return result;
}

// ── Section 3: Entry Quality ────────────────────────────────────────

function buildEntryQuality(rows: CandidateRow[]): EntryQualityRow[] {
  const result: EntryQualityRow[] = [];

  // By entry mode
  const modes: { label: string; pred: (r: CandidateRow) => boolean }[] = [
    { label: 'Clean Trigger (dist ≤ 0.5%)', pred: (r) => r.status === 'READY' && r.distancePct <= 0.5 && r.passedAntiChase },
    { label: 'Small Gap (dist 0.5–2%)', pred: (r) => r.status === 'READY' && r.distancePct > 0.5 && r.distancePct <= 2 },
    { label: 'Large Gap (dist > 2%)', pred: (r) => r.distancePct > 2 },
    { label: 'Pullback Continuation', pred: (r) => r.entryMode === 'PULLBACK_CONTINUATION' },
    { label: 'Anti-Chase Blocked', pred: (r) => !r.passedAntiChase && r.antiChaseReason != null },
    { label: 'Breakout (standard)', pred: (r) => r.entryMode === 'BREAKOUT' || r.entryMode == null },
  ];

  for (const { label, pred } of modes) {
    const bucket = rows.filter(pred);
    if (bucket.length > 0) {
      result.push({ entryType: label, stats: computeStats(bucket) });
    }
  }

  return result;
}

// ── Section 4: Exit Performance ─────────────────────────────────────

function buildExitPerformance(trades: TradeRow[]): ExitPerformanceRow[] {
  const exits = trades.filter((t) => t.tradeType === 'EXIT' || t.tradeType === 'STOP_HIT');
  if (exits.length === 0) return [];

  function exitRow(category: string, subset: TradeRow[]): ExitPerformanceRow {
    const rValues = subset.map((t) => t.finalRMultiple).filter((v): v is number => v != null);
    const daysValues = subset.map((t) => t.daysHeld).filter((v): v is number => v != null);
    const wins = rValues.filter((r) => r > 0).length;
    return {
      exitCategory: category,
      count: subset.length,
      avgR: mean(rValues),
      medianR: median(rValues),
      avgDaysHeld: mean(daysValues),
      winRate: rate(wins, rValues.length),
    };
  }

  const result: ExitPerformanceRow[] = [];

  // By exit reason
  const stopHits = exits.filter((t) => t.exitReason === 'STOP_HIT');
  const manual = exits.filter((t) => t.exitReason === 'MANUAL' || t.exitReason === null);
  const deadMoney = exits.filter((t) => t.exitReason === 'DEAD_MONEY' || t.exitReason === 'LAGGARD');
  const profitTarget = exits.filter((t) => t.exitReason === 'PROFIT_TARGET');
  const trailingStop = exits.filter((t) => t.exitReason === 'TRAILING_STOP' || t.exitReason === 'ATR_TRAILING');

  if (stopHits.length > 0) result.push(exitRow('Stop Hit (original ladder)', stopHits));
  if (trailingStop.length > 0) result.push(exitRow('ATR Trailing Stop', trailingStop));
  if (deadMoney.length > 0) result.push(exitRow('Dead Money / Laggard Exit', deadMoney));
  if (profitTarget.length > 0) result.push(exitRow('Profit Target', profitTarget));
  if (manual.length > 0) result.push(exitRow('Manual Exit', manual));

  // By days held buckets
  const earlyExits = exits.filter((t) => t.daysHeld != null && t.daysHeld <= 5);
  const normalHold = exits.filter((t) => t.daysHeld != null && t.daysHeld > 5 && t.daysHeld <= 20);
  const longHold = exits.filter((t) => t.daysHeld != null && t.daysHeld > 20);
  if (earlyExits.length > 0) result.push(exitRow('Early Exit (≤ 5d)', earlyExits));
  if (normalHold.length > 0) result.push(exitRow('Normal Hold (6–20d)', normalHold));
  if (longHold.length > 0) result.push(exitRow('Long Hold (> 20d)', longHold));

  // All exits aggregate
  result.push(exitRow('All Exits', exits));

  return result;
}

// ── Section 5: Small Account Simulation ─────────────────────────────

export function runSimulation(
  trades: TradeRow[],
  opts: {
    name: string;
    description: string;
    riskPct: number;
    maxPositions: number;
    allowPyramid: boolean;
    slippagePct: number;
  }
): SimulationScenario {
  const initialCapital = 1000; // £1,000 starting
  let capital = initialCapital;
  let maxCapital = initialCapital;
  let maxDrawdownR = 0;
  let wins = 0;
  let losses = 0;
  let totalR = 0;

  // Filter to ENTRY trades that were actually taken
  const entries = trades.filter(
    (t) => t.tradeType === 'ENTRY' && t.decision === 'TAKEN' && t.finalRMultiple != null
  );

  // If no pyramid allowed, skip ADD trades
  const eligible = opts.allowPyramid
    ? trades.filter(
        (t) => (t.tradeType === 'ENTRY' || t.tradeType === 'ADD') &&
               t.decision === 'TAKEN' &&
               t.finalRMultiple != null
      )
    : entries;

  // Simulate sequential trades with position limit
  let openPositions = 0;
  for (const trade of eligible) {
    if (openPositions >= opts.maxPositions && trade.tradeType === 'ENTRY') continue;

    const riskAmount = capital * (opts.riskPct / 100);
    const r = trade.finalRMultiple!;

    // Apply slippage
    const slippageImpact = opts.slippagePct / 100;
    const adjustedR = r - slippageImpact;

    const pnl = riskAmount * adjustedR;
    capital += pnl;
    totalR += adjustedR;

    if (adjustedR > 0) wins++;
    else losses++;

    if (trade.tradeType === 'ENTRY') openPositions++;
    if (trade.tradeType === 'EXIT' || trade.tradeType === 'STOP_HIT') {
      openPositions = Math.max(0, openPositions - 1);
    }

    if (capital > maxCapital) maxCapital = capital;
    const drawdown = maxCapital > 0 ? (maxCapital - capital) / maxCapital : 0;
    const drawdownR = maxCapital > 0 ? (maxCapital - capital) / (initialCapital * opts.riskPct / 100) : 0;
    if (drawdownR > maxDrawdownR) maxDrawdownR = drawdownR;
  }

  const total = wins + losses;
  return {
    name: opts.name,
    description: opts.description,
    trades: total,
    wins,
    losses,
    winRate: rate(wins, total),
    avgR: total > 0 ? Math.round((totalR / total) * 100) / 100 : null,
    totalR: Math.round(totalR * 100) / 100,
    maxDrawdownR: Math.round(maxDrawdownR * 100) / 100,
    finalCapital: Math.round(capital * 100) / 100,
    returnPct: Math.round(((capital - initialCapital) / initialCapital) * 1000) / 10,
  };
}

function buildSimulations(trades: TradeRow[]): SimulationScenario[] {
  return [
    runSimulation(trades, {
      name: '2% risk, 4 pos, no pyramid',
      description: 'SMALL_ACCOUNT baseline: 2% risk per trade, max 4 positions, no pyramiding',
      riskPct: 2,
      maxPositions: 4,
      allowPyramid: false,
      slippagePct: 0,
    }),
    runSimulation(trades, {
      name: '2% risk, 4 pos, with pyramid',
      description: 'SMALL_ACCOUNT + pyramiding enabled (50%/25% adds)',
      riskPct: 2,
      maxPositions: 4,
      allowPyramid: true,
      slippagePct: 0,
    }),
    runSimulation(trades, {
      name: '2% risk, 4 pos, 0.3% slippage',
      description: 'Realistic slippage assumption for Trading 212 fractional shares',
      riskPct: 2,
      maxPositions: 4,
      allowPyramid: false,
      slippagePct: 0.3,
    }),
    runSimulation(trades, {
      name: '2% risk, 3 pos, no pyramid',
      description: 'More concentrated: 3 positions max',
      riskPct: 2,
      maxPositions: 3,
      allowPyramid: false,
      slippagePct: 0,
    }),
    runSimulation(trades, {
      name: '1.5% risk, 5 pos, no pyramid',
      description: 'More diversified: 1.5% risk, 5 positions',
      riskPct: 1.5,
      maxPositions: 5,
      allowPyramid: false,
      slippagePct: 0,
    }),
  ];
}

// ── Public API ──────────────────────────────────────────────────────

export interface EvidenceOptions {
  from?: Date;
  to?: Date;
  sleeve?: string;
  regime?: string;
}

export async function generateEvidence(opts?: EvidenceOptions): Promise<EvidenceResponse> {
  // ── Fetch candidate data ──
  const candidateWhere: Record<string, unknown> = {};
  if (opts?.sleeve) candidateWhere.sleeve = opts.sleeve;
  if (opts?.regime) candidateWhere.regime = opts.regime;
  if (opts?.from || opts?.to) {
    candidateWhere.scanDate = {
      ...(opts?.from ? { gte: opts.from } : {}),
      ...(opts?.to ? { lte: opts.to } : {}),
    };
  }

  const [candidates, trades] = await Promise.all([
    prisma.candidateOutcome.findMany({
      where: candidateWhere,
      select: {
        status: true,
        stageReached: true,
        passedTechFilter: true,
        passedRiskGates: true,
        passedAntiChase: true,
        blockedByRegime: true,
        regime: true,
        sleeve: true,
        ncs: true,
        fws: true,
        bqs: true,
        entryMode: true,
        antiChaseReason: true,
        distancePct: true,
        adx: true,
        atrPct: true,
        efficiency: true,
        dualScoreAction: true,
        fwdReturn5d: true,
        fwdReturn10d: true,
        fwdReturn20d: true,
        mfeR: true,
        maeR: true,
        reached1R: true,
        reached2R: true,
        reached3R: true,
        stopHit: true,
        enrichedAt: true,
      },
    }) as Promise<CandidateRow[]>,

    prisma.tradeLog.findMany({
      where: {
        ...(opts?.from || opts?.to
          ? {
              tradeDate: {
                ...(opts?.from ? { gte: opts.from } : {}),
                ...(opts?.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      select: {
        tradeType: true,
        exitReason: true,
        finalRMultiple: true,
        daysHeld: true,
        decision: true,
        ncsScore: true,
        scanStatus: true,
        slippagePct: true,
        regime: true,
      },
      orderBy: { tradeDate: 'asc' },
    }) as Promise<TradeRow[]>,
  ]);

  const enrichedCount = candidates.filter((r) => r.enrichedAt != null).length;
  const closedTrades = trades.filter(
    (t) => (t.tradeType === 'EXIT' || t.tradeType === 'STOP_HIT') && t.finalRMultiple != null
  ).length;

  // ── Warnings ──
  const warnings: string[] = [];
  if (enrichedCount < 30) {
    warnings.push(`Only ${enrichedCount} candidates have forward outcome data. Results may be unreliable (need ≥ 30).`);
  }
  if (closedTrades < 10) {
    warnings.push(`Only ${closedTrades} closed trades found. Exit and simulation analysis needs ≥ 10.`);
  }
  if (candidates.filter((r) => r.ncs != null).length < 20) {
    warnings.push('Limited NCS data available. Score-based analysis may be incomplete.');
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    sampleSize: {
      totalCandidates: candidates.length,
      enrichedCandidates: enrichedCount,
      totalTrades: trades.length,
      closedTrades,
    },
    warnings,
    ruleContribution: buildRuleContribution(candidates),
    classificationPerformance: buildClassificationPerformance(candidates),
    entryQuality: buildEntryQuality(candidates),
    exitPerformance: buildExitPerformance(trades),
    simulations: buildSimulations(trades),
  };
}

// ── Exported for testing ────────────────────────────────────────────
export { computeStats, buildRuleContribution, buildClassificationPerformance, buildEntryQuality, buildExitPerformance, buildSimulations };
export type { CandidateRow, TradeRow };
