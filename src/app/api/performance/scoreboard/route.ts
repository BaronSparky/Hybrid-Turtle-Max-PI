/**
 * DEPENDENCIES
 * Consumed by: Profit Scoreboard dashboard page
 * Consumes: profit-scoreboard.ts
 * Risk-sensitive: NO — read-only
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { computeProfitScoreboard } from '@/lib/profit-scoreboard';
import { apiError } from '@/lib/api-response';

export async function GET() {
  try {
    const scoreboard = await computeProfitScoreboard();
    return NextResponse.json(scoreboard);
  } catch (error) {
    return apiError(500, 'SCOREBOARD_FAILED', 'Failed to compute scoreboard', (error as Error).message);
  }
}
