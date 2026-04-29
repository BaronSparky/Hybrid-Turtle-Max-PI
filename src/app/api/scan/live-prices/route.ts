/**
 * DEPENDENCIES
 * Consumed by: src/app/scan/page.tsx (live price overlay for READY/WATCH candidates)
 * Consumes: src/lib/market-data.ts (getBatchQuotes)
 * Risk-sensitive: NO
 * Last modified: 2026-02-23
 * Notes: Returns live Yahoo Finance quotes for a list of tickers.
 *        Uses the 30-min quote cache so repeated calls within that window are free.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBatchQuotes } from '@/lib/market-data';
import { apiError } from '@/lib/api-response';
import { parseJsonBody } from '@/lib/request-validation';
import { getT212Prices } from '@/lib/position-sync';

const livePricesSchema = z.object({
  tickers: z.array(z.string().trim().min(1)).min(1).max(50),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, livePricesSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const { tickers } = parsed.data;

    // On Tuesdays (execution day), bypass cache for fresh prices
    const isTuesday = new Date().getDay() === 2;
    const quotes = await getBatchQuotes(tickers, isTuesday);

    // Return a lightweight map: ticker → { price, change, changePercent }
    const prices: Record<string, { price: number; change: number; changePercent: number; source?: string }> = {};
    quotes.forEach((quote, ticker) => {
      prices[ticker] = {
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        source: 'YAHOO',
      };
    });

    // Overlay T212 real-time prices for tickers we currently hold
    // T212 prices are more accurate than Yahoo for trigger-met detection
    const t212Entries = getT212Prices(tickers);
    for (const [ticker, entry] of Object.entries(t212Entries)) {
      if (entry.price > 0 && prices[ticker]) {
        prices[ticker].price = entry.price;
        prices[ticker].source = 'T212';
      }
    }

    return NextResponse.json({
      prices,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[LivePrices] Error:', error);
    return apiError(
      500,
      'LIVE_PRICES_FAILED',
      'Failed to fetch live prices',
      (error as Error).message,
      true
    );
  }
}
