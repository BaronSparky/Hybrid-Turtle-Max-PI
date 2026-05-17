/**
 * DEPENDENCIES
 * Consumed by: src/components/dashboard/TonightWorkflowCard.tsx
 * Consumes: packages/workflow/src/index.ts, src/lib/api-response.ts
 * Risk-sensitive: YES (triggers the same real-money pipeline as /api/workflow/tonight POST)
 * Last modified: 2026-05-17
 * Notes: UI-only sibling of POST /api/workflow/tonight. The parent route is
 * cron-only (CRON_SECRET enforced even when DISABLE_API_AUTH=true) per the
 * 2026-05-16 audit. This route exists so the dashboard "Run All" button can
 * trigger the same runTonightWorkflow() under standard session auth /
 * desktop bypass. Both routes invoke the identical workflow function — the
 * authorisation surface differs, not the behaviour.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { runTonightWorkflow } from '../../../../../../packages/workflow/src';
import { apiError } from '@/lib/api-response';

export async function POST() {
  try {
    const result = await runTonightWorkflow();
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Tonight workflow run (UI) error:', error);
    return apiError(500, 'WORKFLOW_RUN_FAILED', 'Failed to run tonight workflow', (error as Error).message, true);
  }
}
