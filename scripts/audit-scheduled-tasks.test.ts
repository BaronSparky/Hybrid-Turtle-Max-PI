import { describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((filePath: string) => !filePath.includes('HybridTurtle-v6.0')),
  };
});

const { auditScheduledTasks, parseCsvLine, parseSchtasksCsv } = await import('./audit-scheduled-tasks.mjs');

describe('audit-scheduled-tasks.mjs', () => {
  it('parses schtasks CSV rows with quoted commands', () => {
    const output = '"TaskName","Task To Run","Start In"\r\n"\\HybridTurtle-Scan","C:\\Repo\\auto-trade-task.bat scan --scheduled","C:\\Repo"\r\n';

    expect(parseSchtasksCsv(output)).toEqual([
      {
        TaskName: '\\HybridTurtle-Scan',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat scan --scheduled',
        'Start In': 'C:\\Repo',
      },
    ]);
  });

  it('handles escaped quotes inside a CSV field', () => {
    expect(parseCsvLine('"cmd.exe /c ""C:\\Repo\\task.bat"" --scheduled","Ready"')).toEqual([
      'cmd.exe /c "C:\\Repo\\task.bat" --scheduled',
      'Ready',
    ]);
  });

  it('flags stale missing paths and untracked HybridTurtle tasks', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle Intraday Alert',
        'Task To Run': 'cmd.exe /c "C:\\HybridTurtle-v6.0\\intraday-alert-task.bat" --scheduled',
        'Start In': 'C:\\HybridTurtle-v6.0',
        'Scheduled Task State': 'Enabled',
        'Last Result': '-2147024629',
      },
    ], { repoRoot: 'C:\\Repo', expectedTasks: [], retiredTasks: [] });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'MISSING_TARGET_PATH', severity: 'ERROR' }),
      expect.objectContaining({ reason: 'UNTRACKED_HYBRIDTURTLE_TASK', severity: 'WARNING' }),
      expect.objectContaining({ reason: 'NON_ZERO_LAST_RESULT', severity: 'WARNING' }),
    ]));
  });

  it('downgrades missing target paths for disabled retired tasks', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle Intraday Alert',
        'Task To Run': 'cmd.exe /c "C:\\HybridTurtle-v6.0\\intraday-alert-task.bat" --scheduled',
        'Start In': 'C:\\HybridTurtle-v6.0',
        'Scheduled Task State': 'Disabled',
        'Last Result': '-2147024629',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [],
      retiredTasks: [{ name: 'HybridTurtle Intraday Alert', reason: 'retired legacy task' }],
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'RETIRED_TASK_DISABLED', severity: 'WARNING' }),
      expect.objectContaining({ reason: 'MISSING_TARGET_PATH', severity: 'WARNING' }),
    ]));
    expect(findings.some((finding) => finding.severity === 'ERROR')).toBe(false);
  });

  it('fails when a retired task is still enabled', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle Intraday Alert',
        'Task To Run': 'cmd.exe /c "C:\\HybridTurtle-v6.0\\intraday-alert-task.bat" --scheduled',
        'Start In': 'C:\\HybridTurtle-v6.0',
        'Scheduled Task State': 'Enabled',
        'Last Result': '0',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [],
      retiredTasks: [{ name: 'HybridTurtle Intraday Alert', reason: 'retired legacy task' }],
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'RETIRED_TASK_ENABLED', severity: 'ERROR' }),
      expect.objectContaining({ reason: 'MISSING_TARGET_PATH', severity: 'ERROR' }),
    ]));
  });

  it('passes expected current-repo tasks with valid command arguments', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle-Trade-UK',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat uk --scheduled',
        'Start In': 'C:\\Repo',
        'Scheduled Task State': 'Enabled',
        'Last Result': '0',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [{ name: 'HybridTurtle-Trade-UK', requiredPath: 'auto-trade-task.bat', requiredArgument: 'uk' }],
    });

    expect(findings).toEqual([]);
  });

  it('does not warn on N/A Start In when the action path is absolute and valid', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle-Scan',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat scan --scheduled',
        'Start In': 'N/A',
        'Scheduled Task State': 'Enabled',
        'Last Result': '0',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [{ name: 'HybridTurtle-Scan', requiredPath: 'auto-trade-task.bat', requiredArgument: 'scan' }],
    });

    expect(findings).toEqual([]);
  });

  it('does not warn when a task is currently running', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle-Trade-US',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat us --scheduled',
        'Start In': 'N/A',
        'Scheduled Task State': 'Running',
        'Last Result': '267009',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [{ name: 'HybridTurtle-Trade-US', requiredPath: 'auto-trade-task.bat', requiredArgument: 'us' }],
    });

    expect(findings).toEqual([]);
  });
});