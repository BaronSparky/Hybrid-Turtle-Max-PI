/**
 * DEPENDENCIES
 * Consumed by: market-data.ts
 * Consumes: nothing
 * Risk-sensitive: YES — retry logic affects data freshness for pricing
 * Last modified: 2026-03-04
 * Notes: Exponential backoff retry for Yahoo Finance calls.
 *        Retries on transient errors (429, 5xx, network). No retry on 4xx client errors.
 */

/** Whether retry logic is active. Set to false to disable quickly if causing issues. */
export const YAHOO_RETRY_ENABLED = true;

/** Max retry attempts (total calls = MAX_RETRIES + 1) */
const MAX_RETRIES = 5;

/** Base delay in ms — doubles each attempt: 1s → 2s → 4s → 8s → 16s */
const BASE_DELAY_MS = 1000;

/** Max delay cap in ms — prevents runaway waits on later attempts */
const MAX_DELAY_MS = 15_000;

/**
 * Check if an error is transient and worth retrying.
 * Retries: network errors, timeouts, HTTP 429, HTTP 5xx.
 * No retry: 4xx client errors (except 429) — those indicate bad requests.
 */
function isTransientError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error as Error).message || String(error);
  const lower = msg.toLowerCase();

  // Network / timeout errors
  if (lower.includes('timeout') || lower.includes('econnreset') ||
      lower.includes('econnrefused') || lower.includes('enotfound') ||
      lower.includes('fetch failed') || lower.includes('network') ||
      lower.includes('socket hang up') || lower.includes('abort')) {
    return true;
  }

  // HTTP 429 rate limit
  if (msg.includes('429') || lower.includes('too many requests')) return true;

  // HTTP 5xx server errors
  if (/\b5\d{2}\b/.test(msg)) return true;

  return false;
}

/**
 * Execute an async function with exponential backoff retry.
 * Only retries on transient errors (network, 429, 5xx).
 *
 * @param fn        The async function to execute
 * @param label     A descriptive label for logging (e.g. ticker name)
 * @returns         The result of fn(), or throws after all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> {
  if (!YAHOO_RETRY_ENABLED) return fn();

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isTransientError(error) || attempt === MAX_RETRIES - 1) {
        throw error;
      }

      const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * BASE_DELAY_MS);
      const delay = Math.min(exponential + jitter, MAX_DELAY_MS); // 1-2s, 2-3s, 4-5s, 8-9s, 15s
      console.warn(
        `[Retry] ${label} — attempt ${attempt + 1}/${MAX_RETRIES} failed: ${(error as Error).message}. Retrying in ${delay}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
