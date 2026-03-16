import type { SignalBar } from './types';

export function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function ema(values: number[], period: number) {
  if (values.length === 0) {
    return 0;
  }

  const multiplier = 2 / (period + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] * multiplier + current * (1 - multiplier);
  }

  return current;
}

export function slope(values: number[]) {
  if (values.length < 2) {
    return 0;
  }

  const first = values[0];
  const last = values[values.length - 1];
  return ((last - first) / Math.max(Math.abs(first), 0.0001)) * 100;
}

export function highest(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((result, value) => Math.max(result, value), Number.NEGATIVE_INFINITY);
}

export function computeAtr(bars: SignalBar[], period: number) {
  if (bars.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const high = bars[index].high;
    const low = bars[index].low;
    const previousClose = bars[index - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }

  return average(trueRanges.slice(-period));
}

export function round(value: number, precision = 4) {
  return Number(value.toFixed(precision));
}