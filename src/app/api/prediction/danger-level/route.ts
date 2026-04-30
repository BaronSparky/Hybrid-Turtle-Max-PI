/**
 * DEPENDENCIES
 * Consumed by: DangerLevelIndicator component, dashboard
 * Consumes: threat-library.ts, api-response.ts
 * Risk-sensitive: NO — read-only danger assessment
 * Last modified: 2026-03-07
 * Notes: GET returns current danger level and top threat matches.
 *        POST seeds the threat library (if empty) or forces a reassessment.
 */

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { assessDangerLevel, seedThreatLibrary } from '@/lib/prediction/threat-library';
import { IMMUNE_ALERT_THRESHOLD } from '@/lib/prediction/danger-matcher';
import { sendAlert } from '@/lib/alert-service';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Only send danger alert once per 24 hours to prevent Telegram spam */
const DANGER_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const result = await assessDangerLevel();

    // Fire notification if danger crosses threshold — but only once per 24h
    if (result.dangerScore > IMMUNE_ALERT_THRESHOLD * 100 && result.topMatches.length > 0) {
      try {
        const lastAlert = await prisma.notification.findFirst({
          where: { type: 'DANGER_LEVEL_HIGH' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        const cooldownExpired = !lastAlert || (Date.now() - lastAlert.createdAt.getTime() > DANGER_ALERT_COOLDOWN_MS);

        if (cooldownExpired) {
          const topMatch = result.topMatches[0];
          await sendAlert({
            type: 'DANGER_LEVEL_HIGH',
            title: 'High Market Danger Detected',
            message: `Market environment pattern-matches historical danger period [${topMatch.label}] similarity: ${Math.round(topMatch.similarity * 100)}%`,
            priority: 'WARNING',
            data: { dangerScore: result.dangerScore, topMatch: topMatch.label },
            telegramDedupeKey: 'prediction:danger-level-high',
            telegramThrottleMs: DANGER_ALERT_COOLDOWN_MS,
          });
        }
      } catch {
        // Non-critical — don't break the GET response
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        dangerScore: result.dangerScore,
        immuneAlert: result.immuneAlert,
        immuneAlertThreshold: IMMUNE_ALERT_THRESHOLD * 100,
        riskTightening: result.riskTightening,
        riskTighteningPercent: Math.round(result.riskTightening * 100),
        topMatches: result.topMatches,
        environment: result.environment,
      },
    });
  } catch (error) {
    console.error('[DangerLevel] Assessment error:', (error as Error).message);
    return apiError(500, 'DANGER_LEVEL_FAILED', 'Failed to assess danger level', (error as Error).message);
  }
}

export async function POST() {
  try {
    const seeded = await seedThreatLibrary();
    const result = await assessDangerLevel();

    return NextResponse.json({
      ok: true,
      data: {
        seeded,
        dangerScore: result.dangerScore,
        immuneAlert: result.immuneAlert,
        riskTightening: result.riskTightening,
        topMatches: result.topMatches,
      },
    });
  } catch (error) {
    return apiError(500, 'DANGER_SEED_FAILED', 'Failed to seed/assess danger level', (error as Error).message);
  }
}
