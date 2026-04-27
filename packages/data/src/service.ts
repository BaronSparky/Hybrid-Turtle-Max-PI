/**
 * DEPENDENCIES
 * Consumed by: packages/workflow/src/service.ts, scripts/refresh-universe-daily-bars.ts, scripts/verify-phase2.ts
 * Consumes: packages/config/src/env.ts, packages/data/src/repository.ts, packages/data/src/yahoo-provider.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Orchestrates Yahoo historical-bar refresh runs and records per-symbol fetch outcomes.
 */
import pLimit from 'p-limit';
import { Prisma } from '@prisma/client';
import { env } from '../../config/src/env';
import { YahooMarketDataProvider } from './yahoo-provider';
import {
  createDataRefreshRun,
  finalizeDataRefreshRun,
  getActiveUniverseSymbols,
  markInstrumentStale,
  recordDataRefreshResult,
  upsertDailyBars,
} from './repository';
import type {
  HistoricalBarsResult,
  HistoricalInterval,
  HistoricalRange,
  RefreshUniverseOptions,
  RefreshUniverseResult,
  SymbolRefreshResult,
} from './types';
import { toInputJson } from './prisma';

const provider = new YahooMarketDataProvider();

async function withRetries<T>(operation: (attempt: number) => Promise<T>, retries: number) {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      return {
        value: await operation(attempt),
        retriesUsed: attempt,
      };
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > retries) {
        break;
      }
    }
  }

  throw lastError;
}

export async function fetchHistoricalBars(symbol: string, range: HistoricalRange, interval: HistoricalInterval) {
  return provider.fetchHistoricalBars(symbol, range, interval);
}

export { normalizeYahooBar } from './normalizers';

export async function upsertDailyBarsForSymbol(symbol: string, bars: HistoricalBarsResult['bars'], metadata: HistoricalBarsResult) {
  return upsertDailyBars({ symbol, bars, metadata });
}

export async function refreshUniverseDailyBars(options: RefreshUniverseOptions = {}): Promise<RefreshUniverseResult> {
  const range = options.range ?? env.MARKET_DATA_DEFAULT_RANGE;
  const interval = options.interval ?? env.MARKET_DATA_DEFAULT_INTERVAL;
  const symbols = await getActiveUniverseSymbols(options.symbols);
  const run = await createDataRefreshRun({
    range,
    interval,
    requestedSymbols: symbols.length,
    force: options.force ?? false,
  });

  const limiter = pLimit(env.MARKET_DATA_CONCURRENCY);
  const results = await Promise.all(
    symbols.map((symbol) =>
      limiter(async () => {
        const startedAt = new Date();

        try {
          const { value: metadata, retriesUsed } = await withRetries(async (attempt) => {
            if (attempt > 0) {
              await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
            }

            const response = await fetchHistoricalBars(symbol, range, interval);
            return response;
          }, env.MARKET_DATA_FETCH_RETRIES);

          const persisted = await upsertDailyBarsForSymbol(symbol, metadata.bars, metadata);
          const finishedAt = new Date();
          const result: SymbolRefreshResult = {
            symbol,
            status: 'SUCCEEDED',
            barsFetched: persisted.barsFetched,
            lastBarDate: persisted.lastBarDate,
            staleAfterRun: false,
            retriesUsed,
          };

          await recordDataRefreshResult({
            dataRefreshRunId: run.dataRefreshRunId,
            symbol,
            requestedRange: range,
            requestedInterval: interval,
            startedAt,
            finishedAt,
            retryCount: retriesUsed,
            result,
            instrumentId: persisted.instrumentId,
            rawMetaJson: toInputJson(metadata.meta),
            rawEventsJson: metadata.events == null ? undefined : toInputJson(metadata.events),
          });

          return result;
        } catch (error) {
          const finishedAt = new Date();
          const message = error instanceof Error ? error.message : 'Unknown Yahoo Finance fetch error';
          const retriesUsed = env.MARKET_DATA_FETCH_RETRIES;
          await markInstrumentStale(symbol, message, finishedAt);
          const result: SymbolRefreshResult = {
            symbol,
            status: 'FAILED',
            barsFetched: 0,
            lastBarDate: null,
            staleAfterRun: true,
            retriesUsed,
            errorMessage: message,
          };

          await recordDataRefreshResult({
            dataRefreshRunId: run.dataRefreshRunId,
            symbol,
            requestedRange: range,
            requestedInterval: interval,
            startedAt,
            finishedAt,
            retryCount: retriesUsed,
            result,
          });

          return result;
        }
      }),
    ),
  );

  const succeededSymbols = results.filter((result) => result.status === 'SUCCEEDED').length;
  const failedSymbols = results.length - succeededSymbols;
  const staleSymbols = results.filter((result) => result.staleAfterRun).length;

  await finalizeDataRefreshRun({
    dataRefreshRunId: run.dataRefreshRunId,
    jobRunId: run.jobRunId,
    startedAt: run.startedAt,
    requestedSymbols: symbols.length,
    succeededSymbols,
    failedSymbols,
    staleSymbols,
    results,
  });

  return {
    runId: run.dataRefreshRunId,
    requestedSymbols: symbols.length,
    succeededSymbols,
    failedSymbols,
    staleSymbols,
    results,
  };
}