import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

// Mock fs to avoid real file I/O
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

const TREND_FILE = path.join(process.cwd(), 'data', 'sentiment-trends.json');

import {
  recordSentiment,
  recordBatchSentiment,
  getSentimentTrend,
  getBatchSentimentTrends,
} from './sentiment-tracker';

describe('sentiment-tracker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  describe('recordSentiment', () => {
    it('creates new entry for a fresh ticker', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      await recordSentiment('AAPL', 'POSITIVE', 'HIGH');

      expect(fs.writeFile).toHaveBeenCalledOnce();
      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.tickers.AAPL).toHaveLength(1);
      expect(written.tickers.AAPL[0].sentiment).toBe('POSITIVE');
      expect(written.tickers.AAPL[0].confidence).toBe('HIGH');
    });

    it('updates existing entry for the same day', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const existing = {
        tickers: {
          AAPL: [{ sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 1000, date: today }],
        },
      };
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(existing));

      await recordSentiment('AAPL', 'NEGATIVE', 'HIGH');

      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.tickers.AAPL).toHaveLength(1); // Updated, not appended
      expect(written.tickers.AAPL[0].sentiment).toBe('NEGATIVE');
    });

    it('appends entry for a new day', async () => {
      const existing = {
        tickers: {
          AAPL: [{ sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 1000, date: '2025-01-01' }],
        },
      };
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(existing));

      await recordSentiment('AAPL', 'POSITIVE', 'HIGH');

      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.tickers.AAPL).toHaveLength(2);
    });

    it('caps entries at 30 per ticker', async () => {
      const entries = Array.from({ length: 31 }, (_, i) => ({
        sentiment: 'NEUTRAL',
        confidence: 'LOW',
        timestamp: 1000 + i,
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      }));
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ tickers: { AAPL: entries } })
      );

      await recordSentiment('AAPL', 'POSITIVE', 'HIGH');

      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.tickers.AAPL.length).toBeLessThanOrEqual(30);
    });
  });

  describe('recordBatchSentiment', () => {
    it('records multiple tickers at once', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      await recordBatchSentiment([
        { ticker: 'AAPL', sentiment: 'POSITIVE', confidence: 'HIGH' },
        { ticker: 'MSFT', sentiment: 'NEGATIVE', confidence: 'LOW' },
      ]);

      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.tickers.AAPL).toHaveLength(1);
      expect(written.tickers.MSFT).toHaveLength(1);
      expect(written.tickers.AAPL[0].sentiment).toBe('POSITIVE');
      expect(written.tickers.MSFT[0].sentiment).toBe('NEGATIVE');
    });
  });

  describe('getSentimentTrend', () => {
    it('returns null for unknown ticker', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const result = await getSentimentTrend('UNKNOWN');
      expect(result).toBeNull();
    });

    it('returns STABLE for single entry', async () => {
      const store = {
        tickers: {
          AAPL: [{ sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 1000, date: '2025-01-01' }],
        },
      };
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(store));

      const result = await getSentimentTrend('AAPL');
      expect(result).not.toBeNull();
      expect(result!.current).toBe('POSITIVE');
      expect(result!.direction).toBe('STABLE');
      expect(result!.daysCovered).toBe(1);
    });

    it('returns IMPROVING when sentiment shifts from NEGATIVE to POSITIVE', async () => {
      const entries = [
        { sentiment: 'NEGATIVE', confidence: 'HIGH', timestamp: 1, date: '2025-01-01' },
        { sentiment: 'NEGATIVE', confidence: 'HIGH', timestamp: 2, date: '2025-01-02' },
        { sentiment: 'NEGATIVE', confidence: 'HIGH', timestamp: 3, date: '2025-01-03' },
        { sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 4, date: '2025-01-04' },
        { sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 5, date: '2025-01-05' },
        { sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 6, date: '2025-01-06' },
      ];
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ tickers: { AAPL: entries } })
      );

      const result = await getSentimentTrend('AAPL');
      expect(result!.direction).toBe('IMPROVING');
    });

    it('returns DETERIORATING when sentiment shifts from POSITIVE to NEGATIVE', async () => {
      const entries = [
        { sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 1, date: '2025-01-01' },
        { sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 2, date: '2025-01-02' },
        { sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 3, date: '2025-01-03' },
        { sentiment: 'NEGATIVE', confidence: 'HIGH', timestamp: 4, date: '2025-01-04' },
        { sentiment: 'NEGATIVE', confidence: 'HIGH', timestamp: 5, date: '2025-01-05' },
        { sentiment: 'NEGATIVE', confidence: 'HIGH', timestamp: 6, date: '2025-01-06' },
      ];
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ tickers: { AAPL: entries } })
      );

      const result = await getSentimentTrend('AAPL');
      expect(result!.direction).toBe('DETERIORATING');
    });

    it('returns STABLE when sentiment is consistent', async () => {
      const entries = [
        { sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 1, date: '2025-01-01' },
        { sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 2, date: '2025-01-02' },
        { sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 3, date: '2025-01-03' },
        { sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 4, date: '2025-01-04' },
        { sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 5, date: '2025-01-05' },
        { sentiment: 'NEUTRAL', confidence: 'LOW', timestamp: 6, date: '2025-01-06' },
      ];
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ tickers: { AAPL: entries } })
      );

      const result = await getSentimentTrend('AAPL');
      expect(result!.direction).toBe('STABLE');
    });
  });

  describe('getBatchSentimentTrends', () => {
    it('returns trends for known tickers only', async () => {
      const store = {
        tickers: {
          AAPL: [{ sentiment: 'POSITIVE', confidence: 'HIGH', timestamp: 1000, date: '2025-01-01' }],
        },
      };
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(store));

      const result = await getBatchSentimentTrends(['AAPL', 'UNKNOWN']);
      expect(result.size).toBe(1);
      expect(result.has('AAPL')).toBe(true);
      expect(result.has('UNKNOWN')).toBe(false);
    });
  });
});
