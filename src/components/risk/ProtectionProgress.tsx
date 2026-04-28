import { memo } from 'react';
import { cn, formatR } from '@/lib/utils';
import { Shield, Lock, TrendingUp, ArrowUp } from 'lucide-react';

interface PositionProgress {
  ticker: string;
  rMultiple: number;
  protectionLevel: string;
  nextLevel: string | null;
  nextThreshold: number | null;
  progressPercent: number;
}

interface ProtectionProgressProps {
  positions?: Array<{ ticker: string; rMultiple: number; protectionLevel: string }>;
}

const levelConfig: Record<string, { color: string; bgColor: string; icon: React.ElementType }> = {
  INITIAL: { color: 'text-muted-foreground', bgColor: 'bg-navy-600', icon: Shield },
  BREAKEVEN: { color: 'text-warning', bgColor: 'bg-warning/30', icon: Lock },
  TRAILING_ATR: { color: 'text-violet-400', bgColor: 'bg-violet-500/30', icon: TrendingUp },
  LOCK_08R: { color: 'text-blue-400', bgColor: 'bg-blue-500/30', icon: TrendingUp },
  LOCK_1R_TRAIL: { color: 'text-profit', bgColor: 'bg-profit/30', icon: ArrowUp },
};

const levelOrder = ['INITIAL', 'BREAKEVEN', 'TRAILING_ATR', 'LOCK_08R', 'LOCK_1R_TRAIL'];
const levelThresholds = [0, 1.5, 0, 2.5, 3.0];

function ProtectionProgress({ positions = [] }: ProtectionProgressProps) {
  const progressPositions: PositionProgress[] = positions.map((pos) => {
    const currentIdx = levelOrder.indexOf(pos.protectionLevel);
    const nextIdx = currentIdx + 1;
    const nextLevel = levelOrder[nextIdx] || null;
    const nextThreshold = nextLevel ? levelThresholds[nextIdx] : null;
    const progressPercent = nextThreshold ? Math.min((pos.rMultiple / nextThreshold) * 100, 100) : 100;

    return {
      ticker: pos.ticker,
      rMultiple: pos.rMultiple,
      protectionLevel: pos.protectionLevel,
      nextLevel,
      nextThreshold,
      progressPercent,
    };
  });

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <Shield className="w-4 h-4 text-primary-400" />
        Protection Progress
      </h3>

      {/* Level legend */}
      <div className="flex items-center gap-1 mb-4 p-2 bg-navy-800 rounded-lg">
        {levelOrder.map((level, i) => {
          const config = levelConfig[level];
          const Icon = config.icon;
          return (
            <div key={level} className="flex items-center gap-1 flex-1">
              <div className={cn('w-full h-1 rounded-full', config.bgColor)} />
              {i < levelOrder.length - 1 && (
                <div className="text-[10px] text-muted-foreground font-mono whitespace-nowrap px-1">
                  {levelThresholds[i + 1]}R
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-4">
        {progressPositions.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No open positions to track protection progress.
          </div>
        )}
        {progressPositions.map((pos) => {
          const config = levelConfig[pos.protectionLevel];
          const currentIdx = levelOrder.indexOf(pos.protectionLevel);
          
          return (
            <div key={pos.ticker} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{pos.ticker}</span>
                  <span className={cn('text-xs font-mono', config.color)}>
                    {pos.protectionLevel.replace(/_/g, ' ')}
                  </span>
                </div>
                <span className="text-sm font-mono text-primary-400">{formatR(pos.rMultiple)}</span>
              </div>

              {/* Multi-segment progress bar */}
              <div className="flex items-center gap-0.5">
                {levelOrder.map((level, i) => {
                  const lConfig = levelConfig[level];
                  const isReached = i <= currentIdx;
                  const isCurrent = i === currentIdx;

                  return (
                    <div
                      key={level}
                      className={cn(
                        'h-2 flex-1 rounded-sm transition-all',
                        isReached ? lConfig.bgColor : 'bg-navy-700',
                        isCurrent && 'ring-1 ring-white/20'
                      )}
                    />
                  );
                })}
              </div>

              {pos.nextLevel && pos.nextThreshold && (
                <div className="text-[11px] text-muted-foreground">
                  Next: <span className={levelConfig[pos.nextLevel]?.color}>
                    {pos.nextLevel.replace(/_/g, ' ')}
                  </span> at {formatR(pos.nextThreshold)} 
                  <span className="text-muted-foreground/60"> ({formatR(pos.nextThreshold - pos.rMultiple)} to go)</span>
                </div>
              )}
              {!pos.nextLevel && (
                <div className="text-[11px] text-profit">
                  ✓ Maximum protection reached — trailing stop active
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ProtectionProgress);
