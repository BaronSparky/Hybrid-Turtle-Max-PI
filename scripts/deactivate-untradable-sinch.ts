import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Deactivate Stock rows that are confirmed NOT tradable on Trading 212.
 *
 * SINCH.ST (Sinch AB) was verified absent from T212's live instruments
 * universe (17,109 instruments, fetched 2026-06-02) under every ticker,
 * exchange, and currency. With no broker listing it can never fill, yet
 * it surfaces as an A-grade buy (see auto-trade heartbeat 2026-06-02
 * us-mid: "SINCH.ST: No T212 ticker mapped"). Setting active=false
 * removes it from the scan universe (scan-engine.ts filters active:true).
 *
 * This is the documented "Group A" action from
 * scripts/disambiguate-remaining-t212-tickers.ts: null t212Ticker +
 * deactivate so the scanner stops surfacing an unfulfillable candidate.
 *
 * Idempotent. Dry-run by default; pass --apply to write. Reversible
 * (set active=true to restore).
 *
 * Usage:
 *   npx tsx scripts/deactivate-untradable-sinch.ts          # audit
 *   npx tsx scripts/deactivate-untradable-sinch.ts --apply  # write
 */

const APPLY = process.argv.includes('--apply');
const TARGETS = ['SINCH.ST', 'EVO.ST'];

async function main(): Promise<void> {
  console.log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  for (const ticker of TARGETS) {
    const stock = await prisma.stock.findFirst({
      where: { ticker },
      select: { id: true, ticker: true, name: true, active: true, t212Ticker: true },
    });

    if (!stock) {
      console.log(`  ${ticker}: not found — skipping.`);
      continue;
    }

    // Guard: never deactivate a stock that has an OPEN position.
    const openCount = await prisma.position.count({ where: { stockId: stock.id, status: 'OPEN' } });
    if (openCount > 0) {
      console.log(`  ${ticker}: has ${openCount} OPEN position(s) — REFUSING to deactivate. Resolve manually.`);
      continue;
    }

    if (!stock.active) {
      console.log(`  ${ticker}: already inactive — no change.`);
      continue;
    }

    console.log(`  ${ticker} (${stock.name}): active=true → false, t212Ticker=${stock.t212Ticker ?? 'null'} (unchanged)`);

    if (APPLY) {
      await prisma.stock.update({
        where: { id: stock.id },
        data: { active: false },
      });
      console.log(`    ✓ updated.`);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write.');
  } else {
    // Read-back verification
    console.log('\nVerification:');
    for (const ticker of TARGETS) {
      const s = await prisma.stock.findFirst({ where: { ticker }, select: { ticker: true, active: true } });
      if (s) console.log(`  ${s.ticker}: active=${s.active}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
