import { describe, expect, it } from 'vitest';

/**
 * Today-directive decision tree tests.
 *
 * Tests the pure decision logic extracted from the API route.
 * Each test creates a context and asserts the correct decision + blockers.
 */

// ── Types (mirror the API) ──────────────────────────────────

type Decision =
  | 'NO_ACTION'
  | 'MANAGE_EXISTING'
  | 'UPDATE_STOPS'
  | 'WATCH_CANDIDATES'
  | 'PREPARE_PLAN'
  | 'BUY_ALLOWED'
  | 'BUY_BLOCKED'
  | 'EXIT_REVIEW';

interface Blocker {
  code: string;
  label: string;
  severity: 'hard' | 'soft';
}

interface DirectiveContext {
  phase: string;
  regime: string;
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
  isOpportunistic: boolean;
}

// ── Decision tree (extracted from the API for pure testing) ──

function resolveDecision(ctx: DirectiveContext): { decision: Decision; blockers: Blocker[] } {
  const blockers: Blocker[] = [];

  if (ctx.heartbeatStatus === 'FAILED' || ctx.healthOverall === 'RED') {
    blockers.push({ code: 'SYSTEM_DOWN', label: 'System health is RED or nightly failed', severity: 'hard' });
  }
  if (ctx.heartbeatAgeHours > 18) {
    blockers.push({ code: 'DATA_STALE', label: `Nightly ran ${Math.round(ctx.heartbeatAgeHours)}h ago (>18h)`, severity: 'hard' });
  }
  if (ctx.dataStale) {
    blockers.push({ code: 'MARKET_DATA_STALE', label: 'Market data is stale', severity: 'soft' });
  }

  if (ctx.phase === 'PLANNING') return { decision: 'PREPARE_PLAN', blockers };
  if (ctx.phase === 'OBSERVATION') {
    if (ctx.stopsPending > 0) return { decision: 'UPDATE_STOPS', blockers };
    if (ctx.laggardCount > 0) return { decision: 'EXIT_REVIEW', blockers };
    if (ctx.openPositionCount > 0) return { decision: 'MANAGE_EXISTING', blockers };
    return { decision: 'NO_ACTION', blockers };
  }

  if (ctx.killSwitchActive) blockers.push({ code: 'KILL_SWITCH', label: 'Kill switch is active', severity: 'hard' });
  if (ctx.regime === 'BEARISH') blockers.push({ code: 'REGIME_BEARISH', label: 'Market regime is BEARISH', severity: 'hard' });
  if (ctx.regime === 'SIDEWAYS' && !ctx.isOpportunistic) blockers.push({ code: 'REGIME_SIDEWAYS', label: 'Market regime is SIDEWAYS', severity: 'hard' });
  if (ctx.openPositionCount >= ctx.maxPositions) blockers.push({ code: 'MAX_POSITIONS', label: `${ctx.openPositionCount}/${ctx.maxPositions} positions open`, severity: 'hard' });
  if (ctx.openRiskPct >= ctx.maxOpenRisk) blockers.push({ code: 'MAX_RISK', label: `Open risk at limit`, severity: 'hard' });
  if (!ctx.t212Connected) blockers.push({ code: 'T212_NOT_CONNECTED', label: 'Trading 212 not connected', severity: 'soft' });

  if (ctx.laggardCount > 0) return { decision: 'EXIT_REVIEW', blockers };

  if (ctx.stopsPending > 0) {
    const hasHardBlocker = blockers.some(b => b.severity === 'hard');
    if (hasHardBlocker) return { decision: 'UPDATE_STOPS', blockers };
  }

  const hasHardBlocker = blockers.some(b => b.severity === 'hard');
  if (ctx.readyCandidateCount > 0 || ctx.triggerMetCount > 0) {
    if (hasHardBlocker) return { decision: 'BUY_BLOCKED', blockers };
    if (!ctx.canEnter) return { decision: 'BUY_BLOCKED', blockers };
    return { decision: 'BUY_ALLOWED', blockers };
  }

  if (ctx.stopsPending > 0) return { decision: 'UPDATE_STOPS', blockers };
  if (ctx.pyramidCount > 0) return { decision: 'MANAGE_EXISTING', blockers };
  if (ctx.scanAgeHours > 12) return { decision: 'WATCH_CANDIDATES', blockers };
  if (ctx.openPositionCount > 0) return { decision: 'MANAGE_EXISTING', blockers };
  return { decision: 'NO_ACTION', blockers };
}

// ── Default healthy context (Tuesday, BULLISH, all clear) ──

function makeCtx(overrides: Partial<DirectiveContext> = {}): DirectiveContext {
  return {
    phase: 'EXECUTION',
    regime: 'BULLISH',
    heartbeatStatus: 'SUCCESS',
    heartbeatAgeHours: 2,
    healthOverall: 'GREEN',
    scanAgeHours: 3,
    readyCandidateCount: 2,
    triggerMetCount: 1,
    stopsPending: 0,
    laggardCount: 0,
    pyramidCount: 0,
    openPositionCount: 1,
    maxPositions: 4,
    openRiskPct: 2.5,
    maxOpenRisk: 10,
    riskBudgetUsedPct: 25,
    killSwitchActive: false,
    autoTradingEnabled: true,
    t212Connected: true,
    dataStale: false,
    canEnter: true,
    isOpportunistic: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('today-directive: decision tree', () => {
  // ── Phase-based decisions ──

  it('PLANNING phase → PREPARE_PLAN', () => {
    const { decision } = resolveDecision(makeCtx({ phase: 'PLANNING' }));
    expect(decision).toBe('PREPARE_PLAN');
  });

  it('OBSERVATION phase with no stops → NO_ACTION (if no positions)', () => {
    const { decision } = resolveDecision(makeCtx({ phase: 'OBSERVATION', openPositionCount: 0 }));
    expect(decision).toBe('NO_ACTION');
  });

  it('OBSERVATION phase with stops → UPDATE_STOPS', () => {
    const { decision } = resolveDecision(makeCtx({ phase: 'OBSERVATION', stopsPending: 2 }));
    expect(decision).toBe('UPDATE_STOPS');
  });

  it('OBSERVATION phase with laggards → EXIT_REVIEW', () => {
    const { decision } = resolveDecision(makeCtx({ phase: 'OBSERVATION', laggardCount: 1 }));
    expect(decision).toBe('EXIT_REVIEW');
  });

  it('OBSERVATION phase with positions but no stops → MANAGE_EXISTING', () => {
    const { decision } = resolveDecision(makeCtx({ phase: 'OBSERVATION', openPositionCount: 2 }));
    expect(decision).toBe('MANAGE_EXISTING');
  });

  // ── BUY_ALLOWED ──

  it('EXECUTION + BULLISH + candidates + no blockers → BUY_ALLOWED', () => {
    const { decision, blockers } = resolveDecision(makeCtx());
    expect(decision).toBe('BUY_ALLOWED');
    expect(blockers.filter(b => b.severity === 'hard')).toHaveLength(0);
  });

  it('BUY_ALLOWED includes trigger-met count', () => {
    const { decision } = resolveDecision(makeCtx({ readyCandidateCount: 0, triggerMetCount: 1 }));
    expect(decision).toBe('BUY_ALLOWED');
  });

  // ── BUY_BLOCKED ──

  it('BEARISH regime → BUY_BLOCKED with regime blocker', () => {
    const { decision, blockers } = resolveDecision(makeCtx({ regime: 'BEARISH' }));
    expect(decision).toBe('BUY_BLOCKED');
    expect(blockers.some(b => b.code === 'REGIME_BEARISH')).toBe(true);
  });

  it('kill switch active → BUY_BLOCKED', () => {
    const { decision, blockers } = resolveDecision(makeCtx({ killSwitchActive: true }));
    expect(decision).toBe('BUY_BLOCKED');
    expect(blockers.some(b => b.code === 'KILL_SWITCH')).toBe(true);
  });

  it('max positions reached → BUY_BLOCKED', () => {
    const { decision, blockers } = resolveDecision(makeCtx({ openPositionCount: 4, maxPositions: 4 }));
    expect(decision).toBe('BUY_BLOCKED');
    expect(blockers.some(b => b.code === 'MAX_POSITIONS')).toBe(true);
  });

  it('max risk reached → BUY_BLOCKED', () => {
    const { decision, blockers } = resolveDecision(makeCtx({ openRiskPct: 10, maxOpenRisk: 10 }));
    expect(decision).toBe('BUY_BLOCKED');
    expect(blockers.some(b => b.code === 'MAX_RISK')).toBe(true);
  });

  it('SIDEWAYS regime (not opportunistic) → BUY_BLOCKED', () => {
    const { decision, blockers } = resolveDecision(makeCtx({ regime: 'SIDEWAYS', isOpportunistic: false }));
    expect(decision).toBe('BUY_BLOCKED');
    expect(blockers.some(b => b.code === 'REGIME_SIDEWAYS')).toBe(true);
  });

  it('canEnter=false → BUY_BLOCKED even without hard blockers', () => {
    const { decision } = resolveDecision(makeCtx({ canEnter: false }));
    expect(decision).toBe('BUY_BLOCKED');
  });

  // ── EXIT_REVIEW ──

  it('laggards → EXIT_REVIEW (takes priority over buy)', () => {
    const { decision } = resolveDecision(makeCtx({ laggardCount: 1, readyCandidateCount: 3 }));
    expect(decision).toBe('EXIT_REVIEW');
  });

  // ── UPDATE_STOPS ──

  it('stops pending + no candidates → UPDATE_STOPS', () => {
    const { decision } = resolveDecision(makeCtx({ stopsPending: 3, readyCandidateCount: 0, triggerMetCount: 0 }));
    expect(decision).toBe('UPDATE_STOPS');
  });

  it('stops pending + candidates + regime BEARISH → UPDATE_STOPS (can\'t buy, but can update stops)', () => {
    const { decision } = resolveDecision(makeCtx({ stopsPending: 2, regime: 'BEARISH' }));
    expect(decision).toBe('UPDATE_STOPS');
  });

  // ── WATCH_CANDIDATES ──

  it('stale scan (>12h) + no candidates → WATCH_CANDIDATES', () => {
    const { decision } = resolveDecision(makeCtx({ scanAgeHours: 15, readyCandidateCount: 0, triggerMetCount: 0, openPositionCount: 0 }));
    expect(decision).toBe('WATCH_CANDIDATES');
  });

  // ── NO_ACTION ──

  it('no positions, no candidates, fresh scan → NO_ACTION', () => {
    const { decision } = resolveDecision(makeCtx({ openPositionCount: 0, readyCandidateCount: 0, triggerMetCount: 0, scanAgeHours: 2 }));
    expect(decision).toBe('NO_ACTION');
  });

  // ── MANAGE_EXISTING ──

  it('positions open, no candidates, no stops → MANAGE_EXISTING', () => {
    const { decision } = resolveDecision(makeCtx({ readyCandidateCount: 0, triggerMetCount: 0, openPositionCount: 2 }));
    expect(decision).toBe('MANAGE_EXISTING');
  });

  it('pyramid opportunities → MANAGE_EXISTING', () => {
    const { decision } = resolveDecision(makeCtx({ readyCandidateCount: 0, triggerMetCount: 0, pyramidCount: 1, openPositionCount: 1 }));
    expect(decision).toBe('MANAGE_EXISTING');
  });

  // ── Blocker accumulation ──

  it('multiple blockers accumulate', () => {
    const { blockers } = resolveDecision(makeCtx({
      regime: 'BEARISH',
      killSwitchActive: true,
      openPositionCount: 4,
      maxPositions: 4,
    }));
    const hardBlockers = blockers.filter(b => b.severity === 'hard');
    expect(hardBlockers.length).toBeGreaterThanOrEqual(3);
  });

  it('T212 not connected is soft blocker (does not block buy)', () => {
    const { decision, blockers } = resolveDecision(makeCtx({ t212Connected: false }));
    expect(decision).toBe('BUY_ALLOWED'); // soft blocker doesn't block
    expect(blockers.some(b => b.code === 'T212_NOT_CONNECTED' && b.severity === 'soft')).toBe(true);
  });

  it('system health RED creates hard blocker', () => {
    const { blockers } = resolveDecision(makeCtx({ healthOverall: 'RED' }));
    expect(blockers.some(b => b.code === 'SYSTEM_DOWN')).toBe(true);
  });

  it('heartbeat failed creates hard blocker', () => {
    const { blockers } = resolveDecision(makeCtx({ heartbeatStatus: 'FAILED' }));
    expect(blockers.some(b => b.code === 'SYSTEM_DOWN')).toBe(true);
  });

  it('stale heartbeat (>18h) creates hard blocker', () => {
    const { blockers } = resolveDecision(makeCtx({ heartbeatAgeHours: 20 }));
    expect(blockers.some(b => b.code === 'DATA_STALE')).toBe(true);
  });
});

describe('today-directive: decision coverage', () => {
  it('all 8 decisions are reachable', () => {
    const reachable = new Set<Decision>();

    reachable.add(resolveDecision(makeCtx({ phase: 'PLANNING' })).decision);
    reachable.add(resolveDecision(makeCtx({ phase: 'OBSERVATION', openPositionCount: 0 })).decision);
    reachable.add(resolveDecision(makeCtx({ phase: 'OBSERVATION', openPositionCount: 2 })).decision);
    reachable.add(resolveDecision(makeCtx({ phase: 'OBSERVATION', stopsPending: 1 })).decision);
    reachable.add(resolveDecision(makeCtx({ phase: 'OBSERVATION', laggardCount: 1 })).decision);
    reachable.add(resolveDecision(makeCtx()).decision);
    reachable.add(resolveDecision(makeCtx({ regime: 'BEARISH' })).decision);
    reachable.add(resolveDecision(makeCtx({ scanAgeHours: 15, readyCandidateCount: 0, triggerMetCount: 0, openPositionCount: 0 })).decision);
    reachable.add(resolveDecision(makeCtx({ readyCandidateCount: 0, triggerMetCount: 0, pyramidCount: 1 })).decision);

    expect(reachable.size).toBe(8);
    expect(reachable).toContain('NO_ACTION');
    expect(reachable).toContain('MANAGE_EXISTING');
    expect(reachable).toContain('UPDATE_STOPS');
    expect(reachable).toContain('WATCH_CANDIDATES');
    expect(reachable).toContain('PREPARE_PLAN');
    expect(reachable).toContain('BUY_ALLOWED');
    expect(reachable).toContain('BUY_BLOCKED');
    expect(reachable).toContain('EXIT_REVIEW');
  });
});
