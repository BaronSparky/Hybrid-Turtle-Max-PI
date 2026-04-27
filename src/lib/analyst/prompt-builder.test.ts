import { describe, expect, it } from 'vitest';
import {
  buildSystemSummaryPrompt,
  buildCandidateExplainPrompt,
  buildStopExplainPrompt,
  buildJournalDraftPrompt,
  buildNewsContextPrompt,
  buildTradePulseExplainPrompt,
  ANALYST_SYSTEM_PROMPT,
  type SystemSummaryData,
  type CandidateExplainData,
  type StopExplainData,
  type JournalDraftData,
  type NewsContextData,
  type TradePulseExplainData,
} from './prompt-builder';

// ── Test fixtures ──

const MOCK_SUMMARY_DATA: SystemSummaryData = {
  decision: 'BUY_ALLOWED',
  headline: 'Ready to trade',
  explanation: '2 candidates with triggers met',
  phase: 'EXECUTION',
  regime: 'BULLISH',
  operatingMode: 'NORMAL',
  healthOverall: 'GREEN',
  heartbeatAgeHours: 12,
  scanAgeHours: 2,
  openPositionCount: 3,
  maxPositions: 5,
  openRiskPct: 4.2,
  maxOpenRisk: 5.5,
  readyCandidateCount: 5,
  triggerMetCount: 2,
  stopsPending: 1,
  laggardCount: 0,
  pyramidCount: 0,
  killSwitchActive: false,
  autoTradingEnabled: true,
  t212Connected: true,
  dataStale: false,
  blockers: [],
  equity: 10000,
  riskProfile: 'BALANCED',
};

const MOCK_CANDIDATE_DATA: CandidateExplainData = {
  ticker: 'AAPL',
  name: 'Apple Inc',
  status: 'READY',
  price: 178.50,
  entryTrigger: 180.00,
  distancePercent: -0.83,
  sleeve: 'CORE',
  sector: 'Technology',
  cluster: 'US_TECH',
  adx: 28.5,
  atrPercent: 2.1,
  efficiency: 65,
  ma200: 165.30,
  riskPerShare: 3.50,
  positionSize: 28,
  bqs: 72,
  fws: 'AUTO_YES',
  ncs: 68,
  grade: 'B',
};

const MOCK_STOP_DATA: StopExplainData = {
  ticker: 'MSFT',
  entryPrice: 380.00,
  currentPrice: 395.50,
  currentStop: 380.00,
  initialRisk: 7.60,
  protectionLevel: 'BREAKEVEN',
  rMultiple: 2.04,
  atr: 5.20,
  stopHistory: [
    { date: '2026-04-25', oldStop: 372.40, newStop: 380.00, reason: 'R-based: 1.5R reached', level: 'BREAKEVEN' },
    { date: '2026-04-20', oldStop: 372.40, newStop: 372.40, reason: 'Initial stop set', level: 'INITIAL' },
  ],
};

const MOCK_JOURNAL_DATA: JournalDraftData = {
  ticker: 'NVDA',
  name: 'NVIDIA Corp',
  type: 'entry',
  entryPrice: 850.00,
  entryDate: '2026-04-22',
  currentPrice: 875.50,
  initialStop: 830.00,
  currentStop: 850.00,
  rMultiple: 1.28,
  protectionLevel: 'INITIAL',
  entryGrade: 'A',
  regime: 'BULLISH',
  scanStatus: 'READY',
  sleeve: 'CORE',
  sector: 'Technology',
  pnlPercent: 3.0,
  pnlAbsolute: 25.50,
  holdingDays: 4,
  outcome: 'OPEN',
};

// ── System prompt ──

describe('ANALYST_SYSTEM_PROMPT', () => {
  it('contains read-only constraints', () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain('read-only');
    expect(ANALYST_SYSTEM_PROMPT).toContain('NEVER');
  });

  it('forbids trade execution language', () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain('buy or sell');
    expect(ANALYST_SYSTEM_PROMPT).toContain('stop levels');
  });

  it('forbids data fabrication', () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain('Invent numbers');
  });

  it('includes advisory disclaimer instruction', () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain('advisory');
  });
});

// ── buildSystemSummaryPrompt ──

describe('buildSystemSummaryPrompt', () => {
  it('returns system prompt, user prompt, and context numbers', () => {
    const result = buildSystemSummaryPrompt(MOCK_SUMMARY_DATA);
    expect(result.system).toBe(ANALYST_SYSTEM_PROMPT);
    expect(result.prompt).toBeTruthy();
    expect(result.contextNumbers.length).toBeGreaterThan(0);
  });

  it('includes key data in the prompt', () => {
    const result = buildSystemSummaryPrompt(MOCK_SUMMARY_DATA);
    expect(result.prompt).toContain('BULLISH');
    expect(result.prompt).toContain('EXECUTION');
    expect(result.prompt).toContain('BUY_ALLOWED');
    expect(result.prompt).toContain('3');  // open positions
    expect(result.prompt).toContain('5');  // max positions
    expect(result.prompt).toContain('£10000');
  });

  it('includes blockers when present', () => {
    const dataWithBlockers = {
      ...MOCK_SUMMARY_DATA,
      blockers: [{ code: 'REGIME_BEARISH', label: 'Market is bearish', severity: 'hard' }],
    };
    const result = buildSystemSummaryPrompt(dataWithBlockers);
    expect(result.prompt).toContain('REGIME_BEARISH');
    expect(result.prompt).toContain('Market is bearish');
    expect(result.prompt).toContain('HARD');
  });

  it('does not leak sensitive data', () => {
    const dataWithSensitive = {
      ...MOCK_SUMMARY_DATA,
      headline: 'secret=mysecret123 token=abc123',
    };
    const result = buildSystemSummaryPrompt(dataWithSensitive);
    expect(result.prompt).not.toContain('mysecret123');
    expect(result.prompt).toContain('[REDACTED]');
  });

  it('tracks context numbers for fabrication checking', () => {
    const result = buildSystemSummaryPrompt(MOCK_SUMMARY_DATA);
    expect(result.contextNumbers).toContain(3);  // openPositionCount
    expect(result.contextNumbers).toContain(5);  // maxPositions
    expect(result.contextNumbers).toContain(10000); // equity
    expect(result.contextNumbers).toContain(4.2); // openRiskPct
  });
});

// ── buildCandidateExplainPrompt ──

describe('buildCandidateExplainPrompt', () => {
  it('includes ticker and status', () => {
    const result = buildCandidateExplainPrompt(MOCK_CANDIDATE_DATA);
    expect(result.prompt).toContain('AAPL');
    expect(result.prompt).toContain('Apple Inc');
    expect(result.prompt).toContain('READY');
  });

  it('includes technical indicators', () => {
    const result = buildCandidateExplainPrompt(MOCK_CANDIDATE_DATA);
    expect(result.prompt).toContain('28.5'); // ADX
    expect(result.prompt).toContain('2.1');  // ATR%
    expect(result.prompt).toContain('65');   // efficiency
  });

  it('includes scores', () => {
    const result = buildCandidateExplainPrompt(MOCK_CANDIDATE_DATA);
    expect(result.prompt).toContain('72');        // BQS
    expect(result.prompt).toContain('AUTO_YES');  // FWS
    expect(result.prompt).toContain('68');        // NCS
  });

  it('includes gate results when provided', () => {
    const dataWithGates = {
      ...MOCK_CANDIDATE_DATA,
      gateResults: [
        { gate: 'OPEN_RISK', passed: true },
        { gate: 'MAX_POSITIONS', passed: false, reason: 'At capacity' },
      ],
    };
    const result = buildCandidateExplainPrompt(dataWithGates);
    expect(result.prompt).toContain('OPEN_RISK');
    expect(result.prompt).toContain('PASS');
    expect(result.prompt).toContain('MAX_POSITIONS');
    expect(result.prompt).toContain('FAIL');
  });
});

// ── buildStopExplainPrompt ──

describe('buildStopExplainPrompt', () => {
  it('includes position details', () => {
    const result = buildStopExplainPrompt(MOCK_STOP_DATA);
    expect(result.prompt).toContain('MSFT');
    expect(result.prompt).toContain('380.00'); // entry
    expect(result.prompt).toContain('395.50'); // current
    expect(result.prompt).toContain('BREAKEVEN');
  });

  it('includes stop history', () => {
    const result = buildStopExplainPrompt(MOCK_STOP_DATA);
    expect(result.prompt).toContain('372.40');
    expect(result.prompt).toContain('380.00');
    expect(result.prompt).toContain('1.5R reached');
  });

  it('includes protection level ladder explanation', () => {
    const result = buildStopExplainPrompt(MOCK_STOP_DATA);
    expect(result.prompt).toContain('INITIAL');
    expect(result.prompt).toContain('BREAKEVEN');
    expect(result.prompt).toContain('LOCK_08R');
    expect(result.prompt).toContain('LOCK_1R_TRAIL');
  });

  it('includes R-multiple', () => {
    const result = buildStopExplainPrompt(MOCK_STOP_DATA);
    expect(result.prompt).toContain('2.04');
  });
});

// ── buildJournalDraftPrompt ──

describe('buildJournalDraftPrompt', () => {
  it('includes position data', () => {
    const result = buildJournalDraftPrompt(MOCK_JOURNAL_DATA);
    expect(result.prompt).toContain('NVDA');
    expect(result.prompt).toContain('NVIDIA Corp');
    expect(result.prompt).toContain('850.00');
    expect(result.prompt).toContain('875.50');
  });

  it('includes entry grade and regime', () => {
    const result = buildJournalDraftPrompt(MOCK_JOURNAL_DATA);
    expect(result.prompt).toContain('A');      // entry grade
    expect(result.prompt).toContain('BULLISH'); // regime
    expect(result.prompt).toContain('READY');   // scan status
  });

  it('includes performance metrics', () => {
    const result = buildJournalDraftPrompt(MOCK_JOURNAL_DATA);
    expect(result.prompt).toContain('3.0');   // pnlPercent
    expect(result.prompt).toContain('25.50'); // pnlAbsolute
    expect(result.prompt).toContain('4');     // holdingDays
  });

  it('requests correct journal type', () => {
    const result = buildJournalDraftPrompt(MOCK_JOURNAL_DATA);
    expect(result.prompt).toContain('entry journal');
  });

  it('switches to close journal type', () => {
    const closeData = { ...MOCK_JOURNAL_DATA, type: 'close' as const };
    const result = buildJournalDraftPrompt(closeData);
    expect(result.prompt).toContain('close journal');
  });

  it('switches to lesson journal type', () => {
    const lessonData = { ...MOCK_JOURNAL_DATA, type: 'lesson' as const };
    const result = buildJournalDraftPrompt(lessonData);
    expect(result.prompt).toContain('lessons learned');
  });
});

// ── buildNewsContextPrompt ──

const MOCK_NEWS_DATA: NewsContextData = {
  ticker: 'AAPL',
  name: 'Apple Inc',
  sleeve: 'CORE',
  scanStatus: 'READY',
  headlines: [
    { title: 'Apple reports record Q2', publisher: 'Reuters', publishedAt: '2026-04-27T10:00:00Z', ageHours: 2 },
  ],
  earnings: { nextEarningsDate: '2026-04-30T00:00:00Z', daysUntil: 3, isEstimate: false },
};

describe('buildNewsContextPrompt', () => {
  it('includes ticker and headlines', () => {
    const result = buildNewsContextPrompt(MOCK_NEWS_DATA);
    expect(result.prompt).toContain('AAPL');
    expect(result.prompt).toContain('Apple reports record Q2');
    expect(result.prompt).toContain('Reuters');
  });

  it('includes earnings date and days-until', () => {
    const result = buildNewsContextPrompt(MOCK_NEWS_DATA);
    expect(result.prompt).toContain('3 days');
  });

  it('uses analyst system prompt', () => {
    const result = buildNewsContextPrompt(MOCK_NEWS_DATA);
    expect(result.system).toBe(ANALYST_SYSTEM_PROMPT);
  });

  it('handles no headlines gracefully', () => {
    const noNews = { ...MOCK_NEWS_DATA, headlines: [] };
    const result = buildNewsContextPrompt(noNews);
    expect(result.prompt).toContain('no recent headlines');
  });
});

// ── buildTradePulseExplainPrompt ──

const MOCK_TRADE_PULSE_DATA: TradePulseExplainData = {
  ticker: 'MSFT',
  score: 72,
  grade: 'B',
  decision: 'CONDITIONAL',
  signals: [
    { name: 'Trend Strength', shortName: 'ADX', score: 85, weight: 0.25, status: 'POSITIVE', detail: 'Strong uptrend' },
    { name: 'Volume Profile', shortName: 'VOL', score: 40, weight: 0.15, status: 'NEUTRAL' },
  ],
  concerns: ['Volume below average'],
  opportunities: ['Strong ADX trend'],
  headlines: [{ title: 'Microsoft Cloud revenue surges', publisher: 'Bloomberg', ageHours: 5 }],
  earnings: { nextEarningsDate: '2026-05-15T00:00:00Z', daysUntil: 18, isEstimate: false },
};

describe('buildTradePulseExplainPrompt', () => {
  it('includes grade and score', () => {
    const result = buildTradePulseExplainPrompt(MOCK_TRADE_PULSE_DATA);
    expect(result.prompt).toContain('72');
    expect(result.prompt).toContain('B');
  });

  it('includes signal details sorted by weight', () => {
    const result = buildTradePulseExplainPrompt(MOCK_TRADE_PULSE_DATA);
    expect(result.prompt).toContain('ADX');
    expect(result.prompt).toContain('VOL');
    expect(result.prompt).toContain('25%');
  });

  it('includes concerns and opportunities', () => {
    const result = buildTradePulseExplainPrompt(MOCK_TRADE_PULSE_DATA);
    expect(result.prompt).toContain('Volume below average');
    expect(result.prompt).toContain('Strong ADX trend');
  });

  it('includes news headlines', () => {
    const result = buildTradePulseExplainPrompt(MOCK_TRADE_PULSE_DATA);
    expect(result.prompt).toContain('Microsoft Cloud revenue surges');
  });

  it('includes earnings date', () => {
    const result = buildTradePulseExplainPrompt(MOCK_TRADE_PULSE_DATA);
    expect(result.prompt).toContain('18 days');
  });

  it('includes sentiment when provided', () => {
    const dataWithSentiment: TradePulseExplainData = {
      ...MOCK_TRADE_PULSE_DATA,
      sentiment: { overall: 'POSITIVE', confidence: 'HIGH' },
    };
    const result = buildTradePulseExplainPrompt(dataWithSentiment);
    expect(result.prompt).toContain('POSITIVE');
    expect(result.prompt).toContain('confidence: HIGH');
  });

  it('shows not assessed when sentiment is omitted', () => {
    const result = buildTradePulseExplainPrompt(MOCK_TRADE_PULSE_DATA);
    expect(result.prompt).toContain('not assessed');
  });
});
