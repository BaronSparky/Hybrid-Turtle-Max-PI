'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/prediction-status)
 * Consumes: /api/prediction/phase6
 * Risk-sensitive: NO — read-only analytics + manual training trigger
 * Last modified: 2026-03-11
 * Notes: Phase 6 prediction engine status dashboard.
 *        Shows model metrics, feature importance, and ranked READY candidates.
 *        Training is manual — triggered by button click, not automated.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import Navbar from '@/components/shared/Navbar';
import AnalyticsExplainCard from '@/components/analytics/AnalyticsExplainCard';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import {
  BarChart3,
  Brain,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Zap,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface FeatureImportanceRow {
  feature: string;
  importance: number;
  coefficient: number;
}

interface ModelStatus {
  hasModel: boolean;
  trainedAt: string | null;
  daysSinceTraining: number | null;
  trainingSamples: number | null;
  testSamples: number | null;
  metrics: {
    r2: number;
    mae: number;
    rmse: number;
    trainR2: number;
  } | null;
  featureImportance: FeatureImportanceRow[] | null;
  availableTrades: number;
}

interface RankedCandidate {
  ticker: string;
  ncs: number | null;
  predictedR: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MODEL';
}

interface RankingResult {
  candidates: RankedCandidate[];
  modelUsed: boolean;
  modelAge: number | null;
  fallbackReason: string | null;
}

interface Phase6Response {
  ok: boolean;
  status: ModelStatus;
  ranking: RankingResult | null;
}

interface TrainResponse {
  ok: boolean;
  result: {
    success: boolean;
    message: string;
    totalTrades: number;
    trainSize: number;
    testSize: number;
    metrics?: { r2: number; mae: number; rmse: number; trainR2: number };
    featureImportance?: FeatureImportanceRow[];
  };
}

// ── Helpers ──────────────────────────────────────────────────

function confidenceColor(c: string): string {
  if (c === 'HIGH') return 'text-profit';
  if (c === 'MEDIUM') return 'text-warning';
  if (c === 'LOW') return 'text-loss';
  return 'text-muted-foreground';
}

function r2Color(r2: number): string {
  if (r2 > 0.15) return 'text-profit font-semibold';
  if (r2 > 0.05) return 'text-warning';
  return 'text-loss';
}

// ── Page ─────────────────────────────────────────────────────

export default function PredictionStatusPage() {
  const [data, setData] = useState<Phase6Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [trainResult, setTrainResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<Phase6Response>('/api/prediction/phase6');
      setData(result);
    } catch (e) {
      setError((e as Error).message || 'Failed to load prediction status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTrain = async () => {
    setTraining(true);
    setTrainResult(null);
    try {
      const res = await fetch('/api/prediction/phase6', { method: 'POST' });
      const json = (await res.json()) as TrainResponse;
      setTrainResult(json.result.message);
      // Refresh status after training
      await fetchData();
    } catch (e) {
      setTrainResult(`Training failed: ${(e as Error).message}`);
    } finally {
      setTraining(false);
    }
  };

  const status = data?.status;
  const ranking = data?.ranking;

  // Build context summary for AI explain
  const predictionContext = useMemo(() => {
    if (!status) return '';
    const metricsLine = status.metrics
      ? `Test R²=${status.metrics.r2.toFixed(3)}, Train R²=${status.metrics.trainR2.toFixed(3)}, MAE=${status.metrics.mae.toFixed(3)}, RMSE=${status.metrics.rmse.toFixed(3)}`
      : 'No model trained';
    const overfitCheck = status.metrics
      ? `Train/Test R² gap: ${(status.metrics.trainR2 - status.metrics.r2).toFixed(3)} (${status.metrics.trainR2 - status.metrics.r2 > 0.3 ? 'POSSIBLE OVERFIT' : 'acceptable'})`
      : '';
    const features = status.featureImportance
      ? status.featureImportance.slice(0, 8).map(f => `${f.feature}: importance=${f.importance.toFixed(3)}, coeff=${f.coefficient.toFixed(3)}`).join('\n')
      : '';
    const topCandidates = ranking?.candidates.slice(0, 5).map(c => `${c.ticker}: NCS=${c.ncs?.toFixed(0) ?? '?'}, predR=${c.predictedR?.toFixed(2) ?? '?'}, conf=${c.confidence}`).join('\n') ?? '';
    return `Prediction Model Status:\nModel: ${status.hasModel ? 'trained' : 'not trained'}${status.daysSinceTraining != null ? `, ${status.daysSinceTraining} days ago` : ''}\nSamples: ${status.trainingSamples ?? 0} train, ${status.testSamples ?? 0} test\nMetrics: ${metricsLine}\n${overfitCheck}\n\nTop Features:\n${features}\n\nTop Ranked Candidates:\n${topCandidates}`;
  }, [status, ranking]);

  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-center gap-3 mb-6">
          <Brain className="w-6 h-6 text-primary-400" />
          <div>
            <h1 className="text-xl font-bold">Phase 6 — Prediction Engine</h1>
            <p className="text-sm text-muted-foreground">
              Ridge regression model predicting R-multiple from signal features — advisory only
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading prediction status…</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-loss/30 bg-loss/10 p-4 text-loss text-sm mb-6">
            {error}
          </div>
        )}

        {status && !loading && (
          <>
            {/* Model Status Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  {status.hasModel ? (
                    <CheckCircle2 className="w-4 h-4 text-profit" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-warning" />
                  )}
                  <h3 className="font-semibold text-sm">Model Status</h3>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={status.hasModel ? 'text-profit' : 'text-warning'}>
                      {status.hasModel ? 'Trained' : 'Not trained'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Available trades</span>
                    <span>{status.availableTrades}</span>
                  </div>
                  {status.trainedAt && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last trained</span>
                        <span>{new Date(status.trainedAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Model age</span>
                        <span className={status.daysSinceTraining && status.daysSinceTraining > 30 ? 'text-warning' : ''}>
                          {status.daysSinceTraining}d
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Train / Test</span>
                        <span>{status.trainingSamples} / {status.testSamples}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Metrics Card */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-primary-400" />
                  <h3 className="font-semibold text-sm">Model Accuracy</h3>
                </div>
                {status.metrics ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Test R²</span>
                      <span className={r2Color(status.metrics.r2)}>
                        {status.metrics.r2.toFixed(3)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Test MAE</span>
                      <span>{status.metrics.mae.toFixed(3)}R</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Test RMSE</span>
                      <span>{status.metrics.rmse.toFixed(3)}R</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t border-border">
                      <span>Train R² (overfit check)</span>
                      <span>{status.metrics.trainR2.toFixed(3)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No metrics yet — train the model first
                  </div>
                )}
              </div>
            </div>

            {/* Train Button */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handleTrain}
                disabled={training || status.availableTrades < 8}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold',
                  'bg-primary-500/20 text-primary-400 border border-primary-500/30',
                  'hover:bg-primary-500/30 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {training ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {training ? 'Training…' : 'Train Model'}
              </button>
              {status.availableTrades < 8 && (
                <span className="text-xs text-muted-foreground">
                  Need at least 8 closed trades with score breakdowns ({status.availableTrades} available)
                </span>
              )}
              {trainResult && (
                <span className="text-xs text-foreground">{trainResult}</span>
              )}
            </div>

            {/* Feature Importance */}
            {status.featureImportance && status.featureImportance.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Feature Importance
                </h2>
                <div className="rounded-xl border border-border bg-card p-5 mb-6">
                  <div className="space-y-2">
                    {status.featureImportance.map((fi) => (
                      <div key={fi.feature} className="flex items-center gap-3 text-sm">
                        <span className="w-32 text-muted-foreground font-mono text-xs">{fi.feature}</span>
                        <div className="flex-1 h-4 bg-navy-800 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              fi.coefficient > 0 ? 'bg-emerald-500/60' : 'bg-rose-500/60'
                            )}
                            style={{ width: `${Math.max(2, fi.importance * 100)}%` }}
                          />
                        </div>
                        <span className={cn(
                          'w-16 text-right font-mono text-xs',
                          fi.coefficient > 0 ? 'text-profit' : 'text-loss'
                        )}>
                          {fi.coefficient > 0 ? '+' : ''}{fi.coefficient.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Ranked READY Candidates */}
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              READY Candidates — Predicted Ranking
            </h2>
            {ranking?.fallbackReason && (
              <div className="text-xs text-warning mb-3 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {ranking.fallbackReason}
              </div>
            )}
            {ranking && ranking.candidates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-3">#</th>
                      <th className="text-left py-2 pr-3">Ticker</th>
                      <th className="text-right py-2 pr-3">NCS</th>
                      <th className="text-right py-2 pr-3">Pred R</th>
                      <th className="text-center py-2">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.candidates.map((c, i) => (
                      <tr key={c.ticker} className="border-b border-border/50 hover:bg-card/50">
                        <td className="py-2 pr-3 text-muted-foreground font-mono">{i + 1}</td>
                        <td className="py-2 pr-3 font-semibold text-primary-400">{c.ticker}</td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {c.ncs != null ? c.ncs.toFixed(0) : '—'}
                        </td>
                        <td className={cn(
                          'py-2 pr-3 text-right font-mono font-semibold',
                          c.predictedR != null && c.predictedR > 0 ? 'text-profit' : 'text-loss'
                        )}>
                          {c.predictedR != null ? `${c.predictedR > 0 ? '+' : ''}${c.predictedR.toFixed(2)}R` : '—'}
                        </td>
                        <td className="py-2 text-center">
                          <span className={cn('text-xs font-bold', confidenceColor(c.confidence))}>
                            {c.confidence}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4">
                No READY/WATCH candidates in the latest snapshot.
              </div>
            )}
          </>
        )}

        {/* ── AI Explain ── */}
        {data && status && (
          <div className="mt-6">
            <AnalyticsExplainCard
              title="AI Model Analysis"
              contextSummary={predictionContext}
              question="Is this prediction model reliable? Is it overfitting? Which features matter most and why? Should I trust the ranked candidates?"
            />
          </div>
        )}
      </main>
    </>
  );
}
