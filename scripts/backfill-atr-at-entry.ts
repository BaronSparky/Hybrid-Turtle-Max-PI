/**
 * Backfill ATR at Entry
 *
 * Fetches historical price data for each open position and calculates
 * the 14-period ATR as of the entry date, populating atr_at_entry.
 *
 * Usage:
 *   npx tsx scripts/backfill-atr-at-entry.ts           # dry run
 *   npx tsx scripts/backfill-atr-at-entry.ts --apply    # write to DB
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import YahooFinance from 'yahoo-finance2';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');

const yf = new (YahooFinance as unknown as new (opts: { suppressNotices: string[] }) => typeof YahooFinance)({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

import { toYahooTicker } from '../src/lib/ticker-maps';

interface Bar { date: string; high: number; low: number; close: number }

function calculateATR(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(
      bars[i - 1].high - bars[i - 1].low,
      Math.abs(bars[i - 1].high - bars[i].close),
      Math.abs(bars[i - 1].low - bars[i].close)
    );
    trs.push(tr);
  }
  return trs.reduce((s, v) => s + v, 0) / period;
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes\n' : '🔧 APPLY MODE — will update DB\n');

  const positions = await prisma.position.findMany({
    where: { status: 'OPEN', atr_at_entry: null },
    include: { stock: { select: { ticker: true, yahooTicker: true } } },
  });

  console.log(`Positions with null atr_at_entry: ${positions.length}`);
  if (positions.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  for (const pos of positions) {
    const ticker = pos.stock.ticker;
    const yahooTicker = toYahooTicker(ticker, pos.stock.yahooTicker);
    const entryDate = pos.entryDate;

    // Fetch enough history to calculate ATR at entry date
    const period1 = new Date(entryDate);
    period1.setDate(period1.getDate() - 30); // 30 days before entry
    const period2 = new Date(entryDate);
    period2.setDate(period2.getDate() + 5); // a few days after

    try {
      const result = await yf.chart(yahooTicker, {
        period1: period1.toISOString().split('T')[0],
        period2: period2.toISOString().split('T')[0],
        interval: '1d',
      }) as { quotes: Array<{ date: Date; high: number; low: number; close: number; open: number; volume: number }> };

      const quotes = result.quotes
        .filter(q => q.close != null && q.high != null && q.low != null)
        .map(q => ({
          date: new Date(q.date).toISOString().split('T')[0],
          high: q.high,
          low: q.low,
          close: q.close,
        }))
        .reverse(); // newest first for calculateATR

      // Find bars up to and including entry date
      const entryDateStr = entryDate.toISOString().split('T')[0];
      const barsUpToEntry = quotes.filter(b => b.date <= entryDateStr);

      if (barsUpToEntry.length < 15) {
        console.log(`  SKIP  ${ticker}: insufficient bars (${barsUpToEntry.length})`);
        continue;
      }

      const atr = calculateATR(barsUpToEntry, 14);
      const rounded = Math.round(atr * 100) / 100;

      console.log(`  ${DRY_RUN ? 'WOULD' : 'SET'}   ${ticker}: ATR(14) at entry = ${rounded} (entry: ${entryDateStr}, price: $${pos.entryPrice.toFixed(2)})`);

      if (!DRY_RUN) {
        await prisma.position.update({
          where: { id: pos.id },
          data: { atr_at_entry: rounded },
        });
      }
    } catch (err) {
      console.log(`  ERROR ${ticker}: ${(err as Error).message}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
