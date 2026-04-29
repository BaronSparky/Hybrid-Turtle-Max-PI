// ============================================================
// /api/exit-intelligence — Exit Intelligence Layer
// ============================================================
// Returns per-position exit intelligence with 8 scores, an
// action recommendation, and plain-English explanation.
// Advisory-only — never auto-exits, never lowers stops.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { getDailyPrices, calculateADX, calculateMA, calculateATR } from '@/lib/market-data';
import { getLivePrices } from '@/lib/live-prices';
import { calculateRMultiple } from '@/lib/position-sizer';
import { apiError } from '@/lib/api-response';
import { evaluateAllPositions, type ExitPosition } from '@/lib/exit-intelligence';
import type { Sleeve } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');
    if (!userId) userId = await ensureDefaultUser();

    // ── Phase 1: DB lookups ──
    const [user, openPositions, aGradeCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { equity: true, riskProfile: true },
      }),
      prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: true },
      }),
      // Count A-grade candidates waiting (NCS ≥ 70, FWS ≤ 30)
      prisma.candidateOutcome.count({
        where: {
          status: 'READY',
          scanDate: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
          ncs: { gte: 70 },
          fws: { lte: 30 },
        },
      }),
    ]);

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    if (openPositions.length === 0) {
      return NextResponse.json({
        ok: true,
        data: {
          results: [],
          summary: { total: 0, needsAttention: 0, aGradeWaiting: aGradeCount },
        },
      });
    }

    // ── Phase 2: Live prices (T212 primary, Yahoo fallback) ──
    const openTickers = openPositions.map((p) => p.stock.ticker);
    const { prices: livePrices } = await getLivePrices(openTickers, userId);

    // ── Phase 3: Enrich positions with technicals ──
    const enrichedPositions: ExitPosition[] = await Promise.all(
      openPositions.map(async (p) => {
        const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
        const daysHeld = Math.floor((Date.now() - p.entryDate.getTime()) / 86400000);

        // Fetch technicals from daily bars
        let ma20: number | undefined;
        let adxToday: number | undefined;
        let adxYesterday: number | undefined;
        let atr = p.atr_at_entry || 0;
        let plusDI: number | undefined;
        let minusDI: number | undefined;
        let volume: number | undefined;
        let avgVolume20: number | undefined;
        let priceAboveMa20Pct: number | undefined;

        try {
          const bars = await getDailyPrices(p.stock.ticker, 'compact');
          if (bars.length >= 29) {
            const closes = bars.map((b) => b.close);
            ma20 = calculateMA(closes, 20);
            const adxResult = calculateADX(bars, 14);
            adxToday = adxResult.adx;
            plusDI = adxResult.plusDI;
            minusDI = adxResult.minusDI;
            adxYesterday = calculateADX(bars.slice(1), 14).adx;
            atr = calculateATR(bars, 14);

            // Volume data
            volume = bars[0].volume;
            avgVolume20 = bars.slice(1, 21).reduce((s, b) => s + b.volume, 0) / 20;

            // Price above MA20
            if (ma20 > 0) {
              priceAboveMa20Pct = ((rawPrice - ma20) / ma20) * 100;
            }
          }
        } catch {
          // Non-critical — proceed with what we have
        }

        // NCS from latest score breakdown
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

        // RS from latest snapshot
        let relativeStrength: number | undefined;
        try {
          const snapRow = await prisma.snapshotTicker.findFirst({
            where: { ticker: p.stock.ticker },
            orderBy: { createdAt: 'desc' },
            select: { rsVsBenchmarkPct: true },
          });
          if (snapRow?.rsVsBenchmarkPct != null) relativeStrength = snapRow.rsVsBenchmarkPct;
        } catch {
          // Non-critical
        }

        const atrPct = rawPrice > 0 && atr > 0 ? (atr / rawPrice) * 100 : undefined;

        return {
          id: p.id,
          ticker: p.stock.ticker,
          sleeve: p.stock.sleeve as string,
          entryPrice: p.entryPrice,
          currentPrice: rawPrice,
          currentStop: p.currentStop,
          initialRisk: p.initialRisk,
          shares: p.shares,
          daysHeld,
          rMultiple,
          atr,
          currency: p.stock.currency || 'USD',
          protectionLevel: p.protectionLevel,
          adxToday,
          adxYesterday,
          ma20,
          currentNCS,
          relativeStrength,
          plusDI,
          minusDI,
          volume,
          avgVolume20,
          priceAboveMa20Pct,
          aGradeCandidatesWaiting: aGradeCount,
          atrPct,
        };
      })
    );

    // ── Phase 4: Run exit intelligence ──
    const results = evaluateAllPositions(enrichedPositions);

    const needsAttention = results.filter(
      (r) => r.action !== 'HOLD' && r.action !== 'HOLD_AND_TRAIL' && r.action !== 'DO_NOT_TOUCH'
    ).length;

    return NextResponse.json({
      ok: true,
      data: {
        results,
        summary: {
          total: results.length,
          needsAttention,
          aGradeWaiting: aGradeCount,
        },
      },
    });
  } catch (error) {
    console.error('[ExitIntelligence] Unexpected error:', error);
    return apiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error');
  }
}
