@echo off
:: ============================================================
:: HybridTurtle — Hourly Status (Telegram Updates)
:: ============================================================
:: Sends portfolio status, blockers, and candidate readiness
:: via Telegram every hour during market hours (08:00–21:00 UK).
:: No dashboard needed — runs standalone.
::
:: Usage:
::   hourly-status-task.bat              (interactive)
::   hourly-status-task.bat --scheduled  (silent, for Task Scheduler)
:: ============================================================

title HybridTurtle Hourly Status
setlocal
cd /d "%~dp0"

:: Run the hourly status check
call npx tsx src/cron/hourly-status.ts --run-now 2>&1

set EXIT_CODE=%ERRORLEVEL%

if "%~1"=="--scheduled" goto :end

echo.
if %EXIT_CODE% equ 0 (
    echo  Hourly status sent successfully.
) else (
    echo  Hourly status encountered errors.
)
echo.
pause

:end
exit /b %EXIT_CODE%
