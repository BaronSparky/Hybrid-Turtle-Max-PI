import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  assertValidT212TickerOrNull,
  getCanonicalStockTickerCandidates,
  isInvalidT212TickerFormat,
  looksLikeValidT212Ticker,
  stripT212Suffix,
} from './t212-ticker-validator';

describe('looksLikeValidT212Ticker', () => {
  it('accepts canonical US form', () => {
    expect(looksLikeValidT212Ticker('AAPL_US_EQ')).toBe(true);
    expect(looksLikeValidT212Ticker('GOOGL_US_EQ')).toBe(true);
  });

  it('accepts LSE lowercase-l form', () => {
    expect(looksLikeValidT212Ticker('RBOTl_EQ')).toBe(true);
    expect(looksLikeValidT212Ticker('LLOYl_EQ')).toBe(true);
  });

  it('accepts explicit country forms', () => {
    expect(looksLikeValidT212Ticker('DPLM_LSE_EQ')).toBe(true);
    expect(looksLikeValidT212Ticker('SAP_DE_EQ')).toBe(true);
  });

  it('rejects bare tickers (the RBOT bug)', () => {
    expect(looksLikeValidT212Ticker('RBOT')).toBe(false);
    expect(looksLikeValidT212Ticker('AZN')).toBe(false);
    expect(looksLikeValidT212Ticker('GSK')).toBe(false);
  });

  it('rejects null, undefined, empty', () => {
    expect(looksLikeValidT212Ticker(null)).toBe(false);
    expect(looksLikeValidT212Ticker(undefined)).toBe(false);
    expect(looksLikeValidT212Ticker('')).toBe(false);
  });

  it('rejects partial or wrong suffixes', () => {
    expect(looksLikeValidT212Ticker('RBOT_L')).toBe(false);
    expect(looksLikeValidT212Ticker('RBOT.L')).toBe(false);
    expect(looksLikeValidT212Ticker('_EQ')).toBe(false); // empty base
  });
});

describe('isInvalidT212TickerFormat', () => {
  it('returns false for null (null is "unmapped", not "invalid")', () => {
    expect(isInvalidT212TickerFormat(null)).toBe(false);
    expect(isInvalidT212TickerFormat(undefined)).toBe(false);
    expect(isInvalidT212TickerFormat('')).toBe(false);
  });

  it('returns true for bare strings (the RBOT bug)', () => {
    expect(isInvalidT212TickerFormat('RBOT')).toBe(true);
    expect(isInvalidT212TickerFormat('AZN')).toBe(true);
  });

  it('returns false for valid forms', () => {
    expect(isInvalidT212TickerFormat('AAPL_US_EQ')).toBe(false);
    expect(isInvalidT212TickerFormat('RBOTl_EQ')).toBe(false);
  });
});

describe('getCanonicalStockTickerCandidates', () => {
  it('returns just the bare ticker for plain US-style tickers', () => {
    expect(getCanonicalStockTickerCandidates('AAPL')).toEqual(['AAPL']);
    expect(getCanonicalStockTickerCandidates('GOOGL')).toEqual(['GOOGL']);
  });

  it('expands lowercase-l LSE variant to also include the base form', () => {
    // The actual production case: broker-sync arrives as RBOTl, but the
    // canonical scanner-side row is RBOT. Both must collapse together.
    expect(getCanonicalStockTickerCandidates('RBOTl')).toEqual(['RBOTl', 'RBOT']);
    expect(getCanonicalStockTickerCandidates('LLOYl')).toEqual(['LLOYl', 'LLOY']);
    expect(getCanonicalStockTickerCandidates('BATSl')).toEqual(['BATSl', 'BATS']);
  });

  it('does not expand bare tickers without lowercase-l suffix', () => {
    expect(getCanonicalStockTickerCandidates('RBOT')).toEqual(['RBOT']);
    // Non-matching shapes
    expect(getCanonicalStockTickerCandidates('SUPERLONG')).toEqual(['SUPERLONG']);
    expect(getCanonicalStockTickerCandidates('Al')).toEqual(['Al']); // single-char prefix, not expanded
  });

  it('returns empty array for falsy input', () => {
    expect(getCanonicalStockTickerCandidates('')).toEqual([]);
  });
});

describe('assertValidT212TickerOrNull', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('passes through valid values unchanged and does NOT warn', () => {
    expect(assertValidT212TickerOrNull('AAPL_US_EQ', 'seed')).toBe('AAPL_US_EQ');
    expect(assertValidT212TickerOrNull('RBOTl_EQ', 'seed')).toBe('RBOTl_EQ');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null for null/undefined/empty without warning', () => {
    expect(assertValidT212TickerOrNull(null, 'seed')).toBeNull();
    expect(assertValidT212TickerOrNull(undefined, 'seed')).toBeNull();
    expect(assertValidT212TickerOrNull('', 'seed')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('coerces bare invalid values to null AND warns with context', () => {
    const result = assertValidT212TickerOrNull('RBOT', 'seed');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('[seed]');
    expect(message).toContain("'RBOT'");
    expect(message).toContain('missing _EQ suffix');
  });

  it('does NOT throw — seed loops should keep going on bad rows', () => {
    expect(() => assertValidT212TickerOrNull('AZN', 'seed')).not.toThrow();
    expect(() => assertValidT212TickerOrNull('GSK', 'sync')).not.toThrow();
  });
});

describe('stripT212Suffix', () => {
  it('strips US suffix', () => {
    expect(stripT212Suffix('AAPL_US_EQ')).toBe('AAPL');
    expect(stripT212Suffix('GOOGL_US_EQ')).toBe('GOOGL');
  });

  it('strips LSE/UK suffixes', () => {
    expect(stripT212Suffix('AZN_LSE_EQ')).toBe('AZN');
    expect(stripT212Suffix('GSK_UK_EQ')).toBe('GSK');
  });

  it('strips bare _EQ for the lowercase-l LSE form', () => {
    expect(stripT212Suffix('RBOTl_EQ')).toBe('RBOTl');
    expect(stripT212Suffix('LLOYl_EQ')).toBe('LLOYl');
  });

  it('strips European exchange suffixes', () => {
    expect(stripT212Suffix('SAP_DE_EQ')).toBe('SAP');
    expect(stripT212Suffix('MC_FR_EQ')).toBe('MC');
    expect(stripT212Suffix('NESTE_FI_EQ')).toBe('NESTE');
  });

  it('returns the input unchanged when no suffix matches', () => {
    expect(stripT212Suffix('AAPL')).toBe('AAPL');
  });
});
