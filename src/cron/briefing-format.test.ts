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
});
