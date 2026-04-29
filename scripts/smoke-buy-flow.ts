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
    if (!res.ok) {
      return { name, ok: false, detail: `HTTP ${res.status} ${res.statusText}` };
    }
    const json = (await res.json()) as unknown;
    const errorDetail = validate(json);
    if (errorDetail) {
      return { name, ok: false, detail: errorDetail };
    }
    return { name, ok: true, detail: 'OK' };
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
      const j = json as { phase?: string; canEnter?: boolean };
      if (!j.phase) return 'missing phase field';
      return null;
    })
  );

  results.push(
    await checkEndpoint('positions', '/api/positions', (json) => {
      if (!Array.isArray(json) && !(json as { positions?: unknown }).positions) {
        return 'positions response is not an array or {positions:[]}';
      }
      return null;
    })
  );

  results.push(
    await checkEndpoint('scan candidates', '/api/scan?dryRun=true', (json) => {
      const j = json as { error?: string };
      if (j.error && j.error !== 'SCANS_DISABLED_STALE_DATA') {
        return `scan error: ${j.error}`;
      }
      return null;
    })
  );

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
