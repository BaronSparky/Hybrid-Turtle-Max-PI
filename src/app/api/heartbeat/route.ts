export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    // Support ?type= filter for specific heartbeat types (e.g. weekly-digest)
    const typeFilter = request.nextUrl.searchParams.get('type');

    if (typeFilter) {
      const heartbeats = await prisma.heartbeat.findMany({
        where: { details: { contains: typeFilter } },
        orderBy: { timestamp: 'desc' },
        take: 1,
      });
      return NextResponse.json({
        heartbeats: heartbeats.map(h => ({
          timestamp: h.timestamp,
          status: h.status,
          details: h.details,
        })),
      });
    }

    const heartbeat = await prisma.heartbeat.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    if (!heartbeat) {
      return NextResponse.json({
        lastHeartbeat: null,
        status: 'UNKNOWN',
        ageHours: null,
        details: null,
      });
    }

    const ageHours = (Date.now() - heartbeat.timestamp.getTime()) / (1000 * 60 * 60);

    return NextResponse.json({
      lastHeartbeat: heartbeat.timestamp,
      status: heartbeat.status,
      ageHours,
      details: heartbeat.details ? JSON.parse(heartbeat.details) : null,
    });
  } catch (error) {
    console.error('Heartbeat fetch error:', error);
    return apiError(500, 'HEARTBEAT_FETCH_FAILED', 'Failed to fetch heartbeat', (error as Error).message, true);
  }
}

// POST /api/heartbeat — record a heartbeat (called on app startup + nightly)
export async function POST(_request: NextRequest) {
  try {
    const heartbeat = await prisma.heartbeat.create({
      data: {
        status: 'OK',
        details: JSON.stringify({ source: 'app-startup', timestamp: new Date().toISOString() }),
      },
    });

    return NextResponse.json({
      lastHeartbeat: heartbeat.timestamp,
      status: heartbeat.status,
    });
  } catch (error) {
    console.error('Heartbeat record error:', error);
    return apiError(500, 'HEARTBEAT_RECORD_FAILED', 'Failed to record heartbeat', (error as Error).message, true);
  }
}
