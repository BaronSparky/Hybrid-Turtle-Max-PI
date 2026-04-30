'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/execution-audit)
 * Consumes: /api/analytics/execution-audit, shared components (Navbar)
 * Risk-sensitive: NO — read-only analytics page
 * Last modified: 2026-03-06
 *
 * What this page measures:
 *   The gap between what the model planned and what actually executed.
 *   - Entry slippage (planned trigger → actual fill)
 *   - Stop placement accuracy (expected stop → actual initial stop)
 *   - Position sizing accuracy (expected shares → actual shares)
 *   - Risk drift (expected initial risk £ → actual initial risk £)
 *   - Anti-chase compliance (would fill have been blocked?)
 *   - Data freshness impact (LIVE vs CACHE vs STALE)
 */

import { useEffect, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  Target,
  Zap,
  Shield,
  Clock,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface SleeveBreakdown {
  count: number;
  avgSlippagePct: number | null;
  avgSlippageR: number | null;
  materialSlippagePct: number | null;
}

interface AuditSummary {
  totalTrades: number;
  tradesWithFills: number;
  avgSlippagePct: number | null;
  medianSlippagePct: number | null;
  avgSlippageR: number | null;
  medianSlippageR: number | null;
  materialSlippagePct: number | null;
  stopDifferedPct: number | null;
  sizeDifferedPct: number | null;
  worstSlippageTrades: { ticker: string; tradeDate: string; slippagePct: number }[];
  bySleeve: Record<string, SleeveBreakdown>;
}

interface AuditRow {
  tradeLogId: string;
  ticker: string;
  sleeve: string | null;
  tradeDate: string;
  regime: string | null;
  plannedEntry: number | null;
  scanRefPrice: number | null;
  actualFill: number | null;
  fillTimestamp: string | null;
  fillDelayMinutes: number | null;
  expectedStop: number | null;
  actualInitialStop: number | null;
  stopDiffPct: number | null;
  expectedShares: number | null;
  actualShares: number | null;
  sizeDiffPct: number | null;
  expectedRiskGbp: number | null;
  actualRiskGbp: number | null;
  riskDiffPct: number | null;
  slippagePct: number | null;
  slippageR: number | null;
  antiChaseTriggered: boolean;
  wouldViolateAntiChase: boolean;
  riskRulesMetPostFill: boolean;
  dataFreshness: string | null;
  materialSlippage: boolean;
  materialStopDiff: boolean;
  materialSizeDiff: boolean;
}

interface AuditResponse {
  ok: boolean;
  generatedAt: string;
  thresholds: { slippagePct: number; stopDiffPct: number; sizeDiffPct: number; slippageR: number };
  summary: AuditSummary;
  rows: AuditRow[];
}

// ── Formatters ───────────────────────────────────────────────

function fmtPct(v: number | null, showSign = true): string {
  if (v == null) return '—';
  return `${showSign && v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtR(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(3)}R`;
}

function fmtRate(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtPrice(v: number | null): string {
  if (v == null) return '—';
  return v.toFixed(2);
}

function fmtMin(v: number | null): string {
  if (v == null) return '—';
  if (v < 1) return `${Math.round(v * 60)}s`;
  return `${v.toFixed(0)}m`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function slipColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground';
  const abs = Math.abs(v);
  if (abs < 0.1) return 'text-profit';
  if (abs < 0.5) return 'text-warning';
  return 'text-loss font-semibold';
}

function flagColor(bad: boolean): string {
  return bad ? 'text-loss' : 'text-profit';
}

// ── Page ─────────────────────────────────────────────────────

export default function ExecutionAuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sleeve, setSleeve] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (sleeve) params.set('sleeve', sleeve);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const qs = params.toString();
        const result = await apiRequest<AuditResponse>(
          `/api/analytics/execution-audit${qs ? '?' + qs : ''}`
        );
        setData(result);
      } catch (e) {
        setError((e as Error).message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sleeve, from, to]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Execution Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              How much edge do you lose between model plan and actual fill?
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="card-surface p-4 rounded-lg mb-6 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Sleeve</label>
            <select title="Sleeve filter" className="bg-background border border-border rounded px-3 py-1.5 text-sm" value={sleeve} onChange={(e) => setSleeve(e.target.value)}>
              <option value="">All</option>
              <option value="CORE">CORE</option>
              <option value="HIGH_RISK">HIGH_RISK</option>
              <option value="ETF">ETF</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input type="date" title="From date" className="bg-background border border-border rounded px-3 py-1.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <input type="date" title="To date" className="bg-background border border-border rounded px-3 py-1.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading audit data...
          </div>
        )}

        {error && (
          <div className="card-surface p-6 rounded-lg border border-loss/30 text-center">
            <AlertTriangle className="h-8 w-8 text-loss mx-auto mb-2" />
            <p className="text-loss">{error}</p>
          </div>
        )}

        {!loading && !error && data && data.summary.totalTrades === 0 && (
          <div className="card-surface p-10 rounded-lg text-center">
            <Target className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No executed entries found in trade log.</p>
            <p className="text-sm text-muted-foreground mt-1">Execute trades through the Plan → Buy flow to populate this report.</p>
          </div>
        )}

        {!loading && !error && data && data.summary.totalTrades > 0 && (
          <>
            {/* ── Summary Cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              <SummaryCard icon={<Target className="h-4 w-4" />} label="Total Entries" value={String(data.summary.totalTrades)} />
              <SummaryCard icon={<Zap className="h-4 w-4" />} label="Avg Slippage" value={fmtPct(data.summary.avgSlippagePct)} color={slipColor(data.summary.avgSlippagePct)} />
              <SummaryCard icon={<BarChart3 className="h-4 w-4" />} label="Median Slippage" value={fmtPct(data.summary.medianSlippagePct)} color={slipColor(data.summary.medianSlippagePct)} />
              <SummaryCard icon={<Activity className="h-4 w-4" />} label="Avg Slip (R)" value={fmtR(data.summary.avgSlippageR)} color={slipColor(data.summary.avgSlippageR != null ? data.summary.avgSlippageR * 100 : null)} />
              <SummaryCard icon={<AlertTriangle className="h-4 w-4" />} label="Material Slip" value={fmtRate(data.summary.materialSlippagePct)} color={data.summary.materialSlippagePct != null && data.summary.materialSlippagePct > 20 ? 'text-loss' : 'text-profit'} />
            </div>

            {/* ── Plan Accuracy Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <div className="card-surface p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Stop Placement Differed</div>
                <div className={cn('text-xl font-bold tabular-nums', data.summary.stopDifferedPct != null && data.summary.stopDifferedPct > 10 ? 'text-warning' : 'text-profit')}>
                  {fmtRate(data.summary.stopDifferedPct)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">Threshold: &gt; {data.thresholds.stopDiffPct}% diff from plan</div>
              </div>
              <div className="card-surface p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Size Materially Differed</div>
                <div className={cn('text-xl font-bold tabular-nums', data.summary.sizeDifferedPct != null && data.summary.sizeDifferedPct > 10 ? 'text-warning' : 'text-profit')}>
                  {fmtRate(data.summary.sizeDifferedPct)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">Threshold: &gt; {data.thresholds.sizeDiffPct}% diff from plan</div>
              </div>
              <div className="card-surface p-4 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Material Slippage Threshold</div>
                <div className="text-xl font-bold tabular-nums text-foreground">{data.thresholds.slippagePct}%</div>
                <div className="text-[11px] text-muted-foreground mt-1">Slippage R threshold: {data.thresholds.slippageR}R</div>
              </div>
            </div>

            {/* ── Sleeve Breakdown ── */}
            {Object.keys(data.summary.bySleeve).length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Slippage by Sleeve
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 px-3">Sleeve</th>
                        <th className="py-2 px-2 text-right">Trades</th>
                        <th className="py-2 px-2 text-right">Avg Slip %</th>
                        <th className="py-2 px-2 text-right">Avg Slip R</th>
                        <th className="py-2 px-2 text-right">Material %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(data.summary.bySleeve).map(([s, b]) => (
                        <tr key={s} className="border-b border-border/30 hover:bg-card/50">
                          <td className="py-2 px-3 font-medium">{s}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{b.count}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', slipColor(b.avgSlippagePct))}>{fmtPct(b.avgSlippagePct)}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums', slipColor(b.avgSlippageR != null ? b.avgSlippageR * 100 : null))}>{fmtR(b.avgSlippageR)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtRate(b.materialSlippagePct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ── Worst Slippage ── */}
            {data.summary.worstSlippageTrades.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-loss" />
                  Worst Slippage Trades
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  {data.summary.worstSlippageTrades.map((t, i) => (
                    <div key={i} className="card-surface p-3 rounded-lg border border-loss/20">
                      <div className="font-medium text-sm">{t.ticker}</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(t.tradeDate)}</div>
                      <div className={cn('text-lg font-bold tabular-nums mt-1', slipColor(t.slippagePct))}>
                        {fmtPct(t.slippagePct)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Trade Detail Table ── */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Trade-by-Trade Detail
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 px-3 sticky left-0 bg-background z-10">Ticker</th>
                      <th className="py-2 px-2">Date</th>
                      <th className="py-2 px-2">Sleeve</th>
                      <th className="py-2 px-2 text-right">Planned</th>
                      <th className="py-2 px-2 text-right">Filled</th>
                      <th className="py-2 px-2 text-right">Slip %</th>
                      <th className="py-2 px-2 text-right">Slip R</th>
                      <th className="py-2 px-2 text-right border-l border-border">Exp Stop</th>
                      <th className="py-2 px-2 text-right">Act Stop</th>
                      <th className="py-2 px-2 text-right border-l border-border">Exp Shares</th>
                      <th className="py-2 px-2 text-right">Act Shares</th>
                      <th className="py-2 px-2 text-right border-l border-border">Delay</th>
                      <th className="py-2 px-2 text-center border-l border-border">Fresh</th>
                      <th className="py-2 px-2 text-center">Chase</th>
                      <th className="py-2 px-2 text-center">Risk OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr
                        key={r.tradeLogId}
                        className={cn(
                          'border-b border-border/30 hover:bg-card/50 transition-colors',
                          r.materialSlippage && 'bg-loss/5'
                        )}
                      >
                        <td className="py-2 px-3 sticky left-0 bg-background z-10 font-medium">{r.ticker}</td>
                        <td className="py-2 px-2 text-muted-foreground">{fmtDate(r.tradeDate)}</td>
                        <td className="py-2 px-2">{r.sleeve ?? '—'}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmtPrice(r.plannedEntry)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmtPrice(r.actualFill)}</td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', slipColor(r.slippagePct))}>{fmtPct(r.slippagePct)}</td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', slipColor(r.slippageR != null ? r.slippageR * 100 : null))}>{fmtR(r.slippageR)}</td>
                        <td className="py-2 px-2 text-right tabular-nums border-l border-border">{fmtPrice(r.expectedStop)}</td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', r.materialStopDiff ? 'text-warning' : '')}>{fmtPrice(r.actualInitialStop)}</td>
                        <td className="py-2 px-2 text-right tabular-nums border-l border-border">{r.expectedShares?.toFixed(2) ?? '—'}</td>
                        <td className={cn('py-2 px-2 text-right tabular-nums', r.materialSizeDiff ? 'text-warning' : '')}>{r.actualShares?.toFixed(2) ?? '—'}</td>
                        <td className="py-2 px-2 text-right tabular-nums border-l border-border">{fmtMin(r.fillDelayMinutes)}</td>
                        <td className="py-2 px-2 text-center border-l border-border">
                          <FreshnessBadge value={r.dataFreshness} />
                        </td>
                        <td className="py-2 px-2 text-center">
                          {r.wouldViolateAntiChase
                            ? <span className="text-loss text-xs font-medium">VIOLATED</span>
                            : <span className="text-profit text-xs">OK</span>
                          }
                        </td>
                        <td className="py-2 px-2 text-center">
                          {r.riskRulesMetPostFill
                            ? <span className="text-profit text-xs">OK</span>
                            : <span className="text-loss text-xs font-medium">OVER</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Legend */}
            <section className="card-surface p-4 rounded-lg text-xs text-muted-foreground">
              <h3 className="font-semibold text-foreground mb-2">Definitions</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                <div><strong>Slip %:</strong> (actualFill − plannedEntry) / plannedEntry × 100. Positive = overpaid.</div>
                <div><strong>Slip R:</strong> (actualFill − plannedEntry) / initialRisk. How much R was lost to slippage.</div>
                <div><strong>Material Slip:</strong> |slippage| &gt; {data.thresholds.slippagePct}% of entry price.</div>
                <div><strong>Stop Differed:</strong> Actual initial stop &gt; {data.thresholds.stopDiffPct}% different from planned.</div>
                <div><strong>Size Differed:</strong> Actual shares &gt; {data.thresholds.sizeDiffPct}% different from plan.</div>
                <div><strong>Chase:</strong> Would the fill have been blocked by the 0.8-ATR anti-chase extension check?</div>
                <div><strong>Risk OK:</strong> Does actual risk £ still fit within profile limit + 25% tolerance?</div>
                <div><strong>Fresh:</strong> Was data LIVE, CACHE, or STALE at decision time?</div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function SummaryCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="card-surface p-3 rounded-lg">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</div>
      <div className={cn('text-xl font-bold tabular-nums', color ?? 'text-foreground')}>{value}</div>
    </div>
  );
}

function FreshnessBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>;
  const color = value === 'LIVE' ? 'text-profit' : value === 'CACHE' ? 'text-warning' : 'text-loss';
  return <span className={cn('text-xs font-medium', color)}>{value}</span>;
}
