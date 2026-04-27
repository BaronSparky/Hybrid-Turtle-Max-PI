/**
 * DEPENDENCIES
 * Consumed by: AnalystCard.tsx (future), Telegram /news command (future), manual API calls
 * Consumes: news-fetcher.ts (Yahoo Finance public data), analyst-service.ts (Ollama summary), prisma (read-only ticker lookup)
 * Risk-sensitive: NO — read-only public news + LLM commentary, never writes or executes
 * Notes: Returns recent public news headlines + next earnings date for a ticker, plus an
 *        optional plain-English LLM summary flagging event risk. Display-only / advisory.
 *        If Ollama is offline the headlines + earnings still return; only `summary` is null.
 *        If Yahoo is unreachable the endpoint still returns 200 with empty headlines and a
 *        warning, so the dashboard can degrade gracefully.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateNewsContextSummary } from '@/lib/analyst/analyst-service';
import { fetchNewsContext } from '@/lib/analyst/news-fetcher';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import type { NewsContextData } from '@/lib/analyst/prompt-builder';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ticker, model, includeSummary } = body as {
      ticker?: string;
      model?: string;
      includeSummary?: boolean;
    };

    if (!ticker || typeof ticker !== 'string') {
      return apiError(400, 'MISSING_TICKER', 'ticker is required');
    }

    const upper = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,10}$/.test(upper)) {
      return apiError(400, 'INVALID_TICKER', 'ticker must be 1-10 chars (letters, digits, dot, hyphen)');
    }

    // Optional enrichment from local DB (sleeve, current scan status) — read-only
    const stock = await prisma.stock.findFirst({
      where: { ticker: upper },
      select: { id: true, ticker: true, name: true, sleeve: true },
    });
    const yahooSymbol = upper; // Public news search works with the bare ticker for US listings

    let scanStatus: string | undefined;
    if (stock) {
      const scanRow = await prisma.scanResult.findFirst({
        where: { stockId: stock.id },
        orderBy: { scan: { runDate: 'desc' } },
        select: { status: true },
      }).catch(() => null);
      scanStatus = scanRow?.status;
    }

    // Fetch public news + earnings (best-effort, never throws)
    const news = await fetchNewsContext(yahooSymbol, 5);

    const promptData: NewsContextData = {
      ticker: upper,
      name: stock?.name ?? undefined,
      sleeve: stock?.sleeve ?? undefined,
      scanStatus,
      headlines: news.headlines.map(h => ({
        title: h.title,
        publisher: h.publisher,
        publishedAt: h.publishedAt,
        ageHours: h.ageHours,
      })),
      earnings: news.earnings,
    };

    // LLM summary is opt-out (defaults on) — caller can request raw data only
    let summary: Awaited<ReturnType<typeof generateNewsContextSummary>> | null = null;
    if (includeSummary !== false) {
      summary = await generateNewsContextSummary(promptData, model);
    }

    return NextResponse.json({
      ticker: upper,
      fetchedAt: news.fetchedAt,
      headlines: news.headlines,
      earnings: news.earnings,
      sourceWarnings: news.warnings,
      summary,
    });
  } catch (error) {
    console.error('[Analyst News] Error:', error);
    return apiError(
      500,
      'ANALYST_NEWS_FAILED',
      'Failed to fetch news context',
      (error as Error).message
    );
  }
}
