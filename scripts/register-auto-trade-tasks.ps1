$bat = "C:\Turtle-Hybrid\Hybrid-Trurtle-Max\auto-trade-task.bat"
$hs  = "C:\Turtle-Hybrid\Hybrid-Trurtle-Max\hourly-status-task.bat"

schtasks /Delete /TN "HybridTurtle-Scan" /F 2>$null
schtasks /Create /TN "HybridTurtle-Scan" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:00 /TR "`"$bat`" scan --scheduled" /RL HIGHEST /F
Write-Host "Scan: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-UK" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-UK" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:15 /TR "`"$bat`" uk --scheduled" /RL HIGHEST /F
Write-Host "UK: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-US" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-US" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 14:45 /TR "`"$bat`" us --scheduled" /RL HIGHEST /F
Write-Host "US: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-USC" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-USC" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:30 /TR "`"$bat`" us-close --scheduled" /RL HIGHEST /F
Write-Host "USC: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-HourlyStatus" /F 2>$null
schtasks /Create /TN "HybridTurtle-HourlyStatus" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:00 /RI 60 /DU 13:00 /TR "`"$hs`" --scheduled" /RL HIGHEST /F
Write-Host "Hourly: $LASTEXITCODE"

"DONE" | Out-File "C:\Turtle-Hybrid\Hybrid-Trurtle-Max\auto-trade-result.txt"
