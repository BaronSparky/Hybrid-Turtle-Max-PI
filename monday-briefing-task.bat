@echo off
:: ============================================================
:: HybridTurtle — Monday Pre-Trade Briefing
:: ============================================================
:: Sends a Telegram briefing before the UK market opens.
:: Covers regime, ready candidates, health, risk budget.
:: Schedule via Task Scheduler to run Monday at 07:30.
:: ============================================================

title HybridTurtle Monday Briefing
setlocal
cd /d "%~dp0"

:: Ensure migrations are current
call node scripts/auto-migrate.mjs --quiet 2>nul

:: Run the Monday briefing
call npx tsx src/cron/monday-briefing.ts --run-now

endlocal
