// ============================================================
// Sync Yahoo Ticker Mappings → Stock.yahooTicker column
// ============================================================
// Run: npx tsx prisma/sync-yahoo-tickers.ts
// Populates the yahooTicker column for non-US stocks that need
// an explicit Yahoo Finance symbol different from their DB ticker.
// ============================================================

import { PrismaClient } from '@prisma/client';
import { YAHOO_TICKER_MAP } from '../src/lib/ticker-maps';

const prisma = new PrismaClient();

async function main() {
  console.log('Syncing Yahoo ticker mappings...\n');

  let updated = 0;
  let skipped = 0;

  for (const [dbTicker, yahooTicker] of Object.entries(YAHOO_TICKER_MAP)) {
    const stock = await prisma.stock.findUnique({ where: { ticker: dbTicker } });
    if (!stock) {
      console.log(`  SKIP  ${dbTicker} — not in database`);
      skipped++;
      continue;
    }

    if (stock.yahooTicker === yahooTicker) {
      console.log(`  OK    ${dbTicker} → ${yahooTicker} (already set)`);
      continue;
    }

    await prisma.stock.update({
      where: { ticker: dbTicker },
      data: { yahooTicker },
    });
    console.log(`  SET   ${dbTicker} → ${yahooTicker}`);
    updated++;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (not in DB)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
