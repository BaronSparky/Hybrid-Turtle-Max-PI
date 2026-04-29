import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { normalizeBatchPricesToGBP } from '@/lib/market-data';
import { calculateGainDollars, calculateGainPercent } from '@/lib/position-sizer';
import { apiError } from '@/lib/api-response';
import { getLivePrices } from '@/lib/live-prices';

export const dynamic = 'force-dynamic';

interface DistributionItem {
  name: string;
  value: number;
  color?: string;
}

function buildDistribution(items: Array<{ key: string; value: number }>, maxItems = 6): DistributionItem[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, maxItems);
  const tail = sorted.slice(maxItems);
  const result = head.map((item) => ({ name: item.key, value: item.value }));

  if (tail.length > 0) {
    const otherValue = tail.reduce((sum, item) => sum + item.value, 0);
    result.push({ name: 'Other', value: otherValue });
  }

  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        equity: true,
        t212Cash: true,
        t212Invested: true,
        t212UnrealisedPL: true,
        t212TotalValue: true,
        t212Currency: true,
      },
    });

    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    const forceRefresh = searchParams.get('refresh') === 'true';
    const tickers = positions.map((p) => p.stock.ticker);

    const { prices: livePrices } = await getLivePrices(tickers, userId, forceRefresh);

    // Build currency map from stock records
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }

    // Normalize all prices to GBP for portfolio value calculations
    const gbpPrices = tickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};

    const enriched = positions.map((p) => {
      const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;

      // Gain % — same regardless of currency, use raw prices
      const gainPercent = calculateGainPercent(rawPrice, p.entryPrice);

      // Value & P&L — in GBP
      const value = gbpPrice * p.shares;

      // Entry value also in GBP for P&L
      let entryPriceGBP = p.entryPrice;
      if (p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker)) {
        entryPriceGBP = p.entryPrice / 100;
      } else {
        const currency = (p.stock.currency || 'USD').toUpperCase();
        if (currency !== 'GBP') {
          // Approximate: use same FX ratio as current price
          const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
          entryPriceGBP = p.entryPrice * fxRatio;
        }
      }
      const investedGBP = entryPriceGBP * p.shares;
      const gainGBP = value - investedGBP;

      return {
        id: p.id,
        ticker: p.stock.ticker,
        sleeve: p.stock.sleeve,
        cluster: p.stock.cluster || 'Unassigned',
        sector: p.stock.sector || 'Unassigned',
        protectionLevel: p.protectionLevel,
        currentPrice: gbpPrice,
        entryPrice: entryPriceGBP,
        shares: p.shares,
        gainPercent,
        gainDollars: gainGBP,
        value,
      };
    });

    const computedTotalValue = enriched.reduce((sum, p) => sum + p.value, 0);
    const computedPL = enriched.reduce((sum, p) => sum + p.gainDollars, 0);
    const computedInvested = enriched.reduce((sum, p) => sum + p.entryPrice * p.shares, 0);
    const equityValue = user?.equity ?? 0;

    // Use T212 account values as source of truth when available (already GBP-converted by T212)
    const totalValue = user?.t212TotalValue ?? computedTotalValue;
    const unrealisedPL = user?.t212UnrealisedPL ?? computedPL;
    const invested = user?.t212Invested ?? computedInvested;
    const availableCash = user?.t212Cash ?? Math.max(0, equityValue - computedInvested);

    const sleeveMap = new Map<string, number>();
    const clusterMap = new Map<string, number>();
    const levelMap = new Map<string, number>();

    for (const p of enriched) {
      const sleeveLabel =
        p.sleeve === 'CORE'
          ? 'Core Stocks'
          : p.sleeve === 'ETF'
          ? 'Core ETFs'
          : p.sleeve === 'HEDGE'
          ? 'Hedge'
          : 'High-Risk';
      sleeveMap.set(sleeveLabel, (sleeveMap.get(sleeveLabel) || 0) + p.value);

      // Use sector as fallback when cluster is missing
      const clusterLabel = p.cluster && p.cluster !== 'Unassigned'
        ? p.cluster
        : p.sector && p.sector !== 'Unassigned'
        ? p.sector
        : 'Uncategorised';
      clusterMap.set(clusterLabel, (clusterMap.get(clusterLabel) || 0) + p.value);
      levelMap.set(p.protectionLevel, (levelMap.get(p.protectionLevel) || 0) + 1);
    }

    const sleeveDistribution = buildDistribution(
      Array.from(sleeveMap.entries()).map(([key, value]) => ({ key, value }))
    );

    const clusterDistribution = buildDistribution(
      Array.from(clusterMap.entries()).map(([key, value]) => ({ key, value }))
    );

    const protectionDistribution = buildDistribution(
      Array.from(levelMap.entries()).map(([key, value]) => ({ key, value })),
      4
    );

    return NextResponse.json({
      kpis: {
        totalValue,
        unrealisedPL,
        invested,
        cash: availableCash,
        equity: equityValue,
        currency: user?.t212Currency ?? 'GBP',
        openPositions: enriched.length,
        accountTotalValue: user?.t212TotalValue ?? null,
      },
      distributions: {
        sleeves: sleeveDistribution,
        clusters: clusterDistribution,
        protectionLevels: protectionDistribution,
      },
      positions: enriched,
      performance: [],
    });
  } catch (error) {
    console.error('Portfolio summary error:', error);
    return apiError(500, 'PORTFOLIO_SUMMARY_FAILED', 'Failed to fetch portfolio summary', (error as Error).message, true);
  }
}
