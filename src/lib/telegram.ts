/**
 * DEPENDENCIES
 * Consumed by: src/lib/alert-service.ts, nightly automation, Telegram API routes
 * Consumes: src/lib/prisma.ts
 * Risk-sensitive: NO — delivery only
 * Last modified: 2026-03-09
 * Notes: Telegram delivery uses env vars first, then default-user DB credentials as fallback.
 */
// ============================================================
// Telegram Bot Integration
// ============================================================

import prisma from '@/lib/prisma';
import { decryptField } from '@/lib/crypto';

interface TelegramMessage {
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

/**
 * Escape HTML special characters for Telegram parse_mode=HTML
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send a message via Telegram Bot API.
 * Automatically splits messages longer than 4096 characters.
 */
export async function sendTelegramMessage(message: TelegramMessage): Promise<boolean> {
  const credentials = await getTelegramCredentials();
  if (!credentials) {
    console.warn('Telegram credentials not configured');
    return false;
  }

  const MAX_LEN = 4096;
  const chunks: string[] = [];

  if (message.text.length <= MAX_LEN) {
    chunks.push(message.text);
  } else {
    // Split on newline boundaries to avoid breaking HTML tags
    let remaining = message.text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      // Find last newline within limit
      let splitIdx = remaining.lastIndexOf('\n', MAX_LEN);
      if (splitIdx <= 0) splitIdx = MAX_LEN; // fallback: hard split
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx + 1);
    }
  }

  try {
    for (const chunk of chunks) {
      const response = await fetch(
        `https://api.telegram.org/bot${credentials.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: credentials.chatId,
            text: chunk,
            parse_mode: message.parseMode || 'HTML',
            disable_web_page_preview: true,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        console.error('Telegram API error:', error);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return false;
  }
}

// ----------------------------------------------------------------
// Throttled alerts — suppress duplicate alerts within a TTL window
// ----------------------------------------------------------------

import { promises as fs } from 'fs';
import path from 'path';

const ALERT_THROTTLE_FILE = path.resolve(process.cwd(), 'data', 'alert-throttle.json');
const DEFAULT_ALERT_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ThrottleStore {
  [dedupeKey: string]: number; // last-sent epoch ms
}

/**
 * Pure: should an alert with this key be sent given current store state?
 * Exported for testing.
 */
export function shouldSendThrottledAlert(
  store: ThrottleStore,
  dedupeKey: string,
  nowMs: number,
  ttlMs: number
): boolean {
  const last = store[dedupeKey];
  if (!last) return true;
  return nowMs - last >= ttlMs;
}

/**
 * Pure: build a pruned store containing the just-sent key plus any
 * other entries still within their TTL window. Exported for testing.
 */
export function pruneThrottleStore(
  store: ThrottleStore,
  dedupeKey: string,
  nowMs: number,
  ttlMs: number
): ThrottleStore {
  const pruned: ThrottleStore = { [dedupeKey]: nowMs };
  for (const [key, ts] of Object.entries(store)) {
    if (key !== dedupeKey && nowMs - ts < ttlMs) pruned[key] = ts;
  }
  return pruned;
}

async function readThrottleStore(): Promise<ThrottleStore> {
  try {
    const raw = await fs.readFile(ALERT_THROTTLE_FILE, 'utf-8');
    return JSON.parse(raw) as ThrottleStore;
  } catch {
    return {};
  }
}

async function writeThrottleStore(store: ThrottleStore): Promise<void> {
  await fs.mkdir(path.dirname(ALERT_THROTTLE_FILE), { recursive: true });
  await fs.writeFile(ALERT_THROTTLE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Send a Telegram alert with deduplication. If an alert with the same
 * dedupeKey was sent within ttlMs, this call is suppressed and returns false.
 * Useful for cron-driven alerts (e.g. watchdog) that would otherwise spam.
 */
export async function sendThrottledTelegramAlert(
  message: TelegramMessage,
  dedupeKey: string,
  ttlMs: number = DEFAULT_ALERT_TTL_MS
): Promise<boolean> {
  const store = await readThrottleStore();
  const now = Date.now();

  if (!shouldSendThrottledAlert(store, dedupeKey, now, ttlMs)) {
    return false; // suppressed within window
  }

  const sent = await sendTelegramMessage(message);
  if (sent) {
    await writeThrottleStore(pruneThrottleStore(store, dedupeKey, now, ttlMs));
  }
  return sent;
}

async function getTelegramCredentials(): Promise<{ botToken: string; chatId: string } | null> {
  const envBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const envChatId = process.env.TELEGRAM_CHAT_ID;
  if (envBotToken && envChatId) {
    return { botToken: envBotToken, chatId: envChatId };
  }

  const user = await prisma.user.findUnique({
    where: { id: 'default-user' },
    select: { telegramBotToken: true, telegramChatId: true },
  });

  if (!user?.telegramBotToken || !user.telegramChatId) {
    return null;
  }

  // Decrypt in case the values are encrypted (M2). decryptField is a
  // pass-through for plaintext, so legacy rows still work. Any malformed
  // ciphertext makes the credentials unusable — surface as null so the
  // caller treats Telegram as unconfigured rather than throwing.
  try {
    return {
      botToken: decryptField(user.telegramBotToken),
      chatId: decryptField(user.telegramChatId),
    };
  } catch (err) {
    console.warn('[telegram] credential decrypt failed:', (err as Error).message);
    return null;
  }
}

/**
 * Position detail for the nightly Telegram message
 */
export interface NightlyPositionDetail {
  ticker: string;
  sleeve: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  currentStop: number;
  protectionLevel: string;
  rMultiple: number;
  pnl: number;
  pnlPercent: number;
  currency: string;
}

/**
 * Stop change detail for the nightly Telegram message
 */
export interface NightlyStopChange {
  ticker: string;
  oldStop: number;
  newStop: number;
  level: string;
  reason: string;
  currency: string;
}

/**
 * Laggard / dead-money alert for the nightly Telegram message
 */
export interface NightlyLaggardAlert {
  ticker: string;
  daysHeld: number;
  rMultiple: number;
  lossPct: number;
  flag: 'TRIM_LAGGARD' | 'DEAD_MONEY';
  reason: string;
  currency: string;
}

/**
 * Climax top signal for the nightly Telegram message
 */
export interface NightlyClimaxAlert {
  ticker: string;
  priceAboveMa20Pct: number;
  volumeRatio: number;
  action: 'TRIM' | 'TIGHTEN' | 'NONE';
  reason: string;
}

/**
 * Swap suggestion for the nightly Telegram message
 */
export interface NightlySwapAlert {
  cluster: string;
  weakTicker: string;
  weakRMultiple: number;
  strongTicker: string;
  reason: string;
}

/**
 * Whipsaw block for the nightly Telegram message
 */
export interface NightlyWhipsawAlert {
  ticker: string;
  stopsInLast30Days: number;
  reason: string;
}

/**
 * Breadth safety for the nightly Telegram message
 */
export interface NightlyBreadthAlert {
  breadthPct: number;
  isRestricted: boolean;
  maxPositionsOverride: number | null;
  reason: string;
}

/**
 * Momentum expansion for the nightly Telegram message
 */
export interface NightlyMomentumAlert {
  adx: number;
  isExpanded: boolean;
  expandedMaxRisk: number | null;
  reason: string;
}

/**
 * Ready-to-buy candidate for the nightly Telegram message
 */
export interface NightlyReadyCandidate {
  ticker: string;
  name: string;
  sleeve: string;
  close: number;
  entryTrigger: number;
  stopLevel: number;
  distancePct: number;
  atr14: number;
  adx14: number;
  currency: string;
}

/**
 * Trigger-met candidate — price has crossed above entry trigger
 */
export interface NightlyTriggerMetCandidate {
  ticker: string;
  name: string;
  sleeve: string;
  close: number;
  entryTrigger: number;
  stopLevel: number;
  distancePct: number;
  atr14: number;
  adx14: number;
  currency: string;
}

/**
 * Pyramid add alert for the nightly Telegram message
 */
export interface NightlyPyramidAlert {
  ticker: string;
  entryPrice: number;
  currentPrice: number;
  rMultiple: number;
  addNumber: number;
  triggerPrice: number | null;
  message: string;
  currency: string;
  // Pyramid add sizing (scaled-down risk)
  riskScalar: number; // 0.5 for add #1, 0.25 for add #2
  addShares: number; // Shares to buy for this add
  addRiskAmount: number; // Risk £ for this add (GBP)
  scaledRiskPercent: number; // Scaled risk % used for sizing
}

/**
 * Gap risk alert for HIGH_RISK positions with overnight gap > 2× ATR%
 */
export interface NightlyGapRiskAlert {
  ticker: string;
  gapPercent: number;   // (todayOpen - prevClose) / prevClose × 100
  atrPercent: number;   // 14-day ATR%
  threshold: number;    // 2× ATR% threshold that was exceeded
  currency: string;
}

/**
 * Breakout failure alert — price closed back below entry trigger within 5 days
 */
export interface NightlyBreakoutFailureAlert {
  ticker: string;
  daysHeld: number;
  rMultiple: number;
  entryTrigger: number;
  currentPrice: number;
  estimatedLoss: number;  // position-currency loss (negative = loss)
  currency: string;
  reason: string;
}

/**
 * Profit acceleration recommendation for the nightly Telegram message.
 * Advisory-only — every action requires human approval.
 */
export interface NightlyAcceleratorAlert {
  action: string;
  ticker: string;
  replacementTicker?: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  expectedBenefit: string;
  riskImpact: string;
}

/**
 * Send nightly summary via Telegram
 */
export async function sendNightlySummary(summary: {
  date: string;
  healthStatus: string;
  regime: string;
  openPositions: number;
  stopsUpdated: number;
  readyCandidates: number;
  alerts: string[];
  portfolioValue: number;
  dailyChange: number;
  dailyChangePercent: number;
  equity: number;
  openRiskPercent: number;
  positions: NightlyPositionDetail[];
  stopChanges: NightlyStopChange[];
  trailingStopChanges: NightlyStopChange[];
  snapshotSynced: number;
  snapshotFailed: number;
  readyToBuy: NightlyReadyCandidate[];
  triggerMet?: NightlyTriggerMetCandidate[];
  pyramidAlerts?: NightlyPyramidAlert[];
  laggards?: NightlyLaggardAlert[];
  climaxAlerts?: NightlyClimaxAlert[];
  swapAlerts?: NightlySwapAlert[];
  whipsawAlerts?: NightlyWhipsawAlert[];
  breadthAlert?: NightlyBreadthAlert;
  momentumAlert?: NightlyMomentumAlert;
  gapRiskAlerts?: NightlyGapRiskAlert[];
  breakoutFailures?: NightlyBreakoutFailureAlert[];
  acceleratorAlerts?: NightlyAcceleratorAlert[];
  priceAccuracy?: { avgDiffPercent: number; maxDiffPercent: number; snapshotCount: number } | null;
}): Promise<boolean> {
  const healthEmoji = summary.healthStatus === 'GREEN' ? '🟢'
    : summary.healthStatus === 'YELLOW' ? '🟡' : '🔴';

  // ── Position lines ──
  const positionLines = summary.positions.length > 0
    ? summary.positions.map((p) => {
        const pnlEmoji = p.pnl >= 0 ? '🟩' : '🟥';
        const sym = currencySymbol(p.currency);
        const rLabel = p.rMultiple >= 0 ? `+${p.rMultiple.toFixed(1)}R` : `${p.rMultiple.toFixed(1)}R`;
        return `  ${pnlEmoji} <b>${p.ticker}</b>  ${sym}${p.currentPrice.toFixed(2)}  ${rLabel}  ${p.pnl >= 0 ? '+' : ''}${p.pnlPercent.toFixed(1)}%  Stop: ${sym}${p.currentStop.toFixed(2)} [${p.protectionLevel}]`;
      }).join('\n')
    : '  No open positions';

  // ── Stop change lines ──
  const allStopChanges = [...summary.stopChanges, ...summary.trailingStopChanges];
  const stopLines = allStopChanges.length > 0
    ? allStopChanges.map((s) => {
        const sym = currencySymbol(s.currency);
        return `  🔄 <b>${escapeHtml(s.ticker)}</b>  ${sym}${s.oldStop.toFixed(2)} → ${sym}${s.newStop.toFixed(2)}  [${escapeHtml(s.level)}]\n       <i>${escapeHtml(s.reason)}</i>`;
      }).join('\n')
    : '  ✅ No stop changes';

  // ── Alerts ──
  const alertsText = summary.alerts.length > 0
    ? summary.alerts.map((a) => `  ⚠️ ${a}`).join('\n')
    : '  ✅ No alerts';

  // ── Ready to buy lines (only trigger-met candidates) ──
  const readyToBuyAtEntry = summary.readyToBuy
    .filter((r) => r.entryTrigger > 0 && r.close >= r.entryTrigger);
  const readyLines = readyToBuyAtEntry.length > 0
    ? readyToBuyAtEntry.map((r) => {
        const sym = currencySymbol(r.currency);
        return `  🎯 <b>${r.ticker}</b> (${r.sleeve})  ${sym}${r.close.toFixed(2)}
       Entry: ${sym}${r.entryTrigger.toFixed(2)}  Stop: ${sym}${r.stopLevel.toFixed(2)}  Dist: ${r.distancePct.toFixed(1)}%  ADX: ${r.adx14.toFixed(0)}`;
      }).join('\n')
    : '  No candidates at entry';

  // ══ TRIGGER MET lines (price crossed above entry trigger) ══
  const triggerMetList = summary.triggerMet || [];
  const triggerMetLines = triggerMetList.length > 0
    ? triggerMetList.map((t) => {
        const sym = currencySymbol(t.currency);
        return `  🚨 <b>${t.ticker}</b> (${t.sleeve})  ${sym}${t.close.toFixed(2)} ≥ trigger ${sym}${t.entryTrigger.toFixed(2)}
       Stop: ${sym}${t.stopLevel.toFixed(2)}  ADX: ${t.adx14.toFixed(0)}  → CONFIRM VOLUME & BUY`;
      }).join('\n')
    : '';

  // ── Pyramid add lines ──
  const pyramidList = summary.pyramidAlerts || [];
  const pyramidLines = pyramidList.length > 0
    ? pyramidList.map((p) => {
        const sym = currencySymbol(p.currency);
        const scalePct = p.riskScalar > 0 ? `${(p.riskScalar * 100).toFixed(0)}%` : '?';
        const sizingLine = p.addShares > 0
          ? `\n       → ${p.addShares.toFixed(2)} shares (risk £${p.addRiskAmount.toFixed(2)} — ${scalePct} of base)`
          : '';
        return `  📐 <b>${p.ticker}</b>  Add #${p.addNumber}  ${sym}${p.currentPrice.toFixed(2)} ≥ trigger ${p.triggerPrice ? sym + p.triggerPrice.toFixed(2) : 'R-based'}  (${p.rMultiple >= 0 ? '+' : ''}${p.rMultiple.toFixed(1)}R)${sizingLine}`;
      }).join('\n')
    : '';

  // ── Accelerator lines ──
  const accelList = (summary.acceleratorAlerts || []).filter(
    (a) => a.action !== 'HOLD' && a.action !== 'NO_ACTION'
  );
  const accelLines = accelList.length > 0
    ? accelList.map((a) => {
        const urgencyEmoji = a.urgency === 'HIGH' ? '🔴' : a.urgency === 'MEDIUM' ? '🟡' : '⚪';
        const actionEmoji: Record<string, string> = {
          BUY_NEW_A_GRADE: '⚡',
          PYRAMID_WINNER: '📐',
          SWAP_WEAK_FOR_STRONG: '🔄',
          EXIT_LAGGARD: '🗑',
          TIGHTEN_STOP: '🛡',
        };
        const emoji = actionEmoji[a.action] || '📋';
        const swap = a.replacementTicker ? ` → <b>${escapeHtml(a.replacementTicker)}</b>` : '';
        return `  ${urgencyEmoji}${emoji} <b>${escapeHtml(a.ticker)}</b>${swap}  [${a.urgency}]
       ${escapeHtml(a.reason)}`;
      }).join('\n')
    : '';

  // ── Climax / Whipsaw / Swap / Breadth / Momentum lines ──
  const climaxList = summary.climaxAlerts || [];
  const climaxLines = climaxList.length > 0
    ? climaxList.map((c) => {
        return `  🔥 <b>${c.ticker}</b>  +${c.priceAboveMa20Pct.toFixed(1)}% above MA20  Vol ${c.volumeRatio.toFixed(1)}×  → ${c.action}`;
      }).join('\n')
    : '';

  const swapList = summary.swapAlerts || [];
  const swapLines = swapList.length > 0
    ? swapList.map((s) => {
        return `  🔄 <b>${escapeHtml(s.weakTicker)}</b> (${s.weakRMultiple.toFixed(1)}R) → <b>${escapeHtml(s.strongTicker)}</b> in ${escapeHtml(s.cluster)}`;
      }).join('\n')
    : '';

  const whipsawList = summary.whipsawAlerts || [];
  const whipsawLines = whipsawList.length > 0
    ? whipsawList.map((w) => {
        return `  🚫 <b>${w.ticker}</b>  ${w.stopsInLast30Days}× stopped out — re-entry blocked`;
      }).join('\n')
    : '';

  const breadth = summary.breadthAlert;
  const breadthLine = breadth
    ? breadth.isRestricted
      ? `  🔻 Breadth: ${breadth.breadthPct.toFixed(0)}% (< 40%) — max positions reduced to ${breadth.maxPositionsOverride}`
      : `  ✅ Breadth: ${breadth.breadthPct.toFixed(0)}% — normal limits`
    : '';

  const momentum = summary.momentumAlert;
  const momentumLine = momentum
    ? momentum.isExpanded
      ? `  🚀 Momentum: ADX ${momentum.adx.toFixed(1)} > 25 — risk cap expanded to ${momentum.expandedMaxRisk?.toFixed(1)}%`
      : `  📊 Momentum: ADX ${momentum.adx.toFixed(1)} — standard risk limits`
    : '';

  // ── Laggard / Dead Money lines ──
  // ── Gap Risk lines (advisory) ──
  const gapRiskList = summary.gapRiskAlerts || [];
  const gapRiskLines = gapRiskList.length > 0
    ? gapRiskList.map((g) => {
        return `  ⚡ <b>${escapeHtml(g.ticker)}</b>  Gap: ${g.gapPercent >= 0 ? '+' : ''}${g.gapPercent.toFixed(2)}%  (threshold: ±${g.threshold.toFixed(2)}%  ATR%: ${g.atrPercent.toFixed(2)}%)`;
      }).join('\n')
    : '';

  // ── Breakout Failure lines ──
  const breakoutFailureList = summary.breakoutFailures || [];
  const breakoutFailureLines = breakoutFailureList.length > 0
    ? breakoutFailureList.map((bf) => {
        const sym = currencySymbol(bf.currency);
        const lossStr = bf.estimatedLoss < 0 ? `${sym}${Math.abs(bf.estimatedLoss).toFixed(2)}` : `${sym}${bf.estimatedLoss.toFixed(2)}`;
        return `  ⚠️ <b>${escapeHtml(bf.ticker)}</b>  ${bf.daysHeld}d held  ${bf.rMultiple.toFixed(1)}R
       Trigger: ${sym}${bf.entryTrigger.toFixed(2)}  Now: ${sym}${bf.currentPrice.toFixed(2)}  Loss: -${lossStr}`;
      }).join('\n')
    : '';

  const laggardList = summary.laggards || [];
  const laggardLines = laggardList.length > 0
    ? laggardList.map((l) => {
        const emoji = l.flag === 'DEAD_MONEY' ? '💤' : '🐌';
        const rLabel = l.rMultiple >= 0 ? `+${l.rMultiple.toFixed(1)}R` : `${l.rMultiple.toFixed(1)}R`;
        return `  ${emoji} <b>${escapeHtml(l.ticker)}</b>  ${l.daysHeld}d held  ${rLabel}  ${l.lossPct > 0 ? `-${l.lossPct.toFixed(1)}%` : 'flat'}
       <i>${escapeHtml(l.reason)}</i>`;
      }).join('\n')
    : '';

  // ── Total unrealised P&L ──
  const totalPnl = summary.positions.reduce((sum, p) => sum + p.pnl, 0);
  const totalPnlPercent = summary.equity > 0 ? (totalPnl / summary.equity) * 100 : 0;
  const totalPnlEmoji = totalPnl >= 0 ? '📗' : '📕';

  const text = `
<b>🐢 HybridTurtle Nightly Report</b>
<b>Date:</b> ${summary.date}

${healthEmoji} <b>Health:</b> ${summary.healthStatus}

<b>━━━ Portfolio ━━━</b>
  💰 Equity: £${summary.equity.toFixed(2)}
  ${totalPnlEmoji} Unrealised P&L: ${totalPnl >= 0 ? '+' : ''}£${totalPnl.toFixed(2)} (${totalPnlPercent >= 0 ? '+' : ''}${totalPnlPercent.toFixed(1)}%)
  ⚡ Open Risk: ${summary.openRiskPercent.toFixed(1)}% of equity

<b>━━━ Positions (${summary.openPositions}) ━━━</b>
${positionLines}

<b>━━━ Stop Changes (${allStopChanges.length}) ━━━</b>
${stopLines}

<b>━━━ At Entry (${readyToBuyAtEntry.length}) ━━━</b>
${readyLines}

${triggerMetList.length > 0 ? `<b>━━━ 🚨 TRIGGER MET (${triggerMetList.length}) ━━━</b>
${triggerMetLines}

` : ''}${pyramidList.length > 0 ? `<b>━━━ Pyramid Adds (${pyramidList.length}) ━━━</b>
${pyramidLines}

` : ''}${accelList.length > 0 ? `<b>━━━ ⚡ Capital Priority (${accelList.length}) ━━━</b>
${accelLines}

` : ''}${climaxList.length > 0 ? `<b>━━━ Climax Signals (${climaxList.length}) ━━━</b>
${climaxLines}

` : ''}${swapList.length > 0 ? `<b>━━━ Swap Suggestions (${swapList.length}) ━━━</b>
${swapLines}

` : ''}${whipsawList.length > 0 ? `<b>━━━ Whipsaw Blocks (${whipsawList.length}) ━━━</b>
${whipsawLines}

` : ''}${breakoutFailureList.length > 0 ? `<b>━━━ ⚠️ Breakout Failures (${breakoutFailureList.length}) ━━━</b>
${breakoutFailureLines}

` : ''}${laggardList.length > 0 ? `<b>━━━ Laggards / Dead Money (${laggardList.length}) ━━━</b>
${laggardLines}

` : ''}${gapRiskList.length > 0 ? `<b>━━━ ⚡ Gap Risk (${gapRiskList.length}) ━━━</b>
${gapRiskLines}

` : ''}<b>━━━ Market Conditions ━━━</b>
${breadthLine ? breadthLine + '\n' : ''}${momentumLine ? momentumLine + '\n' : ''}
<b>━━━ Sync ━━━</b>
  📊 Snapshot: ${summary.snapshotSynced} synced${summary.snapshotFailed > 0 ? `, ${summary.snapshotFailed} failed` : ''}
${summary.priceAccuracy ? `  📡 T212 vs Yahoo: avg ${summary.priceAccuracy.avgDiffPercent.toFixed(2)}% diff | max ${summary.priceAccuracy.maxDiffPercent.toFixed(2)}% (${summary.priceAccuracy.snapshotCount} samples)` : ''}

<b>━━━ Alerts ━━━</b>
${alertsText}
`.trim();

  return sendTelegramMessage({ text });
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'GBP': case 'GBX': return '£';
    case 'EUR': return '€';
    default: return '$';
  }
}

/**
 * Test Telegram connection
 */
export async function testTelegramConnection(): Promise<{
  success: boolean;
  botName?: string;
  error?: string;
}> {
  const credentials = await getTelegramCredentials();

  if (!credentials) {
    return { success: false, error: 'Bot token not configured' };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${credentials.botToken}/getMe`
    );

    if (!response.ok) {
      return { success: false, error: 'Invalid bot token' };
    }

    const data = await response.json();
    return {
      success: true,
      botName: data.result?.first_name || 'Unknown',
    };
  } catch (error) {
    return { success: false, error: 'Network error' };
  }
}
