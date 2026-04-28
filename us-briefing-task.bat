@echo off
:: ============================================================
:: HybridTurtle — US Pre-Session Briefing
:: ============================================================
:: Sends a Telegram briefing before the US auto-trade session.
:: Schedule via Task Scheduler: Tue-Fri at 14:30.
:: ============================================================

title HybridTurtle US Briefing
setlocal
cd /d "%~dp0"

call node scripts/auto-migrate.mjs --quiet 2>nul
call npx tsx src/cron/us-briefing.ts --run-now

endlocal
