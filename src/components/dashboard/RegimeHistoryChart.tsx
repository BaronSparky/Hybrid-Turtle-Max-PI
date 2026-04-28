'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Shield, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

interface RegimePoint {
  date: string;
  regime: string;
  spyPrice: number | null;
  spyMa200: number | null;
  adx: number | null;
  consecutive: number;
}

const REGIME_COLORS: Record<string, string> = {
  BULLISH: '#22c55e',
  SIDEWAYS: '#eab308',
  BEARISH: '#ef4444',
  CHOP: '#6b7280',
};

export default function RegimeHistoryChart() {
  const [data, setData] = useState<RegimePoint[]>([]);
  const [distribution, setDistribution] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ data: RegimePoint[]; distribution: Record<string, number> }>(`/api/performance/regime-history?days=${days}`);
      setData(result.data);
      setDistribution(result.distribution);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400 animate-pulse" />
          Regime History
        </h3>
        <div className="h-48 flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Regime History
        </h3>
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          Not enough regime data yet — will appear after nightly scans run.
        </div>
      </div>
    );
  }

  // Add numeric regime value for chart rendering
  const chartData = data.map(d => ({
    ...d,
    regimeValue: d.regime === 'BULLISH' ? 3 : d.regime === 'SIDEWAYS' ? 2 : d.regime === 'BEARISH' ? 1 : 2,
  }));

  const total = Object.values(distribution).reduce((s, v) => s + v, 0);

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Regime History
        </h3>
        <div className="flex items-center gap-2">
          {[30, 90, 180].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded transition-colors',
                days === d ? 'bg-primary-400/20 text-primary-400 font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {d}d
            </button>
          ))}
          <button onClick={fetchData} className="text-muted-foreground hover:text-foreground transition-colors ml-1" title="Refresh">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Distribution */}
      <div className="flex gap-3 mb-3">
        {Object.entries(distribution).map(([regime, count]) => (
          <div key={regime} className="flex items-center gap-1.5 text-[10px]">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: REGIME_COLORS[regime] || '#6b7280' }} />
            <span className="text-muted-foreground">{regime}: {total > 0 ? ((count / total) * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
      </div>

      {/* SPY price chart with regime-colored background */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="spyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={(v: string) => v.slice(5)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#6b7280' }}
              domain={['dataMin - 10', 'dataMax + 10']}
              width={50}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1f36', border: '1px solid #2d3348', borderRadius: 8, fontSize: 11 }}
              formatter={(value: number, name: string) => {
                if (name === 'spyPrice') return [`$${value?.toFixed(2) ?? '—'}`, 'SPY'];
                if (name === 'spyMa200') return [`$${value?.toFixed(2) ?? '—'}`, 'MA200'];
                return [value, name];
              }}
              labelFormatter={(label: string) => {
                const point = chartData.find(d => d.date === label);
                return `${label} — ${point?.regime ?? 'UNKNOWN'}`;
              }}
            />
            {chartData[0]?.spyMa200 && (
              <Area type="monotone" dataKey="spyMa200" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" fill="none" dot={false} />
            )}
            <Area
              type="monotone"
              dataKey="spyPrice"
              stroke="#60a5fa"
              strokeWidth={2}
              fill="url(#spyGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
