import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';
import { parseJsonBody } from '@/lib/request-validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    let userId = searchParams.get('userId');
    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const ticker = searchParams.get('ticker')?.trim();
    const decision = searchParams.get('decision')?.trim();
    const tradeType = searchParams.get('tradeType')?.trim();
    const regime = searchParams.get('regime')?.trim();
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'));
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 200), 1), 500);

    const logs = await prisma.tradeLog.findMany({
      where: {
        userId,
        ...(ticker ? { ticker: { contains: ticker } } : {}),
        ...(decision ? { decision } : {}),
        ...(tradeType ? { tradeType } : {}),
        ...(regime ? { regime } : {}),
        ...(from || to
          ? {
              tradeDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { tradeDate: 'desc' },
      take: limit,
    });

    // Trade log is append-only — cache for 2 minutes, serve stale for 1 min while revalidating
    return NextResponse.json({
      logs,
      count: logs.length,
    }, {
      headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('Trade log list error:', error);
    return apiError(500, 'TRADE_LOG_FETCH_FAILED', 'Failed to fetch trade logs', (error as Error).message, true);
  }
}

// ── POST — Record a past trade (manual entry) ───────────────────────

const recordPastTradeSchema = z.object({
  ticker: z.string().trim().min(1).max(20),
  tradeDate: z.string().min(1),
  tradeType: z.enum(['ENTRY', 'EXIT', 'STOP_HIT', 'ADD', 'TRIM']),
  decision: z.enum(['TAKEN', 'SKIPPED', 'PARTIAL']).default('TAKEN'),
  entryPrice: z.coerce.number().positive().optional(),
  exitPrice: z.coerce.number().positive().optional(),
  shares: z.coerce.number().positive().optional(),
  initialStop: z.coerce.number().positive().optional(),
  exitReason: z.string().optional(),
  gainLossGbp: z.coerce.number().optional(),
  daysHeld: z.coerce.number().int().min(0).optional(),
  decisionReason: z.string().max(500).optional(),
  whatWentWell: z.string().max(1000).optional(),
  whatWentWrong: z.string().max(1000).optional(),
  lessonsLearned: z.string().max(1000).optional(),
  tags: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, recordPastTradeSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const data = parsed.data;
    const userId = await ensureDefaultUser();

    // Parse and validate trade date
    const tradeDate = new Date(data.tradeDate);
    if (Number.isNaN(tradeDate.getTime())) {
      return apiError(400, 'INVALID_DATE', 'Invalid trade date');
    }

    // Compute R-multiple if we have entry, exit, and initial stop
    let finalRMultiple: number | null = null;
    let initialR: number | null = null;
    if (data.entryPrice && data.initialStop) {
      initialR = Math.abs(data.entryPrice - data.initialStop);
      if (initialR > 0 && data.exitPrice) {
        finalRMultiple = (data.exitPrice - data.entryPrice) / initialR;
      }
    }

    // Compute days held if entry + exit date available
    const daysHeld = data.daysHeld ?? null;

    const log = await prisma.tradeLog.create({
      data: {
        userId,
        ticker: data.ticker.toUpperCase(),
        tradeDate,
        tradeType: data.tradeType,
        decision: data.decision,
        entryPrice: data.entryPrice ?? null,
        exitPrice: data.exitPrice ?? null,
        initialStop: data.initialStop ?? null,
        initialR,
        shares: data.shares ?? null,
        exitReason: data.exitReason ?? null,
        finalRMultiple,
        gainLossGbp: data.gainLossGbp ?? null,
        daysHeld,
        decisionReason: data.decisionReason ?? null,
        whatWentWell: data.whatWentWell ?? null,
        whatWentWrong: data.whatWentWrong ?? null,
        lessonsLearned: data.lessonsLearned ?? null,
        tags: data.tags ?? null,
      },
    });

    return NextResponse.json({ ok: true, log }, { status: 201 });
  } catch (error) {
    console.error('Record past trade error:', error);
    return apiError(500, 'TRADE_LOG_CREATE_FAILED', 'Failed to record trade', (error as Error).message, true);
  }
}
