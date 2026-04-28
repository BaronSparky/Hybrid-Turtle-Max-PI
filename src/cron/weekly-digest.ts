/**
 * DEPENDENCIES
 * Consumed by: Windows Task Scheduler (Sunday 18:00)
 * Consumes: profit-scoreboard.ts, prisma.ts, telegram.ts, uk-time.ts
 * Risk-sensitive: NO — read-only analytics digest
 * Notes: Sends a weekly Telegram performance summary supporting Job 8 (weekly review).
 *        Covers: trades this week, P&L, R-multiple stats, win rate, equity curve trend.
 *
 * Usage:
 *   npx tsx src/cron/weekly-digest.ts --run-now
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { computeProfitScoreboard } from '@/lib/profit-scoreboard';
import { createCronLogger } from '@/lib/cron-logger';
import { getUKDateString } from '@/lib/uk-time';

const log = createCronLogger('weekly-digest');
const RUN_NOW = process.argv.includes('--run-now');

async function runWeeklyDigest() {
  const userId = 'default-user';
  log.info('Weekly digest starting');

  // Get the past 7 days window
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Fetch trades closed this week
  const closedThisWeek = await prisma.position.findMany({
    where: {
      userId,
      status: 'CLOSED',
      exitDate: { gte: weekAgo },
    },
    include: { stock: { select: { ticker: true } } },
    orderBy: { exitDate: 'desc' },
  });

  // Fetch trades opened this week
  const openedThisWeek = await prisma.position.findMany({
    where: {
      userId,
      entryDate: { gte: weekAgo },
    },
    include: { stock: { select: { ticker: true } } },
  });

  // Get equity snapshots for the week
  const snapshots = await prisma.equitySnapshot.findMany({
    where: { capturedAt: { gte: weekAgo } },
    orderBy: { capturedAt: 'asc' },
    select: { equity: true, capturedAt: true },
  });

  // Get current overall scoreboard
  const scoreboard = await computeProfitScoreboard(userId);

  // Current open positions
  const openCount = await prisma.position.count({
    where: { userId, status: 'OPEN' },
  });

  // Compute this week's stats
  const weekWins = closedThisWeek.filter(p => (p.realisedPnlR ?? 0) > 0);
  const weekLosses = closedThisWeek.filter(p => (p.realisedPnlR ?? 0) <= 0);
  const weekTotalR = closedThisWeek.reduce((sum, p) => sum + (p.realisedPnlR ?? 0), 0);
  const weekPnl = closedThisWeek.reduce((sum, p) => sum + (p.realisedPnlGbp ?? 0), 0);

  // Equity change
  const startEquity = snapshots.length > 0 ? snapshots[0].equity : null;
  const endEquity = snapshots.length > 0 ? snapshots[snapshots.length - 1].equity : null;
  const equityChange = startEquity && endEquity ? endEquity - startEquity : null;
  const equityChangePct = startEquity && equityChange ? (equityChange / startEquity) * 100 : null;

  // Build Telegram message
  const lines: string[] = [
    `📊 <b>Weekly Performance Digest — ${getUKDateString()}</b>`,
    '',
  ];

  // This week's activity
  lines.push('<b>This Week</b>');
  lines.push(`  Opened: ${openedThisWeek.length} | Closed: ${closedThisWeek.length}`);
  if (closedThisWeek.length > 0) {
    lines.push(`  Wins: ${weekWins.length} | Losses: ${weekLosses.length} | Win rate: ${closedThisWeek.length > 0 ? ((weekWins.length / closedThisWeek.length) * 100).toFixed(0) : 0}%`);
    lines.push(`  Total R: ${weekTotalR >= 0 ? '+' : ''}${weekTotalR.toFixed(1)}R`);
    lines.push(`  P&L: ${weekPnl >= 0 ? '+' : ''}£${weekPnl.toFixed(2)}`);

    // List individual trades
    lines.push('');
    lines.push('  <b>Closed trades:</b>');
    for (const p of closedThisWeek.slice(0, 8)) {
      const r = p.realisedPnlR ?? 0;
      const emoji = r > 0 ? '✅' : '❌';
      lines.push(`  ${emoji} ${p.stock.ticker}: ${r >= 0 ? '+' : ''}${r.toFixed(1)}R`);
    }
    if (closedThisWeek.length > 8) {
      lines.push(`  ... and ${closedThisWeek.length - 8} more`);
    }
  } else {
    lines.push('  No trades closed this week.');
  }

  // Equity trend
  if (equityChange !== null && equityChangePct !== null) {
    lines.push('');
    lines.push('<b>Equity</b>');
    lines.push(`  Change: ${equityChange >= 0 ? '+' : '-'}£${Math.abs(equityChange).toFixed(2)} (${equityChangePct >= 0 ? '+' : ''}${equityChangePct.toFixed(1)}%)`);
    lines.push(`  Current: £${(endEquity ?? 0).toFixed(2)}`);
  }

  // Overall system stats
  lines.push('');
  lines.push('<b>All-Time System</b>');
  lines.push(`  Grade: ${scoreboard.grade} | Expectancy: ${scoreboard.expectancyPerTrade >= 0 ? '+' : ''}${scoreboard.expectancyPerTrade.toFixed(2)}R/trade`);
  lines.push(`  Win rate: ${scoreboard.winRate.toFixed(0)}% | Trades: ${scoreboard.totalClosedTrades}`);
  lines.push(`  Avg win: +${scoreboard.avgWinR.toFixed(1)}R | Avg loss: ${scoreboard.avgLossR.toFixed(1)}R`);
  if (scoreboard.profitFactor) {
    lines.push(`  Profit factor: ${scoreboard.profitFactor.toFixed(2)}`);
  }
  lines.push(`  Max drawdown: ${scoreboard.maxDrawdownPct.toFixed(1)}%`);
  if (scoreboard.sampleSizeWarning) {
    lines.push(`  ⚠ ${scoreboard.sampleSizeWarning}`);
  }

  // Automated weekly review suggestions
  lines.push('');
  lines.push('<b>📋 Weekly Review</b>');
  const suggestions: string[] = [];

  // Grade-based suggestion
  if (scoreboard.grade === 'D' || scoreboard.grade === 'F') {
    suggestions.push('System grade is low — review entry criteria and consider tightening filters.');
  }

  // Win rate trend
  if (closedThisWeek.length >= 3) {
    const weekWinRate = (weekWins.length / closedThisWeek.length) * 100;
    if (weekWinRate < 40) suggestions.push(`This week's win rate (${weekWinRate.toFixed(0)}%) is below 40% — check if entries are being chased.`);
    if (weekWinRate >= 70) suggestions.push(`Excellent week (${weekWinRate.toFixed(0)}% win rate) — system is performing well.`);
  }

  // Equity drawdown
  if (equityChangePct !== null && equityChangePct < -3) {
    suggestions.push(`Equity down ${Math.abs(equityChangePct).toFixed(1)}% this week — consider reducing position size or pausing.`);
  }

  // Risk budget
  if (openCount >= 4) {
    suggestions.push(`${openCount} positions open — close to max capacity. Focus on managing existing positions.`);
  } else if (openCount === 0) {
    suggestions.push('No open positions — scan for new opportunities on the next BULLISH regime day.');
  }

  // Sample size
  if (scoreboard.totalClosedTrades < 30) {
    suggestions.push(`Only ${scoreboard.totalClosedTrades} trades completed — too early for reliable system statistics. Keep following the rules.`);
  }

  if (suggestions.length > 0) {
    for (const s of suggestions) {
      lines.push(`  • ${s}`);
    }
  } else {
    lines.push('  ✅ No concerns — system operating normally.');
  }

  // Current state
  lines.push('');
  lines.push(`<b>Current:</b> ${openCount} open position(s)`);

  const text = lines.join('\n');
  log.info('Sending weekly digest', { closedCount: closedThisWeek.length, openedCount: openedThisWeek.length, weekTotalR });

  const sent = await sendTelegramMessage({ text, parseMode: 'HTML' });
  if (sent) {
    log.info('Weekly digest sent');
  } else {
    log.error('Failed to send weekly digest');
  }

  // Write heartbeat
  await prisma.heartbeat.create({
    data: {
      status: 'OK',
      details: JSON.stringify({
        type: 'weekly-digest',
        ranAt: new Date().toISOString(),
        closedThisWeek: closedThisWeek.length,
        weekTotalR,
        grade: scoreboard.grade,
      }),
    },
  });
}

// ── Entry point ──
if (RUN_NOW) {
  runWeeklyDigest()
    .then(() => { log.info('Weekly digest complete'); process.exit(0); })
    .catch((err) => { log.error('Weekly digest failed', { error: (err as Error).message }); process.exit(1); })
    .finally(() => prisma.$disconnect());
} else {
  console.log('Usage: npx tsx src/cron/weekly-digest.ts --run-now');
  process.exit(0);
}
