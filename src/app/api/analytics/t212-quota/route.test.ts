import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readT212QuotaEvents: vi.fn(),
  notificationFindMany: vi.fn(),
}));

vi.mock('@/lib/t212-quota-log', () => ({
  readT212QuotaEvents: mocks.readT212QuotaEvents,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      findMany: mocks.notificationFindMany,
    },
  },
}));

import { GET } from './route';

describe('/api/analytics/t212-quota GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns quota events with rate-limit notification dedupe counts', async () => {
    mocks.readT212QuotaEvents.mockResolvedValue([
      { timestamp: '2026-04-30T11:00:00Z', remaining: 5, limit: 100, method: 'GET', path: '/equity/portfolio' },
      { timestamp: '2026-04-29T10:00:00Z', remaining: 5, limit: 100, method: 'GET', path: '/equity/portfolio' },
    ]);
    mocks.notificationFindMany.mockResolvedValue([
      { createdAt: new Date('2026-04-30T11:30:00Z'), data: '{"_notificationDedupeKey":"t212-rate-limit:Invest"}' },
      { createdAt: new Date('2026-04-29T08:00:00Z'), data: '{"_notificationDedupeKey":"t212-rate-limit:ISA"}' },
      { createdAt: new Date('2026-04-28T08:00:00Z'), data: '{}' },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(mocks.notificationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        title: 'T212 Rate Limited',
        createdAt: { gte: new Date('2026-04-23T12:00:00Z') },
      },
      take: 100,
    }));
    expect(body.total).toBe(2);
    expect(body.last24h).toBe(1);
    expect(body.rateLimitNotifications).toEqual({
      last24h: 1,
      last7d: 3,
      dedupedLast7d: 2,
      latestAt: '2026-04-30T11:30:00.000Z',
    });
  });

  it('returns a 500 response when quota data cannot be read', async () => {
    mocks.readT212QuotaEvents.mockRejectedValue(new Error('quota log unavailable'));
    mocks.notificationFindMany.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: {
        code: 'T212_QUOTA_READ_FAILED',
        message: 'Failed to read T212 quota events',
        details: 'quota log unavailable',
      },
    });
  });
});
