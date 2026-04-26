@echo off
:: ============================================================
:: HybridTurtle — Watchdog (Missed Heartbeat Detection)
:: ============================================================
:: Checks if nightly/midday tasks ran. Sends Telegram alert if not.
:: Schedule via Task Scheduler to run daily at 10:00 AM.
:: ============================================================

title HybridTurtle Watchdog
setlocal
cd /d "%~dp0"

:: Ensure migrations are current (uses retry logic, matches other scripts)
call node scripts/auto-migrate.mjs --quiet 2>nul

:: Run the watchdog check
call npx tsx src/cron/watchdog.ts

endlocal
