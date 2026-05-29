'use client';

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Navbar from '@/components/shared/Navbar';
import KPIBanner from '@/components/portfolio/KPIBanner';
import PositionsTable from '@/components/portfolio/PositionsTable';
import T212SyncPanel from '@/components/portfolio/T212SyncPanel';
import PositionSyncButton from '@/components/portfolio/PositionSyncButton';
import StopUpdateQueue from '@/components/shared/StopUpdateQueue';
import JournalDrawer from '@/components/shared/JournalDrawer';
import type { JournalPositionContext } from '@/components/shared/JournalDrawer';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { Loader2, Briefcase, PieChart, BarChart3, XCircle, RefreshCw } from 'lucide-react';

// Dynamic import keeps ~ReadyToBuyPanel out of initial bundle (only loads when visible)
const ReadyToBuyPanel = dynamic(() => import('@/components/portfolio/ReadyToBuyPanel'), { ssr: false });
const BreakoutFailurePanel = dynamic(() => import('@/components/portfolio/BreakoutFailurePanel'), { ssr: false });
const ExitIntelligenceCard = dynamic(() => import('@/components/portfolio/ExitIntelligenceCard'), { ssr: false });

// Lazy tabs — Distribution and Performance only load on first click
const DistributionTab = lazy(() => import('@/components/portfolio/DistributionTab'));
const PerformanceTab = lazy(() => import('@/components/portfolio/PerformanceTab'));

// Tab definitions
const PORTFOLIO_TABS = [
  { id: 'positions', label: 'Positions', icon: Briefcase },
  { id: 'distribution', label: 'Distribution', icon: PieChart },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
] as const;
type PortfolioTabId = (typeof PORTFOLIO_TABS)[number]['id'];

/** Skeleton placeholder for lazy-loaded tabs */
function TabSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-20 bg-navy-800 rounded-lg" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-64 bg-navy-800 rounded-lg" />
        <div className="h-64 bg-navy-800 rounded-lg" />
      </div>
    </div>
  );
}

const DEFAULT_USER_ID = 'default-user';

interface PositionData {
  id: string;
  ticker: string;
  name: string;
  sleeve: string;
  status: string;
  entryPrice: number;
  entryDate: string;
  shares: number;
  currentStop: number;
  initialRisk: number;
  protectionLevel: string;
  currentPrice: number;
  rMultiple: number;
  gainPercent: number;
  gainDollars: number;
  value: number;
  initialRiskGBP: number;
  riskGBP?: number;
  priceCurrency: string;
  source: string;
  stock?: { ticker: string; name: string; sleeve: string };
  priceFreshness?: { source: string; ageSeconds: number } | null;
  priceSource?: 'T212' | 'YAHOO' | null;
  t212Price?: { price: number; yahooPrice: number; ageMinutes: number; diffPercent: number; mismatch: boolean } | null;
}

interface PositionApiResponse {
  id: string;
  stock?: { ticker: string; name: string; sleeve: string };
  t212Ticker?: string;
  status: string;
  entryPrice: number;
  entryDate: string;
  shares: number;
  currentStop?: number;
  stopLoss?: number;
  initialRisk?: number;
  protectionLevel?: string;
  currentPrice?: number;
  rMultiple?: number;
  gainPercent?: number;
  gainDollars?: number;
  value?: number;
  initialRiskGBP?: number;
  riskGBP?: number;
  priceCurrency?: string;
  source?: string;
  priceFreshness?: { source: string; ageSeconds: number } | null;
  priceSource?: 'T212' | 'YAHOO' | null;
  t212Price?: { price: number; yahooPrice: number; ageMinutes: number; diffPercent: number; mismatch: boolean } | null;
}

interface AccountData {
  totalValue: number | null;
  cash: number | null;
  invested: number | null;
  unrealisedPL: number | null;
}

export default function PositionsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
      </div>
    }>
      <PositionsPageInner />
    </Suspense>
  );
}

function PositionsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get('tab') ?? 'positions') as PortfolioTabId;

  function handleTabChange(tab: PortfolioTabId) {
    router.replace(`/portfolio/positions?tab=${tab}`, { scroll: false });
  }

  const [positions, setPositions] = useState<PositionData[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('GBP');
  const [stopRefreshKey, setStopRefreshKey] = useState(0);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [lastPriceRefresh, setLastPriceRefresh] = useState<Date | null>(null);

  // Journal drawer state
  const [journalPositionId, setJournalPositionId] = useState<string | null>(null);
  const [journalInitialTab, setJournalInitialTab] = useState<'entry' | 'trade' | 'close'>('entry');

  // Fetch ALL OPEN positions (regardless of how they originated — broker sync,
  // auto-trade, or manual). Filtering by source='trading212' previously hid
  // auto-traded positions that are real T212 holdings, causing the portfolio
  // screen to under-report by exactly the count of auto-trade-originated rows.
  const fetchPositions = useCallback(async (forceRefresh = false) => {
    try {
      const refreshParam = forceRefresh ? '&refresh=true' : '';
      const data = await apiRequest<PositionApiResponse[]>(
        `/api/positions?userId=${DEFAULT_USER_ID}&status=OPEN${refreshParam}`
      );

      // Map API response to table format
      const mapped: PositionData[] = data.map((p) => ({
        id: p.id,
        ticker: p.stock?.ticker || p.t212Ticker || 'N/A',
        name: p.stock?.name || '',
        sleeve: p.stock?.sleeve || 'CORE',
        status: p.status,
        entryPrice: p.entryPrice,
        entryDate: p.entryDate,
        shares: p.shares,
        currentStop: p.currentStop || p.stopLoss || 0,
        initialRisk: p.initialRisk || 0,
        protectionLevel: p.protectionLevel || 'INITIAL',
        currentPrice: p.currentPrice || p.entryPrice,
        rMultiple: p.rMultiple || 0,
        gainPercent: p.gainPercent || 0,
        gainDollars: p.gainDollars || 0,
        value: p.value || (p.currentPrice ?? p.entryPrice) * p.shares,
        initialRiskGBP: p.initialRiskGBP ?? p.riskGBP ?? 0,
        riskGBP: p.riskGBP,
        priceCurrency: p.priceCurrency || 'GBP',
        source: p.source || 'trading212',
        priceFreshness: p.priceFreshness ?? null,
        priceSource: p.priceSource ?? null,
        t212Price: p.t212Price ?? null,
      }));

      setPositions(mapped);
      setLastPriceRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch positions:', err);
      setFetchError(formatApiError(err, 'Failed to load positions'));
    }
  }, []);

  // Fetch T212 account summary (cached from last sync)
  const fetchAccount = useCallback(async () => {
    try {
      const data = await apiRequest<{ lastSync?: string; currency?: string; account?: AccountData }>(`/api/trading212/sync?userId=${DEFAULT_USER_ID}`);
      if (data.lastSync) {
        setLastSync(data.lastSync);
      }
      if (data.currency) {
        setCurrency(data.currency);
      }
      if (data.account) {
        setAccount(data.account);
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
    }
  }, []);

  // Load everything on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setFetchError(null);
      await Promise.all([fetchPositions(), fetchAccount()]);
      setLoading(false);
    };
    load();
  }, [fetchPositions, fetchAccount]);

  // Auto-refresh prices every 20 minutes during market hours (Mon-Fri, 8am-9pm UK)
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

    function isMarketHours(): boolean {
      const now = new Date();
      const day = now.getDay(); // 0=Sun, 6=Sat
      if (day === 0 || day === 6) return false;
      // UK hours: 8:00 – 21:00 (covers LSE 8-16:30 + US 14:30-21:00)
      const hour = now.getHours();
      return hour >= 8 && hour < 21;
    }

    const interval = setInterval(() => {
      if (isMarketHours()) {
        fetchPositions(false); // use cache-aware fetch, not force-refresh
      }
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchPositions]);

  // When T212 sync completes, refetch positions and account + refresh stop recs
  const handleSyncComplete = useCallback(async () => {
    await Promise.all([fetchPositions(true), fetchAccount()]);
    setStopRefreshKey((k) => k + 1);
  }, [fetchPositions, fetchAccount]);

  // Force-refresh Yahoo prices without T212 sync (no cooldown)
  const handleRefreshPrices = useCallback(async () => {
    setRefreshingPrices(true);
    try {
      await fetchPositions(true);
      setStopRefreshKey((k) => k + 1);
    } finally {
      setRefreshingPrices(false);
    }
  }, [fetchPositions]);

  // ── Action handlers for PositionsTable ──
  const handleUpdateStop = useCallback(async (positionId: string, newStop: number, reason: string): Promise<boolean> => {
    try {
      await apiRequest('/api/stops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, newStop, reason }),
      });
      await fetchPositions();
      setStopRefreshKey((k) => k + 1);
      return true;
    } catch {
      return false;
    }
  }, [fetchPositions]);

  const handleExitPosition = useCallback(async (positionId: string, exitPrice: number, exitReason?: string, closeNote?: string): Promise<boolean> => {
    try {
      await apiRequest('/api/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, exitPrice, exitReason, closeNote }),
      });
      await Promise.all([fetchPositions(), fetchAccount()]);
      return true;
    } catch {
      return false;
    }
  }, [fetchPositions, fetchAccount]);

  // Use T212 account summary for portfolio KPIs (properly currency-converted)
  const openPositions = positions.filter((p) => p.status === 'OPEN');

  // Cluster-aware position list for ReadyToBuyPanel overlap detection
  const openPositionsForCluster = useMemo(() =>
    openPositions.map((p) => ({
      ticker: p.ticker,
      cluster: p.sleeve, // sleeve is the best cluster proxy available in position data
      sleeve: p.sleeve,
    })),
    [openPositions]
  );

  const totalValue = account?.totalValue ?? 0;
  const unrealisedPL = account?.unrealisedPL ?? 0;
  const cash = account?.cash ?? 0;
  const invested = account?.invested ?? 0;
  const plPercent = invested > 0 ? (unrealisedPL / invested) * 100 : 0;

  // ── Journal drawer: deep-link from ?position=xxx ──
  useEffect(() => {
    const posParam = searchParams.get('position');
    if (posParam) {
      setJournalPositionId(posParam);
    }
  }, [searchParams]);

  // Build position context for the journal drawer (no extra API call)
  const journalContext: JournalPositionContext | null = useMemo(() => {
    if (!journalPositionId) return null;
    const pos = positions.find((p) => p.id === journalPositionId);
    if (!pos) return null;
    return {
      id: pos.id,
      ticker: pos.ticker,
      name: pos.name,
      status: pos.status,
      protectionLevel: pos.protectionLevel,
      entryPrice: pos.entryPrice,
      currentStop: pos.currentStop,
      currentPrice: pos.currentPrice,
      rMultiple: pos.rMultiple,
      gainPercent: pos.gainPercent,
      priceCurrency: pos.priceCurrency,
      entryDate: pos.entryDate,
    };
  }, [journalPositionId, positions]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Tab bar */}
      <div className="border-b border-border bg-navy-900/50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          <div className="flex gap-1 py-1">
            {PORTFOLIO_TABS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors',
                    isActive
                      ? 'bg-primary/15 text-primary-400'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <TabIcon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Distribution tab */}
      {activeTab === 'distribution' && (
        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
          <Suspense fallback={<TabSkeleton />}>
            <DistributionTab />
          </Suspense>
        </main>
      )}

      {/* Performance tab */}
      {activeTab === 'performance' && (
        <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 animate-fade-in">
          <Suspense fallback={<TabSkeleton />}>
            <PerformanceTab />
          </Suspense>
        </main>
      )}

      {/* Positions tab (default — loads eagerly) */}
      {activeTab === 'positions' && (

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Fetch Error Banner */}
        {fetchError && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300 flex-1">{fetchError}</p>
            <button
              onClick={() => { setFetchError(null); setLoading(true); Promise.all([fetchPositions(true), fetchAccount()]).finally(() => setLoading(false)); }}
              className="px-3 py-1 text-xs font-medium rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* KPI Row */}
        <KPIBanner
          items={[
            { label: 'Portfolio Value', value: formatCurrency(totalValue, currency), prefix: '' },
            {
              label: 'Unrealised P&L',
              value: formatCurrency(unrealisedPL, currency),
              change: plPercent,
              changeLabel: formatPercent(plPercent),
            },
            { label: 'Cash', value: formatCurrency(cash, currency), prefix: '' },
            { label: 'Invested', value: formatCurrency(invested, currency), prefix: '' },
            { label: 'Open Positions', value: String(openPositions.length), prefix: '' },
            {
              label: 'Prices Updated',
              value: lastPriceRefresh
                ? lastPriceRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'Never',
            },
            {
              label: 'Last Synced',
              value: lastSync
                ? new Date(lastSync).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Never',
            },
          ]}
        />

        {/* Trading 212 Sync Panel */}
        <T212SyncPanel onSyncComplete={handleSyncComplete} />

        {/* Manual closed-position sync with T212 */}
        <div className="flex items-center gap-3">
          <PositionSyncButton onSyncComplete={handleSyncComplete} />
          <button
            onClick={handleRefreshPrices}
            disabled={refreshingPrices}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              'bg-navy-800 border border-border/50 hover:bg-navy-700 text-foreground',
              refreshingPrices && 'opacity-50 cursor-not-allowed'
            )}
            title="Force-refresh all prices (T212 real-time + Yahoo fallback)"
          >
            <RefreshCw className={cn('w-4 h-4', refreshingPrices && 'animate-spin')} />
            {refreshingPrices ? 'Refreshing...' : 'Refresh Prices'}
          </button>
          {/* T212 connection status badge */}
          {openPositions.length > 0 && (() => {
            const t212Count = openPositions.filter(p => p.priceSource === 'T212').length;
            const total = openPositions.length;
            const allT212 = t212Count === total;
            const noT212 = t212Count === 0;
            return (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border',
                  allT212 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : noT212 ? 'bg-red-500/10 border-red-500/30 text-red-400'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                )}
                title={`${t212Count}/${total} positions using T212 real-time prices`}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', allT212 ? 'bg-emerald-400' : noT212 ? 'bg-red-400' : 'bg-amber-400')} />
                {allT212 ? 'T212 Live' : noT212 ? 'Yahoo Only' : `T212 ${t212Count}/${total}`}
              </span>
            );
          })()}
        </div>

        {/* Stop-Loss Recommendations — fetches live from /api/stops */}
        <StopUpdateQueue userId={DEFAULT_USER_ID} onApplied={fetchPositions} refreshTrigger={stopRefreshKey} />

        {/* Exit Intelligence — per-position scoring and action recommendations */}
        <ExitIntelligenceCard />

        {/* Breakout Failure Alerts — amber warnings for positions that failed within 5 days */}
        <BreakoutFailurePanel />

        {/* Ready to Buy — trigger-met candidates from latest scan */}
        <div id="ready-to-buy" className="scroll-mt-20">
          <ReadyToBuyPanel
            currentPositionCount={openPositions.length}
            openPositions={openPositionsForCluster}
            onPositionCreated={handleSyncComplete}
          />
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading positions with live prices...</span>
          </div>
        ) : openPositions.length === 0 ? (
          <div className="card-surface p-8 text-center text-muted-foreground">
            <p className="text-sm">No open positions. Click &ldquo;Sync Positions&rdquo; to import from Trading 212.</p>
          </div>
        ) : (
          <PositionsTable
            positions={positions}
            onUpdateStop={handleUpdateStop}
            onExitPosition={handleExitPosition}
            onJournalClick={(id) => {
              setJournalPositionId(id);
              setJournalInitialTab('entry');
            }}
          />
        )}

        {/* Journal Drawer — slide-in from right */}
        <JournalDrawer
          positionId={journalPositionId}
          initialTab={journalInitialTab}
          positionContext={journalContext}
          onClose={() => setJournalPositionId(null)}
        />
      </main>
      )}
    </div>
  );
}
