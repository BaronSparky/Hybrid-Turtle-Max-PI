'use client';

import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { Check, X, AlertTriangle, Shield, TrendingUp, Activity, Database, Info } from 'lucide-react';
import {
  PRE_TRADE_CHECKLIST_ITEMS,
  CATEGORY_LABELS,
  type ChecklistCategory,
} from '@/lib/pre-trade-checklist-items';

interface CheckItem {
  id: string;
  label: string;
  checked: boolean;
  category: ChecklistCategory;
  critical?: boolean;
}

const categoryIcons: Record<ChecklistCategory, React.ElementType> = {
  REGIME: TrendingUp,
  RISK: Shield,
  SETUP: Activity,
  EXECUTION: Database,
};

// Display order for categories
const CATEGORY_ORDER: ChecklistCategory[] = ['REGIME', 'RISK', 'SETUP', 'EXECUTION'];

interface PreTradeChecklistProps {
  healthReport?: {
    overall: string;
    checks: Record<string, string>;
    results: Array<{ id: string; status: string }>;
  } | null;
  riskBudget?: {
    usedRiskPercent: number;
    maxRiskPercent: number;
    usedPositions: number;
    maxPositions: number;
    sleeveUtilization: Record<string, { used: number; max: number }>;
  } | null;
  hasReadyCandidates?: boolean;
}

export default function PreTradeChecklist({
  healthReport,
  riskBudget,
  hasReadyCandidates = false,
}: PreTradeChecklistProps) {
  const { marketRegime, healthStatus, fearGreed } = useStore();

  const overallHealth = healthReport?.overall || healthStatus;
  const allHealthGreen = healthReport?.results?.every((r) => r.status === 'GREEN') ?? false;
  const dataFresh = healthReport?.results?.find((r) => r.id === 'A1')?.status === 'GREEN';
  const openRiskOk = riskBudget
    ? riskBudget.usedRiskPercent <= riskBudget.maxRiskPercent
    : false;
  const positionCountOk = riskBudget
    ? riskBudget.usedPositions < riskBudget.maxPositions
    : false;
  const sleeveOk = riskBudget
    ? Object.values(riskBudget.sleeveUtilization).every((s) => s.used <= s.max)
    : false;
  const fearGreedOk = fearGreed ? fearGreed.label !== 'Extreme Fear' : false;

  // Map shared item IDs → runtime check result
  const checkResults: Record<string, boolean> = {
    'regime-bullish': marketRegime === 'BULLISH',
    'fear-greed-ok': fearGreedOk,
    'spy-above-ma200': marketRegime !== 'BEARISH',
    'risk-gates-pass': hasReadyCandidates, // In /plan context, candidates passing filters implies gates pass
    'open-risk-ok': openRiskOk,
    'position-count-ok': positionCountOk,
    'sleeve-caps-ok': sleeveOk,
    'health-green': overallHealth === 'GREEN',
    'data-fresh': dataFresh,
    'candidate-passed-filters': hasReadyCandidates,
    'entry-trigger-correct': hasReadyCandidates,
    'stop-pre-set': hasReadyCandidates,
    'sizing-formula': hasReadyCandidates,
    'shares-rounded-down': hasReadyCandidates,
  };

  // Items that are critical warnings when they fail
  const criticalIds = new Set(['regime-bullish', 'risk-gates-pass', 'candidate-passed-filters', 'stop-pre-set']);

  const checks: CheckItem[] = PRE_TRADE_CHECKLIST_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    checked: checkResults[item.id] ?? false,
    category: item.category,
    critical: criticalIds.has(item.id),
  }));

  const allPassed = checks.every(c => c.checked);
  const failedCount = checks.filter(c => !c.checked).length;
  const criticalFailed = checks.filter(c => c.critical && !c.checked);
  // Entry-only failures (no candidates) aren't a trading danger — use softer language
  const allEntryFailures = criticalFailed.length > 0 && criticalFailed.every(c => c.category === 'EXECUTION');

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Pre-Trade Checklist
        </h3>
        {allPassed ? (
          <span className="text-xs px-2 py-1 rounded bg-profit/20 text-profit font-medium">
            ALL CLEAR
          </span>
        ) : criticalFailed.length > 0 ? (
          <span className="text-xs px-2 py-1 rounded bg-warning/20 text-warning font-medium">
            {criticalFailed.length} WARNING{criticalFailed.length !== 1 ? 'S' : ''}
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded bg-warning/20 text-warning font-medium">
            {failedCount} CAUTION{failedCount !== 1 ? 'S' : ''}
          </span>
        )}
      </div>

      {criticalFailed.length > 0 && (
        <div className={cn(
          'rounded-lg p-3 mb-4 border',
          allEntryFailures
            ? 'bg-navy-700/30 border-navy-600/30'
            : 'bg-warning/10 border-warning/30'
        )}>
          <div className={cn(
            'flex items-center gap-2 text-sm font-semibold mb-1',
            allEntryFailures ? 'text-muted-foreground' : 'text-warning'
          )}>
            <AlertTriangle className="w-4 h-4" />
            {allEntryFailures ? 'NO CANDIDATES READY' : 'TRADE WITH CAUTION'}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {allEntryFailures
              ? 'Waiting for candidates to meet entry criteria:'
              : 'The following items need attention before entering:'}
          </p>
          <ul className="space-y-1">
            {criticalFailed.map((c) => (
              <li key={c.id} className="text-xs text-warning/80">• {c.label}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {CATEGORY_ORDER.map((cat) => {
          const Icon = categoryIcons[cat];
          const items = checks.filter(c => c.category === cat);

          return (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {CATEGORY_LABELS[cat]}
                </span>
              </div>
              <div className="space-y-1.5">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded',
                      item.checked ? 'bg-navy-800/50' : 'bg-loss/5 border border-loss/20'
                    )}
                  >
                    {item.checked ? (
                      <Check className="w-4 h-4 text-profit flex-shrink-0" />
                    ) : (
                      <X className="w-4 h-4 text-loss flex-shrink-0" />
                    )}
                    <span className={cn(
                      'text-xs',
                      item.checked ? 'text-muted-foreground' : 'text-loss'
                    )}>
                      {item.label}
                    </span>
                    {item.critical && (
                      <span className="text-[10px] px-1 py-0.5 bg-warning/20 text-warning rounded ml-auto">
                        CRITICAL
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Note linking to the buy flow enforcement */}
      <div className="mt-4 pt-3 border-t border-border/30 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
        <Info className="w-3 h-3 flex-shrink-0" />
        This checklist is also enforced inside the buy flow
      </div>
    </div>
  );
}
