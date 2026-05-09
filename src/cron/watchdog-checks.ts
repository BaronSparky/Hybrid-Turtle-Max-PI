/**
 * DEPENDENCIES
 * Consumed by: src/cron/watchdog.ts, src/cron/watchdog-checks.test.ts
 * Consumes: nothing (pure functions over plain inputs)
 * Risk-sensitive: NO — produces alert text only, no state changes
 * Notes: Pure helpers added 2026-05-09 to detect two failure modes that
 *        previously went silent for days (Tue 5 May → Fri 8 May): Windows
 *        Task Scheduler killing auto-trade tasks at PT10M before any buy,
 *        and BULLISH-regime days with valid A-grade candidates but zero
 *        execution attempts. Both are derived from existing data sources
 *        (the audit script + ExecutionLog/Scan tables) so this module
 *        introduces no new state.
 */

export interface AuditFinding {
  severity: string;
  taskName: string;
  reason: string;
  detail: string;
}

/**
 * Detect tasks Windows Task Scheduler killed at their ExecutionTimeLimit
 * (Last Result = 267014). Returns one alert string per affected task.
 * Empty array means no kills detected.
 */
export function checkSchedulerKills(findings: readonly AuditFinding[]): string[] {
  const kills = findings.filter((f) => f.reason === 'SCHEDULER_TERMINATED_LAST_RUN');
  if (kills.length === 0) return [];

  const lines = ['🚨 WATCHDOG: Scheduler killed scheduled task(s) at their time limit:'];
  for (const kill of kills) {
    const tag = kill.severity === 'ERROR' ? '❌' : '⚠️';
    lines.push(`  ${tag} ${kill.taskName}`);
  }
  lines.push('');
  lines.push('No buys/syncs were placed by the killed runs. Run `npm run tasks:apply-limits` (admin) to push the updated PT20M/PT45M ExecutionTimeLimits.');
  return [lines.join('\n')];
}

export interface ZeroTradesInputs {
  /** Latest scan regime (BULLISH | NEUTRAL | BEARISH | undefined). */
  regime: string | null | undefined;
  /** Count of A_GRADE_BUY rows in the latest scan with shares > 0. */
  aGradeWithShares: number;
  /** Count of ExecutionLog rows whose phase indicates a buy attempt today. */
  buyAttemptsToday: number;
  /** UK weekday (1=Mon … 5=Fri), 0=Sun, 6=Sat. */
  ukDayOfWeek: number;
  /** UK hour-of-day (0-23). Check fires only after `minHourUk`. */
  ukHourOfDay: number;
  /** Earliest UK hour at which the check is meaningful. */
  minHourUk?: number;
}

/**
 * On a BULLISH UK weekday, after all 3 auto-trade sessions should have run,
 * if there are valid A-grade candidates but zero buy attempts in the
 * ExecutionLog today, surface a warning. This catches silent auto-trade
 * deaths even when the scheduler reports success — for example, the .bat
 * exited cleanly but the tsx subprocess crashed before any logExecution call.
 */
export function checkZeroTradesOnBullishDay(input: ZeroTradesInputs): string[] {
  const minHour = input.minHourUk ?? 16;
  if (input.ukDayOfWeek < 1 || input.ukDayOfWeek > 5) return [];
  if (input.ukHourOfDay < minHour) return [];
  if (String(input.regime ?? '').toUpperCase() !== 'BULLISH') return [];
  if (input.aGradeWithShares <= 0) return [];
  if (input.buyAttemptsToday > 0) return [];

  return [
    `⚠️ WATCHDOG: Regime is BULLISH and the latest scan has ${input.aGradeWithShares} valid A-grade buy candidate(s), but auto-trade has logged 0 buy attempts today (UK). All three sessions should have run by ${minHour}:00 UK. Inspect auto-trade.log and run \`npm run sanity:scheduler\`.`,
  ];
}
