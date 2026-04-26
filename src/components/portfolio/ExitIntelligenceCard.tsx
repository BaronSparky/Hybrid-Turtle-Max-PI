'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import type { ExitIntelligenceResult, ExitAction } from '@/types';
import {
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Eye,
  Scissors,
  XCircle,
  Lock,
  Loader2,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

const ACTION_CONFIG: Record<ExitAction, {
  icon: typeof Shield;
  label: string;
  color: string;
  bg: string;
  border: string;
}> = {
  HOLD: {
    icon: TrendingUp,
    label: 'Hold',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  HOLD_AND_TRAIL: {
    icon: TrendingUp,
    label: 'Hold & Trail',
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  TIGHTEN_STOP: {
    icon: Shield,
    label: 'Tighten',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
  },
  REVIEW_EXIT: {
    icon: Eye,
    label: 'Review',
    color: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  TRIM_REVIEW: {
    icon: Scissors,
    label: 'Trim?',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
  EXIT_REVIEW: {
    icon: XCircle,
    label: 'Exit?',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  DO_NOT_TOUCH: {
    icon: Lock,
    label: 'Protected',
    color: 'text-muted-foreground',
    bg: 'bg-navy-700/20',
    border: 'border-border',
  },
};

const SCORE_LABELS: { key: keyof ExitIntelligenceResult['scores']; label: string; inverse?: boolean }[] = [
  { key: 'trendHealth', label: 'Trend' },
  { key: 'winnerHold', label: 'Winner' },
  { key: 'weakeningTrend', label: 'Weakening', inverse: true },
  { key: 'exitReview', label: 'Exit Pressure', inverse: true },
  { key: 'opportunityCost', label: 'Opp. Cost', inverse: true },
  { key: 'climaxRisk', label: 'Climax', inverse: true },
  { key: 'gapRisk', label: 'Gap', inverse: true },
  { key: 'rsDecay', label: 'RS Decay', inverse: true },
];

function scoreColor(value: number, inverse?: boolean): string {
  const v = inverse ? value : 100 - value;
  if (v >= 60) return 'text-red-400';
  if (v >= 40) return 'text-amber-300';
  return 'text-emerald-400';
}

function ScoreBar({ value, inverse }: { value: number; inverse?: boolean }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = inverse
    ? (pct >= 60 ? 'bg-red-500' : pct >= 30 ? 'bg-amber-500' : 'bg-emerald-500')
    : (pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-500');

  return (
    <div className="w-full h-1.5 bg-navy-700/40 rounded-full overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

interface ApiResponse {
  ok: boolean;
  data: {
    results: ExitIntelligenceResult[];
    summary: { total: number; needsAttention: number; aGradeWaiting: number };
  };
}

export default function ExitIntelligenceCard() {
  const [results, setResults] = useState<ExitIntelligenceResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; needsAttention: number; aGradeWaiting: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest<ApiResponse>(`/api/exit-intelligence?userId=${DEFAULT_USER_ID}`);
        if (cancelled) return;
        if (res.ok && res.data) {
          setResults(res.data.results);
          setSummary(res.data.summary);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary-400" />
          Exit Intelligence
        </h3>
        <div className="flex items-center justify-center py-4 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Analyzing positions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary-400" />
          Exit Intelligence
        </h3>
        <div className="flex items-center gap-2 py-4 text-xs text-amber-300/70">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary-400" />
          Exit Intelligence
        </h3>
        <div className="text-xs text-muted-foreground text-center py-4 bg-navy-700/20 rounded-lg">
          No open positions to analyze
        </div>
      </div>
    );
  }

  const attentionItems = results.filter(
    (r) => r.action !== 'HOLD' && r.action !== 'HOLD_AND_TRAIL' && r.action !== 'DO_NOT_TOUCH'
  );
  const holdItems = results.filter(
    (r) => r.action === 'HOLD' || r.action === 'HOLD_AND_TRAIL'
  );

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary-400" />
        Exit Intelligence
        {summary && summary.needsAttention > 0 && (
          <span className="ml-auto text-xs font-mono bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded">
            {summary.needsAttention} need{summary.needsAttention !== 1 ? '' : 's'} review
          </span>
        )}
      </h3>

      {/* Positions needing attention */}
      {attentionItems.length > 0 && (
        <div className="space-y-2 mb-3">
          {attentionItems.map((result) => {
            const config = ACTION_CONFIG[result.action];
            const Icon = config.icon;
            const isExpanded = expandedTicker === result.ticker;

            return (
              <div
                key={result.positionId}
                className={cn('rounded-lg border', config.bg, config.border)}
              >
                {/* Header row */}
                <button
                  onClick={() => setExpandedTicker(isExpanded ? null : result.ticker)}
                  className="w-full p-3 text-left"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Icon className={cn('w-4 h-4', config.color)} />
                      <span className={cn('text-sm font-semibold', config.color)}>
                        {result.ticker}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {result.rMultiple >= 0 ? '+' : ''}{result.rMultiple.toFixed(1)}R
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                        config.bg, config.color
                      )}>
                        {config.label}
                      </span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                  <div className="text-xs text-foreground">{result.explanation}</div>

                  {/* Key metrics */}
                  <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
                    <span>Stop: {result.stopDistancePct}% below</span>
                    <span>Giveback: {result.givebackRiskR}R</span>
                    <span>Level: {result.protectionLevel}</span>
                  </div>
                </button>

                {/* Expanded scores */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-border/20 pt-2 space-y-2">
                    {/* Score bars */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {SCORE_LABELS.map(({ key, label, inverse }) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
                          <div className="flex-1">
                            <ScoreBar value={result.scores[key]} inverse={inverse} />
                          </div>
                          <span className={cn('text-[10px] font-mono w-6 text-right', scoreColor(result.scores[key], inverse))}>
                            {result.scores[key]}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Active signals */}
                    {result.signals.length > 0 && (
                      <div className="space-y-0.5 mt-2">
                        {result.signals.map((signal, i) => (
                          <div key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                            <span className="text-amber-300/50 mt-0.5">•</span>
                            <span>{signal}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 text-[10px] text-amber-300/70 flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      Advisory only — requires human approval
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Holding positions (collapsed summary) */}
      {holdItems.length > 0 && (
        <div className="text-[11px] text-muted-foreground bg-navy-700/20 rounded-lg p-2.5">
          <span className="font-semibold text-emerald-400">Holding:</span>{' '}
          {holdItems.map((h) => (
            <span key={h.positionId} className="inline-flex items-center gap-1 mr-2">
              {h.ticker}
              <span className="font-mono text-[10px]">
                ({h.rMultiple >= 0 ? '+' : ''}{h.rMultiple.toFixed(1)}R)
              </span>
            </span>
          ))}
          <span className="ml-1 text-muted-foreground/70">— trend intact, no action needed</span>
        </div>
      )}
    </div>
  );
}
