'use client';

import { useState, useEffect, useMemo } from 'react';
import { cn, formatCurrency } from '@/lib/utils';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { Bird, Loader2, AlertTriangle, TrendingUp, Volume2, Download, ArrowUpDown } from 'lucide-react';

const EB_STORAGE_KEY = 'earlyBird_cache';

type SortMode = 'graduation' | 'riskEfficiency' | 'stable' | 'range';

const SORT_LABELS: Record<SortMode, string> = {
  graduation: 'Most likely to trigger',
  riskEfficiency: 'Best risk efficiency',
  stable: 'Most stable (low ATR%)',
  range: 'Range position',
};

interface EarlyBirdSignal {
  ticker: string;
  name: string;
  price: number;
  fiftyFiveDayHigh: number;
  rangePctile: number;
  volumeRatio: number;
  regime: string;
  eligible: boolean;
  reason: string;
  adx: number;
  atrPercent: number;
  ma200Distance: number;
  graduationProbability: number;
  riskEfficiency: number;
  entryTrigger: number;
  candidateStop: number;
  bps: number | null;
}

interface EarlyBirdResponse {
  regime: string;
  signals: EarlyBirdSignal[];
  message: string;
  scannedCount: number;
  cachedAt?: string;
}

/** Save Early Bird results to localStorage so they survive HMR / server restarts */
function saveToLocal(result: EarlyBirdResponse): void {
  try {
    localStorage.setItem(EB_STORAGE_KEY, JSON.stringify(result));
  } catch { /* storage full or unavailable — non-critical */ }
}

/** Load Early Bird results from localStorage fallback */
function loadFromLocal(): EarlyBirdResponse | null {
  try {
    const raw = localStorage.getItem(EB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EarlyBirdResponse;
    // Only use if it has a cachedAt timestamp
    return parsed.cachedAt ? parsed : null;
  } catch {
    return null;
  }
}

export default function EarlyBirdWidget() {
  const [data, setData] = useState<EarlyBirdResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('graduation');

  // Sorted signals derived from current sort mode
  const sortedSignals = useMemo(() => {
    if (!data?.signals.length) return [];
    const copy = [...data.signals];
    switch (sortMode) {
      case 'graduation':
        return copy.sort((a, b) => b.graduationProbability - a.graduationProbability);
      case 'riskEfficiency':
        // Lower is better — ascending sort
        return copy.sort((a, b) => a.riskEfficiency - b.riskEfficiency);
      case 'stable':
        // Lower ATR% is more stable — ascending sort
        return copy.sort((a, b) => a.atrPercent - b.atrPercent);
      case 'range':
      default:
        return copy.sort((a, b) => b.rangePctile - a.rangePctile);
    }
  }, [data?.signals, sortMode]);

  // Load cached results on mount — try server cache first, fall back to localStorage
  useEffect(() => {
    let cancelled = false;

    async function loadCached() {
      try {
        // cacheOnly=true → server returns cached data or 204 (no scan triggered)
        const res = await fetch('/api/modules/early-bird?cacheOnly=true');
        if (res.ok) {
          const result: EarlyBirdResponse = await res.json();
          if (!cancelled && result.cachedAt) {
            setData(result);
            saveToLocal(result);
            return;
          }
        }
      } catch {
        // Server cache unavailable — fall through to localStorage
      }

      // Fallback: restore from localStorage
      if (!cancelled) {
        const local = loadFromLocal();
        if (local) setData(local);
      }
    }

    loadCached();
    return () => { cancelled = true; };
  }, []);

  // Run Scan always forces a fresh scan
  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<EarlyBirdResponse>('/api/modules/early-bird?refresh=true');
      setData(result);
      saveToLocal(result);
    } catch (err) {
      setError(formatApiError(err, 'Scan failed'));
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = () => {
    if (!sortedSignals.length) return;
    const headers = ['Ticker','Name','Price','55d High','Range %','Volume Ratio','ADX','ATR%','MA200 Dist%','Grad Prob','Risk Eff','BPS','Entry Trigger','Stop','Regime','Reason'];
    const rows = sortedSignals.map(s => [
      s.ticker, s.name, s.price, s.fiftyFiveDayHigh,
      s.rangePctile.toFixed(1), s.volumeRatio.toFixed(2),
      s.adx.toFixed(1), s.atrPercent.toFixed(2), s.ma200Distance.toFixed(1),
      s.graduationProbability, s.riskEfficiency.toFixed(2),
      s.bps ?? '', s.entryTrigger.toFixed(2), s.candidateStop.toFixed(2),
      s.regime, s.reason,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `early-bird-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Bird className="w-4 h-4 text-amber-400" />
          Early Bird Entry
        </h3>
        <div className="flex items-center gap-2">
          {sortedSignals.length > 0 && (
            <button
              onClick={downloadCsv}
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground bg-navy-700 hover:bg-navy-600 border border-navy-600 transition-colors"
              title="Download Early Bird results as CSV"
            >
              <Download className="w-3 h-3" />
              CSV
            </button>
          )}
          {sortedSignals.length > 1 && (
            <div className="relative">
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="appearance-none pl-5 pr-2 py-1 rounded text-[10px] font-medium text-muted-foreground bg-navy-700 border border-navy-600 hover:bg-navy-600 transition-colors cursor-pointer"
                title="Sort early birds"
              >
                {Object.entries(SORT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <ArrowUpDown className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          )}
          <button
            onClick={runScan}
            disabled={loading}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              loading
                ? 'bg-navy-700 text-muted-foreground cursor-not-allowed'
                : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'
            )}
          >
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Scanning...
              </>
            ) : data ? (
              'Rescan'
            ) : (
              'Run Scan'
            )}
          </button>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mb-3">
        Catches early momentum moves before ADX confirms — top 10% of 55d range + volume surge + bullish regime.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Regime status */}
          <div className="text-[10px] text-muted-foreground mb-2">
            Regime: <span className={cn(
              'font-semibold',
              data.regime === 'BULLISH' ? 'text-emerald-400' : data.regime === 'BEARISH' ? 'text-red-400' : 'text-amber-400'
            )}>{data.regime}</span>
            {data.scannedCount > 0 && <span> · {data.scannedCount} tickers scanned</span>}
            {data.cachedAt && (
              <span> · Scanned {new Date(data.cachedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>

          {data.signals.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">
              {data.regime !== 'BULLISH'
                ? `Regime is ${data.regime} — Early Bird requires BULLISH`
                : 'No Early Bird candidates found'}
            </div>
          ) : (
            <div className="space-y-2">
              {sortedSignals.map((s) => (
                <div
                  key={s.ticker}
                  className="bg-navy-800 rounded-lg p-3 border border-amber-500/20"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-amber-400 font-bold text-sm">{s.ticker}</span>
                    <span className="text-[10px] text-muted-foreground">{s.name}</span>
                  </div>
                  <div className="grid grid-cols-6 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Price</span>
                      <div className="font-mono text-foreground">{formatCurrency(s.price)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Range
                      </span>
                      <div className="font-mono text-amber-400">{s.rangePctile.toFixed(0)}%</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Volume2 className="w-3 h-3" /> Vol
                      </span>
                      <div className="font-mono text-emerald-400">{s.volumeRatio.toFixed(1)}×</div>
                    </div>
                    {/* Graduation Probability */}
                    <div>
                      <span className="text-muted-foreground">Grad%</span>
                      <div className={cn(
                        'font-mono font-semibold',
                        s.graduationProbability >= 70 ? 'text-emerald-400' :
                        s.graduationProbability >= 45 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {s.graduationProbability}
                      </div>
                    </div>
                    {/* Risk Efficiency — lower is better */}
                    <div>
                      <span className="text-muted-foreground">Risk Eff</span>
                      <div className={cn(
                        'font-mono font-semibold',
                        s.riskEfficiency <= 1.5 ? 'text-emerald-400' :
                        s.riskEfficiency <= 2.0 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {s.riskEfficiency.toFixed(2)}
                      </div>
                    </div>
                    {/* BPS — Breakout Probability Score (0–19, higher = better) */}
                    {s.bps != null && (
                      <div>
                        <span className="text-muted-foreground">BPS</span>
                        <div className={cn(
                          'font-mono font-semibold',
                          s.bps >= 14 ? 'text-emerald-400' :
                          s.bps >= 10 ? 'text-blue-400' :
                          s.bps >= 6 ? 'text-amber-400' : 'text-muted-foreground'
                        )}>
                          {s.bps}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Secondary row: ADX, ATR%, MA200 dist, entry/stop */}
                  <div className="grid grid-cols-5 gap-2 text-[10px] mt-1.5 text-muted-foreground">
                    <div>ADX <span className="text-foreground font-mono">{s.adx.toFixed(0)}</span></div>
                    <div>ATR% <span className="text-foreground font-mono">{s.atrPercent.toFixed(1)}</span></div>
                    <div>MA200 <span className="text-foreground font-mono">+{s.ma200Distance.toFixed(1)}%</span></div>
                    <div>Trig <span className="text-foreground font-mono">{formatCurrency(s.entryTrigger)}</span></div>
                    <div>Stop <span className="text-foreground font-mono">{formatCurrency(s.candidateStop)}</span></div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-muted-foreground italic">
                    {s.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!data && !loading && !error && (
        <div className="text-center py-4 text-muted-foreground text-xs">
          Click &quot;Run Scan&quot; to check for early entries
        </div>
      )}
    </div>
  );
}
