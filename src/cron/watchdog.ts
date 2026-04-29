/**
 * DEPENDENCIES
 * Consumed by: watchdog-task.bat, Task Scheduler
 * Consumes: prisma.ts, telegram.ts
 * Risk-sensitive: NO — monitoring only
 * Last modified: 2026-03-04
 * Notes: Lightweight watchdog that checks for missed nightly/midday heartbeats
 *        and sends a Telegram alert if the nightly hasn't run in 26+ hours.
 *        Runs daily at 10:00 AM via Task Scheduler.
 */

import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { createCronLogger } from '@/lib/cron-logger';
import { exec } from 'child_process';
import path from 'path';

const log = createCronLogger('watchdog');
const NIGHTLY_STALE_HOURS = 26;
const RECOVERY_POLL_INTERVAL_MS = 5000;
const RECOVERY_TIMEOUT_MS = 60000;
const RECOVERY_INITIAL_DELAY_MS = 10000;

/**
 * Polls /api/system-status after auto-restart to confirm the dashboard recovered.
 * Returns true when the endpoint responds OK before the timeout, false otherwise.
 */
async function waitForDashboardRecovery(): Promise<boolean> {
  // Give start.bat time to spin up Next.js before the first probe
  await new Promise((resolve) => setTimeout(resolve, RECOVERY_INITIAL_DELAY_MS));

  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('http://localhost:3000/api/system-status', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) return true;
    } catch {
      // server not ready yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_INTERVAL_MS));
  }
  return false;
}

async function runWatchdog(): Promise<void> {
  log.info('Watchdog check starting');

  const alerts: string[] = [];

  // Check nightly heartbeat
  const latestNightly = await prisma.heartbeat.findFirst({
    where: {
      status: { in: ['SUCCESS', 'FAILED', 'PARTIAL', 'OK'] },
    },
    orderBy: { timestamp: 'desc' },
  });

  if (!latestNightly) {
    alerts.push('🚨 WATCHDOG: No nightly heartbeat found at all. Has the nightly pipeline ever run?');
  } else {
    const hoursSince = (Date.now() - latestNightly.timestamp.getTime()) / (1000 * 60 * 60);
    if (hoursSince > NIGHTLY_STALE_HOURS) {
      const lastRun = latestNightly.timestamp.toISOString().replace('T', ' ').slice(0, 19);
      alerts.push(
        `🚨 WATCHDOG: No nightly heartbeat in ${Math.round(hoursSince)}+ hours. Last run: ${lastRun}. Check Task Scheduler.`
      );
    }
  }

  // Check midday sync on weekdays (Mon-Fri = 1-5)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  if (isWeekday) {
    // Check for a midday heartbeat today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const middayHeartbeat = await prisma.heartbeat.findFirst({
      where: {
        timestamp: { gte: todayStart },
        details: { contains: 'midday' },
      },
      orderBy: { timestamp: 'desc' },
    });

    // Also check for SKIPPED status (intentional skip, e.g. market closed)
    const skippedHeartbeat = await prisma.heartbeat.findFirst({
      where: {
        timestamp: { gte: todayStart },
        status: 'SKIPPED',
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!middayHeartbeat && !skippedHeartbeat && now.getHours() >= 13) {
      // Only alert after 1 PM — midday sync runs at noon
      alerts.push(
        '⚠️ WATCHDOG: No midday sync heartbeat found for today. Check Task Scheduler or midday-sync-task.bat.'
      );
    }
  }

  // Check dashboard server on weekdays during market hours (8AM-5PM UK)
  if (isWeekday && now.getHours() >= 8 && now.getHours() < 17) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('http://localhost:3000/api/system-status', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        alerts.push(
          `⚠️ WATCHDOG: Dashboard responded with HTTP ${res.status}. It may need a restart (run start.bat).`
        );
      }
    } catch {
      // Attempt auto-restart and confirm recovery before alerting
      const rootDir = path.resolve(__dirname, '..', '..');
      const startBat = path.join(rootDir, 'start.bat');
      log.warn('Dashboard not responding — attempting auto-restart via start.bat');
      exec(`start "" /min cmd /c "${startBat}"`, { cwd: rootDir });

      const recovered = await waitForDashboardRecovery();
      if (recovered) {
        log.info('Dashboard recovered after auto-restart');
        alerts.push(
          '✅ WATCHDOG: Dashboard was not responding on port 3000. Auto-restart succeeded — dashboard recovered.'
        );
      } else {
        log.error('Dashboard auto-restart failed to recover within timeout');
        alerts.push(
          '🚨 WATCHDOG: Dashboard was not responding on port 3000. Auto-restart FAILED — manual intervention required (run start.bat).'
        );
      }
    }
  }

  if (alerts.length === 0) {
    log.info('All heartbeats within expected window', { alertCount: 0 });
    return;
  }

  // Send Telegram alert
  const message = alerts.join('\n\n');
  log.warn('Sending watchdog alert', { alertCount: alerts.length });

  const sent = await sendTelegramMessage({
    text: message,
    parseMode: 'HTML',
  });

  if (sent) {
    log.info('Watchdog alert sent via Telegram');
  } else {
    log.error('Failed to send watchdog Telegram alert');
  }
}

runWatchdog()
  .catch((err) => {
    log.error('Watchdog error', { error: (err as Error).message });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
