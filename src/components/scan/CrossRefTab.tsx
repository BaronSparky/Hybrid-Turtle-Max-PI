'use client';

/**
 * DEPENDENCIES
 * Consumed by: /scan page (Cross-Reference tab)
 * Consumes: /api/scan/cross-ref
 * Risk-sensitive: NO (display only)
 * Last modified: 2026-03-03
 * Notes: Lifted from src/app/scan/cross-ref/page.tsx — identical functionality,
 *        rendered inside a tab instead of a full page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  GitMerge,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  Search,
  BarChart3,
  Filter,
  ChevronDown,
  ChevronUp,
  Zap,
  Eye,
  XCircle,
  Minus,
} from 'lucide-react';
import { apiRequest, formatApiError } from '@/lib/api-client';
import { PercentBar } from '@/components/ui/PercentBar';

// ── Types ──────────────────────────────────────────────────
interface CrossRefTicker {
  ticker: string;
  name: string;
  sleeve: string;
  scanStatus: string | null;
  scanRankScore: number | null;
  scanPassesFilters: boolean | null;
  scanPassesRiskGates: boolean | null;
  scanPassesAntiChase: boolean | null;
  scanDistancePercent: number | null;
  scanEntryTrigger: number | null;
  scanStopPrice: number | null;
  scanPrice: number | null;
  scanShares: number | null;
  scanRiskDollars: number | null;
  dualBQS: number | null;
  dualFWS: number | null;
  dualNCS: number | null;
  dualAction: string | null;
  dualStatus: string | null;
  dualClose: number | null;
  dualEntryTrigger: number | null;
  dualStopLevel: number | null;
  dualDistancePct: number | null;
  matchType: 'BOTH_RECOMMEND' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'BOTH_REJECT' | 'CONFLICT';
  agreementScore: number;
  bps: number | null;
}

interface CrossRefData {
  tickers: CrossRefTicker[];
  summary: {
    total: number;
    bothRecommend: number;
    conflict: number;
    scanOnly: number;
    dualOnly: number;
    bothReject: number;
    hasScanData: boolean;
    hasDualData: boolean;
    scanCachedAt: string | null;
  };
}

type MatchFilter = 'ALL' | 'BOTH_RECOMMEND' | 'CONFLICT' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'BOTH_REJECT';

// ── Match type config ───────────────────────────────────────
const MATCH_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode; description: string }> = {
  BOTH_RECOMMEND: {
    label: 'Both Recommend',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: <Check className="w-4 h-4" />,
    description: 'Both systems agree this is a good candidate',
  },
  CONFLICT: {
    label: 'Conflict',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: <AlertTriangle className="w-4 h-4" />,
    description: 'Systems disagree — one recommends, the other rejects',
  },
  SCAN_ONLY: {
    label: '7-Stage Only',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: <Search className="w-4 h-4" />,
    description: 'Passes the 7-stage scan but no dual score data',
  },
  DUAL_ONLY: {
    label: 'Dual Score Only',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    icon: <BarChart3 className="w-4 h-4" />,
    description: 'Good dual score but not in the 7-stage scan',
  },
  BOTH_REJECT: {
    label: 'Both Reject',
    color: 'text-slate-500',
    bg: 'bg-slate-500/5',
    border: 'border-slate-500/20',
    icon: <X className="w-4 h-4" />,
    description: 'Neither system recommends this ticker',
  },
};

// ── Helper components ───────────────────────────────────────

function SleeveBadge({ sleeve }: { sleeve: string }) {
  const cfg =
    sleeve === 'CORE'
      ? 'bg-primary/15 text-primary-400 border-primary/30'
      : sleeve === 'ETF'
      ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
      : sleeve === 'HIGH_RISK'
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : sleeve === 'HEDGE'
      ? 'bg-slate-500/15 text-slate-400 border-slate-500/30'
      : 'bg-navy-700 text-muted-foreground border-navy-600';
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold border', cfg)}>
      {sleeve || '—'}
    </span>
  );
}

function ScanStatusIcon({ status }: { status: string | null }) {
  if (!status) return <Minus className="w-3.5 h-3.5 text-slate-600" />;
  if (status === 'READY') return <Zap className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'WATCH') return <Eye className="w-3.5 h-3.5 text-amber-400" />;
  return <XCircle className="w-3.5 h-3.5 text-red-400" />;
}

function ActionBadge({ action }: { action: string | null }) {
  if (!action) return <span className="text-xs text-slate-600">—</span>;
  const isYes = action.startsWith('Auto-Yes');
  const isNo = action.startsWith('Auto-No');
  return (
    <span
      className={cn(
        'text-[10px] font-semibold px-1.5 py-0.5 rounded',
        isYes && 'bg-emerald-500/15 text-emerald-400',
        isNo && 'bg-red-500/15 text-red-400',
        !isYes && !isNo && 'bg-amber-500/15 text-amber-400'
      )}
    >
      {isYes ? 'Auto-Yes' : isNo ? 'Auto-No' : 'Conditional'}
    </span>
  );
}

function toFillClass(color: string): string {
  switch (color) {
  case 'bg-blue-400': return 'fill-blue-400';
  case 'bg-emerald-400': return 'fill-emerald-400';
  case 'bg-amber-400': return 'fill-amber-400';
  case 'bg-red-400': return 'fill-red-400';
  default: return 'fill-slate-400';
  }
}

function ScoreBar({ value, max = 100, color }: { value: number | null; max?: number; color: string }) {
  if (value === null) return <span className="text-xs text-slate-600">—</span>;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-navy-700 rounded-full overflow-hidden">
        <PercentBar value={pct} fillClassName={toFillClass(color)} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-8 text-right">
        {value.toFixed(0)}
      </span>
    </div>
  );
}

function AgreementMeter({ score }: { score: number }) {
  const color =
    score >= 75 ? 'bg-emerald-400' : score >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 bg-navy-700 rounded-full overflow-hidden">
        <PercentBar value={score} fillClassName={toFillClass(color)} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground">{score}</span>
    </div>
  );
}

function TickerDetail({ t }: { t: CrossRefTicker }) {
  return (
    <tr>
      <td colSpan={11} className="px-4 py-3 bg-navy-800/50 border-t border-navy-700/50">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 7-Stage Scan Detail */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <Search className="w-3 h-3" /> 7-Stage Scan
            </h4>
            {t.scanStatus === null ? (
              <p className="text-xs text-muted-foreground">No scan data — run the 7-Stage Scan first</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">Status</div>
                  <div className={cn(
                    'font-bold',
                    t.scanStatus === 'READY' && 'text-emerald-400',
                    t.scanStatus === 'WATCH' && 'text-amber-400',
                    t.scanStatus === 'FAR' && 'text-red-400'
                  )}>{t.scanStatus}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">Rank Score</div>
                  <div className="font-mono font-bold text-foreground">{t.scanRankScore?.toFixed(1) ?? '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">Distance</div>
                  <div className="font-mono font-bold text-foreground">{t.scanDistancePercent != null ? `${t.scanDistancePercent.toFixed(2)}%` : '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">Entry Trigger</div>
                  <div className="font-mono font-bold text-foreground">{t.scanEntryTrigger != null ? t.scanEntryTrigger.toFixed(2) : '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">Price</div>
                  <div className="font-mono font-bold text-foreground">{t.scanPrice != null ? t.scanPrice.toFixed(2) : '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">Sized Shares</div>
                  <div className="font-mono font-bold text-foreground">{t.scanShares ?? '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2 col-span-2">
                  <div className="text-muted-foreground mb-1">Gate Checks</div>
                  <div className="flex gap-3">
                    <span className="flex items-center gap-1">
                      {t.scanPassesFilters ? <Check className="w-3 h-3 text-emerald-400" /> : <X className="w-3 h-3 text-red-400" />}
                      Filters
                    </span>
                    <span className="flex items-center gap-1">
                      {t.scanPassesRiskGates == null ? <Minus className="w-3 h-3 text-slate-500" /> : t.scanPassesRiskGates ? <Check className="w-3 h-3 text-emerald-400" /> : <X className="w-3 h-3 text-red-400" />}
                      {t.scanPassesRiskGates == null ? 'Risk Gates (Unknown)' : 'Risk Gates'}
                    </span>
                    <span className="flex items-center gap-1">
                      {t.scanPassesAntiChase == null ? <Minus className="w-3 h-3 text-slate-500" /> : t.scanPassesAntiChase ? <Check className="w-3 h-3 text-emerald-400" /> : <X className="w-3 h-3 text-red-400" />}
                      {t.scanPassesAntiChase == null ? 'Anti-Chase (Unknown)' : 'Anti-Chase'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Dual Score Detail */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-3 h-3" /> Dual Score
            </h4>
            {t.dualNCS === null ? (
              <p className="text-xs text-muted-foreground">No dual score data — sync snapshots first</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">BQS (Breakout Quality)</div>
                  <div className="font-mono font-bold text-blue-400">{t.dualBQS?.toFixed(1) ?? '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">FWS (Fatal Weakness)</div>
                  <div className={cn(
                    'font-mono font-bold',
                    (t.dualFWS ?? 0) > 50 ? 'text-red-400' : (t.dualFWS ?? 0) > 30 ? 'text-amber-400' : 'text-emerald-400'
                  )}>{t.dualFWS?.toFixed(1) ?? '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">NCS (Net Composite)</div>
                  <div className={cn(
                    'font-mono font-bold',
                    (t.dualNCS ?? 0) >= 70 ? 'text-emerald-400' : (t.dualNCS ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400'
                  )}>{t.dualNCS?.toFixed(1) ?? '—'}</div>
                </div>
                <div className="bg-navy-700/50 rounded p-2">
                  <div className="text-muted-foreground">Action</div>
                  <div><ActionBadge action={t.dualAction} /></div>
                </div>
                <div className="bg-navy-700/50 rounded p-2 col-span-2">
                  <div className="text-muted-foreground mb-1">Full Action Note</div>
                  <div className="text-foreground text-[11px]">{t.dualAction ?? '—'}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════
// Component
// ════════════════════════════════════════════════════════════
export default function CrossRefTab() {
  const [data, setData] = useState<CrossRefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('ALL');
  const [sleeveFilter, setSleeveFilter] = useState('');
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<CrossRefData>('/api/scan/cross-ref');
      setData(result);
    } catch (error) {
      setError(formatApiError(error, 'Failed to load cross-reference data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let tickers = data.tickers;

    if (!showRejected) {
      tickers = tickers.filter((t) => t.matchType !== 'BOTH_REJECT');
    }
    if (matchFilter !== 'ALL') {
      tickers = tickers.filter((t) => t.matchType === matchFilter);
    }
    if (sleeveFilter) {
      tickers = tickers.filter((t) => t.sleeve === sleeveFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      tickers = tickers.filter(
        (t) =>
          t.ticker.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q)
      );
    }

    const matchPriority: Record<string, number> = {
      BOTH_RECOMMEND: 0,
      CONFLICT: 1,
      SCAN_ONLY: 2,
      DUAL_ONLY: 3,
      BOTH_REJECT: 4,
    };
    tickers = [...tickers].sort((a, b) => {
      const pa = matchPriority[a.matchType] ?? 9;
      const pb = matchPriority[b.matchType] ?? 9;
      if (pa !== pb) return pa - pb;
      return b.agreementScore - a.agreementScore;
    });

    return tickers;
  }, [data, matchFilter, sleeveFilter, search, showRejected]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-primary-400 animate-spin" />
          <p className="text-sm text-muted-foreground">Cross-referencing scan data...</p>
        </div>
      </div>
    );
  }

  // ── Error / empty ──
  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="card-surface p-8 text-center max-w-lg">
          <div className="text-5xl mb-4">🔀</div>
          <h2 className="text-lg font-bold text-foreground mb-2">No Data to Cross-Reference</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Run the <strong>7-Stage Scan</strong> (Pipeline tab) and/or sync <strong>Dual Score</strong> snapshots
            (Scores tab) to populate this view.
          </p>
          {error && (
            <p className="text-xs text-loss/80 mb-4 font-mono bg-navy-800 p-3 rounded-lg">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          Comparing 7-Stage Scan vs Dual Score — {summary.total} tickers
          {summary.scanCachedAt && (
            <span className="ml-2 text-xs text-primary-400/60">
              Scan cached {new Date(summary.scanCachedAt).toLocaleString()}
            </span>
          )}
        </p>
        <button
          onClick={() => fetchData()}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Data Source Indicators */}
      <div className="flex gap-3 flex-wrap">
        <div className={cn(
          'card-surface px-4 py-2 flex items-center gap-2 text-sm border',
          summary.hasScanData ? 'border-emerald-500/30' : 'border-red-500/30'
        )}>
          {summary.hasScanData ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <X className="w-4 h-4 text-red-400" />
          )}
          <span className={summary.hasScanData ? 'text-emerald-400' : 'text-red-400'}>
            7-Stage Scan {summary.hasScanData ? 'Loaded' : 'Not Run'}
          </span>
        </div>
        <div className={cn(
          'card-surface px-4 py-2 flex items-center gap-2 text-sm border',
          summary.hasDualData ? 'border-emerald-500/30' : 'border-red-500/30'
        )}>
          {summary.hasDualData ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <X className="w-4 h-4 text-red-400" />
          )}
          <span className={summary.hasDualData ? 'text-emerald-400' : 'text-red-400'}>
            Dual Score {summary.hasDualData ? 'Loaded' : 'No Data'}
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { key: 'BOTH_RECOMMEND' as const, count: summary.bothRecommend },
          { key: 'CONFLICT' as const, count: summary.conflict },
          { key: 'SCAN_ONLY' as const, count: summary.scanOnly },
          { key: 'DUAL_ONLY' as const, count: summary.dualOnly },
          { key: 'BOTH_REJECT' as const, count: summary.bothReject },
        ].map(({ key, count }) => {
          const cfg = MATCH_CONFIG[key];
          const active = matchFilter === key;
          return (
            <button
              key={key}
              onClick={() => setMatchFilter(active ? 'ALL' : key)}
              className={cn(
                'card-surface p-4 text-center border transition-all hover:brightness-110',
                active ? cfg.border + ' ring-1 ring-' + cfg.border.replace('border-', '') : 'border-transparent',
                cfg.bg
              )}
            >
              <div className={cn('flex items-center justify-center gap-1.5 mb-1', cfg.color)}>
                {cfg.icon}
                <span className="text-2xl font-bold font-mono">{count}</span>
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">{cfg.label}</div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="card-surface p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search ticker or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-navy-800 rounded-lg text-sm text-foreground placeholder:text-muted-foreground border border-navy-600 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <select
          title="Sleeve filter"
          value={sleeveFilter}
          onChange={(e) => setSleeveFilter(e.target.value)}
          className="bg-navy-800 border border-navy-600 text-sm text-foreground rounded-lg px-3 py-2 focus:border-primary/50 focus:outline-none"
        >
          <option value="">All Sleeves</option>
          <option value="CORE">Core</option>
          <option value="ETF">ETF</option>
          <option value="HIGH_RISK">High-Risk</option>
          <option value="HEDGE">Hedge</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRejected}
            onChange={(e) => setShowRejected(e.target.checked)}
            className="rounded bg-navy-800 border-navy-600"
          />
          Show rejected ({summary.bothReject})
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* "Both Recommend" Highlight Banner */}
      {summary.bothRecommend > 0 && matchFilter === 'ALL' && (
        <div className="bg-emerald-500/10 border-2 border-emerald-500/40 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-emerald-400">
                {summary.bothRecommend} Ticker{summary.bothRecommend !== 1 ? 's' : ''} — Both Systems Agree
              </div>
              <div className="text-sm text-emerald-400/70">
                These pass the 7-stage pipeline AND have strong dual scores
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.tickers
              .filter((t) => t.matchType === 'BOTH_RECOMMEND')
              .map((t) => (
                <button
                  key={t.ticker}
                  onClick={() => {
                    setMatchFilter('BOTH_RECOMMEND');
                    setExpandedTicker(expandedTicker === t.ticker ? null : t.ticker);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm font-bold border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                >
                  {t.ticker}
                  {t.dualNCS != null && (
                    <span className="ml-1.5 text-emerald-400/60 text-xs font-normal">
                      NCS {t.dualNCS.toFixed(0)}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Conflicts Banner */}
      {summary.conflict > 0 && matchFilter === 'ALL' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <div className="text-sm font-bold text-amber-400">
                {summary.conflict} Conflict{summary.conflict !== 1 ? 's' : ''} — Manual Review Needed
              </div>
              <div className="text-xs text-amber-400/70">
                One system recommends while the other rejects. Click to expand and review the details.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Comparison Table */}
      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700 text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Ticker</th>
                <th className="px-3 py-3 text-left">Sleeve</th>
                <th className="px-3 py-3 text-center">Match</th>
                <th className="px-3 py-3 text-center">Agreement</th>
                <th className="px-3 py-3 text-center" title="7-Stage Scan Status">Scan Status</th>
                <th className="px-3 py-3 text-center" title="7-Stage Rank Score">Rank</th>
                <th className="px-3 py-3 text-center" title="Dual Score NCS">NCS</th>
                <th className="px-3 py-3 text-center" title="Dual Score BQS">BQS</th>
                <th className="px-3 py-3 text-center" title="Dual Score FWS (lower is better)">FWS</th>
                <th className="px-3 py-3 text-center" title="Breakout Probability Score (0–19, higher = better)">BPS</th>
                <th className="px-3 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    No tickers match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((t) => {
                const cfg = MATCH_CONFIG[t.matchType];
                const isExpanded = expandedTicker === t.ticker;
                return (
                  <>
                    <tr
                      key={t.ticker}
                      onClick={() => setExpandedTicker(isExpanded ? null : t.ticker)}
                      className={cn(
                        'border-b border-navy-700/50 cursor-pointer transition-colors hover:bg-navy-800/50',
                        isExpanded && 'bg-navy-800/30'
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <div>
                            <div className="font-bold text-primary-400">{t.ticker}</div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{t.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <SleeveBadge sleeve={t.sleeve} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border', cfg.bg, cfg.border, cfg.color)}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <AgreementMeter score={t.agreementScore} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <ScanStatusIcon status={t.scanStatus} />
                          <span className={cn(
                            'text-xs font-semibold',
                            t.scanStatus === 'READY' && 'text-emerald-400',
                            t.scanStatus === 'WATCH' && 'text-amber-400',
                            t.scanStatus === 'FAR' && 'text-red-400',
                            !t.scanStatus && 'text-slate-600'
                          )}>
                            {t.scanStatus ?? '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-xs font-mono text-foreground">
                          {t.scanRankScore != null ? t.scanRankScore.toFixed(1) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <ScoreBar
                          value={t.dualNCS}
                          color={
                            (t.dualNCS ?? 0) >= 70 ? 'bg-emerald-400' : (t.dualNCS ?? 0) >= 50 ? 'bg-amber-400' : 'bg-red-400'
                          }
                        />
                      </td>
                      <td className="px-3 py-3">
                        <ScoreBar value={t.dualBQS} color="bg-blue-400" />
                      </td>
                      <td className="px-3 py-3">
                        <ScoreBar
                          value={t.dualFWS}
                          color={
                            (t.dualFWS ?? 0) > 50 ? 'bg-red-400' : (t.dualFWS ?? 0) > 30 ? 'bg-amber-400' : 'bg-emerald-400'
                          }
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        {t.bps != null ? (
                          <span
                            className={cn(
                              'text-xs font-mono font-semibold px-1.5 py-0.5 rounded',
                              t.bps >= 14 && 'text-profit bg-profit/15',
                              t.bps >= 10 && t.bps < 14 && 'text-blue-400 bg-blue-500/15',
                              t.bps >= 6 && t.bps < 10 && 'text-amber-400 bg-amber-500/15',
                              t.bps < 6 && 'text-muted-foreground bg-white/5',
                            )}
                            title={`Breakout Probability Score: ${t.bps}/19`}
                          >
                            {t.bps}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ActionBadge action={t.dualAction} />
                      </td>
                    </tr>
                    {isExpanded && <TickerDetail key={`${t.ticker}-detail`} t={t} />}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
