/**
 * DEPENDENCIES
 * Consumed by: Journal page, positions page (draft button)
 * Consumes: analyst-service.ts, prisma.ts (read-only queries)
 * Risk-sensitive: NO — generates draft text, does NOT save to DB
 * Notes: Accepts a positionId and draft type (entry/close/lesson).
 *        Returns a structured journal draft. User must manually save/edit.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateJournalDraft } from '@/lib/analyst/analyst-service';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import type { JournalDraftData } from '@/lib/analyst/prompt-builder';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { positionId, type, model } = body as {
      positionId: string;
      type: 'entry' | 'close' | 'lesson';
      model?: string;
    };

    if (!positionId) {
      return apiError(400, 'MISSING_POSITION_ID', 'positionId is required');
    }
    if (!type || !['entry', 'close', 'lesson'].includes(type)) {
      return apiError(400, 'INVALID_TYPE', 'type must be "entry", "close", or "lesson"');
    }

    const userId = await ensureDefaultUser();

    const position = await prisma.position.findFirst({
      where: { id: positionId, userId },
      include: { stock: true },
    });

    if (!position) {
      return apiError(404, 'NO_POSITION', `No position found for ${positionId}`);
    }

    const initialRisk = position.initialRisk || (position.entryPrice - position.stopLoss);
    // Position doesn't store currentPrice; use entryPrice as fallback
    const rMultiple = 0;
    const holdingDays = position.exitDate
      ? Math.round((position.exitDate.getTime() - position.entryDate.getTime()) / 86400000)
      : Math.round((Date.now() - position.entryDate.getTime()) / 86400000);
    const pnlAbsolute = position.exitPrice
      ? (position.exitPrice - position.entryPrice) * (position.shares ?? 1)
      : undefined;
    const pnlPercent = position.exitPrice
      ? ((position.exitPrice - position.entryPrice) / position.entryPrice) * 100
      : undefined;

    const data: JournalDraftData = {
      ticker: position.stock.ticker,
      name: position.stock.name || position.stock.ticker,
      type,
      entryPrice: position.entryPrice,
      entryDate: position.entryDate.toISOString().split('T')[0],
      currentPrice: undefined, // Live price not stored on position
      closePrice: position.exitPrice ?? undefined,
      closeDate: position.exitDate?.toISOString().split('T')[0] ?? undefined,
      initialStop: position.stopLoss,
      currentStop: position.currentStop,
      rMultiple,
      protectionLevel: position.protectionLevel || 'INITIAL',
      entryGrade: position.entry_type ?? undefined,
      executionGrade: undefined,
      regime: undefined,
      scanStatus: undefined,
      sleeve: position.stock.sleeve || 'CORE',
      sector: position.stock.sector || 'Unknown',
      pnlPercent,
      pnlAbsolute,
      holdingDays,
      outcome: position.exitDate ? (pnlAbsolute && pnlAbsolute > 0 ? 'WIN' : 'LOSS') : 'OPEN',
    };

    const result = await generateJournalDraft(data, model);

    return NextResponse.json({
      ...result,
      positionId,
      ticker: position.stock.ticker,
      type,
      dataTimestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Analyst Journal] Error:', error);
    return apiError(
      500,
      'ANALYST_JOURNAL_FAILED',
      'Failed to generate journal draft',
      (error as Error).message
    );
  }
}
