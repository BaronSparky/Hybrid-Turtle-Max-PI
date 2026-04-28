/**
 * DEPENDENCIES
 * Consumed by: PerformanceTab.tsx (equity chart benchmark overlay)
 * Consumes: market-data.ts (getDailyPrices)
 * Risk-sensitive: NO (display only)
 * Notes: Returns SPY daily close indexed to 100 at the start date,
 *        aligned to the equity snapshot date range.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDailyPrices } from '@/lib/market-data';

export async function GET(request: NextRequest) {
  try {
    const days = parseInt(request.nextUrl.searchParams.get('days') || '90', 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().split('T')[0];

    const bars = await getDailyPrices('SPY', 'full');
    if (!bars || bars.length === 0) {
      return NextResponse.json({ data: [], error: 'No SPY data available' });
    }

    // bars are newest-first from Yahoo — reverse to chronological
    const chronological = [...bars].reverse();

    // Filter to date range
    const filtered = chronological.filter(b => b.date >= sinceStr);
    if (filtered.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Normalise: first day = 100, subsequent = (close / firstClose) * 100
    const firstClose = filtered[0].close;
    const data = filtered.map(b => ({
      date: b.date,
      close: Math.round(b.close * 100) / 100,
      indexed: Math.round((b.close / firstClose) * 10000) / 100, // indexed to 100
      returnPct: Math.round(((b.close - firstClose) / firstClose) * 10000) / 100,
    }));

    const last = data[data.length - 1];
    return NextResponse.json({
      data,
      summary: {
        ticker: 'SPY',
        startDate: data[0].date,
        endDate: last.date,
        startPrice: data[0].close,
        endPrice: last.close,
        returnPct: last.returnPct,
        points: data.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { data: [], error: (error as Error).message },
      { status: 500 }
    );
  }
}
