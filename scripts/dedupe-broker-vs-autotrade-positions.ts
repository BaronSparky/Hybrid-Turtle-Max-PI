/**
 * One-shot dedupe of broker-sync vs auto-trade duplicates.
 *
 * Background: auto-trade created Position rows with t212Ticker=null. Broker
 * sync queried existingPositions filtered by source='trading212', didn't see
 * the auto-trade rows, and re-created them. Result: 2 rows per ticker (one
 * with correct R math + null t212Ticker, one with default 5% R + correct
 * t212Ticker).
 *
 * Strategy: keep the auto-trade row (correct entry/stop/initialRisk),
 * backfill its t212Ticker from the trading212 dupe, delete the trading212
 * dupe (StopHistory cascades, no TradeLog/TradeJournal references).
 *
 * Idempotent: skips tickers that don't have exactly the expected pair.
 */

import prisma from '../src/lib/prisma';

const USER_ID = process.env.SANITY_USER_ID || 'default-user';

async function main() {
  const open = await prisma.position.findMany({
    where: { userId: USER_ID, status: 'OPEN' },
    include: { stock: { select: { ticker: true } } },
  });

  const byTicker = new Map<string, typeof open>();
  for (const p of open) {
    const list = byTicker.get(p.stock.ticker) || [];
    list.push(p);
    byTicker.set(p.stock.ticker, list);
  }

  let merged = 0;
  let skipped = 0;

  for (const [ticker, rows] of byTicker) {
    if (rows.length === 1) continue;
    if (rows.length !== 2) {
      console.warn(`  ${ticker}: ${rows.length} OPEN rows — skipping (not the known 2-row pattern)`);
      skipped++;
      continue;
    }

    const autoTrade = rows.find(r => r.source === 'auto-trade');
    const broker = rows.find(r => r.source === 'trading212');

    if (!autoTrade || !broker) {
      console.warn(`  ${ticker}: 2 rows but not the auto-trade + trading212 pattern — skipping`);
      skipped++;
      continue;
    }

    if (autoTrade.t212Ticker) {
      console.warn(`  ${ticker}: auto-trade row already has t212Ticker — skipping`);
      skipped++;
      continue;
    }

    if (!broker.t212Ticker) {
      console.warn(`  ${ticker}: trading212 row missing t212Ticker — skipping`);
      skipped++;
      continue;
    }

    if (autoTrade.shares !== broker.shares) {
      console.warn(`  ${ticker}: share counts differ (auto=${autoTrade.shares} broker=${broker.shares}) — skipping`);
      skipped++;
      continue;
    }

    console.log(`  ${ticker}: keeping auto-trade ${autoTrade.id.slice(0, 8)} (iR=${autoTrade.initialRisk.toFixed(4)}), removing broker ${broker.id.slice(0, 8)} (iR=${broker.initialRisk.toFixed(4)}), backfilling t212Ticker=${broker.t212Ticker}`);

    await prisma.$transaction([
      prisma.position.update({
        where: { id: autoTrade.id },
        data: { t212Ticker: broker.t212Ticker },
      }),
      prisma.position.delete({ where: { id: broker.id } }),
    ]);
    merged++;
  }

  console.log(`\nMerged: ${merged}, skipped: ${skipped}`);

  const after = await prisma.position.count({ where: { userId: USER_ID, status: 'OPEN' } });
  console.log(`OPEN positions for ${USER_ID} now: ${after}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
