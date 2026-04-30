/**
 * DEPENDENCIES
 * Consumed by: manual operations
 * Consumes: Windows schtasks, audit-scheduled-tasks.mjs
 * Risk-sensitive: YES - deletes retired scheduled tasks only.
 * Notes: Run from an elevated shell when cleanup requires administrator rights.
 */

import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import path from 'path';
import { RETIRED_TASKS, runSchedulerAudit } from './audit-scheduled-tasks.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

export function cleanupRetiredScheduledTasks(options = {}) {
  const retiredTasks = options.retiredTasks ?? RETIRED_TASKS;
  const execFile = options.execFileSync ?? execFileSync;
  const dryRun = options.dryRun ?? DRY_RUN;
  const results = [];

  for (const task of retiredTasks) {
    if (dryRun) {
      results.push({ taskName: task.name, status: 'DRY_RUN', detail: 'Would delete retired scheduled task' });
      continue;
    }

    try {
      execFile('schtasks', ['/Delete', '/TN', task.name, '/F'], { encoding: 'utf8' });
      results.push({ taskName: task.name, status: 'DELETED', detail: task.reason });
    } catch (error) {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
      results.push({
        taskName: task.name,
        status: 'FAILED',
        detail: output || error.message,
      });
    }
  }

  return results;
}

function printCleanupResults(results) {
  for (const result of results) {
    console.log(`[scheduler-cleanup] ${result.status}: ${result.taskName} - ${result.detail}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const results = cleanupRetiredScheduledTasks();
  printCleanupResults(results);

  if (results.some((result) => result.status === 'FAILED')) {
    console.error('[scheduler-cleanup] Run this command from an elevated administrator shell if deletion was denied.');
    process.exit(1);
  }

  if (!DRY_RUN) {
    const findings = runSchedulerAudit();
    const errors = findings.filter((finding) => finding.severity === 'ERROR');
    if (errors.length > 0) {
      for (const finding of errors) {
        console.error(`[scheduler-cleanup] ERROR: ${finding.taskName} ${finding.reason} - ${finding.detail}`);
      }
      process.exit(1);
    }
  }
}