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

export async function GET() {
  try {
    const events = await readT212QuotaEvents();
    const last24h = events.filter(
      (e) => Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000
    );
    return NextResponse.json({
      total: events.length,
      last24h: last24h.length,
      events: events.slice(-20).reverse(), // newest first, max 20
    });
  } catch (err) {
    return apiError(500, 'T212_QUOTA_READ_FAILED', 'Failed to read T212 quota events', err instanceof Error ? err.message : String(err));
  }
}
