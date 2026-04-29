import { describe, it, expect } from 'vitest';
import { applyRetention, type T212QuotaEvent } from './t212-quota-log';

const NOW = new Date('2026-04-29T12:00:00Z').getTime();

function evt(timestamp: string): T212QuotaEvent {
  return { timestamp, remaining: 5, limit: 100, method: 'GET', path: '/equity' };
}

describe('applyRetention', () => {
  it('keeps events within the retention window', () => {
    const events = [
      evt(new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString()),
      evt(new Date(NOW - 6 * 24 * 60 * 60 * 1000).toISOString()),
    ];
    expect(applyRetention(events, NOW)).toHaveLength(2);
  });

  it('drops events older than 7 days', () => {
    const events = [
      evt(new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString()),
      evt(new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString()),
    ];
    const result = applyRetention(events, NOW);
    expect(result).toHaveLength(1);
    expect(new Date(result[0].timestamp).getTime()).toBeGreaterThan(NOW - 7 * 24 * 60 * 60 * 1000);
  });

  it('enforces hard cap when more than 1000 events survive retention', () => {
    const events = Array.from({ length: 1500 }, (_, i) =>
      evt(new Date(NOW - i * 1000).toISOString())
    );
    const result = applyRetention(events, NOW);
    expect(result).toHaveLength(1000);
  });

  it('drops malformed timestamps as expired', () => {
    const events = [evt('not-a-date'), evt(new Date(NOW - 1000).toISOString())];
    const result = applyRetention(events, NOW);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when all events are outside retention', () => {
    const events = [
      evt(new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ];
    expect(applyRetention(events, NOW)).toHaveLength(0);
  });
});
