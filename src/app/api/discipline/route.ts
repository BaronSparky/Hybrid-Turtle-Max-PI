/**
 * DEPENDENCIES
 * Consumed by: Dashboard discipline panel, profit scoreboard
 * Consumes: discipline.ts
 * Risk-sensitive: NO — read-only
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { computeDisciplineScore, logOverride, type OverrideLogEntry } from '@/lib/discipline';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';

// GET /api/discipline — returns discipline score
export async function GET() {
  try {
    const report = await computeDisciplineScore();
    return NextResponse.json(report);
  } catch (error) {
    return apiError(500, 'DISCIPLINE_FAILED', 'Failed to compute discipline score', (error as Error).message);
  }
}

// POST /api/discipline — log an override
const overrideSchema = z.object({
  userId: z.string().default('default-user'),
  action: z.string(),
  ticker: z.string().optional(),
  blockedRule: z.string(),
  blockType: z.enum(['HARD', 'SOFT']),
  reason: z.string().min(1, 'A reason is required for overrides'),
  riskProfile: z.string(),
  operatingMode: z.string(),
  systemRecommendation: z.string(),
  actionCompleted: z.boolean(),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const parsed = overrideSchema.parse(raw);
    await logOverride(parsed as OverrideLogEntry);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return apiError(400, 'INVALID_OVERRIDE', err.issues.map(i => i.message).join(', '));
    }
    return apiError(500, 'LOG_FAILED', 'Failed to log override', (err as Error).message);
  }
}
