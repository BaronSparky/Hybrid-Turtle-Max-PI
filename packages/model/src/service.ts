/**
 * DEPENDENCIES
 * Consumed by: packages/model/src/index.ts, src/app/api/models/*, src/app/api/scan/route.ts, scripts/verify-phase12.ts
 * Consumes: src/types/index.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 12 model-service boundary implemented in TypeScript. Advisory only — never bypasses or mutates sacred execution logic.
 */
import type { MarketRegime, ScanCandidate } from '../../../src/types';
import type {
  CandidateModelPrediction,
  CandidateModelResult,
  ModelLayerSettings,
  ModelVersionManifest,
  RegimePrediction,
} from './types';

import { round } from '../../data/src/prisma';

const DEFAULT_BLEND_WEIGHT = 0.35;

export const MODEL_VERSIONS: ModelVersionManifest = {
  candidateModelVersion: 'boosted-candidate-v1',
  breakoutModelVersion: 'breakout-prob-v1',
  regimeModelVersion: 'regime-classifier-v1',
  ensembleVersion: 'blend-v1',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function normalizeStatus(status: string): number {
  if (status === 'READY') return 1;
  if (status === 'WATCH' || status === 'WAIT_PULLBACK') return 0.6;
  return 0.2;
}

function getPredictionSettings(settings?: ModelLayerSettings): Required<ModelLayerSettings> {
  return {
    enabled: settings?.enabled ?? false,
    blendWeight: settings?.blendWeight ?? DEFAULT_BLEND_WEIGHT,
    suppressWeakSetups: settings?.suppressWeakSetups ?? true,
  };
}

export function predictRegime(candidate: ScanCandidate, marketRegime?: MarketRegime): RegimePrediction {
  const diSpread = candidate.technicals.plusDI - candidate.technicals.minusDI;
  const adx = candidate.technicals.adx;
  const relativeStrength = candidate.technicals.relativeStrength;

  let regime: MarketRegime = marketRegime ?? 'SIDEWAYS';
  if (adx >= 24 && diSpread > 4 && relativeStrength >= 50) {
    regime = 'BULLISH';
  } else if (adx >= 20 && diSpread < -4) {
    regime = 'BEARISH';
  } else if (Math.abs(diSpread) <= 4) {
    regime = 'SIDEWAYS';
  }

  const confidence = clamp(
    Math.abs(diSpread) * 2 + (adx - 18) * 1.5 + (marketRegime && regime === marketRegime ? 10 : 0),
    35,
    92,
  );

  return {
    regime,
    confidence: round(confidence, 2),
    uncertainty: round(100 - confidence, 2),
  };
}

export function predictBreakoutProbability(candidate: ScanCandidate, marketRegime?: MarketRegime): number {
  const technicals = candidate.technicals;
  const diSpread = technicals.plusDI - technicals.minusDI;
  const priceVsMa200 = candidate.price > technicals.ma200 ? 1 : -1;
  const statusValue = normalizeStatus(candidate.status);

  let logit = -0.35;
  logit += technicals.adx >= 25 ? 0.38 : -0.12;
  logit += technicals.volumeRatio >= 1.4 ? 0.32 : -0.08;
  logit += technicals.efficiency >= 35 ? 0.25 : -0.18;
  logit += technicals.relativeStrength >= 55 ? 0.28 : -0.12;
  logit += technicals.atrPercent <= 6 ? 0.22 : technicals.atrPercent >= 9 ? -0.25 : 0.05;
  logit += diSpread >= 5 ? 0.27 : diSpread <= -2 ? -0.3 : 0.02;
  logit += candidate.distancePercent <= 1.5 ? 0.15 : candidate.distancePercent > 5 ? -0.22 : 0.03;
  logit += priceVsMa200 > 0 ? 0.22 : -0.3;
  logit += technicals.atrSpiking ? -0.18 : 0.04;
  logit += statusValue * 0.15;
  if (marketRegime === 'BULLISH') logit += 0.16;
  if (marketRegime === 'BEARISH') logit -= 0.2;

  return round(clamp(sigmoid(logit), 0.02, 0.98), 4);
}

export function predictCandidateScore(candidate: ScanCandidate, marketRegime?: MarketRegime): CandidateModelPrediction {
  const breakoutProbability = predictBreakoutProbability(candidate, marketRegime);
  const regimePrediction = predictRegime(candidate, marketRegime);
  const baseSystemScore = round(candidate.rankScore, 2);

  let modelScore = breakoutProbability * 70;
  modelScore += clamp(candidate.technicals.adx, 0, 40) * 0.35;
  modelScore += clamp(candidate.technicals.relativeStrength, 0, 100) * 0.1;
  modelScore += candidate.filterResults.priceAboveMa200 ? 5 : -6;
  modelScore += candidate.filterResults.dataQuality ? 4 : -8;
  modelScore += candidate.earningsInfo?.action === 'AUTO_NO' ? -18 : 0;
  modelScore += regimePrediction.regime === 'BULLISH' ? 4 : regimePrediction.regime === 'BEARISH' ? -6 : 0;
  modelScore = round(clamp(modelScore, 0, 100), 2);

  const confidence = round(clamp(
    Math.abs(breakoutProbability - 0.5) * 120
      + (candidate.filterResults.dataQuality ? 12 : 0)
      + (candidate.filterResults.efficiencyAbove30 ? 8 : -6)
      + (candidate.technicals.atrSpiking ? -10 : 5)
      + (marketRegime && regimePrediction.regime === marketRegime ? 8 : 0),
    20,
    95,
  ));
  const uncertainty = round(100 - confidence, 2);

  return {
    baseSystemScore,
    modelScore,
    blendedScore: baseSystemScore,
    breakoutProbability: round(breakoutProbability * 100, 2),
    confidence,
    uncertainty,
    predictedRegime: regimePrediction.regime,
    recommendation: modelScore >= baseSystemScore + 6
      ? 'PROMOTE'
      : modelScore <= baseSystemScore - 10 || breakoutProbability < 0.42
        ? 'SUPPRESS'
        : 'NEUTRAL',
    version: `${MODEL_VERSIONS.candidateModelVersion}/${MODEL_VERSIONS.ensembleVersion}`,
    featureTimestamp: new Date().toISOString(),
  };
}

export function applyModelLayerToCandidates(
  candidates: ScanCandidate[],
  settings?: ModelLayerSettings,
  marketRegime?: MarketRegime,
): CandidateModelResult {
  const resolved = getPredictionSettings(settings);

  const scored = candidates.map((candidate) => {
    const overlay = predictCandidateScore(candidate, marketRegime);
    let blendedScore = overlay.baseSystemScore;

    if (resolved.enabled) {
      blendedScore = overlay.baseSystemScore * (1 - resolved.blendWeight) + overlay.modelScore * resolved.blendWeight;
      if (resolved.suppressWeakSetups && overlay.recommendation === 'SUPPRESS') {
        blendedScore -= 8;
      }
      if (overlay.recommendation === 'PROMOTE') {
        blendedScore += 3;
      }
    }

    return {
      ...candidate,
      modelOverlay: {
        ...overlay,
        enabled: resolved.enabled,
        blendedScore: round(clamp(blendedScore, 0, 100), 2),
      },
    };
  });

  scored.sort((left, right) => {
    const leftScore = resolved.enabled ? left.modelOverlay?.blendedScore ?? left.rankScore : left.rankScore;
    const rightScore = resolved.enabled ? right.modelOverlay?.blendedScore ?? right.rankScore : right.rankScore;
    return rightScore - leftScore;
  });

  return {
    candidates: scored,
    settings: resolved,
    versions: MODEL_VERSIONS,
  };
}

export function getModelVersions(): ModelVersionManifest {
  return { ...MODEL_VERSIONS };
}