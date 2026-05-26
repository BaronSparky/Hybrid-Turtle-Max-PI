@echo off
:: ============================================================
:: HybridTurtle — Register ALL Scheduled Tasks (master)
:: ============================================================
:: One double-click entry point. Self-elevates via UAC and
:: chains every register-*.bat / .ps1 in sequence:
::   1. HybridTurtle Nightly        (21:10)
::   2. HybridTurtle Watchdog       (every 15 min)
::   3. HybridTurtle Midday Sync    (13:30)
::   4. Auto-Trade family           (Scan / UK / UKM / US / USM / USC / HourlyStatus)
::   5. Weekly + Daily extras       (Monday/UK/US Briefings, WeeklyDigest,
::                                   TickerAudit, ResearchRefresh)
::
:: Reads .env so ENABLE_AUTO_TRADING is respected by the chained
:: scripts. Safe to re-run — each register script /Delete /F then
:: /Create /F so it's idempotent.
:: ============================================================

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\register-all-tasks.ps1"
echo.
pause
