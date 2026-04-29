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

export default function WeeklyPhaseIndicator() {
  const { weeklyPhase } = useStore();
  const config = PHASE_CONFIG[weeklyPhase];
  const Icon = phaseIcons[weeklyPhase];

  return (
    <div
      className="card-surface p-4 relative overflow-hidden"
      style={{ borderColor: config.color, borderWidth: '1px' }}
    >
      {/* Background glow */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          background: `radial-gradient(ellipse at center, ${config.color} 0%, transparent 70%)`,
        }}
      />

      <div className="relative flex items-center gap-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: config.bgColor }}
        >
          <Icon className="w-6 h-6" style={{ color: config.color }} />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3
              className="text-lg font-bold uppercase tracking-wide"
              style={{ color: config.color }}
            >
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
