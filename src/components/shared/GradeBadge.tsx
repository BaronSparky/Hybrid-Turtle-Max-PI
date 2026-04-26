'use client';

/**
 * Grade badge for scan candidates.
 * Displays A/B/C/BLOCKED grade with color and optional tooltip explanation.
 */

import { cn } from '@/lib/utils';
import type { CandidateGrade } from '@/lib/candidate-grade';
import { gradeLabel, gradeColor } from '@/lib/candidate-grade';

interface GradeBadgeProps {
  grade: CandidateGrade;
  reason?: string;
  size?: 'sm' | 'md';
}

export default function GradeBadge({ grade, reason, size = 'sm' }: GradeBadgeProps) {
  const colors = gradeColor(grade);
  const label = gradeLabel(grade);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded font-bold border',
        colors.bg, colors.text, colors.border,
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1',
      )}
      title={reason}
    >
      {label}
    </span>
  );
}
