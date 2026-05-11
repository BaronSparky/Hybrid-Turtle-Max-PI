@echo off
:: ============================================================
:: HybridTurtle — Watchdog (Missed Heartbeat Detection)
:: ============================================================
:: Checks if nightly/midday tasks ran. Sends Telegram alert if not.
:: Schedule via Task Scheduler to run daily at 10:05 AM.
:: ============================================================

title HybridTurtle Watchdog
setlocal enabledelayedexpansion
cd /d "%~dp0"

set T0=%time%

:: Ensure migrations are current (uses retry logic, matches other scripts)
call node scripts/auto-migrate.mjs --quiet 2>nul

echo  [watchdog-task] auto-migrate: %T0% -^> %time%
set T1=%time%

:: Run the watchdog check
call npx tsx src/cron/watchdog.ts

echo  [watchdog-task] watchdog.ts:   %T1% -^> %time%
echo  [watchdog-task] total:         %T0% -^> %time%

endlocal
