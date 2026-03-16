import { NextResponse } from 'next/server';
import { getScanCache, setScanCache, isScanCacheFresh, SCAN_CACHE_TTL_MS, type CachedScanResult } from '@/lib/scan-cache';
import prisma from '@/lib/prisma';
import { scoreAll, normaliseRow, type SnapshotRow, type ScoredTicker } from '@/lib/dual-score';
import type { ScanCandidate } from '@/types';
import { apiError } from '@/lib/api-response';
import { getPassedGateCounts, reconstructCandidatesFromDbRows } from '@/lib/scan-db-reconstruction';
import { calcBPSFromSnapshot, computeRsPercentiles } from '@/lib/breakout-probability';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

// ── Locate master_snapshot.csv as fallback ──────────────────
const PLANNING_SIBLING = path.resolve(process.cwd(), '../Planning');
const PLANNING_LOCAL = path.resolve(process.cwd(), 'Planning');
const PLANNING_DIR = fs.existsSync(PLANNING_SIBLING) ? PLANNING_SIBLING : PLANNING_LOCAL;
const CSV_PATH = path.join(PLANNING_DIR, 'master_snapshot.csv');

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.length < 2) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = (values[j] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function dbRowToSnapshotRow(row: Record<string, unknown>): SnapshotRow {
  return {
    ticker: row.ticker as string,
    name: (row.name as string) || (row.ticker as string),
    sleeve: (row.sleeve as string) || '',
    status: (row.status as string) || '',
    currency: (row.currency as string) || '',
    close: (row.close as number) || 0,
    atr_14: (row.atr14 as number) || 0,
    atr_pct: (row.atrPct as number) || 0,
    adx_14: (row.adx14 as number) || 0,
    plus_di: (row.plusDi as number) || 0,
    minus_di: (row.minusDi as number) || 0,
    vol_ratio: (row.volRatio as number) || 1,
    dollar_vol_20: (row.dollarVol20 as number) || 0,
    liquidity_ok: (row.liquidityOk as boolean) ?? true,
    market_regime: (row.marketRegime as string) || 'NEUTRAL',
    market_regime_stable: (row.marketRegimeStable as boolean) ?? true,
    high_20: (row.high20 as number) || 0,
    high_55: (row.high55 as number) || 0,
    distance_to_20d_high_pct: (row.distanceTo20dHighPct as number) || 0,
    distance_to_55d_high_pct: (row.distanceTo55dHighPct as number) || 0,
    entry_trigger: (row.entryTrigger as number) || 0,
    stop_level: (row.stopLevel as number) || 0,
    chasing_20_last5: (row.chasing20Last5 as boolean) ?? false,
    chasing_55_last5: (row.chasing55Last5 as boolean) ?? false,
    atr_spiking: (row.atrSpiking as boolean) ?? false,
    atr_collapsing: (row.atrCollapsing as boolean) ?? false,
    atr_compression_ratio: (row.atrCompressionRatio as number | null) ?? null,
    rs_vs_benchmark_pct: (row.rsVsBenchmarkPct as number) || 0,
    days_to_earnings: (row.daysToEarnings as number | null) ?? null,
    earnings_in_next_5d: (row.earningsInNext5d as boolean) ?? false,
    cluster_name: (row.clusterName as string) || '',
    super_cluster_name: (row.superClusterName as string) || '',
    cluster_exposure_pct: (row.clusterExposurePct as number) || 0,
    super_cluster_exposure_pct: (row.superClusterExposurePct as number) || 0,
    max_cluster_pct: (row.maxClusterPct as number) || 0,
    max_super_cluster_pct: (row.maxSuperClusterPct as number) || 0,
  };
}

// ── Load dual-score tickers ─────────────────────────────────
async function getDualScoreTickers(): Promise<ScoredTicker[]> {
  // Try DB first
  if (process.env.DATABASE_URL) {
    try {
      const snapshot = await prisma.snapshot.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (snapshot) {
        const dbRows = await prisma.snapshotTicker.findMany({
          where: { snapshotId: snapshot.id },
        });
        if (dbRows.length > 0) {
          const snapshotRows: SnapshotRow[] = dbRows.map((r) =>
            dbRowToSnapshotRow(r as unknown as Record<string, unknown>)
          );
          return scoreAll(snapshotRows);
        }
      }
    } catch (dbError) {
      console.warn('[CrossRef] DB unavailable, falling back to CSV:', (dbError as Error).message);
    }
  }

  // Fallback to CSV
  if (fs.existsSync(CSV_PATH)) {
    const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
    const rawRows = parseCSV(csvText);
    const snapshotRows: SnapshotRow[] = rawRows.map((r) =>
      normaliseRow(r as unknown as Record<string, unknown>)
    );
    return scoreAll(snapshotRows);
  }
  return [];
}

// ── Load scan data with DB fallback ─────────────────────────
async function getScanDataWithFallback(): Promise<CachedScanResult | null> {
  // Try in-memory cache first
  const cached = getScanCache();
  if (cached && isScanCacheFresh(cached)) {
    return cached;
  }

  // Fallback: load most recent scan from database
  if (!process.env.DATABASE_URL) return null;
  try {
    const latestScan = await prisma.scan.findFirst({
      orderBy: { runDate: 'desc' },
      include: {
        results: {
          include: { stock: true },
          orderBy: { rankScore: 'desc' },
        },
      },
    });

    if (!latestScan || latestScan.results.length === 0) return null;

    // For cross-ref we accept scans up to 24h old (unlike the live scan page
    // which uses the stricter 1-hour TTL). The plan page watchlist should
    // always show the best available data rather than going blank.
    const CROSS_REF_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const latestScanAgeMs = Date.now() - latestScan.runDate.getTime();
    if (latestScanAgeMs > CROSS_REF_MAX_AGE_MS) {
      console.log('[CrossRef] DB scan is older than 24h, skipping');
      return null;
    }

    // Reconstruct scan result shape from DB rows
    const candidates = reconstructCandidatesFromDbRows(latestScan.results);

    const passedFilters = candidates.filter((c) => c.passesAllFilters);
    const gateCounts = getPassedGateCounts(candidates);

    const dbResult: CachedScanResult = {
      regime: latestScan.regime,
      candidates,
      readyCount: passedFilters.filter((c) => c.status === 'READY').length,
      watchCount: passedFilters.filter((c) => c.status === 'WATCH').length,
      farCount: candidates.filter((c) => c.status === 'FAR').length,
      totalScanned: candidates.length,
      passedFilters: passedFilters.length,
      passedRiskGates: gateCounts.passedRiskGates,
      passedAntiChase: gateCounts.passedAntiChase,
      cachedAt: latestScan.runDate.toISOString(),
      userId: latestScan.userId,
      riskProfile: 'BALANCED',
      equity: 0,
    };

    // Re-populate in-memory cache for subsequent requests
    setScanCache(dbResult);
    console.log(`[CrossRef] Loaded ${candidates.length} scan results from DB (scan ${latestScan.id})`);

    return dbResult;
  } catch (dbError) {
    console.warn('[CrossRef] Failed to load scan from DB:', (dbError as Error).message);
    return null;
  }
}

// ── Cross-reference types ───────────────────────────────────
interface CrossRefTicker {
  ticker: string;
  yahooTicker?: string;
  name: string;
  sleeve: string;
  // 7-Stage Scan data
  scanStatus: string | null;      // READY / WATCH / FAR
  scanRankScore: number | null;
  scanPassesFilters: boolean | null;
  scanPassesRiskGates: boolean | null;
  scanPassesAntiChase: boolean | null;
  scanDistancePercent: number | null;
  scanEntryTrigger: number | null;
  scanStopPrice: number | null;
  scanPrice: number | null;
  scanShares: number | null;
  scanRiskDollars: number | null;
  // Dual Score data
  dualBQS: number | null;
  dualFWS: number | null;
  dualNCS: number | null;
  dualAction: string | null;
  dualStatus: string | null;
  dualClose: number | null;
  dualEntryTrigger: number | null;
  dualStopLevel: number | null;
  dualDistancePct: number | null;
  // Per-ticker display currency (GBX for .L, USD for US, EUR etc.)
  priceCurrency: string;
  // Cross-reference classification
  matchType: 'BOTH_RECOMMEND' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'BOTH_REJECT' | 'CONFLICT';
  agreementScore: number;          // 0-100 how aligned the two systems are
  // Breakout Probability Score (0–19, higher = more structural evidence for breakout)
  bps: number | null;
  // Hurst Exponent from scan engine (0–1, >0.5 = trending)
  hurstExponent: number | null;
  // ADX from scan engine (trend strength)
  scanAdx: number | null;
  // ATR% from scan engine technicals (volatility measure for EV modifier)
  scanAtrPercent: number | null;
  // Earnings calendar data (from scan engine EarningsCache)
  earningsInfo?: {
    daysUntilEarnings: number | null;
    nextEarningsDate: string | null;
    confidence: 'HIGH' | 'LOW' | 'NONE';
    action: 'AUTO_NO' | 'DEMOTE_WATCH' | null;
    reason: string | null;
  };
}

export async function GET() {
  try {
    // ── Load both datasets ──────────────────────────────────
    const scanCache = await getScanDataWithFallback();
    const dualTickers = await getDualScoreTickers();

    const hasScanData = scanCache && Array.isArray(scanCache.candidates) && scanCache.candidates.length > 0;
    const hasDualData = dualTickers.length > 0;

    if (!hasScanData && !hasDualData) {
      return apiError(404, 'NO_CROSS_REF_DATA', 'Run the 7-Stage Scan and/or sync Dual Score data first.');
    }

    // ── Build lookup maps ───────────────────────────────────
    const scanMap = new Map<string, ScanCandidate>();
    if (hasScanData) {
      for (const c of scanCache!.candidates as ScanCandidate[]) {
        scanMap.set(c.ticker, c);
      }
    }

    const dualMap = new Map<string, ScoredTicker>();
    for (const t of dualTickers) {
      dualMap.set(t.ticker, t);
    }

    // ── Pre-compute RS percentile ranks across the full universe ──
    const rsPercentileMap = computeRsPercentiles(
      dualTickers.map(t => ({ ticker: t.ticker, rs: t.rs_vs_benchmark_pct ?? 0 }))
    );

    // ── Merge all tickers ───────────────────────────────────
    const allTickerArr: string[] = [];
    scanMap.forEach((_, k) => allTickerArr.push(k));
    dualMap.forEach((_, k) => { if (!scanMap.has(k)) allTickerArr.push(k); });
    const crossRef: CrossRefTicker[] = [];

    for (const ticker of allTickerArr) {
      const scan = scanMap.get(ticker);
      const dual = dualMap.get(ticker);

      // Determine if each system "recommends"
      const scanRecommends = scan
        ? scan.passesAllFilters && (scan.status === 'READY' || scan.status === 'WATCH')
        : null;
      const dualRecommends = dual
        ? dual.NCS >= 50 && dual.FWS <= 50
        : null;

      // Classify match type
      let matchType: CrossRefTicker['matchType'];
      if (scanRecommends === true && dualRecommends === true) {
        matchType = 'BOTH_RECOMMEND';
      } else if (scanRecommends === true && dualRecommends === false) {
        matchType = 'CONFLICT';
      } else if (scanRecommends === false && dualRecommends === true) {
        matchType = 'CONFLICT';
      } else if (scanRecommends === null && dualRecommends === true) {
        matchType = 'DUAL_ONLY';
      } else if (scanRecommends === true && dualRecommends === null) {
        matchType = 'SCAN_ONLY';
      } else if (scanRecommends === null && dualRecommends === false) {
        matchType = 'BOTH_REJECT';
      } else if (scanRecommends === false && dualRecommends === null) {
        matchType = 'BOTH_REJECT';
      } else if (scanRecommends === false && dualRecommends === false) {
        matchType = 'BOTH_REJECT';
      } else {
        matchType = 'BOTH_REJECT';
      }

      // Calculate agreement score (0-100)
      let agreementScore = 50; // neutral start
      if (scan && dual) {
        // Both have data — measure alignment
        const scanScore = scanRecommends ? 100 : 0;
        const dualScore = dualRecommends ? 100 : 0;
        // Add nuance from NCS and rank
        const ncsNorm = Math.min(100, Math.max(0, dual.NCS));
        const rankNorm = Math.min(100, Math.max(0, scan.rankScore));
        agreementScore = Math.round(
          (scanScore * 0.25 + dualScore * 0.25 + ncsNorm * 0.25 + rankNorm * 0.25)
        );
      } else if (scan) {
        agreementScore = scanRecommends ? 75 : 25;
      } else if (dual) {
        agreementScore = dualRecommends ? 75 : 25;
      }

      // Compute BPS from available snapshot data
      const bpsResult = dual
        ? calcBPSFromSnapshot({
            atr_pct: dual.atr_pct,
            atr_compression_ratio: dual.atr_compression_ratio,
            rs_vs_benchmark_pct: dual.rs_vs_benchmark_pct,
            rsPercentile: rsPercentileMap.get(ticker) ?? null,
            weekly_adx: dual.weekly_adx as number | undefined,
            sector: dual.cluster_name as string | undefined,
          })
        : null;

      crossRef.push({
        ticker,
        yahooTicker: scan?.yahooTicker || undefined,
        name: scan?.name || dual?.name || ticker,
        sleeve: scan?.sleeve || dual?.sleeve || '',
        // 7-Stage scan data
        scanStatus: scan?.status ?? null,
        scanRankScore: scan?.rankScore ?? null,
        scanPassesFilters: scan?.passesAllFilters ?? null,
        scanPassesRiskGates: scan?.passesRiskGates ?? null,
        scanPassesAntiChase: scan?.passesAntiChase ?? null,
        scanDistancePercent: scan?.distancePercent ?? null,
        scanEntryTrigger: scan?.entryTrigger ?? null,
        scanStopPrice: scan?.stopPrice ?? null,
        scanPrice: scan?.price ?? null,
        scanShares: scan?.shares ?? null,
        scanRiskDollars: scan?.riskDollars ?? null,
        // Dual score data
        dualBQS: dual?.BQS ?? null,
        dualFWS: dual?.FWS ?? null,
        dualNCS: dual?.NCS ?? null,
        dualAction: dual?.ActionNote ?? null,
        dualStatus: dual?.status ?? null,
        dualClose: dual?.close ?? null,
        dualEntryTrigger: dual?.entry_trigger ?? null,
        dualStopLevel: dual?.stop_level ?? null,
        dualDistancePct: dual
          ? dual.close > 0 && dual.entry_trigger > 0
            ? Math.round(((dual.entry_trigger - dual.close) / dual.close) * 10000) / 100
            : 0
          : null,
        // Per-ticker display currency
        priceCurrency: scan?.priceCurrency || (ticker.endsWith('.L') ? 'GBX' : (dual?.currency || 'USD').toUpperCase()),
        // Classification
        matchType,
        agreementScore,
        // BPS
        bps: bpsResult?.bps ?? null,
        // Hurst Exponent from scan engine Stage 2 soft filter
        hurstExponent: scan?.filterResults?.hurstExponent ?? null,
        // ADX from scan technicals
        scanAdx: scan?.technicals?.adx ?? (dual?.adx_14 as number ?? null),
        // ATR% from scan technicals (for EV modifier ATR bucket classification)
        scanAtrPercent: scan?.technicals?.atrPercent ?? null,
        // Earnings calendar data passed through from scan engine
        earningsInfo: scan?.earningsInfo ?? undefined,
      });
    }

    // Sort: trigger-met first → BOTH_RECOMMEND → others, then by agreement score desc
    const typeOrder: Record<string, number> = {
      BOTH_RECOMMEND: 0,
      CONFLICT: 1,
      SCAN_ONLY: 2,
      DUAL_ONLY: 3,
      BOTH_REJECT: 4,
    };
    crossRef.sort((a, b) => {
      // Trigger-met candidates float to the very top (actionable now)
      const aTriggerMet = a.scanPrice != null && a.scanEntryTrigger != null && a.scanPrice >= a.scanEntryTrigger;
      const bTriggerMet = b.scanPrice != null && b.scanEntryTrigger != null && b.scanPrice >= b.scanEntryTrigger;
      if (aTriggerMet !== bTriggerMet) return aTriggerMet ? -1 : 1;
      // Then by match type
      const oa = typeOrder[a.matchType] ?? 5;
      const ob = typeOrder[b.matchType] ?? 5;
      if (oa !== ob) return oa - ob;
      return b.agreementScore - a.agreementScore;
    });

    // ── Summary stats ───────────────────────────────────────
    const summary = {
      total: crossRef.length,
      bothRecommend: crossRef.filter((c) => c.matchType === 'BOTH_RECOMMEND').length,
      conflict: crossRef.filter((c) => c.matchType === 'CONFLICT').length,
      scanOnly: crossRef.filter((c) => c.matchType === 'SCAN_ONLY').length,
      dualOnly: crossRef.filter((c) => c.matchType === 'DUAL_ONLY').length,
      bothReject: crossRef.filter((c) => c.matchType === 'BOTH_REJECT').length,
      hasScanData: !!hasScanData,
      hasDualData,
      scanCachedAt: scanCache?.cachedAt ?? null,
    };

    return NextResponse.json({ tickers: crossRef, summary });
  } catch (error) {
    console.error('[CrossRef] Error:', error);
    return apiError(500, 'CROSS_REF_FAILED', 'Failed to build cross-reference', (error as Error).message, true);
  }
}
