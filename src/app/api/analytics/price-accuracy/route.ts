/**
 * DEPENDENCIES
 * Consumed by: PriceAccuracyTile (dashboard), weekly digest
 * Consumes: prisma.ts (PriceSnapshot model)
 * Risk-sensitive: NO — read-only analytics
 * Notes: Aggregates T212 vs Yahoo price accuracy from PriceSnapshot table.
 *        Returns per-ticker and overall accuracy stats for a configurable window.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const days = Math.min(parseInt(searchParams.get('days') ?? '7', 10), 30);
    const cutoff = new Date(Date.now() - days * 86400_000);

    const snapshots = await prisma.priceSnapshot.findMany({
      where: { capturedAt: { gte: cutoff } },
      orderBy: { capturedAt: 'desc' },
      select: {
        ticker: true,
        t212Price: true,
        yahooPrice: true,
        diffPercent: true,
        capturedAt: true,
      },
    });

    if (snapshots.length === 0) {
      return NextResponse.json({
        days,
        totalSnapshots: 0,
        overall: null,
        perTicker: [],
        recentSamples: [],
      });
    }

    // Overall stats
    const withDiff = snapshots.filter(s => s.diffPercent != null);
    const avgDiff = withDiff.length > 0
      ? withDiff.reduce((sum, s) => sum + (s.diffPercent ?? 0), 0) / withDiff.length
      : 0;
    const maxDiff = withDiff.length > 0
      ? Math.max(...withDiff.map(s => s.diffPercent ?? 0))
      : 0;
    const mismatchCount = withDiff.filter(s => (s.diffPercent ?? 0) > 1).length;

    // Per-ticker breakdown
    const tickerMap = new Map<string, { diffs: number[]; count: number }>();
    for (const s of withDiff) {
      const entry = tickerMap.get(s.ticker) ?? { diffs: [], count: 0 };
      entry.diffs.push(s.diffPercent ?? 0);
      entry.count++;
      tickerMap.set(s.ticker, entry);
    }

    const perTicker = [...tickerMap.entries()].map(([ticker, data]) => ({
      ticker,
      snapshots: data.count,
      avgDiffPercent: Math.round(data.diffs.reduce((a, b) => a + b, 0) / data.diffs.length * 100) / 100,
      maxDiffPercent: Math.round(Math.max(...data.diffs) * 100) / 100,
      mismatchCount: data.diffs.filter(d => d > 1).length,
    })).sort((a, b) => b.avgDiffPercent - a.avgDiffPercent);

    // Recent samples (last 20 for timeline view)
    const recentSamples = snapshots.slice(0, 20).map(s => ({
      ticker: s.ticker,
      t212Price: s.t212Price,
      yahooPrice: s.yahooPrice,
      diffPercent: s.diffPercent,
      capturedAt: s.capturedAt.toISOString(),
    }));

    return NextResponse.json({
      days,
      totalSnapshots: snapshots.length,
      overall: {
        avgDiffPercent: Math.round(avgDiff * 100) / 100,
        maxDiffPercent: Math.round(maxDiff * 100) / 100,
        mismatchCount,
        mismatchRate: withDiff.length > 0
          ? Math.round(mismatchCount / withDiff.length * 10000) / 100
          : 0,
      },
      perTicker,
      recentSamples,
    });
  } catch (error) {
    console.error('[price-accuracy] Error:', error);
    return apiError(500, 'PRICE_ACCURACY_FAILED', (error as Error).message);
  }
}
