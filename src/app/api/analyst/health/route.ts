/**
 * DEPENDENCIES
 * Consumed by: AnalystCard.tsx (dashboard), settings page
 * Consumes: ollama-client.ts
 * Risk-sensitive: NO — read-only health check
 * Notes: Returns Ollama connectivity status, available models, and latency.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkOllamaHealth, listOllamaModels } from '@/lib/analyst/ollama-client';
import { apiError } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    const preferredModel = request.nextUrl.searchParams.get('model') || undefined;
    const health = await checkOllamaHealth(preferredModel);

    return NextResponse.json(health);
  } catch (error) {
    return apiError(
      500,
      'ANALYST_HEALTH_FAILED',
      'Failed to check analyst health',
      (error as Error).message
    );
  }
}
