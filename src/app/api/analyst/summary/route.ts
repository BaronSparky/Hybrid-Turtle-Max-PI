/**
 * DEPENDENCIES
 * Consumed by: AnalystCard.tsx (dashboard)
 * Consumes: analyst-service.ts, gather-system-data.ts
 * Risk-sensitive: NO — read-only summary generation
 * Notes: Gathers system state from DB and generates plain-English summary via Ollama.
 *        NEVER writes to DB. NEVER self-fetches.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateSystemSummary, streamSystemSummary } from '@/lib/analyst/analyst-service';
import { apiError } from '@/lib/api-response';
import { ensureDefaultUser } from '@/lib/default-user';
import { gatherSystemData } from '@/lib/analyst/gather-system-data';

export async function GET(request: NextRequest) {
  try {
    const preferredModel = request.nextUrl.searchParams.get('model') || undefined;
    const stream = request.nextUrl.searchParams.get('stream') === '1';
    const userId = await ensureDefaultUser();

    const summaryData = await gatherSystemData(userId);

    // Streaming mode: return SSE stream
    if (stream) {
      const streamResult = await streamSystemSummary(summaryData, preferredModel);

      if (!streamResult.available || !streamResult.stream) {
        return NextResponse.json({
          available: false,
          model: streamResult.model,
          error: streamResult.error || 'Analyst unavailable',
        });
      }

      return new Response(streamResult.stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming mode: wait for full response
    const result = await generateSystemSummary(summaryData, preferredModel);

    return NextResponse.json({
      ...result,
      dataTimestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Analyst Summary] Error:', error);
    return apiError(
      500,
      'ANALYST_SUMMARY_FAILED',
      'Failed to generate analyst summary',
      (error as Error).message
    );
  }
}
