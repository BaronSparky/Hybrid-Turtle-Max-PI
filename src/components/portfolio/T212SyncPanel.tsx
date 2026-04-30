'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import { apiRequest, formatApiError } from '@/lib/api-client';
import {
  RefreshCw,
  TrendingUp,
  Loader2,
  Check,
  AlertTriangle,
  Wallet,
  Clock,
  Unplug,
  Settings,
  Repeat,
} from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

interface T212SyncPanelProps {
  onSyncComplete?: () => void;
}

interface SyncStatus {
  connected: boolean;
  lastSync: string | null;
  accountId: string | null;
  currency: string | null;
  environment: string;
  positionCount: number;
}

interface SyncResult {
  success: boolean;
  sync: {
    invest: { created: number; updated: number; closed: number };
    isa: { created: number; updated: number; closed: number };
    errors?: string[];
    riskGateWarnings?: string[];
  };
  account: {
    accountId: number;
    currency: string;
    cash: number;
    totalCash: number;
    investmentsValue: number;
    investmentsCost: number;
    unrealizedPL: number;
    realizedPL: number;
    totalValue: number;
  };
  positions: Array<{
    ticker: string;
    name: string;
    shares: number;
    entryPrice: number;
    currentPrice: number;
    profitLoss: number;
    profitLossPercent: number;
    accountType?: string;
  }>;
  syncedAt: string;
}

export default function T212SyncPanel({ onSyncComplete }: T212SyncPanelProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncingAccountTypes, setSyncingAccountTypes] = useState(false);
  const [accountTypeSyncResult, setAccountTypeSyncResult] = useState<{
    updated: number; alreadyCorrect: number; notFound: number; totalChecked: number;
  } | null>(null);

  const loadStatus = async () => {
    try {
      const data = await apiRequest<SyncStatus>(`/api/trading212/sync?userId=${DEFAULT_USER_ID}`);
      setStatus(data);
      setLoaded(true);
    } catch (error) {
      setError(formatApiError(error, 'Failed to load sync status'));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const data = await apiRequest<SyncResult>('/api/trading212/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID }),
      });

      setLastResult(data);
      onSyncComplete?.();

      // Reload status
      await loadStatus();
    } catch (error) {
      setError(formatApiError(error, 'Sync failed — check your connection'));
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAccountTypes = async () => {
    setSyncingAccountTypes(true);
    setError(null);
    setAccountTypeSyncResult(null);

    try {
      const data = await apiRequest<{
        success: boolean;
        summary: { updated: number; alreadyCorrect: number; notFound: number; totalChecked: number };
      }>('/api/positions/sync-account-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID }),
      });

      setAccountTypeSyncResult(data.summary);
      onSyncComplete?.();
    } catch (error) {
      setError(formatApiError(error, 'Account type sync failed'));
    } finally {
      setSyncingAccountTypes(false);
    }
  };

  // Load status on first render
  if (!loaded) {
    loadStatus();
  }

  if (!loaded) {
    return (
      <div className="card-surface p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading Trading 212 status...</span>
        </div>
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="card-surface p-4 border border-dashed border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-navy-800 rounded-lg">
              <TrendingUp className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Trading 212 Not Connected</p>
              <p className="text-xs text-muted-foreground">
                Go to Settings to connect your Trading 212 account
              </p>
            </div>
          </div>
          <a
            href="/settings"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary/20 text-primary-400 rounded-lg hover:bg-primary/30 transition-colors"
          >
            <Settings className="w-3 h-3" />
            Settings
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <TrendingUp className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              Trading 212
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-profit/20 text-profit rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-profit" />
                Connected
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {status.environment?.toUpperCase()} · Account {status.accountId} · {status.currency}
              {status.positionCount > 0 && ` · ${status.positionCount} positions`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncAccountTypes}
            disabled={syncingAccountTypes || syncing}
            className="btn-secondary flex items-center gap-1.5 text-sm"
            title="Check all positions against T212 and fix ISA/Invest account types"
          >
            {syncingAccountTypes ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Repeat className="w-4 h-4" />
            )}
            {syncingAccountTypes ? 'Syncing...' : 'Sync Account Types'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing || syncingAccountTypes}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {syncing ? 'Syncing...' : 'Sync Positions'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 mx-4 mt-4 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Account Type Sync Result */}
      {accountTypeSyncResult && (
        <div className="p-3 mx-4 mt-4 bg-primary/10 border border-primary/30 rounded-lg text-sm text-foreground">
          <div className="flex items-center gap-2 mb-1">
            <Repeat className="w-4 h-4 text-primary-400" />
            <span className="font-medium">Account Type Sync Complete</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Checked {accountTypeSyncResult.totalChecked} positions — {accountTypeSyncResult.updated} updated, {accountTypeSyncResult.alreadyCorrect} already correct{accountTypeSyncResult.notFound > 0 ? `, ${accountTypeSyncResult.notFound} not in DB` : ''}
          </p>
        </div>
      )}

      {/* Last Sync Status */}
      {status.lastSync && (
        <div className="px-4 pt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Last synced: {new Date(status.lastSync).toLocaleString()}
        </div>
      )}

      {/* Sync Results */}
      {lastResult && (
        <div className="p-4 space-y-4">
          {/* Account Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-navy-800/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Total Value</p>
              <p className="text-lg font-semibold text-foreground font-mono">
                {formatCurrency(lastResult.account.totalValue)}
              </p>
            </div>
            <div className="p-3 bg-navy-800/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Wallet className="w-3 h-3" /> Cash
              </p>
              <p className="text-lg font-semibold text-foreground font-mono">
                {formatCurrency(lastResult.account.cash)}
              </p>
            </div>
            <div className="p-3 bg-navy-800/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Invested</p>
              <p className="text-lg font-semibold text-foreground font-mono">
                {formatCurrency(lastResult.account.investmentsValue)}
              </p>
            </div>
            <div className="p-3 bg-navy-800/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Unrealised P&L</p>
              <p className={cn(
                'text-lg font-semibold font-mono',
                lastResult.account.unrealizedPL >= 0 ? 'text-profit' : 'text-loss'
              )}>
                {lastResult.account.unrealizedPL >= 0 ? '+' : ''}
                {formatCurrency(lastResult.account.unrealizedPL)}
              </p>
            </div>
          </div>

          {/* Sync Summary */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {(() => {
              // Sum across both accounts for the summary line
              const inv = lastResult.sync.invest ?? { created: 0, updated: 0, closed: 0 };
              const isa = lastResult.sync.isa ?? { created: 0, updated: 0, closed: 0 };
              const created = inv.created + isa.created;
              const updated = inv.updated + isa.updated;
              const closed = inv.closed + isa.closed;
              return (
                <>
                  <span className="flex items-center gap-1">
                    <Check className="w-3 h-3 text-profit" />
                    {created} new
                  </span>
                  <span className="flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 text-primary-400" />
                    {updated} updated
                  </span>
                  {closed > 0 && (
                    <span className="flex items-center gap-1">
                      <Unplug className="w-3 h-3 text-loss" />
                      {closed} closed
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
