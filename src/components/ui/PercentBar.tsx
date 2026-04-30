'use client';

import { cn } from '@/lib/utils';

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

interface PercentBarProps {
  value: number;
  className?: string;
  fillClassName: string;
  trackClassName?: string;
  title?: string;
}

export function PercentBar({
  value,
  className,
  fillClassName,
  trackClassName = 'fill-navy-700',
  title,
}: PercentBarProps) {
  const pct = clampPercent(value);

  return (
    <svg className={cn('block h-full w-full rounded-full', className)} viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      {title ? <title>{title}</title> : null}
      <rect x="0" y="0" width="100" height="8" rx="4" className={trackClassName} />
      <rect x="0" y="0" width={`${pct}%`} height="8" rx="4" className={fillClassName} />
    </svg>
  );
}

interface PercentColumnProps {
  value: number;
  minVisible?: number;
  className?: string;
  fillClassName: string;
  title?: string;
}

export function PercentColumn({
  value,
  minVisible = 0,
  className,
  fillClassName,
  title,
}: PercentColumnProps) {
  const pct = Math.max(minVisible, clampPercent(value));
  const y = 100 - pct;

  return (
    <svg className={cn('block h-full w-full', className)} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {title ? <title>{title}</title> : null}
      <rect x="0" y={`${y}%`} width="100" height={`${pct}%`} rx="8" className={fillClassName} />
    </svg>
  );
}
