'use client';

import StatusBadge from '@/components/shared/StatusBadge';
import { cn, formatPrice, formatPercent } from '@/lib/utils';
import { ArrowUpRight, Clock, Target, CheckCircle2, AlertTriangle, Crosshair, BarChart3, Briefcase, Zap, Info, X, Download, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

interface Candidate {
  ticker: string;
  yahooTicker?: string;
  name: string;
  sleeve: string;
  status: string;
  price: number;
  entryTrigger: number;
  stopPrice: number;
  distancePercent: number;
  shares?: number;
  riskDollars?: number;
  priceCurrency?: string;
  // Cross-ref enrichment
  matchType?: 'BOTH_RECOMMEND' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'CONFLICT';
  agreementScore?: number;
  dualNCS?: number | null;
  dualBQS?: number | null;
  dualFWS?: number | null;
  dualAction?: string | null;
  scanRankScore?: number | null;
  scanPassesFilters?: boolean | null;
  scanPassesRiskGates?: boolean | null;
  scanPassesAntiChase?: boolean | null;
  // Earnings calendar data
  earningsInfo?: {
    daysUntilEarnings: number | null;
    nextEarningsDate: string | null;
    confidence: 'HIGH' | 'LOW' | 'NONE';
    action: 'AUTO_NO' | 'DEMOTE_WATCH' | null;
    reason: string | null;
  };
  // Allocation score breakdown
  allocationScore?: number | null;
  allocationRank?: number | null;
  qualityComponent?: number;
  expectancyComponent?: number;
  sleeveBalanceBonus?: number;
  clusterCrowdingPenalty?: number;
  sectorCrowdingPenalty?: number;
  earningsNearPenalty?: number;
  correlationPenalty?: number;
  capitalInefficiencyPenalty?: number;
  expectancyR?: number | null;
  correlatedHoldings?: string[];
}

interface ReadyCandidatesProps {
  candidates: Candidate[];
  heldTickers?: Set<string>;
  liveTickers?: Set<string>;
}

const matchTypeBadge: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  BOTH_RECOMMEND: { label: 'CONFIRMED', color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle2 },
  SCAN_ONLY: { label: '7-STAGE', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30', icon: Crosshair },
  DUAL_ONLY: { label: 'DUAL', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30', icon: BarChart3 },
  CONFLICT: { label: 'CONFLICT', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30', icon: AlertTriangle },
};

function downloadCsv(rows: Candidate[]) {
  const headers = ['Ticker','Name','Sleeve','Status','Price','Entry Trigger','Stop','Distance %','Match Type','Agreement %','BQS','FWS','NCS','Dual Action','Shares','Risk £'];
  const csvRows = rows.map(c => [
    c.ticker, c.name, c.sleeve, c.status,
    c.price, c.entryTrigger, c.stopPrice, c.distancePercent.toFixed(2),
    c.matchType ?? '', c.agreementScore ?? '',
    c.dualBQS != null ? c.dualBQS.toFixed(0) : '',
    c.dualFWS != null ? c.dualFWS.toFixed(0) : '',
    c.dualNCS != null ? c.dualNCS.toFixed(0) : '',
    c.dualAction ?? '',
    c.shares ?? '', c.riskDollars ?? '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv = [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ready-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReadyCandidates({ candidates, heldTickers = new Set(), liveTickers = new Set() }: ReadyCandidatesProps) {
  const [showScoreHelp, setShowScoreHelp] = useState(false);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const ready = candidates.filter(c => c.status === 'READY');
  const watch = candidates.filter(c => c.status === 'WATCH');

  const hasAllocationScores = ready.some(c => c.allocationScore != null);

  // Sort: trigger-met first, then by allocationScore (if available) or matchType + agreementScore
  const sortedReady = [...ready].sort((a, b) => {
    // Trigger-met candidates first
    const aTriggerMet = a.price > 0 && a.entryTrigger > 0 && a.price >= a.entryTrigger ? 1 : 0;
    const bTriggerMet = b.price > 0 && b.entryTrigger > 0 && b.price >= b.entryTrigger ? 1 : 0;
    if (bTriggerMet !== aTriggerMet) return bTriggerMet - aTriggerMet;
    // If allocation scores available, use them for primary sort
    if (hasAllocationScores) {
      return (b.allocationScore ?? -999) - (a.allocationScore ?? -999);
    }
    const typeOrder: Record<string, number> = { BOTH_RECOMMEND: 0, SCAN_ONLY: 1, DUAL_ONLY: 2, CONFLICT: 3 };
    const oa = typeOrder[a.matchType || 'SCAN_ONLY'] ?? 4;
    const ob = typeOrder[b.matchType || 'SCAN_ONLY'] ?? 4;
    if (oa !== ob) return oa - ob;
    return (b.agreementScore || 0) - (a.agreementScore || 0);
  });

  const bothCount = ready.filter(c => c.matchType === 'BOTH_RECOMMEND').length;
  const triggerMetCount = ready.filter(c => c.price > 0 && c.entryTrigger > 0 && c.price >= c.entryTrigger).length;

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-profit" />
          Ready Candidates
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {ready.length} ready{bothCount > 0 ? ` (${bothCount} confirmed)` : ''}{triggerMetCount > 0 ? ` · ${triggerMetCount} triggered` : ''}
          </span>
          {ready.length > 0 && (
            <button
              onClick={() => downloadCsv(sortedReady)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground bg-navy-700 hover:bg-navy-600 border border-navy-600 transition-colors"
              title="Download ready candidates as CSV"
            >
              <Download className="w-3 h-3" />
              CSV
            </button>
          )}
        </div>
      </div>

      {/* Source indicator */}
      <div className="flex items-center gap-2 mb-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Crosshair className="w-3 h-3 text-blue-400" /> 7-Stage Scan
        </span>
        <span>×</span>
        <span className="flex items-center gap-1">
          <BarChart3 className="w-3 h-3 text-purple-400" /> Dual Scores
        </span>
        <span>×</span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Cross-Ref
        </span>
      </div>

      {sortedReady.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No candidates ready for entry
          <p className="text-xs mt-1 opacity-75">Run a scan to populate candidates</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedReady.map((c) => {
            const badge = matchTypeBadge[c.matchType || 'SCAN_ONLY'] || matchTypeBadge.SCAN_ONLY;
            const BadgeIcon = badge.icon;
            const isHeld = heldTickers.has(c.ticker);
            const isLive = liveTickers.has(c.ticker);
            const isTriggerMet = c.price > 0 && c.entryTrigger > 0 && c.price >= c.entryTrigger;
            const isBuyReady = c.matchType === 'BOTH_RECOMMEND'
              && !isHeld
              && isTriggerMet
              && c.scanPassesFilters !== false
              && c.scanPassesRiskGates !== false
              && c.scanPassesAntiChase !== false;
            return (
              <div
                key={c.ticker}
                className={cn(
                  "bg-navy-800 rounded-lg p-3 border relative",
                  isTriggerMet
                    ? 'border-amber-400/60 ring-2 ring-amber-400/30 animate-pulse'
                    : isHeld
                      ? 'border-primary-400/40 ring-1 ring-primary-400/20'
                      : c.matchType === 'BOTH_RECOMMEND'
                        ? 'border-emerald-500/30'
                        : c.matchType === 'CONFLICT'
                          ? 'border-amber-500/20'
                          : 'border-profit/20'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-profit font-bold">{c.ticker}{c.yahooTicker && c.yahooTicker !== c.ticker && <span className="text-muted-foreground text-[10px] font-normal ml-1">({c.yahooTicker})</span>}</span>
                    <StatusBadge status={c.status} />
                    {isHeld && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border text-primary-400 bg-primary-500/15 border-primary-500/30">
                        <Briefcase className="w-3 h-3" />
                        HELD
                      </span>
                    )}
                    {isLive && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border text-cyan-400 bg-cyan-500/20 border-cyan-500/30">
                        ⚡ LIVE
                      </span>
                    )}
                    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border", badge.color)}>
                      <BadgeIcon className="w-3 h-3" />
                      {badge.label}
                    </span>
                    {isTriggerMet && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border text-amber-400 bg-amber-500/15 border-amber-500/40">
                        <AlertTriangle className="w-3 h-3" />
                        TRIGGER MET
                      </span>
                    )}
                    {/* Earnings calendar warning badge */}
                    {c.earningsInfo?.daysUntilEarnings != null && c.earningsInfo.daysUntilEarnings <= 5 && (
                      <span className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                        c.earningsInfo.action === 'AUTO_NO'
                          ? 'text-red-400 bg-red-500/15 border-red-500/40'
                          : 'text-amber-400 bg-amber-500/15 border-amber-500/30'
                      )}>
                        <AlertTriangle className="w-3 h-3" />
                        {c.earningsInfo.action === 'AUTO_NO'
                          ? `EARNINGS ${c.earningsInfo.daysUntilEarnings}d`
                          : `⚠ Earnings ${c.earningsInfo.daysUntilEarnings}d`}
                      </span>
                    )}
                  </div>
                  {isBuyReady ? (
                    <Link
                      href="/portfolio/positions#ready-to-buy"
                      title="Review and place this order in Ready to Buy"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-500 text-navy-900 hover:bg-emerald-400 transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      BUY
                    </Link>
                  ) : (
                    <ArrowUpRight className="w-4 h-4 text-profit" />
                  )}
                </div>

                {/* Sleeve + rank info */}
                <div className="flex items-center gap-2 mb-2 text-[10px]">
                  <span className="text-muted-foreground">{c.sleeve}</span>
                  {c.scanRankScore != null && (
                    <span className="text-muted-foreground">Rank: {c.scanRankScore.toFixed(0)}</span>
                  )}
                  {c.agreementScore != null && (
                    <span className={cn(
                      "font-medium",
                      c.agreementScore >= 80 ? 'text-emerald-400' : c.agreementScore >= 60 ? 'text-amber-400' : 'text-red-400'
                    )}
                      title={
                        c.agreementScore >= 80 ? 'High Conviction — strong cross-system alignment' :
                        c.agreementScore >= 60 ? 'Acceptable — proceed with normal sizing' :
                        'Low agreement — avoid unless expansion phase'
                      }
                    >
                      Agreement: {c.agreementScore}%
                      <span className={cn(
                        "ml-1 text-[9px] opacity-80",
                        c.agreementScore >= 80 ? 'text-emerald-400' : c.agreementScore >= 60 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {c.agreementScore >= 80 ? '· High' : c.agreementScore >= 60 ? '· OK' : '· Low'}
                      </span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Price</span>
                    <div className="font-mono text-foreground">{formatPrice(c.price, c.priceCurrency)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Trigger</span>
                    <div className="font-mono text-warning">{formatPrice(c.entryTrigger, c.priceCurrency)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Distance</span>
                    <div className={cn(
                      "font-mono font-bold",
                      c.distancePercent < 1 ? 'text-orange-400' :
                      c.distancePercent <= 2 ? 'text-amber-400' :
                      'text-blue-400'
                    )}>
                      {formatPercent(c.distancePercent)}
                      <span className={cn(
                        "ml-1 text-[9px] font-semibold uppercase tracking-wide",
                        c.distancePercent < 1 ? 'text-orange-400' :
                        c.distancePercent <= 2 ? 'text-amber-400' :
                        'text-blue-400/70'
                      )}>
                        {c.distancePercent < 1 ? '🔥 HOT' : c.distancePercent <= 2 ? 'WATCH' : 'EARLY'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dual Score breakdown */}
                {c.dualNCS != null && (
                  <div className="mt-2 pt-2 border-t border-navy-600 space-y-1.5">
                    {/* Score header with explainer toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Dual Score</span>
                      <button
                        onClick={() => setShowScoreHelp(!showScoreHelp)}
                        className="inline-flex items-center gap-1 text-[9px] text-primary-400 hover:text-primary-300 transition-colors"
                        title="What do these scores mean?"
                      >
                        {showScoreHelp ? (
                          <><X className="w-3 h-3" /> hide</>
                        ) : (
                          <><Info className="w-3 h-3" /> guide</>
                        )}
                      </button>
                    </div>

                    {showScoreHelp && (
                      <div className="bg-navy-700 border border-primary-400/30 rounded-lg p-3 mb-2 text-[10px] space-y-2">
                        <p className="text-primary-400 font-semibold text-[11px]">Score Guide</p>
                        <div>
                          <p className="text-emerald-400 font-semibold">Breakout Quality Score (BQS)</p>
                          <p className="text-muted-foreground">Measures setup strength — trend alignment, base quality, volume pattern. Higher = stronger breakout setup. 70+ is ideal.</p>
                        </div>
                        <div>
                          <p className="text-amber-400 font-semibold">Fatal Weakness Score (FWS)</p>
                          <p className="text-muted-foreground">Counts structural risks — overhead supply, weak sector, poor earnings. Lower = safer. Above 60 is a red flag.</p>
                        </div>
                        <div>
                          <p className="text-foreground font-semibold">Net Composite Score (NCS)</p>
                          <p className="text-muted-foreground">Final ranking = BQS − FWS penalty. This is the number that determines candidate priority. 70+ = high conviction, 40–69 = acceptable, &lt;40 = avoid.</p>
                        </div>
                      </div>
                    )}
                    {/* BQS — Breakout Quality Score (strength) */}
                    {c.dualBQS != null && (
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <span className="text-muted-foreground">
                            Breakout Quality <span className="opacity-60">(strength)</span>
                          </span>
                          <span className={cn(
                            "font-mono font-medium",
                            c.dualBQS >= 70 ? 'text-emerald-400' : c.dualBQS >= 40 ? 'text-amber-400' : 'text-red-400'
                          )}>
                            {c.dualBQS.toFixed(0)}
                          </span>
                        </div>
                        <div className="w-full h-1 bg-navy-700 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              c.dualBQS >= 70 ? 'bg-emerald-500' : c.dualBQS >= 40 ? 'bg-amber-500' : 'bg-red-500'
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, c.dualBQS))}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* FWS — Fatal Weakness Score (risk) */}
                    {c.dualFWS != null && (
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <span className="text-muted-foreground">
                            Fatal Weakness <span className="opacity-60">(risk)</span>
                          </span>
                          <span className={cn(
                            "font-mono font-medium",
                            c.dualFWS <= 30 ? 'text-emerald-400' : c.dualFWS <= 60 ? 'text-amber-400' : 'text-red-400'
                          )}>
                            {c.dualFWS.toFixed(0)}
                          </span>
                        </div>
                        <div className="w-full h-1 bg-navy-700 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              c.dualFWS <= 30 ? 'bg-emerald-500' : c.dualFWS <= 60 ? 'bg-amber-500' : 'bg-red-500'
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, c.dualFWS))}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* NCS — Net Composite Score (rank) */}
                    <div>
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="text-foreground font-semibold">
                          Net Composite <span className="opacity-60 font-normal">(rank)</span>
                        </span>
                        <span className={cn(
                          "font-mono font-bold",
                          c.dualNCS >= 70 ? 'text-emerald-400' : c.dualNCS >= 40 ? 'text-amber-400' : 'text-red-400'
                        )}>
                          {c.dualNCS.toFixed(0)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-navy-700 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            c.dualNCS >= 70 ? 'bg-emerald-500' : c.dualNCS >= 40 ? 'bg-amber-500' : 'bg-red-500'
                          )}
                          style={{ width: `${Math.min(100, Math.max(0, c.dualNCS))}%` }}
                        />
                      </div>
                    </div>

                    {c.dualAction && (
                      <div className="text-[10px] text-muted-foreground mt-1 italic">
                        {c.dualAction}
                      </div>
                    )}
                  </div>
                )}

                {/* Allocation Score Breakdown (expandable) */}
                {c.allocationScore != null && (
                  <div className="mt-2 pt-2 border-t border-navy-600">
                    <button
                      onClick={() => setExpandedTicker(expandedTicker === c.ticker ? null : c.ticker)}
                      className="flex items-center justify-between w-full text-[10px] group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Allocation Score</span>
                        {c.allocationRank != null && (
                          <span className="text-primary-400 font-bold">#{c.allocationRank}</span>
                        )}
                      </div>
                      <span className={cn(
                        "font-mono font-bold text-xs",
                        c.allocationScore >= 30 ? 'text-emerald-400' :
                        c.allocationScore >= 15 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {c.allocationScore.toFixed(1)}
                        <ChevronDown className={cn(
                          "inline w-3 h-3 ml-0.5 transition-transform",
                          expandedTicker === c.ticker && 'rotate-180'
                        )} />
                      </span>
                    </button>

                    {expandedTicker === c.ticker && (
                      <div className="mt-1.5 space-y-0.5 text-[10px]">
                        <ScoreRow label="Quality (NCS)" value={c.qualityComponent} maxPositive={40} />
                        <ScoreRow label="Expectancy (EV)" value={c.expectancyComponent} maxPositive={15} subtitle={c.expectancyR != null ? `${c.expectancyR >= 0 ? '+' : ''}${c.expectancyR.toFixed(2)}R hist.` : undefined} />
                        <ScoreRow label="Sleeve balance" value={c.sleeveBalanceBonus} maxPositive={10} />
                        <ScoreRow label="Cluster crowding" value={c.clusterCrowdingPenalty ? -c.clusterCrowdingPenalty : 0} maxNegative={15} />
                        <ScoreRow label="Sector crowding" value={c.sectorCrowdingPenalty ? -c.sectorCrowdingPenalty : 0} maxNegative={10} />
                        <ScoreRow label="Earnings near" value={c.earningsNearPenalty ? -c.earningsNearPenalty : 0} maxNegative={10} />
                        <ScoreRow label="Correlation" value={c.correlationPenalty ? -c.correlationPenalty : 0} maxNegative={10}
                          subtitle={c.correlatedHoldings && c.correlatedHoldings.length > 0 ? `w/ ${c.correlatedHoldings.join(', ')}` : undefined} />
                        <ScoreRow label="Capital efficiency" value={c.capitalInefficiencyPenalty ? -c.capitalInefficiencyPenalty : 0} maxNegative={10} />
                      </div>
                    )}
                  </div>
                )}

                {c.shares && (
                  <div className="mt-2 pt-2 border-t border-navy-600 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Shares</span>
                      <div className="font-mono text-foreground">{c.shares}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Risk $</span>
                      <div className="font-mono text-loss">{formatPrice(c.riskDollars || 0, c.priceCurrency)}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}


    </div>
  );
}

// ── Score breakdown row component ─────────────────────────────
// Shows one component of the allocation score as a labeled bar.

function ScoreRow({ label, value, maxPositive, maxNegative, subtitle }: {
  label: string;
  value?: number;
  maxPositive?: number;
  maxNegative?: number;
  subtitle?: string;
}) {
  const v = value ?? 0;
  const isPositive = v >= 0;
  const absV = Math.abs(v);
  const maxAbs = isPositive ? (maxPositive ?? 40) : (maxNegative ?? 15);
  const barWidth = maxAbs > 0 ? Math.min(100, (absV / maxAbs) * 100) : 0;

  if (v === 0) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-muted-foreground/60">{label}</span>
        <span className="text-muted-foreground/40 font-mono">—</span>
      </div>
    );
  }

  return (
    <div className="py-0.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn(
          "font-mono font-medium",
          isPositive ? 'text-emerald-400' : 'text-red-400'
        )}>
          {isPositive ? '+' : ''}{v.toFixed(1)}
        </span>
      </div>
      <div className="w-full h-0.5 bg-navy-700 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isPositive ? 'bg-emerald-500/60' : 'bg-red-500/60'
          )}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {subtitle && (
        <div className="text-[9px] text-muted-foreground/60 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}
