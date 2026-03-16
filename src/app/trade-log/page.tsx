'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import { apiRequest } from '@/lib/api-client';
import { Loader2, BookOpen } from 'lucide-react';
import RecordPastTradeModal from '@/components/trade-log/RecordPastTradeModal';

const DEFAULT_USER_ID = 'default-user';

type TradeLogRow = {
  id: string;
  ticker: string;
  tradeDate: string;
  tradeType: string;
  decision: string;
  scanStatus: string | null;
  regime: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  finalRMultiple: number | null;
  gainLossGbp: number | null;
  slippagePct: number | null;
  decisionReason: string | null;
  exitReason: string | null;
  whatWentWell: string | null;
  whatWentWrong: string | null;
  lessonsLearned: string | null;
  wouldTakeAgain: boolean | null;
  tags: string | null;
};

type SummaryResponse = {
  totals: {
    totalLogs: number;
    totalOutcomes: number;
    worked: number;
    failed: number;
    winRate: number;
    expectancyR: number | null;
    avgSlippagePct: number | null;
  };
  topDecisionReasons: Array<{ key: string; count: number }>;
  topWinningTags: Array<{ key: string; count: number }>;
  topLosingTags: Array<{ key: string; count: number }>;
  byRegime: Record<string, { count: number; avgR: number | null }>;
};

type MonthlyTrendPoint = {
  month: string;
  winRate: number;
  outcomes: number;
  avgR: number | null;
};

type QueryFilters = {
  ticker: string;
  decision: string;
  tradeType: string;
  from: string;
  to: string;
};

type PresetType = '30D' | '90D' | 'YTD' | 'ALL';

function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `£${value.toFixed(2)}`;
}

export default function TradeLogPage() {
  const [logs, setLogs] = useState<TradeLogRow[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [tickerFilter, setTickerFilter] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [tradeTypeFilter, setTradeTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [activePreset, setActivePreset] = useState<PresetType | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const hasLoadedOnce = useRef(false);

  const fetchData = useCallback(async (overrides?: Partial<QueryFilters>) => {
    setLoading(true);
    try {
      const effective: QueryFilters = {
        ticker: tickerFilter.trim(),
        decision: decisionFilter,
        tradeType: tradeTypeFilter,
        from: fromDate,
        to: toDate,
        ...overrides,
      };

      const query = new URLSearchParams({
        userId: DEFAULT_USER_ID,
        limit: '300',
      });

      if (effective.ticker) query.set('ticker', effective.ticker);
      if (effective.decision !== 'all') query.set('decision', effective.decision);
      if (effective.tradeType !== 'all') query.set('tradeType', effective.tradeType);
      if (effective.from) query.set('from', effective.from);
      if (effective.to) query.set('to', effective.to);

      const [logsResult, summaryResult] = await Promise.all([
        apiRequest<{ logs: TradeLogRow[] }>(`/api/trade-log?${query.toString()}`),
        apiRequest<SummaryResponse>(`/api/trade-log/summary?${query.toString()}`),
      ]);

      setLogs(logsResult.logs || []);
      setSummary(summaryResult);
      setLastUpdatedAt(new Date());
    } catch {
      setLogs([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [tickerFilter, decisionFilter, tradeTypeFilter, fromDate, toDate]);

  const applyPreset = useCallback((preset: PresetType) => {
    const now = new Date();
    const format = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    let nextFrom = '';
    let nextTo = '';

    if (preset === 'ALL') {
      nextFrom = '';
      nextTo = '';
    } else if (preset === 'YTD') {
      nextFrom = `${now.getFullYear()}-01-01`;
      nextTo = format(now);
    } else {
      const days = preset === '30D' ? 30 : 90;
      const start = new Date(now);
      start.setDate(now.getDate() - days);
      nextFrom = format(start);
      nextTo = format(now);
    }

    setFromDate(nextFrom);
    setToDate(nextTo);
    setActivePreset(preset);
    setPresetLoading(true);
    void fetchData({ from: nextFrom, to: nextTo }).finally(() => {
      setPresetLoading(false);
    });
  }, [fetchData]);

  useEffect(() => {
    if (hasLoadedOnce.current) return;
    hasLoadedOnce.current = true;
    void fetchData();
  }, [fetchData]);

  const workedRows = useMemo(
    () => logs.filter((row) => (row.finalRMultiple ?? 0) > 0 || (row.gainLossGbp ?? 0) > 0),
    [logs]
  );

  const failedRows = useMemo(
    () => logs.filter((row) => (row.finalRMultiple ?? 0) <= 0 && (row.gainLossGbp ?? 0) <= 0 && (row.finalRMultiple !== null || row.gainLossGbp !== null)),
    [logs]
  );

  const monthlyTrend = useMemo<MonthlyTrendPoint[]>(() => {
    const grouped: Record<string, Array<{ worked: boolean; r: number }>> = {};

    logs.forEach((row) => {
      if (row.finalRMultiple === null && row.gainLossGbp === null) return;
      const date = new Date(row.tradeDate);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[month]) grouped[month] = [];

      const worked = row.finalRMultiple !== null
        ? row.finalRMultiple > 0
        : (row.gainLossGbp ?? 0) > 0;

      grouped[month].push({ worked, r: row.finalRMultiple ?? 0 });
    });

    return Object.entries(grouped)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, points]) => {
        const outcomes = points.length;
        const wins = points.filter((point) => point.worked).length;
        const avgR = outcomes > 0 ? points.reduce((sum, point) => sum + point.r, 0) / outcomes : null;
        return {
          month,
          winRate: outcomes > 0 ? (wins / outcomes) * 100 : 0,
          outcomes,
          avgR,
        };
      });
  }, [logs]);

  const regimeRows = useMemo(
    () => Object.entries(summary?.byRegime || {}).sort((a, b) => b[1].count - a[1].count),
    [summary]
  );

  const maxRegimeCount = useMemo(
    () => Math.max(1, ...regimeRows.map(([, stats]) => stats.count)),
    [regimeRows]
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trade Review</h1>
            <p className="text-sm text-muted-foreground">See what worked, what failed, and why.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowRecordModal(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <BookOpen className="w-4 h-4" />
            Record Past Trade
          </button>
        </div>

        <RecordPastTradeModal
          isOpen={showRecordModal}
          onClose={() => setShowRecordModal(false)}
          onSaved={() => void fetchData()}
        />

        <div className="card-surface p-4 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <input
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
            placeholder="Filter ticker (e.g. AAPL)"
            className="px-3 py-2 rounded-md bg-navy-700/40 border border-border text-sm text-foreground"
          />

          <select
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value)}
            className="px-3 py-2 rounded-md bg-navy-700/40 border border-border text-sm text-foreground"
          >
            <option value="all">All decisions</option>
            <option value="TAKEN">TAKEN</option>
            <option value="SKIPPED">SKIPPED</option>
            <option value="PARTIAL">PARTIAL</option>
          </select>

          <select
            value={tradeTypeFilter}
            onChange={(e) => setTradeTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-md bg-navy-700/40 border border-border text-sm text-foreground"
          >
            <option value="all">All trade types</option>
            <option value="ENTRY">ENTRY</option>
            <option value="EXIT">EXIT</option>
            <option value="STOP_HIT">STOP_HIT</option>
            <option value="ADD">ADD</option>
            <option value="TRIM">TRIM</option>
          </select>

          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-2 rounded-md bg-navy-700/40 border border-border text-sm text-foreground"
            aria-label="From date"
          />

          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-2 rounded-md bg-navy-700/40 border border-border text-sm text-foreground"
            aria-label="To date"
          />

          <button
            type="button"
            onClick={() => void fetchData()}
            className="btn-primary"
          >
            Apply Filters
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
            disabled={presetLoading}
            onClick={() => applyPreset('30D')}
          >
            {presetLoading && activePreset === '30D' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Last 30D
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
            disabled={presetLoading}
            onClick={() => applyPreset('90D')}
          >
            {presetLoading && activePreset === '90D' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Last 90D
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
            disabled={presetLoading}
            onClick={() => applyPreset('YTD')}
          >
            {presetLoading && activePreset === 'YTD' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            YTD
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
            disabled={presetLoading}
            onClick={() => applyPreset('ALL')}
          >
            {presetLoading && activePreset === 'ALL' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            All Time
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          Last updated: {lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString('en-GB') : '—'}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
          <div className="card-surface p-4">
            <div className="text-xs text-muted-foreground">Win Rate</div>
            <div className="text-xl font-bold text-foreground">{fmtNumber(summary?.totals.winRate, 1)}%</div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs text-muted-foreground">Expectancy (R)</div>
            <div className="text-xl font-bold text-foreground">{fmtNumber(summary?.totals.expectancyR, 2)}</div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs text-muted-foreground">Avg Slippage %</div>
            <div className="text-xl font-bold text-foreground">{fmtNumber(summary?.totals.avgSlippagePct, 2)}%</div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs text-muted-foreground">Worked</div>
            <div className="text-xl font-bold text-profit">{summary?.totals.worked ?? 0}</div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs text-muted-foreground">Did Not Work</div>
            <div className="text-xl font-bold text-loss">{summary?.totals.failed ?? 0}</div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs text-muted-foreground">Total Logs</div>
            <div className="text-xl font-bold text-foreground">{summary?.totals.totalLogs ?? 0}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card-surface p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Performance by Regime</h3>
            {regimeRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No regime outcome data yet.</div>
            ) : (
              <div className="space-y-3">
                {regimeRows.map(([regime, stats]) => (
                  <div key={regime}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{regime}</span>
                      <span className="text-foreground">{stats.count} trades · Avg R {fmtNumber(stats.avgR, 2)}</span>
                    </div>
                    <div className="h-2 rounded bg-navy-700/50 overflow-hidden">
                      <div
                        className={`h-full ${((stats.avgR ?? 0) >= 0) ? 'bg-profit' : 'bg-loss'}`}
                        style={{ width: `${(stats.count / maxRegimeCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card-surface p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Monthly Win Rate Trend</h3>
            {monthlyTrend.length === 0 ? (
              <div className="text-sm text-muted-foreground">No monthly outcomes yet.</div>
            ) : (
              <div className="space-y-3">
                {monthlyTrend.map((point) => (
                  <div key={point.month}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{point.month}</span>
                      <span className="text-foreground">{fmtNumber(point.winRate, 1)}% · {point.outcomes} outcomes</span>
                    </div>
                    <div className="h-2 rounded bg-navy-700/50 overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.max(0, Math.min(100, point.winRate))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card-surface p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Top Why (Decision Reason)</h3>
            <div className="space-y-2 text-sm">
              {(summary?.topDecisionReasons || []).map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <span className="text-muted-foreground truncate pr-2">{item.key}</span>
                  <span className="text-foreground font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Top Winning Tags</h3>
            <div className="space-y-2 text-sm">
              {(summary?.topWinningTags || []).map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <span className="text-muted-foreground truncate pr-2">{item.key}</span>
                  <span className="text-profit font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Top Losing Tags</h3>
            <div className="space-y-2 text-sm">
              {(summary?.topLosingTags || []).map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <span className="text-muted-foreground truncate pr-2">{item.key}</span>
                  <span className="text-loss font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card-surface p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Worked vs Not Worked (Current Filter)</h3>
          <div className="text-sm text-muted-foreground">
            Worked: <span className="text-profit font-semibold">{workedRows.length}</span> · Failed:{' '}
            <span className="text-loss font-semibold">{failedRows.length}</span>
          </div>
        </div>

        <div className="card-surface p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-foreground mb-3">Trade Journal</h3>
          {loading ? (
            <div className="text-sm text-muted-foreground py-6">Loading trade logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6">No trades found for current filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Ticker</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Regime</th>
                  <th className="py-2 pr-3">R</th>
                  <th className="py-2 pr-3">P/L</th>
                  <th className="py-2 pr-3">Why</th>
                  <th className="py-2 pr-3">What Worked</th>
                  <th className="py-2 pr-3">What Failed</th>
                  <th className="py-2">Lessons</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                      {new Date(row.tradeDate).toLocaleDateString('en-GB')}
                    </td>
                    <td className="py-2 pr-3 text-foreground font-medium">{row.ticker}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.tradeType}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.regime || '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{fmtNumber(row.finalRMultiple, 2)}</td>
                    <td className="py-2 pr-3 text-foreground">{fmtCurrency(row.gainLossGbp)}</td>
                    <td className="py-2 pr-3 text-muted-foreground min-w-[220px]">{row.decisionReason || row.exitReason || '—'}</td>
                    <td className="py-2 pr-3 text-muted-foreground min-w-[220px]">{row.whatWentWell || '—'}</td>
                    <td className="py-2 pr-3 text-muted-foreground min-w-[220px]">{row.whatWentWrong || '—'}</td>
                    <td className="py-2 text-muted-foreground min-w-[220px]">{row.lessonsLearned || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
