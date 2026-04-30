import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rehydrateScanCacheFromDisk: vi.fn(),
  rehydrateModulesCacheFromDisk: vi.fn(),
  rehydrateQuoteCacheFromDisk: vi.fn(),
  rehydrateT212PriceCache: vi.fn(),
  fetchT212LivePrices: vi.fn(),
}));

vi.mock('./scan-cache', () => ({
  rehydrateScanCacheFromDisk: mocks.rehydrateScanCacheFromDisk,
}));

vi.mock('./modules-cache', () => ({
  rehydrateModulesCacheFromDisk: mocks.rehydrateModulesCacheFromDisk,
}));

vi.mock('./market-data', () => ({
  rehydrateQuoteCacheFromDisk: mocks.rehydrateQuoteCacheFromDisk,
}));

vi.mock('./position-sync', () => ({
  rehydrateT212PriceCache: mocks.rehydrateT212PriceCache,
  fetchT212LivePrices: mocks.fetchT212LivePrices,
}));

describe('warmCachesOnStartup', () => {
  const originalNextPhase = process.env.NEXT_PHASE;
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as { __cacheWarmupDone?: boolean }).__cacheWarmupDone;

    mocks.rehydrateScanCacheFromDisk.mockResolvedValue(true);
    mocks.rehydrateModulesCacheFromDisk.mockResolvedValue(true);
    mocks.rehydrateQuoteCacheFromDisk.mockResolvedValue(true);
    mocks.rehydrateT212PriceCache.mockResolvedValue(true);
    mocks.fetchT212LivePrices.mockResolvedValue({ VOD: 72.4 });
  });

  afterEach(() => {
    if (originalNextPhase === undefined) {
      delete process.env.NEXT_PHASE;
    } else {
      process.env.NEXT_PHASE = originalNextPhase;
    }
    consoleLog.mockClear();
  });

  afterAll(() => {
    consoleLog.mockRestore();
  });

  it('rehydrates disk caches but skips live T212 pre-warm during production build', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    const { warmCachesOnStartup } = await import('./cache-warmup');

    await warmCachesOnStartup();

    expect(mocks.rehydrateScanCacheFromDisk).toHaveBeenCalledTimes(1);
    expect(mocks.rehydrateModulesCacheFromDisk).toHaveBeenCalledTimes(1);
    expect(mocks.rehydrateQuoteCacheFromDisk).toHaveBeenCalledTimes(1);
    expect(mocks.rehydrateT212PriceCache).toHaveBeenCalledTimes(1);
    expect(mocks.fetchT212LivePrices).not.toHaveBeenCalled();
  });
});
