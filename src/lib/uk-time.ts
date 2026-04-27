/**
 * DEPENDENCIES
 * Consumed by: src/cron/nightly.ts, src/cron/auto-trade.ts, src/cron/midday-sync.ts, src/cron/hourly-status.ts, src/lib/market-holidays.ts
 * Risk-sensitive: NO
 * Notes: Shared UK timezone helpers for cron jobs. Uses IANA 'Europe/London'
 *        so GMT ↔ BST transitions are handled automatically.
 *        Uses Intl.DateTimeFormat for reliable cross-platform component extraction
 *        (avoids the fragile `new Date(toLocaleString())` round-trip).
 */

const UK_TZ = 'Europe/London';

/** Extract named date/time components in UK timezone. */
function getUKParts(now = new Date()): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

const DAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Return the current day-of-week (0=Sun … 6=Sat) in UK local time.
 */
export function getUKDayOfWeek(): number {
  const parts = getUKParts();
  return DAY_MAP[parts.weekday] ?? new Date().getDay();
}

/**
 * Return the current hour (0–23) in UK local time.
 */
export function getUKHour(): number {
  return parseInt(getUKParts().hour, 10);
}

/**
 * Return the current date/time as a human-readable UK-locale string.
 */
export function getUKTimeString(): string {
  return new Date().toLocaleString('en-GB', { timeZone: UK_TZ, hour12: false });
}

/**
 * Return today's date in YYYY-MM-DD format, UK timezone.
 */
export function getUKDateString(): string {
  const p = getUKParts();
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Check if today is a weekday (Mon–Fri) in UK time.
 */
export function isUKWeekday(): boolean {
  const day = getUKDayOfWeek();
  return day >= 1 && day <= 5;
}
