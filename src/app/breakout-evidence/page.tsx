'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/breakout-evidence)
 * Consumes: /api/analytics/breakout-evidence, shared components (Navbar)
 * Risk-sensitive: NO — read-only analytics page, Layer 2 advisory
 * Last modified: 2026-03-11
 * Notes: Shows breakout vs non-breakout performance comparison,
 *        plus shadow stats for breakout + low entropy and breakout + high isolation.
 *        All data is observational — never affects scan decisions.
 */

import { useEffect, useState, useMemo } from 'react';
import Navbar from '@/components/shared/Navbar';
import AnalyticsExplainCard from '@/components/analytics/AnalyticsExplainCard';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import {
  BarChart3,
  Loader2,
  TrendingUp,
  Zap,
  Activity,
  Network,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface BucketStats {
  count: number;
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  hit1RRate: number | null;
  stopHitRate: number | null;
  avgEntropy63: number | null;
  avgNetIsolation: number | null;
}

interface TickerDetail {
  ticker: string;
  sleeve: string | null;
  status: string | null;
  close: number;
  isBreakout20: boolean | null;
  breakoutDistancePct: number | null;
  breakoutWindowDays: number | null;
  entropy63: number | null;
  netIsolation: number | null;
  smartMoney21: number | null;
  fractalDim: number | null;
  complexity: number | null;
  createdAt: string;
}

interface BreakoutEvidenceResponse {
  ok: boolean;
  generatedAt: string;
  totalSnapshots: number;
  breakout: BucketStats;
  nonBreakout: BucketStats;
  shadow: {
    breakoutLowEntropy: BucketStats;
    breakoutHighIsolation: BucketStats;
  };
  tickerDetails: TickerDetail[];
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

// ── Stats Card Component ─────────────────────────────────────

function StatsCard({ title, icon, stats, className }: {
  title: string;
  icon: React.ReactNode;
  stats: BucketStats;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          n={stats.count} ({stats.withOutcomes} enriched)
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">Fwd 5d</div>
          <div className={returnColor(stats.avgFwd5d)}>{fmtPct(stats.avgFwd5d)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Fwd 10d</div>
          <div className={returnColor(stats.avgFwd10d)}>{fmtPct(stats.avgFwd10d)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Fwd 20d</div>
          <div className={returnColor(stats.avgFwd20d)}>{fmtPct(stats.avgFwd20d)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Avg MFE</div>
          <div className={returnColor(stats.avgMfeR ? stats.avgMfeR * 100 : null)}>{fmtR(stats.avgMfeR)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Hit 1R</div>
          <div className={rateColor(stats.hit1RRate)}>{fmtRate(stats.hit1RRate)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Stop Hit</div>
          <div className={rateColor(stats.stopHitRate, true)}>{fmtRate(stats.stopHitRate)}</div>
        </div>
      </div>
      {(stats.avgEntropy63 != null || stats.avgNetIsolation != null) && (
        <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-border text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Avg Entropy</div>
            <div className="text-foreground">{stats.avgEntropy63?.toFixed(2) ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Avg Isolation</div>
            <div className="text-foreground">{stats.avgNetIsolation?.toFixed(3) ?? '—'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function BreakoutEvidencePage() {
  const [data, setData] = useState<BreakoutEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await apiRequest<BreakoutEvidenceResponse>('/api/analytics/breakout-evidence');
        setData(result);
      } catch (e) {
        setError((e as Error).message || 'Failed to load breakout evidence');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Build context summary for AI explain
  const breakoutContext = useMemo(() => {
    if (!data) return '';
    const fmt = (s: BucketStats, label: string) =>
      `${label}: n=${s.count}, fwd20d=${s.avgFwd20d?.toFixed(2) ?? 'N/A'}%, MFE=${s.avgMfeR?.toFixed(2) ?? '?'}R, 1R=${s.hit1RRate?.toFixed(0) ?? '?'}%, stop=${s.stopHitRate?.toFixed(0) ?? '?'}%`;
    return `Breakout Evidence Data:\n${fmt(data.breakout, 'Breakout (close >= 20d high)')}\n${fmt(data.nonBreakout, 'Non-Breakout')}\n${fmt(data.shadow.breakoutLowEntropy, 'Breakout + Low Entropy')}\n${fmt(data.shadow.breakoutHighIsolation, 'Breakout + High Isolation')}\nTotal tickers with data: ${data.tickerDetails.length}`;
  }, [data]);

  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-6 h-6 text-primary-400" />
          <div>
            <h1 className="text-xl font-bold">Breakout Evidence</h1>
            <p className="text-sm text-muted-foreground">
              Breakout vs non-breakout performance comparison — advisory Layer 2 analytics
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading evidence data…</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-loss/30 bg-loss/10 p-4 text-loss text-sm">
            {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-4 mb-6 text-sm text-muted-foreground">
              <span>{data.totalSnapshots} total snapshots</span>
              <span>·</span>
              <span>{data.breakout.count} breakout</span>
              <span>·</span>
              <span>{data.nonBreakout.count} non-breakout</span>
              <span className="ml-auto text-xs">
                Generated {new Date(data.generatedAt).toLocaleString()}
              </span>
            </div>

            {/* Primary comparison: breakout vs non-breakout */}
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Primary Comparison
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <StatsCard
                title="Breakout (close ≥ 20d high)"
                icon={<Zap className="w-4 h-4 text-emerald-400" />}
                stats={data.breakout}
                className="border-emerald-500/30"
              />
              <StatsCard
                title="Non-Breakout (below 20d high)"
                icon={<TrendingUp className="w-4 h-4 text-muted-foreground" />}
                stats={data.nonBreakout}
              />
            </div>

            {/* Shadow stats */}
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Shadow Stats (Phase 6 Learning)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <StatsCard
                title="Breakout + Low Entropy (<2.5 bits)"
                icon={<Activity className="w-4 h-4 text-amber-400" />}
                stats={data.shadow.breakoutLowEntropy}
                className="border-amber-500/20"
              />
              <StatsCard
                title="Breakout + High Isolation (>0.5)"
                icon={<Network className="w-4 h-4 text-blue-400" />}
                stats={data.shadow.breakoutHighIsolation}
                className="border-blue-500/20"
              />
            </div>

            {/* Breakout candidates detail table */}
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Current Breakout Candidates
            </h2>
            {data.tickerDetails.length === 0 ? (
              <div className="text-muted-foreground text-sm py-4">
                No breakout snapshots with evidence fields recorded yet. Run a nightly sync to populate.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-3">Ticker</th>
                      <th className="text-left py-2 pr-3">Sleeve</th>
                      <th className="text-left py-2 pr-3">Status</th>
                      <th className="text-right py-2 pr-3">Close</th>
                      <th className="text-right py-2 pr-3">Dist%</th>
                      <th className="text-right py-2 pr-3">Window</th>
                      <th className="text-right py-2 pr-3">Entropy</th>
                      <th className="text-right py-2 pr-3">Isolation</th>
                      <th className="text-right py-2 pr-3">Smart$</th>
                      <th className="text-right py-2 pr-3">Fractal</th>
                      <th className="text-right py-2 pr-3">Complx</th>
                      <th className="text-right py-2">Snapshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tickerDetails.map((t) => (
                      <tr key={`${t.ticker}-${t.createdAt}`} className="border-b border-border/50 hover:bg-card/50">
                        <td className="py-2 pr-3 font-semibold text-primary-400">{t.ticker}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{t.sleeve ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <span className={cn(
                            'inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold',
                            t.status === 'READY' ? 'bg-emerald-500/20 text-emerald-400' :
                            t.status === 'WATCH' ? 'bg-amber-500/20 text-amber-300' :
                            'bg-zinc-500/20 text-zinc-400'
                          )}>
                            {t.status ?? '—'}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">{t.close.toFixed(2)}</td>
                        <td className={cn('py-2 pr-3 text-right font-mono', returnColor(t.breakoutDistancePct != null ? -t.breakoutDistancePct : null))}>
                          {t.breakoutDistancePct != null ? `${t.breakoutDistancePct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">{t.breakoutWindowDays ?? '—'}d</td>
                        <td className="py-2 pr-3 text-right font-mono">{t.entropy63?.toFixed(2) ?? '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono">{t.netIsolation?.toFixed(3) ?? '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs">{t.smartMoney21 != null ? (t.smartMoney21 / 1e6).toFixed(1) + 'M' : '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono">{t.fractalDim?.toFixed(2) ?? '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono">{t.complexity?.toFixed(2) ?? '—'}</td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── AI Explain ── */}
        {data && (
          <div className="mt-6">
            <AnalyticsExplainCard
              title="AI Breakout Analysis"
              contextSummary={breakoutContext}
              question="Do breakouts actually outperform non-breakouts in this data? Does adding low entropy or high isolation improve outcomes? Is the evidence strong enough to justify the breakout filter?"
            />
          </div>
        )}
      </main>
    </>
  );
}
