/**
 * DEPENDENCIES
 * Consumed by: nightly-task.bat
 * Consumes: health-check.ts, stop-manager.ts, telegram.ts, market-data.ts, equity-snapshot.ts, snapshot-sync.ts, laggard-detector.ts, modules/*, risk-gates.ts, position-sizer.ts, prisma.ts, @/types
 * Risk-sensitive: YES
 * Last modified: 2026-02-24
 * Notes: Nightly automation should continue on partial failures.
 */
/**
 * HybridTurtle Nightly Cron Job — Standalone
 *
 * Runs the full nightly process directly (no running dashboard needed).
 *
 * 9-Step Nightly Process:
 * 1. Run 16-point health check
 * 2. Fetch live prices for all open positions
 * 3. Generate stop-loss recommendations + trailing ATR stops
 * 4. Detect laggards / dead money
 * 5. Run risk-signal modules (climax, swap, whipsaw, breadth, momentum)
 * 6. Record equity snapshot + check pyramid opportunities
 * 7. Sync snapshot data from Yahoo Finance + query READY candidates
 * 8. Send Telegram summary
 * 9. Write heartbeat
 *
 * Usage:
 *   npx tsx src/cron/nightly.ts --run-now
 */

import prisma from '@/lib/prisma';
import { runHealthCheck } from '@/lib/health-check';
import { generateStopRecommendations, generateTrailingStopRecommendations, updateStopLoss } from '@/lib/stop-manager';
import { sendNightlySummary } from '@/lib/telegram';
import type { NightlyPositionDetail, NightlyStopChange, NightlyReadyCandidate, NightlyTriggerMetCandidate, NightlyLaggardAlert, NightlyClimaxAlert, NightlySwapAlert, NightlyWhipsawAlert, NightlyBreadthAlert, NightlyMomentumAlert, NightlyPyramidAlert, NightlyGapRiskAlert, NightlyBreakoutFailureAlert, NightlyAcceleratorAlert } from '@/lib/telegram';
import { getBatchQuotes, normalizeBatchPricesToGBP, getDailyPrices, calculateADX, calculateATR, calculateMA, preCacheHistoricalData, getDataFreshness, getMarketRegime } from '@/lib/market-data';
import { fetchWithFallback, toPriceRecord } from '@/lib/data-provider';
import { fetchT212LivePrices } from '@/lib/position-sync';
import type { DataSourceHealth } from '@/lib/data-provider';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { syncClosedPositions } from '@/lib/position-sync';
import type { PositionSyncResult } from '@/lib/position-sync';
import { syncSnapshot } from '@/lib/snapshot-sync';
import { detectLaggards } from '@/lib/laggard-detector';
import { rankActions, type AcceleratorContext, type HeldPosition, type ReadyCandidate as AcceleratorCandidate } from '@/lib/profit-accelerator';
import { detectBreakoutFailures } from '@/lib/breakout-failure-detector';
import type { BreakoutFailureResult } from '@/lib/breakout-failure-detector';
import { scanClimaxSignals } from '@/lib/modules/climax-detector';
import { findSwapSuggestions } from '@/lib/modules/heatmap-swap';
import { checkWhipsawBlocks } from '@/lib/modules/whipsaw-guard';
import { calculateBreadth, checkBreadthSafety } from '@/lib/modules/breadth-safety';
// Module 13 disabled — import preserved for reference
// import { checkMomentumExpansion } from '@/lib/modules/momentum-expansion';
import { computeCorrelationMatrix } from '@/lib/correlation-matrix';
import { refreshSectorMomentumCache } from '@/lib/sector-etf-cache';
import { preCacheEarningsBatch } from '@/lib/earnings-calendar';
import { getRiskBudget, canPyramid, calculatePyramidAddSize } from '@/lib/risk-gates';
import { calculateRMultiple } from '@/lib/position-sizer';
import { sendAlert } from '@/lib/alert-service';
import { backupDatabase } from '@/lib/db-backup';
import { isAutoTradingEnabled } from '../../packages/workflow/src';
import { Trading212Client } from '@/lib/trading212';
import type { T212AccountType } from '@/lib/trading212-dual';
import { decryptField } from '@/lib/crypto';
import { isEnabled } from '@/lib/feature-flags';
import { isEarlyCloseDay, checkHolidayCoverage } from '@/lib/market-holidays';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek } from '@/lib/uk-time';
import { saveScoreBreakdowns } from '@/lib/score-tracker';
import { scoreRow, normaliseRow } from '@/lib/dual-score';
import { runFullCalibration } from '@/lib/prediction/bootstrap-calibration';
import { runTraining as runMetaModelTraining } from '@/lib/prediction/meta-model-trainer';
import { recomputeLeadLagGraph } from '@/lib/prediction/lead-lag-graph';
import { runGNNTraining } from '@/lib/prediction/gnn/gnn-trainer';
import { RISK_PROFILES, EQUITY_REVIEW_THRESHOLDS, type RiskProfileType, type Sleeve } from '@/types';

async function getNightlyT212Client(userId: string, accountType: T212AccountType): Promise<Trading212Client | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        t212ApiKey: true, t212ApiSecret: true, t212Environment: true, t212Connected: true,
        t212IsaApiKey: true, t212IsaApiSecret: true, t212IsaConnected: true,
      },
    });
    if (!user) return null;
    if (accountType === 'isa') {
      if (!user.t212IsaApiKey || !user.t212IsaConnected) return null;
      return new Trading212Client(decryptField(user.t212IsaApiKey), decryptField(user.t212IsaApiSecret ?? ''), user.t212Environment as 'demo' | 'live');
    }
    if (!user.t212ApiKey || !user.t212Connected) return null;
    return new Trading212Client(decryptField(user.t212ApiKey), decryptField(user.t212ApiSecret ?? ''), user.t212Environment as 'demo' | 'live');
  } catch {
    return null;
  }
}

async function runNightlyProcess() {
  const userId = 'default-user';
  let hadFailure = false;
  // Step-level tracking for PARTIAL heartbeat status
  interface StepResult {
    step: string;
    name: string;
    status: 'OK' | 'FAILED' | 'SKIPPED';
    error?: string;
    durationMs: number;
  }
  const stepResults: StepResult[] = [];
  let currentStepStart = 0;
  let currentStepHadFailure = false;
  let currentStepError: string | undefined;
  function startStep(step: string, name: string): void {
    // Auto-close the previous step when a new one starts
    if (stepResults.length > 0) {
      const prev = stepResults[stepResults.length - 1];
      prev.durationMs = Date.now() - currentStepStart;
      if (currentStepHadFailure) {
        prev.status = 'FAILED';
        if (currentStepError) prev.error = currentStepError;
      }
    }
    currentStepStart = Date.now();
    currentStepHadFailure = false;
    currentStepError = undefined;
    stepResults.push({ step, name, status: 'OK', durationMs: 0 });
  }
  function markStepFailed(error: string): void {
    currentStepHadFailure = true;
    currentStepError = error;
  }
  function finalizeSteps(): void {
    // Close the last open step
    if (stepResults.length > 0) {
      const last = stepResults[stepResults.length - 1];
      last.durationMs = Date.now() - currentStepStart;
      if (currentStepHadFailure) {
        last.status = 'FAILED';
        if (currentStepError) last.error = currentStepError;
      }
    }
  }
  // Track data source health across the pipeline
  let dataSourceHealth: DataSourceHealth = 'LIVE';
  let dataSourceStaleTickers: string[] = [];
  let dataSourceMaxStalenessHours = 0;
  let dataSourceSummary = '';

  const log = createCronLogger('nightly');
  log.info('Nightly process started');
  console.log('========================================');
  console.log(`[HybridTurtle] Nightly process started at ${new Date().toISOString()}`);
  console.log('========================================');

  try {
    // Write RUNNING heartbeat so the dashboard knows we're active
    await prisma.heartbeat.create({
      data: { status: 'RUNNING', details: JSON.stringify({ startedAt: new Date().toISOString() }) },
    });
    console.log('  [---] RUNNING heartbeat written');

    // Check for tomorrow's early-close or holiday so the nightly summary can note it
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const tomorrowEarlyClose = isEarlyCloseDay(tomorrowStr);
    if (tomorrowEarlyClose) {
      log.info('Tomorrow is an early-close day', { date: tomorrowStr, closeTime: tomorrowEarlyClose });
    }

    // Holiday calendar coverage check — warn in January if next year is missing
    const currentMonth = new Date().getMonth(); // 0 = January
    if (currentMonth === 0) {
      const nextYear = new Date().getFullYear() + 1;
      const coverageWarning = checkHolidayCoverage(nextYear);
      if (coverageWarning) {
        log.warn('Holiday calendar gap detected', { year: nextYear });
        console.warn(`  [!!!] ${coverageWarning}`);
      }
    }

    // Step 0: Pre-cache historical data for all active tickers
    console.log('  [0/9] Pre-caching historical data for all active tickers...');
    startStep('0', 'Pre-cache historical data');
    log.info('Step 0: Pre-cache historical data');
    try {
      const preCacheResult = await preCacheHistoricalData();
      console.log(`        ${preCacheResult.success}/${preCacheResult.total} tickers cached in ${(preCacheResult.durationMs / 1000).toFixed(1)}s`);
      if (preCacheResult.failed.length > 0) {
        console.warn(`        Failed: ${preCacheResult.failed.join(', ')}`);
      }
    } catch (error) {
      hadFailure = true;
      log.error('Step 0 failed', { error: (error as Error).message });
      console.error('  [0] Pre-cache failed:', (error as Error).message);
    }

    // Step 0b: Database backup
    console.log('  [0b] Database backup...');
    try {
      const backupResult = await backupDatabase();
      if (backupResult.success) {
        console.log(`        Backup created: ${backupResult.filename} (${backupResult.sizeBytes} bytes)`);
      } else {
        console.warn(`        Backup failed: ${backupResult.error}`);
        hadFailure = true;
        // Do NOT abort — backup failure should not stop the rest of the pipeline
      }
    } catch (err) {
      console.error('  [0b] Backup step threw unexpectedly:', err);
      hadFailure = true;
    }

    // Step 1: Run health check (isolated — failure doesn't block other steps)
    console.log('  [1/9] Running health check...');
    startStep('1', 'Health check');
    log.info('Step 1: Health check');
    let healthReport: { overall: string; checks: Record<string, string>; results: unknown[]; timestamp: Date } = {
      overall: 'YELLOW', checks: {}, results: [], timestamp: new Date(),
    };
    try {
      healthReport = await runHealthCheck(userId);
      console.log(`        Health: ${healthReport.overall}`);
    } catch (error) {
      hadFailure = true;
      console.error('  [1] Health check failed:', (error as Error).message);
    }

    // Step 2: Get open positions + fetch live prices
    // Collect alert summary strings for the Telegram nightly report.
    // Declared early so data source alerts (Step 2) and stop-hit detection (Step 3d) can push to it.
    const alerts: string[] = [];
    // Surface tomorrow's early-close as an alert in the nightly summary
    if (tomorrowEarlyClose) {
      alerts.push(`📅 Tomorrow is an early-close day — US market closes at ${tomorrowEarlyClose} ET. The us-close auto-trade session will be skipped.`);
    }
    console.log('  [2/9] Fetching positions and live prices...');
    startStep('2', 'Live prices');
    let positions: Awaited<ReturnType<typeof prisma.position.findMany<{ include: { stock: true } }>>> = [];
    try {
      positions = await prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: true },
      });
    } catch (error) {
      hadFailure = true;
      console.error('  [2] Position fetch failed:', (error as Error).message);
    }
    log.info('Step 2: Live prices', { positionCount: positions.length });

    const openTickers = positions.map((p) => p.stock.ticker);
    let livePrices: Record<string, number> = {};
    try {
      if (openTickers.length > 0) {
        // Use resilient fallback chain: Yahoo → AV → EODHD → DB cache
        const fetchResult = await fetchWithFallback(openTickers, 'nightly');
        livePrices = toPriceRecord(fetchResult);
        dataSourceHealth = fetchResult.health;
        dataSourceStaleTickers = fetchResult.staleTickers;
        dataSourceMaxStalenessHours = fetchResult.maxStalenessHours;
        dataSourceSummary = fetchResult.summary;

        // Surface data source degradation as an alert
        if (fetchResult.health === 'DEGRADED') {
          console.warn(`  [2] DATA DEGRADED — using cached data from ${fetchResult.maxStalenessHours.toFixed(1)}h ago`);
          alerts.push(`⚠ Yahoo Finance unavailable — using cached data from ${fetchResult.maxStalenessHours.toFixed(1)}h ago. Scan results may be slightly outdated.`);
        } else if (fetchResult.health === 'PARTIAL') {
          console.warn(`  [2] PARTIAL DATA — ${fetchResult.staleTickers.length} tickers using cache`);
          alerts.push(`⚠ Yahoo partial failure — ${fetchResult.staleTickers.length} ticker(s) using cached data`);
        }
      }
    } catch (error) {
      hadFailure = true;
      console.error('  [2] Live price fetch failed:', (error as Error).message);
    }

    // Overlay T212 real-time prices for held positions (more accurate than Yahoo)
    if (openTickers.length > 0) {
      try {
        const t212Prices = await fetchT212LivePrices(userId);
        const t212Count = Object.keys(t212Prices).length;
        if (t212Count > 0) {
          Object.assign(livePrices, t212Prices);
          console.log(`        T212 overlay: ${t212Count} tickers upgraded to real-time`);
        }
      } catch {
        console.warn('  [2] T212 price overlay failed — using Yahoo/cache prices');
      }
    }

    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    let gbpPrices: Record<string, number> = {};
    try {
      gbpPrices = openTickers.length > 0
        ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
        : {};
    } catch (error) {
      hadFailure = true;
      // Fall back to raw prices so downstream steps can still run
      gbpPrices = { ...livePrices };
      console.error('  [2] FX normalisation failed, using raw prices as fallback:', (error as Error).message);
    }
    console.log(`        ${positions.length} positions, ${Object.keys(livePrices).length} prices fetched`);

    // Check market data freshness — warn if stale
    const freshness = getDataFreshness();
    if (freshness.source === 'STALE_CACHE' || freshness.ageMinutes > 60) {
      alerts.push(`⚠️ Market data is ${freshness.ageMinutes}m old (source: ${freshness.source})`);
      console.warn(`  [2] Data freshness warning: ${freshness.source}, ${freshness.ageMinutes}m old`);
    }

    // Step 2b: Position sync — detect T212 closures before downstream steps
    console.log('  [2b] Syncing positions against Trading 212...');
    let positionSyncResult: PositionSyncResult = { checked: 0, closed: 0, skipped: 0, updated: 0, errors: [] };
    try {
      positionSyncResult = await syncClosedPositions(userId);
      console.log(`        Position sync: ${positionSyncResult.checked} checked, ${positionSyncResult.closed} closed, ${positionSyncResult.skipped} skipped`);
      if (positionSyncResult.errors.length > 0) {
        for (const err of positionSyncResult.errors) {
          console.warn(`        Sync: ${err}`);
        }
      }
      if (positionSyncResult.closed > 0) {
        alerts.push(`${positionSyncResult.closed} position(s) auto-closed via T212 sync`);
        // Re-fetch open positions so downstream steps work with accurate status
        positions = await prisma.position.findMany({
          where: { userId, status: 'OPEN' },
          include: { stock: true },
        });
      }
      if (positionSyncResult.errors.length > 0 && positionSyncResult.closed === 0) {
        alerts.push(`T212 position sync: ${positionSyncResult.errors[0]}`);
      }
    } catch (error) {
      // Position sync failure is non-blocking — nightly continues
      console.error('  [2b] Position sync failed:', (error as Error).message);
      alerts.push('T212 position sync failed — positions not updated. Check manually.');
    }

    // Step 3: Generate stop recommendations (isolated)
    console.log('  [3/9] Generating stop recommendations...');
    startStep('3', 'Stop management');
    log.info('Step 3: Stop management', { openPositions: positions.length });
    const livePriceMap = new Map(Object.entries(livePrices));
    const stopChanges: NightlyStopChange[] = [];
    const atrMap = new Map<string, number>();
    let stopRecs: Awaited<ReturnType<typeof generateStopRecommendations>> = [];
    try {
      // Fetch daily bars in parallel batches — use 'full' so trailing stop (step 3b) gets cache hits
      const PRICE_BATCH = 10;
      for (let i = 0; i < openTickers.length; i += PRICE_BATCH) {
        const batch = openTickers.slice(i, i + PRICE_BATCH);
        await Promise.allSettled(
          batch.map(async (ticker) => {
            const bars = await getDailyPrices(ticker, 'full');
            if (bars.length >= 15) {
              atrMap.set(ticker, calculateATR(bars, 14));
            }
          })
        );
        if (i + PRICE_BATCH < openTickers.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      stopRecs = await generateStopRecommendations(userId, livePriceMap, atrMap);

      for (const rec of stopRecs) {
        const pos = positions.find((p) => p.id === rec.positionId);
        const isUK = rec.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(rec.ticker);
        const cur = isUK ? 'GBX' : (pos?.stock.currency || 'USD').toUpperCase();
        try {
          await updateStopLoss(rec.positionId, rec.newStop, rec.reason, rec.newLevel);
          stopChanges.push({
            ticker: rec.ticker,
            oldStop: rec.currentStop,
            newStop: rec.newStop,
            level: rec.newLevel,
            reason: rec.reason,
            currency: cur,
          });
        } catch (err) {
          console.warn(`  [nightly] Stop update skipped due to error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (error) {
      hadFailure = true;
      console.error('  [3] R-based stop recommendations failed:', (error as Error).message);
    }

    // Step 3b: Trailing ATR stops
    const trailingStopChanges: NightlyStopChange[] = [];
    try {
      const trailingRecs = await generateTrailingStopRecommendations(userId);
      for (const rec of trailingRecs) {
        try {
          await updateStopLoss(rec.positionId, rec.trailingStop, rec.reason, 'TRAILING_ATR');
          trailingStopChanges.push({
            ticker: rec.ticker,
            oldStop: rec.currentStop,
            newStop: rec.trailingStop,
            level: 'TRAILING_ATR',
            reason: rec.reason,
            currency: rec.priceCurrency,
          });
        } catch (err) {
          console.warn(`  [nightly] Trailing stop update skipped due to error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [3b] Trailing stop calculation failed:', (error as Error).message);
    }
    console.log(`        ${stopRecs.length} R-based, ${trailingStopChanges.length} trailing ATR`);

    // Re-fetch positions from DB so all downstream code (T212 push, stop-hit detection,
    // near-stop alerts, position details, Telegram) uses the updated stop values.
    if (stopChanges.length > 0 || trailingStopChanges.length > 0) {
      try {
        positions = await prisma.position.findMany({
          where: { userId, status: 'OPEN' },
          include: { stock: true },
        });
      } catch (err) {
        console.warn('  [3] Position re-fetch after stop updates failed:', (err as Error).message);
      }
    }

    // Clear near-stop alert flag for positions whose stop just moved
    // (so the alert can fire again if price approaches the new, higher stop)
    const movedPositionIds = [
      ...stopChanges.map((sc) => positions.find((p) => p.stock.ticker === sc.ticker)?.id),
      ...trailingStopChanges.map((sc) => positions.find((p) => p.stock.ticker === sc.ticker)?.id),
    ].filter((id): id is string => !!id);
    if (movedPositionIds.length > 0) {
      try {
        // Clear via raw SQL — Prisma client may not have the field type yet if generate hasn't run
        for (const pid of movedPositionIds) {
          await prisma.$executeRawUnsafe(
            'UPDATE "Position" SET "nearStopAlertSentAt" = NULL WHERE "id" = ? AND "nearStopAlertSentAt" IS NOT NULL',
            pid
          );
        }
      } catch (err) {
        console.warn('  [3] Near-stop flag clear failed:', (err as Error).message);
      }
    }

    // Step 3c: Gap Risk detection for HIGH_RISK positions (advisory only)
    const gapRiskAlerts: NightlyGapRiskAlert[] = [];
    try {
      const highRiskPositions = positions.filter((p) => p.stock.sleeve === 'HIGH_RISK');
      if (highRiskPositions.length > 0) {
        const hrTickers = highRiskPositions.map((p) => p.stock.ticker);
        // getBatchQuotes hits Yahoo quote cache populated by step 2's fetchWithFallback
        const quotes = await getBatchQuotes(hrTickers);
        for (const pos of highRiskPositions) {
          const quote = quotes.get(pos.stock.ticker);
          const atr = atrMap.get(pos.stock.ticker);
          if (!quote || !atr || quote.previousClose <= 0) continue;
          const gapPercent = ((quote.open - quote.previousClose) / quote.previousClose) * 100;
          const atrPercent = (atr / quote.previousClose) * 100;
          const threshold = atrPercent * 2;
          // Flag if absolute gap exceeds 2× ATR%
          if (Math.abs(gapPercent) > threshold) {
            const isUK = pos.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(pos.stock.ticker);
            const currency = isUK ? 'GBX' : (pos.stock.currency || 'USD').toUpperCase();
            gapRiskAlerts.push({ ticker: pos.stock.ticker, gapPercent, atrPercent, threshold, currency });
          }
        }
      }
    } catch (error) {
      console.warn('  [3c] Gap risk detection failed:', (error as Error).message);
    }
    console.log(`        Gap risk: ${gapRiskAlerts.length} flagged`);

    // Step 3d: Stop-hit detection — alert if any position price <= currentStop
    const stopHitPositions: Array<{ ticker: string; name: string; currentStop: number; currentPrice: number; currency: string }> = [];
    try {
      for (const p of positions) {
        const currentPrice = livePrices[p.stock.ticker];
        if (!currentPrice || currentPrice <= 0) continue;
        if (currentPrice <= p.currentStop) {
          const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
          const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
          stopHitPositions.push({
            ticker: p.stock.ticker,
            name: p.stock.name || p.stock.ticker,
            currentStop: p.currentStop,
            currentPrice,
            currency,
          });
        }
      }
      // Send stop-hit alerts (any day of the week)
      for (const hit of stopHitPositions) {
        const currSymbol = hit.currency === 'GBP' || hit.currency === 'GBX' ? '£' : hit.currency === 'EUR' ? '€' : '$';
        await sendAlert({
          type: 'STOP_HIT',
          title: `⚠ Action needed — ${hit.ticker} may have hit its stop`,
          message: `${hit.name} (${hit.ticker}) has fallen to or below your stop-loss level.\n\nStop price: ${currSymbol}${hit.currentStop.toFixed(2)}\nCurrent price: ${currSymbol}${hit.currentPrice.toFixed(2)}\n\nCheck Trading 212 and confirm whether the position has been closed. If not, close it manually now.`,
          data: { ticker: hit.ticker, currentStop: hit.currentStop, currentPrice: hit.currentPrice },
          priority: 'WARNING',
        });
      }
      if (stopHitPositions.length > 0) {
        alerts.push(`🔴 ${stopHitPositions.length} position(s) hit stop-loss — check Trading 212`);
      }
    } catch (error) {
      console.warn('  [3d] Stop-hit detection failed:', (error as Error).message);
    }
    console.log(`        Stop hits: ${stopHitPositions.length} detected`);

    // Step 3e: Breakout failure detection — price closed back below entry trigger within 5 days
    let breakoutFailureAlerts: NightlyBreakoutFailureAlert[] = [];
    try {
      const bfInput = positions.map((p) => {
        const currentPrice = livePrices[p.stock.ticker];
        const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
        const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
        return {
          id: p.id,
          ticker: p.stock.ticker,
          entryPrice: p.entryPrice,
          entryDate: p.entryDate,
          entryTrigger: p.entryTrigger,
          initialRisk: p.initialRisk,
          currentPrice: currentPrice || p.entryPrice,
          shares: p.shares,
          currency,
          alreadyFlagged: !!p.breakoutFailureDetectedAt,
        };
      });
      const failures = detectBreakoutFailures(bfInput);

      // Persist the detection timestamp on newly-flagged positions
      for (const f of failures) {
        try {
          await prisma.position.update({
            where: { id: f.positionId },
            data: { breakoutFailureDetectedAt: new Date() },
          });
        } catch (err) {
          console.warn(`  [nightly] Breakout failure flag skipped due to error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      breakoutFailureAlerts = failures.map((f) => {
        const currSymbol = f.currency === 'GBP' || f.currency === 'GBX' ? '£' : f.currency === 'EUR' ? '€' : '$';
        return {
          ticker: f.ticker,
          daysHeld: f.daysHeld,
          rMultiple: f.rMultiple,
          entryTrigger: f.entryTrigger,
          currentPrice: f.currentPrice,
          estimatedLoss: f.estimatedLoss,
          currency: f.currency,
          reason: f.reason,
        };
      });

      // Send in-app + Telegram alerts for each breakout failure
      for (const bf of breakoutFailureAlerts) {
        const currSymbol = bf.currency === 'GBP' || bf.currency === 'GBX' ? '£' : bf.currency === 'EUR' ? '€' : '$';
        await sendAlert({
          type: 'BREAKOUT_FAILURE',
          title: `⚠ Breakout failure — ${bf.ticker}`,
          message: `${bf.ticker} has closed back below its entry trigger after ${bf.daysHeld} day${bf.daysHeld !== 1 ? 's' : ''}. Consider exiting.\n\nEntry trigger: ${currSymbol}${bf.entryTrigger.toFixed(2)}\nCurrent price: ${currSymbol}${bf.currentPrice.toFixed(2)}\nExpected loss: -${currSymbol}${Math.abs(bf.estimatedLoss).toFixed(2)}\n\nRecommendation: Exit this position in Trading 212. This breakout has failed.`,
          data: { ticker: bf.ticker, daysHeld: bf.daysHeld, rMultiple: bf.rMultiple, entryTrigger: bf.entryTrigger, currentPrice: bf.currentPrice, estimatedLoss: bf.estimatedLoss },
          priority: 'WARNING',
        });
      }
      if (breakoutFailureAlerts.length > 0) {
        alerts.push(`⚠️ ${breakoutFailureAlerts.length} breakout failure(s) — consider exiting`);
      }
    } catch (error) {
      console.warn('  [3e] Breakout failure detection failed:', (error as Error).message);
    }
    console.log(`        Breakout failures: ${breakoutFailureAlerts.length} detected`);

    // Step 3f: Near-stop alert — warn when price is within 3% of stop-loss
    // Only fires once per position (until stop is moved). HEDGE positions excluded.
    let nearStopCount = 0;
    try {
      const NEAR_STOP_THRESHOLD = 0.03; // 3%

      // Fetch nearStopAlertSentAt for open positions (may not be in Prisma types yet)
      const alertFlags = await prisma.$queryRawUnsafe<Array<{ id: string; nearStopAlertSentAt: string | null }>>(
        'SELECT "id", "nearStopAlertSentAt" FROM "Position" WHERE "status" = \'OPEN\''
      );
      const alertFlagMap = new Map(alertFlags.map((r) => [r.id, r.nearStopAlertSentAt]));

      for (const p of positions) {
        // Skip HEDGE positions — excluded from risk alerts per CLAUDE.md
        if ((p.stock as { sleeve?: string }).sleeve === 'HEDGE') continue;

        const currentPrice = livePrices[p.stock.ticker];
        if (!currentPrice || currentPrice <= 0 || p.currentStop <= 0) continue;

        // Already hit stop (handled by step 3d) or stop above price — skip
        if (currentPrice <= p.currentStop) continue;

        const distanceToStop = (currentPrice - p.currentStop) / currentPrice;
        if (distanceToStop > NEAR_STOP_THRESHOLD) continue;

        // Already alerted for this stop level — skip until stop moves
        if (alertFlagMap.get(p.id)) continue;

        // Price is within 3% of stop — fire alert
        const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
        const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
        const currSymbol = currency === 'GBP' || currency === 'GBX' ? '\u00a3' : currency === 'EUR' ? '\u20ac' : '$';
        const distPct = (distanceToStop * 100).toFixed(1);

        await sendAlert({
          type: 'NEAR_STOP',
          title: `\u26a0 Near stop \u2014 ${p.stock.ticker} is ${distPct}% from stop`,
          message: `${p.stock.name || p.stock.ticker} is approaching its stop-loss.\n\nCurrent price: ${currSymbol}${currentPrice.toFixed(2)}\nStop-loss: ${currSymbol}${p.currentStop.toFixed(2)}\nDistance: ${distPct}%\n\nConsider reviewing this position. The stop will execute automatically if the price drops further.`,
          data: { ticker: p.stock.ticker, currentPrice, currentStop: p.currentStop, distancePct: parseFloat(distPct) },
          priority: 'WARNING',
        });

        // Mark as alerted — prevents duplicate alerts until stop moves
        await prisma.$executeRawUnsafe(
          'UPDATE "Position" SET "nearStopAlertSentAt" = ? WHERE "id" = ?',
          new Date().toISOString(),
          p.id
        );

        nearStopCount++;
      }
      if (nearStopCount > 0) {
        alerts.push(`\u26a0\ufe0f ${nearStopCount} position(s) within 3% of stop-loss`);
      }
    } catch (error) {
      console.warn('  [3f] Near-stop alert failed:', (error as Error).message);
    }
    console.log(`        Near-stop alerts: ${nearStopCount} sent`);

    // Step 3g: Auto-push updated stops to T212 (requires ENABLE_AUTO_TRADING)
    // Pushes the union of {positions whose stop changed tonight} ∪ {orphans —
    // open positions with no STOP/SELL order at the broker}. The orphan path
    // catches the case where execute/route.ts skipped Phase C (e.g. UK fill
    // confirmation timeout left a position at the broker with no stop attached).
    const autoTradingEnabled = await isAutoTradingEnabled();
    let stopsPushedToT212 = 0;
    let stopsPushFailed = 0;
    let orphanStopsPlaced = 0;
    const orphanTickersPlaced: string[] = [];
    if (autoTradingEnabled) {
      console.log('  [3g] Auto-pushing stops to Trading 212...');
      try {
        const changedTickers = new Set([
          ...stopChanges.map(s => s.ticker),
          ...trailingStopChanges.map(s => s.ticker),
        ]);

        // Group ALL open positions by account so we can detect orphans per account
        const positionsByAccount = new Map<T212AccountType, typeof positions>();
        for (const p of positions) {
          const acctType: T212AccountType = p.accountType === 'isa' ? 'isa' : 'invest';
          const group = positionsByAccount.get(acctType) ?? [];
          group.push(p);
          positionsByAccount.set(acctType, group);
        }

        for (const [acctType, acctPositions] of Array.from(positionsByAccount.entries())) {
          const client = await getNightlyT212Client(userId, acctType);
          if (!client) {
            console.warn(`  [3g] T212 ${acctType} client unavailable — skipping stop push`);
            continue;
          }

          // Detect orphans: fetch pending orders once per account and find
          // open positions whose t212Ticker has no STOP/SELL order at the broker.
          const orphanT212Tickers = new Set<string>();
          try {
            const pending = await client.getPendingOrders();
            const brokerStopTickers = new Set(
              pending
                .filter(o => o.type === 'STOP' && o.side === 'SELL')
                .map(o => o.ticker)
            );
            for (const p of acctPositions) {
              const t = p.t212Ticker || p.stock.t212Ticker;
              if (t && !brokerStopTickers.has(t) && p.currentStop > 0) {
                orphanT212Tickers.add(t);
              }
            }
          } catch (err) {
            console.warn(`  [3g] Orphan detection failed for ${acctType}: ${(err as Error).message}`);
          }

          // Build push batch: positions in {changed ∪ orphans} only.
          // Positions whose broker stop merely differs (but exists) are left
          // to step 3h's drift detection — avoids tripping the monotonic rule
          // on stops the user manually moved at the broker.
          const batchInput = acctPositions
            .filter(p => {
              const t212Ticker = p.t212Ticker || p.stock.t212Ticker;
              if (!t212Ticker || p.currentStop <= 0) return false;
              return changedTickers.has(p.stock.ticker) || orphanT212Tickers.has(t212Ticker);
            })
            .map(p => ({
              t212Ticker: (p.t212Ticker || p.stock.t212Ticker)!,
              shares: p.shares,
              stopPrice: p.currentStop,
            }));

          if (batchInput.length === 0) continue;

          try {
            const results = await client.setStopLossBatch(batchInput);
            for (const r of results) {
              if (r.action === 'PLACED' || r.action === 'UPDATED') {
                stopsPushedToT212++;
                if (orphanT212Tickers.has(r.t212Ticker)) {
                  orphanStopsPlaced++;
                  orphanTickersPlaced.push(r.t212Ticker);
                  console.warn(`  [3g] Orphan stop placed for ${r.t212Ticker} @ ${r.stopPrice} — position had no broker stop`);
                }
              } else if (r.action === 'SKIPPED_SAME') {
                // Already correct at broker — no-op, no alert
              } else {
                stopsPushFailed++;
                console.warn(`  [3g] Stop push ${r.action} for ${r.t212Ticker}: ${r.error || ''}`);
              }
            }
          } catch (err) {
            console.warn(`  [3g] Batch stop push failed for ${acctType}: ${(err as Error).message}`);
            stopsPushFailed += batchInput.length;
          }
        }

        if (stopsPushedToT212 > 0) {
          alerts.push(`✅ ${stopsPushedToT212} stop(s) auto-pushed to T212`);
        }
        if (orphanStopsPlaced > 0) {
          alerts.push(`⚠ Orphan stop(s) placed for ${orphanTickersPlaced.join(', ')} — position(s) had no broker stop (initial Phase C likely skipped)`);
        }
        if (stopsPushFailed > 0) {
          alerts.push(`⚠ ${stopsPushFailed} stop(s) failed to push to T212 — check manually`);
        }
      } catch (error) {
        console.warn('  [3g] Auto-push stops failed:', (error as Error).message);
        alerts.push('⚠ Auto stop-push to T212 failed — check manually');
      }
    }
    console.log(`        T212 stop push: ${stopsPushedToT212} pushed (${orphanStopsPlaced} orphans), ${stopsPushFailed} failed`);

    // Step 3h: Stop–Broker sync check — compare DB stops vs T212 pending orders
    if (process.env.BROKER_ADAPTER === 'trading212') {
      try {
        const { checkStopBrokerSync } = await import('@/lib/stop-broker-sync-check');
        const t212Clients: { type: string; client: typeof import('@/lib/trading212').Trading212Client.prototype }[] = [];
        for (const acctType of ['invest', 'isa'] as T212AccountType[]) {
          const c = await getNightlyT212Client(userId, acctType);
          if (c) t212Clients.push({ type: acctType, client: c });
        }
        if (t212Clients.length > 0) {
          const driftReport = await checkStopBrokerSync(t212Clients, true); // autoCorrect DB_HIGHER
          if (driftReport.mismatches.length > 0) {
            for (const m of driftReport.mismatches) {
              const dir = m.driftDirection === 'NO_BROKER_STOP'
                ? 'NO T212 STOP'
                : `DB:$${m.dbStop.toFixed(2)} vs T212:$${m.brokerStop?.toFixed(2)} (${m.driftPct.toFixed(1)}%)${m.corrected ? ' → AUTO-CORRECTED' : ''}`;
              console.warn(`        ⚠ Stop drift: ${m.ticker} — ${dir}`);
            }
            const uncorrected = driftReport.mismatches.filter(m => !m.corrected);
            if (uncorrected.length > 0) {
              alerts.push(`⚠ ${uncorrected.length} stop(s) drifted from T212 — check manually`);
            }
            if (driftReport.corrected > 0) {
              alerts.push(`✅ ${driftReport.corrected} stop(s) auto-corrected to match T212`);
            }
          } else {
            console.log(`        Stop-broker sync: ${driftReport.checked} checked, all matched`);
          }
        }
      } catch (error) {
        console.warn('  [3h] Stop-broker sync check failed:', (error as Error).message);
      }
    }

    // Step 4: Detect laggards + collect alerts
    console.log('  [4/9] Detecting laggards...');
    startStep('4', 'Laggard detection');
    log.info('Step 4: Laggard detection');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const equity = user?.equity || 0;

    if (healthReport.overall === 'RED') alerts.push('Health check is RED — review issues before trading');
    if (healthReport.overall === 'YELLOW') alerts.push('Health check has warnings');
    if (stopChanges.length > 0) alerts.push(`${stopChanges.length} R-based stop-loss updates auto-applied`);
    if (trailingStopChanges.length > 0) alerts.push(`${trailingStopChanges.length} trailing ATR stops auto-applied`);
    if (gapRiskAlerts.length > 0) alerts.push(`${gapRiskAlerts.length} HIGH_RISK position(s) with overnight gap > 2× ATR%`);

    let laggardAlerts: NightlyLaggardAlert[] = [];
    // Hoisted for reuse by accelerator engine (step 6c)
    const laggardExtrasCache = new Map<string, { ma20: number; adxToday: number; adxYesterday: number }>();
    try {
      // Pre-compute MA20 + ADX (today vs yesterday) from cached daily bars
      // getDailyPrices hits cache here — bars were fetched in Step 3
      const laggardExtras = laggardExtrasCache;
      for (const p of positions) {
        try {
          const bars = await getDailyPrices(p.stock.ticker, 'full');
          if (bars.length >= 29) {
            // MA20 from newest-first close prices
            const closes = bars.map(b => b.close);
            const ma20 = calculateMA(closes, 20);
            // ADX today (full bars) vs yesterday (exclude today's bar)
            const adxToday = calculateADX(bars, 14).adx;
            const adxYesterday = calculateADX(bars.slice(1), 14).adx;
            laggardExtras.set(p.stock.ticker, { ma20, adxToday, adxYesterday });
          }
        } catch (err) {
          console.warn(`  [nightly] Laggard extra data skipped due to error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const laggardInput = positions.map((p) => {
        const currentPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
        const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
        const extras = laggardExtras.get(p.stock.ticker);
        return {
          id: p.id,
          ticker: p.stock.ticker,
          entryPrice: p.entryPrice,
          entryDate: p.entryDate,
          currentStop: p.currentStop,
          shares: p.shares,
          initialRisk: p.initialRisk,
          currentPrice,
          currency,
          sleeve: p.stock.sleeve,
          // Recovery exemption fields — computed from cached daily bars
          ...(extras ? { ma20: extras.ma20, adxToday: extras.adxToday, adxYesterday: extras.adxYesterday } : {}),
        };
      });
      const laggards = detectLaggards(laggardInput);
      laggardAlerts = laggards.map((l) => ({
        ticker: l.ticker,
        daysHeld: l.daysHeld,
        rMultiple: l.rMultiple,
        lossPct: l.lossPct,
        flag: l.flag,
        reason: l.reason,
        currency: l.currency,
      }));
      if (laggardAlerts.length > 0) {
        const trimCount = laggardAlerts.filter((l) => l.flag === 'TRIM_LAGGARD').length;
        const deadCount = laggardAlerts.filter((l) => l.flag === 'DEAD_MONEY').length;
        const parts: string[] = [];
        if (trimCount > 0) parts.push(`${trimCount} laggard(s)`);
        if (deadCount > 0) parts.push(`${deadCount} dead-money`);
        alerts.push(`${parts.join(' + ')} flagged for review`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [4] Laggard detection failed:', (error as Error).message);
    }
    console.log(`        ${laggardAlerts.length} laggards flagged`);

    // Step 5: Risk-signal modules
    console.log('  [5/9] Running risk-signal modules...');
    startStep('5', 'Risk modules');
    log.info('Step 5: Risk modules');
    let climaxAlerts: NightlyClimaxAlert[] = [];
    let swapAlerts: NightlySwapAlert[] = [];
    let whipsawAlerts: NightlyWhipsawAlert[] = [];
    let breadthAlert: NightlyBreadthAlert | undefined;
    let momentumAlert: NightlyMomentumAlert | undefined;

    try {
      const climaxSignals = await scanClimaxSignals(
        positions.map((p) => ({ id: p.id, ticker: p.stock.ticker }))
      );
      climaxAlerts = climaxSignals.map((c) => ({
        ticker: c.ticker,
        priceAboveMa20Pct: c.priceAboveMa20Pct,
        volumeRatio: c.volumeRatio,
        action: c.action,
        reason: c.reason,
      }));
      if (climaxAlerts.length > 0) {
        alerts.push(`${climaxAlerts.length} climax top signal(s) — consider trimming`);
      }
    } catch (error) {
      console.warn('  [5] Climax detection failed:', (error as Error).message);
    }

    // Shared data for risk modules — computed once, used by swap/whipsaw/breadth/momentum
    const riskProfile = (user?.riskProfile || 'BALANCED') as RiskProfileType;
    const enrichedForSwap = positions.map((p) => {
      const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
      const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
      return {
        id: p.id,
        ticker: p.stock.ticker,
        cluster: p.stock.cluster || 'General',
        sleeve: p.stock.sleeve as Sleeve,
        value: gbpPrice * p.shares,
        rMultiple,
      };
    });
    const totalPortfolioValue = enrichedForSwap.reduce((s, p) => s + p.value, 0);

    // Swap suggestions (isolated)
    try {
      const latestScan = await prisma.scan.findFirst({
        where: { userId },
        orderBy: { runDate: 'desc' },
        include: { results: { include: { stock: true } } },
      });
      const scanCandidates = (latestScan?.results || [])
        .filter((r) => r.status === 'READY')
        .map((r) => ({
          ticker: r.stock.ticker,
          cluster: r.stock.cluster || 'General',
          rankScore: r.rankScore,
          status: r.status,
        }));

      const swaps = findSwapSuggestions(enrichedForSwap, scanCandidates, totalPortfolioValue, riskProfile);
      swapAlerts = swaps.map((s) => ({
        cluster: s.cluster,
        weakTicker: s.weakTicker,
        weakRMultiple: s.weakRMultiple,
        strongTicker: s.strongTicker,
        reason: s.reason,
      }));
      if (swapAlerts.length > 0) {
        alerts.push(`${swapAlerts.length} swap suggestion(s) — stronger candidates available`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [5] Swap suggestions failed:', (error as Error).message);
    }

    // Whipsaw kill switch (isolated)
    try {
      const closedPositions = await prisma.position.findMany({
        where: { userId, status: 'CLOSED' },
        include: { stock: true },
        orderBy: { exitDate: 'desc' },
        take: 50,
      });
      const blocks = checkWhipsawBlocks(
        closedPositions.map((p) => ({
          ticker: p.stock.ticker,
          exitDate: p.exitDate || new Date(),
          exitReason: p.exitReason,
          whipsawCount: p.whipsawCount ?? 0,
        }))
      );
      whipsawAlerts = blocks.map((w) => ({
        ticker: w.ticker,
        stopsInLast30Days: w.stopsInLast30Days,
        reason: w.reason,
      }));
      if (whipsawAlerts.length > 0) {
        alerts.push(`${whipsawAlerts.length} ticker(s) blocked by whipsaw kill switch`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [5] Whipsaw check failed:', (error as Error).message);
    }

    // Breadth safety (isolated)
    try {
      const stocks = await prisma.stock.findMany({ where: { active: true }, select: { ticker: true } });
      const universeTickers = stocks.map((s) => s.ticker);
      // Sample up to 30 tickers for breadth — avoids 266 sequential Yahoo calls
      const sampleSize = Math.min(30, universeTickers.length);
      const shuffled = [...universeTickers].sort(() => Math.random() - 0.5);
      const breadthSample = shuffled.slice(0, sampleSize);
      console.log(`        Breadth sample: ${breadthSample.length} of ${universeTickers.length} tickers`);
      const breadthPct = breadthSample.length > 0 ? await calculateBreadth(breadthSample) : 100;

      const { maxPositions } = getRiskBudget(
        enrichedForSwap.map((p) => ({
          id: p.id,
          ticker: p.ticker,
          sleeve: p.sleeve,
          sector: 'Unknown',
          cluster: p.cluster,
          value: p.value,
          riskDollars: 0,
          shares: 0,
          entryPrice: 0,
          currentStop: 0,
          currentPrice: 0,
        })),
        equity,
        riskProfile
      );
      const breadthResult = checkBreadthSafety(breadthPct, maxPositions);
      breadthAlert = {
        breadthPct: breadthResult.breadthPct,
        isRestricted: breadthResult.isRestricted,
        maxPositionsOverride: breadthResult.maxPositionsOverride,
        reason: breadthResult.reason,
      };
      if (breadthResult.isRestricted) {
        alerts.push(`Breadth ${breadthPct.toFixed(0)}% < 40% — max positions reduced to ${breadthResult.maxPositionsOverride}`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [5] Breadth safety failed:', (error as Error).message);
    }

    // Momentum expansion — gated by feature flag
    if (isEnabled('MODULE_MOMENTUM_EXPANSION')) {
      console.log('  [5] Module 13 (Momentum Expansion) — running');
      // Would call checkMomentumExpansion() here
    } else {
      console.log('  [5] Module 13 (Momentum Expansion) — DISABLED (feature flag off), skipping');
    }

    // Correlation matrix (isolated — advisory only, no hard blocks)
    let correlationPairCount = 0;
    try {
      const corrResult = await computeCorrelationMatrix();
      correlationPairCount = corrResult.pairs.length;
      if (corrResult.pairs.length > 0) {
        alerts.push(`${corrResult.pairs.length} HIGH_CORR pair(s) detected (r > 0.75)`);
      }
      if (corrResult.tickersFailed.length > 0) {
        console.warn(`        Correlation: ${corrResult.tickersFailed.length} tickers failed data fetch`);
      }
    } catch (error) {
      // Non-critical — log and continue
      console.warn('  [5] Correlation matrix failed:', (error as Error).message);
    }
    console.log(`        Climax: ${climaxAlerts.length}, Swap: ${swapAlerts.length}, Whipsaw: ${whipsawAlerts.length}, Corr pairs: ${correlationPairCount}`);

    // Sector ETF momentum cache refresh (non-blocking — BPS factor 4 data)
    try {
      const sectorResult = await refreshSectorMomentumCache();
      console.log(`        Sector ETF cache: ${sectorResult.cached} sectors cached, ${sectorResult.failed.length} failed`);
    } catch (error) {
      // Non-critical — BPS sector factor returns 0 on cache miss
      console.warn('  [5] Sector ETF cache refresh failed:', (error as Error).message);
    }

    // Step 6: Record equity snapshot + check pyramids
    console.log('  [6/9] Recording equity snapshot...');
    startStep('6', 'Equity snapshot');
    log.info('Step 6: Equity snapshot');
    let openRiskPercent = 0;
    try {
      const openRisk = positions
        .filter((p) => p.stock.sleeve !== 'HEDGE')
        .reduce((sum, p) => {
          const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
          const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
          const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
          const currentStopGbp = p.currentStop * fxRatio;
          const risk = Math.max(0, (gbpPrice - currentStopGbp) * p.shares);
          return sum + risk;
        }, 0);
      openRiskPercent = equity > 0 ? (openRisk / equity) * 100 : 0;
      await recordEquitySnapshot(userId, equity, openRiskPercent);

      // Equity drawdown alert: warn if equity drops >5% from all-time peak
      try {
        const peakSnapshot = await prisma.equitySnapshot.findFirst({
          where: { userId },
          orderBy: { equity: 'desc' },
          select: { equity: true, capturedAt: true },
        });
        if (peakSnapshot && peakSnapshot.equity > 0 && equity < peakSnapshot.equity) {
          const drawdownPct = ((peakSnapshot.equity - equity) / peakSnapshot.equity) * 100;
          if (drawdownPct >= 5) {
            const peakDate = peakSnapshot.capturedAt.toISOString().split('T')[0];
            alerts.push(`⚠️ Equity drawdown: ${drawdownPct.toFixed(1)}% below peak £${peakSnapshot.equity.toFixed(2)} (${peakDate}). Current: £${equity.toFixed(2)}. Consider CAPITAL_PRESERVATION mode.`);
            log.warn('Equity drawdown alert', { drawdownPct: drawdownPct.toFixed(1), peak: peakSnapshot.equity, current: equity });
          }
        }
      } catch (err) {
        console.warn('  [6] Equity drawdown check failed:', (err as Error).message);
      }
    } catch {
      hadFailure = true;
      await recordEquitySnapshot(userId, equity);
    }

    let pyramidAlerts: NightlyPyramidAlert[] = [];
    // Hoisted for reuse by accelerator engine (step 6c)
    const addsMap = new Map<string, number>();
    try {
      // Count existing pyramid adds per position from TradeLog
      const addCounts = await prisma.tradeLog.groupBy({
        by: ['positionId'],
        where: { userId, tradeType: 'ADD', positionId: { not: null } },
        _count: { id: true },
      });
      for (const row of addCounts) {
        if (row.positionId) addsMap.set(row.positionId, row._count.id);
      }

      // Open risk ratio for pyramid gating (0–1 scale)
      const maxOpenRiskPct = RISK_PROFILES[riskProfile].maxOpenRisk;
      const openRiskRatio = maxOpenRiskPct > 0 ? openRiskPercent / maxOpenRiskPct : 1;

      for (const p of positions) {
        if (p.stock.sleeve === 'HEDGE') continue;
        const currentPrice = livePrices[p.stock.ticker] || p.entryPrice;
        if (currentPrice <= p.entryPrice) continue;

        let atr: number | null = null;
        try {
          const bars = await getDailyPrices(p.stock.ticker, 'compact');
          if (bars.length >= 15) {
            atr = calculateATR(bars, 14);
          }
        } catch (err) { console.warn(`  [nightly] Pyramid ATR fetch skipped: ${err instanceof Error ? err.message : String(err)}`); }

        const pyramidCheck = canPyramid(
          currentPrice,
          p.entryPrice,
          p.initialRisk,
          atr ?? undefined,
          addsMap.get(p.id) ?? 0,
          openRiskRatio
        );

        if (pyramidCheck.allowed) {
          const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
          const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();

          // Compute scaled add sizing
          const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
          const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
          const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
          const addSizing = calculatePyramidAddSize({
            equity,
            riskProfile,
            addNumber: pyramidCheck.addNumber,
            currentPrice,
            currentStop: p.currentStop,
            sleeve: p.stock.sleeve as Sleeve,
            fxToGbp: fxRatio,
            allowFractional: true, // Trading 212
          });

          pyramidAlerts.push({
            ticker: p.stock.ticker,
            entryPrice: p.entryPrice,
            currentPrice,
            rMultiple: pyramidCheck.rMultiple,
            addNumber: pyramidCheck.addNumber,
            triggerPrice: pyramidCheck.triggerPrice,
            message: pyramidCheck.message,
            currency,
            riskScalar: pyramidCheck.riskScalar,
            addShares: addSizing.shares,
            addRiskAmount: addSizing.riskDollars,
            scaledRiskPercent: addSizing.scaledRiskPercent,
          });
        }
      }
      if (pyramidAlerts.length > 0) {
        alerts.push(`${pyramidAlerts.length} position(s) eligible for pyramid add`);
      }

      // Send pyramid add alerts via notification centre (Friday only — matches execution day)
      const dayOfWeekPyramid = getUKDayOfWeek(); // 0=Sun, 5=Fri — UK timezone
      if (dayOfWeekPyramid === 5 && pyramidAlerts.length > 0) {
        for (const pa of pyramidAlerts) {
          const currSymbol = pa.currency === 'GBP' || pa.currency === 'GBX' ? '£' : pa.currency === 'EUR' ? '€' : '$';
          const sizingLine = pa.addShares > 0
            ? `Add #${pa.addNumber}: ${pa.addShares.toFixed(2)} shares (risk ${currSymbol}${pa.addRiskAmount.toFixed(2)} — ${(pa.riskScalar * 100).toFixed(0)}% of base)`
            : `Add number: #${pa.addNumber}`;
          await sendAlert({
            type: 'PYRAMID_ADD',
            title: `${pa.ticker} is ready for a pyramid add`,
            message: `Your position in ${pa.ticker} has moved up enough to add more shares.\n\nR-multiple: ${pa.rMultiple.toFixed(1)}R\n${sizingLine}\n${pa.triggerPrice ? `Trigger price: ${currSymbol}${pa.triggerPrice.toFixed(2)}` : ''}\n${pa.message}\n\nPyramid adds auto-execute on Friday nightly if regime is BULLISH.`,
            data: { ticker: pa.ticker, rMultiple: pa.rMultiple, addNumber: pa.addNumber, addShares: pa.addShares, addRiskAmount: pa.addRiskAmount, riskScalar: pa.riskScalar },
            priority: 'INFO',
            telegramDedupeKey: `nightly:pyramid-ready:${pa.ticker}:${pa.addNumber}`,
            telegramThrottleMs: 6 * 24 * 60 * 60 * 1000,
          });
        }
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [6] Pyramid check failed:', (error as Error).message);
    }
    console.log(`        Equity: ${equity.toFixed(2)}, Risk: ${openRiskPercent.toFixed(1)}%, Pyramids: ${pyramidAlerts.length}`);

    // Step 6-auto: Auto-execute pyramid adds (requires ENABLE_AUTO_TRADING + regime BULLISH)
    let pyramidsExecuted = 0;
    let pyramidsFailed = 0;
    if (autoTradingEnabled && pyramidAlerts.length > 0) {
      const regime = await getMarketRegime().catch(() => 'UNKNOWN');
      const dayOfWeek = getUKDayOfWeek();

      // Only pyramid on Fridays in BULLISH regime (end-of-week confirmation)
      if (regime === 'BULLISH' && dayOfWeek === 5) {
        console.log('  [6-auto] Auto-executing pyramid adds...');
        try {
          for (const pa of pyramidAlerts) {
            if (pa.addShares <= 0) continue;

            // Find the position and its stock
            const pos = positions.find(p => p.stock.ticker === pa.ticker);
            if (!pos) continue;

            const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker;
            if (!t212Ticker) {
              console.warn(`  [6-auto] ${pa.ticker}: no T212 ticker — skipping`);
              pyramidsFailed++;
              continue;
            }

            const acctType: T212AccountType = pos.accountType === 'isa' ? 'isa' : 'invest';
            const client = await getNightlyT212Client(userId, acctType);
            if (!client) {
              console.warn(`  [6-auto] ${pa.ticker}: T212 ${acctType} client unavailable`);
              pyramidsFailed++;
              continue;
            }

            // Cash check: verify sufficient funds before placing order
            try {
              const summary = await client.getAccountSummary();
              const availableCash = summary.cash.availableToTrade;
              const estimatedCost = pa.addShares * pa.currentPrice;

              if (availableCash < estimatedCost) {
                console.warn(`  [6-auto] ${pa.ticker}: insufficient cash (need ${estimatedCost.toFixed(2)}, have ${availableCash.toFixed(2)})`);
                alerts.push(`⚠ Pyramid ${pa.ticker}: insufficient cash (need ${estimatedCost.toFixed(2)}, have ${availableCash.toFixed(2)})`);
                pyramidsFailed++;
                continue;
              }
            } catch (err) {
              console.warn(`  [6-auto] ${pa.ticker}: cash check failed — ${(err as Error).message}`);
              pyramidsFailed++;
              continue;
            }

            // Place market buy order for the add
            try {
              const buyOrder = await client.placeMarketOrder({ quantity: pa.addShares, ticker: t212Ticker });
              console.log(`  [6-auto] ${pa.ticker}: pyramid add placed (order ${buyOrder.id}, ${pa.addShares} shares)`);

              // Note: entryPrice uses pa.currentPrice (last close from scan), not the actual fill.
              // The actual fill may differ due to slippage. The next T212 position sync (midday/nightly)
              // will reconcile the real fill price. This is acceptable for the pyramid use case
              // because the position already has a stop, and slippage on an add is small relative to R.

              // Fix 4: Update position shares in DB so next nightly uses correct count
              const newTotalShares = pos.shares + pa.addShares;
              await prisma.position.update({
                where: { id: pos.id },
                data: { shares: newTotalShares },
              });

              // Fix 2: Place protective stop for the full position (original + added shares)
              // This ensures the added shares are covered by the existing stop on T212.
              try {
                await client.setStopLoss(t212Ticker, newTotalShares, pos.currentStop);
                console.log(`  [6-auto] ${pa.ticker}: stop updated for ${newTotalShares.toFixed(2)} total shares`);
              } catch (stopErr) {
                console.warn(`  [6-auto] ${pa.ticker}: stop update after pyramid failed — ${(stopErr as Error).message}`);
                alerts.push(`⚠ ${pa.ticker}: pyramid bought but stop may not cover new shares — check T212`);
              }

              // Log to execution audit
              await prisma.executionLog.create({
                data: {
                  ticker: pa.ticker,
                  phase: 'PYRAMID_ADD',
                  orderId: String(buyOrder.id),
                  requestBody: JSON.stringify({ shares: pa.addShares, t212Ticker, addNumber: pa.addNumber, newTotalShares }),
                  responseStatus: 200,
                  quantity: pa.addShares,
                  accountType: acctType,
                },
              });

              // Log to TradeLog as ADD type
              await prisma.tradeLog.create({
                data: {
                  userId,
                  positionId: pos.id,
                  ticker: pa.ticker,
                  tradeDate: new Date(),
                  tradeType: 'ADD',
                  entryPrice: pa.currentPrice, // Approximate — actual fill reconciled by T212 sync
                  shares: pa.addShares,
                  decision: 'AUTO_PYRAMID',
                  decisionReason: `Auto pyramid add #${pa.addNumber} at ${pa.rMultiple.toFixed(1)}R`,
                },
              });

              // Send alert
              await sendAlert({
                type: 'PYRAMID_ADD',
                title: `✅ Auto pyramid: ${pa.ticker} add #${pa.addNumber}`,
                message: `Bought ${pa.addShares.toFixed(2)} shares at ~${pa.currentPrice.toFixed(2)} (${pa.rMultiple.toFixed(1)}R). Total: ${newTotalShares.toFixed(2)} shares. Stop covers full position.`,
                priority: 'INFO',
              });

              pyramidsExecuted++;
              alerts.push(`✅ Pyramid ${pa.ticker}: ${pa.addShares.toFixed(2)} shares added at ${pa.rMultiple.toFixed(1)}R`);
            } catch (err) {
              console.error(`  [6-auto] ${pa.ticker}: pyramid buy failed — ${(err as Error).message}`);
              alerts.push(`⚠ Pyramid ${pa.ticker} FAILED: ${(err as Error).message}`);
              pyramidsFailed++;
            }
          }
        } catch (error) {
          console.warn('  [6-auto] Auto pyramid execution failed:', (error as Error).message);
        }
      } else {
        console.log(`  [6-auto] Pyramid auto-exec skipped (regime=${regime}, day=${dayOfWeek})`);
      }
    }
    if (pyramidsExecuted > 0 || pyramidsFailed > 0) {
      console.log(`        Auto pyramids: ${pyramidsExecuted} executed, ${pyramidsFailed} failed`);
    }

    // Step 6b: Equity milestone check (advisory only — never auto-changes risk profile)
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const dismissed: number[] = user?.dismissedEquityThresholds
        ? JSON.parse(user.dismissedEquityThresholds) as number[]
        : [];
      for (const threshold of EQUITY_REVIEW_THRESHOLDS) {
        if (equity >= threshold.equity && !dismissed.includes(threshold.equity)) {
          alerts.push(`💰 ${threshold.message}`);
          await sendAlert({
            type: 'EQUITY_MILESTONE',
            title: `Equity milestone: £${threshold.equity.toLocaleString()}`,
            message: threshold.message,
            data: { threshold: threshold.equity, equity },
            priority: 'INFO',
          });
          console.log(`        Equity milestone: £${threshold.equity}`);
        }
      }
    } catch (error) {
      // Non-critical — don't fail the pipeline for an advisory check
      console.warn('  [6b] Equity milestone check failed:', (error as Error).message);
    }

    // Step 6c: Profit Acceleration — Capital Priority Engine (advisory only)
    let acceleratorAlerts: NightlyAcceleratorAlert[] = [];
    try {
      // Build HeldPosition data for the accelerator
      const accelPositions: HeldPosition[] = positions.map((p) => {
        const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const rMult = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
        const extras = laggardExtrasCache?.get(p.stock.ticker);
        return {
          id: p.id,
          ticker: p.stock.ticker,
          sleeve: p.stock.sleeve as Sleeve,
          sector: p.stock.sector || 'Unknown',
          cluster: p.stock.cluster || 'General',
          entryPrice: p.entryPrice,
          currentPrice: rawPrice,
          currentStop: p.currentStop,
          shares: p.shares,
          initialRisk: p.initialRisk,
          entryDate: p.entryDate,
          daysHeld: Math.floor((Date.now() - p.entryDate.getTime()) / 86400000),
          rMultiple: rMult,
          atr: p.atr_at_entry || 0,
          currency: p.stock.currency || 'USD',
          pyramidAdds: addsMap.get(p.id) ?? 0,
          ma20: extras?.ma20,
          adxToday: extras?.adxToday,
          adxYesterday: extras?.adxYesterday,
        };
      });

      // Build candidate data from latest scan (CandidateOutcome has NCS/FWS)
      const accelCandidates: AcceleratorCandidate[] = [];
      try {
        const recentCandidates = await prisma.candidateOutcome.findMany({
          where: {
            status: 'READY',
            scanDate: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
          },
          orderBy: { ncs: 'desc' },
          take: 30,
        });
        const heldTickers = new Set(positions.map((p) => p.stock.ticker));
        for (const r of recentCandidates) {
          if (heldTickers.has(r.ticker)) continue;
          accelCandidates.push({
            ticker: r.ticker,
            sleeve: (r.sleeve || 'CORE') as Sleeve,
            sector: r.sector || 'Unknown',
            cluster: r.cluster || 'General',
            ncs: r.ncs ?? 0,
            fws: r.fws ?? 0,
            actionNote: r.dualScoreAction ?? '',
            entryTrigger: r.entryTrigger ?? 0,
            stopPrice: r.stopPrice ?? 0,
            riskDollars: r.suggestedRiskGbp ?? 0,
            totalCost: r.suggestedCostGbp ?? 0,
          });
        }
      } catch {
        // Non-critical — accelerator runs with empty candidates
      }

      const accelCtx: AcceleratorContext = {
        positions: accelPositions,
        candidates: accelCandidates,
        equity,
        riskProfile,
        regime: (await getMarketRegime()) as AcceleratorContext['regime'],
        openRiskPercent,
      };

      const recommendations = rankActions(accelCtx);
      const actionable = recommendations.filter(
        (r) => r.action !== 'HOLD' && r.action !== 'NO_ACTION'
      );

      acceleratorAlerts = actionable.map((r) => ({
        action: r.action,
        ticker: r.ticker,
        replacementTicker: r.replacementTicker,
        urgency: r.urgency,
        reason: r.reason,
        expectedBenefit: r.expectedBenefit,
        riskImpact: r.riskImpact,
      }));

      if (acceleratorAlerts.length > 0) {
        alerts.push(`⚡ ${acceleratorAlerts.length} capital priority action(s) — review in plan page`);
      }
      console.log(`        Accelerator: ${acceleratorAlerts.length} actionable recommendations`);
    } catch (error) {
      // Non-critical — accelerator is advisory-only
      console.warn('  [6c] Profit accelerator failed:', (error as Error).message);
    }

    // Step 7: Sync snapshot + query READY candidates
    console.log('  [7/9] Syncing snapshot data...');
    startStep('7', 'Snapshot sync');
    log.info('Step 7: Snapshot sync');
    const positionDetails: NightlyPositionDetail[] = positions.map((p) => {
      const currentPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? currentPrice;
      const fxRatio = currentPrice > 0 ? gbpPrice / currentPrice : 1;
      // Use GBP-normalised prices for cross-currency PnL aggregation
      const pnlValue = (gbpPrice - p.entryPrice * fxRatio) * p.shares;
      const pnlPercent = p.entryPrice > 0 ? ((currentPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
      const rMultiple = p.initialRisk > 0 ? (currentPrice - p.entryPrice) / p.initialRisk : 0;
      const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
      const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
      return {
        ticker: p.stock.ticker,
        sleeve: p.stock.sleeve,
        shares: p.shares,
        entryPrice: p.entryPrice,
        currentPrice,
        currentStop: p.currentStop,
        protectionLevel: p.protectionLevel,
        rMultiple,
        pnl: pnlValue,
        pnlPercent,
        currency,
      };
    });

    let snapshotSync = { synced: false, rowCount: 0, failed: [] as string[], snapshotId: '', failureReasons: new Map<string, string>() };
    try {
      const result = await syncSnapshot();
      snapshotSync = { synced: true, rowCount: result.rowCount, failed: result.failed, snapshotId: result.snapshotId, failureReasons: result.failureReasons };
      if (result.failed.length > 0) {
        alerts.push(`Snapshot sync: ${result.rowCount} tickers synced, ${result.failed.length} failed`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [7] Snapshot sync failed:', (error as Error).message);
      alerts.push('Snapshot sync failed — scores may be stale');
    }
    console.log(`        Snapshot: ${snapshotSync.rowCount} synced, ${snapshotSync.failed.length} failed`);

    // ── Auto-deactivate chronically dead tickers ──
    if (snapshotSync.synced && snapshotSync.failureReasons.size > 0) {
      try {
        const { updateStaleTracking } = await import('@/lib/stale-ticker-tracker');
        const activeStocksForTracking = await prisma.stock.findMany({ where: { active: true }, select: { ticker: true } });
        const allActive = new Set(activeStocksForTracking.map(s => s.ticker));
        const staleResult = await updateStaleTracking(snapshotSync.failureReasons, allActive);
        if (staleResult.deactivated.length > 0) {
          alerts.push(`Auto-deactivated ${staleResult.deactivated.length} dead tickers: ${staleResult.deactivated.join(', ')}`);
          console.log(`        Auto-deactivated: ${staleResult.deactivated.join(', ')}`);
        }
        if (staleResult.tracked > 0) {
          console.log(`        Stale tracking: ${staleResult.tracked} tickers being monitored`);
        }
      } catch (error) {
        console.warn('  [7] Stale ticker tracking failed:', (error as Error).message);
      }
    }

    // ── Score Breakdown: record BQS/FWS/NCS component decomposition for analytics ──
    if (snapshotSync.snapshotId && snapshotSync.synced) {
      try {
        const allSnapshotRows = await prisma.snapshotTicker.findMany({
          where: { snapshotId: snapshotSync.snapshotId },
        });
        const scoredTickers = allSnapshotRows.map((st) => {
          const row = normaliseRow({
            ticker: st.ticker, name: st.name || st.ticker, sleeve: st.sleeve || 'CORE',
            status: st.status || 'FAR', close: st.close, atr_14: st.atr14,
            atr_pct: st.atrPct, adx_14: st.adx14, plus_di: st.plusDi,
            minus_di: st.minusDi, vol_ratio: st.volRatio,
            market_regime: st.marketRegime, market_regime_stable: st.marketRegimeStable,
            distance_to_20d_high_pct: st.distanceTo20dHighPct,
            entry_trigger: st.entryTrigger, stop_level: st.stopLevel,
            chasing_20_last5: st.chasing20Last5, chasing_55_last5: st.chasing55Last5,
            atr_spiking: st.atrSpiking, atr_collapsing: st.atrCollapsing,
            rs_vs_benchmark_pct: st.rsVsBenchmarkPct,
            days_to_earnings: st.daysToEarnings, earnings_in_next_5d: st.earningsInNext5d,
            cluster_name: st.clusterName, super_cluster_name: st.superClusterName,
            cluster_exposure_pct: st.clusterExposurePct,
            super_cluster_exposure_pct: st.superClusterExposurePct,
            max_cluster_pct: st.maxClusterPct, max_super_cluster_pct: st.maxSuperClusterPct,
            weekly_adx: st.weeklyAdx, vol_regime: st.volRegime,
            dual_regime_aligned: st.dualRegimeAligned, bis_score: st.bisScore,
            currency: st.currency,
          });
          return scoreRow(row);
        });
        const sbResult = await saveScoreBreakdowns(
          scoredTickers,
          snapshotSync.snapshotId,
          allSnapshotRows[0]?.marketRegime || 'NEUTRAL'
        );
        console.log(`        ScoreBreakdown: ${sbResult.saved} saved, ${sbResult.errors} errors`);
      } catch (sbError) {
        console.warn('  [7] ScoreBreakdown save failed:', (sbError as Error).message);
        // Non-fatal — analytics data loss, not pipeline failure
      }
    }

    let readyToBuy: NightlyReadyCandidate[] = [];
    let triggerMetCandidates: NightlyTriggerMetCandidate[] = [];
    if (snapshotSync.snapshotId) {
      try {
        const heldTickers = new Set(positions.map((p) => p.stock.ticker));
        const readyRows = await prisma.snapshotTicker.findMany({
          where: { snapshotId: snapshotSync.snapshotId, status: 'READY' },
          orderBy: { distanceTo20dHighPct: 'asc' },
          take: 15,
        });
        readyToBuy = readyRows
          .filter((r) => !heldTickers.has(r.ticker) && r.adx14 >= 20)
          .map((r) => ({
            ticker: r.ticker,
            name: r.name || r.ticker,
            sleeve: r.sleeve || 'CORE',
            close: r.close,
            entryTrigger: r.entryTrigger,
            stopLevel: r.stopLevel,
            // Distance to entry trigger (not raw 20d high) — matches classifyCandidate
            distancePct: r.close > 0 && r.entryTrigger > 0
              ? ((r.entryTrigger - r.close) / r.close) * 100
              : r.distanceTo20dHighPct,
            atr14: r.atr14,
            adx14: r.adx14,
            currency: r.currency || 'USD',
          }));

        // Detect trigger-met candidates: close >= entryTrigger and not already held
        const allTriggeredRows = await prisma.snapshotTicker.findMany({
          where: {
            snapshotId: snapshotSync.snapshotId,
            status: { in: ['READY', 'WATCH'] },
          },
          orderBy: { distanceTo20dHighPct: 'asc' },
        });
        triggerMetCandidates = allTriggeredRows
          .filter((r) => !heldTickers.has(r.ticker) && r.close >= r.entryTrigger && r.entryTrigger > 0 && r.adx14 >= 20)
          .map((r) => ({
            ticker: r.ticker,
            name: r.name || r.ticker,
            sleeve: r.sleeve || 'CORE',
            close: r.close,
            entryTrigger: r.entryTrigger,
            stopLevel: r.stopLevel,
            distancePct: ((r.close - r.entryTrigger) / r.entryTrigger) * 100,
            atr14: r.atr14,
            adx14: r.adx14,
            currency: r.currency || 'USD',
          }));
        if (triggerMetCandidates.length > 0) {
          alerts.push(`🚨 ${triggerMetCandidates.length} trigger(s) met — review for immediate entry`);
        }
      } catch (error) {
        hadFailure = true;
        console.warn('  [7b] Failed to query READY tickers:', (error as Error).message);
      }
    }

    // ── Step 7c: Pre-cache earnings dates for READY/WATCH candidates ──
    // Fetches from Yahoo quoteSummary(calendarEvents) and writes to EarningsCache table.
    // This means Tuesday morning's scan reads from cache — no additional Yahoo calls needed.
    console.log('  [7c] Pre-caching earnings dates...');
    try {
      // Gather unique tickers from ready-to-buy + trigger-met candidates + all READY/WATCH from snapshot
      const earningsTickers = new Set<string>();
      for (const r of readyToBuy) earningsTickers.add(r.ticker);
      for (const t of triggerMetCandidates) earningsTickers.add(t.ticker);

      // Also include all READY/WATCH from latest snapshot for broader coverage
      if (snapshotSync.snapshotId) {
        const watchRows = await prisma.snapshotTicker.findMany({
          where: {
            snapshotId: snapshotSync.snapshotId,
            status: { in: ['READY', 'WATCH'] },
          },
          select: { ticker: true },
        });
        for (const r of watchRows) earningsTickers.add(r.ticker);
      }

      const tickerList = Array.from(earningsTickers);
      if (tickerList.length > 0) {
        const earningsResult = await preCacheEarningsBatch(tickerList);
        console.log(`        Earnings cached: ${earningsResult.success} success, ${earningsResult.failed} failed of ${tickerList.length}`);
        if (earningsResult.failed > 0) {
          alerts.push(`Earnings cache: ${earningsResult.failed}/${tickerList.length} tickers failed`);
        }
      } else {
        console.log('        No READY/WATCH candidates — earnings cache skipped');
      }
    } catch (error) {
      // Non-critical — scan will fall through to UNKNOWN confidence (no penalty)
      console.warn('  [7c] Earnings pre-cache failed:', (error as Error).message);
    }

    // ── Alert Generation — In-app notifications via alert-service ────
    const dayOfWeek = getUKDayOfWeek(); // 0=Sunday, 2=Tuesday — UK timezone

    // ALERT 1: Trade triggers (Tuesday only, max 3)
    if (dayOfWeek === 2 && triggerMetCandidates.length > 0) {
      try {
        // Take top 3 by closest distance (already sorted by distanceTo20dHighPct asc)
        const topTriggers = triggerMetCandidates.slice(0, 3);
        const extraCount = triggerMetCandidates.length - topTriggers.length;

        for (const t of topTriggers) {
          const currSymbol = t.currency === 'GBP' || t.currency === 'GBX' ? '£' : t.currency === 'EUR' ? '€' : '$';
          const riskPerShare = t.entryTrigger > 0 && t.stopLevel > 0 ? t.entryTrigger - t.stopLevel : 0;
          await sendAlert({
            type: 'TRADE_TRIGGER',
            title: `${t.ticker} is ready to buy`,
            message: `The system found a trade for Tuesday.\n${t.name} (${t.ticker})\nBuy price: ${currSymbol}${t.entryTrigger.toFixed(2)}\nStop-loss: ${currSymbol}${t.stopLevel.toFixed(2)}${riskPerShare > 0 ? `\nRisk per share: ${currSymbol}${riskPerShare.toFixed(2)}` : ''}\n\nOpen the Plan page to review.${extraCount > 0 ? `\n\nand ${extraCount} more in the app.` : ''}`,
            data: { ticker: t.ticker, entryTrigger: t.entryTrigger, stopLevel: t.stopLevel, close: t.close },
            priority: 'INFO',
          });
        }
        console.log(`        Trade trigger alerts: ${topTriggers.length} sent${extraCount > 0 ? ` (+${extraCount} more in app)` : ''}`);
      } catch (error) {
        console.warn('  [7c] Trade trigger alerts failed:', (error as Error).message);
      }
    }

    // ALERT 2: Weekly summary (Sunday only)
    if (dayOfWeek === 0) {
      try {
        // Determine market mood from regime
        const latestRegime = await prisma.regimeHistory.findFirst({ orderBy: { date: 'desc' } });
        const mood = latestRegime?.regime === 'BULLISH' ? 'Positive ✓'
          : latestRegime?.regime === 'BEARISH' ? 'Negative ✗'
          : 'Neutral —';

        // Position tickers as comma-separated
        const positionTickers = positions.map((p) => p.stock.ticker).join(', ') || 'None';

        // Portfolio value in GBP
        const portfolioValue = positions.reduce((sum, p) => {
          const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
          const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
          return sum + gbpPrice * p.shares;
        }, 0);

        // Closest to triggering (top 3 from readyToBuy)
        const closest = readyToBuy.slice(0, 3);
        const closestLines = closest.length > 0
          ? closest.map((c) => `· ${c.ticker} — ${c.distancePct.toFixed(2)}% away`).join('\n')
          : 'None close to triggering';

        const watchCount = readyToBuy.length;

        await sendAlert({
          type: 'WEEKLY_SUMMARY',
          title: 'Weekly Summary',
          message: `Market mood: ${mood}\nOpen positions: ${positions.length} (${positionTickers})\nPortfolio value: £${portfolioValue.toFixed(0)}\nCandidates watching: ${watchCount}\n\nClosest to triggering:\n${closestLines}\n\nYour trading window is Tuesday.`,
          data: { mood, positionCount: positions.length, portfolioValue, watchCount },
          priority: 'INFO',
          // Sunday nightly report (sendNightlySummary) already sends a comprehensive
          // Telegram message — suppress Telegram here to avoid a confusing double-message.
          // The in-app notification still saves to DB for the notifications page.
          skipTelegram: true,
        });
        console.log('        Weekly summary alert sent');
      } catch (error) {
        console.warn('  [7d] Weekly summary alert failed:', (error as Error).message);
      }
    }

    // Step 7b: Conformal calibration recalibration (non-critical)
    console.log('  [7b] Checking conformal calibration...');
    try {
      const calResult = await runFullCalibration(null, false);
      if (calResult.calibrated) {
        console.log(`        Recalibrated: ${calResult.sampleSize} samples across ${calResult.coverageLevels.length} coverage levels`);
        await sendAlert({
          type: 'CALIBRATION_COMPLETE',
          title: 'NCS Calibration Complete',
          message: `Conformal calibration updated: ${calResult.sampleSize} samples, ${calResult.coverageLevels.length} coverage levels`,
          priority: 'INFO',
          skipTelegram: true,
        });
      } else {
        console.log(`        Skipped: ${calResult.skippedReason ?? 'unknown reason'}`);
      }
    } catch (error) {
      // Non-critical — calibration failure should not affect the pipeline
      console.warn('  [7b] Conformal calibration failed:', (error as Error).message);
    }

    // Step 7c: Signal weight meta-model training (weekly, Sunday only)
    const ukDay = getUKDayOfWeek();
    if (ukDay === 0) {
      console.log('  [7c] Running weekly signal weight training...');
      try {
        const trainResult = await runMetaModelTraining(false);
        if (trainResult.trained) {
          console.log(`        Trained: source=${trainResult.source}, outcomes=${trainResult.outcomeCount}`);
          await sendAlert({
            type: 'SIGNAL_WEIGHTS_SHIFTED',
            title: 'Signal Weights Updated',
            message: `Meta-model retrained: source=${trainResult.source}, ${trainResult.outcomeCount} outcomes`,
            priority: 'INFO',
            skipTelegram: true,
          });
        } else {
          console.log(`        Skipped: ${trainResult.reason ?? 'unknown reason'}`);
        }
      } catch (error) {
        // Non-critical — training failure should not affect the pipeline
        console.warn('  [7c] Signal weight training failed:', (error as Error).message);
      }
    }

    // Step 7d: Lead-lag graph recomputation (weekly, Sunday only)
    if (ukDay === 0) {
      console.log('  [7d] Recomputing lead-lag graph...');
      try {
        const llResult = await recomputeLeadLagGraph(50);
        console.log(`        Found ${llResult.edgesFound} edges across ${llResult.tickersProcessed} tickers`);
      } catch (error) {
        // Non-critical — lead-lag failure should not affect the pipeline
        console.warn('  [7d] Lead-lag graph computation failed:', (error as Error).message);
      }
    }

    // Step 7e: GNN training (weekly, Sunday only, after lead-lag graph is fresh)
    if (ukDay === 0) {
      console.log('  [7e] Running GNN training...');
      try {
        const gnnResult = await runGNNTraining(false);
        if (gnnResult.trained) {
          console.log(`        GNN trained: loss=${gnnResult.finalLoss.toFixed(4)}, samples=${gnnResult.sampleSize}`);
        } else {
          console.log(`        GNN skipped: ${gnnResult.reason ?? 'unknown'}`);
        }
      } catch (error) {
        console.warn('  [7e] GNN training failed:', (error as Error).message);
      }
    }

    // Step 8: Send Telegram summary (isolated — failure doesn't block heartbeat)
    console.log('  [8/9] Sending Telegram summary...');
    startStep('8', 'Telegram alert');
    log.info('Step 8: Telegram summary');

    // Fetch today's price accuracy stats (T212 vs Yahoo)
    let priceAccuracy: { avgDiffPercent: number; maxDiffPercent: number; snapshotCount: number } | null = null;
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const snapshots = await prisma.priceSnapshot.findMany({
        where: { capturedAt: { gte: dayAgo }, diffPercent: { not: null } },
        select: { diffPercent: true },
      });
      if (snapshots.length > 0) {
        const diffs = snapshots.map(s => s.diffPercent!);
        priceAccuracy = {
          avgDiffPercent: Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length * 100) / 100,
          maxDiffPercent: Math.round(Math.max(...diffs) * 100) / 100,
          snapshotCount: snapshots.length,
        };
      }
    } catch { /* advisory — don't block telegram */ }

    let telegramSent = false;
    try {
      telegramSent = await sendNightlySummary({
      date: new Date().toISOString().split('T')[0],
      healthStatus: healthReport.overall,
      regime: snapshotSync.synced ? 'SYNCED' : 'UNKNOWN',
      openPositions: positions.length,
      stopsUpdated: stopChanges.length + trailingStopChanges.length,
      readyCandidates: readyToBuy.length,
      alerts,
      // Portfolio value in GBP for multi-currency consistency
      portfolioValue: positions.reduce((sum, p) => {
        const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
        return sum + gbpPrice * p.shares;
      }, 0),
      dailyChange: 0,
      dailyChangePercent: 0,
      equity,
      openRiskPercent,
      positions: positionDetails,
      stopChanges,
      trailingStopChanges,
      snapshotSynced: snapshotSync.rowCount,
      snapshotFailed: snapshotSync.failed.length,
      readyToBuy,
      triggerMet: triggerMetCandidates,
      pyramidAlerts,
      laggards: laggardAlerts,
      climaxAlerts,
      swapAlerts,
      whipsawAlerts,
      breadthAlert,
      momentumAlert,
      gapRiskAlerts,
      breakoutFailures: breakoutFailureAlerts,
      acceleratorAlerts,
      priceAccuracy,
    });
    } catch (error) {
      // Telegram is optional infrastructure — failure must not degrade heartbeat
      console.error('  [8] Telegram send failed:', (error as Error).message);
    }
    console.log(`        Telegram: ${telegramSent ? 'SENT' : 'NOT SENT (check credentials)'}`);

    // Step 9: Write heartbeat
    console.log('  [9/9] Writing heartbeat...');
    finalizeSteps();
    // Derive status: SUCCESS (no failures), PARTIAL (some steps failed, pipeline completed), FAILED (critical)
    const failedSteps = stepResults.filter(s => s.status === 'FAILED');
    const heartbeatStatus = !hadFailure ? 'SUCCESS' : failedSteps.length < stepResults.length ? 'PARTIAL' : 'FAILED';
    if (heartbeatStatus === 'PARTIAL') {
      const degradedNames = failedSteps.map(s => `Step ${s.step} (${s.name})`).join(', ');
      alerts.push(`⚠️ Degraded steps: ${degradedNames}`);
    }
    await prisma.heartbeat.create({
      data: {
        status: heartbeatStatus,
        details: JSON.stringify({
          healthStatus: healthReport.overall,
          positionsChecked: positions.length,
          stopsRecommended: stopRecs.length,
          trailingStopsApplied: trailingStopChanges.length,
          alertsCount: alerts.length,
          telegramSent,
          hadFailure,
          stepResults,
          snapshotSync,
          positionSync: {
            checked: positionSyncResult.checked,
            closed: positionSyncResult.closed,
            skipped: positionSyncResult.skipped,
            errors: positionSyncResult.errors,
          },
          // Data source fallback chain health
          dataSource: {
            health: dataSourceHealth,
            staleTickers: dataSourceStaleTickers,
            maxStalenessHours: dataSourceMaxStalenessHours,
            summary: dataSourceSummary,
          },
        }),
      },
    });

    console.log('========================================');
    console.log('[HybridTurtle] Nightly process completed successfully');

    // Step self-test: warn if any step took >5 minutes (300s)
    finalizeSteps();
    const STEP_SLOW_THRESHOLD_MS = 5 * 60 * 1000;
    const slowSteps = stepResults.filter(s => s.durationMs > STEP_SLOW_THRESHOLD_MS);
    if (slowSteps.length > 0) {
      const slowList = slowSteps.map(s => `${s.name}: ${(s.durationMs / 1000).toFixed(0)}s`).join(', ');
      log.warn('Slow steps detected', { slowSteps: slowList, thresholdMs: STEP_SLOW_THRESHOLD_MS });
      alerts.push(`⏱ ${slowSteps.length} step(s) took >5 min: ${slowList}`);
    }
    const failedStepsFinal = stepResults.filter(s => s.status === 'FAILED');
    if (failedStepsFinal.length > 0) {
      const failList = failedStepsFinal.map(s => `${s.name}: ${s.error ?? 'unknown'}`).join('; ');
      log.warn('Failed steps in nightly', { failedSteps: failList });
    }

    log.info('Nightly process completed', {
      status: hadFailure ? 'PARTIAL' : 'SUCCESS',
      health: healthReport.overall,
      positions: positions.length,
      alerts: alerts.length,
      telegramSent,
      steps: stepResults.map(s => ({ step: s.step, name: s.name, status: s.status, durationMs: s.durationMs })),
    });
    console.log(`  Health: ${healthReport.overall}`);
    console.log(`  Positions: ${positions.length}`);
    console.log(`  Alerts: ${alerts.length}`);
    console.log(`  Telegram: ${telegramSent ? 'Sent' : 'Not sent'}`);
    console.log('========================================');
  } catch (error) {
    console.error('[HybridTurtle] Nightly process error:', error);

    // Still write heartbeat on failure
    try {
      await prisma.heartbeat.create({
        data: {
          status: 'FAILED',
          details: JSON.stringify({ error: (error as Error).message }),
        },
      });
    } catch (err) { console.warn(`  [nightly] Heartbeat write skipped: ${err instanceof Error ? err.message : String(err)}`); }
  } finally {
    // Safety net: if latest heartbeat is still RUNNING, mark as FAILED
    try {
      const latest = await prisma.heartbeat.findFirst({ orderBy: { timestamp: 'desc' } });
      if (latest?.status === 'RUNNING') {
        await prisma.heartbeat.create({
          data: {
            status: 'FAILED',
            details: JSON.stringify({ error: 'Pipeline exited with RUNNING status — forced to FAILED' }),
          },
        });
        console.warn('  [!!!] RUNNING heartbeat found in finally — forced to FAILED');
      }
    } catch (err) { console.warn(`  [nightly] Safety-net heartbeat skipped: ${err instanceof Error ? err.message : String(err)}`); }
    await prisma.$disconnect();
  }
}

// If running directly via tsx / node
const args = process.argv.slice(2);

if (args.includes('--run-now')) {
  console.log('[HybridTurtle] Running nightly process immediately (--run-now)');
  runNightlyProcess().then(() => process.exit(0));
}
