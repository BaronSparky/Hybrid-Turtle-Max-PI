'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/signal-audit)
 * Consumes: /api/prediction/signal-audit
 * Risk-sensitive: NO — read-only analysis page
 * Last modified: 2026-03-07
 * Notes: Signal Pruning Audit — shows mutual information analysis of BQS
 *        signal layers. Heatmap of pairwise MI, conditional MI bars, and
 *        KEEP/INVESTIGATE/REDUNDANT recommendations.
 *        ⛔ Analysis only — no changes to NCS or signal weights.
 */

import { useEffect, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { Loader2, PlayCircle, BarChart3, AlertTriangle, CheckCircle2, Download } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface ConditionalMIEntry {
  signal: string;
  conditionalMI: number;
  recommendation: 'KEEP' | 'INVESTIGATE' | 'REDUNDANT';
}

interface MIMatrixEntry {
  signalA: string;
  signalB: string;
  mi: number;
}

interface AuditResult {
  computedAt: string;
  sampleSize: number;
  hasOutcomes: boolean;
  miMatrix: MIMatrixEntry[];
  conditionalMI: ConditionalMIEntry[];
  highCorrPairs: Array<{ signalA: string; signalB: string; mi: number }>;
  summary: string;
}

// ── Signal Labels ────────────────────────────────────────────

const LABELS: Record<string, string> = {
  trend: 'Trend (ADX)',
  direction: 'Direction (DI)',
  volatility: 'Volatility',
  proximity: 'Proximity',
  tailwind: 'Regime (DRS)',
  rs: 'Rel. Strength',
  weeklyAdx: 'Weekly ADX',
  bis: 'BIS',
  hurst: 'Hurst',
  volBonus: 'Vol Bonus',
};

// ── Recommendation Styles ────────────────────────────────────

const recStyles = {
  KEEP: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: '✓' },
  INVESTIGATE: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: '?' },
  REDUNDANT: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: '✕' },
};

// ── Components ───────────────────────────────────────────────

function ConditionalMIBar({ entry }: { entry: ConditionalMIEntry }) {
  const label = LABELS[entry.signal] ?? entry.signal;
  const style = recStyles[entry.recommendation];
  const pct = Math.min(entry.conditionalMI / 0.3, 1) * 100; // normalize to 0.3 max

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-muted-foreground w-28 truncate" title={label}>{label}</span>
      <div className="flex-1 h-4 bg-navy-800/60 rounded-full overflow-hidden relative">
        {/* Threshold markers */}
        <div className="absolute top-0 bottom-0 w-px bg-amber-500/30 z-10" style={{ left: `${(0.05 / 0.3) * 100}%` }} title="0.05 threshold" />
        <div className="absolute top-0 bottom-0 w-px bg-emerald-500/30 z-10" style={{ left: `${(0.15 / 0.3) * 100}%` }} title="0.15 threshold" />
        <div
          className={cn('h-full rounded-full transition-all duration-500',
            entry.recommendation === 'KEEP' ? 'bg-emerald-500/70' :
            entry.recommendation === 'INVESTIGATE' ? 'bg-amber-500/70' : 'bg-red-500/50'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-12 text-right">{(entry.conditionalMI ?? 0).toFixed(3)}</span>
      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border w-20 text-center', style.bg, style.border, style.text)}>
        {style.icon} {entry.recommendation}
      </span>
    </div>
  );
}

function MIHeatmap({ matrix, signals }: { matrix: MIMatrixEntry[]; signals: string[] }) {
  // Build lookup
  const lookup = new Map<string, number>();
  for (const entry of matrix) {
    lookup.set(`${entry.signalA},${entry.signalB}`, entry.mi);
    lookup.set(`${entry.signalB},${entry.signalA}`, entry.mi);
  }

  const maxMI = Math.max(...matrix.map(e => e.mi), 0.01);

  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] border-collapse">
        <thead>
          <tr>
            <th className="p-1" />
            {signals.map(s => (
              <th key={s} className="p-1 text-muted-foreground font-normal text-center writing-mode-vertical" style={{ writingMode: 'vertical-lr' }}>
                {(LABELS[s] ?? s).substring(0, 8)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {signals.map(row => (
            <tr key={row}>
              <td className="p-1 text-muted-foreground text-right pr-2">{(LABELS[row] ?? row).substring(0, 10)}</td>
              {signals.map(col => {
                const mi = lookup.get(`${row},${col}`) ?? 0;
                const intensity = Math.min(mi / maxMI, 1);

                return (
                  <td
                    key={col}
                    className={cn('p-1 text-center rounded', row === col ? 'bg-navy-700/40' : '')}
                    style={row !== col ? { backgroundColor: mi > 0.7
                      ? `rgba(239, 68, 68, ${intensity * 0.3 + 0.05})`
                      : `rgba(59, 130, 246, ${intensity * 0.25 + 0.02})` } : undefined}
                    title={`${LABELS[row] ?? row} ↔ ${LABELS[col] ?? col}: MI=${(mi ?? 0).toFixed(3)}`}
                  >
                    {mi > 0 ? (mi ?? 0).toFixed(2) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function SignalAuditPage() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Fetch latest result on mount
  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const data = await apiRequest<{ ok: boolean; data: { hasResult: boolean; result: AuditResult | null } }>(
          '/api/prediction/signal-audit'
        );
        if (data.data.hasResult && data.data.result) {
          setResult(data.data.result);
        }
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    };
    fetchLatest();
  }, []);

  const runAudit = async () => {
    setRunning(true);
    try {
      const data = await apiRequest<{ ok: boolean; data: AuditResult }>(
        '/api/prediction/signal-audit',
        { method: 'POST' }
      );
      if (data.data) {
        setResult(data.data);
      }
    } catch (error) {
      console.error('Failed to run audit:', error);
    } finally {
      setRunning(false);
    }
  };

  const signals = ['trend', 'direction', 'volatility', 'proximity', 'tailwind', 'rs', 'weeklyAdx', 'bis', 'hurst', 'volBonus'];

  const exportCSV = () => {
    if (!result) return;
    const rows: string[] = ['Signal,Conditional MI,Recommendation'];
    for (const entry of result.conditionalMI) {
      rows.push(`${LABELS[entry.signal] ?? entry.signal},${entry.conditionalMI.toFixed(4)},${entry.recommendation}`);
    }
    if (result.highCorrPairs.length > 0) {
      rows.push('');
      rows.push('Signal A,Signal B,Pairwise MI');
      for (const pair of result.highCorrPairs) {
        rows.push(`${LABELS[pair.signalA] ?? pair.signalA},${LABELS[pair.signalB] ?? pair.signalB},${pair.mi}`);
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-audit-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-6xl mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Signal Pruning Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Mutual information analysis — measures unique contribution of each signal layer
            </p>
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 bg-navy-700 hover:bg-navy-600 text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            )}
            <button
              onClick={runAudit}
              disabled={running}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              {running ? 'Running...' : 'Run Analysis'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading...
          </div>
        ) : !result ? (
          <div className="card-surface p-8 text-center text-muted-foreground">
            <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No audit results yet. Click &ldquo;Run Analysis&rdquo; to compute signal mutual information.</p>
            <p className="text-xs mt-2">Requires at least 50 observations in the ScoreBreakdown table.</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="card-surface p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-foreground">{result.summary}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Samples: {result.sampleSize}</span>
                    <span>Outcome: {result.hasOutcomes ? 'Real R-multiples' : 'NCS proxy'}</span>
                    <span>Computed: {new Date(result.computedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Conditional MI — Signal Value Ranking */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Conditional MI — Unique Information Per Signal
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Higher = more unique predictive information. &lt;0.05 = nearly redundant, 0.05–0.15 = marginal, &gt;0.15 = genuinely independent.
              </p>
              <div className="space-y-0">
                {result.conditionalMI.map(entry => (
                  <ConditionalMIBar key={entry.signal} entry={entry} />
                ))}
              </div>
            </div>

            {/* MI Heatmap */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                Pairwise MI Heatmap
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                High MI between two signals = redundant pair (one could be dropped). Diagonal shows MI with outcome.
              </p>
              <MIHeatmap matrix={result.miMatrix} signals={signals} />
            </div>

            {/* High Correlation Pairs */}
            {(result.highCorrPairs ?? []).length > 0 && (
              <div className="card-surface p-4">
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  High Correlation Pairs (MI &gt; 0.7)
                </h2>
                <p className="text-xs text-muted-foreground mb-3">
                  These signal pairs share very similar information. Consider merging into a single interaction feature.
                </p>
                <div className="space-y-2">
                  {result.highCorrPairs.map((pair, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-amber-400">⚠</span>
                      <span className="text-foreground">{LABELS[pair.signalA] ?? pair.signalA}</span>
                      <span className="text-muted-foreground">↔</span>
                      <span className="text-foreground">{LABELS[pair.signalB] ?? pair.signalB}</span>
                      <span className="text-xs text-muted-foreground font-mono">(MI = {pair.mi})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
