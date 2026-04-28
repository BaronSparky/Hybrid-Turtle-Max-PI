@echo off
:: ============================================================
:: HybridTurtle — Ticker Audit (Clean Delisted Tickers)
:: ============================================================
:: Probes all active tickers against Yahoo Finance and deactivates
:: any that return no data (delisted, renamed, or invalid symbols).
::
:: Schedule: Monthly (1st Sunday) or run manually after market changes.
::
:: Usage:
::   ticker-audit-task.bat              (interactive, pauses on finish)
::   ticker-audit-task.bat --scheduled  (silent, for Task Scheduler)
:: ============================================================

title HybridTurtle Ticker Audit
setlocal
cd /d "%~dp0"

:: Run migrations first
call node scripts/auto-migrate.mjs --quiet

echo [%date% %time%] Starting ticker audit... >> ticker-audit.log

:: Run ticker audit with --apply flag (deactivates delisted tickers)
call npx tsx scripts/clean-delisted-tickers.ts --apply 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath 'ticker-audit.log' -Append"

set EXIT_CODE=%ERRORLEVEL%

echo [%date% %time%] Ticker audit finished (exit code: %EXIT_CODE%) >> ticker-audit.log

if "%~1"=="--scheduled" goto :end

echo.
if %EXIT_CODE% equ 0 (
    echo  Ticker audit completed successfully.
) else (
    echo  Ticker audit encountered errors. Check ticker-audit.log
)
echo.
pause

:end
exit /b %EXIT_CODE%
