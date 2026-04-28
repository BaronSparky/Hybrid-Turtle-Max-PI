/**
 * Equity curve API — returns equity snapshots for chart display.
 * Consumed by the EquityCurveChart dashboard component.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId') || await ensureDefaultUser();
    const days = parseInt(request.nextUrl.searchParams.get('days') || '90', 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await prisma.equitySnapshot.findMany({
      where: { userId, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
      select: { equity: true, openRiskPercent: true, capturedAt: true },
    });

    // Compute drawdown from peak
    let peak = 0;
    const data = snapshots.map(s => {
      if (s.equity > peak) peak = s.equity;
      const drawdownPct = peak > 0 ? ((peak - s.equity) / peak) * 100 : 0;
      return {
        date: s.capturedAt.toISOString().split('T')[0],
        equity: Math.round(s.equity * 100) / 100,
        openRiskPct: s.openRiskPercent !== null ? Math.round(s.openRiskPercent * 10) / 10 : null,
        drawdownPct: Math.round(drawdownPct * 10) / 10,
      };
    });

    // Summary stats
    const first = data[0]?.equity ?? 0;
    const last = data[data.length - 1]?.equity ?? 0;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : 0;
    const maxDrawdown = data.length > 0 ? Math.max(...data.map(d => d.drawdownPct)) : 0;

    return NextResponse.json({
      data,
      summary: {
        startEquity: first,
        currentEquity: last,
        change: Math.round(change * 100) / 100,
        changePct: Math.round(changePct * 10) / 10,
        maxDrawdownPct: Math.round(maxDrawdown * 10) / 10,
        snapshotCount: data.length,
        days,
      },
    });
  } catch (error) {
    console.error('Equity curve error:', error);
    return NextResponse.json({ data: [], summary: null, error: (error as Error).message }, { status: 500 });
  }
}
