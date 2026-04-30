import { describe, expect, it } from 'vitest';
import { validateScanCacheResponse, validateSystemReadiness } from '../../scripts/smoke-buy-flow';

describe('validateSystemReadiness', () => {
  it('requires a readiness field', () => {
    expect(validateSystemReadiness({}, false)).toBe('missing readiness field');
  });

  it('rejects blocked readiness by default', () => {
    expect(validateSystemReadiness({ readiness: 'BLOCKED' }, false)).toBe('system BLOCKED (cannot trade)');
  });

  it('accepts blocked readiness for scheduled smoke probes when explicitly allowed', () => {
    expect(validateSystemReadiness({ readiness: 'BLOCKED' }, true)).toBeNull();
  });

  it('accepts non-blocked readiness values', () => {
    expect(validateSystemReadiness({ readiness: 'READY' }, false)).toBeNull();
  });
});

describe('validateScanCacheResponse', () => {
  it('accepts cached scan responses with results', () => {
    expect(validateScanCacheResponse({ results: [] })).toBeNull();
  });

  it('accepts cached scan responses with candidates', () => {
    expect(validateScanCacheResponse({ candidates: [] })).toBeNull();
  });

  it('accepts benign cache miss errors', () => {
    expect(validateScanCacheResponse({ error: { code: 'SCAN_CACHE_MISS' } })).toBeNull();
  });

  it('rejects unexpected scan response shapes', () => {
    expect(validateScanCacheResponse({ totalScanned: 0 })).toBe('scan response missing results/candidates');
  });
});
