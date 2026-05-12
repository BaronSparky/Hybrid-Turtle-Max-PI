/**
 * Standalone runner for the stop-broker-sync check.
 *
 * Wraps `checkStopBrokerSync` so the operator can verify the
 * sacred-adjacent stop-broker reconciliation surface without firing
 * off the rest of nightly.ts (which scans, snapshots, and alerts).
 *
 * Always runs with `autoCorrect=false` — this script is read-only.
 * The nightly cron remains the only path that can auto-correct
 * DB stops to match the broker.
 *
 * Usage:
 *   npx tsx scripts/verify-stop-broker-sync.ts
 *
 * Exit codes:
 *   0  — check completed (mismatches printed if any)
 *   1  — check itself failed (auth, no clients, etc.)
 *
 * Environment:
 *   SANITY_USER_ID — user whose T212 credentials are used
 *                     (defaults to `default-user`)
 */

import 'dotenv/config';
// Skip the heavy startup pre-cache — this script is a quick read-only check.
// Mirrors the same env flag set by src/cron/midday-sync.ts.
process.env.HYBRIDTURTLE_SKIP_STARTUP_PRECACHE = 'true';

import { PrismaClient } from '@prisma/client';
import { Trading212Client } from '../src/lib/trading212';
import { decryptField } from '../src/lib/crypto';
import { checkStopBrokerSync } from '../src/lib/stop-broker-sync-check';
import type { T212AccountType } from '../src/lib/trading212-dual';

const prisma = new PrismaClient();
const USER_ID = process.env.SANITY_USER_ID || 'default-user';

async function buildClient(userId: string, accountType: T212AccountType): Promise<Trading212Client | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      t212ApiKey: true, t212ApiSecret: true, t212Environment: true, t212Connected: true,
      t212IsaApiKey: true, t212IsaApiSecret: true, t212IsaConnected: true,
    },
  });
  if (!user) return null;
  if (accountType === 'isa') {
    if (!user.t212IsaApiKey || !user.t212IsaConnected) return null;
    return new Trading212Client(
      decryptField(user.t212IsaApiKey),
      decryptField(user.t212IsaApiSecret ?? ''),
      user.t212Environment as 'demo' | 'live',
    );
  }
  if (!user.t212ApiKey || !user.t212Connected) return null;
  return new Trading212Client(
    decryptField(user.t212ApiKey),
    decryptField(user.t212ApiSecret ?? ''),
    user.t212Environment as 'demo' | 'live',
  );
}

async function main() {
  console.log(`[verify-stop-broker-sync] read-only check for user '${USER_ID}'\n`);

  const clients: { type: string; client: Trading212Client }[] = [];
  for (const acctType of ['invest', 'isa'] as T212AccountType[]) {
    const client = await buildClient(USER_ID, acctType);
    if (client) {
      clients.push({ type: acctType, client });
      console.log(`  Client connected: ${acctType}`);
    } else {
      console.log(`  No connected ${acctType} account.`);
    }
  }

  if (clients.length === 0) {
    console.error('\nNo connected T212 clients — nothing to compare.');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('\n  Comparing DB stops against T212 pending orders...\n');
  const report = await checkStopBrokerSync(clients, false); // autoCorrect=false

  console.log(`  Checked:    ${report.checked} open position(s) with T212 ticker mappings`);
  console.log(`  Mismatches: ${report.mismatches.length}`);
  console.log(`  Corrected:  ${report.corrected} (always 0 in dry-run)`);
  console.log(`  Errors:     ${report.errors.length}`);

  if (report.errors.length > 0) {
    console.log('\n  --- Errors ---');
    for (const err of report.errors) {
      console.log(`    ${err}`);
    }
  }

  if (report.mismatches.length > 0) {
    console.log('\n  --- Mismatches ---');
    for (const m of report.mismatches) {
      const dir =
        m.driftDirection === 'NO_BROKER_STOP'
          ? 'NO T212 STOP'
          : `DB:$${m.dbStop.toFixed(2)} vs T212:$${m.brokerStop?.toFixed(2)} (${m.driftPct.toFixed(1)}% drift, ${m.driftDirection})`;
      console.log(`    ⚠ ${m.ticker.padEnd(10)} ${dir}`);
    }
    console.log(
      '\n  Mismatches found — the nightly cron would auto-correct DB_HIGHER cases.',
    );
    console.log(
      '  This script does not write. Run `npx tsx src/cron/nightly.ts` to apply corrections,',
    );
    console.log(
      '  or fix individually via the dashboard / direct DB update.',
    );
  } else {
    console.log('\n  ✓ DB stops in sync with T212 pending orders.');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[verify-stop-broker-sync] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
