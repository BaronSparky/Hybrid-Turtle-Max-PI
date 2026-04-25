export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';

const stockPayloadSchema = z.object({
  ticker: z.string().trim().min(1),
  name: z.string().optional(),
  sleeve: z.enum(['CORE', 'ETF', 'HIGH_RISK', 'HEDGE']).optional(),
  sector: z.string().optional().nullable(),
  cluster: z.string().optional().nullable(),
  superCluster: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  t212Ticker: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

const bulkStocksSchema = z.object({
  stocks: z.array(stockPayloadSchema).min(1),
});

// GET /api/stocks — List all stocks. Optional filters: ?sleeve=CORE&active=true&search=AAPL
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sleeve = searchParams.get('sleeve');
    const active = searchParams.get('active');
    const search = searchParams.get('search');
    const cluster = searchParams.get('cluster');
    const superCluster = searchParams.get('superCluster');
    const region = searchParams.get('region');

    const where: Record<string, unknown> = {};

    if (sleeve) where.sleeve = sleeve;
    if (active !== null && active !== undefined && active !== '') {
      where.active = active === 'true';
    }
    if (cluster) where.cluster = cluster;
    if (superCluster) where.superCluster = superCluster;
    if (region) where.region = region;
    if (search) {
      where.OR = [
        { ticker: { contains: search } },
        { name: { contains: search } },
        { sector: { contains: search } },
      ];
    }

    const stocks = await prisma.stock.findMany({
      where,
      orderBy: [{ sleeve: 'asc' }, { sector: 'asc' }, { ticker: 'asc' }],
    });

    // Build summary stats
    const summary = {
      total: stocks.length,
      core: stocks.filter((s) => s.sleeve === 'CORE').length,
      etf: stocks.filter((s) => s.sleeve === 'ETF').length,
      highRisk: stocks.filter((s) => s.sleeve === 'HIGH_RISK').length,
      hedge: stocks.filter((s) => s.sleeve === 'HEDGE').length,
    };

    // Stock list changes infrequently — cache for 5 minutes, serve stale for 1 min while revalidating
    return NextResponse.json({ stocks, summary }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('GET /api/stocks error:', error);
    return apiError(500, 'STOCKS_FETCH_FAILED', 'Failed to fetch stocks', (error as Error).message, true);
  }
}

// POST /api/stocks — Add a new stock or bulk-add
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object') {
      return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    // Bulk add: { stocks: [...] }
    if (Array.isArray((rawBody as { stocks?: unknown[] }).stocks)) {
      const bulkParsed = bulkStocksSchema.safeParse(rawBody);
      if (!bulkParsed.success) {
        return apiError(400, 'INVALID_REQUEST', 'Invalid bulk stock payload', bulkParsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
      }

      const body = bulkParsed.data;
      const results = await prisma.$transaction(
        body.stocks.map((stock) =>
          prisma.stock.upsert({
            where: { ticker: stock.ticker },
            update: {
              name: stock.name || stock.ticker,
              sleeve: stock.sleeve || 'CORE',
              sector: stock.sector || null,
              cluster: stock.cluster || null,
              superCluster: stock.superCluster || null,
              region: stock.region || null,
              currency: stock.currency || null,
              t212Ticker: stock.t212Ticker || null,
              active: stock.active !== undefined ? stock.active : true,
            },
            create: {
              ticker: stock.ticker,
              name: stock.name || stock.ticker,
              sleeve: stock.sleeve || 'CORE',
              sector: stock.sector || null,
              cluster: stock.cluster || null,
              superCluster: stock.superCluster || null,
              region: stock.region || null,
              currency: stock.currency || null,
              t212Ticker: stock.t212Ticker || null,
              active: stock.active !== undefined ? stock.active : true,
            },
          })
        )
      );
      return NextResponse.json({
        message: `Upserted ${results.length} stocks`,
        count: results.length,
      });
    }

    // Single add
    const singleParsed = stockPayloadSchema.safeParse(rawBody);
    if (!singleParsed.success) {
      return apiError(400, 'INVALID_REQUEST', 'Invalid stock payload', singleParsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    }
    const body = singleParsed.data;

    const stock = await prisma.stock.upsert({
      where: { ticker: body.ticker },
      update: {
        name: body.name || body.ticker,
        sleeve: body.sleeve || 'CORE',
        sector: body.sector || null,
        cluster: body.cluster || null,
        superCluster: body.superCluster || null,
        region: body.region || null,
        currency: body.currency || null,
        t212Ticker: body.t212Ticker || null,
        active: body.active !== undefined ? body.active : true,
      },
      create: {
        ticker: body.ticker,
        name: body.name || body.ticker,
        sleeve: body.sleeve || 'CORE',
        sector: body.sector || null,
        cluster: body.cluster || null,
        superCluster: body.superCluster || null,
        region: body.region || null,
        currency: body.currency || null,
        t212Ticker: body.t212Ticker || null,
        active: body.active !== undefined ? body.active : true,
      },
    });

    return NextResponse.json({ stock });
  } catch (error) {
    console.error('POST /api/stocks error:', error);
    return apiError(500, 'STOCK_ADD_FAILED', 'Failed to add stock', (error as Error).message, true);
  }
}

// DELETE /api/stocks?ticker=AAPL — Remove a stock (soft-delete by setting active=false)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const hard = searchParams.get('hard') === 'true';

    if (!ticker) {
      return apiError(400, 'INVALID_REQUEST', 'ticker is required');
    }

    if (hard) {
      return apiError(400, 'HARD_DELETE_DISABLED', 'Hard delete is disabled for stocks. Use soft delete.');
    }

    await prisma.stock.update({
      where: { ticker },
      data: { active: false },
    });

    return NextResponse.json({ message: `${ticker} deactivated` });
  } catch (error) {
    console.error('DELETE /api/stocks error:', error);
    return apiError(500, 'STOCK_DELETE_FAILED', 'Failed to delete stock', (error as Error).message, true);
  }
}
