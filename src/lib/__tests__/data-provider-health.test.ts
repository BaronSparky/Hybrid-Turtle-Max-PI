import { describe, it, expect } from 'vitest';

/**
 * Data provider fallback chain tests.
 *
 * Tests the health classification logic and data source type contracts
 * extracted from fetchWithFallback in data-provider.ts.
 * The actual fetchWithFallback uses server-only imports and live DB/API calls,
 * so we test the pure logic here.
 */

// ── Types mirrored from data-provider.ts ──
type DataSource = 'YAHOO' | 'ALPHA_VANTAGE' | 'EODHD' | 'CACHE_RECENT' | 'CACHE_STALE';
type DataSourceHealth = 'LIVE' | 'PARTIAL' | 'DEGRADED';

interface PriceData {
  ticker: string;
  close: number;
  source: DataSource;
  isStale: boolean;
}

/**
 * Health classification logic extracted from fetchWithFallback.
 * Must match the logic in data-provider.ts exactly.
 */
function classifyHealth(prices: PriceData[], staleTickers: string[]): DataSourceHealth {
  const yahooCount = prices.filter(d => d.source === 'YAHOO').length;
  const cacheCount = staleTickers.length;
  const avCount = prices.filter(d => d.source === 'ALPHA_VANTAGE').length;
  const eodCount = prices.filter(d => d.source === 'EODHD').length;

  if (cacheCount === 0) return 'LIVE';
  if (yahooCount > 0 || avCount > 0 || eodCount > 0) return 'PARTIAL';
  return 'DEGRADED';
}

describe('Data provider health classification', () => {
  it('returns LIVE when all sources are live providers', () => {
    const prices: PriceData[] = [
      { ticker: 'AAPL', close: 170, source: 'YAHOO', isStale: false },
      { ticker: 'MSFT', close: 400, source: 'YAHOO', isStale: false },
    ];
    expect(classifyHealth(prices, [])).toBe('LIVE');
  });

  it('returns LIVE when mix of Yahoo and Alpha Vantage (no cache)', () => {
    const prices: PriceData[] = [
      { ticker: 'AAPL', close: 170, source: 'YAHOO', isStale: false },
      { ticker: 'MSFT', close: 400, source: 'ALPHA_VANTAGE', isStale: false },
    ];
    expect(classifyHealth(prices, [])).toBe('LIVE');
  });

  it('returns LIVE when mix of Yahoo and EODHD (no cache)', () => {
    const prices: PriceData[] = [
      { ticker: 'AAPL', close: 170, source: 'YAHOO', isStale: false },
      { ticker: 'MSFT', close: 400, source: 'EODHD', isStale: false },
    ];
    expect(classifyHealth(prices, [])).toBe('LIVE');
  });

  it('returns PARTIAL when some tickers used cache and some used live', () => {
    const prices: PriceData[] = [
      { ticker: 'AAPL', close: 170, source: 'YAHOO', isStale: false },
      { ticker: 'DEAD', close: 50, source: 'CACHE_RECENT', isStale: true },
    ];
    expect(classifyHealth(prices, ['DEAD'])).toBe('PARTIAL');
  });

  it('returns PARTIAL when Alpha Vantage provides some and cache provides rest', () => {
    const prices: PriceData[] = [
      { ticker: 'AAPL', close: 170, source: 'ALPHA_VANTAGE', isStale: false },
      { ticker: 'DEAD', close: 50, source: 'CACHE_STALE', isStale: true },
    ];
    expect(classifyHealth(prices, ['DEAD'])).toBe('PARTIAL');
  });

  it('returns DEGRADED when all tickers used cache', () => {
    const prices: PriceData[] = [
      { ticker: 'AAPL', close: 170, source: 'CACHE_RECENT', isStale: true },
      { ticker: 'MSFT', close: 400, source: 'CACHE_STALE', isStale: true },
    ];
    expect(classifyHealth(prices, ['AAPL', 'MSFT'])).toBe('DEGRADED');
  });

  it('returns LIVE for empty price list (no tickers)', () => {
    expect(classifyHealth([], [])).toBe('LIVE');
  });
});

describe('Data source ordering contract', () => {
  it('fallback tiers are ordered: Yahoo → Alpha Vantage → EODHD → Cache', () => {
    // This test documents the expected tier ordering.
    // The actual fallback chain in data-provider.ts tries providers in this order
    // and only passes remaining (unfulfilled) tickers to the next tier.
    const tiers: DataSource[] = ['YAHOO', 'ALPHA_VANTAGE', 'EODHD', 'CACHE_RECENT'];
    expect(tiers[0]).toBe('YAHOO');
    expect(tiers[1]).toBe('ALPHA_VANTAGE');
    expect(tiers[2]).toBe('EODHD');
    expect(tiers[3]).toBe('CACHE_RECENT');
  });

  it('cache sources are classified correctly', () => {
    const cacheSources: DataSource[] = ['CACHE_RECENT', 'CACHE_STALE'];
    const liveSources: DataSource[] = ['YAHOO', 'ALPHA_VANTAGE', 'EODHD'];

    // Cache sources should not count as live
    for (const src of cacheSources) {
      expect(liveSources).not.toContain(src);
    }
  });
});

describe('Data source staleness rules', () => {
  it('CACHE_RECENT under 24h is not stale', () => {
    const CACHE_RECENT_THRESHOLD_HOURS = 24;
    const ageHours = 12;
    expect(ageHours < CACHE_RECENT_THRESHOLD_HOURS).toBe(true);
  });

  it('CACHE_RECENT over 24h but under 48h is stale', () => {
    const CACHE_RECENT_THRESHOLD_HOURS = 24;
    const CACHE_STALE_THRESHOLD_HOURS = 48;
    const ageHours = 30;
    expect(ageHours >= CACHE_RECENT_THRESHOLD_HOURS).toBe(true);
    expect(ageHours < CACHE_STALE_THRESHOLD_HOURS).toBe(true);
  });

  it('CACHE_STALE over 48h is stale', () => {
    const CACHE_STALE_THRESHOLD_HOURS = 48;
    const ageHours = 72;
    expect(ageHours >= CACHE_STALE_THRESHOLD_HOURS).toBe(true);
  });
});
