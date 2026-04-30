---
title: HybridTurtle Scheduler Audit
description: How to run the scheduler audit and repair common Windows Task Scheduler findings
author: HybridTurtle
ms.date: 2026-04-30
ms.topic: troubleshooting
keywords:
  - scheduler
  - task scheduler
  - automation
  - audit
estimated_reading_time: 4
---

## Purpose

HybridTurtle relies on Windows Task Scheduler for live operational jobs such as
nightly processing, watchdog checks, midday broker sync, auto-trade sessions,
briefings, and ticker audits. The scheduler audit checks that those tasks still
point at this repository and that retired legacy tasks are not active.

Run the audit after installer changes, machine moves, task repairs, or any
unexpected missed automation window.

```powershell
npm run tasks:audit
```

The smoke command also runs the scheduler audit:

```powershell
npm run smoke
```

## Finding Severity

Errors mean a load-bearing task is missing or points at the wrong target. Fix
errors before trusting scheduled automation.

Warnings mean the system is still operational, but there is drift to clean up.
Common warning examples include disabled retired tasks, old non-zero task
results, or disabled tasks that are intentionally offline.

## Common Repairs

### Retired Intraday Alert Task

`HybridTurtle Intraday Alert` is a retired legacy task. It points at the old
`C:\HybridTurtle-v6.0\intraday-alert-task.bat` path and is replaced by current
nightly near-stop checks plus hourly status monitoring.

If the audit reports it as disabled, automation can still run. Delete it from an
elevated PowerShell or Command Prompt to remove the warning:

```powershell
schtasks /Delete /TN "HybridTurtle Intraday Alert" /F
```

If deletion returns `Access is denied`, open the shell as administrator and run
the command again.

### Midday Sync Drift

The canonical midday task is `HybridTurtle Midday Sync`. It should run
`midday-sync-task.bat --scheduled` from this repository at 10:00, 13:00, 16:00,
and 19:00 on weekdays.

Repair it from an elevated PowerShell session:

```powershell
.\register-midday-sync.ps1
```

The older `HybridTurtle-MiddaySync` task is not canonical. Delete it if it
appears:

```powershell
schtasks /Delete /TN "HybridTurtle-MiddaySync" /F
```

### Auto-Trade Task Drift

Auto-trade tasks must call `auto-trade-task.bat` with the expected scheduled
session argument:

* `HybridTurtle-Scan`: `scan --scheduled`
* `HybridTurtle-Trade-UK`: `uk --scheduled`
* `HybridTurtle-Trade-US`: `us --scheduled`
* `HybridTurtle-Trade-USC`: `us-close --scheduled`

Repair them from an elevated shell with:

```powershell
.\register-auto-trade.bat
```

> [!WARNING]
> Do not manually run the `uk`, `us`, or `us-close` auto-trade sessions unless
> you intend to allow the live order path. The scheduled task registration is
> safe; the trading sessions themselves can place orders when enabled.

## Verification

After any repair, run:

```powershell
npm run tasks:audit
npm run smoke
```

The audit is clean when it prints no errors. Retired-task warnings are acceptable
only when the task is disabled and cannot be removed without administrator
permissions.