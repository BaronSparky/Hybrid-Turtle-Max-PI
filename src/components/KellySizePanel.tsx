/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view), Portfolio page
 * Consumes: /api/prediction/kelly-size (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows Kelly-suggested risk % vs profile fixed %, uncertainty breakdown.
 *        Kelly suggestion is advisory — existing position sizer always prevails.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Calculator } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface KellyData {
  suggestedRiskPercent: number;
  profileFixedRisk: number;
  kellyVsFixed: number;
  edge: number;
  hasEdge: boolean;
  uncertaintyMultiplier: number;
  loading: boolean;
  hasResult: boolean;
}

// ── Hook ─────────────────────────────────────────────────────

export function useKellySize(params: {
  ncs: number;
  maxRisk: number;
  conformalWidth?: number;
  beliefMean?: number;
  gnnConf?: number;
} | null): KellyData {
  const ncs = params?.ncs;
  const maxRisk = params?.maxRisk;
  const conformalWidth = params?.conformalWidth;
  const beliefMean = params?.beliefMean;
  const gnnConf = params?.gnnConf;
  const [data, setData] = useState<KellyData>({
    suggestedRiskPercent: 0, profileFixedRisk: 2, kellyVsFixed: 1,
    edge: 0, hasEdge: false, uncertaintyMultiplier: 1,
    loading: !!params, hasResult: false,
  });

  useEffect(() => {
    if (ncs === undefined || maxRisk === undefined) { setData(prev => ({ ...prev, loading: false })); return; }
    let cancelled = false;

    const fetchKelly = async () => {
      try {
        const qs = new URLSearchParams({
          ncs: String(ncs),
          maxRisk: String(maxRisk),
          conformalWidth: String(conformalWidth ?? 10),
          beliefMean: String(beliefMean ?? 0.5),
          gnnConf: String(gnnConf ?? 0.5),
        });
        const res = await fetch(`/api/prediction/kelly-size?${qs}`);
        if (!res.ok) { if (!cancelled) setData(prev => ({ ...prev, loading: false })); return; }
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.data) {
          const d = json.data;
          setData({
            suggestedRiskPercent: d.suggestedRiskPercent,
            profileFixedRisk: d.profileFixedRisk,
            kellyVsFixed: d.kellyVsFixed,
            edge: d.rawKelly?.edge ?? 0,
            hasEdge: d.rawKelly?.hasEdge ?? false,
            uncertaintyMultiplier: d.uncertaintyPenalty?.combinedMultiplier ?? 1,
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

    fetchKelly();
    return () => { cancelled = true; };
  }, [beliefMean, conformalWidth, gnnConf, maxRisk, ncs]);

  return data;
}

// ── Component ────────────────────────────────────────────────

interface KellySizePanelProps {
  data: KellyData;
}

export default function KellySizePanel({ data }: KellySizePanelProps) {
  if (!data.hasResult) return null;

  const kellySmaller = data.kellyVsFixed < 0.9;
  const kellyLarger = data.kellyVsFixed > 1.1;

  return (
    <div className={cn(
      'mt-2 px-3 py-2 rounded-lg border',
      !data.hasEdge ? 'bg-red-500/5 border-red-500/20' :
      kellySmaller ? 'bg-amber-500/5 border-amber-500/20' :
      'bg-navy-900/40 border-border/30'
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Calculator className="w-3.5 h-3.5" />
          Kelly Criterion
        </span>
        {!data.hasEdge && (
          <span className="text-[10px] text-red-400 font-medium">No edge</span>
        )}
      </div>

      <div className="flex items-center gap-4 text-[11px]">
        {/* Kelly suggestion */}
        <div className="text-center">
          <div className={cn('text-lg font-bold',
            !data.hasEdge ? 'text-red-400' :
            kellySmaller ? 'text-amber-400' : 'text-emerald-400'
          )}>
            {(data.suggestedRiskPercent ?? 0).toFixed(1)}%
          </div>
          <div className="text-[9px] text-muted-foreground">Kelly suggests</div>
        </div>

        {/* vs indicator */}
        <div className="text-muted-foreground text-xs">vs</div>

        {/* Profile fixed */}
        <div className="text-center">
          <div className="text-lg font-bold text-foreground">
            {(data.profileFixedRisk ?? 2).toFixed(1)}%
          </div>
          <div className="text-[9px] text-muted-foreground">Profile fixed</div>
        </div>

        {/* Ratio badge */}
        <div className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-mono border',
          kellySmaller ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
          kellyLarger ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
          'bg-navy-800/60 border-border/30 text-muted-foreground'
        )}>
          {((data.kellyVsFixed ?? 1) * 100).toFixed(0)}%
        </div>
      </div>

      {/* Details */}
      <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground">
        <span>Edge: {data.hasEdge ? `+${((data.edge ?? 0) * 100).toFixed(1)}%` : 'none'}</span>
        <span>Uncertainty: ×{data.uncertaintyMultiplier}</span>
        {kellySmaller && <span className="text-amber-400">Kelly says size down</span>}
        {!data.hasEdge && <span className="text-red-400">Kelly says skip trade</span>}
      </div>
    </div>
  );
}
