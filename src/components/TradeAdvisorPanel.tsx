/**
 * DEPENDENCIES
 * Consumed by: Portfolio page (position management)
 * Consumes: /api/prediction/trade-recommendation (GET)
 * Risk-sensitive: NO — display only (recommendations are suggestions)
 * Last modified: 2026-03-07
 * Notes: Shows agent's recommended action + confidence + key reasoning.
 *        Human approves or overrides — override logged for RLHF feedback.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Bot, ThumbsUp, ThumbsDown } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface TradeRecData {
  recommendation: string;
  label: string;
  confidence: number;
  topFeatures: Array<{ name: string; value: number }>;
  modelTrained: boolean;
  loading: boolean;
  hasResult: boolean;
}

const ACTION_ICONS: Record<string, string> = {
  HOLD: '⏸️', TIGHTEN_STOP: '🔒', TRAIL_STOP_ATR: '📏',
  PYRAMID_ADD: '📈', PARTIAL_EXIT_25: '💰', PARTIAL_EXIT_50: '💵', FULL_EXIT: '🚪',
};

// ── Hook ─────────────────────────────────────────────────────

export function useTradeRecommendation(params: {
  rMultiple: number;
  daysInTrade: number;
  stopDistanceAtr: number;
  ncs?: number;
} | null): TradeRecData {
  const rMultiple = params?.rMultiple;
  const daysInTrade = params?.daysInTrade;
  const stopDistanceAtr = params?.stopDistanceAtr;
  const ncs = params?.ncs;
  const [data, setData] = useState<TradeRecData>({
    recommendation: '', label: '', confidence: 0,
    topFeatures: [], modelTrained: false, loading: !!params, hasResult: false,
  });

  useEffect(() => {
    if (rMultiple === undefined || daysInTrade === undefined || stopDistanceAtr === undefined) { setData(prev => ({ ...prev, loading: false })); return; }
    let cancelled = false;

    const fetchRec = async () => {
      try {
        const qs = new URLSearchParams({
          rMultiple: String(rMultiple),
          daysInTrade: String(daysInTrade),
          stopDistanceAtr: String(stopDistanceAtr),
          ncs: String(ncs ?? 50),
        });
        const res = await fetch(`/api/prediction/trade-recommendation?${qs}`);
        if (!res.ok) { if (!cancelled) setData(prev => ({ ...prev, loading: false })); return; }
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.data) {
          setData({
            recommendation: json.data.recommendation,
            label: json.data.label,
            confidence: json.data.confidence,
            topFeatures: json.data.topFeatures ?? [],
            modelTrained: json.data.modelTrained,
            loading: false,
            hasResult: true,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchRec();
    return () => { cancelled = true; };
  }, [daysInTrade, ncs, rMultiple, stopDistanceAtr]);

  return data;
}

// ── Component ────────────────────────────────────────────────

interface TradeAdvisorPanelProps {
  data: TradeRecData;
  /** Called when user approves the recommendation */
  onApprove?: () => void;
  /** Called when user overrides (logged for RLHF) */
  onOverride?: () => void;
}

export default function TradeAdvisorPanel({ data, onApprove, onOverride }: TradeAdvisorPanelProps) {
  if (!data.hasResult) return null;

  const icon = ACTION_ICONS[data.recommendation] ?? '🤖';
  const confPct = Math.round(data.confidence * 100);
  const isHighConf = confPct >= 60;

  return (
    <div className={cn(
      'px-3 py-2.5 rounded-lg border',
      isHighConf ? 'bg-blue-500/5 border-blue-500/20' : 'bg-navy-900/40 border-border/30'
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5" />
          Trade Advisor
        </span>
        {!data.modelTrained && (
          <span className="text-[9px] text-amber-400">untrained</span>
        )}
      </div>

      {/* Recommendation */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <div className="flex-1">
          <div className="text-sm font-medium text-foreground">{data.label}</div>
          <div className="text-[10px] text-muted-foreground">
            {confPct}% confidence
            {data.topFeatures.length > 0 && (
              <> — driven by {data.topFeatures.map(f => f.name).join(', ')}</>
            )}
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="h-1.5 bg-navy-800/60 rounded-full overflow-hidden mb-2">
        <div
          className={cn('h-full rounded-full', confPct >= 60 ? 'bg-blue-500/70' : 'bg-muted-foreground/30')}
          style={{ width: `${confPct}%` }}
        />
      </div>

      {/* Action buttons */}
      {(onApprove || onOverride) && (
        <div className="flex items-center gap-2">
          {onApprove && (
            <button onClick={onApprove} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
              <ThumbsUp className="w-3 h-3" /> Approve
            </button>
          )}
          {onOverride && (
            <button onClick={onOverride} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors">
              <ThumbsDown className="w-3 h-3" /> Override
            </button>
          )}
        </div>
      )}
    </div>
  );
}
