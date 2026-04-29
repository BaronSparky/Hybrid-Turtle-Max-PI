/**
 * scripts/smoke-buy-flow.ts
 *
 * Backend smoke test for the buy flow. Hits the live dashboard endpoints
 * and verifies they return sensible shapes — does NOT execute any orders.
 *
 * Use as a one-command proxy for "is the buy flow working end-to-end?"
 * when manual UI testing isn't practical.
 *
 * Usage: npx tsx scripts/smoke-buy-flow.ts
 *        BASE_URL=http://localhost:3000 npx tsx scripts/smoke-buy-flow.ts
 *
 * Exits non-zero on any check failure.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkEndpoint(name: string, path: string, validate: (json: unknown) => string | null): Promise<CheckResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    // Read body even on non-OK so validators can decide whether the error code is benign
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      // Allow validator to accept benign error codes (e.g. SCAN_CACHE_MISS)
      const errorDetail = validate(json ?? {});
      if (errorDetail === null) {
        return { name, ok: true, detail: `OK (HTTP ${res.status} acceptable)` };
      }
      return { name, ok: false, detail: `HTTP ${res.status} ${res.statusText}` };
    }
    const errorDetail = validate(json);
    if (errorDetail) {
      return { name, ok: false, detail: errorDetail };
    }
    return { name, ok: true, detail: 'OK' };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Optional: POST to /api/scan to verify the full scan pipeline (Yahoo,
 * ranking, persistence). Expensive — only run when SMOKE_TRIGGER_SCAN=1.
 * Uses default-user with a conservative profile and a small equity stub.
 */
async function checkScanTrigger(): Promise<CheckResult> {
  const name = 'scan trigger (POST)';
  try {
    const res = await fetch(`${BASE_URL}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'default-user',
        riskProfile: 'BALANCED',
        equity: 10000,
      }),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    // Benign cases: nightly running (503) or safety control (423) — system
    // is healthy, just not in a state where a manual scan is allowed.
    if (res.status === 503 || res.status === 423) {
      const j = json as { error?: { code?: string; message?: string } };
      return { name, ok: true, detail: `OK (HTTP ${res.status} ${j.error?.code ?? 'gated'})` };
    }
    if (!res.ok) {
      return { name, ok: false, detail: `HTTP ${res.status} ${res.statusText}` };
    }
    const j = json as { result?: unknown; candidates?: unknown[] };
    if (!j.result && !Array.isArray(j.candidates)) {
      return { name, ok: false, detail: 'scan response missing result/candidates' };
    }
    return { name, ok: true, detail: 'OK (scan completed)' };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  console.log(`[smoke-buy-flow] BASE_URL=${BASE_URL}`);
  console.log('');

  const results: CheckResult[] = [];

  results.push(
    await checkEndpoint('system-status', '/api/system-status', (json) => {
      const j = json as { readiness?: string };
      if (!j.readiness) return 'missing readiness field';
      if (j.readiness === 'BLOCKED') return `system BLOCKED (cannot trade)`;
      return null;
    })
  );

  results.push(
    await checkEndpoint('today-directive', '/api/dashboard/today-directive', (json) => {
      const j = json as { decision?: string; context?: { phase?: string } };
      const phase = j.context?.phase;
      if (!phase) return 'missing context.phase field';
      // Phase regression check: weekday should be EXECUTION, weekend should be PLANNING
      const day = new Date().getDay();
      const isWeekday = day >= 1 && day <= 5;
      const expected = isWeekday ? 'EXECUTION' : 'PLANNING';
      if (phase !== expected) {
        return `phase=${phase} but expected ${expected} for ${isWeekday ? 'weekday' : 'weekend'} (regression in getCurrentWeeklyPhase)`;
      }
      if (!j.decision) return 'missing decision field';
      return null;
    })
  );

  results.push(
    await checkEndpoint('positions', '/api/positions?userId=default-user', (json) => {
      if (!Array.isArray(json) && !(json as { positions?: unknown }).positions) {
        return 'positions response is not an array or {positions:[]}';
      }
      return null;
    })
  );

  results.push(
    await checkEndpoint('scan cache', '/api/scan', (json) => {
      // Cached scan returns { results: [...] } when fresh; benign 404 codes mean
      // no fresh cache exists yet — that's normal, not a regression.
      const j = json as { error?: { code?: string }; results?: unknown };
      const benignCodes = new Set(['SCAN_CACHE_MISS', 'SCAN_CACHE_STALE']);
      if (j.error?.code && benignCodes.has(j.error.code)) return null;
      if (j.results === undefined && !Array.isArray(json)) return 'scan response missing results';
      return null;
    })
  );

  // Optional: actually trigger a fresh scan to verify the full pipeline,
  // not just the cache read. Gated behind SMOKE_TRIGGER_SCAN=1 because
  // a real scan is expensive (Yahoo calls, ranking, persistence).
  if (process.env.SMOKE_TRIGGER_SCAN === '1') {
    results.push(await checkScanTrigger());
  }

  let failed = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${r.name.padEnd(20)} ${r.detail}`);
    if (!r.ok) failed += 1;
  }

  console.log('');
  if (failed > 0) {
    console.error(`[smoke-buy-flow] FAILED: ${failed}/${results.length} check(s) failed`);
    process.exit(1);
  } else {
    console.log(`[smoke-buy-flow] PASSED: all ${results.length} checks OK`);
  }
}

main().catch((err) => {
  console.error('[smoke-buy-flow] Unhandled error:', err);
  process.exit(2);
});
