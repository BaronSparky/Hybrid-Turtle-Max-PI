'use client';

/**
 * DEPENDENCIES
 * Consumed by: navigation
 * Consumes: src/components/shared/Navbar.tsx, src/lib/api-client.ts, Phase 11 backtest APIs
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 11 backtesting and replay page with date-range runner, replay-date inspection, stored run fetch, equity curve, drawdown, and trade log views.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Navbar from '@/components/shared/Navbar';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface BacktestTrade {
  ticker: string;
  name: string;
  sleeve: string;
  regime: string;
  signalDate: string;
  entryPrice: number;
  entryTrigger: number;
  stopLevel: number;
  riskPerShare: number;
  bqs: number;
  fws: number;
  ncs: number;
  bps: number;
  actionNote: string;
  stopHit: boolean;
  stopHitDate: string | null;
  stopHitR: number | null;
  maxFavorableR: number | null;
  maxAdverseR: number | null;
  realizedR: number | null;
  exitDate: string | null;
  exitReason: 'STOP_HIT' | 'TIME_EXIT_20D' | 'PARTIAL_LOOKAHEAD' | 'NO_OUTCOME';
  daysHeld: number | null;
}

interface BacktestCurvePoint {
  date: string;
  equity: number;
  drawdownPct: number;
  tradeCount: number;
}

interface BacktestSummary {
  mode: 'FULL' | 'CORE_LITE';
  startDate: string;
  endDate: string;
  replayDate: string | null;
  initialCapital: number;
  endingCapital: number;
  riskPerTradePct: number;
  snapshotCount: number;
  signalCount: number;
  completedTrades: number;
  winRate: number | null;
  averageR: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  averageHoldingDays: number | null;
  stopsHit: number;
  stopsHitPct: number | null;
}

interface StoredBacktestRun {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  requestedAt: string;
  finishedAt: string | null;
  filters: {
    ticker: string | null;
    sleeve: string | null;
    regime: string | null;
  };
  summary: BacktestSummary;
  trades: BacktestTrade[];
  equityCurve: BacktestCurvePoint[];
  drawdownCurve: BacktestCurvePoint[];
  errorMessage: string | null;
}

interface RunResponse {
  ok: true;
  run: StoredBacktestRun;
}

interface FetchResponse {
  ok: true;
  run: StoredBacktestRun;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }

  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(value: number | null): string {
  if (value == null) {
    return '—';
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number | null): string {
  if (value == null) {
    return '—';
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatR(value: number | null): string {
  if (value == null) {
    return '—';
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

function equityTooltipLabel(label: string): string {
  return formatDate(label);
}

export default function BacktestPage() {
  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000), [today]);
  const [startDate, setStartDate] = useState(toDateInputValue(defaultStart));
  const [endDate, setEndDate] = useState(toDateInputValue(today));
  const [useReplayDate, setUseReplayDate] = useState(false);
  const [replayDate, setReplayDate] = useState(toDateInputValue(today));
  const [mode, setMode] = useState<'FULL' | 'CORE_LITE'>('FULL');
  const [sleeve, setSleeve] = useState('');
  const [regime, setRegime] = useState('');
  const [initialCapital, setInitialCapital] = useState('10000');
  const [riskPerTradePct, setRiskPerTradePct] = useState('2');
  const [run, setRun] = useState<StoredBacktestRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTicker, setSearchTicker] = useState('');

  const loadRun = useCallback(async (id: string) => {
    const response = await apiRequest<FetchResponse>(`/api/backtests/${id}`);
    setRun(response.run);
  }, []);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        startDate,
        endDate,
        replayDate: useReplayDate ? replayDate : null,
        mode,
        sleeve: sleeve || null,
        regime: regime || null,
        initialCapital: Number(initialCapital),
        riskPerTradePct: Number(riskPerTradePct),
      };

      const response = await apiRequest<RunResponse>('/api/backtests/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      await loadRun(response.run.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to run backtest.');
    } finally {
      setLoading(false);
    }
  }, [endDate, initialCapital, loadRun, mode, replayDate, regime, riskPerTradePct, sleeve, startDate, useReplayDate]);

  const filteredTrades = useMemo(() => {
    if (!run) {
      return [];
    }
    if (!searchTicker) {
      return run.trades;
    }

    const query = searchTicker.toUpperCase();
    return run.trades.filter((trade) =>
      trade.ticker.toUpperCase().includes(query) || trade.name.toUpperCase().includes(query),
    );
  }, [run, searchTicker]);

  const drawdownSeries = run?.drawdownCurve.map((point) => ({
    ...point,
    drawdownMagnitude: point.drawdownPct,
  })) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        <section className="card-surface p-6 border border-border/70 overflow-hidden relative">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.5),_transparent_45%),radial-gradient(circle_at_bottom_left,_rgba(34,197,94,0.35),_transparent_40%)]" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 text-xs tracking-[0.25em] uppercase text-primary-300">
                <ShieldCheck className="w-4 h-4" />
                Phase 11 Validation Layer
              </div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <Activity className="w-7 h-7 text-primary-400" />
                Backtesting and Replay
              </h1>
              <p className="text-sm text-muted-foreground">
                Replays the evening signal stack over historical snapshot history, simulates the monotonic stop ladder,
                and projects a fixed-risk equity curve so the same rules can be inspected before more automation.
              </p>
            </div>
            {run && (
              <div className="text-xs text-muted-foreground space-y-1 text-left lg:text-right">
                <div>
                  Run ID: <span className="text-foreground font-mono">{run.id}</span>
                </div>
                <div>Requested: {formatDate(run.requestedAt)}</div>
                <div>Status: <span className="text-foreground">{run.status}</span></div>
              </div>
            )}
          </div>
        </section>

        <section className="card-surface p-6 border border-border/70 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarRange className="w-4 h-4 text-primary-400" />
            Run Controls
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">End date</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Mode</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as 'FULL' | 'CORE_LITE')}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
              >
                <option value="FULL">FULL</option>
                <option value="CORE_LITE">CORE_LITE</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Sleeve filter</span>
              <select
                value={sleeve}
                onChange={(event) => setSleeve(event.target.value)}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
              >
                <option value="">All sleeves</option>
                <option value="STOCK_CORE">Stock Core</option>
                <option value="ETF_CORE">ETF Core</option>
                <option value="STOCK_HIGH_RISK">High Risk</option>
                <option value="HEDGE">Hedge</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Regime filter</span>
              <select
                value={regime}
                onChange={(event) => setRegime(event.target.value)}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
              >
                <option value="">All regimes</option>
                <option value="BULLISH">Bullish</option>
                <option value="SIDEWAYS">Sideways</option>
                <option value="BEARISH">Bearish</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Initial capital</span>
              <input
                type="number"
                min="1000"
                step="500"
                value={initialCapital}
                onChange={(event) => setInitialCapital(event.target.value)}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Risk per trade %</span>
              <input
                type="number"
                min="0.25"
                max="25"
                step="0.25"
                value={riskPerTradePct}
                onChange={(event) => setRiskPerTradePct(event.target.value)}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
              />
            </label>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={useReplayDate}
                  onChange={(event) => setUseReplayDate(event.target.checked)}
                  className="rounded border-border bg-navy-800"
                />
                Replay a single evening
              </label>
              <input
                type="date"
                title="Replay date"
                value={replayDate}
                onChange={(event) => setReplayDate(event.target.value)}
                disabled={!useReplayDate}
                className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground disabled:opacity-50"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runBacktest()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-navy-950 font-semibold disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run Backtest
            </button>
            <button
              type="button"
              onClick={() => run?.id ? void loadRun(run.id) : undefined}
              disabled={!run || loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Stored Run
            </button>
            <span className="text-xs text-muted-foreground">
              Replay mode narrows the trade log to one historical evening while keeping forward outcomes for validation.
            </span>
          </div>
          {error && (
            <div className="rounded-lg border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">
              {error}
            </div>
          )}
        </section>

        {run && run.summary.signalCount === 0 && run.summary.snapshotCount < 5 && (
          <section className="rounded-xl border border-warning/40 bg-warning/10 px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-warning">Insufficient snapshot history</p>
              <p className="text-foreground/80">
                The backtest found only {run.summary.snapshotCount} snapshot{run.summary.snapshotCount === 1 ? '' : 's'} in
                the selected date range. Signals are detected by comparing successive nightly snapshots, so the backtest
                needs data accumulated over several weeks to produce meaningful results.
              </p>
              <p className="text-foreground/80">
                Snapshots are created automatically each time the nightly task runs. After a week or two of nightly runs,
                the backtest will have enough historical data to generate signals and replay trades.
              </p>
            </div>
          </section>
        )}

        {run && (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <MetricCard label="Signals" value={String(run.summary.signalCount)} icon={<Target className="w-4 h-4 text-primary-400" />} />
              <MetricCard label="Completed" value={String(run.summary.completedTrades)} icon={<Activity className="w-4 h-4 text-blue-400" />} />
              <MetricCard label="Win Rate" value={run.summary.winRate == null ? '—' : `${run.summary.winRate.toFixed(2)}%`} valueClass={run.summary.winRate != null && run.summary.winRate >= 50 ? 'text-profit' : 'text-foreground'} icon={<TrendingUp className="w-4 h-4 text-profit" />} />
              <MetricCard label="Average R" value={formatR(run.summary.averageR)} valueClass={run.summary.averageR != null && run.summary.averageR >= 0 ? 'text-profit' : 'text-loss'} icon={<ShieldCheck className="w-4 h-4 text-warning" />} />
              <MetricCard label="Total Return" value={formatPct(run.summary.totalReturnPct)} valueClass={run.summary.totalReturnPct != null && run.summary.totalReturnPct >= 0 ? 'text-profit' : 'text-loss'} icon={<TrendingUp className="w-4 h-4 text-primary-400" />} />
              <MetricCard label="Max Drawdown" value={formatPct(run.summary.maxDrawdownPct == null ? null : -Math.abs(run.summary.maxDrawdownPct))} valueClass="text-loss" icon={<TrendingDown className="w-4 h-4 text-loss" />} />
            </section>

            {run.summary.replayDate && (
              <section className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground">
                Replay date active for <span className="font-semibold">{formatDate(run.summary.replayDate)}</span>. The table below shows only the decisions visible on that evening.
              </section>
            )}

            <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ChartCard
                title="Equity Curve"
                subtitle={`${formatCurrency(run.summary.initialCapital)} to ${formatCurrency(run.summary.endingCapital)}`}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={run.equityCurve}>
                    <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDate} stroke="#94a3b8" />
                    <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} stroke="#94a3b8" width={48} />
                    <Tooltip labelFormatter={equityTooltipLabel} formatter={(value: number) => [formatCurrency(value), 'Equity']} />
                    <Line type="monotone" dataKey="equity" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Drawdown"
                subtitle={run.summary.maxDrawdownPct == null ? 'No closed trades yet' : `Worst drawdown ${run.summary.maxDrawdownPct.toFixed(2)}%`}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={drawdownSeries}>
                    <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDate} stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" width={48} />
                    <Tooltip labelFormatter={equityTooltipLabel} formatter={(value: number) => [`${value.toFixed(2)}%`, 'Drawdown']} />
                    <Area type="monotone" dataKey="drawdownMagnitude" stroke="#ef4444" fill="rgba(239,68,68,0.18)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <DetailCard label="Profit Factor" value={run.summary.profitFactor == null ? '—' : run.summary.profitFactor.toFixed(2)} />
              <DetailCard label="Average Holding" value={run.summary.averageHoldingDays == null ? '—' : `${run.summary.averageHoldingDays.toFixed(1)}d`} />
              <DetailCard label="Stops Hit" value={run.summary.stopsHitPct == null ? `${run.summary.stopsHit}` : `${run.summary.stopsHit} (${run.summary.stopsHitPct.toFixed(2)}%)`} />
              <DetailCard label="Snapshot Rows" value={String(run.summary.snapshotCount)} />
            </section>

            <section className="card-surface p-5 border border-border/70 space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Trade Log</h2>
                  <p className="text-sm text-muted-foreground">
                    Fixed-risk replay of historical evening signals using the stored stop ladder outcome.
                  </p>
                </div>
                <div className="w-full md:w-64">
                  <label className="text-xs text-muted-foreground block mb-2">Filter ticker</label>
                  <input
                    type="text"
                    value={searchTicker}
                    onChange={(event) => setSearchTicker(event.target.value)}
                    placeholder="AAPL"
                    className="w-full bg-navy-800/70 border border-border rounded-lg px-3 py-2 text-foreground"
                  />
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-navy-900/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3 text-left">Date</th>
                      <th className="px-3 py-3 text-left">Ticker</th>
                      <th className="px-3 py-3 text-left">Regime</th>
                      <th className="px-3 py-3 text-right">Entry</th>
                      <th className="px-3 py-3 text-right">Stop</th>
                      <th className="px-3 py-3 text-right">NCS</th>
                      <th className="px-3 py-3 text-right">R</th>
                      <th className="px-3 py-3 text-left">Exit</th>
                      <th className="px-3 py-3 text-right">Held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((trade) => (
                      <tr key={`${trade.ticker}-${trade.signalDate}`} className="border-t border-border/50 hover:bg-navy-800/35">
                        <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{formatDate(trade.signalDate)}</td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-foreground">{trade.ticker}</div>
                          <div className="text-xs text-muted-foreground">{trade.name}</div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{trade.regime}</td>
                        <td className="px-3 py-3 text-right font-mono text-foreground">{trade.entryPrice.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-mono text-muted-foreground">{trade.stopLevel.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right">
                          <span className={cn(
                            'inline-flex min-w-12 justify-center rounded-full border px-2 py-1 text-xs font-semibold',
                            trade.ncs >= 70 ? 'border-profit/40 text-profit bg-profit/10' :
                              trade.ncs >= 50 ? 'border-blue-400/40 text-blue-300 bg-blue-500/10' :
                                'border-warning/40 text-warning bg-warning/10',
                          )}>
                            {trade.ncs.toFixed(0)}
                          </span>
                        </td>
                        <td className={cn(
                          'px-3 py-3 text-right font-mono font-semibold',
                          (trade.realizedR ?? 0) >= 0 ? 'text-profit' : 'text-loss',
                        )}>
                          {formatR(trade.realizedR)}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          <div>{trade.exitReason.replaceAll('_', ' ')}</div>
                          <div>{formatDate(trade.exitDate)}</div>
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">{trade.daysHeld == null ? '—' : `${trade.daysHeld}d`}</td>
                      </tr>
                    ))}
                    {filteredTrades.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                          No trades match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  valueClass,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="card-surface p-4 border border-border/70">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
        {icon}
        {label}
      </div>
      <div className={cn('text-2xl font-bold text-foreground', valueClass)}>{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface p-5 border border-border/70">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface p-4 border border-border/70">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}