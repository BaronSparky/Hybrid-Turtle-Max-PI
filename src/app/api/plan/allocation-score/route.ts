/**
 * DEPENDENCIES
 * Consumed by: Plan page, allocation views
 * Consumes: allocation-score.ts, ev-tracker.ts, prisma.ts, dual-score.ts
 * Risk-sensitive: NO — advisory ranking, no orders
 * Last modified: 2026-03-06
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  scoreAndRankCandidates,
  WEIGHTS,
  type AllocationCandidate,
  type PortfolioContext,
} from '@/lib/allocation-score';
import { scoreRow, normaliseRow } from '@/lib/dual-score';
import { getExpectancyStats } from '@/lib/ev-tracker';
import type { Sleeve, RiskProfileType } from '@/types';

export async function GET() {
  // 1. Load user
  const user = await prisma.user.findFirst();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No user found' }, { status: 404 });
  }

  const equity = user.equity;
  const riskProfile = (user.riskProfile || 'SMALL_ACCOUNT') as RiskProfileType;

  // 2. Get latest snapshot with READY/WATCH candidates
  const latestSnapshot = await prisma.snapshot.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  if (!latestSnapshot) {
    return NextResponse.json({ ok: false, error: 'No snapshot data. Run nightly sync first.' }, { status: 404 });
  }

  const snapshotTickers = await prisma.snapshotTicker.findMany({
    where: { snapshotId: latestSnapshot.id, status: 'READY' },
  });

  if (snapshotTickers.length === 0) {
    return NextResponse.json({ ok: true, entries: [], weights: WEIGHTS, message: 'No READY candidates' });
  }

  // 3. Score candidates via dual-score
  const candidates: AllocationCandidate[] = [];
  for (const st of snapshotTickers) {
    const row = normaliseRow({
      ticker: st.ticker, name: st.name || st.ticker, sleeve: st.sleeve || 'CORE',
      status: st.status || 'READY', close: st.close, atr_14: st.atr14,
      atr_pct: st.atrPct, adx_14: st.adx14, plus_di: st.plusDi,
      minus_di: st.minusDi, vol_ratio: st.volRatio,
      market_regime: st.marketRegime, market_regime_stable: st.marketRegimeStable,
      distance_to_20d_high_pct: st.distanceTo20dHighPct,
      entry_trigger: st.entryTrigger, stop_level: st.stopLevel,
      chasing_20_last5: st.chasing20Last5, chasing_55_last5: st.chasing55Last5,
      atr_spiking: st.atrSpiking, atr_collapsing: st.atrCollapsing,
      rs_vs_benchmark_pct: st.rsVsBenchmarkPct,
      days_to_earnings: st.daysToEarnings, earnings_in_next_5d: st.earningsInNext5d,
      cluster_name: st.clusterName, super_cluster_name: st.superClusterName,
      cluster_exposure_pct: st.clusterExposurePct,
      super_cluster_exposure_pct: st.superClusterExposurePct,
      max_cluster_pct: st.maxClusterPct, max_super_cluster_pct: st.maxSuperClusterPct,
      weekly_adx: st.weeklyAdx, vol_regime: st.volRegime,
      dual_regime_aligned: st.dualRegimeAligned, bis_score: st.bisScore,
    });
    const scored = scoreRow(row);

    if (st.entryTrigger <= 0 || st.stopLevel <= 0 || st.stopLevel >= st.entryTrigger) continue;

    // Look up stock for sector/cluster
    const stock = await prisma.stock.findFirst({
      where: { ticker: st.ticker },
      select: { sector: true, cluster: true },
    });

    candidates.push({
      ticker: st.ticker,
      name: st.name || st.ticker,
      sleeve: (st.sleeve || 'CORE') as Sleeve,
      sector: stock?.sector || 'Unknown',
      cluster: stock?.cluster || st.clusterName || 'General',
      ncs: scored.NCS,
      fws: scored.FWS,
      bqs: scored.BQS,
      entryTrigger: st.entryTrigger,
      stopPrice: st.stopLevel,
      suggestedShares: null, // would need position sizer + FX
      suggestedRiskGbp: null,
      suggestedCostGbp: null,
      daysToEarnings: st.daysToEarnings,
      atrPct: st.atrPct,
    });
  }

  // 4. Build portfolio context
  const positions = await prisma.position.findMany({
    where: { userId: user.id, status: 'OPEN' },
    include: { stock: true },
  });

  const positionData = positions.map((p) => ({
    ticker: p.stock.ticker,
    sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
    sector: p.stock.sector || 'Unknown',
    cluster: p.stock.cluster || 'General',
    value: p.entryPrice * p.shares,
  }));

  // 5. Fetch correlation flags
  const corrFlags = await prisma.correlationFlag.findMany({
    where: { flag: 'HIGH_CORR' },
    select: { tickerA: true, tickerB: true, correlation: true },
  });

  // 6. Fetch expectancy data
  const evStats = await getExpectancyStats();
  const expectancyByKey = new Map<string, number>();
  // Build keys from sliced data
  for (const slice of [...evStats.bySleeve, ...evStats.byRegime, ...evStats.byAtrBucket]) {
    // These are single-dimension slices. For combined keys, iterate EV records directly.
  }
  // Fetch raw EV records for combination keys
  const evRecords = await prisma.evRecord.findMany({
    select: { sleeve: true, atrBucket: true, regime: true, rMultiple: true },
  });
  // Group and compute mean R per combination
  const evGroups = new Map<string, number[]>();
  for (const ev of evRecords) {
    const key = `${ev.sleeve}|${ev.atrBucket}|${ev.regime}`;
    const arr = evGroups.get(key) ?? [];
    arr.push(ev.rMultiple);
    evGroups.set(key, arr);
  }
  for (const key of Array.from(evGroups.keys())) {
    const vals = evGroups.get(key)!;
    expectancyByKey.set(key, vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  // Determine current regime
  const latestRegime = await prisma.regimeHistory.findFirst({ orderBy: { date: 'desc' } });
  const regime = latestRegime?.regime || 'NEUTRAL';

  const context: PortfolioContext = {
    equity,
    riskProfile,
    positions: positionData,
    correlationFlags: corrFlags,
    expectancyByKey,
    regime,
  };

  // 7. Score and rank
  const entries = scoreAndRankCandidates(candidates, context);

  return NextResponse.json({
    ok: true,
    equity,
    riskProfile,
    regime,
    snapshotDate: latestSnapshot.createdAt,
    weights: WEIGHTS,
    entries,
  });
}
