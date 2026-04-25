/**
 * DEPENDENCIES
 * Consumed by: vitest
 * Consumes: route.ts (POST /api/positions/execute)
 * Risk-sensitive: YES — tests execution safety assertions
 * Last modified: 2026-02-28
 * Notes: Mocks Trading212Client, Prisma, and fetch to test all 4 phases
 *        plus safety assertions and failure modes. No real API calls.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Hoisted Mocks ────────────────────────────────────────────

const { prismaMock, mockClient, mockEnsureDefaultUser, mockAssertSubmissionAllowed, MockSafetyControlError } = vi.hoisted(() => {
  const mockClient = {
    placeMarketOrder: vi.fn(),
    getOrder: vi.fn(),
    placeStopOrder: vi.fn(),
    getPositions: vi.fn(),
  };

  class MockSafetyControlError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = 'SafetyControlError';
    }
  }

  return {
    prismaMock: {
      executionLog: { create: vi.fn() },
      stock: { findUnique: vi.fn() },
      user: { findUnique: vi.fn() },
    },
    mockClient,
    mockEnsureDefaultUser: vi.fn().mockResolvedValue('default-user'),
    mockAssertSubmissionAllowed: vi.fn().mockResolvedValue(undefined),
    MockSafetyControlError,
  };
});

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@/lib/default-user', () => ({
  ensureDefaultUser: mockEnsureDefaultUser,
  DEFAULT_USER_ID: 'default-user',
}));

vi.mock('../../../../../packages/workflow/src', () => ({
  assertSubmissionAllowed: mockAssertSubmissionAllowed,
  SafetyControlError: MockSafetyControlError,
}));

// Mock the Trading212Client constructor to return our mock client
vi.mock('@/lib/trading212', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trading212')>();

  class MockTrading212Client {
    constructor(
      public apiKey: string,
      public apiSecret: string,
      public environment: string
    ) {
      // Return the shared mock object so callers can spy on methods
      return mockClient as unknown as MockTrading212Client;
    }
  }

  return {
    ...actual,
    Trading212Client: MockTrading212Client,
  };
});

import { POST } from './route';

// ── Test Fixtures ────────────────────────────────────────────

function makeRequest(overrides: Record<string, unknown> = {}): NextRequest {
  const body = {
    userId: 'default-user',
    stockId: 'stock-abc-123',
    ticker: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    quantity: 10,
    stopPrice: 175.00,
    entryPrice: 185.00,
    accountType: 'invest',
    ...overrides,
  };

  return {
    json: vi.fn().mockResolvedValue(body),
    url: 'http://localhost:3000/api/positions/execute',
  } as unknown as NextRequest;
}

function makePendingOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 12345,
    createdAt: '2026-02-28T10:00:00Z',
    currency: 'USD',
    extendedHours: false,
    filledQuantity: 10,
    filledValue: 1850,
    initiatedFrom: 'API',
    instrument: {
      currency: 'USD',
      isin: 'US0378331005',
      name: 'Apple Inc.',
      ticker: 'AAPL_US_EQ',
    },
    limitPrice: null,
    quantity: 10,
    side: 'BUY',
    status: 'FILLED',
    stopPrice: null,
    strategy: 'QUANTITY',
    ticker: 'AAPL_US_EQ',
    timeInForce: 'DAY',
    type: 'MARKET',
    value: 1850,
    ...overrides,
  };
}

function makeStopOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 67890,
    createdAt: '2026-02-28T10:01:00Z',
    currency: 'USD',
    extendedHours: false,
    filledQuantity: 0,
    filledValue: 0,
    initiatedFrom: 'API',
    instrument: {
      currency: 'USD',
      isin: 'US0378331005',
      name: 'Apple Inc.',
      ticker: 'AAPL_US_EQ',
    },
    quantity: -10,
    side: 'SELL',
    status: 'NEW',
    stopPrice: 175.00,
    strategy: 'QUANTITY',
    ticker: 'AAPL_US_EQ',
    timeInForce: 'GOOD_TILL_CANCEL',
    type: 'STOP',
    value: 0,
    ...overrides,
  };
}

function setupUserMock() {
  prismaMock.user.findUnique.mockResolvedValue({
    t212ApiKey: 'test-key',
    t212ApiSecret: 'test-secret',
    t212Environment: 'demo',
    t212Connected: true,
    t212IsaApiKey: 'test-isa-key',
    t212IsaApiSecret: 'test-isa-secret',
    t212IsaConnected: true,
  });
}

function setupStockMock(t212Ticker = 'AAPL_US_EQ', isaEligible: boolean | null = null) {
  prismaMock.stock.findUnique.mockResolvedValue({
    t212Ticker,
    isaEligible,
    ticker: 'AAPL',
  });
}

/**
 * Helper: Read & parse entire SSE response into structured events.
 * MUST be called to drain the stream fully before checking mock calls.
 */
async function parseSSEResponse(response: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await response.text();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const lines = text.split('\n');
  let currentEvent = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ') && currentEvent) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) });
      } catch {
        // Skip malformed JSON
      }
      currentEvent = '';
    }
  }

  return events;
}

/** Sets up mocks for full Phase A→B→C→D execution */
function setupFullExecution() {
  mockClient.placeMarketOrder.mockResolvedValue(makePendingOrder({ filledQuantity: 0 }));
  mockClient.getOrder.mockResolvedValue(makePendingOrder({ filledQuantity: 10, filledValue: 1850 }));
  mockClient.placeStopOrder.mockResolvedValue(makeStopOrder());
}

// ── Tests ────────────────────────────────────────────────────

describe('POST /api/positions/execute', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.executionLog.create.mockResolvedValue({ id: 1 });
    mockAssertSubmissionAllowed.mockResolvedValue(undefined);
    setupUserMock();
    setupStockMock();

    // Save original fetch — tests that need a mock will override it
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Always restore fetch to prevent leaking mock between tests
    globalThis.fetch = originalFetch;
  });

  // Helper: mock fetch for Phase D (DB position creation)
  function mockFetchForPositionCreation(responseBody: Record<string, unknown> = { id: 'pos-123' }, status = 201) {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), { status })
    );
  }

  // ── Validation ──

  describe('request validation', () => {
    it('rejects request with missing required fields', async () => {
      const req = {
        json: vi.fn().mockResolvedValue({ userId: 'user1' }),
        url: 'http://localhost:3000/api/positions/execute',
      } as unknown as NextRequest;

      const response = await POST(req);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it('rejects negative quantity', async () => {
      const req = makeRequest({ quantity: -5 });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    it('rejects zero stopPrice', async () => {
      const req = makeRequest({ stopPrice: 0 });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    it('rejects invalid accountType', async () => {
      const req = makeRequest({ accountType: 'sipp' });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });
  });

  // ── Safety Assertions ──

  describe('safety assertions', () => {
    it('aborts before broker calls when submissions are disabled', async () => {
      mockAssertSubmissionAllowed.mockRejectedValue(
        new MockSafetyControlError('ALL_SUBMISSIONS_DISABLED', 'All order submissions are currently disabled')
      );

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.phase).toBe('KILL_SWITCH_BLOCK');
      expect(mockClient.placeMarketOrder).not.toHaveBeenCalled();
      expect(mockClient.placeStopOrder).not.toHaveBeenCalled();
    });

    it('aborts if stock not found in DB', async () => {
      prismaMock.stock.findUnique.mockResolvedValue(null);
      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.error).toContain('Stock not found');

      // Should log to ExecutionLog
      expect(prismaMock.executionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phase: 'SAFETY_ABORT' }),
        })
      );
    });

    it('aborts if T212 ticker not mapped', async () => {
      prismaMock.stock.findUnique.mockResolvedValue({
        t212Ticker: null, isaEligible: null, ticker: 'AAPL',
      });

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent!.data.error).toContain('No T212 ticker mapped');
    });

    it('aborts if T212 ticker does not match request', async () => {
      prismaMock.stock.findUnique.mockResolvedValue({
        t212Ticker: 'DIFFERENT_TICKER', isaEligible: null, ticker: 'AAPL',
      });

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent!.data.error).toContain('T212 ticker mismatch');
    });

    it('aborts ISA buy if stock is explicitly not ISA eligible', async () => {
      setupStockMock('AAPL_US_EQ', false);
      const req = makeRequest({ accountType: 'isa' });
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent!.data.error).toContain('not ISA eligible');
    });

    it('allows ISA buy if isaEligible is null (unknown)', async () => {
      setupStockMock('AAPL_US_EQ', null);
      setupFullExecution();
      mockFetchForPositionCreation();

      const req = makeRequest({ accountType: 'isa' });
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      // Should not have an ISA abort error
      const isaAbort = events.find(e => e.event === 'error' && (e.data.error as string)?.includes('ISA'));
      expect(isaAbort).toBeUndefined();
    }, 30_000);
  });

  // ── Phase A: Buy Order ──

  describe('Phase A: Buy Order', () => {
    it('aborts entirely if placeMarketOrder throws', async () => {
      const { Trading212Error } = await import('@/lib/trading212');
      mockClient.placeMarketOrder.mockRejectedValue(
        new Trading212Error('Insufficient funds', 400)
      );

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.phase).toBe('BUY_FAILED');
      expect(errorEvent!.data.critical).toBe(false);

      // Stop should NOT have been called
      expect(mockClient.placeStopOrder).not.toHaveBeenCalled();
    });

    it('places buy order with correct ticker and quantity', async () => {
      setupFullExecution();
      mockFetchForPositionCreation();

      const req = makeRequest();
      const response = await POST(req);
      // MUST drain stream before checking mock calls
      await parseSSEResponse(response);

      expect(mockClient.placeMarketOrder).toHaveBeenCalledWith({
        quantity: 10,
        ticker: 'AAPL_US_EQ',
      });
    }, 30_000);
  });

  // ── Phase B: Polling ──

  describe('Phase B: Fill Polling', () => {
    it('detects fill on first poll when filledQuantity meets threshold', async () => {
      setupFullExecution();
      mockFetchForPositionCreation();

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.data.position).toBeDefined();
    }, 30_000);

    it('handles 404 on getOrder by checking positions (fill detected)', async () => {
      const { Trading212Error } = await import('@/lib/trading212');
      mockClient.placeMarketOrder.mockResolvedValue(makePendingOrder({ filledQuantity: 0 }));
      mockClient.getOrder.mockRejectedValue(new Trading212Error('Not found', 404));
      mockClient.getPositions.mockResolvedValue([{
        averagePricePaid: 185.50,
        quantity: 10,
        instrument: { ticker: 'AAPL_US_EQ', name: 'Apple', isin: 'US0378331005', currencyCode: 'USD' },
        currentPrice: 186,
        createdAt: '2026-02-28T10:00:00Z',
        quantityAvailableForTrading: 10,
        quantityInPies: 0,
      }]);
      mockClient.placeStopOrder.mockResolvedValue(makeStopOrder());
      mockFetchForPositionCreation();

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent).toBeDefined();

      const position = completeEvent!.data.position as Record<string, unknown>;
      expect(position.filledPrice).toBe(185.50);
    }, 30_000);
  });

  // ── Phase C: Stop-Loss ──

  describe('Phase C: Stop-Loss', () => {
    it('places stop with NEGATIVE quantity and correct price', async () => {
      setupFullExecution();
      mockFetchForPositionCreation();

      const req = makeRequest();
      const response = await POST(req);
      // Drain the stream to ensure all phases complete
      await parseSSEResponse(response);

      expect(mockClient.placeStopOrder).toHaveBeenCalledWith({
        quantity: -10,  // MUST be negative — this is the most critical assertion
        stopPrice: 175.00,
        ticker: 'AAPL_US_EQ',
        timeValidity: 'GOOD_TILL_CANCEL',
      });
    }, 30_000);

    it('sends CRITICAL warning if stop fails but still creates DB position', async () => {
      const { Trading212Error } = await import('@/lib/trading212');
      mockClient.placeMarketOrder.mockResolvedValue(makePendingOrder({ filledQuantity: 0 }));
      mockClient.getOrder.mockResolvedValue(makePendingOrder({ filledQuantity: 10, filledValue: 1850 }));
      mockClient.placeStopOrder.mockRejectedValue(
        new Trading212Error('Order rejected', 422)
      );
      mockFetchForPositionCreation();

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      // Should have a critical phase warning
      const criticalPhase = events.find(
        e => e.event === 'phase' && e.data.critical === true
      );
      expect(criticalPhase).toBeDefined();
      expect(criticalPhase!.data.warning).toContain('CRITICAL');
      expect(criticalPhase!.data.warning).toContain('175');

      // Should STILL get a complete event (position saved to DB despite stop failure)
      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.data.stopFailed).toBe(true);
    }, 30_000);
  });

  // ── Phase D: DB Position ──

  describe('Phase D: DB Position Creation', () => {
    it('calls fetch for internal position creation', async () => {
      setupFullExecution();
      mockFetchForPositionCreation({ id: 'pos-abc' });

      const req = makeRequest({ entryPrice: 185.00 });
      const response = await POST(req);
      // Must drain stream to complete Phase D
      await parseSSEResponse(response);

      // Verify the internal fetch was called
      expect(globalThis.fetch).toHaveBeenCalled();

      // Check the call args
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);
      const [url, options] = fetchCalls[0];
      expect(url.toString()).toContain('/api/positions');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.stopLoss).toBe(175);
      expect(body.shares).toBe(10);
    }, 30_000);

    it('sends critical error if DB position creation fails', async () => {
      setupFullExecution();
      mockFetchForPositionCreation({ error: 'DB write failed' }, 500);

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(
        e => e.event === 'error' && e.data.phase === 'DB_POSITION_FAILED'
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.critical).toBe(true);
      expect(errorEvent!.data.error).toContain('IS live on T212');
    }, 30_000);
  });

  // ── Full Happy Path ──

  describe('full execution happy path', () => {
    it('completes all 4 phases and returns complete event', async () => {
      setupFullExecution();
      mockFetchForPositionCreation({ id: 'pos-final' });

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      // Should have phase updates
      const phaseEvents = events.filter(e => e.event === 'phase');
      expect(phaseEvents.length).toBeGreaterThan(0);

      // Should have a complete event
      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.data.stopFailed).toBe(false);

      const position = completeEvent!.data.position as Record<string, unknown>;
      expect(position.ticker).toBe('AAPL');
      expect(position.filledQuantity).toBe(10);
      expect(position.accountType).toBe('invest');
    }, 30_000);
  });

  // ── Audit Trail ──

  describe('audit trail (ExecutionLog)', () => {
    it('logs BUY_PLACED on successful buy order', async () => {
      setupFullExecution();
      mockFetchForPositionCreation();

      const req = makeRequest();
      const response = await POST(req);
      // MUST drain stream before checking mock calls
      await parseSSEResponse(response);

      const buyPlacedLog = prismaMock.executionLog.create.mock.calls.find(
        (call: Array<{ data: { phase: string } }>) => call[0].data.phase === 'BUY_PLACED'
      );
      expect(buyPlacedLog).toBeDefined();
      expect(buyPlacedLog![0].data.ticker).toBe('AAPL');
      expect(buyPlacedLog![0].data.orderId).toBe('12345');
    }, 30_000);

    it('logs COMPLETE at end of successful execution', async () => {
      setupFullExecution();
      mockFetchForPositionCreation({ id: 'pos-abc' });

      const req = makeRequest();
      const response = await POST(req);
      await parseSSEResponse(response);

      const completeLog = prismaMock.executionLog.create.mock.calls.find(
        (call: Array<{ data: { phase: string } }>) => call[0].data.phase === 'COMPLETE'
      );
      expect(completeLog).toBeDefined();
    }, 30_000);

    it('never lets ExecutionLog failure abort the execution', async () => {
      // Make logging fail — execution should still complete
      prismaMock.executionLog.create.mockRejectedValue(new Error('DB locked'));

      setupFullExecution();
      mockFetchForPositionCreation();

      const req = makeRequest();
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      // Execution should still complete despite log failures
      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent).toBeDefined();
    }, 30_000);
  });

  // ── Account Type Routing ──

  describe('account routing', () => {
    it('queries user credentials for ISA accountType', async () => {
      setupFullExecution();
      mockFetchForPositionCreation();

      const req = makeRequest({ accountType: 'isa' });
      const response = await POST(req);
      // Drain stream before checking mock calls
      await parseSSEResponse(response);

      // Verify user.findUnique was called for credential lookup
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'default-user' },
        })
      );
    }, 30_000);

    it('aborts if ISA account not connected', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        t212ApiKey: 'test-key',
        t212ApiSecret: 'test-secret',
        t212Environment: 'demo',
        t212Connected: true,
        t212IsaApiKey: null,
        t212IsaApiSecret: null,
        t212IsaConnected: false,
      });

      const req = makeRequest({ accountType: 'isa' });
      const response = await POST(req);
      const events = await parseSSEResponse(response);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.error).toContain('ISA account not connected');
    });
  });
});
