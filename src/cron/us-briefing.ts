/**
 * DEPENDENCIES
 * Consumed by: Windows Task Scheduler (Tue-Fri 14:30 UK)
 * Consumes: market-data.ts, prisma.ts, telegram.ts, uk-time.ts
 * Risk-sensitive: NO — read-only briefing, no trading actions
 * Notes: Sends a pre-US-session Telegram briefing at 14:30 UK (Tue-Fri).
 *        Shows US-market READY candidates, current regime, and risk budget.
 *        Helps prepare before the 14:45 auto-trade US session.
 *
 * Usage:
 *   npx tsx src/cron/us-briefing.ts --run-now
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { getMarketRegime } from '@/lib/market-data';
import { getRiskBudget } from '@/lib/risk-gates';
import { RISK_PROFILES, type RiskProfileType, type Sleeve } from '@/types';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek, getUKTimeString } from '@/lib/uk-time';
import { isTodayMarketHoliday, isEarlyCloseDay } from '@/lib/market-holidays';

const log = createCronLogger('us-briefing');
const RUN_NOW = process.argv.includes('--run-now');

async function runUSBriefing() {
  const userId = 'default-user';
  log.info('US pre-session briefing starting');

  // Skip weekends and Monday (Monday briefing covers the full day)
  const ukDay = getUKDayOfWeek();
  if ((ukDay === 0 || ukDay === 6) && !process.argv.includes('--force')) {
    log.info('Weekend — skipping');
    return;
  }

  // Skip market holidays
  const { isHoliday, holiday } = isTodayMarketHoliday();
  if (isHoliday) {
    log.info('Market holiday — skipping', { holiday: holiday?.label });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { riskProfile: true, equity: true, operatingMode: true },
  });
  if (!user) { log.error('User not found'); return; }

  const riskProfile = (user.riskProfile || 'BALANCED') as RiskProfileType;
  const equity = user.equity || 0;

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
      currentPrice: p.entryPrice,
    })),
    equity,
    riskProfile
  );

  // US-eligible READY candidates from latest scan (non-.L tickers)
  const latestScan = await prisma.scan.findFirst({
    where: { userId },
    orderBy: { runDate: 'desc' },
    select: { id: true },
  });
  const usCandidates = latestScan
    ? await prisma.scanResult.findMany({
        where: {
          status: 'READY',
          scanId: latestScan.id,
          stock: { ticker: { not: { endsWith: '.L' } } },
        },
        select: { entryTrigger: true, price: true, rankScore: true, stock: { select: { ticker: true, sleeve: true } } },
        orderBy: { rankScore: 'desc' },
        take: 8,
      })
    : [];

  // Early close check
  const earlyClose = isEarlyCloseDay();

  // Build message
  const regimeEmoji = regime === 'BULLISH' ? '🟢' : regime === 'SIDEWAYS' ? '🟡' : regime === 'BEARISH' ? '🔴' : '⚪';

  const lines: string[] = [
    `🇺🇸 <b>US Pre-Session — ${getUKTimeString()}</b>`,
    '',
  ];

  if (earlyClose) {
    lines.push(`📅 <b>Early close today: ${earlyClose} ET</b>`, '');
  }

  lines.push(`${regimeEmoji} Regime: ${regime} | Risk: ${budget.usedRiskPercent.toFixed(1)}%/${budget.maxRiskPercent}% | Slots: ${budget.usedPositions}/${budget.maxPositions}`);
  lines.push('');

  if (usCandidates.length > 0) {
    lines.push(`<b>US READY Candidates (${usCandidates.length})</b>`);
    for (const c of usCandidates) {
      const distance = c.entryTrigger && c.price ? ((c.entryTrigger - c.price) / c.price * 100).toFixed(1) : '?';
      lines.push(`  📌 ${c.stock.ticker} [${c.stock.sleeve}] — ${c.price.toFixed(2)} → trigger ${c.entryTrigger.toFixed(2)} (${distance}% away)`);
    }
  } else {
    lines.push('No US READY candidates from latest scan.');
  }

  if (regime !== 'BULLISH') {
    lines.push('', '⚠ Regime not BULLISH — US auto-trade will skip buying.');
  }
  if (budget.availableRiskPercent <= 0) {
    lines.push('', '⚠ Risk budget full — no new US entries possible.');
  }

  const text = lines.join('\n');
  log.info('Sending US briefing', { regime, usCandidates: usCandidates.length });
  await sendTelegramMessage({ text, parseMode: 'HTML' });
  log.info('US briefing sent');
}

if (RUN_NOW) {
  runUSBriefing()
    .then(() => process.exit(0))
    .catch((err) => { log.error('US briefing failed', { error: (err as Error).message }); process.exit(1); })
    .finally(() => prisma.$disconnect());
} else {
  console.log('Usage: npx tsx src/cron/us-briefing.ts --run-now');
  process.exit(0);
}
