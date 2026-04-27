/**
 * DEPENDENCIES
 * Consumed by: /trade-pulse/[ticker] page (AI Explain button)
 * Consumes: analyst-service.ts (Ollama), news-fetcher.ts (Yahoo Finance)
 * Risk-sensitive: NO — read-only, advisory explanation
 * Notes: Accepts Trade Pulse data + ticker, enriches with news/earnings context,
 *        and returns a plain-English explanation of the grade and signals.
 *        If Ollama is offline, returns { available: false }.
 *        News/earnings fetch is best-effort — explanation works without it.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateTradePulseExplanation, streamTradePulseExplanation } from '@/lib/analyst/analyst-service';
import { fetchNewsContext } from '@/lib/analyst/news-fetcher';
import { apiError } from '@/lib/api-response';
import type { TradePulseExplainData } from '@/lib/analyst/prompt-builder';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ticker, score, grade, decision, signals, concerns, opportunities, model, stream } = body as {
      ticker?: string;
      score?: number;
      grade?: string;
      decision?: string;
      signals?: TradePulseExplainData['signals'];
      concerns?: string[];
      opportunities?: string[];
      model?: string;
      stream?: boolean;
    };

    if (!ticker || typeof ticker !== 'string') {
      return apiError(400, 'MISSING_TICKER', 'ticker is required');
    }
    if (score == null || !grade || !signals?.length) {
      return apiError(400, 'MISSING_DATA', 'score, grade, and signals are required');
    }

    // Best-effort news + earnings enrichment
    let headlines: TradePulseExplainData['headlines'] = [];
    let earnings: TradePulseExplainData['earnings'] = undefined;
    try {
      const news = await fetchNewsContext(ticker, 3);
      headlines = news.headlines.map(h => ({
        title: h.title,
        publisher: h.publisher,
        ageHours: h.ageHours,
      }));
      earnings = news.earnings;
    } catch {
      // Non-critical — proceed without news context
    }

    const data: TradePulseExplainData = {
      ticker,
      score,
      grade,
      decision: decision ?? '',
      signals,
      concerns: concerns ?? [],
      opportunities: opportunities ?? [],
      headlines,
      earnings,
    };

    // Streaming mode: return SSE stream
    if (stream) {
      const streamResult = await streamTradePulseExplanation(data, model);
      if (!streamResult.available || !streamResult.stream) {
        return NextResponse.json({
          available: false,
          error: streamResult.error || 'Stream unavailable',
          ticker,
          grade,
          earnings,
        });
      }
      return new Response(streamResult.stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Ticker': ticker,
          'X-Grade': grade,
          'X-Model': streamResult.model || '',
        },
      });
    }

    const result = await generateTradePulseExplanation(data, model);

    return NextResponse.json({
      ...result,
      ticker,
      grade,
      earnings,
    });
  } catch (error) {
    console.error('[Analyst Trade Pulse Explain] Error:', error);
    return apiError(
      500,
      'ANALYST_TRADE_PULSE_FAILED',
      'Failed to generate Trade Pulse explanation',
      (error as Error).message
    );
  }
}
