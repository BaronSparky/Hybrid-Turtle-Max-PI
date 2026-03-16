import { DataFetchStatus, JobRunStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import type { HistoricalBar, HistoricalBarsResult, SymbolRefreshResult } from './types';

type UpsertDailyBarsInput = {
  symbol: string;
  bars: HistoricalBar[];
  metadata: HistoricalBarsResult;
};

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function ensureInstrument(symbol: string, metadata?: HistoricalBarsResult) {
  const exchange = typeof metadata?.meta.exchangeName === 'string' ? metadata.meta.exchangeName : 'UNKNOWN';
  const name =
    typeof metadata?.meta.longName === 'string'
      ? metadata.meta.longName
      : typeof metadata?.meta.shortName === 'string'
        ? metadata.meta.shortName
        : symbol;
  const currency = typeof metadata?.meta.currency === 'string' ? metadata.meta.currency : 'USD';
  const instrumentType = typeof metadata?.meta.instrumentType === 'string' ? metadata.meta.instrumentType : 'OTHER';

  return prisma.instrument.upsert({
    where: { symbol },
    update: {
      name,
      exchange,
      currency,
      assetType: instrumentType === 'ETF' ? 'ETF' : instrumentType === 'MUTUALFUND' ? 'FUND' : 'STOCK',
      dataSource: 'YAHOO',
    },
    create: {
      symbol,
      name,
      exchange,
      currency,
      assetType: instrumentType === 'ETF' ? 'ETF' : instrumentType === 'MUTUALFUND' ? 'FUND' : 'STOCK',
      dataSource: 'YAHOO',
      isActive: true,
    },
  });
}

export async function upsertDailyBars({ symbol, bars, metadata }: UpsertDailyBarsInput) {
  const instrument = await ensureInstrument(symbol, metadata);

  // Batch all upserts in a single transaction for atomicity and performance
  await prisma.$transaction(
    bars.map((bar) =>
      prisma.dailyBar.upsert({
        where: {
          instrumentId_date_source: {
            instrumentId: instrument.id,
            date: bar.date,
            source: bar.source,
          },
        },
        update: {
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: BigInt(bar.volume),
          adjustedClose: bar.adjustedClose,
          fetchedAt: bar.fetchedAt,
        },
        create: {
          instrumentId: instrument.id,
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: BigInt(bar.volume),
          adjustedClose: bar.adjustedClose,
          source: bar.source,
          fetchedAt: bar.fetchedAt,
        },
      })
    )
  );

  const lastBarDate = bars.length > 0 ? bars[bars.length - 1].date : null;

  await prisma.instrument.update({
    where: { id: instrument.id },
    data: {
      dataSource: 'YAHOO',
      isPriceDataStale: false,
      staleReason: null,
      staleAsOf: null,
      lastPriceBarDate: lastBarDate,
      lastSuccessfulDataFetchAt: metadata.fetchedAt,
    },
  });

  return {
    instrumentId: instrument.id,
    barsFetched: bars.length,
    lastBarDate,
  };
}

export async function markInstrumentStale(symbol: string, errorMessage: string, at: Date) {
  await prisma.instrument.updateMany({
    where: { symbol },
    data: {
      isPriceDataStale: true,
      staleReason: errorMessage.slice(0, 500),
      staleAsOf: at,
      lastFailedDataFetchAt: at,
    },
  });
}

export async function createDataRefreshRun(args: {
  range: string;
  interval: string;
  requestedSymbols: number;
  force: boolean;
}) {
  const startedAt = new Date();
  const run = await prisma.dataRefreshRun.create({
    data: {
      source: 'YAHOO',
      requestedRange: args.range,
      requestedInterval: args.interval,
      requestedSymbols: args.requestedSymbols,
      forced: args.force,
      startedAt,
      status: JobRunStatus.RUNNING,
    },
  });

  const jobRun = await prisma.jobRun.create({
    data: {
      jobName: 'market-data.refresh-universe-daily-bars',
      status: JobRunStatus.RUNNING,
      startedAt,
      detailsJson: toInputJson({
        dataRefreshRunId: run.id,
        range: args.range,
        interval: args.interval,
        requestedSymbols: args.requestedSymbols,
        forced: args.force,
      }),
    },
  });

  return {
    dataRefreshRunId: run.id,
    jobRunId: jobRun.id,
    startedAt,
  };
}

export async function recordDataRefreshResult(args: {
  dataRefreshRunId: string;
  symbol: string;
  requestedRange: string;
  requestedInterval: string;
  startedAt: Date;
  finishedAt: Date;
  retryCount: number;
  result: SymbolRefreshResult;
  instrumentId?: string;
  rawMetaJson?: Prisma.InputJsonValue;
  rawEventsJson?: Prisma.InputJsonValue;
}) {
  await prisma.dataRefreshResult.create({
    data: {
      dataRefreshRunId: args.dataRefreshRunId,
      instrumentId: args.instrumentId,
      symbol: args.symbol,
      status: args.result.status === 'SUCCEEDED' ? DataFetchStatus.SUCCEEDED : DataFetchStatus.FAILED,
      requestedRange: args.requestedRange,
      requestedInterval: args.requestedInterval,
      barsFetched: args.result.barsFetched,
      lastBarDate: args.result.lastBarDate,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      retryCount: args.retryCount,
      staleAfterRun: args.result.staleAfterRun,
      errorMessage: args.result.errorMessage,
      rawMetaJson: args.rawMetaJson,
      rawEventsJson: args.rawEventsJson,
    },
  });
}

export async function finalizeDataRefreshRun(args: {
  dataRefreshRunId: string;
  jobRunId: string;
  startedAt: Date;
  requestedSymbols: number;
  succeededSymbols: number;
  failedSymbols: number;
  staleSymbols: number;
  results: SymbolRefreshResult[];
}) {
  const finishedAt = new Date();
  const status = args.failedSymbols >= args.requestedSymbols
    ? JobRunStatus.FAILED
    : args.failedSymbols > 0
      ? JobRunStatus.PARTIAL
      : JobRunStatus.SUCCEEDED;

  await prisma.dataRefreshRun.update({
    where: { id: args.dataRefreshRunId },
    data: {
      finishedAt,
      status,
      succeededSymbols: args.succeededSymbols,
      failedSymbols: args.failedSymbols,
      staleSymbols: args.staleSymbols,
      summaryJson: toInputJson({
        requestedSymbols: args.requestedSymbols,
        succeededSymbols: args.succeededSymbols,
        failedSymbols: args.failedSymbols,
        staleSymbols: args.staleSymbols,
        results: args.results,
      }),
      errorSummary: args.failedSymbols > 0 ? `${args.failedSymbols} symbol fetches failed.` : null,
    },
  });

  await prisma.jobRun.update({
    where: { id: args.jobRunId },
    data: {
      finishedAt,
      durationMs: finishedAt.getTime() - args.startedAt.getTime(),
      status,
      detailsJson: toInputJson({
        dataRefreshRunId: args.dataRefreshRunId,
        requestedSymbols: args.requestedSymbols,
        succeededSymbols: args.succeededSymbols,
        failedSymbols: args.failedSymbols,
        staleSymbols: args.staleSymbols,
      }),
      errorMessage: args.failedSymbols > 0 ? `${args.failedSymbols} symbol fetches failed.` : null,
    },
  });

  await prisma.auditEvent.create({
    data: {
      eventType: 'MARKET_DATA_REFRESH_COMPLETED',
      entityType: 'DataRefreshRun',
      entityId: args.dataRefreshRunId,
      payloadJson: toInputJson({
        requestedSymbols: args.requestedSymbols,
        succeededSymbols: args.succeededSymbols,
        failedSymbols: args.failedSymbols,
        staleSymbols: args.staleSymbols,
      }),
    },
  });

  return finishedAt;
}

export async function getActiveUniverseSymbols(symbols?: string[]) {
  const instruments = await prisma.instrument.findMany({
    where: {
      isActive: true,
      ...(symbols ? { symbol: { in: symbols } } : {}),
    },
    orderBy: { symbol: 'asc' },
    select: { symbol: true },
  });

  return instruments.map((instrument) => instrument.symbol);
}