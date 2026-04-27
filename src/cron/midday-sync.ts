/**
 * DEPENDENCIES
 * Consumed by: midday-sync-task.bat, Windows Task Scheduler
 * Consumes: position-sync.ts, prisma.ts, telegram.ts
 * Risk-sensitive: YES — auto-closes positions based on T212 state
 * Last modified: 2026-03-02
 * Notes: Lightweight intra-day sync — only runs position detection (no stops, no scans).
 *        Designed to run every 2-3 hours during market hours so stop-outs are detected quickly.
 */

import prisma from '@/lib/prisma';
import { syncClosedPositions } from '@/lib/position-sync';
import type { PositionSyncResult } from '@/lib/position-sync';
import { sendAlert } from '@/lib/alert-service';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek } from '@/lib/uk-time';

const log = createCronLogger('midday-sync');

async function runMiddaySync() {
  const userId = 'default-user';

  log.info('Midday position sync started');

  // Skip weekends (UK time)
  const ukDay = getUKDayOfWeek();
  if (ukDay === 0 || ukDay === 6) {
    console.log('  Weekend — skipping sync.');
    await prisma.heartbeat.create({
      data: {
        status: 'SKIPPED',
        details: JSON.stringify({ type: 'midday-sync', reason: 'weekend', ranAt: new Date().toISOString() }),
      },
    });
    await prisma.$disconnect();
    return;
  }

  let result: PositionSyncResult = { checked: 0, closed: 0, skipped: 0, updated: 0, errors: [] };

  try {
    // Check if there are open positions to sync
    const openCount = await prisma.position.count({ where: { userId, status: 'OPEN' } });
    if (openCount === 0) {
      console.log('  No open positions — nothing to sync.');
      await prisma.heartbeat.create({
        data: {
          status: 'SKIPPED',
          details: JSON.stringify({ type: 'midday-sync', reason: 'no-open-positions', ranAt: new Date().toISOString() }),
        },
      });
      await prisma.$disconnect();
      return;
    }

    console.log(`  ${openCount} open position(s) — syncing against Trading 212...`);
    result = await syncClosedPositions(userId);

    console.log(`  Result: ${result.checked} checked, ${result.closed} closed, ${result.skipped} skipped, ${result.updated} updated`);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.warn(`  Warning: ${err}`);
      }
    }

    if (result.closed > 0) {
      console.log(`  ** ${result.closed} position(s) detected as closed in T212 **`);
      // Alert is already sent by syncClosedPositions — just log for the batch file
    }

    // Write a heartbeat so the dashboard knows the midday sync ran
    await prisma.heartbeat.create({
      data: {
        status: 'OK',
        details: JSON.stringify({
          type: 'midday-sync',
          ranAt: new Date().toISOString(),
          checked: result.checked,
          closed: result.closed,
          errors: result.errors,
        }),
      },
    });

  } catch (error) {
    const msg = (error as Error).message;
    log.error('Midday sync failed', { error: msg });

    // Send alert on failure so the user knows
    try {
      await sendAlert({
        type: 'SYSTEM',
        title: 'Midday position sync failed',
        message: `The intra-day T212 position sync failed.\n\nError: ${msg}\n\nYour nightly sync at 9 PM will still run. You can also click Sync manually in the dashboard.`,
        data: { error: msg },
        priority: 'WARNING',
      });
    } catch {
      // Alert itself failed — just log
      console.error('  Could not send failure alert.');
    }
  } finally {
    await prisma.$disconnect();
  }

  log.info('Midday sync finished', { checked: result.checked, closed: result.closed, errors: result.errors.length });
}


// ── Entry point ──────────────────────────────────────────────────────
runMiddaySync().catch((err) => {
  console.error('Fatal error in midday sync:', err);
  process.exit(1);
});
