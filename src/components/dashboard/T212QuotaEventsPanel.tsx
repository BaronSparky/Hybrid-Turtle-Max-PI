'use client';

/**
 * DEPENDENCIES
 * Consumed by: Dashboard page (system status row)
 * Consumes: /api/analytics/t212-quota
 * Risk-sensitive: NO — read-only display
 * Notes: Surfaces T212 rate-limit-low events so quota throttling history is
 *        visible without inspecting log files. Renders nothing when no events.
 */

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface QuotaEvent {
  timestamp: string;
  remaining: number;
  limit: number;
  method: string;
  path: string;
}

interface QuotaResponse {
  total: number;
  last24h: number;
  events: QuotaEvent[];
}

export default function T212QuotaEventsPanel() {
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiRequest<QuotaResponse>('/api/analytics/t212-quota');
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !data || data.total === 0) return null;

  const isCritical = data.last24h >= 5;
  const tone = data.last24h === 0
    ? 'text-emerald-500'
    : data.last24h < 5
      ? 'text-amber-500'
      : 'text-red-500';

  return (
    <div className={cn('card-surface p-4', isCritical && 'border border-red-500/50')}>
      {isCritical ? (
        <div className="mb-3 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
          <strong className="font-semibold">⚠ T212 throttling alert:</strong>{' '}
          {data.last24h} rate-limit-low events in the last 24h. Consider reducing
          T212 polling frequency or batch sizes.
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className={cn('h-4 w-4', tone)} />
          T212 Quota
        </h3>
        <span className={cn('text-xs font-mono', tone)}>{data.last24h} / 24h</span>
      </div>

      <div className="text-2xl font-bold text-foreground">
        {data.total}
        <span className="text-sm text-muted-foreground font-normal"> total</span>
      </div>

      <p className="text-xs text-muted-foreground mt-1">
        Rate-limit-low events recorded
      </p>

      {data.events.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground max-h-24 overflow-auto">
          {data.events.slice(0, 5).map((e) => (
            <li key={e.timestamp} className="font-mono truncate">
              {new Date(e.timestamp).toLocaleTimeString()} · {e.remaining}/{e.limit} · {e.method}{' '}
              {e.path}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
