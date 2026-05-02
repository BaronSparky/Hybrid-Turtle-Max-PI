import { describe, expect, it } from 'vitest';
import {
  getUKDayOfWeek,
  getUKHour,
  getUKTimeString,
  getUKDateString,
  isUKWeekday,
} from './uk-time';

describe('uk-time helpers', () => {
  describe('getUKDayOfWeek', () => {
    it('returns a number 0–6', () => {
      const day = getUKDayOfWeek();
      expect(day).toBeGreaterThanOrEqual(0);
      expect(day).toBeLessThanOrEqual(6);
      expect(Number.isInteger(day)).toBe(true);
    });

    it('maps 2026-05-02 to Saturday without locale date reparsing', () => {
      expect(getUKDayOfWeek(new Date('2026-05-02T08:43:39.803Z'))).toBe(6);
    });

    it('maps 2026-05-03 to Sunday without locale date reparsing', () => {
      expect(getUKDayOfWeek(new Date('2026-05-03T08:43:39.803Z'))).toBe(0);
    });
  });

  describe('getUKHour', () => {
    it('returns a number 0–23', () => {
      const hour = getUKHour();
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
      expect(Number.isInteger(hour)).toBe(true);
    });
  });

  describe('getUKTimeString', () => {
    it('returns a non-empty string with date-like content', () => {
      const str = getUKTimeString();
      expect(typeof str).toBe('string');
      expect(str.length).toBeGreaterThan(10);
      // Should contain a year (2026 or similar)
      expect(str).toMatch(/\d{4}/);
    });
  });

  describe('getUKDateString', () => {
    it('returns YYYY-MM-DD format', () => {
      const str = getUKDateString();
      expect(str).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns a plausible current year', () => {
      const year = parseInt(getUKDateString().split('-')[0], 10);
      expect(year).toBeGreaterThanOrEqual(2025);
      expect(year).toBeLessThanOrEqual(2030);
    });
  });

  describe('isUKWeekday', () => {
    it('returns a boolean', () => {
      expect(typeof isUKWeekday()).toBe('boolean');
    });

    it('is consistent with getUKDayOfWeek', () => {
      const day = getUKDayOfWeek();
      const weekday = isUKWeekday();
      if (day >= 1 && day <= 5) {
        expect(weekday).toBe(true);
      } else {
        expect(weekday).toBe(false);
      }
    });
  });
});
