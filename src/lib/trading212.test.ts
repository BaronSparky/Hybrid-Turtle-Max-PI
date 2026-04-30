import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  Trading212Client,
  Trading212Error,
  mapT212Position,
  mapT212AccountSummary,
} from './trading212';
import type { T212Position, T212AccountSummary } from './trading212';

// ── isStopTooFar ──

describe('Trading212Client.isStopTooFar', () => {
  it('returns tooFar=false when stop is within threshold', () => {
    const result = Trading212Client.isStopTooFar(95, 100, 50);
    expect(result.tooFar).toBe(false);
    expect(result.distancePct).toBeCloseTo(5);
  });

  it('returns tooFar=true when stop exceeds threshold', () => {
    const result = Trading212Client.isStopTooFar(40, 100, 50);
    expect(result.tooFar).toBe(true);
    expect(result.distancePct).toBeCloseTo(60);
  });

  it('returns tooFar=false for zero/negative prices', () => {
    expect(Trading212Client.isStopTooFar(0, 100).tooFar).toBe(false);
    expect(Trading212Client.isStopTooFar(100, 0).tooFar).toBe(false);
    expect(Trading212Client.isStopTooFar(-1, 100).tooFar).toBe(false);
  });

  it('uses default maxDistancePct of 50', () => {
    // 49% distance → within default 50% threshold
    const within = Trading212Client.isStopTooFar(51, 100);
    expect(within.tooFar).toBe(false);

    // 51% distance → exceeds default 50% threshold
    const beyond = Trading212Client.isStopTooFar(49, 100);
    expect(beyond.tooFar).toBe(true);
  });

  it('handles custom maxDistancePct', () => {
    // 10% distance, threshold 5% → too far
    const result = Trading212Client.isStopTooFar(90, 100, 5);
    expect(result.tooFar).toBe(true);
    expect(result.distancePct).toBeCloseTo(10);
  });
});

// ── Trading212Error ──

describe('Trading212Error', () => {
  it('extends Error with statusCode', () => {
    const err = new Trading212Error('Rate limited', 429, 1700000000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('Trading212Error');
    expect(err.message).toBe('Rate limited');
    expect(err.statusCode).toBe(429);
    expect(err.rateLimitReset).toBe(1700000000);
  });

  it('works without rateLimitReset', () => {
    const err = new Trading212Error('Forbidden', 403);
    expect(err.statusCode).toBe(403);
    expect(err.rateLimitReset).toBeUndefined();
  });
});

// ── getOrderHistory pagination ──

describe('Trading212Client.getOrderHistory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockHistoryResponse(nextPagePath: string | null, id: number) {
    return {
      ok: true,
      headers: { get: vi.fn(() => null) },
      json: vi.fn(async () => ({
        items: [{
          order: {
            id,
            ticker: 'VOD_UK_EQ',
            type: 'SELL',
            side: 'SELL',
            status: 'FILLED',
            quantity: -10,
            filledQuantity: 10,
            filledValue: 720,
            createdAt: '2026-04-30T09:59:00Z',
          },
          fill: {
            id,
            quantity: -10,
            price: 72,
            type: 'FILL',
            filledAt: '2026-04-30T10:00:00Z',
          },
        }],
        nextPagePath,
      })),
    } as unknown as Response;
  }

  it('continues through pages by default for full import callers', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockHistoryResponse('/api/v0/equity/history/orders?limit=50&cursor=next', 1))
      .mockResolvedValueOnce(mockHistoryResponse(null, 2));

    const client = new Trading212Client('key', 'secret', 'demo');
    const orders = await client.getOrderHistory(50);

    expect(orders.map((order) => order.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://demo.trading212.com/api/v0/equity/history/orders?limit=50&cursor=next', expect.any(Object));
  });

  it('stops after maxPages when callers only need recent history', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockHistoryResponse('/api/v0/equity/history/orders?limit=50&cursor=next', 1));

    const client = new Trading212Client('key', 'secret', 'demo');
    const orders = await client.getOrderHistory(50, { maxPages: 1 });

    expect(orders.map((order) => order.id)).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── mapT212Position ──

describe('mapT212Position', () => {
  const mockPosition: T212Position = {
    averagePricePaid: 150.25,
    createdAt: '2026-04-01T10:00:00Z',
    currentPrice: 165.50,
    instrument: {
      isin: 'US0378331005',
      currencyCode: 'USD',
      name: 'Apple Inc',
      ticker: 'AAPL_US_EQ',
    },
    quantity: 10,
    quantityAvailableForTrading: 10,
    quantityInPies: 0,
    walletImpact: {
      investedValue: 1502.50,
      result: 152.50,
      resultCoef: 0.1015,
      value: 1655.00,
      valueInAccountCurrency: 1320.00,
    },
  };

  it('strips _US_EQ suffix from ticker', () => {
    const mapped = mapT212Position(mockPosition);
    expect(mapped.ticker).toBe('AAPL');
    expect(mapped.fullTicker).toBe('AAPL_US_EQ');
  });

  it('strips _UK_EQ suffix', () => {
    const ukPos = { ...mockPosition, instrument: { ...mockPosition.instrument, ticker: 'GSK_UK_EQ' } };
    expect(mapT212Position(ukPos).ticker).toBe('GSK');
  });

  it('strips _EQ suffix', () => {
    const eqPos = { ...mockPosition, instrument: { ...mockPosition.instrument, ticker: 'DPLMl_EQ' } };
    expect(mapT212Position(eqPos).ticker).toBe('DPLMl');
  });

  it('strips _ETF suffix', () => {
    const etfPos = { ...mockPosition, instrument: { ...mockPosition.instrument, ticker: 'SPY_ETF' } };
    expect(mapT212Position(etfPos).ticker).toBe('SPY');
  });

  it('maps all required fields correctly', () => {
    const mapped = mapT212Position(mockPosition, 'isa');
    expect(mapped.name).toBe('Apple Inc');
    expect(mapped.isin).toBe('US0378331005');
    expect(mapped.currency).toBe('USD');
    expect(mapped.shares).toBe(10);
    expect(mapped.entryPrice).toBe(150.25);
    expect(mapped.currentPrice).toBe(165.50);
    expect(mapped.entryDate).toBe('2026-04-01T10:00:00Z');
    expect(mapped.profitLoss).toBe(152.50);
    expect(mapped.profitLossPercent).toBeCloseTo(10.15);
    expect(mapped.source).toBe('trading212');
    expect(mapped.accountType).toBe('isa');
  });

  it('defaults accountType to invest', () => {
    const mapped = mapT212Position(mockPosition);
    expect(mapped.accountType).toBe('invest');
  });

  it('handles missing walletImpact gracefully', () => {
    const posNoWallet = { ...mockPosition, walletImpact: {} as T212Position['walletImpact'] };
    const mapped = mapT212Position(posNoWallet);
    expect(mapped.investedValue).toBe(0);
    expect(mapped.profitLoss).toBe(0);
  });
});

// ── mapT212AccountSummary ──

describe('mapT212AccountSummary', () => {
  const mockSummary: T212AccountSummary = {
    cash: {
      availableToTrade: 5000,
      inPies: 200,
      reservedForOrders: 100,
    },
    currency: 'GBP',
    id: 12345,
    investments: {
      currentValue: 15000,
      realizedProfitLoss: 500,
      totalCost: 14000,
      unrealizedProfitLoss: 1000,
    },
    totalValue: 20300,
  };

  it('maps all account fields correctly', () => {
    const mapped = mapT212AccountSummary(mockSummary);
    expect(mapped.accountId).toBe(12345);
    expect(mapped.currency).toBe('GBP');
    expect(mapped.cash).toBe(5000);
    expect(mapped.cashInPies).toBe(200);
    expect(mapped.cashReservedForOrders).toBe(100);
    expect(mapped.totalCash).toBe(5300); // 5000 + 200 + 100
    expect(mapped.investmentsValue).toBe(15000);
    expect(mapped.investmentsCost).toBe(14000);
    expect(mapped.realizedPL).toBe(500);
    expect(mapped.unrealizedPL).toBe(1000);
    expect(mapped.totalValue).toBe(20300);
  });
});
