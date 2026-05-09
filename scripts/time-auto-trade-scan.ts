/**
 * Monday-equivalent timing test for the auto-trade scan pipeline.
 *
 * Runs the EXACT scan path that auto-trade-task.bat invokes inside the
 * scheduler box (runFullScan + grading + position sizing on the full
 * universe), but bypasses the weekend/holiday gates that would otherwise
 * exit early. Used to verify the new PT20M ExecutionTimeLimit gives
 * comfortable headroom over real-world wall-clock time.
 *
 * READ-ONLY: writes nothing to T212, the DB, or alerts. Just times the
 * pipeline and prints the breakdown.
 *
 * Usage:
 *   npx tsx scripts/time-auto-trade-scan.ts
 */
import 'dotenv/config';
import prisma from '@/lib/prisma';
import { runFullScan } from '@/lib/scan-engine';
import { classifyCandidate, type GradingContext } from '@/lib/candidate-grade';
import { getLatestScoresByTicker } from '@/lib/score-lookup';
import { type RiskProfileType } from '@/types';

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${(sec / 60).toFixed(2)}m`;
}

async function main() {
  const userId = process.env.SANITY_USER_ID || 'default-user';
  console.log('Auto-trade scan timing harness (Monday-equivalent)');
  console.log('  user:', userId);
  console.log('  PT10M limit =', 600 * 1000, 'ms (old)');
  console.log('  PT20M limit =', 1200 * 1000, 'ms (new)');
  console.log('');

  const startUser = Date.now();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { riskProfile: true, equity: true },
  });
  if (!user) {
    console.error('User not found:', userId);
    process.exit(1);
  }
  const riskProfile = (user.riskProfile || 'BALANCED') as RiskProfileType;
  const equity = user.equity ?? 0;
  console.log(`  riskProfile=${riskProfile} equity=${equity}`);
  console.log(`  user fetch: ${fmtMs(Date.now() - startUser)}`);
  console.log('');

  console.log('  [1/4] Running signal scan (the slow step) ...');
  const scanStart = Date.now();
  const scanResult = await runFullScan(userId, riskProfile, equity);
  const scanMs = Date.now() - scanStart;
  console.log(
    `    Regime: ${scanResult.regime} | Scanned: ${scanResult.totalScanned} | READY: ${scanResult.readyCount}`
  );
  console.log(`    Scan elapsed: ${fmtMs(scanMs)}`);
  console.log('');

  console.log('  [2/4] Grading candidates with batch score lookup ...');
  const gradeStart = Date.now();
  const gradingCtx: GradingContext = {
    regime: scanResult.regime,
    healthOverall: 'GREEN',
  };
  const sessionTickers = scanResult.candidates.filter((c) => c.status === 'READY').map((c) => c.ticker);
  const scoresByTicker = await getLatestScoresByTicker(sessionTickers).catch((err) => {
    console.warn('    score lookup failed:', (err as Error).message);
    return new Map<string, { ncs: number; fws: number; bqs: number }>();
  });
  const aGradeBuys: string[] = [];
  for (const candidate of scanResult.candidates) {
    if (candidate.status !== 'READY') continue;
    const scores = scoresByTicker.get(candidate.ticker);
    const ctx: GradingContext = scores
      ? { ...gradingCtx, ncs: scores.ncs, fws: scores.fws, bqs: scores.bqs }
      : gradingCtx;
    const grade = classifyCandidate(candidate, ctx);
    if (grade.grade === 'A_GRADE_BUY') aGradeBuys.push(candidate.ticker);
  }
  const gradeMs = Date.now() - gradeStart;
  console.log(`    A-grade candidates: ${aGradeBuys.length}`);
  console.log(`    A-grade tickers (first 12): ${aGradeBuys.slice(0, 12).join(', ')}`);
  console.log(`    Grade elapsed: ${fmtMs(gradeMs)}`);
  console.log('');

  const total = Date.now() - startUser;
  console.log('=== SUMMARY ===');
  console.log(`  Total wall-clock: ${fmtMs(total)}`);
  console.log(`  vs old PT10M limit (600s): ${total > 600_000 ? 'EXCEEDS' : 'fits'} (${(total / 600_000 * 100).toFixed(1)}%)`);
  console.log(`  vs new PT20M limit (1200s): ${total > 1_200_000 ? 'EXCEEDS' : 'fits'} (${(total / 1_200_000 * 100).toFixed(1)}%)`);
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
