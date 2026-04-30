/**
 * DEPENDENCIES
 * Consumed by: TradeAdvisorPanel component
 * Consumes: maml-trainer.ts, policy-network.ts, trade-state-encoder.ts, api-response.ts
 * Risk-sensitive: NO — advisory recommendations only
 * Last modified: 2026-03-07
 * Notes: GET returns recommended action for an open trade.
 *        POST triggers MAML retraining.
 *        Recommendations are SUGGESTIONS — human approves before execution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';
import { sendAlert } from '@/lib/alert-service';
import { prisma } from '@/lib/prisma';
import { encodeObservation, getTopFeatures, ACTIONS, ACTION_LABELS, type TradeObservation } from '@/lib/prediction/meta-rl/trade-state-encoder';
import { policyForward } from '@/lib/prediction/meta-rl/policy-network';
import { loadLatestPolicy, runMAMLTraining } from '@/lib/prediction/meta-rl/maml-trainer';

export const dynamic = 'force-dynamic';

const observationSchema = z.object({
  rMultipleCurrent: z.number(),
  daysInTrade: z.number().int().min(0),
  stopDistanceAtr: z.number().min(0),
  pyramidLevel: z.number().int().min(0).max(2),
  regimeScore: z.number(),
  vixPercentile: z.number(),
  volumeTrend3d: z.number(),
  priceVsEntryPercent: z.number(),
  currentNCS: z.number(),
  beliefWeightedNCS: z.number(),
  fm1Score: z.number(),
  fm4Score: z.number(),
  openRiskPercent: z.number(),
  correlationWithPortfolio: z.number(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    // Build observation from query params
    const obs: TradeObservation = {
      rMultipleCurrent: parseFloat(searchParams.get('rMultiple') ?? '0'),
      daysInTrade: parseInt(searchParams.get('daysInTrade') ?? '0'),
      stopDistanceAtr: parseFloat(searchParams.get('stopDistanceAtr') ?? '1.5'),
      pyramidLevel: parseInt(searchParams.get('pyramidLevel') ?? '0'),
      regimeScore: parseFloat(searchParams.get('regimeScore') ?? '50'),
      vixPercentile: parseFloat(searchParams.get('vixPercentile') ?? '50'),
      volumeTrend3d: parseFloat(searchParams.get('volumeTrend3d') ?? '1'),
      priceVsEntryPercent: parseFloat(searchParams.get('priceVsEntry') ?? '0'),
      currentNCS: parseFloat(searchParams.get('ncs') ?? '50'),
      beliefWeightedNCS: parseFloat(searchParams.get('beliefNCS') ?? '50'),
      fm1Score: parseFloat(searchParams.get('fm1') ?? '0'),
      fm4Score: parseFloat(searchParams.get('fm4') ?? '0'),
      openRiskPercent: parseFloat(searchParams.get('openRisk') ?? '5'),
      correlationWithPortfolio: parseFloat(searchParams.get('correlation') ?? '0.3'),
    };

    const vec = encodeObservation(obs);
    const { weights, trained } = await loadLatestPolicy();
    const output = policyForward(vec, weights);
    const topFeatures = getTopFeatures(vec);

    const bestAction = ACTIONS[output.bestAction];

    // Notification: RL EXIT EARLY with high confidence (item 30) — max once per 6h per ticker
    if (bestAction === 'FULL_EXIT' && output.confidence > 0.80) {
      const ticker = searchParams.get('ticker') ?? 'unknown';
      try {
        const lastAlert = await prisma.notification.findFirst({
          where: { type: 'RL_EXIT_EARLY', data: { contains: ticker } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        const cooldownExpired = !lastAlert || (Date.now() - lastAlert.createdAt.getTime() > 6 * 60 * 60 * 1000);
        if (cooldownExpired) {
          await sendAlert({
            type: 'RL_EXIT_EARLY',
            title: 'RL Advisor: Exit Recommended',
            message: `RL advisor recommends early exit: ${ticker} — ${Math.round(output.confidence * 100)}% confidence`,
            priority: 'WARNING',
            data: { ticker, confidence: output.confidence },
            telegramDedupeKey: `prediction:rl-exit-early:${ticker}`,
            telegramThrottleMs: 6 * 60 * 60 * 1000,
          });
        }
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      ok: true,
      data: {
        recommendation: bestAction,
        label: ACTION_LABELS[bestAction],
        confidence: output.confidence,
        actionProbs: Object.fromEntries(ACTIONS.map((a, i) => [a, output.actionProbs[i]])),
        topFeatures,
        modelTrained: trained,
      },
    });
  } catch (error) {
    return apiError(500, 'TRADE_REC_FAILED', 'Failed to compute trade recommendation', (error as Error).message);
  }
}

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, z.object({ force: z.boolean().optional().default(false) }));
  if (!parsed.ok) return parsed.response;

  try {
    const result = await runMAMLTraining(parsed.data.force);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return apiError(500, 'MAML_TRAINING_FAILED', 'Failed to run MAML training', (error as Error).message);
  }
}
