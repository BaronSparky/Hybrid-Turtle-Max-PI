@echo off
:: Registers HybridTurtle Watchdog scheduled task (self-elevates)
:: Runs daily at 10:05 AM to check for missed nightly/midday heartbeats.
:: Staggered from 10:00 to avoid SQLite/CPU contention with Midday Sync.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process cmd -Verb RunAs -ArgumentList '/c \"%~f0\"'"
    exit /b
)

echo.
echo  ==========================================================
echo   HybridTurtle — Registering Watchdog Scheduled Task
echo  ==========================================================
echo.

:: Delete existing task
schtasks /delete /tn "HybridTurtle Watchdog" /f >nul 2>&1

:: Register: runs daily at 10:05 AM (staggered from Midday Sync at 10:00)
schtasks /create /tn "HybridTurtle Watchdog" /tr "\"%~dp0watchdog-task.bat\"" /sc daily /st 10:05 /rl highest /f

if %errorlevel% equ 0 (
    echo.
    echo  [OK] Task "HybridTurtle Watchdog" registered — runs daily at 10:05 AM
    echo  Applying battery/idle/limit settings...
    powershell -NoProfile -Command ^
      "$t = Get-ScheduledTask -TaskName 'HybridTurtle Watchdog';" ^
      "$t.Settings.ExecutionTimeLimit = 'PT10M';" ^
      "$t.Settings.DisallowStartIfOnBatteries = $false;" ^
      "$t.Settings.StopIfGoingOnBatteries = $false;" ^
      "$t.Settings.StartWhenAvailable = $true;" ^
      "$t.Settings.IdleSettings.StopOnIdleEnd = $false;" ^
      "Set-ScheduledTask -InputObject $t | Out-Null;" ^
      "Write-Host '  [OK] Settings applied: PT10M, battery-safe, start-when-available'"
) else (
    echo.
    echo  [FAIL] Could not register task. Try running as Administrator.
)

echo.
pause
