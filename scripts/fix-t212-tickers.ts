/**
 * Fix: Populate t212Ticker for US stocks and open positions.
 *
 * Run: npx tsx scripts/fix-t212-tickers.ts
 *
 * - US stocks without .L/.DE/.PA etc. suffix get t212Ticker = "{TICKER}_US_EQ"
 * - Open positions with known T212 tickers get mapped
 * - Does NOT overwrite existing t212Ticker values
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Known T212 ticker mappings for open positions (manually verified)
const OPEN_POSITION_MAPPINGS: Record<string, string> = {
  'APLS': 'APLS_US_EQ',
  'GEV': 'GEV_US_EQ',
  'SLAB': 'SLAB_US_EQ',
  'DPLMl': 'DPLM_LSE_EQ',  // Diploma PLC on LSE
};

// Non-US suffixes — stocks with these are NOT US equities
const NON_US_SUFFIXES = ['.L', '.DE', '.PA', '.MI', '.MC', '.AS', '.CO', '.ST', '.HE', '.AX', '.SW', '.TO', '.V', '.SI', '.HK', '.T', '.KS', '.TW', '.SA', '.MX', '.WA', '.PR', '.IS', '.TA', '.JO', '.NS', '.BO', '.KL', '.BK', '.JK'];

function isUSStock(ticker: string): boolean {
  return !NON_US_SUFFIXES.some(suffix => ticker.endsWith(suffix));
}

async function main() {
  console.log('[fix-t212-tickers] Starting T212 ticker mapping fix...\n');

  // 1. Fix open positions with known mappings
  console.log('--- Open Position Mappings ---');
  for (const [ticker, t212Ticker] of Object.entries(OPEN_POSITION_MAPPINGS)) {
    const stock = await prisma.stock.findUnique({ where: { ticker }, select: { id: true, t212Ticker: true } });
    if (!stock) {
      console.log(`  SKIP ${ticker}: not found in DB`);
      continue;
    }
    if (stock.t212Ticker) {
      console.log(`  SKIP ${ticker}: already mapped to ${stock.t212Ticker}`);
      continue;
    }
    await prisma.stock.update({ where: { ticker }, data: { t212Ticker } });
    console.log(`  SET  ${ticker} → ${t212Ticker}`);
  }

  // 2. Bulk-set US stocks without t212Ticker
  console.log('\n--- US Stock Bulk Mapping ---');
  const unmapped = await prisma.stock.findMany({
    where: { active: true, t212Ticker: null },
    select: { id: true, ticker: true },
  });

  let usCount = 0;
  let skipCount = 0;

  for (const stock of unmapped) {
    if (!isUSStock(stock.ticker)) {
      skipCount++;
      continue;
    }
    const t212Ticker = `${stock.ticker}_US_EQ`;
    await prisma.stock.update({ where: { id: stock.id }, data: { t212Ticker } });
    usCount++;
  }

  console.log(`  Mapped ${usCount} US stocks to {TICKER}_US_EQ`);
  console.log(`  Skipped ${skipCount} non-US stocks (need manual mapping)`);

  // 3. Summary
  const total = await prisma.stock.count({ where: { active: true } });
  const withT212 = await prisma.stock.count({ where: { active: true, t212Ticker: { not: null } } });
  const withoutT212 = await prisma.stock.count({ where: { active: true, t212Ticker: null } });

  console.log(`\n--- Summary ---`);
  console.log(`  Active stocks:      ${total}`);
  console.log(`  With t212Ticker:    ${withT212}`);
  console.log(`  Without t212Ticker: ${withoutT212}`);

  // 4. Verify open positions
  console.log('\n--- Open Position Verification ---');
  const openPositions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    include: { stock: { select: { ticker: true, t212Ticker: true } } },
  });
  for (const pos of openPositions) {
    const status = pos.stock.t212Ticker ? '✓' : '✗ UNMAPPED';
    console.log(`  ${status} ${pos.stock.ticker} → ${pos.stock.t212Ticker || 'null'}`);
  }

  console.log('\n[fix-t212-tickers] Done.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
