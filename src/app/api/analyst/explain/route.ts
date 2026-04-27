/**
 * DEPENDENCIES
 * Consumed by: AnalystExplainButton.tsx, scan page, positions page
 * Consumes: analyst-service.ts, prisma.ts (read-only queries)
 * Risk-sensitive: NO — read-only explanations, no trade execution, no stop modification
 * Notes: Accepts a ticker + type (candidate|stop) and returns a plain-English explanation.
 *        Reads scan results and position data from DB — NEVER writes.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateCandidateExplanation, generateStopExplanation } from '@/lib/analyst/analyst-service';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import type { CandidateExplainData, StopExplainData } from '@/lib/analyst/prompt-builder';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ticker, positionId, model } = body as {
      type: 'candidate' | 'stop';
      ticker?: string;
      positionId?: string;
      model?: string;
    };

    if (!type || !['candidate', 'stop'].includes(type)) {
      return apiError(400, 'INVALID_TYPE', 'type must be "candidate" or "stop"');
    }

    const userId = await ensureDefaultUser();

    if (type === 'candidate') {
      return handleCandidateExplain(ticker, userId, model);
    } else {
      return handleStopExplain(ticker, positionId, userId, model);
    }
  } catch (error) {
    console.error('[Analyst Explain] Error:', error);
    return apiError(
      500,
      'ANALYST_EXPLAIN_FAILED',
      'Failed to generate explanation',
      (error as Error).message
    );
  }
}

async function handleCandidateExplain(
  ticker: string | undefined,
  userId: string,
  preferredModel?: string
) {
  if (!ticker) {
    return apiError(400, 'MISSING_TICKER', 'ticker is required for candidate explanations');
  }

  // Find the stock by ticker first
  const stock = await prisma.stock.findFirst({ where: { ticker } });
  if (!stock) {
    return apiError(404, 'NO_STOCK', `No stock found for ${ticker}`);
  }

  // Get the latest scan result for this stock (via scan → scanResult)
  const scanRow = await prisma.scanResult.findFirst({
    where: { stockId: stock.id, scan: { userId } },
    orderBy: { scan: { runDate: 'desc' } },
    include: { stock: true },
  });

  if (!scanRow) {
    return apiError(404, 'NO_SCAN_DATA', `No scan data found for ${ticker}`);
  }

  const data: CandidateExplainData = {
    ticker: scanRow.stock.ticker,
    name: scanRow.stock.name,
    status: scanRow.status,
    price: scanRow.price,
    entryTrigger: scanRow.entryTrigger,
    distancePercent: scanRow.distancePercent,
    sleeve: scanRow.stock.sleeve || 'CORE',
    sector: scanRow.stock.sector || 'Unknown',
    cluster: scanRow.stock.cluster || 'Unknown',
    adx: scanRow.adx,
    atrPercent: scanRow.atrPercent,
    efficiency: scanRow.efficiency,
    ma200: scanRow.ma200,
    riskPerShare: scanRow.riskDollars ?? 0,
    positionSize: scanRow.shares ?? 0,
    grade: scanRow.grade ?? undefined,
    stage6Reason: scanRow.stage6Reason ?? undefined,
    entryMode: scanRow.entryMode ?? undefined,
  };

  const result = await generateCandidateExplanation(data, preferredModel);

  return NextResponse.json({
    ...result,
    ticker,
    type: 'candidate',
    dataTimestamp: new Date().toISOString(),
  });
}

async function handleStopExplain(
  ticker: string | undefined,
  positionId: string | undefined,
  userId: string,
  preferredModel?: string
) {
  if (!positionId && !ticker) {
    return apiError(400, 'MISSING_ID', 'ticker or positionId is required for stop explanations');
  }

  // Find position by ID or by stock ticker
  let position;
  if (positionId) {
    position = await prisma.position.findFirst({
      where: { id: positionId, userId },
      include: { stock: true, stopHistory: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
  } else if (ticker) {
    const stock = await prisma.stock.findFirst({ where: { ticker } });
    if (stock) {
      position = await prisma.position.findFirst({
        where: { stockId: stock.id, userId, status: 'OPEN' },
        include: { stock: true, stopHistory: { orderBy: { createdAt: 'desc' }, take: 10 } },
      });
    }
  }

  if (!position) {
    return apiError(404, 'NO_POSITION', `No position found for ${ticker || positionId}`);
  }

  const initialRisk = position.initialRisk || (position.entryPrice - position.stopLoss);
  const rMultiple = 0; // Live price not in DB; R-multiple requires market data

  const data: StopExplainData = {
    ticker: position.stock.ticker,
    entryPrice: position.entryPrice,
    currentPrice: position.entryPrice, // Fallback; live price not stored on position
    currentStop: position.currentStop,
    initialRisk,
    protectionLevel: position.protectionLevel || 'INITIAL',
    rMultiple,
    atr: position.atr_at_entry ?? undefined,
    stopHistory: (position.stopHistory || []).map((h: { createdAt: Date; oldStop: number; newStop: number; reason: string; level: string }) => ({
      date: h.createdAt.toISOString().split('T')[0],
      oldStop: h.oldStop,
      newStop: h.newStop,
      reason: h.reason || 'Unknown',
      level: h.level || 'INITIAL',
    })),
  };

  const result = await generateStopExplanation(data, preferredModel);

  return NextResponse.json({
    ...result,
    ticker: position.stock.ticker,
    type: 'stop',
    dataTimestamp: new Date().toISOString(),
  });
}
