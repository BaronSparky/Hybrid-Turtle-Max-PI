/**
 * Standalone verifier for the regime gate (job 1 — the master kill switch
 * for new entries). Calls `getMarketRegime` against live SPY + VWRL.L
 * data and prints the verdict alongside the inputs that produced it,
 * so the operator can sanity-check the gate without firing the rest of
 * the auto-trade pipeline.
 *
 * Read-only: never mutates state, never writes a heartbeat, never
 * sends a Telegram alert.
 *
 * Usage:
 *   npx tsx scripts/verify-regime-gate.ts
 *
 * Exit codes:
 *   0 — verdict produced (BULLISH / SIDEWAYS / BEARISH printed)
 *   1 — fetch or computation failed
 */

import 'dotenv/config';
// Skip the heavy startup pre-cache — this script is a quick read-only check.
process.env.HYBRIDTURTLE_SKIP_STARTUP_PRECACHE = 'true';

import { getDailyPrices, calculateMA, getMarketRegime } from '../src/lib/market-data';

async function main() {
  console.log('[verify-regime-gate] live regime check\n');

  // Fetch the same two benchmarks getMarketRegime uses.
  const [spy, vwrl] = await Promise.all([
    getDailyPrices('SPY', 'full').catch(() => []),
    getDailyPrices('VWRL.L', 'full').catch(() => []),
  ]);

  console.log(`  SPY     bars: ${spy.length}`);
  console.log(`  VWRL.L  bars: ${vwrl.length}`);

  if (spy.length < 200) {
    console.error('\n  ✗ Insufficient SPY history (<200 bars) — regime would default to SIDEWAYS.');
    process.exit(1);
  }

  const spyClose = spy[0].close;
  const spyMa200 = calculateMA(spy.map((d) => d.close), 200);
  const spyAboveMa = spyClose > spyMa200;

  console.log(`\n  SPY today: ${spyClose.toFixed(2)}`);
  console.log(`  SPY MA200: ${spyMa200.toFixed(2)}`);
  console.log(`  SPY above MA200: ${spyAboveMa ? 'YES' : 'NO'} (${(((spyClose / spyMa200) - 1) * 100).toFixed(2)}%)`);

  if (vwrl.length >= 200) {
    const vwrlClose = vwrl[0].close;
    const vwrlMa200 = calculateMA(vwrl.map((d) => d.close), 200);
    const vwrlAboveMa = vwrlClose > vwrlMa200;
    console.log(`\n  VWRL today: ${vwrlClose.toFixed(2)}`);
    console.log(`  VWRL MA200: ${vwrlMa200.toFixed(2)}`);
    console.log(`  VWRL above MA200: ${vwrlAboveMa ? 'YES' : 'NO'} (${(((vwrlClose / vwrlMa200) - 1) * 100).toFixed(2)}%)`);
  } else {
    console.log('\n  ⚠ VWRL.L history insufficient — regime falls back to SPY-only with CHOP band.');
  }

  console.log('\n  Computing 3-day-stable regime via getMarketRegime()...');
  const regime = await getMarketRegime();
  const verdict =
    regime === 'BULLISH'
      ? '✓ BULLISH — auto-trade would ALLOW new entries'
      : regime === 'SIDEWAYS'
        ? '⚠ SIDEWAYS — auto-trade would BLOCK new entries (regime gate closed)'
        : '✗ BEARISH — auto-trade would BLOCK new entries (regime gate closed)';
  console.log(`\n  Regime: ${regime}`);
  console.log(`  ${verdict}`);
}

main().catch((err) => {
  console.error('[verify-regime-gate] failed:', err);
  process.exit(1);
});
