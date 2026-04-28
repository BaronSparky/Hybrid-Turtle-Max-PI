import { describe, expect, it } from 'vitest';
import { parseCommand } from './telegram-commands';

describe('parseCommand', () => {
  it('parses /watchlist command', () => {
    expect(parseCommand('/watchlist')).toBe('/watchlist');
  });

  it('parses /feedback command', () => {
    expect(parseCommand('/feedback')).toBe('/feedback');
  });

  it('parses existing commands correctly', () => {
    expect(parseCommand('/status')).toBe('/status');
    expect(parseCommand('/positions')).toBe('/positions');
    expect(parseCommand('/stopsdue')).toBe('/stopsdue');
    expect(parseCommand('/regime')).toBe('/regime');
    expect(parseCommand('/risk')).toBe('/risk');
    expect(parseCommand('/candidates')).toBe('/candidates');
    expect(parseCommand('/analyst')).toBe('/analyst');
    expect(parseCommand('/help')).toBe('/help');
    expect(parseCommand('/start')).toBe('/help');
    expect(parseCommand('/news AAPL')).toBe('/news');
    expect(parseCommand('/ask what is going on?')).toBe('/ask');
    expect(parseCommand('/explain AAPL')).toBe('/explain');
    expect(parseCommand('/scorecard')).toBe('/scorecard');
    expect(parseCommand('/earnings')).toBe('/earnings');
    expect(parseCommand('/briefing')).toBe('/briefing');
    expect(parseCommand('/stops')).toBe('/stopsdue');
    expect(parseCommand('/backtest')).toBe('/backtest');
  });

  it('returns unknown for unrecognized commands', () => {
    expect(parseCommand('/foo')).toBe('unknown');
    expect(parseCommand('hello')).toBe('unknown');
    expect(parseCommand('')).toBe('unknown');
  });

  it('handles case-insensitive and extra whitespace', () => {
    expect(parseCommand('/STATUS')).toBe('/status');
    expect(parseCommand('  /watchlist  ')).toBe('/watchlist');
    expect(parseCommand('/FEEDBACK  ')).toBe('/feedback');
  });
});
