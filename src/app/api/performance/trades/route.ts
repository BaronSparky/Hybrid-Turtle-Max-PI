/**
 * Closed trades API — returns trade history for R-multiple visualization.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId') || await ensureDefaultUser();
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);

    const trades = await prisma.position.findMany({
      where: { userId, status: 'CLOSED', realisedPnlR: { not: null } },
      orderBy: { exitDate: 'desc' },
      take: limit,
      select: {
        id: true,
        entryPrice: true,
        exitPrice: true,
        entryDate: true,
        exitDate: true,
        realisedPnlR: true,
        realisedPnl: true,
        shares: true,
        protectionLevel: true,
        stock: { select: { ticker: true, sleeve: true } },
      },
    });

    const data = trades.reverse().map(t => ({
      ticker: t.stock.ticker,
      sleeve: t.stock.sleeve,
      entryDate: t.entryDate.toISOString().split('T')[0],
      exitDate: t.exitDate?.toISOString().split('T')[0] ?? null,
      rMultiple: t.realisedPnlR ?? 0,
      pnl: t.realisedPnl ?? 0,
      holdDays: t.exitDate && t.entryDate
        ? Math.round((t.exitDate.getTime() - t.entryDate.getTime()) / (24 * 60 * 60 * 1000))
        : null,
      protectionLevel: t.protectionLevel,
    }));

    const wins = data.filter(t => t.rMultiple > 0);
    const losses = data.filter(t => t.rMultiple <= 0);

    // R-distribution buckets
    const buckets = [
      { label: '< -1R', min: -Infinity, max: -1, count: 0 },
      { label: '-1 to 0R', min: -1, max: 0, count: 0 },
      { label: '0 to 1R', min: 0, max: 1, count: 0 },
      { label: '1 to 2R', min: 1, max: 2, count: 0 },
      { label: '2 to 3R', min: 2, max: 3, count: 0 },
      { label: '3R+', min: 3, max: Infinity, count: 0 },
    ];
    for (const t of data) {
      const bucket = buckets.find(b => t.rMultiple >= b.min && t.rMultiple < b.max);
      if (bucket) bucket.count++;
    }

    return NextResponse.json({
      trades: data,
      summary: {
        total: data.length,
        wins: wins.length,
        losses: losses.length,
        winRate: data.length > 0 ? (wins.length / data.length) * 100 : 0,
        avgR: data.length > 0 ? data.reduce((s, t) => s + t.rMultiple, 0) / data.length : 0,
        totalR: data.reduce((s, t) => s + t.rMultiple, 0),
        distribution: buckets.map(b => ({ label: b.label, count: b.count })),
      },
    });
  } catch (error) {
    return NextResponse.json({ trades: [], summary: null, error: (error as Error).message }, { status: 500 });
  }
}
