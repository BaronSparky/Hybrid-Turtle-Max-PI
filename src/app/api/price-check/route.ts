/**
 * DEPENDENCIES
 * Consumed by: Manual diagnostic (hit /api/price-check?ticker=GEV)
 * Consumes: live-prices.ts, position-sync.ts, market-data.ts
 * Risk-sensitive: NO — read-only diagnostic
 * Notes: Compare T212 vs Yahoo prices side-by-side for a given ticker.
 *        Use to verify the T212-primary pipeline is working correctly.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getLivePrices } from '@/lib/live-prices';
import { getT212Prices, getT212ApiStats } from '@/lib/position-sync';
import { getStockQuote, getDataFreshness } from '@/lib/market-data';
import { apiError } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker');

  if (!ticker) {
    // No ticker — return overall pipeline status
    const stats = getT212ApiStats();
    const freshness = getDataFreshness();

    return NextResponse.json({
      t212: {
        cacheSize: stats.cacheSize,
        cacheAgeSeconds: stats.cacheAge,
        callsLastHour: stats.callsLastHour,
        lastCallAt: stats.lastCallAt ? new Date(stats.lastCallAt).toISOString() : null,
      },
      yahoo: {
        source: freshness.source,
        ageMinutes: freshness.ageMinutes,
        lastFetchTime: freshness.lastFetchTimestamp > 0
          ? new Date(freshness.lastFetchTimestamp).toISOString()
          : null,
      },
      checkedAt: new Date().toISOString(),
    });
  }

  try {
    // Fetch from both sources
    const [liveResult, yahooQuote] = await Promise.all([
      getLivePrices([ticker], 'default-user', true), // force-refresh Yahoo
      getStockQuote(ticker, true), // force-refresh individual quote
    ]);

    const t212Entry = getT212Prices([ticker])[ticker] ?? null;

    return NextResponse.json({
      ticker,
      // What getLivePrices returns (the merged result)
      merged: {
        price: liveResult.prices[ticker] ?? null,
        source: liveResult.sources[ticker] ?? null,
      },
      // Raw T212 cache entry
      t212: t212Entry ? {
        price: t212Entry.price,
        ageSeconds: Math.round((Date.now() - t212Entry.updatedAt) / 1000),
        updatedAt: new Date(t212Entry.updatedAt).toISOString(),
      } : null,
      // Raw Yahoo quote
      yahoo: yahooQuote ? {
        price: yahooQuote.price,
        change: yahooQuote.change,
        changePercent: yahooQuote.changePercent,
      } : null,
      // Discrepancy
      discrepancy: t212Entry && yahooQuote ? {
        diffAbsolute: Math.round((t212Entry.price - yahooQuote.price) * 100) / 100,
        diffPercent: Math.round(Math.abs(t212Entry.price - yahooQuote.price) / yahooQuote.price * 10000) / 100,
      } : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(500, 'PRICE_CHECK_FAILED', (error as Error).message);
  }
}
