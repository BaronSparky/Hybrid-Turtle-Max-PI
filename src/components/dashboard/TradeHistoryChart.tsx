'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { BarChart3, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts';

interface TradeData {
  ticker: string;
  rMultiple: number;
  exitDate: string | null;
  holdDays: number | null;
}

interface TradeSummary {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
  distribution?: Array<{ label: string; count: number }>;
}

export default function TradeHistoryChart() {
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [summary, setSummary] = useState<TradeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ trades: TradeData[]; summary: TradeSummary }>('/api/performance/trades?limit=30');
      setTrades(result.trades);
      setSummary(result.summary);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary-400 animate-pulse" />
          Trade History
        </h3>
        <div className="h-48 flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary-400" />
          Trade History
        </h3>
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          No closed trades yet — R-multiple chart will appear after your first exit.
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary-400" />
          Trade History (R-multiples)
        </h3>
        <button onClick={fetchData} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-muted-foreground">Trades</div>
            <div className="text-sm font-mono">{summary.total}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Win Rate</div>
            <div className={cn('text-sm font-mono', summary.winRate >= 50 ? 'text-profit' : 'text-loss')}>
              {summary.winRate.toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Avg R</div>
            <div className={cn('text-sm font-mono', summary.avgR >= 0 ? 'text-profit' : 'text-loss')}>
              {summary.avgR >= 0 ? '+' : ''}{summary.avgR.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Total R</div>
            <div className={cn('text-sm font-mono font-semibold', summary.totalR >= 0 ? 'text-profit' : 'text-loss')}>
              {summary.totalR >= 0 ? '+' : ''}{summary.totalR.toFixed(1)}
            </div>
          </div>
        </div>
      )}

      {/* Bar chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trades} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="ticker"
              tick={{ fontSize: 9, fill: '#6b7280' }}
              interval={0}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={(v: number) => `${v}R`}
              width={40}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1f36', border: '1px solid #2d3348', borderRadius: 8, fontSize: 11 }}
              formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}R`, 'Result']}
              labelFormatter={(label: string) => label}
            />
            <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} />
            <Bar dataKey="rMultiple" radius={[2, 2, 0, 0]}>
              {trades.map((t, i) => (
                <Cell key={i} fill={t.rMultiple >= 0 ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* R-distribution */}
      {summary?.distribution && summary.distribution.some(b => b.count > 0) && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">R Distribution</p>
          <div className="flex items-end gap-1 h-12">
            {summary.distribution.map((bucket, i) => {
              const maxCount = Math.max(...summary.distribution!.map(b => b.count), 1);
              const heightPct = (bucket.count / maxCount) * 100;
              const isLoss = i < 2;
              return (
                <div key={bucket.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className={cn(
                      'w-full rounded-t transition-all',
                      isLoss ? 'bg-loss/60' : 'bg-profit/60',
                      bucket.count === 0 && 'bg-border/20'
                    )}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                    title={`${bucket.label}: ${bucket.count} trade${bucket.count !== 1 ? 's' : ''}`}
                  />
                  <span className="text-[8px] text-muted-foreground/60 truncate w-full text-center">{bucket.label}</span>
                  {bucket.count > 0 && <span className="text-[9px] font-mono text-muted-foreground">{bucket.count}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
