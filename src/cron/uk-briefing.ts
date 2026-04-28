/**
 * DEPENDENCIES
 * Consumed by: Windows Task Scheduler (Mon-Fri 08:00 UK)
 * Consumes: market-data.ts, prisma.ts, telegram.ts, uk-time.ts
 * Risk-sensitive: NO — read-only briefing, no trading actions
 * Notes: Sends a pre-UK-session Telegram briefing at 08:00 UK (Mon-Fri).
 *        Shows UK (.L) READY candidates, current regime, and risk budget.
 *        Helps prepare before the 08:15 auto-trade UK session.
 *
 * Usage:
 *   npx tsx src/cron/uk-briefing.ts --run-now
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { getMarketRegime } from '@/lib/market-data';
import { getRiskBudget } from '@/lib/risk-gates';
import { RISK_PROFILES, type RiskProfileType, type Sleeve } from '@/types';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek, getUKTimeString } from '@/lib/uk-time';
import { isTodayMarketHoliday } from '@/lib/market-holidays';

const log = createCronLogger('uk-briefing');
const RUN_NOW = process.argv.includes('--run-now');

async function runUKBriefing() {
  const userId = 'default-user';
  log.info('UK pre-session briefing starting');

  const ukDay = getUKDayOfWeek();
  if ((ukDay === 0 || ukDay === 6) && !process.argv.includes('--force')) {
    log.info('Weekend — skipping');
    return;
  }

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

  // UK-eligible READY candidates (.L tickers only)
  const latestScan = await prisma.scan.findFirst({
    where: { userId },
    orderBy: { runDate: 'desc' },
    select: { id: true },
  });
  const ukCandidates = latestScan
    ? await prisma.scanResult.findMany({
        where: {
          status: 'READY',
          scanId: latestScan.id,
          stock: { ticker: { endsWith: '.L' } },
        },
        select: { entryTrigger: true, price: true, rankScore: true, stock: { select: { ticker: true, sleeve: true } } },
        orderBy: { rankScore: 'desc' },
        take: 8,
      })
    : [];

  const regimeEmoji = regime === 'BULLISH' ? '🟢' : regime === 'SIDEWAYS' ? '🟡' : regime === 'BEARISH' ? '🔴' : '⚪';

  const lines: string[] = [
    `🇬🇧 <b>UK Pre-Session — ${getUKTimeString()}</b>`,
    '',
    `${regimeEmoji} Regime: ${regime} | Risk: ${budget.usedRiskPercent.toFixed(1)}%/${budget.maxRiskPercent}% | Slots: ${budget.usedPositions}/${budget.maxPositions}`,
    '',
  ];

  if (ukCandidates.length > 0) {
    lines.push(`<b>UK READY Candidates (${ukCandidates.length})</b>`);
    for (const c of ukCandidates) {
      const distance = c.entryTrigger && c.price ? ((c.entryTrigger - c.price) / c.price * 100).toFixed(1) : '?';
      lines.push(`  📌 ${c.stock.ticker} [${c.stock.sleeve}] — ${c.price.toFixed(2)} → trigger ${c.entryTrigger.toFixed(2)} (${distance}% away)`);
    }
  } else {
    lines.push('No UK READY candidates from latest scan.');
  }

  if (regime !== 'BULLISH') {
    lines.push('', '⚠ Regime not BULLISH — UK auto-trade will skip buying.');
  }
  if (budget.availableRiskPercent <= 0) {
    lines.push('', '⚠ Risk budget full — no new UK entries possible.');
  }

  const text = lines.join('\n');
  log.info('Sending UK briefing', { regime, ukCandidates: ukCandidates.length });
  await sendTelegramMessage({ text, parseMode: 'HTML' });
  log.info('UK briefing sent');
}

if (RUN_NOW) {
  runUKBriefing()
    .then(() => process.exit(0))
    .catch((err) => { log.error('UK briefing failed', { error: (err as Error).message }); process.exit(1); })
    .finally(() => prisma.$disconnect());
} else {
  console.log('Usage: npx tsx src/cron/uk-briefing.ts --run-now');
  process.exit(0);
}
