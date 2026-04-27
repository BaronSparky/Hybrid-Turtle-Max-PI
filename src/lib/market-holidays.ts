/**
 * DEPENDENCIES
 * Consumed by: src/cron/auto-trade.ts, src/cron/nightly.ts, src/cron/midday-sync.ts, src/lib/execution-mode.ts
 * Risk-sensitive: NO — advisory only, does not block anything by itself
 * Notes: Known US/UK market holidays for the current year.
 *        Updated annually. Dates are in YYYY-MM-DD format.
 *        Markets close on these dates; cron jobs should skip or reduce scope.
 */

import { getUKDateString } from './uk-time';

/** Holiday entry with date and label */
export interface MarketHoliday {
  date: string; // YYYY-MM-DD
  label: string;
  markets: ('US' | 'UK')[];
  /** If set, the market closes early on this date (e.g. '13:00' ET for US half-days) */
  earlyClose?: string;
}

/**
 * Known market holidays. Updated annually.
 * Sources: NYSE, LSE published holiday calendars.
 */
const HOLIDAYS_2026: MarketHoliday[] = [
  // US holidays
  { date: '2026-01-01', label: "New Year's Day", markets: ['US', 'UK'] },
  { date: '2026-01-19', label: 'Martin Luther King Jr. Day', markets: ['US'] },
  { date: '2026-02-16', label: "Presidents' Day", markets: ['US'] },
  { date: '2026-04-03', label: 'Good Friday', markets: ['US', 'UK'] },
  { date: '2026-04-06', label: 'Easter Monday', markets: ['UK'] },
  { date: '2026-05-04', label: 'Early May Bank Holiday', markets: ['UK'] },
  { date: '2026-05-25', label: 'Spring Bank Holiday', markets: ['UK'] },
  { date: '2026-05-25', label: 'Memorial Day', markets: ['US'] },
  { date: '2026-07-03', label: 'Independence Day (observed)', markets: ['US'] },
  { date: '2026-08-31', label: 'Summer Bank Holiday', markets: ['UK'] },
  { date: '2026-09-07', label: 'Labor Day', markets: ['US'] },
  { date: '2026-11-26', label: 'Thanksgiving Day', markets: ['US'] },
  { date: '2026-11-27', label: 'Black Friday (early close 1pm ET)', markets: ['US'], earlyClose: '13:00' },
  { date: '2026-12-24', label: 'Christmas Eve (early close 1pm ET)', markets: ['US'], earlyClose: '13:00' },
  { date: '2026-12-25', label: 'Christmas Day', markets: ['US', 'UK'] },
  { date: '2026-12-26', label: 'Boxing Day', markets: ['UK'] },
  { date: '2026-12-28', label: 'Boxing Day (substitute)', markets: ['UK'] },
];

const HOLIDAYS_2027: MarketHoliday[] = [
  { date: '2027-01-01', label: "New Year's Day", markets: ['US', 'UK'] },
  { date: '2027-01-18', label: 'Martin Luther King Jr. Day', markets: ['US'] },
  { date: '2027-02-15', label: "Presidents' Day", markets: ['US'] },
  { date: '2027-03-26', label: 'Good Friday', markets: ['US', 'UK'] },
  { date: '2027-03-29', label: 'Easter Monday', markets: ['UK'] },
  { date: '2027-05-03', label: 'Early May Bank Holiday', markets: ['UK'] },
  { date: '2027-05-31', label: 'Spring Bank Holiday / Memorial Day', markets: ['US', 'UK'] },
  { date: '2027-07-05', label: 'Independence Day (observed)', markets: ['US'] },
  { date: '2027-08-30', label: 'Summer Bank Holiday', markets: ['UK'] },
  { date: '2027-09-06', label: 'Labor Day', markets: ['US'] },
  { date: '2027-11-25', label: 'Thanksgiving Day', markets: ['US'] },
  { date: '2027-11-26', label: 'Black Friday (early close 1pm ET)', markets: ['US'], earlyClose: '13:00' },
  { date: '2027-12-24', label: 'Christmas Eve (early close)', markets: ['US'], earlyClose: '13:00' },
  { date: '2027-12-27', label: 'Christmas Day (substitute)', markets: ['US', 'UK'] },
  { date: '2027-12-28', label: 'Boxing Day (substitute)', markets: ['UK'] },
];

const HOLIDAYS_2028: MarketHoliday[] = [
  { date: '2028-01-03', label: "New Year's Day (substitute)", markets: ['UK'] },
  { date: '2028-01-17', label: 'Martin Luther King Jr. Day', markets: ['US'] },
  { date: '2028-02-21', label: "Presidents' Day", markets: ['US'] },
  { date: '2028-04-14', label: 'Good Friday', markets: ['US', 'UK'] },
  { date: '2028-04-17', label: 'Easter Monday', markets: ['UK'] },
  { date: '2028-05-01', label: 'Early May Bank Holiday', markets: ['UK'] },
  { date: '2028-05-29', label: 'Spring Bank Holiday / Memorial Day', markets: ['US', 'UK'] },
  { date: '2028-07-04', label: 'Independence Day', markets: ['US'] },
  { date: '2028-08-28', label: 'Summer Bank Holiday', markets: ['UK'] },
  { date: '2028-09-04', label: 'Labor Day', markets: ['US'] },
  { date: '2028-11-23', label: 'Thanksgiving Day', markets: ['US'] },
  { date: '2028-11-24', label: 'Black Friday (early close 1pm ET)', markets: ['US'], earlyClose: '13:00' },
  { date: '2028-12-25', label: 'Christmas Day', markets: ['US', 'UK'] },
  { date: '2028-12-26', label: 'Boxing Day', markets: ['UK'] },
];

const ALL_HOLIDAYS = [...HOLIDAYS_2026, ...HOLIDAYS_2027, ...HOLIDAYS_2028];

// Pre-build lookup sets for fast O(1) checks
const US_HOLIDAY_SET = new Set(
  ALL_HOLIDAYS.filter(h => h.markets.includes('US')).map(h => h.date)
);
const UK_HOLIDAY_SET = new Set(
  ALL_HOLIDAYS.filter(h => h.markets.includes('UK')).map(h => h.date)
);
const ANY_HOLIDAY_MAP = new Map<string, MarketHoliday>(
  ALL_HOLIDAYS.map(h => [h.date, h])
);

/**
 * Check if a date is a market holiday.
 * @param date - Date or ISO date string (YYYY-MM-DD)
 * @param market - 'US', 'UK', or undefined for any market
 */
export function isMarketHoliday(date: Date | string, market?: 'US' | 'UK'): boolean {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  if (!market) return ANY_HOLIDAY_MAP.has(dateStr);
  return market === 'US' ? US_HOLIDAY_SET.has(dateStr) : UK_HOLIDAY_SET.has(dateStr);
}

/**
 * Get the holiday details for a given date, or null if it's a trading day.
 */
export function getMarketHoliday(date: Date | string): MarketHoliday | null {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  return ANY_HOLIDAY_MAP.get(dateStr) ?? null;
}

/**
 * Check if today (UK timezone) is a market holiday for any market.
 */
export function isTodayMarketHoliday(): { isHoliday: boolean; holiday: MarketHoliday | null } {
  const dateStr = getUKDateString();
  const holiday = getMarketHoliday(dateStr);
  return { isHoliday: !!holiday, holiday };
}

/**
 * Check if today is an early-close half-day (e.g. Black Friday, Christmas Eve).
 * Returns the earlyClose time string (e.g. '13:00') or null.
 */
export function isEarlyCloseDay(date?: Date | string): string | null {
  const dateStr = date
    ? (typeof date === 'string' ? date : date.toISOString().split('T')[0])
    : getUKDateString();
  const holiday = ANY_HOLIDAY_MAP.get(dateStr);
  return holiday?.earlyClose ?? null;
}

/**
 * Check if the holiday calendar covers the given year.
 * Returns a warning message if no holidays are defined for that year, or null if covered.
 * Use in January nightly runs to prompt annual calendar updates.
 */
export function checkHolidayCoverage(year?: number): string | null {
  const targetYear = year ?? new Date().getFullYear();
  const prefix = `${targetYear}-`;
  const hasEntries = ALL_HOLIDAYS.some(h => h.date.startsWith(prefix));
  if (!hasEntries) {
    return `⚠ No market holidays defined for ${targetYear}. Update src/lib/market-holidays.ts to avoid missed holiday detection.`;
  }
  return null;
}
