'use client';

import { PHASE_CONFIG } from '@/types';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { Check, Zap, Shield, Loader2 } from 'lucide-react';

const phaseIcons: Record<string, React.ElementType> = {
  PLANNING: Loader2,
  OBSERVATION: Zap,  // Legacy key — treated as Execution
  EXECUTION: Zap,
  MAINTENANCE: Shield,
};

const phaseColors: Record<string, string> = {
  PLANNING: 'text-primary-400 border-primary/40 bg-primary/10',
  OBSERVATION: 'text-profit border-profit/40 bg-profit/10',
  EXECUTION: 'text-profit border-profit/40 bg-profit/10',
  MAINTENANCE: 'text-blue-400 border-blue-400/40 bg-blue-500/10',
};

const phaseOrder = ['PLANNING', 'OBSERVATION', 'EXECUTION', 'MAINTENANCE'] as const;

export default function PhaseTimeline() {
  const { weeklyPhase } = useStore();

  const currentPhaseIdx = phaseOrder.indexOf(weeklyPhase as typeof phaseOrder[number]);

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">Weekly Rhythm</h3>
      <div className="relative">
        {/* Timeline connector */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-navy-600" />

        <div className="space-y-4">
          {phaseOrder.map((phase, idx) => {
            const config = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG];
            const Icon = phaseIcons[phase];
            const isPast = idx < currentPhaseIdx;
            const isCurrent = idx === currentPhaseIdx;

            return (
              <div key={phase} className="relative pl-14">
                {/* Circle */}
                <div className={cn(
                  'absolute left-3 top-2 w-7 h-7 rounded-full border-2 flex items-center justify-center z-10',
                  isPast
                    ? 'bg-profit/20 border-profit'
                    : isCurrent
                    ? phaseColors[phase] + ' animate-pulse'
                    : 'bg-navy-700 border-navy-500'
                )}>
                  {isPast ? (
                    <Check className="w-4 h-4 text-profit" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>

                {/* Content */}
                <div className={cn(
                  'p-3 rounded-lg border transition-all',
                  isCurrent
                    ? phaseColors[phase] + ' border'
                    : isPast
                    ? 'bg-navy-800/50 border-navy-600 opacity-60'
                    : 'bg-navy-800/30 border-navy-700 opacity-40'
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold">
                      {config.label}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 font-mono">CURRENT</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {config.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
