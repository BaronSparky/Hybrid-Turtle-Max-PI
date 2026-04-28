/**
 * Scheduled Tasks status API.
 * Returns the list of known cron tasks with their last heartbeat info.
 * Consumed by the dashboard ScheduledTasksPanel component.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Known cron task definitions (static — matches Task Scheduler registrations)
const KNOWN_TASKS = [
  { id: 'nightly', label: 'Nightly Pipeline', schedule: 'Daily 21:30', type: 'nightly' },
  { id: 'auto-trade-uk', label: 'UK Trade Session', schedule: 'Mon-Fri 08:15', type: 'auto-trade', session: 'uk' },
  { id: 'auto-trade-us', label: 'US Trade Session', schedule: 'Mon-Fri 14:45', type: 'auto-trade', session: 'us' },
  { id: 'auto-trade-usc', label: 'US Close Session', schedule: 'Mon-Fri 20:30', type: 'auto-trade', session: 'us-close' },
  { id: 'scan', label: 'Evening Scan', schedule: 'Mon-Fri 20:00', type: 'auto-trade', session: 'scan' },
  { id: 'midday-sync', label: 'Midday Sync', schedule: 'Mon-Fri 12:00', type: 'midday-sync' },
  { id: 'hourly-status', label: 'Hourly Status', schedule: 'Mon-Fri hourly', type: 'hourly-status' },
  { id: 'watchdog', label: 'Watchdog', schedule: 'Daily 10:00', type: 'watchdog' },
  { id: 'research-refresh', label: 'Research Refresh', schedule: 'Mon-Fri 22:30', type: 'research-refresh' },
  { id: 'weekly-digest', label: 'Weekly Digest', schedule: 'Sunday 18:00', type: 'weekly-digest' },
  { id: 'monday-briefing', label: 'Monday Briefing', schedule: 'Monday 07:30', type: 'monday-briefing' },
  { id: 'us-briefing', label: 'US Pre-Session', schedule: 'Tue-Fri 14:30', type: 'us-briefing' },
];

export async function GET() {
  try {
    // Fetch the latest heartbeat for each known task type
    const heartbeats = await prisma.heartbeat.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100, // Last 100 should cover all task types
      select: { status: true, timestamp: true, details: true },
    });

    const tasks = KNOWN_TASKS.map(task => {
      // Find the latest heartbeat matching this task type
      const match = heartbeats.find(h => {
        if (!h.details) return false;
        try {
          const d = JSON.parse(h.details);
          if (d.type === task.type) return true;
          // Auto-trade heartbeats include session
          if (task.type === 'auto-trade' && d.type === 'auto-trade' && d.session === task.session) return true;
          // Nightly heartbeats don't always have type — match by status patterns
          if (task.type === 'nightly' && d.startedAt && !d.type) return true;
        } catch { /* skip */ }
        return false;
      });

      const lastRun = match?.timestamp ?? null;
      const lastStatus = match?.status ?? null;
      const ageHours = lastRun ? (Date.now() - new Date(lastRun).getTime()) / 3600000 : null;

      return {
        ...task,
        lastRun,
        lastStatus,
        ageHours: ageHours !== null ? Math.round(ageHours * 10) / 10 : null,
      };
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('Scheduled tasks fetch error:', error);
    return NextResponse.json({ tasks: [], error: (error as Error).message }, { status: 500 });
  }
}
