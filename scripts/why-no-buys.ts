import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Read-only diagnostic: explains why auto-trade produced no buys for a given day.
 *
 * Reads the AUTO_TRADE heartbeats and prints, per session, the gate that fired
 * (regime block, health block, kill-switch, operating mode, etc.) plus any
 * per-candidate skip reasons recorded in the final heartbeat.
 *
 * Usage:
 *   tsx scripts/why-no-buys.ts            # today (local time)
 *   tsx scripts/why-no-buys.ts 2026-06-02 # a specific YYYY-MM-DD
 */

function dayBounds(dateArg?: string): { start: Date; end: Date; label: string } {
  const base = dateArg ? new Date(`${dateArg}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid date: "${dateArg}". Use YYYY-MM-DD.`);
  }
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
  const label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return { start, end, label };
}

interface ParsedDetails {
  type?: string;
  session?: string;
  reason?: string;
  message?: string;
  holiday?: string;
  closeTime?: string;
  scanned?: number;
  ready?: number;
  eligible?: number;
  executed?: number;
  failed?: number;
  unprotected?: number;
  skipped?: number;
  skipReasons?: { ticker: string; reason: string }[];
  trades?: { ticker: string; success: boolean; stopPlaced: boolean }[];
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function main(): Promise<void> {
  const dateArg = process.argv[2];
  const { start, end, label } = dayBounds(dateArg);

  console.log(`\n=== Why no buys? — ${label} ===\n`);

  // 1. Auto-trade heartbeats for the day
  const beats = await prisma.heartbeat.findMany({
    where: { kind: 'AUTO_TRADE', timestamp: { gte: start, lte: end } },
    orderBy: { timestamp: 'asc' },
  });

  if (beats.length === 0) {
    console.log('No AUTO_TRADE heartbeats found for this day.');
    console.log('Likely meaning: the auto-trade cron did not run (weekend, machine off,');
    console.log('scheduled task disabled, or the date has no activity).\n');
  } else {
    console.log(`Found ${beats.length} auto-trade run(s):\n`);
    for (const b of beats) {
      let d: ParsedDetails = {};
      try { d = JSON.parse(b.details ?? '{}'); } catch { /* leave empty */ }

      const sess = d.session ?? '(unknown)';
      console.log(`• ${fmtTime(b.timestamp)}  session=${sess}  status=${b.status}`);

      // Early-exit gates write a `reason` field.
      if (d.reason) {
        console.log(`    GATE: ${d.reason}${d.message ? ` — ${d.message}` : ''}` +
          `${d.holiday ? ` (${d.holiday})` : ''}${d.closeTime ? ` (close ${d.closeTime})` : ''}`);
      }

      // Full-run summary (got past all global gates).
      if (typeof d.executed === 'number' || typeof d.eligible === 'number') {
        console.log(`    scanned=${d.scanned ?? '?'} ready=${d.ready ?? '?'} ` +
          `eligible=${d.eligible ?? '?'} executed=${d.executed ?? 0} ` +
          `failed=${d.failed ?? 0} skipped=${d.skipped ?? 0}`);

        if (d.executed === 0) {
          if ((d.eligible ?? 0) === 0) {
            console.log('    → No eligible (A-grade, TRIGGERED) candidates this session.');
          } else {
            console.log('    → Candidates were eligible but all were skipped (see reasons below).');
          }
        }

        if (d.skipReasons && d.skipReasons.length > 0) {
          console.log('    Per-candidate skip reasons:');
          for (const s of d.skipReasons) {
            console.log(`      - ${s.ticker}: ${s.reason}`);
          }
        }

        if (d.trades && d.trades.length > 0) {
          console.log('    Trades:');
          for (const t of d.trades) {
            console.log(`      - ${t.ticker}: ${t.success ? 'BUY OK' : 'FAILED'}` +
              `${t.success ? (t.stopPlaced ? ' (stop placed)' : ' (NO STOP)') : ''}`);
          }
        }
      }
      console.log('');
    }
  }

  // 2. Latest health record (fail-closed gate)
  const health = await prisma.heartbeat.findFirst({
    where: { kind: 'NIGHTLY', timestamp: { lte: end } },
    orderBy: { timestamp: 'desc' },
  });
  console.log('--- Context ---');
  if (health) {
    const ageH = (end.getTime() - health.timestamp.getTime()) / 3_600_000;
    console.log(`Last NIGHTLY heartbeat: ${health.timestamp.toLocaleString('en-GB')} ` +
      `(${ageH.toFixed(1)}h before end of day, status=${health.status})`);
    if (ageH > 30) console.log('  ⚠ Stale (>30h): would fail-close the health gate and block buys.');
  } else {
    console.log('No NIGHTLY heartbeat found before this day — health gate would fail-closed (blocks buys).');
  }

  // 3. Open position count
  const openPositions = await prisma.position.count({ where: { status: 'OPEN' } }).catch(() => null);
  if (openPositions !== null) {
    console.log(`Open positions (status=OPEN): ${openPositions}`);
  }

  console.log('\nInterpretation:');
  console.log('  - A `reason` like `regime-SIDEWAYS` / `regime-BEARISH` = the master regime gate blocked all buys.');
  console.log('  - `kill-switch`, `operating-mode-*`, `no-t212`, `weekend`, `market-holiday`,');
  console.log('    `early-close` = a global gate exited before scoring any candidate.');
  console.log('  - eligible=0 = regime was fine but no candidate was A-grade AND triggered (price >= entryTrigger).');
  console.log('  - skipReasons list = candidates were eligible but each blocked (extended, live-price, earnings, etc).');
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
