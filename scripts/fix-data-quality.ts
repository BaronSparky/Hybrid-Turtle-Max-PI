import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) console.log('🔍 DRY RUN — no changes will be made\n');

  // Fix 4: Delete phantom 10000 equity snapshot (seed artifact — not real trading history)
  const phantomCount = await prisma.equitySnapshot.count({ where: { equity: 10000 } });
  console.log(`Phantom equity snapshots to delete: ${phantomCount}`);
  if (!DRY_RUN && phantomCount > 0) {
    const deleted = await prisma.equitySnapshot.deleteMany({ where: { equity: 10000 } });
    console.log('Phantom equity snapshots deleted:', deleted.count);
  }

  // Fix 5: Deactivate stale tickers that fail Yahoo data fetch (delisted/renamed)
  const staleTickers = ['ANSS', 'NEP', 'NOVA', 'K', 'CATT.L', 'ERF', 'TKWY.AS', 'ROIC', 'IDEX', 'BRFS', 'SBA', 'ZI', 'ALTR', 'FRG', 'BAE.L'];
  let deactivated = 0;
  for (const t of staleTickers) {
    const active = await prisma.stock.count({ where: { ticker: t, active: true } });
    if (active > 0) {
      if (DRY_RUN) {
        console.log('  Would deactivate:', t);
      } else {
        await prisma.stock.updateMany({ where: { ticker: t, active: true }, data: { active: false } });
        console.log('  Deactivated:', t);
      }
      deactivated++;
    }
  }
  console.log(`${DRY_RUN ? 'Would deactivate' : 'Deactivated'} ${deactivated} stale tickers.`);

  // Verify
  const activeCount = await prisma.stock.count({ where: { active: true } });
  const snapCount = await prisma.equitySnapshot.count();
  const latestSnap = await prisma.equitySnapshot.findFirst({ orderBy: { capturedAt: 'desc' }, select: { equity: true } });
  console.log(`\nActive stocks now: ${activeCount}`);
  console.log(`Equity snapshots remaining: ${snapCount}`);
  console.log(`Latest equity: £${latestSnap?.equity ?? 'none'}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
