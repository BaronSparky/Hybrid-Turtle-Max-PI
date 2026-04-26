/**
 * DEPENDENCIES
 * Consumed by: BuyConfirmationModal.tsx (frontend pre-check)
 * Consumes: pre-execution-dry-run.ts, entry-quality-engine.ts
 * Risk-sensitive: NO — read-only validation, no execution
 * Notes: POST /api/positions/dry-run — runs all safety checks + entry quality without placing orders.
 *        Frontend calls this before showing the "Confirm Buy" button.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runPreExecutionDryRun, type DryRunInput } from '@/lib/pre-execution-dry-run';
import { assessEntryQuality, type EntryQualityInput } from '@/lib/entry-quality-engine';
import type { EntryQuality } from '@/types';
import { z } from 'zod';

const dryRunSchema = z.object({
  userId: z.string().trim().min(1),
  ticker: z.string().trim().min(1),
  entryPrice: z.coerce.number().positive(),
  stopPrice: z.coerce.number().positive(),
  quantity: z.coerce.number().positive(),
  accountType: z.enum(['invest', 'isa']),
  regime: z.string().optional(),
  ncsScore: z.coerce.number().optional(),
  fwsScore: z.coerce.number().optional(),
  dualScoreAction: z.string().optional(),
  // Entry quality inputs
  currentPrice: z.coerce.number().positive().optional(),
  entryTrigger: z.coerce.number().positive().optional(),
  atr: z.coerce.number().positive().optional(),
  atrPercent: z.coerce.number().optional(),
  slippageBuffer: z.coerce.number().optional(),
  candidateStatus: z.string().optional(),
  antiChaseFailed: z.boolean().optional(),
  pullbackTriggered: z.boolean().optional(),
  pullbackEntryPrice: z.coerce.number().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const body = dryRunSchema.parse(rawBody);

    const result = await runPreExecutionDryRun(body as DryRunInput);

    // Compute entry quality if sufficient data provided
    let entryQuality: EntryQuality | null = null;
    if (body.currentPrice && body.entryTrigger && body.atr) {
      const eqInput: EntryQualityInput = {
        price: body.currentPrice,
        entryTrigger: body.entryTrigger,
        stopPrice: body.stopPrice,
        atr: body.atr,
        atrPercent: body.atrPercent ?? 0,
        status: body.candidateStatus ?? 'READY',
        slippageBuffer: body.slippageBuffer ?? 0,
        pullbackTriggered: body.pullbackTriggered ?? false,
        pullbackEntryPrice: body.pullbackEntryPrice,
        antiChaseFailed: body.antiChaseFailed ?? false,
      };
      entryQuality = assessEntryQuality(eqInput);
    }

    return NextResponse.json({
      ...result,
      entryQuality,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: (err as Error).message || 'Dry run failed' },
      { status: 500 }
    );
  }
}
