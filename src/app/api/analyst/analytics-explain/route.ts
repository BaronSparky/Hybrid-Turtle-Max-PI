/**
 * DEPENDENCIES
 * Consumed by: AnalyticsExplainCard.tsx (Score Lab, Filter Scorecard)
 * Consumes: analyst-service.ts (Ollama)
 * Risk-sensitive: NO — read-only, advisory explanations
 * Notes: Generic analytics explanation endpoint. Accepts a context summary string
 *        and a question, then asks the local analyst to interpret in plain English.
 *        Supports streaming (SSE) and non-streaming modes.
 *        Used for Score Lab and Filter Scorecard pages.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { contextSummary, question, model, stream } = body as {
      contextSummary?: string;
      question?: string;
      model?: string;
      stream?: boolean;
    };

    if (!contextSummary || !question) {
      return apiError(400, 'MISSING_DATA', 'contextSummary and question are required');
    }

    // Truncate context to prevent prompt injection via very large payloads
    const truncatedContext = contextSummary.slice(0, 4000);
    const truncatedQuestion = question.slice(0, 500);

    // Streaming mode: return SSE stream
    if (stream) {
      const { streamAnalyticsExplanation } = await import('@/lib/analyst/analyst-service');
      const streamResult = await streamAnalyticsExplanation(truncatedContext, truncatedQuestion, model);
      if (!streamResult.available || !streamResult.stream) {
        return NextResponse.json({
          available: false,
          error: streamResult.error || 'Stream unavailable',
        });
      }
      return new Response(streamResult.stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Model': streamResult.model || '',
        },
      });
    }

    const { checkOllamaHealth, ollamaGenerate } = await import('@/lib/analyst/ollama-client');
    const { ANALYST_SYSTEM_PROMPT } = await import('@/lib/analyst/prompt-builder');
    const { checkResponseSafety } = await import('@/lib/analyst/safety-filter');

    const health = await checkOllamaHealth(model);
    if (!health.available || !health.selectedModel) {
      return NextResponse.json({ available: false, response: null, model: null });
    }

    const prompt = `${truncatedContext}\n\nQuestion: ${truncatedQuestion}\n\nExplain in plain English for a beginner. Reference specific numbers from the data. Do NOT recommend buy or sell.`;

    const start = Date.now();
    const result = await ollamaGenerate({
      model: health.selectedModel,
      system: ANALYST_SYSTEM_PROMPT,
      prompt,
      options: { temperature: 0.3, num_predict: 400, num_ctx: 4096 },
    });

    if (!result?.response) {
      return NextResponse.json({ available: true, response: null, model: health.selectedModel });
    }

    const safety = checkResponseSafety(result.response);

    return NextResponse.json({
      available: true,
      response: safety.cleaned,
      model: health.selectedModel,
      durationMs: Date.now() - start,
      safetyWarnings: safety.warnings,
    });
  } catch (error) {
    console.error('[Analyst Analytics Explain] Error:', error);
    return apiError(
      500,
      'ANALYST_ANALYTICS_EXPLAIN_FAILED',
      'Failed to generate analytics explanation',
      (error as Error).message
    );
  }
}
