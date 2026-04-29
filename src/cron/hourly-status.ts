/**
 * DEPENDENCIES
 * Consumed by: hourly-status-task.bat, Windows Task Scheduler
 * Consumes: prisma.ts, telegram.ts, market-data.ts, risk-gates.ts, scan-engine.ts, safety-controls.ts
 * Risk-sensitive: NO — read-only status reporting, no trading actions
 * Last modified: 2026-04-26
 * Notes: Sends hourly Telegram status during market hours (08:00–21:00 UK Mon-Fri).
 *        Reports portfolio state, blockers, candidate readiness, and system health.
 *        Designed to be lightweight and never fail the pipeline.
 */
/**
 * HybridTurtle Hourly Status — Telegram Status Updates
 *
 * Sends detailed Telegram updates during market hours showing:
 *   - Portfolio snapshot (equity, open risk, P&L)
 *   - Trade blockers (regime, health, kill switch, gates)
 *   - READY candidates and their distance to trigger
 *   - Open position status with R-multiples
 *   - System health indicators
 *
 * Runs every hour during UK market hours (08:00–21:00 Mon-Fri).
 * Read-only — no trades, no stop changes, no mutations.
 *
 * Usage:
 *   npx tsx src/cron/hourly-status.ts --run-now
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { getBatchPrices, normalizeBatchPricesToGBP, getMarketRegime } from '@/lib/market-data';
import { fetchT212LivePrices } from '@/lib/position-sync';
import { getKillSwitchSettings, isAutoTradingEnabled, getMarketDataSafetyStatus } from '../../packages/workflow/src';
import { RISK_PROFILES, type RiskProfileType, type Sleeve } from '@/types';
import { getUKDayOfWeek, getUKHour, getUKTimeString } from '@/lib/uk-time';
import { createCronLogger } from '@/lib/cron-logger';
import { isEarlyCloseDay } from '@/lib/market-holidays';

const log = createCronLogger('hourly-status');

// ── Helpers ──────────────────────────────────────────────────

function formatCurrency(value: number, symbol = '£'): string {
  return `${symbol}${Math.abs(value).toFixed(2)}`;
}

// ── Main ─────────────────────────────────────────────────────

async function runHourlyStatus() {
  const userId = 'default-user';
  const ukHour = getUKHour();
  const ukDay = getUKDayOfWeek();

  console.log(`[HybridTurtle] Hourly status check — ${getUKTimeString()}`);

  // Skip weekends
  if (ukDay === 0 || ukDay === 6) {
    console.log('  Weekend — skipping.');
    return;
  }

  // Skip outside market hours (08:00–21:00 UK)
  if (ukHour < 8 || ukHour >= 21) {
    console.log(`  Outside market hours (${ukHour}:00 UK) — skipping.`);
    return;
  }

  try {
    // ── Gather data (all read-only, all wrapped in try/catch) ──

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { riskProfile: true, equity: true },
    });
    const equity = user?.equity || 0;
    const riskProfile = (user?.riskProfile || 'BALANCED') as RiskProfileType;
    const profile = RISK_PROFILES[riskProfile];

    // Open positions with live prices
    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
      orderBy: { entryDate: 'asc' },
    });

    const tickers = positions.map(p => p.stock.ticker);
    // T212 real-time prices as primary, Yahoo as fallback
    const t212Prices = tickers.length > 0 ? await fetchT212LivePrices(userId) : {};
    const missingTickers = tickers.filter(t => !t212Prices[t]);
    const yahooFallback = missingTickers.length > 0 ? await getBatchPrices(missingTickers) : {};
    const prices: Record<string, number> = { ...yahooFallback, ...t212Prices };
    const currencies: Record<string, string | null> = {};
    for (const p of positions) currencies[p.stock.ticker] = p.stock.currency;
    const gbpPrices = tickers.length > 0 ? await normalizeBatchPricesToGBP(prices, currencies) : {};

    // Market regime
    let regime = 'UNKNOWN';
    try { regime = await getMarketRegime(); } catch { /* use UNKNOWN */ }

    // Safety controls
    const killSwitch = await getKillSwitchSettings();
    const autoEnabled = await isAutoTradingEnabled();
    const marketDataStatus = await getMarketDataSafetyStatus();

    // Health check
    const latestHealth = await prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    });

    // Latest scan results (READY candidates)
    const latestScan = await prisma.scan.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      include: {
        results: {
          where: { status: 'READY', passesAllFilters: true },
          orderBy: { rankScore: 'desc' },
          take: 10,
          include: { stock: true },
        },
      },
    });

    // Last heartbeat for auto-trade
    const lastAutoTrade = await prisma.heartbeat.findFirst({
      where: { details: { contains: 'auto-trade' } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, status: true, details: true },
    });

    // ── Build Telegram message ──

    const healthEmoji = latestHealth?.overall === 'GREEN' ? '🟢'
      : latestHealth?.overall === 'YELLOW' ? '🟡' : '🔴';
    const regimeEmoji = regime === 'BULLISH' ? '🟢' : regime === 'SIDEWAYS' ? '🟡' : regime === 'BEARISH' ? '🔴' : '⚪';

    const lines: string[] = [
      `⏰ <b>HybridTurtle Status — ${getUKTimeString()}</b>`,
      '',
    ];

    // Note early-close half-days
    const earlyClose = isEarlyCloseDay();
    if (earlyClose) {
      lines.push(`📅 <i>Early-close day — US market closes at ${earlyClose} ET</i>`, '');
    }

    // ── Portfolio snapshot ──
    let totalUnrealisedPnl = 0;
    let totalOpenRisk = 0;
    let totalMarketValue = 0;

    for (const p of positions) {
      const currentPrice = gbpPrices[p.stock.ticker] ?? (prices[p.stock.ticker] || p.entryPrice);
      const rawPrice = prices[p.stock.ticker] || p.entryPrice;
      const fxRatio = rawPrice > 0 ? currentPrice / rawPrice : 1;
      const entryGbp = p.entryPrice * fxRatio;
      const stopGbp = p.currentStop * fxRatio;
      totalUnrealisedPnl += (currentPrice - entryGbp) * p.shares;
      totalOpenRisk += Math.max(0, (currentPrice - stopGbp) * p.shares);
      totalMarketValue += currentPrice * p.shares;
    }

    const openRiskPct = equity > 0 ? (totalOpenRisk / equity) * 100 : 0;
    const pnlEmoji = totalUnrealisedPnl >= 0 ? '🟩' : '🟥';

    lines.push(
      `<b>Portfolio</b>`,
      `  Equity: ${formatCurrency(equity)} | Positions: ${positions.length}/${profile.maxPositions}`,
      `  ${pnlEmoji} Unrealised: ${totalUnrealisedPnl >= 0 ? '+' : ''}${formatCurrency(totalUnrealisedPnl)}`,
      `  Open risk: ${openRiskPct.toFixed(1)}% / ${profile.maxOpenRisk}%`,
      '',
    );

    // ── Positions detail ──
    if (positions.length > 0) {
      lines.push(`<b>Positions</b>`);
      for (const p of positions) {
        const currentPrice = prices[p.stock.ticker] || p.entryPrice;
        const initialR = p.initialRisk || (p.entryPrice - p.stopLoss) || 1;
        const rMultiple = (currentPrice - p.entryPrice) / initialR;
        const pnlPct = p.entryPrice > 0 ? ((currentPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
        const posEmoji = rMultiple >= 0 ? '🟩' : '🟥';
        const protLevel = p.protectionLevel || 'INITIAL';
        lines.push(`  ${posEmoji} <b>${p.stock.ticker}</b> ${currentPrice.toFixed(2)} | ${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(1)}R | ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% | Stop: ${p.currentStop.toFixed(2)} [${protLevel}]`);
      }
      lines.push('');
    }

    // ── Blockers ──
    const blockers: string[] = [];
    if (regime !== 'BULLISH') blockers.push(`${regimeEmoji} Regime: ${regime}`);
    if (latestHealth?.overall === 'RED') blockers.push('🔴 Health: RED');
    if (killSwitch.disableAllSubmissions) blockers.push('🚫 Kill switch: ALL submissions disabled');
    if (killSwitch.disableAutomatedSubmissions) blockers.push('🚫 Kill switch: automated submissions disabled');
    if (marketDataStatus.isStale) blockers.push(`⚠️ Stale market data (${marketDataStatus.staleSymbolCount} symbols)`);
    if (!autoEnabled) blockers.push('⏸ Auto-trading: OFF');
    if (positions.length >= profile.maxPositions) blockers.push(`📊 Max positions reached (${positions.length}/${profile.maxPositions})`);
    if (openRiskPct >= profile.maxOpenRisk) blockers.push(`📊 Open risk at limit (${openRiskPct.toFixed(1)}%/${profile.maxOpenRisk}%)`);

    if (blockers.length > 0) {
      lines.push(`<b>⛔ Blockers (${blockers.length})</b>`);
      for (const b of blockers) lines.push(`  ${b}`);
    } else {
      lines.push(`<b>✅ No blockers — clear to trade</b>`);
    }
    lines.push('');

    // ── READY candidates ──
    const readyCandidates = latestScan?.results ?? [];
    const openTickers = new Set(positions.map(p => p.stock.ticker));
    const newCandidates = readyCandidates.filter(c => !openTickers.has(c.stock.ticker));

    if (newCandidates.length > 0) {
      lines.push(`<b>📋 READY Candidates (${newCandidates.length})</b>`);
      for (const c of newCandidates.slice(0, 8)) {
        const distEmoji = c.distancePercent <= 1 ? '🔥' : c.distancePercent <= 2 ? '📍' : '📌';
        lines.push(`  ${distEmoji} <b>${c.stock.ticker}</b> — rank ${c.rankScore.toFixed(1)} | ${c.distancePercent.toFixed(1)}% from trigger | stop ${c.stopPrice.toFixed(2)}`);
      }
      if (newCandidates.length > 8) {
        lines.push(`  ... and ${newCandidates.length - 8} more`);
      }
    } else {
      lines.push('📋 No READY candidates');
    }
    lines.push('');

    // ── System status ──
    lines.push(`<b>System</b>`);
    lines.push(`  Health: ${healthEmoji} ${latestHealth?.overall ?? 'UNKNOWN'} | Regime: ${regimeEmoji} ${regime}`);
    lines.push(`  Auto-trade: ${autoEnabled ? '✅ ON' : '⏸ OFF'}`);

    if (lastAutoTrade) {
      const ago = Math.round((Date.now() - new Date(lastAutoTrade.timestamp).getTime()) / 3600000);
      let details = '';
      try {
        const d = JSON.parse(lastAutoTrade.details || '{}');
        details = ` (${d.session || '?'}: ${d.executed ?? 0} executed, ${d.failed ?? 0} failed)`;
      } catch { /* ignore */ }
      lines.push(`  Last auto-trade: ${ago}h ago — ${lastAutoTrade.status}${details}`);
    }

    // ── Send ──
    await sendTelegramMessage({ text: lines.join('\n') });
    console.log('  ✓ Hourly status sent via Telegram');

  } catch (err) {
    console.error('  ✗ Hourly status failed:', err);
    // Try to send error notification (throttled — repeated failures within 1h dedupe)
    try {
      const { sendThrottledTelegramAlert } = await import('@/lib/telegram');
      const { ALERT_CATEGORY } = await import('@/lib/alert-categories');
      await sendThrottledTelegramAlert(
        { text: `⚠️ Hourly status failed: ${(err as Error).message}` },
        ALERT_CATEGORY.HOURLY_STATUS_FAIL
      );
    } catch { /* give up */ }
  } finally {
    await prisma.$disconnect();
  }
}

// ── Entry point ──────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--run-now')) {
  console.log('[HybridTurtle] Running hourly status immediately');
}

runHourlyStatus().then(() => process.exit(0)).catch((err) => {
  console.error('Fatal error in hourly status:', err);
  process.exit(1);
});
