import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    position: { findMany: vi.fn() },
    tradeLog: { groupBy: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@/lib/market-data', () => ({
  getBatchPrices: vi.fn(async () => ({ AAA: 110 })),
  normalizeBatchPricesToGBP: vi.fn(async () => ({ AAA: 110 })),
  getMarketRegime: vi.fn(),
}));

vi.mock('@/lib/position-sync', () => ({
  getT212Prices: vi.fn(() => ({})),
}));

vi.mock('@/lib/live-prices', () => ({
  getLivePrices: vi.fn(async () => ({
    prices: { AAA: 110 },
    sources: { AAA: 'T212' },
    stats: { t212Count: 1, yahooCount: 0, totalRequested: 1 },
  })),
  getTickerFreshness: vi.fn(() => ({})),
}));

import { GET } from './route';

describe('/api/positions GET risk fields', () => {
  beforeEach(() => {
    prismaMock.position.findMany.mockReset();
    prismaMock.tradeLog.groupBy.mockReset();
  });

  it('returns initialRiskGBP and keeps riskGBP alias equal for compatibility', async () => {
    prismaMock.position.findMany.mockResolvedValue([
      {
        id: 'p1',
        status: 'OPEN',
        entryPrice: 100,
        currentStop: 95,
        stopLoss: 95,
        initialRisk: 5,
        shares: 10,
        exitPrice: null,
        stock: {
          ticker: 'AAA',
          currency: 'GBP',
        },
        stopHistory: [],
      },
    ]);
    prismaMock.tradeLog.groupBy.mockResolvedValue([]);

    const request = {
      nextUrl: new URL('http://localhost/api/positions?userId=u1&status=OPEN&source=all'),
    } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body[0].initialRiskGBP).toBe(50);
    expect(body[0].riskGBP).toBe(50);
    expect(body[0].initialRiskGBP).toBe(body[0].riskGBP);
  });

  // Regression: portfolio + plan pages dropped the &source=trading212 filter
  // because it hid auto-trade-originated positions (real T212 holdings with
  // valid t212Ticker) from the UI. The GET handler must therefore:
  //   (a) NOT inject a default source filter when the param is omitted, and
  //   (b) return positions regardless of source value when called that way.
  it('does not filter by source when the query param is omitted', async () => {
    prismaMock.position.findMany.mockResolvedValue([
      {
        id: 'p-broker',
        status: 'OPEN',
        source: 'trading212',
        entryPrice: 100, currentStop: 95, stopLoss: 95, initialRisk: 5,
        shares: 1, exitPrice: null,
        stock: { ticker: 'AAA', currency: 'GBP' },
        stopHistory: [],
      },
      {
        id: 'p-auto',
        status: 'OPEN',
        source: 'auto-trade',
        entryPrice: 100, currentStop: 95, stopLoss: 95, initialRisk: 5,
        shares: 1, exitPrice: null,
        stock: { ticker: 'AAA', currency: 'GBP' },
        stopHistory: [],
      },
    ]);
    prismaMock.tradeLog.groupBy.mockResolvedValue([]);

    const request = {
      nextUrl: new URL('http://localhost/api/positions?userId=u1&status=OPEN'),
    } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    // Both rows must come through — the page now relies on this to count all 6.
    expect(body).toHaveLength(2);
    expect(body.map((p: { id: string }) => p.id).sort()).toEqual(['p-auto', 'p-broker']);

    // And the prisma where clause must not silently constrain by source.
    const callArgs = prismaMock.position.findMany.mock.calls[0]?.[0] ?? {};
    expect(callArgs.where).toEqual({ userId: 'u1', status: 'OPEN' });
    expect(callArgs.where).not.toHaveProperty('source');
  });
});
