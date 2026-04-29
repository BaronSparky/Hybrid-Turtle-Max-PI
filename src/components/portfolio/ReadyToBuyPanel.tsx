/**
 * DEPENDENCIES
 * Consumed by: src/app/portfolio/positions/page.tsx
 * Consumes: src/lib/ready-to-buy.ts, src/lib/api-client.ts, src/lib/utils.ts,
 *           src/hooks/useWeeklyPhase.ts, src/hooks/useRiskProfile.ts,
 *           src/components/portfolio/BuyConfirmationModal.tsx
 * Risk-sensitive: NO (display only — risk gates enforced server-side on POST /api/positions)
 * Last modified: 2026-02-28
 * Notes: Consumes existing /api/scan/cross-ref and /api/risk endpoints. No new APIs.
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiRequest } from '@/lib/api-client';
import { formatPrice } from '@/lib/utils';
import { useWeeklyPhase } from '@/hooks/useWeeklyPhase';
import { useRiskProfile } from '@/hooks/useRiskProfile';
import { getDayOfWeek } from '@/lib/utils';
import {
  filterTriggerMet,
  getSnapshotAge,
  getClusterWarnings,
  getBuyButtonState,
  type CrossRefTicker,
  type TriggerMetCandidate,
  type OpenPositionForCluster,
} from '@/lib/ready-to-buy';
import BuyConfirmationModal from './BuyConfirmationModal';
import {
  ChevronDown,
  ChevronRight,
  ShoppingCart,
  AlertTriangle,
  Clock,
  TrendingUp,
  Shield,
  Ban,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_USER_ID = 'default-user';

// ── Approximate GBP value helper (display only) ──────────────
// Converts shares × price in native currency to approximate GBP.
// Uses hardcoded FX fallbacks — the ≈ symbol signals approximation.
const APPROX_FX_TO_GBP: Record<string, number> = {
  GBP: 1,
  GBX: 0.01,   // pence to pounds
  GBp: 0.01,
  USD: 0.79,
  EUR: 0.86,
};

function approxGbpValue(shares: number, price: number, currency?: string): number {
  const fx = APPROX_FX_TO_GBP[currency ?? 'USD'] ?? 0.79;
  return Math.round(shares * price * fx);
}

// ── Types for API responses ──────────────────────────────────

interface CrossRefResponse {
  tickers: CrossRefTicker[];
  summary: {
    total: number;
    scanCachedAt: string | null;
    hasScanData: boolean;
    hasDualData: boolean;
  };
}

interface RiskBudgetData {
  usedRiskPercent: number;
  availableRiskPercent: number;
  maxRiskPercent: number;
  usedPositions: number;
  maxPositions: number;
}

interface RiskResponse {
  budget: RiskBudgetData;
  equity: number;
}

interface SettingsResponse {
  t212Connected: boolean;
  t212IsaConnected: boolean;
}

// ── Props ────────────────────────────────────────────────────

interface ReadyToBuyPanelProps {
  /** Number of currently open positions (from parent's state) */
  currentPositionCount: number;
  /** Open positions with cluster info for overlap detection */
  openPositions: OpenPositionForCluster[];
  /** Callback to refresh positions table after a buy */
  onPositionCreated: () => void;
}

// ── Score colour helpers ─────────────────────────────────────

function ncsColor(ncs: number | null): string {
  if (ncs == null) return 'text-muted-foreground';
  if (ncs >= 70) return 'text-profit';
  if (ncs >= 50) return 'text-amber-400';
  return 'text-loss';
}

function fwsColor(fws: number | null): string {
  if (fws == null) return 'text-muted-foreground';
  if (fws <= 30) return 'text-profit';
  if (fws <= 50) return 'text-amber-400';
  return 'text-loss';
}

function actionBadge(action: string | null): { text: string; className: string } {
  switch (action) {
    case 'Auto-Yes':
      return { text: 'AUTO-YES', className: 'bg-profit/15 text-profit border-profit/30' };
    case 'Auto-No':
      return { text: 'AUTO-NO', className: 'bg-loss/15 text-loss border-loss/30' };
    default:
      return { text: 'CONDITIONAL', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  }
}

function sleeveBadge(sleeve: string): { text: string; className: string } {
  switch (sleeve) {
    case 'CORE':
      return { text: 'CORE', className: 'bg-blue-500/15 text-blue-400' };
    case 'HIGH_RISK':
      return { text: 'HIGH RISK', className: 'bg-orange-500/15 text-orange-400' };
    case 'ETF':
      return { text: 'ETF', className: 'bg-teal-500/15 text-teal-400' };
    default:
      return { text: sleeve, className: 'bg-white/10 text-muted-foreground' };
  }
}

// ── Component ────────────────────────────────────────────────

export default function ReadyToBuyPanel({
  currentPositionCount,
  openPositions,
  onPositionCreated,
}: ReadyToBuyPanelProps) {
  const [crossRefData, setCrossRefData] = useState<CrossRefResponse | null>(null);
  const [riskBudget, setRiskBudget] = useState<RiskBudgetData | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [equity, setEquity] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<TriggerMetCandidate | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { canPlaceNewTrades } = useWeeklyPhase();
  const { sizePosition } = useRiskProfile();
  const dayOfWeek = getDayOfWeek();
  const buttonState = getBuyButtonState(dayOfWeek);

  // ── Fetch data on mount ──────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [crossRef, risk, settingsData] = await Promise.all([
        apiRequest<CrossRefResponse>('/api/scan/cross-ref').catch(() => null),
        apiRequest<RiskResponse>(`/api/risk?userId=${DEFAULT_USER_ID}`).catch(() => null),
        apiRequest<SettingsResponse>(`/api/settings?userId=${DEFAULT_USER_ID}`).catch(() => null),
      ]);

      if (crossRef) setCrossRefData(crossRef);
      if (risk) {
        setRiskBudget(risk.budget);
        setEquity(risk.equity);
      }
      if (settingsData) setSettings(settingsData);
      if (!crossRef) setError('Could not load scan data');
    } catch {
      setError('Failed to load Ready to Buy data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived data ─────────────────────────────────────────
  const candidates = useMemo(() => {
    if (!crossRefData?.tickers) return [];
    const triggerMet = filterTriggerMet(crossRefData.tickers);
    // Exclude tickers the user already holds
    const heldTickers = new Set(openPositions.map((p) => p.ticker));
    return triggerMet.filter((c) => !heldTickers.has(c.ticker));
  }, [crossRefData, openPositions]);

  const snapshotAge = useMemo(() => {
    return getSnapshotAge(crossRefData?.summary?.scanCachedAt ?? null);
  }, [crossRefData]);

  // Auto-expand on execution day if there are candidates
  useEffect(() => {
    if (canPlaceNewTrades && candidates.length > 0) {
      setExpanded(true);
    }
  }, [canPlaceNewTrades, candidates.length]);

  // ── Gate checks (UI-side only — server enforces authoritative gates) ──
  const positionCapReached = currentPositionCount >= (riskBudget?.maxPositions ?? 4);
  const riskBudgetFull = riskBudget
    ? riskBudget.usedRiskPercent >= riskBudget.maxRiskPercent
    : false;
  const noT212Connected = settings
    ? !settings.t212Connected && !settings.t212IsaConnected
    : false;

  // ── Buy button disable reasons (per-candidate) ───────────
  function getCandidateDisableReason(candidate: TriggerMetCandidate): string | null {
    if (!buttonState.enabled) return buttonState.tooltip;
    if (positionCapReached) return `Maximum ${riskBudget?.maxPositions ?? 4} positions reached`;
    if (riskBudgetFull) return `Risk budget exhausted (${riskBudget?.maxRiskPercent ?? 10}%)`;
    if (noT212Connected) return 'Connect Trading 212 in Settings';
    if (snapshotAge.critical) return 'Snapshot too stale — run a fresh scan';
    if (candidate.dualAction === 'Auto-No') return 'Rejected by dual-score (FWS > 65)';
    return null;
  }

  // ── Handlers ─────────────────────────────────────────────
  const handleBuyClick = (candidate: TriggerMetCandidate) => {
    setSelectedCandidate(candidate);
    setModalOpen(true);
  };

  const handleBuyConfirm = useCallback(async () => {
    setModalOpen(false);
    setSelectedCandidate(null);
    onPositionCreated();
    // Refresh candidates (bought ticker should disappear)
    await fetchData();
  }, [onPositionCreated, fetchData]);

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedCandidate(null);
  };

  // ── Render ───────────────────────────────────────────────
  const candidateCount = candidates.length;
  const hasAnyCandidates = candidateCount > 0;

  return (
    <>
      <div className="card-surface overflow-hidden">
        {/* Collapsible header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-5 h-5 text-primary-400" />
            <h2 className="text-sm font-semibold text-foreground">Ready to Buy</h2>
            {/* Count badge */}
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                hasAnyCandidates
                  ? 'bg-profit/15 text-profit'
                  : 'bg-white/10 text-muted-foreground'
              )}
            >
              {loading ? '...' : candidateCount}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Snapshot age indicator */}
            {!loading && (
              <span
                className={cn(
                  'text-xs flex items-center gap-1',
                  snapshotAge.critical
                    ? 'text-loss'
                    : snapshotAge.stale
                      ? 'text-amber-400'
                      : 'text-muted-foreground'
                )}
              >
                <Clock className="w-3 h-3" />
                {snapshotAge.label}
              </span>
            )}
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="px-5 pb-5 border-t border-border">
            {/* Loading state */}
            {loading && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading candidates...
              </div>
            )}

            {/* Error state */}
            {!loading && error && (
              <div className="py-4 px-3 mt-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Staleness warning */}
            {!loading && snapshotAge.critical && (
              <div className="py-3 px-3 mt-3 bg-loss/10 border border-loss/30 rounded-lg text-xs text-loss flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Snapshot data is {snapshotAge.label} — run a fresh scan from the Plan page before buying.
              </div>
            )}
            {!loading && snapshotAge.stale && !snapshotAge.critical && (
              <div className="py-3 px-3 mt-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400 flex items-center gap-2">
                <Info className="w-4 h-4 flex-shrink-0" />
                Snapshot data is {snapshotAge.label} — consider running a fresh scan for accurate triggers.
              </div>
            )}

            {/* Risk budget summary row */}
            {!loading && riskBudget && (
              <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Positions: {currentPositionCount}/{riskBudget.maxPositions}
                  {positionCapReached && <span className="text-loss ml-1">(FULL)</span>}
                </span>
                <span className="flex items-center gap-1">
                  Open risk: {riskBudget.usedRiskPercent.toFixed(1)}%/{riskBudget.maxRiskPercent}%
                  {riskBudgetFull && <span className="text-loss ml-1">(FULL)</span>}
                </span>
                {/* Day-of-week indicator */}
                <span
                  className={cn(
                    'flex items-center gap-1',
                    buttonState.color === 'green' && 'text-profit',
                    buttonState.color === 'amber' && 'text-amber-400',
                    buttonState.color === 'red' && 'text-loss',
                    buttonState.color === 'grey' && 'text-muted-foreground'
                  )}
                >
                  {buttonState.enabled ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <Ban className="w-3 h-3" />
                  )}
                  {buttonState.tooltip}
                </span>
              </div>
            )}

            {/* No candidates */}
            {!loading && !error && candidateCount === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No trigger-met candidates — prices have not yet reached entry triggers.
              </div>
            )}

            {/* Candidate cards */}
            {!loading && candidateCount > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                {candidates.map((candidate) => {
                  const disableReason = getCandidateDisableReason(candidate);
                  const isDisabled = disableReason !== null;
                  const badge = actionBadge(candidate.dualAction);
                  const sleeve = sleeveBadge(candidate.sleeve);
                  const clusterWarnings = getClusterWarnings(
                    candidate.ticker,
                    candidate.scanStatus === 'READY' ? (crossRefData?.tickers.find(t => t.ticker === candidate.ticker) as CrossRefTicker & { clusterName?: string })?.sleeve : undefined,
                    undefined,
                    openPositions
                  );
                  // Use cross-ref data for cluster name — it's in the dual score fields
                  const candidateCluster = crossRefData?.tickers.find(t => t.ticker === candidate.ticker);
                  const realClusterWarnings = getClusterWarnings(
                    candidate.ticker,
                    (candidateCluster as CrossRefTicker & { clusterName?: string })?.sleeve,
                    undefined,
                    openPositions
                  );
                  // Check open positions for cluster match directly
                  const positionClusterWarnings: string[] = [];
                  for (const pos of openPositions) {
                    if (pos.ticker === candidate.ticker) continue;
                    if (pos.cluster && candidate.sleeve && pos.cluster === candidate.sleeve) {
                      // This would be sleeve matching, not cluster — skip
                    }
                  }

                  return (
                    <div
                      key={candidate.ticker}
                      className="bg-navy-800/50 border border-border rounded-lg p-4 flex flex-col gap-2"
                    >
                      {/* Header: ticker + name + sleeve + action badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-semibold text-foreground text-sm">
                            {candidate.ticker}
                          </span>
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded', sleeve.className)}>
                            {sleeve.text}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap',
                            badge.className
                          )}
                        >
                          {badge.text}
                        </span>
                      </div>

                      {/* Name */}
                      <div className="text-xs text-muted-foreground truncate">{candidate.name}</div>

                      {/* Price vs trigger */}
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className="text-foreground font-mono">
                          {formatPrice(candidate.scanPrice ?? 0, candidate.priceCurrency)}
                        </span>
                        <span className="text-muted-foreground">
                          trigger {formatPrice(candidate.scanEntryTrigger ?? 0, candidate.priceCurrency)}
                        </span>
                        {candidate.aboveTriggerPct > 0 && (
                          <span className="text-profit text-[10px]">
                            +{candidate.aboveTriggerPct.toFixed(1)}%
                          </span>
                        )}
                      </div>

                      {/* Scores row */}
                      <div className="flex gap-2 text-[10px] font-mono">
                        <span className="text-muted-foreground">
                          BQS <span className="text-foreground">{candidate.dualBQS?.toFixed(0) ?? '—'}</span>
                        </span>
                        <span className="text-muted-foreground">
                          FWS <span className={fwsColor(candidate.dualFWS)}>{candidate.dualFWS?.toFixed(0) ?? '—'}</span>
                        </span>
                        <span className="text-muted-foreground">
                          NCS <span className={ncsColor(candidate.dualNCS)}>{candidate.dualNCS?.toFixed(0) ?? '—'}</span>
                        </span>
                        {candidate.bps != null && (
                          <span className="text-muted-foreground">
                            BPS <span className={cn(
                              candidate.bps >= 14 ? 'text-profit' :
                              candidate.bps >= 10 ? 'text-blue-400' :
                              candidate.bps >= 6 ? 'text-amber-400' : 'text-foreground'
                            )}>{candidate.bps}</span>
                          </span>
                        )}
                      </div>

                      {/* Stop level + initial risk + approx position value */}
                      {candidate.scanStopPrice != null && candidate.scanEntryTrigger != null && (
                        <div className="text-[10px] text-muted-foreground">
                          {candidate.scanShares != null && candidate.scanShares > 0 && (
                            <>
                              <span className="text-foreground font-mono">
                                {candidate.scanShares < 1
                                  ? candidate.scanShares.toFixed(2)
                                  : candidate.scanShares.toFixed(candidate.scanShares % 1 > 0 ? 2 : 0)
                                } shares
                              </span>
                              <span className="mx-1">·</span>
                              <span>≈ £{approxGbpValue(candidate.scanShares, candidate.scanEntryTrigger, candidate.priceCurrency)}</span>
                              <span className="mx-1">·</span>
                            </>
                          )}
                          {candidate.scanRiskDollars != null && (
                            <>
                              <span>Risk £{candidate.scanRiskDollars.toFixed(2)}</span>
                              <span className="mx-1">·</span>
                            </>
                          )}
                          Stop {formatPrice(candidate.scanStopPrice, candidate.priceCurrency)}
                        </div>
                      )}

                      {/* Cluster warnings */}
                      {openPositions.some(
                        (p) => p.cluster && p.ticker !== candidate.ticker
                      ) && openPositions.filter(
                        (p) => p.cluster && p.cluster === candidate.sleeve && p.ticker !== candidate.ticker
                      ).length > 0 && (
                        <div className="text-[10px] text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Sleeve overlap with open positions
                        </div>
                      )}

                      {/* Buy button */}
                      <div className="mt-auto pt-2">
                        <button
                          onClick={() => handleBuyClick(candidate)}
                          disabled={isDisabled}
                          title={disableReason || ''}
                          className={cn(
                            'w-full py-1.5 px-3 rounded text-xs font-medium transition-all flex items-center justify-center gap-1.5',
                            isDisabled
                              ? buttonState.color === 'red'
                                ? 'bg-loss/10 text-loss/50 border border-loss/20 cursor-not-allowed'
                                : 'bg-white/5 text-muted-foreground/50 border border-border cursor-not-allowed'
                              : buttonState.color === 'green'
                                ? 'bg-profit/15 text-profit border border-profit/30 hover:bg-profit/25'
                                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
                          )}
                        >
                          <ShoppingCart className="w-3 h-3" />
                          {isDisabled ? 'Blocked' : buttonState.color === 'amber' ? 'Buy (Advisory)' : 'Buy'}
                        </button>
                        {/* Inline advisory for amber days */}
                        {!isDisabled && buttonState.color === 'amber' && (
                          <p className="text-[10px] text-amber-400/70 text-center mt-1">
                            Mid-week entry — confirm this was pre-planned
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Buy confirmation modal */}
      {selectedCandidate && (
        <BuyConfirmationModal
          candidate={selectedCandidate}
          riskBudget={riskBudget}
          equity={equity}
          investConnected={settings?.t212Connected ?? false}
          isaConnected={settings?.t212IsaConnected ?? false}
          sizePosition={sizePosition}
          openPositionTickers={openPositions.map(p => p.ticker)}
          isOpen={modalOpen}
          onConfirm={handleBuyConfirm}
          onCancel={handleModalClose}
        />
      )}
    </>
  );
}
