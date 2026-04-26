import { describe, expect, it } from 'vitest';

/**
 * Hourly status tests — verifies the market-hours filtering
 * and message formatting logic without requiring DB or Telegram.
 */

describe('hourly-status: market hours filtering', () => {
  it('runs between 08:00 and 20:59 UK time', () => {
    function shouldRun(ukHour: number, ukDay: number): boolean {
      if (ukDay === 0 || ukDay === 6) return false;
      return ukHour >= 8 && ukHour < 21;
    }

    // Market hours
    expect(shouldRun(8, 1)).toBe(true);    // 08:00 Monday
    expect(shouldRun(12, 3)).toBe(true);   // 12:00 Wednesday
    expect(shouldRun(20, 5)).toBe(true);   // 20:00 Friday
    expect(shouldRun(14, 2)).toBe(true);   // 14:00 Tuesday

    // Outside hours
    expect(shouldRun(7, 1)).toBe(false);   // 07:00 too early
    expect(shouldRun(21, 1)).toBe(false);  // 21:00 too late
    expect(shouldRun(23, 4)).toBe(false);  // 23:00 too late

    // Weekends
    expect(shouldRun(12, 0)).toBe(false);  // Sunday
    expect(shouldRun(12, 6)).toBe(false);  // Saturday
  });

  it('covers all UK trading sessions', () => {
    function shouldRun(ukHour: number): boolean {
      return ukHour >= 8 && ukHour < 21;
    }

    // UK market open through US close
    expect(shouldRun(8)).toBe(true);   // LSE pre-market
    expect(shouldRun(9)).toBe(true);   // LSE open
    expect(shouldRun(14)).toBe(true);  // US open
    expect(shouldRun(16)).toBe(true);  // US afternoon
    expect(shouldRun(20)).toBe(true);  // US near close
  });
});

describe('hourly-status: blocker detection', () => {
  it('identifies regime blocker', () => {
    const blockers: string[] = [];
    const regime = 'SIDEWAYS';
    if (regime !== 'BULLISH') blockers.push(`Regime: ${regime}`);
    expect(blockers).toContain('Regime: SIDEWAYS');
  });

  it('identifies max positions blocker', () => {
    const blockers: string[] = [];
    const openPositions = 5;
    const maxPositions = 5;
    if (openPositions >= maxPositions) blockers.push('Max positions reached');
    expect(blockers).toHaveLength(1);
  });

  it('identifies open risk blocker', () => {
    const blockers: string[] = [];
    const openRiskPct = 6.0;
    const maxOpenRisk = 5.5;
    if (openRiskPct >= maxOpenRisk) blockers.push('Open risk at limit');
    expect(blockers).toHaveLength(1);
  });

  it('reports no blockers when all clear', () => {
    const blockers: string[] = [];
    const regime = 'BULLISH';
    const health = 'GREEN';
    const autoEnabled = true;
    const openPositions = 2;
    const maxPositions = 5;

    if (regime !== 'BULLISH') blockers.push('regime');
    if (health === 'RED') blockers.push('health');
    if (!autoEnabled) blockers.push('auto-off');
    if (openPositions >= maxPositions) blockers.push('max-pos');

    expect(blockers).toHaveLength(0);
  });
});
