'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/score-validation)
 * Consumes: /api/analytics/score-validation, shared components (Navbar)
 * Risk-sensitive: NO — read-only analytics page
 * Last modified: 2026-03-06
 *
 * What this page proves:
 *   Section 1 (Score Bands) — Do BQS/FWS/NCS bands predict outcomes?
 *     Higher NCS → better 20d return, higher 1R rate? (should be yes)
 *     Higher FWS → worse 20d return, more stop hits? (should be yes)
 *     Higher BQS → better return, better MFE? (should be yes)
 *
 *   Section 2 (Auto-Action) — Does the Auto-Yes/Conditional/Auto-No
 *     classification from dual-score.ts produce meaningfully different
 *     outcomes? Auto-Yes should outperform Conditional which should
 *     outperform Auto-No.
 *
 *   Section 3 (Monotonicity) — Automated check: does each score metric
 *     improve monotonically across bands? Perfect monotonicity = the
 *     score formula is doing its job. Violations mean noise or
 *     rebalancing is needed.
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface BucketStats {
  count: number;
  withOutcomes: number;
  tradedCount: number;
  tradeConversionRate: number | null;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  stopHitRate: number | null;
}

interface ScoreBandRow {
  score: string;
  band: string;
  stats: BucketStats;
}

interface ActionClassRow {
  action: string;
  stats: BucketStats;
}

interface MonotonicityResult {
  score: string;
  direction: string;
  metric: string;
  values: (number | null)[];
  isMonotonic: boolean;
  violations: number;
  interpretation: string;
}

interface ValidationResponse {
  ok: boolean;
  generatedAt: string;
  totalCandidates: number;
  totalWithScores: number;
  totalEnriched: number;
  ncsBands: ScoreBandRow[];
  fwsBands: ScoreBandRow[];
  bqsBands: ScoreBandRow[];
  actionClassification: ActionClassRow[];
  monotonicity: MonotonicityResult[];
}

// ── Formatters ───────────────────────────────────────────────

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtR(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}

function fmtRate(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

function returnColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground';
  if (v > 2) return 'text-profit font-semibold';
  if (v > 0) return 'text-profit/80';
  if (v > -2) return 'text-warning';
  return 'text-loss font-semibold';
}

function rateColor(v: number | null, invert = false): string {
  if (v == null) return 'text-muted-foreground';
  const good = invert ? v < 30 : v > 50;
  const bad = invert ? v > 60 : v < 20;
  if (good) return 'text-profit';
  if (bad) return 'text-loss';
  return 'text-warning';
}

function actionBadge(action: string): { color: string; icon: React.ReactNode } {
  switch (action) {
    case 'Auto-Yes':
      return { color: 'text-profit bg-profit/10 border-profit/30', icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
    case 'Auto-No':
      return { color: 'text-loss bg-loss/10 border-loss/30', icon: <XCircle className="h-3.5 w-3.5" /> };
    default:
      return { color: 'text-warning bg-warning/10 border-warning/30', icon: <AlertTriangle className="h-3.5 w-3.5" /> };
  }
}

// ── Shared table component ───────────────────────────────────

function BandTable({ bands, scoreLabel }: { bands: ScoreBandRow[]; scoreLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 px-3">{scoreLabel} Band</th>
            <th className="py-2 px-2 text-right">Count</th>
            <th className="py-2 px-2 text-right">Enriched</th>
            <th className="py-2 px-2 text-right">Traded</th>
            <th className="py-2 px-2 text-right">Conv %</th>
            <th className="py-2 px-2 text-right border-l border-border">5d</th>
            <th className="py-2 px-2 text-right">10d</th>
            <th className="py-2 px-2 text-right">20d</th>
            <th className="py-2 px-2 text-right border-l border-border">MFE</th>
            <th className="py-2 px-2 text-right">MAE</th>
            <th className="py-2 px-2 text-right border-l border-border">1R</th>
            <th className="py-2 px-2 text-right">2R</th>
            <th className="py-2 px-2 text-right">Stop</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.band} className="border-b border-border/30 hover:bg-card/50 transition-colors">
              <td className="py-2 px-3 font-medium">{b.band}</td>
              <td className="py-2 px-2 text-right tabular-nums">{b.stats.count}</td>
              <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{b.stats.withOutcomes}</td>
              <td className="py-2 px-2 text-right tabular-nums">{b.stats.tradedCount}</td>
              <td className="py-2 px-2 text-right tabular-nums">{fmtRate(b.stats.tradeConversionRate)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', returnColor(b.stats.avgFwd5d))}>{fmtPct(b.stats.avgFwd5d)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(b.stats.avgFwd10d))}>{fmtPct(b.stats.avgFwd10d)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(b.stats.avgFwd20d))}>{fmtPct(b.stats.avgFwd20d)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', returnColor(b.stats.avgMfeR))}>{fmtR(b.stats.avgMfeR)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(b.stats.avgMaeR))}>{fmtR(b.stats.avgMaeR)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', rateColor(b.stats.hit1RRate))}>{fmtRate(b.stats.hit1RRate)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(b.stats.hit2RRate))}>{fmtRate(b.stats.hit2RRate)}</td>
              <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(b.stats.stopHitRate, true))}>{fmtRate(b.stats.stopHitRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function ScoreValidationPage() {
  const [data, setData] = useState<ValidationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  // Filters
  const [sleeve, setSleeve] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sleeve) params.set('sleeve', sleeve);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const result = await apiRequest<ValidationResponse>(
        `/api/analytics/score-validation${qs ? '?' + qs : ''}`
      );
      setData(result);
    } catch (e) {
      setError((e as Error).message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [from, sleeve, to]);

  useEffect(() => { loadData(); }, [loadData]);

  async function runBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await apiRequest<{ updated: number; skipped: number; errors: number }>(
        '/api/analytics/score-validation',
        { method: 'POST' }
      );
      setBackfillResult(`Updated ${res.updated}, skipped ${res.skipped}, errors ${res.errors}`);
      loadData(); // refresh
    } catch (e) {
      setBackfillResult(`Error: ${(e as Error).message}`);
    } finally {
      setBackfilling(false);
    }
  }

  const noScores = data && data.totalWithScores === 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <FlaskConical className="h-6 w-6 text-primary" />
              Score Validation
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Do BQS, FWS, and NCS genuinely predict better outcomes?
            </p>
          </div>
          {data && (
            <div className="flex items-center gap-4 mt-3 sm:mt-0 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Target className="h-4 w-4" />{data.totalCandidates.toLocaleString()} candidates</span>
              <span className="flex items-center gap-1"><Zap className="h-4 w-4" />{data.totalWithScores.toLocaleString()} scored</span>
              <span className="flex items-center gap-1"><BarChart3 className="h-4 w-4" />{data.totalEnriched.toLocaleString()} enriched</span>
            </div>
          )}
        </div>

        {/* Filters + Backfill */}
        <div className="card-surface p-4 rounded-lg mb-6 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Sleeve</label>
            <select className="bg-background border border-border rounded px-3 py-1.5 text-sm" value={sleeve} onChange={(e) => setSleeve(e.target.value)}>
              <option value="">All</option>
              <option value="CORE">CORE</option>
              <option value="HIGH_RISK">HIGH_RISK</option>
              <option value="ETF">ETF</option>
              <option value="HEDGE">HEDGE</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input type="date" className="bg-background border border-border rounded px-3 py-1.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <input type="date" className="bg-background border border-border rounded px-3 py-1.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={runBackfill}
              disabled={backfilling}
              className="px-3 py-1.5 text-sm rounded bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-50 transition-colors"
            >
              {backfilling ? 'Backfilling...' : 'Backfill Scores'}
            </button>
            {backfillResult && <span className="text-xs text-muted-foreground">{backfillResult}</span>}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading validation data...
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card-surface p-6 rounded-lg border border-loss/30 text-center">
            <AlertTriangle className="h-8 w-8 text-loss mx-auto mb-2" />
            <p className="text-loss">{error}</p>
          </div>
        )}

        {/* No scores */}
        {!loading && !error && noScores && (
          <div className="card-surface p-10 rounded-lg text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No scored candidates found.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click &ldquo;Backfill Scores&rdquo; to populate BQS/FWS/NCS from nightly snapshot data,
              or wait for the next scan + nightly cycle.
            </p>
          </div>
        )}

        {/* Main content */}
        {!loading && !error && data && !noScores && (
          <>
            {/* ── Section 1: NCS Bands ── */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                NCS — Net Composite Score
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Formula:</strong> NCS = clamp(BQS − 0.8 × FWS + 10 − penalties). Higher NCS should predict better outcomes.
                Auto-Yes requires NCS ≥ 70 and FWS ≤ 30.
              </p>
              <BandTable bands={data.ncsBands} scoreLabel="NCS" />
            </section>

            {/* ── Section 2: FWS Bands ── */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-loss" />
                FWS — Fatal Weakness Score
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Formula:</strong> FWS = sum(volume risk + extension risk + marginal trend + vol shock + regime instability). Max 95.
                Higher FWS = more weakness. FWS {'>'} 65 = Auto-No. FWS ≤ 30 = Auto-Yes eligible.
                Returns should <em>decrease</em> as FWS increases.
              </p>
              <BandTable bands={data.fwsBands} scoreLabel="FWS" />
            </section>

            {/* ── Section 3: BQS Bands ── */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                BQS — Breakout Quality Score
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Formula:</strong> BQS = sum(trend 25 + direction 10 + volatility 15 + proximity 15 + regime 20 + RS 15 + vol bonus 5 + weekly ADX 10 + BIS 15 + Hurst 8). Max 100.
                Higher BQS should predict better breakout quality and higher returns.
              </p>
              <BandTable bands={data.bqsBands} scoreLabel="BQS" />
            </section>

            {/* ── Section 4: Auto-Action Classification ── */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Auto-Action Classification
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Rules:</strong> Auto-Yes = NCS ≥ 70 AND FWS ≤ 30 &nbsp;|&nbsp;
                Auto-No = FWS {'>'} 65 &nbsp;|&nbsp; Conditional = everything else.
                Auto-Yes should clearly outperform Auto-No.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3">Classification</th>
                      <th className="py-2 px-2 text-right">Count</th>
                      <th className="py-2 px-2 text-right">Enriched</th>
                      <th className="py-2 px-2 text-right">Traded</th>
                      <th className="py-2 px-2 text-right">Conv %</th>
                      <th className="py-2 px-2 text-right border-l border-border">5d</th>
                      <th className="py-2 px-2 text-right">10d</th>
                      <th className="py-2 px-2 text-right">20d</th>
                      <th className="py-2 px-2 text-right border-l border-border">MFE</th>
                      <th className="py-2 px-2 text-right">MAE</th>
                      <th className="py-2 px-2 text-right border-l border-border">1R</th>
                      <th className="py-2 px-2 text-right">2R</th>
                      <th className="py-2 px-2 text-right">Stop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.actionClassification.map((a) => {
                      const badge = actionBadge(a.action);
                      return (
                        <tr key={a.action} className="border-b border-border/30 hover:bg-card/50 transition-colors">
                          <td className="py-2 px-3">
                            <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border', badge.color)}>
                              {badge.icon}
                              {a.action}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">{a.stats.count}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{a.stats.withOutcomes}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{a.stats.tradedCount}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtRate(a.stats.tradeConversionRate)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', returnColor(a.stats.avgFwd5d))}>{fmtPct(a.stats.avgFwd5d)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(a.stats.avgFwd10d))}>{fmtPct(a.stats.avgFwd10d)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(a.stats.avgFwd20d))}>{fmtPct(a.stats.avgFwd20d)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', returnColor(a.stats.avgMfeR))}>{fmtR(a.stats.avgMfeR)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(a.stats.avgMaeR))}>{fmtR(a.stats.avgMaeR)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', rateColor(a.stats.hit1RRate))}>{fmtRate(a.stats.hit1RRate)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(a.stats.hit2RRate))}>{fmtRate(a.stats.hit2RRate)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(a.stats.stopHitRate, true))}>{fmtRate(a.stats.stopHitRate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Section 5: Monotonicity Tests ── */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Monotonicity Tests
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Does each score metric improve consistently across bands?
                <span className="text-profit"> ✓ = monotonic (predictive)</span>,
                <span className="text-warning"> ~ = mostly monotonic</span>,
                <span className="text-loss"> ✗ = non-monotonic (needs rebalancing)</span>.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.monotonicity.map((m) => {
                  const statusIcon = m.isMonotonic
                    ? <CheckCircle2 className="h-4 w-4 text-profit" />
                    : m.violations <= 1
                      ? <AlertTriangle className="h-4 w-4 text-warning" />
                      : <XCircle className="h-4 w-4 text-loss" />;
                  const borderColor = m.isMonotonic ? 'border-profit/30' : m.violations <= 1 ? 'border-warning/30' : 'border-loss/30';

                  return (
                    <div key={`${m.score}-${m.metric}`} className={cn('card-surface p-3 rounded-lg border', borderColor)}>
                      <div className="flex items-center gap-2 mb-1">
                        {statusIcon}
                        <span className="font-medium text-sm">{m.score} → {m.metric}</span>
                        <span className="text-xs text-muted-foreground ml-auto">({m.direction})</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{m.interpretation}</p>
                      <div className="flex gap-1.5 mt-2">
                        {m.values.map((v, i) => (
                          <span
                            key={i}
                            className={cn(
                              'text-xs tabular-nums px-1.5 py-0.5 rounded',
                              v == null ? 'bg-card text-muted-foreground' : returnColor(v)
                            )}
                          >
                            {v != null ? (m.metric.includes('Rate') ? `${v.toFixed(1)}%` : v.toFixed(1)) : '—'}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Legend ── */}
            <section className="card-surface p-4 rounded-lg text-xs text-muted-foreground">
              <h3 className="font-semibold text-foreground mb-2">Metric Definitions</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                <div><strong>Fwd 5d/10d/20d:</strong> Avg % price change from scan close after N trading days</div>
                <div><strong>MFE (R):</strong> Maximum Favourable Excursion — peak R above entry within 20 bars</div>
                <div><strong>MAE (R):</strong> Maximum Adverse Excursion — worst R below entry (negative = drawdown)</div>
                <div><strong>1R/2R Hit:</strong> % of candidates whose close reached 1× or 2× initial risk above entry</div>
                <div><strong>Stop Hit:</strong> % whose intraday low touched the stop within 20 bars</div>
                <div><strong>Conv %:</strong> Trade conversion rate — % of candidates that became actual trades</div>
                <div><strong>Monotonicity:</strong> Whether a metric improves consistently across score bands (0 violations = perfect)</div>
                <div><strong>Backfill:</strong> Populates BQS/FWS/NCS from nightly snapshot scoring → CandidateOutcome</div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
