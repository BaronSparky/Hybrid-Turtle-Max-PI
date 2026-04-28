import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { StopDriftReport } from './stop-broker-sync-check';

// Mock prisma before importing the module under test
vi.mock('./prisma', () => ({
  default: {
    position: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from './prisma';
import { checkStopBrokerSync } from './stop-broker-sync-check';

const mockFindMany = prisma.position.findMany as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.position.update as ReturnType<typeof vi.fn>;

function makePosition(
  ticker: string,
  currentStop: number,
  t212Ticker?: string,
  entryPrice = 100,
  initialRisk = 10,
) {
  return {
    id: `pos-${ticker}`,
    currentStop,
    t212Ticker: t212Ticker ?? null,
    stopLoss: currentStop,
    entryPrice,
    initialRisk,
    stock: { ticker, t212Ticker: t212Ticker ?? `${ticker}_EQ`, currency: 'USD' },
  };
}

function makeClient(pendingOrders: Array<{ ticker: string; stopPrice: number }>) {
  return {
    type: 'invest' as const,
    client: {
      getPendingOrders: vi.fn().mockResolvedValue(
        pendingOrders.map((o) => ({
          ticker: o.ticker,
          type: 'STOP',
          side: 'SELL',
          stopPrice: o.stopPrice,
        }))
      ),
    } as any,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkStopBrokerSync', () => {
  it('returns empty report when no positions exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const report = await checkStopBrokerSync([makeClient([])]);
    expect(report.checked).toBe(0);
    expect(report.mismatches).toHaveLength(0);
    expect(report.corrected).toBe(0);
    expect(report.errors).toHaveLength(0);
  });

  it('reports MATCHED when DB and broker stops are within 1%', async () => {
    mockFindMany.mockResolvedValue([makePosition('AAPL', 100, 'AAPL_EQ')]);

    const report = await checkStopBrokerSync([
      makeClient([{ ticker: 'AAPL_EQ', stopPrice: 100.5 }]),
    ]);

    expect(report.checked).toBe(1);
    expect(report.mismatches).toHaveLength(0);
  });

  it('reports NO_BROKER_STOP when T212 has no pending stop for position', async () => {
    mockFindMany.mockResolvedValue([makePosition('AAPL', 100, 'AAPL_EQ')]);

    const report = await checkStopBrokerSync([makeClient([])]);

    expect(report.checked).toBe(1);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]).toMatchObject({
      ticker: 'AAPL',
      driftDirection: 'NO_BROKER_STOP',
      brokerStop: null,
      corrected: false,
    });
  });

  it('reports DB_HIGHER when DB stop exceeds broker stop by >1%', async () => {
    // DB has 110, broker has 100 — 10% drift, DB is higher
    mockFindMany.mockResolvedValue([makePosition('GEV', 110, 'GEV_EQ')]);

    const report = await checkStopBrokerSync([
      makeClient([{ ticker: 'GEV_EQ', stopPrice: 100 }]),
    ]);

    expect(report.checked).toBe(1);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]).toMatchObject({
      ticker: 'GEV',
      driftDirection: 'DB_HIGHER',
      dbStop: 110,
      brokerStop: 100,
      corrected: false,
    });
    expect(report.mismatches[0].driftPct).toBeGreaterThan(1);
  });

  it('reports DB_LOWER when broker stop exceeds DB stop by >1%', async () => {
    // DB has 90, broker has 100 — DB is more conservative
    mockFindMany.mockResolvedValue([makePosition('SLAB', 90, 'SLAB_EQ')]);

    const report = await checkStopBrokerSync([
      makeClient([{ ticker: 'SLAB_EQ', stopPrice: 100 }]),
    ]);

    expect(report.checked).toBe(1);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]).toMatchObject({
      ticker: 'SLAB',
      driftDirection: 'DB_LOWER',
      dbStop: 90,
      brokerStop: 100,
      corrected: false,
    });
  });

  describe('auto-correction', () => {
    it('auto-corrects DB_HIGHER when autoCorrect=true', async () => {
      // Entry $1100, initialRisk $80 → broker stop $1039.30 is below entry → INITIAL
      mockFindMany.mockResolvedValue([makePosition('GEV', 1088.54, 'GEV_EQ', 1100, 80)]);
      mockUpdate.mockResolvedValue({});

      const report = await checkStopBrokerSync(
        [makeClient([{ ticker: 'GEV_EQ', stopPrice: 1039.30 }])],
        true // autoCorrect
      );

      expect(report.corrected).toBe(1);
      expect(report.mismatches).toHaveLength(1);
      expect(report.mismatches[0]).toMatchObject({
        ticker: 'GEV',
        driftDirection: 'DB_HIGHER',
        corrected: true,
      });

      // Verify the DB update was called with broker's stop and inferred level
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'pos-GEV' },
        data: {
          currentStop: 1039.30,
          stopLoss: 1039.30,
          protectionLevel: 'INITIAL',
        },
      });
    });

    it('does NOT auto-correct DB_LOWER even when autoCorrect=true', async () => {
      // DB is more conservative (lower stop) — safe, do not touch
      mockFindMany.mockResolvedValue([makePosition('APLS', 90, 'APLS_EQ')]);

      const report = await checkStopBrokerSync(
        [makeClient([{ ticker: 'APLS_EQ', stopPrice: 100 }])],
        true
      );

      expect(report.corrected).toBe(0);
      expect(report.mismatches).toHaveLength(1);
      expect(report.mismatches[0]).toMatchObject({
        driftDirection: 'DB_LOWER',
        corrected: false,
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('infers correct protection level when broker stop is above entry', async () => {
      // Entry $900, initialRisk $50 → broker stop $960 → stopR = 1.2 → LOCK_1R_TRAIL
      mockFindMany.mockResolvedValue([makePosition('SLAB', 990, 'SLAB_EQ', 900, 50)]);
      mockUpdate.mockResolvedValue({});

      const report = await checkStopBrokerSync(
        [makeClient([{ ticker: 'SLAB_EQ', stopPrice: 960 }])],
        true
      );

      expect(report.corrected).toBe(1);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'pos-SLAB' },
        data: {
          currentStop: 960,
          stopLoss: 960,
          protectionLevel: 'LOCK_1R_TRAIL', // NOT 'INITIAL' — inferred from stop position
        },
      });
    });

    it('does NOT auto-correct when autoCorrect=false (default)', async () => {
      mockFindMany.mockResolvedValue([makePosition('GEV', 110, 'GEV_EQ')]);

      const report = await checkStopBrokerSync([
        makeClient([{ ticker: 'GEV_EQ', stopPrice: 100 }]),
      ]);

      expect(report.corrected).toBe(0);
      expect(report.mismatches[0].corrected).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('does NOT auto-correct NO_BROKER_STOP', async () => {
      mockFindMany.mockResolvedValue([makePosition('AAPL', 100, 'AAPL_EQ')]);

      const report = await checkStopBrokerSync([makeClient([])], true);

      expect(report.corrected).toBe(0);
      expect(report.mismatches[0]).toMatchObject({
        driftDirection: 'NO_BROKER_STOP',
        corrected: false,
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('records error and does not mark corrected when DB update fails', async () => {
      mockFindMany.mockResolvedValue([makePosition('GEV', 110, 'GEV_EQ')]);
      mockUpdate.mockRejectedValue(new Error('DB write failed'));

      const report = await checkStopBrokerSync(
        [makeClient([{ ticker: 'GEV_EQ', stopPrice: 100 }])],
        true
      );

      expect(report.corrected).toBe(0);
      expect(report.mismatches[0].corrected).toBe(false);
      expect(report.errors).toContain('Failed to auto-correct GEV: DB write failed');
    });
  });

  describe('edge cases', () => {
    it('skips positions without t212Ticker', async () => {
      const pos = makePosition('PRIVATE', 100);
      pos.t212Ticker = null;
      pos.stock.t212Ticker = null as any;
      mockFindMany.mockResolvedValue([pos]);

      const report = await checkStopBrokerSync([makeClient([])]);
      expect(report.checked).toBe(0);
    });

    it('uses position t212Ticker over stock t212Ticker when both exist', async () => {
      const pos = makePosition('AAPL', 100, 'AAPL_POS_EQ');
      pos.stock.t212Ticker = 'AAPL_STOCK_EQ';
      mockFindMany.mockResolvedValue([pos]);

      const report = await checkStopBrokerSync([
        makeClient([{ ticker: 'AAPL_POS_EQ', stopPrice: 100 }]),
      ]);

      // Should match on position's t212Ticker, not stock's
      expect(report.checked).toBe(1);
      expect(report.mismatches).toHaveLength(0);
    });

    it('handles multiple positions with mixed drift directions', async () => {
      mockFindMany.mockResolvedValue([
        makePosition('AAPL', 110, 'AAPL_EQ'),  // DB_HIGHER
        makePosition('SLAB', 90, 'SLAB_EQ'),   // DB_LOWER
        makePosition('GEV', 100, 'GEV_EQ'),    // MATCHED (within 1%)
      ]);

      const report = await checkStopBrokerSync([
        makeClient([
          { ticker: 'AAPL_EQ', stopPrice: 100 },
          { ticker: 'SLAB_EQ', stopPrice: 100 },
          { ticker: 'GEV_EQ', stopPrice: 100.5 },
        ]),
      ]);

      expect(report.checked).toBe(3);
      expect(report.mismatches).toHaveLength(2);
      expect(report.mismatches.map((m) => m.driftDirection)).toContain('DB_HIGHER');
      expect(report.mismatches.map((m) => m.driftDirection)).toContain('DB_LOWER');
    });

    it('handles T212 client fetch failure gracefully', async () => {
      mockFindMany.mockResolvedValue([makePosition('AAPL', 100, 'AAPL_EQ')]);

      const failingClient = {
        type: 'invest' as const,
        client: {
          getPendingOrders: vi.fn().mockRejectedValue(new Error('Network timeout')),
        } as any,
      };

      const report = await checkStopBrokerSync([failingClient]);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toContain('Network timeout');
    });

    it('merges pending stops from multiple T212 clients', async () => {
      mockFindMany.mockResolvedValue([
        makePosition('AAPL', 100, 'AAPL_EQ'),
        makePosition('SLAB', 100, 'SLAB_EQ'),
      ]);

      const investClient = makeClient([{ ticker: 'AAPL_EQ', stopPrice: 100 }]);
      const isaClient = {
        type: 'isa' as const,
        client: {
          getPendingOrders: vi.fn().mockResolvedValue([
            { ticker: 'SLAB_EQ', type: 'STOP', side: 'SELL', stopPrice: 100 },
          ]),
        } as any,
      };

      const report = await checkStopBrokerSync([investClient, isaClient]);
      expect(report.checked).toBe(2);
      expect(report.mismatches).toHaveLength(0);
    });
  });
});
