/**
 * DEPENDENCIES
 * Consumed by: src/app/backtest/page.tsx
 * Consumes: packages/backtest/src/index.ts, src/lib/api-response.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 11 fetch endpoint for persisted backtest runs.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getStoredBacktestRun } from '../../../../../packages/backtest/src';
import { apiError } from '@/lib/api-response';

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await getStoredBacktestRun(id);
    if (!run) {
      return apiError(404, 'BACKTEST_NOT_FOUND', 'Backtest run not found.');
    }

    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return apiError(
      500,
      'BACKTEST_FETCH_FAILED',
      'Failed to load backtest run.',
      error instanceof Error ? error.message : 'Unknown backtest fetch failure',
      true,
    );
  }
}