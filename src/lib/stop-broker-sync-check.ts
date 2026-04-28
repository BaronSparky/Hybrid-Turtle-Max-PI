/**
 * Stop–Broker Sync Check
 *
 * Compares DB stop prices against T212 pending stop orders and reports
 * mismatches. Used by nightly.ts to detect stop drift before it causes
 * false alerts (like the GEV incident).
 *
 * Consumed by: nightly.ts (step 3, after stop management)
 * Consumes: trading212.ts, prisma.ts
 */

import prisma from './prisma';
import type { Trading212Client } from './trading212';

export interface StopDriftResult {
  ticker: string;
  positionId: string;
  dbStop: number;
  brokerStop: number | null;
  driftPct: number;
  driftDirection: 'DB_HIGHER' | 'DB_LOWER' | 'MATCHED' | 'NO_BROKER_STOP';
  /** Whether the DB was auto-corrected to match the broker */
  corrected: boolean;
}

export interface StopDriftReport {
  checked: number;
  mismatches: StopDriftResult[];
  /** Positions where DB stop was auto-corrected to match broker */
  corrected: number;
  errors: string[];
}

const DRIFT_THRESHOLD_PCT = 1; // Alert on >1% difference

/**
 * Compare DB stops with T212 pending stop orders.
 * Returns mismatches where DB and broker stops differ by more than 1%.
 *
 * When autoCorrect is true, DB_HIGHER mismatches (DB stop above T212 stop)
 * are auto-corrected by lowering the DB stop to match the broker. This is
 * safe because T212 is authoritative — orders execute at the broker's price,
 * not the DB's. DB_HIGHER causes false stop-hit alerts (like the GEV incident).
 *
 * DB_LOWER mismatches (DB stop below broker) are NOT auto-corrected because
 * the DB is more conservative, which is safe.
 *
 * @param clients - T212 clients already authenticated (from nightly)
 * @param autoCorrect - When true, auto-correct DB_HIGHER mismatches
 */
export async function checkStopBrokerSync(
  clients: { type: string; client: Trading212Client }[],
  autoCorrect = false
): Promise<StopDriftReport> {
  const errors: string[] = [];
  const mismatches: StopDriftResult[] = [];
  let checked = 0;
  let corrected = 0;

  // Get all open positions with T212 tickers
  const positions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    include: { stock: { select: { ticker: true, t212Ticker: true, currency: true } } },
  });

  if (positions.length === 0) {
    return { checked: 0, mismatches: [], corrected: 0, errors: [] };
  }

  // Collect pending stop orders from all T212 clients
  const allPendingStops = new Map<string, number>(); // t212Ticker → stopPrice

  for (const { type, client } of clients) {
    try {
      const orders = await client.getPendingOrders();
      for (const order of orders) {
        if (order.type === 'STOP' && order.side === 'SELL' && order.stopPrice) {
          allPendingStops.set(order.ticker, order.stopPrice);
        }
      }
    } catch (err) {
      errors.push(`Failed to fetch ${type} pending orders: ${(err as Error).message}`);
    }
  }

  if (allPendingStops.size === 0 && errors.length > 0) {
    return { checked: 0, mismatches: [], corrected: 0, errors };
  }

  // Compare each position's DB stop with the broker's pending stop
  for (const pos of positions) {
    const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker;
    if (!t212Ticker) continue;

    checked++;
    const brokerStop = allPendingStops.get(t212Ticker) ?? null;
    const dbStop = pos.currentStop;

    if (brokerStop === null) {
      mismatches.push({
        ticker: pos.stock.ticker,
        positionId: pos.id,
        dbStop,
        brokerStop: null,
        driftPct: 100,
        driftDirection: 'NO_BROKER_STOP',
        corrected: false,
      });
      continue;
    }

    const driftPct = Math.abs(dbStop - brokerStop) / Math.max(dbStop, brokerStop) * 100;

    if (driftPct > DRIFT_THRESHOLD_PCT) {
      const direction = dbStop > brokerStop ? 'DB_HIGHER' : 'DB_LOWER';
      let wasCorrected = false;

      // Auto-correct DB_HIGHER: DB stop is above T212 stop.
      // This is dangerous — the system thinks the stop is tighter than it actually is,
      // causing false stop-hit alerts. Correct DB down to match broker.
      if (autoCorrect && direction === 'DB_HIGHER' && brokerStop > 0) {
        try {
          await prisma.position.update({
            where: { id: pos.id },
            data: {
              currentStop: brokerStop,
              stopLoss: brokerStop,
              protectionLevel: 'INITIAL', // Reset since we don't know the correct level
            },
          });
          wasCorrected = true;
          corrected++;
          console.log(`  [stop-drift] Auto-corrected ${pos.stock.ticker}: DB $${dbStop.toFixed(2)} → T212 $${brokerStop.toFixed(2)}`);
        } catch (err) {
          errors.push(`Failed to auto-correct ${pos.stock.ticker}: ${(err as Error).message}`);
        }
      }

      mismatches.push({
        ticker: pos.stock.ticker,
        positionId: pos.id,
        dbStop,
        brokerStop,
        driftPct,
        driftDirection: direction,
        corrected: wasCorrected,
      });
    }
  }

  return { checked, mismatches, corrected, errors };
}
