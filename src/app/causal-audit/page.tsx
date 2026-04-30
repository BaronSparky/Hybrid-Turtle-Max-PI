'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/causal-audit)
 * Consumes: /api/prediction/invariance
 * Risk-sensitive: NO — read-only analysis page
 * Last modified: 2026-03-07
 * Notes: IRM analysis page. Shows which signals are causally stable vs
 *        regime-dependent. Invariance bar chart, β-per-regime grouped bars,
 *        historical variance trend, full recommendation table, regime
 *        breakdown accordion, CSV export.
 *        ⛔ ANALYSIS ONLY — no changes to NCS or signals.
 */

import { useEffect, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { Loader2, PlayCircle, Shield, AlertTriangle, BarChart3, ChevronDown, ChevronUp, Download, Info } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface SignalInvariance {
  signal: string;
  invarianceScore: number;
  betaPerEnvironment: Record<string, number>;
  betaVariance: number;
  classification: 'CAUSAL' | 'MIXED' | 'SPURIOUS';
}

interface AuditResult {
  signals: SignalInvariance[];
  computedAt: string;
  sampleSize: number;
}

interface HistoricalRun {
  runAt: string;
  signalScores: Record<string, number>;
}

// ── Labels ───────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  bqsTrend: 'Trend (ADX)', bqsDirection: 'Direction (DI)',
  bqsVolatility: 'Volatility', bqsProximity: 'Proximity',
  bqsTailwind: 'Regime (DRS)', bqsRs: 'Rel. Strength',
  bqsWeeklyAdx: 'Weekly ADX', bqsBis: 'BIS',
  bqsHurst: 'Hurst', bqsVolBonus: 'Vol Bonus',
};

const classStyles = {
  CAUSAL: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Causal', action: 'Keep' },
  MIXED: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Monitor', action: 'Watch' },
  SPURIOUS: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Spurious', action: 'Review' },
};

const ENVS = ['TRENDING', 'RANGING', 'VOLATILE', 'TRANSITION'];
const ENV_LABELS: Record<string, string> = {
  TRENDING: 'Trending', RANGING: 'Ranging', VOLATILE: 'Volatile', TRANSITION: 'Transition',
};

const LINE_COLORS = [
  'text-emerald-400', 'text-blue-400', 'text-amber-400', 'text-red-400',
  'text-purple-400', 'text-cyan-400', 'text-orange-400', 'text-pink-400',
  'text-lime-400', 'text-indigo-400',
];

// ── Invariance Bar Component ─────────────────────────────────

function InvarianceBar({ signal }: { signal: SignalInvariance }) {
  const label = LABELS[signal.signal] ?? signal.signal;
  const style = classStyles[signal.classification];
  const pct = Math.round(signal.invarianceScore * 100);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-muted-foreground w-28 truncate" title={label}>{label}</span>
      <div className="flex-1 h-4 bg-navy-800/60 rounded-full overflow-hidden relative">
        {/* Threshold markers at 40% and 70% (spec) mapped to 0.3 and 0.6 invariance scale */}
        <div className="absolute top-0 bottom-0 w-px bg-amber-500/30 z-10 left-[30%]" title="Mixed/Spurious threshold" />
        <div className="absolute top-0 bottom-0 w-px bg-emerald-500/30 z-10 left-[60%]" title="Causal/Mixed threshold" />
        <div
          className={cn('h-full rounded-full transition-all duration-500',
            signal.classification === 'CAUSAL' ? 'bg-emerald-500/70' :
            signal.classification === 'MIXED' ? 'bg-amber-500/70' : 'bg-red-500/50'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-10 text-right">{pct}%</span>
      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border w-16 text-center', style.bg, style.border, style.text)}>
        {style.label}
      </span>
    </div>
  );
}

// ── Beta-per-Regime Grouped Bar Component ────────────────────

function BetaChart({ signal }: { signal: SignalInvariance }) {
  const betas = ENVS.map(env => ({ env, beta: signal.betaPerEnvironment[env] ?? 0 }));
  const maxAbs = Math.max(...betas.map(b => Math.abs(b.beta)), 0.001);

  return (
    <div className="flex items-end gap-1 h-12">
      {betas.map(({ env, beta }) => {
        const height = Math.abs(beta) / maxAbs * 100;
        const isPositive = beta >= 0;

        return (
          <div key={env} className="flex flex-col items-center gap-0.5 flex-1">
            <div className="relative w-full h-8 flex items-end justify-center">
              <div
                className={cn('w-full rounded-t', isPositive ? 'bg-emerald-500/50' : 'bg-red-500/50')}
                style={{ height: `${Math.max(height, 5)}%` }}
                title={`β in ${ENV_LABELS[env]}: ${beta.toFixed(4)}`}
              />
            </div>
            <span className="text-[8px] text-muted-foreground">{ENV_LABELS[env]?.substring(0, 5)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Historical Variance Line Chart (SVG) ─────────────────────

function VarianceTrendChart({ runs, signalNames }: { runs: HistoricalRun[]; signalNames: string[] }) {
  if (runs.length < 2) {
    return (
      <div className="text-center text-xs text-muted-foreground py-6">
        Run analysis multiple times to see invariance score trends over time.
      </div>
    );
  }

  const width = 100;
  const height = 60;
  const padding = 2;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32" preserveAspectRatio="none">
        {signalNames.map((sig, si) => {
          const points = runs.map((r, i) => {
            const x = padding + (i / (runs.length - 1)) * (width - 2 * padding);
            const score = r.signalScores[sig] ?? 0;
            const y = height - padding - score * (height - 2 * padding);
            return `${x},${y}`;
          }).join(' ');

          return (
            <polyline
              key={sig}
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className={LINE_COLORS[si % LINE_COLORS.length]}
              opacity={0.7}
            />
          );
        })}
        {/* Reference lines at 0.3 and 0.6 */}
        <line x1={padding} y1={height - padding - 0.3 * (height - 2 * padding)} x2={width - padding} y2={height - padding - 0.3 * (height - 2 * padding)} stroke="currentColor" strokeWidth="0.3" className="text-amber-500/30" strokeDasharray="2,2" />
        <line x1={padding} y1={height - padding - 0.6 * (height - 2 * padding)} x2={width - padding} y2={height - padding - 0.6 * (height - 2 * padding)} stroke="currentColor" strokeWidth="0.3" className="text-emerald-500/30" strokeDasharray="2,2" />
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2">
        {signalNames.map((sig, i) => (
          <span key={sig} className={cn('text-[9px] flex items-center gap-1', LINE_COLORS[i % LINE_COLORS.length])}>
            <span className="w-2 h-0.5 bg-current inline-block" />
            {LABELS[sig] ?? sig}
          </span>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>{runs[0].runAt.split('T')[0]}</span>
        <span>{runs[runs.length - 1].runAt.split('T')[0]}</span>
      </div>
    </div>
  );
}

// ── Regime Breakdown Accordion ───────────────────────────────

function RegimeAccordion({ signals }: { signals: SignalInvariance[] }) {
  const [openRegime, setOpenRegime] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {ENVS.map(env => {
        const isOpen = openRegime === env;
        return (
          <div key={env} className="card-surface border border-border/30 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenRegime(isOpen ? null : env)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left"
            >
              <span className="text-sm font-medium text-foreground">{ENV_LABELS[env]} Regime</span>
              {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {isOpen && (
              <div className="px-4 pb-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border/30">
                      <th className="pb-1.5 pr-4">Signal</th>
                      <th className="pb-1.5 pr-4 text-right">β</th>
                      <th className="pb-1.5 text-right">Performance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.map(s => {
                      const beta = s.betaPerEnvironment[env] ?? 0;
                      const meanBeta = ENVS.reduce((sum, e) => sum + (s.betaPerEnvironment[e] ?? 0), 0) / ENVS.length;
                      const deviation = beta - meanBeta;
                      const isWorse = deviation < -Math.abs(meanBeta * 0.3);
                      const isBetter = deviation > Math.abs(meanBeta * 0.3);

                      return (
                        <tr key={s.signal} className={cn('border-b border-border/10', isWorse && 'bg-red-500/5', isBetter && 'bg-emerald-500/5')}>
                          <td className="py-1.5 pr-4 text-foreground">{LABELS[s.signal] ?? s.signal}</td>
                          <td className="py-1.5 pr-4 text-right font-mono text-xs">{beta.toFixed(4)}</td>
                          <td className={cn('py-1.5 text-right text-xs font-medium',
                            isWorse ? 'text-red-400' : isBetter ? 'text-emerald-400' : 'text-muted-foreground'
                          )}>
                            {isWorse ? 'Below avg' : isBetter ? 'Above avg' : 'Average'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function CausalAuditPage() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [historicalRuns, setHistoricalRuns] = useState<HistoricalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dataSourceInfo, setDataSourceInfo] = useState<{
    source?: string; tradesUsed?: number; scanMatchRate?: number; message?: string;
  } | null>(null);

  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const data = await apiRequest<{ ok: boolean; data: {
          hasResult: boolean;
          result: AuditResult | null;
          historicalRuns?: HistoricalRun[];
        } }>('/api/prediction/invariance');
        if (data.data.hasResult && data.data.result) setResult(data.data.result);
        if (data.data.historicalRuns) setHistoricalRuns(data.data.historicalRuns);
      } catch { /* silent */ }
      finally { setLoading(false); }
    };
    fetchLatest();
  }, []);

  const runAudit = async () => {
    setRunning(true);
    try {
      const data = await apiRequest<{ ok: boolean; data: {
        signals: SignalInvariance[];
        totalSamples?: number;
        computedAt?: string;
        dataSource?: string;
        tradesUsed?: number;
        scanMatchRate?: number;
        dataSourceMessage?: string;
      } }>(
        '/api/prediction/invariance', { method: 'POST' }
      );
      if (data.data) {
        setResult({
          signals: data.data.signals,
          computedAt: data.data.computedAt ?? new Date().toISOString(),
          sampleSize: data.data.totalSamples ?? 0,
        });
        setDataSourceInfo({
          source: data.data.dataSource,
          tradesUsed: data.data.tradesUsed,
          scanMatchRate: data.data.scanMatchRate,
          message: data.data.dataSourceMessage,
        });
      }
    } catch (e) { console.error('IRM failed:', e); }
    finally { setRunning(false); }
  };

  const exportCSV = () => {
    if (!result) return;
    const rows: string[] = ['Signal,Invariance Score,Classification,Beta Variance,Worst Regime'];
    const sorted = [...result.signals].sort((a, b) => a.invarianceScore - b.invarianceScore);
    for (const s of sorted) {
      const worstRegime = ENVS.reduce((worst, env) => {
        const beta = s.betaPerEnvironment[env] ?? 0;
        const worstBeta = s.betaPerEnvironment[worst] ?? 0;
        return Math.abs(beta) < Math.abs(worstBeta) ? env : worst;
      }, ENVS[0]);
      rows.push(`${LABELS[s.signal] ?? s.signal},${(s.invarianceScore * 100).toFixed(1)}%,${s.classification},${s.betaVariance.toFixed(4)},${worstRegime}`);
    }
    rows.push('');
    rows.push('Signal,Trending β,Ranging β,Volatile β,Transition β');
    for (const s of sorted) {
      rows.push(`${LABELS[s.signal] ?? s.signal},${(s.betaPerEnvironment.TRENDING ?? 0).toFixed(4)},${(s.betaPerEnvironment.RANGING ?? 0).toFixed(4)},${(s.betaPerEnvironment.VOLATILE ?? 0).toFixed(4)},${(s.betaPerEnvironment.TRANSITION ?? 0).toFixed(4)}`);
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `causal-audit-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const causalCount = result?.signals.filter(s => s.classification === 'CAUSAL').length ?? 0;
  const mixedCount = result?.signals.filter(s => s.classification === 'MIXED').length ?? 0;
  const spuriousCount = result?.signals.filter(s => s.classification === 'SPURIOUS').length ?? 0;

  // Detect default/insufficient data: all signals at exactly 0.5
  const allDefaulted = result
    ? result.signals.length > 0 && result.signals.every(s => s.invarianceScore === 0.5)
    : false;

  // Sort by invariance ascending (most problematic first) for the recommendation table
  const sortedSignals = result ? [...result.signals].sort((a, b) => a.invarianceScore - b.invarianceScore) : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-6xl mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Causal Invariance Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              IRM analysis — identifies signals that predict across all regimes vs. regime-dependent ones
            </p>
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <button onClick={exportCSV}
                className="flex items-center gap-2 bg-navy-700 hover:bg-navy-600 text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                <Download className="w-4 h-4" /> Export CSV
              </button>
            )}
            <button onClick={runAudit} disabled={running}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              {running ? 'Running...' : 'Run IRM Analysis'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading...
          </div>
        ) : !result ? (
          <div className="card-surface p-8 text-center text-muted-foreground">
            <Shield className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No invariance audit yet. Click &ldquo;Run IRM Analysis&rdquo; to identify causal vs spurious signals.</p>
            <p className="text-xs mt-2">Needs ≥2 regime environments with ≥10 samples each in ScoreBreakdown.</p>
          </div>
        ) : (
          <>
            {/* Summary Banner — 3 stat cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="card-surface p-4 text-center">
                <div className="text-emerald-400 font-bold text-2xl">{causalCount}</div>
                <div className="text-sm text-muted-foreground">Causally Invariant</div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">invariance &gt; 60%</div>
              </div>
              <div className="card-surface p-4 text-center">
                <div className="text-amber-400 font-bold text-2xl">{mixedCount}</div>
                <div className="text-sm text-muted-foreground">Partially Dependent</div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">invariance 30–60%</div>
              </div>
              <div className="card-surface p-4 text-center">
                <div className="text-red-400 font-bold text-2xl">{spuriousCount}</div>
                <div className="text-sm text-muted-foreground">Regime-Dependent</div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">invariance &lt; 30%</div>
              </div>
            </div>

            {/* Insufficient data warning */}
            {allDefaulted && (
              <div className="flex items-start gap-2 p-3 rounded-lg border text-sm bg-amber-500/10 border-amber-500/30 text-amber-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <strong>Insufficient regime diversity.</strong> All scores are defaulting to 50% because the system
                  has only seen one market regime (BULLISH). IRM needs data from at least 2 different regimes
                  (e.g. BULLISH + SIDEWAYS/BEARISH) to measure which signals are truly causal vs. regime-dependent.
                  <span className="block text-xs mt-1 opacity-70">
                    As the system runs through different market conditions, this analysis will become meaningful.
                  </span>
                </div>
              </div>
            )}

            {/* Data Source Info */}
            {dataSourceInfo && (
              <div className={cn(
                'flex items-start gap-2 p-3 rounded-lg border text-sm',
                dataSourceInfo.source === 'TRADELOG'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              )}>
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  {dataSourceInfo.source === 'TRADELOG' ? (
                    <span>
                      Analysis based on <strong>{dataSourceInfo.tradesUsed}</strong> real trades
                      ({dataSourceInfo.scanMatchRate}% matched to scan results).
                    </span>
                  ) : (
                    <span>
                      Using NCS scores as outcome proxy — complete more trades for real outcome analysis.
                      {dataSourceInfo.message && <span className="block text-xs mt-1 opacity-70">{dataSourceInfo.message}</span>}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Invariance Score Bar Chart */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Invariance Scores
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Higher = more stable across regimes. &lt;30% = spurious, 30–60% = mixed, &gt;60% = causal.
              </p>
              {result.signals.map(s => <InvarianceBar key={s.signal} signal={s} />)}
            </div>

            {/* β per regime grouped bar chart */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                β Coefficients per Regime
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                How much each signal predicts outcomes in each regime. Similar bar heights = causally invariant.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {result.signals.map(s => (
                  <div key={s.signal} className="text-center">
                    <div className="text-[10px] text-muted-foreground mb-1">{LABELS[s.signal] ?? s.signal}</div>
                    <BetaChart signal={s} />
                  </div>
                ))}
              </div>
            </div>

            {/* Historical Variance Trend */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                Invariance Score Trend
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                How invariance scores change across audit runs. Stable lines = consistent signal quality.
              </p>
              <VarianceTrendChart
                runs={historicalRuns}
                signalNames={result.signals.map(s => s.signal)}
              />
            </div>

            {/* Full Recommendation Table */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" /> Recommendations
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border/30">
                      <th className="pb-2 pr-4">Signal</th>
                      <th className="pb-2 pr-4 text-right">Invariance</th>
                      <th className="pb-2 pr-4 text-right">β Variance</th>
                      <th className="pb-2 pr-4">Worst Regime</th>
                      <th className="pb-2 pr-4">Recommendation</th>
                      <th className="pb-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSignals.map(s => {
                      const style = classStyles[s.classification];
                      // Find worst regime: lowest absolute beta
                      const worstRegime = ENVS.reduce((worst, env) => {
                        const beta = Math.abs(s.betaPerEnvironment[env] ?? 0);
                        const worstBeta = Math.abs(s.betaPerEnvironment[worst] ?? 0);
                        return beta < worstBeta ? env : worst;
                      }, ENVS[0]);

                      return (
                        <tr key={s.signal} className="border-b border-border/10">
                          <td className="py-2 pr-4 text-foreground">{LABELS[s.signal] ?? s.signal}</td>
                          <td className={cn('py-2 pr-4 text-right font-mono', style.text)}>
                            {(s.invarianceScore * 100).toFixed(0)}%
                          </td>
                          <td className="py-2 pr-4 text-right font-mono text-muted-foreground">
                            {s.betaVariance.toFixed(4)}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">{ENV_LABELS[worstRegime]}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">
                            {s.classification === 'CAUSAL' && 'Stable across regimes. Trust this signal.'}
                            {s.classification === 'MIXED' && 'Regime-dependent. Weight carefully.'}
                            {s.classification === 'SPURIOUS' && 'Unreliable. Consider removing or isolating.'}
                          </td>
                          <td className="py-2 text-center">
                            <span className={cn('px-2 py-0.5 rounded text-[10px] font-semibold border', style.bg, style.border, style.text)}>
                              {style.action}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Regime Breakdown Accordion */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                Regime Breakdown
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Expand each regime to see how signals performed within that specific environment.
              </p>
              <RegimeAccordion signals={result.signals} />
            </div>

            {/* Meta-model integration note */}
            <div className="card-surface p-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-400" />
              <span>
                Invariance scores feed into the Dynamic Signal Weighting meta-model.
                Low-invariance signals are automatically down-weighted system-wide.
                A signal with 30% invariance has its dynamic weight multiplied by 0.30.
              </span>
            </div>

            {/* Footer */}
            <div className="text-center text-xs text-muted-foreground pb-4">
              Analysis based on {result.sampleSize} scan results · Powered by Invariant Risk Minimisation (IRM) · Results stored in InvarianceAuditResult table
              {result.computedAt && <> · Last run: {new Date(result.computedAt).toLocaleString()}</>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
