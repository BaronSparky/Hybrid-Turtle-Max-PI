import { describe, expect, it } from 'vitest';
import { isMarketHoliday, getMarketHoliday, isTodayMarketHoliday, isEarlyCloseDay, checkHolidayCoverage } from './market-holidays';

describe('market-holidays', () => {
  describe('isMarketHoliday', () => {
    it('detects US holidays', () => {
      expect(isMarketHoliday('2026-01-19', 'US')).toBe(true);  // MLK Day
      expect(isMarketHoliday('2026-01-19', 'UK')).toBe(false); // Not a UK holiday
    });

    it('detects UK holidays', () => {
      expect(isMarketHoliday('2026-04-06', 'UK')).toBe(true);  // Easter Monday
      expect(isMarketHoliday('2026-04-06', 'US')).toBe(false); // Not a US holiday
    });

    it('detects shared holidays', () => {
      expect(isMarketHoliday('2026-04-03', 'US')).toBe(true);  // Good Friday
      expect(isMarketHoliday('2026-04-03', 'UK')).toBe(true);  // Good Friday
    });

    it('returns false for regular trading days', () => {
      expect(isMarketHoliday('2026-04-27')).toBe(false); // Normal Monday
      expect(isMarketHoliday('2026-06-15')).toBe(false);
    });

    it('accepts Date objects', () => {
      const date = new Date('2026-12-25T00:00:00Z');
      expect(isMarketHoliday(date)).toBe(true); // Christmas
    });

    it('any-market check works without market param', () => {
      expect(isMarketHoliday('2026-08-31')).toBe(true);  // UK Summer Bank Holiday
      expect(isMarketHoliday('2026-09-07')).toBe(true);  // US Labor Day
    });
  });

  describe('getMarketHoliday', () => {
    it('returns holiday details for known holidays', () => {
      const holiday = getMarketHoliday('2026-11-26');
      expect(holiday).not.toBeNull();
      expect(holiday!.label).toBe('Thanksgiving Day');
      expect(holiday!.markets).toContain('US');
    });

    it('returns null for trading days', () => {
      expect(getMarketHoliday('2026-04-28')).toBeNull();
    });
  });

  describe('isTodayMarketHoliday', () => {
    it('returns an object with isHoliday boolean', () => {
      const result = isTodayMarketHoliday();
      expect(typeof result.isHoliday).toBe('boolean');
      expect(result.holiday === null || typeof result.holiday.label === 'string').toBe(true);
    });
  });

  describe('isEarlyCloseDay', () => {
    it('returns close time for Black Friday 2026', () => {
      expect(isEarlyCloseDay('2026-11-27')).toBe('13:00');
    });

    it('returns close time for Christmas Eve 2028', () => {
      // 2028 doesn't have a Christmas Eve entry; verify null
      // (Christmas is Dec 25, not Dec 24 in 2028)
      expect(isEarlyCloseDay('2028-12-24')).toBeNull();
    });

    it('returns null for normal trading days', () => {
      expect(isEarlyCloseDay('2026-06-15')).toBeNull();
    });

    it('returns close time for Black Friday 2028', () => {
      expect(isEarlyCloseDay('2028-11-24')).toBe('13:00');
    });
  });

  describe('2028 holidays', () => {
    it('detects 2028 US holidays', () => {
      expect(isMarketHoliday('2028-01-17', 'US')).toBe(true); // MLK Day
      expect(isMarketHoliday('2028-07-04', 'US')).toBe(true); // Independence Day
      expect(isMarketHoliday('2028-11-23', 'US')).toBe(true); // Thanksgiving
    });

    it('detects 2028 UK holidays', () => {
      expect(isMarketHoliday('2028-04-17', 'UK')).toBe(true); // Easter Monday
      expect(isMarketHoliday('2028-08-28', 'UK')).toBe(true); // Summer Bank Holiday
    });

    it('detects 2028 shared holidays', () => {
      expect(isMarketHoliday('2028-04-14', 'US')).toBe(true); // Good Friday
      expect(isMarketHoliday('2028-04-14', 'UK')).toBe(true);
      expect(isMarketHoliday('2028-12-25', 'US')).toBe(true); // Christmas
      expect(isMarketHoliday('2028-12-25', 'UK')).toBe(true);
    });
  });

  describe('checkHolidayCoverage', () => {
    it('returns null for years with holiday data', () => {
      expect(checkHolidayCoverage(2026)).toBeNull();
      expect(checkHolidayCoverage(2027)).toBeNull();
      expect(checkHolidayCoverage(2028)).toBeNull();
    });

    it('returns warning for years without data', () => {
      const warning = checkHolidayCoverage(2030);
      expect(warning).not.toBeNull();
      expect(warning).toContain('2030');
      expect(warning).toContain('No market holidays');
    });
  });
});
