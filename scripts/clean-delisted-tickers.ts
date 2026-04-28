/**
 * Clean Delisted Tickers
 *
 * Probes all active tickers against Yahoo Finance and deactivates
 * any that return no data (delisted, renamed, or invalid symbols).
 *
 * Usage:
 *   npx tsx scripts/clean-delisted-tickers.ts           # dry run
 *   npx tsx scripts/clean-delisted-tickers.ts --apply    # actually deactivate
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import YahooFinance from 'yahoo-finance2';
import { toYahooTicker } from '../src/lib/ticker-maps';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');

// Instantiate yahoo-finance2 with suppressed notices (matches market-data.ts)
const yf = new (YahooFinance as unknown as new (opts: { suppressNotices: string[] }) => typeof YahooFinance)({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

/** Test a batch of tickers via yf.quote(). Returns set of tickers that FAILED. */
async function probeBatch(tickers: string[]): Promise<Set<string>> {
  const failed = new Set<string>();
  const yahooToOriginal = new Map<string, string>();
  const yahooTickers: string[] = [];

  for (const t of tickers) {
    const yt = toYahooTicker(t);
    yahooToOriginal.set(yt, t);
    yahooTickers.push(yt);
  }

  try {
    const results = (await yf.quote(yahooTickers)) as Array<{
      symbol?: string;
      regularMarketPrice?: number;
    }>;

    // Mark tickers that returned valid data
    const succeeded = new Set<string>();
    for (const r of results) {
      if (r?.symbol && r.regularMarketPrice && r.regularMarketPrice > 0) {
        const orig = yahooToOriginal.get(r.symbol) ?? r.symbol;
        succeeded.add(orig);
      }
    }

    // Anything not in succeeded set is a failure
    for (const t of tickers) {
      if (!succeeded.has(t)) failed.add(t);
    }
  } catch {
    // Entire batch failed — try individually
    for (const t of tickers) {
      try {
        const yt = toYahooTicker(t);
        const r = (await yf.quote(yt)) as {
          symbol?: string;
          regularMarketPrice?: number;
        } | null;
        if (!r || !r.regularMarketPrice || r.regularMarketPrice <= 0) {
          failed.add(t);
        }
      } catch {
        failed.add(t);
      }
    }
  }

  return failed;
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes\n' : '🔧 APPLY MODE — will deactivate delisted tickers\n');

  // Load all active tickers
  const activeStocks = await prisma.stock.findMany({
    where: { active: true },
    select: { ticker: true, name: true, sleeve: true },
    orderBy: { ticker: 'asc' },
  });

  console.log(`Active tickers in DB: ${activeStocks.length}`);

  // Probe in batches of 30 (Yahoo supports up to 50, but smaller batches are more reliable)
  const BATCH_SIZE = 30;
  const allFailed: { ticker: string; name: string; sleeve: string }[] = [];
  const tickers = activeStocks.map((s) => s.ticker);

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tickers.length / BATCH_SIZE);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} tickers)...`);

    const failed = await probeBatch(batch);

    if (failed.size > 0) {
      console.log(` ❌ ${failed.size} failed: ${[...failed].join(', ')}`);
      for (const t of failed) {
        const stock = activeStocks.find((s) => s.ticker === t);
        if (stock) allFailed.push(stock);
      }
    } else {
      console.log(' ✅');
    }

    // Rate limit between batches
    if (i + BATCH_SIZE < tickers.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total delisted/failed: ${allFailed.length} / ${activeStocks.length}`);

  if (allFailed.length === 0) {
    console.log('✅ All active tickers are valid. Nothing to clean.');
    return;
  }

  // Group by sleeve for reporting
  const bySleeve = new Map<string, string[]>();
  for (const s of allFailed) {
    const existing = bySleeve.get(s.sleeve) ?? [];
    existing.push(s.ticker);
    bySleeve.set(s.sleeve, existing);
  }

  console.log('\nBy sleeve:');
  for (const [sleeve, tickers] of bySleeve) {
    console.log(`  ${sleeve}: ${tickers.length} — ${tickers.join(', ')}`);
  }

  if (DRY_RUN) {
    console.log(`\n⚠  Run with --apply to deactivate these ${allFailed.length} tickers.`);
  } else {
    // Deactivate in one bulk update
    const failedTickers = allFailed.map((s) => s.ticker);
    const result = await prisma.stock.updateMany({
      where: { ticker: { in: failedTickers }, active: true },
      data: { active: false },
    });
    console.log(`\n✅ Deactivated ${result.count} tickers.`);
  }

  // Final count
  const remaining = await prisma.stock.count({ where: { active: true } });
  console.log(`\nActive tickers remaining: ${remaining}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
