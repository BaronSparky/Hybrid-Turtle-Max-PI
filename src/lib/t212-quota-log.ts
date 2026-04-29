/**
 * DEPENDENCIES
 * Consumed by: src/lib/trading212.ts (rate-limit observability)
 * Consumes: data/t212-quota-events.json (append-only, capped)
 * Risk-sensitive: NO — observability sink only
 * Notes: Records T212 rate-limit-low events to a rotating JSON file so the
 *        dashboard can surface throttling history without a schema change.
 */

import { promises as fs } from 'fs';
import path from 'path';

const QUOTA_LOG_FILE = path.resolve(process.cwd(), 'data', 't212-quota-events.json');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const HARD_CAP = 1000;

export interface T212QuotaEvent {
  timestamp: string;
  remaining: number;
  limit: number;
  method: string;
  path: string;
}

/**
 * Pure: apply retention rules to an event list.
 * - Drop entries older than RETENTION_MS
 * - Cap at HARD_CAP (most recent kept)
 * Exported for testing.
 */
export function applyRetention(
  events: T212QuotaEvent[],
  nowMs: number = Date.now(),
  retentionMs: number = RETENTION_MS,
  hardCap: number = HARD_CAP
): T212QuotaEvent[] {
  const cutoff = nowMs - retentionMs;
  const fresh = events.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
  if (fresh.length > hardCap) {
    return fresh.slice(-hardCap);
  }
  return fresh;
}

/**
 * Append a quota-low event to the rotating log file.
 * Errors are swallowed — quota logging must never break the API call path.
 */
export async function recordT212QuotaEvent(event: T212QuotaEvent): Promise<void> {
  try {
    let events: T212QuotaEvent[] = [];
    try {
      const raw = await fs.readFile(QUOTA_LOG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) events = parsed as T212QuotaEvent[];
    } catch {
      // file missing or unreadable — start fresh
    }

    events.push(event);
    events = applyRetention(events);

    await fs.mkdir(path.dirname(QUOTA_LOG_FILE), { recursive: true });
    await fs.writeFile(QUOTA_LOG_FILE, JSON.stringify(events, null, 2), 'utf-8');
  } catch {
    // never throw from observability sink
  }
}

/**
 * Read recent quota events for dashboard display.
 */
export async function readT212QuotaEvents(): Promise<T212QuotaEvent[]> {
  try {
    const raw = await fs.readFile(QUOTA_LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T212QuotaEvent[]) : [];
  } catch {
    return [];
  }
}
