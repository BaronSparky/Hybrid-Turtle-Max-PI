/**
 * One-shot script: tag UK-listed core ETFs as ISA-eligible.
 *
 * Reads Planning/etf_core.txt, finds matching Stock rows where currency = 'GBP'
 * (UK-listed UCITS ETFs, regulator-allowed in T212 ISA), and sets isaEligible = true
 * if it's currently null. Skips rows already tagged true/false explicitly.
 *
 * USD-priced ETFs (VWO, REMX, PICK) are LEFT UNTOUCHED — they may be ISA-eligible
 * but require manual review, so we don't auto-tag.
 *
 * Idempotent: safe to run repeatedly.
 *
 * USAGE: npx tsx scripts/tag-isa-eligible-etfs.ts
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const prisma = new PrismaClient();
  try {
    const file = readFileSync(join(process.cwd(), 'Planning', 'etf_core.txt'), 'utf-8');
    const tickers = file
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    console.log(`[tag-isa-eligible-etfs] Read ${tickers.length} tickers from Planning/etf_core.txt`);

    const rows = await prisma.stock.findMany({
      where: { ticker: { in: tickers } },
      select: { id: true, ticker: true, sleeve: true, currency: true, isaEligible: true },
    });

    const candidates = rows.filter(
      (r) => r.sleeve === 'ETF' && r.currency === 'GBP' && r.isaEligible === null,
    );

    console.log(
      `[tag-isa-eligible-etfs] ${rows.length} stocks matched, ${candidates.length} are GBP ETFs with isaEligible=null`,
    );

    if (candidates.length === 0) {
      console.log('[tag-isa-eligible-etfs] Nothing to update. Exiting.');
      return;
    }

    for (const c of candidates) {
      console.log(`  - ${c.ticker} (${c.sleeve}, ${c.currency}) → isaEligible=true`);
    }

    const result = await prisma.stock.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { isaEligible: true },
    });

    console.log(`\n[tag-isa-eligible-etfs] Updated ${result.count} rows.`);

    // Report what we DIDN'T touch so the operator can decide manually.
    const skipped = rows.filter(
      (r) => r.sleeve === 'ETF' && r.currency !== 'GBP' && r.isaEligible === null,
    );
    if (skipped.length > 0) {
      console.log(`\n[tag-isa-eligible-etfs] Left untouched (manual review needed):`);
      for (const s of skipped) {
        console.log(`  - ${s.ticker} (${s.sleeve}, ${s.currency ?? 'unknown'}) — isaEligible=null`);
      }
    }

    const missing = tickers.filter((t) => !rows.find((r) => r.ticker === t));
    if (missing.length > 0) {
      console.log(`\n[tag-isa-eligible-etfs] Missing from DB (${missing.length}):`);
      console.log('  ' + missing.join(', '));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
