'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/filter-scorecard)
 * Consumes: /api/analytics/filter-scorecard, shared components (Navbar)
 * Risk-sensitive: NO — read-only analytics page
 * Last modified: 2026-03-06
 * Notes: Filter Scorecard — proves the value of each pipeline filter by
 *        comparing forward outcomes of passed vs blocked candidates.
 */

import { useEffect, useState, useMemo } from 'react';
import Navbar from '@/components/shared/Navbar';
import AnalyticsExplainCard from '@/components/analytics/AnalyticsExplainCard';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Filter,
  Loader2,
  Target,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Layers,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface FilterBucketStats {
  count: number;
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  stopHitRate: number | null;
}

interface FilterScorecardRow {
  rule: string;
  description: string;
  total: number;
  passedCount: number;
  blockedCount: number;
  passRate: number;
  passed: FilterBucketStats;
  blocked: FilterBucketStats;
}

interface ScoreBandRow {
  scoreName: string;
  band: string;
  count: number;
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  stopHitRate: number | null;
}

interface ScorecardResponse {
  ok: boolean;
  generatedAt: string;
  totalCandidates: number;
  totalEnriched: number;
  filters: FilterScorecardRow[];
  scoreBands: ScoreBandRow[];
}

// ── Helpers ──────────────────────────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────

export default function FilterScorecardPage() {
  const [data, setData] = useState<ScorecardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sleeve, setSleeve] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Active score tab
  const [activeScore, setActiveScore] = useState<'NCS' | 'FWS' | 'BQS'>('NCS');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (sleeve) params.set('sleeve', sleeve);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const qs = params.toString();
        const url = `/api/analytics/filter-scorecard${qs ? '?' + qs : ''}`;
        const result = await apiRequest<ScorecardResponse>(url);
        setData(result);
      } catch (e) {
        setError((e as Error).message || 'Failed to load scorecard');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sleeve, from, to]);

  const scoreBands = useMemo(() => {
    if (!data) return [];
    return data.scoreBands.filter((b) => b.scoreName === activeScore);
  }, [data, activeScore]);

  // Build context summary for AI explain
  const filterContext = useMemo(() => {
    if (!data) return '';
    const rules = data.filters.map(r =>
      `${r.rule}: pass=${r.passRate.toFixed(0)}%, passed fwd20d=${r.passed.avgFwd20d?.toFixed(2) ?? 'N/A'}%, blocked fwd20d=${r.blocked.avgFwd20d?.toFixed(2) ?? 'N/A'}%, passed 1R=${r.passed.hit1RRate?.toFixed(0) ?? '?'}%, blocked 1R=${r.blocked.hit1RRate?.toFixed(0) ?? '?'}%`
    ).join('\n');
    return `Filter Scorecard (${data.totalCandidates} candidates, ${data.totalEnriched} enriched):\n\nPipeline Rules (passed vs blocked forward returns):\n${rules}`;
  }, [data]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Filter Scorecard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Compare passed vs blocked candidates by each pipeline rule. Outcome data requires enrichment (≥ 8 days after scan).
            </p>
          </div>
          {data && (
            <div className="flex items-center gap-4 mt-3 sm:mt-0 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Target className="h-4 w-4" />
                {data.totalCandidates.toLocaleString()} candidates
              </span>
              <span className="flex items-center gap-1">
                <BarChart3 className="h-4 w-4" />
                {data.totalEnriched.toLocaleString()} with outcomes
              </span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="card-surface p-4 rounded-lg mb-6 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Sleeve</label>
            <select
              className="bg-background border border-border rounded px-3 py-1.5 text-sm"
              value={sleeve}
              onChange={(e) => setSleeve(e.target.value)}
            >
              <option value="">All</option>
              <option value="CORE">CORE</option>
              <option value="HIGH_RISK">HIGH_RISK</option>
              <option value="ETF">ETF</option>
              <option value="HEDGE">HEDGE</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input
              type="date"
              className="bg-background border border-border rounded px-3 py-1.5 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <input
              type="date"
              className="bg-background border border-border rounded px-3 py-1.5 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading scorecard...
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card-surface p-6 rounded-lg border border-loss/30 text-center">
            <AlertTriangle className="h-8 w-8 text-loss mx-auto mb-2" />
            <p className="text-loss">{error}</p>
          </div>
        )}

        {/* No data */}
        {!loading && !error && data && data.totalCandidates === 0 && (
          <div className="card-surface p-10 rounded-lg text-center">
            <Filter className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No candidate outcome data available.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Run a scan to generate candidate outcome records, then wait for enrichment.
            </p>
          </div>
        )}

        {/* Main content */}
        {!loading && !error && data && data.totalCandidates > 0 && (
          <>
            {/* ── Section 1: Filter Rules ── */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" />
                Pipeline Rules
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Each row compares candidates that <span className="text-profit">passed</span> vs <span className="text-loss">were blocked</span> by a rule.
                Forward returns and R-metrics only count enriched rows. Positive value-add = passed avg &gt; blocked avg.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 sticky left-0 bg-background z-10">Rule</th>
                      <th className="py-2 px-2 text-right">Total</th>
                      <th className="py-2 px-2 text-right">Pass</th>
                      <th className="py-2 px-2 text-right">Block</th>
                      <th className="py-2 px-2 text-right">Pass %</th>
                      <th className="py-2 px-2 text-center border-l border-border" colSpan={3}>
                        Avg Fwd Return (Passed)
                      </th>
                      <th className="py-2 px-2 text-center border-l border-border" colSpan={3}>
                        Avg Fwd Return (Blocked)
                      </th>
                      <th className="py-2 px-2 text-center border-l border-border" colSpan={2}>
                        Passed R-Metrics
                      </th>
                      <th className="py-2 px-2 text-center border-l border-border" colSpan={3}>
                        Passed Hit Rates
                      </th>
                    </tr>
                    <tr className="border-b border-border/50 text-[11px] text-muted-foreground/80">
                      <th className="py-1 px-3 sticky left-0 bg-background z-10"></th>
                      <th className="py-1 px-2"></th>
                      <th className="py-1 px-2"></th>
                      <th className="py-1 px-2"></th>
                      <th className="py-1 px-2"></th>
                      <th className="py-1 px-2 text-right border-l border-border">5d</th>
                      <th className="py-1 px-2 text-right">10d</th>
                      <th className="py-1 px-2 text-right">20d</th>
                      <th className="py-1 px-2 text-right border-l border-border">5d</th>
                      <th className="py-1 px-2 text-right">10d</th>
                      <th className="py-1 px-2 text-right">20d</th>
                      <th className="py-1 px-2 text-right border-l border-border">MFE</th>
                      <th className="py-1 px-2 text-right">MAE</th>
                      <th className="py-1 px-2 text-right border-l border-border">1R</th>
                      <th className="py-1 px-2 text-right">2R</th>
                      <th className="py-1 px-2 text-right">StopHit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.filters.map((f) => (
                      <tr
                        key={f.rule}
                        className="border-b border-border/30 hover:bg-card/50 transition-colors"
                        title={f.description}
                      >
                        <td className="py-2 px-3 sticky left-0 bg-background z-10 font-medium">
                          <span className="cursor-help" title={f.description}>
                            {f.rule}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{f.total}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-profit">{f.passedCount}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-loss">{f.blockedCount}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{f.passRate}%</td>

                        {/* Passed forward returns */}
                        <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', returnColor(f.passed.avgFwd5d))}>
                          {fmtPct(f.passed.avgFwd5d)}
                        </td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(f.passed.avgFwd10d))}>
                          {fmtPct(f.passed.avgFwd10d)}
                        </td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(f.passed.avgFwd20d))}>
                          {fmtPct(f.passed.avgFwd20d)}
                        </td>

                        {/* Blocked forward returns */}
                        <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', returnColor(f.blocked.avgFwd5d))}>
                          {fmtPct(f.blocked.avgFwd5d)}
                        </td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(f.blocked.avgFwd10d))}>
                          {fmtPct(f.blocked.avgFwd10d)}
                        </td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(f.blocked.avgFwd20d))}>
                          {fmtPct(f.blocked.avgFwd20d)}
                        </td>

                        {/* Passed R metrics */}
                        <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', returnColor(f.passed.avgMfeR))}>
                          {fmtR(f.passed.avgMfeR)}
                        </td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(f.passed.avgMaeR))}>
                          {fmtR(f.passed.avgMaeR)}
                        </td>

                        {/* Passed hit rates */}
                        <td className={cn('py-2 px-2 text-right tabular-nums border-l border-border', rateColor(f.passed.hit1RRate))}>
                          {fmtRate(f.passed.hit1RRate)}
                        </td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(f.passed.hit2RRate))}>
                          {fmtRate(f.passed.hit2RRate)}
                        </td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(f.passed.stopHitRate, true))}>
                          {fmtRate(f.passed.stopHitRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Value-add interpretation */}
              <div className="mt-3 p-3 rounded bg-card/30 border border-border/50 text-xs text-muted-foreground">
                <strong className="text-foreground">How to read:</strong>{' '}
                A filter adds value when <span className="text-profit">passed candidates</span> have
                higher forward returns than <span className="text-loss">blocked ones</span>.
                If blocked candidates perform just as well, the filter may be too aggressive.
                If passed candidates perform poorly, the filter may not be selective enough.
              </div>
            </section>

            {/* ── Section 2: Score Bands ── */}
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Score Band Analysis
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Candidates bucketed by score range. Shows whether higher scores predict better outcomes.
              </p>

              {/* Score tabs */}
              <div className="flex gap-1 mb-4">
                {(['NCS', 'FWS', 'BQS'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setActiveScore(s)}
                    className={cn(
                      'px-4 py-1.5 rounded text-sm font-medium transition-colors',
                      activeScore === s
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card/50 text-muted-foreground hover:bg-card'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {scoreBands.length === 0 ? (
                <div className="card-surface p-6 rounded-lg text-center text-muted-foreground">
                  <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
                  No {activeScore} score data available. Scores are populated from snapshot sync.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3">{activeScore} Band</th>
                        <th className="py-2 px-2 text-right">Count</th>
                        <th className="py-2 px-2 text-right">Enriched</th>
                        <th className="py-2 px-2 text-right">Fwd 5d</th>
                        <th className="py-2 px-2 text-right">Fwd 10d</th>
                        <th className="py-2 px-2 text-right">Fwd 20d</th>
                        <th className="py-2 px-2 text-right">Avg MFE</th>
                        <th className="py-2 px-2 text-right">1R Hit</th>
                        <th className="py-2 px-2 text-right">2R Hit</th>
                        <th className="py-2 px-2 text-right">Stop Hit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoreBands.map((b) => (
                        <tr
                          key={`${b.scoreName}-${b.band}`}
                          className="border-b border-border/30 hover:bg-card/50 transition-colors"
                        >
                          <td className="py-2 px-3 font-medium">{b.band}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{b.count}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{b.withOutcomes}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(b.avgFwd5d))}>
                            {fmtPct(b.avgFwd5d)}
                          </td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(b.avgFwd10d))}>
                            {fmtPct(b.avgFwd10d)}
                          </td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(b.avgFwd20d))}>
                            {fmtPct(b.avgFwd20d)}
                          </td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', returnColor(b.avgMfeR))}>
                            {fmtR(b.avgMfeR)}
                          </td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(b.hit1RRate))}>
                            {fmtRate(b.hit1RRate)}
                          </td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(b.hit2RRate))}>
                            {fmtRate(b.hit2RRate)}
                          </td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', rateColor(b.stopHitRate, true))}>
                            {fmtRate(b.stopHitRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Score band interpretation */}
              <div className="mt-3 p-3 rounded bg-card/30 border border-border/50 text-xs text-muted-foreground">
                <strong className="text-foreground">How to read:</strong>{' '}
                For <strong>NCS</strong> and <strong>BQS</strong>, higher bands should show higher forward returns (monotonically increasing = score works).
                For <strong>FWS</strong>, lower bands should show higher returns (monotonically decreasing = weakness detection works).
                Non-monotonic patterns suggest the scoring formula needs rebalancing.
              </div>
            </section>

            {/* ── Legend ── */}
            <section className="mt-8 card-surface p-4 rounded-lg text-xs text-muted-foreground">
              <h3 className="font-semibold text-foreground mb-2">Metric Definitions</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                <div><strong>Fwd 5d/10d/20d:</strong> Average % price change from scan close after N trading days</div>
                <div><strong>MFE (R):</strong> Maximum Favourable Excursion — peak R above entry within 20 bars</div>
                <div><strong>MAE (R):</strong> Maximum Adverse Excursion — worst R below entry within 20 bars (negative)</div>
                <div><strong>1R/2R Hit:</strong> % of candidates whose close reached 1× or 2× initial risk above entry</div>
                <div><strong>Stop Hit:</strong> % of candidates whose intraday low touched the stop price within 20 bars</div>
                <div><strong>Pass Rate:</strong> % of total candidates that passed this filter/rule</div>
                <div><strong>Enriched:</strong> Count of candidates with forward price data available (≥ 8 days old)</div>
                <div><strong>&ldquo;&mdash;&rdquo;:</strong> Insufficient data — need more scans + enrichment runs</div>
              </div>
            </section>

            {/* ── AI Explain ── */}
            <section className="mt-8">
              <AnalyticsExplainCard
                title="AI Filter Analysis"
                contextSummary={filterContext}
                question="Which pipeline filters are adding value by improving outcomes for passed candidates? Are any filters too aggressive (blocking candidates that would have done well)? What should I focus on?"
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
