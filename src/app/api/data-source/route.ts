export const dynamic = 'force-dynamic';

/**
 * DEPENDENCIES
 * Consumed by: DataSourceTile.tsx (dashboard)
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only reporting
 * Last modified: 2026-03-01
 * Notes: Returns data source health from the latest heartbeat.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getDataFreshness } from '@/lib/market-data';
import { getT212ApiStats } from '@/lib/position-sync';

interface DataSourceResponse {
  health: 'LIVE' | 'PARTIAL' | 'DEGRADED' | 'UNKNOWN';
  staleTickers: string[];
  maxStalenessHours: number;
  summary: string;
  lastYahooSuccess: string | null;
  freshness?: {
    source: 'LIVE' | 'CACHE' | 'STALE_CACHE';
    ageMinutes: number;
    lastFetchTime: string | null;
  };
  t212?: {
    callsLastHour: number;
    lastCallAt: string | null;
    cacheSize: number;
    cacheAgeSeconds: number;
  };
}

export async function GET() {
  // Collect in-memory freshness data regardless of heartbeat status
  const freshness = getDataFreshness();
  const freshnessPayload = {
    source: freshness.source,
    ageMinutes: freshness.ageMinutes,
    lastFetchTime: freshness.lastFetchTimestamp > 0
      ? new Date(freshness.lastFetchTimestamp).toISOString()
      : null,
  };

  // T212 API usage stats
  const t212Stats = getT212ApiStats();
  const t212Payload = {
    callsLastHour: t212Stats.callsLastHour,
    lastCallAt: t212Stats.lastCallAt ? new Date(t212Stats.lastCallAt).toISOString() : null,
    cacheSize: t212Stats.cacheSize,
    cacheAgeSeconds: t212Stats.cacheAge,
  };

  try {
    // Find the most recent heartbeat with details
    const heartbeat = await prisma.heartbeat.findFirst({
      where: { status: { in: ['SUCCESS', 'FAILED'] } },
      orderBy: { timestamp: 'desc' },
    });

    if (!heartbeat?.details) {
      return NextResponse.json<DataSourceResponse>({
        health: 'UNKNOWN',
        staleTickers: [],
        maxStalenessHours: 0,
        summary: 'No heartbeat data available',
        lastYahooSuccess: null,
        freshness: freshnessPayload,
      t212: t212Payload,
      });
    }

    let details: Record<string, unknown>;
    try {
      details = JSON.parse(heartbeat.details) as Record<string, unknown>;
    } catch {
      return NextResponse.json<DataSourceResponse>({
        health: 'UNKNOWN',
        staleTickers: [],
        maxStalenessHours: 0,
        summary: 'Heartbeat details unparseable',
        lastYahooSuccess: null,
        freshness: freshnessPayload,
      t212: t212Payload,
      });
    }

    const ds = details.dataSource as {
      health?: string;
      staleTickers?: string[];
      maxStalenessHours?: number;
      summary?: string;
    } | undefined;

    if (!ds || !ds.health) {
      // Pre-upgrade heartbeat — assume live data
      return NextResponse.json<DataSourceResponse>({
        health: 'LIVE',
        staleTickers: [],
        maxStalenessHours: 0,
        summary: 'Pre-upgrade heartbeat — assumed live',
        lastYahooSuccess: heartbeat.timestamp.toISOString(),
        freshness: freshnessPayload,
      t212: t212Payload,
      });
    }

    // Find the last heartbeat where data was LIVE (all Yahoo)
    let lastYahooSuccess: string | null = null;
    try {
      const successHeartbeats = await prisma.heartbeat.findMany({
        where: { status: 'SUCCESS' },
        orderBy: { timestamp: 'desc' },
        take: 10,
        select: { details: true, timestamp: true },
      });
      for (const hb of successHeartbeats) {
        if (!hb.details) continue;
        try {
          const d = JSON.parse(hb.details) as Record<string, unknown>;
          const hbDs = d.dataSource as { health?: string } | undefined;
          // Pre-upgrade heartbeats or LIVE health both count as Yahoo success
          if (!hbDs || hbDs.health === 'LIVE') {
            lastYahooSuccess = hb.timestamp.toISOString();
            break;
          }
        } catch { continue; }
      }
    } catch {
      // Non-critical — last Yahoo timestamp just won't show
    }

    const health = (['LIVE', 'PARTIAL', 'DEGRADED'].includes(ds.health)
      ? ds.health
      : 'UNKNOWN') as DataSourceResponse['health'];

    return NextResponse.json<DataSourceResponse>({
      health,
      staleTickers: ds.staleTickers ?? [],
      maxStalenessHours: ds.maxStalenessHours ?? 0,
      summary: ds.summary ?? '',
      lastYahooSuccess,
      freshness: freshnessPayload,
      t212: t212Payload,
    });
  } catch (error) {
    console.error('[API] Data source status error:', (error as Error).message);
    return NextResponse.json<DataSourceResponse>({
      health: 'UNKNOWN',
      staleTickers: [],
      maxStalenessHours: 0,
      summary: 'API error',
      lastYahooSuccess: null,
      freshness: freshnessPayload,
      t212: t212Payload,
    });
  }
}
