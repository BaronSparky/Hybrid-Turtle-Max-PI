/**
 * DEPENDENCIES
 * Consumed by: src/cron/nightly.ts, src/cron/auto-trade.ts, src/cron/watchdog.ts, src/cron/midday-sync.ts, src/cron/hourly-status.ts, src/cron/research-refresh.ts
 * Risk-sensitive: NO
 * Notes: Structured JSON logger for cron jobs. Outputs machine-parseable log lines
 *        while keeping human-readable console output for interactive runs.
 *        Each log entry includes timestamp, job name, level, and structured data.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  ts: string;
  job: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export interface CronLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  /** Create a child logger with additional default fields */
  child(fields: Record<string, unknown>): CronLogger;
}

/**
 * Create a structured logger for a cron job.
 * Writes JSON to stdout/stderr for machine parsing.
 * @param jobName - e.g. 'nightly', 'auto-trade', 'watchdog'
 */
export function createCronLogger(jobName: string, extraFields: Record<string, unknown> = {}): CronLogger {
  function emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      job: jobName,
      level,
      msg,
      ...extraFields,
      ...data,
    };

    const line = JSON.stringify(entry);

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
    debug: (msg, data) => emit('debug', msg, data),
    child: (fields) => createCronLogger(jobName, { ...extraFields, ...fields }),
  };
}
