/**
 * DEPENDENCIES
 * Consumed by: packages/workflow/src/scan.ts, scripts/run-signal-scan.ts, scripts/show-signal-candidates.ts
 * Consumes: packages/workflow/src/repository.ts, packages/signals/src/breakout.ts, packages/signals/src/ranking.ts, packages/signals/src/trend.ts, packages/signals/src/types.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Normalizes persisted numeric values that may arrive as plain numbers or Decimal-like objects.
 */
import {
  createSignalRun,
  finalizeSignalRun,
  getActiveInstrumentsWithBars,
  getLatestSignalRunWithCandidates,
  replaceSignalCandidates,
} from '../../workflow/src/repository';
import { analyzeBreakout } from './breakout';
import { rankCandidate, analyzeRiskFilter } from './ranking';
import { analyzeTrend } from './trend';
import type { CandidateListView, RankedCandidate, SignalBar, SignalScanResult } from './types';

type NumericLike = number | { toNumber(): number } | null | undefined;
type SetupStatus = RankedCandidate['setupStatus'];

const SETUP_STATUSES: readonly SetupStatus[] = [
  'READY_NEXT_SESSION',
  'READY_ON_TRIGGER',
  'EARLY_BIRD',
  'WATCH',
  'WAIT_PULLBACK',
  'AVOID',
];

function toNumeric(value: NumericLike): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  return value.toNumber();
}

function toSetupStatus(value: string): SetupStatus {
  return SETUP_STATUSES.includes(value as SetupStatus) ? value as SetupStatus : 'AVOID';
}

function toSignalBars(
  bars: Array<{
    date: Date;
    open: NumericLike;
    high: NumericLike;
    low: NumericLike;
    close: NumericLike;
    volume: bigint;
  }>,
): SignalBar[] {
  return bars.map((bar) => ({
    date: bar.date,
    open: toNumeric(bar.open),
    high: toNumeric(bar.high),
    low: toNumeric(bar.low),
    close: toNumeric(bar.close),
    volume: Number(bar.volume),
  }));
}

export async function runSignalScan(): Promise<SignalScanResult> {
  const instruments = await getActiveInstrumentsWithBars();
  const staleSymbols = instruments.filter((instrument) => instrument.isPriceDataStale).length;
  const signalRun = await createSignalRun(instruments.length, staleSymbols);

  try {
    const candidates: RankedCandidate[] = [];

    for (const instrument of instruments) {
      if (instrument.isPriceDataStale || instrument.dailyBars.length < 60) {
        continue;
      }

      const bars = toSignalBars(instrument.dailyBars);
      const trend = analyzeTrend(bars);
      const breakout = analyzeBreakout(bars);
      const risk = analyzeRiskFilter(bars, breakout);

      if (breakout.setupStatus === 'AVOID' || !risk.passes) {
        continue;
      }

      candidates.push(rankCandidate(instrument.symbol, trend, breakout, risk));
    }

    candidates.sort((left, right) => right.rankScore - left.rankScore);

    await replaceSignalCandidates(signalRun.id, candidates);
    await finalizeSignalRun(signalRun.id, 'SUCCEEDED', `Generated ${candidates.length} ranked candidates.`);

    return {
      signalRunId: signalRun.id,
      scannedSymbols: instruments.length,
      staleSymbols,
      candidates,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown signal scan error';
    await finalizeSignalRun(signalRun.id, 'FAILED', message);
    throw error;
  }
}

function compareValues(left: RankedCandidate, right: RankedCandidate, sortBy: CandidateListView['sortBy']) {
  switch (sortBy) {
    case 'symbol':
      return left.symbol.localeCompare(right.symbol);
    case 'currentPrice':
      return left.currentPrice - right.currentPrice;
    case 'triggerPrice':
      return left.triggerPrice - right.triggerPrice;
    case 'stopDistancePercent':
      return left.stopDistancePercent - right.stopDistancePercent;
    case 'setupStatus':
      return left.setupStatus.localeCompare(right.setupStatus);
    case 'rankScore':
    default:
      return left.rankScore - right.rankScore;
  }
}

export async function getCandidateListView(
  sortBy: CandidateListView['sortBy'] = 'rankScore',
  direction: CandidateListView['direction'] = 'desc',
): Promise<CandidateListView> {
  const latestSignalRun = await getLatestSignalRunWithCandidates();

  if (!latestSignalRun) {
    return {
      signalRunId: '',
      sortBy,
      direction,
      totalCandidates: 0,
      items: [],
    };
  }

  const items: RankedCandidate[] = latestSignalRun.candidates.map((candidate) => ({
    symbol: candidate.symbol,
    currentPrice: toNumeric(candidate.currentPrice),
    triggerPrice: toNumeric(candidate.triggerPrice),
    initialStop: toNumeric(candidate.initialStop),
    stopDistancePercent: toNumeric(candidate.stopDistancePercent),
    riskPerShare: toNumeric(candidate.riskPerShare),
    setupStatus: toSetupStatus(candidate.setupStatus),
    rankScore: toNumeric(candidate.rankScore),
    reasons: Array.isArray(candidate.reasonsJson) ? (candidate.reasonsJson as string[]) : [],
    warnings: Array.isArray(candidate.warningsJson) ? (candidate.warningsJson as string[]) : [],
  }));

  items.sort((left, right) => {
    const result = compareValues(left, right, sortBy);
    return direction === 'asc' ? result : -result;
  });

  return {
    signalRunId: latestSignalRun.id,
    sortBy,
    direction,
    totalCandidates: items.length,
    items,
  };
}