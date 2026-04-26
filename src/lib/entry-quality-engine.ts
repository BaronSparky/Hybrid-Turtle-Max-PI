/**
 * DEPENDENCIES
 * Consumed by: scan-engine.ts (Stage 6+), /api/scan/route.ts, UI components
 * Consumes: @/types (EntryQuality, EntryWindowStatus, etc.)
 * Risk-sensitive: YES — produces entry/no-entry decisions
 * Notes: Pure function — no DB access, no side effects.
 *        Computes entry quality assessment for a scan candidate.
 *        All prices are in native currency (same as candidate).
 */

import type {
  EntryQuality,
  EntryWindowStatus,
  EntryDecision,
  EntryQualityColor,
} from '@/types';

// ── Constants ──────────────────────────────────────────────────
// Anti-chase bound: price within this many ATRs above trigger is still buyable
const ANTI_CHASE_ATR_BOUND = 0.8;

// Hard ceiling: never buy above this many ATRs above trigger
const NO_CHASE_ATR_BOUND = 1.2;

// High ATR extension: yellow warning when extension > this
const HIGH_EXTENSION_ATR = 0.5;

// Spread/slippage risk: if slippage buffer eats > this fraction of anti-chase headroom, WAIT
const SLIPPAGE_HEADROOM_FRACTION = 0.8;

export interface EntryQualityInput {
  price: number;
  entryTrigger: number;
  stopPrice: number;
  atr: number;
  atrPercent: number;
  status: string;
  /** Historical slippage ATR buffer (from slippage-tracker) */
  slippageBuffer: number;
  /** Whether pullback continuation was triggered */
  pullbackTriggered: boolean;
  /** Pullback entry price (if pullback mode) */
  pullbackEntryPrice?: number;
  /** Whether the anti-chase guard already blocked this candidate */
  antiChaseFailed: boolean;
}

/**
 * Assess entry quality for a scan candidate.
 *
 * Rules:
 * 1. If price is below trigger → WATCH/READY depending on distance
 * 2. If price crosses trigger but is within anti-chase bounds → BUY_ALLOWED
 * 3. If price is above anti-chase bound → WAIT_PULLBACK
 * 4. If spread/slippage risk is too high → WAIT_SPREAD
 * 5. If candidate gaps above no-chase price → MISSED_DO_NOT_CHASE
 * 6. If pullback continuation triggered → BUY_ALLOWED via pullback
 */
export function assessEntryQuality(input: EntryQualityInput): EntryQuality {
  const {
    price,
    entryTrigger,
    stopPrice,
    atr,
    atrPercent,
    status,
    slippageBuffer,
    pullbackTriggered,
    pullbackEntryPrice,
    antiChaseFailed,
  } = input;

  // ── Derived prices ──
  const idealEntry = entryTrigger;
  const maxAllowedEntry = atr > 0
    ? entryTrigger + ANTI_CHASE_ATR_BOUND * atr
    : entryTrigger * 1.02; // Fallback: 2% above trigger if no ATR
  const noChasePrice = atr > 0
    ? entryTrigger + NO_CHASE_ATR_BOUND * atr
    : entryTrigger * 1.04; // Fallback: 4%

  // Slippage-adjusted limit: tighten maxAllowedEntry by historical slippage
  const slippageAdjustedLimit = atr > 0
    ? maxAllowedEntry - slippageBuffer * atr
    : maxAllowedEntry;

  // ── Extension metrics ──
  const extensionATR = atr > 0 ? (price - entryTrigger) / atr : 0;
  const triggerDistancePct = entryTrigger > 0
    ? ((price - entryTrigger) / entryTrigger) * 100
    : 0;

  // ── No data guard ──
  if (atr <= 0 || entryTrigger <= 0 || price <= 0) {
    return {
      idealEntry: entryTrigger || 0,
      maxAllowedEntry: entryTrigger || 0,
      noChasePrice: entryTrigger || 0,
      entryWindowStatus: 'WATCH',
      triggerDistancePct: 0,
      extensionATR: 0,
      slippageAdjustedLimit: entryTrigger || 0,
      suggestedOrderType: 'LIMIT',
      decision: 'WAIT',
      reason: 'Insufficient data — ATR or price missing.',
      quality: 'RED',
    };
  }

  // ── Pullback continuation override ──
  if (pullbackTriggered && pullbackEntryPrice) {
    return {
      idealEntry,
      maxAllowedEntry,
      noChasePrice,
      entryWindowStatus: 'BUY_ALLOWED',
      triggerDistancePct,
      extensionATR,
      slippageAdjustedLimit,
      suggestedOrderType: 'LIMIT',
      decision: 'BUY_NOW',
      reason: `Pullback continuation — buy at ${pullbackEntryPrice.toFixed(2)} (pulled back into valid zone).`,
      quality: 'GREEN',
    };
  }

  // ── Price below trigger → WATCH or READY ──
  if (price < entryTrigger) {
    const distancePct = Math.abs(triggerDistancePct);
    const isClose = distancePct <= 2;
    const windowStatus: EntryWindowStatus = isClose ? 'READY' : 'WATCH';

    return {
      idealEntry,
      maxAllowedEntry,
      noChasePrice,
      entryWindowStatus: windowStatus,
      triggerDistancePct,
      extensionATR,
      slippageAdjustedLimit,
      suggestedOrderType: 'STOP',
      decision: 'WAIT',
      reason: isClose
        ? `${distancePct.toFixed(1)}% below trigger — approaching breakout. Set buy-stop at ${idealEntry.toFixed(2)}.`
        : `${distancePct.toFixed(1)}% below trigger — watch for approach.`,
      quality: 'GREEN',
    };
  }

  // ── Price above no-chase ceiling → MISSED ──
  if (price > noChasePrice) {
    return {
      idealEntry,
      maxAllowedEntry,
      noChasePrice,
      entryWindowStatus: 'MISSED_DO_NOT_CHASE',
      triggerDistancePct,
      extensionATR,
      slippageAdjustedLimit,
      suggestedOrderType: 'LIMIT',
      decision: 'MISSED',
      reason: `Gapped ${extensionATR.toFixed(2)} ATR above trigger — do not chase. Do not pay above ${noChasePrice.toFixed(2)}.`,
      quality: 'RED',
    };
  }

  // ── Price above anti-chase bound but below no-chase → WAIT_PULLBACK ──
  if (price > maxAllowedEntry || antiChaseFailed) {
    return {
      idealEntry,
      maxAllowedEntry,
      noChasePrice,
      entryWindowStatus: 'WAIT_PULLBACK',
      triggerDistancePct,
      extensionATR,
      slippageAdjustedLimit,
      suggestedOrderType: 'LIMIT',
      decision: 'WAIT',
      reason: `Extended ${extensionATR.toFixed(2)} ATR above trigger — wait for pullback to ${maxAllowedEntry.toFixed(2)} or below.`,
      quality: 'YELLOW',
    };
  }

  // ── Slippage/spread risk check ──
  // If historical slippage consumes most of the anti-chase headroom, wait
  const headroom = maxAllowedEntry - entryTrigger;
  const slippageCost = slippageBuffer * atr;
  if (headroom > 0 && slippageCost / headroom > SLIPPAGE_HEADROOM_FRACTION) {
    return {
      idealEntry,
      maxAllowedEntry,
      noChasePrice,
      entryWindowStatus: 'WAIT_SPREAD',
      triggerDistancePct,
      extensionATR,
      slippageAdjustedLimit,
      suggestedOrderType: 'LIMIT',
      decision: 'WAIT',
      reason: `High slippage risk — historical fills overshoot by ${(slippageBuffer * 100).toFixed(2)}%. Use limit at ${slippageAdjustedLimit.toFixed(2)}.`,
      quality: 'YELLOW',
    };
  }

  // ── Within bounds → BUY_ALLOWED ──
  // Determine order type: at trigger → LIMIT at trigger, slightly above → LIMIT at max
  const atTrigger = extensionATR <= 0.1;
  const suggestedOrderType = atTrigger ? 'LIMIT' : 'LIMIT';
  const limitTarget = atTrigger ? idealEntry : slippageAdjustedLimit;
  const isHighExtension = extensionATR > HIGH_EXTENSION_ATR;

  return {
    idealEntry,
    maxAllowedEntry,
    noChasePrice,
    entryWindowStatus: 'BUY_ALLOWED',
    triggerDistancePct,
    extensionATR,
    slippageAdjustedLimit,
    suggestedOrderType,
    decision: 'BUY_NOW',
    reason: atTrigger
      ? `At trigger — limit buy at ${limitTarget.toFixed(2)}.`
      : `${extensionATR.toFixed(2)} ATR above trigger — limit buy at ${limitTarget.toFixed(2)}.${isHighExtension ? ' Slightly extended — tighter fill preferred.' : ''}`,
    quality: isHighExtension ? 'YELLOW' : 'GREEN',
  };
}
