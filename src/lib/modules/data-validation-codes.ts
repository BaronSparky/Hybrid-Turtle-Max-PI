// ── Dead Ticker Reason Constants ──────────────────────────────
// Shared between data-validator.ts and stale-ticker-tracker.ts.
// Changing a string here automatically updates both systems.

export const DEAD_REASONS = {
  NO_DATA: 'No data available — may be delisted or halted',
  ZERO_VOLUME: 'Zero volume — stock may be halted',
  STALE_PRICE: 'Same closing price for 3+ days — possible stale data',
} as const;

/** Prefix for the insufficient-data error thrown by snapshot-sync.ts */
export const INSUFFICIENT_DATA_PREFIX = 'Insufficient data:';
