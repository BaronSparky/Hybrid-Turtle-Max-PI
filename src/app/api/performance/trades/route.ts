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

    return NextResponse.json({
      trades: data,
      summary: {
        total: data.length,
        wins: wins.length,
        losses: losses.length,
        winRate: data.length > 0 ? (wins.length / data.length) * 100 : 0,
        avgR: data.length > 0 ? data.reduce((s, t) => s + t.rMultiple, 0) / data.length : 0,
        totalR: data.reduce((s, t) => s + t.rMultiple, 0),
      },
    });
  } catch (error) {
    return NextResponse.json({ trades: [], summary: null, error: (error as Error).message }, { status: 500 });
  }
}
