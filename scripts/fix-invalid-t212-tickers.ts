/**
 * Audit and repair invalid `Stock.t212Ticker` values.
 *
 * Background — 11 May 2026 incident
 * ────────────────────────────────
 * `Stock(ticker='RBOT').t212Ticker = 'RBOT'` (bare, structurally invalid).
 * Trading 212 returns HTTP 404 "entity not found" for any order placed
 * against a bare ticker. The user already held the same ETF as `RBOTl`
 * (broker-sync stub row) which had `t212Ticker = null`, so dedup also
 * missed it. The dedup bug was fixed in `src/cron/auto-trade.ts`; this
 * script cleans up the invalid `t212Ticker` data so the canonical row
 * is usable for future trades.
 *
 * Strategy
 * ────────
 * 1. List every `Stock` row whose `t212Ticker` is non-null but does
 *    not match the structural pattern `_EQ$`.
 * 2. For each, search for an OPEN `Position` whose `t212Ticker` IS
 *    structurally valid AND whose Stock row collapses to the same
 *    canonical Yahoo symbol (via the lowercase-l rule). When found,
 *    that valid value is the recommended replacement.
 * 3. Default mode prints the audit and recommendations only.
 *    `--apply` performs the updates (idempotent).
 *
 * Usage
 * ─────
 *   npx tsx scripts/fix-invalid-t212-tickers.ts          # audit only
 *   npx tsx scripts/fix-invalid-t212-tickers.ts --apply  # write updates
 *
 * Safe to re-run: only touches rows that still have an invalid value.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  isInvalidT212TickerFormat,
  looksLikeValidT212Ticker,
} from '../src/lib/t212-ticker-validator';
import { toYahooTicker } from '../src/lib/ticker-maps';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

interface InvalidRow {
  id: string;
  ticker: string;
  t212Ticker: string;
  active: boolean;
}

interface Recommendation {
  row: InvalidRow;
  /** Replacement t212Ticker value, or null when no automatic fix is available. */
  replacement: string | null;
  reason: string;
}

async function main() {
  const mode = APPLY ? 'APPLY' : 'AUDIT';
  console.log(`[fix-invalid-t212-tickers] mode=${mode}\n`);

  // 1. Find Stock rows with invalid-shaped t212Ticker values.
  const allWithT212 = await prisma.stock.findMany({
    where: { t212Ticker: { not: null } },
    select: { id: true, ticker: true, t212Ticker: true, active: true },
  });

  const invalid: InvalidRow[] = allWithT212
    .filter((s) => isInvalidT212TickerFormat(s.t212Ticker))
    .map((s) => ({
      id: s.id,
      ticker: s.ticker,
      t212Ticker: s.t212Ticker as string,
      active: s.active,
    }));

  console.log(`Stock rows with non-null t212Ticker:        ${allWithT212.length}`);
  console.log(`Stock rows with INVALID-shaped t212Ticker:  ${invalid.length}`);

  if (invalid.length === 0) {
    console.log('\nNothing to repair — every populated t212Ticker matches `_EQ$`.');
    await prisma.$disconnect();
    return;
  }

  // 2. For each invalid row, look for a valid replacement among OPEN positions
  //    whose Stock collapses to the same canonical Yahoo symbol.
  //
  //    We use canonical-Yahoo equivalence (rather than the narrower
  //    lowercase-l candidate list used by sync) because the audit's job is
  //    to surface every plausible replacement, while sync wants the
  //    safest, most conservative match.
  const allOpenPositionsWithT212 = await prisma.position.findMany({
    where: { status: 'OPEN', t212Ticker: { not: null } },
    select: {
      t212Ticker: true,
      stock: { select: { ticker: true, yahooTicker: true } },
    },
  });

  const recommendations: Recommendation[] = [];
  for (const row of invalid) {
    const targetYahoo = toYahooTicker(row.ticker, null);

    const matchingPositions = allOpenPositionsWithT212.filter((p) => {
      if (!looksLikeValidT212Ticker(p.t212Ticker)) return false;
      const posYahoo = toYahooTicker(p.stock.ticker, p.stock.yahooTicker);
      return posYahoo === targetYahoo;
    });

    if (matchingPositions.length === 0) {
      recommendations.push({
        row,
        replacement: null,
        reason: `No OPEN position with a valid \`_EQ\` t212Ticker collapses to canonical Yahoo '${targetYahoo}' — needs manual mapping`,
      });
      continue;
    }

    const validReplacements = matchingPositions.map((p) => p.t212Ticker as string);

    // Prefer the most-recent / most-common value if multiple disagree.
    // For the documented RBOT/RBOTl case there is exactly one.
    const counts = new Map<string, number>();
    for (const t of validReplacements) counts.set(t, (counts.get(t) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    recommendations.push({
      row,
      replacement: best,
      reason:
        validReplacements.length === 1
          ? `Single OPEN position on '${matchingPositions[0].stock.ticker}' collapses to canonical Yahoo '${targetYahoo}'`
          : `${validReplacements.length} positions match canonical Yahoo '${targetYahoo}'; chose most common`,
    });
  }

  // 3. Print recommendations.
  console.log('\n--- Recommendations ---');
  for (const rec of recommendations) {
    if (rec.replacement) {
      console.log(`  ${rec.row.ticker.padEnd(10)} t212Ticker '${rec.row.t212Ticker}' → '${rec.replacement}'  (${rec.reason})`);
    } else {
      console.log(`  ${rec.row.ticker.padEnd(10)} t212Ticker '${rec.row.t212Ticker}' → ??           (${rec.reason})`);
    }
  }

  const repairable = recommendations.filter((r) => r.replacement !== null);
  const manual = recommendations.filter((r) => r.replacement === null);

  console.log(`\nAutomatically repairable: ${repairable.length}`);
  console.log(`Needs manual mapping:     ${manual.length}`);

  if (!APPLY) {
    console.log('\nDry run — no changes written. Re-run with `--apply` to perform repairs.');
    await prisma.$disconnect();
    return;
  }

  // 4. Apply repairs.
  console.log('\n--- Applying repairs ---');
  let updated = 0;
  for (const rec of repairable) {
    if (!rec.replacement) continue;
    await prisma.stock.update({
      where: { id: rec.row.id },
      data: { t212Ticker: rec.replacement },
    });
    updated++;
    console.log(`  UPDATED ${rec.row.ticker} → ${rec.replacement}`);
  }

  console.log(`\nDone. ${updated} row(s) updated. ${manual.length} still need manual mapping.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[fix-invalid-t212-tickers] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
