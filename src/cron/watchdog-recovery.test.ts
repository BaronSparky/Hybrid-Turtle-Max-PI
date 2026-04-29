import { describe, it, expect, vi } from 'vitest';
import { waitForDashboardRecovery } from './watchdog-recovery';

describe('waitForDashboardRecovery', () => {
  const noSleep = async (): Promise<void> => undefined;

  it('returns true when dashboard responds OK on first poll', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const recovered = await waitForDashboardRecovery({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: noSleep,
      initialDelayMs: 0,
      timeoutMs: 1000,
      pollIntervalMs: 10,
    });
    expect(recovered).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps polling and returns true when dashboard recovers mid-window', async () => {
    let calls = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNREFUSED');
      return { ok: true };
    });
    const recovered = await waitForDashboardRecovery({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: noSleep,
      initialDelayMs: 0,
      timeoutMs: 10000,
      pollIntervalMs: 10,
    });
    expect(recovered).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('returns false when dashboard never recovers within timeout', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    let now = 0;
    const recovered = await waitForDashboardRecovery({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async (ms) => { now += ms; },
      nowFn: () => now,
      initialDelayMs: 0,
      timeoutMs: 100,
      pollIntervalMs: 30,
    });
    expect(recovered).toBe(false);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(0);
  });

  it('returns false on persistent non-OK responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    let now = 0;
    const recovered = await waitForDashboardRecovery({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async (ms) => { now += ms; },
      nowFn: () => now,
      initialDelayMs: 0,
      timeoutMs: 50,
      pollIntervalMs: 20,
    });
    expect(recovered).toBe(false);
  });
});
