/**
 * Tests for the evening workflow's continue-on-failure behavior.
 * Verifies that critical steps (sync-broker, verify-stops) run even when
 * earlier non-critical steps fail.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──

const mockRunBrokerSync = vi.fn();
const mockRefreshUniverseDailyBars = vi.fn();
const mockRunEveningScan = vi.fn();
const mockReviewEveningCandidates = vi.fn();
const mockReviewEveningRisk = vi.fn();
const mockBuildNextSessionPlan = vi.fn();
const mockVerifyProtectiveStops = vi.fn();

const mockCreateEveningWorkflowRun = vi.fn();
const mockStartWorkflowStep = vi.fn();
const mockCompleteWorkflowStep = vi.fn();
const mockFailWorkflowStep = vi.fn();
const mockFinalizeWorkflowRun = vi.fn();
const mockCreateWorkflowAuditEvent = vi.fn();

vi.mock('../../broker/src', () => ({
  runBrokerSync: (...args: unknown[]) => mockRunBrokerSync(...args),
}));

vi.mock('../../data/src', () => ({
  refreshUniverseDailyBars: (...args: unknown[]) => mockRefreshUniverseDailyBars(...args),
}));

vi.mock('../../data/src/prisma', () => ({
  prisma: {},
  toInputJson: (v: unknown) => v,
}));

vi.mock('./scan', () => ({
  runEveningScan: (...args: unknown[]) => mockRunEveningScan(...args),
  reviewEveningCandidates: (...args: unknown[]) => mockReviewEveningCandidates(...args),
}));

vi.mock('./risk', () => ({
  reviewEveningRisk: (...args: unknown[]) => mockReviewEveningRisk(...args),
}));

vi.mock('./plan', () => ({
  buildNextSessionPlan: (...args: unknown[]) => mockBuildNextSessionPlan(...args),
}));

vi.mock('./reconcile', () => ({
  reconcileStopsAndPositions: vi.fn(),
  verifyProtectiveStops: (...args: unknown[]) => mockVerifyProtectiveStops(...args),
}));

vi.mock('./repository', () => ({
  createEveningWorkflowRun: (...args: unknown[]) => mockCreateEveningWorkflowRun(...args),
  startWorkflowStep: (...args: unknown[]) => mockStartWorkflowStep(...args),
  completeWorkflowStep: (...args: unknown[]) => mockCompleteWorkflowStep(...args),
  failWorkflowStep: (...args: unknown[]) => mockFailWorkflowStep(...args),
  finalizeWorkflowRun: (...args: unknown[]) => mockFinalizeWorkflowRun(...args),
  createWorkflowAuditEvent: (...args: unknown[]) => mockCreateWorkflowAuditEvent(...args),
}));

import { runTonightWorkflow } from './service';

// ── Setup ──

function setupDefaultMocks() {
  mockCreateEveningWorkflowRun.mockResolvedValue({ id: 'wf-1' });
  mockStartWorkflowStep.mockImplementation((_wfId: string, key: string, label: string) =>
    Promise.resolve({ id: `step-${key}`, startedAt: new Date() })
  );
  mockCompleteWorkflowStep.mockResolvedValue(undefined);
  mockFailWorkflowStep.mockResolvedValue(undefined);
  mockFinalizeWorkflowRun.mockResolvedValue(undefined);
  mockCreateWorkflowAuditEvent.mockResolvedValue(undefined);

  // All steps succeed by default
  mockRefreshUniverseDailyBars.mockResolvedValue({
    runId: 'run-1', requestedSymbols: 10, succeededSymbols: 10, failedSymbols: 0, staleSymbols: 0,
  });
  mockRunEveningScan.mockResolvedValue({ candidatesCount: 5 });
  mockReviewEveningCandidates.mockResolvedValue({ reviewed: 5 });
  mockReviewEveningRisk.mockResolvedValue({ riskOk: true });
  mockBuildNextSessionPlan.mockResolvedValue({ planId: 'plan-1' });
  mockRunBrokerSync.mockResolvedValue({
    runId: 'sync-1', discrepancyCount: 0, positionsCount: 3, ordersCount: 1,
  });
  mockVerifyProtectiveStops.mockResolvedValue({ verified: 3, missingStopsCount: 0 });
}

// ── Tests ──

describe('runTonightWorkflow continue-on-failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('runs all steps when everything succeeds', async () => {
    const result = await runTonightWorkflow();

    expect(result.status).toBe('SUCCEEDED');
    expect(result.steps).toHaveLength(7);
    expect(result.steps.every(s => s.status === 'SUCCEEDED')).toBe(true);
    expect(mockVerifyProtectiveStops).toHaveBeenCalled();
    expect(mockRunBrokerSync).toHaveBeenCalled();
  });

  it('skips non-critical steps after failure but runs critical steps', async () => {
    // Make refresh-data (first step, non-critical) fail
    mockRefreshUniverseDailyBars.mockRejectedValue(new Error('Yahoo API down'));

    const result = await runTonightWorkflow();

    expect(result.status).toBe('FAILED');

    // First step should be FAILED
    const refreshStep = result.steps.find(s => s.key === 'refresh-data');
    expect(refreshStep?.status).toBe('FAILED');

    // Non-critical steps after the failure should be skipped
    const scanStep = result.steps.find(s => s.key === 'run-scan');
    expect(scanStep?.status).toBe('FAILED');
    expect((scanStep?.details as Record<string, unknown>)?.skipped).toBe(true);

    // Critical steps should still run
    expect(mockRunBrokerSync).toHaveBeenCalled();
    expect(mockVerifyProtectiveStops).toHaveBeenCalled();

    const brokerStep = result.steps.find(s => s.key === 'sync-broker');
    expect(brokerStep?.status).toBe('SUCCEEDED');

    const stopsStep = result.steps.find(s => s.key === 'verify-stops');
    expect(stopsStep?.status).toBe('SUCCEEDED');
  });

  it('marks workflow FAILED even when critical steps succeed', async () => {
    // A non-critical step fails, but critical steps succeed
    mockBuildNextSessionPlan.mockRejectedValue(new Error('Plan generation failed'));

    const result = await runTonightWorkflow();

    expect(result.status).toBe('FAILED');
    // Critical steps still ran successfully
    expect(mockRunBrokerSync).toHaveBeenCalled();
    expect(mockVerifyProtectiveStops).toHaveBeenCalled();
  });

  it('handles critical step failure gracefully', async () => {
    // Make a critical step (sync-broker) fail
    mockRunBrokerSync.mockRejectedValue(new Error('Broker API timeout'));

    const result = await runTonightWorkflow();

    expect(result.status).toBe('FAILED');

    // verify-stops (also critical) should still run
    expect(mockVerifyProtectiveStops).toHaveBeenCalled();
    const stopsStep = result.steps.find(s => s.key === 'verify-stops');
    expect(stopsStep?.status).toBe('SUCCEEDED');
  });

  it('records audit events for step failures', async () => {
    mockRunEveningScan.mockRejectedValue(new Error('Scan crashed'));

    await runTonightWorkflow();

    expect(mockCreateWorkflowAuditEvent).toHaveBeenCalledWith(
      'EVENING_WORKFLOW_STEP_FAILED',
      'wf-1',
      expect.objectContaining({ stepKey: 'run-scan' })
    );
  });

  it('finalizes workflow run with correct status', async () => {
    mockRefreshUniverseDailyBars.mockRejectedValue(new Error('fail'));

    await runTonightWorkflow();

    expect(mockFinalizeWorkflowRun).toHaveBeenCalledWith(
      'wf-1',
      'FAILED',
      expect.anything()
    );
  });
});
