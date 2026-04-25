/**
 * DEPENDENCIES
 * Consumed by: Plan page (allocation tab)
 * Consumes: capital-ranker.ts, dual-score.ts, prisma.ts
 * Risk-sensitive: YES — uses position sizer and risk gates (advisory only)
 * Last modified: 2026-03-06
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { rankForCapitalAllocation } from '@/lib/capital-ranker';
import { scoreRow, normaliseRow } from '@/lib/dual-score';
import type { Sleeve, RiskProfileType } from '@/types';

export async function GET() {
  const user = await prisma.user.findFirst();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No user found' }, { status: 404 });
  }

  const equity = user.equity;
  const riskProfile = (user.riskProfile || 'SMALL_ACCOUNT') as RiskProfileType;

  // Get the latest snapshot for scoring
  const latestSnapshot = await prisma.snapshot.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  if (!latestSnapshot) {
    return NextResponse.json({ ok: false, error: 'No snapshot data available. Run nightly sync first.' }, { status: 404 });
  }

  const snapshotTickers = await prisma.snapshotTicker.findMany({
    where: {
      snapshotId: latestSnapshot.id,
      status: { in: ['READY', 'WATCH'] },
    },
  });

  if (snapshotTickers.length === 0) {
    return NextResponse.json({ ok: true, entries: [], message: 'No READY/WATCH candidates in latest snapshot' });
  }

  // Score all candidates
  const candidates = snapshotTickers
    .map((st) => {
      const row = normaliseRow({
        ticker: st.ticker,
        name: st.name || st.ticker,
        sleeve: st.sleeve || 'CORE',
        status: st.status || 'WATCH',
        close: st.close,
        atr_14: st.atr14,
        atr_pct: st.atrPct,
        adx_14: st.adx14,
        plus_di: st.plusDi,
        minus_di: st.minusDi,
        vol_ratio: st.volRatio,
        market_regime: st.marketRegime,
        market_regime_stable: st.marketRegimeStable,
        distance_to_20d_high_pct: st.distanceTo20dHighPct,
        entry_trigger: st.entryTrigger,
        stop_level: st.stopLevel,
        chasing_20_last5: st.chasing20Last5,
        chasing_55_last5: st.chasing55Last5,
        atr_spiking: st.atrSpiking,
        atr_collapsing: st.atrCollapsing,
        rs_vs_benchmark_pct: st.rsVsBenchmarkPct,
        days_to_earnings: st.daysToEarnings,
        earnings_in_next_5d: st.earningsInNext5d,
        cluster_name: st.clusterName,
        super_cluster_name: st.superClusterName,
        cluster_exposure_pct: st.clusterExposurePct,
        super_cluster_exposure_pct: st.superClusterExposurePct,
        max_cluster_pct: st.maxClusterPct,
        max_super_cluster_pct: st.maxSuperClusterPct,
        weekly_adx: st.weeklyAdx,
        vol_regime: st.volRegime,
        dual_regime_aligned: st.dualRegimeAligned,
        bis_score: st.bisScore,
        currency: st.currency,
      });
      const scored = scoreRow(row);
      return {
        ticker: st.ticker,
        name: st.name || st.ticker,
        sleeve: (st.sleeve || 'CORE') as Sleeve,
        sector: 'Unknown', // Snapshot doesn't carry sector — would need stock lookup
        cluster: st.clusterName || 'General',
        entryTrigger: st.entryTrigger,
        stopPrice: st.stopLevel,
        ncs: scored.NCS,
        fws: scored.FWS,
        bqs: scored.BQS,
        fxToGbp: 1, // simplified; full scan uses proper FX
        currency: st.currency || undefined,
      };
    })
    .filter((c) => c.entryTrigger > 0 && c.stopPrice > 0 && c.stopPrice < c.entryTrigger);

  const entries = await rankForCapitalAllocation(candidates, equity, riskProfile, user.id);

  return NextResponse.json({
    ok: true,
    equity,
    riskProfile,
    snapshotDate: latestSnapshot.createdAt,
    entries,
  });
}
