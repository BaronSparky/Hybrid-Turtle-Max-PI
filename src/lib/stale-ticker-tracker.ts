/**
 * Stale Ticker Tracker
 *
 * Tracks consecutive nightly sync failures per ticker and auto-deactivates
 * tickers that have failed 3+ consecutive runs with "dead ticker" reasons
 * (zero volume, halted, insufficient data, stale price).
 *
 * Consumed by: nightly.ts (step 7, after snapshot sync)
 * State file: prisma/cache/stale-ticker-counts.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Config ──
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const STATE_FILE = join(process.cwd(), 'prisma', 'cache', 'stale-ticker-counts.json');

// Reasons that indicate a truly dead/delisted ticker (not just a bad day)
const DEAD_TICKER_PATTERNS = [
  'Zero volume',
  'stock may be halted',
  'Insufficient data: 1 bars',
  'Same closing price for 3+ days',
];

interface FailureState {
  [ticker: string]: {
    count: number;
    lastReason: string;
    lastSeen: string; // ISO date
  };
}

function loadState(): FailureState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {};
}

function saveState(state: FailureState): void {
  const dir = join(process.cwd(), 'prisma', 'cache');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isDeadTickerReason(reason: string): boolean {
  return DEAD_TICKER_PATTERNS.some(pattern => reason.includes(pattern));
}

export interface StaleTickerResult {
  /** Tickers that were auto-deactivated this run */
  deactivated: string[];
  /** Current failure counts for tracking */
  tracked: number;
}

/**
 * Update stale ticker tracking after a nightly sync run.
 *
 * @param syncFailures - Map of ticker → failure reason from the nightly sync log
 * @param allActiveTickers - Set of all active tickers that were synced this run
 * @returns List of tickers that were auto-deactivated
 */
export async function updateStaleTracking(
  syncFailures: Map<string, string>,
  allActiveTickers: Set<string>
): Promise<StaleTickerResult> {
  // Dynamic import to avoid circular dependency
  const { default: prisma } = await import('./prisma');

  const state = loadState();
  const deactivated: string[] = [];

  // Reset count for tickers that succeeded this run
  for (const ticker of allActiveTickers) {
    if (!syncFailures.has(ticker) && state[ticker]) {
      delete state[ticker];
    }
  }

  // Update counts for failed tickers
  for (const [ticker, reason] of syncFailures) {
    if (!isDeadTickerReason(reason)) continue; // Skip spikes and other transient failures

    const existing = state[ticker];
    const newCount = (existing?.count ?? 0) + 1;

    state[ticker] = {
      count: newCount,
      lastReason: reason,
      lastSeen: new Date().toISOString().split('T')[0],
    };

    // Auto-deactivate after threshold
    if (newCount >= CONSECUTIVE_FAILURE_THRESHOLD) {
      try {
        await prisma.stock.updateMany({
          where: { ticker, active: true },
          data: { active: false },
        });
        deactivated.push(ticker);
        console.log(`  [auto-deactivate] ${ticker} — ${newCount} consecutive failures: ${reason}`);
        delete state[ticker]; // Remove from tracking after deactivation
      } catch (err) {
        console.warn(`  [auto-deactivate] Failed to deactivate ${ticker}: ${(err as Error).message}`);
      }
    }
  }

  saveState(state);

  return {
    deactivated,
    tracked: Object.keys(state).length,
  };
}
