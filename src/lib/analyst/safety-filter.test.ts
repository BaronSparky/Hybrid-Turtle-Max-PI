import { describe, expect, it } from 'vitest';
import {
  stripSensitiveData,
  checkResponseSafety,
  checkForFabricatedNumbers,
} from './safety-filter';

// ── stripSensitiveData ──

describe('stripSensitiveData', () => {
  it('strips NEXTAUTH_SECRET', () => {
    const input = 'Config: NEXTAUTH_SECRET=abc123secret456';
    expect(stripSensitiveData(input)).toContain('[REDACTED]');
    expect(stripSensitiveData(input)).not.toContain('abc123secret456');
  });

  it('strips TELEGRAM_BOT_TOKEN', () => {
    const input = 'TELEGRAM_BOT_TOKEN=123456:ABCdefGHI';
    expect(stripSensitiveData(input)).toContain('[REDACTED]');
    expect(stripSensitiveData(input)).not.toContain('123456:ABCdefGHI');
  });

  it('strips Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123';
    expect(stripSensitiveData(input)).toContain('[REDACTED]');
    expect(stripSensitiveData(input)).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('strips API keys', () => {
    const input = 'api_key=sk_live_1234567890abcdef';
    expect(stripSensitiveData(input)).toContain('[REDACTED]');
    expect(stripSensitiveData(input)).not.toContain('sk_live_1234567890abcdef');
  });

  it('strips password fields', () => {
    const input = 'password=mysecretpassword123';
    expect(stripSensitiveData(input)).toContain('[REDACTED]');
    expect(stripSensitiveData(input)).not.toContain('mysecretpassword123');
  });

  it('leaves normal text intact', () => {
    const input = 'The market regime is BULLISH with ADX at 25.3';
    expect(stripSensitiveData(input)).toBe(input);
  });

  it('handles multiple sensitive values in one string', () => {
    const input = 'NEXTAUTH_SECRET=abc TELEGRAM_BOT_TOKEN=def api_key=ghi';
    const cleaned = stripSensitiveData(input);
    expect(cleaned).not.toContain('abc');
    expect(cleaned).not.toContain('def');
    expect(cleaned).not.toContain('ghi');
  });
});

// ── checkResponseSafety ──

describe('checkResponseSafety', () => {
  it('marks clean response as safe', () => {
    const response = 'The system is in BULLISH regime with 3 open positions.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('always prepends advisory disclaimer', () => {
    const response = 'Everything looks normal.';
    const result = checkResponseSafety(response);
    expect(result.cleaned).toContain('Advisory only');
    expect(result.cleaned).toContain('Everything looks normal.');
  });

  it('flags "buy now" as unsafe', () => {
    const response = 'You should buy now while the price is low.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('buy now'))).toBe(true);
  });

  it('flags "sell now" as unsafe', () => {
    const response = 'I suggest you sell now to lock in profits.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  it('flags "execute the trade" as unsafe', () => {
    const response = 'Go ahead and execute the trade on AAPL.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  it('flags "move your stop to" as unsafe', () => {
    const response = 'I recommend you move your stop to 145.50.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  it('flags "override the gate" as unsafe', () => {
    const response = 'You could override the gate to push this through.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  it('flags "disable the kill switch" as unsafe', () => {
    const response = 'Just disable the kill switch and proceed.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  it('flags "you should buy" as unsafe', () => {
    const response = 'Based on the data, you should buy MSFT.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  it('flags "ignore the risk gate" as unsafe', () => {
    const response = 'You can ignore the risk gate here.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(false);
  });

  it('allows discussing buy/sell in descriptive context', () => {
    // "buy" without "buy now" / "you should buy" pattern
    const response = 'The system has identified 2 buy candidates that met the scan criteria.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(true);
  });

  it('allows discussing stops without suggesting changes', () => {
    const response = 'The stop is currently at the BREAKEVEN level, protecting your entry price.';
    const result = checkResponseSafety(response);
    expect(result.safe).toBe(true);
  });
});

// ── checkForFabricatedNumbers ──

describe('checkForFabricatedNumbers', () => {
  it('returns no warnings when all numbers match context', () => {
    const response = 'The equity is £10000 with open risk at 5.5%.';
    const contextNumbers = [10000, 5.5];
    const warnings = checkForFabricatedNumbers(response, contextNumbers);
    expect(warnings).toHaveLength(0);
  });

  it('warns about numbers not in context', () => {
    const response = 'The equity is £50000 which is very high.';
    const contextNumbers = [10000, 5.5];
    const warnings = checkForFabricatedNumbers(response, contextNumbers);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes('50000'))).toBe(true);
  });

  it('allows small numbers without context match', () => {
    const response = 'There are 3 positions and 2 candidates.';
    const contextNumbers = [10000]; // 3 and 2 are < 10, so allowed
    const warnings = checkForFabricatedNumbers(response, contextNumbers);
    expect(warnings).toHaveLength(0);
  });

  it('handles percentage values', () => {
    const response = 'Risk utilisation is at 75.3%.';
    const contextNumbers = [75.3, 10000];
    const warnings = checkForFabricatedNumbers(response, contextNumbers);
    expect(warnings).toHaveLength(0);
  });

  it('warns about fabricated percentages', () => {
    const response = 'The win rate is 92.5% which is excellent.';
    const contextNumbers = [10000, 5.5, 3];
    const warnings = checkForFabricatedNumbers(response, contextNumbers);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('handles dollar amounts', () => {
    const response = 'The position is worth $1500.';
    const contextNumbers = [1500];
    const warnings = checkForFabricatedNumbers(response, contextNumbers);
    expect(warnings).toHaveLength(0);
  });
});
