import { describe, expect, it } from 'vitest';
import {
  OPERATING_MODES,
  type OperatingMode,
  type OperatingModeConfig,
} from '@/types';

describe('operating-mode types', () => {
  const ALL_MODES: OperatingMode[] = ['NORMAL', 'AGGRESSIVE_QUALITY', 'CAPITAL_PRESERVATION', 'RESEARCH'];

  it('defines all four operating modes', () => {
    for (const mode of ALL_MODES) {
      expect(OPERATING_MODES[mode]).toBeDefined();
      expect(OPERATING_MODES[mode].name).toBeTruthy();
      expect(OPERATING_MODES[mode].description).toBeTruthy();
    }
  });

  it('NORMAL mode allows buying and pyramiding', () => {
    const cfg = OPERATING_MODES.NORMAL;
    expect(cfg.canBuy).toBe(true);
    expect(cfg.canPyramid).toBe(true);
    expect(cfg.requiresAGrade).toBe(false);
    expect(cfg.stricterEntry).toBe(false);
  });

  it('AGGRESSIVE_QUALITY mode allows buying but requires A-grade', () => {
    const cfg = OPERATING_MODES.AGGRESSIVE_QUALITY;
    expect(cfg.canBuy).toBe(true);
    expect(cfg.canPyramid).toBe(true);
    expect(cfg.requiresAGrade).toBe(true);
    expect(cfg.stricterEntry).toBe(true);
  });

  it('CAPITAL_PRESERVATION mode blocks buying and pyramiding', () => {
    const cfg = OPERATING_MODES.CAPITAL_PRESERVATION;
    expect(cfg.canBuy).toBe(false);
    expect(cfg.canPyramid).toBe(false);
  });

  it('RESEARCH mode blocks all execution', () => {
    const cfg = OPERATING_MODES.RESEARCH;
    expect(cfg.canBuy).toBe(false);
    expect(cfg.canPyramid).toBe(false);
  });

  it('no mode has undocumented properties', () => {
    const expectedKeys: (keyof OperatingModeConfig)[] = [
      'name', 'canBuy', 'canPyramid', 'requiresAGrade', 'stricterEntry', 'description',
    ];
    for (const mode of ALL_MODES) {
      const cfg = OPERATING_MODES[mode];
      const keys = Object.keys(cfg);
      for (const key of keys) {
        expect(expectedKeys).toContain(key);
      }
    }
  });

  it('operating modes are independent of risk profiles', () => {
    // Operating modes control behaviour, not sizing — no riskPerTrade, maxPositions, maxOpenRisk
    for (const mode of ALL_MODES) {
      const cfg = OPERATING_MODES[mode] as unknown as Record<string, unknown>;
      expect(cfg.riskPerTrade).toBeUndefined();
      expect(cfg.maxPositions).toBeUndefined();
      expect(cfg.maxOpenRisk).toBeUndefined();
    }
  });
});
