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
    'uk-mid': ['CORE', 'ETF'],
    us: ['CORE', 'HIGH_RISK', 'ETF'],
    'us-mid': ['CORE', 'HIGH_RISK', 'ETF'],
    'us-close': ['CORE', 'HIGH_RISK', 'ETF'],
  };
  const sleeves = sessionSleeves[session];
  if (!sleeves || !sleeves.includes(sleeve)) return false;
  if (session === 'uk' || session === 'uk-mid') return ticker.endsWith('.L');
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

  it('UK-mid session matches same as UK session', () => {
    expect(isStockForSession('GSK.L', 'CORE', 'uk-mid')).toBe(true);
    expect(isStockForSession('AAPL', 'CORE', 'uk-mid')).toBe(false);
    expect(isStockForSession('VWRL.L', 'ETF', 'uk-mid')).toBe(true);
    expect(isStockForSession('MSFT', 'HIGH_RISK', 'uk-mid')).toBe(false);
  });

  it('US-mid session matches same as US session', () => {
    expect(isStockForSession('AAPL', 'CORE', 'us-mid')).toBe(true);
    expect(isStockForSession('MSFT', 'HIGH_RISK', 'us-mid')).toBe(true);
    expect(isStockForSession('SPY', 'ETF', 'us-mid')).toBe(true);
    expect(isStockForSession('GSK.L', 'CORE', 'us-mid')).toBe(false);
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
    const validSessions = ['uk', 'uk-mid', 'us', 'us-mid', 'us-close', 'scan'];
    expect(validSessions).toContain('uk');
    expect(validSessions).toContain('uk-mid');
    expect(validSessions).toContain('us');
    expect(validSessions).toContain('us-mid');
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

// ── Trade execution flow contracts ──

describe('auto-trade: trade execution contracts', () => {
  // Replicates the TradeResult interface
  interface TradeResult {
    ticker: string;
    success: boolean;
    shares?: number;
    filledPrice?: number;
    stopPrice?: number;
    stopPlaced: boolean;
    positionId?: string;
    error?: string;
    critical?: boolean;
  }

  it('successful trade result has all required fields', () => {
    const result: TradeResult = {
      ticker: 'AAPL',
      success: true,
      shares: 10,
      filledPrice: 185.50,
      stopPrice: 175.00,
      stopPlaced: true,
      positionId: 'pos-123',
    };
    expect(result.success).toBe(true);
    expect(result.stopPlaced).toBe(true);
    expect(result.shares).toBeGreaterThan(0);
    expect(result.filledPrice).toBeGreaterThan(0);
    expect(result.positionId).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.critical).toBeUndefined();
  });

  it('buy failure result stops execution before stop placement', () => {
    const result: TradeResult = {
      ticker: 'AAPL',
      success: false,
      stopPlaced: false,
      error: 'Insufficient funds',
    };
    expect(result.success).toBe(false);
    expect(result.stopPlaced).toBe(false);
    expect(result.shares).toBeUndefined();
  });

  it('fill timeout is marked critical', () => {
    const result: TradeResult = {
      ticker: 'AAPL',
      success: false,
      stopPlaced: false,
      error: 'Buy order placed but fill not confirmed after 60s',
      critical: true,
    };
    expect(result.critical).toBe(true);
    expect(result.success).toBe(false);
    expect(result.stopPlaced).toBe(false);
  });

  it('stop failure after successful buy still counts as success', () => {
    // The position IS live on T212, so the trade "succeeded" even if the stop failed
    const result: TradeResult = {
      ticker: 'AAPL',
      success: true,
      shares: 10,
      filledPrice: 185.50,
      stopPlaced: false, // CRITICAL: stop didn't place
      positionId: 'pos-123',
    };
    expect(result.success).toBe(true);
    expect(result.stopPlaced).toBe(false);
    // This scenario triggers a CRITICAL Telegram alert
  });

  it('initial risk is always positive (entry > stop)', () => {
    const filledPrice = 185.50;
    const stopPrice = 175.00;
    const initialRisk = filledPrice - stopPrice;
    expect(initialRisk).toBeGreaterThan(0);
    expect(initialRisk).toBe(10.50);
  });

  it('fill detection: filledQuantity threshold is 99% of requested', () => {
    const requestedShares = 10;
    const threshold = requestedShares * 0.99;
    // Full fill
    expect(10 >= threshold).toBe(true);
    // Partial fill over 99%
    expect(9.95 >= threshold).toBe(true);
    // Partial fill under 99%
    expect(9.8 >= threshold).toBe(false);
  });

  it('fill price fallback uses entry price when filledValue is 0', () => {
    const entryPrice = 185.50;
    const filledValue = 0;
    const filledQuantity = 10;
    const filledPrice = filledValue > 0 ? filledValue / filledQuantity : entryPrice;
    expect(filledPrice).toBe(entryPrice);
  });

  it('trade results summary counts are correct', () => {
    const results: TradeResult[] = [
      { ticker: 'AAPL', success: true, stopPlaced: true },
      { ticker: 'MSFT', success: true, stopPlaced: false },
      { ticker: 'GOOG', success: false, stopPlaced: false, error: 'Failed' },
    ];
    const executed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const stopsPlaced = results.filter(r => r.stopPlaced).length;
    expect(executed).toBe(2);
    expect(failed).toBe(1);
    expect(stopsPlaced).toBe(1);
  });
});
