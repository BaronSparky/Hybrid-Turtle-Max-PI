import { describe, expect, it } from 'vitest';
import { validateSystemReadiness } from '../../scripts/smoke-buy-flow';

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
