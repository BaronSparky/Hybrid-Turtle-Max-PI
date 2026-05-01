/**
 * Regression tests for the trading212 sync merge logic.
 *
 * These cover the "9 vs 6" bug from 2026-05-01 where auto-trade rows
 * were created with t212Ticker=null and the broker sync re-created them
 * because its existence check filtered by source='trading212' and indexed
 * only by full T212 ticker.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSyncIndex,
  findExistingForSync,
  isExistingStillActive,
  shouldSkipForCrossAccountDuplicate,
  type ExistingSyncPosition,
} from './trading212-sync-merge';

function row(id: string, ticker: string, t212Ticker: string | null): ExistingSyncPosition {
  return { id, t212Ticker, stock: { ticker } };
}

describe('trading212-sync-merge: buildSyncIndex', () => {
  it('indexes by full T212 ticker when present', () => {
    const idx = buildSyncIndex([row('1', 'UNFI', 'UNFI_US_EQ')]);
    expect(idx.byFullTicker.get('UNFI_US_EQ')?.id).toBe('1');
  });

  it('indexes by bare stock ticker for every row', () => {
    const idx = buildSyncIndex([row('1', 'UNFI', 'UNFI_US_EQ'), row('2', 'GOOGL', null)]);
    expect(idx.byBareTicker.get('UNFI')?.id).toBe('1');
    expect(idx.byBareTicker.get('GOOGL')?.id).toBe('2');
  });

  it('skips byFullTicker entries when t212Ticker is null', () => {
    const idx = buildSyncIndex([row('1', 'GOOGL', null)]);
    expect(idx.byFullTicker.size).toBe(0);
    expect(idx.byBareTicker.size).toBe(1);
  });
});

describe('trading212-sync-merge: findExistingForSync', () => {
  it('matches by full T212 ticker (preferred path)', () => {
    const idx = buildSyncIndex([row('1', 'UNFI', 'UNFI_US_EQ')]);
    const found = findExistingForSync(idx, { ticker: 'UNFI', fullTicker: 'UNFI_US_EQ' });
    expect(found?.id).toBe('1');
  });

  it('falls back to bare ticker when t212Ticker is null on the existing row (the auto-trade dedupe bug)', () => {
    // This is the regression: an auto-trade row exists with t212Ticker=null
    // and broker sync arrives with the populated full ticker. Without the
    // bare-ticker fallback the sync would have created a duplicate.
    const idx = buildSyncIndex([row('1', 'UNFI', null)]);
    const found = findExistingForSync(idx, { ticker: 'UNFI', fullTicker: 'UNFI_US_EQ' });
    expect(found?.id).toBe('1');
  });

  it('returns null when neither key matches', () => {
    const idx = buildSyncIndex([row('1', 'UNFI', 'UNFI_US_EQ')]);
    const found = findExistingForSync(idx, { ticker: 'GOOGL', fullTicker: 'GOOGL_US_EQ' });
    expect(found).toBeNull();
  });

  it('prefers full-ticker match over bare-ticker match when both indexes contain entries', () => {
    const idx = buildSyncIndex([
      row('full', 'UNFI', 'UNFI_US_EQ'),
      // Hypothetical second row with the same bare ticker but null t212Ticker
      // (degenerate but should not dictate the match).
    ]);
    const found = findExistingForSync(idx, { ticker: 'UNFI', fullTicker: 'UNFI_US_EQ' });
    expect(found?.id).toBe('full');
  });
});

describe('trading212-sync-merge: shouldSkipForCrossAccountDuplicate', () => {
  it('does not skip when the ticker is not held in the other account', () => {
    const idx = buildSyncIndex([]);
    const skip = shouldSkipForCrossAccountDuplicate(
      idx,
      new Set(),
      { ticker: 'UNFI', fullTicker: 'UNFI_US_EQ' },
    );
    expect(skip).toBe(false);
  });

  it('skips when the ticker is held in the other account and not present in this account at all', () => {
    const idx = buildSyncIndex([]);
    const skip = shouldSkipForCrossAccountDuplicate(
      idx,
      new Set(['UNFI_US_EQ']),
      { ticker: 'UNFI', fullTicker: 'UNFI_US_EQ' },
    );
    expect(skip).toBe(true);
  });

  it('does NOT skip when a matching row already exists in this account by full ticker (allow update)', () => {
    const idx = buildSyncIndex([row('1', 'UNFI', 'UNFI_US_EQ')]);
    const skip = shouldSkipForCrossAccountDuplicate(
      idx,
      new Set(['UNFI_US_EQ']),
      { ticker: 'UNFI', fullTicker: 'UNFI_US_EQ' },
    );
    expect(skip).toBe(false);
  });

  it('does NOT skip when a matching row exists in this account only by bare ticker (legacy auto-trade case)', () => {
    const idx = buildSyncIndex([row('1', 'UNFI', null)]);
    const skip = shouldSkipForCrossAccountDuplicate(
      idx,
      new Set(['UNFI_US_EQ']),
      { ticker: 'UNFI', fullTicker: 'UNFI_US_EQ' },
    );
    expect(skip).toBe(false);
  });
});

describe('trading212-sync-merge: isExistingStillActive', () => {
  it('treats a row as active when its full T212 ticker is in the active set', () => {
    const active = isExistingStillActive(
      row('1', 'UNFI', 'UNFI_US_EQ'),
      new Set(['UNFI_US_EQ']),
      new Set(),
    );
    expect(active).toBe(true);
  });

  it('treats a legacy null-t212Ticker row as active when its bare ticker is in the active bare set', () => {
    // Without this branch, the close-detection loop would falsely close
    // an auto-trade row the moment the broker sync runs (because the row
    // has t212Ticker=null and would not appear in activeT212Tickers).
    const active = isExistingStillActive(
      row('1', 'UNFI', null),
      new Set(['UNFI_US_EQ']),
      new Set(['UNFI']),
    );
    expect(active).toBe(true);
  });

  it('treats a row as inactive when neither ticker form is present', () => {
    const active = isExistingStillActive(
      row('1', 'UNFI', 'UNFI_US_EQ'),
      new Set(['GOOGL_US_EQ']),
      new Set(['GOOGL']),
    );
    expect(active).toBe(false);
  });

  it('does not require t212Ticker to look up the bare-ticker fallback', () => {
    const active = isExistingStillActive(
      row('1', 'GOOGL', null),
      new Set(),
      new Set(['GOOGL']),
    );
    expect(active).toBe(true);
  });
});
