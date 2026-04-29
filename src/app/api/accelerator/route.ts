// ============================================================
// /api/accelerator — Profit Acceleration Layer
// ============================================================
// Returns ranked action recommendations from the Capital Priority
// Engine. Advisory-only — every recommendation requires human
// approval. Does NOT bypass SMALL_ACCOUNT rules, max positions,
// max open risk, regime gate, or stop levels.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { normalizeBatchPricesToGBP, getMarketRegime, getDailyPrices, calculateADX, calculateMA } from '@/lib/market-data';
import { getLivePrices } from '@/lib/live-prices';
import { calculateRMultiple } from '@/lib/position-sizer';
import { apiError } from '@/lib/api-response';
import {
  rankActions,
  evaluateOpportunityCost,
  evaluateWinnerExpansion,
  reviewDeadMoney,
  type HeldPosition,
  type ReadyCandidate as AcceleratorCandidate,
  type AcceleratorContext,
} from '@/lib/profit-accelerator';
import type { RiskProfileType, Sleeve, MarketRegime } from '@/types';
import { RISK_PROFILES } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');
    if (!userId) userId = await ensureDefaultUser();

    // ── Phase 1: DB lookups ──
    const [user, openPositions, candidateOutcomes] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { equity: true, riskProfile: true },
      }),
      prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: true },
      }),
      prisma.candidateOutcome.findMany({
        where: {
          status: 'READY',
          scanDate: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
        orderBy: { ncs: 'desc' },
        take: 30,
      }),
    ]);

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const riskProfile = user.riskProfile as RiskProfileType;
    const equity = user.equity;
    const profile = RISK_PROFILES[riskProfile];

    // ── Phase 2: Live prices + regime ──
    const openTickers = openPositions.map((p) => p.stock.ticker);
    const [liveResult, regime] = await Promise.all([
      openTickers.length > 0 ? getLivePrices(openTickers, userId) : Promise.resolve({ prices: {} as Record<string, number>, sources: {}, stats: { t212Count: 0, yahooCount: 0, totalRequested: 0 } }),
      getMarketRegime(),
    ]);
    const livePrices = liveResult.prices;

    const stockCurrencies: Record<string, string | null> = {};
    for (const p of openPositions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = openTickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};

    // ── Phase 3: Enrich positions with technicals ──
    const enrichedPositions: HeldPosition[] = await Promise.all(
      openPositions.map(async (p) => {
        const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);

        // Fetch MA20 + ADX for trend detection
        let ma20: number | undefined;
        let adxToday: number | undefined;
        let adxYesterday: number | undefined;
        try {
          const bars = await getDailyPrices(p.stock.ticker, 'compact');
          if (bars.length >= 29) {
            const closes = bars.map((b) => b.close);
            ma20 = calculateMA(closes, 20);
            adxToday = calculateADX(bars, 14).adx;
            adxYesterday = calculateADX(bars.slice(1), 14).adx;
          }
        } catch {
          // Non-critical — proceed without technicals
        }

        // Look up NCS from latest score breakdown
        let currentNCS: number | undefined;
        try {
          const scoreRow = await prisma.scoreBreakdown.findFirst({
            where: { ticker: p.stock.ticker },
            orderBy: { scoredAt: 'desc' },
            select: { ncsTotal: true },
          });
          if (scoreRow?.ncsTotal != null) currentNCS = scoreRow.ncsTotal;
        } catch {
          // Non-critical
        }

        // Count pyramid adds from trade log
        let pyramidAdds = 0;
        try {
          pyramidAdds = await prisma.tradeLog.count({
            where: { userId: userId!, positionId: p.id, tradeType: 'ADD' },
          });
        } catch {
          // Non-critical
        }

        return {
          id: p.id,
          ticker: p.stock.ticker,
          sleeve: p.stock.sleeve as Sleeve,
          sector: p.stock.sector || 'Unknown',
          cluster: p.stock.cluster || 'General',
          entryPrice: p.entryPrice,
          currentPrice: rawPrice,
          currentStop: p.currentStop,
          shares: p.shares,
          initialRisk: p.initialRisk,
          entryDate: p.entryDate,
          daysHeld: Math.floor((Date.now() - p.entryDate.getTime()) / 86400000),
          rMultiple,
          atr: p.atr_at_entry || 0,
          currency: p.stock.currency || 'USD',
          pyramidAdds,
          currentNCS,
          ma20,
          adxToday,
          adxYesterday,
        };
      })
    );

    // ── Phase 4: Map scan candidates ──
    const heldTickers = new Set(enrichedPositions.map((p) => p.ticker));
    const candidates: AcceleratorCandidate[] = candidateOutcomes
      .filter((r) => !heldTickers.has(r.ticker))
      .map((r) => ({
        ticker: r.ticker,
        sleeve: (r.sleeve || 'CORE') as Sleeve,
        sector: r.sector || 'Unknown',
        cluster: r.cluster || 'General',
        ncs: r.ncs ?? 0,
        fws: r.fws ?? 0,
        actionNote: r.dualScoreAction ?? '',
        entryTrigger: r.entryTrigger ?? 0,
        stopPrice: r.stopPrice ?? 0,
        riskDollars: r.suggestedRiskGbp ?? 0,
        totalCost: r.suggestedCostGbp ?? 0,
      }));

    // ── Phase 5: Compute open risk ──
    const openRisk = enrichedPositions
      .filter((p) => p.sleeve !== 'HEDGE')
      .reduce((sum, p) => {
        const gbpPrice = gbpPrices[p.ticker] ?? p.currentPrice;
        const rawPrice = livePrices[p.ticker] || p.entryPrice;
        const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
        const currentStopGbp = p.currentStop * fxRatio;
        return sum + Math.max(0, (gbpPrice - currentStopGbp) * p.shares);
      }, 0);
    const openRiskPercent = equity > 0 ? (openRisk / equity) * 100 : 0;

    // ── Phase 6: Run accelerator engines ──
    const ctx: AcceleratorContext = {
      positions: enrichedPositions,
      candidates,
      equity,
      riskProfile,
      regime: regime as AcceleratorContext['regime'],
      openRiskPercent,
    };

    const recommendations = rankActions(ctx);
    const opportunityCosts = evaluateOpportunityCost(
      enrichedPositions,
      candidates,
      profile.maxPositions
    );
    const winnerExpansions = evaluateWinnerExpansion(
      enrichedPositions,
      equity,
      riskProfile,
      openRiskPercent
    );
    const deadMoneyReview = reviewDeadMoney(enrichedPositions, candidates);

    return NextResponse.json({
      ok: true,
      data: {
        recommendations,
        opportunityCosts,
        winnerExpansions,
        deadMoneyReview,
        context: {
          equity,
          riskProfile,
          regime,
          openRiskPercent,
          maxPositions: profile.maxPositions,
          maxOpenRisk: profile.maxOpenRisk,
          positionsCount: enrichedPositions.filter((p) => p.sleeve !== 'HEDGE').length,
          slotsAvailable: Math.max(0, profile.maxPositions - enrichedPositions.filter((p) => p.sleeve !== 'HEDGE').length),
          riskHeadroom: Math.max(0, profile.maxOpenRisk - openRiskPercent),
          candidatesCount: candidates.length,
          aGradeCandidates: candidates.filter((c) => c.ncs >= 70 && c.fws <= 30).length,
        },
      },
    });
  } catch (error) {
    console.error('[Accelerator] Unexpected error:', error);
    return apiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error');
  }
}
