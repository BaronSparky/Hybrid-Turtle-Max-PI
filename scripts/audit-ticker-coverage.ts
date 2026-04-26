import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

function parseTickers(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'))
    .map(l => l.split(/\s+/)[0])
    .filter(Boolean);
}

async function main() {
  const core = parseTickers('Planning/stock_core_200.txt');
  const etf = parseTickers('Planning/etf_core.txt');
  const hr = parseTickers('Planning/stock_high_risk.txt');

  const allPlanned = new Set([...core, ...etf, ...hr]);
  console.log('Planning unique tickers:', allPlanned.size);
  console.log('  CORE:', new Set(core).size, ' ETF:', new Set(etf).size, ' HIGH_RISK:', new Set(hr).size);

  const dbStocks = await prisma.stock.findMany({ select: { ticker: true, active: true, sleeve: true } });
  const dbTickers = new Set(dbStocks.map(s => s.ticker));
  const dbActive = new Set(dbStocks.filter(s => s.active).map(s => s.ticker));

  console.log('\nDB total:', dbTickers.size, '  active:', dbActive.size);

  const missingFromDB: string[] = [];
  for (const t of allPlanned) {
    if (!dbTickers.has(t)) missingFromDB.push(t);
  }
  console.log('\nMissing from DB entirely:', missingFromDB.length);
  if (missingFromDB.length > 0 && missingFromDB.length <= 50) {
    console.log('  ', missingFromDB.join(', '));
  } else if (missingFromDB.length > 50) {
    console.log('  First 50:', missingFromDB.slice(0, 50).join(', '));
    console.log('  ... and', missingFromDB.length - 50, 'more');
  }

  const inDBbutInactive: string[] = [];
  for (const t of allPlanned) {
    if (dbTickers.has(t) && !dbActive.has(t)) inDBbutInactive.push(t);
  }
  console.log('\nIn DB but INACTIVE:', inDBbutInactive.length);
  if (inDBbutInactive.length > 0) {
    console.log('  ', inDBbutInactive.join(', '));
  }

  // Check for tickers in DB but NOT in any planning file
  const inDBnotPlanned: string[] = [];
  for (const s of dbStocks) {
    if (s.active && !allPlanned.has(s.ticker)) inDBnotPlanned.push(s.ticker);
  }
  console.log('\nIn DB (active) but NOT in any Planning file:', inDBnotPlanned.length);
  if (inDBnotPlanned.length > 0 && inDBnotPlanned.length <= 20) {
    console.log('  ', inDBnotPlanned.join(', '));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
