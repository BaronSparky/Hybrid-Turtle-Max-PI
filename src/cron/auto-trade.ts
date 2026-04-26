/**
 * DEPENDENCIES
 * Consumed by: auto-trade-task.bat, Windows Task Scheduler
 * Consumes: scan-engine.ts, position-sizer.ts, risk-gates.ts, stop-manager.ts,
 *           trading212.ts, telegram.ts, market-data.ts, prisma.ts, safety-controls.ts
 * Risk-sensitive: YES — places real buy and stop orders on Trading 212
 * Last modified: 2026-04-25
 * Notes: Standalone cron — runs WITHOUT the dashboard. Must be robust to failures.
 *        Every trade is logged, gated, and Telegram-notified.
 *        ENABLE_AUTO_TRADING=true required or script exits immediately.
 */
/**
 * HybridTurtle Auto-Trade — Standalone Scheduled Execution
 *
 * Scans for READY candidates, validates risk gates, executes buy orders,
 * places protective stops, and sends Telegram updates — all without the
 * Next.js dashboard running.
 *
 * Sessions (UK timezone):
 *   --session=uk       08:15 — UK/EU market entries
 *   --session=us       14:45 — US market entries (early)
 *   --session=us-close  20:00 — US market entries (near close)
 *   --session=scan     20:00 — Evening scan only (no trades)
 *
 * Safety:
 *   - ENABLE_AUTO_TRADING env var must be "true" (master gate)
 *   - Phase 10 kill switch checked before every trade
 *   - All 6 risk gates must pass per candidate
 *   - Regime must be BULLISH
 *   - Health must not be RED
 *   - Max 2 trades per session (configurable)
 *   - Every execution logged to ExecutionLog audit trail
 *   - Immediate Telegram notification per trade
 *
 * Usage:
 *   npx tsx src/cron/auto-trade.ts --session=uk
 *   npx tsx src/cron/auto-trade.ts --session=us
 *   npx tsx src/cron/auto-trade.ts --session=us-close
 *   npx tsx src/cron/auto-trade.ts --session=scan
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { runFullScan } from '@/lib/scan-engine';
import { calculatePositionSize } from '@/lib/position-sizer';
import { validateRiskGates } from '@/lib/risk-gates';
import { Trading212Client, Trading212Error, type T212PendingOrder } from '@/lib/trading212';
import type { T212AccountType } from '@/lib/trading212-dual';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendAlert } from '@/lib/alert-service';
import { assertSubmissionAllowed, SafetyControlError, isAutoTradingEnabled } from '../../packages/workflow/src';
import { getBatchPrices, normalizeBatchPricesToGBP, getFXRate, getMarketRegime } from '@/lib/market-data';
import { classifyCandidate, type GradingContext, type CandidateGrade } from '@/lib/candidate-grade';
import { RISK_PROFILES, type RiskProfileType, type Sleeve, type MarketRegime } from '@/types';

// ── Configuration ────────────────────────────────────────────

const MAX_TRADES_PER_SESSION = parseInt(process.env.AUTO_TRADE_MAX_PER_SESSION || '2', 10);
const SCAN_MAX_AGE_HOURS = 18;
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20;

type Session = 'uk' | 'us' | 'us-close' | 'scan';

interface SessionConfig {
  name: string;
  sleeves: Sleeve[];
  description: string;
}

const SESSION_CONFIGS: Record<Session, SessionConfig> = {
  uk: { name: 'UK/EU Morning', sleeves: ['CORE', 'ETF'], description: 'UK/EU entries (08:15)' },
  us: { name: 'US Afternoon', sleeves: ['CORE', 'HIGH_RISK', 'ETF'], description: 'US entries (14:45)' },
  'us-close': { name: 'US Near-Close', sleeves: ['CORE', 'HIGH_RISK', 'ETF'], description: 'US near-close entries (20:00)' },
  scan: { name: 'Evening Scan', sleeves: [], description: 'Scan only — no trades' },
};

// ── Helpers ──────────────────────────────────────────────────

function getUKDayOfWeek(): number {
  const now = new Date();
  const ukTime = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  return ukTime.getDay();
}

function getUKTimeString(): string {
  return new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false });
}

function isStockForSession(ticker: string, sleeve: string, session: Session): boolean {
  if (session === 'scan') return false; // Scan session never trades
  const config = SESSION_CONFIGS[session];
  if (!config.sleeves.includes(sleeve as Sleeve)) return false;

  // UK session: only .L suffix stocks (LSE)
  if (session === 'uk') return ticker.endsWith('.L');
  // US sessions: non-.L stocks
  return !ticker.endsWith('.L');
}

// ── Execution Log (audit trail) ──────────────────────────────

async function logExecution(data: {
  ticker: string;
  phase: string;
  orderId?: string | null;
  requestBody: string;
  responseStatus?: number | null;
  responseBody?: string | null;
  stopPrice?: number | null;
  quantity?: number | null;
  accountType: string;
  error?: string | null;
}): Promise<void> {
  try {
    await prisma.executionLog.create({
      data: {
        ticker: data.ticker,
        phase: data.phase,
        orderId: data.orderId ?? null,
        requestBody: data.requestBody,
        responseStatus: data.responseStatus ?? null,
        responseBody: data.responseBody ?? null,
        stopPrice: data.stopPrice ?? null,
        quantity: data.quantity ?? null,
        accountType: data.accountType,
        error: data.error ?? null,
      },
    });
  } catch (logErr) {
    console.error('[ExecutionLog] Failed to write log:', logErr);
  }
}

// ── T212 Client Factory (standalone — no HTTP request context) ──

async function getT212Client(userId: string, accountType: T212AccountType): Promise<Trading212Client> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      t212ApiKey: true,
      t212ApiSecret: true,
      t212Environment: true,
      t212Connected: true,
      t212IsaApiKey: true,
      t212IsaApiSecret: true,
      t212IsaConnected: true,
    },
  });

  if (!user) throw new Error('User not found');

  if (accountType === 'isa') {
    if (!user.t212IsaApiKey || !user.t212IsaApiSecret || !user.t212IsaConnected) {
      throw new Error('Trading 212 ISA account not connected.');
    }
    return new Trading212Client(user.t212IsaApiKey, user.t212IsaApiSecret, user.t212Environment as 'demo' | 'live');
  }

  if (!user.t212ApiKey || !user.t212ApiSecret || !user.t212Connected) {
    throw new Error('Trading 212 Invest account not connected.');
  }
  return new Trading212Client(user.t212ApiKey, user.t212ApiSecret, user.t212Environment as 'demo' | 'live');
}

// ── Determine account type for a stock ───────────────────────

async function getAccountTypeForStock(userId: string, stockId: string): Promise<T212AccountType> {
  const stock = await prisma.stock.findUnique({ where: { id: stockId }, select: { isaEligible: true, sleeve: true } });
  if (!stock) return 'invest';

  // Check if ISA account is configured
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { t212IsaConnected: true },
  });

  // Default to invest if ISA not connected or stock not ISA eligible
  if (!user?.t212IsaConnected) return 'invest';
  if (stock.isaEligible === false) return 'invest';

  // ISA-eligible CORE stocks → ISA account
  if (stock.sleeve === 'CORE' && stock.isaEligible === true) return 'isa';

  return 'invest';
}

// ── Single Trade Execution (buy + stop + DB position) ────────

interface TradeResult {
  ticker: string;
  success: boolean;
  shares?: number;
  filledPrice?: number;
  stopPrice?: number;
  stopPlaced: boolean;
  positionId?: string;
  error?: string;
  critical?: boolean;
}

async function executeTrade(
  userId: string,
  candidate: {
    stockId: string;
    ticker: string;
    t212Ticker: string;
    entryPrice: number;
    stopPrice: number;
    shares: number;
    sleeve: string;
    accountType: T212AccountType;
    rankScore: number;
    atr?: number;
    adx?: number;
  }
): Promise<TradeResult> {
  const { ticker, t212Ticker, entryPrice, stopPrice, shares, accountType } = candidate;

  console.log(`  [TRADE] ${ticker}: ${shares} shares @ ~${entryPrice.toFixed(2)}, stop @ ${stopPrice.toFixed(2)} (${accountType})`);

  // ── Phase A: Place Market Buy ──
  let client: Trading212Client;
  try {
    client = await getT212Client(userId, accountType);
  } catch (err) {
    const msg = (err as Error).message;
    await logExecution({ ticker, phase: 'CLIENT_ERROR', requestBody: JSON.stringify(candidate), accountType, error: msg });
    return { ticker, success: false, stopPlaced: false, error: msg };
  }

  let buyOrder: T212PendingOrder;
  try {
    buyOrder = await client.placeMarketOrder({ quantity: shares, ticker: t212Ticker });
    await logExecution({
      ticker, phase: 'BUY_PLACED', orderId: String(buyOrder.id),
      requestBody: JSON.stringify({ quantity: shares, ticker: t212Ticker }),
      responseStatus: 200, responseBody: JSON.stringify(buyOrder),
      quantity: shares, accountType,
    });
    console.log(`    ✓ Buy order placed (ID: ${buyOrder.id})`);
  } catch (err) {
    const msg = err instanceof Trading212Error ? `T212 ${err.statusCode}: ${err.message}` : (err as Error).message;
    await logExecution({
      ticker, phase: 'BUY_FAILED', requestBody: JSON.stringify({ quantity: shares, ticker: t212Ticker }),
      responseStatus: err instanceof Trading212Error ? err.statusCode : null, accountType, error: msg,
    });
    return { ticker, success: false, stopPlaced: false, error: msg };
  }

  // ── Phase B: Poll for Fill ──
  let filledQuantity = 0;
  let filledPrice = 0;
  let filled = false;

  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const order = await client.getOrder(buyOrder.id);
      if (order.filledQuantity > 0 && order.filledQuantity >= shares * 0.99) {
        filledQuantity = order.filledQuantity;
        filledPrice = order.filledValue > 0 ? order.filledValue / order.filledQuantity : entryPrice;
        filled = true;
        break;
      }
    } catch (err) {
      if (err instanceof Trading212Error && err.statusCode === 404) {
        // Order filled and removed from pending — check positions
        try {
          const positions = await client.getPositions();
          const pos = positions.find(p => p.instrument.ticker === t212Ticker);
          if (pos) {
            filledQuantity = pos.quantity;
            filledPrice = pos.averagePricePaid;
            filled = true;
            break;
          }
        } catch { /* fall through */ }
      }
    }
  }

  if (!filled) {
    await logExecution({
      ticker, phase: 'BUY_TIMEOUT', orderId: String(buyOrder.id),
      requestBody: JSON.stringify({ orderId: buyOrder.id, maxPolls: MAX_POLLS }),
      accountType, error: `Fill not confirmed after ${MAX_POLLS} polls. DO NOT place stop.`,
    });
    return {
      ticker, success: false, stopPlaced: false,
      error: `Buy order ${buyOrder.id} placed but fill not confirmed after ${(MAX_POLLS * POLL_INTERVAL_MS / 1000).toFixed(0)}s. Check T212 app manually.`,
      critical: true,
    };
  }

  console.log(`    ✓ Filled ${filledQuantity} shares @ ${filledPrice.toFixed(4)}`);

  // ── Phase C: Place Stop-Loss (negative quantity) ──
  let stopPlaced = false;
  const stopQuantity = -Math.abs(filledQuantity);
  const stopRequest = { quantity: stopQuantity, stopPrice, ticker: t212Ticker, timeValidity: 'GOOD_TILL_CANCEL' as const };

  try {
    const stopOrder = await client.placeStopOrder(stopRequest);
    await logExecution({
      ticker, phase: 'STOP_PLACED', orderId: String(stopOrder.id),
      requestBody: JSON.stringify(stopRequest), responseStatus: 200,
      responseBody: JSON.stringify(stopOrder), stopPrice, quantity: stopQuantity, accountType,
    });
    stopPlaced = true;
    console.log(`    ✓ Stop-loss placed @ ${stopPrice.toFixed(4)} (ID: ${stopOrder.id})`);
  } catch (err) {
    const msg = err instanceof Trading212Error ? `T212 ${err.statusCode}: ${err.message}` : (err as Error).message;
    await logExecution({
      ticker, phase: 'STOP_FAILED', requestBody: JSON.stringify(stopRequest),
      responseStatus: err instanceof Trading212Error ? err.statusCode : null,
      accountType, error: msg, stopPrice, quantity: stopQuantity,
    });
    console.error(`    ✗ CRITICAL: Stop-loss FAILED — ${msg}`);
  }

  // ── Phase D: Create DB Position (direct Prisma — no dashboard needed) ──
  let positionId: string | undefined;
  try {
    const initialRisk = filledPrice - stopPrice;
    const regime = await getMarketRegime();

    // FX rate for trade log
    const stock = await prisma.stock.findUnique({ where: { id: candidate.stockId }, select: { currency: true, ticker: true } });
    const currency = (stock?.currency || 'USD').toUpperCase();
    const isUk = ticker.endsWith('.L');
    let fxToGbp = 1;
    if (isUk || currency === 'GBX' || currency === 'GBp') fxToGbp = 0.01;
    else if (currency !== 'GBP') fxToGbp = await getFXRate(currency, 'GBP');

    const position = await prisma.$transaction(async (tx) => {
      const pos = await tx.position.create({
        data: {
          userId,
          stockId: candidate.stockId,
          entryPrice: filledPrice,
          entryDate: new Date(),
          shares: filledQuantity,
          stopLoss: stopPrice,
          initialRisk,
          currentStop: stopPrice,
          entry_price: filledPrice,
          initial_stop: stopPrice,
          initial_R: initialRisk,
          atr_at_entry: candidate.atr ?? null,
          profile_used: 'BALANCED',
          entry_type: 'BREAKOUT',
          protectionLevel: 'INITIAL',
          source: 'auto-trade',
          accountType: accountType,
          entryTrigger: candidate.entryPrice,
          notes: `Auto-trade: T212 order ${buyOrder.id} | Session ${getUKTimeString()}`,
        },
      });

      // Trade log (best-effort inside transaction)
      try {
        await tx.tradeLog.create({
          data: {
            userId,
            positionId: pos.id,
            ticker,
            tradeDate: new Date(),
            tradeType: 'ENTRY',
            decision: 'TAKEN',
            entryPrice: filledPrice,
            initialStop: stopPrice,
            initialR: initialRisk,
            shares: filledQuantity,
            positionSizeGbp: filledQuantity * filledPrice * fxToGbp,
            atrAtEntry: candidate.atr ?? null,
            adxAtEntry: candidate.adx ?? null,
            rankScore: candidate.rankScore ?? null,
            regime,
            plannedEntry: candidate.entryPrice,
            actualFill: filledPrice,
            slippagePct: candidate.entryPrice ? ((filledPrice - candidate.entryPrice) / candidate.entryPrice) * 100 : null,
            fillTime: new Date(),
          },
        });
      } catch (logErr) {
        console.warn('TradeLog create failed (non-blocking)', logErr);
      }

      return pos;
    });

    positionId = position.id;
    console.log(`    ✓ Position saved (ID: ${positionId.slice(0, 8)}...)`);

    await logExecution({
      ticker, phase: 'COMPLETE', orderId: String(buyOrder.id),
      requestBody: JSON.stringify({ positionId }), responseStatus: 201,
      quantity: filledQuantity, accountType, stopPrice,
    });
  } catch (err) {
    const msg = (err as Error).message;
    await logExecution({
      ticker, phase: 'DB_POSITION_FAILED', orderId: String(buyOrder.id),
      requestBody: JSON.stringify({ filledPrice, filledQuantity }), accountType, error: msg,
    });
    console.error(`    ✗ DB position failed — trade IS live on T212. ${msg}`);
    return {
      ticker, success: true, shares: filledQuantity, filledPrice, stopPrice,
      stopPlaced, error: `DB save failed: ${msg}`, critical: true,
    };
  }

  return {
    ticker, success: true, shares: filledQuantity, filledPrice, stopPrice,
    stopPlaced, positionId,
    critical: !stopPlaced ? true : undefined,
  };
}

// ── Telegram Notification Helpers ────────────────────────────

async function sendTradeNotification(result: TradeResult, session: string): Promise<void> {
  const statusEmoji = result.success ? (result.stopPlaced ? '✅' : '⚠️') : '❌';
  const stopLine = result.stopPlaced
    ? `Stop: ${result.stopPrice?.toFixed(2)}`
    : '🚨 <b>STOP NOT PLACED — SET MANUALLY</b>';

  const lines = [
    `${statusEmoji} <b>Auto-Trade: ${result.ticker}</b>`,
    `Session: ${session}`,
    '',
  ];

  if (result.success) {
    lines.push(
      `Shares: ${result.shares}`,
      `Fill: ${result.filledPrice?.toFixed(4)}`,
      stopLine,
    );
    if (result.positionId) lines.push(`Position: ${result.positionId.slice(0, 8)}...`);
  } else {
    lines.push(`Error: ${result.error}`);
  }

  if (result.critical) {
    lines.push('', '🚨 <b>ACTION REQUIRED — check T212 app immediately</b>');
  }

  await sendTelegramMessage({ text: lines.join('\n') });

  // Also create in-app alert for critical issues
  if (result.critical) {
    await sendAlert({
      type: result.stopPlaced === false && result.success ? 'UNPROTECTED_POSITION' : 'FAILED_ORDER',
      title: `Auto-Trade: ${result.ticker}`,
      message: result.error || 'Stop-loss failed to place',
      priority: 'CRITICAL',
    });
  }
}

async function sendSessionSummary(
  session: Session,
  scanResults: { regime: string; readyCount: number; totalScanned: number },
  eligible: Array<{ ticker: string; rankScore: number; distancePercent: number; shares?: number; reason?: string }>,
  tradeResults: TradeResult[],
  skipped: Array<{ ticker: string; reason: string }>,
): Promise<void> {
  const config = SESSION_CONFIGS[session];
  const now = getUKTimeString();
  const executed = tradeResults.filter(r => r.success).length;
  const failed = tradeResults.filter(r => !r.success).length;

  const lines = [
    `📊 <b>HybridTurtle Auto-Trade — ${config.name}</b>`,
    `${now}`,
    '',
    `Regime: <b>${scanResults.regime}</b> | Scanned: ${scanResults.totalScanned} | READY: ${scanResults.readyCount}`,
    '',
  ];

  if (session === 'scan') {
    // Scan-only session — report candidates, no trades
    if (eligible.length > 0) {
      lines.push(`<b>📋 Candidates for tomorrow:</b>`);
      for (const c of eligible) {
        lines.push(`  • <b>${c.ticker}</b> — rank ${c.rankScore.toFixed(1)}, ${c.distancePercent.toFixed(1)}% from trigger`);
      }
    } else {
      lines.push('No READY candidates found.');
    }
  } else {
    // Trading session — report executions
    if (tradeResults.length > 0) {
      lines.push(`<b>Trades: ${executed} executed, ${failed} failed</b>`);
      for (const r of tradeResults) {
        const emoji = r.success ? (r.stopPlaced ? '✅' : '⚠️') : '❌';
        if (r.success) {
          lines.push(`  ${emoji} <b>${r.ticker}</b> — ${r.shares} shares @ ${r.filledPrice?.toFixed(2)}, stop ${r.stopPlaced ? r.stopPrice?.toFixed(2) : 'MISSING'}`);
        } else {
          lines.push(`  ${emoji} <b>${r.ticker}</b> — ${r.error}`);
        }
      }
    } else {
      lines.push('No trades executed this session.');
    }

    if (skipped.length > 0) {
      lines.push('', `<b>Skipped (${skipped.length}):</b>`);
      for (const s of skipped) {
        lines.push(`  ⏭ ${s.ticker} — ${s.reason}`);
      }
    }
  }

  // Portfolio status
  const openCount = await prisma.position.count({ where: { userId: 'default-user', status: 'OPEN' } });
  lines.push('', `Open positions: ${openCount}`);

  await sendTelegramMessage({ text: lines.join('\n') });
}

// ── Main Pipeline ────────────────────────────────────────────

async function runAutoTrade(session: Session) {
  const userId = 'default-user';

  console.log('========================================');
  console.log(`[HybridTurtle] Auto-Trade — ${SESSION_CONFIGS[session].name}`);
  console.log(`  Time (UK): ${getUKTimeString()}`);
  console.log('========================================');

  // ── Gate 0: Master enable check (DB setting or env var) ──
  const autoEnabled = await isAutoTradingEnabled();
  if (!autoEnabled) {
    console.log('  ✗ Auto-trading is not enabled — exiting.');
    console.log('  Enable via Settings > Safety Controls, or set ENABLE_AUTO_TRADING=true in .env');
    await prisma.$disconnect();
    return;
  }

  // ── Gate 1: Weekend check ──
  const ukDay = getUKDayOfWeek();
  if (ukDay === 0 || ukDay === 6) {
    console.log('  Weekend — skipping.');
    await prisma.heartbeat.create({
      data: { status: 'SKIPPED', details: JSON.stringify({ type: 'auto-trade', session, reason: 'weekend' }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Gate 2: Kill switch check ──
  try {
    await assertSubmissionAllowed({ automated: true });
  } catch (err) {
    const msg = err instanceof SafetyControlError ? err.message : 'Safety control blocked';
    console.log(`  ✗ Kill switch active: ${msg}`);
    await sendTelegramMessage({ text: `🚫 Auto-Trade blocked by kill switch: ${msg}` });
    await prisma.heartbeat.create({
      data: { status: 'SKIPPED', details: JSON.stringify({ type: 'auto-trade', session, reason: 'kill-switch', message: msg }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Gate 3: Broker configured check ──
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { riskProfile: true, equity: true, t212Connected: true, t212IsaConnected: true },
  });
  if (!user) {
    console.error('  ✗ User not found');
    await prisma.$disconnect();
    return;
  }
  if (!user.t212Connected && !user.t212IsaConnected) {
    console.log('  ✗ No Trading 212 accounts connected — exiting.');
    await sendTelegramMessage({ text: '🚫 Auto-Trade: No T212 account connected. Configure in Settings.' });
    await prisma.$disconnect();
    return;
  }

  const riskProfile = (user.riskProfile || 'BALANCED') as RiskProfileType;
  const equity = user.equity || 0;

  if (equity <= 0) {
    console.log('  ✗ Account equity is 0 — exiting.');
    await prisma.$disconnect();
    return;
  }

  // ── Step 1: Run fresh scan ──
  console.log('\n  [1/4] Running signal scan...');
  let scanResult: Awaited<ReturnType<typeof runFullScan>>;
  try {
    scanResult = await runFullScan(userId, riskProfile, equity);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`  ✗ Scan failed: ${msg}`);
    await sendTelegramMessage({ text: `❌ Auto-Trade scan failed: ${msg}` });
    await prisma.$disconnect();
    return;
  }

  console.log(`    Regime: ${scanResult.regime} | Scanned: ${scanResult.totalScanned} | READY: ${scanResult.readyCount}`);

  // ── Gate 4: Regime check (scan-only sessions skip this) ──
  if (session !== 'scan' && scanResult.regime !== 'BULLISH') {
    console.log(`  ✗ Regime is ${scanResult.regime} — no new entries allowed.`);
    await sendSessionSummary(session, { regime: scanResult.regime, readyCount: scanResult.readyCount, totalScanned: scanResult.totalScanned }, [], [], [{ ticker: '*', reason: `Regime: ${scanResult.regime}` }]);
    await prisma.heartbeat.create({
      data: { status: 'OK', details: JSON.stringify({ type: 'auto-trade', session, reason: `regime-${scanResult.regime}`, scanned: scanResult.totalScanned }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Gate 5: Health check ──
  const latestHealth = await prisma.healthCheck.findFirst({
    where: { userId },
    orderBy: { runDate: 'desc' },
    select: { overall: true },
  });
  if (session !== 'scan' && latestHealth?.overall === 'RED') {
    console.log('  ✗ Health status is RED — no new entries.');
    await sendSessionSummary(session, { regime: scanResult.regime, readyCount: scanResult.readyCount, totalScanned: scanResult.totalScanned }, [], [], [{ ticker: '*', reason: 'Health: RED' }]);
    await prisma.$disconnect();
    return;
  }

  // ── Step 2: Filter and grade candidates for this session ──
  console.log('\n  [2/4] Filtering and grading candidates...');

  const existingPositions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: true },
  });
  const openTickers = new Set(existingPositions.map(p => p.stock.ticker));

  // Grade all candidates using the classification module
  const gradingCtx: GradingContext = {
    regime: scanResult.regime,
    healthOverall: latestHealth?.overall ?? 'GREEN',
  };

  // Get candidates that pass filters, are READY, match session, and are A-grade (prefer) or B-grade (fallback)
  const sessionCandidates = scanResult.candidates.filter(c =>
    !openTickers.has(c.ticker) &&
    isStockForSession(c.ticker, c.sleeve, session)
  );

  // Classify each candidate
  const gradedCandidates = sessionCandidates.map(c => ({
    ...c,
    classification: classifyCandidate(c, gradingCtx),
  }));

  // Auto-trade only executes A_GRADE_BUY candidates
  const readyCandidates = gradedCandidates.filter(c => c.classification.grade === 'A_GRADE_BUY');

  // Sort by rank (highest first)
  readyCandidates.sort((a, b) => b.rankScore - a.rankScore);

  // Log B-grade as skipped with reason
  const bGrades = gradedCandidates.filter(c => c.classification.grade === 'B_GRADE_WATCH');
  for (const c of bGrades) {
    console.log(`    [B-GRADE] ${c.ticker}: ${c.classification.reason}`);
  }

  const eligible = readyCandidates.map(c => ({
    ticker: c.ticker,
    rankScore: c.rankScore,
    distancePercent: c.distancePercent,
    shares: c.shares,
    reason: c.classification.reason,
  }));

  console.log(`    A-Grade for ${session}: ${readyCandidates.length} | B-Grade: ${bGrades.length} | Blocked/C: ${gradedCandidates.length - readyCandidates.length - bGrades.length}`);
  for (const c of readyCandidates.slice(0, 5)) {
    console.log(`      ✓ ${c.ticker} — rank ${c.rankScore.toFixed(1)}, ${c.distancePercent.toFixed(1)}% from trigger`);
  }

  // ── Scan-only session: report and exit ──
  if (session === 'scan') {
    // Also report all READY candidates regardless of session filter
    const allReady = scanResult.candidates.filter(c => c.passesAllFilters && c.status === 'READY' && !openTickers.has(c.ticker));
    allReady.sort((a, b) => b.rankScore - a.rankScore);
    const allEligible = allReady.map(c => ({ ticker: c.ticker, rankScore: c.rankScore, distancePercent: c.distancePercent }));

    await sendSessionSummary('scan', { regime: scanResult.regime, readyCount: scanResult.readyCount, totalScanned: scanResult.totalScanned }, allEligible, [], []);
    await prisma.heartbeat.create({
      data: { status: 'OK', details: JSON.stringify({ type: 'auto-trade', session: 'scan', scanned: scanResult.totalScanned, ready: allReady.length }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Step 3: Size and validate each candidate ──
  console.log('\n  [3/4] Sizing and validating...');

  const tradeResults: TradeResult[] = [];
  const skipped: Array<{ ticker: string; reason: string }> = [];
  let tradesExecuted = 0;

  // Build existing positions for risk gate checks (GBP-normalised)
  const existingTickers = existingPositions.map(p => p.stock.ticker);
  const existingPrices = existingTickers.length > 0 ? await getBatchPrices(existingTickers) : {};
  const existingCurrencies: Record<string, string | null> = {};
  for (const p of existingPositions) existingCurrencies[p.stock.ticker] = p.stock.currency;
  const existingGbpPrices = existingTickers.length > 0
    ? await normalizeBatchPricesToGBP(existingPrices, existingCurrencies)
    : {};

  const positionsForGates = existingPositions.map(p => {
    const rawPrice = existingPrices[p.stock.ticker] || p.entryPrice;
    const gbpPrice = existingGbpPrices[p.stock.ticker] ?? rawPrice;
    const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
    return {
      id: p.id,
      ticker: p.stock.ticker,
      sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
      sector: p.stock.sector || 'Unknown',
      cluster: p.stock.cluster || 'General',
      value: p.entryPrice * fxRatio * p.shares,
      riskDollars: Math.max(0, (gbpPrice - p.currentStop * fxRatio) * p.shares),
      shares: p.shares,
      entryPrice: p.entryPrice * fxRatio,
      currentStop: p.currentStop * fxRatio,
      currentPrice: gbpPrice,
    };
  });

  for (const candidate of readyCandidates) {
    if (tradesExecuted >= MAX_TRADES_PER_SESSION) {
      skipped.push({ ticker: candidate.ticker, reason: `Session limit (${MAX_TRADES_PER_SESSION})` });
      continue;
    }

    // Look up stock for T212 ticker mapping and currency
    const stock = await prisma.stock.findFirst({
      where: { ticker: candidate.ticker },
      select: { id: true, t212Ticker: true, currency: true, sleeve: true, sector: true, cluster: true, isaEligible: true },
    });

    if (!stock?.t212Ticker) {
      skipped.push({ ticker: candidate.ticker, reason: 'No T212 ticker mapped' });
      continue;
    }

    // FX conversion for sizing
    const currency = (stock.currency || 'USD').toUpperCase();
    const isUk = candidate.ticker.endsWith('.L');
    let fxToGbp = 1;
    if (isUk || currency === 'GBX' || currency === 'GBp') fxToGbp = 0.01;
    else if (currency !== 'GBP') {
      try { fxToGbp = await getFXRate(currency, 'GBP'); } catch { fxToGbp = 1; }
    }

    // Position sizing
    let sizing;
    try {
      sizing = calculatePositionSize({
        equity,
        riskProfile,
        entryPrice: candidate.entryTrigger,
        stopPrice: candidate.stopPrice,
        sleeve: candidate.sleeve as Sleeve,
        fxToGbp,
        allowFractional: true, // T212 supports fractional shares
      });
    } catch (err) {
      skipped.push({ ticker: candidate.ticker, reason: `Sizing failed: ${(err as Error).message}` });
      continue;
    }

    if (sizing.shares <= 0) {
      skipped.push({ ticker: candidate.ticker, reason: 'Zero shares after sizing' });
      continue;
    }

    // Risk gate validation
    const newEntryGbp = candidate.entryTrigger * fxToGbp;
    const newStopGbp = candidate.stopPrice * fxToGbp;
    const newValue = newEntryGbp * sizing.shares;
    const newRiskDollars = Math.max(0, (newEntryGbp - newStopGbp) * sizing.shares);

    const gateResults = validateRiskGates(
      {
        sleeve: (stock.sleeve || 'CORE') as Sleeve,
        sector: stock.sector || 'Unknown',
        cluster: stock.cluster || 'General',
        value: newValue,
        riskDollars: newRiskDollars,
      },
      positionsForGates,
      equity,
      riskProfile
    );

    const failedGates = gateResults.filter(g => !g.passed);
    if (failedGates.length > 0) {
      skipped.push({ ticker: candidate.ticker, reason: `Risk gates: ${failedGates.map(g => g.gate).join(', ')}` });
      continue;
    }

    // Determine account type
    const accountType = await getAccountTypeForStock(userId, stock.id);

    // ── Step 4: Execute trade ──
    console.log(`\n  [4/4] Executing trade ${tradesExecuted + 1}/${MAX_TRADES_PER_SESSION}...`);

    const result = await executeTrade(userId, {
      stockId: stock.id,
      ticker: candidate.ticker,
      t212Ticker: stock.t212Ticker,
      entryPrice: candidate.entryTrigger,
      stopPrice: candidate.stopPrice,
      shares: sizing.shares,
      sleeve: candidate.sleeve,
      accountType,
      rankScore: candidate.rankScore,
      atr: candidate.technicals?.atr,
      adx: candidate.technicals?.adx,
    });

    tradeResults.push(result);

    // Send immediate Telegram notification for each trade
    await sendTradeNotification(result, SESSION_CONFIGS[session].name);

    if (result.success) {
      tradesExecuted++;

      // Update positions for risk gates (so next candidate is gated against updated state)
      positionsForGates.push({
        id: result.positionId || 'pending',
        ticker: candidate.ticker,
        sleeve: (stock.sleeve || 'CORE') as Sleeve,
        sector: stock.sector || 'Unknown',
        cluster: stock.cluster || 'General',
        value: newValue,
        riskDollars: newRiskDollars,
        shares: sizing.shares,
        entryPrice: newEntryGbp,
        currentStop: newStopGbp,
        currentPrice: newEntryGbp,
      });
    }

    // Rate limit: wait 3s between trades
    if (tradesExecuted < MAX_TRADES_PER_SESSION && readyCandidates.indexOf(candidate) < readyCandidates.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  if (readyCandidates.length === 0) {
    skipped.push({ ticker: '-', reason: 'No READY candidates for this session' });
  }

  // ── Session summary ──
  await sendSessionSummary(
    session,
    { regime: scanResult.regime, readyCount: scanResult.readyCount, totalScanned: scanResult.totalScanned },
    eligible,
    tradeResults,
    skipped,
  );

  // ── Heartbeat ──
  const successCount = tradeResults.filter(r => r.success).length;
  const failCount = tradeResults.filter(r => !r.success).length;
  const heartbeatStatus = failCount > 0 ? 'PARTIAL' : 'OK';

  await prisma.heartbeat.create({
    data: {
      status: heartbeatStatus,
      details: JSON.stringify({
        type: 'auto-trade',
        session,
        scanned: scanResult.totalScanned,
        ready: scanResult.readyCount,
        eligible: readyCandidates.length,
        executed: successCount,
        failed: failCount,
        skipped: skipped.length,
        trades: tradeResults.map(r => ({ ticker: r.ticker, success: r.success, stopPlaced: r.stopPlaced })),
      }),
    },
  });

  console.log(`\n  Done: ${successCount} trades executed, ${failCount} failed, ${skipped.length} skipped`);
  await prisma.$disconnect();
}

// ── Entry point ──────────────────────────────────────────────

const args = process.argv.slice(2);
const sessionArg = args.find(a => a.startsWith('--session='));
const session = (sessionArg?.split('=')[1] || 'scan') as Session;

if (!SESSION_CONFIGS[session]) {
  console.error(`Unknown session: ${session}. Use: uk, us, us-close, scan`);
  process.exit(1);
}

runAutoTrade(session).catch((err) => {
  console.error('Fatal error in auto-trade:', err);
  // Send Telegram alert on fatal crash
  sendTelegramMessage({ text: `🔥 <b>Auto-Trade CRASHED</b>\n\nSession: ${session}\nError: ${(err as Error).message}\n\nCheck logs immediately.` })
    .finally(() => process.exit(1));
});
