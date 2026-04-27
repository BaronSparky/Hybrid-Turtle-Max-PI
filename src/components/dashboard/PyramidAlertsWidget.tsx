'use client';

import { Layers, TrendingUp, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';
import { formatPrice } from '@/lib/utils';

export default function PyramidAlertsWidget() {
  const { data: modulesData, loading } = useModulesData();
  const pyramidAlerts = modulesData?.pyramidAlerts ?? [];

  // Split into actionable (allowed) and upcoming (within 5% of trigger)
  const actionable = pyramidAlerts.filter(a => a.allowed);
  const upcoming = pyramidAlerts.filter(a => {
    if (a.allowed) return false;
    if (!a.triggerPrice || a.triggerPrice <= 0 || a.rMultiple <= 0) return false;
    // Only show if price is within 5% of the trigger — far-away positions are noise
    const distancePct = ((a.triggerPrice - a.currentPrice) / a.currentPrice) * 100;
    return distancePct <= 5 && distancePct > 0;
  });

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary-400 animate-pulse" />
          Pyramid Adds
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Checking positions...</div>
      </div>
    );
  }

  if (pyramidAlerts.length === 0) {
    return null; // Don't render if no open positions to check
  }

  // Don't show the widget if nothing is actionable or approaching — reduces noise
  if (actionable.length === 0 && upcoming.length === 0) {
    return null;
  }

  return (
    <div className="card-surface p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary-400" />
          Pyramid Adds
        </h3>
        {actionable.length > 0 && (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-profit/20 text-profit animate-pulse">
            {actionable.length} READY
          </span>
        )}
      </div>

      {/* Actionable adds */}
      {actionable.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Triggered — Add Now
          </p>
          {actionable.map((a) => (
            <div
              key={`${a.ticker}-${a.nextAddNumber}`}
              className="flex items-center justify-between p-3 rounded-lg border border-profit/30 bg-profit/5"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-profit/20 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-profit" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{a.ticker}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-profit/20 text-profit font-medium">
                      Add #{a.nextAddNumber}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatPrice(a.currentPrice, a.priceCurrency)} ≥ trigger{' '}
                    {a.triggerPrice ? formatPrice(a.triggerPrice, a.priceCurrency) : 'R-based'}
                    {' · '}
                    <span className="text-profit">+{a.rMultiple.toFixed(1)}R</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono text-profit font-semibold">
                  +{a.rMultiple.toFixed(1)}R
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {a.addsUsed}/{a.maxAdds} used
                </div>
                {a.addShares > 0 && (
                  <div className="text-[10px] text-foreground mt-0.5 font-medium">
                    {a.addShares.toFixed(2)} shares &middot; &pound;{a.addRiskAmount.toFixed(2)} risk
                  </div>
                )}
                {a.riskScalar > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    {(a.riskScalar * 100).toFixed(0)}% of base risk
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming / not yet triggered */}
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Approaching Trigger
          </p>
          {upcoming.slice(0, 5).map((a) => {
            const distancePct = a.triggerPrice && a.currentPrice > 0
              ? ((a.triggerPrice - a.currentPrice) / a.currentPrice) * 100
              : null;
            return (
              <div
                key={`${a.ticker}-upcoming`}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-navy-900/50"
              >
                <div className="flex items-center gap-2.5">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <div>
                    <span className="text-sm font-medium text-foreground">{a.ticker}</span>
                    <div className="text-[10px] text-muted-foreground">
                      Next add at {a.triggerPrice ? formatPrice(a.triggerPrice, a.priceCurrency) : '—'}
                      {distancePct !== null && (
                        <span className="ml-1 text-warning">({distancePct.toFixed(1)}% away)</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn(
                    'text-xs font-mono',
                    a.rMultiple >= 0 ? 'text-profit' : 'text-loss'
                  )}>
                    {a.rMultiple >= 0 ? '+' : ''}{a.rMultiple.toFixed(1)}R
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No actionable and no upcoming */}
      {actionable.length === 0 && upcoming.length === 0 && (
        <div className="text-center py-4">
          <div className="text-xs text-muted-foreground">
            No pyramid opportunities — positions have not reached trigger levels yet
          </div>
        </div>
      )}
    </div>
  );
}
