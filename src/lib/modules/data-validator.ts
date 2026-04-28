// ============================================================
// Module 18: Stale Data Protection (Ticker Validation)
// ============================================================
// Validates downloads — flags delisted/halted tickers, spike
// cleaning, data age checks. Dashboard no longer trusts Yahoo
// data blindly.
// ============================================================

import 'server-only';
import type { DataValidationResult } from '@/types';
import { getDailyPrices } from '../market-data';
import { DEAD_REASONS } from './data-validation-codes';

export { DEAD_REASONS, INSUFFICIENT_DATA_PREFIX } from './data-validation-codes';

const MAX_DATA_AGE_DAYS = 5; // business days
const SPIKE_THRESHOLD = 25;  // % daily move considered anomalous

/**
 * Validate a single ticker's data quality.
 */
export function validateTickerData(
  ticker: string,
  bars: { date: string; close: number; high: number; low: number; volume: number }[]
): DataValidationResult {
  const issues: string[] = [];

  if (!bars || bars.length === 0) {
    return {
      ticker,
      isValid: false,
      issues: [DEAD_REASONS.NO_DATA],
    };
  }

  // Check data age
  const latestDate = bars[0].date;
  const latestDateObj = new Date(latestDate);
  const now = new Date();
  const daysSinceUpdate = Math.floor(
    (now.getTime() - latestDateObj.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceUpdate > MAX_DATA_AGE_DAYS) {
    issues.push(`Data is ${daysSinceUpdate} days old (max ${MAX_DATA_AGE_DAYS})`);
  }

  // Check for price spikes (anomalies)
  let hasSpikeAnomaly = false;
  for (let i = 0; i < Math.min(5, bars.length - 1); i++) {
    const dailyChange = Math.abs(
      ((bars[i].close - bars[i + 1].close) / bars[i + 1].close) * 100
    );
    if (dailyChange > SPIKE_THRESHOLD) {
      hasSpikeAnomaly = true;
      issues.push(`Spike detected: ${dailyChange.toFixed(1)}% move on ${bars[i].date}`);
    }
  }

  // Check for zero/negative prices
  if (bars[0].close <= 0) {
    issues.push('Zero or negative price detected');
  }

  // Check for zero volume (halted)
  if (bars[0].volume === 0) {
    issues.push(DEAD_REASONS.ZERO_VOLUME);
  }

  // Check for stale price (same close for 3+ days)
  if (bars.length >= 3) {
    const same = bars[0].close === bars[1].close && bars[1].close === bars[2].close;
    if (same) {
      issues.push(DEAD_REASONS.STALE_PRICE);
    }
  }

  return {
    ticker,
    isValid: issues.length === 0,
    issues,
    lastPriceDate: latestDate,
    daysSinceUpdate,
    hasSpikeAnomaly,
  };
}

/**
 * Validate data quality for multiple tickers.
 * Parallelized in batches of 10 for performance.
 */
export async function validateUniverse(
  tickers: string[]
): Promise<DataValidationResult[]> {
  const results: DataValidationResult[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (ticker) => {
        try {
          const bars = await getDailyPrices(ticker, 'compact');
          return validateTickerData(ticker, bars);
        } catch {
          return {
            ticker,
            isValid: false,
            issues: ['Failed to fetch data — possible delisting or network error'],
          } as DataValidationResult;
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }

    if (i + BATCH_SIZE < tickers.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}
