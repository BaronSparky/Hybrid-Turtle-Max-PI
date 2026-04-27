import { describe, expect, it, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';

// Mock fs to avoid real file I/O
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock api-response
vi.mock('@/lib/api-response', () => ({
  apiError: (_status: number, code: string, message: string) => {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status: _status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
}));

import { GET, POST } from '@/app/api/analyst/feedback/route';
import { NextRequest } from 'next/server';

function makeRequest(method: string, body?: object): NextRequest {
  const url = 'http://localhost:3000/api/analyst/feedback';
  if (method === 'GET') {
    return new NextRequest(url, { method: 'GET' });
  }
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/analyst/feedback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  describe('GET', () => {
    it('returns empty summary when no feedback file exists', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const res = await GET();
      const data = await res.json();

      expect(data.total).toBe(0);
      expect(data.summary).toEqual({});
    });

    it('returns aggregated summary from existing entries', async () => {
      const store = {
        entries: [
          { context: 'trade-pulse:AAPL', rating: 'up', model: 'gemma3:4b', timestamp: 1000 },
          { context: 'trade-pulse:AAPL', rating: 'up', model: 'gemma3:4b', timestamp: 2000 },
          { context: 'trade-pulse:AAPL', rating: 'down', model: 'gemma3:4b', timestamp: 3000 },
          { context: 'analytics:Score Lab', rating: 'up', model: 'gemma3:4b', timestamp: 4000 },
        ],
      };
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(store));

      const res = await GET();
      const data = await res.json();

      expect(data.total).toBe(4);
      expect(data.summary['trade-pulse:AAPL']).toEqual({ up: 2, down: 1, lastAt: 3000 });
      expect(data.summary['analytics:Score Lab']).toEqual({ up: 1, down: 0, lastAt: 4000 });
    });
  });

  describe('POST', () => {
    it('saves a valid feedback entry', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const req = makeRequest('POST', {
        context: 'trade-pulse:MSFT',
        rating: 'up',
        model: 'gemma3:4b',
      });
      const res = await POST(req);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.totalEntries).toBe(1);

      // Verify writeFile was called with correct data
      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.entries).toHaveLength(1);
      expect(written.entries[0].context).toBe('trade-pulse:MSFT');
      expect(written.entries[0].rating).toBe('up');
    });

    it('rejects missing context', async () => {
      const req = makeRequest('POST', { rating: 'up' });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('rejects invalid rating', async () => {
      const req = makeRequest('POST', { context: 'test', rating: 'maybe' });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('sanitizes context string', async () => {
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const req = makeRequest('POST', {
        context: 'test<script>alert(1)</script>',
        rating: 'down',
      });
      const res = await POST(req);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.entries[0].context).not.toContain('<script>');
      expect(written.entries[0].context).not.toContain('>');
    });

    it('caps entries at 1000 with FIFO eviction', async () => {
      const entries = Array.from({ length: 1000 }, (_, i) => ({
        context: `ctx-${i}`,
        rating: 'up',
        timestamp: i,
      }));
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ entries })
      );

      const req = makeRequest('POST', { context: 'new-entry', rating: 'down' });
      await POST(req);

      const written = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(written.entries.length).toBeLessThanOrEqual(1000);
      expect(written.entries[written.entries.length - 1].context).toBe('new-entry');
    });

    it('round-trip: POST then GET returns the entry', async () => {
      // Simulate empty store for POST
      (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOENT'));

      const postReq = makeRequest('POST', {
        context: 'analytics:Test Card',
        rating: 'up',
        model: 'llama3:8b',
      });
      await POST(postReq);

      // Capture what was written
      const writtenData = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // Now mock readFile to return what was written
      (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(writtenData);

      const getRes = await GET();
      const data = await getRes.json();

      expect(data.total).toBe(1);
      expect(data.summary['analytics:Test Card']).toBeDefined();
      expect(data.summary['analytics:Test Card'].up).toBe(1);
    });
  });
});
