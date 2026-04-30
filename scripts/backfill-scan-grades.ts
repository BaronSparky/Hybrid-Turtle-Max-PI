/**
 * DEPENDENCIES
 * Consumed by: manual operations, npm run scripts:backfill-scan-grades
 * Consumes: ScanResult, ScoreBreakdown via prisma
 * Risk-sensitive: NO — analytics backfill only. Updates ncs/fws/bqs columns
 *                 on existing ScanResult rows; does not touch grade or trade
 *                 execution paths. Safe to re-run.
 *
 * Backfills ncs/fws/bqs onto existing ScanResult rows by joining each row's
 * ticker (via Stock) to the closest ScoreBreakdown entry around the scan
 * timestamp. Re-grading is intentionally NOT done here — the persisted grade
 * reflects what the system *did* at scan time, which is part of the audit
 * trail. New scans pick up scores via the scan route wiring.
 *
 * Usage:
 *   npx tsx scripts/backfill-scan-grades.ts            # dry run (default)
 *   npx tsx scripts/backfill-scan-grades.ts --apply    # apply updates
 */

import prisma from '@/lib/prisma';

const APPLY = process.argv.includes('--apply');

async function main() {
  const scanResults = await prisma.scanResult.findMany({
    where: { ncs: null, fws: null, bqs: null },
    select: {
      id: true,
      stockId: true,
      stock: { select: { ticker: true } },
      scan: { select: { runDate: true } },
    },
    orderBy: { id: 'desc' },
  });

  console.log(`[backfill] Found ${scanResults.length} ScanResult rows missing ncs/fws/bqs.`);

  if (scanResults.length === 0) {
    console.log('[backfill] Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // Group by ticker to batch lookups.
  const tickerToRows = new Map<string, typeof scanResults>();
  for (const row of scanResults) {
    const arr = tickerToRows.get(row.stock.ticker) ?? [];
    arr.push(row);
    tickerToRows.set(row.stock.ticker, arr);
  }

  console.log(`[backfill] Spans ${tickerToRows.size} unique tickers.`);

  let matched = 0;
  let updated = 0;
  let unmatched = 0;

  for (const [ticker, rows] of tickerToRows) {
    const scores = await prisma.scoreBreakdown.findMany({
      where: { ticker },
      select: { ncsTotal: true, fwsTotal: true, bqsTotal: true, scoredAt: true },
      orderBy: { scoredAt: 'asc' },
    });

    if (scores.length === 0) {
      unmatched += rows.length;
      continue;
    }

    for (const row of rows) {
      // Find the score row whose scoredAt is closest to (and ideally before)
      // the scan runDate. Prefer the most recent score AT OR BEFORE the scan.
      const scanTs = row.scan.runDate.getTime();
      let chosen = scores[0];
      let chosenDelta = Math.abs(chosen.scoredAt.getTime() - scanTs);
      for (const s of scores) {
        const delta = Math.abs(s.scoredAt.getTime() - scanTs);
        if (delta < chosenDelta) {
          chosen = s;
          chosenDelta = delta;
        }
      }

      // Skip when the closest score is more than 7 days away — likely a
      // historical scan whose snapshot context is gone.
      if (chosenDelta > 7 * 24 * 60 * 60 * 1000) {
        unmatched += 1;
        continue;
      }

      matched += 1;
      if (APPLY) {
        await prisma.scanResult.update({
          where: { id: row.id },
          data: { ncs: chosen.ncsTotal, fws: chosen.fwsTotal, bqs: chosen.bqsTotal },
        });
        updated += 1;
      }
    }
  }

  console.log(`[backfill] Matched: ${matched}, Updated: ${updated}, Unmatched: ${unmatched}`);
  if (!APPLY) {
    console.log('[backfill] Dry run only. Re-run with --apply to write updates.');
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[backfill] FATAL', err);
  process.exit(1);
});
