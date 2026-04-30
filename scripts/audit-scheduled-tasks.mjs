/**
 * DEPENDENCIES
 * Consumed by: manual operations, scheduler readiness checks
 * Consumes: Windows schtasks output
 * Risk-sensitive: YES — read-only audit of load-bearing automation.
 * Notes: Does not create, update, disable, or delete scheduled tasks.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

export const EXPECTED_TASKS = [
  { name: 'HybridTurtle Nightly', requiredPath: 'nightly-task.bat' },
  { name: 'HybridTurtle Watchdog', requiredPath: 'watchdog-task.bat' },
  { name: 'HybridTurtle Midday Sync', requiredPath: 'midday-sync-task.bat' },
  { name: 'HybridTurtle-Scan', requiredPath: 'auto-trade-task.bat', requiredArgument: 'scan' },
  { name: 'HybridTurtle-Trade-UK', requiredPath: 'auto-trade-task.bat', requiredArgument: 'uk' },
  { name: 'HybridTurtle-Trade-US', requiredPath: 'auto-trade-task.bat', requiredArgument: 'us' },
  { name: 'HybridTurtle-Trade-USC', requiredPath: 'auto-trade-task.bat', requiredArgument: 'us-close' },
  { name: 'HybridTurtle-HourlyStatus', requiredPath: 'hourly-status-task.bat' },
  { name: 'HybridTurtle-MondayBriefing', requiredPath: 'monday-briefing-task.bat' },
  { name: 'HybridTurtle-UKBriefing', requiredPath: 'uk-briefing-task.bat' },
  { name: 'HybridTurtle-USBriefing', requiredPath: 'us-briefing-task.bat' },
  { name: 'HybridTurtle-WeeklyDigest', requiredPath: 'weekly-digest-task.bat' },
  { name: 'HybridTurtle-TickerAudit', requiredPath: 'ticker-audit-task.bat' },
];

export const RETIRED_TASKS = [
  {
    name: 'HybridTurtle Intraday Alert',
    reason: 'Legacy task target is absent from this repo; nightly near-stop checks and hourly status cover current monitoring paths.',
  },
];

export function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

export function parseSchtasksCsv(output) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? '']));
  });
}

function normalizeTaskName(name) {
  return name.replace(/^\\+/, '');
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

function extractQuotedPaths(command) {
  const quoted = [...String(command ?? '').matchAll(/"([A-Za-z]:\\[^"<>|?*]+)"/g)].map((match) => match[1]);
  const unquoted = [...String(command ?? '').matchAll(/\b([A-Za-z]:\\[^\s"<>|?*]+\.(?:bat|cmd|ps1|mjs|js|ts))\b/gi)].map((match) => match[1]);
  return [...new Set([...quoted, ...unquoted])];
}

export function auditScheduledTasks(tasks, options = {}) {
  const repoRoot = options.repoRoot ?? ROOT;
  const expectedTasks = options.expectedTasks ?? EXPECTED_TASKS;
  const retiredTasks = options.retiredTasks ?? RETIRED_TASKS;
  const expectedByName = new Map(expectedTasks.map((task) => [task.name.toLowerCase(), task]));
  const retiredByName = new Map(retiredTasks.map((task) => [task.name.toLowerCase(), task]));
  const seenExpected = new Set();
  const findings = [];

  for (const task of tasks) {
    const taskName = normalizeTaskName(task.TaskName ?? task['TaskName'] ?? '');
    if (!taskName.toLowerCase().startsWith('hybridturtle')) continue;

    const expected = expectedByName.get(taskName.toLowerCase());
    const retired = retiredByName.get(taskName.toLowerCase());
    const taskToRun = task['Task To Run'] ?? '';
    const startIn = task['Start In'] ?? '';
    const state = task['Scheduled Task State'] ?? task.Status ?? '';
    const lastResult = task['Last Result'] ?? '';
    const disabled = /disabled/i.test(state);

    if (expected) {
      seenExpected.add(expected.name.toLowerCase());

      const requiredPath = path.join(repoRoot, expected.requiredPath);
      if (!normalizeText(taskToRun).includes(normalizeText(requiredPath))) {
        findings.push({ severity: 'ERROR', taskName, reason: 'EXPECTED_PATH_MISMATCH', detail: `Expected action to include ${requiredPath}` });
      }

      if (expected.requiredArgument && !normalizeText(taskToRun).includes(normalizeText(expected.requiredArgument))) {
        findings.push({ severity: 'ERROR', taskName, reason: 'EXPECTED_ARGUMENT_MISSING', detail: `Expected action argument ${expected.requiredArgument}` });
      }

      if (startIn && startIn !== 'N/A' && normalizeText(startIn) !== normalizeText(repoRoot)) {
        findings.push({ severity: 'WARNING', taskName, reason: 'START_IN_MISMATCH', detail: `Start In is ${startIn}` });
      }
    }

    if (disabled) {
      findings.push({ severity: 'WARNING', taskName, reason: retired ? 'RETIRED_TASK_DISABLED' : 'TASK_DISABLED', detail: retired?.reason ?? 'Task is disabled' });
    } else if (retired) {
      findings.push({ severity: 'ERROR', taskName, reason: 'RETIRED_TASK_ENABLED', detail: retired.reason });
    }

    if (lastResult && !['0', '267009', '267011'].includes(lastResult)) {
      findings.push({ severity: 'WARNING', taskName, reason: 'NON_ZERO_LAST_RESULT', detail: `Last Result is ${lastResult}` });
    }

    const referencedPaths = extractQuotedPaths(taskToRun);
    for (const referencedPath of referencedPaths) {
      if (!existsSync(referencedPath)) {
        findings.push({ severity: disabled ? 'WARNING' : 'ERROR', taskName, reason: 'MISSING_TARGET_PATH', detail: referencedPath });
      }
    }

    if (!expected && !retired) {
      findings.push({ severity: 'WARNING', taskName, reason: 'UNTRACKED_HYBRIDTURTLE_TASK', detail: 'Task is not in the expected scheduler manifest' });
    }
  }

  for (const expected of expectedTasks) {
    if (!seenExpected.has(expected.name.toLowerCase())) {
      findings.push({ severity: 'ERROR', taskName: expected.name, reason: 'EXPECTED_TASK_MISSING', detail: 'Task was not registered' });
    }
  }

  return findings;
}

export function runSchedulerAudit(options = {}) {
  if (process.platform !== 'win32' && !options.schtasksOutput) {
    return [{ severity: 'WARNING', taskName: '*', reason: 'UNSUPPORTED_PLATFORM', detail: 'Scheduler audit requires Windows schtasks output' }];
  }

  const output = options.schtasksOutput ?? execFileSync('schtasks', ['/Query', '/FO', 'CSV', '/V'], { encoding: 'utf8' });
  return auditScheduledTasks(parseSchtasksCsv(output), options);
}

function logFindings(findings) {
  if (findings.length === 0) {
    if (!QUIET) console.log('[scheduler-audit] OK: all expected HybridTurtle scheduled tasks are registered with valid targets.');
    return;
  }

  for (const finding of findings) {
    console.log(`[scheduler-audit] ${finding.severity}: ${finding.taskName} ${finding.reason} - ${finding.detail}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const findings = runSchedulerAudit();
  logFindings(findings);
  process.exit(findings.some((finding) => finding.severity === 'ERROR') ? 1 : 0);
}