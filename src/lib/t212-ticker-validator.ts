/**
 * T212 instrument ticker validator.
 *
 * Trading 212 instrument tickers are structured strings ending in an
 * `_EQ` suffix (optionally preceded by a country code), e.g.:
 *
 *   AAPL_US_EQ       — US equity
 *   RBOTl_EQ         — LSE listing (lowercase-l = London suffix)
 *   DPLM_LSE_EQ      — explicit LSE form
 *   BESIa_EQ         — Amsterdam listing (lowercase-a)
 *
 * A bare alphabetic string like `RBOT`, `AZN`, or `GSK` is the BARE
 * form (the result of `stripT212Suffix`). T212's order endpoints reject
 * bare forms with HTTP 404 "entity not found" — see the 11 May 2026
 * incident where Stock.t212Ticker='RBOT' caused an auto-trade 404.
 *
 * Used by:
 *  - scripts/fix-invalid-t212-tickers.ts (audit + repair existing data)
 *  - src/cron/auto-trade.ts (candidate sieve before order placement)
 *
 * Pure module — no DB, no network, no `server-only` import.
 */

/**
 * Returns true when the string has the structure of a valid T212
 * instrument identifier (ends in `_EQ`, with at least one base char).
 *
 * This is a STRUCTURAL check only. It does not confirm the instrument
 * exists in T212's instruments universe — for that, `getInstruments()`
 * would need to be called against the live API. The structural check
 * is sufficient to catch the actual production failure mode (bare
 * unsuffixed values populated by seed scripts).
 */
export function looksLikeValidT212Ticker(t212Ticker: string | null | undefined): boolean {
  if (!t212Ticker) return false;
  // Must end in `_EQ`. Allow optional `_<COUNTRY>` segment before it.
  // Examples accepted: AAPL_US_EQ, RBOTl_EQ, DPLM_LSE_EQ, BESIa_EQ.
  // Examples rejected: RBOT, AZN, GSK, RBOT_L, RBOT_EQ_FOO.
  return /_EQ$/.test(t212Ticker) && t212Ticker.length > 3;
}

/** Inverse helper used by audit scripts and skip-reason messages. */
export function isInvalidT212TickerFormat(t212Ticker: string | null | undefined): boolean {
  if (t212Ticker == null || t212Ticker === '') return false; // null is "unmapped", not "invalid"
  return !looksLikeValidT212Ticker(t212Ticker);
}

/**
 * For a bare T212 ticker (the result of `stripT212Suffix`), return the
 * set of equivalent bare tickers that could collapse to the same
 * underlying instrument under HybridTurtle's ticker conventions.
 *
 * Currently handles the lowercase-`l` LSE listing variant only:
 * `RBOTl` ↔ `RBOT` are the same iShares ETF (LSE listing) and must
 * collapse to one Stock row when broker-sync encounters either form.
 *
 * The bare ticker itself is always included as the first entry.
 */
export function getCanonicalStockTickerCandidates(bareTicker: string): string[] {
  if (!bareTicker) return [];
  const out: string[] = [bareTicker];
  // Lowercase-l LSE suffix rule (mirrors src/lib/ticker-maps.ts:97).
  // RBOTl → also probe RBOT. Restricted to 2–5 uppercase chars + 'l'
  // to avoid spurious collapses on tickers like `Tesla` etc.
  const lowercaseLMatch = /^([A-Z]{2,5})l$/.exec(bareTicker);
  if (lowercaseLMatch) {
    out.push(lowercaseLMatch[1]);
  }
  return out;
}

/**
 * Write-side guard. Coerce any structurally-invalid `t212Ticker` value
 * to `null`, emitting a single `console.warn` line tagged with the
 * caller-supplied context so the source can be located in logs.
 *
 * Intent: stop the seed/import paths reintroducing bare values like
 * `'RBOT'` (the 11 May 2026 incident root cause). Callers that previously
 * passed `t212Ticker: someValue` to a Prisma write should now pass
 * `t212Ticker: assertValidT212TickerOrNull(someValue, 'seed')`.
 *
 * Intentionally non-throwing: the seed should keep going and just leave
 * the field unmapped, rather than abort and break a multi-thousand-row
 * batch. The `console.warn` makes the misconfiguration visible.
 */
export function assertValidT212TickerOrNull(
  value: string | null | undefined,
  context: string,
): string | null {
  if (value == null || value === '') return null;
  if (looksLikeValidT212Ticker(value)) return value;
  console.warn(
    `[t212-ticker-validator] [${context}] Rejecting invalid t212Ticker '${value}' ` +
      '(missing _EQ suffix). Coercing to null. ' +
      'See scripts/repair-t212-tickers-from-instruments.ts to map this stock.',
  );
  return null;
}

/**
 * Strip T212 instrument suffixes to get a bare ticker.
 *
 * Examples:
 *   AAPL_US_EQ  → AAPL
 *   AZN_LSE_EQ  → AZN
 *   RBOTl_EQ    → RBOTl
 *   BESIa_EQ    → BESIa
 *
 * Single source of truth for the suffix list. `src/lib/t212-history-importer.ts`
 * imports this function rather than duplicating it (the previous local
 * copy was removed on 11 May 2026 to prevent suffix-list drift).
 */
export function stripT212Suffix(t212Ticker: string): string {
  return t212Ticker
    .replace(/_US_EQ$/, '')
    .replace(/_UK_EQ$/, '')
    .replace(/_NL_EQ$/, '')
    .replace(/_DE_EQ$/, '')
    .replace(/_FR_EQ$/, '')
    .replace(/_CH_EQ$/, '')
    .replace(/_DK_EQ$/, '')
    .replace(/_SE_EQ$/, '')
    .replace(/_FI_EQ$/, '')
    .replace(/_IT_EQ$/, '')
    .replace(/_ES_EQ$/, '')
    .replace(/_LSE_EQ$/, '')
    .replace(/_EQ$/, '')
    .replace(/_ETF$/, '');
}
