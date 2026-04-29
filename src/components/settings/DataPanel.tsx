'use client';

/**
 * DEPENDENCIES
 * Consumed by: /settings page
 * Consumes: /api/settings (GET + PUT)
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: Data section — Market data provider (Yahoo/EODHD), API key config.
 */

import { useState, useEffect, useCallback } from 'react';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Database, Eye, EyeOff, Check, Save, Loader2 } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

export default function DataPanel() {
  const [marketDataProvider, setMarketDataProvider] = useState<'yahoo' | 'eodhd'>('yahoo');
  const [eodhApiKey, setEodhApiKey] = useState('');
  const [eodhApiKeySet, setEodhApiKeySet] = useState(false);
  const [showEodhKey, setShowEodhKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    apiRequest<{ marketDataProvider?: string; eodhApiKeySet?: boolean }>(`/api/settings?userId=${DEFAULT_USER_ID}`)
      .then((data) => {
        if (data.marketDataProvider === 'eodhd') setMarketDataProvider('eodhd');
        if (data.eodhApiKeySet) setEodhApiKeySet(true);
      })
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          marketDataProvider,
          ...(eodhApiKey && !eodhApiKey.startsWith('****') ? { eodhApiKey } : {}),
        }),
      });
      setSaveResult({ ok: true, message: 'Saved' });
      setDirty(false);
      setTimeout(() => setSaveResult(null), 2000);
    } catch (err) {
      setSaveResult({ ok: false, message: formatApiError(err, 'Save failed') });
    } finally {
      setSaving(false);
    }
  }, [marketDataProvider, eodhApiKey]);

  return (
    <div className="card-surface p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Database className="w-5 h-5 text-primary-400" />
          Market Data
          {dirty && <span className="w-2 h-2 rounded-full bg-warning" title="Unsaved changes" />}
        </h2>
        <div className="flex items-center gap-2">
          {saveResult && <span className={cn('text-xs', saveResult.ok ? 'text-profit' : 'text-loss')}>{saveResult.ok ? '✓' : '✗'} {saveResult.message}</span>}
          <button onClick={handleSave} disabled={saving} className="btn-outline text-sm flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving...' : 'Save Data Settings'}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Choose your market data source. Yahoo Finance is free. EODHD requires a paid API key.
      </p>

      {/* Provider toggle */}
      <div className="mb-4">
        <label className="block text-sm text-muted-foreground mb-2">Active Provider</label>
        <div className="flex gap-2">
          <button
            onClick={() => { setMarketDataProvider('yahoo'); setDirty(true); }}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors border', marketDataProvider === 'yahoo' ? 'bg-primary/20 border-primary text-primary-400' : 'border-white/10 text-muted-foreground hover:text-foreground hover:bg-surface-2')}
          >
            Yahoo Finance<span className="block text-[10px] font-normal mt-0.5 opacity-70">Free · No API key</span>
          </button>
          <button
            onClick={() => { if (!eodhApiKeySet && !eodhApiKey) return; setMarketDataProvider('eodhd'); setDirty(true); }}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors border', marketDataProvider === 'eodhd' ? 'bg-primary/20 border-primary text-primary-400' : 'border-white/10 text-muted-foreground hover:text-foreground hover:bg-surface-2', !eodhApiKeySet && !eodhApiKey && 'opacity-50 cursor-not-allowed')}
            title={!eodhApiKeySet && !eodhApiKey ? 'Enter your EODHD API key first' : undefined}
          >
            EODHD<span className="block text-[10px] font-normal mt-0.5 opacity-70">Premium · API key required</span>
          </button>
        </div>
      </div>

      {/* EODHD API Key */}
      <div className="p-4 rounded-lg border border-white/10 bg-surface-2/50">
        <label className="block text-sm text-muted-foreground mb-1">EODHD API Key</label>
        <div className="relative">
          <input
            type={showEodhKey ? 'text' : 'password'}
            value={eodhApiKey}
            onChange={(e) => { setEodhApiKey(e.target.value); if (e.target.value) setEodhApiKeySet(true); setDirty(true); }}
            placeholder={eodhApiKeySet ? '••••••••' : 'Enter your EODHD API key'}
            className="input-field w-full pr-10"
          />
          <button onClick={() => setShowEodhKey(!showEodhKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Toggle visibility">
            {showEodhKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Get an API key at <a href="https://eodhd.com/financial-apis/" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300">eodhd.com →</a>
          {eodhApiKeySet && <span className="ml-2 text-profit"><Check className="w-3 h-3 inline" /> Key configured</span>}
        </p>
      </div>

      {/* Current status */}
      <div className="mt-3 flex items-center gap-2">
        <div className={cn('w-2 h-2 rounded-full', marketDataProvider === 'yahoo' ? 'bg-green-400' : 'bg-blue-400')} />
        <span className="text-xs text-muted-foreground">
          Currently using: <span className="text-foreground font-medium">{marketDataProvider === 'yahoo' ? 'Yahoo Finance' : 'EODHD'}</span>
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Switching providers takes effect after saving. You can switch back to Yahoo at any time.
      </p>
    </div>
  );
}
