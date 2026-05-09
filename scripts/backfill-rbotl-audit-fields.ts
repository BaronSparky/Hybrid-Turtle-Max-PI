/**
 * Backfill RBOTl audit fields after manual broker-sync entry
 *
 * The 8 May 2026 manual buy of RBOTl was synced from T212 with a custom
 * stop ($19.81), but broker-sync defaulted the audit-trail fields
 * (initial_stop, initialRisk, initial_R) to its 5%-of-entry fallback. The
 * live stop is correct and protective; only R-attribution reports are off.
 *
 * This script aligns initial_stop and initialRisk to the actual entry-to-stop
 * distance derived from the StopHistory INITIAL row, leaving every other
 * field untouched.
 *
 * Idempotent and read-by-default.
 *
 * Usage:
 *   npx tsx scripts/backfill-rbotl-audit-fields.ts            # dry run
 *   npx tsx scripts/backfill-rbotl-audit-fields.ts --apply    # write to DB
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes' : '🔧 APPLY MODE — will update DB');
  console.log('');

  const pos = await prisma.position.findFirst({
    where: { stock: { ticker: 'RBOTl' }, status: 'OPEN' },
    include: { stock: { select: { ticker: true } } },
  });
  if (!pos) {
    console.log('No OPEN RBOTl position found — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // Use the canonical INITIAL stop from StopHistory rather than the live
  // stopLoss field (which can have advanced past INITIAL by the time this
  // script runs). For RBOTl the dashboard-applied INITIAL row is the
  // authoritative stop the user set at entry.
  const initialStopHistory = await prisma.stopHistory.findFirst({
    where: { positionId: pos.id, level: 'INITIAL' },
    orderBy: { createdAt: 'desc' },
  });

  const authoritativeStop = initialStopHistory ? Number(initialStopHistory.newStop) : Number(pos.stopLoss);
  const entryPrice = Number(pos.entryPrice);
  const shares = Number(pos.shares);

  if (!entryPrice || !authoritativeStop || !shares) {
    console.log('  Missing entry price, stop, or shares — refusing to compute.');
    await prisma.$disconnect();
    return;
  }
  if (authoritativeStop >= entryPrice) {
    console.log(`  Authoritative stop ${authoritativeStop} >= entry ${entryPrice}; refusing.`);
    await prisma.$disconnect();
    return;
  }

  const perShareRisk = entryPrice - authoritativeStop;
  const totalRisk = Math.round(perShareRisk * shares * 10000) / 10000;
  const correctedInitialStop = Math.round(authoritativeStop * 10000) / 10000;
  const correctedInitialR = Math.round(perShareRisk * 10000) / 10000;

  console.log(`Position: ${pos.stock.ticker} (id=${pos.id})`);
  console.log(`  entryPrice:     ${entryPrice}`);
  console.log(`  shares:         ${shares}`);
  console.log(`  authoritative stop (from INITIAL StopHistory): ${authoritativeStop}`);
  console.log('');
  console.log('  CURRENT audit-trail fields:');
  console.log(`    initial_stop  ${pos.initial_stop}`);
  console.log(`    initialRisk   ${pos.initialRisk}`);
  console.log(`    initial_R     ${pos.initial_R}`);
  console.log('');
  console.log('  PROPOSED audit-trail fields:');
  console.log(`    initial_stop  ${correctedInitialStop}`);
  console.log(`    initialRisk   ${correctedInitialR}  (per-share)`);
  console.log(`    initial_R     ${correctedInitialR}  (per-share, alias)`);
  console.log(`    total $ risk  ${totalRisk}  across ${shares} shares`);

  const noChange =
    Number(pos.initial_stop) === correctedInitialStop &&
    Number(pos.initialRisk) === correctedInitialR &&
    Number(pos.initial_R) === correctedInitialR;
  if (noChange) {
    console.log('');
    console.log('  Already aligned — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log('');
    console.log('  Re-run with --apply to write these values.');
  } else {
    await prisma.position.update({
      where: { id: pos.id },
      data: {
        initial_stop: correctedInitialStop,
        initialRisk: correctedInitialR,
        initial_R: correctedInitialR,
      },
    });
    console.log('');
    console.log('  ✅ Updated.');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
