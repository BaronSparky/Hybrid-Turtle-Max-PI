'use client';

import { cn } from '@/lib/utils';
import type { EntryQuality } from '@/types';

interface EntryQualityBadgeProps {
  entryQuality: EntryQuality;
  priceCurrency?: string;
  compact?: boolean;
}

const QUALITY_STYLES: Record<string, string> = {
  GREEN: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  YELLOW: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  RED: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const DECISION_LABELS: Record<string, string> = {
  BUY_NOW: 'BUY',
  WAIT: 'WAIT',
  MISSED: 'MISSED',
};

export default function EntryQualityBadge({
  entryQuality,
  priceCurrency,
  compact = false,
}: EntryQualityBadgeProps) {
  const style = QUALITY_STYLES[entryQuality.quality] ?? QUALITY_STYLES.RED;
  const label = DECISION_LABELS[entryQuality.decision] ?? entryQuality.decision;

  if (compact) {
    return (
      <span
        title={entryQuality.reason}
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border',
          style
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border',
            style
          )}
        >
          {label}
        </span>
        <span className="text-xs text-muted-foreground">
          {entryQuality.entryWindowStatus.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="text-xs text-foreground">{entryQuality.reason}</div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] mt-1">
        <div className="text-muted-foreground">
          Do not pay above
        </div>
        <div className="font-mono text-loss font-semibold">
          {formatEntryPrice(entryQuality.noChasePrice, priceCurrency)}
        </div>

        <div className="text-muted-foreground">
          Ideal entry
        </div>
        <div className="font-mono text-profit">
          {formatEntryPrice(entryQuality.idealEntry, priceCurrency)}
        </div>

        <div className="text-muted-foreground">
          Max allowed
        </div>
        <div className="font-mono text-foreground">
          {formatEntryPrice(entryQuality.maxAllowedEntry, priceCurrency)}
        </div>

        <div className="text-muted-foreground">
          Limit price
        </div>
        <div className="font-mono text-primary-400">
          {formatEntryPrice(entryQuality.slippageAdjustedLimit, priceCurrency)}
        </div>

        <div className="text-muted-foreground">
          Extension
        </div>
        <div className="font-mono">
          {entryQuality.extensionATR.toFixed(2)} ATR
          {entryQuality.triggerDistancePct !== 0 && (
            <span className="text-muted-foreground ml-1">
              ({entryQuality.triggerDistancePct > 0 ? '+' : ''}{entryQuality.triggerDistancePct.toFixed(1)}%)
            </span>
          )}
        </div>

        <div className="text-muted-foreground">
          Order type
        </div>
        <div className="font-mono">
          {entryQuality.suggestedOrderType}
        </div>
      </div>
    </div>
  );
}

function formatEntryPrice(value: number, currency?: string): string {
  if (currency === 'GBX' || currency === 'GBp') {
    return `${value.toFixed(1)}p`;
  }
  if (currency === 'GBP') {
    return `£${value.toFixed(2)}`;
  }
  return `$${value.toFixed(2)}`;
}
