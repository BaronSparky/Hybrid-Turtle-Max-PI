@echo off
:: ============================================================
:: HybridTurtle — Post-Install Cleanup (master)
:: ============================================================
:: Double-clickable entry point. Self-elevates via UAC and runs:
::
::   1. Removes stale 'HybridTurtle-Nightly' (dash) task left over
::      from an older repo location.
::   2. Applies expected ExecutionTimeLimits via
::      scripts\apply-task-time-limits.ps1 (fixes HourlyStatus drift).
::   3. Ensures prisma\backups\ exists for the nightly db backup.
::   4. Re-runs the scheduler audit to confirm a clean state.
::
:: Safe to re-run — every step is idempotent.
:: ============================================================

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\cleanup-tasks.ps1"
echo.
pause
