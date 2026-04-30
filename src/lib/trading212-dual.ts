/**
 * DEPENDENCIES
 * Consumed by: /api/trading212/sync/route.ts, /api/trading212/connect/route.ts
 * Consumes: trading212.ts (Trading212Client, Trading212Error, T212Position, T212AccountSummary, mapT212Position, mapT212AccountSummary)
 * Risk-sensitive: NO — orchestration layer only, no position sizing or stop logic
 * Last modified: 2026-02-23
 * Notes: Dual-account orchestrator — fetches Invest + ISA in parallel via Promise.allSettled.
 *        Positions are kept SEPARATE (never aggregated). Each position is tagged with accountType.
 */

import {
  Trading212Client,
  Trading212Error,
  type Trading212Environment,
  type T212Position,
  type T212AccountSummary,
  mapT212Position,
  mapT212AccountSummary,
} from './trading212';
import { decryptField } from './crypto';

// ---- Types ----

/** Which T212 account a position belongs to */
export type T212AccountType = 'invest' | 'isa';

/** Credentials for a single T212 account */
export interface T212AccountCredentials {
  apiKey: string;
  apiSecret: string;
  environment: Trading212Environment;
}

/** Summary + positions fetched from a single account */
export interface T212AccountData {
  summary: ReturnType<typeof mapT212AccountSummary>;
  positions: T212Position[];
  /** True if positions were actually fetched; false if degraded to empty on failure */
  positionsFetched: boolean;
}

/** Result of fetching both accounts — allows partial success */
export interface DualAccountResult {
  invest: T212AccountData | null;
  isa: T212AccountData | null;
  errors: {
    invest?: string;
    isa?: string;
  };
}

/** A mapped position tagged with its account type */
export interface PositionWithAccount extends ReturnType<typeof mapT212Position> {
  accountType: T212AccountType;
}

/** Credential validation result */
export interface DualCredentialStatus {
  hasInvest: boolean;
  hasIsa: boolean;
  /** True if at least one account has valid credentials */
  canFetch: boolean;
}

// ---- Max backoff cap for 429 retries (ms) ----
const MAX_BACKOFF_MS = 60_000;

// ---- Dual Account Client ----

export class DualT212Client {
  private investClient: Trading212Client | null;
  private isaClient: Trading212Client | null;

  constructor(
    investCreds?: T212AccountCredentials | null,
    isaCreds?: T212AccountCredentials | null
  ) {
    this.investClient = investCreds
      ? new Trading212Client(investCreds.apiKey, investCreds.apiSecret, investCreds.environment)
      : null;

    this.isaClient = isaCreds
      ? new Trading212Client(isaCreds.apiKey, isaCreds.apiSecret, isaCreds.environment)
      : null;
  }

  /**
   * Fetch summary + positions from both accounts in parallel.
   * Uses Promise.allSettled so one failing account doesn't block the other.
   * On 429: extracts the reset timestamp from Trading212Error, waits (capped at 60s), retries once.
   * Never throws — errors are captured in the result.errors object.
   */
  async fetchBothAccounts(): Promise<DualAccountResult> {
    const result: DualAccountResult = {
      invest: null,
      isa: null,
      errors: {},
    };

    // Build fetch tasks for each connected account
    const tasks: Array<{
      key: T212AccountType;
      fetcher: () => Promise<T212AccountData>;
    }> = [];

    if (this.investClient) {
      const client = this.investClient;
      tasks.push({
        key: 'invest',
        fetcher: () => this.fetchSingleAccount(client),
      });
    }

    if (this.isaClient) {
      const client = this.isaClient;
      tasks.push({
        key: 'isa',
        fetcher: () => this.fetchSingleAccount(client),
      });
    }

    if (tasks.length === 0) {
      result.errors.invest = 'No credentials provided';
      result.errors.isa = 'No credentials provided';
      return result;
    }

    // Fetch in parallel — Promise.allSettled gives us partial success
    const settled = await Promise.allSettled(
      tasks.map(async (task) => {
        try {
          return { key: task.key, data: await task.fetcher() };
        } catch (err) {
          // Handle 429 with backoff + single retry
          if (err instanceof Trading212Error && err.statusCode === 429) {
            const waitMs = this.calculateBackoffMs(err.rateLimitReset);
            await this.sleep(waitMs);
            // Retry once — if this also throws, it propagates to allSettled as rejected
            return { key: task.key, data: await task.fetcher() };
          }
          throw err; // Re-throw non-429 errors for allSettled to capture
        }
      })
    );

    // Process results
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const { key, data } = outcome.value;
        result[key] = data;
      } else {
        // Determine which account failed — match by index
        const idx = settled.indexOf(outcome);
        const key = tasks[idx]?.key;
        if (key) {
          const errMsg = outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
          result.errors[key] = errMsg;
        }
      }
    }

    return result;
  }

  /**
   * Flatten positions from both accounts into a single tagged list.
   * Overlapping tickers (same ticker in invest + isa) remain as separate entries.
   */
  getCombinedPositions(result: DualAccountResult): PositionWithAccount[] {
    const combined: PositionWithAccount[] = [];

    if (result.invest?.positions) {
      for (const pos of result.invest.positions) {
        combined.push({
          ...mapT212Position(pos),
          accountType: 'invest',
        });
      }
    }

    if (result.isa?.positions) {
      for (const pos of result.isa.positions) {
        combined.push({
          ...mapT212Position(pos),
          accountType: 'isa',
        });
      }
    }

    return combined;
  }

  // ---- Private Helpers ----

  /**
   * Fetch summary + positions from a single Trading212Client.
   * Uses Promise.allSettled internally so a positions failure doesn't block summary.
   */
  private async fetchSingleAccount(client: Trading212Client): Promise<T212AccountData> {
    const [summaryResult, positionsResult] = await Promise.allSettled([
      client.getAccountSummary(),
      client.getPositions(),
    ]);

    // Summary is required — if it fails, the whole account fetch fails
    if (summaryResult.status === 'rejected') {
      throw summaryResult.reason;
    }

    const summary = mapT212AccountSummary(summaryResult.value);

    // Positions can degrade gracefully — return empty array on failure
    // But we track whether positions were actually fetched so callers
    // don't accidentally close existing positions on a transient failure
    let positions: T212Position[] = [];
    let positionsFetched = false;
    if (positionsResult.status === 'fulfilled') {
      positions = positionsResult.value;
      positionsFetched = true;
    }

    return { summary, positions, positionsFetched };
  }

  /**
   * Calculate how long to wait before retrying a 429.
   * Uses the reset timestamp from the Trading212Error, capped at MAX_BACKOFF_MS.
   * Falls back to 5s if no reset timestamp is available.
   */
  private calculateBackoffMs(rateLimitReset?: number): number {
    if (!rateLimitReset) {
      return 5_000; // Default 5s if no reset timestamp
    }

    // T212 returns reset as Unix epoch seconds
    const nowMs = Date.now();
    const resetMs = rateLimitReset * 1000;
    const waitMs = Math.max(0, resetMs - nowMs);

    // Cap at MAX_BACKOFF_MS to avoid absurdly long waits
    return Math.min(waitMs, MAX_BACKOFF_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---- Credential Validation ----

/**
 * Check which T212 accounts have credentials configured.
 * Accepts a partial User record — only needs the T212 fields.
 */
export function validateDualCredentials(user: {
  t212ApiKey?: string | null;
  t212ApiSecret?: string | null;
  t212Connected?: boolean;
  t212IsaApiKey?: string | null;
  t212IsaApiSecret?: string | null;
  t212IsaConnected?: boolean;
}): DualCredentialStatus {
  // apiSecret is OPTIONAL (legacy single-token auth) — only the key + connected flag are required.
  const hasInvest = !!(user.t212ApiKey && user.t212Connected);
  const hasIsa = !!(user.t212IsaApiKey && user.t212IsaConnected);

  return {
    hasInvest,
    hasIsa,
    canFetch: hasInvest || hasIsa,
  };
}

/**
 * Build T212AccountCredentials from a User record for a specific account type.
 * Returns null if credentials are missing or account is not connected.
 */
export function getCredentialsForAccount(
  user: {
    t212ApiKey?: string | null;
    t212ApiSecret?: string | null;
    t212Environment?: string;
    t212Connected?: boolean;
    t212IsaApiKey?: string | null;
    t212IsaApiSecret?: string | null;
    t212IsaConnected?: boolean;
  },
  accountType: T212AccountType
): T212AccountCredentials | null {
  if (accountType === 'invest') {
    // Secret is optional (legacy single-token auth). Required: key + connected flag.
    if (!user.t212ApiKey || !user.t212Connected) return null;
    return {
      apiKey: decryptField(user.t212ApiKey),
      apiSecret: user.t212ApiSecret ? decryptField(user.t212ApiSecret) : '',
      environment: (user.t212Environment as Trading212Environment) || 'live',
    };
  }

  // ISA — shares t212Environment with the invest account (same demo/live setting)
  if (!user.t212IsaApiKey || !user.t212IsaConnected) return null;
  return {
    apiKey: decryptField(user.t212IsaApiKey),
    apiSecret: user.t212IsaApiSecret ? decryptField(user.t212IsaApiSecret) : '',
    environment: (user.t212Environment as Trading212Environment) || 'live',
  };
}
