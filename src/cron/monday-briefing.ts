/**
 * DEPENDENCIES
 * Consumed by: Windows Task Scheduler (Monday 07:30 UK)
 * Consumes: briefing-context.ts, telegram.ts, cron-logger.ts, uk-time.ts
 * Risk-sensitive: NO — read-only briefing, no trading actions
 *
 * Usage: npx tsx src/cron/monday-briefing.ts --run-now [--force]
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek } from '@/lib/uk-time';
import { gatherBriefingContext } from '@/lib/briefing-context';

const log = createCronLogger('monday-briefing');
const RUN_NOW = process.argv.includes('--run-now');

async function runMondayBriefing() {
  log.info('Monday briefing starting');

  const ukDay = getUKDayOfWeek();
  if (ukDay !== 1 && !process.argv.includes('--force')) {
    log.info('Not Monday — skipping', { ukDay }); return;
  }

  const ctx = await gatherBriefingContext({ market: 'all' });

  const regimeEmoji = ctx.regime === 'BULLISH' ? '🟢' : ctx.regime === 'SIDEWAYS' ? '🟡' : '🔴';
  const healthEmoji = ctx.health === 'GREEN' ? '🟢' : ctx.health === 'YELLOW' ? '🟡' : '🔴';

  const lines = [
    `☀️ <b>Monday Pre-Trade Briefing — ${ctx.ukTimeString}</b>`, '',
  ];

  if (ctx.isHoliday) lines.push(`🚫 <b>Market Holiday: ${ctx.holidayLabel}</b> — no trading today.`, '');
  if (ctx.earlyClose) lines.push(`📅 <b>Early close today: ${ctx.earlyClose} ET</b>`, '');

  lines.push('<b>System Status</b>');
  lines.push(`  ${regimeEmoji} Regime: ${ctx.regime}`);
  lines.push(`  ${healthEmoji} Health: ${ctx.health ?? 'UNKNOWN'}`);
  lines.push(`  Mode: ${ctx.operatingMode}`);
  lines.push(`  Equity: £${ctx.equity.toFixed(2)}`, '');

  lines.push('<b>Risk Budget</b>');
  lines.push(`  Open risk: ${ctx.usedRiskPct.toFixed(1)}% of ${ctx.maxRiskPct}%`);
  lines.push(`  Available: ${ctx.availableRiskPct.toFixed(1)}%`);
  lines.push(`  Positions: ${ctx.usedPositions}/${ctx.maxPositions}`, '');

  if (ctx.openPositions.length > 0) {
    lines.push(`<b>Open Positions (${ctx.openPositions.length})</b>`);
    for (const p of ctx.openPositions.slice(0, 8)) {
      lines.push(`  ${p.ticker} — entry ${p.entryPrice.toFixed(2)}, stop ${p.currentStop.toFixed(2)}`);
    }
    if (ctx.openPositions.length > 8) lines.push(`  ... and ${ctx.openPositions.length - 8} more`);
    lines.push('');
  }

  if (ctx.candidates.length > 0) {
    lines.push(`<b>READY Candidates (${ctx.candidates.length})</b>`);
    for (const c of ctx.candidates) {
      lines.push(`  📌 ${c.ticker} — trigger ${c.entryTrigger.toFixed(2)}, price ${c.price.toFixed(2)}`);
    }
    lines.push('');
  } else { lines.push('No READY candidates from latest scan.', ''); }

  // Last week's price accuracy (T212 vs Yahoo)
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const snapshots = await prisma.priceSnapshot.findMany({
      where: { capturedAt: { gte: weekAgo }, diffPercent: { not: null } },
      select: { diffPercent: true },
    });
    if (snapshots.length > 0) {
      const avg = snapshots.reduce((s, r) => s + (r.diffPercent ?? 0), 0) / snapshots.length;
      const max = Math.max(...snapshots.map(r => r.diffPercent ?? 0));
      const emoji = avg < 0.5 ? '✅' : avg < 2 ? '⚠️' : '🔴';
      lines.push('<b>Price Sources (last 7d)</b>');
      lines.push(`  ${emoji} T212 vs Yahoo: avg ${avg.toFixed(2)}% diff, max ${max.toFixed(2)}%`);
      lines.push(`  ${snapshots.length} snapshots recorded`);
      if (avg > 2) lines.push('  ⚠ High divergence — check T212 connection');
      lines.push('');
    }
  } catch { /* advisory — don't block briefing */ }

  if (ctx.regime !== 'BULLISH') lines.push('⚠ Regime not BULLISH — buying blocked.');
  if (ctx.operatingMode === 'CAPITAL_PRESERVATION' || ctx.operatingMode === 'RESEARCH') {
    lines.push(`⚠ Mode ${ctx.operatingMode} — buying disabled.`);
  }
  if (ctx.availableRiskPct <= 0) lines.push('⚠ Risk budget full.');

  log.info('Sending Monday briefing', { regime: ctx.regime, positions: ctx.openPositions.length, candidates: ctx.candidates.length });
  await sendTelegramMessage({ text: lines.join('\n'), parseMode: 'HTML' });
  log.info('Monday briefing sent');

  await prisma.heartbeat.create({
    data: { kind: 'MONDAY_BRIEFING', status: 'OK', details: JSON.stringify({ type: 'monday-briefing', ranAt: new Date().toISOString(), regime: ctx.regime, positions: ctx.openPositions.length, readyCandidates: ctx.candidates.length }) },
  });
}

if (RUN_NOW) {
  runMondayBriefing().then(() => process.exit(0)).catch(e => { log.error('Failed', { error: (e as Error).message }); process.exit(1); }).finally(() => prisma.$disconnect());
} else { console.log('Usage: npx tsx src/cron/monday-briefing.ts --run-now [--force]'); process.exit(0); }
