'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/utils';
import { apiRequest, formatApiError } from '@/lib/api-client';
import {
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';

interface HedgePosition {
  id: string;
  ticker: string;
  name: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  shares: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  rMultiple: number;
  entryDate: string;
  priceCurrency: string;
  currency: string;
  protectionLevel: string;
  stopGuidance: {
    recommendedStop: number;
    recommendedLevel: string;
    reason: string;
  } | null;
}

interface HedgeData {
  positions: HedgePosition[];
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  count: number;
}

export default function HedgeCard() {
  const [data, setData] = useState<HedgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHedge = async () => {
    try {
      setLoading(true);
      setError(null);
      const json = await apiRequest<HedgeData>('/api/positions/hedge?userId=default-user');
      setData(json);
    } catch (error) {
      setError(formatApiError(error, 'Unable to load hedge positions'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHedge(); // Fetch once on mount — manual refresh via button
  }, []);

  const formatGBP = (v: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v);

  const levelLabel = (level: string) => {
    switch (level) {
      case 'BREAKEVEN': return 'B/E';
      case 'LOCK_08R': return '+0.5R';
      case 'LOCK_1R_TRAIL': return 'Trail';
      default: return 'Init';
    }
  };

  const levelColor = (level: string) => {
    switch (level) {
      case 'BREAKEVEN': return 'text-yellow-400';
      case 'LOCK_08R': return 'text-blue-400';
      case 'LOCK_1R_TRAIL': return 'text-profit';
      default: return 'text-muted-foreground';
    }
  };

  if (loading && !data) {
    return (
      <div className="card-surface p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-semibold text-muted-foreground">Hedge Portfolio</span>
        </div>
        <div className="h-16 bg-surface-2 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-surface p-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-semibold text-foreground">Hedge Portfolio</span>
        </div>
        <p className="text-xs text-loss">{error}</p>
      </div>
    );
  }

  if (!data || data.positions.length === 0) {
    return (
      <div className="card-surface p-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-semibold text-foreground">Hedge Portfolio</span>
        </div>
        <p className="text-xs text-muted-foreground text-center py-4">
          No hedge positions. Add long-term holds via Settings → Stocks (Hedge sleeve).
        </p>
      </div>
    );
  }

  const positionsToShow = expanded ? data.positions : data.positions.slice(0, 5);

  return (
    <div className="card-surface p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-semibold text-foreground">Hedge Portfolio</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-400 font-medium">
            {data.count} position{data.count !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-sm font-semibold',
            data.totalPnl >= 0 ? 'text-profit' : 'text-loss'
          )}>
            {data.totalPnl >= 0 ? '+' : ''}{formatGBP(data.totalPnl)}
          </span>
          <button
            onClick={fetchHedge}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3 mb-3 text-center">
        <div className="bg-surface-2 rounded-lg p-2">
          <div className="text-[10px] text-muted-foreground">Total Value</div>
          <div className="text-sm font-semibold text-foreground">{formatGBP(data.totalValue)}</div>
        </div>
        <div className="bg-surface-2 rounded-lg p-2">
          <div className="text-[10px] text-muted-foreground">Total P&L</div>
          <div className={cn(
            'text-sm font-semibold',
            data.totalPnl >= 0 ? 'text-profit' : 'text-loss'
          )}>
            {data.totalPnlPercent >= 0 ? '+' : ''}{data.totalPnlPercent.toFixed(1)}%
          </div>
        </div>
        <div className="bg-surface-2 rounded-lg p-2">
          <div className="text-[10px] text-muted-foreground">Positions</div>
          <div className="text-sm font-semibold text-foreground">{data.count}</div>
        </div>
      </div>

      {/* Position list */}
      <div className="space-y-1.5">
        {positionsToShow.map((pos) => {
          const stopAlert = pos.currentPrice <= pos.stopLoss * 1.05; // within 5% of stop
          const hasStopUpgrade = pos.stopGuidance != null &&
            pos.stopGuidance.recommendedLevel !== pos.protectionLevel &&
            pos.stopGuidance.recommendedStop > pos.stopLoss;

          return (
            <div
              key={pos.id}
              className={cn(
                'flex items-center gap-3 p-2 rounded-lg transition-colors',
                stopAlert ? 'bg-loss/10 border border-loss/20' : 'bg-surface-2 hover:bg-white/5'
              )}
            >
              {/* Ticker + name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-semibold text-foreground">
                    {pos.ticker}
                  </span>
                  {stopAlert && (
                    <AlertTriangle className="w-3 h-3 text-loss flex-shrink-0" />
                  )}
                  {hasStopUpgrade && pos.stopGuidance && (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400"
                      title={pos.stopGuidance.reason}
                    >
                      ↑ {levelLabel(pos.stopGuidance.recommendedLevel)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  Stop: {formatPrice(pos.stopLoss, pos.priceCurrency)}
                  <span className={cn('ml-1', levelColor(pos.protectionLevel))}>
                    ({levelLabel(pos.protectionLevel)})
                  </span>
                </div>
              </div>

              {/* Price */}
              <div className="text-right">
                <div className="text-xs font-mono text-foreground">
                  {formatPrice(pos.currentPrice, pos.priceCurrency)}
                </div>
                <div className={cn(
                  'text-[10px] font-mono flex items-center justify-end gap-0.5',
                  pos.pnl >= 0 ? 'text-profit' : 'text-loss'
                )}>
                  {pos.pnl >= 0 ? (
                    <TrendingUp className="w-2.5 h-2.5" />
                  ) : (
                    <TrendingDown className="w-2.5 h-2.5" />
                  )}
                  {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
                  <span className="text-muted-foreground ml-1">
                    ({pos.rMultiple >= 0 ? '+' : ''}{pos.rMultiple.toFixed(1)}R)
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expand/collapse */}
      {data.positions.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          {expanded ? (
            <>Show less <ChevronUp className="w-3 h-3" /></>
          ) : (
            <>Show all {data.count} <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      )}

      {/* Guidance footer */}
      <div className="mt-3 pt-3 border-t border-white/5">
        <div className="text-[10px] text-muted-foreground text-center italic">
          Hedge positions are exempt from laggard purge & open risk caps.
          Stop guidance shown but not enforced — manage at your discretion.
        </div>
      </div>
    </div>
  );
}
