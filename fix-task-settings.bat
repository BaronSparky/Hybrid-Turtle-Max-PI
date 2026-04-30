@echo off
:: Fix ALL HybridTurtle scheduled tasks to not skip on battery/idle
:: Right-click this file and choose "Run as administrator"
echo.
echo  Fixing HybridTurtle scheduled tasks...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($name in @('HybridTurtle-HourlyStatus','HybridTurtle-Scan','HybridTurtle-Trade-UK','HybridTurtle-Trade-US','HybridTurtle-Trade-USC','HybridTurtle Nightly','HybridTurtle Watchdog','HybridTurtle Midday Sync')) { $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue; if ($t) { $t.Settings.DisallowStartIfOnBatteries = $false; $t.Settings.StopIfGoingOnBatteries = $false; $t.Settings.IdleSettings.StopOnIdleEnd = $false; $t.Settings.StartWhenAvailable = $true; Set-ScheduledTask -InputObject $t | Out-Null; Write-Host ('  Fixed: ' + $name) -ForegroundColor Green } else { Write-Host ('  Not found: ' + $name) -ForegroundColor Yellow } }"
echo.
echo  Done. Tasks will no longer skip on battery or idle.
echo.
pause
