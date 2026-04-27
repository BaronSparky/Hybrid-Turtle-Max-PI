'use client';

/**
 * DEPENDENCIES
 * Consumed by: /portfolio/positions/page.tsx (primary location)
 * Consumes: /api/stops (GET — merged R-based + trailing ATR recs), /api/stops/apply (POST)
 * Risk-sensitive: YES — applies stop updates to DB + Trading 212 in one click
 * Last modified: 2026-03-03
 * Notes: Single canonical stop queue component. One-click apply calls /api/stops/apply
 *        which handles both T212 push and DB write atomically.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatPrice } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  ArrowUp,
  Shield,
  TrendingUp,
  AlertTriangle,
  Loader2,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

// Shape returned by GET /api/stops
interface StopRecommendation {
  positionId: string;
  ticker: string;
  currentStop: number;
  newStop: number;
  newLevel: string;
  reason: string;
  priceCurrency?: string;
}

// Shape returned by POST /api/stops/apply (success)
interface ApplySuccessResponse {
  success: true;
  positionId: string;
  newStop: number;
  protectionLevel: string;
  message: string;
}

// Shape returned by POST /api/stops/apply (failure)
interface ApplyErrorResponse {
  success: false;
  error: string;
  step: 'T212' | 'DB';
}

type ApplyResponse = ApplySuccessResponse | ApplyErrorResponse;

const protectionColors: Record<string, string> = {
  INITIAL: 'text-muted-foreground',
  BREAKEVEN: 'text-warning',
  LOCK_08R: 'text-blue-400',
  LOCK_1R_TRAIL: 'text-profit',
  TRAILING_ATR: 'text-primary-400',
};

interface StopUpdateQueueProps {
  userId: string;
  /** Called after any stop is successfully written so the parent can re-fetch positions */
  onApplied?: () => void;
  /** Increment to force re-fetch (e.g. after T212 sync bumps a DB stop) */
  refreshTrigger?: number;
}

type RowStatus = 'idle' | 'applying' | 'success' | 'error' | 'fading';

interface RowState {
  status: RowStatus;
  message: string | null;
}

const IDLE_ROW: RowState = { status: 'idle', message: null };
const FADE_DELAY_MS = 2000;

export default function StopUpdateQueue({ userId, onApplied, refreshTrigger = 0 }: StopUpdateQueueProps) {
  const [recs, setRecs] = useState<StopRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [applyingAll, setApplyingAll] = useState(false);
  // Track which tickers have been faded out so they disappear from the list
  const [hiddenTickers, setHiddenTickers] = useState<Set<string>>(new Set());
  const fadeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const fetchRecs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await apiRequest<StopRecommendation[]>(`/api/stops?userId=${userId}`);
      // Client-side safety: filter out same-value recommendations (floating-point edge cases)
      const filtered = data.filter(r => {
        const roundedNew = Math.round(r.newStop * 100) / 100;
        const roundedCurrent = Math.round(r.currentStop * 100) / 100;
        return roundedNew > roundedCurrent;
      });
      setRecs(filtered);
      setRowStates({});
      setHiddenTickers(new Set());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load stop recommendations');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchRecs(); }, [fetchRecs, refreshTrigger]);

  // Clean up fade timers on unmount
  useEffect(() => {
    const timers = fadeTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  function getRow(ticker: string): RowState {
    return rowStates[ticker] ?? IDLE_ROW;
  }

  function patchRow(ticker: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [ticker]: { ...(prev[ticker] ?? IDLE_ROW), ...patch } }));
  }

  /** Schedule fade-out → hide for a successfully applied ticker */
  function scheduleFade(ticker: string) {
    // Fade the row green, then hide it after delay
    const timer = setTimeout(() => {
      patchRow(ticker, { status: 'fading' });
      const hideTimer = setTimeout(() => {
        setHiddenTickers((prev) => new Set(prev).add(ticker));
      }, 500); // 500ms for the CSS fade-out animation
      fadeTimers.current.set(`${ticker}-hide`, hideTimer);
    }, FADE_DELAY_MS);
    fadeTimers.current.set(ticker, timer);
  }

  async function apply(rec: StopRecommendation) {
    patchRow(rec.ticker, { status: 'applying', message: null });

    try {
      const result = await apiRequest<ApplyResponse>('/api/stops/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId: rec.positionId, newStop: rec.newStop }),
      });

      if (result.success) {
        patchRow(rec.ticker, {
          status: 'success',
          message: result.message,
        });
        scheduleFade(rec.ticker);
        onApplied?.();
      } else {
        // Should not reach here — apiRequest throws on non-2xx
        patchRow(rec.ticker, {
          status: 'error',
          message: result.error,
        });
      }
    } catch (err) {
      // Parse the error response to get the step info
      const errMsg = err instanceof Error ? err.message : 'Failed to apply stop';
      patchRow(rec.ticker, { status: 'error', message: errMsg });
    }
  }

  async function applyAll() {
    const pending = visibleRecs.filter((r) => getRow(r.ticker).status === 'idle');
    if (pending.length === 0) return;

    setApplyingAll(true);
    for (const rec of pending) {
      await apply(rec);
    }
    setApplyingAll(false);
  }

  // Filter out hidden (fully faded) rows
  const visibleRecs = recs.filter((r) => !hiddenTickers.has(r.ticker));
  const pendingCount = visibleRecs.filter((r) => getRow(r.ticker).status === 'idle').length;

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Stop-Loss Queue
        </h3>
        <div className="flex items-center gap-2">
          {!loading && (
            <button
              onClick={fetchRecs}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh recommendations"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            {loading ? 'Loading…' : `${pendingCount} pending`}
          </span>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Fetching live recommendations…</span>
        </div>
      )}

      {/* Fetch error */}
      {!loading && fetchError && (
        <div className="text-xs text-loss flex items-center gap-1 py-2">
          <AlertTriangle className="w-3 h-3" /> {fetchError}
        </div>
      )}

      {/* No upgrades needed — empty state */}
      {!loading && !fetchError && visibleRecs.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-6">
          <CheckCircle className="w-4 h-4 text-profit/50" />
          <span className="text-xs text-muted-foreground">All stops up to date</span>
        </div>
      )}

      {/* Recommendations list */}
      {!loading && visibleRecs.length > 0 && (
        <>
          {/* Apply All button when multiple pending */}
          {pendingCount > 1 && (
            <button
              onClick={applyAll}
              disabled={applyingAll}
              className="w-full mb-3 text-xs py-1.5 rounded bg-profit/20 text-profit font-medium hover:bg-profit/30 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {applyingAll ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Applying all…</>
              ) : (
                <><TrendingUp className="w-3 h-3" /> Apply All {pendingCount} Stops</>
              )}
            </button>
          )}

          <div className="space-y-3">
            {visibleRecs.map((rec) => {
              const row = getRow(rec.ticker);
              const applied = row.status === 'success';
              const applying = row.status === 'applying';
              const fading = row.status === 'fading';

              return (
                <div
                  key={rec.ticker}
                  className={cn(
                    'bg-navy-800 rounded-lg p-3 border transition-all duration-500',
                    fading && 'opacity-0 scale-95',
                    applied && 'border-profit/50 bg-profit/5',
                    !applied && !fading && 'border-profit/30',
                    row.status === 'error' && 'border-loss/50'
                  )}
                >
                  {/* Ticker + level */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{rec.ticker}</span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-mono',
                        protectionColors[rec.newLevel] || 'text-muted-foreground'
                      )}>
                        {rec.newLevel.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* Apply button — right-aligned */}
                    {!applied && !fading && (
                      <button
                        disabled={applying || applyingAll}
                        onClick={() => apply(rec)}
                        className="text-xs px-3 py-1 rounded bg-profit/20 text-profit font-medium hover:bg-profit/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {applying ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Applying…</>
                        ) : (
                          'Apply'
                        )}
                      </button>
                    )}

                    {/* Applied checkmark */}
                    {applied && (
                      <CheckCircle className="w-4 h-4 text-profit" />
                    )}
                  </div>

                  {/* Current → Recommended */}
                  <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                    <div>
                      <span className="text-muted-foreground">Current Stop</span>
                      <div className="font-mono text-foreground">{formatPrice(rec.currentStop, rec.priceCurrency)}</div>
                    </div>
                    <div className="text-center">
                      <ArrowUp className="w-5 h-5 text-profit mx-auto mt-2" />
                    </div>
                    <div className="text-right">
                      <span className="text-muted-foreground">Move To</span>
                      <div className="font-mono text-profit font-semibold">{formatPrice(rec.newStop, rec.priceCurrency)}</div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="text-[11px] text-muted-foreground">{rec.reason}</div>

                  {/* Post-apply feedback */}
                  {applied && row.message && (
                    <p className="text-xs text-profit flex items-center gap-1 mt-2">
                      <CheckCircle className="w-3 h-3" /> {row.message}
                    </p>
                  )}

                  {/* Error feedback */}
                  {row.status === 'error' && row.message && (
                    <p className="text-xs text-loss flex items-center gap-1 mt-2">
                      <AlertTriangle className="w-3 h-3" /> {row.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
