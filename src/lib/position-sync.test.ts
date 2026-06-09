import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Trading212Error, type T212Position } from './trading212';
import { shouldFetchOrderHistoryForSync } from './position-sync';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  positionFindMany: vi.fn(),
  positionUpdate: vi.fn(),
  tradeLogCreate: vi.fn(),
  tradeLogFindFirst: vi.fn(),
  transaction: vi.fn(),
  getPositions: vi.fn(),
  getAccountSummary: vi.fn(),
  getOrderHistory: vi.fn(),
  sendAlert: vi.fn(),
  logEVRecord: vi.fn(),
  persistCache: vi.fn(),
  rehydrateCache: vi.fn(),
  recordPriceSnapshots: vi.fn(),
  decryptField: vi.fn((value: string) => value),
  constructedApiKeys: [] as string[],
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: mocks.findUnique,
    },
    position: {
      findMany: mocks.positionFindMany,
      update: mocks.positionUpdate,
    },
    tradeLog: {
      create: mocks.tradeLogCreate,
      findFirst: mocks.tradeLogFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('./crypto', () => ({
  decryptField: mocks.decryptField,
}));

vi.mock('@/lib/alert-service', () => ({
  sendAlert: mocks.sendAlert,
}));

vi.mock('@/lib/cache-persistence', () => ({
  persistCache: mocks.persistCache,
  rehydrateCache: mocks.rehydrateCache,
}));

vi.mock('@/lib/price-snapshot', () => ({
  recordPriceSnapshots: mocks.recordPriceSnapshots,
}));

vi.mock('@/lib/ev-tracker', () => ({
  logEVRecord: mocks.logEVRecord,
}));

vi.mock('./trading212', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trading212')>();

  class MockTrading212Client {
    constructor(
      public apiKey: string,
      public apiSecret: string,
      public environment: string
    ) {
      mocks.constructedApiKeys.push(apiKey);
    }

    async getPositions(): Promise<T212Position[]> {
      return mocks.getPositions(this.apiKey);
    }

    async getAccountSummary() {
      return mocks.getAccountSummary(this.apiKey);
    }

    async getOrderHistory(limit = 50, options = {}) {
      return mocks.getOrderHistory(this.apiKey, limit, options);
    }
  }

  return {
    ...actual,
    Trading212Client: MockTrading212Client,
  };
});

function makePosition(ticker: string, currentPrice: number): T212Position {
  return {
    averagePricePaid: currentPrice - 5,
    createdAt: '2026-04-30T09:00:00Z',
    currentPrice,
    instrument: {
      isin: `ISIN-${ticker}`,
      currencyCode: 'GBP',
      name: `${ticker} plc`,
      ticker: `${ticker}_UK_EQ`,
    },
    quantity: 10,
    quantityAvailableForTrading: 10,
    quantityInPies: 0,
    walletImpact: {
      investedValue: 1000,
      result: 50,
      resultCoef: 0.05,
      value: 1050,
      valueInAccountCurrency: 1050,
    },
  };
}

function connectedDualUser() {
  return {
    t212ApiKey: 'invest-key',
    t212ApiSecret: 'invest-secret',
    t212Environment: 'live',
    t212Connected: true,
    t212IsaApiKey: 'isa-key',
    t212IsaApiSecret: 'isa-secret',
    t212IsaConnected: true,
  };
}

function connectedSameKeyUser() {
  return {
    ...connectedDualUser(),
    t212ApiKey: 'shared-key',
    t212IsaApiKey: 'shared-key',
  };
}

function makeAccountSummary() {
  return {
    cash: { availableToTrade: 5000, inPies: 0, reservedForOrders: 0 },
    currency: 'GBP',
    id: 123,
    investments: {
      currentValue: 1000,
      realizedProfitLoss: 0,
      totalCost: 950,
      unrealizedProfitLoss: 50,
    },
    totalValue: 6000,
  };
}

function makeDbPosition(ticker: string, t212Ticker = `${ticker}_UK_EQ`) {
  return {
    id: `position-${ticker}`,
    userId: 'default-user',
    stockId: `stock-${ticker}`,
    t212Ticker,
    entryPrice: 75,
    entryDate: new Date('2026-04-01T09:00:00Z'),
    shares: 10,
    currentStop: 68,
    initialRisk: 7,
    initial_R: 7,
    atr_at_entry: 2,
    accountType: 'invest',
    stock: {
      ticker,
      name: `${ticker} plc`,
      t212Ticker,
      currency: 'GBP',
      cluster: 'core',
      sleeve: 'stock',
    },
  };
}

function makeSellOrder(ticker: string) {
  return {
    id: 12345,
    ticker: `${ticker}_UK_EQ`,
    type: 'SELL',
    side: 'SELL' as const,
    status: 'FILLED',
    quantity: 10,
    filledQuantity: 10,
    filledValue: 720,
    dateCreated: '2026-04-30T09:59:00Z',
    dateExecuted: '2026-04-30T10:00:00Z',
    initiatedFrom: 'STOP_LOSS',
    fills: [{
      price: 72,
      quantity: 10,
      filledAt: '2026-04-30T10:00:00Z',
      walletImpact: { netValue: 720, realisedProfitLoss: -30, fxRate: 1 },
    }],
  };
}

describe('fetchT212LivePrices rate-limit handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 30, 10, 0, 0));

    mocks.constructedApiKeys.length = 0;
    mocks.findUnique.mockResolvedValue(connectedDualUser());
    mocks.positionFindMany.mockResolvedValue([]);
    mocks.positionUpdate.mockResolvedValue({});
    mocks.tradeLogCreate.mockResolvedValue({});
    mocks.tradeLogFindFirst.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback) => callback({
      position: { update: mocks.positionUpdate },
      tradeLog: { create: mocks.tradeLogCreate },
    }));
    mocks.getAccountSummary.mockResolvedValue(makeAccountSummary());
    mocks.getOrderHistory.mockResolvedValue([]);
    mocks.sendAlert.mockResolvedValue(undefined);
    mocks.logEVRecord.mockResolvedValue(undefined);
    mocks.persistCache.mockResolvedValue(undefined);
    mocks.rehydrateCache.mockResolvedValue(null);
    mocks.recordPriceSnapshots.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets Invest backoff after a 429 and still fetches ISA positions in the same pass', async () => {
    const resetEpochSeconds = Math.floor(Date.now() / 1000) + 600;
    mocks.getPositions.mockImplementation((apiKey: string) => {
      if (apiKey === 'invest-key') {
        throw new Trading212Error('Too many requests', 429, resetEpochSeconds);
      }
      return [makePosition('VOD', 72.4)];
    });

    const { fetchT212LivePrices, getT212ApiStats, updateT212PriceCache } = await import('./position-sync');

    updateT212PriceCache(new Map([['OLD', 99]]));
    vi.setSystemTime(new Date(2026, 3, 30, 10, 2, 0));

    const resultPromise = fetchT212LivePrices('default-user');
    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    expect(result).toEqual({ VOD: 72.4 });
    expect(mocks.getPositions).toHaveBeenCalledTimes(2);
    expect(mocks.constructedApiKeys).toEqual(['invest-key', 'isa-key']);
    expect(mocks.sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'T212 Rate Limited',
      data: { account: 'Invest', callsLastHour: 1 },
      notificationDedupeKey: 't212-rate-limit:Invest',
      telegramDedupeKey: 't212-rate-limit:Invest',
    }));
    expect(getT212ApiStats().callsLastHour).toBe(2);
  });

  it('serves stale cached prices during a later backoff without calling T212 again', async () => {
    const resetEpochSeconds = Math.floor(Date.now() / 1000) + 600;
    mocks.getPositions.mockImplementation((apiKey: string) => {
      if (apiKey === 'invest-key') {
        throw new Trading212Error('Too many requests', 429, resetEpochSeconds);
      }
      return [makePosition('VOD', 72.4)];
    });

    const { fetchT212LivePrices, updateT212PriceCache } = await import('./position-sync');

    updateT212PriceCache(new Map([['OLD', 99]]));
    vi.setSystemTime(new Date(2026, 3, 30, 10, 2, 0));

    const firstResultPromise = fetchT212LivePrices('default-user');
    await vi.advanceTimersByTimeAsync(1500);
    await firstResultPromise;
    expect(mocks.getPositions).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date(2026, 3, 30, 10, 4, 0));
    const secondResult = await fetchT212LivePrices('default-user');

    expect(secondResult).toEqual({ OLD: 99, VOD: 72.4 });
    expect(mocks.getPositions).toHaveBeenCalledTimes(2);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });

  it('skips ISA fetch when Invest and ISA share the same API key', async () => {
    mocks.findUnique.mockResolvedValue(connectedSameKeyUser());
    mocks.getPositions.mockResolvedValue([makePosition('VOD', 72.4)]);
    const { fetchT212LivePrices } = await import('./position-sync');

    const result = await fetchT212LivePrices('default-user');

    expect(result).toEqual({ VOD: 72.4 });
    expect(mocks.getPositions).toHaveBeenCalledTimes(1);
    expect(mocks.constructedApiKeys).toEqual(['shared-key']);
  });
});

describe('shouldFetchOrderHistoryForSync', () => {
  it('skips order history for routine midday sync when tracked positions are still open and untracked sales are disabled', () => {
    expect(shouldFetchOrderHistoryForSync({
      hasMissingTrackedPosition: false,
      detectUntrackedSales: false,
    })).toBe(false);
  });

  it('fetches order history when a tracked position is missing from T212', () => {
    expect(shouldFetchOrderHistoryForSync({
      hasMissingTrackedPosition: true,
      detectUntrackedSales: false,
    })).toBe(true);
  });

  it('fetches order history for full syncs that detect untracked sales', () => {
    expect(shouldFetchOrderHistoryForSync({
      hasMissingTrackedPosition: false,
      detectUntrackedSales: true,
    })).toBe(true);
  });
});

describe('syncClosedPositions order-history usage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 30, 10, 0, 0));

    mocks.constructedApiKeys.length = 0;
    mocks.findUnique.mockResolvedValue({
      ...connectedDualUser(),
      t212IsaConnected: false,
      t212IsaApiKey: null,
      t212IsaApiSecret: null,
    });
    mocks.positionUpdate.mockResolvedValue({});
    mocks.tradeLogCreate.mockResolvedValue({});
    mocks.tradeLogFindFirst.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback) => callback({
      position: { update: mocks.positionUpdate },
      tradeLog: { create: mocks.tradeLogCreate },
    }));
    mocks.getAccountSummary.mockResolvedValue(makeAccountSummary());
    mocks.getOrderHistory.mockResolvedValue([]);
    mocks.sendAlert.mockResolvedValue(undefined);
    mocks.logEVRecord.mockResolvedValue(undefined);
    mocks.persistCache.mockResolvedValue(undefined);
    mocks.rehydrateCache.mockResolvedValue(null);
    mocks.recordPriceSnapshots.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch order history when every tracked position is still open and untracked sale detection is disabled', async () => {
    mocks.positionFindMany.mockResolvedValue([makeDbPosition('VOD')]);
    mocks.getPositions.mockResolvedValue([makePosition('VOD', 72.4)]);

    const { syncClosedPositions } = await import('./position-sync');
    const result = await syncClosedPositions('default-user', { detectUntrackedSales: false });

    expect(result).toMatchObject({ checked: 1, closed: 0, skipped: 0, updated: 1, errors: [] });
    expect(mocks.getOrderHistory).not.toHaveBeenCalled();
    expect(mocks.positionUpdate).not.toHaveBeenCalled();
  });

  it('fetches one history page and closes when a tracked position is missing from T212', async () => {
    mocks.positionFindMany.mockResolvedValue([makeDbPosition('VOD')]);
    mocks.getPositions.mockResolvedValue([makePosition('SHEL', 2500)]);
    mocks.getOrderHistory.mockResolvedValue([makeSellOrder('VOD')]);

    const { syncClosedPositions } = await import('./position-sync');
    const result = await syncClosedPositions('default-user', { detectUntrackedSales: false });

    expect(result).toMatchObject({ checked: 1, closed: 1, skipped: 0, updated: 0, errors: [] });
    expect(mocks.getOrderHistory).toHaveBeenCalledWith('invest-key', 50, { maxPages: 1 });
    expect(mocks.positionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'position-VOD' },
      data: expect.objectContaining({
        status: 'CLOSED',
        exitPrice: 72,
        closedBy: 'AUTO_SYNC',
      }),
    }));
  });

  it('self-heals a fully-sold (flat) account: closes the stale tracked position when T212 returns 0 positions and the summary is flat', async () => {
    mocks.positionFindMany.mockResolvedValue([makeDbPosition('HON')]);
    mocks.getPositions.mockResolvedValue([]); // T212 Invest fully flat
    mocks.getAccountSummary.mockResolvedValue({
      ...makeAccountSummary(),
      investments: { currentValue: 0, realizedProfitLoss: 0, totalCost: 0, unrealizedProfitLoss: 0 },
    });
    mocks.getOrderHistory.mockResolvedValue([makeSellOrder('HON')]);

    const { syncClosedPositions } = await import('./position-sync');
    const result = await syncClosedPositions('default-user', { detectUntrackedSales: false });

    expect(result).toMatchObject({ checked: 1, closed: 1, skipped: 0, errors: [] });
    expect(mocks.positionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'position-HON' },
      data: expect.objectContaining({ status: 'CLOSED', closedBy: 'AUTO_SYNC' }),
    }));
    // Reconciliation alert fired so the divergence is reported
    expect(mocks.sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Auto-reconciled'),
    }));
  });

  it('does NOT close when T212 returns 0 positions but the account summary still shows invested value (suspected partial outage)', async () => {
    mocks.positionFindMany.mockResolvedValue([makeDbPosition('HON')]);
    mocks.getPositions.mockResolvedValue([]); // positions endpoint empty
    mocks.getAccountSummary.mockResolvedValue(makeAccountSummary()); // currentValue: 1000

    const { syncClosedPositions } = await import('./position-sync');
    const result = await syncClosedPositions('default-user', { detectUntrackedSales: false });

    expect(result.closed).toBe(0);
    expect(mocks.positionUpdate).not.toHaveBeenCalled();
    expect(result.errors.some(e => e.includes('suspected partial outage'))).toBe(true);
  });
});

