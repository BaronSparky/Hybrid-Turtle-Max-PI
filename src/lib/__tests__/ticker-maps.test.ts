import { describe, it, expect } from 'vitest';
import { YAHOO_TICKER_MAP, EODHD_TICKER_MAP, toYahooTicker, toEodhdTicker } from '../ticker-maps';

describe('Shared ticker maps', () => {
  it('YAHOO_TICKER_MAP and EODHD_TICKER_MAP have the same DB tickers', () => {
    const yahooKeys = Object.keys(YAHOO_TICKER_MAP).sort();
    const eodhdKeys = Object.keys(EODHD_TICKER_MAP).sort();
    expect(yahooKeys).toEqual(eodhdKeys);
  });

  it('all Yahoo tickers have exchange suffixes or are renames', () => {
    for (const [db, yahoo] of Object.entries(YAHOO_TICKER_MAP)) {
      const hasExchangeSuffix = /\.[A-Z]{1,5}$/.test(yahoo);
      const isRename = yahoo !== db && !hasExchangeSuffix;
      expect(hasExchangeSuffix || isRename, `${db} → ${yahoo} should have suffix or be a rename`).toBe(true);
    }
  });

  it('toYahooTicker uses yahooTicker override when provided', () => {
    expect(toYahooTicker('WHATEVER', 'CUSTOM.L')).toBe('CUSTOM.L');
  });

  it('toYahooTicker uses map for known tickers', () => {
    expect(toYahooTicker('GSK')).toBe('GSK.L');
    expect(toYahooTicker('SAP')).toBe('SAP.DE');
    expect(toYahooTicker('NVO')).toBe('NOVO-B.CO');
    expect(toYahooTicker('WLTW')).toBe('WTW');
  });

  it('toYahooTicker applies T212 lowercase-l rule', () => {
    expect(toYahooTicker('BARCl')).toBe('BARC.L');
  });

  it('toYahooTicker passes through US tickers', () => {
    expect(toYahooTicker('AAPL')).toBe('AAPL');
    expect(toYahooTicker('MSFT')).toBe('MSFT');
  });

  it('toEodhdTicker uses map for known tickers', () => {
    expect(toEodhdTicker('GSK')).toBe('GSK.LSE');
    expect(toEodhdTicker('SAP')).toBe('SAP.XETRA');
    expect(toEodhdTicker('WLTW')).toBe('WTW');
  });

  it('toEodhdTicker applies T212 lowercase-l rule', () => {
    expect(toEodhdTicker('BARCl')).toBe('BARC.LSE');
  });

  it('toEodhdTicker defaults US tickers to .US suffix', () => {
    expect(toEodhdTicker('AAPL')).toBe('AAPL.US');
    expect(toEodhdTicker('MSFT')).toBe('MSFT.US');
  });

  it('toEodhdTicker converts Yahoo .L to .LSE', () => {
    expect(toEodhdTicker('BARC.L')).toBe('BARC.LSE');
  });

  it('toEodhdTicker converts Yahoo .DE to .XETRA', () => {
    expect(toEodhdTicker('BMW.DE')).toBe('BMW.XETRA');
  });

  it('toEodhdTicker passes through EODHD-compatible suffixes', () => {
    expect(toEodhdTicker('ASML.AS')).toBe('ASML.AS');
    expect(toEodhdTicker('MC.PA')).toBe('MC.PA');
    expect(toEodhdTicker('ROG.SW')).toBe('ROG.SW');
  });
});
