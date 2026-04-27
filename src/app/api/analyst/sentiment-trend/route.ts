/**
 * DEPENDENCIES
 * Consumed by: watchlist-news page, dashboard components
 * Consumes: sentiment-tracker.ts
 * Risk-sensitive: NO — read-only sentiment trend data
 * Notes: Returns sentiment trend data for one or more tickers.
 *        GET /api/analyst/sentiment-trend?tickers=AAPL,MSFT
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { getSentimentTrend, getBatchSentimentTrends } from '@/lib/analyst/sentiment-tracker';

export async function GET(request: NextRequest) {
  try {
    const tickersParam = request.nextUrl.searchParams.get('tickers');

    if (!tickersParam) {
      return apiError(400, 'MISSING_TICKERS', 'tickers query parameter is required');
    }

    const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 20);

    if (tickers.length === 0) {
      return apiError(400, 'EMPTY_TICKERS', 'At least one ticker is required');
    }

    if (tickers.length === 1) {
      const trend = await getSentimentTrend(tickers[0]);
      return NextResponse.json({ tickers: trend ? { [tickers[0]]: trend } : {} });
    }

    const trends = await getBatchSentimentTrends(tickers);
    const result: Record<string, object> = {};
    for (const [ticker, trend] of trends) {
      result[ticker] = trend;
    }

    return NextResponse.json({ tickers: result });
  } catch (error) {
    console.error('[Sentiment Trend] Error:', error);
    return apiError(500, 'SENTIMENT_TREND_FAILED', 'Failed to fetch sentiment trends');
  }
}
