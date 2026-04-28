import { describe, expect, it } from 'vitest';

/**
 * Tests for the briefing Telegram message formatting contracts.
 * Validates the message structure patterns used by monday-briefing,
 * uk-briefing, us-briefing, and weekly-digest.
 */

// Replicate the message builder patterns from the briefing scripts

function buildMondayBriefing(data: {
  date: string;
  regime: string;
  health: string;
  operatingMode: string;
  equity: number;
  usedRiskPct: number;
  maxRiskPct: number;
  availableRiskPct: number;
  usedPositions: number;
  maxPositions: number;
  openPositions: Array<{ ticker: string; entryPrice: number; currentStop: number }>;
  readyCandidates: Array<{ ticker: string; entryTrigger: number; price: number }>;
  isHoliday: boolean;
  holidayLabel?: string;
  earlyClose?: string;
}): string[] {
  const regimeEmoji = data.regime === 'BULLISH' ? '🟢' : data.regime === 'SIDEWAYS' ? '🟡' : '🔴';
  const healthEmoji = data.health === 'GREEN' ? '🟢' : data.health === 'YELLOW' ? '🟡' : '🔴';
  const lines: string[] = [
    `☀️ <b>Monday Pre-Trade Briefing — ${data.date}</b>`,
    '',
  ];
  if (data.isHoliday) lines.push(`🚫 <b>Market Holiday: ${data.holidayLabel}</b> — no trading today.`, '');
  if (data.earlyClose) lines.push(`📅 <b>Early close today: ${data.earlyClose} ET</b>`, '');
  lines.push('<b>System Status</b>');
  lines.push(`  ${regimeEmoji} Regime: ${data.regime}`);
  lines.push(`  ${healthEmoji} Health: ${data.health}`);
  lines.push(`  Mode: ${data.operatingMode}`);
  lines.push(`  Equity: £${data.equity.toFixed(2)}`);
  lines.push('');
  lines.push('<b>Risk Budget</b>');
  lines.push(`  Open risk: ${data.usedRiskPct.toFixed(1)}% of ${data.maxRiskPct}%`);
  lines.push(`  Positions: ${data.usedPositions}/${data.maxPositions}`);
  return lines;
}

function buildSessionBriefing(data: {
  session: 'UK' | 'US';
  time: string;
  regime: string;
  usedRiskPct: number;
  maxRiskPct: number;
  usedPositions: number;
  maxPositions: number;
  candidates: Array<{ ticker: string; price: number; entryTrigger: number; sleeve: string }>;
  earlyClose?: string;
}): string[] {
  const flag = data.session === 'UK' ? '🇬🇧' : '🇺🇸';
  const regimeEmoji = data.regime === 'BULLISH' ? '🟢' : '🟡';
  const lines = [
    `${flag} <b>${data.session} Pre-Session — ${data.time}</b>`,
    '',
  ];
  if (data.earlyClose) lines.push(`📅 <b>Early close today: ${data.earlyClose} ET</b>`, '');
  lines.push(`${regimeEmoji} Regime: ${data.regime} | Risk: ${data.usedRiskPct.toFixed(1)}%/${data.maxRiskPct}% | Slots: ${data.usedPositions}/${data.maxPositions}`);
  lines.push('');
  if (data.candidates.length > 0) {
    lines.push(`<b>${data.session} READY Candidates (${data.candidates.length})</b>`);
    for (const c of data.candidates) {
      const dist = ((c.entryTrigger - c.price) / c.price * 100).toFixed(1);
      lines.push(`  📌 ${c.ticker} [${c.sleeve}] — ${c.price.toFixed(2)} → trigger ${c.entryTrigger.toFixed(2)} (${dist}% away)`);
    }
  } else {
    lines.push(`No ${data.session} READY candidates from latest scan.`);
  }
  return lines;
}

describe('briefing message formatting', () => {
  describe('Monday briefing', () => {
    it('includes header with date', () => {
      const lines = buildMondayBriefing({
        date: '2026-04-27', regime: 'BULLISH', health: 'GREEN', operatingMode: 'NORMAL',
        equity: 5000, usedRiskPct: 2.5, maxRiskPct: 5.5, availableRiskPct: 3.0,
        usedPositions: 3, maxPositions: 5, openPositions: [], readyCandidates: [],
        isHoliday: false,
      });
      expect(lines[0]).toContain('Monday Pre-Trade Briefing');
      expect(lines[0]).toContain('2026-04-27');
    });

    it('shows holiday warning when applicable', () => {
      const lines = buildMondayBriefing({
        date: '2026-04-03', regime: 'BULLISH', health: 'GREEN', operatingMode: 'NORMAL',
        equity: 5000, usedRiskPct: 0, maxRiskPct: 5.5, availableRiskPct: 5.5,
        usedPositions: 0, maxPositions: 5, openPositions: [], readyCandidates: [],
        isHoliday: true, holidayLabel: 'Good Friday',
      });
      const text = lines.join('\n');
      expect(text).toContain('Market Holiday');
      expect(text).toContain('Good Friday');
    });

    it('shows early close warning', () => {
      const lines = buildMondayBriefing({
        date: '2026-11-27', regime: 'BULLISH', health: 'GREEN', operatingMode: 'NORMAL',
        equity: 5000, usedRiskPct: 0, maxRiskPct: 5.5, availableRiskPct: 5.5,
        usedPositions: 0, maxPositions: 5, openPositions: [], readyCandidates: [],
        isHoliday: false, earlyClose: '13:00',
      });
      expect(lines.join('\n')).toContain('Early close today');
    });

    it('includes regime and health emojis', () => {
      const lines = buildMondayBriefing({
        date: '2026-04-27', regime: 'BEARISH', health: 'RED', operatingMode: 'NORMAL',
        equity: 5000, usedRiskPct: 4, maxRiskPct: 5.5, availableRiskPct: 1.5,
        usedPositions: 4, maxPositions: 5, openPositions: [], readyCandidates: [],
        isHoliday: false,
      });
      const text = lines.join('\n');
      expect(text).toContain('🔴');
      expect(text).toContain('BEARISH');
    });

    it('shows risk budget numbers', () => {
      const lines = buildMondayBriefing({
        date: '2026-04-27', regime: 'BULLISH', health: 'GREEN', operatingMode: 'NORMAL',
        equity: 10000, usedRiskPct: 3.2, maxRiskPct: 5.5, availableRiskPct: 2.3,
        usedPositions: 3, maxPositions: 5, openPositions: [], readyCandidates: [],
        isHoliday: false,
      });
      const text = lines.join('\n');
      expect(text).toContain('3.2%');
      expect(text).toContain('5.5%');
      expect(text).toContain('3/5');
    });
  });

  describe('session briefing (UK/US)', () => {
    it('UK briefing uses GB flag', () => {
      const lines = buildSessionBriefing({
        session: 'UK', time: '08:00', regime: 'BULLISH',
        usedRiskPct: 2, maxRiskPct: 5.5, usedPositions: 2, maxPositions: 5,
        candidates: [],
      });
      expect(lines[0]).toContain('🇬🇧');
      expect(lines[0]).toContain('UK Pre-Session');
    });

    it('US briefing uses US flag', () => {
      const lines = buildSessionBriefing({
        session: 'US', time: '14:30', regime: 'BULLISH',
        usedRiskPct: 2, maxRiskPct: 5.5, usedPositions: 2, maxPositions: 5,
        candidates: [],
      });
      expect(lines[0]).toContain('🇺🇸');
      expect(lines[0]).toContain('US Pre-Session');
    });

    it('lists candidates with distance percentage', () => {
      const lines = buildSessionBriefing({
        session: 'UK', time: '08:00', regime: 'BULLISH',
        usedRiskPct: 2, maxRiskPct: 5.5, usedPositions: 2, maxPositions: 5,
        candidates: [
          { ticker: 'GSK.L', price: 1500, entryTrigger: 1520, sleeve: 'CORE' },
        ],
      });
      const text = lines.join('\n');
      expect(text).toContain('GSK.L');
      expect(text).toContain('CORE');
      expect(text).toContain('1500.00');
      expect(text).toContain('1520.00');
      expect(text).toContain('% away');
    });

    it('shows no-candidates message when empty', () => {
      const lines = buildSessionBriefing({
        session: 'US', time: '14:30', regime: 'SIDEWAYS',
        usedRiskPct: 5, maxRiskPct: 5.5, usedPositions: 5, maxPositions: 5,
        candidates: [],
      });
      expect(lines.join('\n')).toContain('No US READY candidates');
    });

    it('includes early-close warning for US', () => {
      const lines = buildSessionBriefing({
        session: 'US', time: '14:30', regime: 'BULLISH',
        usedRiskPct: 2, maxRiskPct: 5.5, usedPositions: 2, maxPositions: 5,
        candidates: [], earlyClose: '13:00',
      });
      expect(lines.join('\n')).toContain('Early close today');
    });
  });

  describe('weekly digest formatting', () => {
    function buildWeeklyDigest(data: {
      date: string;
      closedTrades: Array<{ ticker: string; realisedR: number }>;
      openedCount: number;
      weekPnl: number;
      equityChange: number | null;
      equityChangePct: number | null;
      currentEquity: number;
      grade: string;
      expectancy: number;
      winRate: number;
      totalTrades: number;
      openCount: number;
    }): string[] {
      const lines = [`📊 <b>Weekly Performance Digest — ${data.date}</b>`, ''];
      lines.push('<b>This Week</b>');
      lines.push(`  Opened: ${data.openedCount} | Closed: ${data.closedTrades.length}`);
      if (data.closedTrades.length > 0) {
        const wins = data.closedTrades.filter(t => t.realisedR > 0);
        const weekTotalR = data.closedTrades.reduce((sum, t) => sum + t.realisedR, 0);
        lines.push(`  Wins: ${wins.length} | Losses: ${data.closedTrades.length - wins.length} | Win rate: ${((wins.length / data.closedTrades.length) * 100).toFixed(0)}%`);
        lines.push(`  Total R: ${weekTotalR >= 0 ? '+' : ''}${weekTotalR.toFixed(1)}R`);
        lines.push(`  P&L: ${data.weekPnl >= 0 ? '+' : ''}£${data.weekPnl.toFixed(2)}`);
        lines.push('', '  <b>Closed trades:</b>');
        for (const t of data.closedTrades.slice(0, 8)) {
          lines.push(`  ${t.realisedR > 0 ? '✅' : '❌'} ${t.ticker}: ${t.realisedR >= 0 ? '+' : ''}${t.realisedR.toFixed(1)}R`);
        }
      }
      if (data.equityChange !== null) {
        lines.push('', '<b>Equity</b>');
        lines.push(`  Change: ${data.equityChange >= 0 ? '+' : '-'}£${Math.abs(data.equityChange).toFixed(2)} (${data.equityChangePct! >= 0 ? '+' : ''}${data.equityChangePct!.toFixed(1)}%)`);
      }
      lines.push('', '<b>All-Time System</b>');
      lines.push(`  Grade: ${data.grade} | Expectancy: ${data.expectancy >= 0 ? '+' : ''}${data.expectancy.toFixed(2)}R/trade`);
      lines.push(`  Win rate: ${data.winRate.toFixed(0)}% | Trades: ${data.totalTrades}`);
      lines.push('', `<b>Current:</b> ${data.openCount} open position(s)`);
      return lines;
    }

    it('includes header with date', () => {
      const lines = buildWeeklyDigest({
        date: '2026-04-26', closedTrades: [], openedCount: 0, weekPnl: 0,
        equityChange: null, equityChangePct: null, currentEquity: 5000,
        grade: 'B', expectancy: 0.25, winRate: 55, totalTrades: 20, openCount: 3,
      });
      expect(lines[0]).toContain('Weekly Performance Digest');
      expect(lines[0]).toContain('2026-04-26');
    });

    it('shows winning trades with check marks', () => {
      const lines = buildWeeklyDigest({
        date: '2026-04-26',
        closedTrades: [
          { ticker: 'AAPL', realisedR: 2.5 },
          { ticker: 'MSFT', realisedR: -0.8 },
        ],
        openedCount: 1, weekPnl: 85.50,
        equityChange: 85.50, equityChangePct: 1.7, currentEquity: 5085.50,
        grade: 'B', expectancy: 0.25, winRate: 55, totalTrades: 22, openCount: 4,
      });
      const text = lines.join('\n');
      expect(text).toContain('✅ AAPL: +2.5R');
      expect(text).toContain('❌ MSFT: -0.8R');
      expect(text).toContain('Win rate: 50%'); // 1 out of 2 this week
      expect(text).toContain('+£85.50');
    });

    it('shows equity change with percentage', () => {
      const lines = buildWeeklyDigest({
        date: '2026-04-26', closedTrades: [], openedCount: 0, weekPnl: 0,
        equityChange: -120, equityChangePct: -2.4, currentEquity: 4880,
        grade: 'C', expectancy: -0.1, winRate: 40, totalTrades: 15, openCount: 2,
      });
      const text = lines.join('\n');
      expect(text).toContain('-£120.00');
      expect(text).toContain('-2.4%');
    });

    it('shows system grade and expectancy', () => {
      const lines = buildWeeklyDigest({
        date: '2026-04-26', closedTrades: [], openedCount: 0, weekPnl: 0,
        equityChange: null, equityChangePct: null, currentEquity: 5000,
        grade: 'A', expectancy: 0.5, winRate: 60, totalTrades: 50, openCount: 5,
      });
      const text = lines.join('\n');
      expect(text).toContain('Grade: A');
      expect(text).toContain('+0.50R/trade');
      expect(text).toContain('60%');
      expect(text).toContain('5 open position(s)');
    });
  });
});
