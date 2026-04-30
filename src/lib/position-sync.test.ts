import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Trading212Error, type T212Position } from './trading212';
import { shouldFetchOrderHistoryForSync } from './position-sync';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getPositions: vi.fn(),
  sendAlert: vi.fn(),
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

describe('fetchT212LivePrices rate-limit handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 30, 10, 0, 0));

    mocks.constructedApiKeys.length = 0;
    mocks.findUnique.mockResolvedValue(connectedDualUser());
    mocks.sendAlert.mockResolvedValue(undefined);
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
