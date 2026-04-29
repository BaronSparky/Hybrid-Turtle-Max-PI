'use client';

/**
 * DEPENDENCIES
 * Consumed by: Dashboard page (system status row)
 * Consumes: /api/system-status (predictionEngine field)
 * Risk-sensitive: NO — read-only display
 * Notes: Surfaces prediction calibration progress so the Phase 11 unlock
 *        threshold (30 closed trades) is visible without DB inspection.
 */

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Brain } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface SystemStatusResponse {
  predictionEngine?: {
    readiness: 'NO_DATA' | 'INSUFFICIENT' | 'EARLY_SIGNAL' | 'CALIBRATION_READY';
    closedTrades: number;
    tradesNeeded: number;
    message: string;
    canCalibrate: boolean;
    canComputeBasicStats: boolean;
  };
}

const READINESS_THRESHOLD = 30;

export default function PredictionReadinessTile() {
  const [data, setData] = useState<SystemStatusResponse['predictionEngine'] | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiRequest<SystemStatusResponse>('/api/system-status');
      setData(result.predictionEngine ?? null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !data) return null;

  const closed = data.closedTrades;
  const ratio = Math.min(closed / READINESS_THRESHOLD, 1);
  const percent = Math.round(ratio * 100);

  const tone = data.canCalibrate
    ? 'text-emerald-500'
    : data.canComputeBasicStats
      ? 'text-amber-500'
      : 'text-muted-foreground';

  const barColor = data.canCalibrate
    ? 'bg-emerald-500'
    : data.canComputeBasicStats
      ? 'bg-amber-500'
      : 'bg-muted-foreground/40';

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Brain className={cn('h-4 w-4', tone)} />
          Prediction Engine
        </h3>
        <span className={cn('text-xs font-mono', tone)}>{percent}%</span>
      </div>

      <div className="text-2xl font-bold text-foreground">
        {closed}
        <span className="text-sm text-muted-foreground font-normal"> / {READINESS_THRESHOLD}</span>
      </div>

      <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full transition-all', barColor)}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground mt-2 leading-snug">
        {data.canCalibrate
          ? 'Phase 11 calibration unlocked.'
          : data.canComputeBasicStats
            ? `${data.tradesNeeded} more closed trades to unlock Phase 11 calibration.`
            : `${data.tradesNeeded} more closed trades to unlock prediction calibration.`}
      </p>
    </div>
  );
}
