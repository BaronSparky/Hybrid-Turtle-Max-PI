/**
 * DEPENDENCIES
 * Consumed by: Windows Task Scheduler (Monday 07:30 UK)
 * Consumes: market-data.ts, risk-gates.ts, prisma.ts, telegram.ts, uk-time.ts, market-holidays.ts
 * Risk-sensitive: NO — read-only briefing, no trading actions
 * Notes: Sends a Monday morning Telegram briefing before the UK session opens.
 *        Covers: regime, ready candidates, health, open risk budget, holiday notes.
 *        Helps the user prepare before the 08:15 auto-trade window.
 *
 * Usage:
 *   npx tsx src/cron/monday-briefing.ts --run-now
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { getMarketRegime } from '@/lib/market-data';
import { getRiskBudget } from '@/lib/risk-gates';
import { RISK_PROFILES, type RiskProfileType, type Sleeve } from '@/types';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek, getUKDateString } from '@/lib/uk-time';
import { isMarketHoliday, isEarlyCloseDay, getMarketHoliday } from '@/lib/market-holidays';

const log = createCronLogger('monday-briefing');
const RUN_NOW = process.argv.includes('--run-now');

async function runMondayBriefing() {
  const userId = 'default-user';
  log.info('Monday briefing starting');

  // Skip non-Mondays (unless --run-now for testing)
  const ukDay = getUKDayOfWeek();
  if (ukDay !== 1 && !process.argv.includes('--force')) {
    log.info('Not Monday — skipping', { ukDay });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { riskProfile: true, equity: true, operatingMode: true },
  });
  if (!user) { log.error('User not found'); return; }

  const riskProfile = (user.riskProfile || 'BALANCED') as RiskProfileType;
  const equity = user.equity || 0;
  const operatingMode = user.operatingMode || 'NORMAL';

  // Gather data
  let regime = 'UNKNOWN';
  try { regime = await getMarketRegime(); } catch { /* use UNKNOWN */ }

  const openPositions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: { select: { ticker: true, sleeve: true } } },
  });

  const budget = getRiskBudget(
    openPositions.map(p => ({
      id: p.id,
      ticker: p.stock.ticker,
      sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
      sector: 'Unknown',
      cluster: 'General',
      value: p.shares * p.entryPrice,
      riskDollars: p.shares * (p.entryPrice - p.currentStop),
      shares: p.shares,
      entryPrice: p.entryPrice,
      currentStop: p.currentStop,
      currentPrice: p.entryPrice, // Approximate — market not open yet
    })),
    equity,
    riskProfile
  );

  // Check for today's holiday/early-close
  const todayStr = getUKDateString();
  const todayHoliday = getMarketHoliday(todayStr);
  const todayEarlyClose = isEarlyCloseDay(todayStr);

  // Ready candidates from latest scan
  const latestScan = await prisma.scan.findFirst({
    where: { userId },
    orderBy: { runDate: 'desc' },
    select: { id: true },
  });
  const readyCandidates = latestScan
    ? await prisma.scanResult.findMany({
        where: { status: 'READY', scanId: latestScan.id },
        select: { entryTrigger: true, price: true, stock: { select: { ticker: true } } },
        orderBy: { rankScore: 'desc' },
        take: 5,
      })
    : [];

  // Latest health
  const health = await prisma.healthCheck.findFirst({
    where: { userId },
    orderBy: { runDate: 'desc' },
    select: { overall: true },
  });

  // Build message
  const regimeEmoji = regime === 'BULLISH' ? '🟢' : regime === 'SIDEWAYS' ? '🟡' : regime === 'BEARISH' ? '🔴' : '⚪';
  const healthEmoji = health?.overall === 'GREEN' ? '🟢' : health?.overall === 'YELLOW' ? '🟡' : '🔴';

  const lines: string[] = [
    `☀️ <b>Monday Pre-Trade Briefing — ${todayStr}</b>`,
    '',
  ];

  // Holiday / early-close warnings
  if (todayHoliday) {
    lines.push(`🚫 <b>Market Holiday: ${todayHoliday.label}</b> — no trading today.`, '');
  }
  if (todayEarlyClose) {
    lines.push(`📅 <b>Early close today: ${todayEarlyClose} ET</b> — us-close session will be skipped.`, '');
  }

  // System status
  lines.push('<b>System Status</b>');
  lines.push(`  ${regimeEmoji} Regime: ${regime}`);
  lines.push(`  ${healthEmoji} Health: ${health?.overall ?? 'UNKNOWN'}`);
  lines.push(`  Mode: ${operatingMode}`);
  lines.push(`  Equity: £${equity.toFixed(2)}`);
  lines.push('');

  // Risk budget
  lines.push('<b>Risk Budget</b>');
  lines.push(`  Open risk: ${budget.usedRiskPercent.toFixed(1)}% of ${budget.maxRiskPercent}%`);
  lines.push(`  Available: ${budget.availableRiskPercent.toFixed(1)}%`);
  lines.push(`  Positions: ${budget.usedPositions}/${budget.maxPositions}`);
  lines.push('');

  // Open positions
  if (openPositions.length > 0) {
    lines.push(`<b>Open Positions (${openPositions.length})</b>`);
    for (const p of openPositions.slice(0, 8)) {
      const r = p.initialRisk > 0 ? ((p.entryPrice - p.currentStop) / p.initialRisk).toFixed(1) : '?';
      lines.push(`  ${p.stock.ticker} — entry ${p.entryPrice.toFixed(2)}, stop ${p.currentStop.toFixed(2)}`);
    }
    if (openPositions.length > 8) lines.push(`  ... and ${openPositions.length - 8} more`);
    lines.push('');
  }

  // Ready candidates
  if (readyCandidates.length > 0) {
    lines.push(`<b>READY Candidates (${readyCandidates.length})</b>`);
    for (const c of readyCandidates) {
      lines.push(`  📌 ${c.stock.ticker} — trigger ${c.entryTrigger?.toFixed(2) ?? '?'}, price ${c.price?.toFixed(2) ?? '?'}`);
    }
    lines.push('');
  } else {
    lines.push('No READY candidates from latest scan.', '');
  }

  // Trading guidance
  if (regime !== 'BULLISH') {
    lines.push('⚠ Regime is not BULLISH — no new entries will be taken by auto-trade.');
  }
  if (operatingMode === 'CAPITAL_PRESERVATION' || operatingMode === 'RESEARCH') {
    lines.push(`⚠ Operating mode ${operatingMode} — buying is disabled.`);
  }
  if (budget.availableRiskPercent <= 0) {
    lines.push('⚠ Risk budget is full — no new entries possible until existing positions close.');
  }

  const text = lines.join('\n');
  log.info('Sending Monday briefing', { regime, positions: openPositions.length, readyCandidates: readyCandidates.length });

  const sent = await sendTelegramMessage({ text, parseMode: 'HTML' });
  if (sent) {
    log.info('Monday briefing sent');
  } else {
    log.error('Failed to send Monday briefing');
  }

  await prisma.heartbeat.create({
    data: {
      status: 'OK',
      details: JSON.stringify({
        type: 'monday-briefing',
        ranAt: new Date().toISOString(),
        regime,
        positions: openPositions.length,
        readyCandidates: readyCandidates.length,
      }),
    },
  });
}

// ── Entry point ──
if (RUN_NOW) {
  runMondayBriefing()
    .then(() => { log.info('Monday briefing complete'); process.exit(0); })
    .catch((err) => { log.error('Monday briefing failed', { error: (err as Error).message }); process.exit(1); })
    .finally(() => prisma.$disconnect());
} else {
  console.log('Usage: npx tsx src/cron/monday-briefing.ts --run-now');
  process.exit(0);
}
