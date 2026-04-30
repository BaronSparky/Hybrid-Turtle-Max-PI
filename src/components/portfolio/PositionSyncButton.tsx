'use client';

/**
 * DEPENDENCIES
 * Consumed by: portfolio/positions/page.tsx
 * Consumes: /api/positions/sync, api-client.ts
 * Risk-sensitive: YES — triggers auto-close of positions via T212 state
 * Last modified: 2026-03-02
 * Notes: Rate-limited server-side (60s). Client shows countdown. Result card persists until dismissed.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { apiRequest, ApiClientError, formatApiError } from '@/lib/api-client';
import {
  RefreshCw,
  Check,
  AlertTriangle,
  X,
  Loader2,
  BookOpen,
} from 'lucide-react';

interface ClosedPosition {
  positionId: string;
  ticker: string;
  companyName: string;
  exitPrice: number | null;
  exitReason: string | null;
  realisedPnlGbp: number | null;
  realisedPnlR: number | null;
}

interface SyncResponse {
  ok: boolean;
  checked: number;
  closed: number;
  closedPositions: ClosedPosition[];
  errors: string[];
  message?: string;
}

type SyncState = 'idle' | 'loading' | 'success' | 'closed' | 'error' | 'cooldown';

interface PositionSyncButtonProps {
  onSyncComplete?: () => void;
}

export default function PositionSyncButton({ onSyncComplete }: PositionSyncButtonProps) {
  const [state, setState] = useState<SyncState>('idle');
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const startCooldown = useCallback((seconds: number) => {
    setCooldownSeconds(seconds);
    setState('cooldown');
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          setState('idle');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const resetAfterDelay = useCallback((ms: number) => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setState('idle');
      setErrorMessage(null);
    }, ms);
  }, []);

  const handleSync = async () => {
    setState('loading');
    setClosedPositions([]);
    setErrorMessage(null);

    try {
      const data = await apiRequest<SyncResponse>('/api/positions/sync', {
        method: 'POST',
      });

      if (data.closed > 0) {
        setState('closed');
        setClosedPositions(data.closedPositions);
        onSyncComplete?.();
        // Don't auto-dismiss — user needs to see closure details
      } else if (data.errors.length > 0) {
        setState('error');
        setErrorMessage(data.errors[0]);
        resetAfterDelay(8000);
      } else {
        setState('success');
        resetAfterDelay(5000);
      }

      // Start cooldown in background (60s)
      startCooldown(60);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        // Extract wait time from message
        const match = err.message.match(/(\d+)s/);
        const wait = match ? parseInt(match[1], 10) : 60;
        startCooldown(wait);
      } else {
        setState('error');
        setErrorMessage(formatApiError(err, 'Could not reach Trading 212. Check your API credentials in Settings.'));
        resetAfterDelay(8000);
      }
    }
  };

  const dismissCard = () => {
    setClosedPositions([]);
    // If cooldown is still active, show that; otherwise go idle
    if (cooldownSeconds > 0) {
      setState('cooldown');
    } else {
      setState('idle');
    }
  };

  const formatPnl = (value: number | null) => {
    if (value == null) return 'N/A';
    const sign = value >= 0 ? '+' : '';
    return `${sign}£${Math.abs(value).toFixed(2)}`;
  };

  const formatR = (value: number | null) => {
    if (value == null) return '';
    const sign = value >= 0 ? '+' : '';
    return `(${sign}${value.toFixed(1)}R)`;
  };

  const formatExitReason = (reason: string | null) => {
    if (!reason) return 'Closed';
    if (reason === 'STOP_HIT') return 'Stop-loss triggered';
    if (reason === 'MANUAL_SALE') return 'Manually sold';
    return 'Closed';
  };

  return (
    <div>
      {/* Button */}
      <button
        onClick={handleSync}
        disabled={state === 'loading' || state === 'cooldown'}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
          state === 'loading' && 'border-border text-muted-foreground cursor-wait',
          state === 'success' && 'border-gain/30 text-gain',
          state === 'closed' && 'border-gain/30 text-gain',
          state === 'error' && 'border-amber-500/30 text-amber-400',
          state === 'cooldown' && 'border-border text-muted-foreground cursor-not-allowed',
          state === 'idle' && 'border-border text-muted-foreground hover:text-foreground hover:bg-surface-2',
        )}
      >
        {state === 'loading' && (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Syncing…
          </>
        )}
        {state === 'success' && (
          <>
            <Check className="w-3.5 h-3.5" />
            All positions confirmed
          </>
        )}
        {state === 'closed' && (
          <>
            <Check className="w-3.5 h-3.5" />
            Sync complete
          </>
        )}
        {state === 'error' && (
          <>
            <AlertTriangle className="w-3.5 h-3.5" />
            Sync failed
          </>
        )}
        {state === 'cooldown' && (
          <>
            <RefreshCw className="w-3.5 h-3.5" />
            Sync available in {cooldownSeconds}s
          </>
        )}
        {state === 'idle' && (
          <>
            <RefreshCw className="w-3.5 h-3.5" />
            Sync with Trading 212
          </>
        )}
      </button>

      {/* Error message inline */}
      {state === 'error' && errorMessage && (
        <p className="text-xs text-amber-400 mt-1.5">{errorMessage}</p>
      )}

      {/* Closed positions result card */}
      {state === 'closed' && closedPositions.length > 0 && (
        <div className="mt-3 card-surface border border-gain/20 p-4 relative">
          <button
            onClick={dismissCard}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 mb-3">
            <Check className="w-4 h-4 text-gain" />
            <span className="text-sm font-semibold text-gain">Sync complete</span>
          </div>

          <div className="space-y-3">
            {closedPositions.map((pos) => (
              <div key={pos.positionId} className="border-t border-border/30 pt-3 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium text-foreground">
                  {pos.ticker}
                  <span className="text-muted-foreground font-normal ml-1.5">
                    — {pos.companyName}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatExitReason(pos.exitReason)}
                  {pos.exitPrice != null && (
                    <> at ${pos.exitPrice.toFixed(2)}</>
                  )}
                </p>
                <p className={cn(
                  'text-sm font-semibold mt-0.5',
                  (pos.realisedPnlGbp ?? 0) >= 0 ? 'text-gain' : 'text-loss'
                )}>
                  Result: {formatPnl(pos.realisedPnlGbp)} {formatR(pos.realisedPnlR)}
                </p>

                <Link
                  href={`/portfolio/positions?position=${pos.positionId}`}
                  className="inline-flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 mt-1.5 transition-colors"
                >
                  <BookOpen className="w-3 h-3" />
                  Open journal to add close note →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
