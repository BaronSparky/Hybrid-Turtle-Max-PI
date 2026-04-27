import { JobRunStatus, Prisma } from '@prisma/client';
import { runBrokerSync } from '../../broker/src';
import { refreshUniverseDailyBars } from '../../data/src';
import { toInputJson } from '../../data/src/prisma';
import {
  completeWorkflowStep,
  createEveningWorkflowRun,
  createWorkflowAuditEvent,
  failWorkflowStep,
  finalizeWorkflowRun,
  startWorkflowStep,
} from './repository';
import { buildNextSessionPlan } from './plan';
import { reconcileStopsAndPositions, verifyProtectiveStops } from './reconcile';
import { reviewEveningRisk } from './risk';
import { reviewEveningCandidates, runEveningScan } from './scan';
import type {
  EveningRefreshResult,
  ReconciliationResult,
  TonightWorkflowActionKey,
  TonightWorkflowRunResult,
} from './types';

type StepDefinition = {
  key: TonightWorkflowActionKey;
  label: string;
  run: (workflowRunId: string) => Promise<object>;
  /** If true, this step runs even if a previous step failed. */
  critical?: boolean;
};

export async function runEveningRefresh(): Promise<EveningRefreshResult> {
  const result = await refreshUniverseDailyBars({ force: true });
  return {
    runId: result.runId,
    requestedSymbols: result.requestedSymbols,
    succeededSymbols: result.succeededSymbols,
    failedSymbols: result.failedSymbols,
    staleSymbols: result.staleSymbols,
  };
}

const workflowSteps: StepDefinition[] = [
  {
    key: 'refresh-data',
    label: 'Refresh Data',
    run: async () => runEveningRefresh(),
  },
  {
    key: 'run-scan',
    label: 'Run Scan',
    run: async () => runEveningScan(),
  },
  {
    key: 'review-candidates',
    label: 'Review Candidates',
    run: async () => reviewEveningCandidates(),
  },
  {
    key: 'review-risk',
    label: 'Review Risk',
    run: async () => reviewEveningRisk(),
  },
  {
    key: 'generate-plan',
    label: 'Generate Plan',
    run: async () => buildNextSessionPlan(),
  },
  {
    key: 'sync-broker',
    label: 'Sync Broker',
    critical: true,
    run: async () => {
      const result = await runBrokerSync();
      return {
        brokerSyncRunId: result.runId,
        discrepancyCount: result.discrepancyCount,
        positionsCount: result.positionsCount,
        ordersCount: result.ordersCount,
      };
    },
  },
  {
    key: 'verify-stops',
    label: 'Verify Stops',
    critical: true,
    run: async (workflowRunId) => verifyProtectiveStops(workflowRunId),
  },
];

function mapStatus(details: Record<string, unknown>) {
  if ('failedSymbols' in details && typeof details.failedSymbols === 'number' && details.failedSymbols > 0) {
    return JobRunStatus.PARTIAL;
  }

  if ('discrepancyCount' in details && typeof details.discrepancyCount === 'number' && details.discrepancyCount > 0) {
    return JobRunStatus.PARTIAL;
  }

  if ('missingStopsCount' in details && typeof details.missingStopsCount === 'number' && details.missingStopsCount > 0) {
    return JobRunStatus.PARTIAL;
  }

  if ('missingStopsCreated' in details && typeof details.missingStopsCreated === 'number' && details.missingStopsCreated > 0) {
    return JobRunStatus.PARTIAL;
  }

  return JobRunStatus.SUCCEEDED;
}

export async function runTonightWorkflow(): Promise<TonightWorkflowRunResult> {
  const workflowRun = await createEveningWorkflowRun();
  const stepResults: TonightWorkflowRunResult['steps'] = [];
  let overallStatus: JobRunStatus = JobRunStatus.SUCCEEDED;

  try {
    for (const definition of workflowSteps) {
      // Skip non-critical steps after a failure, but always run critical steps
      if (overallStatus === JobRunStatus.FAILED && !definition.critical) {
        stepResults.push({
          key: definition.key,
          label: definition.label,
          status: JobRunStatus.FAILED,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          details: { skipped: true, reason: 'Previous step failed' },
        });
        continue;
      }

      const step = await startWorkflowStep(workflowRun.id, definition.key, definition.label);
      try {
        const details = (await definition.run(workflowRun.id)) as Record<string, unknown>;
        const stepStatus = mapStatus(details);
        await completeWorkflowStep(step.id, stepStatus, toInputJson(details));
        if (stepStatus === JobRunStatus.PARTIAL && overallStatus === JobRunStatus.SUCCEEDED) {
          overallStatus = JobRunStatus.PARTIAL;
        }
        stepResults.push({
          key: definition.key,
          label: definition.label,
          status: stepStatus,
          startedAt: step.startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          details,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown workflow step error';
        await failWorkflowStep(step.id, message);
        overallStatus = JobRunStatus.FAILED;
        await createWorkflowAuditEvent('EVENING_WORKFLOW_STEP_FAILED', workflowRun.id, {
          stepKey: definition.key,
          label: definition.label,
          errorMessage: message,
        } as Prisma.InputJsonValue);
        stepResults.push({
          key: definition.key,
          label: definition.label,
          status: JobRunStatus.FAILED,
          startedAt: step.startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          details: { error: message },
        });
        // Continue to next step instead of aborting — critical steps must run
      }
    }

    await finalizeWorkflowRun(workflowRun.id, overallStatus, toInputJson({
      workflowRunId: workflowRun.id,
      steps: stepResults,
    }));
    await createWorkflowAuditEvent('EVENING_WORKFLOW_COMPLETED', workflowRun.id, toInputJson({
      status: overallStatus,
      stepCount: stepResults.length,
    }));

    return {
      workflowRunId: workflowRun.id,
      status: overallStatus,
      steps: stepResults,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown evening workflow error';
    await finalizeWorkflowRun(workflowRun.id, JobRunStatus.FAILED, toInputJson({
      workflowRunId: workflowRun.id,
      steps: stepResults,
    }), message);
    throw error;
  }
}

export async function syncAndVerifyStops(): Promise<ReconciliationResult> {
  return reconcileStopsAndPositions();
}