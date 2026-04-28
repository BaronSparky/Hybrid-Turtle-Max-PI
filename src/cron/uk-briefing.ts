/**
 * DEPENDENCIES
 * Consumed by: Windows Task Scheduler (Mon-Fri 08:00 UK)
 * Consumes: briefing-context.ts, telegram.ts, cron-logger.ts, uk-time.ts
 * Risk-sensitive: NO — read-only briefing, no trading actions
 *
 * Usage: npx tsx src/cron/uk-briefing.ts --run-now
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDayOfWeek } from '@/lib/uk-time';
import { gatherBriefingContext } from '@/lib/briefing-context';

const log = createCronLogger('uk-briefing');
const RUN_NOW = process.argv.includes('--run-now');

async function runUKBriefing() {
  log.info('UK pre-session briefing starting');

  const ukDay = getUKDayOfWeek();
  if ((ukDay === 0 || ukDay === 6) && !process.argv.includes('--force')) {
    log.info('Weekend — skipping'); return;
  }

  const ctx = await gatherBriefingContext({ market: 'UK' });
  if (ctx.isHoliday) { log.info('Market holiday — skipping', { holiday: ctx.holidayLabel }); return; }

  const regimeEmoji = ctx.regime === 'BULLISH' ? '🟢' : ctx.regime === 'SIDEWAYS' ? '🟡' : '🔴';
  const lines = [
    `🇬🇧 <b>UK Pre-Session — ${ctx.ukTimeString}</b>`, '',
    `${regimeEmoji} Regime: ${ctx.regime} | Risk: ${ctx.usedRiskPct.toFixed(1)}%/${ctx.maxRiskPct}% | Slots: ${ctx.usedPositions}/${ctx.maxPositions}`, '',
  ];

  if (ctx.candidates.length > 0) {
    lines.push(`<b>UK READY (${ctx.candidates.length})</b>`);
    for (const c of ctx.candidates) {
      const dist = c.entryTrigger && c.price ? ((c.entryTrigger - c.price) / c.price * 100).toFixed(1) : '?';
      lines.push(`  📌 ${c.ticker} [${c.sleeve}] — ${c.price.toFixed(2)} → ${c.entryTrigger.toFixed(2)} (${dist}%)`);
    }
  } else { lines.push('No UK READY candidates.'); }

  if (ctx.regime !== 'BULLISH') lines.push('', '⚠ Regime not BULLISH — buying blocked.');
  if (ctx.availableRiskPct <= 0) lines.push('', '⚠ Risk budget full.');

  log.info('Sending UK briefing', { regime: ctx.regime, candidates: ctx.candidates.length });
  await sendTelegramMessage({ text: lines.join('\n'), parseMode: 'HTML' });
  log.info('UK briefing sent');
}

if (RUN_NOW) {
  runUKBriefing().then(() => process.exit(0)).catch(e => { log.error('Failed', { error: (e as Error).message }); process.exit(1); }).finally(() => prisma.$disconnect());
} else { console.log('Usage: npx tsx src/cron/uk-briefing.ts --run-now'); process.exit(0); }
