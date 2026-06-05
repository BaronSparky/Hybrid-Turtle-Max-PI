import 'dotenv/config';
import prisma from '../src/lib/prisma';
import {
  DualT212Client,
  getCredentialsForAccount,
  validateDualCredentials,
  type T212AccountType,
} from '../src/lib/trading212-dual';

/**
 * DEPENDENCIES
 * Consumes: trading212-dual.ts (DualT212Client.fetchPendingStopOrders), prisma.ts
 * Mutates (only with --apply): Position.currentStop, Position.stopLoss
 * Risk-sensitive: YES — touches stop records on a live trading account.
 *
 * PURPOSE
 * Reconcile DB stop records against the REAL pending STOP/SELL orders held at
 * Trading 212. The sync importer historically stamped a fabricated 5%-of-entry
 * placeholder stop on manually-bought positions; this corrects those records to
 * the truth.
 *
 * SAFETY MODEL (read this before using --apply)
 * - Read-only by default. Prints a diff and exits. Writes ONLY with --apply.
 * - NEVER places, cancels, or modifies a broker order. Your actual capital
 *   protection (the live broker stop) is left exactly where it is.
 * - Only corrects DB stops that sit ABOVE the real broker stop (i.e. the DB
 *   overstates your protection — the fabricated/stale class). It moves the DB
 *   record DOWN to meet the broker stop, never below it, so real exposure is
 *   unchanged. This is a record correction, not a loosening of a real stop —
 *   which is why it intentionally bypasses the monotonic guard for this case.
 * - Where the BROKER stop is higher than the DB, it does NOT touch anything:
 *   that upward case is the sanctioned job of GET /api/stops/t212.
 * - Leaves initialRisk / protectionLevel untouched and flags them for manual
 *   review, since recomputing them is a separate, history-dependent decision.
 *
 * USAGE
 *   npx tsx scripts/reconcile-db-stops.ts                # dry-run, all positions
 *   npx tsx scripts/reconcile-db-stops.ts --ticker ELV   # dry-run, one ticker
 *   npx tsx scripts/reconcile-db-stops.ts --apply        # commit corrections
 *   npx tsx scripts/reconcile-db-stops.ts --ticker ELV --apply
 */

const EPSILON = 0.01; // sub-cent float dust is "in sync"

type Row = {
  ticker: string;
  t212Ticker: string;
  account: T212AccountType;
  dbStop: number;
  brokerStop: number | null;
  status: 'OVERSTATED' | 'BROKER_HIGHER' | 'IN_SYNC' | 'NO_BROKER_STOP';
  positionId: string;
  initialRisk: number;
};

function classify(dbStop: number, brokerStop: number | null): Row['status'] {
  if (brokerStop === null) return 'NO_BROKER_STOP';
  if (Math.abs(dbStop - brokerStop) < EPSILON) return 'IN_SYNC';
  if (dbStop > brokerStop) return 'OVERSTATED'; // DB lies high — correctable
  return 'BROKER_HIGHER'; // handled elsewhere (upward ratchet)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tickerIdx = args.indexOf('--ticker');
  const tickerFilter = tickerIdx >= 0 ? args[tickerIdx + 1]?.toUpperCase() : null;

  const userId = 'default-user';
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      t212ApiKey: true,
      t212ApiSecret: true,
      t212Environment: true,
      t212Connected: true,
      t212IsaApiKey: true,
      t212IsaApiSecret: true,
      t212IsaConnected: true,
    },
  });

  if (!user) {
    console.error('User not found — cannot load credentials.');
    process.exit(1);
  }

  const creds = validateDualCredentials(user);
  if (!creds.canFetch) {
    console.error('No T212 credentials configured. Connect an account in Settings first.');
    process.exit(1);
  }

  const dualClient = new DualT212Client(
    getCredentialsForAccount(user, 'invest'),
    getCredentialsForAccount(user, 'isa')
  );

  console.log('Reading live pending STOP/SELL orders from Trading 212…');
  const pending = await dualClient.fetchPendingStopOrders();

  // Highest broker stop per ticker, per account (defensive against duplicates).
  const brokerStopByAccount: Record<T212AccountType, Map<string, number>> = {
    invest: new Map(),
    isa: new Map(),
  };
  for (const acct of ['invest', 'isa'] as const) {
    for (const order of pending[acct]) {
      if (typeof order.stopPrice === 'number' && order.stopPrice > 0) {
        const prev = brokerStopByAccount[acct].get(order.ticker);
        if (prev === undefined || order.stopPrice > prev) {
          brokerStopByAccount[acct].set(order.ticker, order.stopPrice);
        }
      }
    }
  }

  const positions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: true },
  });

  const rows: Row[] = [];
  for (const pos of positions) {
    const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker || '';
    if (tickerFilter && pos.stock.ticker.toUpperCase() !== tickerFilter && t212Ticker.toUpperCase() !== tickerFilter) {
      continue;
    }
    const account: T212AccountType = pos.accountType === 'isa' ? 'isa' : 'invest';
    const brokerStop = t212Ticker ? brokerStopByAccount[account].get(t212Ticker) ?? null : null;
    rows.push({
      ticker: pos.stock.ticker,
      t212Ticker,
      account,
      dbStop: pos.currentStop,
      brokerStop,
      status: classify(pos.currentStop, brokerStop),
      positionId: pos.id,
      initialRisk: pos.initialRisk,
    });
  }

  if (rows.length === 0) {
    console.log(tickerFilter ? `No open position matched "${tickerFilter}".` : 'No open positions.');
    return;
  }

  // ---- Report ----
  console.log('\nDB stop vs live broker stop:\n');
  const fmt = (n: number | null) => (n === null ? '   —   ' : n.toFixed(2).padStart(9));
  for (const r of rows.sort((a, b) => a.status.localeCompare(b.status))) {
    const tag =
      r.status === 'OVERSTATED' ? 'OVERSTATED (DB > broker) → correctable'
      : r.status === 'BROKER_HIGHER' ? 'broker higher (use GET /api/stops/t212)'
      : r.status === 'IN_SYNC' ? 'in sync'
      : 'no live broker stop found';
    console.log(
      `  ${r.ticker.padEnd(8)} ${r.account.padEnd(7)} DB ${fmt(r.dbStop)}  broker ${fmt(r.brokerStop)}  ${tag}`
    );
  }

  const correctable = rows.filter((r) => r.status === 'OVERSTATED');

  if (correctable.length === 0) {
    console.log('\nNothing to correct. Every DB stop is at or below its real broker stop.');
    return;
  }

  console.log(`\n${correctable.length} position(s) have an overstated DB stop.`);

  if (!apply) {
    console.log('\nDRY-RUN — no changes written. Re-run with --apply to correct the records:');
    for (const r of correctable) {
      console.log(`  ${r.ticker}: currentStop ${r.dbStop.toFixed(2)} → ${r.brokerStop!.toFixed(2)} (DB + stopLoss only; broker order untouched)`);
      console.log(`           initialRisk left at ${r.initialRisk.toFixed(2)} — review manually if this was the entry stop.`);
    }
    return;
  }

  // ---- Apply ----
  // Raw update scoped to currentStop + stopLoss. This deliberately bypasses the
  // monotonic guard because we are correcting a fabricated record DOWN to the
  // real broker stop — actual protection (the broker order) does not change.
  console.log('\nApplying corrections (broker orders are NOT touched)…');
  for (const r of correctable) {
    const newStop = r.brokerStop!;
    await prisma.position.update({
      where: { id: r.positionId },
      data: { currentStop: newStop, stopLoss: newStop },
    });
    console.log(`  ✓ ${r.ticker}: currentStop ${r.dbStop.toFixed(2)} → ${newStop.toFixed(2)} (initialRisk unchanged: ${r.initialRisk.toFixed(2)})`);
  }
  console.log('\nDone. DB stop records now match your live broker stops.');
  console.log('Note: initialRisk values were left as-is. If an R-multiple looks off, fix that position separately.');
}

main()
  .catch((err) => {
    console.error('reconcile-db-stops failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
