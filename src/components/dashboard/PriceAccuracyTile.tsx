'use client';

/**
 * DEPENDENCIES
 * Consumed by: Dashboard page (next to DataSourceTile)
 * Consumes: /api/analytics/price-accuracy
 * Risk-sensitive: NO — read-only display
 * Notes: Shows T212 vs Yahoo price accuracy stats from PriceSnapshot data.
 *        Only renders when snapshot data exists (graceful fallback).
 */

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { BarChart3, TrendingUp, AlertTriangle } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface AccuracyData {
  days: number;
  totalSnapshots: number;
  overall: {
    avgDiffPercent: number;
    maxDiffPercent: number;
    mismatchCount: number;
    mismatchRate: number;
  } | null;
  perTicker: Array<{
    ticker: string;
    snapshots: number;
    avgDiffPercent: number;
    maxDiffPercent: number;
    mismatchCount: number;
  }>;
}

export default function PriceAccuracyTile() {
  const [data, setData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiRequest<AccuracyData>('/api/analytics/price-accuracy?days=7');
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Don't render if no data or still loading
  if (loading || !data || data.totalSnapshots === 0) return null;

  const overall = data.overall;
  if (!overall) return null;

  const isGood = overall.avgDiffPercent < 0.5;
  const isWarning = overall.avgDiffPercent >= 0.5 && overall.avgDiffPercent < 2;

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary-400" />
        Price Accuracy
        <span className="text-xs text-muted-foreground font-normal">({data.days}d)</span>
      </h3>

      {/* Overall accuracy */}
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center',
          isGood ? 'bg-profit/10' : isWarning ? 'bg-warning/10' : 'bg-loss/10'
        )}>
          {isGood ? (
            <TrendingUp className="w-5 h-5 text-profit" />
          ) : (
            <AlertTriangle className={cn('w-5 h-5', isWarning ? 'text-warning' : 'text-loss')} />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border',
              isGood ? 'text-profit bg-profit/10 border-profit/30'
                : isWarning ? 'text-warning bg-warning/10 border-warning/30'
                : 'text-loss bg-loss/10 border-loss/30'
            )}>
              {isGood ? '✓' : '⚠'} Avg diff: {overall.avgDiffPercent}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {data.totalSnapshots} snapshots · Max diff: {overall.maxDiffPercent}%
          </div>
        </div>
      </div>

      {/* Per-ticker breakdown (top 3 worst) */}
      {data.perTicker.length > 0 && (
        <div className="border-t border-border/30 pt-2 space-y-1">
          {data.perTicker.slice(0, 3).map((t) => (
            <div key={t.ticker} className="flex items-center justify-between text-xs">
              <span className="font-mono font-medium">{t.ticker}</span>
              <span className={cn(
                'font-mono',
                t.avgDiffPercent < 0.5 ? 'text-profit' : t.avgDiffPercent < 2 ? 'text-warning' : 'text-loss'
              )}>
                ±{t.avgDiffPercent}% avg ({t.snapshots} samples)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
