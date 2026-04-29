'use client';

/**
 * System Heat Widget — advisory / display-only.
 * Tracks whether the system is deploying capital appropriately during bullish conditions.
 * No execution effect whatsoever.
 */

import { useEffect, useState, useCallback } from 'react';
import { Flame, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {apiRequest, formatApiError } from '@/lib/api-client';

interface SystemHeatData {
  ok: boolean;
  status: 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
  avgRiskUtilBullishPct: number | null;
  avgTradesPerMonth: Record<string, number>;
  pctBullishWeeksWellFilled: number | null;
  coldStreakWeeks: number;
  currentPositions: number;
  maxPositions: number;
  maxRiskPct: number;
  bullishWeeksInWindow: number;
  dataPoints: number;
}

const STATUS_CONFIG = {
  GREEN: {
    label: 'Deploying Well',
    color: 'text-profit',
    bg: 'bg-profit',
    glow: 'shadow-glow-success',
    border: 'border-emerald-500/30',
    bgCard: 'bg-emerald-500/5',
  },
  AMBER: {
    label: 'Under-Deploying',
    color: 'text-warning',
    bg: 'bg-warning',
    glow: 'shadow-[0_0_10px_rgba(245,158,11,0.3)]',
    border: 'border-amber-500/30',
    bgCard: 'bg-amber-500/5',
  },
  RED: {
    label: 'System Appears Frozen',
    color: 'text-loss',
    bg: 'bg-loss',
    glow: 'shadow-glow-danger',
    border: 'border-red-500/30',
    bgCard: 'bg-red-500/5',
  },
  NO_DATA: {
    label: 'Insufficient Data',
    color: 'text-muted-foreground',
    bg: 'bg-navy-600',
    glow: '',
    border: 'border-border',
    bgCard: '',
  },
} as const;

export default function SystemHeatWidget() {
  const [data, setData] = useState<SystemHeatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiRequest<SystemHeatData>('/api/system-heat');
      setData(result);
    } catch (err) {
      setError(formatApiError(err, 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-400" />
          System Heat
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-400" />
          System Heat
        </h3>
        <div className="text-xs text-muted-foreground">{error || 'No data available'}</div>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[data.status];

  return (
    <div className={cn('card-surface p-4', cfg.bgCard)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-400" />
          System Heat
        </h3>
        <button
          onClick={fetchData}
          className="p-1 rounded hover:bg-navy-700 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Traffic Light */}
      <div className="flex items-center gap-3 mb-4">
        <div className={cn('w-5 h-5 rounded-full', cfg.bg, cfg.glow)} />
        <div>
          <span className={cn('text-sm font-bold', cfg.color)}>{cfg.label}</span>
          {data.avgRiskUtilBullishPct !== null && (
            <span className="text-xs text-muted-foreground ml-2">
              ({data.avgRiskUtilBullishPct.toFixed(0)}% avg utilisation)
            </span>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Metric 1: Avg risk utilisation in bullish weeks */}
        <div className="rounded-lg bg-navy-800/50 p-2.5 border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Bullish Risk Util (4w)
          </div>
          <div className={cn('text-lg font-bold', cfg.color)}>
            {data.avgRiskUtilBullishPct !== null ? `${data.avgRiskUtilBullishPct.toFixed(0)}%` : '—'}
          </div>
          <div className="text-[10px] text-muted-foreground">
            of max {data.maxRiskPct}% open risk
          </div>
        </div>

        {/* Metric 2: Trades per month by regime */}
        <div className="rounded-lg bg-navy-800/50 p-2.5 border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Avg Trades/Month
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-profit">BULL</span>
              <span className="text-xs font-semibold text-foreground">
                {data.avgTradesPerMonth.BULLISH ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-warning">SIDE</span>
              <span className="text-xs font-semibold text-foreground">
                {data.avgTradesPerMonth.SIDEWAYS ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-loss">BEAR</span>
              <span className="text-xs font-semibold text-foreground">
                {data.avgTradesPerMonth.BEARISH ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Metric 3: % bullish weeks well-filled */}
        <div className="rounded-lg bg-navy-800/50 p-2.5 border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Well-Filled Bull Weeks
          </div>
          <div className="flex items-baseline gap-1">
            <span className={cn(
              'text-lg font-bold',
              data.pctBullishWeeksWellFilled !== null && data.pctBullishWeeksWellFilled >= 60 ? 'text-profit' :
              data.pctBullishWeeksWellFilled !== null && data.pctBullishWeeksWellFilled >= 30 ? 'text-warning' :
              'text-loss'
            )}>
              {data.pctBullishWeeksWellFilled !== null ? `${data.pctBullishWeeksWellFilled}%` : '—'}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            weeks with &ge;60% positions
          </div>
        </div>

        {/* Metric 4: Cold streak */}
        <div className="rounded-lg bg-navy-800/50 p-2.5 border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Cold Streak
          </div>
          <div className="flex items-baseline gap-1">
            <span className={cn(
              'text-lg font-bold',
              data.coldStreakWeeks === 0 ? 'text-profit' :
              data.coldStreakWeeks <= 2 ? 'text-warning' :
              'text-loss'
            )}>
              {data.coldStreakWeeks}
            </span>
            <span className="text-xs text-muted-foreground">weeks</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            bullish weeks &lt;50% deployed
          </div>
        </div>
      </div>

      {/* RED advisory prompt */}
      {data.status === 'RED' && (
        <div className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-300">
              Review most restrictive gates — check extATR blocks, prediction layer failure modes, and breadth valve
            </p>
          </div>
        </div>
      )}

      {/* Context footer */}
      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {data.bullishWeeksInWindow} bullish weeks in window
        </span>
        <span>{data.dataPoints} snapshots</span>
      </div>
    </div>
  );
}
