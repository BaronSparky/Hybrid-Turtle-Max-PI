/**
 * Regime history API — returns daily regime transitions for visualization.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const days = parseInt(request.nextUrl.searchParams.get('days') || '90', 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const history = await prisma.regimeHistory.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        regime: true,
        spyPrice: true,
        spyMa200: true,
        adx: true,
        consecutive: true,
      },
    });

    const data = history.map(h => ({
      date: h.date.toISOString().split('T')[0],
      regime: h.regime,
      spyPrice: h.spyPrice,
      spyMa200: h.spyMa200,
      adx: h.adx,
      consecutive: h.consecutive,
    }));

    // Regime distribution
    const distribution: Record<string, number> = {};
    for (const h of data) {
      distribution[h.regime] = (distribution[h.regime] || 0) + 1;
    }

    return NextResponse.json({
      data,
      distribution,
      days,
      total: data.length,
    });
  } catch (error) {
    return NextResponse.json({ data: [], error: (error as Error).message }, { status: 500 });
  }
}
