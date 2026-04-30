/**
 * DEPENDENCIES
 * Consumed by: T212QuotaEventsPanel (dashboard)
 * Consumes: src/lib/t212-quota-log.ts (data/t212-quota-events.json)
 * Risk-sensitive: NO — read-only observability
 * Notes: Returns the rotating T212 rate-limit-low event log so the dashboard
 *        can show how often the API is being throttled.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readT212QuotaEvents } from '@/lib/t212-quota-log';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const events = await readT212QuotaEvents();
    const last24h = events.filter(
      (e) => now - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000
    );
    const rateLimitNotifications = await prisma.notification.findMany({
      where: {
        title: 'T212 Rate Limited',
        createdAt: { gte: new Date(weekAgo) },
      },
      select: { createdAt: true, data: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const notificationLast24h = rateLimitNotifications.filter(
      (notification) => notification.createdAt.getTime() >= dayAgo
    );
    const dedupedLast7d = rateLimitNotifications.filter(
      (notification) => notification.data?.includes('"_notificationDedupeKey":"t212-rate-limit:')
    );

    return NextResponse.json({
      total: events.length,
      last24h: last24h.length,
      events: events.slice(-20).reverse(), // newest first, max 20
      rateLimitNotifications: {
        last24h: notificationLast24h.length,
        last7d: rateLimitNotifications.length,
        dedupedLast7d: dedupedLast7d.length,
        latestAt: rateLimitNotifications[0]?.createdAt.toISOString() ?? null,
      },
    });
  } catch (err) {
    return apiError(500, 'T212_QUOTA_READ_FAILED', 'Failed to read T212 quota events', err instanceof Error ? err.message : String(err));
  }
}
