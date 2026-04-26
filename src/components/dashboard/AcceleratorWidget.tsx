'use client';

import { useState, useEffect } from 'react';
import AcceleratorCard from '@/components/plan/AcceleratorCard';
import type { AcceleratorRecommendation } from '@/types';
import { apiRequest } from '@/lib/api-client';
import { Loader2, Zap, AlertTriangle } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

interface AcceleratorApiResponse {
  ok: boolean;
  data: {
    recommendations: AcceleratorRecommendation[];
    context: {
      equity: number;
      riskProfile: string;
      regime: string;
      openRiskPercent: number;
      maxPositions: number;
      maxOpenRisk: number;
      positionsCount: number;
      slotsAvailable: number;
      riskHeadroom: number;
      candidatesCount: number;
      aGradeCandidates: number;
    };
  };
}

export default function AcceleratorWidget() {
  const [recommendations, setRecommendations] = useState<AcceleratorRecommendation[]>([]);
  const [context, setContext] = useState<AcceleratorApiResponse['data']['context'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await apiRequest<AcceleratorApiResponse>(
          `/api/accelerator?userId=${DEFAULT_USER_ID}`
        );
        if (cancelled) return;
        if (res.ok && res.data) {
          setRecommendations(res.data.recommendations);
          setContext(res.data.context);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
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
          Capital Priority
        </h3>
        <div className="flex items-center justify-center py-4 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading accelerator...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary-400" />
          Capital Priority
        </h3>
        <div className="flex items-center gap-2 py-4 text-xs text-amber-300/70">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <AcceleratorCard recommendations={recommendations} />
      {context && (
        <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] text-muted-foreground">
          <div className="bg-navy-700/20 rounded px-2 py-1 text-center">
            <div className="font-semibold text-foreground">{context.slotsAvailable}</div>
            <div>slots free</div>
          </div>
          <div className="bg-navy-700/20 rounded px-2 py-1 text-center">
            <div className="font-semibold text-foreground">{context.riskHeadroom.toFixed(1)}%</div>
            <div>risk room</div>
          </div>
          <div className="bg-navy-700/20 rounded px-2 py-1 text-center">
            <div className="font-semibold text-foreground">{context.aGradeCandidates}</div>
            <div>A-grade</div>
          </div>
          <div className="bg-navy-700/20 rounded px-2 py-1 text-center">
            <div className="font-semibold text-foreground">{context.regime}</div>
            <div>regime</div>
          </div>
        </div>
      )}
    </div>
  );
}
