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
import { sendTelegramMessage, sendThrottledTelegramAlert } from '@/lib/telegram';
import { sendAlert } from '@/lib/alert-service';
import { assertSubmissionAllowed, SafetyControlError, isAutoTradingEnabled } from '../../packages/workflow/src';
import { getBatchPrices, normalizeBatchPricesToGBP, getFXRate, getMarketRegime } from '@/lib/market-data';
import { fetchT212LivePrices } from '@/lib/position-sync';
import { classifyCandidate, type GradingContext, type CandidateGrade } from '@/lib/candidate-grade';
import { getLatestScoresByTicker } from '@/lib/score-lookup';
import { RISK_PROFILES, type RiskProfileType, type Sleeve, type MarketRegime, OPERATING_MODES, type OperatingMode } from '@/types';
import { decryptField } from '@/lib/crypto';
import { isTodayMarketHoliday, isEarlyCloseDay } from '@/lib/market-holidays';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek, getUKTimeString } from '@/lib/uk-time';

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
    return new Trading212Client(decryptField(user.t212IsaApiKey), decryptField(user.t212IsaApiSecret), user.t212Environment as 'demo' | 'live');
  }

  if (!user.t212ApiKey || !user.t212ApiSecret || !user.t212Connected) {
    throw new Error('Trading 212 Invest account not connected.');
  }
  return new Trading212Client(decryptField(user.t212ApiKey), decryptField(user.t212ApiSecret), user.t212Environment as 'demo' | 'live');
}

// ── Determine account type for a stock ───────────────────────
// Returns the account type the stock should route to, or null if
// that account is not connected (caller should skip the candidate
// rather than attempt a trade that will throw "not connected").

async function getAccountTypeForStock(userId: string, stockId: string): Promise<T212AccountType | null> {
  const stock = await prisma.stock.findUnique({ where: { id: stockId }, select: { isaEligible: true, sleeve: true } });

  // Read both account-connection flags once so routing matches reality.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { t212Connected: true, t212IsaConnected: true },
  });

  const investConnected = !!user?.t212Connected;
  const isaConnected = !!user?.t212IsaConnected;

  // No T212 accounts at all → caller will skip (and Telegram will say so once).
  if (!investConnected && !isaConnected) return null;

  // Stock unknown → fall back to whichever account is connected (prefer Invest).
  if (!stock) return investConnected ? 'invest' : 'isa';

  // ISA-eligible CORE stocks prefer ISA, but only if it's connected.
  if (stock.sleeve === 'CORE' && stock.isaEligible === true) {
    if (isaConnected) return 'isa';
    if (investConnected) return 'invest';
    return null;
  }

  // Everything else routes to Invest. If Invest isn't connected, this
  // candidate cannot be traded under the current configuration → null.
  if (investConnected) return 'invest';
  return null;
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
  },
  tradeLog?: ReturnType<typeof createCronLogger>
): Promise<TradeResult> {
  const { ticker, t212Ticker, entryPrice, stopPrice, shares, accountType } = candidate;

  tradeLog?.info('Trade execution starting', { ticker, shares, entryPrice, stopPrice, accountType });
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
    tradeLog?.info('Stop-loss placed', { ticker, stopPrice, orderId: stopOrder.id });
    console.log(`    ✓ Stop-loss placed @ ${stopPrice.toFixed(4)} (ID: ${stopOrder.id})`);
  } catch (err) {
    const msg = err instanceof Trading212Error ? `T212 ${err.statusCode}: ${err.message}` : (err as Error).message;
    await logExecution({
      ticker, phase: 'STOP_FAILED', requestBody: JSON.stringify(stopRequest),
      responseStatus: err instanceof Trading212Error ? err.statusCode : null,
      accountType, error: msg, stopPrice, quantity: stopQuantity,
    });
    console.error(`    ✗ CRITICAL: Stop-loss FAILED — ${msg}`);
    tradeLog?.error('CRITICAL: Stop-loss FAILED', { ticker, error: msg });
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

  // Weekly earnings calendar (scan session only)
  if (session === 'scan') {
    try {
      const openPositions = await prisma.position.findMany({
        where: { userId: 'default-user', status: 'OPEN' },
        select: { stock: { select: { ticker: true } } },
      });
      const holdingTickers = openPositions.map(p => p.stock.ticker);
      const candidateTickers = eligible.slice(0, 5).map(c => c.ticker);
      const allTickers = [...new Set([...holdingTickers, ...candidateTickers])];
      if (allTickers.length > 0) {
        const { fetchBatchNewsContext } = await import('@/lib/analyst/news-fetcher');
        const results = await fetchBatchNewsContext(allTickers, 0);
        const upcoming = results
          .filter(r => r.earnings.daysUntil != null && r.earnings.daysUntil <= 7)
          .sort((a, b) => (a.earnings.daysUntil ?? 99) - (b.earnings.daysUntil ?? 99));
        if (upcoming.length > 0) {
          lines.push('', `📅 <b>Earnings this week:</b>`);
          for (const u of upcoming) {
            const warn = (u.earnings.daysUntil ?? 99) <= 3 ? '⚠️ ' : '';
            const type = holdingTickers.includes(u.ticker) ? '(held)' : '(candidate)';
            lines.push(`  ${warn}<b>${u.ticker}</b> in ${u.earnings.daysUntil}d ${type}`);
          }
        }
      }
    } catch {
      // Best-effort — don't fail the summary
    }
  }

  await sendTelegramMessage({ text: lines.join('\n') });
}

// ── Main Pipeline ────────────────────────────────────────────

async function runAutoTrade(session: Session) {
  const userId = 'default-user';
  const log = createCronLogger('auto-trade', { session });

  log.info('Auto-trade started', { sessionName: SESSION_CONFIGS[session].name, ukTime: getUKTimeString() });
  console.log('========================================');
  console.log(`[HybridTurtle] Auto-Trade — ${SESSION_CONFIGS[session].name}`);
  console.log(`  Time (UK): ${getUKTimeString()}`);
  console.log('========================================');

  // ── Gate 0: Master enable check (DB setting or env var) ──
  const autoEnabled = await isAutoTradingEnabled();
  if (!autoEnabled) {
    log.info('Gate 0 BLOCKED: auto-trading not enabled');
    console.log('  ✗ Auto-trading is not enabled — exiting.');
    console.log('  Enable via Settings > Safety Controls, or set ENABLE_AUTO_TRADING=true in .env');
    await prisma.$disconnect();
    return;
  }

  // ── Gate 1: Weekend check ──
  const ukDay = getUKDayOfWeek();
  if (ukDay === 0 || ukDay === 6) {
    log.info('Gate 1 BLOCKED: weekend', { ukDay });
    console.log('  Weekend — skipping.');
    await prisma.heartbeat.create({
      data: { status: 'SKIPPED', details: JSON.stringify({ type: 'auto-trade', session, reason: 'weekend' }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Gate 1a: Market holiday check ──
  const { isHoliday, holiday } = isTodayMarketHoliday();
  if (isHoliday && session !== 'scan') {
    log.info('Gate 1a BLOCKED: market holiday', { holiday: holiday?.label });
    console.log(`  Market holiday: ${holiday?.label} — skipping trades (scan-only allowed).`);
    await prisma.heartbeat.create({
      data: { status: 'SKIPPED', details: JSON.stringify({ type: 'auto-trade', session, reason: 'market-holiday', holiday: holiday?.label }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Gate 1b: Early-close half-day check (US sessions only) ──
  // On early-close days (Black Friday, Christmas Eve) the US market closes at 1pm ET (~6pm UK).
  // The us-close session at 20:00 UK would trade after market close — skip it.
  const earlyClose = isEarlyCloseDay();
  if (earlyClose && session === 'us-close') {
    log.info('Early-close day — us-close session skipped', { closeTime: earlyClose });
    console.log(`  Early-close day (${earlyClose} ET) — us-close session skipped.`);
    await sendTelegramMessage({ text: `📅 Early-close day today (market closes ${earlyClose} ET). The us-close session is skipped — only UK and early US sessions will trade.` });
    await prisma.heartbeat.create({
      data: { status: 'SKIPPED', details: JSON.stringify({ type: 'auto-trade', session, reason: 'early-close', closeTime: earlyClose }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Gate 2: Kill switch check ──
  try {
    await assertSubmissionAllowed({ automated: true });
  } catch (err) {
    const msg = err instanceof SafetyControlError ? err.message : 'Safety control blocked';
    log.info('Gate 2 BLOCKED: kill switch', { message: msg });
    console.log(`  ✗ Kill switch active: ${msg}`);
    const { ALERT_CATEGORY: AC1, buildAlertKey: BK1 } = await import('@/lib/alert-categories');
    await sendThrottledTelegramAlert(
      { text: `🚫 Auto-Trade blocked by kill switch: ${msg}` },
      BK1(AC1.AUTO_TRADE_BLOCKED, `kill-switch:${session}`)
    );
    await prisma.heartbeat.create({
      data: { status: 'SKIPPED', details: JSON.stringify({ type: 'auto-trade', session, reason: 'kill-switch', message: msg }) },
    });
    await prisma.$disconnect();
    return;
  }

  // ── Gate 3: Broker configured check ──
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { riskProfile: true, equity: true, t212Connected: true, t212IsaConnected: true, operatingMode: true },
  });
  if (!user) {
    console.error('  ✗ User not found');
    await prisma.$disconnect();
    return;
  }

  // ── Gate 3a: Operating mode check ──
  const modeKey = (user.operatingMode || 'NORMAL') as OperatingMode;
  const modeConfig = OPERATING_MODES[modeKey];
  if (session !== 'scan' && modeConfig && !modeConfig.canBuy) {
    log.info('Gate 3a BLOCKED: operating mode', { mode: modeKey });
    console.log(`  ✗ Operating mode ${modeKey} does not allow buying — exiting.`);
    const { ALERT_CATEGORY: AC2, buildAlertKey: BK2 } = await import('@/lib/alert-categories');
    await sendThrottledTelegramAlert(
      { text: `🚫 Auto-Trade blocked: operating mode ${modeKey} — ${modeConfig.description}` },
      BK2(AC2.AUTO_TRADE_BLOCKED, `mode:${modeKey}:${session}`)
    );
    await prisma.heartbeat.create({
      data: { status: 'SKIPPED', details: JSON.stringify({ type: 'auto-trade', session, reason: `operating-mode-${modeKey}` }) },
    });
    await prisma.$disconnect();
    return;
  }

  if (!user.t212Connected && !user.t212IsaConnected) {
    log.info('Gate 3 BLOCKED: no T212 accounts connected');
    console.log('  ✗ No Trading 212 accounts connected — exiting.');
    const { ALERT_CATEGORY: AC3, buildAlertKey: BK3 } = await import('@/lib/alert-categories');
    await sendThrottledTelegramAlert(
      { text: '🚫 Auto-Trade: No T212 account connected. Configure in Settings.' },
      BK3(AC3.AUTO_TRADE_BLOCKED, `no-t212:${session}`)
    );
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
    const { ALERT_CATEGORY: AC4, buildAlertKey: BK4 } = await import('@/lib/alert-categories');
    await sendThrottledTelegramAlert(
      { text: `❌ Auto-Trade scan failed: ${msg}` },
      BK4(AC4.AUTO_TRADE_SCAN_FAIL, session)
    );
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

  // Per-candidate dual-score lookup. Without this every candidate is graded
  // with NCS=0/FWS=100/BQS=0 (worst case), which means nothing ever reaches
  // A_GRADE_BUY and auto-trade silently produces zero eligible trades.
  const sessionTickers = sessionCandidates.map(c => c.ticker);
  const scoresByTicker = await getLatestScoresByTicker(sessionTickers).catch((err) => {
    console.warn('  [grading] Score lookup failed, falling back to null scores:', (err as Error).message);
    return new Map<string, ReturnType<typeof Map.prototype.get>>() as Map<string, never>;
  });

  // Classify each candidate with its own NCS/FWS/BQS
  const gradedCandidates = sessionCandidates.map(c => {
    const scores = scoresByTicker.get(c.ticker);
    const candidateCtx: GradingContext = scores
      ? { ...gradingCtx, ncs: scores.ncs, fws: scores.fws, bqs: scores.bqs }
      : gradingCtx;
    return {
      ...c,
      classification: classifyCandidate(c, candidateCtx),
    };
  });

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

  // ── Earnings proximity check (advisory + optional deferral) ──
  const earningsDeferralDays = parseInt(process.env.EARNINGS_DEFERRAL_DAYS || '0', 10);
  const earningsWarnings: string[] = [];
  const earningsDeferredTickers = new Set<string>();

  try {
    const { fetchBatchNewsContext } = await import('@/lib/analyst/news-fetcher');
    const candidateTickers = readyCandidates.slice(0, 5).map(c => c.ticker);
    if (candidateTickers.length > 0) {
      const newsResults = await fetchBatchNewsContext(candidateTickers, 0); // 0 headlines — only need earnings
      for (const news of newsResults) {
        if (news.earnings.daysUntil !== null && news.earnings.daysUntil <= Math.max(earningsDeferralDays, 5)) {
          const warn = `⚠️ ${news.ticker}: earnings in ${news.earnings.daysUntil} days`;
          earningsWarnings.push(warn);
          console.log(`    [EARNINGS WARNING] ${warn}`);

          // If deferral is enabled and within the deferral window, mark for downgrade
          if (earningsDeferralDays > 0 && news.earnings.daysUntil <= earningsDeferralDays) {
            earningsDeferredTickers.add(news.ticker);
            console.log(`    [EARNINGS DEFERRED] ${news.ticker} downgraded to B-grade (earnings in ${news.earnings.daysUntil}d, deferral window ${earningsDeferralDays}d)`);
          }
        }
      }
      if (earningsWarnings.length > 0) {
        const deferralNote = earningsDeferredTickers.size > 0
          ? `\n\n🚫 Deferred (EARNINGS_DEFERRAL_DAYS=${earningsDeferralDays}): ${[...earningsDeferredTickers].join(', ')}`
          : '\n\n<i>Auto-trade will proceed — manual review recommended.</i>';
        await sendTelegramMessage({
          text: `📅 <b>Earnings Event Risk</b>\n\n${earningsWarnings.join('\n')}${deferralNote}`,
          parseMode: 'HTML',
        }).catch(() => {}); // Best-effort alert
      }
    }
  } catch (err) {
    console.log(`    [EARNINGS CHECK] Skipped: ${(err as Error).message}`);
  }

  // Remove deferred tickers from the ready list (move to skipped)
  const originalReadyCount = readyCandidates.length;
  for (let i = readyCandidates.length - 1; i >= 0; i--) {
    if (earningsDeferredTickers.has(readyCandidates[i].ticker)) {
      readyCandidates.splice(i, 1);
    }
  }
  if (earningsDeferredTickers.size > 0) {
    console.log(`    [EARNINGS DEFERRAL] ${earningsDeferredTickers.size} candidates deferred (${originalReadyCount} → ${readyCandidates.length} remaining)`);
  }

  const tradeResults: TradeResult[] = [];
  const skipped: Array<{ ticker: string; reason: string }> = [];
  let tradesExecuted = 0;

  // Build existing positions for risk gate checks (GBP-normalised)
  const existingTickers = existingPositions.map(p => p.stock.ticker);
  // T212 real-time prices for existing positions, Yahoo fallback
  const t212Prices = existingTickers.length > 0 ? await fetchT212LivePrices(userId).catch(() => ({} as Record<string, number>)) : {};
  const priceMissing = existingTickers.filter(t => !t212Prices[t]);
  const yahooFallback = priceMissing.length > 0 ? await getBatchPrices(priceMissing) : {};
  const existingPrices: Record<string, number> = { ...yahooFallback, ...t212Prices };
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
    if (!accountType) {
      // Routed account not connected (e.g. ISA-only setup with a non-ISA-eligible US stock).
      // Treat as a configuration skip, not a trade failure.
      skipped.push({
        ticker: candidate.ticker,
        reason: 'T212 account not connected for this stock (check Settings → connect Invest account, or restrict universe to ISA-eligible CORE stocks)',
      });
      continue;
    }

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
    }, log);

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

runAutoTrade(session).catch(async (err) => {
  console.error('Fatal error in auto-trade:', err);
  // Send throttled Telegram alert on fatal crash (suppresses repeated identical crashes)
  try {
    const { sendThrottledTelegramAlert: sendThrottled } = await import('@/lib/telegram');
    const { ALERT_CATEGORY: AC, buildAlertKey: BK } = await import('@/lib/alert-categories');
    await sendThrottled(
      { text: `🔥 <b>Auto-Trade CRASHED</b>\n\nSession: ${session}\nError: ${(err as Error).message}\n\nCheck logs immediately.`, parseMode: 'HTML' },
      BK(AC.AUTO_TRADE_CRASH, session)
    );
  } catch { /* never block exit */ }
  process.exit(1);
});
