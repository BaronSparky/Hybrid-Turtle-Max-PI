import { describe, expect, it, vi } from 'vitest';
import { cleanupRetiredScheduledTasks } from './cleanup-retired-scheduled-tasks.mjs';

describe('cleanup-retired-scheduled-tasks.mjs', () => {
  it('reports dry-run deletes without invoking schtasks', () => {
    const execFileSync = vi.fn();

    const results = cleanupRetiredScheduledTasks({
      dryRun: true,
      execFileSync,
      retiredTasks: [{ name: 'HybridTurtle Intraday Alert', reason: 'retired legacy task' }],
    });

    expect(execFileSync).not.toHaveBeenCalled();
    expect(results).toEqual([
      { taskName: 'HybridTurtle Intraday Alert', status: 'DRY_RUN', detail: 'Would delete retired scheduled task' },
    ]);
  });

  it('deletes retired tasks with schtasks when not in dry-run mode', () => {
    const execFileSync = vi.fn();

    const results = cleanupRetiredScheduledTasks({
      dryRun: false,
      execFileSync,
      retiredTasks: [{ name: 'HybridTurtle Intraday Alert', reason: 'retired legacy task' }],
    });

    expect(execFileSync).toHaveBeenCalledWith('schtasks', ['/Delete', '/TN', 'HybridTurtle Intraday Alert', '/F'], { encoding: 'utf8' });
    expect(results).toEqual([
      { taskName: 'HybridTurtle Intraday Alert', status: 'DELETED', detail: 'retired legacy task' },
    ]);
  });

  it('reports access-denied failures without throwing', () => {
    const error = new Error('Command failed');
    Object.assign(error, { stderr: 'ERROR: Access is denied.' });
    const execFileSync = vi.fn(() => { throw error; });

    const results = cleanupRetiredScheduledTasks({
      dryRun: false,
      execFileSync,
      retiredTasks: [{ name: 'HybridTurtle Intraday Alert', reason: 'retired legacy task' }],
    });

    expect(results).toEqual([
      { taskName: 'HybridTurtle Intraday Alert', status: 'FAILED', detail: 'ERROR: Access is denied.' },
    ]);
  });
});