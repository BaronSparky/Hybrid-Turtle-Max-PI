/**
 * DEPENDENCIES
 * Consumed by: src/cron/watchdog.ts
 * Consumes: global fetch
 * Risk-sensitive: NO — monitoring only
 * Notes: Polls /api/system-status after auto-restart to confirm dashboard recovery.
 *        Extracted from watchdog.ts so it can be unit-tested in isolation.
 */

export interface RecoveryOptions {
  /** Total time to wait for recovery (ms). Default 60s. */
  timeoutMs?: number;
  /** Delay between polls (ms). Default 5s. */
  pollIntervalMs?: number;
  /** Wait before first poll to let server boot (ms). Default 10s. */
  initialDelayMs?: number;
  /** Per-request fetch timeout (ms). Default 3s. */
  fetchTimeoutMs?: number;
  /** URL to probe. Default localhost dashboard system-status. */
  url?: string;
  /** Injectable fetch + timer for tests. */
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the dashboard system-status endpoint until it responds OK
 * or the timeout elapses. Returns true on recovery, false otherwise.
 */
export async function waitForDashboardRecovery(options: RecoveryOptions = {}): Promise<boolean> {
  const {
    timeoutMs = 60000,
    pollIntervalMs = 5000,
    initialDelayMs = 10000,
    fetchTimeoutMs = 3000,
    url = 'http://localhost:3000/api/system-status',
    fetchFn = fetch,
    sleepFn = defaultSleep,
    nowFn = Date.now,
  } = options;

  await sleepFn(initialDelayMs);

  const deadline = nowFn() + timeoutMs;
  while (nowFn() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
      const res = await fetchFn(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return true;
    } catch {
      // server still down — keep polling
    }
    await sleepFn(pollIntervalMs);
  }
  return false;
}
