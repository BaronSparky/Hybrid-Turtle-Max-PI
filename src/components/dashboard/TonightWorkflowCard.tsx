'use client';

/**
 * DEPENDENCIES
 * Consumed by: src/app/dashboard/page.tsx
 * Consumes: src/lib/api-client.ts, src/lib/utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 4 gap fix — Tonight's Workflow card with 7-step actions and run-all button.
 */
import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { Loader2, Play, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface WorkflowAction {
  key: string;
  label: string;
  description: string;
  lastStatus: string | null;
  lastFinishedAt: string | null;
}

interface WorkflowCardData {
  title: string;
  summary: {
    lastRunAt: string | null;
    lastRunStatus: string | null;
    currentSessionDate: string;
  };
  actions: WorkflowAction[];
  latestPlan: {
    executionSessionDate: string | null;
    draftTrades: number;
  };
}

interface CardResponse {
  card: WorkflowCardData;
}

function StatusIcon({ status }: { status: string | null }) {
  if (!status) return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === 'SUCCEEDED') return <CheckCircle className="h-3.5 w-3.5 text-gain" />;
  if (status === 'PARTIAL') return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
  return <XCircle className="h-3.5 w-3.5 text-loss" />;
}

export default function TonightWorkflowCard() {
  const [card, setCard] = useState<WorkflowCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<CardResponse>('/api/workflow/tonight');
      setCard(data.card);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load workflow card.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRunAll = useCallback(async () => {
    setRunning(true);
    try {
      // UI-only sibling of POST /api/workflow/tonight. The parent route is
      // cron-only (CRON_SECRET enforced); this one is session-gated and
      // calls the same runTonightWorkflow() server-side.
      await apiRequest('/api/workflow/tonight/run-from-ui', { method: 'POST' });
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Workflow run failed.');
    } finally {
      setRunning(false);
    }
  }, [load]);

  return (
    <section className="card-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Tonight&apos;s Workflow</h3>
          <p className="text-xs text-muted-foreground">7-step evening workflow from data refresh to stop verification.</p>
        </div>
        <button
          onClick={handleRunAll}
          disabled={running}
          className="flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'Running…' : 'Run All'}
        </button>
      </div>

      {!card && !error ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary-400" />
          Loading workflow…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</div>
      ) : null}

      {card ? (
        <>
          {card.summary.lastRunAt ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusIcon status={card.summary.lastRunStatus} />
              <span>Last run: {formatDateTime(card.summary.lastRunAt)}</span>
              {card.latestPlan.draftTrades > 0 ? (
                <span className="ml-auto text-amber-400">{card.latestPlan.draftTrades} draft trades</span>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            {card.actions.map((action, index) => (
              <div key={action.key} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy-700 text-[10px] font-bold text-muted-foreground">
                  {index + 1}
                </span>
                <StatusIcon status={action.lastStatus} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">{action.label}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground hidden sm:inline">{action.description}</span>
                </div>
                {action.lastFinishedAt ? (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDateTime(action.lastFinishedAt)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
