'use client';

/**
 * DEPENDENCIES
 * Consumed by: /portfolio/positions page (Performance tab)
 * Consumes: /api/performance/summary
 * Risk-sensitive: NO (display only)
 * Last modified: 2026-03-03
 * Notes: Lifted from src/app/performance/page.tsx — identical functionality
 *        rendered inside a tab. recharts loaded dynamically.
 */

import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Trophy,
  Target,
  AlertTriangle,
  Clock,
  Loader2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface PerformanceData {
  weeksRunning: number;
  startingEquity: number | null;
  currentEquity: number | null;
  totalGainLoss: number | null;
  totalGainLossPct: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  bestTrade: { ticker: string; gainLoss: number } | null;
  worstTrade: { ticker: string; gainLoss: number } | null;
  totalRealisedPnl: number | null;
  exitReasonBreakdown: { stopLoss: number; manualSale: number; unknown: number } | null;
  avgDaysHeld: number | null;
  openPositions: { ticker: string; unrealisedGainLoss: number | null }[];
  equityCurve: { date: string; value: number }[];
  tradeList: { ticker: string; tradeDate: string; daysHeld: number | null; gainLoss: number | null; exitReason: string | null }[];
}

function formatGBP(value: number): string {
  const abs = Math.abs(value);
  return `${value < 0 ? '-' : ''}£${abs.toFixed(2)}`;
}

interface BenchmarkPoint {
  date: string;
  returnPct: number;
}

interface BenchmarkData {
  data: BenchmarkPoint[];
  summary?: { ticker: string; returnPct: number };
}

export default function PerformanceTab() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [res, bench] = await Promise.all([
        apiRequest<PerformanceData & { ok: boolean }>('/api/performance/summary'),
        apiRequest<BenchmarkData>('/api/performance/benchmark?days=90').catch(() => null),
      ]);
      setData(res);
      if (bench) setBenchmark(bench);
    } catch {
      // Graceful degradation
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isPositive = data?.totalGainLoss != null && data.totalGainLoss > 0;
  const hasEquity = data?.startingEquity != null && data?.currentEquity != null;
  const hasClosedTrades = (data?.totalTrades ?? 0) > 0;
  const unrealisedTotal = data?.openPositions?.reduce((sum, p) => sum + (p.unrealisedGainLoss ?? 0), 0) ?? 0;
  const realisedTotal = data?.totalRealisedPnl ?? 0;
  const combinedTotal = realisedTotal + unrealisedTotal;
  const hasChartData = (data?.equityCurve?.length ?? 0) >= 7;

  // Build merged return comparison data for dual-axis chart
  const returnComparisonData = (() => {
    if (!hasChartData || !data?.equityCurve || !benchmark?.data?.length) return null;
    const firstEquity = data.equityCurve[0]?.value;
    if (!firstEquity || firstEquity <= 0) return null;

    // Index benchmark returns by date for lookup
    const benchByDate = new Map(benchmark.data.map(b => [b.date, b.returnPct]));

    return data.equityCurve.map(e => ({
      date: e.date,
      portfolio: Math.round(((e.value - firstEquity) / firstEquity) * 1000) / 10,
      spy: benchByDate.get(e.date) ?? null,
    })).filter(d => d.spy !== null);
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading performance data…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card-surface p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-foreground font-medium">Could not load performance data</p>
        <p className="text-sm text-muted-foreground">Try running the nightly pipeline first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Big number card */}
      <div className="card-surface p-6">
        {hasEquity ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Started with</p>
                <p className="text-xl font-bold text-foreground">£{data.startingEquity!.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Current value</p>
                <p className="text-xl font-bold text-foreground">£{data.currentEquity!.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Total gain/loss</p>
                <p className={cn('text-xl font-bold flex items-center gap-1', isPositive ? 'text-gain' : data.totalGainLoss! < 0 ? 'text-loss' : 'text-foreground')}>
                  {isPositive ? <TrendingUp className="w-5 h-5" /> : data.totalGainLoss! < 0 ? <TrendingDown className="w-5 h-5" /> : null}
                  {data.totalGainLoss! >= 0 ? '+' : ''}£{Math.abs(data.totalGainLoss!).toFixed(2)}
                  {data.totalGainLossPct != null && (
                    <span className="text-sm font-normal ml-1">({data.totalGainLossPct! >= 0 ? '+' : ''}{data.totalGainLossPct!.toFixed(1)}%)</span>
                  )}
                </p>
              </div>
            </div>
            {hasClosedTrades && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-border/30">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Realised (closed trades)</p>
                  <p className={cn('text-sm font-semibold font-mono', realisedTotal >= 0 ? 'text-gain' : 'text-loss')}>{realisedTotal >= 0 ? '+' : ''}£{Math.abs(realisedTotal).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Unrealised (open positions)</p>
                  <p className={cn('text-sm font-semibold font-mono', unrealisedTotal >= 0 ? 'text-gain' : 'text-loss')}>{unrealisedTotal >= 0 ? '+' : ''}£{Math.abs(unrealisedTotal).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Total</p>
                  <p className={cn('text-sm font-semibold font-mono', combinedTotal >= 0 ? 'text-gain' : 'text-loss')}>{combinedTotal >= 0 ? '+' : ''}£{Math.abs(combinedTotal).toFixed(2)}</p>
                </div>
              </div>
            )}
            <p className="text-sm mt-3 text-muted-foreground">
              {isPositive ? 'Your system is working.' : data.totalGainLoss! < 0 ? `Down ${formatGBP(Math.abs(data.totalGainLoss!))} — normal early on. Momentum systems take time.` : 'Break even so far.'}
            </p>
          </>
        ) : (
          <div className="text-center py-4">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-foreground font-medium">No equity data yet</p>
            <p className="text-sm text-muted-foreground">Check back after first nightly run.</p>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      {hasClosedTrades ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="card-surface p-4 text-center"><Target className="w-5 h-5 text-primary-400 mx-auto mb-1" /><p className="text-2xl font-bold text-foreground">{data.totalTrades}</p><p className="text-xs text-muted-foreground">Trades taken</p></div>
          <div className="card-surface p-4 text-center"><Trophy className="w-5 h-5 text-gain mx-auto mb-1" /><p className="text-2xl font-bold text-foreground">{data.winningTrades}{data.winRate != null && <span className="text-sm font-normal text-muted-foreground ml-1">({data.winRate.toFixed(0)}%)</span>}</p><p className="text-xs text-muted-foreground">Winning trades</p></div>
          <div className="card-surface p-4 text-center"><TrendingUp className="w-5 h-5 text-gain mx-auto mb-1" /><p className="text-lg font-bold text-foreground">{data.bestTrade ? `${data.bestTrade.ticker} ${formatGBP(data.bestTrade.gainLoss)}` : '—'}</p><p className="text-xs text-muted-foreground">Best trade</p></div>
          <div className="card-surface p-4 text-center"><TrendingDown className="w-5 h-5 text-loss mx-auto mb-1" /><p className="text-lg font-bold text-foreground">{data.worstTrade ? `${data.worstTrade.ticker} ${formatGBP(data.worstTrade.gainLoss)}` : '—'}</p><p className="text-xs text-muted-foreground">Worst trade</p></div>
          {data.avgDaysHeld != null && <div className="card-surface p-4 text-center"><Clock className="w-5 h-5 text-primary-400 mx-auto mb-1" /><p className="text-2xl font-bold text-foreground">{data.avgDaysHeld}</p><p className="text-xs text-muted-foreground">Avg days held</p></div>}
        </div>
      ) : (
        <div className="card-surface p-6 text-center"><p className="text-foreground font-medium">No completed trades yet</p><p className="text-sm text-muted-foreground">Check back after your first position closes.</p></div>
      )}

      {/* Exit reason breakdown */}
      {hasClosedTrades && data.exitReasonBreakdown && (
        <div className="card-surface p-5">
          <h2 className="text-sm font-semibold text-foreground mb-2">How trades closed</h2>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            {data.exitReasonBreakdown.stopLoss > 0 && <span>Stop-loss: <strong className="text-foreground">{data.exitReasonBreakdown.stopLoss}</strong></span>}
            {data.exitReasonBreakdown.manualSale > 0 && <span>Manual sale: <strong className="text-foreground">{data.exitReasonBreakdown.manualSale}</strong></span>}
            {data.exitReasonBreakdown.unknown > 0 && <span>Unknown: <strong className="text-foreground">{data.exitReasonBreakdown.unknown}</strong></span>}
          </div>
        </div>
      )}

      {/* Equity curve */}
      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Your account value over time</h2>
        {hasChartData ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickFormatter={(v: number) => `£${v}`} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#f1f5f9', fontSize: '12px' }} formatter={(value: number) => [`£${value.toFixed(2)}`, 'Equity']} />
                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#6366f1' }} />
              </LineChart>
            </ResponsiveContainer>
            {benchmark?.summary && (
              <p className="text-xs text-muted-foreground mt-2">
                Benchmark (SPY): <span className={cn(benchmark.summary.returnPct >= 0 ? 'text-gain' : 'text-loss', 'font-medium')}>
                  {benchmark.summary.returnPct >= 0 ? '+' : ''}{benchmark.summary.returnPct.toFixed(1)}%
                </span> over same period
                {data.totalGainLossPct != null && (
                  <> · Your portfolio: <span className={cn(data.totalGainLossPct >= 0 ? 'text-gain' : 'text-loss', 'font-medium')}>
                    {data.totalGainLossPct >= 0 ? '+' : ''}{data.totalGainLossPct.toFixed(1)}%
                  </span></>
                )}
              </p>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm">Chart will appear after 1 week of data.</div>
        )}
      </div>

      {/* Returns vs Benchmark chart */}
      {returnComparisonData && returnComparisonData.length >= 7 && (
        <div className="card-surface p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Returns vs Benchmark (SPY)</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={returnComparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#f1f5f9', fontSize: '12px' }}
                formatter={(value: number, name: string) => [`${value >= 0 ? '+' : ''}${value.toFixed(1)}%`, name === 'portfolio' ? 'Portfolio' : 'SPY']}
              />
              <Line type="monotone" dataKey="portfolio" stroke="#6366f1" strokeWidth={2} dot={false} name="portfolio" />
              <Line type="monotone" dataKey="spy" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="spy" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-500 inline-block" /> Portfolio</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block border-dashed" /> SPY</span>
          </div>
        </div>
      )}

      {/* Trade list */}
      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Trade History</h2>
        {data.tradeList && data.tradeList.length > 0 ? (
          <div className="space-y-2 mb-4">
            {data.tradeList.map((trade, i) => {
              const isWin = (trade.gainLoss ?? 0) > 0;
              return (
                <div key={`${trade.ticker}-${trade.tradeDate}-${i}`} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div>
                    <span className="text-sm font-medium text-foreground">{trade.ticker}</span>
                    <span className="text-xs text-muted-foreground ml-2">{trade.tradeDate}{trade.daysHeld != null && ` · ${trade.daysHeld} day${trade.daysHeld !== 1 ? 's' : ''}`}</span>
                  </div>
                  {trade.gainLoss != null && (
                    <span className={cn('text-sm font-medium', isWin ? 'text-gain' : 'text-loss')}>{isWin ? '+' : ''}£{trade.gainLoss.toFixed(2)} {isWin ? '✓' : '✗'}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mb-4">No closed trades yet.</p>
        )}
        {data.openPositions && data.openPositions.length > 0 && (
          <>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Currently open ({data.openPositions.length})</h3>
            <div className="space-y-1">
              {data.openPositions.map((pos) => (
                <div key={pos.ticker} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-foreground">{pos.ticker}</span>
                  <span className="text-xs text-muted-foreground">{pos.unrealisedGainLoss != null ? `Unrealised: ${pos.unrealisedGainLoss >= 0 ? '+' : ''}£${pos.unrealisedGainLoss.toFixed(2)}` : 'Unrealised: —'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
