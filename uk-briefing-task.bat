@echo off
:: ============================================================
:: HybridTurtle — UK Pre-Session Briefing
:: ============================================================
:: Sends a Telegram briefing before the UK auto-trade session.
:: Schedule via Task Scheduler: Mon-Fri at 08:00.
:: ============================================================

title HybridTurtle UK Briefing
setlocal
cd /d "%~dp0"

call node scripts/auto-migrate.mjs --quiet 2>nul
call npx tsx src/cron/uk-briefing.ts --run-now

endlocal
