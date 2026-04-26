@echo off
:: Registers HybridTurtle Nightly scheduled task (self-elevates)
:: Double-click this file to run.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process cmd -Verb RunAs -ArgumentList '/c \"%~f0\"'"
    exit /b
)

echo.
echo  ==========================================================
echo   HybridTurtle — Registering Nightly Scheduled Task
echo  ==========================================================
echo.

:: Delete existing task
schtasks /delete /tn "HybridTurtle Nightly" /f >nul 2>&1

:: Use PowerShell Register-ScheduledTask for full control (already elevated)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-nightly-task.ps1" -FromBat

echo.
pause
