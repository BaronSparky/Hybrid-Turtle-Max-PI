/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx
 * Consumes: /api/prediction/stress-test (POST to run, GET for cached)
 * Risk-sensitive: NO — read-only display
 * Last modified: 2026-03-07
 * Notes: Runs stress test on-demand for a candidate trade.
 *        Checks cache first (GET), runs simulation if not cached (POST).
 */

'use client';

import { useState, useEffect } from 'react';

export interface StressTestData {
  stopHitProbability: number;
  gate: 'PASS' | 'FAIL';
  pathsRun: number;
  horizonDays: number;
  percentiles: { p5: number; p50: number; p95: number } | null;
  avgDaysToStopHit: number | null;
  loading: boolean;
  hasResult: boolean;
}

interface StressTestInput {
  ticker: string;
  entryPrice: number;
  stopPrice: number;
  atr: number;
  regime: string;
}

export function useStressTest(input: StressTestInput | null): StressTestData {
  const ticker = input?.ticker;
  const entryPrice = input?.entryPrice;
  const stopPrice = input?.stopPrice;
  const atr = input?.atr;
  const regime = input?.regime;
  const [data, setData] = useState<StressTestData>({
    stopHitProbability: 0,
    gate: 'PASS',
    pathsRun: 0,
    horizonDays: 7,
    percentiles: null,
    avgDaysToStopHit: null,
    loading: !!input,
    hasResult: false,
  });

  useEffect(() => {
    if (!ticker || entryPrice === undefined || stopPrice === undefined || atr === undefined || regime === undefined) {
      setData(prev => ({ ...prev, loading: false, hasResult: false }));
      return;
    }

    let cancelled = false;

    const runTest = async () => {
      try {
        // Check cache first
        const cacheRes = await fetch(`/api/prediction/stress-test?ticker=${encodeURIComponent(ticker)}`);
        if (cacheRes.ok) {
          const cacheJson = await cacheRes.json();
          if (!cancelled && cacheJson.ok && cacheJson.data?.hasResult) {
            const r = cacheJson.data.result;
            setData({
              stopHitProbability: r.stopHitProbability,
              gate: r.gate,
              pathsRun: r.pathsRun,
              horizonDays: r.horizonDays,
              percentiles: r.percentiles ?? null,
              avgDaysToStopHit: r.avgDaysToStopHit,
              loading: false,
              hasResult: true,
            });
            return;
          }
        }

        // No cache — run the simulation
        const runRes = await fetch('/api/prediction/stress-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker,
            entryPrice,
            stopPrice,
            atr,
            regime,
          }),
        });

        if (!runRes.ok) {
          if (!cancelled) setData(prev => ({ ...prev, loading: false }));
          return;
        }

        const runJson = await runRes.json();
        if (cancelled) return;

        if (runJson.ok && runJson.data) {
          const r = runJson.data;
          setData({
            stopHitProbability: r.stopHitProbability,
            gate: r.gate,
            pathsRun: r.pathsRun,
            horizonDays: r.horizonDays,
            percentiles: r.percentiles ?? null,
            avgDaysToStopHit: r.avgDaysToStopHit,
            loading: false,
            hasResult: true,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    runTest();
    return () => { cancelled = true; };
  }, [atr, entryPrice, regime, stopPrice, ticker]);

  return data;
}
