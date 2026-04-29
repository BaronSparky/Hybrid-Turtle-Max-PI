'use client';

/**
 * DEPENDENCIES
 * Consumed by: /price-accuracy route (Analysis menu)
 * Consumes: /api/analytics/price-accuracy
 * Risk-sensitive: NO — read-only analytics page
 * Notes: Shows T212 vs Yahoo price accuracy over time with per-ticker breakdown.
 */

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { BarChart3, Loader2, TrendingUp, AlertTriangle } from 'lucide-react';

interface TickerAccuracy {
  ticker: string;
  snapshots: number;
  avgDiffPercent: number;
  maxDiffPercent: number;
  mismatchCount: number;
}

interface RecentSample {
  ticker: string;
  t212Price: number;
  yahooPrice: number | null;
  diffPercent: number | null;
  capturedAt: string;
}

interface AccuracyData {
  days: number;
  totalSnapshots: number;
  overall: {
    avgDiffPercent: number;
    maxDiffPercent: number;
    mismatchCount: number;
    mismatchRate: number;
  } | null;
  perTicker: TickerAccuracy[];
  recentSamples: RecentSample[];
}

export default function PriceAccuracyPage() {
  const [data, setData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<AccuracyData>(`/api/analytics/price-accuracy?days=${days}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-primary-400" />
            <div>
              <h1 className="text-xl font-bold">Price Accuracy</h1>
              <p className="text-sm text-muted-foreground">T212 vs Yahoo Finance price comparison</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[1, 3, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  days === d
                    ? 'bg-primary-500 text-white'
                    : 'bg-navy-800 text-muted-foreground hover:text-foreground border border-border/50'
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="card-surface p-12 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading price accuracy data...
          </div>
        ) : !data || data.totalSnapshots === 0 ? (
          <div className="card-surface p-12 text-center text-muted-foreground">
            <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No price snapshots yet</p>
            <p className="text-sm mt-1">Snapshots are recorded automatically when T212 prices are fetched during market hours.</p>
          </div>
        ) : (
          <>
            {/* Summary KPIs */}
            {data.overall && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="card-surface p-4">
                  <div className="text-xs text-muted-foreground">Avg Difference</div>
                  <div className={cn(
                    'text-2xl font-bold font-mono mt-1',
                    data.overall.avgDiffPercent < 0.5 ? 'text-profit'
                      : data.overall.avgDiffPercent < 2 ? 'text-warning' : 'text-loss'
                  )}>
                    {data.overall.avgDiffPercent}%
                  </div>
                </div>
                <div className="card-surface p-4">
                  <div className="text-xs text-muted-foreground">Max Difference</div>
                  <div className={cn(
                    'text-2xl font-bold font-mono mt-1',
                    data.overall.maxDiffPercent < 1 ? 'text-profit'
                      : data.overall.maxDiffPercent < 3 ? 'text-warning' : 'text-loss'
                  )}>
                    {data.overall.maxDiffPercent}%
                  </div>
                </div>
                <div className="card-surface p-4">
                  <div className="text-xs text-muted-foreground">Mismatch Rate</div>
                  <div className="text-2xl font-bold font-mono mt-1 text-foreground">
                    {data.overall.mismatchRate}%
                  </div>
                  <div className="text-xs text-muted-foreground">&gt;1% diff</div>
                </div>
                <div className="card-surface p-4">
                  <div className="text-xs text-muted-foreground">Total Snapshots</div>
                  <div className="text-2xl font-bold font-mono mt-1 text-foreground">
                    {data.totalSnapshots}
                  </div>
                  <div className="text-xs text-muted-foreground">{data.days} day window</div>
                </div>
              </div>
            )}

            {/* Per-Ticker Table */}
            {data.perTicker.length > 0 && (
              <div className="card-surface">
                <div className="p-4 border-b border-border">
                  <h2 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary-400" />
                    Per-Ticker Accuracy
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left p-3">Ticker</th>
                        <th className="text-right p-3">Avg Diff %</th>
                        <th className="text-right p-3">Max Diff %</th>
                        <th className="text-right p-3">Mismatches</th>
                        <th className="text-right p-3">Snapshots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.perTicker.map((t) => (
                        <tr key={t.ticker} className="border-b border-border/30 hover:bg-navy-800/30">
                          <td className="p-3 font-mono font-medium">{t.ticker}</td>
                          <td className={cn(
                            'p-3 text-right font-mono',
                            t.avgDiffPercent < 0.5 ? 'text-profit' : t.avgDiffPercent < 2 ? 'text-warning' : 'text-loss'
                          )}>
                            {t.avgDiffPercent}%
                          </td>
                          <td className={cn(
                            'p-3 text-right font-mono',
                            t.maxDiffPercent < 1 ? 'text-profit' : t.maxDiffPercent < 3 ? 'text-warning' : 'text-loss'
                          )}>
                            {t.maxDiffPercent}%
                          </td>
                          <td className="p-3 text-right font-mono">
                            {t.mismatchCount > 0 ? (
                              <span className="text-warning">{t.mismatchCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-mono text-muted-foreground">{t.snapshots}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent Samples */}
            {data.recentSamples.length > 0 && (
              <div className="card-surface">
                <div className="p-4 border-b border-border">
                  <h2 className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-primary-400" />
                    Recent Price Comparisons
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left p-3">Time</th>
                        <th className="text-left p-3">Ticker</th>
                        <th className="text-right p-3">T212</th>
                        <th className="text-right p-3">Yahoo</th>
                        <th className="text-right p-3">Diff %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentSamples.map((s, i) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-navy-800/30">
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(s.capturedAt).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="p-3 font-mono font-medium">{s.ticker}</td>
                          <td className="p-3 text-right font-mono">{s.t212Price.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono text-muted-foreground">
                            {s.yahooPrice?.toFixed(2) ?? '—'}
                          </td>
                          <td className={cn(
                            'p-3 text-right font-mono',
                            (s.diffPercent ?? 0) < 0.5 ? 'text-profit'
                              : (s.diffPercent ?? 0) < 2 ? 'text-warning' : 'text-loss'
                          )}>
                            {s.diffPercent?.toFixed(2) ?? '—'}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
