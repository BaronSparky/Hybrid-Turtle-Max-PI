/**
 * Trade export API — returns closed trades as CSV or JSON.
 * Usage: GET /api/performance/export?format=csv
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId') || await ensureDefaultUser();
    const format = request.nextUrl.searchParams.get('format') || 'json';

    const trades = await prisma.position.findMany({
      where: { userId, status: 'CLOSED' },
      orderBy: { exitDate: 'desc' },
      include: { stock: { select: { ticker: true, name: true, sleeve: true } } },
    });

    const rows = trades.map(t => ({
      ticker: t.stock.ticker,
      name: t.stock.name,
      sleeve: t.stock.sleeve,
      entryDate: t.entryDate.toISOString().split('T')[0],
      exitDate: t.exitDate?.toISOString().split('T')[0] ?? '',
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice ?? '',
      shares: t.shares,
      initialRisk: t.initialRisk,
      realisedPnl: t.realisedPnl ?? '',
      realisedPnlR: t.realisedPnlR ?? '',
      protectionLevel: t.protectionLevel ?? '',
      holdDays: t.exitDate && t.entryDate
        ? Math.round((t.exitDate.getTime() - t.entryDate.getTime()) / (24 * 60 * 60 * 1000))
        : '',
    }));

    if (format === 'csv') {
      const headers = Object.keys(rows[0] || {});
      const csvLines = [
        headers.join(','),
        ...rows.map(r => headers.map(h => {
          const val = (r as Record<string, unknown>)[h];
          return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val ?? '');
        }).join(',')),
      ];
      return new Response(csvLines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="hybridturtle-trades-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({ trades: rows, count: rows.length });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
