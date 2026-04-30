'use client';

/**
 * DEPENDENCIES
 * Consumed by: /scan page (Scores tab)
 * Consumes: /api/scan/scores, /api/scan/snapshots/sync
 * Risk-sensitive: NO (display only)
 * Last modified: 2026-03-03
 * Notes: Lifted from src/app/scan/scores/page.tsx — identical functionality,
 *        rendered inside a tab instead of a full page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import DualScoreKPICards from '@/components/scan/scores/DualScoreKPICards';
import dynamic from 'next/dynamic';

const NCSDistributionChart = dynamic(() => import('@/components/scan/scores/NCSDistributionChart'), { ssr: false });
const BQSvsFWSScatter = dynamic(() => import('@/components/scan/scores/BQSvsFWSScatter'), { ssr: false });
import DualScoreFilters from '@/components/scan/scores/DualScoreFilters';
import DualScoreTable from '@/components/scan/scores/DualScoreTable';
import WhyCard from '@/components/scan/scores/WhyCard';
import ScoringGuide from '@/components/scan/scores/ScoringGuide';
import type { ScoredTicker } from '@/lib/dual-score';
import { apiRequest, formatApiError } from '@/lib/api-client';
import { BarChart3, RefreshCw, CloudDownload, Database, FileText } from 'lucide-react';

interface ScoresResponse {
  tickers: ScoredTicker[];
  summary: {
    total: number;
    autoYes: number;
    autoNo: number;
    conditional: number;
    avgNCS: number;
    avgBQS: number;
    avgFWS: number;
  };
  filters: { sleeves: string[]; statuses: string[] };
  source?: string;
  updatedAt: string;
}

export default function ScoresTab() {
  const [data, setData] = useState<ScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState('');
  const [sleeve, setSleeve] = useState('');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState('');
  const [minNCS, setMinNCS] = useState(0);
  const [maxFWS, setMaxFWS] = useState(100);

  // Selection state
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<ScoresResponse>('/api/scan/scores');
      setData(result);
    } catch (error) {
      setError(formatApiError(error, 'Failed to load dual score data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const body = await apiRequest<{ message?: string }>('/api/scan/snapshots/sync', { method: 'POST' });
      setSyncMessage(body.message ?? 'Sync completed');
      await fetchScores();
    } catch (error) {
      const message = formatApiError(error, 'Unknown sync error');
      setSyncMessage(`Sync failed: ${message}`);
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    let tickers = data.tickers;

    if (search) {
      const q = search.toLowerCase();
      tickers = tickers.filter(
        (t) =>
          t.ticker.toLowerCase().includes(q) ||
          (t.name && t.name.toLowerCase().includes(q))
      );
    }
    if (sleeve) {
      tickers = tickers.filter((t) => t.sleeve === sleeve);
    }
    if (status) {
      tickers = tickers.filter((t) => t.status === status);
    }
    if (action === 'Auto-Yes') {
      tickers = tickers.filter((t) => t.ActionNote.startsWith('Auto-Yes'));
    } else if (action === 'Auto-No') {
      tickers = tickers.filter((t) => t.ActionNote.startsWith('Auto-No'));
    } else if (action === 'Conditional') {
      tickers = tickers.filter((t) => t.ActionNote.startsWith('Conditional'));
    }
    if (minNCS > 0) {
      tickers = tickers.filter((t) => t.NCS >= minNCS);
    }
    if (maxFWS < 100) {
      tickers = tickers.filter((t) => t.FWS <= maxFWS);
    }
    return tickers;
  }, [data, search, sleeve, status, action, minNCS, maxFWS]);

  const selectedTickerData = useMemo(() => {
    if (!selectedTicker || !data) return null;
    return data.tickers.find((t) => t.ticker === selectedTicker) ?? null;
  }, [data, selectedTicker]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-primary-400 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading scores...</p>
        </div>
      </div>
    );
  }

  // ── Error / empty state ──
  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="card-surface p-8 text-center max-w-lg">
          <div className="text-5xl mb-4">📊</div>
          <h2 className="text-lg font-bold text-foreground mb-2">No Snapshot Data</h2>
          <p className="text-sm text-muted-foreground mb-6">
            No snapshot data available. Sync live data from Yahoo Finance or
            place a <code className="text-primary-400">master_snapshot.csv</code> in the
            Planning folder.
          </p>
          {error && (
            <p className="text-xs text-loss/80 mb-4 font-mono bg-navy-800 p-3 rounded-lg">
              {error}
            </p>
          )}
          {syncMessage && (
            <p className="text-xs text-primary-400/80 mb-4 font-mono bg-navy-800 p-3 rounded-lg">
              {syncMessage}
            </p>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary text-sm flex items-center gap-2 mx-auto"
          >
            {syncing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <CloudDownload className="w-4 h-4" />
            )}
            {syncing ? 'Syncing...' : 'Sync from Yahoo'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          BQS / FWS / NCS scoring — {data.summary.total} tickers scored
          {data.source && (
            <span className="inline-flex items-center gap-1 text-xs bg-navy-800 px-2 py-0.5 rounded-full">
              {data.source === 'csv' ? (
                <FileText className="w-3 h-3" />
              ) : (
                <Database className="w-3 h-3" />
              )}
              {data.source}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Snapshot {new Date(data.updatedAt).toLocaleString()}
          </span>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {syncing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <CloudDownload className="w-4 h-4" />
            )}
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            onClick={() => fetchScores()}
            className="btn-outline text-sm flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Scoring Guide */}
      <ScoringGuide />

      {/* KPI Cards */}
      <DualScoreKPICards {...data.summary} />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NCSDistributionChart tickers={data.tickers} />
        <BQSvsFWSScatter tickers={data.tickers} />
      </div>

      {/* Filters */}
      <DualScoreFilters
        search={search}
        onSearchChange={setSearch}
        sleeve={sleeve}
        onSleeveChange={setSleeve}
        status={status}
        onStatusChange={setStatus}
        action={action}
        onActionChange={setAction}
        minNCS={minNCS}
        onMinNCSChange={setMinNCS}
        maxFWS={maxFWS}
        onMaxFWSChange={setMaxFWS}
        sleeves={data.filters.sleeves}
        statuses={data.filters.statuses}
        resultCount={filtered.length}
      />

      {/* Table + Why Card */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <DualScoreTable
          tickers={filtered}
          selectedTicker={selectedTicker}
          onSelect={setSelectedTicker}
        />
        <WhyCard ticker={selectedTickerData} />
      </div>
    </div>
  );
}
