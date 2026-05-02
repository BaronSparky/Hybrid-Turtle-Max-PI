---
title: 2026-04-30 Auto-Trade Rescue Archive
description: Archive of one-shot rescue artifacts from the 2026-04-30 auto-trade incident
ms.date: 2026-05-02
ms.topic: reference
---

## Summary

This folder preserves the one-shot diagnostic and rescue artifacts from the
2026-04-30 auto-trade incident. The files are stored as `.txt` so they remain
forensic evidence only and are not compiled, registered, or run as part of the
live system.

The incident is recorded in [Sacred File Changes](../../SACRED_FILE_CHANGES.md).
The rescue log shows GOOGL, PWR, and UNFI reached `STOPPED` or
`ALREADY_STOPPED` by the 2026-05-01 runs.

## Archived Files

* `check-positions.ts.txt`: One-shot database and execution-log diagnostic
* `rescue-stops-task.bat.txt`: One-shot scheduled task wrapper
* `rescue-stops-2026-04-30.ts.txt`: One-shot T212 stop rescue script
* `rescue-stops.log.txt`: Run transcript showing stop protection status

## Operational Status

These artifacts are retired. Do not register or run them during normal
operations. If a similar incident occurs, create a fresh incident-specific
script after reviewing the current broker, stop, and position state.
