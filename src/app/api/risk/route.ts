import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { normalizeBatchPricesToGBP, normalizePriceToGBP } from '@/lib/market-data';
import { getLivePrices } from '@/lib/live-prices';
import { calculateRMultiple } from '@/lib/position-sizer';
import { buildInitialRiskFields, computeOpenRiskGBP } from '@/lib/risk-fields';
import { getRiskBudget } from '@/lib/risk-gates';
import { getWeeklyEquityChangePercent } from '@/lib/equity-snapshot';
import type { RiskProfileType, Sleeve } from '@/types';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { equity: true, riskProfile: true },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
      orderBy: { updatedAt: 'desc' },
    });

    const tickers = positions.map((p) => p.stock.ticker);
    const { prices: livePrices } = await getLivePrices(tickers, userId);
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = tickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};

    const enriched = await Promise.all(positions.map(async (p) => {
      const currentPriceRaw = livePrices[p.stock.ticker] || p.entryPrice;
      const currentPriceGbp = gbpPrices[p.stock.ticker]
        ?? await normalizePriceToGBP(currentPriceRaw, p.stock.ticker, p.stock.currency);
      const entryPriceGbp = await normalizePriceToGBP(p.entryPrice, p.stock.ticker, p.stock.currency);
      const currentStopGbp = await normalizePriceToGBP(p.currentStop, p.stock.ticker, p.stock.currency);
      const fxRatio = currentPriceRaw > 0 ? currentPriceGbp / currentPriceRaw : 1;
      const rMultiple = calculateRMultiple(currentPriceRaw, p.entryPrice, p.initialRisk);
      const initialStop = p.entryPrice - p.initialRisk;
      const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
      const priceCurrency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
      const { initialRiskGBP } = buildInitialRiskFields(entryPriceGbp, currentStopGbp, p.shares);
      const openRiskGBP = computeOpenRiskGBP(currentPriceGbp, currentStopGbp, p.shares);

      return {
        id: p.id,
        ticker: p.stock.ticker,
        sleeve: p.stock.sleeve as Sleeve,
        sector: p.stock.sector || 'Unassigned',
        cluster: p.stock.cluster || 'Unassigned',
        entryPrice: p.entryPrice,
        currentPrice: currentPriceRaw,
        currentStop: p.currentStop,
        initialStop,
        shares: p.shares,
        rMultiple,
        protectionLevel: p.protectionLevel,
        fxRatio,
        entryPriceGbp,
        currentPriceGbp,
        currentStopGbp,
        value: currentPriceGbp * p.shares,
        initialRiskGBP,
        // Explicit open risk (current → stop)
        openRiskGBP,
        openRiskDollars: openRiskGBP,
        // @deprecated Use openRiskGBP/openRiskDollars instead.
        riskDollars: openRiskGBP,
        priceCurrency,
      };
    }));

    const budget = getRiskBudget(
      enriched,
      user.equity,
      user.riskProfile as RiskProfileType
    );

    // Equity snapshots are recorded by nightly automation (rate-limited to 6h).
    // Removed from GET endpoint to avoid unnecessary DB queries on every page load/poll.
    const efficiencyData = await getWeeklyEquityChangePercent(userId);
    const maxOpenRiskUsedPercent = efficiencyData.maxOpenRiskUsedPercent ?? budget.usedRiskPercent;
    const riskEfficiency = efficiencyData.weeklyChangePercent != null && maxOpenRiskUsedPercent > 0
      ? efficiencyData.weeklyChangePercent / maxOpenRiskUsedPercent
      : null;

    return NextResponse.json({
      riskProfile: user.riskProfile,
      equity: user.equity,
      budget,
      riskEfficiency,
      weeklyEquityChangePercent: efficiencyData.weeklyChangePercent,
      maxOpenRiskUsedPercent,
      positions: enriched,
    });
  } catch (error) {
    console.error('Risk summary error:', error);
    return apiError(500, 'RISK_SUMMARY_FAILED', 'Failed to fetch risk summary', (error as Error).message, true);
  }
}
