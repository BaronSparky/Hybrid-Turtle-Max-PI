export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runFullScan } from '@/lib/scan-engine';
import {
  clearScanCache,
  getScanCache,
  isScanCacheFresh,
  SCAN_CACHE_TTL_MS,
  setScanCache,
} from '@/lib/scan-cache';
import {
  ATR_VOLATILITY_CAP_ALL,
  ATR_VOLATILITY_CAP_HIGH_RISK,
  DEFAULT_GAP_GUARD_CONFIG,
  type RiskProfileType,
  type GapGuardConfig,
  type GapGuardMode,
  type MarketRegime,
  type ScanCandidate,
  type Sleeve,
} from '@/types';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { isNightlyRunning } from '@/lib/nightly-guard';
import { normalizePersistedPassFlag } from '@/lib/scan-pass-flags';
import { updateScanProgress, clearScanProgress } from '@/lib/scan-progress';
import { getSlippageStats } from '@/lib/slippage-tracker';
import { saveFilterAttributions } from '@/lib/filter-attribution';
import { saveCandidateOutcomes } from '@/lib/candidate-outcome';
import { getDataFreshness } from '@/lib/market-data';
import { applyModelLayerToCandidates } from '../../../../packages/model/src';
import { assertScanAllowed, SafetyControlError } from '../../../../packages/workflow/src';
import { classifyCandidates, type GradingContext } from '@/lib/candidate-grade';

const scanRequestSchema = z.object({
  userId: z.string().trim().min(1),
  riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'SMALL_ACCOUNT', 'AGGRESSIVE']),
  equity: z.coerce.number().positive(),
});

// ── POST: Run a fresh scan, persist to DB + cache in memory ─────────
export async function POST(request: NextRequest) {
  // Guard: block bulk Yahoo calls while nightly is running
  if (await isNightlyRunning()) {
    return apiError(503, 'NIGHTLY_RUNNING',
      'Nightly scan is currently running — manual scan unavailable for a few minutes. Try again shortly.');
  }

  try {
    await assertScanAllowed();
  } catch (error) {
    if (error instanceof SafetyControlError) {
      return apiError(423, error.code, error.message);
    }
    throw error;
  }

  try {
    const parsed = await parseJsonBody(request, scanRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { userId, riskProfile, equity } = parsed.data;

    // Read user's gap guard config from DB (falls back to defaults if not set)
    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        gapGuardMode: true,
        gapGuardWeekendATR: true,
        gapGuardWeekendPct: true,
        gapGuardDailyATR: true,
        gapGuardDailyPct: true,
        modelLayerEnabled: true,
      },
    });
    const gapGuardConfig: GapGuardConfig = {
      enabledDays: (userSettings?.gapGuardMode as GapGuardMode) || DEFAULT_GAP_GUARD_CONFIG.enabledDays,
      weekendThresholdATR: userSettings?.gapGuardWeekendATR ?? DEFAULT_GAP_GUARD_CONFIG.weekendThresholdATR,
      weekendThresholdPct: userSettings?.gapGuardWeekendPct ?? DEFAULT_GAP_GUARD_CONFIG.weekendThresholdPct,
      dailyThresholdATR: userSettings?.gapGuardDailyATR ?? DEFAULT_GAP_GUARD_CONFIG.dailyThresholdATR,
      dailyThresholdPct: userSettings?.gapGuardDailyPct ?? DEFAULT_GAP_GUARD_CONFIG.dailyThresholdPct,
    };

    clearScanProgress();
    // Fetch historical slippage to dynamically tighten anti-chase guard
    let slippageBuffer = 0;
    try {
      const slippageStats = await getSlippageStats();
      slippageBuffer = slippageStats.atrBufferAdjustment;
    } catch {
      // Non-critical — use default thresholds if slippage query fails
    }

    const result = await runFullScan(
      userId,
      riskProfile as RiskProfileType,
      equity,
      gapGuardConfig,
      (stage, processed, total) => updateScanProgress(stage, processed, total),
      slippageBuffer
    );
    const modelLayer = applyModelLayerToCandidates(result.candidates, {
      enabled: userSettings?.modelLayerEnabled ?? false,
    }, result.regime);

    // ── Classify candidates (A/B/C/BLOCKED grades) ──
    const latestHealth = await prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    }).catch(() => null);

    const gradingContext: GradingContext = {
      regime: result.regime,
      healthOverall: (latestHealth?.overall as string) ?? 'GREEN',
    };

    // Classify each candidate — NCS/BQS/FWS come from dual-score if available
    // (scan candidates don't carry these yet; they're in the snapshot/cross-ref layer)
    // For now, use what's available from modelOverlay or leave null for B/C grading
    const gradedCandidates = classifyCandidates(
      modelLayer.candidates,
      gradingContext,
    );

    const responseResult = {
      ...result,
      candidates: gradedCandidates,
      modelLayer: {
        enabled: modelLayer.settings.enabled,
        versions: modelLayer.versions,
      },
    };
    clearScanProgress();

    // ── Persist to database ──────────────────────────────────────────
    try {
      // Look up stockId for each candidate
      const allStocks = await prisma.stock.findMany({
        where: { active: true },
        select: { id: true, ticker: true },
      });
      const stockMap = new Map(allStocks.map((s) => [s.ticker, s.id]));

      const scan = await prisma.scan.create({
        data: {
          userId,
          regime: responseResult.regime,
          results: {
            create: responseResult.candidates
              .filter((c) => stockMap.has(c.ticker)) // only known tickers
              .map((c) => ({
                stockId: stockMap.get(c.ticker)!,
                price: c.price,
                ma200: c.technicals?.ma200 ?? 0,
                adx: c.technicals?.adx ?? 0,
                plusDI: c.technicals?.plusDI ?? 0,
                minusDI: c.technicals?.minusDI ?? 0,
                atrPercent: c.technicals?.atrPercent ?? 0,
                efficiency: c.technicals?.efficiency ?? 0,
                twentyDayHigh: c.technicals?.twentyDayHigh ?? 0,
                entryTrigger: c.entryTrigger,
                stopPrice: c.stopPrice,
                distancePercent: c.distancePercent,
                status: c.status,
                entryMode: c.pullbackSignal?.triggered ? 'PULLBACK_CONTINUATION' : 'BREAKOUT',
                stage6Reason: c.pullbackSignal?.reason ?? c.antiChaseResult?.reason ?? null,
                passesRiskGates: c.passesRiskGates ?? null,
                passesAntiChase: c.passesAntiChase ?? null,
                rankScore: c.rankScore,
                passesAllFilters: c.passesAllFilters,
                shares: c.shares ?? null,
                riskDollars: c.riskDollars ?? null,
                grade: (c as { classification?: { grade: string } }).classification?.grade ?? null,
                gradeReason: (c as { classification?: { reason: string } }).classification?.reason ?? null,
              })),
          },
        },
      });
      console.log(`[Scan] Saved scan ${scan.id} with ${responseResult.candidates.length} candidates to DB`);

      // ── Filter Attribution: record per-candidate filter decisions for analytics ──
      try {
        const attrResult = await saveFilterAttributions(responseResult.candidates, scan.id, responseResult.regime);
        console.log(`[FilterAttribution] Saved ${attrResult.saved}, errors: ${attrResult.errors}`);
      } catch (attrError) {
        console.warn('[FilterAttribution] Failed:', (attrError as Error).message);
      }

      // ── Candidate Outcome: research-grade dataset for every candidate ──
      try {
        const freshness = getDataFreshness();
        const coResult = await saveCandidateOutcomes(
          responseResult.candidates,
          scan.id,
          responseResult.regime,
          freshness.source
        );
        console.log(`[CandidateOutcome] Saved ${coResult.saved}, errors: ${coResult.errors}`);
      } catch (coError) {
        console.warn('[CandidateOutcome] Failed:', (coError as Error).message);
      }
    } catch (dbError) {
      console.warn('[Scan] Failed to persist scan to DB:', (dbError as Error).message);
      // Non-fatal — scan still returns results via cache
    }

    // Cache the result so GET can return it without re-scanning
    const cached = setScanCache({
      ...responseResult,
      userId,
      riskProfile,
      equity,
    });

    return NextResponse.json({ ...responseResult, cachedAt: cached.cachedAt });
  } catch (error) {
    console.error('Scan error:', error);
    const msg = (error as Error).message || '';
    const isYahooRateLimit = msg.includes('429') || msg.toLowerCase().includes('too many');
    return apiError(
      isYahooRateLimit ? 429 : 500,
      isYahooRateLimit ? 'YAHOO_RATE_LIMITED' : 'SCAN_FAILED',
      isYahooRateLimit
        ? 'Yahoo Finance rate limit hit. Wait a few minutes and retry.'
        : 'Scan failed',
      msg,
      true
    );
  }
}

// ── GET: Return cached scan results, fallback to DB ─────────────────
export async function GET() {
  try {
    // Try in-memory cache first
    const cached = getScanCache();
    if (cached && isScanCacheFresh(cached)) {
      return NextResponse.json({ ...cached, hasCache: true, source: 'memory' });
    }
    if (cached && !isScanCacheFresh(cached)) {
      clearScanCache();
    }

    if (!process.env.DATABASE_URL) {
      return apiError(
        404,
        'SCAN_CACHE_MISS',
        'No fresh scan cache available',
        'Run Full Scan to generate fresh results.'
      );
    }

    // Fallback: load most recent scan from database
    const latestScan = await prisma.scan.findFirst({
      orderBy: { runDate: 'desc' },
      include: {
        results: {
          include: { stock: true },
          orderBy: { rankScore: 'desc' },
        },
      },
    });

    if (!latestScan || latestScan.results.length === 0) {
      return apiError(
        404,
        'SCAN_CACHE_MISS',
        'No cached scan',
        'Click "Run Full Scan" to generate results. They will be persisted across restarts.'
      );
    }

    const latestScanAgeMs = Date.now() - latestScan.runDate.getTime();
    if (latestScanAgeMs > SCAN_CACHE_TTL_MS) {
      return apiError(
        404,
        'SCAN_CACHE_STALE',
        'Latest scan cache is stale',
        'Run Full Scan to refresh candidates.'
      );
    }

    // Reconstruct the scan result shape from DB rows
    const candidates = latestScan.results.map((r) => {
      const atrCap = r.stock.sleeve === 'HIGH_RISK'
        ? ATR_VOLATILITY_CAP_HIGH_RISK
        : ATR_VOLATILITY_CAP_ALL;

      return {
        id: r.stock.ticker,
        ticker: r.stock.ticker,
        yahooTicker: r.stock.yahooTicker || undefined,
        name: r.stock.name,
        sleeve: r.stock.sleeve as Sleeve,
        sector: r.stock.sector || 'Unknown',
        cluster: r.stock.cluster || 'General',
        price: r.price,
        priceCurrency: r.stock.ticker.endsWith('.L') ? 'GBX' : (r.stock.currency || 'USD'),
        technicals: {
          currentPrice: r.price,
          ma200: r.ma200,
          adx: r.adx,
          plusDI: r.plusDI,
          minusDI: r.minusDI,
          atr: 0,
          atr20DayAgo: 0,
          medianAtr14: 0,
          atrPercent: r.atrPercent,
          twentyDayHigh: r.twentyDayHigh,
          efficiency: r.efficiency,
          volumeRatio: 1,
          relativeStrength: 0,
          atrSpiking: false,
          failedBreakoutAt: null,
        },
        entryTrigger: r.entryTrigger,
        stopPrice: r.stopPrice,
        distancePercent: r.distancePercent,
        status: r.status,
        antiChaseResult: r.stage6Reason
          ? {
              passed: !r.stage6Reason.includes('WAIT_PULLBACK') && !r.stage6Reason.includes('CHASE RISK'),
              reason: r.stage6Reason,
            }
          : undefined,
        pullbackSignal: r.entryMode === 'PULLBACK_CONTINUATION'
          ? {
              triggered: true,
              mode: 'PULLBACK_CONTINUATION' as const,
              anchor: r.entryTrigger,
              zoneLow: r.entryTrigger,
              zoneHigh: r.entryTrigger,
              entryPrice: r.entryTrigger,
              stopPrice: r.stopPrice,
              reason: r.stage6Reason || 'PULLBACK_CONTINUATION',
            }
          : undefined,
        rankScore: r.rankScore,
        passesAllFilters: r.passesAllFilters,
        passesRiskGates: normalizePersistedPassFlag(r.passesRiskGates),
        passesAntiChase: normalizePersistedPassFlag(r.passesAntiChase),
        shares: r.shares,
        riskDollars: r.riskDollars,
        filterResults: {
          priceAboveMa200: r.price > r.ma200,
          adxAbove20: r.adx >= 20,
          plusDIAboveMinusDI: r.plusDI > r.minusDI,
          atrPercentBelow8: r.atrPercent < atrCap,
          efficiencyAbove30: r.efficiency >= 30,
          dataQuality: r.ma200 > 0 && r.adx > 0,
          passesAll: r.passesAllFilters,
          atrSpiking: false,
          atrSpikeAction: 'NONE' as const,
        },
      };
    }) as ScanCandidate[];

    const passedFilters = candidates.filter((c) => c.passesAllFilters);

    // Look up actual user profile/equity so DB fallback uses real values
    const scanUser = await prisma.user.findUnique({
      where: { id: latestScan.userId },
      select: { riskProfile: true, equity: true, modelLayerEnabled: true },
    });

    const modelLayer = applyModelLayerToCandidates(candidates, {
      enabled: scanUser?.modelLayerEnabled ?? false,
    }, latestScan.regime as MarketRegime);
    const scoredCandidates = modelLayer.candidates;
    const scoredPassedFilters = scoredCandidates.filter((c) => c.passesAllFilters);

    const dbResult = {
      regime: latestScan.regime,
      candidates: scoredCandidates,
      readyCount: scoredPassedFilters.filter((c) => c.status === 'READY').length,
      watchCount: scoredPassedFilters.filter((c) => c.status === 'WATCH' || c.status === 'WAIT_PULLBACK').length,
      farCount: scoredCandidates.filter((c) => c.status === 'FAR').length,
      totalScanned: scoredCandidates.length,
      passedFilters: scoredPassedFilters.length,
      passedRiskGates: scoredPassedFilters.filter((c) => c.passesRiskGates === true).length,
      passedAntiChase: scoredPassedFilters.filter((c) => c.passesAntiChase === true).length,
      cachedAt: latestScan.runDate.toISOString(),
      userId: latestScan.userId,
      riskProfile: scanUser?.riskProfile || 'BALANCED',
      equity: scanUser?.equity || 0,
      modelLayer: {
        enabled: modelLayer.settings.enabled,
        versions: modelLayer.versions,
      },
      hasCache: true,
      source: 'database',
    };

    // Re-populate the in-memory cache so subsequent GETs are fast
    setScanCache(dbResult);

    return NextResponse.json(dbResult);
  } catch (error) {
    console.error('Scan cache error:', error);
    return apiError(
      500,
      'SCAN_CACHE_ERROR',
      'Failed to retrieve scan data',
      (error as Error).message,
      true
    );
  }
}
