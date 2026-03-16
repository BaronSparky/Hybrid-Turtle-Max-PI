export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { WeeklyPhase } from '@/types';
import { getCurrentWeeklyPhase } from '@/types';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const createPlanSchema = z.object({
  userId: z.string().trim().min(1),
  candidates: z.array(z.unknown()).optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return apiError(400, 'INVALID_REQUEST', 'userId is required');
    }

    const currentPhase = getCurrentWeeklyPhase();

    // Get the latest plan for this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const plan = await prisma.executionPlan.findFirst({
      where: {
        userId,
        weekOf: { gte: weekStart },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      currentPhase,
      plan,
      weekStart,
    });
  } catch (error) {
    console.error('Plan error:', error);
    return apiError(500, 'PLAN_FETCH_FAILED', 'Failed to fetch plan', (error as Error).message, true);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, createPlanSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { userId, candidates, notes } = parsed.data;
    const candidatesJson = JSON.stringify(candidates ?? []);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const plan = await prisma.executionPlan.create({
      data: {
        userId,
        weekOf: weekStart,
        phase: getCurrentWeeklyPhase() as WeeklyPhase,
        candidates: candidatesJson,
        notes,
      },
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    console.error('Create plan error:', error);
    return apiError(500, 'PLAN_CREATE_FAILED', 'Failed to create plan', (error as Error).message, true);
  }
}
