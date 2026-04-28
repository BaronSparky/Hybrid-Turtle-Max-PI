import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// We test the core logic by directly testing the module
// The prisma calls are mocked via vi.mock

const STATE_FILE = join(process.cwd(), 'prisma', 'cache', 'stale-ticker-counts.json');

// Clean state file before/after tests
function cleanState() {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch { /* ignore */ }
}

// Mock prisma for the auto-deactivation DB call
vi.mock('../prisma', () => ({
  default: {
    stock: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

describe('stale-ticker-tracker', () => {
  beforeEach(() => cleanState());
  afterEach(() => cleanState());

  it('tracks dead ticker failures incrementally', async () => {
    const { updateStaleTracking } = await import('../stale-ticker-tracker');

    const failures = new Map([
      ['FOLD', 'Invalid data: Zero volume — stock may be halted'],
      ['GRAM', 'Invalid data: Zero volume — stock may be halted; Same closing price for 3+ days'],
      ['AAPL', 'Invalid data: Spike detected: 25% move on 2026-04-28'], // spike — should be ignored
    ]);
    const allActive = new Set(['FOLD', 'GRAM', 'AAPL', 'MSFT']);

    const result = await updateStaleTracking(failures, allActive);

    // FOLD and GRAM should be tracked (count=1), AAPL ignored (spike), no deactivations yet
    expect(result.deactivated).toHaveLength(0);
    expect(result.tracked).toBe(2);

    // Check state file
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(state.FOLD.count).toBe(1);
    expect(state.GRAM.count).toBe(1);
    expect(state.AAPL).toBeUndefined(); // spike not tracked
  });

  it('resets count for tickers that succeed', async () => {
    const { updateStaleTracking } = await import('../stale-ticker-tracker');

    // First run: FOLD fails
    writeFileSync(STATE_FILE, JSON.stringify({
      FOLD: { count: 2, lastReason: 'Zero volume', lastSeen: '2026-04-27' },
    }));

    const failures = new Map<string, string>(); // FOLD succeeds this time
    const allActive = new Set(['FOLD', 'MSFT']);

    const result = await updateStaleTracking(failures, allActive);

    expect(result.deactivated).toHaveLength(0);
    expect(result.tracked).toBe(0); // FOLD was reset

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(state.FOLD).toBeUndefined();
  });

  it('auto-deactivates after 3 consecutive failures', async () => {
    const { updateStaleTracking } = await import('../stale-ticker-tracker');

    // Pre-seed with 2 failures
    writeFileSync(STATE_FILE, JSON.stringify({
      FOLD: { count: 2, lastReason: 'Zero volume — stock may be halted', lastSeen: '2026-04-27' },
    }));

    const failures = new Map([
      ['FOLD', 'Invalid data: Zero volume — stock may be halted'],
    ]);
    const allActive = new Set(['FOLD', 'MSFT']);

    const result = await updateStaleTracking(failures, allActive);

    expect(result.deactivated).toEqual(['FOLD']);
    // After deactivation, ticker is removed from tracking
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(state.FOLD).toBeUndefined();
  });

  it('tracks insufficient data tickers', async () => {
    const { updateStaleTracking } = await import('../stale-ticker-tracker');

    const failures = new Map([
      ['EGIO', 'Insufficient data: 1 bars'],
    ]);
    const allActive = new Set(['EGIO']);

    const result = await updateStaleTracking(failures, allActive);
    expect(result.tracked).toBe(1);

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(state.EGIO.count).toBe(1);
  });
});
