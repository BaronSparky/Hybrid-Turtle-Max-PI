'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/shared/Navbar';
import EquityCurveChart from '@/components/dashboard/EquityCurveChart';
import TradeHistoryChart from '@/components/dashboard/TradeHistoryChart';
import RegimeHistoryChart from '@/components/dashboard/RegimeHistoryChart';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { BarChart3, TrendingUp, Award, Loader2 } from 'lucide-react';

interface Scoreboard {
  totalClosedTrades: number;
  totalRealisedR: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyPerTrade: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  avgHoldDays: number | null;
  grade: string;
  gradeReason: string;
  sampleSizeWarning: string | null;
}

const GRADE_COLORS: Record<string, string> = {
  A: 'text-profit bg-profit/20',
  B: 'text-blue-400 bg-blue-400/20',
  C: 'text-warning bg-warning/20',
  D: 'text-orange-400 bg-orange-400/20',
  F: 'text-loss bg-loss/20',
};

export default function PerformancePage() {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchScoreboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<Scoreboard>('/api/performance/scoreboard');
      setScoreboard(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchScoreboard(); }, [fetchScoreboard]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-foreground">Performance</h1>
        </div>

        {/* Scoreboard */}
        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading scoreboard...</span>
          </div>
        ) : scoreboard ? (
          <div className="card-surface p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Award className="w-5 h-5 text-primary-400" />
                System Scoreboard
              </h2>
              <span className={cn('text-2xl font-bold px-3 py-1 rounded-lg', GRADE_COLORS[scoreboard.grade] || 'text-muted-foreground')}>
                {scoreboard.grade}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{scoreboard.gradeReason}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              <StatCard label="Closed Trades" value={String(scoreboard.totalClosedTrades)} />
              <StatCard label="Win Rate" value={`${scoreboard.winRate.toFixed(0)}%`} color={scoreboard.winRate >= 50 ? 'text-profit' : 'text-loss'} />
              <StatCard label="Expectancy" value={`${scoreboard.expectancyPerTrade >= 0 ? '+' : ''}${scoreboard.expectancyPerTrade.toFixed(2)}R`} color={scoreboard.expectancyPerTrade >= 0 ? 'text-profit' : 'text-loss'} />
              <StatCard label="Total R" value={`${scoreboard.totalRealisedR >= 0 ? '+' : ''}${scoreboard.totalRealisedR.toFixed(1)}R`} color={scoreboard.totalRealisedR >= 0 ? 'text-profit' : 'text-loss'} />
              <StatCard label="Profit Factor" value={scoreboard.profitFactor ? scoreboard.profitFactor.toFixed(2) : '—'} />
              <StatCard label="Max Drawdown" value={`${scoreboard.maxDrawdownPct.toFixed(1)}%`} color="text-warning" />
              <StatCard label="Avg Win" value={`+${scoreboard.avgWinR.toFixed(1)}R`} color="text-profit" />
              <StatCard label="Avg Loss" value={`${scoreboard.avgLossR.toFixed(1)}R`} color="text-loss" />
              <StatCard label="Avg Hold" value={scoreboard.avgHoldDays ? `${scoreboard.avgHoldDays.toFixed(0)}d` : '—'} />
              <StatCard label="Current DD" value={`${scoreboard.currentDrawdownPct.toFixed(1)}%`} color={scoreboard.currentDrawdownPct > 5 ? 'text-loss' : 'text-muted-foreground'} />
              <StatCard label="Wins" value={String(scoreboard.winCount)} color="text-profit" />
              <StatCard label="Losses" value={String(scoreboard.lossCount)} color="text-loss" />
            </div>

            {scoreboard.sampleSizeWarning && (
              <div className="mt-4 text-xs text-warning bg-warning/10 px-3 py-2 rounded-lg">
                ⚠ {scoreboard.sampleSizeWarning}
              </div>
            )}
          </div>
        ) : null}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <EquityCurveChart />
          <TradeHistoryChart />
        </div>

        <RegimeHistoryChart />
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-navy-900/50 rounded-lg p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={cn('text-lg font-mono font-semibold mt-1', color || 'text-foreground')}>{value}</div>
    </div>
  );
}
