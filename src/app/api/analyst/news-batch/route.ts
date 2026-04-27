/**
 * DEPENDENCIES
 * Consumed by: AnalystCard.tsx (auto-load on mount)
 * Consumes: news-fetcher.ts (Yahoo Finance), prisma (read-only position + scan queries)
 * Risk-sensitive: NO — read-only public data, no trade execution, no DB writes
 * Notes: Returns news + earnings context for all open portfolio positions and top-N
 *        scan candidates in a single call. Designed for the dashboard to auto-load on
 *        mount so the user sees event-risk context without manual ticker entry.
 *        Tickers are deduped (a candidate that is also held shows once under "portfolio").
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { fetchBatchNewsContext } from '@/lib/analyst/news-fetcher';
import { classifyBatchSentiment, type TickerSentiment } from '@/lib/analyst/sentiment';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';

const DEFAULT_USER_ID = 'default-user';

export async function GET(request: NextRequest) {
  try {
    const topN = Math.min(
      parseInt(request.nextUrl.searchParams.get('topN') ?? '5', 10) || 5,
      10 // Hard cap
    );

    // 1. Get tickers for open portfolio positions
    const openPositions = await prisma.position.findMany({
      where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
      select: { stock: { select: { ticker: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const portfolioTickers = openPositions.map(p => p.stock.ticker);

    // 2. Get tickers for top-N scan candidates (READY, ranked by score)
    const latestScan = await prisma.scan.findFirst({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { runDate: 'desc' },
      select: { id: true },
    });

    let candidateTickers: string[] = [];
    if (latestScan) {
      const topCandidates = await prisma.scanResult.findMany({
        where: {
          scanId: latestScan.id,
          status: 'READY',
          passesAllFilters: true,
        },
        orderBy: { rankScore: 'desc' },
        take: topN,
        select: { stock: { select: { ticker: true } } },
      });
      candidateTickers = topCandidates.map(c => c.stock.ticker);
    }

    // 3. Dedup: remove candidates already in portfolio
    const portfolioSet = new Set(portfolioTickers);
    const uniqueCandidateTickers = candidateTickers.filter(t => !portfolioSet.has(t));

    // 4. Fetch news in parallel batches (3 headlines each to keep it fast)
    const allTickers = [...portfolioTickers, ...uniqueCandidateTickers];

    if (allTickers.length === 0) {
      return NextResponse.json({
        portfolio: [],
        candidates: [],
        fetchedAt: new Date().toISOString(),
      });
    }

    const allNews = await fetchBatchNewsContext(allTickers, 3);

    // 5. Best-effort sentiment classification (uses smallest Ollama model)
    let sentimentMap = new Map<string, TickerSentiment>();
    try {
      const sentimentResults = await classifyBatchSentiment(
        allNews.map(n => ({ ticker: n.ticker, headlines: n.headlines }))
      );
      for (const s of sentimentResults) sentimentMap.set(s.ticker, s);

      // Record sentiment trends for historical tracking (best-effort)
      try {
        const { recordBatchSentiment } = await import('@/lib/analyst/sentiment-tracker');
        await recordBatchSentiment(
          sentimentResults.map(s => ({
            ticker: s.ticker,
            sentiment: s.sentiment,
            confidence: s.confidence,
          }))
        );
      } catch { /* trend recording is best-effort */ }
    } catch {
      // Best-effort — skip sentiment if Ollama is offline
    }

    // 6. Split results back into portfolio vs candidate groups, attach sentiment
    const attachSentiment = (news: typeof allNews) =>
      news.map(n => ({
        ...n,
        sentiment: sentimentMap.get(n.ticker) ?? { ticker: n.ticker, sentiment: 'NEUTRAL' as const, confidence: 'LOW' as const },
      }));

    const portfolioNews = attachSentiment(allNews.slice(0, portfolioTickers.length));
    const candidateNews = attachSentiment(allNews.slice(portfolioTickers.length));

    return NextResponse.json({
      portfolio: portfolioNews,
      candidates: candidateNews,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Analyst News Batch] Error:', error);
    return apiError(
      500,
      'ANALYST_NEWS_BATCH_FAILED',
      'Failed to fetch batch news context',
      (error as Error).message
    );
  }
}
