/**
 * DEPENDENCIES
 * Consumed by: TodayDirectiveCard.tsx (dashboard)
 * Consumes: prisma.ts, market-data.ts, position-sizer.ts, stop-manager.ts, modules/laggard-purge.ts,
 *           default-user.ts, execution-mode.ts, safety-controls.ts
 * Risk-sensitive: NO (read-only aggregation)
 * Last modified: 2026-04-26
 * Notes: Single "what should I do today?" endpoint. Combines weekly phase, regime, health,
 *        risk budget, positions, stops, candidates, trigger-met, kill switch, T212 sync, data freshness
 *        into one of 8 user-facing decisions.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { getMarketRegime } from '@/lib/market-data';
import { getBatchPrices } from '@/lib/market-data';
import { getLivePrices } from '@/lib/live-prices';
import { calculateRMultiple } from '@/lib/position-sizer';
import { generateStopRecommendations, generateTrailingStopRecommendations } from '@/lib/stop-manager';
import { detectLaggards } from '@/lib/modules';
import { apiError } from '@/lib/api-response';
import { getExecutionMode } from '@/lib/execution-mode';
import { getUKDayOfWeek } from '@/lib/uk-time';
import { getKillSwitchSettings, isAutoTradingEnabled, getMarketDataSafetyStatus } from '../../../../../packages/workflow/src';
import { RISK_PROFILES, OPERATING_MODES, type RiskProfileType, type OperatingMode, type Sleeve } from '@/types';

// ── The user-facing decisions ──────────────────────────────
const DECISIONS = [
  'NO_ACTION',
  'MANAGE_EXISTING',
  'UPDATE_STOPS',
  'WATCH_CANDIDATES',
  'PREPARE_PLAN',
  'BUY_ALLOWED',
  'BUY_BLOCKED',
  'EXIT_REVIEW',
  'SYSTEM_BLOCKED',
  'CAPITAL_PRESERVATION_ACTIVE',
  'RESEARCH_ONLY',
] as const;
type Decision = (typeof DECISIONS)[number];

// ── Phase (derived from UK day-of-week) ─────────────────────
type Phase = 'PLANNING' | 'EXECUTION' | 'MAINTENANCE';

function getPhaseForDay(day: number): Phase {
  switch (day) {
    case 0: return 'PLANNING';
    case 6: return 'MAINTENANCE';
    default: return 'EXECUTION'; // Mon-Fri
  }
}

// ── Blocker: anything preventing a buy ──────────────────────
interface Blocker {
  code: string;
  label: string;
  severity: 'hard' | 'soft';
}

// ── Full context (everything the decision tree needs) ────────
interface DirectiveContext {
  phase: Phase;
  regime: string;
  operatingMode: OperatingMode;
  heartbeatStatus: string;
  heartbeatAgeHours: number;
  healthOverall: string;
  scanAgeHours: number;
  readyCandidateCount: number;
  triggerMetCount: number;
  stopsPending: number;
  laggardCount: number;
  pyramidCount: number;
  openPositionCount: number;
  maxPositions: number;
  openRiskPct: number;
  maxOpenRisk: number;
  riskBudgetUsedPct: number;
  killSwitchActive: boolean;
  autoTradingEnabled: boolean;
  t212Connected: boolean;
  dataStale: boolean;
  canEnter: boolean;
}

// ── Decision tree ────────────────────────────────────────────

function resolveDecision(ctx: DirectiveContext): { decision: Decision; blockers: Blocker[] } {
  const blockers: Blocker[] = [];

  // Layer 0: Emergency do-nothing — system is in a critical state
  if (ctx.killSwitchActive && ctx.healthOverall === 'RED') {
    blockers.push({ code: 'EMERGENCY', label: 'Kill switch active AND system health RED', severity: 'hard' });
    return { decision: 'SYSTEM_BLOCKED', blockers };
  }
  if (ctx.killSwitchActive) {
    blockers.push({ code: 'KILL_SWITCH', label: 'Kill switch is active — all submissions blocked', severity: 'hard' });
    return { decision: 'SYSTEM_BLOCKED', blockers };
  }

  // Layer 0b: System health — always populate blockers before any mode decisions
  if (ctx.heartbeatStatus === 'FAILED' || ctx.healthOverall === 'RED') {
    blockers.push({ code: 'SYSTEM_DOWN', label: 'System health is RED or nightly failed', severity: 'hard' });
  }
  if (ctx.heartbeatAgeHours > 18) {
    blockers.push({ code: 'DATA_STALE', label: `Nightly ran ${Math.round(ctx.heartbeatAgeHours)}h ago (>18h)`, severity: 'hard' });
  }
  if (ctx.dataStale) {
    blockers.push({ code: 'MARKET_DATA_STALE', label: 'Market data is stale', severity: 'soft' });
  }

  // Layer 0c: Operating mode overrides — these take priority but still allow stop/exit management
  // Health blockers are already populated above, so mode-specific decisions carry health warnings.
  const modeConfig = OPERATING_MODES[ctx.operatingMode];
  if (ctx.operatingMode === 'RESEARCH') {
    return { decision: 'RESEARCH_ONLY', blockers };
  }
  if (ctx.operatingMode === 'CAPITAL_PRESERVATION') {
    // Still allow stop updates and exit reviews
    if (ctx.stopsPending > 0) return { decision: 'UPDATE_STOPS', blockers };
    if (ctx.laggardCount > 0) return { decision: 'EXIT_REVIEW', blockers };
    return { decision: 'CAPITAL_PRESERVATION_ACTIVE', blockers };
  }

  // Layer 1: Phase-based blocking
  if (ctx.phase === 'PLANNING') {
    return { decision: 'PREPARE_PLAN', blockers };
  }

  // Layer 3: Regime / risk blockers (affect buying only)
  // Kill switch is handled in Layer 0 as SYSTEM_BLOCKED.
  if (ctx.regime === 'BEARISH') {
    blockers.push({ code: 'REGIME_BEARISH', label: 'Market regime is BEARISH', severity: 'hard' });
  }
  if (ctx.regime === 'SIDEWAYS') {
    blockers.push({ code: 'REGIME_SIDEWAYS', label: 'Market regime is SIDEWAYS', severity: 'hard' });
  }
  if (ctx.openPositionCount >= ctx.maxPositions) {
    blockers.push({ code: 'MAX_POSITIONS', label: `${ctx.openPositionCount}/${ctx.maxPositions} positions open`, severity: 'hard' });
  }
  if (ctx.openRiskPct >= ctx.maxOpenRisk) {
    blockers.push({ code: 'MAX_RISK', label: `Open risk ${ctx.openRiskPct.toFixed(1)}% (limit ${ctx.maxOpenRisk}%)`, severity: 'hard' });
  }
  if (!ctx.t212Connected) {
    blockers.push({ code: 'T212_NOT_CONNECTED', label: 'Trading 212 not connected', severity: 'soft' });
  }

  // Layer 4: Exit review takes priority over new entries
  if (ctx.laggardCount > 0) {
    return { decision: 'EXIT_REVIEW', blockers };
  }

  // Layer 5: Stop updates take priority over new entries
  if (ctx.stopsPending > 0) {
    // If there are also candidates ready, still flag stops first
    const hasHardBlocker = blockers.some(b => b.severity === 'hard');
    if (hasHardBlocker) return { decision: 'UPDATE_STOPS', blockers };
    // If no hard blockers, BUY_ALLOWED will also mention stops
    // Fall through to candidate check
  }

  // Layer 6: Candidate readiness
  const hasHardBlocker = blockers.some(b => b.severity === 'hard');

  if (ctx.readyCandidateCount > 0 || ctx.triggerMetCount > 0) {
    // AGGRESSIVE_QUALITY mode: counts are already filtered to A-grade only
    if (modeConfig?.requiresAGrade) {
      blockers.push({ code: 'MODE_A_GRADE_ONLY', label: 'Aggressive Quality mode — only A-grade candidates shown', severity: 'soft' });
    }
    if (hasHardBlocker) return { decision: 'BUY_BLOCKED', blockers };
    if (!ctx.canEnter) return { decision: 'BUY_BLOCKED', blockers };
    return { decision: 'BUY_ALLOWED', blockers };
  }

  // Layer 7: No candidates — what else can we do?
  if (ctx.stopsPending > 0) return { decision: 'UPDATE_STOPS', blockers };
  if (ctx.pyramidCount > 0) return { decision: 'MANAGE_EXISTING', blockers };
  if (ctx.scanAgeHours > 12) return { decision: 'WATCH_CANDIDATES', blockers };
  if (ctx.openPositionCount > 0) return { decision: 'MANAGE_EXISTING', blockers };

  return { decision: 'NO_ACTION', blockers };
}

// ── Human-readable content per decision ─────────────────────

function buildContent(
  decision: Decision,
  ctx: DirectiveContext,
  blockers: Blocker[],
): {
  headline: string;
  explanation: string;
  action: { label: string; href: string } | null;
  urgency: 'high' | 'medium' | 'low' | 'none';
} {
  switch (decision) {
    case 'NO_ACTION':
      return {
        headline: 'Nothing to do right now.',
        explanation: ctx.openPositionCount > 0
          ? `${ctx.openPositionCount} position${ctx.openPositionCount === 1 ? '' : 's'} running. Stops are current. No new candidates.`
          : 'No open positions and no candidates ready. Check back after the evening scan.',
        action: null,
        urgency: 'none',
      };

    case 'MANAGE_EXISTING':
      return {
        headline: `${ctx.openPositionCount} position${ctx.openPositionCount === 1 ? '' : 's'} to monitor.`,
        explanation: ctx.pyramidCount > 0
          ? `${ctx.pyramidCount} at ≥2R — pyramid add opportunity.`
          : 'Positions running. No immediate action needed.',
        action: { label: 'View Positions', href: '/portfolio/positions' },
        urgency: 'low',
      };

    case 'UPDATE_STOPS':
      return {
        headline: `${ctx.stopsPending} stop${ctx.stopsPending === 1 ? '' : 's'} to update.`,
        explanation: 'Trailing stops have moved. Review and apply to lock in profit.',
        action: { label: 'Review Stops', href: '/risk' },
        urgency: 'medium',
      };

    case 'WATCH_CANDIDATES':
      return {
        headline: 'Scan is stale. Run a fresh scan to find candidates.',
        explanation: `Last scan was ${Math.round(ctx.scanAgeHours)} hours ago. Run a new scan to get a fresh picture.`,
        action: { label: 'Run Scan', href: '/scan' },
        urgency: 'low',
      };

    case 'PREPARE_PLAN':
      return {
        headline: 'Planning day. Review the scan and prepare for the week.',
        explanation: ctx.scanAgeHours > 24
          ? 'Run a fresh scan first, then review candidates.'
          : `${ctx.readyCandidateCount} candidate${ctx.readyCandidateCount === 1 ? '' : 's'} from last scan. Review and shortlist.`,
        action: { label: 'Run Scan', href: '/scan' },
        urgency: 'low',
      };

    case 'BUY_ALLOWED': {
      const triggerText = ctx.triggerMetCount > 0
        ? `${ctx.triggerMetCount} triggered (price ≥ entry). `
        : '';
      const stopsNote = ctx.stopsPending > 0 ? ` Also: ${ctx.stopsPending} stop update${ctx.stopsPending === 1 ? '' : 's'} pending.` : '';
      return {
        headline: `${ctx.readyCandidateCount + ctx.triggerMetCount} candidate${(ctx.readyCandidateCount + ctx.triggerMetCount) === 1 ? '' : 's'} ready to buy.`,
        explanation: `${triggerText}Risk budget: ${ctx.riskBudgetUsedPct.toFixed(0)}% used. ${ctx.maxPositions - ctx.openPositionCount} position slot${(ctx.maxPositions - ctx.openPositionCount) === 1 ? '' : 's'} available.${stopsNote}`,
        action: { label: 'Go to Positions', href: '/portfolio/positions' },
        urgency: 'high',
      };
    }

    case 'BUY_BLOCKED': {
      const hardBlockers = blockers.filter(b => b.severity === 'hard');
      const topBlocker = hardBlockers[0]?.label || 'Entry conditions not met';
      const moreCount = hardBlockers.length - 1;
      return {
        headline: ctx.readyCandidateCount > 0
          ? `${ctx.readyCandidateCount} candidate${ctx.readyCandidateCount === 1 ? '' : 's'} ready — but buying is blocked.`
          : 'New entries are blocked.',
        explanation: `${topBlocker}${moreCount > 0 ? ` (+${moreCount} more)` : ''}`,
        action: ctx.openPositionCount > 0 ? { label: 'View Positions', href: '/portfolio/positions' } : null,
        urgency: 'medium',
      };
    }

    case 'EXIT_REVIEW':
      return {
        headline: `${ctx.laggardCount} position${ctx.laggardCount === 1 ? '' : 's'} flagged — exit review needed.`,
        explanation: 'Dead money or laggard positions detected. Review for potential exit to free up capital.',
        action: { label: 'View Positions', href: '/portfolio/positions' },
        urgency: 'high',
      };

    case 'SYSTEM_BLOCKED': {
      const reasons = blockers.map(b => b.label).join('. ');
      return {
        headline: 'SYSTEM BLOCKED — do not trade.',
        explanation: `${reasons}. Do not place any orders until the system is healthy. Recovery: check Settings → Safety Controls, run the nightly process, and resolve any RED health items.`,
        action: { label: 'Go to Settings', href: '/settings' },
        urgency: 'high',
      };
    }

    case 'CAPITAL_PRESERVATION_ACTIVE':
      return {
        headline: 'Capital Preservation mode — no new trades.',
        explanation: ctx.openPositionCount > 0
          ? `Managing ${ctx.openPositionCount} existing position${ctx.openPositionCount === 1 ? '' : 's'}. Stops and exits only. Switch to Normal mode when ready to trade again.`
          : 'No positions open. System is in capital preservation mode. Switch to Normal mode to resume trading.',
        action: ctx.openPositionCount > 0 ? { label: 'View Positions', href: '/portfolio/positions' } : { label: 'Change Mode', href: '/settings' },
        urgency: 'low',
      };

    case 'RESEARCH_ONLY':
      return {
        headline: 'Research mode — read-only.',
        explanation: 'Scan and review candidates. No execution allowed. Switch to Normal mode to resume trading.',
        action: { label: 'Run Scan', href: '/scan' },
        urgency: 'none',
      };
  }
}

// ── Map heartbeat DB status to simplified enum ──
function mapHeartbeatStatus(dbStatus: string | null): 'SUCCESS' | 'FAILED' | 'RUNNING' | 'NONE' {
  if (!dbStatus) return 'NONE';
  const upper = dbStatus.toUpperCase();
  if (upper === 'OK' || upper === 'SUCCESS') return 'SUCCESS';
  if (upper === 'FAILED' || upper === 'ERROR') return 'FAILED';
  if (upper === 'RUNNING') return 'RUNNING';
  return 'SUCCESS';
}

// ── GET handler ──────────────────────────────────────────────
export async function GET(_request: NextRequest) {
  try {
    const userId = await ensureDefaultUser();
    const now = new Date();
    const ukDay = getUKDayOfWeek(now);
    const phase = getPhaseForDay(ukDay);

    // ── Parallel data fetch ──
    const [
      user,
      latestHealth,
      latestHeartbeat,
      latestScan,
      openPositions,
      killSwitch,
      marketDataStatus,
      autoEnabled,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { riskProfile: true, operatingMode: true, equity: true, t212Connected: true, t212IsaConnected: true },
      }),
      prisma.healthCheck.findFirst({
        where: { userId },
        orderBy: { runDate: 'desc' },
        select: { overall: true },
      }),
      prisma.heartbeat.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { status: true, timestamp: true },
      }),
      prisma.scan.findFirst({
        where: { userId },
        orderBy: { runDate: 'desc' },
        include: {
          results: {
            where: { status: 'READY', passesAllFilters: true },
            select: { id: true, price: true, entryTrigger: true, grade: true },
          },
        },
      }),
      prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: { select: { ticker: true, currency: true, sleeve: true } } },
      }),
      getKillSwitchSettings(),
      getMarketDataSafetyStatus(),
      isAutoTradingEnabled(),
    ]);

    const riskProfile = (user?.riskProfile || 'SMALL_ACCOUNT') as RiskProfileType;
    const operatingMode = (user?.operatingMode || 'NORMAL') as OperatingMode;
    const equity = user?.equity || 0;
    const profile = RISK_PROFILES[riskProfile];
    const t212Connected = !!(user?.t212Connected || user?.t212IsaConnected);

    // ── Heartbeat / health / scan age ──
    const heartbeatStatus = mapHeartbeatStatus(latestHeartbeat?.status ?? null);
    const heartbeatAgeHours = latestHeartbeat
      ? (now.getTime() - latestHeartbeat.timestamp.getTime()) / (1000 * 60 * 60)
      : 999;
    const healthOverall = (latestHealth?.overall as string) ?? 'GREEN';
    const scanAgeHours = latestScan
      ? (now.getTime() - latestScan.runDate.getTime()) / (1000 * 60 * 60)
      : 999;

    // ── Candidate counts (grade-aware) ──
    const allReadyCandidates = latestScan?.results ?? [];
    const aGradeCount = allReadyCandidates.filter((r: { grade?: string | null }) => r.grade === 'A_GRADE_BUY').length;
    const bGradeCount = allReadyCandidates.filter((r: { grade?: string | null }) => r.grade === 'B_GRADE_WATCH').length;

    // In AGGRESSIVE_QUALITY mode, only A-grade candidates count as ready
    const modeConfig = OPERATING_MODES[operatingMode];
    const readyCandidateCount = modeConfig.requiresAGrade ? aGradeCount : allReadyCandidates.length;

    // Trigger-met: price ≥ entryTrigger (already has price and entryTrigger)
    const triggerMetCount = allReadyCandidates.filter((r: { price?: number | null; entryTrigger?: number | null; grade?: string | null }) => {
      const triggered = r.price != null && r.entryTrigger != null && r.price >= r.entryTrigger;
      // In AGGRESSIVE_QUALITY, only A-grade trigger-met count
      if (modeConfig.requiresAGrade) return triggered && r.grade === 'A_GRADE_BUY';
      return triggered;
    }).length;

    // ── Regime + live prices (parallel, T212 primary) ──
    const openTickers = openPositions.map(p => p.stock.ticker);
    const [regime, liveResult] = await Promise.all([
      getMarketRegime().catch(() => 'SIDEWAYS' as const),
      openTickers.length > 0 ? getLivePrices(openTickers, userId) : Promise.resolve({ prices: {} as Record<string, number>, sources: {}, stats: { t212Count: 0, yahooCount: 0, totalRequested: 0 } }),
    ]);
    const livePrices = liveResult.prices;

    // ── Stops, laggards, pyramids, risk budget ──
    let stopsPending = 0;
    let laggardCount = 0;
    let pyramidCount = 0;
    let openRiskPct = 0;

    if (openPositions.length > 0) {
      const priceMap = new Map(Object.entries(livePrices));
      const [rBasedRecs, trailingRecs] = await Promise.all([
        generateStopRecommendations(userId, priceMap).catch(() => []),
        generateTrailingStopRecommendations(userId).catch(() => []),
      ]);

      // Merge stops (highest per position)
      const mergedStops = new Map<string, number>();
      for (const r of rBasedRecs) mergedStops.set(r.positionId, r.newStop);
      for (const r of trailingRecs) {
        const existing = mergedStops.get(r.positionId);
        if (!existing || r.trailingStop > existing) mergedStops.set(r.positionId, r.trailingStop);
      }
      stopsPending = mergedStops.size;

      // Laggards
      const enriched = openPositions.map(p => ({
        id: p.id,
        ticker: p.stock.ticker,
        entryPrice: p.entryPrice,
        entryDate: p.entryDate,
        currentPrice: livePrices[p.stock.ticker] ?? p.entryPrice,
        initialRisk: p.initialRisk,
        shares: p.shares,
        sleeve: p.stock.sleeve,
      }));
      laggardCount = detectLaggards(enriched).length;

      // Pyramids (≥2R, non-HEDGE)
      for (const p of openPositions) {
        if (p.stock.sleeve === 'HEDGE') continue;
        const price = livePrices[p.stock.ticker];
        if (!price) continue;
        if (calculateRMultiple(price, p.entryPrice, p.initialRisk) >= 2) pyramidCount++;
      }

      // Open risk %
      const nonHedgePositions = openPositions.filter(p => p.stock.sleeve !== 'HEDGE');
      const totalOpenRisk = nonHedgePositions.reduce((sum, p) => {
        const price = livePrices[p.stock.ticker] ?? p.entryPrice;
        return sum + Math.max(0, (price - p.currentStop) * p.shares);
      }, 0);
      openRiskPct = equity > 0 ? (totalOpenRisk / equity) * 100 : 0;
    }

    const riskBudgetUsedPct = profile.maxOpenRisk > 0 ? (openRiskPct / profile.maxOpenRisk) * 100 : 0;

    // ── Execution mode ──
    const execMode = getExecutionMode(ukDay, regime);

    // ── Kill switch check ──
    const killSwitchActive = killSwitch.disableAllSubmissions || killSwitch.disableAutomatedSubmissions;

    // ── Build context ──
    const ctx: DirectiveContext = {
      phase,
      regime,
      operatingMode,
      heartbeatStatus,
      heartbeatAgeHours,
      healthOverall,
      scanAgeHours,
      readyCandidateCount,
      triggerMetCount,
      stopsPending,
      laggardCount,
      pyramidCount,
      openPositionCount: openPositions.filter(p => p.stock.sleeve !== 'HEDGE').length,
      maxPositions: profile.maxPositions,
      openRiskPct,
      maxOpenRisk: profile.maxOpenRisk,
      riskBudgetUsedPct,
      killSwitchActive,
      autoTradingEnabled: autoEnabled,
      t212Connected,
      dataStale: marketDataStatus.isStale,
      canEnter: execMode.canEnter,
    };

    // ── Resolve decision ──
    const { decision, blockers } = resolveDecision(ctx);
    const { headline, explanation, action, urgency } = buildContent(decision, ctx, blockers);

    // ── Response ──
    return NextResponse.json({
      // Primary output: one decision, one headline, one action
      decision,
      headline,
      explanation,
      action,
      urgency,
      blockers,

      // Context (for advanced detail panel)
      context: {
        phase,
        regime,
        operatingMode,
        healthOverall,
        heartbeatStatus,
        heartbeatAgeHours: Math.round(heartbeatAgeHours * 10) / 10,
        scanAgeHours: Math.round(scanAgeHours * 10) / 10,
        openPositionCount: ctx.openPositionCount,
        maxPositions: ctx.maxPositions,
        openRiskPct: Math.round(openRiskPct * 10) / 10,
        maxOpenRisk: ctx.maxOpenRisk,
        riskBudgetUsedPct: Math.round(riskBudgetUsedPct),
        readyCandidateCount,
        triggerMetCount,
        aGradeCandidateCount: aGradeCount,
        bGradeCandidateCount: bGradeCount,
        stopsPending,
        laggardCount,
        pyramidCount,
        killSwitchActive,
        autoTradingEnabled: autoEnabled,
        t212Connected,
        dataStale: marketDataStatus.isStale,
        canEnter: execMode.canEnter,
      },
    });
  } catch (error) {
    console.error('[Today Directive] Error:', error);
    return apiError(500, 'DIRECTIVE_FAILED', 'Failed to compute today directive', (error as Error).message, true);
  }
}
