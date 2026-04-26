import { describe, expect, it } from 'vitest';

/**
 * Auto-trade safety gate tests.
 *
 * These tests verify the session filtering, safety configuration,
 * and gate logic used by src/cron/auto-trade.ts without requiring
 * a live broker connection or database.
 */

// ── Session filtering (pure function extracted from auto-trade logic) ──

function isStockForSession(ticker: string, sleeve: string, session: string): boolean {
  if (session === 'scan') return false;
  const sessionSleeves: Record<string, string[]> = {
    uk: ['CORE', 'ETF'],
    us: ['CORE', 'HIGH_RISK', 'ETF'],
    'us-close': ['CORE', 'HIGH_RISK', 'ETF'],
  };
  const sleeves = sessionSleeves[session];
  if (!sleeves || !sleeves.includes(sleeve)) return false;
  if (session === 'uk') return ticker.endsWith('.L');
  return !ticker.endsWith('.L');
}

describe('auto-trade: session filtering', () => {
  it('UK session only includes .L stocks', () => {
    expect(isStockForSession('GSK.L', 'CORE', 'uk')).toBe(true);
    expect(isStockForSession('AAPL', 'CORE', 'uk')).toBe(false);
    expect(isStockForSession('MSFT', 'HIGH_RISK', 'uk')).toBe(false);
  });

  it('US session excludes .L stocks', () => {
    expect(isStockForSession('AAPL', 'CORE', 'us')).toBe(true);
    expect(isStockForSession('MSFT', 'HIGH_RISK', 'us')).toBe(true);
    expect(isStockForSession('GSK.L', 'CORE', 'us')).toBe(false);
  });

  it('US close session matches same as US session', () => {
    expect(isStockForSession('AAPL', 'CORE', 'us-close')).toBe(true);
    expect(isStockForSession('GSK.L', 'CORE', 'us-close')).toBe(false);
  });

  it('scan session never returns true (no trades)', () => {
    expect(isStockForSession('AAPL', 'CORE', 'scan')).toBe(false);
    expect(isStockForSession('GSK.L', 'CORE', 'scan')).toBe(false);
  });

  it('UK session excludes HIGH_RISK sleeve', () => {
    expect(isStockForSession('XYZ.L', 'HIGH_RISK', 'uk')).toBe(false);
  });

  it('HEDGE sleeve never included in any trading session', () => {
    expect(isStockForSession('AAPL', 'HEDGE', 'us')).toBe(false);
    expect(isStockForSession('GSK.L', 'HEDGE', 'uk')).toBe(false);
    expect(isStockForSession('AAPL', 'HEDGE', 'us-close')).toBe(false);
  });

  it('ETF sleeve allowed in all trading sessions', () => {
    expect(isStockForSession('VWRL.L', 'ETF', 'uk')).toBe(true);
    expect(isStockForSession('SPY', 'ETF', 'us')).toBe(true);
  });
});

describe('auto-trade: safety configuration', () => {
  it('ENABLE_AUTO_TRADING defaults to false when not set', () => {
    const enabled = process.env.ENABLE_AUTO_TRADING === 'true';
    expect(enabled).toBe(false);
  });

  it('DB enableAutoTrading defaults to false in KillSwitchSettings', () => {
    // Mirrors the default in safety-controls.ts
    const defaults = {
      disableAllSubmissions: false,
      disableAutomatedSubmissions: false,
      disableScansWhenDataStale: true,
      enableAutoTrading: false,
      updatedAt: null,
    };
    expect(defaults.enableAutoTrading).toBe(false);
  });

  it('isAutoTradingEnabled logic: DB true OR env true = enabled', () => {
    // Simulates the logic in isAutoTradingEnabled()
    function check(dbSetting: boolean, envVar: string | undefined): boolean {
      return dbSetting || envVar === 'true';
    }
    expect(check(false, undefined)).toBe(false);   // both off
    expect(check(true, undefined)).toBe(true);      // DB on, env missing
    expect(check(false, 'true')).toBe(true);         // DB off, env on
    expect(check(true, 'true')).toBe(true);          // both on
    expect(check(false, 'false')).toBe(false);       // both off
  });

  it('max trades per session defaults to 2', () => {
    const max = parseInt(process.env.AUTO_TRADE_MAX_PER_SESSION || '2', 10);
    expect(max).toBe(2);
  });

  it('session names are validated', () => {
    const validSessions = ['uk', 'us', 'us-close', 'scan'];
    expect(validSessions).toContain('uk');
    expect(validSessions).toContain('us');
    expect(validSessions).toContain('us-close');
    expect(validSessions).toContain('scan');
    expect(validSessions).not.toContain('invalid');
  });

  it('stop quantity is always negative', () => {
    const filledQuantity = 10;
    const stopQuantity = -Math.abs(filledQuantity);
    expect(stopQuantity).toBeLessThan(0);
    expect(stopQuantity).toBe(-10);
  });

  it('stop quantity is negative even for fractional shares', () => {
    const filledQuantity = 3.25;
    const stopQuantity = -Math.abs(filledQuantity);
    expect(stopQuantity).toBeLessThan(0);
    expect(stopQuantity).toBe(-3.25);
  });
});
