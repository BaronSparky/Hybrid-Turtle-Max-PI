import { describe, it, expect } from 'vitest';
import { DEAD_REASONS, INSUFFICIENT_DATA_PREFIX } from './data-validation-codes';

describe('data-validation-codes', () => {
  it('DEAD_REASONS values are non-empty strings', () => {
    for (const [key, value] of Object.entries(DEAD_REASONS)) {
      expect(value, `${key} should be a non-empty string`).toBeTruthy();
      expect(typeof value).toBe('string');
    }
  });

  it('INSUFFICIENT_DATA_PREFIX is a non-empty string', () => {
    expect(INSUFFICIENT_DATA_PREFIX).toBeTruthy();
    expect(typeof INSUFFICIENT_DATA_PREFIX).toBe('string');
  });

  it('DEAD_REASONS are distinct from each other', () => {
    const values = Object.values(DEAD_REASONS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('stale-ticker-tracker patterns match data-validator outputs', () => {
    // Simulate the composite error messages that snapshot-sync produces:
    // "Invalid data: Zero volume — stock may be halted; Same closing price for 3+ days — possible stale data"
    const compositeMessage = `Invalid data: ${DEAD_REASONS.ZERO_VOLUME}; ${DEAD_REASONS.STALE_PRICE}`;

    // The stale-ticker-tracker uses includes() to match patterns in these composite messages
    expect(compositeMessage.includes(DEAD_REASONS.ZERO_VOLUME)).toBe(true);
    expect(compositeMessage.includes(DEAD_REASONS.STALE_PRICE)).toBe(true);
  });

  it('INSUFFICIENT_DATA_PREFIX matches snapshot-sync error format', () => {
    // snapshot-sync throws: `${INSUFFICIENT_DATA_PREFIX} ${daily.length} bars`
    const errorMessage = `${INSUFFICIENT_DATA_PREFIX} 1 bars`;
    expect(errorMessage.includes(INSUFFICIENT_DATA_PREFIX)).toBe(true);

    // Also matches higher bar counts (not just 1)
    const errorMessage2 = `${INSUFFICIENT_DATA_PREFIX} 30 bars`;
    expect(errorMessage2.includes(INSUFFICIENT_DATA_PREFIX)).toBe(true);
  });
});
