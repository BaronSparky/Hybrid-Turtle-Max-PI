'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/evidence)
 * Consumes: /api/analytics/evidence
 * Risk-sensitive: NO — read-only research dashboard
 * Notes: Evidence framework — proves which rules improve expectancy.
 *        Does not modify live trading logic.
 */

import { useEffect, useState, useMemo } from 'react';
import Navbar from '@/components/shared/Navbar';
import AnalyticsExplainCard from '@/components/analytics/AnalyticsExplainCard';
import { cn } from '@/lib/utils';
import {apiRequest, formatApiError } from '@/lib/api-client';
import {
  AlertTriangle,
  BarChart3,
  Download,
  Filter,
  FlaskConical,
  Loader2,
  TrendingUp,
  TrendingDown,
  Layers,
  Target,
  LogOut,
  Cpu,
  ChevronDown,
  ChevronUp,
  Shield,
} from 'lucide-react';

// ── Types (mirror evidence-framework.ts) ────────────────────

interface OutcomeStats {
  count: number;
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  hit3RRate: number | null;
  stopHitRate: number | null;
  avgR: number | null;
  medianR: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
}

interface RuleContributionRow {
  rule: string;
  description: string;
  passed: OutcomeStats;
  blocked: OutcomeStats;
  edgeFwd20d: number | null;
  edge1RRate: number | null;
}

interface ClassificationBandRow {
  dimension: string;
  band: string;
  stats: OutcomeStats;
}

interface EntryQualityRow {
  entryType: string;
  stats: OutcomeStats;
}

interface ExitPerformanceRow {
  exitCategory: string;
  count: number;
  avgR: number | null;
  medianR: number | null;
  avgDaysHeld: number | null;
  winRate: number | null;
}

interface SimulationScenario {
  name: string;
  description: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  totalR: number;
  maxDrawdownR: number;
  finalCapital: number;
  returnPct: number;
}

interface EvidenceData {
  ok: boolean;
  generatedAt: string;
  sampleSize: { totalCandidates: number; enrichedCandidates: number; totalTrades: number; closedTrades: number };
  warnings: string[];
  ruleContribution: RuleContributionRow[];
  classificationPerformance: ClassificationBandRow[];
  entryQuality: EntryQualityRow[];
  exitPerformance: ExitPerformanceRow[];
  simulations: SimulationScenario[];
}

type TabKey = 'rules' | 'classification' | 'entry' | 'exit' | 'simulation';

// ── Helpers ─────────────────────────────────────────────────

function fmt(v: number | null, suffix = ''): string {
  if (v == null) return '—';
  return `${v >= 0 ? '' : ''}${v}${suffix}`;
}

function edgeColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground';
  if (v > 1) return 'text-emerald-400';
  if (v > 0) return 'text-emerald-400/70';
  if (v < -1) return 'text-red-400';
  return 'text-red-400/70';
}

function statColor(v: number | null, higher: boolean): string {
  if (v == null) return 'text-muted-foreground';
  if (higher) return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-muted-foreground';
  return v < 50 ? 'text-emerald-400' : v >= 50 ? 'text-red-400' : 'text-muted-foreground';
}

function exportCsv(filename: string, headers: string[], rows: string[][]): void {
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Stat Cell ───────────────────────────────────────────────

function StatCell({ value, suffix, higher }: { value: number | null; suffix?: string; higher?: boolean }) {
  return (
    <td className={cn('px-2 py-1.5 text-right font-mono text-xs', higher != null ? statColor(value, higher) : 'text-foreground')}>
      {fmt(value, suffix)}
    </td>
  );
}

// ── Warning Banner ──────────────────────────────────────────

function WarningBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-1">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────

export default function EvidencePage() {
  const [data, setData] = useState<EvidenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('rules');
  const [sleeve, setSleeve] = useState('');
  const [regime, setRegime] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (sleeve) params.set('sleeve', sleeve);
    if (regime) params.set('regime', regime);
    const qs = params.toString();

    (async () => {
      try {
        const res = await apiRequest<EvidenceData>(`/api/analytics/evidence${qs ? '?' + qs : ''}`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(formatApiError(err, 'Failed to load'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sleeve, regime]);

  // Build context for AI explain based on active tab
  const evidenceContext = useMemo(() => {
    if (!data) return '';
    const samples = `Evidence Data (${data.sampleSize.totalCandidates} candidates, ${data.sampleSize.enrichedCandidates} enriched, ${data.sampleSize.totalTrades} trades, ${data.sampleSize.closedTrades} closed)`;

    if (tab === 'rules') {
      const lines = data.ruleContribution.slice(0, 10).map(r =>
        `${r.rule}: passed fwd20d=${r.passed.avgFwd20d?.toFixed(2) ?? 'N/A'}%, blocked fwd20d=${r.blocked.avgFwd20d?.toFixed(2) ?? 'N/A'}%, edge=${r.edgeFwd20d?.toFixed(2) ?? '?'}%, passed 1R=${r.passed.hit1RRate?.toFixed(0) ?? '?'}%`
      ).join('\n');
      return `${samples}\n\nRule Contribution:\n${lines}`;
    }
    if (tab === 'classification') {
      const lines = data.classificationPerformance.map(c =>
        `${c.dimension}/${c.band}: n=${c.stats.count}, avgR=${c.stats.avgR?.toFixed(2) ?? '?'}, 1R=${c.stats.hit1RRate?.toFixed(0) ?? '?'}%, stop=${c.stats.stopHitRate?.toFixed(0) ?? '?'}%`
      ).join('\n');
      return `${samples}\n\nClassification Performance:\n${lines}`;
    }
    if (tab === 'entry') {
      const lines = data.entryQuality.map(e =>
        `${e.entryType}: n=${e.stats.count}, avgR=${e.stats.avgR?.toFixed(2) ?? '?'}, 1R=${e.stats.hit1RRate?.toFixed(0) ?? '?'}%, fwd20d=${e.stats.avgFwd20d?.toFixed(2) ?? '?'}%`
      ).join('\n');
      return `${samples}\n\nEntry Quality:\n${lines}`;
    }
    if (tab === 'exit') {
      const lines = data.exitPerformance.map(e =>
        `${e.exitCategory}: n=${e.count}, avgR=${e.avgR?.toFixed(2) ?? '?'}, winRate=${e.winRate?.toFixed(0) ?? '?'}%, avgDays=${e.avgDaysHeld?.toFixed(0) ?? '?'}`
      ).join('\n');
      return `${samples}\n\nExit Performance:\n${lines}`;
    }
    if (tab === 'simulation') {
      const lines = data.simulations.map(s =>
        `${s.name}: totalR=${s.totalR?.toFixed(1) ?? '?'}, winRate=${s.winRate?.toFixed(0) ?? '?'}%, avgR=${s.avgR?.toFixed(2) ?? '?'}R, return=${s.returnPct?.toFixed(1) ?? '?'}%`
      ).join('\n');
      return `${samples}\n\nSimulation Scenarios:\n${lines}`;
    }
    return samples;
  }, [data, tab]);

  const evidenceQuestion = useMemo(() => {
    switch (tab) {
      case 'rules': return 'Which rules add the most edge? Are any rules blocking candidates that would have performed well?';
      case 'classification': return 'Do A-grade candidates genuinely outperform B and C grades? Is the grading system working?';
      case 'entry': return 'How good are the entry decisions? Are entries well-timed or is there room for improvement?';
      case 'exit': return 'How effective are the exit decisions? Are stops being hit too early, or are exits well-managed?';
      case 'simulation': return 'Which simulation scenario produces the best risk-adjusted returns? What does this tell us about the strategy?';
      default: return 'Explain these evidence metrics for a beginner.';
    }
  }, [tab]);

  const tabs: { key: TabKey; label: string; icon: typeof Filter }[] = [
    { key: 'rules', label: 'Rule Contribution', icon: Filter },
    { key: 'classification', label: 'Classification', icon: Layers },
    { key: 'entry', label: 'Entry Quality', icon: Target },
    { key: 'exit', label: 'Exit Performance', icon: LogOut },
    { key: 'simulation', label: 'Simulation', icon: Cpu },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <FlaskConical className="w-6 h-6 text-primary-400" />
              Evidence Framework
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Prove which rules improve expectancy. Read-only — does not affect live trading.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sleeve}
              onChange={(e) => setSleeve(e.target.value)}
              className="text-xs bg-navy-800 border border-border rounded px-2 py-1.5 text-foreground"
              aria-label="Filter by sleeve"
            >
              <option value="">All Sleeves</option>
              <option value="CORE">CORE</option>
              <option value="HIGH_RISK">HIGH_RISK</option>
              <option value="HEDGE">HEDGE</option>
            </select>
            <select
              value={regime}
              onChange={(e) => setRegime(e.target.value)}
              className="text-xs bg-navy-800 border border-border rounded px-2 py-1.5 text-foreground"
              aria-label="Filter by regime"
            >
              <option value="">All Regimes</option>
              <option value="BULLISH">BULLISH</option>
              <option value="SIDEWAYS">SIDEWAYS</option>
              <option value="BEARISH">BEARISH</option>
            </select>
          </div>
        </div>

        {loading && (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Generating evidence report...</span>
          </div>
        )}

        {error && (
          <div className="card-surface p-6 text-center text-red-400 text-sm">{error}</div>
        )}

        {data && !loading && (
          <>
            {/* Sample size banner */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Candidates', value: data.sampleSize.totalCandidates },
                { label: 'With Outcomes', value: data.sampleSize.enrichedCandidates },
                { label: 'Total Trades', value: data.sampleSize.totalTrades },
                { label: 'Closed Trades', value: data.sampleSize.closedTrades },
              ].map((s) => (
                <div key={s.label} className="card-surface p-3 text-center">
                  <div className="text-lg font-bold text-foreground font-mono">{s.value.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>

            <WarningBanner warnings={data.warnings} />

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-border/30 pb-0">
              {tabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2',
                    tab === key
                      ? 'text-primary-400 border-primary-400 bg-navy-800/50'
                      : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-navy-800/30'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {tab === 'rules' && <RulesTab data={data.ruleContribution} />}
            {tab === 'classification' && <ClassificationTab data={data.classificationPerformance} />}
            {tab === 'entry' && <EntryTab data={data.entryQuality} />}
            {tab === 'exit' && <ExitTab data={data.exitPerformance} />}
            {tab === 'simulation' && <SimulationTab data={data.simulations} />}

            {/* ── AI Explain ── */}
            <div className="mt-6">
              <AnalyticsExplainCard
                title={`AI Evidence Analysis — ${tabs.find(t => t.key === tab)?.label ?? tab}`}
                contextSummary={evidenceContext}
                question={evidenceQuestion}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Tab: Rule Contribution ──────────────────────────────────

function RulesTab({ data }: { data: RuleContributionRow[] }) {
  const handleExport = () => {
    const headers = ['Rule', 'Passed', 'Blocked', 'Pass Fwd20d', 'Block Fwd20d', 'Edge 20d', 'Pass 1R%', 'Block 1R%', 'Edge 1R', 'Pass StopHit%', 'Block StopHit%', 'Pass MFE', 'Block MAE'];
    const rows = data.map((r) => [
      r.rule, String(r.passed.count), String(r.blocked.count),
      String(r.passed.avgFwd20d ?? ''), String(r.blocked.avgFwd20d ?? ''), String(r.edgeFwd20d ?? ''),
      String(r.passed.hit1RRate ?? ''), String(r.blocked.hit1RRate ?? ''), String(r.edge1RRate ?? ''),
      String(r.passed.stopHitRate ?? ''), String(r.blocked.stopHitRate ?? ''),
      String(r.passed.avgMfeR ?? ''), String(r.blocked.avgMaeR ?? ''),
    ]);
    exportCsv('rule-contribution.csv', headers, rows);
  };

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary-400" />
          Rule Contribution — Does each filter improve outcomes?
        </h3>
        <button onClick={handleExport} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground bg-navy-700/30 px-2 py-1 rounded">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30 text-muted-foreground">
              <th className="text-left px-2 py-1.5">Rule</th>
              <th className="text-right px-2 py-1.5">Pass</th>
              <th className="text-right px-2 py-1.5">Block</th>
              <th className="text-right px-2 py-1.5 border-l border-border/20">Pass 5d</th>
              <th className="text-right px-2 py-1.5">Block 5d</th>
              <th className="text-right px-2 py-1.5 border-l border-border/20">Pass 20d</th>
              <th className="text-right px-2 py-1.5">Block 20d</th>
              <th className="text-right px-2 py-1.5 font-semibold text-primary-400">Edge 20d</th>
              <th className="text-right px-2 py-1.5 border-l border-border/20">Pass 1R%</th>
              <th className="text-right px-2 py-1.5">Block 1R%</th>
              <th className="text-right px-2 py-1.5 font-semibold text-primary-400">Edge 1R</th>
              <th className="text-right px-2 py-1.5 border-l border-border/20">Pass Stop%</th>
              <th className="text-right px-2 py-1.5">Block Stop%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.rule} className="border-b border-border/10 hover:bg-navy-700/20" title={r.description}>
                <td className="px-2 py-1.5 text-foreground font-medium">{r.rule}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.passed.count}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.blocked.count}</td>
                <StatCell value={r.passed.avgFwd5d} suffix="%" higher />
                <StatCell value={r.blocked.avgFwd5d} suffix="%" higher />
                <StatCell value={r.passed.avgFwd20d} suffix="%" higher />
                <StatCell value={r.blocked.avgFwd20d} suffix="%" higher />
                <td className={cn('px-2 py-1.5 text-right font-mono font-semibold', edgeColor(r.edgeFwd20d))}>
                  {fmt(r.edgeFwd20d, '%')}
                </td>
                <StatCell value={r.passed.hit1RRate} suffix="%" higher />
                <StatCell value={r.blocked.hit1RRate} suffix="%" higher />
                <td className={cn('px-2 py-1.5 text-right font-mono font-semibold', edgeColor(r.edge1RRate))}>
                  {fmt(r.edge1RRate, 'pp')}
                </td>
                <StatCell value={r.passed.stopHitRate} suffix="%" higher={false} />
                <StatCell value={r.blocked.stopHitRate} suffix="%" higher={false} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-[10px] text-muted-foreground/70 flex items-center gap-1">
        <Shield className="w-3 h-3" />
        Green edge = rule is adding value. Red edge = rule may be removing good candidates.
      </div>
    </div>
  );
}

// ── Tab: Classification Performance ─────────────────────────

function ClassificationTab({ data }: { data: ClassificationBandRow[] }) {
  const dimensions = useMemo(() => [...new Set(data.map((d) => d.dimension))], [data]);
  const [expanded, setExpanded] = useState<string>(dimensions[0] || '');

  const handleExport = () => {
    const headers = ['Dimension', 'Band', 'Count', 'Outcomes', 'Fwd5d', 'Fwd10d', 'Fwd20d', '1R%', '2R%', '3R%', 'Stop%', 'Avg MFE', 'Avg MAE'];
    const rows = data.map((r) => [
      r.dimension, r.band, String(r.stats.count), String(r.stats.withOutcomes),
      String(r.stats.avgFwd5d ?? ''), String(r.stats.avgFwd10d ?? ''), String(r.stats.avgFwd20d ?? ''),
      String(r.stats.hit1RRate ?? ''), String(r.stats.hit2RRate ?? ''), String(r.stats.hit3RRate ?? ''),
      String(r.stats.stopHitRate ?? ''), String(r.stats.avgMfeR ?? ''), String(r.stats.avgMaeR ?? ''),
    ]);
    exportCsv('classification-performance.csv', headers, rows);
  };

  return (
    <div className="card-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary-400" />
          Classification Performance — Which buckets produce the best outcomes?
        </h3>
        <button onClick={handleExport} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground bg-navy-700/30 px-2 py-1 rounded">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      {dimensions.map((dim) => {
        const dimData = data.filter((d) => d.dimension === dim);
        const isOpen = expanded === dim;
        return (
          <div key={dim} className="border border-border/20 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? '' : dim)}
              className="w-full flex items-center justify-between px-3 py-2 bg-navy-800/30 hover:bg-navy-800/50 transition-colors"
            >
              <span className="text-xs font-semibold text-foreground">{dim}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{dimData.length} bands</span>
                {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
            </button>
            {isOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/20 text-muted-foreground">
                      <th className="text-left px-2 py-1.5">Band</th>
                      <th className="text-right px-2 py-1.5">N</th>
                      <th className="text-right px-2 py-1.5">w/ Data</th>
                      <th className="text-right px-2 py-1.5">5d%</th>
                      <th className="text-right px-2 py-1.5">10d%</th>
                      <th className="text-right px-2 py-1.5">20d%</th>
                      <th className="text-right px-2 py-1.5">1R%</th>
                      <th className="text-right px-2 py-1.5">2R%</th>
                      <th className="text-right px-2 py-1.5">3R%</th>
                      <th className="text-right px-2 py-1.5">Stop%</th>
                      <th className="text-right px-2 py-1.5">MFE</th>
                      <th className="text-right px-2 py-1.5">MAE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dimData.map((r) => (
                      <tr key={r.band} className="border-b border-border/10 hover:bg-navy-700/20">
                        <td className="px-2 py-1.5 text-foreground font-medium">{r.band}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.stats.count}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{r.stats.withOutcomes}</td>
                        <StatCell value={r.stats.avgFwd5d} suffix="%" higher />
                        <StatCell value={r.stats.avgFwd10d} suffix="%" higher />
                        <StatCell value={r.stats.avgFwd20d} suffix="%" higher />
                        <StatCell value={r.stats.hit1RRate} suffix="%" higher />
                        <StatCell value={r.stats.hit2RRate} suffix="%" higher />
                        <StatCell value={r.stats.hit3RRate} suffix="%" higher />
                        <StatCell value={r.stats.stopHitRate} suffix="%" higher={false} />
                        <StatCell value={r.stats.avgMfeR} higher />
                        <StatCell value={r.stats.avgMaeR} />
                      </tr>
                    ))}
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

// ── Tab: Entry Quality ──────────────────────────────────────

function EntryTab({ data }: { data: EntryQualityRow[] }) {
  const handleExport = () => {
    const headers = ['Entry Type', 'Count', 'Outcomes', 'Fwd5d', 'Fwd10d', 'Fwd20d', '1R%', '2R%', 'Stop%', 'Avg MFE', 'Avg MAE'];
    const rows = data.map((r) => [
      r.entryType, String(r.stats.count), String(r.stats.withOutcomes),
      String(r.stats.avgFwd5d ?? ''), String(r.stats.avgFwd10d ?? ''), String(r.stats.avgFwd20d ?? ''),
      String(r.stats.hit1RRate ?? ''), String(r.stats.hit2RRate ?? ''),
      String(r.stats.stopHitRate ?? ''), String(r.stats.avgMfeR ?? ''), String(r.stats.avgMaeR ?? ''),
    ]);
    exportCsv('entry-quality.csv', headers, rows);
  };

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-primary-400" />
          Entry Quality — Which entry types produce the best R-multiples?
        </h3>
        <button onClick={handleExport} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground bg-navy-700/30 px-2 py-1 rounded">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30 text-muted-foreground">
              <th className="text-left px-2 py-1.5">Entry Type</th>
              <th className="text-right px-2 py-1.5">N</th>
              <th className="text-right px-2 py-1.5">w/ Data</th>
              <th className="text-right px-2 py-1.5">5d%</th>
              <th className="text-right px-2 py-1.5">10d%</th>
              <th className="text-right px-2 py-1.5">20d%</th>
              <th className="text-right px-2 py-1.5">1R%</th>
              <th className="text-right px-2 py-1.5">2R%</th>
              <th className="text-right px-2 py-1.5">3R%</th>
              <th className="text-right px-2 py-1.5">Stop%</th>
              <th className="text-right px-2 py-1.5">Avg MFE</th>
              <th className="text-right px-2 py-1.5">Avg MAE</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.entryType} className="border-b border-border/10 hover:bg-navy-700/20">
                <td className="px-2 py-1.5 text-foreground font-medium">{r.entryType}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.stats.count}</td>
                <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{r.stats.withOutcomes}</td>
                <StatCell value={r.stats.avgFwd5d} suffix="%" higher />
                <StatCell value={r.stats.avgFwd10d} suffix="%" higher />
                <StatCell value={r.stats.avgFwd20d} suffix="%" higher />
                <StatCell value={r.stats.hit1RRate} suffix="%" higher />
                <StatCell value={r.stats.hit2RRate} suffix="%" higher />
                <StatCell value={r.stats.hit3RRate} suffix="%" higher />
                <StatCell value={r.stats.stopHitRate} suffix="%" higher={false} />
                <StatCell value={r.stats.avgMfeR} higher />
                <StatCell value={r.stats.avgMaeR} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Exit Performance ───────────────────────────────────

function ExitTab({ data }: { data: ExitPerformanceRow[] }) {
  const handleExport = () => {
    const headers = ['Exit Category', 'Count', 'Avg R', 'Median R', 'Avg Days', 'Win Rate'];
    const rows = data.map((r) => [
      r.exitCategory, String(r.count),
      String(r.avgR ?? ''), String(r.medianR ?? ''), String(r.avgDaysHeld ?? ''), String(r.winRate ?? ''),
    ]);
    exportCsv('exit-performance.csv', headers, rows);
  };

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <LogOut className="w-4 h-4 text-primary-400" />
          Exit Performance — Which exit strategies produce the best R?
        </h3>
        <button onClick={handleExport} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground bg-navy-700/30 px-2 py-1 rounded">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30 text-muted-foreground">
              <th className="text-left px-2 py-1.5">Exit Category</th>
              <th className="text-right px-2 py-1.5">N</th>
              <th className="text-right px-2 py-1.5">Avg R</th>
              <th className="text-right px-2 py-1.5">Med R</th>
              <th className="text-right px-2 py-1.5">Avg Days</th>
              <th className="text-right px-2 py-1.5">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.exitCategory} className="border-b border-border/10 hover:bg-navy-700/20">
                <td className="px-2 py-1.5 text-foreground font-medium">{r.exitCategory}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.count}</td>
                <td className={cn('px-2 py-1.5 text-right font-mono', statColor(r.avgR, true))}>{fmt(r.avgR, 'R')}</td>
                <td className={cn('px-2 py-1.5 text-right font-mono', statColor(r.medianR, true))}>{fmt(r.medianR, 'R')}</td>
                <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{fmt(r.avgDaysHeld, 'd')}</td>
                <td className={cn('px-2 py-1.5 text-right font-mono', statColor(r.winRate != null ? r.winRate - 50 : null, true))}>{fmt(r.winRate, '%')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Simulation ─────────────────────────────────────────

function SimulationTab({ data }: { data: SimulationScenario[] }) {
  const handleExport = () => {
    const headers = ['Scenario', 'Trades', 'Wins', 'Losses', 'Win%', 'Avg R', 'Total R', 'Max DD (R)', 'Final £', 'Return%'];
    const rows = data.map((s) => [
      s.name, String(s.trades), String(s.wins), String(s.losses),
      String(s.winRate ?? ''), String(s.avgR ?? ''), String(s.totalR),
      String(s.maxDrawdownR), String(s.finalCapital), String(s.returnPct),
    ]);
    exportCsv('simulation-results.csv', headers, rows);
  };

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary-400" />
          Small Account Simulation — £1,000 starting capital
        </h3>
        <button onClick={handleExport} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground bg-navy-700/30 px-2 py-1 rounded">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {data.map((s) => (
          <div key={s.name} className="bg-navy-800/30 border border-border/20 rounded-lg p-3">
            <div className="text-xs font-semibold text-foreground mb-1">{s.name}</div>
            <div className="text-[10px] text-muted-foreground mb-2">{s.description}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <div className="text-muted-foreground">Trades</div>
              <div className="font-mono text-right">{s.trades}</div>
              <div className="text-muted-foreground">Win Rate</div>
              <div className="font-mono text-right">{fmt(s.winRate, '%')}</div>
              <div className="text-muted-foreground">Avg R</div>
              <div className={cn('font-mono text-right', statColor(s.avgR, true))}>{fmt(s.avgR, 'R')}</div>
              <div className="text-muted-foreground">Total R</div>
              <div className={cn('font-mono text-right', statColor(s.totalR, true))}>{fmt(s.totalR, 'R')}</div>
              <div className="text-muted-foreground">Max DD</div>
              <div className="font-mono text-right text-red-400">{s.maxDrawdownR}R</div>
              <div className="text-muted-foreground">Final Capital</div>
              <div className={cn('font-mono text-right font-semibold', s.finalCapital >= 1000 ? 'text-emerald-400' : 'text-red-400')}>
                £{s.finalCapital.toLocaleString()}
              </div>
              <div className="text-muted-foreground">Return</div>
              <div className={cn('font-mono text-right font-semibold', s.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {s.returnPct >= 0 ? '+' : ''}{s.returnPct}%
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
        <Shield className="w-3 h-3" />
        Simulations use actual trade log R-multiples with sequential execution. Not a backtest — based on real trades taken.
      </div>
    </div>
  );
}
