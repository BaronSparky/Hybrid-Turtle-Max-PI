'use client';

import { useStore } from '@/store/useStore';
import { PHASE_CONFIG } from '@/types';
import type { WeeklyPhase } from '@/types';
import { cn } from '@/lib/utils';
import { Calendar, Zap, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const phaseIcons: Record<WeeklyPhase, LucideIcon> = {
  PLANNING: Calendar,
  OBSERVATION: Zap,  // Legacy key — mapped to Execution
  EXECUTION: Zap,
  MAINTENANCE: Wrench,
};

const phaseStyles: Record<WeeklyPhase, { border: string; glow: string; iconBg: string; text: string }> = {
  PLANNING: {
    border: 'border-violet-500',
    glow: 'bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.35)_0%,transparent_70%)]',
    iconBg: 'bg-violet-500/15',
    text: 'text-violet-400',
  },
  OBSERVATION: {
    border: 'border-emerald-500',
    glow: 'bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.35)_0%,transparent_70%)]',
    iconBg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
  },
  EXECUTION: {
    border: 'border-emerald-500',
    glow: 'bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.35)_0%,transparent_70%)]',
    iconBg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
  },
  MAINTENANCE: {
    border: 'border-blue-500',
    glow: 'bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.35)_0%,transparent_70%)]',
    iconBg: 'bg-blue-500/15',
    text: 'text-blue-400',
  },
};

export default function WeeklyPhaseIndicator() {
  const { weeklyPhase } = useStore();
  const config = PHASE_CONFIG[weeklyPhase];
  const Icon = phaseIcons[weeklyPhase];
  const styles = phaseStyles[weeklyPhase];

  return (
    <div className={cn('card-surface p-4 relative overflow-hidden border', styles.border)}>
      {/* Background glow */}
      <div className={cn('absolute inset-0 opacity-30', styles.glow)} />

      <div className="relative flex items-center gap-4">
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', styles.iconBg)}>
          <Icon className={cn('w-6 h-6', styles.text)} />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className={cn('text-lg font-bold uppercase tracking-wide', styles.text)}>
              {config.label}
            </h3>
            <span className="text-xs text-muted-foreground px-2 py-0.5 bg-navy-800 rounded-full">
              {config.dayLabel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {config.description}
          </p>
        </div>
      </div>
    </div>
  );
}
