'use client';

import { cn } from '@/lib/utils';
import {
  Zap,
  TrendingUp,
  ArrowRightLeft,
  Trash2,
  Shield,
  Pause,
  Ban,
} from 'lucide-react';
import type { AcceleratorRecommendation } from '@/types';

interface AcceleratorCardProps {
  recommendations: AcceleratorRecommendation[];
}

const ACTION_CONFIG: Record<string, {
  icon: typeof Zap;
  label: string;
  color: string;
  bg: string;
  border: string;
}> = {
  BUY_NEW_A_GRADE: {
    icon: Zap,
    label: 'Buy A-Grade',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  PYRAMID_WINNER: {
    icon: TrendingUp,
    label: 'Pyramid',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  SWAP_WEAK_FOR_STRONG: {
    icon: ArrowRightLeft,
    label: 'Swap',
    color: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  EXIT_LAGGARD: {
    icon: Trash2,
    label: 'Exit',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  TIGHTEN_STOP: {
    icon: Shield,
    label: 'Tighten',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
  },
  HOLD: {
    icon: Pause,
    label: 'Hold',
    color: 'text-muted-foreground',
    bg: 'bg-navy-700/20',
    border: 'border-border',
  },
  NO_ACTION: {
    icon: Ban,
    label: 'No Action',
    color: 'text-muted-foreground',
    bg: 'bg-navy-700/20',
    border: 'border-border',
  },
};

const URGENCY_STYLES: Record<string, string> = {
  HIGH: 'bg-red-500/20 text-red-400 border-red-500/30',
  MEDIUM: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  LOW: 'bg-navy-600/30 text-muted-foreground border-border',
};

export default function AcceleratorCard({ recommendations }: AcceleratorCardProps) {
  const actionable = recommendations.filter(
    (r) => r.action !== 'HOLD' && r.action !== 'NO_ACTION'
  );
  const holds = recommendations.filter((r) => r.action === 'HOLD');

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary-400" />
        Capital Priority
        {actionable.length > 0 && (
          <span className="ml-auto text-xs font-mono bg-primary-500/15 text-primary-400 px-2 py-0.5 rounded">
            {actionable.length} action{actionable.length !== 1 ? 's' : ''}
          </span>
        )}
      </h3>

      {recommendations.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4 bg-navy-700/20 rounded-lg">
          No data available
        </div>
      )}

      {/* Actionable recommendations */}
      {actionable.length > 0 && (
        <div className="space-y-2 mb-3">
          {actionable.map((rec, i) => {
            const config = ACTION_CONFIG[rec.action] ?? ACTION_CONFIG.NO_ACTION;
            const Icon = config.icon;

            return (
              <div
                key={`${rec.action}-${rec.ticker}-${i}`}
                className={cn('rounded-lg p-3 border', config.bg, config.border)}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-4 h-4', config.color)} />
                    <span className={cn('text-sm font-semibold', config.color)}>
                      {rec.ticker}
                      {rec.replacementTicker && (
                        <span className="text-muted-foreground mx-1">→</span>
                      )}
                      {rec.replacementTicker && (
                        <span className="text-emerald-400">{rec.replacementTicker}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                      URGENCY_STYLES[rec.urgency]
                    )}>
                      {rec.urgency}
                    </span>
                    <span className={cn(
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                      config.bg, config.color
                    )}>
                      {config.label}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-foreground mb-1">{rec.reason}</div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] mt-2">
                  <div className="text-muted-foreground">Benefit</div>
                  <div>{rec.expectedBenefit}</div>
                  <div className="text-muted-foreground">Risk</div>
                  <div>{rec.riskImpact}</div>
                </div>

                {rec.requiresApproval && (
                  <div className="mt-2 text-[10px] text-amber-300/70 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Requires human approval
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Holds (collapsed summary) */}
      {holds.length > 0 && (
        <div className="text-[11px] text-muted-foreground bg-navy-700/20 rounded-lg p-2.5">
          <span className="font-semibold">Holding:</span>{' '}
          {holds.map((h) => h.ticker).join(', ')}
          <span className="ml-1 text-muted-foreground/70">
            — no action needed
          </span>
        </div>
      )}

      {/* No action state */}
      {recommendations.length === 1 && recommendations[0].action === 'NO_ACTION' && (
        <div className="text-xs text-muted-foreground text-center py-4 bg-navy-700/20 rounded-lg">
          {recommendations[0].reason}
        </div>
      )}
    </div>
  );
}
