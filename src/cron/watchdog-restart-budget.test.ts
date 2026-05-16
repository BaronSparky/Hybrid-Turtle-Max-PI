import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  readRestartState,
  writeRestartState,
  recordRecovery,
  recordFailure,
  isBudgetExhausted,
  MAX_CONSECUTIVE_RESTART_FAILURES,
} from './watchdog-restart-budget';

describe('watchdog-restart-budget', () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'watchdog-budget-'));
    stateFile = path.join(tmpDir, 'state.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty state when file does not exist', async () => {
    const state = await readRestartState(stateFile);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastAttemptAt).toBeNull();
    expect(state.lastRecoveredAt).toBeNull();
  });

  it('returns empty state when file is unparseable (does not throw)', async () => {
    await fs.writeFile(stateFile, '{not json at all', 'utf8');
    const state = await readRestartState(stateFile);
    expect(state.consecutiveFailures).toBe(0);
  });

  it('persists and reads back state', async () => {
    await writeRestartState(
      { consecutiveFailures: 2, lastAttemptAt: '2026-05-16T10:00:00.000Z', lastRecoveredAt: null },
      stateFile
    );
    const state = await readRestartState(stateFile);
    expect(state.consecutiveFailures).toBe(2);
    expect(state.lastAttemptAt).toBe('2026-05-16T10:00:00.000Z');
  });

  it('recordRecovery resets the failure counter', async () => {
    await writeRestartState(
      { consecutiveFailures: 2, lastAttemptAt: '2026-05-16T10:00:00.000Z', lastRecoveredAt: null },
      stateFile
    );
    await recordRecovery(stateFile);
    const state = await readRestartState(stateFile);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastRecoveredAt).not.toBeNull();
  });

  it('recordFailure increments the failure counter and returns new state', async () => {
    const next1 = await recordFailure(stateFile);
    expect(next1.consecutiveFailures).toBe(1);
    const next2 = await recordFailure(stateFile);
    expect(next2.consecutiveFailures).toBe(2);
    const next3 = await recordFailure(stateFile);
    expect(next3.consecutiveFailures).toBe(3);
  });

  it('recordFailure preserves lastRecoveredAt from prior state', async () => {
    const recoveredAt = '2026-05-15T09:00:00.000Z';
    await writeRestartState(
      { consecutiveFailures: 1, lastAttemptAt: null, lastRecoveredAt: recoveredAt },
      stateFile
    );
    const next = await recordFailure(stateFile);
    expect(next.lastRecoveredAt).toBe(recoveredAt);
    expect(next.consecutiveFailures).toBe(2);
  });

  it('isBudgetExhausted is true at the threshold and above', () => {
    expect(
      isBudgetExhausted({ consecutiveFailures: 0, lastAttemptAt: null, lastRecoveredAt: null })
    ).toBe(false);
    expect(
      isBudgetExhausted({
        consecutiveFailures: MAX_CONSECUTIVE_RESTART_FAILURES - 1,
        lastAttemptAt: null,
        lastRecoveredAt: null,
      })
    ).toBe(false);
    expect(
      isBudgetExhausted({
        consecutiveFailures: MAX_CONSECUTIVE_RESTART_FAILURES,
        lastAttemptAt: null,
        lastRecoveredAt: null,
      })
    ).toBe(true);
    expect(
      isBudgetExhausted({
        consecutiveFailures: MAX_CONSECUTIVE_RESTART_FAILURES + 5,
        lastAttemptAt: null,
        lastRecoveredAt: null,
      })
    ).toBe(true);
  });

  it('writes atomically (no .tmp file left after success)', async () => {
    await writeRestartState(
      { consecutiveFailures: 1, lastAttemptAt: null, lastRecoveredAt: null },
      stateFile
    );
    const entries = await fs.readdir(tmpDir);
    expect(entries).toContain('state.json');
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });
});
