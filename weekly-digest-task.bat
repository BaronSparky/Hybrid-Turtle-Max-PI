@echo off
:: ============================================================
:: HybridTurtle — Weekly Performance Digest
:: ============================================================
:: Sends a Telegram summary every Sunday: trades, P&L, R-multiples,
:: equity trend, and all-time system grade.
:: Schedule via Task Scheduler to run Sunday at 18:00.
:: ============================================================

title HybridTurtle Weekly Digest
setlocal
cd /d "%~dp0"

:: Ensure migrations are current
call node scripts/auto-migrate.mjs --quiet 2>nul

:: Run the weekly digest
call npx tsx src/cron/weekly-digest.ts --run-now

endlocal
