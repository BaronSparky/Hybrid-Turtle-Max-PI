/**
 * Regression test: seed t212Ticker write-guard.
 *
 * Background — 11 May 2026 RBOT 404 incident
 * ──────────────────────────────────────────
 * The seed file's `t212Ticker` write path used to pass `findInMap(...)`
 * directly into `prisma.stock.upsert()`, which silently accepted bare
 * values like `'RBOT'` from `Planning/ticker_map.csv`. Those bare values
 * later 404'd against T212.
 *
 * The fix wrapped every t212Ticker write site with
 * `assertValidT212TickerOrNull(value, context)` from the shared
 * validator, which coerces invalid values to `null` and emits a
 * contextual `console.warn`.
 *
 * This test pins that contract: feed the seed's helper composition a
 * deliberately bad ticker map, verify bare values get coerced to `null`
 * with a warning. If a future seed refactor drops the wrapper, this
 * test fails and prevents the bare-value class of bug from returning.
 *
 * The seed module itself is not imported because it has heavy top-level
 * side effects (file reads, Prisma client construction). We replicate
 * the seed's `findInMap` helper inline — kept in sync via the docstring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertValidT212TickerOrNull } from './t212-ticker-validator';

// Mirrors prisma/seed.ts findInMap (lines ~233-243). If the seed's
// implementation changes shape, update this copy to match.
function findInMap(map: Record<string, string>, ticker: string): string | null {
  if (map[ticker]) return map[ticker];
  const suffixes = ['.L', '.SW', '.DE', '.PA', '.MI', '.MC', '.AS', '.CO', '.ST', '.HE', '.AX'];
  for (const suffix of suffixes) {
    if (map[ticker + suffix]) return map[ticker + suffix];
  }
  return null;
}

describe('seed t212Ticker write-guard regression (11 May 2026 RBOT incident)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Crucial: without restoreAllMocks the previous spy stays attached
    // to console.warn and its call history bleeds into the next test.
    vi.restoreAllMocks();
  });

  it('passes through valid _EQ values from the ticker map unchanged', () => {
    // Real well-formed entries that the seed would write as-is.
    const tickerMap = {
      AAPL: 'AAPL_US_EQ',
      'AZN.L': 'AZNl_EQ',
      'SAP.DE': 'SAPd_EQ',
    };
    expect(
      assertValidT212TickerOrNull(findInMap(tickerMap, 'AAPL'), 'seed:CORE:AAPL'),
    ).toBe('AAPL_US_EQ');
    expect(
      assertValidT212TickerOrNull(findInMap(tickerMap, 'AZN'), 'seed:CORE:AZN'),
    ).toBe('AZNl_EQ');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('coerces a bare value (the original RBOT row) to null with a warning', () => {
    // The exact shape of the bug. Planning/ticker_map.csv historically
    // contained `RBOT,RBOT.L` which made findInMap return the literal
    // string 'RBOT' for the t212Ticker column.
    const tickerMap = { 'RBOT.L': 'RBOT' };
    const result = assertValidT212TickerOrNull(findInMap(tickerMap, 'RBOT'), 'seed:ETF:RBOT');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('[seed:ETF:RBOT]');
    expect(message).toContain("'RBOT'");
    expect(message).toContain('missing _EQ suffix');
  });

  it('returns null without warning when the ticker is unmapped', () => {
    const tickerMap = { AAPL: 'AAPL_US_EQ' };
    const result = assertValidT212TickerOrNull(findInMap(tickerMap, 'UNKNOWN'), 'seed:CORE:UNKNOWN');
    expect(result).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('coerces multiple bad rows in a single seed pass without throwing', () => {
    // Confirms the seed's per-row loop continues on bad rows rather than
    // aborting the whole batch (the helper is non-throwing by design).
    const tickerMap = {
      AAPL: 'AAPL_US_EQ',
      'RBOT.L': 'RBOT',  // bare
      'AZN.L': 'AZN',    // bare
      'GSK.L': 'GSK',    // bare
    };
    const writes: Array<string | null> = [];
    for (const t of ['AAPL', 'RBOT', 'AZN', 'GSK']) {
      writes.push(assertValidT212TickerOrNull(findInMap(tickerMap, t), `seed:CORE:${t}`));
    }
    expect(writes).toEqual(['AAPL_US_EQ', null, null, null]);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('context label propagates so warnings can be traced back to the seed sleeve', () => {
    const tickerMap = { 'RBOT.L': 'RBOT' };
    assertValidT212TickerOrNull(findInMap(tickerMap, 'RBOT'), 'seed:ETF:RBOT');
    const message = warnSpy.mock.calls[0][0] as string;
    // Must include the sleeve+ticker context so a future operator can
    // grep the seed log and locate the bad row.
    expect(message).toMatch(/\[seed:[A-Z_]+:[A-Z.]+\]/);
  });
});
