'use client';

/**
 * DEPENDENCIES
 * Consumed by: /settings page
 * Consumes: /api/settings (GET + PUT), /api/trading212/connect, /api/trading212/sync
 * Risk-sensitive: NO (credential management only)
 * Last modified: 2026-03-03
 * Notes: Broker section — T212 Invest + ISA credentials, Gap Guard config.
 *        T212 connect/disconnect/sync are self-contained API calls.
 *        Gap Guard saves via PUT /api/settings.
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  TrendingUp, Shield, AlertTriangle, Check, Loader2, Save,
  Eye, EyeOff, RefreshCw, Unplug, Plug,
} from 'lucide-react';
import T212ImportPanel from '@/components/settings/T212ImportPanel';

const DEFAULT_USER_ID = 'default-user';

export default function BrokerPanel() {
  const { setEquity } = useStore();

  // T212 Environment
  const [t212Environment, setT212Environment] = useState<'demo' | 'live'>('demo');

  // T212 Invest
  const [t212ApiKey, setT212ApiKey] = useState('');
  const [t212ApiSecret, setT212ApiSecret] = useState('');
  const [t212ShowKey, setT212ShowKey] = useState(false);
  const [t212ShowSecret, setT212ShowSecret] = useState(false);
  const [t212Connected, setT212Connected] = useState(false);
  const [t212AccountId, setT212AccountId] = useState<string | null>(null);
  const [t212Currency, setT212Currency] = useState<string | null>(null);
  const [t212LastSync, setT212LastSync] = useState<string | null>(null);
  const [t212Connecting, setT212Connecting] = useState(false);
  const [t212Syncing, setT212Syncing] = useState(false);
  const [t212Error, setT212Error] = useState<string | null>(null);
  const [t212Success, setT212Success] = useState<string | null>(null);

  // T212 ISA
  const [t212IsaApiKey, setT212IsaApiKey] = useState('');
  const [t212IsaApiSecret, setT212IsaApiSecret] = useState('');
  const [t212IsaShowKey, setT212IsaShowKey] = useState(false);
  const [t212IsaShowSecret, setT212IsaShowSecret] = useState(false);
  const [t212IsaConnected, setT212IsaConnected] = useState(false);
  const [t212IsaAccountId, setT212IsaAccountId] = useState<string | null>(null);
  const [t212IsaCurrency, setT212IsaCurrency] = useState<string | null>(null);
  const [t212IsaLastSync, setT212IsaLastSync] = useState<string | null>(null);
  const [t212IsaConnecting, setT212IsaConnecting] = useState(false);
  const [t212IsaError, setT212IsaError] = useState<string | null>(null);
  const [t212IsaSuccess, setT212IsaSuccess] = useState<string | null>(null);

  // Gap Guard
  const [gapGuardMode, setGapGuardMode] = useState<'ALL' | 'MONDAY_ONLY'>('ALL');
  const [gapGuardWeekendATR, setGapGuardWeekendATR] = useState('0.75');
  const [gapGuardWeekendPct, setGapGuardWeekendPct] = useState('3.0');
  const [gapGuardDailyATR, setGapGuardDailyATR] = useState('1.0');
  const [gapGuardDailyPct, setGapGuardDailyPct] = useState('4.0');
  const [gapSaving, setGapSaving] = useState(false);
  const [gapSaveResult, setGapSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [gapDirty, setGapDirty] = useState(false);

  // Load on mount
  useEffect(() => {
    apiRequest<Record<string, unknown>>(`/api/settings?userId=${DEFAULT_USER_ID}`)
      .then((data) => {
        // T212 Invest
        if (data.t212Connected) {
          setT212Connected(true);
          if (data.t212ApiKey) setT212ApiKey(data.t212ApiKey as string);
          if (data.t212ApiSecret) setT212ApiSecret(data.t212ApiSecret as string);
          if (data.t212AccountId) setT212AccountId(data.t212AccountId as string);
          if (data.t212Currency) setT212Currency(data.t212Currency as string);
          if (data.t212LastSync) setT212LastSync(data.t212LastSync as string);
        }
        if (data.t212Environment === 'live' || data.t212Environment === 'demo') {
          setT212Environment(data.t212Environment as 'demo' | 'live');
        }
        // T212 ISA
        if (data.t212IsaConnected) {
          setT212IsaConnected(true);
          if (data.t212IsaApiKey) setT212IsaApiKey(data.t212IsaApiKey as string);
          if (data.t212IsaApiSecret) setT212IsaApiSecret(data.t212IsaApiSecret as string);
          if (data.t212IsaAccountId) setT212IsaAccountId(data.t212IsaAccountId as string);
          if (data.t212IsaCurrency) setT212IsaCurrency(data.t212IsaCurrency as string);
          if (data.t212IsaLastSync) setT212IsaLastSync(data.t212IsaLastSync as string);
        }
        // Gap Guard
        if (data.gapGuardMode === 'ALL' || data.gapGuardMode === 'MONDAY_ONLY') setGapGuardMode(data.gapGuardMode);
        if (data.gapGuardWeekendATR != null) setGapGuardWeekendATR(String(data.gapGuardWeekendATR));
        if (data.gapGuardWeekendPct != null) setGapGuardWeekendPct(String(data.gapGuardWeekendPct));
        if (data.gapGuardDailyATR != null) setGapGuardDailyATR(String(data.gapGuardDailyATR));
        if (data.gapGuardDailyPct != null) setGapGuardDailyPct(String(data.gapGuardDailyPct));
      })
      .catch(() => {});
  }, []);

  // ── T212 handlers ──
  const handleT212Connect = async () => {
    if (!t212ApiKey || !t212ApiSecret) { setT212Error('Enter both API Key and Secret'); return; }
    setT212Connecting(true); setT212Error(null); setT212Success(null);
    try {
      const data = await apiRequest<{ accountId: number; currency: string }>('/api/trading212/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID, apiKey: t212ApiKey, apiSecret: t212ApiSecret, environment: t212Environment, accountType: 'invest' }),
      });
      setT212Connected(true);
      setT212AccountId(data.accountId?.toString());
      setT212Currency(data.currency);
      setT212Success(`Connected! Account: ${data.accountId} (${data.currency})`);
    } catch (err) { setT212Error(formatApiError(err, 'Connection failed')); }
    finally { setT212Connecting(false); }
  };

  const handleT212Disconnect = async () => {
    try {
      await apiRequest(`/api/trading212/connect?userId=${DEFAULT_USER_ID}&accountType=invest`, { method: 'DELETE' });
      setT212Connected(false); setT212AccountId(null); setT212Currency(null); setT212LastSync(null);
      setT212ApiKey(''); setT212ApiSecret(''); setT212Success(null); setT212Error(null);
    } catch { setT212Error('Failed to disconnect'); }
  };

  const handleT212IsaConnect = async () => {
    if (!t212IsaApiKey || !t212IsaApiSecret) { setT212IsaError('Enter both API Key and Secret'); return; }
    setT212IsaConnecting(true); setT212IsaError(null); setT212IsaSuccess(null);
    try {
      const data = await apiRequest<{ accountId: number; currency: string }>('/api/trading212/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID, apiKey: t212IsaApiKey, apiSecret: t212IsaApiSecret, environment: t212Environment, accountType: 'isa' }),
      });
      setT212IsaConnected(true);
      setT212IsaAccountId(data.accountId?.toString());
      setT212IsaCurrency(data.currency);
      setT212IsaSuccess(`Connected! ISA: ${data.accountId} (${data.currency})`);
    } catch (err) { setT212IsaError(formatApiError(err, 'Connection failed')); }
    finally { setT212IsaConnecting(false); }
  };

  const handleT212IsaDisconnect = async () => {
    try {
      await apiRequest(`/api/trading212/connect?userId=${DEFAULT_USER_ID}&accountType=isa`, { method: 'DELETE' });
      setT212IsaConnected(false); setT212IsaAccountId(null); setT212IsaCurrency(null); setT212IsaLastSync(null);
      setT212IsaApiKey(''); setT212IsaApiSecret(''); setT212IsaSuccess(null); setT212IsaError(null);
    } catch { setT212IsaError('Failed to disconnect'); }
  };

  const handleT212Sync = async () => {
    setT212Syncing(true); setT212Error(null); setT212Success(null);
    try {
      const data = await apiRequest<{ syncedAt: string; sync: { invest: { created: number; updated: number; closed: number }; isa: { created: number; updated: number; closed: number } }; account?: { totalValue?: number } }>('/api/trading212/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID }),
      });
      setT212LastSync(data.syncedAt);
      const inv = data.sync.invest; const isa = data.sync.isa;
      const parts: string[] = [];
      if (inv.created + inv.updated + inv.closed > 0) parts.push(`Invest: ${inv.created} new, ${inv.updated} updated, ${inv.closed} closed`);
      if (isa.created + isa.updated + isa.closed > 0) parts.push(`ISA: ${isa.created} new, ${isa.updated} updated, ${isa.closed} closed`);
      setT212Success(parts.length > 0 ? `Synced! ${parts.join(' | ')}` : 'Synced! No changes.');
      if (data.sync.isa && (isa.created + isa.updated + isa.closed > 0)) setT212IsaLastSync(data.syncedAt);
      const combined = data.account?.totalValue;
      if (combined && combined > 0) setEquity(combined);
    } catch (err) { setT212Error(formatApiError(err, 'Sync failed')); }
    finally { setT212Syncing(false); }
  };

  // ── Gap Guard save ──
  const handleGapSave = async () => {
    setGapSaving(true); setGapSaveResult(null);
    try {
      await apiRequest('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          gapGuardMode,
          gapGuardWeekendATR: parseFloat(gapGuardWeekendATR) || 0.75,
          gapGuardWeekendPct: parseFloat(gapGuardWeekendPct) || 3.0,
          gapGuardDailyATR: parseFloat(gapGuardDailyATR) || 1.0,
          gapGuardDailyPct: parseFloat(gapGuardDailyPct) || 4.0,
        }),
      });
      setGapSaveResult({ ok: true, message: 'Saved' });
      setGapDirty(false);
      setTimeout(() => setGapSaveResult(null), 2000);
    } catch (err) {
      setGapSaveResult({ ok: false, message: formatApiError(err, 'Save failed') });
    } finally { setGapSaving(false); }
  };

  return (
    <div className="space-y-6">
      {/* T212 Integration */}
      <div className="card-surface p-6 border border-primary/20">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-primary-400" />
          Trading 212 Integration
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Connect your Trading 212 accounts to sync positions. Invest and ISA use separate API keys.
        </p>

        {/* Environment */}
        <div className="mb-4">
          <label className="block text-sm text-muted-foreground mb-1">Environment</label>
          <select value={t212Environment} onChange={(e) => setT212Environment(e.target.value as 'demo' | 'live')} className="input-field" disabled={t212Connected || t212IsaConnected} title="T212 environment">
            <option value="demo">Paper Trading (Demo)</option>
            <option value="live">Live Trading (Real Money)</option>
          </select>
          {(t212Connected || t212IsaConnected) && <p className="text-xs text-muted-foreground mt-1">Disconnect all accounts to change environment.</p>}
        </div>

        {/* Sync All */}
        {(t212Connected || t212IsaConnected) && (
          <div className="mb-4">
            {t212Error && <div className="mb-3 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{t212Error}</div>}
            {t212Success && <div className="mb-3 p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit flex items-center gap-2"><Check className="w-4 h-4 flex-shrink-0" />{t212Success}</div>}
            <button onClick={handleT212Sync} disabled={t212Syncing} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2">
              {t212Syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {t212Syncing ? 'Syncing...' : 'Sync All Connected Accounts'}
            </button>
          </div>
        )}

        {/* Invest Account */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-primary-400" />Invest Account</h3>
          {t212Connected ? (
            <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-profit animate-pulse" />
                  <span className="text-sm font-medium text-foreground">Connected</span>
                  {t212AccountId && <span className="text-xs text-muted-foreground">Account: {t212AccountId} ({t212Currency}) — {t212Environment.toUpperCase()}</span>}
                </div>
                <button onClick={handleT212Disconnect} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-loss/20 text-loss rounded-lg hover:bg-loss/30 transition-colors"><Unplug className="w-3 h-3" />Disconnect</button>
              </div>
              {t212LastSync && <p className="text-xs text-muted-foreground mt-2">Last synced: {new Date(t212LastSync).toLocaleString()}</p>}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">API Key</label>
                  <div className="relative">
                    <input type={t212ShowKey ? 'text' : 'password'} value={t212ApiKey} onChange={(e) => setT212ApiKey(e.target.value)} placeholder="Invest API Key" className="input-field w-full pr-10 text-sm" />
                    <button onClick={() => setT212ShowKey(!t212ShowKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Toggle visibility">{t212ShowKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">API Secret</label>
                  <div className="relative">
                    <input type={t212ShowSecret ? 'text' : 'password'} value={t212ApiSecret} onChange={(e) => setT212ApiSecret(e.target.value)} placeholder="Invest API Secret" className="input-field w-full pr-10 text-sm" />
                    <button onClick={() => setT212ShowSecret(!t212ShowSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Toggle visibility">{t212ShowSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
              </div>
              <button onClick={handleT212Connect} disabled={t212Connecting || !t212ApiKey || !t212ApiSecret} className={cn('btn-primary flex items-center gap-2 text-sm', (t212Connecting || !t212ApiKey || !t212ApiSecret) && 'opacity-50 cursor-not-allowed')}>
                {t212Connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                {t212Connecting ? 'Connecting...' : 'Connect & Test'}
              </button>
            </>
          )}
        </div>

        {/* ISA Account */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3"><Shield className="w-4 h-4 text-primary-400" />Stocks ISA Account</h3>
          {t212IsaError && <div className="mb-3 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{t212IsaError}</div>}
          {t212IsaSuccess && <div className="mb-3 p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit flex items-center gap-2"><Check className="w-4 h-4 flex-shrink-0" />{t212IsaSuccess}</div>}
          {t212IsaConnected ? (
            <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-profit animate-pulse" />
                  <span className="text-sm font-medium text-foreground">Connected</span>
                  {t212IsaAccountId && <span className="text-xs text-muted-foreground">ISA: {t212IsaAccountId} ({t212IsaCurrency}) — {t212Environment.toUpperCase()}</span>}
                </div>
                <button onClick={handleT212IsaDisconnect} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-loss/20 text-loss rounded-lg hover:bg-loss/30 transition-colors"><Unplug className="w-3 h-3" />Disconnect</button>
              </div>
              {t212IsaLastSync && <p className="text-xs text-muted-foreground mt-2">Last synced: {new Date(t212IsaLastSync).toLocaleString()}</p>}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">ISA API Key</label>
                  <div className="relative">
                    <input type={t212IsaShowKey ? 'text' : 'password'} value={t212IsaApiKey} onChange={(e) => setT212IsaApiKey(e.target.value)} placeholder="ISA API Key" className="input-field w-full pr-10 text-sm" />
                    <button onClick={() => setT212IsaShowKey(!t212IsaShowKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Toggle visibility">{t212IsaShowKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">ISA API Secret</label>
                  <div className="relative">
                    <input type={t212IsaShowSecret ? 'text' : 'password'} value={t212IsaApiSecret} onChange={(e) => setT212IsaApiSecret(e.target.value)} placeholder="ISA API Secret" className="input-field w-full pr-10 text-sm" />
                    <button onClick={() => setT212IsaShowSecret(!t212IsaShowSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Toggle visibility">{t212IsaShowSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
              </div>
              <button onClick={handleT212IsaConnect} disabled={t212IsaConnecting || !t212IsaApiKey || !t212IsaApiSecret} className={cn('btn-primary flex items-center gap-2 text-sm', (t212IsaConnecting || !t212IsaApiKey || !t212IsaApiSecret) && 'opacity-50 cursor-not-allowed')}>
                {t212IsaConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                {t212IsaConnecting ? 'Connecting...' : 'Connect & Test'}
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Generate separate API keys for each account from your Trading 212 app.
          <a href="https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300 ml-1">How to get your API key →</a>
        </p>
      </div>

      {/* T212 History Import */}
      <T212ImportPanel />

      {/* Gap Guard */}
      <div className="card-surface p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-warning" />
            Gap Guard (Anti-Chase)
            {gapDirty && <span className="w-2 h-2 rounded-full bg-warning" title="Unsaved changes" />}
          </h2>
          <div className="flex items-center gap-2">
            {gapSaveResult && <span className={cn('text-xs', gapSaveResult.ok ? 'text-profit' : 'text-loss')}>{gapSaveResult.ok ? '✓' : '✗'} {gapSaveResult.message}</span>}
            <button onClick={handleGapSave} disabled={gapSaving} className="btn-outline text-sm flex items-center gap-1.5">
              {gapSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {gapSaving ? 'Saving...' : 'Save Gap Guard'}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Flags READY candidates that gapped significantly above their entry trigger.</p>

        <div className="mb-4">
          <label className="block text-sm text-muted-foreground mb-2">Apply gap check on</label>
          <div className="flex gap-2">
            <button onClick={() => { setGapGuardMode('ALL'); setGapDirty(true); }} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors border', gapGuardMode === 'ALL' ? 'bg-primary/20 border-primary text-primary-400' : 'border-white/10 text-muted-foreground hover:text-foreground hover:bg-surface-2')}>All trading days<span className="block text-[10px] font-normal mt-0.5 opacity-70">Recommended</span></button>
            <button onClick={() => { setGapGuardMode('MONDAY_ONLY'); setGapDirty(true); }} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors border', gapGuardMode === 'MONDAY_ONLY' ? 'bg-primary/20 border-primary text-primary-400' : 'border-white/10 text-muted-foreground hover:text-foreground hover:bg-surface-2')}>Monday only<span className="block text-[10px] font-normal mt-0.5 opacity-70">Weekend gaps only</span></button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-white/10 bg-surface-2/50">
            <h3 className="text-sm font-semibold text-foreground mb-2">Monday / Weekend Gap</h3>
            <p className="text-[10px] text-muted-foreground mb-3">3-day gap after weekend close</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-muted-foreground mb-1">ATR multiple</label><input type="number" step="0.05" min="0.1" max="5.0" value={gapGuardWeekendATR} onChange={(e) => { setGapGuardWeekendATR(e.target.value); setGapDirty(true); }} className="input-field w-full text-sm" /></div>
              <div><label className="block text-xs text-muted-foreground mb-1">Percent</label><div className="relative"><input type="number" step="0.5" min="0.5" max="20" value={gapGuardWeekendPct} onChange={(e) => { setGapGuardWeekendPct(e.target.value); setGapDirty(true); }} className="input-field w-full text-sm pr-6" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span></div></div>
            </div>
          </div>
          <div className={cn('p-4 rounded-lg border bg-surface-2/50', gapGuardMode === 'ALL' ? 'border-white/10' : 'border-white/5 opacity-40')}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Tuesday–Friday Gap</h3>
            <p className="text-[10px] text-muted-foreground mb-3">1-day gap</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-muted-foreground mb-1">ATR multiple</label><input type="number" step="0.05" min="0.1" max="5.0" value={gapGuardDailyATR} onChange={(e) => { setGapGuardDailyATR(e.target.value); setGapDirty(true); }} className="input-field w-full text-sm" disabled={gapGuardMode === 'MONDAY_ONLY'} /></div>
              <div><label className="block text-xs text-muted-foreground mb-1">Percent</label><div className="relative"><input type="number" step="0.5" min="0.5" max="20" value={gapGuardDailyPct} onChange={(e) => { setGapGuardDailyPct(e.target.value); setGapDirty(true); }} className="input-field w-full text-sm pr-6" disabled={gapGuardMode === 'MONDAY_ONLY'} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span></div></div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">Thresholds flag chase warnings — candidates are <span className="text-warning font-medium">not hard-blocked</span>.</p>
      </div>
    </div>
  );
}
