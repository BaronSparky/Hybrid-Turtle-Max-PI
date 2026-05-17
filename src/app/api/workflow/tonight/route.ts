/**
 * DEPENDENCIES
 * Consumed by: src/components/dashboard/TonightWorkflowCard.tsx (GET only); scheduled tasks via CRON_SECRET (POST)
 * Consumes: packages/workflow/src/index.ts, src/lib/api-response.ts
 * Risk-sensitive: YES (POST triggers real-money pipeline)
 * Last modified: 2026-05-17
 * Notes: GET returns card data and is session-gated. POST is cron-only and
 * requires CRON_SECRET even when DISABLE_API_AUTH=true (2026-05-16 audit).
 * The dashboard "Run All" button calls the sibling /run-from-ui route, not
 * this POST.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getTonightWorkflowCardData, runTonightWorkflow } from '../../../../../packages/workflow/src';
import { apiError, verifyCronSecret } from '@/lib/api-response';

export async function GET() {
  try {
    const card = await getTonightWorkflowCardData();
    return NextResponse.json({ card });
  } catch (error) {
    console.error('Tonight workflow card error:', error);
    return apiError(500, 'WORKFLOW_CARD_FAILED', 'Failed to fetch tonight workflow card', (error as Error).message, true);
  }
}

export async function POST(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request);
  if (cronAuthError) return cronAuthError;

  try {
    const result = await runTonightWorkflow();
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Tonight workflow run error:', error);
    return apiError(500, 'WORKFLOW_RUN_FAILED', 'Failed to run tonight workflow', (error as Error).message, true);
  }
}
