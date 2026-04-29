import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiClientError, formatApiError } from './api-client';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('apiRequest network failure handling', () => {
  it('wraps fetch TypeError as NETWORK_UNREACHABLE ApiClientError', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    await expect(apiRequest('/api/scan')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 0,
      code: 'NETWORK_UNREACHABLE',
      retryable: true,
      message: 'Dashboard server unreachable',
    });
  });

  it('wraps AbortError as REQUEST_ABORTED ApiClientError', async () => {
    const abortErr = new DOMException('aborted', 'AbortError');
    global.fetch = vi.fn().mockRejectedValue(abortErr) as unknown as typeof fetch;

    await expect(apiRequest('/api/scan')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 0,
      code: 'REQUEST_ABORTED',
    });
  });

  it('parses structured server error envelopes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        ok: false,
        error: { code: 'SCAN_FAILED', message: 'Scan failed', details: 'Yahoo 429', retryable: true },
      }),
    }) as unknown as typeof fetch;

    try {
      await apiRequest('/api/scan');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const e = err as ApiClientError;
      expect(e.status).toBe(500);
      expect(e.code).toBe('SCAN_FAILED');
      expect(e.details).toBe('Yahoo 429');
      expect(e.retryable).toBe(true);
    }
  });

  it('returns parsed JSON payload on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [], totalScanned: 0 }),
    }) as unknown as typeof fetch;

    const data = await apiRequest<{ candidates: unknown[]; totalScanned: number }>('/api/scan');
    expect(data).toEqual({ candidates: [], totalScanned: 0 });
  });
});

describe('formatApiError', () => {
  it('returns actionable message for NETWORK_UNREACHABLE', () => {
    const err = new ApiClientError('Dashboard server unreachable', 0, 'NETWORK_UNREACHABLE');
    expect(formatApiError(err)).toBe('Dashboard server is not reachable. Make sure start.bat is running, then retry.');
  });

  it('returns short message for REQUEST_ABORTED', () => {
    const err = new ApiClientError('Request aborted', 0, 'REQUEST_ABORTED');
    expect(formatApiError(err)).toBe('Request was cancelled.');
  });

  it('returns err.message for other ApiClientErrors', () => {
    const err = new ApiClientError('Scan failed', 500, 'SCAN_FAILED');
    expect(formatApiError(err)).toBe('Scan failed');
  });

  it('returns err.message for plain Error', () => {
    expect(formatApiError(new Error('bad'))).toBe('bad');
  });

  it('returns fallback for non-Error values', () => {
    expect(formatApiError('oops', 'Fallback msg')).toBe('Fallback msg');
  });
});
