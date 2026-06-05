import { describe, expect, it } from 'vitest';

import { decideStopCommit, isBrokerStopConfirmed } from './nightly-stop-apply';

describe('isBrokerStopConfirmed', () => {
  it('confirms when the broker holds the requested stop', () => {
    expect(isBrokerStopConfirmed('PLACED')).toBe(true);
    expect(isBrokerStopConfirmed('UPDATED')).toBe(true);
    expect(isBrokerStopConfirmed('SKIPPED_SAME')).toBe(true);
  });

  it('does not confirm on any failure or skip-without-protection action', () => {
    expect(isBrokerStopConfirmed('FAILED')).toBe(false);
    expect(isBrokerStopConfirmed('FAILED_PRICE_TOO_FAR')).toBe(false);
    expect(isBrokerStopConfirmed('SKIPPED_NOT_OWNED')).toBe(false);
    expect(isBrokerStopConfirmed('SKIPPED_PRICE_TOO_FAR')).toBe(false);
    expect(isBrokerStopConfirmed('SKIPPED_NO_SHARES')).toBe(false);
  });

  it('does not confirm when the action is missing (never pushed / push threw)', () => {
    expect(isBrokerStopConfirmed(undefined)).toBe(false);
    expect(isBrokerStopConfirmed(null)).toBe(false);
    expect(isBrokerStopConfirmed('')).toBe(false);
  });
});

describe('decideStopCommit', () => {
  it('commits in advisory mode regardless of broker outcome', () => {
    expect(
      decideStopCommit({ autoTradingEnabled: false, hasBrokerTicker: true, brokerAction: 'FAILED' })
    ).toBe('COMMIT');
    expect(
      decideStopCommit({ autoTradingEnabled: false, hasBrokerTicker: true, brokerAction: undefined })
    ).toBe('COMMIT');
  });

  it('commits when the position has no broker ticker to confirm against', () => {
    expect(
      decideStopCommit({ autoTradingEnabled: true, hasBrokerTicker: false, brokerAction: undefined })
    ).toBe('COMMIT');
  });

  it('commits when auto-trading is on and the broker confirmed the stop', () => {
    expect(
      decideStopCommit({ autoTradingEnabled: true, hasBrokerTicker: true, brokerAction: 'PLACED' })
    ).toBe('COMMIT');
    expect(
      decideStopCommit({ autoTradingEnabled: true, hasBrokerTicker: true, brokerAction: 'SKIPPED_SAME' })
    ).toBe('COMMIT');
  });

  it('withholds when auto-trading is on, ticker exists, but the broker did not confirm', () => {
    expect(
      decideStopCommit({ autoTradingEnabled: true, hasBrokerTicker: true, brokerAction: 'FAILED' })
    ).toBe('WITHHOLD');
    expect(
      decideStopCommit({ autoTradingEnabled: true, hasBrokerTicker: true, brokerAction: 'SKIPPED_PRICE_TOO_FAR' })
    ).toBe('WITHHOLD');
  });

  it('withholds when auto-trading is on, ticker exists, but the stop was never pushed', () => {
    expect(
      decideStopCommit({ autoTradingEnabled: true, hasBrokerTicker: true, brokerAction: undefined })
    ).toBe('WITHHOLD');
  });
});
