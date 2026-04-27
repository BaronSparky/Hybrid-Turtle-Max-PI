'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { Heart, AlertTriangle, Clock, CheckCircle, XCircle } from 'lucide-react';
import { timeSince } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';

interface NightlyStepInfo {
  step: string;
  name: string;
  status: 'OK' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  error?: string;
}

export default function HeartbeatMonitor() {
  const { lastHeartbeat, heartbeatOk, heartbeatStatus } = useStore();
  const [steps, setSteps] = useState<NightlyStepInfo[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lastDigest, setLastDigest] = useState<string | null>(null);

  const isPartial = heartbeatOk && heartbeatStatus === 'PARTIAL';

  // Fetch nightly step details + weekly digest status
  useEffect(() => {
    apiRequest<{ details?: string; status?: string }>('/api/heartbeat')
      .then(data => {
        if (data?.details) {
          try {
            const parsed = JSON.parse(data.details);
            if (parsed.steps && Array.isArray(parsed.steps)) {
              setSteps(parsed.steps);
            }
          } catch {
            // Not all heartbeats have step details
          }
        }
      })
      .catch(() => {});

    // Check for latest weekly digest heartbeat
    apiRequest<{ heartbeats?: Array<{ details: string; timestamp: string }> }>('/api/heartbeat?type=weekly-digest')
      .then(data => {
        if (data?.heartbeats?.[0]?.timestamp) {
          setLastDigest(data.heartbeats[0].timestamp);
        }
      })
      .catch(() => {});
  }, [lastHeartbeat]);

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Heartbeat Monitor</h3>
      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => steps && setExpanded(!expanded)}
        title={steps ? 'Click to show/hide step details' : undefined}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            isPartial
              ? 'bg-warning/20'
              : heartbeatOk
                ? 'bg-profit/20 animate-pulse-green'
                : 'bg-loss/20 animate-pulse-red'
          )}
        >
          {isPartial ? (
            <AlertTriangle className="w-5 h-5 text-warning" />
          ) : heartbeatOk ? (
            <Heart className="w-5 h-5 text-profit heartbeat-animation" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-loss" />
          )}
        </div>
        <div className="flex-1">
          <div
            className={cn(
              'text-sm font-semibold',
              isPartial ? 'text-warning' : heartbeatOk ? 'text-profit' : 'text-loss'
            )}
          >
            {isPartial
              ? 'Partial — some steps degraded'
              : heartbeatOk
                ? 'Healthy'
                : 'STALE — Nightly run missing'}
          </div>
          <div className="text-xs text-muted-foreground">
            {lastHeartbeat
              ? `Last run: ${timeSince(lastHeartbeat)}`
              : 'No heartbeat recorded yet'}
            {steps && !expanded && (
              <span className="ml-1 text-muted-foreground/60">
                · {steps.filter(s => s.status === 'OK').length}/{steps.length} steps OK
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Expandable step details */}
      {expanded && steps && (
        <div className="mt-3 space-y-1 border-t border-border/30 pt-2">
          {steps.map(s => (
            <div key={s.step} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                {s.status === 'OK' ? (
                  <CheckCircle className="w-3 h-3 text-profit" />
                ) : s.status === 'FAILED' ? (
                  <XCircle className="w-3 h-3 text-loss" />
                ) : (
                  <Clock className="w-3 h-3 text-muted-foreground" />
                )}
                <span className={cn(
                  s.status === 'FAILED' ? 'text-loss' : 'text-muted-foreground'
                )}>
                  {s.name}
                </span>
              </div>
              <span className={cn(
                'font-mono text-[10px]',
                s.durationMs > 300000 ? 'text-warning' : 'text-muted-foreground/60'
              )}>
                {(s.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Weekly digest status */}
      {lastDigest && (
        <div className="mt-2 pt-2 border-t border-border/30 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle className="w-3 h-3 text-primary-400" />
          Weekly digest: {timeSince(new Date(lastDigest))}
        </div>
      )}
    </div>
  );
}
