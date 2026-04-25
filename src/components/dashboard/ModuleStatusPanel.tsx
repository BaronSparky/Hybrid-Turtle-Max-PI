'use client';

/**
 * DEPENDENCIES
 * Consumed by: /dashboard page
 * Consumes: useModulesData hook, module-buckets.ts, @/types
 * Risk-sensitive: NO (display only)
 * Last modified: 2026-03-03
 * Notes: Bucketed module status panel — Entry Blockers, Exit Signals, Background.
 *        Uncategorised modules (if any new ones are added) render at the bottom.
 */

import { useState, useMemo } from 'react';
import {
  Zap, Trash2, Flame, ArrowRightLeft, Thermometer,
  RotateCcw, BarChart3, Ban, Layers, TrendingUp,
  Scissors, BookOpen, Clock, FileText, ShieldAlert,
  Globe, RefreshCw, Database, Activity, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle,
  ShieldOff, Eye, Monitor, FlaskConical,
} from 'lucide-react';
import type { AllModulesResult, ModuleStatus } from '@/types';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';
import {
  MODULE_BUCKETS,
  getUncategorisedModules,
  type ModuleBucket,
} from '@/lib/module-buckets';

const MODULE_ICONS: Record<number, React.ElementType> = {
  2: Zap,
  3: Trash2,
  5: Flame,
  7: ArrowRightLeft,
  8: Thermometer,
  9: RotateCcw,
  9.1: Activity,
  10: BarChart3,
  11: Ban,
  12: Layers,
  13: TrendingUp,
  14: Scissors,
  15: BookOpen,
  16: Clock,
  17: FileText,
  18: ShieldAlert,
  19: Globe,
  20: RefreshCw,
  21: Database,
};

// Bucket header icons
const BUCKET_ICONS: Record<ModuleBucket | 'UNCATEGORISED', React.ElementType> = {
  ENTRY_BLOCKERS: ShieldOff,
  EXIT_SIGNALS: Eye,
  BACKGROUND: Monitor,
  PLANNED: FlaskConical,
  UNCATEGORISED: Activity,
};

// Active status dot colour depends on bucket type
const ACTIVE_DOT_CLASS: Record<ModuleBucket | 'UNCATEGORISED', string> = {
  ENTRY_BLOCKERS: 'bg-loss',
  EXIT_SIGNALS: 'bg-warning',
  BACKGROUND: 'bg-warning',
  PLANNED: 'bg-muted-foreground/30',
  UNCATEGORISED: 'bg-warning',
};

function getStatusDot(status: ModuleStatus['status'], bucketId: ModuleBucket | 'UNCATEGORISED'): string {
  if (status === 'RED') return 'bg-loss';
  if (status === 'YELLOW') return ACTIVE_DOT_CLASS[bucketId];
  if (status === 'DISABLED' || status === 'INACTIVE') return 'bg-muted-foreground/30';
  return 'bg-muted-foreground/40'; // GREEN → grey ("nothing to report")
}

function getStatusText(status: ModuleStatus['status']): string {
  switch (status) {
    case 'RED': return 'Triggered';
    case 'YELLOW': return 'Active';
    case 'GREEN': return 'Clear';
    case 'INACTIVE': return 'Inactive';
    case 'DISABLED': return 'Disabled';
    default: return status;
  }
}

function isActive(status: ModuleStatus['status']): boolean {
  return status === 'RED' || status === 'YELLOW';
}

export default function ModuleStatusPanel() {
  const { data, loading } = useModulesData();

  // Default collapse state: Blockers=open, Exit=depends, Background=closed
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(() => {
    return new Set(['BACKGROUND', 'PLANNED']);
  });

  const statuses = useMemo(() => data?.moduleStatuses || [], [data?.moduleStatuses]);
  const uncategorised = getUncategorisedModules(statuses);

  // Decide initial Exit Signals state: collapsed if all clear
  const exitBucket = MODULE_BUCKETS.find((b) => b.id === 'EXIT_SIGNALS');
  const exitModules = exitBucket
    ? statuses.filter((m) => exitBucket.moduleIds.includes(m.id))
    : [];
  const exitHasActive = exitModules.some((m) => isActive(m.status));

  // Build bucket data
  const bucketData = useMemo(() => {
    return MODULE_BUCKETS.map((bucket) => {
      const modules = statuses
        .filter((m) => bucket.moduleIds.includes(m.id))
        .sort((a, b) => {
          // Active first, then green, then inactive/disabled
          const order = { RED: 0, YELLOW: 1, GREEN: 2, INACTIVE: 3, DISABLED: 4 };
          return (order[a.status] ?? 4) - (order[b.status] ?? 4);
        });
      const activeCount = modules.filter((m) => isActive(m.status)).length;
      return { ...bucket, modules, activeCount };
    });
  }, [statuses]);

  function toggleBucket(id: string) {
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Early returns AFTER all hooks ──

  if (loading && !data) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary-400 animate-pulse" />
          Module Status
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Loading module checks...</div>
      </div>
    );
  }

  if (!data) return null;

  // Auto-expand Exit Signals if it has active modules, collapse if all clear
  // (only on initial render — user can override by clicking)
  const isBucketCollapsed = (id: string) => {
    if (id === 'EXIT_SIGNALS' && !collapsedBuckets.has('EXIT_SIGNALS') && !exitHasActive) {
      // Default to collapsed when all clear, but don't override user interaction
      return !exitHasActive;
    }
    return collapsedBuckets.has(id);
  };

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary-400" />
          Module Status
        </h3>
        <span className="text-[10px] text-muted-foreground">{statuses.length} modules</span>
      </div>

      <div className="space-y-3">
        {bucketData.map((bucket) => {
          const collapsed = isBucketCollapsed(bucket.id);
          const BucketIcon = BUCKET_ICONS[bucket.id];

          return (
            <BucketSection
              key={bucket.id}
              bucketId={bucket.id}
              label={bucket.label}
              description={bucket.description}
              icon={BucketIcon}
              modules={bucket.modules}
              activeCount={bucket.activeCount}
              collapsed={collapsed}
              onToggle={() => toggleBucket(bucket.id)}
              data={data}
            />
          );
        })}

        {/* Uncategorised — fallback for new modules not yet assigned to a bucket */}
        {uncategorised.length > 0 && (
          <BucketSection
            bucketId="UNCATEGORISED"
            label="Other Modules"
            description="Not yet categorised"
            icon={BUCKET_ICONS.UNCATEGORISED}
            modules={uncategorised}
            activeCount={uncategorised.filter((m) => isActive(m.status)).length}
            collapsed={isBucketCollapsed('UNCATEGORISED')}
            onToggle={() => toggleBucket('UNCATEGORISED')}
            data={data}
          />
        )}
      </div>
    </div>
  );
}

// ── Bucket Section ──

interface BucketSectionProps {
  bucketId: ModuleBucket | 'UNCATEGORISED';
  label: string;
  description: string;
  icon: React.ElementType;
  modules: ModuleStatus[];
  activeCount: number;
  collapsed: boolean;
  onToggle: () => void;
  data: AllModulesResult;
}

function BucketSection({
  bucketId,
  label,
  description,
  icon: Icon,
  modules,
  activeCount,
  collapsed,
  onToggle,
  data,
}: BucketSectionProps) {
  if (modules.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      {/* Header — clickable to toggle */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-navy-800/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <Icon className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-xs font-semibold text-foreground">{label}</span>
            {collapsed && (
              <span className="text-[10px] text-muted-foreground ml-2">{description}</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          {bucketId === 'PLANNED' ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy-800/50 text-muted-foreground/60 font-medium italic">
              {modules.length} planned
            </span>
          ) : activeCount > 0 ? (
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium',
              bucketId === 'ENTRY_BLOCKERS'
                ? 'bg-loss/15 text-loss'
                : 'bg-warning/15 text-warning'
            )}>
              {activeCount} active
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy-800/50 text-muted-foreground font-medium">
              All clear
            </span>
          )}
        </div>
      </button>

      {/* Module rows — shown when expanded */}
      {!collapsed && (
        <div className="border-t border-border/30 px-3 py-1.5 space-y-0.5">
          {modules.map((mod) => (
            <ModuleRow
              key={mod.id}
              mod={mod}
              bucketId={bucketId}
              data={data}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Module Row ──

function ModuleRow({
  mod,
  bucketId,
  data,
}: {
  mod: ModuleStatus;
  bucketId: ModuleBucket | 'UNCATEGORISED';
  data: AllModulesResult;
}) {
  const isDisabled = mod.status === 'DISABLED' || mod.status === 'INACTIVE';
  const Icon = MODULE_ICONS[mod.id] || Activity;
  const dotColor = getStatusDot(mod.status, bucketId);
  const details = getModuleDetails(mod, data);

  return (
    <div className={cn(
      'flex items-start gap-2 py-1.5 rounded px-1.5',
      isDisabled && 'opacity-50'
    )}>
      {/* Status dot */}
      <div className="mt-1.5 flex-shrink-0">
        <div className={cn('w-2 h-2 rounded-full', dotColor)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon className={cn('w-3 h-3 flex-shrink-0', isDisabled ? 'text-muted-foreground/40' : 'text-muted-foreground')} />
          <span className={cn(
            'text-xs truncate',
            isDisabled ? 'text-muted-foreground/60 italic' : 'text-foreground'
          )}>
            {mod.name}
          </span>
        </div>
        <div className={cn(
          'text-[10px] truncate mt-0.5 ml-4.5',
          isDisabled ? 'text-muted-foreground/40' : 'text-muted-foreground'
        )}>
          {mod.summary}
        </div>
        {/* Inline details for active modules */}
        {details && isActive(mod.status) && (
          <div className="ml-4.5 mt-1 space-y-0.5">
            {details.map((d) => (
              <div key={d} className="text-[10px] text-muted-foreground/80">• {d}</div>
            ))}
          </div>
        )}
      </div>

      {/* Status label */}
      <span className={cn(
        'text-[10px] flex-shrink-0 mt-0.5',
        mod.status === 'RED' ? 'text-loss' :
        mod.status === 'YELLOW' ? 'text-warning' :
        'text-muted-foreground/50'
      )}>
        {getStatusText(mod.status)}
      </span>
    </div>
  );
}

// ── Module Details (preserved from original) ──

function getModuleDetails(mod: ModuleStatus, data: AllModulesResult): string[] | null {
  switch (mod.id) {
    case 3:
      if (data.laggards.length === 0) return null;
      return data.laggards.map(l => `${l.ticker}: ${l.reason}`);
    case 5:
    case 14:
      if (data.climaxSignals.length === 0) return null;
      return data.climaxSignals.map(c => `${c.ticker}: ${c.reason}`);
    case 7:
      if (data.swapSuggestions.length === 0) return null;
      return data.swapSuggestions.map(s => s.reason);
    case 8:
      if (data.heatChecks.length === 0) return null;
      return data.heatChecks.map(h => h.reason);
    case 10:
      return [data.breadthSafety.reason];
    case 11:
      if (data.whipsawBlocks.length === 0) return null;
      return data.whipsawBlocks.map(w => w.reason);
    case 13:
      return [data.momentumExpansion.reason];
    case 9.1:
      return [data.regimeStability.reason];
    case 19:
      return [
        `SPY: ${data.dualRegime.spy.regime} ($${data.dualRegime.spy.price.toFixed(2)} vs MA200 $${data.dualRegime.spy.ma200.toFixed(2)})`,
        `VWRL: ${data.dualRegime.vwrl.regime} ($${data.dualRegime.vwrl.price.toFixed(2)} vs MA200 $${data.dualRegime.vwrl.ma200.toFixed(2)})`,
        `Combined: ${data.dualRegime.combined}`,
      ];
    default:
      return null;
  }
}
