/**
 * DEPENDENCIES
 * Consumed by: src/cron/watchdog.ts (and future cron alerts)
 * Consumes: nothing
 * Risk-sensitive: NO — typed registry only
 * Notes: Centralizes alert dedupe-key prefixes so different cron jobs use
 *        consistent throttling categories. Add new entries here rather than
 *        inventing strings inline.
 */

export const ALERT_CATEGORY = {
  WATCHDOG_DASHBOARD: 'watchdog:dashboard',
  WATCHDOG_NIGHTLY: 'watchdog:nightly',
  WATCHDOG_MIDDAY: 'watchdog:midday',
  NIGHTLY_FAIL: 'nightly:fail',
  STOP_TRIGGER: 'stop:trigger',
  T212_QUOTA: 't212:quota',
  AUTO_TRADE_CRASH: 'auto-trade:crash',
  AUTO_TRADE_BLOCKED: 'auto-trade:blocked',
  AUTO_TRADE_SCAN_FAIL: 'auto-trade:scan-fail',
  HOURLY_STATUS_FAIL: 'hourly-status:fail',
} as const;

export type AlertCategory = (typeof ALERT_CATEGORY)[keyof typeof ALERT_CATEGORY];

/**
 * Build a stable dedupe key by combining a category prefix with an optional
 * discriminator (e.g. ticker, alert hash). Categories without a discriminator
 * dedupe across all instances within the TTL window.
 */
export function buildAlertKey(category: AlertCategory, discriminator?: string): string {
  return discriminator ? `${category}:${discriminator}` : category;
}
