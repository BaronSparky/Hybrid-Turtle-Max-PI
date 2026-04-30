import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  DualT212Client,
  validateDualCredentials,
  getCredentialsForAccount,
  type T212AccountCredentials,
  type DualAccountResult,
} from './trading212-dual';
import {
  Trading212Error,
  type T212Position,
  type T212AccountSummary,
} from './trading212';

// ── Mock Trading212Client ────────────────────────────────────

// We mock the Trading212Client class so no real HTTP calls are made.
// Each test configures the mock behaviour via getAccountSummary / getPositions.
vi.mock('./trading212', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trading212')>();

  class MockTrading212Client {
    constructor(
      public apiKey: string,
      public apiSecret: string,
      public environment: string
    ) {}

    // Default implementations — tests override via vi.spyOn
    async getAccountSummary(): Promise<T212AccountSummary> {
      return makeSummary();
    }

    async getPositions(): Promise<T212Position[]> {
      return [];
    }
  }

  return {
    ...actual,
    Trading212Client: MockTrading212Client,
  };
});

// ── Test Fixtures ────────────────────────────────────────────

function makeSummary(overrides: Partial<T212AccountSummary> = {}): T212AccountSummary {
  return {
    id: 12345,
    currency: 'GBP',
    cash: {
      availableToTrade: 100,
      inPies: 0,
      reservedForOrders: 0,
    },
    investments: {
      currentValue: 500,
      totalCost: 450,
      realizedProfitLoss: 10,
      unrealizedProfitLoss: 50,
    },
    totalValue: 600,
    ...overrides,
  };
}

function makePosition(ticker: string, overrides: Partial<T212Position> = {}): T212Position {
  return {
    averagePricePaid: 100,
    createdAt: '2026-01-15T10:00:00Z',
    currentPrice: 110,
    instrument: {
      isin: 'US0000000001',
      currencyCode: 'GBP',
      name: `${ticker} Corp`,
      ticker: `${ticker}_US_EQ`,
    },
    quantity: 10,
    quantityAvailableForTrading: 10,
    quantityInPies: 0,
    walletImpact: {
      investedValue: 1000,
      result: 100,
      resultCoef: 0.1,
      value: 1100,
      valueInAccountCurrency: 1100,
    },
    ...overrides,
  };
}

const INVEST_CREDS: T212AccountCredentials = {
  apiKey: 'invest-key',
  apiSecret: 'invest-secret',
  environment: 'live',
};

const ISA_CREDS: T212AccountCredentials = {
  apiKey: 'isa-key',
  apiSecret: 'isa-secret',
  environment: 'live',
};

// ── DualT212Client.fetchBothAccounts ─────────────────────────

describe('DualT212Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchBothAccounts', () => {
    it('returns data from both accounts when both succeed', async () => {
      const client = new DualT212Client(INVEST_CREDS, ISA_CREDS);

      const result = await client.fetchBothAccounts();

      // Both accounts should have data, no errors
      expect(result.invest).not.toBeNull();
      expect(result.isa).not.toBeNull();
      expect(result.errors.invest).toBeUndefined();
      expect(result.errors.isa).toBeUndefined();

      // Summary should be mapped
      expect(result.invest!.summary.accountId).toBe(12345);
      expect(result.isa!.summary.accountId).toBe(12345);
    });

    it('returns invest-only data when only invest credentials provided', async () => {
      const client = new DualT212Client(INVEST_CREDS, null);

      const result = await client.fetchBothAccounts();

      expect(result.invest).not.toBeNull();
      expect(result.invest!.summary.accountId).toBe(12345);
      expect(result.isa).toBeNull();
      // ISA should NOT have an error — it simply wasn't requested
      expect(result.errors.isa).toBeUndefined();
    });

    it('returns isa-only data when only ISA credentials provided', async () => {
      const client = new DualT212Client(null, ISA_CREDS);

      const result = await client.fetchBothAccounts();

      expect(result.isa).not.toBeNull();
      expect(result.isa!.summary.accountId).toBe(12345);
      expect(result.invest).toBeNull();
      expect(result.errors.invest).toBeUndefined();
    });

    it('returns errors for both when no credentials provided', async () => {
      const client = new DualT212Client(null, null);

      const result = await client.fetchBothAccounts();

      expect(result.invest).toBeNull();
      expect(result.isa).toBeNull();
      expect(result.errors.invest).toBe('No credentials provided');
      expect(result.errors.isa).toBe('No credentials provided');
    });
  });

  describe('getCombinedPositions', () => {
    it('tags positions with correct accountType and keeps overlapping tickers separate', () => {
      const client = new DualT212Client(INVEST_CREDS, ISA_CREDS);

      // Same ticker AAPL in both accounts — must remain as separate entries
      const result: DualAccountResult = {
        invest: {
          summary: { accountId: 1, currency: 'GBP', cash: 100, cashInPies: 0, cashReservedForOrders: 0, totalCash: 100, investmentsValue: 500, investmentsCost: 450, realizedPL: 10, unrealizedPL: 50, totalValue: 600 },
          positions: [makePosition('AAPL'), makePosition('MSFT')],
          positionsFetched: true,
        },
        isa: {
          summary: { accountId: 2, currency: 'GBP', cash: 200, cashInPies: 0, cashReservedForOrders: 0, totalCash: 200, investmentsValue: 300, investmentsCost: 280, realizedPL: 5, unrealizedPL: 20, totalValue: 500 },
          positions: [makePosition('AAPL'), makePosition('TSLA')],
          positionsFetched: true,
        },
        errors: {},
      };

      const combined = client.getCombinedPositions(result);

      // 4 positions total: AAPL(invest), MSFT(invest), AAPL(isa), TSLA(isa)
      expect(combined).toHaveLength(4);

      // Check invest positions tagged correctly
      const investPositions = combined.filter((p) => p.accountType === 'invest');
      expect(investPositions).toHaveLength(2);
      expect(investPositions.map((p) => p.ticker).sort()).toEqual(['AAPL', 'MSFT']);

      // Check ISA positions tagged correctly
      const isaPositions = combined.filter((p) => p.accountType === 'isa');
      expect(isaPositions).toHaveLength(2);
      expect(isaPositions.map((p) => p.ticker).sort()).toEqual(['AAPL', 'TSLA']);

      // Overlapping AAPL should appear twice with different account types
      const aaplPositions = combined.filter((p) => p.ticker === 'AAPL');
      expect(aaplPositions).toHaveLength(2);
      expect(aaplPositions.map((p) => p.accountType).sort()).toEqual(['invest', 'isa']);
    });

    it('returns empty array when both accounts have no positions', () => {
      const client = new DualT212Client(INVEST_CREDS, ISA_CREDS);

      const result: DualAccountResult = {
        invest: {
          summary: { accountId: 1, currency: 'GBP', cash: 100, cashInPies: 0, cashReservedForOrders: 0, totalCash: 100, investmentsValue: 0, investmentsCost: 0, realizedPL: 0, unrealizedPL: 0, totalValue: 100 },
          positions: [],
          positionsFetched: true,
        },
        isa: null,
        errors: {},
      };

      const combined = client.getCombinedPositions(result);
      expect(combined).toHaveLength(0);
    });

    it('sets accountType correctly on each mapped position', () => {
      const client = new DualT212Client(INVEST_CREDS, ISA_CREDS);

      const result: DualAccountResult = {
        invest: {
          summary: { accountId: 1, currency: 'GBP', cash: 0, cashInPies: 0, cashReservedForOrders: 0, totalCash: 0, investmentsValue: 0, investmentsCost: 0, realizedPL: 0, unrealizedPL: 0, totalValue: 0 },
          positions: [makePosition('NVDA')],
          positionsFetched: true,
        },
        isa: {
          summary: { accountId: 2, currency: 'GBP', cash: 0, cashInPies: 0, cashReservedForOrders: 0, totalCash: 0, investmentsValue: 0, investmentsCost: 0, realizedPL: 0, unrealizedPL: 0, totalValue: 0 },
          positions: [makePosition('AMD')],
          positionsFetched: true,
        },
        errors: {},
      };

      const combined = client.getCombinedPositions(result);

      const nvda = combined.find((p) => p.ticker === 'NVDA');
      const amd = combined.find((p) => p.ticker === 'AMD');

      expect(nvda?.accountType).toBe('invest');
      expect(amd?.accountType).toBe('isa');
      expect(nvda?.source).toBe('trading212');
      expect(amd?.source).toBe('trading212');
    });
  });
});

// ── validateDualCredentials ──────────────────────────────────

describe('validateDualCredentials', () => {
  it('returns both true when both accounts have full credentials', () => {
    const result = validateDualCredentials({
      t212ApiKey: 'key',
      t212ApiSecret: 'secret',
      t212Connected: true,
      t212IsaApiKey: 'isa-key',
      t212IsaApiSecret: 'isa-secret',
      t212IsaConnected: true,
    });

    expect(result.hasInvest).toBe(true);
    expect(result.hasIsa).toBe(true);
    expect(result.canFetch).toBe(true);
  });

  it('returns invest-only when ISA is not connected', () => {
    const result = validateDualCredentials({
      t212ApiKey: 'key',
      t212ApiSecret: 'secret',
      t212Connected: true,
      t212IsaApiKey: null,
      t212IsaApiSecret: null,
      t212IsaConnected: false,
    });

    expect(result.hasInvest).toBe(true);
    expect(result.hasIsa).toBe(false);
    expect(result.canFetch).toBe(true);
  });

  it('returns isa-only when Invest is not connected', () => {
    const result = validateDualCredentials({
      t212ApiKey: null,
      t212ApiSecret: null,
      t212Connected: false,
      t212IsaApiKey: 'isa-key',
      t212IsaApiSecret: 'isa-secret',
      t212IsaConnected: true,
    });

    expect(result.hasInvest).toBe(false);
    expect(result.hasIsa).toBe(true);
    expect(result.canFetch).toBe(true);
  });

  it('returns canFetch: false when neither account has credentials', () => {
    const result = validateDualCredentials({
      t212ApiKey: null,
      t212ApiSecret: null,
      t212Connected: false,
      t212IsaApiKey: null,
      t212IsaApiSecret: null,
      t212IsaConnected: false,
    });

    expect(result.hasInvest).toBe(false);
    expect(result.hasIsa).toBe(false);
    expect(result.canFetch).toBe(false);
  });

  it('requires connected flag — credentials alone are not enough', () => {
    const result = validateDualCredentials({
      t212ApiKey: 'key',
      t212ApiSecret: 'secret',
      t212Connected: false, // has creds but not connected
      t212IsaApiKey: 'isa-key',
      t212IsaApiSecret: 'isa-secret',
      t212IsaConnected: false,
    });

    expect(result.hasInvest).toBe(false);
    expect(result.hasIsa).toBe(false);
    expect(result.canFetch).toBe(false);
  });

  it('requires both key and secret — partial credentials fail', () => {
    const result = validateDualCredentials({
      t212ApiKey: null, // missing key — fails even with secret present
      t212ApiSecret: 'invest-secret',
      t212Connected: true,
      t212IsaApiKey: null, // missing key
      t212IsaApiSecret: 'isa-secret',
      t212IsaConnected: true,
    });

    expect(result.hasInvest).toBe(false);
    expect(result.hasIsa).toBe(false);
    expect(result.canFetch).toBe(false);
  });

  it('accepts key-only credentials (legacy single-token auth)', () => {
    // T212 may issue a single token (no separate secret). The Trading212Client
    // sends Authorization: <apiKey> per the legacy cURL example in the docs.
    const result = validateDualCredentials({
      t212ApiKey: 'just-a-token',
      t212ApiSecret: null, // intentionally absent — legacy auth
      t212Connected: true,
      t212IsaApiKey: 'isa-token',
      t212IsaApiSecret: null,
      t212IsaConnected: true,
    });

    expect(result.hasInvest).toBe(true);
    expect(result.hasIsa).toBe(true);
    expect(result.canFetch).toBe(true);
  });
});

// ── getCredentialsForAccount ─────────────────────────────────

describe('getCredentialsForAccount', () => {
  const fullUser = {
    t212ApiKey: 'invest-key',
    t212ApiSecret: 'invest-secret',
    t212Environment: 'live',
    t212Connected: true,
    t212IsaApiKey: 'isa-key',
    t212IsaApiSecret: 'isa-secret',
    t212IsaConnected: true,
  };

  it('returns invest credentials for accountType invest', () => {
    const creds = getCredentialsForAccount(fullUser, 'invest');

    expect(creds).not.toBeNull();
    expect(creds!.apiKey).toBe('invest-key');
    expect(creds!.apiSecret).toBe('invest-secret');
    expect(creds!.environment).toBe('live');
  });

  it('returns ISA credentials for accountType isa', () => {
    const creds = getCredentialsForAccount(fullUser, 'isa');

    expect(creds).not.toBeNull();
    expect(creds!.apiKey).toBe('isa-key');
    expect(creds!.apiSecret).toBe('isa-secret');
    expect(creds!.environment).toBe('live'); // ISA shares invest environment
  });

  it('returns null for invest when not connected', () => {
    const creds = getCredentialsForAccount(
      { ...fullUser, t212Connected: false },
      'invest'
    );

    expect(creds).toBeNull();
  });

  it('returns null for ISA when not connected', () => {
    const creds = getCredentialsForAccount(
      { ...fullUser, t212IsaConnected: false },
      'isa'
    );

    expect(creds).toBeNull();
  });

  it('defaults environment to live when not specified', () => {
    const creds = getCredentialsForAccount(
      { ...fullUser, t212Environment: undefined },
      'invest'
    );

    expect(creds).not.toBeNull();
    expect(creds!.environment).toBe('live');
  });
});

// ── getCredentialsForAccount — encryption integration ────────

describe('getCredentialsForAccount with encrypted keys', () => {
  const originalSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'test-secret-for-integration-tests!';
  });

  // Use a dynamic import so encryptField picks up the test secret
  async function encrypt(value: string): Promise<string> {
    const { encryptField } = await import('./crypto');
    return encryptField(value);
  }

  it('decrypts encrypted invest credentials', async () => {
    const encKey = await encrypt('my-invest-key');
    const encSecret = await encrypt('my-invest-secret');

    const creds = getCredentialsForAccount(
      { t212ApiKey: encKey, t212ApiSecret: encSecret, t212Environment: 'live', t212Connected: true },
      'invest'
    );

    expect(creds).not.toBeNull();
    expect(creds!.apiKey).toBe('my-invest-key');
    expect(creds!.apiSecret).toBe('my-invest-secret');
  });

  it('decrypts encrypted ISA credentials', async () => {
    const encKey = await encrypt('my-isa-key');
    const encSecret = await encrypt('my-isa-secret');

    const creds = getCredentialsForAccount(
      { t212IsaApiKey: encKey, t212IsaApiSecret: encSecret, t212Environment: 'demo', t212IsaConnected: true },
      'isa'
    );

    expect(creds).not.toBeNull();
    expect(creds!.apiKey).toBe('my-isa-key');
    expect(creds!.apiSecret).toBe('my-isa-secret');
  });

  it('passes through plaintext credentials (backward compat)', () => {
    const creds = getCredentialsForAccount(
      { t212ApiKey: 'plain', t212ApiSecret: 'text', t212Environment: 'live', t212Connected: true },
      'invest'
    );

    expect(creds!.apiKey).toBe('plain');
    expect(creds!.apiSecret).toBe('text');
  });

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = originalSecret;
  });
});
