/**
 * DEPENDENCIES
 * Consumed by: TodayPanel, BuyConfirmationModal, /api/positions, /api/dashboard/today-directive
 * Consumes: @/types (ExecutionMode)
 * Risk-sensitive: YES — determines whether entries are allowed
 * Last modified: 2026-04-29
 * Notes: Single source of truth for entry logic.
 *        Mon-Fri are all execution days (regime-gated). Weekends are blocked.
 */

import type { ExecutionMode } from '@/types';

export interface ExecutionModeResult {
  mode: ExecutionMode;
  canEnter: boolean;
  reason: string;
  isPlanned: boolean;
}

/**
 * Determines the current execution mode based on day and regime.
 * Mon-Fri: entries allowed unless regime is BEARISH.
 * Sat-Sun: no entries (markets closed / planning).
 * @param dayOfWeek 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 * @param regime Current market regime
 */
export function getExecutionMode(
  dayOfWeek: number,
  regime: string
): ExecutionModeResult {
  // Weekend — markets closed
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      mode: 'PLANNING',
      canEnter: false,
      reason: dayOfWeek === 0
        ? 'Planning day. Run the scan and prepare for the week.'
        : 'Weekend. Markets closed.',
      isPlanned: false,
    };
  }

  // Monday–Friday — execution allowed, regime-gated
  const blocked = regime === 'BEARISH';
  return {
    mode: 'PLANNED',
    canEnter: !blocked,
    reason: blocked
      ? 'Regime is BEARISH. Entries blocked.'
      : 'Execution day. Trade when candidates are ready.',
    isPlanned: true,
  };
}

/**
 * Get the current execution mode using UK time.
 */
export function getCurrentExecutionMode(regime: string): ExecutionModeResult {
  const ukDay = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'Europe/London',
  });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[ukDay] ?? 0;
  return getExecutionMode(dayOfWeek, regime);
}
