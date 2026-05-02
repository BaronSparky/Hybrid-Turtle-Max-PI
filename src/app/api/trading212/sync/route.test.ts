/**
 * Regression test for GET /api/trading212/sync — guards positionCount.
 *
 * Background: the sibling bug to "portfolio shows 3 of 6 positions" was that
 * this GET handler counted positions filtered by source='trading212', which
 * silently under-reported holdings whenever auto-trade-originated rows were
 * present. The fix removed the source filter; this test pins that contract
 * so a future "tighten the where clause" attempt can't reintroduce it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { prismaMock, ensureDefaultUserMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    position: { count: vi.fn() },
  },
  ensureDefaultUserMock: vi.fn(async () => 'default-user'),
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/default-user', () => ({ ensureDefaultUser: ensureDefaultUserMock }));
vi.mock('@/lib/trading212-dual', () => ({
  DualT212Client: class { },
  validateDualCredentials: () => ({ canFetch: false }),
  getCredentialsForAccount: () => null,
}));
vi.mock('@/lib/equity-snapshot', () => ({ recordEquitySnapshot: vi.fn() }));
vi.mock('@/lib/risk-gates', () => ({ validateRiskGates: () => [] }));
vi.mock('@/lib/market-data', () => ({ getFXRate: vi.fn(async () => 1) }));
vi.mock('@/lib/trading212', () => ({
  mapT212Position: (p: unknown) => p,
  mapT212AccountSummary: (s: unknown) => s,
}));
vi.mock('@/lib/trading212-sync-merge', () => ({
  buildSyncIndex: () => ({}),
  findExistingForSync: () => null,
  isExistingStillActive: () => true,
  shouldSkipForCrossAccountDuplicate: () => false,
}));

import { GET } from './route';

function makeRequest(url = 'http://localhost/api/trading212/sync?userId=u1'): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

describe('GET /api/trading212/sync — positionCount source-filter regression', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.position.count.mockReset();
    ensureDefaultUserMock.mockClear();
  });

  it('counts ALL OPEN positions per accountType regardless of source', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      t212ApiKey: 'invest-key',
      t212IsaApiKey: 'isa-key',
      t212Connected: true,
      t212IsaConnected: true,
      t212LastSync: null,
      t212IsaLastSync: null,
      t212AccountId: '1',
      t212IsaAccountId: '2',
      t212Currency: 'GBP',
      t212IsaCurrency: 'GBP',
      t212Environment: 'live',
      t212Cash: 0, t212Invested: 0, t212UnrealisedPL: 0, t212TotalValue: 0,
      t212IsaCash: 0, t212IsaInvested: 0, t212IsaUnrealisedPL: 0, t212IsaTotalValue: 0,
    });
    // Simulate the live DB state: 3 trading212 + 3 auto-trade rows under ISA.
    prismaMock.position.count.mockImplementation(async (args: { where: { accountType: string } }) =>
      args.where.accountType === 'isa' ? 6 : 0
    );

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body.isa.positionCount).toBe(6);
    expect(body.invest.positionCount).toBe(0);
    expect(body.positionCount).toBe(6);

    // The where clauses must NOT carry a source filter. If they do, the
    // dashboard will silently revert to under-reporting.
    for (const call of prismaMock.position.count.mock.calls) {
      const where = call[0]?.where ?? {};
      expect(where).not.toHaveProperty('source');
      expect(where).toMatchObject({ userId: 'u1', status: 'OPEN' });
    }
  });

  it('zeroes the per-account ISA tile when invest and ISA share the same API key', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      t212ApiKey: 'same-key',
      t212IsaApiKey: 'same-key',
      t212Connected: true,
      t212IsaConnected: true,
      t212LastSync: null, t212IsaLastSync: null,
      t212AccountId: '1', t212IsaAccountId: '1',
      t212Currency: 'GBP', t212IsaCurrency: 'GBP',
      t212Environment: 'live',
      t212Cash: 0, t212Invested: 0, t212UnrealisedPL: 0, t212TotalValue: 0,
      t212IsaCash: 0, t212IsaInvested: 0, t212IsaUnrealisedPL: 0, t212IsaTotalValue: 0,
    });
    // Simulate a legacy DB still carrying ISA rows from before the dup-key
    // guard existed: invest=3, isa=3. With duplicate-key in effect, both the
    // ISA tile AND the top-level total must collapse the ISA contribution.
    prismaMock.position.count.mockImplementation(async (args: { where: { accountType: string } }) =>
      args.where.accountType === 'invest' ? 3 : 3
    );

    const response = await GET(makeRequest());
    const body = await response.json();

    // Per-account ISA tile is force-zeroed by the duplicate-key guard.
    expect(body.isa.positionCount).toBe(0);
    expect(body.invest.positionCount).toBe(3);
    // Top-level total must stay in lockstep with the per-account tiles —
    // otherwise the dashboard reads "6 positions" while ISA shows 0.
    expect(body.positionCount).toBe(3);
    expect(body.duplicateKeyWarning).toBeTruthy();
    // No source filter must leak in here either.
    for (const call of prismaMock.position.count.mock.calls) {
      expect(call[0]?.where ?? {}).not.toHaveProperty('source');
    }
  });
});
