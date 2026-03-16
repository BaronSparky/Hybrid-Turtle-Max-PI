export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { calculateRMultiple, calculateGainPercent, calculateGainDollars } from '@/lib/position-sizer';
import { getBatchPrices, getBatchQuotes, getMarketRegime, normalizeBatchPricesToGBP, getQuickPrice, getFXRate, getDailyPrices, calculateATR } from '@/lib/market-data';
import { buildInitialRiskFields } from '@/lib/risk-fields';
import { validateRiskGates } from '@/lib/risk-gates';
import { apiError } from '@/lib/api-response';
import { logEVRecord } from '@/lib/ev-tracker';
import { clearScanCache } from '@/lib/scan-cache';
import { clearModulesCache } from '@/lib/modules-cache';
import { getCurrentWeeklyPhase } from '@/types';
import { OPPORTUNISTIC_GATES } from '@/types';
import { getCurrentExecutionMode } from '@/lib/execution-mode';
import type { Sleeve } from '@/types';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const createPositionSchema = z.object({
  userId: z.string().trim().min(1),
  stockId: z.string().trim().min(1),
  entryPrice: z.coerce.number().positive(),
  entryDate: z.string().optional(),
  shares: z.coerce.number().positive(),
  stopLoss: z.coerce.number().positive(),
  atrAtEntry: z.coerce.number().positive().optional(),
  adxAtEntry: z.coerce.number().positive().optional(),
  scanStatus: z.string().optional(),
  bqsScore: z.coerce.number().optional(),
  fwsScore: z.coerce.number().optional(),
  ncsScore: z.coerce.number().optional(),
  dualScoreAction: z.string().optional(),
  rankScore: z.coerce.number().optional(),
  entryType: z.string().optional(),
  plannedEntry: z.coerce.number().positive().optional(),
  antiChaseTriggered: z.coerce.boolean().optional(),
  breadthRestricted: z.coerce.boolean().optional(),
  whipsawBlocked: z.coerce.boolean().optional(),
  climaxDetected: z.coerce.boolean().optional(),
  notes: z.string().optional(),
  // T212 dual-account: ISA vs Invest — ensures stops route to the correct account
  accountType: z.enum(['invest', 'isa']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // OPEN | CLOSED | all
    const source = searchParams.get('source'); // manual | trading212 | all

    if (!userId) {
      return apiError(400, 'INVALID_REQUEST', 'userId is required');
    }

    const where: { userId: string; status?: string; source?: string } = { userId };
    if (status && status !== 'all') {
      where.status = status;
    }
    if (source && source !== 'all') {
      where.source = source;
    }

    const positions = await prisma.position.findMany({
      where,
      include: {
        stock: true,
        stopHistory: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Fetch live prices from Yahoo Finance for all open positions
    const openTickers = positions
      .filter((p) => p.status === 'OPEN')
      .map((p) => p.stock.ticker);
    const livePrices = openTickers.length > 0
      ? await getBatchPrices(openTickers)
      : {};

    // Build currency map and normalize to GBP
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = openTickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};

    // Compute gap risk for open HIGH_RISK positions (advisory only)
    const GAP_RISK_ATR_MULTIPLIER = 2;
    const gapRiskMap = new Map<string, { gapPercent: number; atrPercent: number; threshold: number }>();
    const highRiskOpen = positions.filter((p) => p.status === 'OPEN' && p.stock.sleeve === 'HIGH_RISK');
    if (highRiskOpen.length > 0) {
      try {
        const hrTickers = highRiskOpen.map((p) => p.stock.ticker);
        const quotes = await getBatchQuotes(hrTickers);
        // Fetch daily bars and compute ATR in parallel
        const atrResults = await Promise.allSettled(
          hrTickers.map(async (ticker) => {
            const bars = await getDailyPrices(ticker, 'compact');
            return { ticker, atr: bars.length >= 15 ? calculateATR(bars, 14) : 0 };
          })
        );
        const atrMap = new Map<string, number>();
        for (const result of atrResults) {
          if (result.status === 'fulfilled' && result.value.atr > 0) {
            atrMap.set(result.value.ticker, result.value.atr);
          }
        }
        for (const pos of highRiskOpen) {
          const quote = quotes.get(pos.stock.ticker);
          const atr = atrMap.get(pos.stock.ticker);
          if (!quote || !atr || quote.previousClose <= 0) continue;
          const gapPercent = ((quote.open - quote.previousClose) / quote.previousClose) * 100;
          const atrPercent = (atr / quote.previousClose) * 100;
          const threshold = atrPercent * GAP_RISK_ATR_MULTIPLIER;
          if (Math.abs(gapPercent) > threshold) {
            gapRiskMap.set(pos.stock.ticker, { gapPercent, atrPercent, threshold });
          }
        }
      } catch {
        // Gap risk is advisory — failure doesn't block positions
      }
    }

    // Count pyramid adds per position from TradeLog
    const addCounts = await prisma.tradeLog.groupBy({
      by: ['positionId'],
      where: { userId, tradeType: 'ADD', positionId: { not: null } },
      _count: { id: true },
    });
    const addsMap = new Map<string, number>();
    for (const row of addCounts) {
      if (row.positionId) addsMap.set(row.positionId, row._count.id);
    }

    // Enrich with calculated fields using GBP-normalised prices
    const enriched = positions.map((p) => {
      const rawPrice = p.status === 'OPEN'
        ? (livePrices[p.stock.ticker] || p.entryPrice)
        : (p.exitPrice || p.entryPrice);

      // Determine the price currency this ticker trades in
      const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
      const priceCurrency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();

      // Current price in native currency (same as T212 / Yahoo raw)
      const currentPriceNative = p.status === 'OPEN' ? rawPrice : (p.exitPrice || p.entryPrice);

      // GBP-normalised prices for portfolio-level calculations only
      let currentPriceGBP: number;
      let entryPriceGBP = p.entryPrice;

      if (p.status === 'OPEN' && gbpPrices[p.stock.ticker] !== undefined) {
        currentPriceGBP = gbpPrices[p.stock.ticker];
        if (isUK) {
          entryPriceGBP = p.entryPrice / 100;
        } else if (priceCurrency !== 'GBP') {
          const fxRatio = rawPrice > 0 ? currentPriceGBP / rawPrice : 1;
          entryPriceGBP = p.entryPrice * fxRatio;
        }
      } else {
        currentPriceGBP = isUK ? rawPrice / 100 : rawPrice;
        if (isUK) entryPriceGBP = p.entryPrice / 100;
      }

      // Gain % uses raw prices (currency-independent)
      const gainPercent = calculateGainPercent(rawPrice, p.entryPrice);
      const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
      const gainDollars = currentPriceGBP * p.shares - entryPriceGBP * p.shares;
      const value = currentPriceGBP * p.shares;

      // Risk at stop in GBP (portfolio-level)
      const stopGBP = isUK ? (p.currentStop || 0) / 100
        : priceCurrency !== 'GBP'
          ? (p.currentStop || 0) * (rawPrice > 0 ? currentPriceGBP / rawPrice : 1)
          : (p.currentStop || 0);
      const { initialRiskGBP, riskGBP } = buildInitialRiskFields(entryPriceGBP, stopGBP, p.shares);

      return {
        ...p,
        // Per-ticker prices in NATIVE currency (matches T212 display)
        entryPrice: p.entryPrice,
        currentPrice: currentPriceNative,
        currentStop: p.currentStop || 0,
        stopLoss: p.stopLoss || 0,
        initialRisk: p.initialRisk || 0,
        priceCurrency,
        // Portfolio-level aggregates in GBP
        rMultiple,
        gainPercent,
        gainDollars,
        value,
        initialRiskGBP,
        // Deprecated: use initialRiskGBP instead
        riskGBP,
        pyramidAdds: addsMap.get(p.id) ?? 0,
        gapRisk: gapRiskMap.get(p.stock.ticker) ?? null,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Positions error:', error);
    return apiError(500, 'POSITIONS_FETCH_FAILED', 'Failed to fetch positions', (error as Error).message, true);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, createPositionSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const {
      userId,
      stockId,
      entryPrice,
      entryDate,
      shares,
      stopLoss,
      atrAtEntry,
      adxAtEntry,
      scanStatus,
      bqsScore,
      fwsScore,
      ncsScore,
      dualScoreAction,
      rankScore,
      entryType,
      plannedEntry,
      antiChaseTriggered,
      breadthRestricted,
      whipsawBlocked,
      climaxDetected,
      notes,
      accountType,
    } = parsed.data;

    // Hard pre-trade gates
    const phase = getCurrentWeeklyPhase();
    if (phase === 'OBSERVATION') {
      return apiError(400, 'PHASE_BLOCKED', 'New entries are blocked on Monday (OBSERVATION phase)');
    }

    const regime = await getMarketRegime();

    // Opportunistic mode enforcement (Wed-Fri)
    const execMode = getCurrentExecutionMode(regime);
    if (execMode.mode === 'OPPORTUNISTIC') {
      if (!execMode.canEnter) {
        return apiError(400, 'REGIME_BLOCKED', execMode.reason);
      }
      // Daily limit check — count non-HEDGE positions opened today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEntryCount = await prisma.position.count({
        where: {
          userId,
          entryDate: { gte: todayStart },
          stock: { sleeve: { not: 'HEDGE' } },
        },
      });
      if (todayEntryCount >= OPPORTUNISTIC_GATES.maxNewPositions) {
        return apiError(400, 'DAILY_LIMIT', `Mid-week daily limit reached. Maximum ${OPPORTUNISTIC_GATES.maxNewPositions} new position per day on Wednesday–Friday.`);
      }
      // Verify candidate meets opportunistic bar (server-side safety net)
      if (typeof bqsScore === 'number' && typeof fwsScore === 'number' && typeof ncsScore === 'number') {
        if (ncsScore < OPPORTUNISTIC_GATES.minNCS) {
          return apiError(400, 'OPPORTUNISTIC_NCS', `NCS ${ncsScore.toFixed(0)} does not meet mid-week minimum of ${OPPORTUNISTIC_GATES.minNCS}.`);
        }
        if (fwsScore > OPPORTUNISTIC_GATES.maxFWS) {
          return apiError(400, 'OPPORTUNISTIC_FWS', `FWS ${fwsScore.toFixed(0)} exceeds mid-week maximum of ${OPPORTUNISTIC_GATES.maxFWS}.`);
        }
      }
    }

    if (regime !== 'BULLISH') {
      return apiError(400, 'REGIME_BLOCKED', `New entries require BULLISH regime. Current regime: ${regime}`);
    }

    const latestHealth = await prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    });
    if (latestHealth?.overall === 'RED') {
      return apiError(400, 'HEALTH_BLOCKED', 'New entries are blocked while health status is RED');
    }

    // SAFETY: Stop-loss must be set before confirming trade
    if (stopLoss >= entryPrice) {
      return apiError(400, 'INVALID_STOP_LOSS', 'Stop-loss must be below entry price');
    }

    const initialRisk = entryPrice - stopLoss;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { riskProfile: true, equity: true },
    });

    const riskProfile = (user?.riskProfile || 'BALANCED') as import('@/types').RiskProfileType;
    const equity = user?.equity || 0;

    // ── RISK GATE ENFORCEMENT — all 6 gates must pass ──
    // Fetch existing open positions and build gate input
    const existingPositions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    // Build positions array with GBP-normalised values for gate checks
    const existingTickers = existingPositions.map((p) => p.stock.ticker);
    const existingPrices = existingTickers.length > 0 ? await getBatchPrices(existingTickers) : {};
    const existingCurrencies: Record<string, string | null> = {};
    for (const p of existingPositions) {
      existingCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const existingGbpPrices = existingTickers.length > 0
      ? await normalizeBatchPricesToGBP(existingPrices, existingCurrencies)
      : {};

    const positionsForGates = existingPositions.map((p) => {
      const rawPrice = existingPrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = existingGbpPrices[p.stock.ticker] ?? rawPrice;
      const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
      const entryPriceGbp = p.entryPrice * fxRatio;
      const currentStopGbp = p.currentStop * fxRatio;
      const currentPriceGbp = gbpPrice;
      return {
        id: p.id,
        ticker: p.stock.ticker,
        sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
        sector: p.stock.sector || 'Unknown',
        cluster: p.stock.cluster || 'General',
        value: entryPriceGbp * p.shares,
        riskDollars: Math.max(0, (currentPriceGbp - currentStopGbp) * p.shares),
        shares: p.shares,
        entryPrice: entryPriceGbp,
        currentStop: currentStopGbp,
        currentPrice: currentPriceGbp,
      };
    });

    // Look up the stock being entered for sleeve/sector/cluster info
    const newStock = await prisma.stock.findUnique({ where: { id: stockId } });
    if (!newStock) {
      return apiError(404, 'STOCK_NOT_FOUND', 'Stock not found');
    }

    // FX-convert the new position values to GBP
    const newCurrency = (newStock.currency || 'USD').toUpperCase();
    const isNewUk = newStock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(newStock.ticker);
    let newFxToGbp: number;
    if (isNewUk || newCurrency === 'GBX' || newCurrency === 'GBp') {
      newFxToGbp = 0.01;
    } else if (newCurrency === 'GBP') {
      newFxToGbp = 1;
    } else {
      newFxToGbp = await getFXRate(newCurrency, 'GBP');
    }
    const newEntryGbp = entryPrice * newFxToGbp;
    const newStopGbp = stopLoss * newFxToGbp;
    const newValue = newEntryGbp * shares;
    const newRiskDollars = Math.max(0, (newEntryGbp - newStopGbp) * shares);

    const riskGateResults = validateRiskGates(
      {
        sleeve: (newStock.sleeve || 'CORE') as Sleeve,
        sector: newStock.sector || 'Unknown',
        cluster: newStock.cluster || 'General',
        value: newValue,
        riskDollars: newRiskDollars,
      },
      positionsForGates,
      equity,
      riskProfile
    );

    const failedGates = riskGateResults.filter((g) => !g.passed);
    if (failedGates.length > 0) {
      const gateDetails = failedGates.map((g) => `${g.gate}: ${g.message}`).join('; ');
      return apiError(400, 'RISK_GATES_FAILED', `Position blocked by risk gates: ${gateDetails}`);
    }

    // Pre-compute FX data outside transaction to avoid holding it open
    const ticker = newStock.ticker;
    const fxToGbp = newFxToGbp; // already computed above for risk gates
    const effectivePlannedEntry = plannedEntry ?? null;

    // Atomic: position create + trade log in one transaction
    const position = await prisma.$transaction(async (tx) => {
      const pos = await tx.position.create({
        data: {
          userId,
          stockId,
          entryPrice,
          entryDate: entryDate ? new Date(entryDate) : new Date(),
          shares,
          stopLoss,
          initialRisk,
          currentStop: stopLoss,
          entry_price: entryPrice,
          initial_stop: stopLoss,
          initial_R: initialRisk,
          atr_at_entry: atrAtEntry,
          profile_used: user?.riskProfile,
          entry_type: entryType || 'BREAKOUT',
          protectionLevel: 'INITIAL',
          source: 'manual',
          // T212 dual-account: ISA vs Invest — routes stops to the correct account
          accountType: accountType ?? 'invest',
          notes,
        },
        include: { stock: true },
      });

      // Best-effort trade logging inside transaction (caught errors don't abort)
      try {
        await tx.tradeLog.create({
          data: {
            userId,
            positionId: pos.id,
            ticker,
            tradeDate: new Date(),
            tradeType: 'ENTRY',
            decision: 'TAKEN',
            entryPrice,
            initialStop: stopLoss,
            initialR: initialRisk,
            shares,
            positionSizeGbp: shares * entryPrice * fxToGbp,
            atrAtEntry: atrAtEntry ?? null,
            adxAtEntry: adxAtEntry ?? null,
            scanStatus: scanStatus ?? null,
            bqsScore: bqsScore ?? null,
            fwsScore: fwsScore ?? null,
            ncsScore: ncsScore ?? null,
            dualScoreAction: dualScoreAction ?? null,
            rankScore: rankScore ?? null,
            regime,
            plannedEntry: effectivePlannedEntry,
            actualFill: entryPrice,
            slippagePct:
              effectivePlannedEntry && entryPrice
                ? ((entryPrice - effectivePlannedEntry) / effectivePlannedEntry) * 100
                : null,
            fillTime: new Date(),
            antiChaseTriggered: antiChaseTriggered ?? false,
            breadthRestricted: breadthRestricted ?? false,
            whipsawBlocked: whipsawBlocked ?? false,
            climaxDetected: climaxDetected ?? false,
          },
        });
      } catch (logError) {
        const prismaCode = (logError as { code?: string })?.code;
        if (prismaCode === 'P2002') {
          console.warn('TradeLog duplicate skipped for position entry', { userId, stockId });
        } else {
          console.warn('TradeLog create failed (non-blocking)', logError);
        }
      }

      return pos;
    });

    // Invalidate scan and module caches so stale candidates are not shown
    clearScanCache();
    clearModulesCache();

    return NextResponse.json(position, { status: 201 });
  } catch (error) {
    console.error('Create position error:', error);
    return apiError(500, 'POSITION_CREATE_FAILED', 'Failed to create position', (error as Error).message, true);
  }
}

const closePositionSchema = z.object({
  positionId: z.string().trim().min(1),
  exitPrice: z.coerce.number().positive(),
  exitReason: z.string().optional(),
  closeNote: z.string().optional(),
});

/**
 * PATCH — Close / exit a position
 * Body: { positionId, exitPrice, exitReason? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, closePositionSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { positionId, exitPrice, exitReason, closeNote } = parsed.data;

    const position = await prisma.position.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      return apiError(404, 'POSITION_NOT_FOUND', 'Position not found');
    }

    if (position.status === 'CLOSED') {
      return apiError(400, 'POSITION_ALREADY_CLOSED', 'Position is already closed');
    }

    const resolvedExitReason =
      exitReason === 'STOP_HIT' || (typeof position.currentStop === 'number' && exitPrice <= position.currentStop)
        ? 'STOP_HIT'
        : (exitReason || 'MANUAL');

    // Pre-compute FX data outside transaction to avoid holding it open
    const stockForClose = await prisma.stock.findFirst({
      where: { positions: { some: { id: positionId } } },
    });
    const closeTicker = stockForClose?.ticker ?? '';
    const closeCurrency = (stockForClose?.currency || 'USD').toUpperCase();
    const isCloseUk = closeTicker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(closeTicker);
    let closeFxToGbp: number;
    if (isCloseUk || closeCurrency === 'GBX' || closeCurrency === 'GBp') {
      closeFxToGbp = 0.01;
    } else if (closeCurrency === 'GBP') {
      closeFxToGbp = 1;
    } else {
      closeFxToGbp = await getFXRate(closeCurrency, 'GBP');
    }

    // Pre-compute P&L fields for Position record
    const closeInitialR = position.initial_R ?? position.initialRisk ?? null;
    const closeRealisedPnlGbp = (exitPrice - position.entryPrice) * position.shares * closeFxToGbp;
    const closeRealisedPnlR = closeInitialR ? (exitPrice - position.entryPrice) / closeInitialR : null;

    // Atomic: position close + trade log in one transaction
    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.position.update({
        where: { id: positionId },
        data: {
          status: 'CLOSED',
          exitPrice,
          exitReason: resolvedExitReason,
          exitDate: new Date(),
          exitProfitR: closeRealisedPnlR,
          realisedPnlGbp: closeRealisedPnlGbp,
          realisedPnlR: closeRealisedPnlR,
          closedBy: 'MANUAL',
          notes: closeNote || position.notes || null,
        },
        include: { stock: true },
      });

      // Best-effort trade logging inside transaction (caught errors don't abort)
      try {
        const daysHeld = Math.floor((upd.exitDate!.getTime() - upd.entryDate.getTime()) / 86400000);
        const initialR = upd.initial_R ?? upd.initialRisk ?? null;
        const finalRMultiple = initialR ? (exitPrice - upd.entryPrice) / initialR : null;
        const tradeType = resolvedExitReason === 'STOP_HIT' ? 'STOP_HIT' : 'EXIT';

        await tx.tradeLog.create({
          data: {
            userId: upd.userId,
            positionId: upd.id,
            ticker: upd.stock.ticker,
            tradeDate: new Date(),
            tradeType,
            decision: 'TAKEN',
            entryPrice: upd.entry_price ?? upd.entryPrice,
            initialStop: upd.initial_stop ?? upd.stopLoss,
            initialR,
            shares: upd.shares,
            exitPrice,
            exitReason: resolvedExitReason,
            finalRMultiple,
            gainLossGbp: (exitPrice - upd.entryPrice) * upd.shares * closeFxToGbp,
            daysHeld,
            atrAtEntry: upd.atr_at_entry,
          },
        });
      } catch (logError) {
        const prismaCode = (logError as { code?: string })?.code;
        if (prismaCode === 'P2002') {
          console.warn('TradeLog duplicate skipped for position close', { positionId });
        } else {
          console.warn('TradeLog create failed on close (non-blocking)', logError);
        }
      }

      return upd;
    });

    // Best-effort EV record logging — outside transaction, non-blocking
    const initialR = updated.initial_R ?? updated.initialRisk ?? null;
    const evRMultiple = initialR ? (exitPrice - updated.entryPrice) / initialR : 0;

    // Pull regime from the TradeLog entry record (set at trade open)
    const entryLog = await prisma.tradeLog.findFirst({
      where: { positionId: updated.id, tradeType: { in: ['ENTRY', 'STOP_HIT', 'EXIT'] } },
      orderBy: { tradeDate: 'asc' },
      select: { id: true, regime: true, ncsScore: true },
    });

    logEVRecord({
      tradeId: entryLog?.id ?? updated.id,
      regime: entryLog?.regime,
      atrAtEntry: updated.atr_at_entry,
      cluster: updated.stock.cluster,
      sleeve: updated.stock.sleeve,
      entryNCS: entryLog?.ncsScore ?? null,
      rMultiple: evRMultiple,
      closedAt: updated.exitDate ?? new Date(),
    }).catch(() => { /* already logged inside logEVRecord */ });

    // Invalidate scan and module caches so risk gates reflect the closure
    clearScanCache();
    clearModulesCache();

    return NextResponse.json({ success: true, position: updated });
  } catch (error) {
    console.error('Close position error:', error);
    return apiError(500, 'POSITION_CLOSE_FAILED', 'Failed to close position', (error as Error).message, true);
  }
}
