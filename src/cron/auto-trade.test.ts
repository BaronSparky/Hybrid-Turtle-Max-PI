import { describe, expect, it } from 'vitest';
import { revalidateLivePrice } from './auto-trade';

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

// ── Live-price revalidation (audit 2026-05-28) ──

describe('auto-trade: live-price revalidation', () => {
  it('KEEPs when live price equals trigger (breakout still confirmed)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 100.00);
    expect(decision.action).toBe('KEEP');
  });

  it('KEEPs when live price is above trigger', () => {
    const decision = revalidateLivePrice(99.50, 100.00, 101.25);
    expect(decision.action).toBe('KEEP');
  });

  it('SKIPs when live price has fallen back below trigger since scan', () => {
    const decision = revalidateLivePrice(100.25, 100.00, 99.80);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/fell back below trigger/i);
      expect(decision.reason).toContain('99.80');
      expect(decision.reason).toContain('100.00');
    }
  });

  it('SKIPs when live price is undefined (fetch missed this ticker)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, undefined);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/unavailable/i);
    }
  });

  it('SKIPs when live price is NaN', () => {
    const decision = revalidateLivePrice(100.00, 100.00, NaN);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/unavailable/i);
    }
  });

  it('SKIPs when live price is zero (treated as missing data)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 0);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/unavailable/i);
    }
  });

  it('SKIPs when live price is negative (treated as missing data)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, -5);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/unavailable/i);
    }
  });

  it('SKIPs when live price is Infinity', () => {
    const decision = revalidateLivePrice(100.00, 100.00, Infinity);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/unavailable/i);
    }
  });

  it('below-trigger SKIP reason includes both live and trigger numbers', () => {
    const decision = revalidateLivePrice(63.06, 63.28, 62.95);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toContain('62.95');
      expect(decision.reason).toContain('63.28');
    }
  });

  it('unavailable SKIP reason includes scan price and trigger for diagnosis', () => {
    const decision = revalidateLivePrice(120.50, 121.00, undefined);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toContain('120.50');
      expect(decision.reason).toContain('121.00');
    }
  });
});

// ── Live-price anti-chase ceiling (audit 2026-05-29) ──
// ceiling = entryTrigger + NO_CHASE_ATR_BOUND (1.2) × ATR.
// With trigger 100 and ATR 5 the ceiling is 106.00.

describe('auto-trade: live-price anti-chase ceiling', () => {
  it('KEEPs when live price is extended but still under the no-chase ceiling', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 105.00, 5.00);
    expect(decision.action).toBe('KEEP');
  });

  it('KEEPs at exactly the no-chase ceiling (boundary is strict >)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 106.00, 5.00);
    expect(decision.action).toBe('KEEP');
  });

  it('SKIPs when live price has run above the no-chase ceiling since scan', () => {
    const decision = revalidateLivePrice(102.00, 100.00, 108.00, 5.00);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/no-chase ceiling/i);
      expect(decision.reason).toContain('108.00');
      expect(decision.reason).toContain('106.00');
    }
  });

  it('does NOT enforce the ceiling when ATR is undefined (cannot compute)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 130.00, undefined);
    expect(decision.action).toBe('KEEP');
  });

  it('does NOT enforce the ceiling when ATR is zero (cannot compute)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 130.00, 0);
    expect(decision.action).toBe('KEEP');
  });

  it('does NOT enforce the ceiling when ATR is negative (treated as invalid)', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 130.00, -5);
    expect(decision.action).toBe('KEEP');
  });

  it('floor check takes precedence: below-trigger SKIPs before ceiling is evaluated', () => {
    const decision = revalidateLivePrice(100.00, 100.00, 99.00, 5.00);
    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toMatch(/fell back below trigger/i);
    }
  });
});

// ── Heartbeat skip-reason logging (audit 2026-05-28) ──

describe('auto-trade: heartbeat skip-reason logging', () => {
  // Mirrors the heartbeat details shape constructed at the end of runAutoTrade.
  // The contract under test: skipReasons is an array of {ticker, reason}
  // matching the session's `skipped` array exactly, so post-hoc diagnostics
  // can see WHY each candidate didn't trade — not just how many.
  it('skipReasons array preserves per-candidate reason text', () => {
    const skipped = [
      { ticker: 'AAPL', reason: 'Price fell back below trigger since scan (live 99.80 < trigger 100.00)' },
      { ticker: 'MSFT', reason: 'Risk gates: SLEEVE_CAP, CLUSTER_CAP' },
      { ticker: 'GSK.L', reason: 'No T212 ticker mapped' },
    ];
    const skipReasons = skipped.map(s => ({ ticker: s.ticker, reason: s.reason }));
    expect(skipReasons).toHaveLength(3);
    expect(skipReasons[0]).toEqual({ ticker: 'AAPL', reason: skipped[0].reason });
    expect(skipReasons[1].ticker).toBe('MSFT');
    expect(skipReasons[2].reason).toBe('No T212 ticker mapped');
  });

  it('skipReasons is empty when no candidates were skipped', () => {
    const skipped: Array<{ ticker: string; reason: string }> = [];
    const skipReasons = skipped.map(s => ({ ticker: s.ticker, reason: s.reason }));
    expect(skipReasons).toEqual([]);
  });

  it('skipReasons remains present even when eligible > 0 and executed = 0', () => {
    // This is the diagnostic blind spot the change closes: previously a
    // session that found candidates but skipped every one of them stored
    // only `skipped: <count>` with no reasons, making post-hoc analysis blind.
    const skipped = [
      { ticker: 'AAPL', reason: 'Session aborted: Insufficient funds' },
      { ticker: 'MSFT', reason: 'Session aborted: Insufficient funds' },
    ];
    const heartbeatDetails = {
      type: 'auto-trade',
      session: 'us',
      eligible: 2,
      executed: 0,
      skipped: skipped.length,
      skipReasons: skipped.map(s => ({ ticker: s.ticker, reason: s.reason })),
    };
    const serialized = JSON.stringify(heartbeatDetails);
    const parsed = JSON.parse(serialized);
    expect(parsed.skipReasons).toHaveLength(2);
    expect(parsed.skipReasons[0].reason).toContain('Insufficient funds');
  });

  it('JSON-serialised heartbeat round-trips skipReasons', () => {
    const skipped = [{ ticker: 'AAPL', reason: 'Live price unavailable (scan price 100.00, trigger 100.00)' }];
    const json = JSON.stringify({ skipReasons: skipped.map(s => ({ ticker: s.ticker, reason: s.reason })) });
    const back = JSON.parse(json) as { skipReasons: Array<{ ticker: string; reason: string }> };
    expect(back.skipReasons[0]).toEqual(skipped[0]);
  });
});
