import { describe, expect, it } from 'vitest';

/**
 * Tests for the nightly step tracking infrastructure.
 * Replicates the startStep/markStepFailed/finalizeSteps pattern from nightly.ts
 * to verify the step result shape and state machine behavior.
 */

interface StepResult {
  step: string;
  name: string;
  status: 'OK' | 'FAILED' | 'SKIPPED';
  error?: string;
  durationMs: number;
}

function createStepTracker() {
  const stepResults: StepResult[] = [];
  let currentStepStart = 0;
  let currentStepHadFailure = false;
  let currentStepError: string | undefined;

  function startStep(step: string, name: string): void {
    if (stepResults.length > 0) {
      const prev = stepResults[stepResults.length - 1];
      prev.durationMs = Date.now() - currentStepStart;
      if (currentStepHadFailure) {
        prev.status = 'FAILED';
        if (currentStepError) prev.error = currentStepError;
      }
    }
    currentStepStart = Date.now();
    currentStepHadFailure = false;
    currentStepError = undefined;
    stepResults.push({ step, name, status: 'OK', durationMs: 0 });
  }

  function markStepFailed(error: string): void {
    currentStepHadFailure = true;
    currentStepError = error;
  }

  function finalizeSteps(): void {
    if (stepResults.length > 0) {
      const last = stepResults[stepResults.length - 1];
      last.durationMs = Date.now() - currentStepStart;
      if (currentStepHadFailure) {
        last.status = 'FAILED';
        if (currentStepError) last.error = currentStepError;
      }
    }
  }

  return { stepResults, startStep, markStepFailed, finalizeSteps };
}

describe('nightly step tracking', () => {
  it('produces correct shape for a single step', () => {
    const { stepResults, startStep, finalizeSteps } = createStepTracker();
    startStep('0', 'Pre-cache');
    finalizeSteps();

    expect(stepResults).toHaveLength(1);
    expect(stepResults[0]).toMatchObject({
      step: '0',
      name: 'Pre-cache',
      status: 'OK',
    });
    expect(stepResults[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('auto-closes previous step when starting a new one', () => {
    const { stepResults, startStep, finalizeSteps } = createStepTracker();
    startStep('1', 'Health check');
    startStep('2', 'Live prices');
    finalizeSteps();

    expect(stepResults).toHaveLength(2);
    expect(stepResults[0].status).toBe('OK');
    expect(stepResults[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(stepResults[1].status).toBe('OK');
  });

  it('marks step as FAILED with error message', () => {
    const { stepResults, startStep, markStepFailed, finalizeSteps } = createStepTracker();
    startStep('1', 'Health check');
    markStepFailed('Connection timeout');
    finalizeSteps();

    expect(stepResults[0].status).toBe('FAILED');
    expect(stepResults[0].error).toBe('Connection timeout');
  });

  it('failure in one step does not affect subsequent steps', () => {
    const { stepResults, startStep, markStepFailed, finalizeSteps } = createStepTracker();
    startStep('1', 'Health check');
    markStepFailed('Failed');
    startStep('2', 'Live prices');
    finalizeSteps();

    expect(stepResults[0].status).toBe('FAILED');
    expect(stepResults[1].status).toBe('OK');
  });

  it('tracks all 9 nightly steps correctly', () => {
    const { stepResults, startStep, finalizeSteps } = createStepTracker();
    const steps = [
      ['0', 'Pre-cache'],
      ['1', 'Health check'],
      ['2', 'Live prices'],
      ['3', 'Stop management'],
      ['4', 'Laggard detection'],
      ['5', 'Risk modules'],
      ['6', 'Equity snapshot'],
      ['7', 'Snapshot sync'],
      ['8', 'Telegram alert'],
    ] as const;

    for (const [id, name] of steps) {
      startStep(id, name);
    }
    finalizeSteps();

    expect(stepResults).toHaveLength(9);
    expect(stepResults.every(s => s.status === 'OK')).toBe(true);
    expect(stepResults.map(s => s.step)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('last markStepFailed wins when called multiple times', () => {
    const { stepResults, startStep, markStepFailed, finalizeSteps } = createStepTracker();
    startStep('1', 'Test');
    markStepFailed('first error');
    markStepFailed('second error');
    finalizeSteps();

    expect(stepResults[0].error).toBe('second error');
  });

  it('produces serializable JSON output', () => {
    const { stepResults, startStep, markStepFailed, finalizeSteps } = createStepTracker();
    startStep('0', 'Pre-cache');
    startStep('1', 'Health');
    markStepFailed('timeout');
    finalizeSteps();

    const json = JSON.stringify(stepResults);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].error).toBe('timeout');
  });
});
