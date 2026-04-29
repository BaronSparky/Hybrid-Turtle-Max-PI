import { describe, it, expect } from 'vitest';
import {
  shouldSendThrottledAlert,
  pruneThrottleStore,
  type ThrottleStore,
} from './telegram';

const TTL = 60 * 60 * 1000; // 1 hour
const NOW = 1_000_000_000_000;

describe('shouldSendThrottledAlert', () => {
  it('returns true when key has never been sent', () => {
    expect(shouldSendThrottledAlert({}, 'watchdog:dashboard', NOW, TTL)).toBe(true);
  });

  it('returns false when key was sent within the TTL window', () => {
    const store: ThrottleStore = { 'watchdog:dashboard': NOW - TTL / 2 };
    expect(shouldSendThrottledAlert(store, 'watchdog:dashboard', NOW, TTL)).toBe(false);
  });

  it('returns true when key was sent before the TTL window', () => {
    const store: ThrottleStore = { 'watchdog:dashboard': NOW - TTL - 1 };
    expect(shouldSendThrottledAlert(store, 'watchdog:dashboard', NOW, TTL)).toBe(true);
  });

  it('returns true exactly at the TTL boundary', () => {
    const store: ThrottleStore = { 'watchdog:dashboard': NOW - TTL };
    expect(shouldSendThrottledAlert(store, 'watchdog:dashboard', NOW, TTL)).toBe(true);
  });

  it('treats different keys independently', () => {
    const store: ThrottleStore = { 'watchdog:dashboard': NOW };
    expect(shouldSendThrottledAlert(store, 'nightly:fail', NOW, TTL)).toBe(true);
  });
});

describe('pruneThrottleStore', () => {
  it('records the current key with the now timestamp', () => {
    const result = pruneThrottleStore({}, 'watchdog:dashboard', NOW, TTL);
    expect(result['watchdog:dashboard']).toBe(NOW);
  });

  it('keeps other entries that are still within the TTL window', () => {
    const store: ThrottleStore = {
      'nightly:fail': NOW - TTL / 2,
      'watchdog:dashboard': NOW - TTL - 100,
    };
    const result = pruneThrottleStore(store, 'watchdog:dashboard', NOW, TTL);
    expect(result['nightly:fail']).toBe(NOW - TTL / 2);
    expect(result['watchdog:dashboard']).toBe(NOW);
  });

  it('drops entries older than the TTL window', () => {
    const store: ThrottleStore = {
      'old:alert': NOW - TTL - 1,
      'recent:alert': NOW - 100,
    };
    const result = pruneThrottleStore(store, 'watchdog:dashboard', NOW, TTL);
    expect(result['old:alert']).toBeUndefined();
    expect(result['recent:alert']).toBe(NOW - 100);
    expect(result['watchdog:dashboard']).toBe(NOW);
  });

  it('overwrites the existing timestamp for the same key', () => {
    const store: ThrottleStore = { 'watchdog:dashboard': NOW - 5000 };
    const result = pruneThrottleStore(store, 'watchdog:dashboard', NOW, TTL);
    expect(result['watchdog:dashboard']).toBe(NOW);
    expect(Object.keys(result)).toHaveLength(1);
  });
});
