/**
 * DEPENDENCIES
 * Consumed by: src/cron/watchdog.ts
 * Consumes: node:fs/promises, node:path
 * Risk-sensitive: NO — recovery state only
 * Notes: Tracks consecutive dashboard auto-restart failures so the watchdog
 *        does not loop forever restarting a broken build/install. Extracted
 *        so it can be unit-tested in isolation. See audit 2026-05-16 (H5).
 */

import { promises as fs } from 'fs';
import path from 'path';

/** Maximum consecutive failed auto-restart attempts before we give up. */
export const MAX_CONSECUTIVE_RESTART_FAILURES = 3;

/** Default state-file location: project-root/.watchdog-restart-state.json */
export function defaultStateFile(): string {
  // watchdog.ts lives in src/cron/, so project root is two levels up.
  return path.resolve(__dirname, '..', '..', '.watchdog-restart-state.json');
}

export interface RestartState {
  /** Count of consecutive failures (recovered=0). */
  consecutiveFailures: number;
  /** ISO timestamp of last attempt (any outcome). */
  lastAttemptAt: string | null;
  /** ISO timestamp of last successful recovery. */
  lastRecoveredAt: string | null;
}

const EMPTY_STATE: RestartState = {
  consecutiveFailures: 0,
  lastAttemptAt: null,
  lastRecoveredAt: null,
};

/**
 * Read the restart state. Returns EMPTY_STATE if the file is missing or
 * unparseable — recovery state corruption should not block the watchdog.
 */
export async function readRestartState(file: string = defaultStateFile()): Promise<RestartState> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RestartState>;
    return {
      consecutiveFailures: typeof parsed.consecutiveFailures === 'number' ? parsed.consecutiveFailures : 0,
      lastAttemptAt: typeof parsed.lastAttemptAt === 'string' ? parsed.lastAttemptAt : null,
      lastRecoveredAt: typeof parsed.lastRecoveredAt === 'string' ? parsed.lastRecoveredAt : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/**
 * Atomic write: write to a temp file in the same dir, then rename. This
 * avoids leaving a half-written state file if the process is killed mid-write.
 */
export async function writeRestartState(state: RestartState, file: string = defaultStateFile()): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/** Record a successful recovery — resets the failure counter. */
export async function recordRecovery(file: string = defaultStateFile()): Promise<void> {
  const now = new Date().toISOString();
  await writeRestartState(
    { consecutiveFailures: 0, lastAttemptAt: now, lastRecoveredAt: now },
    file
  );
}

/** Record a failed recovery — increments the failure counter. */
export async function recordFailure(file: string = defaultStateFile()): Promise<RestartState> {
  const current = await readRestartState(file);
  const next: RestartState = {
    consecutiveFailures: current.consecutiveFailures + 1,
    lastAttemptAt: new Date().toISOString(),
    lastRecoveredAt: current.lastRecoveredAt,
  };
  await writeRestartState(next, file);
  return next;
}

/** True when consecutive failures have hit or exceeded the budget. */
export function isBudgetExhausted(state: RestartState): boolean {
  return state.consecutiveFailures >= MAX_CONSECUTIVE_RESTART_FAILURES;
}
