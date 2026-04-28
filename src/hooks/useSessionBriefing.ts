'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';

const DEFAULT_USER_ID = 'default-user';

export interface SessionBriefingData {
  session: 'pre-UK' | 'UK' | 'US' | 'post-market';
  regime: string;
  health: string;
  operatingMode: string;
  equity: number;
  usedRiskPct: number;
  maxRiskPct: number;
  availableRiskPct: number;
  usedPositions: number;
  maxPositions: number;
  readyCandidates: Array<{
    ticker: string;
    price: number;
    entryTrigger: number;
    sleeve: string;
  }>;
  openPositionCount: number;
  isHoliday: boolean;
  holidayLabel?: string;
  earlyClose?: string;
}

/**
 * Hook that provides session briefing data for the current trading session.
 * Fetches from /api/modules and /api/system-status to build a consolidated view.
 * Suitable for the Plan page or any component needing pre-session context.
 */
export function useSessionBriefing(): {
  data: SessionBriefingData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<SessionBriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBriefing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Determine current session based on UK hour
      const now = new Date();
      const ukHour = parseInt(
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false })
          .format(now),
        10
      );
      const session: SessionBriefingData['session'] =
        ukHour < 8 ? 'pre-UK' : ukHour < 14 ? 'UK' : ukHour < 20 ? 'US' : 'post-market';

      // Fetch modules data (has regime, positions, candidates, risk budget)
      const modules = await apiRequest<{
        regime?: string;
        healthOverall?: string;
        openPositions?: Array<{ ticker: string; sleeve: string }>;
        riskBudget?: { usedRiskPercent: number; maxRiskPercent: number; availableRiskPercent: number; usedPositions: number; maxPositions: number };
        readyCandidates?: Array<{ ticker: string; currentPrice: number; entryTrigger: number; sleeve: string }>;
      }>(`/api/modules?userId=${DEFAULT_USER_ID}`);

      // Fetch system status for operating mode and equity
      const status = await apiRequest<{
        operatingMode?: string;
        riskProfile?: string;
        checks?: Array<{ id: string; value: string }>;
      }>('/api/system-status');

      const equityCheck = status.checks?.find(c => c.id === 'equity');
      const equity = equityCheck ? parseFloat(equityCheck.value.replace('£', '').replace(',', '')) : 0;

      const isUKSession = session === 'pre-UK' || session === 'UK';
      const filteredCandidates = (modules.readyCandidates ?? []).filter(c =>
        isUKSession ? c.ticker.endsWith('.L') : !c.ticker.endsWith('.L')
      );

      setData({
        session,
        regime: modules.regime ?? 'UNKNOWN',
        health: modules.healthOverall ?? 'UNKNOWN',
        operatingMode: status.operatingMode ?? 'NORMAL',
        equity,
        usedRiskPct: modules.riskBudget?.usedRiskPercent ?? 0,
        maxRiskPct: modules.riskBudget?.maxRiskPercent ?? 0,
        availableRiskPct: modules.riskBudget?.availableRiskPercent ?? 0,
        usedPositions: modules.riskBudget?.usedPositions ?? 0,
        maxPositions: modules.riskBudget?.maxPositions ?? 0,
        readyCandidates: filteredCandidates.map(c => ({
          ticker: c.ticker,
          price: c.currentPrice,
          entryTrigger: c.entryTrigger,
          sleeve: c.sleeve,
        })),
        openPositionCount: modules.openPositions?.length ?? 0,
        isHoliday: false, // Would need market-holidays import — keep simple for now
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBriefing(); }, [fetchBriefing]);

  return { data, loading, error, refresh: fetchBriefing };
}
