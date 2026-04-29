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
});
