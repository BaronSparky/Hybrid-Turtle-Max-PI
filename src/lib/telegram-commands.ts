/**
 * DEPENDENCIES
 * Consumed by: /api/telegram/webhook/route.ts, /api/telegram/test-command/route.ts
 * Consumes: prisma.ts, market-data.ts, position-sizer.ts, risk-gates.ts, stop-manager.ts
 * Risk-sensitive: NO (read-only queries — never writes to DB or places orders)
 * Last modified: 2026-03-03
 * Notes: Inbound Telegram command handler. Completely separate from telegram.ts
 *        which handles outbound messages only. All responses use HTML parse mode.
 */

import prisma from '@/lib/prisma';
import { getBatchPrices, normalizeBatchPricesToGBP, getMarketRegime } from '@/lib/market-data';
import { calculateRMultiple } from '@/lib/position-sizer';
import { getRiskBudget } from '@/lib/risk-gates';
import { generateStopRecommendations, generateTrailingStopRecommendations } from '@/lib/stop-manager';
import type { RiskProfileType, Sleeve } from '@/types';

// ── Types ──

export type TelegramCommand =
  | '/status'
  | '/positions'
  | '/stopsdue'
  | '/regime'
  | '/risk'
  | '/candidates'
  | '/analyst'
  | '/ask'
  | '/news'
  | '/scorecard'
  | '/earnings'
  | '/help'
  | 'unknown';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number };
    chat: { id: number };
    text?: string;
    date: number;
  };
}

export interface CommandResponse {
  text: string;
  parseMode: 'HTML';
}

// ── Helpers ──

const DEFAULT_USER_ID = 'default-user';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function currencySymbol(currency: string | null): string {
  const c = (currency ?? 'USD').toUpperCase();
  if (c === 'GBP' || c === 'GBX') return '£';
  if (c === 'EUR') return '€';
  return '$';
}

function getPhaseForDay(day: number): string {
  switch (day) {
    case 0: return 'PLANNING';
    case 1: return 'OBSERVATION';
    case 2: return 'EXECUTION';
    default: return 'MAINTENANCE';
  }
}

// ── Command parsing ──

export function parseCommand(text: string): TelegramCommand {
  const cmd = text.trim().toLowerCase().split(/\s+/)[0];
  switch (cmd) {
    case '/status': return '/status';
    case '/positions': return '/positions';
    case '/stopsdue': return '/stopsdue';
    case '/regime': return '/regime';
    case '/risk': return '/risk';
    case '/candidates': return '/candidates';
    case '/analyst': return '/analyst';
    case '/ask': return '/ask';
    case '/news': return '/news';
    case '/scorecard': return '/scorecard';
    case '/earnings': return '/earnings';
    case '/help': case '/start': return '/help';
    default: return 'unknown';
  }
}

// ── Main handler ──

export async function handleCommand(command: TelegramCommand, rawText?: string): Promise<CommandResponse> {
  try {
    switch (command) {
      case '/status': return await cmdStatus();
      case '/positions': return await cmdPositions();
      case '/stopsdue': return await cmdStopsDue();
      case '/regime': return await cmdRegime();
      case '/risk': return await cmdRisk();
      case '/candidates': return await cmdCandidates();
      case '/analyst': return await cmdAnalyst();
      case '/ask': return await cmdAsk(rawText || '');
      case '/news': return await cmdNews(rawText || '');
      case '/scorecard': return await cmdScorecard();
      case '/earnings': return await cmdEarnings();
      case '/help': return cmdHelp();
      case 'unknown':
      default:
        return { text: '❓ Unknown command. Send /help for available commands.', parseMode: 'HTML' };
    }
  } catch (err) {
    console.error(`[telegram-commands] Error handling ${command}:`, err);
    return {
      text: '⚠️ Internal error processing command. Check the dashboard logs.',
      parseMode: 'HTML',
    };
  }
}

// ── /status ──

async function cmdStatus(): Promise<CommandResponse> {
  const now = new Date();
  const phase = getPhaseForDay(now.getDay());

  const [heartbeat, healthCheck, regime, posCount, scanResult] = await Promise.all([
    prisma.heartbeat.findFirst({ orderBy: { timestamp: 'desc' } }),
    prisma.healthCheck.findFirst({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    }),
    getMarketRegime().catch(() => 'SIDEWAYS' as const),
    prisma.position.count({ where: { userId: DEFAULT_USER_ID, status: 'OPEN' } }),
    prisma.scan.findFirst({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { runDate: 'desc' },
      include: { results: { where: { status: 'READY' }, select: { id: true } } },
    }),
  ]);

  const healthEmoji = healthCheck?.overall === 'GREEN' ? '🟢'
    : healthCheck?.overall === 'YELLOW' ? '🟡' : '🔴';
  const heartbeatAge = heartbeat
    ? Math.round((now.getTime() - heartbeat.timestamp.getTime()) / (1000 * 60 * 60))
    : null;
  const heartbeatStr = heartbeatAge !== null
    ? `${heartbeatAge}h ago ${heartbeat?.status === 'OK' ? '✓' : '⚠️'}`
    : 'Never';

  // Quick stop count
  let stopsCount = 0;
  try {
    const positions = await prisma.position.findMany({
      where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
      include: { stock: { select: { ticker: true } } },
    });
    const tickers = positions.map((p) => p.stock.ticker);
    if (tickers.length > 0) {
      const livePrices = await getBatchPrices(tickers);
      const priceMap = new Map(Object.entries(livePrices));
      const recs = await generateStopRecommendations(DEFAULT_USER_ID, priceMap).catch(() => []);
      const trailing = await generateTrailingStopRecommendations(DEFAULT_USER_ID).catch(() => []);
      // Merge — same logic as /api/stops
      const merged = new Map<string, number>();
      for (const r of recs) merged.set(r.positionId, r.newStop);
      for (const r of trailing) {
        const existing = merged.get(r.positionId);
        if (!existing || r.trailingStop > existing) merged.set(r.positionId, r.trailingStop);
      }
      stopsCount = merged.size;
    }
  } catch { /* best-effort */ }

  const readyCount = scanResult?.results.length ?? 0;

  const text = `${healthEmoji} <b>HybridTurtle Status</b>
Phase: ${phase}
Regime: <b>${regime}</b>
Last nightly: ${heartbeatStr}
Health: ${healthCheck?.overall ?? 'UNKNOWN'}
Open positions: ${posCount}
Stops pending: ${stopsCount}
Ready candidates: ${readyCount}`;

  return { text, parseMode: 'HTML' };
}

// ── /positions ──

async function cmdPositions(): Promise<CommandResponse> {
  const positions = await prisma.position.findMany({
    where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
    include: { stock: { select: { ticker: true, currency: true, sleeve: true } } },
  });

  if (positions.length === 0) {
    return { text: '📊 <b>Open Positions</b>\nNo open positions.', parseMode: 'HTML' };
  }

  const tickers = positions.map((p) => p.stock.ticker);
  const livePrices = await getBatchPrices(tickers);

  const lines = positions.map((p) => {
    const price = livePrices[p.stock.ticker] ?? p.entryPrice;
    const rMul = calculateRMultiple(price, p.entryPrice, p.initialRisk);
    const rLabel = rMul >= 0 ? `+${rMul.toFixed(1)}R` : `${rMul.toFixed(1)}R`;
    const levelEmoji = p.protectionLevel === 'LOCK_1R_TRAIL' ? '🟢'
      : p.protectionLevel === 'LOCK_08R' ? '🔵'
      : p.protectionLevel === 'BREAKEVEN' ? '🟡' : '⚪';
    const sym = currencySymbol(p.stock.currency);
    return `${levelEmoji} <b>${escapeHtml(p.stock.ticker)}</b>  ${rLabel}  ${p.protectionLevel ?? 'INITIAL'}  Stop: ${sym}${p.currentStop.toFixed(2)}`;
  });

  // Total open risk
  const user = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_ID },
    select: { equity: true, riskProfile: true },
  });
  let riskLine = '';
  if (user) {
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) { stockCurrencies[p.stock.ticker] = p.stock.currency; }
    const gbpPrices = await normalizeBatchPricesToGBP(livePrices, stockCurrencies);
    const enriched = positions.map((p) => {
      const rawPrice = livePrices[p.stock.ticker] ?? p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
      const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
      return {
        id: p.id, ticker: p.stock.ticker, sleeve: p.stock.sleeve as Sleeve,
        sector: 'X', cluster: 'X', value: gbpPrice * p.shares,
        riskDollars: Math.max(0, (gbpPrice - p.currentStop * fxRatio) * p.shares),
        shares: p.shares, entryPrice: p.entryPrice, currentStop: p.currentStop, currentPrice: rawPrice,
      };
    });
    const budget = getRiskBudget(enriched, user.equity, user.riskProfile as RiskProfileType);
    riskLine = `\nTotal open risk: ${budget.usedRiskPercent.toFixed(1)}%`;
  }

  return {
    text: `📊 <b>Open Positions (${positions.length})</b>\n${lines.join('\n')}${riskLine}`,
    parseMode: 'HTML',
  };
}

// ── /stopsdue ──

async function cmdStopsDue(): Promise<CommandResponse> {
  const positions = await prisma.position.findMany({
    where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
    include: { stock: { select: { ticker: true, currency: true } } },
  });

  if (positions.length === 0) {
    return { text: '🔔 <b>Stops Due</b>\nNo open positions.', parseMode: 'HTML' };
  }

  const tickers = positions.map((p) => p.stock.ticker);
  const livePrices = await getBatchPrices(tickers);
  const priceMap = new Map(Object.entries(livePrices));

  const rBasedRecs = await generateStopRecommendations(DEFAULT_USER_ID, priceMap).catch(() => []);
  const trailingRecs = await generateTrailingStopRecommendations(DEFAULT_USER_ID).catch(() => []);

  // Merge — keep highest per position
  const merged = new Map<string, { ticker: string; currentStop: number; newStop: number; level: string; currency: string }>();
  for (const r of rBasedRecs) {
    const pos = positions.find((p) => p.id === r.positionId);
    merged.set(r.positionId, {
      ticker: r.ticker, currentStop: r.currentStop, newStop: r.newStop,
      level: r.newLevel, currency: pos?.stock.currency ?? 'USD',
    });
  }
  for (const r of trailingRecs) {
    const existing = merged.get(r.positionId);
    if (!existing || r.trailingStop > existing.newStop) {
      merged.set(r.positionId, {
        ticker: r.ticker, currentStop: r.currentStop, newStop: r.trailingStop,
        level: 'TRAILING_ATR', currency: r.priceCurrency,
      });
    }
  }

  if (merged.size === 0) {
    return { text: '🔔 <b>Stops Due</b>\n✅ All stops up to date.', parseMode: 'HTML' };
  }

  const lines = Array.from(merged.values()).map((r) => {
    const sym = currencySymbol(r.currency);
    return `${escapeHtml(r.ticker)}: Move stop ${sym}${r.currentStop.toFixed(2)} → ${sym}${r.newStop.toFixed(2)} (${r.level})`;
  });

  return {
    text: `🔔 <b>Stops Due (${merged.size})</b>\n${lines.join('\n')}\n\n<i>Apply stops in the dashboard → /portfolio/positions</i>`,
    parseMode: 'HTML',
  };
}

// ── /regime ──

async function cmdRegime(): Promise<CommandResponse> {
  const regime = await getMarketRegime().catch(() => 'SIDEWAYS' as const);

  // Fear & Greed — best-effort from last known store value
  // (Not easily available server-side without an extra fetch, so omit if not cached)

  const text = `📈 <b>Market Regime</b>
Overall: <b>${regime}</b>

<i>Dual benchmark: SPY + VWRL must both be bullish for BULLISH confirmation. 3-day stability required.</i>`;

  return { text, parseMode: 'HTML' };
}

// ── /risk ──

async function cmdRisk(): Promise<CommandResponse> {
  const user = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_ID },
    select: { equity: true, riskProfile: true },
  });

  if (!user) {
    return { text: '💰 <b>Risk Budget</b>\nUser not found.', parseMode: 'HTML' };
  }

  const positions = await prisma.position.findMany({
    where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
    include: { stock: true },
  });

  const tickers = positions.map((p) => p.stock.ticker);
  const livePrices = tickers.length > 0 ? await getBatchPrices(tickers) : {};
  const stockCurrencies: Record<string, string | null> = {};
  for (const p of positions) { stockCurrencies[p.stock.ticker] = p.stock.currency; }
  const gbpPrices = tickers.length > 0
    ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
    : {};

  const enriched = positions.map((p) => {
    const rawPrice = livePrices[p.stock.ticker] ?? p.entryPrice;
    const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
    const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
    return {
      id: p.id, ticker: p.stock.ticker, sleeve: p.stock.sleeve as Sleeve,
      sector: p.stock.sector ?? 'X', cluster: p.stock.cluster ?? 'X',
      value: gbpPrice * p.shares,
      riskDollars: Math.max(0, (gbpPrice - p.currentStop * fxRatio) * p.shares),
      shares: p.shares, entryPrice: p.entryPrice, currentStop: p.currentStop, currentPrice: rawPrice,
    };
  });

  const budget = getRiskBudget(enriched, user.equity, user.riskProfile as RiskProfileType);

  const sleeveLines = Object.entries(budget.sleeveUtilization)
    .filter(([sleeve]) => sleeve !== 'HEDGE')
    .map(([sleeve, { used, max }]) => `  ${sleeve}: ${used.toFixed(0)}% / ${max.toFixed(0)}%`)
    .join('\n');

  const text = `💰 <b>Risk Budget</b>
Profile: ${user.riskProfile}
Open risk: ${budget.usedRiskPercent.toFixed(1)}% / ${budget.maxRiskPercent.toFixed(1)}%
Positions: ${budget.usedPositions} / ${budget.maxPositions} max
Sleeve usage:
${sleeveLines}`;

  return { text, parseMode: 'HTML' };
}

// ── /candidates ──

async function cmdCandidates(): Promise<CommandResponse> {
  // Use snapshot data for candidates (same source as cross-ref)
  const latestSnapshot = await prisma.snapshot.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });

  if (!latestSnapshot) {
    return { text: '🎯 <b>Ready Candidates</b>\nNo snapshot data. Run the nightly pipeline first.', parseMode: 'HTML' };
  }

  const heldTickers = new Set(
    (await prisma.position.findMany({
      where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
      select: { stock: { select: { ticker: true } } },
    })).map((p) => p.stock.ticker)
  );

  const candidates = await prisma.snapshotTicker.findMany({
    where: {
      snapshotId: latestSnapshot.id,
      status: { in: ['READY', 'WATCH'] },
    },
    orderBy: { distanceTo20dHighPct: 'asc' },
    take: 20,
  });

  // Filter: not held, trigger met, ADX ok
  const ready = candidates
    .filter((r) => !heldTickers.has(r.ticker) && r.close >= r.entryTrigger && r.entryTrigger > 0 && r.adx14 >= 20)
    .slice(0, 5);

  if (ready.length === 0) {
    const ageHours = Math.round((Date.now() - latestSnapshot.createdAt.getTime()) / (1000 * 60 * 60));
    return {
      text: `🎯 <b>Ready Candidates</b>\nNo trigger-met candidates.\nLast snapshot: ${ageHours}h ago`,
      parseMode: 'HTML',
    };
  }

  const lines = ready.map((r) => {
    const sym = currencySymbol(r.currency);
    return `<b>${escapeHtml(r.ticker)}</b>  ${sym}${r.close.toFixed(2)}  ADX: ${r.adx14.toFixed(0)}  Stop: ${sym}${r.stopLevel.toFixed(2)}`;
  });

  const ageHours = Math.round((Date.now() - latestSnapshot.createdAt.getTime()) / (1000 * 60 * 60));

  return {
    text: `🎯 <b>Ready Candidates (${ready.length})</b>\n${lines.join('\n')}\nLast snapshot: ${ageHours}h ago`,
    parseMode: 'HTML',
  };
}

// ── /help ──

function cmdHelp(): CommandResponse {
  return {
    text: `🐢 <b>HybridTurtle Commands</b>
/status — system overview
/positions — open positions
/stopsdue — pending stop updates
/regime — market regime detail
/risk — risk budget
/candidates — ready candidates
/analyst — AI system summary (Ollama)
/ask &lt;question&gt; — ask the AI analyst
/news &lt;ticker&gt; — news &amp; earnings check
/scorecard — filter performance summary
/earnings — earnings calendar for holdings
/help — this message`,
    parseMode: 'HTML',
  };
}

// ── /analyst — AI system summary via Ollama ──

async function cmdAnalyst(): Promise<CommandResponse> {
  try {
    const { generateSystemSummary } = await import('@/lib/analyst/analyst-service');
    const { gatherSystemData } = await import('@/lib/analyst/gather-system-data');
    const { checkOllamaHealth } = await import('@/lib/analyst/ollama-client');

    // Quick health check first
    const health = await checkOllamaHealth();
    if (!health.available) {
      return {
        text: '🤖 <b>AI Analyst</b>\n\n⚠️ Ollama is not running. Start it with <code>ollama serve</code> to enable AI summaries.',
        parseMode: 'HTML',
      };
    }

    const summaryData = await gatherSystemData(DEFAULT_USER_ID);
    const result = await generateSystemSummary(summaryData);

    if (!result.available || !result.response) {
      return {
        text: '🤖 <b>AI Analyst</b>\n\n⚠️ Could not generate summary. Ollama may be loading — try again in a moment.',
        parseMode: 'HTML',
      };
    }

    // Strip markdown bold/italic for Telegram HTML and convert
    const cleaned = escapeHtml(
      result.response.replace(/^⚠️ \*\*Advisory only\*\*.*\n\n/m, '')
    )
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>');

    const header = `🤖 <b>AI Analyst</b> (${escapeHtml(result.model || 'unknown')}, ${((result.durationMs || 0) / 1000).toFixed(0)}s)\n<i>Advisory only — verify against dashboard</i>\n\n`;

    return {
      text: header + cleaned,
      parseMode: 'HTML',
    };
  } catch (err) {
    console.error('[telegram-commands] /analyst error:', err);
    return {
      text: '🤖 <b>AI Analyst</b>\n\n⚠️ Error generating summary. Check dashboard logs.',
      parseMode: 'HTML',
    };
  }
}

// ── /ask <question> — ask the AI analyst a question ──

async function cmdAsk(rawText: string): Promise<CommandResponse> {
  // Extract question after "/ask "
  const question = rawText.replace(/^\/ask\s*/i, '').trim();
  if (!question) {
    return {
      text: '🤖 <b>AI Analyst</b>\n\nUsage: <code>/ask your question here</code>\n\nExample: <code>/ask why are my trades blocked?</code>',
      parseMode: 'HTML',
    };
  }

  try {
    const { checkOllamaHealth, ollamaGenerate } = await import('@/lib/analyst/ollama-client');
    const { ANALYST_SYSTEM_PROMPT } = await import('@/lib/analyst/prompt-builder');
    const { gatherSystemData } = await import('@/lib/analyst/gather-system-data');
    const { checkResponseSafety } = await import('@/lib/analyst/safety-filter');
    const { stripSensitiveData } = await import('@/lib/analyst/safety-filter');

    const health = await checkOllamaHealth();
    if (!health.available || !health.selectedModel) {
      return {
        text: '🤖 <b>AI Analyst</b>\n\n⚠️ Ollama is not running. Start it with <code>ollama serve</code>.',
        parseMode: 'HTML',
      };
    }

    // Gather current system state as context
    const data = await gatherSystemData(DEFAULT_USER_ID);

    const contextBlock = stripSensitiveData(`Current System State:
- Phase: ${data.phase} | Regime: ${data.regime} | Mode: ${data.operatingMode}
- Health: ${data.healthOverall} | Equity: £${data.equity?.toFixed(0) || 'unknown'}
- Positions: ${data.openPositionCount}/${data.maxPositions} | Risk: ${data.openRiskPct.toFixed(1)}%/${data.maxOpenRisk}%
- Ready candidates: ${data.readyCandidateCount} | Triggers met: ${data.triggerMetCount}
- Stops pending: ${data.stopsPending} | Data stale: ${data.dataStale ? 'YES' : 'no'}
- Blockers: ${data.blockers.length > 0 ? data.blockers.map(b => b.label).join(', ') : 'none'}`);

    const prompt = `${contextBlock}\n\nUser question: ${question}\n\nAnswer the question based only on the system state above. Be concise (2-3 sentences). If the question is not about the trading system, politely redirect.`;

    const result = await ollamaGenerate({
      model: health.selectedModel,
      system: ANALYST_SYSTEM_PROMPT,
      prompt,
      options: { temperature: 0.3, num_predict: 200, num_ctx: 4096 },
    });

    if (!result || !result.response) {
      return {
        text: '🤖 <b>AI Analyst</b>\n\n⚠️ No response from model. It may be loading — try again shortly.',
        parseMode: 'HTML',
      };
    }

    // Safety check
    const safety = checkResponseSafety(result.response);
    const answer = escapeHtml(
      safety.cleaned.replace(/^⚠️ \*\*Advisory only\*\*.*\n\n/m, '')
    )
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>');

    const header = `🤖 <b>AI Analyst</b> (${escapeHtml(health.selectedModel)})\n<i>Advisory only — verify against dashboard</i>\n\n<b>Q:</b> ${escapeHtml(question)}\n\n`;

    return {
      text: header + answer,
      parseMode: 'HTML',
    };
  } catch (err) {
    console.error('[telegram-commands] /ask error:', err);
    return {
      text: '🤖 <b>AI Analyst</b>\n\n⚠️ Error processing question. Check dashboard logs.',
      parseMode: 'HTML',
    };
  }
}

// ── /news <ticker> — news headlines + earnings calendar + optional AI review ──

async function cmdNews(rawText: string): Promise<CommandResponse> {
  const ticker = rawText.replace(/^\/news\s*/i, '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
    return {
      text: '📰 <b>News &amp; Catalyst Check</b>\n\nUsage: <code>/news AAPL</code>\n\nReturns recent headlines and next earnings date for a ticker.',
      parseMode: 'HTML',
    };
  }

  try {
    const { fetchNewsContext } = await import('@/lib/analyst/news-fetcher');

    const news = await fetchNewsContext(ticker, 5);

    // Earnings section
    let earningsLine: string;
    if (news.earnings.nextEarningsDate) {
      const dateStr = new Date(news.earnings.nextEarningsDate).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      const warn = (news.earnings.daysUntil ?? 99) <= 10 ? ' ⚠️ EVENT RISK' : '';
      const est = news.earnings.isEstimate ? ' (estimated)' : '';
      earningsLine = `📅 Earnings: <b>${dateStr}</b> (${news.earnings.daysUntil} days)${warn}${est}`;
    } else {
      earningsLine = '📅 Earnings: not announced';
    }

    // Headlines section
    let headlinesBlock: string;
    if (news.headlines.length > 0) {
      headlinesBlock = news.headlines.map((h) => {
        const age = h.ageHours < 1 ? '<1h' : `${Math.round(h.ageHours)}h`;
        return `• ${escapeHtml(h.title)}\n  <i>${escapeHtml(h.publisher)}, ${age} ago</i>`;
      }).join('\n');
    } else {
      headlinesBlock = '<i>No recent headlines</i>';
    }

    // Optional LLM summary
    let summaryBlock = '';
    try {
      const { checkOllamaHealth } = await import('@/lib/analyst/ollama-client');
      const health = await checkOllamaHealth();
      if (health.available) {
        const { generateNewsContextSummary } = await import('@/lib/analyst/analyst-service');
        const result = await generateNewsContextSummary({
          ticker,
          headlines: news.headlines.map(h => ({
            title: h.title,
            publisher: h.publisher,
            publishedAt: h.publishedAt,
            ageHours: h.ageHours,
          })),
          earnings: news.earnings,
        });
        if (result.available && result.response) {
          const cleaned = escapeHtml(
            result.response.replace(/^⚠️ \*\*Advisory only\*\*.*\n\n/m, '')
          )
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.+?)\*/g, '<i>$1</i>');
          summaryBlock = `\n\n🤖 <b>AI Review</b> (${escapeHtml(result.model || 'unknown')})\n${cleaned}`;
        }
      }
    } catch {
      // LLM summary is best-effort — skip if Ollama is offline
    }

    const warningsLine = news.warnings.length > 0
      ? `\n\n⚠️ ${escapeHtml(news.warnings.join('; '))}`
      : '';

    return {
      text: `📰 <b>News: ${escapeHtml(ticker)}</b>\n\n${earningsLine}\n\n<b>Headlines</b>\n${headlinesBlock}${summaryBlock}${warningsLine}\n\n<i>Advisory only — verify before acting</i>`,
      parseMode: 'HTML',
    };
  } catch (err) {
    console.error(`[telegram-commands] /news error for ${ticker}:`, err);
    return {
      text: `📰 <b>News: ${escapeHtml(ticker)}</b>\n\n⚠️ Error fetching news. Yahoo may be unreachable.`,
      parseMode: 'HTML',
    };
  }
}

// ── /scorecard — filter performance summary ──

async function cmdScorecard(): Promise<CommandResponse> {
  try {
    const res = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/analytics/filter-scorecard`);
    if (!res.ok) {
      return {
        text: '📊 <b>Filter Scorecard</b>\n\n⚠️ Could not load scorecard data.',
        parseMode: 'HTML',
      };
    }

    const data = await res.json() as {
      totalCandidates: number;
      totalEnriched: number;
      filters: Array<{
        rule: string;
        passRate: number;
        passed: { avgFwd20d: number | null; hit1RRate: number | null; stopHitRate: number | null };
        blocked: { avgFwd20d: number | null; hit1RRate: number | null; stopHitRate: number | null };
      }>;
    };

    if (!data.filters?.length) {
      return {
        text: '📊 <b>Filter Scorecard</b>\n\nNo filter data available. Run a scan and wait for enrichment.',
        parseMode: 'HTML',
      };
    }

    const fmtPct = (v: number | null) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
    const fmtRate = (v: number | null) => v != null ? `${v.toFixed(0)}%` : '—';

    const lines = data.filters.slice(0, 8).map(f => {
      const passedBetter = (f.passed.avgFwd20d ?? -99) > (f.blocked.avgFwd20d ?? -99);
      const icon = passedBetter ? '✅' : '⚠️';
      return `${icon} <b>${escapeHtml(f.rule)}</b> (${f.passRate.toFixed(0)}% pass)\n   Passed: fwd20d ${fmtPct(f.passed.avgFwd20d)}, 1R ${fmtRate(f.passed.hit1RRate)}\n   Blocked: fwd20d ${fmtPct(f.blocked.avgFwd20d)}, 1R ${fmtRate(f.blocked.hit1RRate)}`;
    });

    return {
      text: `📊 <b>Filter Scorecard</b>\n${data.totalCandidates} candidates, ${data.totalEnriched} enriched\n\n${lines.join('\n\n')}\n\n<i>✅ = filter improves outcomes, ⚠️ = may need review</i>`,
      parseMode: 'HTML',
    };
  } catch (err) {
    console.error('[telegram-commands] /scorecard error:', err);
    return {
      text: '📊 <b>Filter Scorecard</b>\n\n⚠️ Error loading scorecard. Check dashboard.',
      parseMode: 'HTML',
    };
  }
}

// ── /earnings — earnings calendar for all open positions ──

async function cmdEarnings(): Promise<CommandResponse> {
  try {
    const positions = await prisma.position.findMany({
      where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
      select: { stock: { select: { ticker: true } } },
    });

    if (positions.length === 0) {
      return {
        text: '📅 <b>Earnings Calendar</b>\n\nNo open positions to check.',
        parseMode: 'HTML',
      };
    }

    const tickers = positions.map(p => p.stock.ticker);
    const { fetchBatchNewsContext } = await import('@/lib/analyst/news-fetcher');
    const results = await fetchBatchNewsContext(tickers, 0); // 0 headlines — only earnings

    const lines: string[] = [];
    const alerts: string[] = [];

    for (const r of results) {
      if (r.earnings.nextEarningsDate) {
        const dateStr = new Date(r.earnings.nextEarningsDate).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short',
        });
        const days = r.earnings.daysUntil ?? 99;
        const warn = days <= 5 ? ' ⚠️' : days <= 10 ? ' ⏰' : '';
        const est = r.earnings.isEstimate ? ' (est)' : '';
        lines.push(`${warn ? warn + ' ' : ''}  <b>${escapeHtml(r.ticker)}</b>: ${dateStr} (${days}d)${est}`);
        if (days <= 5) alerts.push(r.ticker);
      } else {
        lines.push(`  <b>${escapeHtml(r.ticker)}</b>: no date announced`);
      }
    }

    // Sort by days-until (soonest first)
    lines.sort();

    const alertLine = alerts.length > 0
      ? `\n\n🔴 <b>Event Risk:</b> ${alerts.join(', ')} — earnings within 5 days`
      : '';

    return {
      text: `📅 <b>Earnings Calendar</b> (${tickers.length} positions)\n\n${lines.join('\n')}${alertLine}`,
      parseMode: 'HTML',
    };
  } catch (err) {
    console.error('[telegram-commands] /earnings error:', err);
    return {
      text: '📅 <b>Earnings Calendar</b>\n\n⚠️ Error checking earnings. Yahoo may be unreachable.',
      parseMode: 'HTML',
    };
  }
}
