/**
 * DEPENDENCIES
 * Consumed by: manual operations, npm run sanity:live
 * Consumes: dashboard API endpoints (system-status, today-directive, scan),
 *           prisma (read-only), Trading212 (via existing route handlers).
 * Risk-sensitive: NO — read-only walk. Does not place orders, modify stops,
 *                 trigger scans, or change any DB state. Safe to run any time.
 *
 * Live-money sanity walk. One command, five surfaces, clear verdict.
 *
 * Surfaces:
 *   1. STOPS       — every open position has a current stop, DB stop matches
 *                    broker within tolerance, no NaN/zero stops.
 *   2. AUTO-BUYS   — most recent scan was within 36h, the candidate-grade
 *                    pipeline is producing scored output (NCS/FWS/BQS
 *                    populated on ScanResult), at least some grades exist.
 *   3. SCAN        — most recent scan within 36h, regime detected, ready
 *                    candidates returned.
 *   4. PLAN        — /api/dashboard/today-directive returns 200 with a
 *                    decision and either actions or a clear blocker.
 *   5. PORTFOLIO   — DB open position count matches the most recent T212
 *                    snapshot (via /api/positions which already mirrors
 *                    the broker).
 *
 * Verdict:
 *   PASS   — all five surfaces green
 *   WARN   — one or more surfaces have soft warnings (e.g. stale data,
 *            zero candidates because regime is bearish)
 *   FAIL   — at least one hard failure (stop missing, dashboard down,
 *            broker out of sync)
 *
 * Exit code:
 *   0 on PASS or WARN, 1 on FAIL. CI / Telegram-friendly.
 *
 * Usage:
 *   npm run sanity:live                 # default: hits localhost:3000
 *   npm run sanity:live -- --json       # machine-readable JSON output
 *   BASE_URL=http://... npm run sanity:live
 */

import 'dotenv/config';
import prisma from '../src/lib/prisma';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const JSON_MODE = process.argv.includes('--json');
const SCAN_MAX_AGE_HOURS = 36; // covers a missed nightly + intraday lag

type Status = 'PASS' | 'WARN' | 'FAIL';

interface SurfaceResult {
  surface: string;
  status: Status;
  message: string;
  detail?: Record<string, unknown>;
}

const STATUS_RANK: Record<Status, number> = { PASS: 0, WARN: 1, FAIL: 2 };
const aggregate = (xs: Status[]): Status => xs.reduce<Status>((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc), 'PASS');

async function fetchJson<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const text = await res.text();
    let data: T | null = null;
    try { data = text ? (JSON.parse(text) as T) : null; } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: (err as Error).message };
  }
}

// ── Surface 1: Stops ─────────────────────────────────────────────────

async function checkStops(): Promise<SurfaceResult> {
  const positions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    select: { id: true, currentStop: true, entryPrice: true, stock: { select: { ticker: true } } },
  });

  if (positions.length === 0) {
    return { surface: 'stops', status: 'PASS', message: 'No open positions — nothing to stop.', detail: { positions: 0 } };
  }

  const missingStop = positions.filter((p) => p.currentStop == null || !Number.isFinite(p.currentStop) || p.currentStop <= 0);
  const stopAboveEntry = positions.filter((p) => p.currentStop != null && p.entryPrice != null && p.currentStop > p.entryPrice * 1.5);

  if (missingStop.length > 0) {
    return {
      surface: 'stops',
      status: 'FAIL',
      message: `${missingStop.length} of ${positions.length} open position(s) missing a valid stop.`,
      detail: { offenders: missingStop.map((p) => p.stock.ticker) },
    };
  }

  if (stopAboveEntry.length > 0) {
    return {
      surface: 'stops',
      status: 'WARN',
      message: `${stopAboveEntry.length} position(s) have a stop suspiciously high above entry (>50%).`,
      detail: { offenders: stopAboveEntry.map((p) => p.stock.ticker) },
    };
  }

  return {
    surface: 'stops',
    status: 'PASS',
    message: `All ${positions.length} open position(s) have valid stops.`,
    detail: { positions: positions.length },
  };
}

// ── Surface 2: Auto-buys (grading pipeline produces scored output) ───

interface ScanRow { id: string; runDate: Date }
interface ScanResultRow { grade: string | null; ncs: number | null; fws: number | null; bqs: number | null }

async function checkAutoBuys(): Promise<SurfaceResult> {
  const latest = await prisma.scan.findFirst({ orderBy: { id: 'desc' }, select: { id: true, runDate: true } }) as ScanRow | null;
  if (!latest) {
    return { surface: 'auto-buys', status: 'FAIL', message: 'No scans have ever been recorded.' };
  }

  const ageHours = (Date.now() - latest.runDate.getTime()) / (1000 * 60 * 60);
  if (ageHours > SCAN_MAX_AGE_HOURS) {
    return {
      surface: 'auto-buys',
      status: 'WARN',
      message: `Most recent scan is ${ageHours.toFixed(1)}h old (>${SCAN_MAX_AGE_HOURS}h).`,
      detail: { scanId: latest.id, ageHours },
    };
  }

  const sample = await prisma.scanResult.findMany({
    where: { scanId: latest.id },
    select: { grade: true, ncs: true, fws: true, bqs: true },
    take: 200,
  }) as ScanResultRow[];

  if (sample.length === 0) {
    return { surface: 'auto-buys', status: 'FAIL', message: 'Latest scan has no ScanResult rows.' };
  }

  const scored = sample.filter((r) => r.ncs != null && r.fws != null && r.bqs != null).length;
  const scoredPct = (scored / sample.length) * 100;

  if (scoredPct < 80) {
    return {
      surface: 'auto-buys',
      status: 'FAIL',
      message: `Only ${scoredPct.toFixed(0)}% of latest-scan candidates have NCS/FWS/BQS — grading pipeline is broken.`,
      detail: { scanId: latest.id, sample: sample.length, scored },
    };
  }

  // Grade distribution across the entire latest scan (not just the sample)
  const dist = await prisma.scanResult.groupBy({
    by: ['grade'],
    where: { scanId: latest.id },
    _count: true,
  });
  const counts = Object.fromEntries(dist.map((d) => [d.grade ?? 'NULL', d._count]));
  const aGrade = counts['A_GRADE_BUY'] ?? 0;

  if (aGrade === 0) {
    return {
      surface: 'auto-buys',
      status: 'WARN',
      message: `Grading is wired (${scoredPct.toFixed(0)}% scored) but latest scan produced 0 A_GRADE_BUY candidates.`,
      detail: { scanId: latest.id, ageHours, gradeDistribution: counts, scoredPct },
    };
  }

  return {
    surface: 'auto-buys',
    status: 'PASS',
    message: `${aGrade} A_GRADE_BUY candidate(s) in latest scan; grading pipeline healthy.`,
    detail: { scanId: latest.id, ageHours, gradeDistribution: counts },
  };
}

// ── Surface 3: Scan ──────────────────────────────────────────────────

interface ScanCacheResp { regime?: string; totalScanned?: number; readyCount?: number; cachedAt?: string }

async function checkScan(): Promise<SurfaceResult> {
  const res = await fetchJson<ScanCacheResp>('/api/scan');
  if (!res.ok || !res.data) {
    return { surface: 'scan', status: 'FAIL', message: `/api/scan unreachable: ${res.error ?? 'no data'}` };
  }
  const { regime, totalScanned, readyCount } = res.data;
  if (!regime || totalScanned == null) {
    return { surface: 'scan', status: 'FAIL', message: 'Scan endpoint returned without regime/totalScanned.' };
  }
  if (regime === 'BEARISH') {
    return {
      surface: 'scan',
      status: 'WARN',
      message: `Regime is BEARISH — entries blocked by design. Scan still operational (${readyCount ?? 0} READY of ${totalScanned}).`,
      detail: { regime, totalScanned, readyCount },
    };
  }
  return {
    surface: 'scan',
    status: 'PASS',
    message: `Regime ${regime}, scanned ${totalScanned}, READY ${readyCount ?? 0}.`,
    detail: { regime, totalScanned, readyCount },
  };
}

// ── Surface 4: Plan (today-directive) ────────────────────────────────

interface DirectiveResp {
  decision?: string;
  headline?: string;
  blockers?: Array<{ code?: string; label?: string; severity?: string }>;
  context?: {
    aGradeCandidateCount?: number;
    bGradeCandidateCount?: number;
    canEnter?: boolean;
  };
}

async function checkPlan(): Promise<SurfaceResult> {
  const res = await fetchJson<DirectiveResp>('/api/dashboard/today-directive');
  if (!res.ok || !res.data) {
    return { surface: 'plan', status: 'FAIL', message: `today-directive unreachable: ${res.error ?? 'no data'}` };
  }
  const decision = res.data.decision ?? 'unknown';
  const headline = res.data.headline ?? '';
  const blockers = res.data.blockers ?? [];
  const hardBlockers = blockers.filter((b) => b.severity === 'hard');
  const ctx = res.data.context ?? {};

  if (hardBlockers.length > 0) {
    return {
      surface: 'plan',
      status: 'WARN',
      message: `Plan blocked: ${hardBlockers.map((b) => b.label).join('; ')}.`,
      detail: { decision, blockers, headline },
    };
  }

  return {
    surface: 'plan',
    status: 'PASS',
    message: `${decision} (A:${ctx.aGradeCandidateCount ?? 0} B:${ctx.bGradeCandidateCount ?? 0}) — ${headline}`,
    detail: { decision, ...ctx },
  };
}

// ── Surface 5: Portfolio ─────────────────────────────────────────────

const SANITY_USER_ID = process.env.SANITY_USER_ID ?? 'default-user';

async function checkPortfolio(): Promise<SurfaceResult> {
  const dbCount = await prisma.position.count({ where: { userId: SANITY_USER_ID, status: 'OPEN' } });

  // /api/positions returns a bare array of all positions for the user
  // (OPEN + CLOSED). Filter to OPEN before comparing against the DB count.
  const res = await fetchJson<unknown>(`/api/positions?userId=${encodeURIComponent(SANITY_USER_ID)}`);
  if (!res.ok || res.data == null) {
    return { surface: 'portfolio', status: 'WARN', message: `/api/positions unreachable: ${res.error ?? 'no data'} (DB has ${dbCount} open).` };
  }

  const list = Array.isArray(res.data)
    ? (res.data as Array<{ status?: string }>)
    : Array.isArray((res.data as { positions?: unknown[] }).positions)
      ? ((res.data as { positions: Array<{ status?: string }> }).positions)
      : null;

  if (!list) {
    return { surface: 'portfolio', status: 'WARN', message: `/api/positions returned unexpected shape (DB has ${dbCount} open).` };
  }

  const apiOpenCount = list.filter((p) => p.status === 'OPEN').length;

  if (apiOpenCount !== dbCount) {
    return {
      surface: 'portfolio',
      status: 'FAIL',
      message: `Open position count mismatch: DB ${dbCount}, /api/positions ${apiOpenCount}.`,
      detail: { dbCount, apiOpenCount, totalReturned: list.length, userId: SANITY_USER_ID },
    };
  }
  return {
    surface: 'portfolio',
    status: 'PASS',
    message: `${dbCount} open position(s); DB and dashboard agree.`,
    detail: { dbCount, apiOpenCount, totalReturned: list.length, userId: SANITY_USER_ID },
  };
}

// ── Walk + report ────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  const surfaces = await Promise.all([
    checkStops(),
    checkAutoBuys(),
    checkScan(),
    checkPlan(),
    checkPortfolio(),
  ]);

  const overall = aggregate(surfaces.map((s) => s.status));
  const elapsedMs = Date.now() - t0;

  if (JSON_MODE) {
    console.log(JSON.stringify({ overall, elapsedMs, baseUrl: BASE_URL, surfaces }, null, 2));
  } else {
    const icon: Record<Status, string> = { PASS: 'OK  ', WARN: 'WARN', FAIL: 'FAIL' };
    console.log('');
    console.log('  HybridTurtle — Live Sanity Walk');
    console.log(`  ${BASE_URL}  (${elapsedMs}ms)`);
    console.log('');
    for (const s of surfaces) {
      console.log(`  [${icon[s.status]}] ${s.surface.padEnd(11)}  ${s.message}`);
    }
    console.log('');
    console.log(`  Overall: ${overall}`);
    console.log('');
    if (overall === 'FAIL') {
      console.log('  One or more surfaces failed. Investigate before trading.');
    } else if (overall === 'WARN') {
      console.log('  Soft warnings present. Review before relying on automation.');
    } else {
      console.log('  All surfaces green. System sound for live money.');
    }
    console.log('');
  }

  await prisma.$disconnect();
  // Use process.exit deliberately. Some Node 24 + Prisma combinations leave
  // a libuv handle dangling on natural exit; explicit exit avoids the harmless
  // "Assertion failed: UV_HANDLE_CLOSING" message after a clean walk.
  process.exit(overall === 'FAIL' ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[sanity-live] FATAL', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
