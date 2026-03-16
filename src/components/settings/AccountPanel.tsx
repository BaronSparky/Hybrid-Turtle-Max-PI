'use client';

/**
 * DEPENDENCIES
 * Consumed by: /settings page
 * Consumes: /api/settings (GET + PUT), useStore (riskProfile + equity)
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: Account section — risk profile, equity, starting equity override.
 *        Saves independently from other sections.
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { RISK_PROFILES, type RiskProfileType } from '@/types';
import { apiRequest } from '@/lib/api-client';
import { cn, formatCurrency, formatPercent } from '@/lib/utils';
import { DollarSign, Save, Check, Loader2 } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

export default function AccountPanel() {
  const { riskProfile, setRiskProfile, equity, setEquity } = useStore();
  const [equityInput, setEquityInput] = useState(equity.toString());
  const [startingEquityOverride, setStartingEquityOverride] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const profile = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES];

  // Load saved startingEquityOverride on mount
  useEffect(() => {
    apiRequest<{ startingEquityOverride?: number | null }>(`/api/settings?userId=${DEFAULT_USER_ID}`)
      .then((data) => {
        if (data.startingEquityOverride != null) {
          setStartingEquityOverride(data.startingEquityOverride.toString());
        }
      })
      .catch(() => {});
  }, []);

  // Sync equity input when store changes (e.g. from T212 sync)
  useEffect(() => {
    setEquityInput(equity.toString());
  }, [equity]);

  const handleSave = useCallback(async () => {
    const newEquity = parseFloat(equityInput);
    if (!isNaN(newEquity) && newEquity > 0) {
      setEquity(newEquity);
    }
    setSaving(true);
    setSaveResult(null);
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          riskProfile,
          equity: !isNaN(newEquity) && newEquity > 0 ? newEquity : equity,
          startingEquityOverride: startingEquityOverride.trim()
            ? parseFloat(startingEquityOverride) || null
            : null,
        }),
      });
      setSaveResult({ ok: true, message: 'Saved' });
      setDirty(false);
      setTimeout(() => setSaveResult(null), 2000);
    } catch (err) {
      setSaveResult({ ok: false, message: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }, [equityInput, riskProfile, equity, startingEquityOverride, setEquity]);

  return (
    <div className="card-surface p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-primary-400" />
          Account
          {dirty && <span className="w-2 h-2 rounded-full bg-warning" title="Unsaved changes" />}
        </h2>
        <div className="flex items-center gap-2">
          {saveResult && (
            <span className={cn('text-xs', saveResult.ok ? 'text-profit' : 'text-loss')}>
              {saveResult.ok ? '✓' : '✗'} {saveResult.message}
            </span>
          )}
          <button onClick={handleSave} disabled={saving} className="btn-outline text-sm flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saveResult?.ok ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving...' : 'Save Account'}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Risk profile, equity, and performance baseline</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Account Equity</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
            <input
              type="number"
              value={equityInput}
              onChange={(e) => { setEquityInput(e.target.value); setDirty(true); }}
              className="input-field pl-7 w-full"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Risk per trade: {formatCurrency(parseFloat(equityInput || '0') * profile.riskPerTrade / 100)}
          </p>
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Risk Profile</label>
          <select
            value={riskProfile}
            onChange={(e) => { setRiskProfile(e.target.value as RiskProfileType); setDirty(true); }}
            className="input-field w-full"
            title="Select risk profile"
          >
            {(Object.entries(RISK_PROFILES) as [RiskProfileType, typeof RISK_PROFILES[RiskProfileType]][]).map(([key, p]) => (
              <option key={key} value={key}>
                {p.name} ({p.riskPerTrade}% / {p.maxPositions} pos)
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Max positions: {profile.maxPositions} · Max total risk: {formatPercent(profile.maxOpenRisk)}
          </p>
        </div>
      </div>

      {/* Profile parameters display */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Risk/trade: <strong className="text-foreground">{profile.riskPerTrade}%</strong></span>
        <span>Max positions: <strong className="text-foreground">{profile.maxPositions}</strong></span>
        <span>Max open risk: <strong className="text-foreground">{profile.maxOpenRisk}%</strong></span>
      </div>

      {/* Starting equity override */}
      <div className="mt-4 pt-4 border-t border-border/30">
        <label className="block text-sm text-muted-foreground mb-1">Starting equity override</label>
        <div className="relative max-w-xs">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
          <input
            type="number"
            value={startingEquityOverride}
            onChange={(e) => { setStartingEquityOverride(e.target.value); setDirty(true); }}
            placeholder="Leave blank to use first snapshot"
            className="input-field pl-7 w-full"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Used as baseline for performance calculations. Leave blank to use the earliest nightly snapshot.
        </p>
      </div>
    </div>
  );
}
