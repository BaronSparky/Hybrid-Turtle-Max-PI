import { describe, it, expect } from 'vitest';

/**
 * Alpha Vantage response parsing tests.
 *
 * These validate the parsing logic extracted from the AV integration
 * without requiring live API calls or complex mocking of the full
 * fetchWithFallback chain.
 */

interface AVGlobalQuote {
  'Global Quote': {
    '01. symbol': string;
    '02. open': string;
    '03. high': string;
    '04. low': string;
    '05. price': string;
    '06. volume': string;
    '07. latest trading day': string;
    '08. previous close': string;
    '09. change': string;
    '10. change percent': string;
  };
}

/** Extracted parsing logic matching data-provider.ts */
function parseAVQuote(json: unknown): { close: number; open: number; high: number; low: number; volume: number } | null {
  if (!json || typeof json !== 'object') return null;
  if ('Note' in (json as Record<string, unknown>) || 'Information' in (json as Record<string, unknown>)) return null;

  const gq = (json as AVGlobalQuote)['Global Quote'];
  if (!gq || !gq['05. price']) return null;

  const close = parseFloat(gq['05. price']);
  if (close <= 0 || isNaN(close)) return null;

  return {
    close,
    open: parseFloat(gq['02. open']) || close,
    high: parseFloat(gq['03. high']) || close,
    low: parseFloat(gq['04. low']) || close,
    volume: parseInt(gq['06. volume'], 10) || 0,
  };
}

describe('Alpha Vantage response parsing', () => {
  it('parses valid GLOBAL_QUOTE response', () => {
    const response = {
      'Global Quote': {
        '01. symbol': 'AAPL',
        '02. open': '170.00',
        '03. high': '175.50',
        '04. low': '169.80',
        '05. price': '173.25',
        '06. volume': '52341000',
        '07. latest trading day': '2026-04-28',
        '08. previous close': '171.00',
        '09. change': '2.25',
        '10. change percent': '1.3158%',
      },
    };

    const result = parseAVQuote(response);
    expect(result).not.toBeNull();
    expect(result!.close).toBe(173.25);
    expect(result!.open).toBe(170.0);
    expect(result!.high).toBe(175.5);
    expect(result!.low).toBe(169.8);
    expect(result!.volume).toBe(52341000);
  });

  it('returns null for rate-limit Note response', () => {
    const response = {
      Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.',
    };
    expect(parseAVQuote(response)).toBeNull();
  });

  it('returns null for Information error response', () => {
    const response = {
      Information: 'The **demo** API key is for demo purposes only.',
    };
    expect(parseAVQuote(response)).toBeNull();
  });

  it('returns null for empty Global Quote', () => {
    const response = { 'Global Quote': {} };
    expect(parseAVQuote(response)).toBeNull();
  });

  it('returns null for zero price', () => {
    const response = {
      'Global Quote': {
        '01. symbol': 'DEAD',
        '02. open': '0.00',
        '03. high': '0.00',
        '04. low': '0.00',
        '05. price': '0.00',
        '06. volume': '0',
        '07. latest trading day': '2026-01-01',
        '08. previous close': '0.00',
        '09. change': '0.00',
        '10. change percent': '0.00%',
      },
    };
    expect(parseAVQuote(response)).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseAVQuote(null)).toBeNull();
    expect(parseAVQuote(undefined)).toBeNull();
  });

  it('uses close as fallback for missing OHLC fields', () => {
    const response = {
      'Global Quote': {
        '01. symbol': 'TEST',
        '02. open': '',
        '03. high': '',
        '04. low': '',
        '05. price': '50.00',
        '06. volume': '',
        '07. latest trading day': '2026-04-28',
        '08. previous close': '49.00',
        '09. change': '1.00',
        '10. change percent': '2.04%',
      },
    };

    const result = parseAVQuote(response);
    expect(result).not.toBeNull();
    expect(result!.close).toBe(50.0);
    expect(result!.open).toBe(50.0); // falls back to close
    expect(result!.high).toBe(50.0);
    expect(result!.low).toBe(50.0);
    expect(result!.volume).toBe(0);
  });
});
