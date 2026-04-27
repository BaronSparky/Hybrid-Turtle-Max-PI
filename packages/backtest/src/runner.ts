/**
 * DEPENDENCIES
 * Consumed by: packages/backtest/src/index.ts, src/app/api/backtests/run/route.ts, src/app/api/backtests/[id]/route.ts, scripts/verify-phase11.ts
 * Consumes: packages/data/src/prisma.ts, src/lib/dual-score.ts, src/lib/breakout-probability.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 11 shared backtest runner over historical snapshot data. Reuses the live scoring stack and monotonic stop simulation, then persists stored run results for UI/API access.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, round } from '../../data/src/prisma';
import { scoreRow, type SnapshotRow } from '../../../src/lib/dual-score';
import { calcBPSFromSnapshot, computeRsPercentiles } from '../../../src/lib/breakout-probability';
import type {
  BacktestCurvePoint,
  BacktestMode,
  BacktestRequest,
  BacktestResult,
  BacktestSummary,
  BacktestTrade,
  StoredBacktestRun,
} from './types';

const DEFAULT_INITIAL_CAPITAL = 10_000;
const DEFAULT_RISK_PER_TRADE_PCT = 2;
const LOOKBACK_BUFFER_DAYS = 10;
const LOOKAHEAD_BUFFER_DAYS = 45;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isSameUtcDay(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function decimalOrNull(value: number | null | undefined): number | null {
  return value == null ? null : value;
}

const snapshotRowSchema = z.object({
  ticker: z.string(),
  name: z.string().default(''),
  sleeve: z.string().default(''),
  status: z.string().default(''),
  currency: z.string().default(''),
  close: z.number().default(0),
  atr14: z.number().default(0),
  atrPct: z.number().default(0),
  adx14: z.number().default(0),
  plusDi: z.number().default(0),
  minusDi: z.number().default(0),
  volRatio: z.number().default(1),
  dollarVol20: z.number().default(0),
  liquidityOk: z.boolean().default(true),
  marketRegime: z.string().default('NEUTRAL'),
  marketRegimeStable: z.boolean().default(true),
  high20: z.number().default(0),
  high55: z.number().default(0),
  distanceTo20dHighPct: z.number().default(0),
  distanceTo55dHighPct: z.number().default(0),
  entryTrigger: z.number().default(0),
  stopLevel: z.number().default(0),
  chasing20Last5: z.boolean().default(false),
  chasing55Last5: z.boolean().default(false),
  atrSpiking: z.boolean().default(false),
  atrCollapsing: z.boolean().default(false),
  atrCompressionRatio: z.number().nullable().default(null),
  rsVsBenchmarkPct: z.number().default(0),
  daysToEarnings: z.number().nullable().default(null),
  earningsInNext5d: z.boolean().default(false),
  clusterName: z.string().default(''),
  superClusterName: z.string().default(''),
  clusterExposurePct: z.number().default(0),
  superClusterExposurePct: z.number().default(0),
  maxClusterPct: z.number().default(0),
  maxSuperClusterPct: z.number().default(0),
  weeklyAdx: z.number().default(0),
  volRegime: z.string().default('NORMAL_VOL'),
  dualRegimeAligned: z.boolean().default(true),
  bisScore: z.number().default(0),
});

function toSnapshotRow(row: Record<string, unknown>): SnapshotRow {
  const parsed = snapshotRowSchema.parse(row);
  return {
    ticker: parsed.ticker,
    name: parsed.name || parsed.ticker,
    sleeve: parsed.sleeve,
    status: parsed.status,
    currency: parsed.currency,
    close: parsed.close,
    atr_14: parsed.atr14,
    atr_pct: parsed.atrPct,
    adx_14: parsed.adx14,
    plus_di: parsed.plusDi,
    minus_di: parsed.minusDi,
    vol_ratio: parsed.volRatio,
    dollar_vol_20: parsed.dollarVol20,
    liquidity_ok: parsed.liquidityOk,
    market_regime: parsed.marketRegime,
    market_regime_stable: parsed.marketRegimeStable,
    high_20: parsed.high20,
    high_55: parsed.high55,
    distance_to_20d_high_pct: parsed.distanceTo20dHighPct,
    distance_to_55d_high_pct: parsed.distanceTo55dHighPct,
    entry_trigger: parsed.entryTrigger,
    stop_level: parsed.stopLevel,
    chasing_20_last5: parsed.chasing20Last5,
    chasing_55_last5: parsed.chasing55Last5,
    atr_spiking: parsed.atrSpiking,
    atr_collapsing: parsed.atrCollapsing,
    atr_compression_ratio: parsed.atrCompressionRatio,
    rs_vs_benchmark_pct: parsed.rsVsBenchmarkPct,
    days_to_earnings: parsed.daysToEarnings,
    earnings_in_next_5d: parsed.earningsInNext5d,
    cluster_name: parsed.clusterName,
    super_cluster_name: parsed.superClusterName,
    cluster_exposure_pct: parsed.clusterExposurePct,
    super_cluster_exposure_pct: parsed.superClusterExposurePct,
    max_cluster_pct: parsed.maxClusterPct,
    max_super_cluster_pct: parsed.maxSuperClusterPct,
    weekly_adx: parsed.weeklyAdx,
    vol_regime: parsed.volRegime,
    dual_regime_aligned: parsed.dualRegimeAligned,
    bis_score: parsed.bisScore,
  };
}

function simulateStopLadder(
  entryPrice: number,
  initialStop: number,
  forwardCloses: Array<{ date: string; close: number; atr14: number }>,
): { hit: boolean; hitDate: string | null; hitR: number | null; maxFavR: number; maxAdvR: number } {
  const riskPerShare = entryPrice - initialStop;
  if (riskPerShare <= 0) {
    return { hit: false, hitDate: null, hitR: null, maxFavR: 0, maxAdvR: 0 };
  }

  let currentStop = initialStop;
  let maxFavR = 0;
  let maxAdvR = 0;

  for (const snap of forwardCloses) {
    const rMultiple = (snap.close - entryPrice) / riskPerShare;
    maxFavR = Math.max(maxFavR, rMultiple);
    maxAdvR = Math.min(maxAdvR, rMultiple);

    if (snap.close <= currentStop) {
      return {
        hit: true,
        hitDate: snap.date,
        hitR: (currentStop - entryPrice) / riskPerShare,
        maxFavR,
        maxAdvR,
      };
    }

    if (rMultiple >= 3.0) {
      currentStop = Math.max(currentStop, Math.max(entryPrice + riskPerShare, snap.close - 2 * snap.atr14));
    } else if (rMultiple >= 2.5) {
      currentStop = Math.max(currentStop, entryPrice + 0.5 * riskPerShare);
    } else if (rMultiple >= 1.5) {
      currentStop = Math.max(currentStop, entryPrice);
    }
  }

  return { hit: false, hitDate: null, hitR: null, maxFavR, maxAdvR };
}

function findForwardReturn(
  forwardSnaps: Array<{ date: string; close: number }>,
  signalDate: Date,
  targetDays: number,
  riskPerShare: number,
  entryPrice: number,
): { date: string; close: number; rMultiple: number; daysDelta: number } | null {
  if (forwardSnaps.length === 0 || riskPerShare <= 0) {
    return null;
  }

  let best: { snap: { date: string; close: number }; daysDelta: number } | null = null;
  const tolerance = Math.max(3, targetDays * 0.4);

  for (const snap of forwardSnaps) {
    const snapDate = new Date(snap.date);
    const daysDelta = daysBetween(signalDate, snapDate);
    const diff = Math.abs(daysDelta - targetDays);
    if (diff <= tolerance && (!best || diff < Math.abs(best.daysDelta - targetDays))) {
      best = { snap, daysDelta };
    }
  }

  if (!best) {
    return null;
  }

  return {
    date: best.snap.date,
    close: best.snap.close,
    rMultiple: round((best.snap.close - entryPrice) / riskPerShare),
    daysDelta: best.daysDelta,
  };
}

function buildSummary(
  mode: BacktestMode,
  startDate: Date,
  endDate: Date,
  replayDate: Date | null,
  initialCapital: number,
  riskPerTradePct: number,
  snapshotCount: number,
  trades: BacktestTrade[],
  equityCurve: BacktestCurvePoint[],
): BacktestSummary {
  const completed = trades.filter((trade) => trade.realizedR != null);
  const winners = completed.filter((trade) => (trade.realizedR ?? 0) > 0);
  const losers = completed.filter((trade) => (trade.realizedR ?? 0) < 0);
  const winSum = winners.reduce((sum, trade) => sum + (trade.realizedR ?? 0), 0);
  const lossSumAbs = Math.abs(losers.reduce((sum, trade) => sum + (trade.realizedR ?? 0), 0));
  const averageR = completed.length > 0
    ? round(completed.reduce((sum, trade) => sum + (trade.realizedR ?? 0), 0) / completed.length)
    : null;
  const averageWinR = winners.length > 0 ? round(winSum / winners.length) : null;
  const averageLossR = losers.length > 0
    ? round(losers.reduce((sum, trade) => sum + (trade.realizedR ?? 0), 0) / losers.length)
    : null;
  const endingCapital = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const totalReturnPct = completed.length > 0 ? round(((endingCapital - initialCapital) / initialCapital) * 100) : null;
  const maxDrawdownPct = equityCurve.length > 0
    ? round(Math.max(...equityCurve.map((point) => point.drawdownPct)))
    : null;
  const stopsHit = trades.filter((trade) => trade.stopHit).length;
  const averageHoldingDays = completed.length > 0
    ? round(completed.reduce((sum, trade) => sum + (trade.daysHeld ?? 0), 0) / completed.length)
    : null;

  return {
    mode,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    replayDate: replayDate?.toISOString() ?? null,
    initialCapital: round(initialCapital),
    endingCapital: round(endingCapital),
    riskPerTradePct: round(riskPerTradePct),
    snapshotCount,
    signalCount: trades.length,
    completedTrades: completed.length,
    winRate: completed.length > 0 ? round((winners.length / completed.length) * 100) : null,
    averageR,
    averageWinR,
    averageLossR,
    expectancyR: averageR,
    profitFactor: lossSumAbs > 0 ? round(winSum / lossSumAbs) : null,
    totalReturnPct,
    maxDrawdownPct,
    averageHoldingDays,
    stopsHit,
    stopsHitPct: trades.length > 0 ? round((stopsHit / trades.length) * 100) : null,
  };
}

function mapStoredRun(row: {
  id: string;
  status: string;
  requestedAt: Date;
  finishedAt: Date | null;
  filtersJson: Prisma.JsonValue | null;
  summaryJson: Prisma.JsonValue | null;
  tradesJson: Prisma.JsonValue | null;
  equityCurveJson: Prisma.JsonValue | null;
  drawdownCurveJson: Prisma.JsonValue | null;
  errorMessage: string | null;
}): StoredBacktestRun {
  return {
    id: row.id,
    status: row.status as StoredBacktestRun['status'],
    requestedAt: row.requestedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    filters: (row.filtersJson as unknown as StoredBacktestRun['filters'] | null) ?? { ticker: null, sleeve: null, regime: null },
    summary: row.summaryJson as unknown as BacktestSummary,
    trades: (row.tradesJson as unknown as BacktestTrade[]) ?? [],
    equityCurve: (row.equityCurveJson as unknown as BacktestCurvePoint[]) ?? [],
    drawdownCurve: (row.drawdownCurveJson as unknown as BacktestCurvePoint[]) ?? [],
    errorMessage: row.errorMessage,
  };
}

export async function runBacktest(input: BacktestRequest): Promise<BacktestResult> {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const replayDate = input.replayDate ? new Date(input.replayDate) : null;
  const mode: BacktestMode = input.mode ?? 'FULL';
  const initialCapital = input.initialCapital ?? DEFAULT_INITIAL_CAPITAL;
  const riskPerTradePct = input.riskPerTradePct ?? DEFAULT_RISK_PER_TRADE_PCT;

  const loadStart = addDays(startDate, -LOOKBACK_BUFFER_DAYS);
  const loadEnd = addDays(endDate, LOOKAHEAD_BUFFER_DAYS);

  const snapshots = await prisma.snapshot.findMany({
    where: {
      createdAt: {
        gte: loadStart,
        lte: loadEnd,
      },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true },
  });

  if (snapshots.length === 0) {
    const emptyCurve: BacktestCurvePoint[] = [{
      date: startDate.toISOString(),
      equity: round(initialCapital),
      drawdownPct: 0,
      tradeCount: 0,
    }];
    return {
      summary: buildSummary(mode, startDate, endDate, replayDate, initialCapital, riskPerTradePct, 0, [], emptyCurve),
      trades: [],
      equityCurve: emptyCurve,
      drawdownCurve: emptyCurve,
    };
  }

  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const snapshotDateMap = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.createdAt]));

  const where: Prisma.SnapshotTickerWhereInput = {
    snapshotId: { in: snapshotIds },
  };
  if (input.ticker) {
    where.ticker = input.ticker;
  }
  if (input.sleeve) {
    where.sleeve = input.sleeve;
  }

  const rows = await prisma.snapshotTicker.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }],
    select: {
      snapshotId: true,
      ticker: true,
      name: true,
      sleeve: true,
      status: true,
      currency: true,
      close: true,
      atr14: true,
      atrPct: true,
      adx14: true,
      plusDi: true,
      minusDi: true,
      weeklyAdx: true,
      volRatio: true,
      dollarVol20: true,
      liquidityOk: true,
      bisScore: true,
      marketRegime: true,
      marketRegimeStable: true,
      volRegime: true,
      dualRegimeAligned: true,
      high20: true,
      high55: true,
      distanceTo20dHighPct: true,
      distanceTo55dHighPct: true,
      entryTrigger: true,
      stopLevel: true,
      chasing20Last5: true,
      chasing55Last5: true,
      atrSpiking: true,
      atrCollapsing: true,
      atrCompressionRatio: true,
      rsVsBenchmarkPct: true,
      daysToEarnings: true,
      earningsInNext5d: true,
      clusterName: true,
      superClusterName: true,
      clusterExposurePct: true,
      superClusterExposurePct: true,
      maxClusterPct: true,
      maxSuperClusterPct: true,
      createdAt: true,
    },
  });

  type HistoryRow = (typeof rows)[number];
  const rsPercentileBySnapshot = new Map<string, Map<string, number>>();
  const snapshotBuckets = new Map<string, Array<{ ticker: string; rs: number }>>();
  for (const row of rows) {
    const bucket = snapshotBuckets.get(row.snapshotId) ?? [];
    bucket.push({ ticker: row.ticker, rs: row.rsVsBenchmarkPct ?? 0 });
    snapshotBuckets.set(row.snapshotId, bucket);
  }
  for (const [snapshotId, bucket] of Array.from(snapshotBuckets.entries())) {
    rsPercentileBySnapshot.set(snapshotId, computeRsPercentiles(bucket));
  }

  const historyByTicker = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const history = historyByTicker.get(row.ticker) ?? [];
    history.push(row);
    historyByTicker.set(row.ticker, history);
  }

  const trades: BacktestTrade[] = [];

  for (const [ticker, history] of Array.from(historyByTicker.entries())) {
    history.sort((left, right) => {
      const leftTime = snapshotDateMap.get(left.snapshotId)?.getTime() ?? left.createdAt.getTime();
      const rightTime = snapshotDateMap.get(right.snapshotId)?.getTime() ?? right.createdAt.getTime();
      return leftTime - rightTime;
    });

    for (let index = 0; index < history.length; index += 1) {
      const current = history[index];
      const previous = index > 0 ? history[index - 1] : null;
      const signalDate = snapshotDateMap.get(current.snapshotId) ?? current.createdAt;

      if (signalDate < startDate || signalDate > endDate) {
        continue;
      }
      if (replayDate && !isSameUtcDay(signalDate, replayDate)) {
        continue;
      }
      if (input.regime && current.marketRegime !== input.regime) {
        continue;
      }
      if (!current.entryTrigger || !current.stopLevel || !current.close) {
        continue;
      }

      const entryPrice = current.close;
      const riskPerShare = entryPrice - current.stopLevel;
      if (riskPerShare <= 0) {
        continue;
      }

      const triggered = current.close >= current.entryTrigger;
      const prevBelow = !previous || previous.close < (previous.entryTrigger || current.entryTrigger);
      if (!triggered || !prevBelow) {
        continue;
      }

      const snapshotRow = toSnapshotRow(current as unknown as Record<string, unknown>);
      const scored = scoreRow(snapshotRow);
      const displayNcs = mode === 'CORE_LITE'
        ? round(Math.max(0, Math.min(100, scored.BQS - 0.8 * scored.FWS + 10)))
        : scored.NCS;
      const actionNote = mode === 'CORE_LITE' ? 'CORE_LITE' : scored.ActionNote;

      const forwardCloses = history.slice(index + 1).map((row) => ({
        date: (snapshotDateMap.get(row.snapshotId) ?? row.createdAt).toISOString(),
        close: row.close,
        atr14: row.atr14,
      }));
      const fwd20 = findForwardReturn(
        forwardCloses.map((point) => ({ date: point.date, close: point.close })),
        signalDate,
        20,
        riskPerShare,
        entryPrice,
      );
      const stopSimulation = simulateStopLadder(entryPrice, current.stopLevel, forwardCloses);
      const lastForward = forwardCloses.length > 0 ? forwardCloses[forwardCloses.length - 1] : null;

      const realizedR = stopSimulation.hit
        ? round(stopSimulation.hitR ?? 0)
        : fwd20
          ? round(fwd20.rMultiple)
          : lastForward
            ? round((lastForward.close - entryPrice) / riskPerShare)
            : null;
      const exitDate = stopSimulation.hit
        ? stopSimulation.hitDate
        : fwd20?.date ?? lastForward?.date ?? null;
      const exitReason = stopSimulation.hit
        ? 'STOP_HIT'
        : fwd20
          ? 'TIME_EXIT_20D'
          : lastForward
            ? 'PARTIAL_LOOKAHEAD'
            : 'NO_OUTCOME';

      const rsPercentile = rsPercentileBySnapshot.get(current.snapshotId)?.get(ticker) ?? null;
      const bps = calcBPSFromSnapshot({
        atr_pct: snapshotRow.atr_pct,
        atr_compression_ratio: snapshotRow.atr_compression_ratio,
        rs_vs_benchmark_pct: snapshotRow.rs_vs_benchmark_pct,
        rsPercentile,
        weekly_adx: snapshotRow.weekly_adx as number | undefined,
        sector: snapshotRow.cluster_name as string | undefined,
      }).bps;

      trades.push({
        ticker,
        name: current.name || ticker,
        sleeve: current.sleeve || '',
        regime: current.marketRegime,
        signalDate: signalDate.toISOString(),
        entryPrice: round(entryPrice),
        entryTrigger: round(current.entryTrigger),
        stopLevel: round(current.stopLevel),
        riskPerShare: round(riskPerShare),
        bqs: round(scored.BQS),
        fws: round(scored.FWS),
        ncs: round(displayNcs),
        bps,
        actionNote,
        stopHit: stopSimulation.hit,
        stopHitDate: stopSimulation.hitDate,
        stopHitR: stopSimulation.hitR == null ? null : round(stopSimulation.hitR),
        maxFavorableR: round(stopSimulation.maxFavR),
        maxAdverseR: round(stopSimulation.maxAdvR),
        realizedR,
        exitDate,
        exitReason,
        daysHeld: exitDate ? daysBetween(signalDate, new Date(exitDate)) : null,
      });
    }
  }

  trades.sort((left, right) => new Date(left.signalDate).getTime() - new Date(right.signalDate).getTime());

  let equity = initialCapital;
  let peakEquity = initialCapital;
  const equityCurve: BacktestCurvePoint[] = [{
    date: startDate.toISOString(),
    equity: round(initialCapital),
    drawdownPct: 0,
    tradeCount: 0,
  }];

  for (let index = 0; index < trades.length; index += 1) {
    const trade = trades[index];
    if (trade.realizedR == null) {
      continue;
    }

    const riskAmount = equity * (riskPerTradePct / 100);
    equity += riskAmount * trade.realizedR;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    equityCurve.push({
      date: trade.exitDate ?? trade.signalDate,
      equity: round(equity),
      drawdownPct: round(drawdownPct),
      tradeCount: equityCurve.length,
    });
  }

  const summary = buildSummary(mode, startDate, endDate, replayDate, initialCapital, riskPerTradePct, snapshots.length, trades, equityCurve);

  return {
    summary,
    trades: [...trades].sort((left, right) => new Date(right.signalDate).getTime() - new Date(left.signalDate).getTime()),
    equityCurve,
    drawdownCurve: equityCurve.map((point) => ({
      date: point.date,
      equity: point.drawdownPct,
      drawdownPct: point.drawdownPct,
      tradeCount: point.tradeCount,
    })),
  };
}

export async function runAndStoreBacktest(input: BacktestRequest): Promise<StoredBacktestRun> {
  const mode: BacktestMode = input.mode ?? 'FULL';
  const filters = {
    ticker: input.ticker ?? null,
    sleeve: input.sleeve ?? null,
    regime: input.regime ?? null,
  };

  const created = await prisma.backtestRun.create({
    data: {
      mode,
      startDate: input.startDate,
      endDate: input.endDate,
      replayDate: input.replayDate ?? null,
      status: 'RUNNING',
      initialCapital: input.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
      riskPerTradePct: input.riskPerTradePct ?? DEFAULT_RISK_PER_TRADE_PCT,
      filtersJson: filters as Prisma.JsonObject,
    },
    select: {
      id: true,
    },
  });

  try {
    const result = await runBacktest(input);
    const updated = await prisma.backtestRun.update({
      where: { id: created.id },
      data: {
        status: 'SUCCEEDED',
        signalCount: result.summary.signalCount,
        completedTrades: result.summary.completedTrades,
        winRate: decimalOrNull(result.summary.winRate),
        averageR: decimalOrNull(result.summary.averageR),
        totalReturnPct: decimalOrNull(result.summary.totalReturnPct),
        maxDrawdownPct: decimalOrNull(result.summary.maxDrawdownPct),
        summaryJson: result.summary as unknown as Prisma.JsonObject,
        tradesJson: result.trades as unknown as Prisma.JsonArray,
        equityCurveJson: result.equityCurve as unknown as Prisma.JsonArray,
        drawdownCurveJson: result.drawdownCurve as unknown as Prisma.JsonArray,
        finishedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        finishedAt: true,
        filtersJson: true,
        summaryJson: true,
        tradesJson: true,
        equityCurveJson: true,
        drawdownCurveJson: true,
        errorMessage: true,
      },
    });

    return mapStoredRun(updated);
  } catch (error) {
    await prisma.backtestRun.update({
      where: { id: created.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown backtest failure',
      },
    });
    throw error;
  }
}

export async function getStoredBacktestRun(id: string): Promise<StoredBacktestRun | null> {
  const row = await prisma.backtestRun.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      finishedAt: true,
      filtersJson: true,
      summaryJson: true,
      tradesJson: true,
      equityCurveJson: true,
      drawdownCurveJson: true,
      errorMessage: true,
    },
  });

  return row ? mapStoredRun(row) : null;
}