import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Fix 4: Delete phantom 10000 equity snapshot (seed artifact — not real trading history)
  const deleted = await prisma.equitySnapshot.deleteMany({ where: { equity: 10000 } });
  console.log('Phantom equity snapshots deleted:', deleted.count);

  // Fix 5: Deactivate stale tickers that fail Yahoo data fetch (delisted/renamed)
  const staleTickers = ['ANSS', 'NEP', 'NOVA', 'K', 'CATT.L', 'ERF', 'TKWY.AS', 'ROIC', 'IDEX', 'BRFS', 'SBA', 'ZI', 'ALTR', 'FRG', 'BAE.L'];
  let deactivated = 0;
  for (const t of staleTickers) {
    const r = await prisma.stock.updateMany({ where: { ticker: t, active: true }, data: { active: false } });
    if (r.count > 0) {
      console.log('  Deactivated:', t);
      deactivated++;
    }
  }
  console.log(`Deactivated ${deactivated} stale tickers.`);

  // Verify
  const activeCount = await prisma.stock.count({ where: { active: true } });
  const snapCount = await prisma.equitySnapshot.count();
  const latestSnap = await prisma.equitySnapshot.findFirst({ orderBy: { capturedAt: 'desc' }, select: { equity: true } });
  console.log(`\nActive stocks now: ${activeCount}`);
  console.log(`Equity snapshots remaining: ${snapCount}`);
  console.log(`Latest equity: £${latestSnap?.equity ?? 'none'}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
